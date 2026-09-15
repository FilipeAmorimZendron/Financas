// api/criar-checkout.js
// Serverless function (roda na Vercel, no servidor — nunca no navegador).
// Quando o usuário clica "Assinar", esta função devolve o link do checkout
// certo pra ele.
//
// Diferente do Asaas, a Kiwify NÃO tem API pra criar um checkout dinâmico
// com preço calculado na hora — o checkout é um link FIXO, configurado no
// painel deles (Produtos → [produto] → aba Checkout). Por isso essa função
// não calcula nada: só escolhe entre os 4 links já cadastrados de acordo
// com o plano/tipo de pagamento escolhido, e devolve pro navegador redirecionar.
//
// Sem cupom de desconto por enquanto (decisão de 2026-09-15) — se um dia
// voltar a usar, a Kiwify aceita cupom nativo aplicado direto no checkout
// dela (?coupon=CODIGO na URL), não precisa passar pelo nosso servidor.

import { limitar, chaveDoIP } from "./_ratelimit.js";

// Os 4 links de checkout, cadastrados manualmente no painel da Kiwify.
// Se recriar algum produto lá (o link muda), atualiza aqui.
const CHECKOUT_KIWIFY = {
  pessoal:     { mensal: "https://pay.kiwify.com.br/2dgjQkc", vitalicio: "https://pay.kiwify.com.br/AD5Ni2q" },
  empresarial: { mensal: "https://pay.kiwify.com.br/Beh4v29", vitalicio: "https://pay.kiwify.com.br/Z0iNdQ8" },
};

// Só pra mensagens/analytics (InitiateCheckout) — o valor cobrado de
// verdade é o que está configurado no plano/produto lá na Kiwify.
const PRECOS = {
  pessoal:     { mensal: 26.9,  vitalicio: 369.9 },
  empresarial: { mensal: 41.9,  vitalicio: 479.9 },
};

const SUPABASE_URL = process.env.SUPABASE_URL || "https://yuvhkrwksdnajfautkru.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Valida o token do usuário e retorna o ID dele (não dá pra falsificar,
// mesmo padrão usado em api/chat-ia.js e api/ler-extrato.js).
async function validarUsuario(token, anonKey) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user && user.id ? { id: user.id, email: user.email } : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  // Limite básico por IP: evita martelar esta rota (não cria nada num
  // processador externo aqui, mas evita abuso/enumeração mesmo assim).
  const { permitido } = limitar(chaveDoIP(req), 8, 60_000);
  if (!permitido) {
    return res.status(429).json({ erro: "Muitas tentativas. Aguarde um minuto e tente de novo." });
  }

  if (!SUPABASE_ANON_KEY) {
    return res.status(500).json({ erro: "Servidor sem as chaves configuradas" });
  }

  try {
    const { email, nome, token, tipoConta: tipoContaBruto, tipoPagamento: tipoPagamentoBruto } = req.body || {};
    const tipoConta = tipoContaBruto === "empresarial" ? "empresarial" : "pessoal";
    const tipoPagamento = tipoPagamentoBruto === "vitalicio" ? "vitalicio" : "mensal";

    if (!email) {
      return res.status(400).json({ erro: "Dados do usuário faltando" });
    }
    if (!token || typeof token !== "string") {
      return res.status(401).json({ erro: "Sessão inválida. Faça login novamente." });
    }

    // CRÍTICO: o userId NUNCA vem do corpo da requisição — vem só da
    // validação do token de sessão.
    const usuario = await validarUsuario(token, SUPABASE_ANON_KEY);
    if (!usuario) {
      return res.status(401).json({ erro: "Sessão expirada. Faça login novamente." });
    }

    // Troca de plano (Pessoal <-> Empresarial) de quem JÁ assina: a Kiwify
    // não tem API pra atualizar o valor de uma assinatura existente (o
    // Asaas tinha) — aqui a pessoa simplesmente assina o novo plano, e
    // precisa cancelar o antigo por conta própria (link de gerenciar
    // assinatura que a Kiwify manda por e-mail, ou dashboard.kiwify.com.br/
    // minhas-compras). Avisamos isso na mensagem de volta.
    let trocaDePlano = false;
    if (SUPABASE_SERVICE_KEY) {
      try {
        const respPerfil = await fetch(
          `${SUPABASE_URL}/rest/v1/perfil?user_id=eq.${encodeURIComponent(usuario.id)}&select=assinatura_status,empresarial`,
          { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
        );
        if (respPerfil.ok) {
          const linhas = await respPerfil.json();
          const perfilAtual = linhas[0];
          const tierAtual = perfilAtual?.empresarial ? "empresarial" : "pessoal";
          if (perfilAtual?.assinatura_status === "ativa" && tierAtual !== tipoConta) {
            trocaDePlano = true;
          }
        }
      } catch (e) {
        console.error("Falha ao checar troca de plano:", e);
      }
    }

    const link = CHECKOUT_KIWIFY[tipoConta]?.[tipoPagamento];
    if (!link) {
      return res.status(500).json({ erro: "Checkout não configurado pra esse plano." });
    }

    // Pré-preenche nome/e-mail no checkout da Kiwify (ela aceita esses
    // parâmetros na URL) — poupa a pessoa de digitar de novo.
    const url = new URL(link);
    url.searchParams.set("email", email);
    if (nome) url.searchParams.set("name", nome);

    const valor = PRECOS[tipoConta]?.[tipoPagamento] ?? null;

    return res.status(200).json({
      url: url.toString(),
      valor,
      vitalicio: tipoPagamento === "vitalicio",
      troca: trocaDePlano,
      mensagem: trocaDePlano
        ? "Você será levado pro checkout do novo plano. Depois de assinar, lembre de cancelar sua assinatura atual — link de gerenciar assinatura no e-mail que você recebeu da Kiwify, ou em dashboard.kiwify.com.br/minhas-compras."
        : null,
    });

  } catch (e) {
    return res.status(500).json({ erro: "Erro interno", detalhe: String(e) });
  }
}

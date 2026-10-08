// api/criar-checkout.js
// Serverless function (roda na Vercel, no servidor — nunca no navegador).
// Quando o usuário clica "Assinar", esta função devolve o link do checkout
// certo pra ele.
//
// Diferente do Asaas, a Kiwify NÃO tem API pra criar um checkout dinâmico
// com preço calculado na hora — o checkout é um link FIXO, configurado no
// painel deles (Produtos → [produto] → aba Checkout). Por isso essa função
// não calcula nada: só escolhe entre os links já cadastrados de acordo
// com o tipo da conta e o tipo de pagamento, e devolve pro navegador redirecionar.
//
// Sem cupom de desconto por enquanto (decisão de 2026-09-15) — se um dia
// voltar a usar, a Kiwify aceita cupom nativo aplicado direto no checkout
// dela (?coupon=CODIGO na URL), não precisa passar pelo nosso servidor.

import { limitar, chaveDoIP } from "./_ratelimit.js";

// Os links de checkout, cadastrados manualmente no painel da Kiwify.
// Se recriar algum produto lá (o link muda), atualiza aqui.
const CHECKOUT_KIWIFY = {
  pessoal:     { mensal: "https://pay.kiwify.com.br/2dgjQkc", vitalicio: "https://pay.kiwify.com.br/AD5Ni2q" },
  empresarial: { mensal: "https://pay.kiwify.com.br/Beh4v29", vitalicio: "https://pay.kiwify.com.br/Z0iNdQ8" },
};
// "Empresa extra" (3ª empresa em diante de uma conta Empresarial): R$ 19,90,
// pagamento único. Produto a criar na Kiwify — o NOME dele precisa conter
// "empresa extra" (é assim que o webhook reconhece, ver classificarProduto).
// Enquanto estiver null, o app avisa que a compra ainda não está disponível.
const CHECKOUT_EMPRESA_EXTRA = null;
const PRECO_EMPRESA_EXTRA = 19.9;

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
    let tipoConta = tipoContaBruto === "empresarial" ? "empresarial" : "pessoal";
    const tipoPagamento = tipoPagamentoBruto === "vitalicio" ? "vitalicio"
      : tipoPagamentoBruto === "empresa_extra" ? "empresa_extra" : "mensal";

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

    // Desde 08/10/2026 cada conta tem UM tipo (perfil.tipo_conta), fixo
    // desde o cadastro: o plano cobrado é sempre o desse tipo, não importa
    // o que o navegador mandou. Por isso não existe mais "troca de plano"
    // Pessoal <-> Empresarial.
    let perfilAtual = null;
    if (SUPABASE_SERVICE_KEY) {
      try {
        const respPerfil = await fetch(
          `${SUPABASE_URL}/rest/v1/perfil?user_id=eq.${encodeURIComponent(usuario.id)}&select=assinatura_status,empresarial,tipo_conta`,
          { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
        );
        if (respPerfil.ok) {
          const linhas = await respPerfil.json();
          perfilAtual = linhas[0] || null;
        }
      } catch (e) {
        console.error("Falha ao ler o perfil:", e);
      }
    }
    if (perfilAtual?.tipo_conta === "empresarial" || perfilAtual?.tipo_conta === "pessoal") {
      tipoConta = perfilAtual.tipo_conta;
    }

    // Empresa extra: só pra conta Empresarial com o plano ativo.
    if (tipoPagamento === "empresa_extra") {
      if (tipoConta !== "empresarial") {
        return res.status(400).json({ erro: "Empresas extras são só pra contas Empresariais." });
      }
      if (perfilAtual?.assinatura_status !== "ativa" || !perfilAtual?.empresarial) {
        return res.status(400).json({ erro: "Assine o plano Empresarial antes de liberar mais empresas." });
      }
      if (!CHECKOUT_EMPRESA_EXTRA) {
        return res.status(503).json({ erro: "A compra de empresa extra ainda não está disponível. Fale com o suporte: suporte@fazfinancas.com." });
      }
      const urlExtra = new URL(CHECKOUT_EMPRESA_EXTRA);
      urlExtra.searchParams.set("email", email);
      if (nome) urlExtra.searchParams.set("name", nome);
      return res.status(200).json({ url: urlExtra.toString(), valor: PRECO_EMPRESA_EXTRA, vitalicio: false, troca: false, mensagem: null });
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
      troca: false,
      mensagem: null,
    });

  } catch (e) {
    return res.status(500).json({ erro: "Erro interno", detalhe: String(e) });
  }
}

// api/criar-checkout.js
// Serverless function (roda na Vercel, no servidor — nunca no navegador).
// Quando o usuário clica "Assinar", esta função:
//   1. cria (ou reusa) o cliente no Asaas
//   2. cria um checkout recorrente
//   3. devolve o link da página de pagamento do Asaas
// A chave do Asaas vem de process.env.ASAAS_KEY (configurada na Vercel).

import { limitar, chaveDoIP } from "./_ratelimit.js";

// ---- Plano único (valor em reais) ----
// Não existe mais escolha de plano nem ciclo anual — um preço só, cobrado
// todo mês. "premium" segue sendo o valor gravado em perfil.plano (e no
// externalReference do Asaas) só por compatibilidade com o resto do
// código — não precisou renomear nada no banco pra fazer essa mudança.
const PLANO_UNICO = { valor: 27.9, nome: "FAZ Finanças", desc: "Todos os recursos: IA financeira, contas ilimitadas, investimentos, relatórios e importação de extrato. Cancele quando quiser." };
const PLANO_ID = "premium";
const CICLO = "mensal";

// Sandbox por padrão. Em produção troque para https://api.asaas.com/v3
const ASAAS_URL = process.env.ASAAS_URL || "https://api-sandbox.asaas.com/v3";

// URL do seu site (pra onde o usuário volta depois de pagar)
const SITE_URL = process.env.SITE_URL || "https://fazfinancas.com";

const SUPABASE_URL_AUTH = process.env.SUPABASE_URL || "https://yuvhkrwksdnajfautkru.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Valida o token do usuário e retorna o ID dele (não dá pra falsificar,
// mesmo padrão usado em api/chat-ia.js, api/ler-extrato.js e api/excluir-conta.js).
async function validarUsuario(token, anonKey) {
  const res = await fetch(`${SUPABASE_URL_AUTH}/auth/v1/user`, {
    headers: { "apikey": anonKey, "Authorization": `Bearer ${token}` }
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user && user.id ? user.id : null;
}

// Logo do FAZ (256x256, base64) exibida como imagem do item no checkout.
const LOGO_FAZ = "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";

export default async function handler(req, res) {
  // Só aceita POST
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  const chave = process.env.ASAAS_KEY;
  if (!chave) {
    return res.status(500).json({ erro: "Chave do Asaas não configurada" });
  }

  // Limite básico por IP: evita que alguém martele esta rota e crie clientes
  // e checkouts em massa no Asaas (a proteção de verdade contra abuso segue
  // sendo o token de sessão exigido abaixo — isto é só uma trava extra).
  const { permitido } = limitar(chaveDoIP(req), 8, 60_000);
  if (!permitido) {
    return res.status(429).json({ erro: "Muitas tentativas. Aguarde um minuto e tente de novo." });
  }

  if (!SUPABASE_ANON_KEY) {
    return res.status(500).json({ erro: "Servidor sem as chaves configuradas" });
  }

  try {
    // Dados que o app manda (não existe mais plano/ciclo pra escolher)
    const { email, nome, token } = req.body || {};

    if (!email) {
      return res.status(400).json({ erro: "Dados do usuário faltando" });
    }
    if (!token || typeof token !== "string") {
      return res.status(401).json({ erro: "Sessão inválida. Faça login novamente." });
    }

    // CRÍTICO: o userId NUNCA vem do corpo da requisição — vem só da validação
    // do token de sessão. Antes, quem chamasse esta rota podia mandar QUALQUER
    // userId no corpo e vincular um checkout (e o e-mail gravado no perfil) a
    // uma conta que não é a sua.
    const userId = await validarUsuario(token, SUPABASE_ANON_KEY);
    if (!userId) {
      return res.status(401).json({ erro: "Sessão expirada. Faça login novamente." });
    }

    const config = PLANO_UNICO;
    const plano = PLANO_ID;
    const ciclo = CICLO;
    const valor = config.valor;

    // Garante que o e-mail esteja gravado no perfil ANTES do pagamento.
    // O webhook usa o e-mail para identificar o usuário quando o Asaas
    // não devolve o externalReference — sem isso, o plano não libera.
    const SUPABASE_URL = process.env.SUPABASE_URL || "https://yuvhkrwksdnajfautkru.supabase.co";
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    if (SERVICE_KEY) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/perfil`, {
          method: "POST",
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify({
            user_id: userId,
            email: String(email).trim().toLowerCase(),
          }),
        });
      } catch (e) {
        // Não impede o checkout: o webhook ainda pode achar pelo auth
        console.error("Não consegui gravar o e-mail no perfil:", e);
      }
    }

    // Cabeçalhos padrão para chamar o Asaas
    const headers = {
      "Content-Type": "application/json",
      "access_token": chave,
      "User-Agent": "FAZ Financas",
    };

    // --- 1. Acha ou cria o cliente no Asaas ---
    // Primeiro procura um cliente já existente com esse e-mail.
    // Sem isso, cada tentativa de checkout cria um cliente novo, e a conta
    // enche de duplicados — o que atrapalha achar o pagamento depois.
    let cliente = null;

    const respBusca = await fetch(
      `${ASAAS_URL}/customers?email=${encodeURIComponent(email)}&limit=1`,
      { headers }
    );
    if (respBusca.ok) {
      const achados = await respBusca.json();
      cliente = (achados.data || [])[0] || null;
      if (cliente) {
        console.log("Cliente Asaas reaproveitado:", cliente.id);
        // Garante que a referência ao nosso usuário esteja gravada nele
        if (cliente.externalReference !== userId) {
          await fetch(`${ASAAS_URL}/customers/${cliente.id}`, {
            method: "POST",
            headers,
            body: JSON.stringify({ externalReference: userId }),
          }).catch(() => {});
        }
      }
    }

    // Não existe ainda: cria
    if (!cliente) {
      const respCliente = await fetch(`${ASAAS_URL}/customers`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: nome || email,
          email: email,
          externalReference: userId,
        }),
      });
      cliente = await respCliente.json();
      console.log("Cliente Asaas criado:", respCliente.status, cliente.id || JSON.stringify(cliente));
      if (!respCliente.ok || !cliente.id) {
        return res.status(502).json({
          erro: "Falha ao criar cliente no Asaas",
          detalhe: cliente,
        });
      }
    }

    // --- 2. Cria o checkout recorrente ---
    // A primeira cobrança vence HOJE, para o cartão ser processado na hora
    // e o plano ser liberado imediatamente após o pagamento.
    // (Se colocarmos uma data futura, o Asaas apenas agenda e a cobrança
    //  fica "aguardando pagamento", sem confirmar o acesso do cliente.)
    // Usamos a data no fuso de São Paulo: toISOString() usa UTC e, após as
    // 21h no Brasil, já teria virado para o dia seguinte.
    const hojeBR = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const nextDueDate = hojeBR;

    // Data de término da assinatura (bem no futuro, ~10 anos)
    const fim = new Date();
    fim.setFullYear(fim.getFullYear() + 10);
    const endDate = fim.toISOString().slice(0, 10);

    // Monta o corpo do checkout. A referência vai em externalReference, mas
    // o Asaas costuma não devolvê-la — por isso o vínculo real com o usuário
    // fica na nossa tabela de checkouts, gravada logo abaixo.
    const corpoBase = {
      // O Asaas só permite CREDIT_CARD em cobrança RECURRENT (assinatura que
      // renova sozinha). Pix recorrente exige o fluxo de "Pix Automático".
      billingTypes: ["CREDIT_CARD"],
      chargeTypes: ["RECURRENT"],
      minutesToExpire: 20,
      callback: {
        successUrl: `${SITE_URL}/?assinatura=sucesso`,
        cancelUrl: `${SITE_URL}/?assinatura=cancelada`,
        expiredUrl: `${SITE_URL}/?assinatura=expirada`,
      },
      items: [
        {
          name: config.nome,
          description: config.desc,
          quantity: 1,
          value: valor,
          imageBase64: LOGO_FAZ,
        },
      ],
      subscription: {
        cycle: "MONTHLY",
        nextDueDate: nextDueDate,
        endDate: endDate,
        externalReference: `${userId}|${plano}|${ciclo}`,
      },
      externalReference: `${userId}|${plano}|${ciclo}`,
    };

    // Cria o checkout. Não mandamos customerData: o Asaas passa a exigir
    // telefone quando esse campo vem, e não precisamos dele — o vínculo com
    // o usuário fica registrado na nossa tabela de checkouts.
    const respCheckout = await fetch(`${ASAAS_URL}/checkouts`, {
      method: "POST",
      headers,
      body: JSON.stringify(corpoBase),
    });
    console.log("Checkout criado:", respCheckout.status);

    const checkout = await respCheckout.json();

    // Log da resposta crua do Asaas (aparece nos Logs da Vercel) para diagnóstico
    console.log("Resposta checkout Asaas:", respCheckout.status, JSON.stringify(checkout));

    // Se o Asaas recusou (status não-2xx), devolve o motivo
    if (!respCheckout.ok) {
      // Extrai a mensagem legível do Asaas para mostrar ao usuário
      const msgAsaas =
        checkout?.errors?.[0]?.description ||
        checkout?.message ||
        "O banco recusou a criação do pagamento.";
      console.error("Checkout recusado:", respCheckout.status, JSON.stringify(checkout));
      return res.status(502).json({
        erro: msgAsaas,
        detalhe: checkout,
      });
    }

    // --- 3. Devolve o link da página de pagamento ---
    // O Asaas pode usar nomes diferentes para o link/id dependendo da versão.
    // Tentamos os campos mais comuns, na ordem.
    // O domínio do fallback acompanha o ambiente: sandbox ou produção.
    const ehSandbox = ASAAS_URL.includes("sandbox");
    const dominioCheckout = ehSandbox ? "https://sandbox.asaas.com" : "https://www.asaas.com";

    const link =
      checkout.link ||
      checkout.url ||
      checkout.invoiceUrl ||
      checkout.checkoutUrl ||
      (checkout.id ? `${dominioCheckout}/checkoutSession/show?id=${checkout.id}` : null);

    if (!link) {
      // Não achamos o link — devolve a resposta inteira para investigarmos
      return res.status(502).json({
        erro: "Checkout criado mas link não encontrado",
        detalhe: checkout,
      });
    }

    // Registra de quem é este checkout. É o que garante o vínculo mesmo se
    // a pessoa digitar outro e-mail no formulário de pagamento do Asaas.
    if (SERVICE_KEY && checkout.id) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/checkouts`, {
          method: "POST",
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            user_id: userId,
            email: String(email).trim().toLowerCase(),
            plano: plano,
            ciclo: ciclo,
            valor: valor,
            asaas_checkout_id: checkout.id,
            asaas_customer_id: cliente.id,
          }),
        });
        console.log("Checkout registrado:", checkout.id, "para", userId);
      } catch (e) {
        console.error("Não consegui registrar o checkout:", String(e));
      }
    }

    return res.status(200).json({ url: link });

  } catch (e) {
    return res.status(500).json({ erro: "Erro interno", detalhe: String(e) });
  }
}
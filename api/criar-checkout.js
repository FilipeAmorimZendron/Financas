// api/criar-checkout.js
// Serverless function (roda na Vercel, no servidor — nunca no navegador).
// Quando o usuário clica "Assinar", esta função:
//   1. cria (ou reusa) o cliente no Asaas
//   2. cria um checkout recorrente
//   3. devolve o link da página de pagamento do Asaas
// A chave do Asaas vem de process.env.ASAAS_KEY (configurada na Vercel).

// ---- Configuração dos planos (valores em reais) ----
const PLANOS = {
  premium: { mensal: 19.9, anual: 214.8, nome: "FAZ Finanças Premium" },
  master:  { mensal: 29.9, anual: 310.8, nome: "FAZ Finanças Master" },
};

// Sandbox por padrão. Em produção troque para https://api.asaas.com/v3
const ASAAS_URL = process.env.ASAAS_URL || "https://api-sandbox.asaas.com/v3";

// URL do seu site (pra onde o usuário volta depois de pagar)
const SITE_URL = process.env.SITE_URL || "https://financas-eta-two.vercel.app";

export default async function handler(req, res) {
  // Só aceita POST
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  const chave = process.env.ASAAS_KEY;
  if (!chave) {
    return res.status(500).json({ erro: "Chave do Asaas não configurada" });
  }

  try {
    // Dados que o app manda
    const { plano, ciclo, email, nome, userId } = req.body || {};

    // Validação básica
    if (!PLANOS[plano]) {
      return res.status(400).json({ erro: "Plano inválido" });
    }
    if (ciclo !== "mensal" && ciclo !== "anual") {
      return res.status(400).json({ erro: "Ciclo inválido" });
    }
    if (!email || !userId) {
      return res.status(400).json({ erro: "Dados do usuário faltando" });
    }

    const config = PLANOS[plano];
    const valor = config[ciclo];

    // Cabeçalhos padrão para chamar o Asaas
    const headers = {
      "Content-Type": "application/json",
      "access_token": chave,
      "User-Agent": "FAZ Financas",
    };

    // --- 1. Cria o cliente no Asaas ---
    const respCliente = await fetch(`${ASAAS_URL}/customers`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: nome || email,
        email: email,
        externalReference: userId, // liga o cliente Asaas ao seu usuário
      }),
    });

    const cliente = await respCliente.json();
    console.log("Resposta cliente Asaas:", respCliente.status, JSON.stringify(cliente));
    if (!respCliente.ok || !cliente.id) {
      return res.status(502).json({
        erro: "Falha ao criar cliente no Asaas",
        detalhe: cliente,
      });
    }

    // --- 2. Cria o checkout recorrente ---
    const proximoVencimento = new Date();
    proximoVencimento.setDate(proximoVencimento.getDate() + 1); // amanhã
    const nextDueDate = proximoVencimento.toISOString().slice(0, 10);

    const respCheckout = await fetch(`${ASAAS_URL}/checkouts`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        billingTypes: ["CREDIT_CARD"],
        chargeTypes: ["RECURRENT"],
        minutesToExpire: 60,
        callback: {
          successUrl: `${SITE_URL}/?assinatura=sucesso`,
          cancelUrl: `${SITE_URL}/?assinatura=cancelada`,
          expiredUrl: `${SITE_URL}/?assinatura=expirada`,
        },
        items: [
          {
            name: config.nome,
            description: `Assinatura ${plano} (${ciclo})`,
            quantity: 1,
            value: valor,
          },
        ],
        customerData: {
          name: nome || email,
          email: email,
        },
        subscription: {
          cycle: ciclo === "anual" ? "YEARLY" : "MONTHLY",
          nextDueDate: nextDueDate,
        },
        externalReference: `${userId}|${plano}|${ciclo}`,
      }),
    });

    const checkout = await respCheckout.json();

    // Log da resposta crua do Asaas (aparece nos Logs da Vercel) para diagnóstico
    console.log("Resposta checkout Asaas:", respCheckout.status, JSON.stringify(checkout));

    // Se o Asaas recusou (status não-2xx), devolve o motivo
    if (!respCheckout.ok) {
      return res.status(502).json({
        erro: "Falha ao criar checkout no Asaas",
        detalhe: checkout,
      });
    }

    // --- 3. Devolve o link da página de pagamento ---
    // O Asaas pode usar nomes diferentes para o link/id dependendo da versão.
    // Tentamos os campos mais comuns, na ordem.
    const link =
      checkout.link ||
      checkout.url ||
      checkout.invoiceUrl ||
      checkout.checkoutUrl ||
      (checkout.id ? `https://sandbox.asaas.com/checkoutSession/show?id=${checkout.id}` : null);

    if (!link) {
      // Não achamos o link — devolve a resposta inteira para investigarmos
      return res.status(502).json({
        erro: "Checkout criado mas link não encontrado",
        detalhe: checkout,
      });
    }

    return res.status(200).json({ url: link });

  } catch (e) {
    return res.status(500).json({ erro: "Erro interno", detalhe: String(e) });
  }
}
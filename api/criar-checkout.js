// api/criar-checkout.js
// Serverless function (roda na Vercel, no servidor — nunca no navegador).
// Quando o usuário clica "Assinar", esta função:
//   1. cria (ou reusa) o cliente no Asaas
//   2. cria um checkout recorrente
//   3. devolve o link da página de pagamento do Asaas
// A chave do Asaas vem de process.env.ASAAS_KEY (configurada na Vercel).

// ---- Configuração dos planos (valores em reais) ----
const PLANOS = {
  premium: { mensal: 25.9, anual: 264.0, nome: "FAZ Finanças Premium" },
  master:  { mensal: 47.9, anual: 488.4, nome: "FAZ Finanças Master" },
};

// Sandbox por padrão. Em produção troque para https://api.asaas.com/v3
const ASAAS_URL = process.env.ASAAS_URL || "https://api-sandbox.asaas.com/v3";

// URL do seu site (pra onde o usuário volta depois de pagar)
const SITE_URL = process.env.SITE_URL || "https://fazfinancas.com";

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

    const respCheckout = await fetch(`${ASAAS_URL}/checkouts`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        billingTypes: ["CREDIT_CARD"],
        chargeTypes: ["RECURRENT"],
        minutesToExpire: 60,
        // Amarra o checkout ao cliente que acabamos de criar.
        // Sem isto o Asaas cria OUTRO cliente com o que a pessoa digitar,
        // e o nosso fica órfão — foi o que impediu de achar o pagamento.
        customer: cliente.id,
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
        subscription: {
          cycle: ciclo === "anual" ? "YEARLY" : "MONTHLY",
          nextDueDate: nextDueDate,
          endDate: endDate,
          // Repete a referência aqui: sem isso a assinatura (e as cobranças que
          // ela gera todo mês) não sabem a qual usuário pertencem, e o webhook
          // não consegue liberar o plano.
          externalReference: `${userId}|${plano}|${ciclo}`,
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

    return res.status(200).json({ url: link });

  } catch (e) {
    return res.status(500).json({ erro: "Erro interno", detalhe: String(e) });
  }
}
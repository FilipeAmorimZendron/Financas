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

    // Monta o corpo do checkout. O customerData faz o Asaas reaproveitar o
    // cliente existente com esse e-mail, em vez de criar um novo — é o que
    // liga o pagamento ao nosso userId.
    const corpoBase = {
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
      subscription: {
        cycle: ciclo === "anual" ? "YEARLY" : "MONTHLY",
        nextDueDate: nextDueDate,
        endDate: endDate,
        externalReference: `${userId}|${plano}|${ciclo}`,
      },
      externalReference: `${userId}|${plano}|${ciclo}`,
    };

    // 1ª tentativa: com os dados do cliente
    let respCheckout = await fetch(`${ASAAS_URL}/checkouts`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...corpoBase,
        customerData: { name: nome || email, email: email },
      }),
    });

    // Se o Asaas recusar por causa do customerData, tenta sem ele.
    // Melhor um checkout que abre do que um erro na cara do cliente.
    if (!respCheckout.ok) {
      const erro1 = await respCheckout.clone().json().catch(() => ({}));
      console.log("Checkout com customerData falhou:", respCheckout.status, JSON.stringify(erro1));
      respCheckout = await fetch(`${ASAAS_URL}/checkouts`, {
        method: "POST",
        headers,
        body: JSON.stringify(corpoBase),
      });
      console.log("Retentativa sem customerData:", respCheckout.status);
    }

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
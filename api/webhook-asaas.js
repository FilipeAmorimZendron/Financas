// api/webhook-asaas.js
// Serverless function (roda na Vercel, no servidor).
// O Asaas chama esta URL toda vez que acontece um evento de pagamento.
// Quando o pagamento é confirmado, liberamos o plano do usuário no Supabase.
//
// Fluxo:
//   1. Asaas envia um POST com o evento (ex.: PAYMENT_RECEIVED / PAYMENT_CONFIRMED)
//   2. Lemos o externalReference (userId|plano|ciclo) que guardamos no checkout
//   3. Atualizamos perfil: plano + assinatura_status = 'ativa'
//   4. Respondemos 200 rápido (o Asaas exige resposta 2xx)

const SUPABASE_URL = process.env.SUPABASE_URL || "https://yuvhkrwksdnajfautkru.supabase.co";
// Chave de serviço (server-side, ignora RLS). Configurada na Vercel, NUNCA no navegador.
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// (Opcional) Token de segurança do webhook. Se você configurar um token no Asaas,
// coloque o mesmo valor aqui na Vercel como ASAAS_WEBHOOK_TOKEN para validar a origem.
const WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN || null;

// Acesso à API do Asaas: usamos para descobrir o usuário quando o evento de
// pagamento não traz o externalReference (ele fica na assinatura, não na cobrança).
const ASAAS_URL = process.env.ASAAS_URL || "https://api-sandbox.asaas.com/v3";
const ASAAS_KEY = process.env.ASAAS_KEY;

/* Busca a referência (userId|plano|ciclo) na assinatura que gerou a cobrança */
async function refDaAssinatura(subscriptionId) {
  if (!subscriptionId || !ASAAS_KEY) return "";
  try {
    const resp = await fetch(`${ASAAS_URL}/subscriptions/${subscriptionId}`, {
      headers: { access_token: ASAAS_KEY }
    });
    if (!resp.ok) {
      console.error("Falha ao buscar assinatura no Asaas:", resp.status);
      return "";
    }
    const assinatura = await resp.json();
    return assinatura.externalReference || "";
  } catch (e) {
    console.error("Erro ao consultar assinatura:", e);
    return "";
  }
}

/* Último recurso: o cliente do Asaas guarda o userId na referência externa.
   O cliente é criado por nós em criar-checkout.js com externalReference = userId. */
async function userIdDoCliente(customerId) {
  if (!customerId || !ASAAS_KEY) return "";
  try {
    const resp = await fetch(`${ASAAS_URL}/customers/${customerId}`, {
      headers: { access_token: ASAAS_KEY }
    });
    if (!resp.ok) {
      console.error("Falha ao buscar cliente no Asaas:", resp.status);
      return "";
    }
    const cliente = await resp.json();
    return cliente.externalReference || "";
  } catch (e) {
    console.error("Erro ao consultar cliente:", e);
    return "";
  }
}

/* Busca o e-mail do cliente no Asaas.
   É o dado mais confiável: sempre existe (o Asaas exige) e o usuário
   digitou o mesmo e-mail que usa para entrar no app. */
async function emailDoCliente(customerId) {
  if (!customerId || !ASAAS_KEY) return "";
  try {
    const resp = await fetch(`${ASAAS_URL}/customers/${customerId}`, {
      headers: { access_token: ASAAS_KEY }
    });
    if (!resp.ok) return "";
    const cliente = await resp.json();
    return (cliente.email || "").trim().toLowerCase();
  } catch (e) {
    console.error("Erro ao buscar e-mail do cliente:", e);
    return "";
  }
}

/* O caminho mais confiável: nós mesmos registramos, no momento de criar o
   checkout, de quem ele é. Não depende do Asaas devolver nada nem do e-mail
   que a pessoa digitou no formulário de pagamento. */
async function donoDoCheckout(checkoutId, customerId) {
  if (!SUPABASE_SERVICE_KEY) return null;
  const cabecalhos = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`
  };

  // Tenta pelo id do checkout, depois pelo id do cliente
  const tentativas = [];
  if (checkoutId) tentativas.push(`asaas_checkout_id=eq.${encodeURIComponent(checkoutId)}`);
  if (customerId) tentativas.push(`asaas_customer_id=eq.${encodeURIComponent(customerId)}`);

  for (const filtro of tentativas) {
    try {
      const url = `${SUPABASE_URL}/rest/v1/checkouts?${filtro}&select=user_id,plano,ciclo&order=criado_em.desc&limit=1`;
      const resp = await fetch(url, { headers: cabecalhos });
      if (!resp.ok) continue;
      const linhas = await resp.json();
      if (Array.isArray(linhas) && linhas[0]?.user_id) {
        console.log("CHECKOUT REGISTRADO: achou o dono ->", linhas[0].user_id, linhas[0].plano);
        return linhas[0];
      }
    } catch (e) {
      console.error("Erro ao consultar checkouts:", String(e));
    }
  }
  return null;
}

/* A sessão de checkout também guarda a referência que enviamos.
   Os logs mostram que o pagamento traz o campo checkoutSession — é mais
   uma chance de recuperar o userId original em vez de deduzir pelo valor. */
async function refDoCheckout(checkoutSessionId) {
  if (!checkoutSessionId || !ASAAS_KEY) return "";
  try {
    const resp = await fetch(`${ASAAS_URL}/checkouts/${checkoutSessionId}`, {
      headers: { access_token: ASAAS_KEY }
    });
    console.log("CHECKOUT busca:", resp.status);
    if (!resp.ok) return "";
    const sessao = await resp.json();
    const ref = sessao.externalReference || sessao.subscription?.externalReference || "";
    console.log("CHECKOUT externalReference:", ref || "(vazio)");
    return ref;
  } catch (e) {
    console.error("Erro ao consultar checkout:", String(e));
    return "";
  }
}

/* Acha o usuário no Supabase pelo e-mail.
   A tabela perfil guarda o e-mail; se não achar lá, procura no auth. */
async function userIdPeloEmail(email) {
  if (!email) { console.error("EMAIL: vazio, nada a buscar"); return ""; }
  if (!SUPABASE_SERVICE_KEY) { console.error("EMAIL: falta SUPABASE_SERVICE_KEY"); return ""; }

  const cabecalhos = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`
  };

  // 1. Tenta na tabela perfil (mais direto)
  try {
    const url = `${SUPABASE_URL}/rest/v1/perfil?email=eq.${encodeURIComponent(email)}&select=user_id`;
    const resp = await fetch(url, { headers: cabecalhos });
    const texto = await resp.text();
    console.log("EMAIL busca perfil:", resp.status, texto.slice(0, 300));

    if (resp.ok) {
      const linhas = JSON.parse(texto);
      if (Array.isArray(linhas) && linhas[0]?.user_id) {
        console.log("EMAIL: achou na tabela perfil ->", linhas[0].user_id);
        return linhas[0].user_id;
      }
      console.log("EMAIL: tabela perfil não tem esse e-mail");
    }
  } catch (e) {
    console.error("EMAIL: erro ao consultar perfil:", String(e));
  }

  // 2. Não achou: procura na base de autenticação do Supabase
  try {
    const urlAuth = `${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`;
    const respAuth = await fetch(urlAuth, { headers: cabecalhos });
    console.log("EMAIL busca auth:", respAuth.status);

    if (respAuth.ok) {
      const dados = await respAuth.json();
      const lista = dados.users || dados;
      if (Array.isArray(lista)) {
        console.log("EMAIL: auth devolveu", lista.length, "usuários");
        const achado = lista.find(u => (u.email || "").toLowerCase() === email);
        if (achado?.id) {
          console.log("EMAIL: achou no auth ->", achado.id);
          return achado.id;
        }
        console.error("EMAIL: nenhum usuário do auth tem o e-mail", email);
      }
    } else {
      const err = await respAuth.text();
      console.error("EMAIL: auth recusou:", respAuth.status, err.slice(0, 200));
    }
  } catch (e) {
    console.error("EMAIL: erro ao consultar auth:", String(e));
  }

  return "";
}

/* Descobre o plano a partir do valor pago, quando não sabemos pela referência.
   Precisa bater com os preços de criar-checkout.js. */
function planoPeloValor(valor) {
  const v = Number(valor) || 0;
  if (v >= 400) return "master";   // anual master (488,40)
  if (v >= 200) return "premium";  // anual premium (264,00)
  if (v >= 40)  return "master";   // mensal master (47,90)
  return "premium";                // mensal premium (25,90)
}

// Eventos que significam "pagou / assinatura ativa"
const EVENTOS_ATIVA = [
  "PAYMENT_RECEIVED",
  "PAYMENT_CONFIRMED",
];

// Atraso: NÃO corta na hora. O Asaas ainda vai tentar cobrar de novo,
// e cartão pode falhar por saldo momentâneo. Marca como atrasada e dá
// um prazo de tolerância antes de rebaixar.
const EVENTOS_ATRASO = [
  "PAYMENT_OVERDUE",
];

// Corte imediato: aqui não há o que esperar — o dinheiro voltou,
// foi contestado, ou a assinatura acabou.
const EVENTOS_CORTE = [
  "PAYMENT_REFUNDED",
  "PAYMENT_CHARGEBACK_REQUESTED",
  "PAYMENT_CHARGEBACK_DISPUTE",
  "PAYMENT_DELETED",
  "SUBSCRIPTION_DELETED",
  "SUBSCRIPTION_INACTIVATED",
];

// Dias de tolerância após o vencimento antes de cortar o acesso.
// O Asaas tenta recobrar o cartão algumas vezes nesse período.
const DIAS_TOLERANCIA = Number(process.env.DIAS_TOLERANCIA || 5);

export default async function handler(req, res) {
  // Log de entrada: confirma que o Asaas chamou o webhook
  console.log("Webhook chamado:", req.method, "| evento:", req.body?.event || "?");

  // Diagnóstico de configuração: mostra o que está faltando, sem expor as chaves
  console.log("CONFIG:", JSON.stringify({
    temServiceKey: !!SUPABASE_SERVICE_KEY,
    temAsaasKey: !!ASAAS_KEY,
    asaasUrl: ASAAS_URL,
    supabaseUrl: SUPABASE_URL,
    exigeToken: !!WEBHOOK_TOKEN
  }));

  // Só aceita POST
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  // Validação de token (se você configurou no Asaas)
  if (WEBHOOK_TOKEN) {
    // O Asaas pode enviar o token em cabeçalhos com nomes ligeiramente diferentes.
    const tokenRecebido =
      req.headers["asaas-access-token"] ||
      req.headers["asaas-access-token".toLowerCase()] ||
      req.headers["access-token"] ||
      req.headers["asaas_access_token"] ||
      null;

    const bateu = tokenRecebido && tokenRecebido.trim() === WEBHOOK_TOKEN.trim();

    // Log de diagnóstico (aparece nos Logs da Vercel)
    console.log(
      "Webhook token check:",
      "recebido?", tokenRecebido ? "sim" : "não",
      "| bateu?", bateu ? "sim" : "não"
    );

    if (!bateu) {
      // Loga o evento mesmo assim, mas recusa por segurança
      console.error("Webhook recusado: token não confere");
      return res.status(401).json({ erro: "Token inválido" });
    }
  }

  if (!SUPABASE_SERVICE_KEY) {
    // Sem a chave não conseguimos escrever. Responde 200 mesmo assim
    // para o Asaas não ficar reenviando, mas registra o problema.
    console.error("SUPABASE_SERVICE_KEY não configurada");
    return res.status(200).json({ ok: false, motivo: "sem chave supabase" });
  }

  try {
    const body = req.body || {};
    const evento = body.event;
    const pagamento = body.payment || {};

    // O externalReference vem no formato userId|plano|ciclo
    let ref = pagamento.externalReference || "";

    // Diagnóstico: mostra os campos que usamos para identificar o usuário
    console.log("DIAGNOSTICO webhook:", JSON.stringify({
      evento: evento,
      externalReference: pagamento.externalReference || "(vazio)",
      subscription: pagamento.subscription || "(sem)",
      checkoutSession: pagamento.checkoutSession || "(sem)",
      customer: pagamento.customer || "(sem)",
      valor: pagamento.value,
      paymentId: pagamento.id || "(sem)"
    }));

    // Se a cobrança não trouxe a referência, ela está na assinatura que a gerou.
    if (!ref && pagamento.subscription) {
      ref = await refDaAssinatura(pagamento.subscription);
      console.log("Referência buscada na assinatura:", ref || "(não encontrada)");
    }

    // Ainda sem referência: tenta na sessão de checkout que originou tudo.
    if (!ref && pagamento.checkoutSession) {
      ref = await refDoCheckout(pagamento.checkoutSession);
      console.log("Referência buscada no checkout:", ref || "(não encontrada)");
    }

    let [userId, plano, ciclo] = ref.split("|");

    // Caminho preferencial: a tabela que nós mesmos gravamos ao criar o
    // checkout. Não depende do Asaas nem do e-mail digitado pela pessoa.
    if (!userId) {
      const dono = await donoDoCheckout(pagamento.checkoutSession, pagamento.customer);
      if (dono) {
        userId = dono.user_id;
        plano = dono.plano;
        ciclo = dono.ciclo;
      }
    }

    // Último recurso: o cliente do Asaas guarda o userId.
    // Nesse caminho não sabemos o plano pela referência, então deduzimos pelo valor pago.
    if (!userId && pagamento.customer) {
      userId = await userIdDoCliente(pagamento.customer);
      if (userId) {
        plano = planoPeloValor(pagamento.value);
        console.log("Usuário identificado pelo cliente Asaas:", userId, "| plano pelo valor:", plano);
      }
    }

    // Plano D: identificar pelo e-mail.
    // O Asaas às vezes não devolve o externalReference em lugar nenhum,
    // mas o e-mail do cliente sempre existe — e é único no Supabase.
    if (!userId && pagamento.customer) {
      const email = await emailDoCliente(pagamento.customer);
      console.log("PLANO D: e-mail do cliente no Asaas =", email || "(vazio)");
      if (email) {
        userId = await userIdPeloEmail(email);
        if (userId) {
          plano = plano || planoPeloValor(pagamento.value);
          console.log("PLANO D OK: usuário", userId, "| plano", plano);
        } else {
          console.error("PLANO D FALHOU: e-mail", email, "não corresponde a nenhum usuário do app");
        }
      }
    }

    // Se não conseguimos identificar o usuário, não há o que fazer.
    if (!userId) {
      console.error(
        "FALHA TOTAL: nenhum dos 5 caminhos identificou o usuário.",
        "customer:", pagamento.customer || "(sem)",
        "| subscription:", pagamento.subscription || "(sem)",
        "| checkoutSession:", pagamento.checkoutSession || "(sem)",
        "| valor:", pagamento.value,
        "— libere manualmente no Supabase ou chame /api/confirmar-assinatura"
      );
      return res.status(200).json({ ok: true, motivo: "usuário não identificado" });
    }

    let novoStatus = null;
    let novoPlano = null;
    const extras = {};

    if (EVENTOS_ATIVA.includes(evento)) {
      // Pagou: libera (ou renova) o acesso e limpa qualquer marca de atraso
      novoStatus = "ativa";
      novoPlano = plano || "premium";
      extras.atraso_desde = null;
      // Guarda quando vence a próxima, para o app avisar com antecedência
      if (pagamento.dueDate) {
        const venc = new Date(pagamento.dueDate + "T00:00:00");
        venc.setMonth(venc.getMonth() + (ciclo === "anual" ? 12 : 1));
        extras.proxima_cobranca = venc.toISOString().slice(0, 10);
      }

    } else if (EVENTOS_ATRASO.includes(evento)) {
      // Atrasou: NÃO corta agora. Marca a data e mantém o acesso durante
      // a tolerância — o Asaas ainda vai tentar cobrar de novo.
      const hoje = new Date().toISOString().slice(0, 10);
      novoStatus = "atrasada";
      novoPlano = plano || null;   // mantém o plano atual
      extras.atraso_desde = hoje;
      console.log(`ATRASO registrado para ${userId}. Acesso mantido por ${DIAS_TOLERANCIA} dias.`);

    } else if (EVENTOS_CORTE.includes(evento)) {
      // Corta na hora. Guarda o motivo e qual plano foi perdido, para o app
      // conseguir explicar ao cliente o que aconteceu.
      novoPlano = "basico";
      extras.atraso_desde = null;
      if (plano && plano !== "basico") extras.plano_anterior = plano;

      // Falta de pagamento tem status próprio: a mensagem ao cliente é outra
      // (ele pode reassinar) comparada a um estorno ou contestação.
      const porFaltaDePagamento =
        evento === "SUBSCRIPTION_DELETED" ||
        evento === "SUBSCRIPTION_INACTIVATED" ||
        evento === "PAYMENT_DELETED";
      novoStatus = porFaltaDePagamento ? "cancelada_falta_pagamento" : "inativa";

      console.log(`CORTE imediato para ${userId} — evento ${evento} — status ${novoStatus}`);

    } else {
      // Evento que não muda o status (ex.: PAYMENT_CREATED). Só confirma o recebimento.
      return res.status(200).json({ ok: true, evento: evento, acao: "ignorado" });
    }

    // Monta o que vamos atualizar
    const atualizacao = {
      assinatura_status: novoStatus,
      ...extras,
    };
    // No atraso, o plano não muda — só mexemos nele quando ativa ou corta
    if (novoPlano !== null) {
      atualizacao.plano = novoPlano;
    }
    // Guarda o id da assinatura do Asaas, se veio
    if (pagamento.subscription) {
      atualizacao.asaas_subscription_id = pagamento.subscription;
    }

    // Atualiza o perfil no Supabase via REST, usando a service key
    const url = `${SUPABASE_URL}/rest/v1/perfil?user_id=eq.${encodeURIComponent(userId)}`;
    const resp = await fetch(url, {
      method: "PATCH",
      headers: {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify(atualizacao),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.error("Falha ao atualizar Supabase:", resp.status, txt);
      // Responde 200 pra não gerar reenvio infinito, mas loga o erro
      return res.status(200).json({ ok: false, motivo: "falha supabase", status: resp.status });
    }

    return res.status(200).json({ ok: true, userId: userId, status: novoStatus, plano: novoPlano });

  } catch (e) {
    console.error("Erro no webhook:", e);
    // Sempre 200 pra evitar reenvios em loop; o erro fica no log da Vercel.
    return res.status(200).json({ ok: false, motivo: "erro interno" });
  }
}
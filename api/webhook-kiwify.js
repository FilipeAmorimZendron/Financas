// api/webhook-kiwify.js
// Serverless function (roda na Vercel, no servidor).
// A Kiwify chama esta URL toda vez que acontece um evento de venda/assinatura.
// Quando o pagamento é confirmado, liberamos o plano do usuário no Supabase.
//
// Diferente do Asaas, aqui NÃO existe API pra criar checkout dinâmico — os
// 4 produtos (Pessoal Mensal, Empresarial Mensal, Pessoal Vitalício,
// Empresarial Vitalício) são cadastrados manualmente no painel da Kiwify.
// O link de cada um mora em api/criar-checkout.js. Qual plano liberar é
// decidido pelo NOME do produto que vem no webhook, procurando só
// palavra-chave (ver classificarProduto) — não precisa bater exato com o
// nome cadastrado lá, então renomear o produto no painel não quebra nada.
//
// Fluxo:
//   1. Kiwify envia um POST com o evento (webhook_event_type) e os dados da venda
//   2. Validamos a assinatura (signature na querystring, HMAC-SHA1 do corpo cru)
//   3. Identificamos o usuário pelo e-mail do comprador (Customer.email)
//   4. Identificamos o plano pelo nome do produto (Product.product_name)
//   5. Atualizamos perfil: plano + assinatura_status (+ vitalicio/empresarial)
//   6. Respondemos 200 rápido (a Kiwify reenvia até 5x se não receber 2xx)
//
// IMPORTANTE: precisa de bodyParser desligado pra calcular a assinatura em
// cima do corpo EXATO que a Kiwify mandou (re-serializar com JSON.stringify
// depois de já ter sido parseado pode gerar um texto levemente diferente e
// derrubar a validação por engano).
export const config = { api: { bodyParser: false } };

import crypto from "crypto";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://yuvhkrwksdnajfautkru.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Token do webhook, mostrado no painel da Kiwify na hora de criar/editar o
// webhook (Configurações → Webhooks). Configurar em Vercel → Settings →
// Environment Variables como KIWIFY_WEBHOOK_TOKEN — nunca direto no código.
const WEBHOOK_TOKEN = process.env.KIWIFY_WEBHOOK_TOKEN || null;

// Faixa Unicode das marcas de acentuação combinadas (usada depois de
// normalize("NFD"), que separa por ex. "í" em "i" + acento combinando).
const REGEX_DIACRITICOS = new RegExp("[\u0300-\u036f]", "g");

/* Tira acento e baixa a caixa. */
function normalizar(txt) {
  return String(txt || "")
    .normalize("NFD")
    .replace(REGEX_DIACRITICOS, "")
    .trim()
    .toLowerCase();
}

/* Decide o plano pelo NOME DO PRODUTO só procurando palavras-chave dentro
   dele — não por igualdade exata. Comparação exata quebrou de verdade em
   produção: o produto real na Kiwify se chama "Plano Pessoal Vitalício"
   (com "Plano " na frente), e como não batia caractere a caractere com
   "pessoal vitalicio", uma compra PAGA de verdade não liberou o acesso do
   cliente (2026-09-15). Com palavra-chave, funciona não importa como o
   produto foi nomeado/renomeado no painel — só precisa conter
   "empresarial" (senão assume Pessoal) e "vitalici" (senão assume Mensal,
   cobre "vitalício"/"vitalicio" com ou sem acento já que roda depois do
   normalizar()). */
function classificarProduto(nomeProduto) {
  const nome = normalizar(nomeProduto);
  if (!nome) return null;
  const tipoConta = nome.includes("empresarial") ? "empresarial" : "pessoal";
  const tipoPagamento = nome.includes("vitalici") ? "vitalicio" : "mensal";
  return { tipoConta, tipoPagamento };
}

/* Lê o corpo bruto da requisição (sem o bodyParser do Vercel) — precisamos
   do texto EXATO pra validar a assinatura HMAC. */
async function lerCorpoBruto(req) {
  const pedacos = [];
  for await (const pedaco of req) pedacos.push(pedaco);
  return Buffer.concat(pedacos).toString("utf8");
}

/* Acha o usuário no Supabase pelo e-mail do comprador (é o único jeito
   confiável que a Kiwify nos dá — não existe um "externalReference" nosso
   passando pelo checkout, já que o link é fixo/configurado no painel).
   Mesmo padrão de 2 passos usado no webhook do Asaas: primeiro tenta na
   tabela perfil (mais direto), depois no auth do Supabase. */
async function userIdPeloEmail(email) {
  if (!email || !SUPABASE_SERVICE_KEY) return "";
  const cabecalhos = {
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  };

  try {
    const url = `${SUPABASE_URL}/rest/v1/perfil?email=eq.${encodeURIComponent(email)}&select=user_id`;
    const resp = await fetch(url, { headers: cabecalhos });
    if (resp.ok) {
      const linhas = await resp.json();
      if (Array.isArray(linhas) && linhas[0]?.user_id) return linhas[0].user_id;
    }
  } catch (e) {
    console.error("Erro ao consultar perfil por e-mail:", e);
  }

  try {
    const urlAuth = `${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`;
    const respAuth = await fetch(urlAuth, { headers: cabecalhos });
    if (respAuth.ok) {
      const dados = await respAuth.json();
      const lista = dados.users || dados;
      if (Array.isArray(lista)) {
        const achado = lista.find(u => (u.email || "").toLowerCase() === email);
        if (achado?.id) return achado.id;
      }
    }
  } catch (e) {
    console.error("Erro ao consultar auth por e-mail:", e);
  }

  return "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  if (!SUPABASE_SERVICE_KEY) {
    console.error("SUPABASE_SERVICE_KEY não configurada");
    return res.status(200).json({ ok: false, motivo: "sem chave supabase" });
  }

  // Validação de assinatura SEMPRE obrigatória (fail-closed) — mesma
  // postura do webhook do Asaas: sem o token configurado, recusa tudo em
  // vez de aceitar sem checar.
  if (!WEBHOOK_TOKEN) {
    console.error(
      "Webhook recusado: KIWIFY_WEBHOOK_TOKEN não configurado na Vercel. " +
      "Pegue o token no painel da Kiwify (Configurações → Webhooks) e " +
      "configure a env var na Vercel pra reativar a confirmação automática."
    );
    return res.status(401).json({ erro: "Webhook não configurado com token de segurança." });
  }

  let corpoBruto;
  try {
    corpoBruto = await lerCorpoBruto(req);
  } catch (e) {
    console.error("Falha ao ler corpo da requisição:", e);
    return res.status(400).json({ erro: "Corpo inválido" });
  }

  const assinaturaRecebida = req.query?.signature || "";
  const assinaturaEsperada = crypto
    .createHmac("sha1", WEBHOOK_TOKEN)
    .update(corpoBruto)
    .digest("hex");

  const bateu =
    assinaturaRecebida.length === assinaturaEsperada.length &&
    crypto.timingSafeEqual(Buffer.from(assinaturaRecebida), Buffer.from(assinaturaEsperada));

  if (!bateu) {
    console.error("Webhook recusado: assinatura não confere");
    return res.status(401).json({ erro: "Assinatura inválida" });
  }

  let body;
  try {
    body = JSON.parse(corpoBruto);
  } catch (e) {
    return res.status(400).json({ erro: "JSON inválido" });
  }

  try {
    const evento = body.webhook_event_type;
    const orderStatus = body.order_status;
    const email = String(body.Customer?.email || "").trim().toLowerCase();
    const nomeProduto = body.Product?.product_name;

    console.log("Webhook Kiwify:", JSON.stringify({
      evento, orderStatus, email: email || "(vazio)", nomeProduto: nomeProduto || "(vazio)",
      orderId: body.order_id, subscriptionId: body.Subscription?.subscription_id,
    }));

    // classificarProduto() só devolve null se o nome do produto vier vazio
    // (não deveria acontecer nunca — a Kiwify sempre manda isso).
    const classificacao = classificarProduto(nomeProduto);
    if (!classificacao) {
      console.error("Webhook sem nome de produto — não dá pra saber qual plano liberar:", JSON.stringify(body.Product));
      return res.status(200).json({ ok: true, motivo: "sem nome de produto" });
    }
    const { tipoConta, tipoPagamento } = classificacao;

    if (!email) {
      console.error("Webhook sem e-mail do comprador — não dá pra identificar o usuário");
      return res.status(200).json({ ok: true, motivo: "sem e-mail" });
    }
    const userId = await userIdPeloEmail(email);
    if (!userId) {
      console.error(
        "FALHA: nenhum usuário no Supabase com o e-mail", email,
        "— confira se a pessoa já tinha criado conta no FAZ antes de comprar"
      );
      return res.status(200).json({ ok: true, motivo: "usuário não identificado" });
    }

    let atualizacao = null;

    // Compra aprovada — vale tanto pro Vitalício (pagamento único) quanto
    // pra primeira cobrança de uma assinatura mensal.
    if (evento === "order_approved" && orderStatus === "paid") {
      if (tipoPagamento === "vitalicio") {
        atualizacao = {
          plano: "premium",
          assinatura_status: "ativa",
          vitalicio: true,
          empresarial: tipoConta === "empresarial",
          atraso_desde: null,
        };
        console.log(`VITALÍCIO liberado (Kiwify) para ${userId} (${tipoConta})`);
      } else {
        atualizacao = {
          plano: "premium",
          assinatura_status: "ativa",
          empresarial: tipoConta === "empresarial",
          atraso_desde: null,
        };
        if (body.Subscription?.next_payment) {
          atualizacao.proxima_cobranca = String(body.Subscription.next_payment).slice(0, 10);
        }
        if (body.Subscription?.subscription_id) {
          atualizacao.kiwify_subscription_id = body.Subscription.subscription_id;
        }
        console.log(`MENSAL liberado (Kiwify) para ${userId} (${tipoConta})`);
      }

    // Renovação de assinatura (cobrança do mês seguinte confirmada)
    } else if (evento === "subscription_renewed") {
      atualizacao = {
        plano: "premium",
        assinatura_status: "ativa",
        empresarial: tipoConta === "empresarial",
        atraso_desde: null,
      };
      if (body.Subscription?.next_payment) {
        atualizacao.proxima_cobranca = String(body.Subscription.next_payment).slice(0, 10);
      }
      console.log(`RENOVAÇÃO (Kiwify) para ${userId}`);

    // Assinatura atrasada — mantém acesso durante a tolerância (mesma regra
    // de DIAS_TOLERANCIA_PLANO já usada em app.js, independente do processor)
    } else if (evento === "subscription_late") {
      atualizacao = {
        assinatura_status: "atrasada",
        atraso_desde: new Date().toISOString().slice(0, 10),
      };
      console.log(`ATRASO (Kiwify) para ${userId}`);

    // Cancelamento — mantém acesso até a data que já estava paga (a Kiwify
    // manda o fim do período em Subscription.customer_access.access_until)
    } else if (evento === "subscription_canceled") {
      atualizacao = { assinatura_status: "cancelada_fim_ciclo" };
      const ate = body.Subscription?.customer_access?.access_until;
      if (ate) atualizacao.proxima_cobranca = String(ate).slice(0, 10);
      console.log(`CANCELAMENTO (Kiwify) para ${userId}`);

    // Estorno ou chargeback — corte imediato (dinheiro voltou)
    } else if (evento === "order_refunded" || evento === "chargeback") {
      atualizacao = {
        plano: "basico",
        assinatura_status: "inativa",
        vitalicio: false,
        empresarial: false,
        atraso_desde: null,
      };
      console.log(`CORTE imediato (Kiwify, ${evento}) para ${userId}`);

    } else {
      // order_rejected, pix_created, billet_created, carrinho_abandonado etc:
      // não muda nada, só confirma o recebimento.
      return res.status(200).json({ ok: true, evento, acao: "ignorado" });
    }

    const resp = await fetch(`${SUPABASE_URL}/rest/v1/perfil?user_id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(atualizacao),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.error("Falha ao atualizar Supabase:", resp.status, txt);
      return res.status(200).json({ ok: false, motivo: "falha supabase", status: resp.status });
    }

    if (evento === "order_approved") {
      await enviarPurchaseFacebook({
        valor: Number(body.Commissions?.charge_amount || 0) / 100,
        email,
        plano: tipoConta === "empresarial" ? "empresarial" : "premium",
        idEvento: body.order_id || `${userId}-${Date.now()}`,
      });
    }

    return res.status(200).json({ ok: true, userId, evento });

  } catch (e) {
    console.error("Erro no webhook Kiwify:", e);
    return res.status(200).json({ ok: false, motivo: "erro interno" });
  }
}

/* Envia o evento de compra (Purchase) pro Facebook via Conversions API.
   Mesma função usada no webhook do Asaas. */
async function enviarPurchaseFacebook({ valor, email, plano, idEvento }) {
  const PIXEL_ID = process.env.FB_PIXEL_ID;
  const TOKEN = process.env.FB_CAPI_TOKEN;
  if (!PIXEL_ID || !TOKEN) return;

  try {
    const emailHash = email
      ? crypto.createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex")
      : undefined;

    const corpo = {
      data: [{
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        event_id: String(idEvento),
        action_source: "website",
        user_data: emailHash ? { em: [emailHash] } : {},
        custom_data: { value: valor, currency: "BRL", content_name: plano || "assinatura" },
      }],
    };

    const url = `https://graph.facebook.com/v19.0/${PIXEL_ID}/events?access_token=${encodeURIComponent(TOKEN)}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error("Falha ao enviar Purchase ao Facebook:", r.status, t);
    } else {
      console.log(`Purchase enviado ao Facebook: ${plano} R$ ${valor}`);
    }
  } catch (e) {
    console.error("Erro ao enviar Purchase ao Facebook:", e);
  }
}

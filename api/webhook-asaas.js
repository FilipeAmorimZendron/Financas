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

// Eventos que significam "pagou / assinatura ativa"
const EVENTOS_ATIVA = [
  "PAYMENT_RECEIVED",
  "PAYMENT_CONFIRMED",
];

// Eventos que significam "assinatura caiu / precisa bloquear"
const EVENTOS_INATIVA = [
  "PAYMENT_OVERDUE",
  "PAYMENT_DELETED",
  "PAYMENT_REFUNDED",
  "PAYMENT_CHARGEBACK_REQUESTED",
  "SUBSCRIPTION_DELETED",
];

export default async function handler(req, res) {
  // Log de entrada: confirma que o Asaas chamou o webhook
  console.log("Webhook chamado:", req.method, "| evento:", req.body?.event || "?");

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
    const ref = pagamento.externalReference || "";
    const [userId, plano, ciclo] = ref.split("|");

    // Se não conseguimos identificar o usuário, não há o que fazer.
    if (!userId) {
      return res.status(200).json({ ok: true, motivo: "sem externalReference" });
    }

    let novoStatus = null;
    let novoPlano = null;

    if (EVENTOS_ATIVA.includes(evento)) {
      novoStatus = "ativa";
      novoPlano = plano || "premium";
    } else if (EVENTOS_INATIVA.includes(evento)) {
      novoStatus = "inativa";
      // Ao cair, volta pro básico
      novoPlano = "basico";
    } else {
      // Evento que não muda o status (ex.: PAYMENT_CREATED). Só confirma o recebimento.
      return res.status(200).json({ ok: true, evento: evento, acao: "ignorado" });
    }

    // Monta o que vamos atualizar
    const atualizacao = {
      assinatura_status: novoStatus,
      plano: novoPlano,
    };
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
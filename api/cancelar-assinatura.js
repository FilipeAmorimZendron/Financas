// api/cancelar-assinatura.js
// Cancelamento de assinatura self-service — chamado pelo botão "Cancelar
// assinatura" em Conta. Cancela a assinatura recorrente no Asaas (não
// gera mais cobranças) e já atualiza o perfil na hora, sem depender só
// do webhook chegar (mesmo espírito de api/confirmar-assinatura.js).
//
// O ciclo já pago NÃO é estornado — a pessoa mantém acesso completo até
// proxima_cobranca, exatamente como prometido na landing e no app. Isso
// espelha o que api/webhook-asaas.js já faz quando recebe o evento
// SUBSCRIPTION_DELETED/SUBSCRIPTION_INACTIVATED do Asaas (mesmo status:
// "cancelada_fim_ciclo") — aqui só adiantamos essa atualização, pro
// usuário ver o efeito na hora em vez de esperar o webhook.

const SUPABASE_URL = process.env.SUPABASE_URL || "https://yuvhkrwksdnajfautkru.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ASAAS_URL = process.env.ASAAS_URL || "https://api-sandbox.asaas.com/v3";
const ASAAS_KEY = process.env.ASAAS_KEY;

// Valida o token do usuário e retorna o ID dele (não dá pra falsificar,
// mesmo padrão usado em api/chat-ia.js, api/criar-checkout.js etc.).
async function validarUsuario(token, anonKey) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { "apikey": anonKey, "Authorization": `Bearer ${token}` }
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user && user.id ? user.id : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido" });
  }
  if (!ASAAS_KEY || !SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ erro: "Servidor sem as chaves configuradas" });
  }

  try {
    // "motivo" é só pra registro/log — opcional, texto livre curto, nunca
    // bloqueia o cancelamento (ver comentário mais abaixo).
    const { token, motivo } = req.body || {};
    if (!token || typeof token !== "string") {
      return res.status(401).json({ erro: "Sessão inválida. Faça login novamente." });
    }

    // CRÍTICO: o userId NUNCA vem do corpo da requisição — só da validação
    // do token de sessão (mesma regra de todos os outros endpoints de
    // pagamento). Ninguém cancela a assinatura de outra pessoa.
    const userId = await validarUsuario(token, SUPABASE_ANON_KEY);
    if (!userId) {
      return res.status(401).json({ erro: "Sessão expirada. Faça login novamente." });
    }

    // Busca a assinatura atual no nosso banco
    const respPerfil = await fetch(
      `${SUPABASE_URL}/rest/v1/perfil?user_id=eq.${encodeURIComponent(userId)}&select=assinatura_status,asaas_subscription_id,plano,proxima_cobranca`,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    if (!respPerfil.ok) {
      return res.status(500).json({ erro: "Não consegui ler seu perfil agora." });
    }
    const linhas = await respPerfil.json();
    const perfil = linhas[0];

    if (!perfil || perfil.assinatura_status !== "ativa" || !perfil.asaas_subscription_id) {
      return res.status(400).json({ erro: "Você não tem uma assinatura ativa pra cancelar." });
    }

    // Cancela a assinatura recorrente no Asaas — não gera mais cobranças.
    // O ciclo já pago não é mexido (sem estorno), então o acesso continua
    // valendo até proxima_cobranca, exatamente como já é hoje quando o
    // cancelamento chega pelo webhook.
    const respCancela = await fetch(`${ASAAS_URL}/subscriptions/${perfil.asaas_subscription_id}`, {
      method: "DELETE",
      headers: { access_token: ASAAS_KEY }
    });

    // 404 significa que o Asaas já não tem mais essa assinatura (cancelada
    // por outro caminho, ex.: o webhook já processou antes de chegarmos
    // aqui) — trata como sucesso, não como erro, pra não travar a pessoa.
    if (!respCancela.ok && respCancela.status !== 404) {
      const txt = await respCancela.text();
      console.error("Falha ao cancelar assinatura no Asaas:", respCancela.status, txt);
      return res.status(502).json({ erro: "Não consegui cancelar a assinatura agora. Tente de novo em instantes ou fale com o suporte." });
    }

    // Atualiza o perfil na hora — mesmo status que o webhook usaria
    // (ver EVENTOS_CANCELAMENTO em api/webhook-asaas.js). Mantém "plano"
    // como está: o acesso só cai quando proxima_cobranca chegar (o app já
    // trata esse status sozinho, ver mostrarAppOuPaywall() em app.js).
    const respUp = await fetch(
      `${SUPABASE_URL}/rest/v1/perfil?user_id=eq.${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ assinatura_status: "cancelada_fim_ciclo" }),
      }
    );
    if (!respUp.ok) {
      const txt = await respUp.text();
      console.error("Cancelou no Asaas mas falhou ao atualizar o perfil:", respUp.status, txt);
      // Não devolve erro pro usuário aqui: a assinatura JÁ foi cancelada de
      // verdade no Asaas (a fonte da verdade), o webhook ainda vai chegar
      // e corrigir o perfil sozinho. Informar "erro" faria a pessoa achar
      // que precisa tentar cancelar de novo, quando já cancelou.
    }

    // Log só pra registro interno (sem tabela nova) — dá pra ver nos Logs
    // da Vercel se quiser ter uma ideia dos motivos mais comuns.
    console.log("Cancelamento de assinatura:", userId, "| motivo:", String(motivo || "").slice(0, 200) || "(não informado)");

    return res.status(200).json({ ok: true, acessoAte: perfil.proxima_cobranca || null });

  } catch (e) {
    console.error("Erro em cancelar-assinatura:", e);
    return res.status(500).json({ erro: "Erro interno", detalhe: String(e) });
  }
}

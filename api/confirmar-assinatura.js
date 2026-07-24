// api/confirmar-assinatura.js
// Rede de segurança para quando o webhook do Asaas falha ou demora.
//
// Quando o usuário volta do checkout, o app chama esta função.
// Ela pergunta ao Asaas: "esse e-mail tem pagamento confirmado?"
// Se tiver, libera o plano na hora — sem depender do webhook chegar.

const SUPABASE_URL = process.env.SUPABASE_URL || "https://yuvhkrwksdnajfautkru.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ASAAS_URL = process.env.ASAAS_URL || "https://api-sandbox.asaas.com/v3";
const ASAAS_KEY = process.env.ASAAS_KEY;

/* Descobre o plano pelo valor pago (mesmos preços de criar-checkout.js) */
function planoPeloValor(valor) {
  const v = Number(valor) || 0;
  if (v >= 400) return "master";
  if (v >= 200) return "premium";
  if (v >= 40)  return "master";
  return "premium";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido" });
  }
  if (!ASAAS_KEY || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ erro: "Servidor sem as chaves configuradas" });
  }

  try {
    const { email, userId } = req.body || {};
    if (!email || !userId) {
      return res.status(400).json({ erro: "Informe e-mail e userId" });
    }

    const emailLimpo = String(email).trim().toLowerCase();
    const headersAsaas = { access_token: ASAAS_KEY };

    // 1. Acha o cliente no Asaas pelo e-mail
    const respCli = await fetch(
      `${ASAAS_URL}/customers?email=${encodeURIComponent(emailLimpo)}`,
      { headers: headersAsaas }
    );
    if (!respCli.ok) {
      return res.status(502).json({ erro: "Falha ao consultar o Asaas" });
    }
    const clientes = await respCli.json();
    const cliente = (clientes.data || [])[0];
    if (!cliente) {
      return res.status(200).json({ ativo: false, motivo: "sem cliente no Asaas" });
    }

    // 2. Procura pagamentos confirmados desse cliente
    const respPag = await fetch(
      `${ASAAS_URL}/payments?customer=${cliente.id}&limit=20`,
      { headers: headersAsaas }
    );
    if (!respPag.ok) {
      return res.status(502).json({ erro: "Falha ao consultar pagamentos" });
    }
    const pagamentos = await respPag.json();
    const lista = pagamentos.data || [];

    const confirmado = lista.find(p =>
      p.status === "CONFIRMED" || p.status === "RECEIVED"
    );

    if (!confirmado) {
      return res.status(200).json({
        ativo: false,
        motivo: "nenhum pagamento confirmado",
        statusEncontrados: lista.map(p => p.status)
      });
    }

    // 3. Pagamento existe: libera o plano no Supabase
    const plano = planoPeloValor(confirmado.value);
    const atualizacao = {
      assinatura_status: "ativa",
      plano: plano,
    };
    if (confirmado.subscription) {
      atualizacao.asaas_subscription_id = confirmado.subscription;
    }

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
        body: JSON.stringify(atualizacao),
      }
    );

    if (!respUp.ok) {
      const txt = await respUp.text();
      console.error("Falha ao liberar plano:", respUp.status, txt);
      return res.status(500).json({ erro: "Não consegui atualizar o perfil" });
    }

    console.log("Plano liberado por confirmação direta:", userId, plano);
    return res.status(200).json({ ativo: true, plano: plano });

  } catch (e) {
    console.error("Erro em confirmar-assinatura:", e);
    return res.status(500).json({ erro: "Erro interno", detalhe: String(e) });
  }
}
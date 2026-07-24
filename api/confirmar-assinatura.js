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
    const { email, userId, customerId } = req.body || {};
    if (!email || !userId) {
      return res.status(400).json({ erro: "Informe e-mail e userId" });
    }

    const emailLimpo = String(email).trim().toLowerCase();
    const headersAsaas = { access_token: ASAAS_KEY };
    const diagnostico = { email: emailLimpo, etapas: [] };

    // Atalho: se você já sabe o id do cliente (pelos logs do webhook),
    // pode passar direto e pular a busca por e-mail.
    let listaClientes = [];
    if (customerId) {
      const rc = await fetch(`${ASAAS_URL}/customers/${customerId}`, { headers: headersAsaas });
      if (rc.ok) {
        const c = await rc.json();
        diagnostico.etapas.push(`cliente informado: ${c.id} (${c.email || "sem e-mail"})`);
        listaClientes = [c];
      }
    }

    // 1. Se não veio cliente direto, acha pelos e-mail no Asaas.
    //    Pode haver mais de um (o app cria um a cada tentativa de checkout).
    if (!listaClientes.length) {
      const respCli = await fetch(
        `${ASAAS_URL}/customers?email=${encodeURIComponent(emailLimpo)}&limit=100`,
        { headers: headersAsaas }
      );
      if (!respCli.ok) {
        const txt = await respCli.text();
        console.error("Falha ao consultar clientes:", respCli.status, txt.slice(0, 200));
        return res.status(502).json({ erro: "Falha ao consultar o Asaas", status: respCli.status });
      }
      const clientes = await respCli.json();
      listaClientes = clientes.data || [];
      diagnostico.etapas.push(`clientes com esse e-mail: ${listaClientes.length}`);
    }

    // 2. Não achou pelo e-mail? Procura nos pagamentos recentes da conta.
    //    Cobre o caso de a pessoa ter digitado outro e-mail no checkout.
    if (!listaClientes.length) {
      const respTodos = await fetch(
        `${ASAAS_URL}/payments?status=CONFIRMED&limit=100`,
        { headers: headersAsaas }
      );
      if (respTodos.ok) {
        const todos = await respTodos.json();
        const pagos = todos.data || [];
        diagnostico.etapas.push(`pagamentos confirmados na conta: ${pagos.length}`);

        // Para cada pagamento, checa se o cliente tem o nosso userId ou e-mail
        for (const p of pagos) {
          if (!p.customer) continue;
          const rc = await fetch(`${ASAAS_URL}/customers/${p.customer}`, { headers: headersAsaas });
          if (!rc.ok) continue;
          const c = await rc.json();
          const emailCliente = (c.email || "").trim().toLowerCase();
          const refCliente = c.externalReference || "";
          if (emailCliente === emailLimpo || refCliente === userId) {
            listaClientes = [c];
            diagnostico.etapas.push(`achou pelo pagamento ${p.id}`);
            break;
          }
        }
      }
    }

    if (!listaClientes.length) {
      console.log("DIAGNOSTICO confirmar:", JSON.stringify(diagnostico));
      return res.status(200).json({
        ativo: false,
        motivo: "nenhum cliente com esse e-mail no Asaas",
        diagnostico
      });
    }

    // 3. Procura pagamento confirmado em qualquer um dos clientes encontrados
    let confirmado = null;
    const statusVistos = [];
    for (const cli of listaClientes) {
      const respPag = await fetch(
        `${ASAAS_URL}/payments?customer=${cli.id}&limit=50`,
        { headers: headersAsaas }
      );
      if (!respPag.ok) continue;
      const pagamentos = await respPag.json();
      const lista = pagamentos.data || [];
      lista.forEach(p => statusVistos.push(p.status));
      const achado = lista.find(p => p.status === "CONFIRMED" || p.status === "RECEIVED");
      if (achado) { confirmado = achado; break; }
    }
    diagnostico.etapas.push(`status vistos: ${statusVistos.join(",") || "nenhum"}`);

    if (!confirmado) {
      console.log("DIAGNOSTICO confirmar:", JSON.stringify(diagnostico));
      return res.status(200).json({
        ativo: false,
        motivo: "nenhum pagamento confirmado",
        statusEncontrados: statusVistos,
        diagnostico
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
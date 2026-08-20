// api/confirmar-assinatura.js
// Rede de segurança para quando o webhook do Asaas falha ou demora.
//
// Quando o usuário volta do checkout, o app chama esta função.
// Ela pergunta ao Asaas: "esse e-mail tem pagamento confirmado?"
// Se tiver, libera o plano na hora — sem depender do webhook chegar.

const SUPABASE_URL = process.env.SUPABASE_URL || "https://yuvhkrwksdnajfautkru.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ASAAS_URL = process.env.ASAAS_URL || "https://api-sandbox.asaas.com/v3";
const ASAAS_KEY = process.env.ASAAS_KEY;

// Valores do plano Empresarial (cheio e com o cupom ORGANIZACAO) — mesma
// lista de webhook-asaas.js. Precisa ser checado ANTES dos limites
// genéricos abaixo: sem isso, 41,90 cairia em "v >= 40 -> master" (o
// Master antigo de R$47,90), classificando errado o plano Empresarial.
const VALORES_EMPRESARIAL = [41.9, 35.9];
function ehValorEmpresarial(valor) {
  const v = Number(valor) || 0;
  return VALORES_EMPRESARIAL.some(x => Math.abs(v - x) < 0.005);
}

/* Descobre o plano pelo valor pago (mesmos preços de criar-checkout.js).
   Assinantes antigos (Premium/Master, mensal ou anual) continuam renovando
   nos preços de antes; o plano único (hoje R$ 26,90, ou R$ 20,90 com
   cupom — já foi R$ 37,90/27,90 antes) e o Empresarial (R$ 41,90, ou
   R$ 35,90 com cupom) caem no último "return premium" — o Empresarial só
   por causa do ehValorEmpresarial() acima, os outros por serem sempre
   menores que 40 — não precisou mudar mais nada aqui a cada mudança de
   preço. */
function planoPeloValor(valor) {
  const v = Number(valor) || 0;
  if (ehValorEmpresarial(v)) return "premium";
  if (v >= 400) return "master";
  if (v >= 200) return "premium";
  if (v >= 40)  return "master";
  return "premium";
}

// Valida o token do usuário e retorna o ID dele (não dá pra falsificar,
// mesmo padrão usado em api/chat-ia.js, api/ler-extrato.js e api/excluir-conta.js).
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
    const { email, token, customerId } = req.body || {};
    if (!email) {
      return res.status(400).json({ erro: "Informe o e-mail" });
    }
    if (!token || typeof token !== "string") {
      return res.status(401).json({ erro: "Sessão inválida. Faça login novamente." });
    }

    // CRÍTICO: o userId NUNCA vem do corpo da requisição — vem só da validação
    // do token de sessão. Antes, quem chamasse esta rota podia mandar QUALQUER
    // userId no corpo e ativar Premium/Master na conta de outra pessoa, bastando
    // ter um pagamento confirmado no Asaas com o próprio e-mail. Agora só dá
    // pra ativar a assinatura na própria conta de quem está logado.
    const userId = await validarUsuario(token, SUPABASE_ANON_KEY);
    if (!userId) {
      return res.status(401).json({ erro: "Sessão expirada. Faça login novamente." });
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

    // 0. Caminho preferencial: os checkouts que ESTE usuário iniciou.
    //    Cobre o caso de a pessoa ter digitado outro e-mail no pagamento.
    if (!listaClientes.length) {
      try {
        const url = `${SUPABASE_URL}/rest/v1/checkouts?user_id=eq.${encodeURIComponent(userId)}` +
                    `&select=asaas_customer_id&order=criado_em.desc&limit=10`;
        const resp = await fetch(url, {
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`
          }
        });
        if (resp.ok) {
          const linhas = await resp.json();
          const ids = [...new Set((linhas || []).map(l => l.asaas_customer_id).filter(Boolean))];
          diagnostico.etapas.push(`checkouts registrados deste usuário: ${ids.length}`);
          for (const id of ids) {
            const rc = await fetch(`${ASAAS_URL}/customers/${id}`, { headers: headersAsaas });
            if (rc.ok) listaClientes.push(await rc.json());
          }
        }
      } catch (e) {
        diagnostico.etapas.push(`falha ao ler checkouts: ${String(e)}`);
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

    // Confere se algum dos clientes encontrados tem pagamento.
    // Se nenhum tiver, precisamos varrer os pagamentos da conta —
    // é o caso de o checkout ter criado um cliente à parte.
    let precisaVarrer = false;
    if (listaClientes.length) {
      let algumTemPagamento = false;
      for (const cli of listaClientes) {
        const r = await fetch(`${ASAAS_URL}/payments?customer=${cli.id}&limit=1`, { headers: headersAsaas });
        if (r.ok) {
          const d = await r.json();
          if ((d.data || []).length) { algumTemPagamento = true; break; }
        }
      }
      if (!algumTemPagamento) {
        precisaVarrer = true;
        diagnostico.etapas.push("nenhum desses clientes tem pagamento — varrendo a conta");
      }
    }

    // 2. Achou clientes mas nenhum tem pagamento? O checkout do Asaas cria
    //    OUTRO cliente com os dados digitados. Então varremos os pagamentos
    //    recentes da conta e casamos pelo e-mail do cliente que pagou.
    if (!listaClientes.length || precisaVarrer) {
      const respTodos = await fetch(
        `${ASAAS_URL}/payments?limit=100`,
        { headers: headersAsaas }
      );
      if (respTodos.ok) {
        const todos = await respTodos.json();
        const pagos = todos.data || [];
        diagnostico.etapas.push(`pagamentos na conta: ${pagos.length}`);

        const emailsVistos = new Set();
        const achados = [];

        for (const p of pagos) {
          if (!p.customer) continue;
          const rc = await fetch(`${ASAAS_URL}/customers/${p.customer}`, { headers: headersAsaas });
          if (!rc.ok) continue;
          const c = await rc.json();
          const emailCliente = (c.email || "").trim().toLowerCase();
          if (emailCliente) emailsVistos.add(`${emailCliente} (${p.status})`);
          const refCliente = c.externalReference || "";
          if (emailCliente === emailLimpo || refCliente === userId) {
            achados.push(c);
            diagnostico.etapas.push(`pagamento ${p.id} status ${p.status} → cliente ${c.id}`);
          }
        }

        if (achados.length) {
          listaClientes = achados;
        } else {
          diagnostico.emailsQuePagaram = [...emailsVistos].slice(0, 15);
          diagnostico.etapas.push("nenhum pagamento é do seu e-mail nem do seu userId");
        }
      } else {
        diagnostico.etapas.push(`falha ao listar pagamentos: ${respTodos.status}`);
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
      // Mesma lógica do webhook: liga/desliga o espaço Empresarial de
      // acordo com o valor pago nesta cobrança.
      empresarial: ehValorEmpresarial(confirmado.value),
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
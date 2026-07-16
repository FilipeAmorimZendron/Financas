// api/chat-ia.js
// Função serverless que conversa com a API da Anthropic (Claude).
// Faz o controle de limite de uso da IA por plano (verificação no servidor):
//   - Premium: 25 perguntas por mês (ao acabar, pede upgrade)
//   - Master:  100 perguntas; ao zerar, recarrega tudo após 3 horas

const SUPABASE_URL = "https://yuvhkrwksdnajfautkru.supabase.co";

const LIMITES = {
  premium: 25,
  master: 100
};
const HORAS_RECARGA_MASTER = 3;

// Lê o perfil do usuário no Supabase (usando a service key)
async function lerPerfil(userId, serviceKey) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/perfil?user_id=eq.${userId}&select=plano,assinatura_status,ia_usos,ia_reset_em`,
    {
      headers: {
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`
      }
    }
  );
  if (!res.ok) return null;
  const linhas = await res.json();
  return linhas[0] || null;
}

// Atualiza a contagem de uso no Supabase
async function atualizarUso(userId, serviceKey, usos, resetEm) {
  await fetch(`${SUPABASE_URL}/rest/v1/perfil?user_id=eq.${userId}`, {
    method: "PATCH",
    headers: {
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
      "content-type": "application/json",
      "Prefer": "return=minimal"
    },
    body: JSON.stringify({ ia_usos: usos, ia_reset_em: resetEm })
  });
}

// Valida o token do usuário e retorna o ID dele (não dá pra falsificar)
async function validarUsuario(token, anonKey) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      "apikey": anonKey,
      "Authorization": `Bearer ${token}`
    }
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user && user.id ? user.id : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!apiKey) {
    return res.status(500).json({ erro: "Chave da API não configurada." });
  }

  try {
    const { pergunta, resumoFinanceiro, token } = req.body || {};

    if (!pergunta || typeof pergunta !== "string") {
      return res.status(400).json({ erro: "Pergunta inválida." });
    }
    if (pergunta.length > 1000) {
      return res.status(400).json({ erro: "Pergunta muito longa." });
    }

    // ─── Controle de limite (só se as chaves do Supabase estiverem configuradas) ───
    let usosInfo = null;
    if (serviceKey && anonKey && token) {
      const userId = await validarUsuario(token, anonKey);
      if (!userId) {
        return res.status(401).json({ erro: "Sessão inválida. Faça login de novo." });
      }

      const perfil = await lerPerfil(userId, serviceKey);
      if (!perfil) {
        return res.status(403).json({ erro: "Perfil não encontrado." });
      }

      const plano = (perfil.assinatura_status === "ativa") ? perfil.plano : "basico";

      // Básico não tem acesso
      if (plano !== "premium" && plano !== "master") {
        return res.status(403).json({ erro: "upgrade", motivo: "O assistente de IA está disponível nos planos Premium e Master." });
      }

      const limite = LIMITES[plano];
      let usos = perfil.ia_usos || 0;
      let resetEm = perfil.ia_reset_em ? new Date(perfil.ia_reset_em) : new Date();
      const agora = new Date();

      if (plano === "master") {
        // Master: se a cota zerou e já passaram 3h desde o reset, recarrega
        if (usos >= limite) {
          const horasPassadas = (agora - resetEm) / (1000 * 60 * 60);
          if (horasPassadas >= HORAS_RECARGA_MASTER) {
            usos = 0;
            resetEm = agora;
          } else {
            const faltam = Math.ceil(HORAS_RECARGA_MASTER - horasPassadas);
            return res.status(429).json({
              erro: "limite",
              plano: "master",
              motivo: `Você atingiu o limite de ${limite} perguntas. Suas perguntas serão liberadas em aproximadamente ${faltam} hora(s).`
            });
          }
        }
      } else {
        // Premium: limite mensal. Se o mês virou, zera.
        const mesReset = resetEm.getFullYear() * 100 + resetEm.getMonth();
        const mesAgora = agora.getFullYear() * 100 + agora.getMonth();
        if (mesAgora > mesReset) {
          usos = 0;
          resetEm = agora;
        }
        if (usos >= limite) {
          return res.status(429).json({
            erro: "limite",
            plano: "premium",
            motivo: `Você usou suas ${limite} perguntas do mês. Faça upgrade para o plano Master e tenha muito mais.`
          });
        }
      }

      // Consome uma pergunta
      usos += 1;
      await atualizarUso(userId, serviceKey, usos, resetEm.toISOString());
      usosInfo = { usados: usos, limite: limite, plano: plano };
    }

    // ─── Chama a IA ───
    const systemPrompt = [
      "Você é o Assistente FAZ, o assistente financeiro inteligente do app FAZ Finanças, um aplicativo brasileiro de finanças pessoais.",
      "Responda sempre em português do Brasil, de forma profissional, clara, acolhedora e fácil de entender.",
      "",
      "SUAS TRÊS FUNÇÕES:",
      "1) Responder sobre os dados financeiros do usuário (saldo, gastos, metas, investimentos, etc.).",
      "2) Explicar como usar o app FAZ Finanças (como fazer algo, onde fica cada funcionalidade).",
      "3) Dar conselhos financeiros úteis (como economizar, organizar, planejar).",
      "",
      "COMO O APP FAZ FINANÇAS FUNCIONA (use para responder dúvidas de uso):",
      "- Dashboard: visão geral com saldo total, entradas e gastos do período, e um gráfico de evolução do saldo dos últimos meses.",
      "- Contas: onde o usuário cadastra suas contas/carteiras (Nubank, Itaú, carteira física, etc.), cada uma com saldo próprio.",
      "- Lançamentos: onde registra entradas e gastos. Aceita linguagem natural (ex: 'gastei 50 no mercado' ou '+1500 salário'). O app detecta valor, tipo e categoria automaticamente. Também dá para importar extrato em CSV.",
      "- Transferências: para mover dinheiro entre contas próprias sem contar como receita ou gasto. A origem perde e o destino ganha; o saldo total não muda.",
      "- Recorrências: contas fixas que se repetem todo mês (aluguel, Netflix, academia). Cadastra uma vez e o app lança automaticamente no dia definido.",
      "- Metas: limite de gasto mensal por categoria. A barra fica amarela acima de 75% e vermelha quando estoura.",
      "- Investimentos: onde registra aplicações (CDB, Tesouro, ações, cripto). Mostra o valor atual e o rendimento.",
      "- Planilha: análise detalhada dos dados com filtros e resumos.",
      "- Conta: perfil do usuário, plano (Básico, Premium ou Master) e configurações.",
      "As categorias de gastos são: Alimentação, Transporte, Moradia, Saúde, Lazer, Educação, Serviços, Compras e Outros.",
      "",
      "REGRAS IMPORTANTES:",
      "- Você JÁ TEM acesso aos dados financeiros do usuário (fornecidos abaixo). Nunca peça para ele compartilhar ou enviar os dados — eles já estão disponíveis. Use-os diretamente.",
      "- Os dados abaixo são uma fotografia do momento atual. Se o usuário disser que acabou de adicionar algo e você não vê, oriente-o gentilmente a fechar e reabrir o chat para atualizar os dados, em vez de afirmar que o lançamento não existe.",
      "- Nunca invente números que não estão nos dados. Se um dado específico não estiver disponível, diga que ele ainda não foi registrado no app e explique como registrá-lo.",
      "- Você não é um consultor financeiro certificado; para decisões grandes (grandes investimentos, dívidas complexas), sugira procurar um profissional.",
      "",
      "FORMATO DAS RESPOSTAS (siga sempre):",
      "- Seja curto e direto, geralmente 1 a 3 frases. Vá direto ao ponto.",
      "- Não use asteriscos, markdown, negrito ou formatação especial — escreva texto simples e corrido.",
      "- Não use emojis.",
      "- Quando citar valores, use o formato brasileiro (R$ 1.500,00).",
      resumoFinanceiro
        ? `\n\nDADOS FINANCEIROS ATUAIS DO USUÁRIO:\n${resumoFinanceiro}`
        : "\n\n(O usuário ainda não tem dados financeiros registrados no app. Oriente-o a começar cadastrando uma conta e alguns lançamentos.)"
    ].join("\n");

    const resposta = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 400,
        system: systemPrompt,
        messages: [{ role: "user", content: pergunta }]
      })
    });

    const dados = await resposta.json();

    if (!resposta.ok) {
      console.error("Erro da API Anthropic:", JSON.stringify(dados));
      return res.status(502).json({ erro: "Não foi possível obter a resposta da IA." });
    }

    const texto = (dados.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n")
      .trim();

    return res.status(200).json({
      resposta: texto || "Não consegui gerar uma resposta.",
      usos: usosInfo
    });

  } catch (e) {
    console.error("Erro na função chat-ia:", e);
    return res.status(500).json({ erro: "Erro ao processar a pergunta." });
  }
}
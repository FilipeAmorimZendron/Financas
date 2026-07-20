// api/ler-extrato.js
// Recebe um extrato (texto de CSV/OFX, ou PDF/imagem em base64), manda para a IA
// e devolve os lançamentos já organizados e categorizados.
// O que a IA não conseguir resolver sozinha vira uma "dúvida" para o usuário responder.
// Disponível nos planos Premium e Master.

const SUPABASE_URL = "https://yuvhkrwksdnajfautkru.supabase.co";

const CATEGORIAS = [
  "Alimentação", "Transporte", "Moradia", "Saúde",
  "Lazer", "Educação", "Serviços", "Compras", "Outros"
];

// Valida o token do usuário e devolve o id
async function validarUsuario(token, anonKey) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { "apikey": anonKey, "Authorization": `Bearer ${token}` }
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user && user.id ? user.id : null;
}

// Lê o perfil (plano) do usuário
async function lerPerfil(userId, serviceKey) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/perfil?user_id=eq.${userId}&select=plano,assinatura_status`,
    { headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` } }
  );
  if (!res.ok) return null;
  const linhas = await res.json();
  return linhas[0] || null;
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
    const { texto, arquivoBase64, tipoArquivo, token, hoje } = req.body || {};

    if (!texto && !arquivoBase64) {
      return res.status(400).json({ erro: "Envie o conteúdo do extrato." });
    }

    // ─── Controle de acesso: só Premium e Master ───
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
      if (plano !== "premium" && plano !== "master") {
        return res.status(403).json({
          erro: "upgrade",
          motivo: "A leitura de extrato com IA está disponível nos planos Premium e Master."
        });
      }
    }

    const dataHoje = hoje || new Date().toISOString().slice(0, 10);

    const systemPrompt = [
      "Você é o leitor de extratos do FAZ Finanças, um app brasileiro de finanças pessoais.",
      "Sua tarefa: ler o extrato bancário enviado e transformar cada transação em um lançamento organizado.",
      "",
      "REGRAS DE LEITURA:",
      `- A data de hoje é ${dataHoje}. Use-a para resolver datas sem ano.`,
      "- Datas sempre no formato AAAA-MM-DD.",
      "- Valor sempre positivo (número), e o tipo indica se é entrada ou saída.",
      "- tipo: \"saida\" para gastos/débitos, \"entrada\" para receitas/créditos.",
      "- Descrição: limpe o texto do banco deixando legível. Ex: 'PAG*IFOOD 4412' vira 'iFood'.",
      "- Ignore linhas que não são transações (saldo anterior, saldo final, cabeçalhos, totais).",
      `- Categorias possíveis: ${CATEGORIAS.join(", ")}. Para entradas, use \"Entrada\".`,
      "",
      "QUANDO VOCÊ TIVER DÚVIDA:",
      "- Se não conseguir categorizar com segurança, NÃO chute. Coloque o item em \"duvidas\".",
      "- Você também pode perguntar sobre QUALQUER outra coisa que te deixe insegura: uma data ambígua,",
      "  um valor que pode ser estorno, uma transferência que talvez não deva virar lançamento, uma",
      "  transação duplicada, etc. Use o campo \"pergunta\" para explicar em português claro e simples.",
      "- Em cada dúvida, ofereça de 2 a 4 opções curtas para o usuário escolher.",
      "",
      "FORMATO DA RESPOSTA (responda APENAS com JSON válido, sem markdown, sem cercas de código):",
      "{",
      '  "lancamentos": [',
      '    { "data": "2026-07-10", "descricao": "Supermercado Pão de Açúcar", "valor": 234.50, "tipo": "saida", "categoria": "Alimentação" }',
      "  ],",
      '  "duvidas": [',
      '    { "data": "2026-07-12", "descricao": "PAG*JLM SERVICOS 4412", "valor": 89.90, "tipo": "saida",',
      '      "pergunta": "Não consegui identificar esse estabelecimento. Em qual categoria ele se encaixa?",',
      '      "opcoes": ["Serviços", "Compras", "Moradia", "Outros"] }',
      "  ],",
      '  "resumo": "Li 18 transações entre 10/07 e 15/07."',
      "}",
      "",
      "Nunca invente transações que não estão no extrato. Se o arquivo não for um extrato, devolva listas vazias e explique no resumo."
    ].join("\n");

    // Monta o conteúdo da mensagem (texto puro ou arquivo)
    let conteudoUsuario;
    if (arquivoBase64 && tipoArquivo) {
      const bloco = tipoArquivo === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: arquivoBase64 } }
        : { type: "image",    source: { type: "base64", media_type: tipoArquivo,      data: arquivoBase64 } };
      conteudoUsuario = [bloco, { type: "text", text: "Leia este extrato e devolva o JSON conforme as regras." }];
    } else {
      conteudoUsuario = [{ type: "text", text: "Leia este extrato e devolva o JSON conforme as regras:\n\n" + texto.slice(0, 60000) }];
    }

    const resposta = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: "user", content: conteudoUsuario }]
      })
    });

    const dados = await resposta.json();

    if (!resposta.ok) {
      console.error("Erro da API Anthropic (ler-extrato):", JSON.stringify(dados));
      return res.status(502).json({ erro: "Não foi possível ler o extrato." });
    }

    let bruto = (dados.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("")
      .trim();

    // Remove cercas de código, se a IA tiver colocado mesmo assim
    bruto = bruto.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

    let resultado;
    try {
      resultado = JSON.parse(bruto);
    } catch (e) {
      console.error("JSON inválido da IA:", bruto.slice(0, 500));
      return res.status(502).json({ erro: "A IA não conseguiu organizar esse extrato. Tente outro arquivo." });
    }

    return res.status(200).json({
      lancamentos: Array.isArray(resultado.lancamentos) ? resultado.lancamentos : [],
      duvidas:     Array.isArray(resultado.duvidas)     ? resultado.duvidas     : [],
      resumo:      resultado.resumo || ""
    });

  } catch (e) {
    console.error("Erro na função ler-extrato:", e);
    return res.status(500).json({ erro: "Erro ao processar o extrato." });
  }
}
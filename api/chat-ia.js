// api/chat-ia.js
// Função serverless que conversa com a API da Anthropic (Claude).
// Recebe a pergunta do usuário + um resumo dos dados financeiros,
// e devolve a resposta da IA.

export default async function handler(req, res) {
  // Só aceita POST
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ erro: "Chave da API não configurada." });
  }

  try {
    const { pergunta, resumoFinanceiro } = req.body || {};

    if (!pergunta || typeof pergunta !== "string") {
      return res.status(400).json({ erro: "Pergunta inválida." });
    }

    // Limite de tamanho da pergunta (evita abuso e custo alto)
    if (pergunta.length > 1000) {
      return res.status(400).json({ erro: "Pergunta muito longa." });
    }

    // Instruções para a IA: quem ela é e como deve responder
    const systemPrompt = [
      "Você é o assistente financeiro do app FAZ Finanças, um app brasileiro de finanças pessoais.",
      "Responda em português do Brasil, de forma clara, prática e amigável.",
      "Ajude o usuário a entender suas finanças, economizar e organizar o dinheiro.",
      "IMPORTANTE: você JÁ TEM acesso aos dados financeiros do usuário (fornecidos abaixo). Nunca peça para o usuário compartilhar ou enviar os dados — eles já estão disponíveis para você. Use-os diretamente para dar respostas concretas e personalizadas.",
      "Seja conciso: respostas de 2 a 4 parágrafos no máximo, a não ser que peçam detalhes.",
      "Você não é um consultor financeiro certificado; para decisões grandes, sugira procurar um profissional.",
      "Nunca invente números que não estão nos dados. Se algum dado específico não estiver disponível, diga que aquele dado ainda não foi registrado no app.",
      resumoFinanceiro
        ? `\n\nDados financeiros atuais do usuário:\n${resumoFinanceiro}`
        : "\n\n(O usuário ainda não tem dados financeiros registrados no app.)"
    ].join(" ");

    // Chama a API da Anthropic
    const resposta = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 800,
        system: systemPrompt,
        messages: [
          { role: "user", content: pergunta }
        ]
      })
    });

    const dados = await resposta.json();

    if (!resposta.ok) {
      console.error("Erro da API Anthropic:", JSON.stringify(dados));
      return res.status(502).json({ erro: "Não foi possível obter a resposta da IA." });
    }

    // A resposta vem em dados.content, que é uma lista de blocos
    const texto = (dados.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n")
      .trim();

    return res.status(200).json({ resposta: texto || "Não consegui gerar uma resposta." });

  } catch (e) {
    console.error("Erro na função chat-ia:", e);
    return res.status(500).json({ erro: "Erro ao processar a pergunta." });
  }
}
// api/categorizar.js
// Categoriza uma descrição de gasto usando a IA, quando as palavras-chave
// do app não conseguem identificar (cairia em "Outros").
// Retorna apenas o nome da categoria.

const CATEGORIAS = [
  "Alimentação", "Transporte", "Moradia", "Saúde",
  "Lazer", "Educação", "Serviços", "Compras", "Outros"
];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ categoria: "Outros" });
  }

  try {
    const { descricao } = req.body || {};
    if (!descricao || typeof descricao !== "string") {
      return res.status(200).json({ categoria: "Outros" });
    }

    const systemPrompt =
      "Você categoriza gastos financeiros. Responda APENAS com o nome exato de UMA categoria da lista, sem explicação, sem pontuação, sem mais nada. " +
      "Categorias possíveis: " + CATEGORIAS.join(", ") + ". " +
      "Se não tiver certeza, responda Outros.";

    const resposta = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 20,
        system: systemPrompt,
        messages: [{ role: "user", content: `Categorize este gasto: "${descricao}"` }]
      })
    });

    const dados = await resposta.json();
    if (!resposta.ok) {
      return res.status(200).json({ categoria: "Outros" });
    }

    let texto = (dados.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("")
      .trim();

    // Garante que a resposta é uma categoria válida
    const categoria = CATEGORIAS.find(c => texto.toLowerCase().includes(c.toLowerCase())) || "Outros";

    return res.status(200).json({ categoria });

  } catch (e) {
    console.error("Erro ao categorizar:", e);
    return res.status(200).json({ categoria: "Outros" });
  }
}
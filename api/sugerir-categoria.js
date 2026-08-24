// api/sugerir-categoria.js
// Recebe a explicação que a pessoa escreveu sobre um lançamento (na tela de
// revisão do extrato, botão "Não, é outra coisa (explicar)") e devolve a
// categoria certa: uma das que já existem, ou o nome de uma nova pra criar.
// Chamada pequena e rápida (Haiku, poucos tokens) — não é leitura de arquivo.

const SUPABASE_URL = "https://yuvhkrwksdnajfautkru.supabase.co";

// Quanto essa sugestão consome do limite de usos da IA — é uma classificação
// única e pequena, bem mais barata que ler um extrato inteiro.
const CUSTO = 1;
const LIMITES = { premium: 100, master: 100 };
const HORAS_RECARGA = 3;

// Mesma data de corte do plano único usada nos outros endpoints.
const CORTE_PLANO_UNICO = "2026-08-13T17:50:58Z";

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

async function validarUsuario(token, anonKey) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { "apikey": anonKey, "Authorization": `Bearer ${token}` }
  });
  if (!res.ok) return null;
  const user = await res.json();
  if (!user || !user.id) return null;
  return { id: user.id, createdAt: user.created_at || null };
}

async function lerPerfil(userId, serviceKey) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/perfil?user_id=eq.${userId}&select=plano,assinatura_status,ia_usos,ia_reset_em,admin`,
    { headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` } }
  );
  if (!res.ok) return null;
  const linhas = await res.json();
  return linhas[0] || null;
}

export const config = { maxDuration: 30 };

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
    const { texto, descricao, valor, tipo, categorias, token } = req.body || {};

    if (!texto || typeof texto !== "string" || !texto.trim()) {
      return res.status(400).json({ erro: "Escreva o que é esse lançamento." });
    }

    let usosInfo = null;

    if (serviceKey && anonKey) {
      if (!token || typeof token !== "string") {
        return res.status(401).json({ erro: "Sessão inválida. Faça login de novo." });
      }
      const usuario = await validarUsuario(token, anonKey);
      if (!usuario) {
        return res.status(401).json({ erro: "Sessão inválida. Faça login de novo." });
      }
      const userId = usuario.id;
      const antesDoPlanoUnico = !!usuario.createdAt &&
        new Date(usuario.createdAt).getTime() < new Date(CORTE_PLANO_UNICO).getTime();

      const perfil = await lerPerfil(userId, serviceKey);
      if (!perfil) {
        return res.status(403).json({ erro: "Perfil não encontrado." });
      }
      let plano = (perfil.assinatura_status === "ativa") ? perfil.plano : "basico";
      if (antesDoPlanoUnico) plano = "premium";
      if (plano !== "premium" && plano !== "master") {
        return res.status(403).json({ erro: "upgrade", motivo: "Esse recurso está disponível pra quem assina o FAZ Finanças." });
      }

      if (perfil.admin) {
        usosInfo = { usados: 0, limite: Infinity, plano, custoDesteUso: 0, admin: true };
      } else {
        const limite = LIMITES[plano];
        let usos = perfil.ia_usos || 0;
        let resetEm = perfil.ia_reset_em ? new Date(perfil.ia_reset_em) : new Date();
        const agora = new Date();

        if (usos >= limite) {
          const horasPassadas = (agora - resetEm) / (1000 * 60 * 60);
          if (horasPassadas >= HORAS_RECARGA) {
            usos = 0; resetEm = agora;
          } else {
            const faltam = Math.ceil(HORAS_RECARGA - horasPassadas);
            return res.status(429).json({
              erro: "limite", plano,
              motivo: `Você atingiu o limite de ${limite} usos. Serão liberados em aproximadamente ${faltam} hora(s).`
            });
          }
        }
        usos += CUSTO;
        await atualizarUso(userId, serviceKey, usos, resetEm.toISOString());
        usosInfo = { usados: usos, limite, plano, custoDesteUso: CUSTO };
      }
    }

    const listaCategorias = Array.isArray(categorias) ? categorias.filter(c => typeof c === "string" && c.trim()) : [];

    const systemPrompt = [
      "Você ajuda a categorizar UM lançamento financeiro num app brasileiro de finanças.",
      "A pessoa escreveu, com as próprias palavras, o que esse lançamento realmente é — use isso pra decidir a categoria certa.",
      "",
      listaCategorias.length
        ? `Categorias que já existem no app dela: ${listaCategorias.join(", ")}.`
        : "Ela ainda não tem nenhuma categoria própria criada.",
      "",
      "REGRAS:",
      "- Se alguma categoria da lista já descreve bem o que ela escreveu, use EXATAMENTE esse nome (não invente uma parecida) e devolva \"nova\": false.",
      "- Se nenhuma categoria existente encaixa bem, sugira o nome de uma categoria NOVA, curta (1-3 palavras, português, sem emoji) que resuma o que ela descreveu, e devolva \"nova\": true.",
      "- Nunca devolva 'Outros' como sugestão de categoria nova — se está tão genérico assim, prefira encaixar numa categoria existente mesmo que não seja perfeita.",
      "",
      "Responda APENAS com JSON válido, sem markdown:",
      '{ "categoria": "nome da categoria", "nova": true ou false }'
    ].join("\n");

    const contexto = [
      `O que ela escreveu: "${texto.trim().slice(0, 200)}"`,
      descricao ? `Descrição original do banco: "${String(descricao).slice(0, 200)}"` : "",
      valor != null ? `Valor: ${valor}` : "",
      tipo ? `Tipo: ${tipo === "entrada" ? "entrada/receita" : "gasto/despesa"}` : ""
    ].filter(Boolean).join("\n");

    const resposta = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 200,
        system: systemPrompt,
        messages: [{ role: "user", content: contexto }]
      })
    });

    const dados = await resposta.json();
    if (!resposta.ok) {
      console.error("Erro da API Anthropic (sugerir-categoria):", JSON.stringify(dados));
      return res.status(502).json({ erro: "Não foi possível pensar numa categoria agora." });
    }

    let bruto = (dados.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("")
      .trim();
    bruto = bruto.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

    let resultado;
    try {
      resultado = JSON.parse(bruto);
    } catch (e) {
      console.error("JSON inválido da IA (sugerir-categoria):", bruto.slice(0, 300));
      return res.status(502).json({ erro: "Não consegui entender a sugestão. Tente descrever de outro jeito." });
    }

    const categoria = String(resultado.categoria || "").trim().slice(0, 40);
    if (!categoria) {
      return res.status(502).json({ erro: "Não consegui sugerir uma categoria. Tente descrever de outro jeito." });
    }

    // Se a IA disse que é nova mas o nome bate com uma que já existe
    // (ignorando acento/caixa), trata como existente — evita duplicar.
    const jaExiste = listaCategorias.find(c => c.localeCompare(categoria, "pt-BR", { sensitivity: "base" }) === 0);

    return res.status(200).json({
      categoria: jaExiste || categoria,
      nova: !jaExiste && !!resultado.nova,
      usos: usosInfo
    });

  } catch (e) {
    console.error("Erro na função sugerir-categoria:", e);
    return res.status(500).json({ erro: "Erro ao sugerir categoria." });
  }
}

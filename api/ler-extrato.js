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

// Quanto cada leitura consome do limite de perguntas da IA.
// PDF e imagem custam bem mais que texto, por isso pesam mais.
const CUSTO_TEXTO = 2;
const CUSTO_ARQUIVO = 4;

const LIMITES = { premium: 25, master: 100 };
const HORAS_RECARGA_MASTER = 3;

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
    `${SUPABASE_URL}/rest/v1/perfil?user_id=eq.${userId}&select=plano,assinatura_status,ia_usos,ia_reset_em`,
    { headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` } }
  );
  if (!res.ok) return null;
  const linhas = await res.json();
  return linhas[0] || null;
}

/* Extratos grandes podem levar mais de 10s (o padrão da Vercel) para a IA
   ler e devolver. Damos mais tempo para não cortar no meio. */
export const config = { maxDuration: 60 };

/* Tenta consertar um JSON levemente quebrado vindo da IA.
   Cobre os casos comuns: resposta cortada no limite de tokens (JSON
   incompleto) e vírgulas sobrando. Devolve o objeto ou null se não deu. */
function repararJSON(texto) {
  if (!texto) return null;

  // Tentativa 1: remover vírgulas antes de } ou ]
  try {
    const limpo = texto.replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(limpo);
  } catch (e) {}

  // Tentativa 2: a resposta foi cortada no meio. Recupera os lançamentos
  // completos que já vieram, ignorando o pedaço truncado no final.
  try {
    const inicio = texto.indexOf('"lancamentos"');
    if (inicio === -1) return null;
    const abre = texto.indexOf("[", inicio);
    if (abre === -1) return null;

    // Varre o array pegando cada objeto {...} bem-formado
    const itens = [];
    let i = abre + 1, nivel = 0, ini = -1;
    for (; i < texto.length; i++) {
      const c = texto[i];
      if (c === "{") { if (nivel === 0) ini = i; nivel++; }
      else if (c === "}") {
        nivel--;
        if (nivel === 0 && ini !== -1) {
          try { itens.push(JSON.parse(texto.slice(ini, i + 1))); } catch (e) {}
          ini = -1;
        }
      } else if (c === "]" && nivel === 0) break;
    }
    if (itens.length) return { lancamentos: itens, duvidas: [], resumo: "" };
  } catch (e) {}

  return null;
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
    const { texto, arquivoBase64, tipoArquivo, token, hoje, titular, contas } = req.body || {};

    if (!texto && !arquivoBase64) {
      return res.status(400).json({ erro: "Envie o conteúdo do extrato." });
    }

    // ─── Controle de acesso e consumo do limite ───
    const custo = arquivoBase64 ? CUSTO_ARQUIVO : CUSTO_TEXTO;
    let usosInfo = null;

    // IMPORTANTE: se as chaves do Supabase existem, o token é OBRIGATÓRIO.
    // Antes, quem não mandasse "token" pulava essa checagem inteira e lia
    // extratos de graça e sem limite, mesmo sem login ou sem plano pago.
    if (serviceKey && anonKey) {
      if (!token || typeof token !== "string") {
        return res.status(401).json({ erro: "Sessão inválida. Faça login para usar esta função." });
      }
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

      const limite = LIMITES[plano];
      let usos = perfil.ia_usos || 0;
      let resetEm = perfil.ia_reset_em ? new Date(perfil.ia_reset_em) : new Date();
      const agora = new Date();

      if (plano === "master") {
        // Master: recarrega tudo depois de 3h quando zera
        if (usos >= limite) {
          const horasPassadas = (agora - resetEm) / (1000 * 60 * 60);
          if (horasPassadas >= HORAS_RECARGA_MASTER) {
            usos = 0; resetEm = agora;
          } else {
            const faltam = Math.ceil(HORAS_RECARGA_MASTER - horasPassadas);
            return res.status(429).json({
              erro: "limite", plano: "master",
              motivo: `Você atingiu o limite de ${limite} usos. Serão liberados em aproximadamente ${faltam} hora(s).`
            });
          }
        }
      } else {
        // Premium: limite mensal
        const mesReset = resetEm.getFullYear() * 100 + resetEm.getMonth();
        const mesAgora = agora.getFullYear() * 100 + agora.getMonth();
        if (mesAgora > mesReset) { usos = 0; resetEm = agora; }
      }

      // Precisa ter saldo suficiente para o custo desta leitura
      if (usos + custo > limite) {
        const restante = Math.max(0, limite - usos);
        return res.status(429).json({
          erro: "limite",
          plano,
          motivo: `Ler este extrato consome ${custo} do seu limite, mas você tem apenas ${restante} restante(s) neste período.`
        });
      }

      usos += custo;
      await atualizarUso(userId, serviceKey, usos, resetEm.toISOString());
      usosInfo = { usados: usos, limite, plano, custoDesteUso: custo };
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
      "- tipo: \"gasto\" para gastos/débitos, \"entrada\" para receitas/créditos. Use exatamente essas duas palavras.",
      "- Descrição: limpe o texto do banco deixando legível. Ex: 'PAG*IFOOD 4412' vira 'iFood'.",
      "- Ignore linhas que não são transações (saldo anterior, saldo final, cabeçalhos, totais).",
      `- Categorias possíveis: ${CATEGORIAS.join(", ")}. Para entradas, use \"Entrada\".`,
      "",
      "COMO CATEGORIZAR (use seu conhecimento de marcas e serviços brasileiros):",
      "- Alimentação: supermercados (Pão de Açúcar, Carrefour, Assaí, Extra), restaurantes, lanchonetes, padarias, iFood, Rappi, açougue, hortifruti, delivery de comida.",
      "- Transporte: Uber, 99, combustível (Shell, Ipiranga, Petrobras, posto), estacionamento, pedágio, metrô, ônibus, passagem, mecânico, oficina.",
      "- Moradia: aluguel, condomínio, conta de luz (Enel, CPFL), água (Sabesp), gás, internet residencial, IPTU, reforma, móveis, material de construção.",
      "- Saúde: farmácias (Drogasil, Raia, Pacheco, Drogaria), consultas, exames, plano de saúde, academia, dentista, ótica, terapia.",
      "- Lazer: cinema, streaming (Netflix, Spotify, Disney+, Prime, HBO), shows, bares, viagens, hotéis, jogos, parques, assinaturas de entretenimento.",
      "- Educação: escola, faculdade, cursos, livros, material escolar, Udemy, Alura, mensalidade, idiomas.",
      "- Serviços: assinaturas de software, telefonia (Vivo, Claro, Tim, Oi), seguros, serviços bancários, tarifas, cabeleireiro, lavanderia, profissionais autônomos.",
      "- Compras: roupas, calçados, eletrônicos, Amazon, Mercado Livre, Shopee, AliExpress, lojas de departamento, presentes, cosméticos.",
      "- Outros: SÓ quando realmente não se encaixa em nenhuma acima. Evite ao máximo usar 'Outros' — quase toda transação tem uma categoria melhor. Se reconhecer a marca ou o tipo de estabelecimento, use a categoria certa.",
      "",
      "IMPORTANTE SOBRE 'OUTROS': é a categoria de último recurso. Antes de usá-la, pense no que aquele estabelecimento vende. Um nome como 'DROGA RAIA' é Saúde, 'POSTO SHELL' é Transporte, 'NETFLIX' é Lazer. Só use 'Outros' se, mesmo pensando, não der para saber o ramo — e nesse caso prefira mandar para 'duvidas' e perguntar.",
      "ANTES de mandar algo para 'duvidas', esforce-se de verdade: nomes de banco costumam trazer o estabelecimento no meio de códigos (ex: 'PAG*IFOOD 4412' é iFood → Alimentação; 'MP *UBER' é Uber → Transporte; 'PICPAY*POSTO' é Posto → Transporte). Procure marcas e palavras conhecidas dentro da bagunça de códigos e maiúsculas. Reserve as dúvidas apenas para o que realmente não dá para deduzir.",
      "Quando MESMO ASSIM precisar perguntar, dê a MELHOR opção primeiro (seu palpite mais provável), mas sempre inclua 'Outros' entre as opções — e saiba que o app deixa o usuário abrir a lista completa se nenhuma servir. Nunca ofereça opções aleatórias: as 3-4 opções devem ser as mais plausíveis para AQUELE gasto.",
      "",
      "TRANSFERÊNCIAS ENTRE AS CONTAS DA PRÓPRIA PESSOA:",
      titular
        ? `- O titular deste extrato é "${titular}". Uma transferência (Pix, TED, DOC) enviada PARA ou recebida DE "${titular}" (ou variações desse mesmo nome) é dinheiro passando entre contas da MESMA pessoa — não é gasto nem receita de verdade.`
        : "- Transferências (Pix, TED, DOC) em que o remetente/destinatário é a MESMA pessoa dona do extrato são dinheiro passando entre contas próprias — não é gasto nem receita.",
      contas && contas.length ? `- As contas que a pessoa tem no app são: ${contas.join(", ")}. Se a transferência menciona uma dessas, é quase certo que é entre contas próprias.` : "",
      "- Quando identificar uma transferência assim, NÃO a classifique como gasto/entrada comum. Coloque em \"duvidas\" com o campo \"ehTransferenciaPropria\": true, pergunta explicando, e as opções [\"Sim, transferência entre minhas contas\", \"Não, é um gasto/recebimento normal\"]. Assim a pessoa confirma e escolhe a outra conta no app.",
      "- Transferências para OUTRAS pessoas (nomes diferentes do titular) são gastos/recebimentos normais — trate normalmente.",
      "",
      "QUANDO VOCÊ TIVER DÚVIDA:",
      "- Se não conseguir categorizar com segurança mesmo usando o guia acima, NÃO jogue em 'Outros'. Coloque o item em \"duvidas\" e pergunte.",
      "- Você também pode perguntar sobre QUALQUER outra coisa que te deixe insegura: uma data ambígua,",
      "  um valor que pode ser estorno, uma transferência que talvez não deva virar lançamento, uma",
      "  transação duplicada, etc. Use o campo \"pergunta\" para explicar em português claro e simples.",
      "- Em cada dúvida, ofereça de 2 a 4 opções curtas para o usuário escolher.",
      "",
      "FORMATO DA RESPOSTA (responda APENAS com JSON válido, sem markdown, sem cercas de código):",
      "{",
      '  "lancamentos": [',
      '    { "data": "2026-07-10", "descricao": "Supermercado Pão de Açúcar", "valor": 234.50, "tipo": "gasto", "categoria": "Alimentação" }',
      "  ],",
      '  "duvidas": [',
      '    { "data": "2026-07-12", "descricao": "PAG*JLM SERVICOS 4412", "valor": 89.90, "tipo": "gasto",',
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
      // A IA às vezes devolve JSON com pequenos defeitos (vírgula sobrando,
      // resposta cortada no limite de tokens). Tenta consertar antes de desistir.
      const reparado = repararJSON(bruto);
      if (reparado) {
        resultado = reparado;
        console.log("JSON reparado com sucesso");
      } else {
        console.error("JSON inválido da IA:", bruto.slice(0, 500));
        return res.status(502).json({ erro: "A IA não conseguiu organizar esse extrato. Tente um arquivo menor ou divida em partes." });
      }
    }

    // ── Sanitiza o que a IA devolveu ──
    // A IA às vezes coloca no campo "categoria" um texto que não é categoria
    // (ex: a própria pergunta que deveria ter feito: "Você me informa o motivo").
    // Toda categoria fora da lista oficial é rejeitada: o lançamento vira uma
    // DÚVIDA, para o usuário escolher a categoria nos botões — nunca salvamos
    // uma categoria inventada.
    const CATS_VALIDAS = new Set([...CATEGORIAS.map(c => c.toLowerCase()), "entrada"]);
    const lancBrutos = Array.isArray(resultado.lancamentos) ? resultado.lancamentos : [];
    const duvidasBrutas = Array.isArray(resultado.duvidas) ? resultado.duvidas : [];

    const lancamentosOk = [];
    lancBrutos.forEach(l => {
      if (!l || typeof l !== "object") return;
      const cat = String(l.categoria || "").trim();
      const ehEntrada = String(l.tipo || "").toLowerCase() === "entrada";
      if (ehEntrada) { l.categoria = "Entrada"; lancamentosOk.push(l); return; }
      if (cat && CATS_VALIDAS.has(cat.toLowerCase())) {
        lancamentosOk.push(l);
      } else {
        // Categoria inválida/inventada → vira dúvida com botões de categoria
        duvidasBrutas.push({
          data: l.data, descricao: l.descricao, valor: l.valor, tipo: l.tipo || "gasto",
          pergunta: "Em qual categoria esse gasto se encaixa?",
          opcoes: ["Alimentação", "Transporte", "Compras", "Outros"]
        });
      }
    });

    // Também limpa as dúvidas: a pergunta nunca pode virar categoria, e as
    // opções devem ser categorias de verdade.
    const duvidasOk = duvidasBrutas.filter(d => d && typeof d === "object").map(d => {
      // Dúvida de transferência própria: as opções são Sim/Não, não categorias.
      if (d.ehTransferenciaPropria) {
        return {
          ...d,
          opcoes: Array.isArray(d.opcoes) && d.opcoes.length === 2
            ? d.opcoes
            : ["Sim, transferência entre minhas contas", "Não, é um gasto/recebimento normal"]
        };
      }
      let opcoes = Array.isArray(d.opcoes) ? d.opcoes.filter(o => CATS_VALIDAS.has(String(o).toLowerCase())) : [];
      if (opcoes.length < 2) opcoes = ["Alimentação", "Transporte", "Compras", "Outros"];
      return { ...d, opcoes };
    });

    return res.status(200).json({
      lancamentos: lancamentosOk,
      duvidas:     duvidasOk,
      resumo:      resultado.resumo || "",
      usos:        usosInfo
    });

  } catch (e) {
    console.error("Erro na função ler-extrato:", e);
    return res.status(500).json({ erro: "Erro ao processar o extrato." });
  }
}
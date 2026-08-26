// api/_lerExtratoCore.js
// Motor de leitura de extrato — o prompt, a chamada à IA e a sanitização
// do resultado. Compartilhado entre api/ler-extrato.js (upload manual, no
// app) e api/receber-extrato-email.js (extrato encaminhado por e-mail):
// os dois precisam do EXATO mesmo comportamento, então isso mora num
// lugar só — mexeu aqui, mexeu nos dois caminhos ao mesmo tempo.
// Este arquivo não é uma rota (não tem "handler" nem exporta "config"),
// começa com "_" só pra deixar isso claro no diretório api/.

export const CATEGORIAS = [
  "Alimentação", "Transporte", "Moradia", "Saúde",
  "Lazer", "Educação", "Serviços", "Compras", "Outros"
];

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

/* Lê um extrato (texto OU arquivo em base64) e devolve
   { lancamentos, duvidas, resumo } já sanitizados, prontos pra tela de
   revisão. Lança erro (com .status opcional) se algo der errado — quem
   chama decide como responder. */
export async function lerExtratoCore({
  texto, arquivoBase64, tipoArquivo,
  dataHoje, titular, contas, categorias,
  apiKey
}) {
  dataHoje = dataHoje || new Date().toISOString().slice(0, 10);

  // Categorias do próprio usuário (fixas do espaço ativo + as que ele criou,
  // ex: "ADS"), além das 9 oficiais acima. Sem isso a IA nunca sabia que
  // essas existiam e chutava a categoria genérica mais parecida (ex: um
  // gasto com Facebook Ads virava "Lazer" em vez de "ADS").
  const categoriasUsuario = Array.isArray(categorias)
    ? [...new Set(
        categorias
          .map(c => String(c || "").trim())
          .filter(c => c && !CATEGORIAS.some(o => o.toLowerCase() === c.toLowerCase()))
      )]
    : [];

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
    "",
    "PDFS E FOTOS DE EXTRATO — cuidados extras (não se aplicam a CSV/OFX):",
    "- Extratos em PDF costumam ter uma coluna de SALDO ao lado de cada transação (saldo do dia, saldo após aquele lançamento). Essa coluna é só contexto — nunca vira lançamento próprio, mesmo que o número mude linha a linha.",
    "- PDF de várias páginas repete o cabeçalho da tabela (ex: 'Data | Histórico | Valor | Saldo') no topo de cada página nova — é o mesmo cabeçalho, não uma linha de dado; ignore todas as repetições, não só a primeira.",
    "- Alguns bancos mostram valor negativo entre parênteses (ex: '(150,00)') ou com o sinal depois do número (ex: '150,00-') em vez de um '-' na frente. Reconheça os dois formatos como valor negativo/gasto normalmente.",
    "- Extratos que juntam várias contas ou cartões num único PDF (ex: fatura de cartão com várias 'páginas' internas por portador, ou extrato consolidado com sub-blocos por conta) podem repetir o mesmo layout de tabela mais de uma vez no arquivo — leia todos os blocos, não só o primeiro.",
    "- Texto de rodapé, aviso legal, propaganda do banco ou número de ouvidoria impresso no extrato não é transação — ignore qualquer texto solto que não esteja dentro do formato de linha da tabela (data + descrição + valor).",
    "- Foto/scan de baixa qualidade: faça o possível pra ler cada linha mesmo com foto tremida, ângulo ruim ou brilho na página. Se uma linha específica estiver realmente ilegível (valor ou descrição cortados, embaçados demais pra ter certeza), NÃO invente o número nem descarte a linha silenciosamente — mande para \"duvidas\" pedindo pra pessoa confirmar ou digitar o valor certo. Perder uma transação por descartar é pior do que perguntar.",
    "",
    "- Taxas/impostos ligados a uma compra internacional (linhas como 'IOF Compra Internacional', 'Spread IOF Compra Internacional', 'IOF', 'Imposto sobre operação de câmbio') NÃO viram lançamento separado — são custo embutido da compra vizinha no extrato (geralmente aparecem logo antes/depois dela, mesma data/hora). Ignore essas linhas por completo (nem em \"lancamentos\", nem em \"duvidas\").",
    "- Pré-autorização de cartão revertida: quando aparece um crédito e um débito do MESMO valor, bem perto um do outro no tempo, com termos como 'AUTH HOLD', 'HOLD TEMPORARY', 'PENDING AUTHORIZATION', 'PRÉ-AUTORIZAÇÃO' — é uma reserva temporária que foi cancelada/liberada, dinheiro nenhum saiu ou entrou de verdade. Ignore o par inteiro (nem o crédito nem o débito viram lançamento).",
    "- Vendedor/serviço com grafia inconsistente no mesmo extrato (ex.: 'WWW.HOSTINGER.COM', 'hostingercom' e 'hostinger.com' na mesma pessoa) é o MESMO estabelecimento — normalize sempre para o mesmo nome limpo (ex.: 'Hostinger'), pra não espalhar o mesmo gasto em nomes diferentes.",
    `- Categorias possíveis: ${CATEGORIAS.join(", ")}. Para entradas, use \"Entrada\".`,
    categoriasUsuario.length
      ? `- ALÉM dessas, esta pessoa também tem categorias próprias criadas por ela: ${categoriasUsuario.join(", ")}. Se uma delas descrever o gasto MELHOR que as categorias oficiais acima, use a categoria dela — é a escolha certa nesse caso, não a genérica. Ex.: se ela tem uma categoria "ADS" e o gasto é com Facebook Ads/Google Ads/impulsionamento, use "ADS", não "Lazer" ou "Serviços".`
      : "",
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
    "- ATENÇÃO — transferência SEM nome de destinatário: bancos digitais e contas multimoeda (Wise, Nomad, PayPal, C6, Nubank etc.) costumam ter uma movimentação chamada \"Transferência interna\", \"Internal transfer\", \"Movimentação entre saldos/carteiras\", \"Conversão de saldo\" ou parecido — SEM mencionar nome nenhum. Isso é SEMPRE dinheiro se movendo entre saldos/moedas/carteiras da MESMA conta da própria pessoa (ex: do saldo em dólar pro saldo em real, ou de uma sub-carteira pra outra) — NUNCA é receita nem gasto de verdade, mesmo sem bater com o nome do titular ou com as contas do app. Trate do mesmo jeito: \"duvidas\" com \"ehTransferenciaPropria\": true. Preste atenção também na coluna \"Tipo de transação\" (ou parecida) do extrato — se disser algo como \"TRANSFERÊNCIA ENTRE CARTEIRAS\"/\"INTERNAL\"/\"WALLET\", é o mesmo caso.",
    "- Quando identificar uma transferência assim, NÃO a classifique como gasto/entrada comum. Coloque em \"duvidas\" com o campo \"ehTransferenciaPropria\": true, pergunta explicando, e as opções [\"Sim, transferência entre minhas contas\", \"Não, é um gasto/recebimento normal\"]. Assim a pessoa confirma e escolhe a outra conta no app.",
    "- Transferências para OUTRAS pessoas (nomes diferentes do titular) são gastos/recebimentos normais — trate normalmente.",
    "",
    "QUANDO VOCÊ TIVER DÚVIDA:",
    "- Se não conseguir categorizar com segurança mesmo usando o guia acima, NÃO jogue em 'Outros'. Coloque o item em \"duvidas\" e pergunte.",
    "- Você também pode perguntar sobre QUALQUER outra coisa que te deixe insegura: uma data ambígua,",
    "  um valor que pode ser estorno, uma transferência que talvez não deva virar lançamento, uma",
    "  transação duplicada, etc. Use o campo \"pergunta\" para explicar em português claro e simples.",
    "- Em cada dúvida, ofereça de 2 a 4 opções curtas para o usuário escolher — e as opções têm que combinar com a PERGUNTA: se a dúvida é sobre categoria, ofereça categorias; se é sobre outra coisa (é estorno? é duplicado? a data está certa?), ofereça as respostas certas pra ISSO (ex.: [\"É um estorno\", \"É uma transação real\"]) — nunca ofereça opções de categoria para uma pergunta que não é sobre categoria.",
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
    conteudoUsuario = [{ type: "text", text: "Leia este extrato e devolva o JSON conforme as regras:\n\n" + String(texto || "").slice(0, 60000) }];
  }

  // PDF/foto usa Sonnet (mais preciso em letra pequena, foto torta, tabela
  // bagunçada) — vale o custo maior porque é justamente o formato mais
  // difícil de ler direito. CSV/OFX/texto puro continua no Haiku: já vem
  // bem estruturado, não precisa do modelo mais caro.
  const modelo = arquivoBase64 ? "claude-sonnet-5" : "claude-haiku-4-5";

  const resposta = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: modelo,
      max_tokens: 12000,
      system: systemPrompt,
      messages: [{ role: "user", content: conteudoUsuario }]
    })
  });

  const dados = await resposta.json();

  if (!resposta.ok) {
    console.error("Erro da API Anthropic (lerExtratoCore):", JSON.stringify(dados));
    const erro = new Error("Não foi possível ler o extrato.");
    erro.status = 502;
    throw erro;
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
      const erro = new Error("A IA não conseguiu organizar esse extrato. Tente um arquivo menor ou divida em partes.");
      erro.status = 502;
      throw erro;
    }
  }

  // ── Sanitiza o que a IA devolveu ──
  // A IA às vezes coloca no campo "categoria" um texto que não é categoria
  // (ex: a própria pergunta que deveria ter feito: "Você me informa o motivo").
  // Toda categoria fora da lista oficial é rejeitada: o lançamento vira uma
  // DÚVIDA, para o usuário escolher a categoria nos botões — nunca salvamos
  // uma categoria inventada.
  const CATS_VALIDAS = new Set([
    ...CATEGORIAS.map(c => c.toLowerCase()),
    ...categoriasUsuario.map(c => c.toLowerCase()),
    "entrada"
  ]);
  const duvidasBrutas = Array.isArray(resultado.duvidas) ? resultado.duvidas : [];

  // ── Rede de segurança pra transferência interna ──
  // A instrução no prompt pede pra IA marcar isso como dúvida, mas o
  // modelo às vezes esquece e solta como gasto/entrada normal (visto ao
  // vivo: um "Transferência interna" virou -R$3.000 de gasto direto,
  // sem perguntar nada). Confiar só no prompt não é confiável o
  // suficiente — quem bater com esse padrão de descrição SEMPRE vira
  // dúvida aqui, não importa o que a IA decidiu.
  const REGEX_TRANSF_INTERNA = /transfer[eê]ncia\s*interna|internal\s*transfer|movimenta[cç][aã]o\s*entre\s*(saldos?|carteiras?)|entre\s*carteiras|wallet\s*transfer|convers[aã]o\s*de\s*saldo/i;

  const lancBrutos = [];
  (Array.isArray(resultado.lancamentos) ? resultado.lancamentos : []).forEach(l => {
    if (l && typeof l === "object" && REGEX_TRANSF_INTERNA.test(String(l.descricao || ""))) {
      duvidasBrutas.push({
        data: l.data, descricao: l.descricao, valor: l.valor, tipo: l.tipo || "gasto",
        ehTransferenciaPropria: true,
        pergunta: `Esta é uma transferência entre suas próprias contas/carteiras (mencionada como "${l.descricao}") ou um gasto/recebimento real?`,
        opcoes: ["Sim, é transferência entre minhas contas", "Não, é um gasto/recebimento normal"]
      });
    } else {
      lancBrutos.push(l);
    }
  });
  // Mesma trava pra quem a IA já mandou como dúvida, mas sem marcar
  // ehTransferenciaPropria (ou com opções de categoria erradas pra essa
  // pergunta).
  duvidasBrutas.forEach(d => {
    if (d && typeof d === "object" && !d.ehTransferenciaPropria && REGEX_TRANSF_INTERNA.test(String(d.descricao || ""))) {
      d.ehTransferenciaPropria = true;
      d.pergunta = `Esta é uma transferência entre suas próprias contas/carteiras (mencionada como "${d.descricao}") ou um gasto/recebimento real?`;
      d.opcoes = ["Sim, é transferência entre minhas contas", "Não, é um gasto/recebimento normal"];
    }
  });

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

  return {
    lancamentos: lancamentosOk,
    duvidas: duvidasOk,
    resumo: resultado.resumo || ""
  };
}

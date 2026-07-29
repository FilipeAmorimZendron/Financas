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
    const { pergunta, resumoFinanceiro, token, historico, acoes, extras, continuacao } = req.body || {};

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

      if (continuacao) {
        // Esta chamada é a volta de uma AÇÃO que a IA já executou — faz parte
        // da mesma pergunta, que já foi cobrada. Não conta de novo e não pode
        // esbarrar no limite, senão a ação aconteceria sem a IA confirmar.
        usosInfo = { usados: usos, limite: limite, plano: plano };
      } else if (plano === "master") {
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

      // Consome uma pergunta (só na primeira volta)
      if (!continuacao) {
        usos += 1;
        await atualizarUso(userId, serviceKey, usos, resetEm.toISOString());
        usosInfo = { usados: usos, limite: limite, plano: plano };
      }
    }

    // ─── Chama a IA ───
    const systemPrompt = [
      "Você é o Assistente FAZ, o assistente financeiro inteligente do app FAZ Finanças, um aplicativo brasileiro de finanças pessoais.",
      "Responda sempre em português do Brasil, de forma profissional, clara, acolhedora e fácil de entender.",
      "",
      "SUAS QUATRO FUNÇÕES:",
      "1) FAZER as coisas pelo usuário dentro do app, usando as ferramentas disponíveis (registrar um gasto, dar baixa numa conta, transferir, definir um limite).",
      "2) Responder sobre os dados financeiros do usuário (saldo, gastos, metas, investimentos, cartão, etc.).",
      "3) Explicar como usar o app FAZ Finanças (como fazer algo, onde fica cada funcionalidade, dúvidas sobre planos e pagamento).",
      "4) Dar conselhos financeiros úteis (como economizar, organizar, planejar).",
      "",
      "════ VOCÊ EXECUTA, NÃO SÓ ENSINA ════",
      "Quando o usuário PEDE PARA FAZER algo que você tem ferramenta, USE A FERRAMENTA. Nunca responda com um passo a passo de onde clicar para algo que você mesma pode fazer.",
      "- 'adiciona 500 de gasto no nubank' → use criar_lancamento. NÃO diga 'abra a aba Lançamentos'.",
      "- 'paguei a conta de luz' → use marcar_como_pago.",
      "- 'passa 200 da poupança pro nubank' → use criar_transferencia.",
      "- 'quero gastar no máximo 800 com alimentação' → use definir_limite.",
      "Preencha só o que o usuário disse. Se ele não disse a conta, a categoria ou a data, DEIXE O CAMPO VAZIO — o app resolve sozinho ou pergunta a ele em botões. Nunca invente a conta nem chute o valor.",
      "NÃO pergunte conta, categoria nem data numa mensagem de texto: quem pergunta isso é o app, com botões, e só quando precisa. A categoria de um gasto o app pergunta em botões coloridos — NUNCA peça para ele digitar a categoria.",
      "A ÚNICA coisa que você pergunta em texto antes de agir são: (a) o VALOR, quando ele não disser quanto foi; (b) para uma ENTRADA sem descrição, DE ONDE veio o dinheiro (salário? venda? presente?) — porque sem isso ele não vai entender esse lançamento depois. Ex: usuário diz 'adiciona entrada de 2500' → pergunte 'De onde veio essa entrada de R$ 2.500,00? (ex: salário, venda, freela)' e só chame a ferramenta depois que ele responder, pondo a resposta em descricao. Se ele já disse ('recebi 2500 de salário'), não pergunte nada.",
      "CUIDADO para não confundir O QUE foi o gasto com a CONTA de onde saiu. 'gastei 500 no mercado' → descricao 'Mercado', conta VAZIA. Só preencha a conta quando ele disser claramente de qual conta/banco saiu, com uma palavra tipo 'no', 'pelo', 'do', 'pela conta', 'no cartão' seguida do nome de um banco (ex: 'pelo Nubank', 'saiu do Itaú'). Nomes de banco podem parecer nome de loja (existe a conta 'Mercado Pago' e existe o 'mercado' onde se faz compras): na dúvida, deixe a conta VAZIA e deixe o app perguntar.",
      "Se ele pedir várias coisas de uma vez ('lança 50 de uber e 30 de almoço'), chame a ferramenta uma vez para cada, uma de cada vez.",
      "Depois que a ferramenta responder, confirme em UMA ou DUAS frases curtas, com o valor em negrito. Não repita a lista de campos nem explique como você fez. Se o resultado disser que não foi possível, explique o motivo com clareza e proponha a saída.",
      "Ensinar o caminho na tela continua certo para o que você NÃO tem ferramenta (cadastrar um banco novo, importar extrato, criar investimento). Nesses casos, explique o passo a passo normalmente.",
      "",
      "════ COMO O APP FAZ FINANÇAS FUNCIONA ════",
      "",
      "DASHBOARD (Visão geral): mostra o saldo total consolidado, entradas e gastos do mês, o total 'a pagar', um gráfico de evolução do saldo (1, 3, 6, 12 meses ou tudo), a lista 'Contas a pagar e receber' e os cartões de crédito. No topo há um sino de notificações com avisos de contas a vencer, faturas, metas estouradas e renovação da assinatura.",
      "",
      "CONTAS: onde o usuário cadastra suas contas e carteiras (Nubank, Itaú, carteira física, cripto, etc.), cada uma com saldo próprio. O saldo inicial deve ser o SALDO TOTAL do banco, contando tudo — inclusive caixinhas e reservas. Cada real deve ser contado uma única vez: se já incluiu as caixinhas no saldo, NÃO deve cadastrá-las de novo em Investimentos, senão conta em dobro. Cada conta pode ter uma DATA DE SALDO: lançamentos anteriores a essa data não afetam o saldo (servem só de histórico).",
      "",
      "CARTÃO DE CRÉDITO: é uma função da conta, não algo separado. Ao cadastrar ou editar um banco, marque 'Este banco tem cartão de crédito' e informe limite, dia de fechamento e dia de vencimento. Compras no crédito NÃO saem do saldo na hora — vão para a fatura. A fatura fecha no dia de fechamento e vence depois. Compras feitas após o fechamento caem na fatura do mês seguinte. Dá para parcelar: cada parcela entra na fatura de um mês. Pagar a fatura debita da própria conta do cartão e libera o limite. A tela do cartão mostra a fatura atual, o limite disponível e as próximas faturas.",
      "",
      "LANÇAMENTOS: onde registra entradas e gastos, em linguagem natural (ex: 'gastei 50 no mercado' ou '+1500 salário'). O app detecta valor, tipo e categoria sozinho. Dá para lançar vários de uma vez. Cada lançamento tem forma de pagamento (Débito, Crédito, Pix, Dinheiro) e situação ('Já pago' ou 'Agendar' para contas futuras). O Histórico tem busca e filtros por categoria, tipo e período, e botão de exportar. Também dá para IMPORTAR EXTRATO (CSV, OFX, PDF ou foto): a IA lê o arquivo, categoriza e mostra uma tela de revisão antes de salvar.",
      "",
      "TRANSFERÊNCIAS: move dinheiro entre contas próprias sem contar como receita ou gasto. A origem perde, o destino ganha, o saldo total não muda.",
      "",
      "GASTOS FIXOS (recorrências): contas que se repetem (aluguel, Netflix, salário). Cadastra uma vez e o app lança no dia definido. É também onde se criam e gerenciam as CATEGORIAS personalizadas.",
      "",
      "CATEGORIAS: além das que já vêm no app (Alimentação, Transporte, Moradia, Saúde, Lazer, Educação, Serviços, Compras, Outros), o usuário pode criar as próprias — como 'Luiz - meu filho' ou 'Pet' — com nome e cor. Cria pela opção '+ Criar categoria' em qualquer campo de categoria, ou pelo painel Categorias em Gastos Fixos, onde também renomeia e exclui. Ao excluir, os lançamentos antigos mantêm o nome.",
      "",
      "METAS: limite de gasto mensal por categoria. A barra fica amarela acima de 75% e vermelha quando estoura.",
      "",
      "INVESTIMENTOS: registra aplicações (CDB, Tesouro, ações, cripto) e mostra o valor atual e o rendimento. Usa o CDI real do Banco Central nos cálculos.",
      "",
      "PLANILHA: análise detalhada com filtros, gráficos por categoria e resumos.",
      "",
      "CONTA: perfil, avatar, plano e configurações.",
      "",
      "════ PLANOS E PAGAMENTO ════",
      "- BÁSICO (grátis): até 2 contas e 5 metas. Não inclui investimentos, gastos fixos, importar extrato, relatórios, exportar nem este assistente de IA.",
      "- PREMIUM (R$ 25,90/mês ou R$ 264,00/ano): contas e metas ilimitadas, investimentos, gastos fixos, importar extrato, relatórios, exportar e assistente de IA.",
      "- MASTER (R$ 47,90/mês ou R$ 488,40/ano): tudo do Premium mais conexão bancária automática (quando disponível).",
      "- O pagamento é por cartão de crédito, com renovação automática mensal ou anual. Se o cartão falhar, o acesso é mantido por alguns dias antes de cair, e o app avisa. Para assinar ou trocar de plano, vá em Conta e toque no plano.",
      "- Se perguntarem como cancelar, oriente a procurar o suporte pelo e-mail contato@fazfinancas.com.",
      "",
      "════ REGRAS IMPORTANTES ════",
      "- Você JÁ TEM os dados financeiros do usuário (abaixo). Nunca peça para ele enviar os dados. Use-os diretamente.",
      "- Os dados são uma fotografia do momento. Se ele disser que acabou de adicionar algo e você não vê, oriente-o a fechar e reabrir o chat para atualizar, em vez de dizer que não existe.",
      "- Nunca invente números que não estão nos dados. Se um dado não estiver lá, diga que ainda não foi registrado e explique como registrar.",
      "- Se perguntarem algo que um recurso pago resolve e o usuário está no Básico, explique como funciona e mencione que está nos planos Premium ou Master.",
      "- Você não é consultor financeiro certificado; para decisões grandes (grandes investimentos, dívidas complexas), sugira procurar um profissional.",
      "- Não fale sobre assuntos fora de finanças e do uso do app. Se perguntarem outra coisa, redirecione gentilmente.",
      "",
      "════ COMO PENSAR ANTES DE RESPONDER ════",
      "Você é a assistente financeira do usuário, não um robô que só lê números. Antes de responder:",
      "- ENTENDA GASTO PAGO vs CONTA A PAGAR. 'Gastos já pagos' é o que ele efetivamente gastou. 'Contas agendadas ainda não pagas' são compromissos futuros. Nunca troque um pelo outro. Se ele pergunta 'quanto gastei', use os gastos já pagos. Se pergunta 'quanto tenho a pagar', use as contas agendadas.",
      "- SE A PERGUNTA FOR AMBÍGUA, faça UMA pergunta curta de esclarecimento antes de responder, em vez de chutar. Ex: se ele diz 'quanto desses lançamentos?' logo após importar um extrato, e não está claro se quer o total gasto, o total do mês ou os pendentes, pergunte o que ele quer saber. Melhor esclarecer do que dar o número errado.",
      "- CONECTE OS DADOS. Se ele pergunta 'posso comprar algo de R$ 500?', não responda só o saldo — considere as contas a pagar que ainda vão sair, o quanto ele costuma gastar no mês, e responda como um conselheiro faria.",
      "- SEJA PROATIVA quando fizer sentido. Se perceber algo relevante (uma categoria que estourou a meta, um gasto muito acima do normal, uma fatura grande chegando), pode apontar — mas com moderação, sem encher.",
      "- Quando ele importar um extrato e perguntar sobre 'esses lançamentos' ou 'o extrato que enviei', olhe o bloco 'ÚLTIMO EXTRATO IMPORTADO' nos dados: ele traz quantos lançamentos entraram, o total de gastos e entradas, o período e a lista completa. Responda com esses números. NÃO diga que não consegue ver o extrato — a informação está ali.",
      "- VOCÊ TEM OS LANÇAMENTOS DIÁRIOS. Nos dados há o bloco 'Lançamentos dos últimos 30 dias (dia a dia)' com o que foi gasto e recebido em cada dia, com a lista detalhada. Se ele perguntar 'quanto gastei no dia 26?', 'e ontem?', 'quanto foi terça?', PROCURE aquele dia nesse bloco e responda com o valor e os lançamentos. NUNCA mande o usuário 'ir em Lançamentos', 'usar o filtro' ou 'consultar no app' para uma data dos últimos 30 dias — você tem o dado, responda direto.",
      "- Só oriente a olhar no app se a informação realmente não estiver nos dados (ex: um dia de mais de 30 dias atrás). E mesmo aí, dê primeiro o que você souber (o total daquele mês, por exemplo).",
      "- Trate cada pergunta no contexto da conversa. Se ele já perguntou algo antes, leve em conta.",
      "",
      "════ FORMATO DAS RESPOSTAS ════",
      "- Adapte o tamanho à pergunta. Perguntas simples ('qual meu saldo?') merecem 1 a 2 frases. Perguntas de análise ('onde gastei mais?', 'como está meu mês?') merecem resposta organizada.",
      "- Use formatação simples: **negrito** para valores e pontos-chave (ex: **R$ 1.500,00**); listas começando a linha com '- '; para categoria/valor use '- 🍽️ Alimentação: R$ 1.240,00'; títulos curtos terminados em dois-pontos numa linha sozinha; linha em branco entre blocos.",
      "- Emojis com MODERAÇÃO, só para identificar categorias em listas (🍽️ alimentação, 🚗 transporte, 🏠 moradia, 💊 saúde, 🎉 lazer, 📚 educação, 🔧 serviços, 🛍️ compras, 💰 entrada, 💳 cartão). Nunca no meio de frases.",
      "- Só formate quando deixa mais claro. Resposta curta não precisa de listas nem títulos.",
      "- Valores sempre no formato brasileiro (R$ 1.500,00), principais em negrito.",
      "- Não use tabelas, cabeçalhos com # nem blocos de código. Apenas negrito, listas com hífen e títulos curtos.",
      resumoFinanceiro
        ? `\n\nDADOS FINANCEIROS ATUAIS DO USUÁRIO:\n${resumoFinanceiro}`
        : "\n\n(O usuário ainda não tem dados financeiros registrados no app. Oriente-o a começar cadastrando uma conta e alguns lançamentos.)"
    ].join("\n");

    // Monta as mensagens com o histórico da conversa, para a IA ter memória
    // do que já foi dito. Limita às últimas trocas para não pesar.
    const mensagens = [];
    if (Array.isArray(historico)) {
      historico.slice(-8).forEach(msg => {
        if (msg && (msg.role === "user" || msg.role === "assistant") && typeof msg.content === "string" && msg.content.trim()) {
          mensagens.push({ role: msg.role, content: msg.content.slice(0, 2000) });
        }
      });
    }
    mensagens.push({ role: "user", content: pergunta });

    // Voltas anteriores desta MESMA pergunta: o que a IA pediu para fazer e o
    // que o app respondeu depois de fazer. Sem isso ela não sabe o resultado.
    const TIPOS_OK = ["text", "tool_use", "tool_result"];
    if (Array.isArray(extras)) {
      extras.slice(-12).forEach(msg => {
        if (!msg || (msg.role !== "user" && msg.role !== "assistant")) return;
        if (!Array.isArray(msg.content)) return;
        const blocos = msg.content.filter(b => b && TIPOS_OK.includes(b.type));
        if (blocos.length) mensagens.push({ role: msg.role, content: blocos });
      });
    }

    // Ferramentas: o app manda o que ele sabe fazer. Quem executa é o app —
    // aqui só repassamos a lista para a IA poder escolher.
    let ferramentas = null;
    if (Array.isArray(acoes) && acoes.length) {
      ferramentas = acoes.slice(0, 20).map(a => ({
        name: String(a.nome || "").slice(0, 64),
        description: String(a.descricao || "").slice(0, 1200),
        input_schema: (a.parametros && typeof a.parametros === "object")
          ? a.parametros
          : { type: "object", properties: {} }
      })).filter(f => /^[a-zA-Z0-9_-]+$/.test(f.name));
      if (!ferramentas.length) ferramentas = null;
    }

    const corpo = {
      model: "claude-haiku-4-5",
      max_tokens: 700,
      system: systemPrompt,
      messages: mensagens
    };
    if (ferramentas) corpo.tools = ferramentas;

    const resposta = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(corpo)
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

    // A IA quer FAZER algo: devolvemos o pedido para o app executar e voltar
    // aqui com o resultado. O conteúdo cru vai junto porque a próxima volta
    // precisa reapresentá-lo à IA exatamente como veio.
    const pedido = (dados.content || []).find(b => b.type === "tool_use");
    if (pedido) {
      return res.status(200).json({
        resposta: texto,
        acao: { id: pedido.id, nome: pedido.name, dados: pedido.input || {} },
        conteudoIA: dados.content,
        usos: usosInfo
      });
    }

    return res.status(200).json({
      resposta: texto || "Não consegui gerar uma resposta.",
      usos: usosInfo
    });

  } catch (e) {
    console.error("Erro na função chat-ia:", e);
    return res.status(500).json({ erro: "Erro ao processar a pergunta." });
  }
}
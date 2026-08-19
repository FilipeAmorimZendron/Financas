// api/chat-ia.js
// Função serverless que conversa com a API da Anthropic (Claude).
// Faz o controle de limite de uso da IA por plano (verificação no servidor):
//   - Plano único: 100 perguntas; ao zerar, recarrega tudo após 3 horas.
//   - "premium" e "master" valem o mesmo limite — não existe mais
//     diferença de plano, os dois nomes só continuam por causa de
//     assinantes antigos que já têm um desses valores gravados no perfil.

const SUPABASE_URL = "https://yuvhkrwksdnajfautkru.supabase.co";

const LIMITES = {
  premium: 100,
  master: 100
};
const HORAS_RECARGA = 3;

// Mesma data de corte do plano único usada em app.js (usuarioAnteriorAoPlanoUnico).
// Quem já tinha conta antes disso mantém acesso completo de graça — inclusive
// à IA — mesmo com plano="basico"/assinatura inativa gravados no perfil.
const CORTE_PLANO_UNICO = "2026-08-13T17:50:58Z";

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

// Valida o token do usuário e devolve o id + data de criação da conta
// (não dá pra falsificar — vem direto do Supabase Auth).
async function validarUsuario(token, anonKey) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      "apikey": anonKey,
      "Authorization": `Bearer ${token}`
    }
  });
  if (!res.ok) return null;
  const user = await res.json();
  if (!user || !user.id) return null;
  return { id: user.id, createdAt: user.created_at || null };
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
    // IMPORTANTE: se as chaves do Supabase existem, o token é OBRIGATÓRIO.
    // Antes, quem não mandasse "token" pulava essa checagem inteira e usava
    // a IA de graça e sem limite, mesmo sem login ou sem plano pago.
    let usosInfo = null;
    if (serviceKey && anonKey) {
      if (!token || typeof token !== "string") {
        return res.status(401).json({ erro: "Sessão inválida. Faça login para usar o assistente." });
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
      // Conta de antes da virada pro plano único: acesso garantido, mesmo
      // sem assinatura paga gravada no perfil.
      if (antesDoPlanoUnico) plano = "premium";

      // Básico (sem assinatura ativa, e não é conta anterior ao plano único)
      if (plano !== "premium" && plano !== "master") {
        return res.status(403).json({ erro: "upgrade", motivo: "O assistente de IA está disponível pra quem assina o FAZ Finanças." });
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
      } else if (usos >= limite) {
        // Cota zerou: só libera de novo depois de HORAS_RECARGA horas
        const horasPassadas = (agora - resetEm) / (1000 * 60 * 60);
        if (horasPassadas >= HORAS_RECARGA) {
          usos = 0;
          resetEm = agora;
        } else {
          const faltam = Math.ceil(HORAS_RECARGA - horasPassadas);
          return res.status(429).json({
            erro: "limite",
            plano: plano,
            motivo: `Você atingiu o limite de ${limite} perguntas. Suas próximas perguntas são liberadas em aproximadamente ${faltam} hora(s).`
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
      "Responda sempre em português do Brasil: direta, objetiva e clara. Vá direto ao ponto — sem saudação, sem frase de abertura, sem gentileza que não carrega informação (nada de 'claro!', 'ótima pergunta', 'fico feliz em ajudar'). Comece já pela resposta.",
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
      "- 'gasto de 50 no nubank' → o valor é 50, a conta é Nubank. Chame criar_lancamento com valor 50 e conta Nubank, descrição vazia. NÃO pergunte 'o que custou 50' nem 'o que você comprou'.",
      "- 'uber' (sem valor) → aí sim pergunte: 'Quanto custou esse Uber?'. Só neste caso, porque não veio número.",
      "- 'paguei a conta de luz' → use marcar_como_pago.",
      "- 'passa 200 da poupança pro nubank' → use criar_transferencia.",
      "- 'quero gastar no máximo 800 com alimentação' → use definir_limite.",
      "- 'quero juntar 2500 pra um tênis até dezembro' → use criar_objetivo (é uma meta de poupança, não um gasto).",
      "- 'meu aluguel é 1500 todo dia 10' ou 'adiciona a Netflix como gasto fixo' → use criar_recorrencia (repete sozinho todo mês). NÃO use criar_lancamento com 'agendar' para algo que se repete: agendar cria UMA conta futura única; gasto fixo cria a regra que se repete todo mês. Se ele disser 'fixo', 'mensal', 'todo mês', 'assinatura', 'toda semana', é criar_recorrencia.",
      "- 'cria um banco Nubank com 500' ou 'adiciona minha carteira' → use criar_banco (cadastra a conta com o saldo atual). Se ele não disser o saldo, pergunte quanto tem hoje nela (aceite zero).",
      "- 'muda aquele gasto do mercado pra 80 reais' ou 'troca a categoria do Uber pra Transporte' → use editar_lancamento. Preencha só o que ele quer mudar (novoValor, novaDescricao, novaCategoria ou novaData) — nunca os campos que ele não mencionou.",
      "- 'apaga o gasto de 50 no mercado' ou 'remove aquele lançamento do Uber' → use excluir_lancamento. Se houver mais de um parecido, o app pergunta em botões qual é — você não escolhe por ele.",
      "- 'paga a fatura do Nubank' ou 'quita a fatura do cartão' → use pagar_fatura_cartao.",
      "- 'aplica 500 num CDB a 110% do CDI' ou 'comprei 0.001 de bitcoin' ou 'investi 1000 no tesouro selic' → use registrar_investimento. Renda fixa (exceto Poupança) precisa da taxa contratada — se ele não disse, use perguntar_opcoes (não pergunte em texto livre).",
      "- 'exclui o investimento em bitcoin' ou 'apaga aquele CDB' ou 'remove o investimento X' → use excluir_investimento. Se houver mais de um parecido, o app pergunta em botões qual é — você não escolhe por ele.",
      "- Precisa de uma informação curta do usuário e consegue sugerir de 2 a 4 respostas prováveis (o que foi um gasto, de onde veio uma entrada, a taxa de um investimento) → use perguntar_opcoes, NUNCA pergunte isso numa mensagem de texto solta. É a única exceção à regra de nunca perguntar 'o que você comprou': se você mesma decidir que precisa saber, pergunte com botões, nunca em texto livre. IMPORTANTE: quando chamar perguntar_opcoes, não escreva NENHUM texto de resposta nessa mesma mensagem (nem repita a pergunta em frase solta) — os botões com a pergunta já aparecem sozinhos, escrever texto também deixaria a pergunta duplicada na tela.",
      "Preencha só o que o usuário disse. Se ele não disse a conta, a categoria ou a data, DEIXE O CAMPO VAZIO — o app resolve sozinho ou pergunta a ele em botões. Nunca invente a conta nem chute o valor.",
      "REGRA DE FERRO SOBRE O VALOR: se o usuário JÁ DISSE um número ('gasto de 50', 'gastei 50', '50 no nubank'), o valor é esse número — NUNCA pergunte 'quanto custou' de novo. Só pergunte o valor quando ele NÃO deu número nenhum ('uber', 'comprei um lanche') — esse é o único caso em que uma pergunta de texto livre é aceitável, porque não há como sugerir opções pra um valor em reais. Nunca invente um valor.",
      "PARA UM GASTO, você NÃO precisa saber o que foi. Se ele deu o valor mas não disse o que comprou ('gasto de 50 no nubank'), o normal é chamar criar_lancamento direto com o valor, deixando a descrição vazia — o app pergunta a categoria e a forma em botões, e isso basta. Só pergunte o que foi se você realmente achar que ajuda (ex: pra não virar um lançamento genérico) — e nesse caso use perguntar_opcoes com sugestões (ex: Mercado, Uber, Farmácia, Restaurante), NUNCA como texto livre tipo 'o que você comprou?'.",
      "NÃO pergunte conta, categoria, forma de pagamento nem parcelas numa mensagem de texto: o app pergunta tudo isso em botões, na hora certa. Se ele não disse a forma de pagamento, deixe o campo 'forma' VAZIO — o app oferece Débito, Crédito, Pix e Dinheiro em botões, e se ele escolher Crédito, o app ainda pergunta à vista ou parcelado e em quantas vezes. Você não precisa cuidar disso.",
      "Para uma ENTRADA sem origem, você PRECISA saber de onde veio o dinheiro (salário? venda? presente?) — um lançamento 'Entrada' sem nome fica impossível de entender depois. Use perguntar_opcoes com texto tipo 'De onde veio essa entrada de R$ 2.500,00?' e opções como ['Salário', 'Venda', 'Freela', 'Presente'] — NUNCA pergunte isso em texto livre. Só depois de ter a resposta, chame criar_lancamento com ela na descrição.",
      "Resumindo o que dá pra perguntar antes de agir: (a) em TEXTO livre, só o VALOR de um gasto/entrada quando ele não deu número nenhum (não há como sugerir opções pra isso); (b) com perguntar_opcoes (botões), qualquer outra coisa que precise de uma resposta curta com alternativas prováveis — origem de uma entrada, o que foi um gasto, taxa de um investimento. Nunca pergunte em texto livre algo que dá pra sugerir em botões.",
      "CUIDADO para não confundir O QUE foi o gasto com a CONTA de onde saiu. 'gastei 500 no mercado' → descricao 'Mercado', conta VAZIA. Só preencha a conta quando ele disser claramente de qual conta/banco saiu, com uma palavra tipo 'no', 'pelo', 'do', 'pela conta', 'no cartão' seguida do nome de um banco (ex: 'pelo Nubank', 'saiu do Itaú'). Nomes de banco podem parecer nome de loja (existe a conta 'Mercado Pago' e existe o 'mercado' onde se faz compras): na dúvida, deixe a conta VAZIA e deixe o app perguntar.",
      "Se ele pedir várias coisas de uma vez ('lança 50 de uber e 30 de almoço'), chame a ferramenta uma vez para cada, uma de cada vez.",
      "Depois que a ferramenta responder, SEMPRE escreva uma confirmação em UMA frase curta e factual, com o valor em negrito — sem saudação, sem elogio, só o fato (ex: '**R$ 50,00** registrado no Nubank.'). Nunca fique em silêncio depois de uma ação. Não repita a lista de campos nem explique como você fez. Se o resultado disser que não foi possível, diga o motivo em uma frase e proponha a saída, sem rodeio.",
      "REGRA DE FERRO SOBRE CONFIRMAR AÇÃO: NUNCA diga que algo foi feito, excluído, salvo, editado ou alterado se você não chamou a ferramenta correspondente NESSA MESMA resposta e ela não devolveu sucesso. Dizer 'excluído' ou 'feito' sem ter chamado a ferramenta é mentir pro usuário — ele vai achar que resolveu e na real nada mudou. Se o pedido dele não tem ferramenta correspondente na lista que você recebeu, diga claramente que ainda não consegue fazer isso pelo chat e explique o caminho na tela — nunca finja que fez.",
      "",
      "════ ANTES DE CHAMAR UMA FERRAMENTA, CONFIRA ════",
      "Releia o pedido uma vez antes de agir. Três erros derrubam a confiança do usuário — não cometa nenhum:",
      "1) VALOR: é exatamente o número que a pessoa escreveu, sem arredondar, converter ou inventar. Se ela não deu número nenhum, o campo fica vazio e você pergunta (não chuta).",
      "2) CONTA: só preencha se ela citou um banco/carteira explicitamente (com 'no', 'do', 'pelo' + nome do banco). Nome de loja não é conta. Na dúvida, vazio.",
      "3) FERRAMENTA CERTA: não troque criar_lancamento (gasto/entrada avulsa) por criar_recorrencia (só quando ela disser 'fixo', 'todo mês', 'assinatura'), nem criar_objetivo (meta de poupança) por definir_limite (teto de gasto por categoria), nem editar/excluir_lancamento por marcar_como_pago (essa é só pra dar baixa numa conta agendada) — são coisas diferentes mesmo quando a frase é parecida.",
      "Ensinar o caminho na tela continua certo para o que você NÃO tem ferramenta (importar extrato, trocar a conta/forma de pagamento de um lançamento, editar um banco, pausar um gasto fixo). Nesses casos, explique o passo a passo normalmente.",
      "",
      "════ COMO O APP FAZ FINANÇAS FUNCIONA ════",
      "",
      "DASHBOARD (Visão geral): mostra o saldo total consolidado, entradas e gastos do mês, o total 'a pagar', um gráfico de evolução do saldo (1, 3, 6, 12 meses ou tudo), a lista 'Contas a pagar e receber' e os cartões de crédito. No topo há um sino de notificações com avisos de contas a vencer, faturas, metas estouradas e renovação da assinatura.",
      "",
      "CONTAS: onde o usuário cadastra suas contas e carteiras (Nubank, Itaú, carteira física, cripto, etc.), cada uma com saldo próprio. O saldo inicial deve ser o SALDO TOTAL do banco, contando tudo — inclusive caixinhas e reservas. Cada real deve ser contado uma única vez: se já incluiu as caixinhas no saldo, NÃO deve cadastrá-las de novo em Investimentos, senão conta em dobro. Cada conta pode ter uma DATA DE SALDO: lançamentos anteriores a essa data não afetam o saldo (servem só de histórico).",
      "",
      "CARTÃO DE CRÉDITO: é uma função da conta, não algo separado. Ao cadastrar ou editar um banco, marque 'Este banco tem cartão de crédito' e informe limite, dia de fechamento e dia de vencimento. Compras no crédito NÃO saem do saldo na hora — vão para a fatura. A fatura fecha no dia de fechamento e vence depois. Compras feitas após o fechamento caem na fatura do mês seguinte. Dá para parcelar: cada parcela entra na fatura de um mês. Pagar a fatura debita da própria conta do cartão e libera o limite — você pode fazer isso pelo chat, com pagar_fatura_cartao. A tela do cartão mostra a fatura atual, o limite disponível e as próximas faturas.",
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
      "INVESTIMENTOS: registra aplicações (CDB, Tesouro, ações, cripto) e mostra o valor atual e o rendimento. Usa o CDI real do Banco Central nos cálculos. Você pode registrar um investimento pelo chat, com registrar_investimento — o valor aplicado não desconta o saldo de nenhuma conta, é só um registro de acompanhamento.",
      "",
      "PLANILHA: análise detalhada com filtros, gráficos por categoria e resumos.",
      "",
      "CONTA: perfil, avatar, plano e configurações.",
      "",
      "════ PLANO E PAGAMENTO ════",
      "- O FAZ Finanças tem um plano único: R$ 26,90/mês, com tudo incluso — contas, metas e lançamentos ilimitados, investimentos, gastos fixos, importar extrato, relatórios, exportar e este assistente de IA. Com o cupom de desconto ORGANIZACAO (aplicado no cadastro ou na tela de assinatura), o valor cai para R$ 20,90/mês.",
      "- Assinantes de antes dessa mudança de preço podem ver um valor diferente (R$ 37,90, R$ 27,90 ou outro) — é o preço em que eles entraram, mantido normalmente; não é erro nem cobrança indevida.",
      "- O pagamento é por cartão de crédito, com renovação automática mensal. Se o cartão falhar, o acesso é mantido por alguns dias antes de cair, e o app avisa.",
      "- Se perguntarem como cancelar, explique que é dentro do app (em Conta) e que o acesso continua até o fim do período já pago. Se precisarem de ajuda, oriente a procurar o suporte pelo e-mail suporte@fazfinancas.com.",
      "",
      "════ REGRAS IMPORTANTES ════",
      "- Você JÁ TEM os dados financeiros do usuário (abaixo). Nunca peça para ele enviar os dados. Use-os diretamente.",
      "- Os dados são uma fotografia do momento. Se ele disser que acabou de adicionar algo e você não vê, oriente-o a fechar e reabrir o chat para atualizar, em vez de dizer que não existe.",
      "- Nunca invente números que não estão nos dados. Se um dado não estiver lá, diga que ainda não foi registrado e explique como registrar.",
      "- Você não é consultor financeiro certificado; para decisões grandes (grandes investimentos, dívidas complexas), sugira procurar um profissional.",
      "- Não fale sobre assuntos fora de finanças e do uso do app. Se perguntarem outra coisa, redirecione gentilmente.",
      "",
      "════ COMO PENSAR ANTES DE RESPONDER ════",
      "Você é a assistente financeira do usuário, não um robô que só lê números. Antes de responder:",
      "- ENTENDA GASTO PAGO vs CONTA A PAGAR. 'Gastos já pagos' é o que ele efetivamente gastou. 'Contas agendadas ainda não pagas' são compromissos futuros. Nunca troque um pelo outro. Se ele pergunta 'quanto gastei', use os gastos já pagos. Se pergunta 'quanto tenho a pagar', use as contas agendadas.",
      "- COMPRA NO CRÉDITO NÃO É GASTO DO MÊS AINDA. 'Gastos já pagos' e 'Gastos por categoria' JÁ excluem compras no cartão de crédito — elas só viram gasto de verdade quando a fatura é paga. Enquanto isso, elas aparecem separadas em 'Cartões de crédito', como 'fatura em aberto'. Se o usuário perguntar quanto gastou no mês, use só 'Gastos já pagos' — não some a fatura em aberto a esse número, e não se surpreenda se o total parecer baixo: é porque o cartão está à parte, exatamente como no card 'Gastos' do dashboard.",
      "- SE A PERGUNTA FOR AMBÍGUA, faça UMA pergunta curta de esclarecimento antes de responder, em vez de chutar. Ex: se ele diz 'quanto desses lançamentos?' logo após importar um extrato, e não está claro se quer o total gasto, o total do mês ou os pendentes, pergunte o que ele quer saber. Melhor esclarecer do que dar o número errado.",
      "- CONECTE OS DADOS. Se ele pergunta 'posso comprar algo de R$ 500?', não responda só o saldo — considere as contas a pagar que ainda vão sair, o quanto ele costuma gastar no mês, e responda como um conselheiro faria.",
      "- SEJA PROATIVA quando fizer sentido. Se perceber algo relevante (uma categoria que estourou a meta, um gasto muito acima do normal, uma fatura grande chegando), pode apontar — mas com moderação, sem encher.",
      "- Quando ele importar um extrato e perguntar sobre 'esses lançamentos' ou 'o extrato que enviei', olhe o bloco 'ÚLTIMO EXTRATO IMPORTADO' nos dados: ele traz quantos lançamentos entraram, o total de gastos e entradas, o período e a lista completa. Responda com esses números. NÃO diga que não consegue ver o extrato — a informação está ali.",
      "- VOCÊ TEM OS LANÇAMENTOS DIÁRIOS. Nos dados há o bloco 'Lançamentos dos últimos 30 dias (dia a dia)' com o que foi gasto e recebido em cada dia, com a lista detalhada. Se ele perguntar 'quanto gastei no dia 26?', 'e ontem?', 'quanto foi terça?', PROCURE aquele dia nesse bloco e responda com o valor e os lançamentos. NUNCA mande o usuário 'ir em Lançamentos', 'usar o filtro' ou 'consultar no app' para uma data dos últimos 30 dias — você tem o dado, responda direto.",
      "- Só oriente a olhar no app se a informação realmente não estiver nos dados (ex: um dia de mais de 30 dias atrás). E mesmo aí, dê primeiro o que você souber (o total daquele mês, por exemplo).",
      "- Trate cada pergunta no contexto da conversa. Se ele já perguntou algo antes, leve em conta.",
      "",
      "════ FORMATO DAS RESPOSTAS ════",
      "- Priorize a resposta mais curta que resolve. Perguntas simples ('qual meu saldo?') merecem UMA frase com o número, sem introdução. Perguntas de análise ('onde gastei mais?', 'como está meu mês?') merecem no máximo 4-5 linhas de lista + 1 frase de conclusão — ainda sem enrolação, vá direto aos dados.",
      "- Nunca abra a resposta explicando o que você vai fazer ('vou verificar', 'deixa eu olhar'). Já responda com o dado.",
      "- Corte palavras de enchimento ('é importante notar que', 'vale lembrar que', 'de forma geral'). Cada frase carrega uma informação; se não carrega, corta.",
      "- Não repita a pergunta do usuário antes de responder, e não feche com um resumo do que você acabou de dizer.",
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
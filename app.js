/* ============================================================
   FINANÇAS PESSOAIS — app.js  v9  (Supabase)
   ============================================================ */

/* ─── Configuração Supabase ──────────────────────────────── */
const SUPABASE_URL = "https://yuvhkrwksdnajfautkru.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1dmhrcndrc2RuYWpmYXV0a3J1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NTIzNDMsImV4cCI6MjA5OTUyODM0M30.zAC5KLy79NTd8LdNiYNIKJyg-Jik3mtm8HEsgM_jg9g";

/* ============================================================
   SEGURANÇA — escape de HTML
   TODO dado que vem do usuário e vai para innerHTML PRECISA
   passar por aqui. Sem isso, um nome como
   <img src=x onerror="roubar()"> executa código no navegador.
   ============================================================ */
function esc(v) {
  if (v == null) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const _h = { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };

/* ─── Estado em memória ──────────────────────────────────── */
const state = {
  bancos: [], movimentos: [], transferencias: [], recorrencias: [], metas: [],
  faturasPagas: [], categorias: [],
  objetivos: [], investimentos: [], recPagamentos: [],
  notasFiscais: [],   // só usado no espaço Empresarial — ver TABELAS_COM_CONTEXTO
  contatos: [],       // clientes e fornecedores — idem
  // Extratos que chegaram por e-mail (encaminhados pra extrato@...) e
  // ainda não foram revisados — ver verificarExtratosPorEmail() e
  // api/receber-extrato-email.js. Populado uma vez no carregamento.
  extratosEmailPendentes: [],
  perfil: { avatarTipo: "inicial", avatarPadrao: null, avatarUrl: null, nome: null },
  user: null,
  // true quando o espaço que NÃO está ativo agora tem algo vencido ou
  // vencendo — acende a bolinha vermelha no seletor da sidebar. Ver
  // haCompromissoPendente() e atualizarSeletorContexto().
  avisoOutroContexto: false,
  // "pessoal" ou "empresarial" — qual espaço financeiro está ativo agora.
  // Ver alternarContexto() e TABELAS_COM_CONTEXTO.
  contextoAtivo: (() => {
    try { return localStorage.getItem("fp_contexto") === "empresarial" ? "empresarial" : "pessoal"; }
    catch (e) { return "pessoal"; }
  })()
};

/* ── DIAGNÓSTICO TEMPORÁRIO (v53) ──────────────────────────
   Investigando um bug relatado: depois de importar um extrato,
   "contas" fantasmas (nome vazio, tipo "gasto"/"entrada" — cara de
   lançamento, não de conta) aparecem em state.bancos só na memória
   do navegador (nunca gravam no banco, somem com F5). Não achei o
   ponto exato revisando o código à mão, então isso aqui grava um log
   no localStorage (sobrevive a F5!) no instante em que state.bancos
   crescer de um jeito suspeito, com a pilha de chamadas de onde veio.
   Não muda nenhum comportamento do app — é só um alarme.
   Remover depois de achar a causa. */
(function instalarDiagnosticoBancos() {
  const pareceMovimento = (o) => o && typeof o === "object" && "descricao" in o && !("nome" in o);
  const armar = (arr) => {
    const origPush = arr.push.bind(arr);
    arr.push = function (...args) {
      const antes = arr.length;
      const r = origPush(...args);
      if (args.length > 3 || args.some(pareceMovimento)) {
        try {
          localStorage.setItem("fp_debug_bancos", JSON.stringify({
            quando: new Date().toISOString(), tipo: "push",
            antes, depois: arr.length, args: args.slice(0, 3),
            stack: new Error().stack
          }));
        } catch (e) {}
      }
      return r;
    };
    return arr;
  };
  let _real = armar(state.bancos);
  Object.defineProperty(state, "bancos", {
    enumerable: true,
    configurable: true,
    get() { return _real; },
    set(v) {
      if (Array.isArray(v) && v !== _real && _real && v.length > _real.length + 3) {
        try {
          localStorage.setItem("fp_debug_bancos", JSON.stringify({
            quando: new Date().toISOString(), tipo: "reassign",
            antes: _real.length, depois: v.length, amostra: v.slice(0, 3),
            stack: new Error().stack
          }));
        } catch (e) {}
      }
      _real = Array.isArray(v) ? armar(v) : v;
    }
  });
})();

let chartCategoriasPlanilha = null;
let chartFluxoPlanilha      = null;
let chartEvolucao           = null;
let _undoSnapshot           = null;
let _motivoUpgrade          = null;   // por que o usuário foi levado aos planos

/* ─── Ícones por categoria ───────────────────────────────── */
/* SVGs inline (stroke, herdam cor via currentColor). Classe .cat-icone controla o tamanho. */
const _sv = p => `<svg class="cat-icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICONE_CAT = {
  "Entrada":          _sv('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'),
  "Gasto importante": _sv('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><rect x="9.5" y="13" width="5" height="8"/>'),
  "Lazer":            _sv('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 4v16M17 4v16M2 9h5M2 15h5M17 9h5M17 15h5"/>'),
  "Transporte":       _sv('<path d="M5 13l1.5-5A2 2 0 0 1 8.4 6.5h7.2a2 2 0 0 1 1.9 1.5L19 13"/><path d="M5 13h14v4a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H8v1a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/><circle cx="7.5" cy="15.5" r="0.6"/><circle cx="16.5" cy="15.5" r="0.6"/>'),
  "Compras":          _sv('<circle cx="9" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.5 3h2l2.2 12.4a1.5 1.5 0 0 0 1.5 1.2h9.3a1.5 1.5 0 0 0 1.5-1.2L21 7H6"/>'),
  "Mercado":          _sv('<path d="M4 10h16l-1.6 9.3a2 2 0 0 1-2 1.7H7.6a2 2 0 0 1-2-1.7L4 10z"/><path d="M9 10 7.5 4M15 10l1.5-6M2.5 10h19"/>'),
  "Cartão de Crédito": _sv('<rect x="2" y="5" width="20" height="14" rx="2.2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="5.5" y1="15" x2="10" y2="15"/>'),
  "Pets":             _sv('<circle cx="7" cy="9" r="1.6"/><circle cx="12" cy="6.3" r="1.6"/><circle cx="17" cy="9" r="1.6"/><path d="M12 12.2c-3 0-5.5 2.1-5.5 4.6 0 1.7 1.5 2.5 3 2 1-.3 1.7-.3 2.5-.3s1.5 0 2.5.3c1.5.5 3-.3 3-2 0-2.5-2.5-4.6-5.5-4.6z"/>'),
  "Vestuário":        _sv('<path d="M7 4 3 7.5 5.5 10.3 8 8.5V20h8V8.5l2.5 1.8L21 7.5 17 4l-3 2h-4z"/>'),
  "Cuidados Pessoais": _sv('<path d="M12 3c4 5 7 8.7 7 12a7 7 0 0 1-14 0c0-3.3 3-7 7-12z"/>'),
  "Outros":           _sv('<path d="M21 8v13H3V8"/><rect x="1" y="3" width="22" height="5" rx="1"/><line x1="12" y1="3" x2="12" y2="21"/>'),
  // Categorias do espaço Empresarial (ver CATEGORIAS_FIXAS_EMPRESARIAL)
  "Fornecedores":         _sv('<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V5a4 4 0 0 1 8 0v2"/>'),
  "Folha de Pagamento":   _sv('<circle cx="9" cy="8" r="3.2"/><path d="M2.5 21a6.5 6.5 0 0 1 13 0"/><circle cx="18" cy="9" r="2.4"/><path d="M15.5 21a4.7 4.7 0 0 1 7.3-3.9"/>'),
  "Impostos e Taxas":     _sv('<circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/><line x1="19" y1="5" x2="5" y2="19"/>'),
  "Receita de Vendas":    _sv('<polyline points="3 17 9.5 10.5 14 15 21 8"/><polyline points="15 8 21 8 21 14"/>')
};
const ICONE_CAT_FALLBACK = _sv('<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/>');

/* ============================================================
   CATEGORIAS — fonte única de verdade
   As fixas vêm com o app. As personalizadas o usuário cria,
   e ficam salvas na conta dele (tabela "categorias").
   ============================================================ */

/* As que vêm de fábrica. Não podem ser apagadas. */
const CATEGORIAS_FIXAS = [
  "Alimentação", "Mercado", "Transporte", "Moradia", "Saúde",
  "Lazer", "Educação", "Serviços", "Compras", "Cartão de Crédito",
  "Pets", "Vestuário", "Cuidados Pessoais", "Outros"
];

/* Categorias de fábrica do espaço EMPRESARIAL — voltadas pra o que uma
   empresa realmente lança no dia a dia, em vez de reaproveitar as
   pessoais (ninguém categoriza despesa de fornecedor como "Compras").
   Automático: aparecem sozinhas assim que o espaço Empresarial é aberto,
   sem precisar criar nada na mão. */
const CATEGORIAS_FIXAS_EMPRESARIAL = [
  "Fornecedores", "Folha de Pagamento", "Impostos e Taxas",
  "Aluguel e Contas Fixas", "Marketing e Vendas",
  "Equipamentos e Software", "Serviços Contratados", "Receita de Vendas", "Outros"
];

/* Quais categorias fixas valem agora, conforme o espaço ativo. */
function categoriasFixasAtivas() {
  return state.contextoAtivo === "empresarial" ? CATEGORIAS_FIXAS_EMPRESARIAL : CATEGORIAS_FIXAS;
}

/* Cores oferecidas ao criar uma categoria */
const CORES_CATEGORIA = [
  "#7F77DD", "#1D9E75", "#D85A30", "#378ADD",
  "#BA7517", "#D4537E", "#639922", "#888780"
];

/* Todas as categorias disponíveis: fixas (do espaço ativo) + as do usuário */
function todasCategorias() {
  const minhas = (state.categorias || []).map(c => c.nome);
  return [...categoriasFixasAtivas(), ...minhas];
}

/* A cor de uma categoria personalizada (fixas usam o padrão do tema) */
function corDaCategoria(nome) {
  const c = (state.categorias || []).find(x => x.nome === nome);
  return c?.cor || null;
}

/* Monta as <option> de um select de categoria.
   incluirEntrada: para formulários que aceitam receitas.
   incluirCriar: adiciona a opção de criar uma nova.
   selecionada: qual deve vir marcada. */
function opcoesCategoria(selecionada, opcoes = {}) {
  const { incluirEntrada = true, incluirCriar = true, incluirTodas = false } = opcoes;

  let html = "";
  if (incluirTodas) {
    html += `<option value="todas"${selecionada === "todas" ? " selected" : ""}>Todas</option>`;
  }
  if (incluirEntrada) {
    html += `<option value="Entrada"${selecionada === "Entrada" ? " selected" : ""}>Entrada</option>`;
  }

  // Fixas (do espaço ativo — Pessoal ou Empresarial)
  html += categoriasFixasAtivas()
    .map(c => `<option value="${esc(c)}"${selecionada === c ? " selected" : ""}>${esc(c)}</option>`)
    .join("");

  // Personalizadas, agrupadas para ficar claro que são do usuário
  const minhas = state.categorias || [];
  if (minhas.length) {
    html += `<optgroup label="Minhas categorias">`;
    html += minhas
      .map(c => `<option value="${esc(c.nome)}"${selecionada === c.nome ? " selected" : ""}>${esc(c.nome)}</option>`)
      .join("");
    html += `</optgroup>`;
  }

  // Se a categoria salva não existe mais na lista, preserva para não perder o dado
  if (selecionada && selecionada !== "todas" && !todasCategorias().includes(selecionada) && selecionada !== "Entrada") {
    html += `<option value="${esc(selecionada)}" selected>${esc(selecionada)}</option>`;
  }

  if (incluirCriar) {
    html += `<option value="__nova__">+ Criar categoria…</option>`;
  }
  return html;
}

/* Repopula todos os selects de categoria do app de uma vez.
   Chamada sempre que a lista muda (criou, renomeou, excluiu). */
function atualizarSelectsCategoria() {
  const alvos = [
    { id: "recCategoria",          entrada: true  },
    { id: "metaCategoria",         entrada: false },
    { id: "filtroCategoriaTabela", entrada: true, todas: true, criar: false },
    { id: "histCategoria",         entrada: true, todas: true, criar: false },
    { id: "editMovCategoria",      entrada: true  },
    { id: "editRecCategoria",      entrada: true  }
  ];
  alvos.forEach(({ id, entrada, todas, criar }) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const valorAtual = sel.value;
    sel.innerHTML = opcoesCategoria(valorAtual, {
      incluirEntrada: entrada,
      incluirTodas: !!todas,
      incluirCriar: criar !== false
    });
    if (valorAtual && [...sel.options].some(o => o.value === valorAtual)) {
      sel.value = valorAtual;
    }
  });
}

/* Liga os selects de categoria à opção "+ Criar categoria…".
   Delegação no documento: funciona mesmo com selects repopulados. */
document.addEventListener("focusin", e => {
  if (e.target.tagName === "SELECT" && /[Cc]ategoria/.test(e.target.id)) {
    guardarValorCategoria(e.target);
  }
});
document.addEventListener("change", e => {
  if (e.target.tagName === "SELECT" && /[Cc]ategoria/.test(e.target.id)) {
    aoTrocarSelectCategoria(e.target);
  }
});

/* Quantos registros usam uma categoria */
function usosDaCategoria(nome) {
  const movs = state.movimentos.filter(m => m.categoria === nome).length;
  const recs = state.recorrencias.filter(r => r.categoria === nome).length;
  const metas = state.metas.filter(m => m.categoria === nome).length;
  return { movs, recs, metas, total: movs + recs + metas };
}

/* Exclui uma categoria criada pelo usuário.
   O histórico é preservado: lançamentos antigos mantêm o nome,
   mas a categoria some das opções de escolha. */
async function excluirCategoria(id) {
  const cat = (state.categorias || []).find(c => c.id === id);
  if (!cat) return;

  const uso = usosDaCategoria(cat.nome);
  let desc = "";
  if (uso.total > 0) {
    const partes = [];
    if (uso.movs)  partes.push(`${uso.movs} lançamento${uso.movs > 1 ? "s" : ""}`);
    if (uso.recs)  partes.push(`${uso.recs} gasto${uso.recs > 1 ? "s" : ""} fixo${uso.recs > 1 ? "s" : ""}`);
    if (uso.metas) partes.push(`${uso.metas} meta${uso.metas > 1 ? "s" : ""}`);
    desc = `Ela está sendo usada em ${partes.join(", ")}. Esses registros continuam com o nome, mas a categoria some das novas escolhas.`;
  }

  const ok = await confirmar(`Excluir a categoria "${esc(cat.nome)}"?`, { tipo: "perigo", descricao: desc, okLabel: "Excluir" });
  if (!ok) return;

  try {
    await dbDelete("categorias", id);
    state.categorias = state.categorias.filter(c => c.id !== id);
    atualizarSelectsCategoria();
    renderCategorias();
    renderTudo();
    toast(`Categoria "${cat.nome}" excluída.`, "info");
  } catch (err) { tratarErro(err); }
}

/* Lista as categorias no painel de Gastos Fixos.
   Mostra as do app (que não podem ser apagadas) e as suas. */
function renderCategorias() {
  const el = document.getElementById("listaCategorias");
  if (!el) return;

  const minhas = state.categorias || [];

  // Contador no cabeçalho do painel
  const cont = document.getElementById("contadorCategorias");
  if (cont) {
    const n = minhas.length;
    cont.textContent = n ? `${n} sua${n === 1 ? "" : "s"}` : "";
  }

  const linhaFixa = nome => {
    const uso = usosDaCategoria(nome);
    return `<div class="cat-item cat-item-fixa">
      <span class="cat-item-icone">${ICONE_CAT[nome] ?? ICONE_CAT_FALLBACK}</span>
      <div class="cat-item-info">
        <div class="cat-item-nome">${esc(nome)}</div>
        <div class="cat-item-sub">${uso.total ? `${uso.total} registro${uso.total > 1 ? "s" : ""}` : "Do app"}</div>
      </div>
    </div>`;
  };

  const linhaMinha = c => {
    const uso = usosDaCategoria(c.nome);
    return `<div class="cat-item">
      <span class="cat-item-cor" style="background:${esc(c.cor || "#888780")}"></span>
      <div class="cat-item-info">
        <div class="cat-item-nome">${esc(c.nome)}</div>
        <div class="cat-item-sub">${uso.total ? `${uso.total} registro${uso.total > 1 ? "s" : ""}` : "Sem uso ainda"}</div>
      </div>
      <div class="cat-item-acoes">
        <button class="btn-acao" onclick="abrirRenomearCategoria('${c.id}')" title="Renomear">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
        </button>
        <button class="btn-acao btn-acao-danger" onclick="excluirCategoria('${c.id}')" title="Excluir">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>
    </div>`;
  };

  let html = "";
  if (minhas.length) {
    html += `<div class="cat-grupo-titulo">Suas categorias</div>`;
    html += minhas.map(linhaMinha).join("");
  }
  html += `<div class="cat-grupo-titulo">Do aplicativo</div>`;
  html += categoriasFixasAtivas().map(linhaFixa).join("");

  el.innerHTML = html;
}

/* Renomear uma categoria criada pelo usuário.
   Os lançamentos que usam ela acompanham o novo nome. */
async function abrirRenomearCategoria(id) {
  const cat = (state.categorias || []).find(c => c.id === id);
  if (!cat) return;

  const uso = usosDaCategoria(cat.nome);
  const aviso = uso.total > 0
    ? `<br><span style="font-size:12px;opacity:.7">${uso.total} registro(s) passarão a usar o novo nome.</span>`
    : "";

  const novo = await promptTexto(
    `Novo nome para <strong>${esc(cat.nome)}</strong>:${aviso}`,
    cat.nome
  );
  if (novo === null) return;

  const nome = novo.trim();
  if (nome.length < 2) { toast("Escreva um nome com pelo menos 2 letras.", "error"); return; }
  if (nome === cat.nome) return;

  const existe = todasCategorias().some(c => c.toLowerCase() === nome.toLowerCase())
                 || nome.toLowerCase() === "entrada";
  if (existe) { toast("Você já tem uma categoria com esse nome.", "error"); return; }

  mostrarLoading(true, "Renomeando", "Atualizando seus registros...");
  try {
    const nomeAntigo = cat.nome;
    await dbUpdate("categorias", id, { nome });

    // Leva o novo nome para tudo que usava o antigo
    for (const m of state.movimentos.filter(x => x.categoria === nomeAntigo)) {
      await dbUpdate("movimentos", m.id, { categoria: nome });
      m.categoria = nome;
    }
    for (const r of state.recorrencias.filter(x => x.categoria === nomeAntigo)) {
      await dbUpdate("recorrencias", r.id, { categoria: nome });
      r.categoria = nome;
    }
    for (const mt of state.metas.filter(x => x.categoria === nomeAntigo)) {
      await dbUpdate("metas", mt.id, { categoria: nome });
      mt.categoria = nome;
    }

    cat.nome = nome;
    state.categorias.sort((a,b) => a.nome.localeCompare(b.nome, "pt-BR"));
    atualizarSelectsCategoria();
    renderTudo();
    toast(`Categoria renomeada para "${nome}".`, "success");
  } catch (err) {
    tratarErro(err);
  } finally { mostrarLoading(false); }
}

/* ─── Criar categoria ─────────────────────────────────────
   Disparado pela opção "+ Criar categoria…" em qualquer select.
   Guarda de onde veio para devolver o foco e já selecionar a nova. */

let _selectOrigemCategoria = null;   // id do select que abriu o modal
let _selectValorAnterior = null;     // valor que estava escolhido antes
let _corCategoriaEscolhida = CORES_CATEGORIA[0];

/* Um select escolheu "+ Criar categoria…" */
function aoTrocarSelectCategoria(sel) {
  if (sel.value !== "__nova__") return;
  _selectOrigemCategoria = sel.id;
  // Volta o select ao valor anterior — só troca de verdade se a criação der certo
  sel.value = _selectValorAnterior && [...sel.options].some(o => o.value === _selectValorAnterior)
    ? _selectValorAnterior
    : (sel.options[0]?.value || "");
  abrirModalCategoria();
}

/* Guarda o valor antes de trocar, para poder voltar se cancelar */
function guardarValorCategoria(sel) {
  if (sel.value !== "__nova__") _selectValorAnterior = sel.value;
}

function abrirModalCategoria() {
  const campo = document.getElementById("novaCategoriaNome");
  const erro  = document.getElementById("novaCategoriaErro");
  if (campo) campo.value = "";
  if (erro) { erro.textContent = ""; erro.classList.remove("campo-dica-erro"); }
  _corCategoriaEscolhida = CORES_CATEGORIA[0];
  montarCoresCategoria();
  abrirModal("modalCategoria");
  setTimeout(() => campo?.focus(), 100);
}

function montarCoresCategoria() {
  const box = document.getElementById("novaCategoriaCores");
  if (!box) return;
  box.innerHTML = CORES_CATEGORIA.map(c => `
    <button type="button" class="cat-cor ${c === _corCategoriaEscolhida ? "ativa" : ""}"
      style="background:${c}" data-cor="${c}" aria-label="Cor ${c}"></button>
  `).join("");
  box.querySelectorAll(".cat-cor").forEach(b => {
    b.addEventListener("click", () => {
      _corCategoriaEscolhida = b.dataset.cor;
      box.querySelectorAll(".cat-cor").forEach(x => x.classList.remove("ativa"));
      b.classList.add("ativa");
    });
  });
}

/* Salva a categoria nova */
document.getElementById("formCategoria")?.addEventListener("submit", async e => {
  e.preventDefault();
  const campo = document.getElementById("novaCategoriaNome");
  const erro  = document.getElementById("novaCategoriaErro");
  const nome  = (campo?.value || "").trim();

  const avisar = msg => {
    if (erro) { erro.textContent = msg; erro.classList.add("campo-dica-erro"); }
    campo?.focus();
  };

  if (nome.length < 2) return avisar("Escreva um nome com pelo menos 2 letras.");
  if (nome === "__nova__" || nome === "todas") return avisar("Esse nome é reservado pelo app.");

  // Já existe? (não diferencia maiúscula/minúscula)
  const existe = todasCategorias().some(c => c.toLowerCase() === nome.toLowerCase())
                 || nome.toLowerCase() === "entrada";
  if (existe) return avisar("Você já tem uma categoria com esse nome.");

  try {
    const nova = await dbInsert("categorias", {
      user_id: state.user.id,
      nome,
      cor: _corCategoriaEscolhida
    });
    state.categorias.push({ id: nova.id, nome: nova.nome, cor: nova.cor || null });
    state.categorias.sort((a,b) => a.nome.localeCompare(b.nome, "pt-BR"));

    atualizarSelectsCategoria();

    // Já deixa a nova categoria escolhida no select de onde o usuário veio
    if (_selectOrigemCategoria) {
      const sel = document.getElementById(_selectOrigemCategoria);
      if (sel) sel.value = nome;
      _selectOrigemCategoria = null;
    }

    fecharModal("modalCategoria");
    renderTudo();
    toast(`Categoria "${nome}" criada.`, "success");
  } catch (err) {
    if (String(err.message || "").includes("duplicate")) {
      avisar("Você já tem uma categoria com esse nome.");
    } else {
      tratarErro(err);
    }
  }
});

["fecharModalCategoria", "cancelarCategoria"].forEach(id => {
  document.getElementById(id)?.addEventListener("click", () => {
    _selectOrigemCategoria = null;
    fecharModal("modalCategoria");
  });
});

/* ─── Tema claro / escuro ────────────────────────────────── */
const SVG_SOL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const SVG_LUA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/></svg>';

function aplicarTema(tema) {
  document.documentElement.setAttribute("data-theme", tema);
  localStorage.setItem("fp_tema", tema);
  const ic = document.getElementById("temaIcone");
  // Mostra o ícone do que a pessoa vai ATIVAR ao clicar (no escuro, oferece o sol)
  if (ic) ic.innerHTML = tema === "dark" ? SVG_SOL : SVG_LUA;
}

/* ============================================================
   TOAST
   ============================================================ */
const toastContainer = document.getElementById("toastContainer");
let _toastQueue = [], _toastRunning = false;

function toast(msg, tipo = "success", comUndo = false) {
  _toastQueue.push({ msg, tipo, comUndo });
  if (!_toastRunning) _nextToast();
}

/* Ícones em SVG (não em caractere de texto) — nítidos em qualquer tamanho e
   reconhecíveis pela FORMA, não só pela cor do círculo em volta (importante
   para quem tem daltonismo: sucesso, erro, aviso e info têm silhuetas
   diferentes entre si, não dependem de perceber a cor). */
const _toastIcones = {
  success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 2 20h20L12 3.5z"/><line x1="12" y1="10" x2="12" y2="14.5"/><circle cx="12" cy="17.3" r="0.9" fill="currentColor" stroke="none"/></svg>',
  info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16.5"/><circle cx="12" cy="7.6" r="0.9" fill="currentColor" stroke="none"/></svg>'
};
function _nextToast() {
  if (!_toastQueue.length) { _toastRunning = false; return; }
  _toastRunning = true;
  const { msg, tipo, comUndo } = _toastQueue.shift();
  const t = document.createElement("div");
  t.className = `toast toast-${tipo}`;
  const ic = _toastIcones[tipo] || _toastIcones.info;
  const dur = comUndo ? 5500 : 3000;
  t.innerHTML = `
    <span class="toast-icon">${ic}</span>
    <span class="toast-msg">${msg}</span>
    ${comUndo ? `<button class="toast-undo" onclick="_executarUndo()">Desfazer</button>` : ""}
    <button class="toast-x" onclick="this.closest('.toast').remove()">✕</button>
    <span class="toast-progresso" style="animation-duration:${dur}ms"></span>
  `;
  toastContainer.appendChild(t);
  requestAnimationFrame(() => t.classList.add("toast-in"));
  setTimeout(() => {
    t.classList.add("toast-out");
    t.addEventListener("transitionend", () => { t.remove(); _nextToast(); }, { once: true });
  }, dur);
}

/* ============================================================
   CONFIRM
   ============================================================ */
function confirmar(titulo, opts = {}) {
  const { tipo = "perigo", descricao = "", lista = null, okLabel = "Confirmar", cancelLabel = "Cancelar" } = opts;
  const neutro = tipo === "neutro";
  const icone = neutro
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M9.2 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.8 2-2.8 3.6"></path><path d="M12 17.5h.01"></path></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
  const xIcone = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
  const descHtml  = descricao ? `<p class="confirm-msg">${descricao}</p>` : "";
  const listaHtml = (Array.isArray(lista) && lista.length)
    ? `<ul class="confirm-lista">${lista.map(i => `<li>${i}</li>`).join("")}</ul>`
    : "";
  return new Promise(resolve => {
    const ov = document.createElement("div");
    ov.className = "confirm-ov";
    ov.innerHTML = `
      <div class="confirm-box ${neutro ? "is-neutro" : "is-perigo"}" role="alertdialog" aria-modal="true">
        <button class="confirm-x" aria-label="Fechar">${xIcone}</button>
        <div class="confirm-ico">${icone}</div>
        <h3 class="confirm-titulo">${titulo}</h3>
        ${descHtml}
        ${listaHtml}
        <div class="confirm-btns">
          <button class="confirm-cancel">${cancelLabel}</button>
          <button class="confirm-ok">${okLabel}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add("open"));
    const fechar = val => {
      ov.classList.remove("open");
      setTimeout(() => ov.remove(), 200);
      resolve(val);
    };
    ov.querySelector(".confirm-ok").onclick     = () => fechar(true);
    ov.querySelector(".confirm-cancel").onclick = () => fechar(false);
    ov.querySelector(".confirm-x").onclick      = () => fechar(false);
    ov.addEventListener("click", e => { if (e.target === ov) fechar(false); });
    ov.addEventListener("keydown", e => { if (e.key === "Escape") fechar(false); });
    setTimeout(() => ov.querySelector(".confirm-cancel")?.focus(), 60);
  });
}

/* ─── Undo ───────────────────────────────────────────────── */
function _salvarUndo() {
  _undoSnapshot = JSON.parse(JSON.stringify(state));
}

function _executarUndo() {
  if (!_undoSnapshot) return;
  const snap = _undoSnapshot; _undoSnapshot = null;
  state.bancos         = snap.bancos;
  state.movimentos     = snap.movimentos;
  state.transferencias = snap.transferencias;
  state.recorrencias   = snap.recorrencias;
  state.metas          = snap.metas;
  renderTudo();
  toast("Ação desfeita com sucesso.", "info");
}

/* ============================================================
   API SUPABASE — funções de acesso ao banco
   ============================================================ */

/* Traduz mensagens de erro do Supabase Auth (vêm em inglês) para
   PT-BR. Se não reconhecer a mensagem, usa o fallback (nunca mostra
   o texto em inglês pro usuário). */
function traduzErroAuth(msgBruta, fallback) {
  const m = String(msgBruta || "").toLowerCase();
  if (!m) return fallback;
  if (m.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
  if (m.includes("email not confirmed")) return "Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada (e o spam).";
  if (m.includes("already registered") || m.includes("already exists") || m.includes("user already")) return "Este e-mail já está cadastrado. Tente entrar ou clique em \"Esqueci minha senha\".";
  if (m.includes("password") && m.includes("at least")) return "A senha deve ter pelo menos 6 caracteres.";
  if (m.includes("different from the old") || m.includes("should be different")) return "A nova senha deve ser diferente da senha atual.";
  if (m.includes("unable to validate email") || m.includes("invalid format") || m.includes("invalid email")) return "E-mail inválido.";
  if (m.includes("rate limit")) return "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.";
  if (m.includes("security purposes") || m.includes("can only request this after")) return "Por segurança, aguarde alguns segundos antes de tentar novamente.";
  if (m.includes("token has expired") || m.includes("otp expired") || m.includes("invalid or has expired") || m.includes("invalid token")) return "O link expirou ou é inválido. Solicite um novo.";
  if (m.includes("user not found")) return "Não encontramos uma conta com esse e-mail.";
  if (m.includes("signup") && m.includes("disabled")) return "Cadastros estão temporariamente desativados.";
  return fallback;
}

/* Autenticação */
async function sbLogin(email, senha) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY },
    body: JSON.stringify({ email, password: senha })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(traduzErroAuth(data.error_description || data.msg, "Não foi possível entrar. Verifique seus dados."));
  return data;
}

/* ─── Renovação de sessão ─────────────────────────────────
   O access_token do Supabase vence em ~1h. Antes, o app só guardava
   esse token (sem o refresh_token) — quem ficasse numa tela demorada
   (ex: categorizando muitas dúvidas na revisão de extrato) sem nenhuma
   chamada de rede nesse meio tempo via o token vencer sozinho, e ao
   tentar salvar levava um 401 que deslogava na hora, perdendo tudo que
   não tinha sido salvo ainda. Agora guardamos o refresh_token também e
   renovamos sozinhos — na marra (timer) e por baixo dos panos quando
   uma chamada esbarra num token vencido (ver fetchSeguro). */

// Evita duas renovações em paralelo (ex: várias chamadas batendo 401 ao
// mesmo tempo) — todo mundo espera a MESMA renovação em andamento.
let _renovacaoSessaoEmAndamento = null;

async function sbRenovarSessao() {
  if (_renovacaoSessaoEmAndamento) return _renovacaoSessaoEmAndamento;
  _renovacaoSessaoEmAndamento = (async () => {
    const refreshToken = localStorage.getItem("fp_refresh_token");
    if (!refreshToken) return null;
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY },
        body: JSON.stringify({ refresh_token: refreshToken })
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.access_token || !data.refresh_token) return null;
      localStorage.setItem("fp_token", data.access_token);
      localStorage.setItem("fp_refresh_token", data.refresh_token);
      return data.access_token;
    } catch (e) {
      return null;
    }
  })();
  try {
    return await _renovacaoSessaoEmAndamento;
  } finally {
    _renovacaoSessaoEmAndamento = null;
  }
}

let _timerRenovacaoSessao = null;

/* Chama uma vez logo após logar (senha, Google ou sessão salva) — renova
   o token sozinho a cada 45min enquanto o app ficar aberto, pra ele quase
   nunca chegar perto de vencer de verdade. */
function iniciarRenovacaoAutomaticaDeSessao() {
  pararRenovacaoAutomaticaDeSessao();
  _timerRenovacaoSessao = setInterval(() => { sbRenovarSessao(); }, 45 * 60 * 1000);
}
function pararRenovacaoAutomaticaDeSessao() {
  if (_timerRenovacaoSessao) { clearInterval(_timerRenovacaoSessao); _timerRenovacaoSessao = null; }
}
/* ─── Recuperação de senha ─────────────────────────────── */

/* Envia o e-mail com o link de redefinição */
async function sbEnviarResetSenha(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY },
    body: JSON.stringify({
      email,
      // Volta para a própria página; o token vem no hash da URL
      redirect_to: window.location.origin + window.location.pathname
    })
  });
  if (!res.ok) {
    const data = await res.json().catch(()=>({}));
    throw new Error(traduzErroAuth(data.msg || data.error_description, "Não foi possível enviar o e-mail."));
  }
  return true;
}

/* Define a nova senha usando o token que veio no link do e-mail */
async function sbDefinirNovaSenha(accessToken, novaSenha) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${accessToken}`
    },
    body: JSON.stringify({ password: novaSenha })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(traduzErroAuth(data.msg || data.error_description, "Não foi possível alterar a senha."));
  return data;
}


async function sbCadastro(email, senha) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY },
    body: JSON.stringify({ email, password: senha })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(traduzErroAuth(data.error_description || data.msg, "Erro ao cadastrar."));
  // Pixel: novo cadastro concluído (evento de topo de funil)
  if (typeof fbq === "function") { try { fbq("track", "CompleteRegistration"); } catch(e){} }
  return data;
}

/* ─── Login social (Google, via OAuth do Supabase) ───────────
   Não usamos a biblioteca supabase-js (o app inteiro fala com o Supabase
   por fetch puro) — então fazemos o fluxo "na mão": manda pra tela de
   login do Google através do endpoint /authorize do Supabase; ele volta
   pro app com os tokens no PEDAÇO da URL (#access_token=...), que a
   verificarLoginOAuth() abaixo lê assim que a página carrega de novo. */
function loginComGoogle() {
  const redirectTo = window.location.origin + window.location.pathname;
  window.location.href =
    `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
}

/* Roda no início do app: fomos redirecionados de volta pelo Google/Supabase
   com um login pronto? Se sim, finaliza a sessão igual ao login por senha
   e devolve true (quem chamou não deve seguir o fluxo normal de checar
   sessão salva). Se não, devolve false sem fazer nada. */
async function verificarLoginOAuth() {
  const hash = window.location.hash;
  if (!hash || !hash.includes("access_token") || hash.includes("type=recovery")) return false;

  const params = new URLSearchParams(hash.slice(1));
  const erro = params.get("error_description");
  history.replaceState(null, "", window.location.pathname + window.location.search); // limpa o hash

  if (erro) {
    toast(decodeURIComponent(erro.replace(/\+/g, " ")), "error");
    return false;
  }

  const accessToken = params.get("access_token");
  if (!accessToken) return false;

  mostrarSplash();
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) throw new Error("Não foi possível confirmar o login com Google.");
    const user = await res.json();

    localStorage.setItem("fp_token", accessToken);
    const refreshTokenOAuth = params.get("refresh_token");
    if (refreshTokenOAuth) localStorage.setItem("fp_refresh_token", refreshTokenOAuth);
    localStorage.setItem("fp_user", JSON.stringify({ email: user.email, id: user.id, createdAt: user.created_at || null }));
    state.user = { email: user.email, id: user.id, createdAt: user.created_at || null };
    document.getElementById("userEmail").textContent = state.user.email;
    iniciarRenovacaoAutomaticaDeSessao();

    await carregarDadosNuvem();
    const retornoJaDecidiuTela = await tratarRetornoAssinatura();
    esconderSplash();
    if (!retornoJaDecidiuTela && mostrarAppOuPaywall()) {
      renderTudo();
      injetarBotoesGuia();
      trocarTela("dashboard");
      toast(`Bem-vindo, ${state.user.email}! 👋`, "success");
      atualizarCDI().then(() => renderTudo()).catch(() => {});
      verificarExtratosPorEmail();
      if (!localStorage.getItem("fp_onboarding_done")) {
        setTimeout(() => mostrarOnboarding(), 600);
      }
    }
  } catch (e) {
    esconderSplash();
    toast(e.message || "Erro ao entrar com Google.", "error");
    mostrarTelaLogin();
    abrirAuth("login");
  }
  return true;
}

async function sbLogout() {
  pararRenovacaoAutomaticaDeSessao();
  const token = localStorage.getItem("fp_token");
  if (token) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` }
    }).catch(()=>{});
  }
  localStorage.removeItem("fp_token");
  localStorage.removeItem("fp_refresh_token");
  localStorage.removeItem("fp_user");
  // Limpa avisos/eventos do sino e o chat — são do usuário que estava
  // logado, não devem aparecer para quem logar depois no mesmo navegador.
  localStorage.removeItem("fp_eventos");
  localStorage.removeItem("fp_avisos_lidos");
  localStorage.removeItem("fp_chat");
}

function getAuthHeader() {
  const token = localStorage.getItem("fp_token");
  return token ? { "Authorization": `Bearer ${token}` } : {};
}

/* CRUD genérico com token do usuário */

/* ============================================================
   CAMADA DE REDE ROBUSTA (v10)
   - Retry automático em falha temporária
   - Mensagens claras em vez de "Failed to fetch"
   - Detecta sessão expirada e manda relogar
   ============================================================ */

/* Erro que o app entende e sabe explicar */
class ErroRede extends Error {
  constructor(msg, tipo) {
    super(msg);
    this.tipo = tipo;   // 'offline' | 'timeout' | 'sessao' | 'servidor' | 'dados'
  }
}

const dormir = ms => new Promise(r => setTimeout(r, ms));

/* fetch com timeout, retry e erros traduzidos */
async function fetchSeguro(url, opcoes = {}, tentativas = 3, jaTentouRenovar = false) {
  // Sem internet? Nem tenta.
  if (!navigator.onLine) {
    throw new ErroRede("Você está sem internet. Verifique sua conexão.", "offline");
  }

  let ultimoErro;

  for (let i = 0; i < tentativas; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);   // 15s de limite

    try {
      const res = await fetch(url, { ...opcoes, signal: ctrl.signal });
      clearTimeout(timer);

      // Sessão expirada — antes de desistir, tenta renovar o token uma vez
      // e repetir a MESMA chamada com ele. É o que salva quem passou muito
      // tempo numa tela sem nenhuma chamada de rede (ex: categorizando
      // várias dúvidas na revisão de extrato) e só na hora de salvar
      // esbarra no token vencido — sem isso, perdia tudo que não salvou.
      if (res.status === 401 || res.status === 403) {
        if (!jaTentouRenovar && opcoes.headers && opcoes.headers.Authorization) {
          const novoToken = await sbRenovarSessao();
          if (novoToken) {
            const novasOpcoes = { ...opcoes, headers: { ...opcoes.headers, Authorization: `Bearer ${novoToken}` } };
            return fetchSeguro(url, novasOpcoes, tentativas, true);
          }
        }
        const corpo = await res.json().catch(() => ({}));
        const msg = (corpo.message || corpo.msg || "").toLowerCase();
        if (msg.includes("jwt") || msg.includes("expired") || msg.includes("token")) {
          throw new ErroRede("Sua sessão expirou. Faça login novamente.", "sessao");
        }
        throw new ErroRede("Sem permissão para essa operação.", "sessao");
      }

      // Erro do servidor (5xx) — vale tentar de novo
      if (res.status >= 500) {
        ultimoErro = new ErroRede("O servidor está com problemas. Tentando de novo...", "servidor");
        if (i < tentativas - 1) { await dormir(600 * (i + 1)); continue; }
        throw new ErroRede("O servidor não respondeu. Tente novamente em instantes.", "servidor");
      }

      // Erro de dados (4xx) — não adianta repetir
      if (!res.ok) {
        const corpo = await res.json().catch(() => ({}));
        throw new ErroRede(corpo.message || corpo.msg || "Não foi possível completar a operação.", "dados");
      }

      return res;

    } catch (err) {
      clearTimeout(timer);

      // Erros que já classificamos: repassa direto
      if (err instanceof ErroRede) {
        if (err.tipo === "servidor" && i < tentativas - 1) { ultimoErro = err; continue; }
        throw err;
      }

      // Timeout
      if (err.name === "AbortError") {
        ultimoErro = new ErroRede("A conexão demorou demais.", "timeout");
        if (i < tentativas - 1) { await dormir(600 * (i + 1)); continue; }
        throw new ErroRede("A conexão demorou demais. Verifique sua internet.", "timeout");
      }

      // Falha de rede (offline no meio da requisição)
      ultimoErro = new ErroRede("Falha de conexão. Tentando novamente...", "offline");
      if (i < tentativas - 1) { await dormir(600 * (i + 1)); continue; }
      throw new ErroRede("Não foi possível conectar. Verifique sua internet.", "offline");
    }
  }

  throw ultimoErro || new ErroRede("Erro desconhecido.", "servidor");
}

/* Trata o erro de forma amigável e age quando necessário */
function tratarErro(err) {
  const msg = err?.message || "Algo deu errado.";

  if (err instanceof ErroRede && err.tipo === "sessao") {
    toast(msg, "error");
    // Dá tempo de ler antes de deslogar. fazerLogout(false) = sem pedir
    // confirmação (a sessão já caiu, não tem o que confirmar).
    setTimeout(() => { fazerLogout(false); }, 2200);
    return;
  }

  toast(msg, "error");
}

/* Aviso visual de offline */
window.addEventListener("offline", () => {
  toast("Você está sem internet. As alterações não serão salvas.", "warning");
  document.body.classList.add("sem-internet");
});
window.addEventListener("online", () => {
  toast("Conexão restaurada.", "success");
  document.body.classList.remove("sem-internet");
});

async function dbSelect(tabela) {
  const res = await fetchSeguro(`${SUPABASE_URL}/rest/v1/${tabela}?select=*`, {
    headers: { ..._h, ...getAuthHeader() }
  });
  return res.json();
}

/* Tabelas com dado financeiro separado por espaço (Pessoal/Empresarial).
   Toda gravação nelas leva a tag do contexto ativo — dbInsert cuida disso
   sozinho, então nenhuma das funções que chamam dbInsert("contas", ...)
   etc. precisou mudar. Ver state.contextoAtivo e alternarContexto(). */
const TABELAS_COM_CONTEXTO = new Set([
  "contas", "movimentos", "transferencias", "recorrencias",
  "recorrencia_pagamentos", "metas", "objetivos", "investimentos",
  "categorias", "faturas_pagas", "notas_fiscais", "contatos"
]);

async function dbInsert(tabela, dados) {
  const corpo = (TABELAS_COM_CONTEXTO.has(tabela) && dados && dados.contexto === undefined)
    ? { ...dados, contexto: state.contextoAtivo || "pessoal" }
    : dados;
  const res = await fetchSeguro(`${SUPABASE_URL}/rest/v1/${tabela}`, {
    method: "POST",
    headers: { ..._h, ...getAuthHeader(), "Prefer": "return=representation" },
    body: JSON.stringify(corpo)
  });
  const rows = await res.json();
  return rows[0];
}

async function dbUpdate(tabela, id, dados) {
  const res = await fetchSeguro(`${SUPABASE_URL}/rest/v1/${tabela}?id=eq.${id}`, {
    method: "PATCH",
    headers: { ..._h, ...getAuthHeader(), "Prefer": "return=representation" },
    body: JSON.stringify(dados)
  });
  const rows = await res.json();
  return rows[0];
}

async function dbDelete(tabela, id) {
  await fetchSeguro(`${SUPABASE_URL}/rest/v1/${tabela}?id=eq.${id}`, {
    method: "DELETE",
    headers: { ..._h, ...getAuthHeader() }
  });
  return true;
}

/* Carregar todos os dados do usuário */
async function carregarDadosNuvem() {
  mostrarLoading(true, "Carregando seus dados", "Buscando contas, lançamentos e metas...");
  try {
    const [contas, movimentos, transferencias, recorrencias, metas, objetivos, investimentos, recPagamentos, perfilRows, faturasPagas, categorias, notasFiscais, contatos] = await Promise.all([
      dbSelect("contas"),
      dbSelect("movimentos"),
      dbSelect("transferencias"),
      dbSelect("recorrencias"),
      dbSelect("metas"),
      dbSelect("objetivos").catch(()=>[]),
      dbSelect("investimentos").catch(()=>[]),
      dbSelect("recorrencia_pagamentos").catch(()=>[]),
      dbSelect("perfil").catch(()=>[]),
      dbSelect("faturas_pagas").catch(()=>[]),
      dbSelect("categorias").catch(()=>[]),
      dbSelect("notas_fiscais").catch(()=>[]),
      dbSelect("contatos").catch(()=>[])
    ]);
    // Cada tabela em TABELAS_COM_CONTEXTO só entra no app se for do espaço
    // ativo agora (Pessoal ou Empresarial) — dado sem a coluna ainda
    // (linhas antigas, de antes da migração) conta como "pessoal".
    const ctx = state.contextoAtivo || "pessoal";
    const doContexto = linha => (linha.contexto || "pessoal") === ctx;

    // Mapear campos do banco para o formato do app
    state.bancos         = contas.filter(doContexto).map(c => ({ id:c.id, nome:c.nome, tipo:c.tipo, saldoInicial: Number(c.saldo_inicial), saldoData: c.saldo_data || null, cor: c.cor || null, logoId: c.logo_id ?? null, temCartao: c.tem_cartao || false, limite: c.limite != null ? Number(c.limite) : null, diaFechamento: c.dia_fechamento || null, diaVencimento: c.dia_vencimento || null }));
    state.movimentos     = movimentos.filter(doContexto).map(m => ({ id:m.id, descricao:m.descricao, bancoId:m.conta_id, data:m.data, valor:Number(m.valor), tipo:m.tipo, categoria:m.categoria, recorrenciaId:m.recorrencia_id, status:m.status||"pago", vencimento:m.vencimento||null, pagoEm:m.pago_em||null, formaPagamento:m.forma_pagamento||null, cartaoId:m.cartao_id||null, faturaMes:m.fatura_mes||null, parcelaNum:m.parcela_num||null, parcelaTotal:m.parcela_total||null, compraId:m.compra_id||null }));
    state.transferencias = transferencias.filter(doContexto).map(t => ({ id:t.id, origem:t.conta_origem, destino:t.conta_destino, valor:Number(t.valor), data:t.data, descricao:t.descricao||"" }));
    state.faturasPagas   = (faturasPagas||[]).filter(doContexto).map(f => ({ id:f.id, cartaoId:f.cartao_id, faturaMes:f.fatura_mes, contaId:f.conta_id||null, valor:Number(f.valor), pagoEm:f.pago_em }));
    state.categorias     = (categorias||[])
      .filter(doContexto)
      .map(c => ({ id:c.id, nome:c.nome, cor:c.cor||null }))
      .sort((a,b) => a.nome.localeCompare(b.nome, "pt-BR"));
    state.recorrencias   = recorrencias.filter(doContexto).map(r => ({
      id:r.id, descricao:r.descricao, valor:Number(r.valor), tipo:r.tipo,
      categoria:r.categoria, contaId:r.conta_id, dia:r.dia,
      frequencia: r.frequencia || "mensal",
      intervalo: r.intervalo || 1,
      intervaloUnidade: r.intervalo_unidade || "meses",
      inicio: r.inicio || (r.dia ? `${mesAtualISO()}-${String(r.dia).padStart(2,"0")}` : hojeISO()),
      fim: r.fim || null,
      ativa: r.ativa !== false
    }));
    const perfilExistente = (perfilRows||[])[0];
    state.perfil = mapPerfil(perfilExistente);

    // Bolinha de aviso no seletor Pessoal/Empresarial: verifica se o
    // espaço que NÃO está ativo agora tem algo vencido/vencendo nos
    // próximos dias. Usa os arrays brutos (movimentos/recorrencias/
    // recPagamentos) já buscados acima — sem nenhuma consulta extra ao
    // banco. Ver haCompromissoPendente() e atualizarSeletorContexto().
    try {
      const outro = state.contextoAtivo === "empresarial" ? "pessoal" : "empresarial";
      const podeVerOutro = outro === "pessoal" || !!state.perfil?.empresarial;
      state.avisoOutroContexto = podeVerOutro && haCompromissoPendente(outro, movimentos, recorrencias, recPagamentos);
    } catch (e) {
      state.avisoOutroContexto = false;
    }

    // O plano pode ter mudado no servidor (pagamento, atraso, cancelamento).
    // Atualiza o selo e os cadeados na hora, sem esperar o próximo render.
    try { atualizarCadeadosMenu(); } catch (e) {}
    // Se o usuário ainda não tem linha de perfil, cria uma agora (plano básico).
    // Assim todo usuário aparece na tabela perfil e pode receber premium.
    if (!perfilExistente && state.user?.id) {
      salvarPerfil({ plano: "basico", assinatura_status: "inativa" })
        .then(() => console.log("Perfil criado automaticamente para", state.user.id))
        .catch(err => console.error("Erro ao criar perfil automático:", err));
    }
    state.recPagamentos  = (recPagamentos||[]).filter(doContexto).map(p => ({
      id:p.id, recorrenciaId:p.recorrencia_id, vencimento:p.vencimento,
      pagoEm:p.pago_em, valorPago: p.valor_pago != null ? Number(p.valor_pago) : null,
      movimentoId: p.movimento_id || null
    }));
    state.metas          = metas.filter(doContexto).map(m => ({ id:m.id, categoria:m.categoria, limite:Number(m.limite) }));
    state.objetivos      = (objetivos||[]).filter(doContexto).map(mapObjetivo);
    state.investimentos  = (investimentos||[]).filter(doContexto).map(mapInvestimento);
    state.notasFiscais   = (notasFiscais||[]).filter(doContexto).map(n => ({
      id:n.id, tipo:n.tipo||"emitida", numero:n.numero||"", valor:Number(n.valor)||0,
      data:n.data, clienteFornecedor:n.cliente_fornecedor||"", descricao:n.descricao||"",
      contatoId:n.contato_id||null
    }));
    state.contatos       = (contatos||[]).filter(doContexto).map(c => ({
      id:c.id, nome:c.nome, tipo:c.tipo||"cliente", documento:c.documento||"",
      telefone:c.telefone||"", email:c.email||""
    })).sort((a,b) => a.nome.localeCompare(b.nome, "pt-BR"));
  } catch(e) {
    // Antes só mostrava um toast e parava, deixando a tela com tudo
    // zerado pra sempre se a sessão tivesse expirado (sem deslogar nem
    // avisar direito). tratarErro já sabe fazer isso certo — inclusive
    // detectar sessão expirada e mandar pra tela de login.
    tratarErro(e);
  } finally {
    mostrarLoading(false);
  }
}

/* ============================================================
   TELA DE LOGIN / CADASTRO
   ============================================================ */

let _landingIniciada = false;

function mostrarTelaLogin() {
  // Mostra a landing, não o formulário direto.
  // O login abre como modal quando a pessoa clica em "Entrar".
  document.getElementById("landing").style.display = "block";
  document.getElementById("telaLogin").style.display = "none";
  // Faltava esconder a tela de assinatura obrigatória: quem clicava em
  // "Sair da conta" voltava pra landing, mas o cartão de assinar
  // continuava por cima (ficou visível quando o fundo virou translúcido).
  const telaAssinar = document.getElementById("telaAssinar");
  if (telaAssinar) telaAssinar.style.display = "none";
  const appLayout = document.getElementById("appLayout");
  appLayout.style.display = "none";
  appLayout.classList.remove("app-bloqueado");
  document.body.style.overflow = "";

  // Só inicia as animações depois que a landing está no fluxo,
  // senão o IntersectionObserver não mede nada.
  if (!_landingIniciada) {
    requestAnimationFrame(() => {
      iniciarLanding();
      _landingIniciada = true;
    });
  }
}

function mostrarTelaApp() {
  document.getElementById("landing").style.display = "none";
  document.getElementById("telaLogin").style.display = "none";
  const telaAssinar = document.getElementById("telaAssinar");
  if (telaAssinar) telaAssinar.style.display = "none";
  const appLayout = document.getElementById("appLayout");
  appLayout.style.display = "flex";
  appLayout.classList.remove("app-bloqueado");
  document.body.style.overflow = "";
}

/* Tela de assinatura obrigatória. Não existe mais conta grátis: quem não
   tem assinatura ativa (e não é um usuário de antes do plano único, ver
   usuarioAnteriorAoPlanoUnico) cai aqui em vez de ver o app.
   O app de verdade fica visível (borrado) atrás do cartão: mostra que é
   um produto de verdade sem soltar acesso — o cadeado cobre a tela
   inteira (pointer-events: none no .app-bloqueado) e quem trava de
   verdade é o servidor, nas APIs que exigem assinatura ativa. Os dados
   já estavam carregados na memória de qualquer forma (carregarDadosNuvem
   roda antes da decisão de mostrar o paywall), então renderizar aqui não
   expõe nada que um F12 já não expusesse. */
function mostrarTelaAssinar() {
  document.getElementById("landing").style.display = "none";
  document.getElementById("telaLogin").style.display = "none";

  const appLayout = document.getElementById("appLayout");
  appLayout.style.display = "flex";
  appLayout.classList.add("app-bloqueado");
  try { renderTudo(); trocarTela("dashboard"); } catch (e) { console.error("Falha ao renderizar o fundo da tela de assinatura:", e); }

  const tela = document.getElementById("telaAssinar");
  if (tela) tela.style.display = "flex";
  document.body.style.overflow = "hidden";
}

/* Chamada depois que os dados da nuvem (e um eventual retorno do checkout)
   já foram processados: decide se libera o app ou manda pra tela de
   assinar. Devolve true se liberou — usada nos três lugares onde uma
   sessão termina de ser estabelecida (login por senha, login social e
   restauração de sessão salva) para só rodar o resto do fluxo (render,
   onboarding, etc.) quando o app realmente vai aparecer. */
function mostrarAppOuPaywall() {
  if (planoAtual() === "basico") {
    mostrarTelaAssinar();
    return false;
  }
  mostrarTelaApp();
  return true;
}

/* ─── Cupom de desconto ───────────────────────────────────
   Preço de tabela: R$ 26,90/mês (Pessoal) e R$ 41,90/mês (Empresarial).
   O código aqui é só pra mostrar o preço na hora — quem decide de verdade
   o valor cobrado é api/criar-checkout.js, no servidor, que valida o
   código de novo antes de criar o checkout. Nunca confie só no que roda
   no navegador para valor de pagamento.
   CUPONS_PREVIA é por plano (pessoal/empresarial) porque o mesmo código
   (ORGANIZACAO) dá descontos diferentes em cada um. */
const PRECO_PLANO_CHEIO = 26.90;
const PRECO_EMPRESARIAL_CHEIO = 41.90;
const CUPONS_PREVIA = { ORGANIZACAO: { pessoal: 20.90, empresarial: 35.90 } };

// sessionStorage (não localStorage): sobrevive a um redirect (ex: login
// com Google) que recarrega a página NA MESMA aba, mas não fica aplicado
// pra sempre — fechou a aba ou voltou outro dia, precisa digitar de novo.
// Some também sempre que a tela de Planos é aberta (ver limparCupomAplicado
// em trocarTela) — cada tentativa de pagar exige digitar o cupom de novo.
let _cupomAplicado = (() => {
  try { return sessionStorage.getItem("fp_cupom") || null; } catch (e) { return null; }
})();

function _fmtPrecoBR(v) { return v.toFixed(2).replace(".", ","); }

/* Preço cheio + preço com cupom (se houver) de um dos dois planos. */
function _precoTier(tier) {
  const cheio = tier === "empresarial" ? PRECO_EMPRESARIAL_CHEIO : PRECO_PLANO_CHEIO;
  const comCupom = _cupomAplicado && CUPONS_PREVIA[_cupomAplicado]?.[tier];
  return { cheio, valor: comCupom || cheio, temCupom: !!comCupom };
}

/* Atualiza todo mundo que mostra o preço do plano na página (landing,
   cadastro, tela de assinatura, tela de planos — pessoal e empresarial),
   de acordo com o cupom aplicado no momento. Com cupom, mostra o preço
   cheio riscado do lado do novo — não só troca o número, deixa claro
   que houve desconto. */
function atualizarPrecoNaTela() {
  [
    { seletor: ".preco-plano-valor", tier: "pessoal" },
    { seletor: ".preco-plano-empresarial-valor", tier: "empresarial" }
  ].forEach(({ seletor, tier }) => {
    const p = _precoTier(tier);
    document.querySelectorAll(seletor).forEach(el => {
      if (p.temCupom) {
        el.innerHTML = `<s class="preco-riscado">${_fmtPrecoBR(p.cheio)}</s> ${_fmtPrecoBR(p.valor)}`;
      } else {
        el.textContent = _fmtPrecoBR(p.valor);
      }
    });
  });
}
atualizarPrecoNaTela();

/* Se já tinha um cupom válido de uma visita anterior (sobrevivendo ao
   redirect do login com Google), MOSTRA isso nas caixas de cupom — nunca
   deixa o preço aparecer diferente sem explicar o motivo. Sem isso, o
   preço mudava "sozinho" e parecia bug pra quem não lembrava de ter
   digitado um cupom antes (ou, pior, num navegador compartilhado).
   Cada caixa mostra o preço do SEU plano (data-tier="empresarial" ou
   pessoal, o padrão) — nunca o de outra caixa na mesma página. */
function refletirCupomSalvo() {
  if (!_cupomAplicado) return;
  document.querySelectorAll(".cupom-box").forEach(box => {
    const tier = box.dataset.tier === "empresarial" ? "empresarial" : "pessoal";
    const valorTier = CUPONS_PREVIA[_cupomAplicado]?.[tier];
    if (!valorTier) return;
    const input = box.querySelector(".cupom-input");
    const campo = box.querySelector(".cupom-campo");
    const msg = box.querySelector(".cupom-msg");
    if (input) input.value = _cupomAplicado;
    if (campo) campo.hidden = false;
    if (msg) {
      msg.textContent = `Cupom aplicado! R$ ${_fmtPrecoBR(valorTier)}/mês — menos de R$ 1 por dia.`;
      msg.className = "cupom-msg cupom-msg-ok";
    }
  });
}
refletirCupomSalvo();

// Clique em "Tem um cupom?" ou em "Aplicar" — delegado, funciona em
// qualquer uma das caixas de cupom da página (cadastro, telaAssinar, planos
// pessoal e empresarial).
document.addEventListener("click", (e) => {
  const toggle = e.target.closest(".cupom-toggle");
  if (toggle) {
    const campo = toggle.parentElement.querySelector(".cupom-campo");
    if (campo) {
      campo.hidden = !campo.hidden;
      if (!campo.hidden) campo.querySelector(".cupom-input")?.focus();
    }
    return;
  }

  const btnAplicar = e.target.closest(".cupom-aplicar");
  if (btnAplicar) {
    const box = btnAplicar.closest(".cupom-box");
    const tier = box?.dataset.tier === "empresarial" ? "empresarial" : "pessoal";
    const input = box?.querySelector(".cupom-input");
    const msg = box?.querySelector(".cupom-msg");
    if (!input || !msg) return;

    const codigo = String(input.value || "").trim().toUpperCase();
    if (!codigo) { input.focus(); return; }

    const valorTier = CUPONS_PREVIA[codigo]?.[tier];
    if (valorTier) {
      _cupomAplicado = codigo;
      try { sessionStorage.setItem("fp_cupom", codigo); } catch (e) {}
      msg.textContent = `Cupom aplicado! R$ ${_fmtPrecoBR(valorTier)}/mês — menos de R$ 1 por dia.`;
      msg.className = "cupom-msg cupom-msg-ok";
    } else {
      msg.textContent = "Cupom inválido.";
      msg.className = "cupom-msg cupom-msg-erro";
    }
    atualizarPrecoNaTela();

    // Mantém as OUTRAS caixas de cupom da página em sincronia (mesmo código
    // digitado), mas cada uma mostra o preço/mensagem do SEU próprio plano
    // — nunca copia a mensagem de uma caixa de plano diferente.
    document.querySelectorAll(".cupom-box").forEach(outraBox => {
      if (outraBox === box) return;
      const outroTier = outraBox.dataset.tier === "empresarial" ? "empresarial" : "pessoal";
      const outroInput = outraBox.querySelector(".cupom-input");
      const outraMsg = outraBox.querySelector(".cupom-msg");
      if (outroInput) outroInput.value = input.value;
      if (!outraMsg) return;
      const v = CUPONS_PREVIA[codigo]?.[outroTier];
      if (v) {
        outraMsg.textContent = `Cupom aplicado! R$ ${_fmtPrecoBR(v)}/mês — menos de R$ 1 por dia.`;
        outraMsg.className = "cupom-msg cupom-msg-ok";
      } else {
        outraMsg.textContent = "Cupom inválido.";
        outraMsg.className = "cupom-msg cupom-msg-erro";
      }
    });
    return;
  }
});

/* Esquece o cupom aplicado e limpa as caixas de cupom na tela — chamada
   toda vez que a tela de Planos é aberta (ver trocarTela). Cada visita à
   tela de Planos (assinar de novo, trocar de plano, virar Empresarial...)
   exige digitar o cupom de novo, em vez de reaproveitar um cupom aplicado
   há dias/sessões atrás sem a pessoa pedir. */
function limparCupomAplicado() {
  _cupomAplicado = null;
  try { sessionStorage.removeItem("fp_cupom"); } catch (e) {}
  document.querySelectorAll(".cupom-box").forEach(box => {
    const input = box.querySelector(".cupom-input");
    const campo = box.querySelector(".cupom-campo");
    const msg = box.querySelector(".cupom-msg");
    if (input) input.value = "";
    if (campo) campo.hidden = true;
    if (msg) { msg.textContent = ""; msg.className = "cupom-msg"; }
  });
  atualizarPrecoNaTela();
}

/* Inicia o checkout de um dos dois planos (Pessoal ou Empresarial).
   tipoConta: "pessoal" | "empresarial". Usada por assinarPlanoUnico()
   (tela de assinatura obrigatória, cadastro fundido, landing) e por
   assinarPlanoEmpresarial() (card Empresarial na tela de planos). */
async function _assinarPlano(tipoConta, btn, contentName) {
  if (!state.user || !state.user.id) {
    toast("Faça login para assinar.", "error");
    return;
  }
  const textoOriginal = btn ? btn.textContent : null;
  if (btn) { btn.disabled = true; btn.textContent = "Preparando pagamento..."; }
  else toast("Preparando pagamento...", "info");
  try {
    const resp = await fetch("/api/criar-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: state.user.email,
        nome: state.perfil?.nome || null,
        token: localStorage.getItem("fp_token") || "",
        cupom: _cupomAplicado || null,
        tipoConta
      })
    });
    const dados = await resp.json();
    if (!resp.ok) {
      toast(dados.erro || "Não foi possível iniciar o pagamento. Tente de novo.", "error");
      return;
    }

    // Troca de plano (Pessoal <-> Empresarial) de quem já assina: a
    // assinatura já foi atualizada no servidor — sem cobrança à parte
    // (diferença pequena/negativa), não tem checkout nenhum pra abrir.
    if (dados.troca && dados.semCobranca) {
      toast(dados.mensagem || "Plano trocado com sucesso!", "success");
      await carregarDadosNuvem();
      renderTudo();
      return;
    }

    if (!dados.url) {
      toast(dados.erro || "Não foi possível iniciar o pagamento. Tente de novo.", "error");
      return;
    }

    if (typeof fbq === "function") {
      try { fbq("track", "InitiateCheckout", { value: dados.valor || (tipoConta === "empresarial" ? PRECO_EMPRESARIAL_CHEIO : PRECO_PLANO_CHEIO), currency: "BRL", content_name: contentName }); } catch(e){}
    }
    // Troca de plano com diferença a cobrar: mostra o cálculo (quanto e
    // até quando) antes de mandar pro checkout da diferença.
    if (dados.troca && dados.mensagem) {
      toast(dados.mensagem, "info");
    }
    // Cupom já foi usado neste checkout — precisa digitar de novo pra
    // qualquer pagamento seguinte (outra assinatura, upgrade etc.).
    _cupomAplicado = null;
    try { sessionStorage.removeItem("fp_cupom"); } catch (e) {}
    setTimeout(() => { window.location.href = dados.url; }, dados.troca ? 1600 : 0);
  } catch (e) {
    toast("Erro de conexão. Tente novamente.", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = textoOriginal; }
  }
}

/* Inicia o checkout do plano Pessoal — usada na tela de assinatura
   obrigatória, no cadastro fundido e na landing. */
async function assinarPlanoUnico() {
  return _assinarPlano("pessoal", document.getElementById("btnAssinarAgora"), "faz_unico");
}

/* Inicia o checkout do plano Empresarial — usada no card Empresarial
   da tela de planos. Quem já tem o Empresarial não precisa passar por
   aqui de novo (evita criar uma segunda assinatura por engano). */
async function assinarPlanoEmpresarial() {
  if (state.perfil?.empresarial) {
    toast("Você já tem o plano Empresarial ativo.", "info");
    return;
  }
  return _assinarPlano("empresarial", document.getElementById("btnAssinarEmpresarial"), "faz_empresarial");
}

/* Sair a partir da tela de assinatura obrigatória, sem confirmação extra
   (quem está aqui ainda não é cliente de verdade — não tem nada "a perder"). */
function sairDaAssinatura() { fazerLogout(false); }

/* ============================================================
   RETORNO DO CHECKOUT (Asaas)
   O Asaas devolve o usuário com ?assinatura=sucesso|cancelada|expirada.
   Como o webhook pode demorar alguns segundos para liberar o plano,
   recarregamos o perfil algumas vezes antes de desistir.
   ============================================================ */
async function tratarRetornoAssinatura() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get("assinatura");
  if (!status) return false;

  // Limpa a URL para não repetir a mensagem se a pessoa recarregar a página
  window.history.replaceState({}, document.title, window.location.pathname);

  // Cancelou ou o checkout expirou: como não existe mais plano grátis, a
  // pessoa não tem "acesso pra continuar usando" — mandar pra tela de
  // assinatura obrigatória de novo seria só bater de frente com a mesma
  // trava. Volta pra landing (ela continua logada; clicar em "Assinar
  // agora" lá vai direto pro checkout de novo, sem precisar logar).
  // Devolve true pra avisar o boot que a tela já foi decidida aqui.
  if (status === "cancelada") {
    toast("Pagamento cancelado. Você pode assinar quando quiser.", "info");
    mostrarTelaLogin();
    return true;
  }
  if (status === "expirada") {
    toast("O tempo do checkout expirou. Tente assinar novamente.", "warning");
    mostrarTelaLogin();
    return true;
  }
  if (status !== "sucesso") return;

  // Pagamento aprovado: espera o webhook liberar o plano
  mostrarLoading(true, "Confirmando seu pagamento", "Isso leva alguns segundos...");
  try {
    // Tenta por ~30s. O webhook do Asaas costuma chegar em poucos segundos,
    // mas em horário de pico pode demorar um pouco mais.
    for (let tentativa = 0; tentativa < 10; tentativa++) {
      await new Promise(r => setTimeout(r, 3000));
      await carregarDadosNuvem();
      const plano = planoAtual();
      if (plano === "premium" || plano === "master") {
        renderTudo();
        mostrarLoading(false);
        toast("Pagamento confirmado! Sua assinatura já está ativa. 🎉", "success");
        return;
      }
      // Na metade do caminho, pergunta direto ao Asaas em vez de só esperar.
      // Cobre o caso do webhook falhar ou não chegar.
      if (tentativa === 4) {
        mostrarLoading(true, "Ainda confirmando", "Verificando direto com o banco...");
        try {
          const resp = await fetch("/api/confirmar-assinatura", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: state.user?.email,
              token: localStorage.getItem("fp_token") || ""
            })
          });
          const dados = await resp.json();
          console.log("Confirmação direta:", dados);
          // Mostra o diagnóstico já expandido, para não precisar clicar
          if (dados.diagnostico) {
            console.log("DIAGNÓSTICO:", JSON.stringify(dados.diagnostico, null, 2));
          }
          if (dados.ativo) {
            await carregarDadosNuvem();
            renderTudo();
            mostrarLoading(false);
            toast("Pagamento confirmado! Sua assinatura já está ativa. 🎉", "success");
            return;
          }
        } catch (e) {
          console.error("Falha na confirmação direta:", e);
        }
      }
    }
    // Passou do tempo: o pagamento pode estar em processamento
    mostrarLoading(false);
    toast(
      "Recebemos seu pagamento. A liberação pode levar alguns minutos — recarregue a página em instantes. " +
      "Se não ativar, escreva para suporte@fazfinancas.com.",
      "info"
    );
  } catch (e) {
    mostrarLoading(false);
    console.error("Erro ao confirmar assinatura:", e);
  }
}

/* Mostra o overlay de carregamento.
   mostrarLoading(true) → mensagem padrão
   mostrarLoading(true, "Lendo seu extrato", "Isso pode levar alguns segundos...") */
function mostrarLoading(ativo, titulo, sub) {
  const el = document.getElementById("loadingOverlay");
  if (!el) return;
  if (ativo) {
    const t = document.getElementById("loadingTitulo");
    const s = document.getElementById("loadingSub");
    if (t) t.textContent = titulo || "Carregando";
    if (s) s.textContent = sub || "Só um instante...";
  }
  el.style.display = ativo ? "flex" : "none";
}

/* Alternar entre login e cadastro */



/* Login */
document.getElementById("formLogin")?.addEventListener("submit", async e => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const senha = document.getElementById("loginSenha").value;
  const btn   = e.target.querySelector("button[type=submit]");
  btn.disabled = true; btn.textContent = "Entrando...";
  try {
    const data = await sbLogin(email, senha);
    localStorage.setItem("fp_token", data.access_token);
    if (data.refresh_token) localStorage.setItem("fp_refresh_token", data.refresh_token);
    localStorage.setItem("fp_user",  JSON.stringify({ email: data.user.email, id: data.user.id, createdAt: data.user.created_at || null }));
    state.user = { email: data.user.email, id: data.user.id, createdAt: data.user.created_at || null };
    document.getElementById("userEmail").textContent = state.user.email;
    iniciarRenovacaoAutomaticaDeSessao();
    await carregarDadosNuvem();
    const retornoJaDecidiuTela = await tratarRetornoAssinatura();
    if (!retornoJaDecidiuTela && mostrarAppOuPaywall()) {
      renderTudo();
      trocarTela("dashboard");
      toast(`Bem-vindo, ${email}! 👋`, "success");
      atualizarCDI().then(() => renderTudo()).catch(() => {});
      verificarExtratosPorEmail();
      // Onboarding para novo usuário
      if (!localStorage.getItem("fp_onboarding_done")) {
        setTimeout(() => mostrarOnboarding(), 600);
      }
    }
  } catch(err) {
    tratarErro(err);
  } finally {
    btn.disabled = false; btn.textContent = "Entrar";
  }
});

/* Cadastro — fundido com a assinatura: não existe mais plano grátis, então
   criar a conta já leva direto pro pagamento, sem passar pelo app antes.
   Só funciona sem esperar confirmação de e-mail porque o Supabase deste
   projeto está com autoconfirmação ligada (senão o /auth/v1/signup não
   devolveria sessão nenhuma aqui). */
document.getElementById("formCadastro")?.addEventListener("submit", async e => {
  e.preventDefault();
  // Pixel: tentou criar conta (sinal de interesse, antes de saber se deu
  // certo — ajuda a ver quem chega até aqui mesmo se travar na validação
  // ou na criação da conta em si).
  if (typeof fbq === "function") { try { fbq("track", "Lead", { content_name: "cadastro_iniciado" }); } catch(e){} }
  const email = document.getElementById("cadEmail").value.trim();
  const senha = document.getElementById("cadSenha").value;
  const conf  = document.getElementById("cadConfirmar").value;
  const aceite = document.getElementById("cadAceite")?.checked;

  if (!aceite) {
    toast("É preciso aceitar os Termos de Uso e a Política de Privacidade.", "error");
    return;
  }
  if (senha !== conf) { toast("As senhas não coincidem.", "error"); return; }
  if (senha.length < 6) { toast("A senha deve ter pelo menos 6 caracteres.", "error"); return; }
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true; btn.textContent = "Criando conta...";
  try {
    const data = await sbCadastro(email, senha);
    // Registra o consentimento (data e versão dos termos aceitos)
    localStorage.setItem("fp_consentimento", JSON.stringify({
      email, aceitoEm: new Date().toISOString(), versaoTermos: "1.0"
    }));

    if (data?.access_token && data?.user) {
      // Conta já vem confirmada e logada: manda direto pro checkout.
      localStorage.setItem("fp_token", data.access_token);
      if (data.refresh_token) localStorage.setItem("fp_refresh_token", data.refresh_token);
      localStorage.setItem("fp_user", JSON.stringify({ email: data.user.email, id: data.user.id, createdAt: data.user.created_at || null }));
      state.user = { email: data.user.email, id: data.user.id, createdAt: data.user.created_at || null };
      iniciarRenovacaoAutomaticaDeSessao();
      fecharAuth();
      await assinarPlanoUnico();
    } else {
      // Extremamente improvável com autoconfirmação ligada, mas cobre o
      // caso de ela ser desligada no futuro sem alguém lembrar de ajustar aqui.
      toast("Conta criada! Verifique seu e-mail para confirmar, depois faça login.", "success");
      mostrarTela("login");
      document.getElementById("loginEmail").value = email;
    }
  } catch(err) {
    tratarErro(err);
  } finally {
    btn.disabled = false; btn.textContent = "Criar conta e assinar";
  }
});

/* Logout — compartilhado entre o menu da conta e a tela de assinatura obrigatória */
async function fazerLogout(pedirConfirmacao = true) {
  if (pedirConfirmacao) {
    const ok = await confirmar("Sair da sua conta?", { tipo: "neutro", descricao: "Você pode entrar de novo quando quiser.", okLabel: "Sair" });
    if (!ok) return;
  }
  await sbLogout();
  state.bancos = state.movimentos = state.transferencias = state.recorrencias = state.metas = [];
  state.objetivos = state.investimentos = [];
  state.user = null;
  mostrarTelaLogin();
}
document.getElementById("btnLogout")?.addEventListener("click", () => fazerLogout(true));

/* ─── DOM refs ───────────────────────────────────────────── */
const menuItems = document.querySelectorAll(".menu-item");
const screens   = document.querySelectorAll(".screen");

const formBanco            = document.getElementById("formBanco");
const nomeBancoInput       = document.getElementById("nomeBanco");
const tipoBancoInput       = document.getElementById("tipoBanco");

// Mostra a caixa de dados do cartão quando o usuário marca "tem cartão".
document.getElementById("temCartao")?.addEventListener("change", function () {
  const box = document.getElementById("cartaoBox");
  if (box) box.style.display = this.checked ? "" : "none";
});
const saldoBancoInput      = document.getElementById("saldoBanco");

const formTexto            = document.getElementById("formTexto");
const textoLivreInput      = document.getElementById("textoLivre");
const contaMovimentoSelect = document.getElementById("contaMovimento");

// Ao mudar a forma de pagamento, mostra os campos certos.
// Crédito → escolhe cartão e parcelas (some a conta). Resto → escolhe conta.
document.getElementById("formaPagamento")?.addEventListener("change", function () {
  const ehCredito = this.value === "credito";
  const fieldConta   = document.getElementById("fieldContaMov");
  const fieldCartao  = document.getElementById("fieldCartaoMov");
  const fieldParc    = document.getElementById("fieldParcelas");
  const contaSel     = document.getElementById("contaMovimento");
  if (fieldConta)  fieldConta.style.display  = ehCredito ? "none" : "";
  if (fieldCartao) fieldCartao.style.display = ehCredito ? "" : "none";
  if (fieldParc)   fieldParc.style.display   = ehCredito ? "" : "none";
  // A conta deixa de ser obrigatória quando é crédito (usa cartão)
  if (contaSel) contaSel.required = !ehCredito;
});
const dataMovimentoInput   = document.getElementById("dataMovimento");

const formImportarExtrato  = document.getElementById("formImportarExtrato");
const contaExtratoSelect   = document.getElementById("contaExtrato");
const arquivoExtratoInput  = document.getElementById("arquivoExtrato");

const buscaMovimentoInput    = document.getElementById("buscaMovimento");
const exportarCSVBtn         = document.getElementById("exportarCSV");
const exportarCSVPlanilhaBtn = document.getElementById("exportarCSVPlanilha");

const formTransferencia    = document.getElementById("formTransferencia");
const transOrigemSelect    = document.getElementById("transOrigem");
const transDestinoSelect   = document.getElementById("transDestino");
const transValorInput      = document.getElementById("transValor");
const transDataInput       = document.getElementById("transData");
const transDescricaoInput  = document.getElementById("transDescricao");

const formRecorrencia      = document.getElementById("formRecorrencia");
const recDescricaoInput    = document.getElementById("recDescricao");
const recValorInput        = document.getElementById("recValor");
const recTipoSelect        = document.getElementById("recTipo");
const recCategoriaSelect   = document.getElementById("recCategoria");
const recContaSelect       = document.getElementById("recConta");

const formMeta             = document.getElementById("formMeta");
const metaCategoriaSelect  = document.getElementById("metaCategoria");
const metaValorInput       = document.getElementById("metaValor");

const tipoFiltroSelect       = document.getElementById("tipoFiltro");
const filtroDiaInput         = document.getElementById("filtroDia");
const filtroMesInput         = document.getElementById("filtroMes");
const filtroAnoInput         = document.getElementById("filtroAno");
const fieldFiltroDia         = document.getElementById("filtroDia");
const fieldFiltroMes         = document.getElementById("filtroMes");
const fieldFiltroAno         = document.getElementById("filtroAno");
const limparFiltrosBtn       = document.getElementById("limparFiltros");
const filtroCategoriaTabela  = document.getElementById("filtroCategoriaTabela");
const limparTudoBtn          = document.getElementById("limparTudo");

const saldoTotalDashboardEl  = document.getElementById("saldoTotalDashboard");
const saldoTotalPlanilhaEl   = document.getElementById("saldoTotalPlanilha");
const totalEntradasEl        = document.getElementById("totalEntradas");
const totalGastosEl          = document.getElementById("totalGastos");
const maiorCategoriaGastoEl  = document.getElementById("maiorCategoriaGasto");

const listaBancosEl          = document.getElementById("listaBancos");
const listaMovimentosEl      = document.getElementById("listaMovimentos");
const listaTransferenciasEl  = document.getElementById("listaTransferencias");
const listaRecorrenciasEl    = document.getElementById("listaRecorrencias");
const listaMetasEl           = document.getElementById("listaMetas");
const resumoCategoriasEl     = document.getElementById("resumoCategorias");
const resumoContasEl         = document.getElementById("resumoContas");
const resumoContasDashboard  = document.getElementById("resumoContasDashboard");
const tabelaMovimentosBody   = document.getElementById("tabelaMovimentosBody");

/* ─── Utilitários ────────────────────────────────────────── */
const fmtMoeda = v => {
  // Converte para número antes de formatar. A IA às vezes devolve o valor
  // como string ("10.50" ou "1.234,56"); sem isto, .toLocaleString quebra.
  let n = v;
  if (typeof n === "string") {
    // Trata formato brasileiro: 1.234,56 -> 1234.56
    n = n.replace(/[R$\s]/g, "").replace(/\.(?=\d{3})/g, "").replace(",", ".");
    n = parseFloat(n);
  }
  if (typeof n !== "number" || !isFinite(n)) n = 0;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};
// "pule" para o dia seguinte à noite. Usa o fuso local do dispositivo.
const hojeISO = () => {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
};
const mesAtualISO = () => hojeISO().slice(0,7);

function badge(cat) {
  const cor = corDaCategoria(cat);
  const estilo = cor ? ` style="--cat-cor:${cor}"` : "";
  const cls = cor ? "badge badge-cat badge-cat-custom" : "badge badge-cat";
  return `<span class="${cls}"${estilo}>${ICONE_CAT[cat] ?? ICONE_CAT_FALLBACK}<span>${esc(cat)}</span></span>`;
}

/* ─── Classificação ─────────────────────────────────────── */
function classificarCategoria(t) {
  t = (t || "").toLowerCase();

  // Movimentação entre contas / dinheiro vivo — não é uma categoria de gasto.
  // Fica em "Outros" de propósito: o app pergunta ao usuário na revisão.
  if (/transfer|ted\b|doc\b|saque|dep[óo]sito|deposito|pix\s*enviado|pix\s*recebido|aplica[çc][ãa]o|resgate|c[âa]mbio/.test(t)) return "Outros";

  // Alimentação (comer pronto — restaurante, delivery, lanchonete. Ver
  // "Mercado" logo abaixo pra compra de mantimentos, que é diferente.)
  if (/ifood|ifd\*|rappi|uber\s*eats|delivery|restaurante|lanchonete|pizzaria|hamburgueria|padaria|cafe|café|bar\b|boteco|comida|almoço|almoco|jantar|food|mc\s*donald|burger|subway|starbucks|doceria|sorveteria|acai|açaí|habib|bobs|outback|madero|coco\s*bambu|giraffas|spoleto|cacau\s*show|kopenhagen/.test(t)) return "Alimentação";

  // Mercado (compra pra cozinhar em casa)
  if (/mercado\b|supermercado|açougue|acougue|hortifruti|feira\b|carrefour|extra\b|assai|assaí|atacad|big\b|dia\b|sendas|zaffari|pao de acucar|pão de açúcar|hortifrut|emporio|empório/.test(t)) return "Mercado";

  // Transporte
  if (/uber|99\b|99app|99pop|cabify|indriver|taxi|táxi|ônibus|onibus|metrô|metro\b|trem|bilhete|passagem|combustível|combustivel|gasolina|álcool|alcool|etanol|posto\b|shell|ipiranga|petrobras|br\s*distribuidora|ale\b|estacionamento|estapar|pedágio|pedagio|sem\s*parar|conectcar|veloe|zona azul|bike|patinete|mecanic|oficina|pneu|lava\s*rapido|lava-rápido|ipva|licenciamento|dpvat|multa/.test(t)) return "Transporte";

  // Moradia
  if (/aluguel|condomínio|condominio|iptu|luz\b|energia|elétrica|eletrica|enel|cemig|copel|celpe|coelba|neoenergia|cpfl|equatorial|light\b|água|agua|sabesp|cedae|caesb|embasa|sanepar|saneamento|gás\b|gas\b|comgás|comgas|ultragaz|liquigas|internet|wifi|banda\s*larga|vivo|claro|tim\b|oi\b|net\b|sky\b|telefone|faxina|diarista|reforma|material\s*de\s*constru|leroy|telhanorte|c&c/.test(t)) return "Moradia";

  // Saúde
  if (/farmácia|farmacia|drogaria|drogasil|droga\s*raia|raia\b|pacheco|pague\s*menos|panvel|nissei|venancio|venâncio|remédio|remedio|médico|medico|consulta|exame|laborat|fleury|dasa|delboni|hospital|clínica|clinica|dentista|ortodont|psicólogo|psicologo|psiquiatr|terapia|plano de saúde|unimed|amil|bradesco\s*saude|sulamerica|hapvita|notredame|porto\s*seguro\s*saude|academia|smartfit|smart\s*fit|bluefit|selfit|panobianco|gympass|totalpass|pilates|crossfit|nutricionista|fisioterap|oftalmo|dermato/.test(t)) return "Saúde";

  // Lazer
  if (/cinema|cinemark|kinoplex|uci\b|netflix|spotify|disney|hbo|max\b|prime video|globoplay|paramount|apple\s*tv|deezer|tidal|youtube premium|twitch|streaming|show|ingresso|ingressoc|sympla|eventim|teatro|museu|parque|viagem|hotel|pousada|airbnb|booking|decolar|latam|gol\b|azul\b|passeio|festa|balada|pub\b|jogo|game|steam|epic\s*games|playstation|psn\b|xbox|nintendo|riot|blizzard/.test(t)) return "Lazer";

  // Educação
  if (/curso|faculdade|universidade|unip|estacio|estácio|anhanguera|uninter|puc\b|escola|colégio|colegio|mensalidade|matrícula|matricula|livro|livraria|saraiva|amazon\s*kindle|apostila|udemy|alura|udacity|coursera|hotmart|kiwify|aula|professor|idioma|inglês|ingles|wizard|ccaa|cultura\s*inglesa|fisk|duolingo/.test(t)) return "Educação";

  // Serviços / assinaturas (cuidado com a pessoa entrar aqui: salão,
  // cabeleireiro etc. agora são "Cuidados Pessoais", ver abaixo)
  if (/assinatura|lavanderia|conserto|manutenção|manutencao|técnico|tecnico|advogado|contador|contabil|chatgpt|openai|anthropic|claude|google\s*one|icloud|apple\.com|microsoft|office\s*365|adobe|canva|dropbox|notion|figma|github|hostinger|godaddy|registro\.br|vercel|aws\b|correios|cartório|cartorio|despachante/.test(t)) return "Serviços";

  // Pets (checado ANTES de "Compras" — "loja"/"shopping" ali são genéricas
  // demais e prendiam nomes de petshop tipo "Petz Loja 123" antes de chegar aqui)
  if (/petz\b|cobasi\b|pet\s*shop|petshop|ra[çc][ãa]o\b|veterinari|banho\s*e\s*tosa/.test(t)) return "Pets";

  // Vestuário (mesmo motivo — checado antes de "Compras")
  if (/roupa|calçado|calcado|sapato|tênis|tenis|vestu|renner|riachuelo|c&a\b|marisa\b|zara\b|hering|centauro|netshoes|decathlon|nike\b|adidas\b/.test(t)) return "Vestuário";

  // Cuidados Pessoais (mesmo motivo — checado antes de "Compras")
  if (/sal[ãa]o|cabeleireir|barbeir|barbearia|manicure|pedicure|estética|estetica|spa\b|massagem|sephora|boticario|boticário|natura\b|avon\b|perfumaria|cosm[ée]tic|maquiagem|depila[çc][ãa]o|podologia/.test(t)) return "Cuidados Pessoais";

  // Compras (coisas em geral — roupa, pet e cosmético já foram tratados acima)
  if (/shopping|loja|magazine|magalu|americanas|amazon|mercado\s*livre|meli\b|mercadolivre|shopee|aliexpress|shein|temu|presente|eletrônico|eletronico|celular|notebook|kabum|pichau|terabyte|fast\s*shop|casas\s*bahia|ponto\s*frio|móveis|moveis|mobly|madeiramadeira|tok\s*stok|decoração|decoracao/.test(t)) return "Compras";

  // Entrada (receitas)
  if (/salário|salario|holerite|proventos|recebi|entrou|ganhei|rendimento|dividendo|juros|cashback|estorno|reembolso|restitui|freelance|freela|honorario|honorário|comiss[ãa]o|vale\b|adiantamento|13[ºo]?\s*sal|f[ée]rias|inss|aposentadoria|pens[ãa]o|aux[íi]lio|bolsa/.test(t)) return "Entrada";

  return "Outros";
}

/* Categorização híbrida: tenta palavras-chave primeiro (grátis/instantâneo).
   Se cair em "Outros", pede ajuda à IA. Sempre retorna uma categoria válida. */
async function categorizarComIA(descricao) {
  const local = classificarCategoria(descricao);
  // Se as palavras-chave já reconheceram, usa direto (sem gastar API)
  if (local !== "Outros") return local;
  // Só chama a IA para "Entrada" não faz sentido; e descrições vazias também não
  if (!descricao || !descricao.trim()) return "Outros";
  try {
    const resp = await fetch("/api/categorizar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ descricao: descricao })
    });
    if (!resp.ok) return "Outros";
    const dados = await resp.json();
    return dados.categoria || "Outros";
  } catch (e) {
    return "Outros";
  }
}

function detectarTipo(t) {
  return /recebi|entrou|ganhei|pagamento|salário|salario|pix recebido|crédito|credito|entrada/.test(t.toLowerCase())
    ? "entrada" : "gasto";
}


/* ─── Cálculos ───────────────────────────────────────────── */


/* ============================================================
   PERFORMANCE (v10)
   - Paginação: não renderiza milhares de itens de uma vez
   - Cache de saldos: evita recalcular a mesma coisa 3x por render
   ============================================================ */

const PAGINA_TAM = 50;          // itens por página no histórico
let movsVisiveis = PAGINA_TAM;  // quantos estão sendo mostrados

/* Cache de saldos — invalidado sempre que os dados mudam */
let _cacheSaldos = null;
function invalidarCacheSaldos() { _cacheSaldos = null; }

/* Calcula o saldo de TODAS as contas de uma vez (1 passada, não N) */
function saldosPorConta() {
  if (_cacheSaldos) return _cacheSaldos;

  const hoje = hojeISO();
  const saldos = {};
  const desde = {};
  state.bancos.forEach(b => {
    saldos[b.id] = b.saldoInicial;
    desde[b.id] = b.saldoData || null;
  });

  // Uma única passada pelos movimentos
  for (const m of state.movimentos) {
    if (!ehPago(m)) continue;
    // Compras no crédito não mexem no saldo — só quando a fatura é paga
    if (m.formaPagamento === "credito") continue;
    if (saldos[m.bancoId] === undefined) continue;
    if (desde[m.bancoId] && m.data < desde[m.bancoId]) continue;
    if (m.data > hoje) continue;
    saldos[m.bancoId] += (m.tipo === "entrada" ? m.valor : -m.valor);
  }
  // Uma única passada pelas transferências
  for (const t of state.transferencias) {
    if (t.data > hoje) continue;
    if (saldos[t.destino] !== undefined && !(desde[t.destino] && t.data < desde[t.destino])) {
      saldos[t.destino] += t.valor;
    }
    if (saldos[t.origem] !== undefined && !(desde[t.origem] && t.data < desde[t.origem])) {
      saldos[t.origem] -= t.valor;
    }
  }

  _cacheSaldos = saldos;
  return saldos;
}

/* REGRA FUNDAMENTAL: só movimento PAGO afeta o saldo.
   Pendentes são compromissos futuros — não saíram/entraram ainda. */
const ehPago = m => (m.status || "pago") === "pago";
const ehPendente = m => m.status === "pendente";

function calcularSaldoBanco(id) {
  const s = saldosPorConta();
  return s[id] ?? 0;
}

/* Verifica se um gasto de `valor` cabe no saldo do banco.
   Retorna true se pode; se não, mostra aviso e retorna false.
   Contas não podem ficar negativas — o usuário deve transferir saldo antes. */
function saldoComporta(bancoId, valor) {
  const banco = state.bancos.find(b => b.id === bancoId);
  if (!banco) return true;
  const saldo = calcularSaldoBanco(bancoId);
  if (valor > saldo + 0.005) {
    const falta = valor - saldo;
    toast(
      `Saldo insuficiente em ${banco.nome}. Faltam ${fmtMoeda(falta)}. ` +
      `Registre uma transferência de outra conta antes.`,
      "error"
    );
    return false;
  }
  return true;
}

/* Verifica se uma compra no crédito cabe no limite disponível do cartão.
   Igual a um cartão de verdade: se passa do limite, a compra é recusada.
   Avisa o usuário e orienta a editar o limite do cartão, caso ele tenha
   aumentado de verdade no banco. */
function limiteComporta(cartaoId, valor) {
  const cartao = state.bancos.find(b => b.id === cartaoId);
  if (!cartao) return true;
  // Cartão sem limite definido: não há teto para checar.
  if (cartao.limite == null) return true;
  const disp = limiteDisponivel(cartaoId);
  if (disp == null) return true;
  if (valor > disp + 0.005) {
    const falta = valor - disp;
    toast(
      `Limite insuficiente no ${cartao.nome}. ` +
      `Disponível: ${fmtMoeda(disp)} — faltam ${fmtMoeda(falta)}. ` +
      `Se o seu limite aumentou, edite o cartão e atualize o limite.`,
      "error"
    );
    return false;
  }
  return true;
}

const calcularSaldoTotal = () => state.bancos.reduce((a,b)=>a+calcularSaldoBanco(b.id),0);

/* Patrimônio total = saldo de todas as contas + valor de HOJE de todos os
   investimentos (ao vivo pra cripto via valorAtualInvestimento, rendimento
   do dia já embutido pra CDB e afins). Só usado pro card do Dashboard —
   de propósito NÃO entra em calcularSaldoTotal()/saldoProjetado nem no
   resumo que a IA usa, porque ali "dinheiro líquido disponível pra pagar
   uma conta" é o que importa, e investimento não é isso. */
function calcularPatrimonioTotal() {
  const contas = calcularSaldoTotal();
  const investimentos = (state.investimentos || []).reduce((s, i) => s + valorAtualInvestimento(i), 0);
  return contas + investimentos;
}

/* Saldo total de todas as contas ATÉ uma data (inclusive).
   Usa exatamente as mesmas regras do card do dashboard: ignora compras no
   crédito, respeita a data de saldo de cada conta e conta transferências.
   É isto que o gráfico de evolução usa, para não divergir do card. */
function saldoTotalAteData(dataLimISO) {
  const saldos = {};
  const desde = {};
  state.bancos.forEach(b => {
    saldos[b.id] = b.saldoInicial;
    desde[b.id] = b.saldoData || null;
  });

  for (const m of state.movimentos) {
    if (!ehPago(m)) continue;
    if (m.formaPagamento === "credito") continue;   // crédito não mexe no saldo
    if (saldos[m.bancoId] === undefined) continue;
    if (!m.data) continue;
    if (desde[m.bancoId] && m.data < desde[m.bancoId]) continue;
    if (m.data > dataLimISO) continue;               // só até a data do ponto
    saldos[m.bancoId] += (m.tipo === "entrada" ? m.valor : -m.valor);
  }
  for (const t of state.transferencias) {
    if (!t.data || t.data > dataLimISO) continue;
    if (saldos[t.destino] !== undefined && !(desde[t.destino] && t.data < desde[t.destino])) {
      saldos[t.destino] += t.valor;
    }
    if (saldos[t.origem] !== undefined && !(desde[t.origem] && t.data < desde[t.origem])) {
      saldos[t.origem] -= t.valor;
    }
  }

  return Object.values(saldos).reduce((a,v) => a + v, 0);
}

/* ─── Avisos / Notificações ──────────────────────────────
   Calcula avisos proativos a partir dos dados do app.
   Não usa IA — é só lógica sobre vencimentos, saldos e metas. */
function formatarDataBR(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
/* ─── Avisos de EVENTO (efêmeros) ────────────────────────
   Além dos avisos derivados do estado (contas a vencer, saldo, etc.),
   registramos eventos que acontecem: importou extrato, IA respondeu.
   Ficam guardados por até 24h e aparecem no sino. */
function registrarEvento(tipo, titulo, texto, acao) {
  try {
    const dono = state.user?.id || null;
    // Lê a lista bruta (todos os donos) para não apagar de outros, mas
    // só o dono atual será exibido em lerEventos.
    let brutos;
    try { brutos = JSON.parse(localStorage.getItem("fp_eventos") || "[]"); }
    catch (e) { brutos = []; }
    brutos.unshift({
      tipo, titulo, texto,
      acao: acao || null,
      quando: Date.now(),
      dono,
      id: `${tipo}-${Date.now()}`
    });
    // Guarda no máximo 20 eventos, dos últimos 2 dias
    const corte = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const limpos = brutos.filter(e => e && e.quando >= corte).slice(0, 20);
    localStorage.setItem("fp_eventos", JSON.stringify(limpos));
    if (typeof renderSino === "function") renderSino();
  } catch (e) {}
}

function lerEventos() {
  try {
    const corte = Date.now() - 2 * 24 * 60 * 60 * 1000;
    const dono = state.user?.id || null;
    return (JSON.parse(localStorage.getItem("fp_eventos") || "[]"))
      .filter(e => e && e.quando >= corte)
      // Só mostra eventos do usuário logado (eventos antigos sem dono
      // são descartados, para não vazar entre contas).
      .filter(e => e.dono && e.dono === dono);
  } catch (e) { return []; }
}

/* Texto amigável de "há quanto tempo" */
function tempoRelativo(ts) {
  const dif = Date.now() - ts;
  const min = Math.floor(dif / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "ontem" : `há ${d} dias`;
}

function calcularAvisos() {
  const avisos = [];
  const hoje = hojeISO();
  const DIAS_AVISO = 5; // avisa contas que vencem nos próximos 5 dias
  const limiteProximo = somarDias(hoje, DIAS_AVISO);

  // 1. Contas vencidas (atrasadas) e vencendo em breve
  const compromissos = todosCompromissos(limiteProximo).filter(c => c.tipo === "gasto");
  compromissos.forEach(c => {
    const ehFatura = c.origem === "fatura";
    const dias = diasAte(c.vencimento);

    if (c.vencimento < hoje) {
      avisos.push({
        tipo: "vencida",
        titulo: ehFatura ? "Fatura atrasada" : "Conta atrasada",
        texto: `${c.descricao} venceu em ${formatarDataBR(c.vencimento)} · ${fmtMoeda(c.valor)}`,
        prioridade: 1
      });
    } else if (dias === 0) {
      avisos.push({
        tipo: "vencendo",
        titulo: ehFatura ? "Fatura vence hoje" : "Conta vence hoje",
        texto: `${c.descricao} · ${fmtMoeda(c.valor)}`,
        prioridade: 1
      });
    } else {
      avisos.push({
        tipo: "vencendo",
        titulo: ehFatura ? "Fatura a vencer" : "Conta a vencer",
        texto: `${c.descricao} vence ${dias === 1 ? "amanhã" : "em " + formatarDataBR(c.vencimento)} · ${fmtMoeda(c.valor)}`,
        prioridade: 2
      });
    }
  });

  // 1b. Limite do cartão quase no fim
  state.bancos.filter(b => b.temCartao && b.limite).forEach(cartao => {
    const disp = limiteDisponivel(cartao.id);
    if (disp == null) return;
    const usado = cartao.limite - disp;
    const pct = cartao.limite > 0 ? (usado / cartao.limite) * 100 : 0;
    if (pct >= 90) {
      avisos.push({
        tipo: "cartao",
        titulo: "Limite quase no fim",
        texto: `${cartao.nome}: restam ${fmtMoeda(disp)} de ${fmtMoeda(cartao.limite)}`,
        prioridade: 2
      });
    }
  });

  // 1b-2. Extrato(s) recebido(s) por e-mail, esperando revisão
  const pendentesEmail = state.extratosEmailPendentes || [];
  if (pendentesEmail.length) {
    avisos.push({
      tipo: "extrato",
      titulo: pendentesEmail.length === 1 ? "Extrato recebido por e-mail" : `${pendentesEmail.length} extratos recebidos por e-mail`,
      texto: "Revise e confirme antes de salvar.",
      prioridade: 2,
      sempreVisivel: true,
      acao: "abrirRevisaoExtratoEmail()"
    });
  }

  // 1c. Assinatura com problema de pagamento
  const perfilAviso = state.perfil || {};
  const statusAss = perfilAviso.assinaturaStatus || "inativa";
  const planoContratado = perfilAviso.plano || "basico";
  const nomePlanoAviso = planoContratado === "master" ? "Master"
                       : planoContratado === "premium" ? "Premium" : null;

  if (statusAss === "atrasada" && nomePlanoAviso) {
    if (dentroDaTolerancia()) {
      // Ainda dá tempo de resolver
      const diasCorte = diasAteCortePlano();
      avisos.push({
        tipo: "vencida",
        titulo: "Pagamento da assinatura falhou",
        texto: `Atualize seu cartão em ${diasCorte} ${diasCorte === 1 ? "dia" : "dias"} ou o plano ${nomePlanoAviso} será cancelado.`,
        prioridade: 1,
        sempreVisivel: true,
        acao: "trocarTela('planos')"
      });
    } else {
      // Tolerância esgotada: o acesso já caiu, mesmo que o Asaas ainda
      // não tenha mandado o evento de cancelamento.
      avisos.push({
        tipo: "vencida",
        titulo: "Plano cancelado",
        texto: `Seu pagamento atrasou e o plano ${nomePlanoAviso} foi cancelado. Assine novamente para recuperar o acesso.`,
        prioridade: 1,
        sempreVisivel: true,
        acao: "trocarTela('planos')"
      });
    }

  } else if (statusAss === "cancelada_fim_ciclo") {
    // Cancelou mas ainda está dentro do mês pago: avisa até quando tem acesso.
    const ate = perfilAviso.proximaCobranca;
    const diasRestantes = ate
      ? Math.floor((new Date(ate + "T00:00:00") - new Date(hojeISO() + "T00:00:00")) / 86400000)
      : null;
    if (diasRestantes !== null && diasRestantes >= 0) {
      const dataBonita = new Date(ate + "T00:00:00").toLocaleDateString("pt-BR");
      avisos.push({
        tipo: "cartao",
        titulo: "Assinatura cancelada",
        texto: `Sua assinatura segue ativa até ${dataBonita}. Depois dessa data, o acesso é bloqueado até você assinar de novo.`,
        prioridade: 2,
        acao: "trocarTela('planos')"
      });
    }

  } else if (statusAss === "cancelada_falta_pagamento") {
    // O Asaas encerrou a assinatura por falta de pagamento
    const perdido = perfilAviso.planoAnterior;
    const nomePerdido = perdido === "master" ? "Master"
                      : perdido === "premium" ? "Premium" : null;
    avisos.push({
      tipo: "vencida",
      titulo: "Plano cancelado",
      texto: nomePerdido
        ? `Seu pagamento atrasou e o plano ${nomePerdido} foi cancelado. Assine novamente para recuperar o acesso.`
        : "Seu pagamento atrasou e a assinatura foi cancelada. Assine novamente para recuperar o acesso.",
      prioridade: 1,
      sempreVisivel: true,
      acao: "trocarTela('planos')"
    });

  } else if (statusAss === "ativa" && nomePlanoAviso && perfilAviso.proximaCobranca) {
    // Renovação chegando: avisa com 5 dias de antecedência para a pessoa
    // conferir o cartão antes de a cobrança falhar.
    const diasRenovacao = Math.floor(
      (new Date(perfilAviso.proximaCobranca + "T00:00:00") - new Date(hojeISO() + "T00:00:00")) / 86400000
    );
    if (diasRenovacao >= 0 && diasRenovacao <= 5) {
      avisos.push({
        tipo: "cartao",
        titulo: "Renovação da assinatura",
        texto: diasRenovacao === 0
          ? `Seu plano ${nomePlanoAviso} renova hoje. Confira se o cartão está em dia.`
          : `Seu plano ${nomePlanoAviso} renova em ${diasRenovacao} ${diasRenovacao === 1 ? "dia" : "dias"}. Confira se o cartão está em dia.`,
        prioridade: 2
      });
    }
  }

  // 2. Saldo baixo ou negativo nas contas
  const saldos = saldosPorConta();
  state.bancos.forEach(b => {
    const saldo = saldos[b.id] ?? 0;
    // Conta zerada e sem nenhuma movimentação é conta nova, não problema.
    const temMovimento = state.movimentos.some(m => m.bancoId === b.id);
    if (saldo === 0 && !temMovimento) return;

    if (saldo < 0) {
      avisos.push({
        tipo: "saldo",
        titulo: "Saldo negativo",
        texto: `${b.nome} está com saldo negativo (${fmtMoeda(saldo)})`,
        prioridade: 1
      });
    } else if (saldo < 50) {
      avisos.push({
        tipo: "saldo",
        titulo: "Saldo baixo",
        texto: `${b.nome} está com saldo baixo (${fmtMoeda(saldo)})`,
        prioridade: 3
      });
    }
  });

  // 3. Metas de gasto estouradas
  const [ano, mes] = hoje.split("-");
  const gastoDaCategoria = (cat) =>
    state.movimentos
      .filter(mv => mv.tipo === "gasto" && ehPago(mv) && mv.categoria === cat
                    && mv.data.slice(0,7) === `${ano}-${mes}`)
      .reduce((s, mv) => s + mv.valor, 0);
  state.metas.forEach(meta => {
    const gasto = gastoDaCategoria(meta.categoria);
    if (gasto > meta.limite) {
      avisos.push({
        tipo: "meta",
        titulo: "Meta estourada",
        texto: `Você passou do limite de "${meta.categoria}" (${fmtMoeda(gasto)} de ${fmtMoeda(meta.limite)})`,
        prioridade: 2
      });
    }
  });

  // 4. Contas do mês ainda não pagas (resumo ao entrar no app)
  const mesAtual = hoje.slice(0, 7);
  const naoPagasDoMes = state.movimentos.filter(m =>
    m.tipo === "gasto" && ehPendente(m) && (m.data || m.vencimento || "").slice(0, 7) === mesAtual
  );
  if (naoPagasDoMes.length > 0) {
    const total = naoPagasDoMes.reduce((s, m) => s + (Number(m.valor) || 0), 0);
    avisos.push({
      tipo: "vencendo",
      titulo: `${naoPagasDoMes.length} ${naoPagasDoMes.length === 1 ? "conta" : "contas"} a pagar este mês`,
      texto: `Você tem ${fmtMoeda(total)} em contas ainda não pagas neste mês.`,
      prioridade: 2,
      acao: "trocarTela('lancamentos')"
    });
  }

  // 4b. Entradas a receber nos próximos dias (salário, recebimentos)
  const entradasProximas = todosCompromissos(limiteProximo).filter(c =>
    c.tipo === "entrada" && c.vencimento >= hoje
  );
  entradasProximas.forEach(c => {
    const dias = diasAte(c.vencimento);
    avisos.push({
      tipo: "sucesso",
      titulo: dias === 0 ? "Recebimento hoje" : "Recebimento a caminho",
      texto: dias === 0
        ? `${c.descricao} · ${fmtMoeda(c.valor)}`
        : `${c.descricao} ${dias === 1 ? "amanhã" : "em " + formatarDataBR(c.vencimento)} · ${fmtMoeda(c.valor)}`,
      prioridade: 3
    });
  });

  // 4c. Gasto muito alto num dia (bem acima do normal)
  // Compara o total gasto hoje com a média diária dos últimos 30 dias.
  // Compras no crédito ficam de fora — igual ao card de Gastos: elas só
  // contam como saída quando a fatura é paga, não no dia da compra.
  (function () {
    const ehGastoReal = m => m.tipo === "gasto" && ehPago(m) && m.formaPagamento !== "credito";
    const gastosHoje = state.movimentos.filter(m =>
      ehGastoReal(m) && (m.data || "").slice(0, 10) === hoje
    );
    const totalHoje = gastosHoje.reduce((s, m) => s + (Number(m.valor) || 0), 0);
    if (totalHoje <= 0) return;

    const ha30 = somarDias(hoje, -30);
    const gastos30 = state.movimentos.filter(m =>
      ehGastoReal(m) && (m.data || "") >= ha30 && (m.data || "") < hoje
    );
    const total30 = gastos30.reduce((s, m) => s + (Number(m.valor) || 0), 0);
    const mediaDia = total30 / 30;

    // Só avisa se há histórico e hoje passou de 3x a média (e de R$ 200)
    if (mediaDia > 0 && totalHoje >= mediaDia * 3 && totalHoje >= 200) {
      avisos.push({
        tipo: "gastoalto",
        titulo: "Gasto alto hoje",
        texto: `Você já gastou ${fmtMoeda(totalHoje)} hoje — bem acima da sua média de ${fmtMoeda(mediaDia)} por dia.`,
        prioridade: 2,
        acao: "trocarTela('lancamentos')"
      });
    }
  })();

  // 4d. Resumo semanal de gastos (aparece às segundas-feiras)
  (function () {
    const d = new Date(hoje + "T00:00:00");
    if (d.getDay() !== 1) return; // 1 = segunda
    const ha7 = somarDias(hoje, -7);
    const gastosSemana = state.movimentos.filter(m =>
      m.tipo === "gasto" && ehPago(m) && m.formaPagamento !== "credito" && (m.data || "") >= ha7 && (m.data || "") < hoje
    );
    if (!gastosSemana.length) return;
    const total = gastosSemana.reduce((s, m) => s + (Number(m.valor) || 0), 0);
    // Categoria onde mais gastou na semana
    const porCat = {};
    gastosSemana.forEach(m => { const c = m.categoria || "Outros"; porCat[c] = (porCat[c] || 0) + (Number(m.valor) || 0); });
    const top = Object.keys(porCat).sort((a, b) => porCat[b] - porCat[a])[0];
    avisos.push({
      tipo: "resumo",
      titulo: "Resumo da semana",
      texto: `Na última semana você gastou ${fmtMoeda(total)}${top ? `, mais em ${top}` : ""}.`,
      prioridade: 3,
      acao: "trocarTela('planilha')"
    });
  })();

  // 4e. Fatura do cartão fechou (dia seguinte ao fechamento)
  state.bancos.filter(b => b.temCartao && b.diaFechamento).forEach(cartao => {
    const diaHoje = Number(hoje.slice(8, 10));
    const diaAvisar = (Number(cartao.diaFechamento) % 31) + 1;
    if (diaHoje !== diaAvisar) return;
    const total = state.movimentos
      .filter(m => m.cartaoId === cartao.id && m.faturaMes === hoje.slice(0, 7))
      .reduce((s, m) => s + (Number(m.valor) || 0), 0);
    if (total > 0) {
      avisos.push({
        tipo: "cartao",
        titulo: "Fatura fechou",
        texto: `A fatura do ${cartao.nome} fechou em ${fmtMoeda(total)}. Fique de olho no vencimento.`,
        prioridade: 2
      });
    }
  });

  // 4f. Objetivo perto da meta (80% ou mais) ou já alcançado
  (state.objetivos || []).forEach(obj => {
    const alvo = Number(obj.valorAlvo) || 0;
    const atual = Number(obj.valorAtual) || 0;
    if (alvo <= 0) return;
    const pct = (atual / alvo) * 100;
    if (pct >= 100) {
      avisos.push({
        tipo: "sucesso",
        titulo: "Objetivo alcançado! 🎉",
        texto: `Você juntou tudo para "${obj.nome}" (${fmtMoeda(alvo)}). Parabéns!`,
        prioridade: 2,
        acao: "trocarTela('investimentos')"
      });
    } else if (pct >= 80) {
      avisos.push({
        tipo: "objetivo",
        titulo: "Quase lá!",
        texto: `Seu objetivo "${obj.nome}" está em ${Math.floor(pct)}% — faltam ${fmtMoeda(alvo - atual)}.`,
        prioridade: 3,
        acao: "trocarTela('investimentos')"
      });
    }
  });

  // 5. Eventos recentes (importou extrato, IA respondeu, etc.)
  lerEventos().forEach(ev => {
    avisos.push({
      tipo: ev.tipo,
      titulo: ev.titulo,
      texto: ev.texto,
      prioridade: 3,
      acao: ev.acao,
      quando: ev.quando,
      ehEvento: true
    });
  });

  // Ordena por prioridade (1 = mais urgente primeiro)
  return avisos.sort((a, b) => a.prioridade - b.prioridade);
}

/* Ícone SVG para cada tipo de aviso */
function iconeAviso(tipo) {
  const icones = {
    vencida:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    vencendo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    saldo:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`,
    meta:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
    cartao:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="6" y1="15" x2="10" y2="15"/></svg>`,
    extrato:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>`,
    ia:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/><circle cx="8.5" cy="14.5" r="1"/><circle cx="15.5" cy="14.5" r="1"/></svg>`,
    sucesso:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    gastoalto: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 6l-9.5 9.5-5-5L1 18"/><polyline points="17 6 23 6 23 12"/></svg>`,
    resumo:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
    objetivo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`
  };
  return icones[tipo] || icones.vencendo;
}

/* Ícone de exclamação para avisos importantes (prioridade 1) */
function iconeImportante() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
}

/* Renderiza o sino: contador + lista no painel */
function renderSino() {
  const contador = document.getElementById("sinoContador");
  const lista = document.getElementById("sinoLista");
  if (!contador || !lista) return;

  // Se qualquer regra de aviso falhar, o sino fica limpo em vez de
  // congelar num número velho que não corresponde a nada.
  let avisos;
  try {
    avisos = calcularAvisos();
  } catch (err) {
    console.error("Erro ao calcular avisos:", err);
    avisos = [];
  }

  // Sem nenhum aviso: o sino fica limpo, sem número. Ponto.
  if (avisos.length === 0) {
    contador.hidden = true;
    contador.textContent = "0";
    lista.innerHTML = `<div class="sino-vazio">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      <p>Tudo em dia!</p>
      <span>Nenhum aviso no momento.</span>
    </div>`;
    return;
  }

  // O contador mostra o que ainda não foi lido — mas avisos críticos
  // (assinatura em risco ou cancelada) contam sempre, mesmo já vistos.
  // Silenciar um problema de pagamento seria esconder algo que custa dinheiro.
  const lidos = lerAvisosLidos();
  const naoLidos = avisos.filter(a => a.sempreVisivel || !lidos.has(chaveAviso(a)));

  if (naoLidos.length > 0) {
    contador.textContent = naoLidos.length > 9 ? "9+" : String(naoLidos.length);
    contador.hidden = false;
  } else {
    contador.hidden = true;
    contador.textContent = "0";
  }

  lista.innerHTML = avisos.map(a => {
    // Críticos ficam sempre destacados; os demais só até serem lidos
    const novo = a.sempreVisivel || !lidos.has(chaveAviso(a));
    // Avisos com ação viram botão; os demais são só informativos
    const clicavel = a.acao ? ` sino-item-clicavel" onclick="${a.acao}` : "";
    // Prioridade 1 = importante: ganha borda/cor de destaque e exclamação
    const importante = a.prioridade === 1;
    const iconeHtml = importante ? iconeImportante() : iconeAviso(a.tipo);
    return `
    <div class="sino-item sino-item-${a.tipo} ${importante ? "sino-item-importante" : ""} ${novo ? "sino-item-novo" : ""}${clicavel}">
      <div class="sino-item-icone">${iconeHtml}</div>
      <div class="sino-item-texto">
        <strong>${a.titulo}</strong>
        <span>${esc(a.texto)}</span>
        ${a.ehEvento && a.quando ? `<time class="sino-item-tempo">${tempoRelativo(a.quando)}</time>` : ""}
      </div>
      ${a.acao ? `<svg class="sino-item-seta" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>` : ""}
    </div>`;
  }).join("");
}

/* Liga os cliques do sino (abrir/fechar painel) */
/* ─── Avisos lidos ────────────────────────────────────────
   Guarda a "assinatura" de cada aviso já visto. Enquanto a situação
   não muda, o aviso não conta como novo. Se surgir um aviso diferente
   (ou o valor mudar), ele volta a aparecer no contador. */
function lerAvisosLidos() {
  try { return new Set(JSON.parse(localStorage.getItem("fp_avisos_lidos") || "[]")); }
  catch (e) { return new Set(); }
}

function gravarAvisosLidos(chaves) {
  try { localStorage.setItem("fp_avisos_lidos", JSON.stringify([...chaves])); }
  catch (e) {}
}

/* Assinatura única de um aviso: tipo + texto. Se o texto mudar
   (valor, data), vira um aviso novo — e volta a notificar. */
function chaveAviso(a) {
  return `${a.tipo}|${a.texto}`;
}

/* Marca tudo que está na tela como lido e atualiza o sino */
function marcarAvisosLidos() {
  const avisos = calcularAvisos();
  // Guarda só as assinaturas dos avisos ATUAIS. Assim o registro não
  // acumula lixo de avisos que já sumiram (conta paga, saldo recuperado).
  gravarAvisosLidos(new Set(avisos.map(chaveAviso)));
  renderSino();   // re-renderiza: contador e lista sempre saem do mesmo cálculo
}

function initSino() {
  const btn = document.getElementById("sinoBtn");
  const painel = document.getElementById("sinoPainel");
  if (!btn || !painel) return;

  // Estado inicial: nunca deixa o contador com valor do HTML
  renderSino();

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const abrindo = painel.hidden;
    if (abrindo) {
      // Recalcula na hora de abrir — a situação pode ter mudado
      // desde o último render (conta paga, tempo passando, etc.)
      renderSino();
      painel.hidden = false;
      marcarAvisosLidos();
      // Também checa se chegou algum extrato por e-mail — antes isso só
      // rodava no login/carregamento da página, então quem já estava com
      // o app aberto numa aba (e mandou o e-mail depois) só via a
      // pendência recarregando a página. Abrir o sino é um bom gatilho
      // natural: a pessoa está literalmente checando se tem algo novo.
      verificarExtratosPorEmail();
    } else {
      painel.hidden = true;
    }
  });
  // Fecha ao clicar fora
  document.addEventListener("click", (e) => {
    if (!painel.hidden && !painel.contains(e.target) && !btn.contains(e.target)) {
      painel.hidden = true;
    }
  });
}
const vencDe = m => m.vencimento || m.data;

/* Dias até vencer. Negativo = atrasado. */
function diasAteVencer(m) {
  const hoje = new Date(hojeISO() + "T00:00:00");
  const venc = new Date(vencDe(m) + "T00:00:00");
  return Math.round((venc - hoje) / 86400000);
}

const estaAtrasado = m => ehPendente(m) && diasAteVencer(m) < 0;

/* Todos os pendentes, ordenados por vencimento */
function listarPendentes() {
  return state.movimentos
    .filter(ehPendente)
    .sort((a,b) => vencDe(a).localeCompare(vencDe(b)));
}

/* Compromissos unificados: lançamentos avulsos pendentes + recorrências não pagas.
   Retorna todos no mesmo formato para a UI. */
/* O horizonte que o dashboard enxerga.
   Padrão: só o mês atual — mostrar 3 Netflix (jul, ago, set) é ruído,
   não informação. Quem quiser ver o futuro escolhe o período. */
let periodoDash = "mes";

/* Data escolhida à mão pelo usuário (null = usa o período dos botões) */
let dataLimiteDash = null;

function limiteDoPeriodo() {
  // Data personalizada tem prioridade sobre os botões
  if (dataLimiteDash) return dataLimiteDash;

  const hoje = hojeISO();
  const [a, m] = hoje.split("-").map(Number);
  const ultimoDia = (ano, mes) => new Date(ano, mes, 0).getDate();

  switch (periodoDash) {
    case "proximo": {
      // Até o fim do mês que vem
      const d = new Date(a, m, 1);           // mês seguinte
      const ano = d.getFullYear(), mes = d.getMonth() + 1;
      return `${ano}-${String(mes).padStart(2,"0")}-${ultimoDia(ano, mes)}`;
    }
    case "3meses":
      return somarMeses(hoje, 3);
    case "tudo":
      return somarMeses(hoje, 12);           // um ano à frente já basta
    case "mes":
    default:
      // Até o último dia deste mês
      return `${a}-${String(m).padStart(2,"0")}-${ultimoDia(a, m)}`;
  }
}

/* Todas as faturas de cartão ainda não pagas — de QUALQUER mês, inclusive
   a que ainda está em aberto (não fechou ainda). Sem filtro de período:
   quem usa isso decide se aplica algum corte. Compartilhado entre
   todosCompromissos() (que corta pelo período escolhido) e o card "A
   pagar" do Dashboard (que conta essa dívida sempre — ver totaisCompromissos). */
function faturasCartaoNaoPagas() {
  const itens = [];
  state.bancos.filter(b => b.temCartao).forEach(cartao => {
    const pagas = new Set((state.faturasPagas || [])
      .filter(f => f.cartaoId === cartao.id)
      .map(f => f.faturaMes));
    const porMes = {};
    state.movimentos
      .filter(m => m.cartaoId === cartao.id && !pagas.has(m.faturaMes))
      .forEach(m => { porMes[m.faturaMes] = (porMes[m.faturaMes] || 0) + m.valor; });

    Object.keys(porMes).forEach(fm => {
      if (porMes[fm] <= 0) return;
      itens.push({
        origem: "fatura",
        id: `fatura|${cartao.id}|${fm}`,
        cartaoId: cartao.id,
        faturaMes: fm,
        descricao: `Fatura ${cartao.nome}`,
        valor: porMes[fm],
        tipo: "gasto",
        categoria: "Cartão de Crédito",
        contaId: cartao.id,
        vencimento: vencimentoDaFatura(fm, cartao)
      });
    });
  });
  return itens;
}

function todosCompromissos(ateISO) {
  const limite = ateISO || limiteDoPeriodo();

  // 1. Lançamentos avulsos marcados como pendentes (dentro do período)
  const avulsos = listarPendentes()
    .filter(m => vencDe(m) <= limite)
    .map(m => ({
      origem: "avulso",
      id: m.id,
      descricao: m.descricao,
      valor: m.valor,
      tipo: m.tipo,
      categoria: m.categoria,
      contaId: m.bancoId,
      vencimento: vencDe(m)
    }));

  // 2. Ocorrências de recorrências ainda não pagas
  const recorrentes = ocorrenciasNaJanela("2000-01-01", limite)
    .filter(o => !o.pago)
    .map(o => ({
      origem: "recorrente",
      id: `${o.rec.id}|${o.vencimento}`,
      recId: o.rec.id,
      descricao: o.rec.descricao,
      valor: o.valor,
      tipo: o.rec.tipo,
      categoria: o.rec.categoria,
      contaId: o.rec.contaId,
      vencimento: o.vencimento
    }));

  // 3. Faturas de cartão em aberto, dentro do período escolhido
  const faturasCartao = faturasCartaoNaoPagas().filter(f => f.vencimento <= limite);

  return [...avulsos, ...recorrentes, ...faturasCartao].sort((a,b) => a.vencimento.localeCompare(b.vencimento));
}

const diasAte = v => Math.round((new Date(v+"T00:00:00") - new Date(hojeISO()+"T00:00:00")) / 86400000);

/* Totais de compromissos — inclui lançamentos avulsos E recorrências não pagas */
function totaisCompromissos() {
  // Faturas de cartão contam sempre no "a pagar", mesmo com vencimento fora
  // do período escolhido no Dashboard — é dívida real, a pessoa vai pagar
  // de qualquer forma, então já mostra o saldo em aberto do cartão desde
  // já em vez de só quando a fatura "vencer". As que já estavam dentro do
  // período (via todosCompromissos) não entram duplicadas.
  const pend = todosCompromissos();
  const faturasForaDoPeriodo = faturasCartaoNaoPagas().filter(f => !pend.some(p => p.id === f.id));
  const todos = [...pend, ...faturasForaDoPeriodo].sort((a,b) => a.vencimento.localeCompare(b.vencimento));

  const aPagar   = todos.filter(m=>m.tipo==="gasto").reduce((a,m)=>a+m.valor, 0);
  const aReceber = todos.filter(m=>m.tipo==="entrada").reduce((a,m)=>a+m.valor, 0);
  const atrasados = todos.filter(m => diasAte(m.vencimento) < 0);
  const proximos7 = todos.filter(m => { const d = diasAte(m.vencimento); return d >= 0 && d <= 7; });
  return {
    aPagar, aReceber,
    saldoProjetado: calcularSaldoTotal() - aPagar + aReceber,
    atrasados, proximos7,
    qtdPendentes: todos.length,
    lista: todos
  };
}

function calcularTotais(movs = state.movimentos) {
  const pagos = movs.filter(ehPago);   // pendentes não entram nos totais realizados
  return {
    entradas: pagos.filter(m=>m.tipo==="entrada").reduce((a,m)=>a+m.valor,0),
    gastos:   pagos.filter(m=>m.tipo==="gasto").reduce((a,m)=>a+m.valor,0)
  };
}

/* ─── Selects de contas ─────────────────────────────────── */
function atualizarSelectContas() {
  const empty = `<option value="">Cadastre uma conta primeiro</option>`;
  // Todas as contas servem para débito/pix/dinheiro
  const ok = state.bancos.length > 0;
  const opts = state.bancos.map(b=>`<option value="${b.id}">${esc(b.nome)} · ${esc(b.tipo)}</option>`).join("");
  [contaMovimentoSelect, contaExtratoSelect, transOrigemSelect, transDestinoSelect, recContaSelect]
    .forEach(s => { if(s){ s.innerHTML = ok ? opts : empty; s.disabled = !ok; } });

  // Select de crédito: só bancos que têm cartão habilitado
  const cartaoSelect = document.getElementById("cartaoMovimento");
  if (cartaoSelect) {
    const comCartao = state.bancos.filter(b => b.temCartao);
    cartaoSelect.innerHTML = comCartao.length
      ? comCartao.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join("")
      : `<option value="">Nenhuma conta com cartão</option>`;
  }

  // Reseleciona a última conta usada na importação de extrato
  if (contaExtratoSelect && ok) {
    const ultima = localStorage.getItem("fp_ultima_conta_extrato");
    if (ultima && state.bancos.some(b => b.id === ultima)) {
      contaExtratoSelect.value = ultima;
    }
  }

  // Select de instituição do investimento (permite "não informar")
  const invContaSelect = document.getElementById("invConta");
  if (invContaSelect) {
    invContaSelect.innerHTML = ok
      ? `<option value="">Não informar</option>` + opts
      : `<option value="">Cadastre uma conta primeiro</option>`;
    invContaSelect.disabled = false;
  }
}

/* ─── Filtros planilha ────────────────────────────────────── */
function obterMovimentosFiltrados() {
  let movs = [...state.movimentos];
  const t = tipoFiltroSelect?.value;
  if (t==="dia" && filtroDiaInput?.value) movs = movs.filter(m=>m.data===filtroDiaInput.value);
  if (t==="mes" && filtroMesInput?.value) movs = movs.filter(m=>m.data.startsWith(filtroMesInput.value));
  if (t==="ano" && filtroAnoInput?.value) movs = movs.filter(m=>m.data.startsWith(filtroAnoInput.value.trim()));
  return movs;
}

const obterMovimentosTabelaFiltrados = () => {
  const c = filtroCategoriaTabela?.value;
  return !c||c==="todas" ? obterMovimentosFiltrados() : obterMovimentosFiltrados().filter(m=>m.categoria===c);
};

function atualizarCamposFiltro() {
  fieldFiltroDia?.classList.add("hidden-filter");
  fieldFiltroMes?.classList.add("hidden-filter");
  fieldFiltroAno?.classList.add("hidden-filter");
  const t = tipoFiltroSelect?.value;
  if (t==="dia") fieldFiltroDia?.classList.remove("hidden-filter");
  if (t==="mes") fieldFiltroMes?.classList.remove("hidden-filter");
  if (t==="ano") fieldFiltroAno?.classList.remove("hidden-filter");
}

/* ──────────────────────────────────────────────────────────
   RENDER FUNCTIONS
   ────────────────────────────────────────────────────────── */

function renderResumoDashboard() {
  // Entradas e gastos do PERÍODO selecionado no topo do gráfico.
  // Compras no crédito ficam de fora: elas contam quando a fatura é paga.
  const { ini, fim } = intervaloPeriodoDashboard();
  const doPeriodo = state.movimentos.filter(m => {
    const d = (m.data || "").slice(0, 10);
    return d && d >= ini && d <= fim && m.formaPagamento !== "credito";
  });
  const { entradas, gastos } = calcularTotais(doPeriodo);

  if(saldoTotalDashboardEl) saldoTotalDashboardEl.textContent = fmtMoeda(saldoTotalAteData(fim));
  if(totalEntradasEl)       totalEntradasEl.textContent       = fmtMoeda(entradas);
  if(totalGastosEl)         totalGastosEl.textContent         = fmtMoeda(gastos);
  const elPatrimonioTotal = document.getElementById("patrimonioTotalDashboard");
  if (elPatrimonioTotal) elPatrimonioTotal.textContent = fmtMoeda(calcularPatrimonioTotal());

  // Atualiza os textos "neste mês" conforme o período
  const rotulo = rotuloPeriodoDashboard();
  const descEnt = document.querySelector("#totalEntradas + .card-desc");
  const descGas = document.querySelector("#totalGastos + .card-desc");
  if (descEnt) descEnt.textContent = `Recebido ${rotulo}`;
  if (descGas) descGas.textContent = `Gasto ${rotulo}`;

  // Mantém o rótulo do seletor de período sincronizado
  if (typeof window._atualizarLabelPeriodo === "function") {
    try { window._atualizarLabelPeriodo(); } catch (e) {}
  }
}

/* Intervalo [ini, fim] em ISO conforme o período escolhido no dashboard.
   É a mesma escolha do gráfico de evolução (_periodoTipo / _periodoDatas). */
function intervaloPeriodoDashboard() {
  const hoje = new Date();
  const pad2 = n => String(n).padStart(2, "0");
  const iso = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  const hojeZero = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());

  if (_periodoDatas) return { ini: _periodoDatas.de, fim: _periodoDatas.ate };
  if (_periodoTipo === "mesanterior") {
    const i = new Date(hoje.getFullYear(), hoje.getMonth()-1, 1);
    const f = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
    return { ini: iso(i), fim: iso(f) };
  }
  if (_periodoTipo === "proximomes") {
    const i = new Date(hoje.getFullYear(), hoje.getMonth()+1, 1);
    const f = new Date(hoje.getFullYear(), hoje.getMonth()+2, 0);
    return { ini: iso(i), fim: iso(f) };
  }
  if (_periodoTipo === "tudo") {
    const datas = state.movimentos.map(m => m.data).filter(Boolean).sort();
    return { ini: datas[0] || iso(hojeZero), fim: iso(hojeZero) };
  }
  // "mes" (padrão): o mês inteiro (dia 1 ao último dia)
  const iniMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fimMes = new Date(hoje.getFullYear(), hoje.getMonth()+1, 0);
  return { ini: iso(iniMes), fim: iso(fimMes) };
}

/* Rótulo curto do período, para os cards ("neste mês", etc.) */
function rotuloPeriodoDashboard() {
  if (_periodoDatas) return "no período";
  return {
    mes: "neste mês", mesanterior: "no mês anterior",
    proximomes: "no próximo mês", tudo: "no total"
  }[_periodoTipo] || "neste mês";
}

/* Mês de fatura (AAAA-MM) que o widget "Cartões de crédito" do dashboard
   deve mostrar, conforme o período escolhido. Só existe um mês único pra
   "este mês", "mês anterior" e "próximo mês" — nesses casos mostramos
   exatamente a fatura daquele mês (que pode ser R$ 0,00, e é isso mesmo:
   antes disso aqui, o widget ficava travado sempre na fatura real atual,
   ignorando o filtro). Em "tudo" ou período customizado não há um mês
   único pra mostrar, então cai no padrão (fatura em aberto mais próxima). */
function faturaAlvoDashboard() {
  if (_periodoDatas) return null;
  const hoje = new Date();
  const pad2 = n => String(n).padStart(2, "0");
  const mesISO = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}`;
  if (_periodoTipo === "mesanterior") return mesISO(new Date(hoje.getFullYear(), hoje.getMonth()-1, 1));
  if (_periodoTipo === "proximomes")  return mesISO(new Date(hoje.getFullYear(), hoje.getMonth()+1, 1));
  if (_periodoTipo === "mes")         return mesISO(hoje);
  return null; // "tudo"
}

/* A fatura "a pagar" mais próxima: a primeira fatura não paga, da mais antiga
   para a mais nova. Se o mês atual tem compras, é ele; senão, a próxima que tiver. */
function proximaFaturaAberta(cartaoId) {
  const pagas = new Set((state.faturasPagas || [])
    .filter(f => f.cartaoId === cartaoId)
    .map(f => f.faturaMes));
  const meses = [...new Set(state.movimentos
    .filter(m => m.cartaoId === cartaoId && !pagas.has(m.faturaMes))
    .map(m => m.faturaMes))].sort();
  return meses[0] || mesAtualISO();
}

/* Data de vencimento de uma fatura (AAAA-MM) de um cartão.
   A fatura fecha no dia de fechamento e vence depois disso.
   Se o dia de vencimento vem DEPOIS do fechamento, vence no mesmo mês.
   Se vem antes ou no mesmo dia, só pode ser no mês seguinte.
   Ex: fecha 20, vence 28 -> fatura de julho vence 28/07.
       fecha 20, vence 10 -> fatura de julho vence 10/08. */
function vencimentoDaFatura(faturaMes, cartao) {
  const [a, m] = faturaMes.split("-").map(Number);
  const diaVenc = cartao?.diaVencimento || 10;
  const diaFech = cartao?.diaFechamento || 0;

  let ano = a, mes = m;
  if (diaFech && diaVenc <= diaFech) {
    mes += 1;
    if (mes > 12) { mes = 1; ano += 1; }
  }
  // Respeita meses curtos (ex: vencimento dia 31 em fevereiro)
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const dia = Math.min(diaVenc, ultimoDia);
  return `${ano}-${String(mes).padStart(2,"0")}-${String(dia).padStart(2,"0")}`;
}

/* Uma fatura está paga? */
function faturaEstaPaga(cartaoId, faturaMes) {
  return (state.faturasPagas || []).some(f => f.cartaoId === cartaoId && f.faturaMes === faturaMes);
}

/* "Saldo" de uma conta pra exibição no card de "Saldo por conta" — soma o
   saldo líquido dela com o valor de HOJE de todo investimento vinculado a
   ela (ex: cripto guardada numa carteira/corretora, como a "Trust" que só
   serve de etiqueta pros investimentos e por isso tinha saldo próprio
   zerado). Só pra exibição: saldoComporta(), saldoProjetado() e o resto
   da lógica financeira de verdade continuam usando só o dinheiro líquido
   (calcularSaldoBanco), sem isso — senão contaria o investimento em dobro
   em outros lugares que dependem de "dinheiro disponível pra gastar". */
function saldoVisivelConta(bancoId) {
  const liquido = calcularSaldoBanco(bancoId);
  const investimentos = (state.investimentos || [])
    .filter(i => i.contaId === bancoId)
    .reduce((s, i) => s + valorAtualInvestimento(i), 0);
  return liquido + investimentos;
}

function renderContasDashboard() {
  if (!resumoContasDashboard) return;
  if (!state.bancos.length) {
    resumoContasDashboard.innerHTML = vazio(
      ICO.conta,
      "Comece cadastrando uma conta",
      "Nubank, Itaú, carteira física — informe o saldo atual de cada uma.",
      { texto: "Cadastrar conta", onclick: "irParaContas()" }
    );
    return;
  }
  const saldos = state.bancos.map(b => ({ b, s: saldoVisivelConta(b.id) }));
  const saldoTotalVisivel = saldos.reduce((acc, x) => acc + x.s, 0);
  resumoContasDashboard.innerHTML = `<div class="bancos-cards-grid">` +
    saldos.map(({ b, s }) => {
      const pct = saldoTotalVisivel !== 0 ? ((s / saldoTotalVisivel) * 100).toFixed(1) : "0.0";
      const cls = s > 0 ? "positivo" : s < 0 ? "negativo" : "";
      return `<div class="banco-card">
        <div class="banco-card-top">
          <span class="banco-card-nome">${marcaConta(b, "sm")}${(() => {
            const nc = nomeConta(b);
            return esc(nc.base) + (nc.apelido
              ? ` <span class="conta-apelido">${esc(nc.apelido)}</span>`
              : "");
          })()}</span>
          <span class="banco-card-tipo">${esc(b.tipo)}</span>
        </div>
        <div class="banco-card-divider"></div>
        <div class="banco-card-saldo ${cls}">${fmtMoeda(s)}</div>
        <div class="banco-card-pct">${pct}% do total</div>
      </div>`;
    }).join("") + `</div>` + renderCartoesDashboard();
}

/* ============================================================
   TELA DO CARTÃO — fatura detalhada e pagamento
   ============================================================ */
let _cartaoAberto = null;
let _faturaMesForcada = null;   // quando aberto a partir de um card já filtrado por período

// faturaMesForcado é opcional: abre direto na fatura daquele mês (AAAA-MM)
// em vez da fatura em aberto mais próxima. Usado pelo card do dashboard
// quando o usuário está filtrando por "mês anterior"/"próximo mês", pra
// abrir exatamente o mês que ele estava vendo.
function abrirTelaCartao(cartaoId, faturaMesForcado) {
  _cartaoAberto = cartaoId;
  _faturaMesForcada = faturaMesForcado || null;
  renderTelaCartao();
  document.getElementById("cartaoOverlay").style.display = "flex";
  document.body.style.overflow = "hidden";
}
function fecharTelaCartao() {
  document.getElementById("cartaoOverlay").style.display = "none";
  document.body.style.overflow = "";
  _cartaoAberto = null;
  _faturaMesForcada = null;
}

function renderTelaCartao() {
  const c = state.bancos.find(b => b.id === _cartaoAberto);
  if (!c) return;
  const corpo = document.getElementById("cartaoCorpo");
  if (!corpo) return;

  const faturaMes = _faturaMesForcada || proximaFaturaAberta(c.id);
  const paga = faturaEstaPaga(c.id, faturaMes);
  const totalAtual = totalFatura(c.id, faturaMes);
  const disponivel = limiteDisponivel(c.id);

  // Lançamentos da fatura atual
  const itens = state.movimentos
    .filter(m => m.cartaoId === c.id && m.faturaMes === faturaMes)
    .sort((a, b) => String(a.data).localeCompare(String(b.data)));

  // Próximas faturas (parcelas futuras)
  const futuras = {};
  state.movimentos
    .filter(m => m.cartaoId === c.id && m.faturaMes > faturaMes)
    .forEach(m => { futuras[m.faturaMes] = (futuras[m.faturaMes] || 0) + m.valor; });

  const [ano, mes] = faturaMes.split("-");
  const nomesMes = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  const tituloFatura = `${nomesMes[Number(mes)-1]} de ${ano}`;
  const vencFatura = vencimentoDaFatura(faturaMes, c);
  const diasVenc = diasAte(vencFatura);
  const vencTxt = diasVenc < 0
    ? `venceu há ${Math.abs(diasVenc)} ${Math.abs(diasVenc) === 1 ? "dia" : "dias"}`
    : diasVenc === 0 ? "vence hoje"
    : diasVenc === 1 ? "vence amanhã"
    : `vence em ${diasVenc} dias`;

  corpo.innerHTML = `
    <div class="cartao-modal-head">
      <div>
        <div class="cartao-modal-nome">${esc(c.nome)}</div>
        <div class="cartao-modal-sub">Fatura de ${tituloFatura} · ${vencTxt} (${vencFatura.slice(8,10)}/${vencFatura.slice(5,7)})</div>
      </div>
      <button class="revisao-fechar" onclick="fecharTelaCartao()" aria-label="Fechar">✕</button>
    </div>

    <div class="cartao-resumo-box">
      <div class="cartao-resumo-item">
        <span class="cartao-resumo-label">Fatura atual</span>
        <span class="cartao-resumo-valor">${fmtMoeda(totalAtual)}</span>
      </div>
      ${c.limite ? `
        <div class="cartao-resumo-item">
          <span class="cartao-resumo-label">Limite disponível</span>
          <span class="cartao-resumo-valor">${fmtMoeda(disponivel ?? 0)}</span>
        </div>
        <div class="cartao-resumo-item">
          <span class="cartao-resumo-label">Limite total</span>
          <span class="cartao-resumo-valor">${fmtMoeda(c.limite)}</span>
        </div>` : ""}
    </div>

    ${paga
      ? `<div class="cartao-fatura-paga">✓ Esta fatura já foi paga</div>`
      : (totalAtual > 0
          ? `<button class="btn-primary cartao-btn-pagar" onclick="abrirPagarFatura('${c.id}','${faturaMes}')">Pagar fatura · ${fmtMoeda(totalAtual)}</button>`
          : `<div class="cartao-fatura-vazia">Nenhuma compra nesta fatura ainda.</div>`)
    }

    ${itens.length ? `
      <div class="cartao-lista-titulo">Compras desta fatura</div>
      <div class="cartao-lista">
        ${itens.map(m => `
          <div class="cartao-item">
            <span class="cartao-item-data">${esc((m.data||"").slice(8,10))}/${esc((m.data||"").slice(5,7))}</span>
            <span class="cartao-item-desc">${esc(m.descricao)}</span>
            <span class="cartao-item-val">${fmtMoeda(m.valor)}</span>
            <button class="btn-acao btn-acao-danger" onclick="excluirItemFatura('${m.id}')" title="Excluir (ex: fatura duplicada)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            </button>
          </div>
        `).join("")}
      </div>` : ""}

    ${Object.keys(futuras).length ? `
      <div class="cartao-lista-titulo">Próximas faturas</div>
      <div class="cartao-futuras">
        ${Object.keys(futuras).sort().map(fm => {
          const [a, mm] = fm.split("-");
          return `<div class="cartao-futura-item">
            <span>${nomesMes[Number(mm)-1]}/${a.slice(2)}</span>
            <span>${fmtMoeda(futuras[fm])}</span>
          </div>`;
        }).join("")}
      </div>` : ""}
  `;
}

/* Exclui uma compra/lançamento de dentro da fatura aberta (ex: fatura
   duplicada por engano). excluirMovimento() já confirma, apaga e chama
   renderTudo() — só falta atualizar essa tela do cartão, que é um overlay
   à parte e não faz parte da varredura normal de render. */
async function excluirItemFatura(id) {
  await excluirMovimento(id);
  if (_cartaoAberto) renderTelaCartao();
}

/* Pagar a fatura: pergunta de qual conta sai o dinheiro */
function abrirPagarFatura(cartaoId, faturaMes) {
  const banco = state.bancos.find(b => b.id === cartaoId);
  if (!banco) return;
  const total = totalFatura(cartaoId, faturaMes);
  const saldo = calcularSaldoBanco(cartaoId);
  const cobre = saldo >= total - 0.005;

  const corpo = document.getElementById("cartaoCorpo");
  corpo.innerHTML = `
    <div class="cartao-modal-head">
      <div class="cartao-modal-nome">Pagar fatura</div>
      <button class="revisao-fechar" onclick="renderTelaCartao()" aria-label="Voltar">✕</button>
    </div>
    <p class="cartao-pagar-info">Valor da fatura: <strong>${fmtMoeda(total)}</strong></p>
    <div class="cartao-pagar-conta">
      Será debitada da conta <strong>${esc(banco.nome)}</strong><br>
      <span class="cartao-pagar-saldo ${cobre ? "" : "insuf"}">Saldo atual: ${fmtMoeda(saldo)}</span>
    </div>
    ${cobre
      ? `<div class="cartao-pagar-acoes">
           <button class="btn-ghost" onclick="renderTelaCartao()">Cancelar</button>
           <button class="btn-primary" id="btnConfirmarPagarFatura" onclick="confirmarPagarFatura('${cartaoId}','${faturaMes}',${total})">Confirmar pagamento</button>
         </div>`
      : `<div class="cartao-pagar-aviso">
           <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="10"/></svg>
           Saldo insuficiente para pagar esta fatura. Faltam ${fmtMoeda(total - saldo)}.
           Registre uma transferência de outra conta para ${esc(banco.nome)} antes de pagar.
         </div>
         <div class="cartao-pagar-acoes">
           <button class="btn-ghost" onclick="renderTelaCartao()">Voltar</button>
           <button class="btn-primary" onclick="fecharTelaCartao(); trocarTela('transferencias')">Ir para transferências</button>
         </div>`
    }
  `;
}

let _pagandoFatura = false;
async function confirmarPagarFatura(cartaoId, faturaMes, valor) {
  if (_pagandoFatura) return;
  // Paga pela própria conta do banco do cartão
  const contaId = cartaoId;

  // Bloqueio: a conta precisa ter saldo para cobrir a fatura
  if (!saldoComporta(contaId, valor)) {
    return;
  }

  _pagandoFatura = true;
  const btn = document.getElementById("btnConfirmarPagarFatura");
  if (btn) { btn.disabled = true; btn.textContent = "Pagando..."; }

  // Garante que o botão sempre volte ao normal, mesmo se algo falhar
  const destravar = () => {
    _pagandoFatura = false;
    if (btn) { btn.disabled = false; btn.textContent = "Confirmar pagamento"; }
  };

  try {
    // 1. Registra a saída na conta (o dinheiro sai de verdade)
    const cartao = state.bancos.find(b => b.id === cartaoId);
    const mov = await dbInsert("movimentos", {
      descricao: `Pagamento fatura ${cartao?.nome || "cartão"}`,
      conta_id: contaId, data: hojeISO(),
      valor: valor, tipo: "gasto", categoria: "Cartão de Crédito",
      status: "pago", pago_em: hojeISO(),
      forma_pagamento: "pagamento_fatura"
    });
    state.movimentos.push({
      id: mov.id, descricao: mov.descricao, bancoId: mov.conta_id, data: mov.data,
      valor: Number(mov.valor), tipo: mov.tipo, categoria: mov.categoria,
      status: mov.status, vencimento: null, pagoEm: mov.pago_em,
      formaPagamento: "pagamento_fatura"
    });

    // 2. Marca a fatura como paga
    const nova = await dbInsert("faturas_pagas", {
      user_id: state.user.id,
      cartao_id: cartaoId, fatura_mes: faturaMes,
      conta_id: contaId, valor: valor, pago_em: hojeISO()
    });
    state.faturasPagas.push({
      id: nova.id, cartaoId: cartaoId, faturaMes: faturaMes,
      contaId: contaId, valor: Number(nova.valor), pagoEm: nova.pago_em
    });

    destravar();
    fecharTelaCartao();
    renderTudo();
    toast(`Fatura paga! ${fmtMoeda(valor)} debitado de ${cartao?.nome || "sua conta"}.`, "success");
  } catch (err) {
    destravar();
    tratarErro(err);
  }
}

/* ============================================================
   TELA DO CARTÃO — fim
   ============================================================ */

/* Cards dos cartões de crédito no dashboard: fatura a pagar + limite disponível */
function renderCartoesDashboard() {
  const cartoes = state.bancos.filter(b => b.temCartao);
  if (!cartoes.length) return "";

  const alvo = faturaAlvoDashboard();

  const cards = cartoes.map(c => {
    const faturaMes = alvo || proximaFaturaAberta(c.id);
    const paga = faturaEstaPaga(c.id, faturaMes);
    // totalFatura() soma as compras daquele mês, pagas ou não — é o
    // histórico da fatura, não quanto falta pagar. Quando "alvo" força um
    // mês específico (filtro "Este mês"/"mês anterior" do dashboard), ele
    // pode cair numa fatura que já foi quitada; sem esse "paga ? 0 :",
    // o card continuava mostrando o valor todo como "A pagar" mesmo paga.
    const aPagar = paga ? 0 : totalFatura(c.id, faturaMes);
    const disponivel = limiteDisponivel(c.id);
    const pctUsado = (c.limite && c.limite > 0)
      ? Math.min(100, Math.max(0, ((c.limite - (disponivel ?? c.limite)) / c.limite) * 100))
      : 0;
    // Data de vencimento real da fatura, para dar contexto
    const vencCard = vencimentoDaFatura(faturaMes, c);
    const dVenc = diasAte(vencCard);
    const labelFatura = aPagar > 0
      ? (dVenc < 0 ? `venceu ${vencCard.slice(8,10)}/${vencCard.slice(5,7)}`
         : dVenc === 0 ? "vence hoje"
         : dVenc === 1 ? "vence amanhã"
         : `vence ${vencCard.slice(8,10)}/${vencCard.slice(5,7)}`)
      : paga ? "fatura paga"
      : (() => {
          const [fa, fm] = faturaMes.split("-");
          const nm = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
          return `fatura ${nm[Number(fm)-1]}/${fa.slice(2)}`;
        })();

    return `<div class="cartao-card" onclick="abrirTelaCartao('${c.id}','${faturaMes}')">
      <div class="cartao-card-top">
        <span class="cartao-card-nome">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          ${esc(c.nome)}
        </span>
        <span class="cartao-card-venc">fatura ${labelFatura}</span>
      </div>
      <div class="cartao-card-label">A pagar</div>
      <div class="cartao-card-valor ${aPagar > 0 ? "tem-fatura" : ""}">${fmtMoeda(aPagar)}</div>
      ${c.limite ? `
        <div class="cartao-limite-barra"><span style="width:${pctUsado.toFixed(0)}%"></span></div>
        <div class="cartao-limite-txt">Limite disponível: <strong>${fmtMoeda(disponivel ?? 0)}</strong> de ${fmtMoeda(c.limite)}</div>
      ` : ""}
    </div>`;
  }).join("");

  return `<div class="cartoes-secao">
    <div class="cartoes-secao-titulo">Cartões de crédito</div>
    <div class="cartoes-cards-grid">${cards}</div>
  </div>`;
}

let _periodoTipo = "mes";   // hoje | ontem | 7dias | mes | mesanterior | tudo
let _periodoDatas = null;   // {de:'YYYY-MM-DD', ate:'YYYY-MM-DD'} quando customizado

function renderGraficoEvolucao() {
  if (chartEvolucao) chartEvolucao.destroy();

  const PT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const hoje = new Date();
  const pad2 = n => String(n).padStart(2, "0");
  const isoDe = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  const hojeZero = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());

  // Define o intervalo [dataIni, dataFim] conforme o período escolhido.
  let dataIni, dataFim;
  if (_periodoDatas) {
    dataIni = new Date(_periodoDatas.de + "T00:00:00");
    dataFim = new Date(_periodoDatas.ate + "T00:00:00");
  } else if (_periodoTipo === "mes") {
    // Mês inteiro: dia 1 até o último dia
    dataIni = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    dataFim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
  } else if (_periodoTipo === "mesanterior") {
    dataIni = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    dataFim = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
  } else if (_periodoTipo === "proximomes") {
    dataIni = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
    dataFim = new Date(hoje.getFullYear(), hoje.getMonth() + 2, 0);
  } else {
    // Tudo: desde o primeiro movimento
    dataFim = hojeZero;
    if (state.movimentos.length) {
      const datas = state.movimentos.map(m => m.data).filter(Boolean).sort();
      dataIni = datas[0] ? new Date(datas[0] + "T00:00:00") : new Date(hoje.getFullYear(), hoje.getMonth()-5, 1);
    } else {
      dataIni = new Date(hoje.getFullYear(), hoje.getMonth()-5, 1);
    }
  }

  // Granularidade diária quando o intervalo é curto (≤ ~62 dias), senão mensal.
  const diasIntervalo = Math.round((dataFim - dataIni) / 86400000) + 1;
  const porDia = diasIntervalo <= 62;

  // Monta os "pontos" do gráfico. Cada ponto tem uma data-limite (lim) e um rótulo.
  let pontos;
  if (porDia) {
    const n = Math.min(diasIntervalo, 62);
    pontos = Array.from({length:n}, (_,i) => {
      const d = new Date(dataIni.getFullYear(), dataIni.getMonth(), dataIni.getDate()+i);
      const diaISO = isoDe(d);
      return {
        limNum: Number(diaISO.replace(/-/g,"")),   // AAAAMMDD para comparação
        iniISO: diaISO,                             // início do intervalo = o próprio dia
        fimISO: diaISO,
        label: diasIntervalo > 15 ? `${pad2(d.getDate())}` : `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}`,
        tooltip: `${d.getDate()} ${PT[d.getMonth()]} ${d.getFullYear()}`
      };
    });
  } else {
    const mesesTotal = (dataFim.getFullYear()-dataIni.getFullYear())*12 + (dataFim.getMonth()-dataIni.getMonth()) + 1;
    const n = Math.min(Math.max(mesesTotal, 1), 120);
    pontos = Array.from({length:n}, (_,i) => {
      const d = new Date(dataIni.getFullYear(), dataIni.getMonth()+i, 1);
      // Último dia do mês desse ponto, para acumular o saldo até o fim do mês
      const fimMes = new Date(d.getFullYear(), d.getMonth()+1, 0);
      return {
        limNum: Number(`${fimMes.getFullYear()}${pad2(fimMes.getMonth()+1)}${pad2(fimMes.getDate())}`),
        iniISO: isoDe(d),           // primeiro dia do mês
        fimISO: isoDe(fimMes),      // último dia do mês
        label: PT[d.getMonth()],
        tooltip: `${PT[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`
      };
    });
  }

  // Atualiza o título com o período
  const tit = document.getElementById("tituloEvolucao");
  if (tit) {
    if (_periodoDatas) {
      const fmtBR = s => `${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)}`;
      tit.textContent = `Evolução do saldo (${fmtBR(_periodoDatas.de)} — ${fmtBR(_periodoDatas.ate)})`;
    } else {
      const nomes = {
        mes: "Evolução do saldo (este mês)",
        mesanterior: "Evolução do saldo (mês anterior)",
        proximomes: "Evolução do saldo (próximo mês)",
        tudo: "Evolução do saldo (todo o histórico)"
      };
      tit.textContent = nomes[_periodoTipo] || "Evolução do saldo";
    }
  }

  // Saldo por ponto — usa a MESMA lógica simples dos cards (filtra só por
  // data), para o gráfico enxergar os mesmos movimentos que os cards enxergam.
  // Parte do saldo total atual e reconstrói a linha ao longo dos pontos.
  const saldoHoje = calcularSaldoTotal();
  const hojeStr = hojeISO();

  // Soma líquida (entradas - gastos) dos movimentos entre duas datas, só por data.
  function movimentoLiquido(deISO, ateISO) {
    let liq = 0;
    for (const m of state.movimentos) {
      if (!ehPago(m) || m.formaPagamento === "credito" || !m.data) continue;
      const d = m.data.slice(0, 10);
      if (d < deISO || d > ateISO) continue;
      liq += (m.tipo === "entrada" ? m.valor : -m.valor);
    }
    return liq;
  }

  const dadosSaldo = [];
  const dadosEntradas = [];
  const dadosGastos = [];
  pontos.forEach(({limNum, iniISO, fimISO}) => {
    const s = String(limNum);
    const dataLimISO = `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
    // Saldo no fim deste ponto = saldo de hoje menos tudo que se moveu DEPOIS.
    // Assim a linha bate com o saldo atual e reage a cada movimento.
    let saldoNoPonto;
    if (dataLimISO >= hojeStr) {
      saldoNoPonto = saldoHoje;
    } else {
      // desconta o que aconteceu do dia seguinte a este ponto até hoje
      const diaSeguinte = (() => {
        const dt = new Date(dataLimISO + "T00:00:00");
        dt.setDate(dt.getDate() + 1);
        return isoDe(dt);
      })();
      saldoNoPonto = saldoHoje - movimentoLiquido(diaSeguinte, hojeStr);
    }
    dadosSaldo.push(saldoNoPonto);

    // Entradas e gastos SÓ deste intervalo (dia ou mês), para o tooltip
    let ent = 0, gas = 0;
    for (const m of state.movimentos) {
      if (!ehPago(m) || m.formaPagamento === "credito" || !m.data) continue;
      const d = m.data.slice(0,10);
      if (d < iniISO || d > fimISO) continue;
      if (m.tipo === "entrada") ent += m.valor; else gas += m.valor;
    }
    dadosEntradas.push(ent);
    dadosGastos.push(gas);
  });
  const dados = dadosSaldo;

  // Escala das linhas de entradas/gastos: damos um teto BEM maior que o pico
  // real, para elas ficarem no terço de baixo do gráfico — visualmente
  // separadas da linha do saldo (que fica em cima). Assim 1.500 não parece
  // estar no mesmo nível de um saldo de 51.000.
  const picoMov = Math.max(1, ...dadosEntradas, ...dadosGastos);
  const tetoMov = picoMov * 3.2;   // as linhas ocupam ~1/3 inferior da altura

  // Verifica se houve algum movimento DENTRO do período mostrado.
  // Se a linha ficar reta por falta de dados, avisamos — senão parece um bug.
  const iniISO = isoDe(dataIni);
  const fimISO = isoDe(dataFim);
  const temMovNoPeriodo = state.movimentos.some(m =>
    m.data && ehPago(m) && m.data >= iniISO && m.data <= fimISO
  ) || state.transferencias.some(t =>
    t.data && t.data >= iniISO && t.data <= fimISO
  );
  const avisoVazio = document.getElementById("evolucaoVazio");
  if (avisoVazio) {
    avisoVazio.hidden = temMovNoPeriodo;
  }

  const canvas = document.getElementById("chartEvolucao");
  if (!canvas) return;

  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue("--accent").trim() || "#1EF6DD";
  const corEntrada = "#22C55E";   // verde
  const corGasto   = "#F0642E";   // laranja/vermelho, estilo o modelo
  const txt    = dark ? "#7C8FA3" : "#8296a5";
  const grid   = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)";

  const ctx = canvas.getContext("2d");
  // Gradiente do saldo (área principal)
  const gradSaldo = ctx.createLinearGradient(0, 0, 0, canvas.height || 260);
  gradSaldo.addColorStop(0,   hexParaRgba(accent, 0.22));
  gradSaldo.addColorStop(0.6, hexParaRgba(accent, 0.06));
  gradSaldo.addColorStop(1,   hexParaRgba(accent, 0));

  // Carteira zerada: mostra o convite, não uma linha reta no zero
  const vazio = dadosSaldo.every(v => v === 0) && dadosEntradas.every(v => v === 0) && dadosGastos.every(v => v === 0);

  chartEvolucao = new Chart(canvas, {
    type: "line",
    data: {
      labels: pontos.map(p => p.label),
      datasets: [
        {
          label: "Saldo",
          data: dadosSaldo,
          borderColor: accent,
          backgroundColor: gradSaldo,
          borderWidth: 3,
          tension: 0.4,
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 6,
          pointHoverBorderWidth: 3,
          pointHoverBackgroundColor: accent,
          pointHoverBorderColor: dark ? "#011025" : "#ffffff",
          yAxisID: "ySaldo",
          order: 0,
          clip: false
        },
        {
          label: "Entradas",
          data: dadosEntradas,
          borderColor: corEntrada,
          backgroundColor: "transparent",
          borderWidth: 2,
          borderDash: [6, 4],          // tracejada, como no modelo
          tension: 0.4,
          fill: false,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBorderWidth: 2,
          pointHoverBackgroundColor: corEntrada,
          pointHoverBorderColor: dark ? "#011025" : "#ffffff",
          yAxisID: "yMov",
          order: 1
        },
        {
          label: "Gastos",
          data: dadosGastos,
          borderColor: corGasto,
          backgroundColor: "transparent",
          borderWidth: 2,
          borderDash: [6, 4],          // tracejada
          tension: 0.4,
          fill: false,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBorderWidth: 2,
          pointHoverBackgroundColor: corGasto,
          pointHoverBorderColor: dark ? "#011025" : "#ffffff",
          yAxisID: "yMov",
          order: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 700, easing: "easeOutQuart" },
      interaction: { mode: "index", intersect: false },
      layout: { padding: { top: 8, right: 4, bottom: 0, left: 0 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: dark ? "#0D1B2F" : "#ffffff",
          borderColor: dark ? "#2C384A" : "#e0e6e8",
          borderWidth: 1,
          titleColor: dark ? "#E6EEF5" : "#16233a",
          bodyColor: dark ? "#E6EEF5" : "#16233a",
          titleFont: { family: "Inter", size: 12.5, weight: "700" },
          bodyFont: { family: "IBM Plex Mono", size: 12.5, weight: "500" },
          padding: { top: 12, bottom: 12, left: 14, right: 16 },
          titleMarginBottom: 10,     // afasta o título das linhas
          bodySpacing: 8,            // respiro entre Saldo / Entradas / Gastos
          displayColors: true,
          boxWidth: 8,
          boxHeight: 8,
          boxPadding: 6,             // afasta a bolinha do texto
          usePointStyle: true,
          cornerRadius: 10,
          caretSize: 6,
          callbacks: {
            title: it => {
              const i = it[0].dataIndex;
              return pontos[i]?.tooltip || "";
            },
            label: c => {
              // Cada série mostra apenas o seu próprio valor
              return `${c.dataset.label}: ${fmtMoeda(c.raw)}`;
            },
            // Bolinha sólida com a cor da série (senão a linha tracejada
            // deixa a bolinha "vazada" e sem cor)
            labelColor: c => {
              const cor = c.dataset.borderColor;
              return { backgroundColor: cor, borderColor: cor, borderRadius: 6 };
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: txt,
            font: { family: "Inter", size: 9 },
            padding: 8,
            maxRotation: 0,            // em pé (horizontal)
            minRotation: 0,
            autoSkip: false,
            callback: function(value, index) {
              const total = pontos.length;
              // No celular a tela é estreita: 31 rótulos não cabem.
              // Espaça os números (a linha continua com todos os pontos).
              const telaEstreita = window.innerWidth <= 640;
              if (telaEstreita && porDia && total > 12) {
                const passo = total > 20 ? 5 : 3;
                if (index === 0 || index === total - 1 || index % passo === 0) {
                  return pontos[index]?.label || "";
                }
                return "";
              }
              return pontos[index]?.label || "";
            }
          }
        },
        ySaldo: {
          position: "left",
          suggestedMin: vazio ? 0 : undefined,
          suggestedMax: vazio ? 100 : undefined,
          grid: { color: grid, drawTicks: false },
          border: { display: false },
          ticks: {
            color: txt,
            font: { family: "IBM Plex Mono", size: 10.5 },
            padding: 10,
            maxTicksLimit: 5,
            callback: v => fmtCompacto(v)
          }
        },
        yMov: {
          // Eixo das entradas/gastos do dia — escala própria (valores menores).
          // Oculto para não poluir; serve só para as duas linhas terem proporção.
          // O teto alto empurra as linhas para o terço de baixo do gráfico,
          // separando-as visualmente da linha do saldo lá em cima.
          position: "right",
          beginAtZero: true,
          max: tetoMov,
          display: false,
          grid: { display: false }
        }
      }
    },
    plugins: [{
      // Linha vertical fina no ponto sob o cursor, como no modelo bonito
      id: "linhaVertical",
      afterDraw: (chart) => {
        const ativos = chart.tooltip?.getActiveElements?.();
        if (!ativos || !ativos.length) return;
        const x = ativos[0].element.x;
        const ctx = chart.ctx;
        const topo = chart.chartArea.top;
        const base = chart.chartArea.bottom;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x, topo);
        ctx.lineTo(x, base);
        ctx.lineWidth = 1;
        ctx.strokeStyle = dark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.15)";
        ctx.stroke();
        ctx.restore();
      }
    }]
  });
}

/* Converte #RRGGBB para rgba() com alfa */
function hexParaRgba(hex, a) {
  const h = hex.replace("#","");
  const r = parseInt(h.slice(0,2),16);
  const g = parseInt(h.slice(2,4),16);
  const b = parseInt(h.slice(4,6),16);
  return `rgba(${r},${g},${b},${a})`;
}

/* Valores curtos no eixo: 12.500 vira "12,5k" — não polui o gráfico */
function fmtCompacto(v) {
  const abs = Math.abs(v);
  if (abs >= 1000000) return (v/1000000).toFixed(1).replace(".",",") + "M";
  if (abs >= 1000)    return (v/1000).toFixed(abs >= 10000 ? 0 : 1).replace(".",",") + "k";
  return String(Math.round(v));
}

function renderBancos() {
  if (!listaBancosEl) return;
  if (!state.bancos.length) {
    listaBancosEl.innerHTML = vazio(
      ICO.conta,
      "Nenhuma conta ainda",
      "Cadastre suas contas no formulário acima para começar."
    );
    if(resumoContasEl) resumoContasEl.innerHTML = `<div class="empty-state">Nenhuma conta cadastrada ainda.</div>`;
    return;
  }

  listaBancosEl.innerHTML = state.bancos.map(b => {
    const atual = calcularSaldoBanco(b.id);
    const dif = atual - b.saldoInicial;
    const qtd = state.movimentos.filter(m => m.bancoId === b.id && ehPago(m)).length;
    const temMovimento = Math.abs(dif) > 0.005;
    const clsDif = dif >= 0 ? "valor-positivo" : "valor-negativo";
    const sinal  = dif >= 0 ? "+" : "−";

    return `<div class="conta-box">
      <div class="conta-box-main">
        ${marcaConta(b)}

        <div class="conta-box-info">
          <div class="conta-box-nome">
            ${(() => {
              const nc = nomeConta(b);
              return esc(nc.base) + (nc.apelido
                ? ` <span class="conta-apelido">${esc(nc.apelido)}</span>`
                : "");
            })()}
          </div>
          <div class="conta-box-meta">
            <span class="badge">${esc(b.tipo)}</span>
            ${temMovimento
              ? `<span class="conta-box-sub">${qtd} lançamento${qtd === 1 ? "" : "s"}</span>`
              : `<span class="conta-box-sub conta-box-sub-fraco">Sem movimentações</span>`
            }
          </div>
        </div>

        <div class="conta-box-num">
          <div class="conta-box-valor">${fmtMoeda(atual)}</div>
          ${temMovimento
            ? `<div class="conta-box-dif ${clsDif}">${sinal}${fmtMoeda(Math.abs(dif))}</div>`
            : `<div class="conta-box-dif conta-box-dif-fraco">inicial</div>`
          }
        </div>

        <div class="conta-box-acoes">
          <button class="btn-acao" onclick="abrirEditarConta('${b.id}')" title="Editar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
          </button>
          <button class="btn-acao btn-acao-danger" onclick="excluirConta('${b.id}')" title="Excluir">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      </div>
    </div>`;
  }).join("");
}

function renderResumoContasFiltrado(movs) {
  if (!resumoContasEl) return;
  if (!state.bancos.length) { resumoContasEl.innerHTML=`<div class="empty-state">Nenhuma conta.</div>`; return; }
  resumoContasEl.innerHTML = state.bancos.map(b => {
    const ent = movs.filter(m=>m.bancoId===b.id&&m.tipo==="entrada"&&ehPago(m)).reduce((a,m)=>a+m.valor,0);
    const gas = movs.filter(m=>m.bancoId===b.id&&m.tipo==="gasto"&&ehPago(m)).reduce((a,m)=>a+m.valor,0);
    const sal = ent-gas;
    return `<div class="conta-resumo-item">
      <div class="item-top"><div class="item-title">${esc(b.nome)}</div><div class="${sal>=0?"valor-positivo":"valor-negativo"}">${fmtMoeda(sal)}</div></div>
      <div class="item-meta">
        <span>Tipo: <span class="badge">${esc(b.tipo)}</span></span><br>
        <span>Entradas: <span class="valor-positivo">${fmtMoeda(ent)}</span></span><br>
        <span>Gastos: <span class="valor-negativo">${fmtMoeda(gas)}</span></span>
      </div>
    </div>`;
  }).join("");
}

/* Filtros do histórico de movimentações */
function filtrosHistorico() {
  return {
    busca: (buscaMovimentoInput?.value || "").toLowerCase().trim(),
    categoria: document.getElementById("histCategoria")?.value || "todas",
    tipo: document.getElementById("histTipo")?.value || "todos",
    de: document.getElementById("histDe")?.value || "",
    ate: document.getElementById("histAte")?.value || ""
  };
}

/* Aplica os filtros à lista de lançamentos */
function movimentosFiltradosHistorico() {
  const f = filtrosHistorico();
  let movs = [...state.movimentos].sort((a,b) => new Date(b.data) - new Date(a.data));

  if (f.busca) {
    movs = movs.filter(m =>
      (m.descricao || "").toLowerCase().includes(f.busca) ||
      (m.categoria || "").toLowerCase().includes(f.busca)
    );
  }
  if (f.categoria !== "todas") movs = movs.filter(m => m.categoria === f.categoria);
  if (f.tipo !== "todos")      movs = movs.filter(m => m.tipo === f.tipo);
  if (f.de)   movs = movs.filter(m => (m.data || "") >= f.de);
  if (f.ate)  movs = movs.filter(m => (m.data || "") <= f.ate);

  return movs;
}

/* Algum filtro está ativo? (para mostrar o botão de limpar) */
function temFiltroHistorico() {
  const f = filtrosHistorico();
  return !!(f.busca || f.categoria !== "todas" || f.tipo !== "todos" || f.de || f.ate);
}

function limparFiltrosHistorico() {
  if (buscaMovimentoInput) buscaMovimentoInput.value = "";
  const cat = document.getElementById("histCategoria");
  const tip = document.getElementById("histTipo");
  const de  = document.getElementById("histDe");
  const ate = document.getElementById("histAte");
  if (cat) cat.value = "todas";
  if (tip) tip.value = "todos";
  if (de)  de.value = "";
  if (ate) ate.value = "";
  movsVisiveis = PAGINA_TAM;
  renderMovimentos();
}

function renderMovimentos() {
  if (!listaMovimentosEl) return;
  const f = filtrosHistorico();
  const movs = movimentosFiltradosHistorico();
  const filtrando = temFiltroHistorico();

  // Botão de limpar só aparece quando há filtro ativo
  const btnLimpar = document.getElementById("histLimpar");
  if (btnLimpar) btnLimpar.hidden = !filtrando;

  // Resumo do que está sendo mostrado
  const resumo = document.getElementById("histResumoFiltro");
  if (resumo) {
    if (filtrando && movs.length) {
      const entradas = movs.filter(m => m.tipo === "entrada").reduce((a,m) => a + m.valor, 0);
      const gastos   = movs.filter(m => m.tipo === "gasto").reduce((a,m) => a + m.valor, 0);
      const partes = [`${movs.length} lançamento${movs.length > 1 ? "s" : ""}`];
      if (entradas) partes.push(`entradas ${fmtMoeda(entradas)}`);
      if (gastos)   partes.push(`gastos ${fmtMoeda(gastos)}`);
      resumo.innerHTML = partes.join(" · ");
      resumo.hidden = false;
    } else {
      resumo.hidden = true;
    }
  }

  if (!movs.length) {
    listaMovimentosEl.innerHTML = filtrando
      ? `<div class="empty-state">Nenhum lançamento com esses filtros.</div>`
      : vazio(ICO.lista, "Nenhum lançamento ainda",
              "Escreva algo como \"gastei 50 no mercado\" no formulário acima.");
    return;
  }

  const total = movs.length;
  const mostrando = Math.min(movsVisiveis, total);
  const pagina = movs.slice(0, mostrando);

  listaMovimentosEl.innerHTML = pagina.map(m => {
    const b = state.bancos.find(x => x.id === m.bancoId);
    const pend = ehPendente(m);
    const atras = estaAtrasado(m);
    const ehEntrada = m.tipo === "entrada";
    const cls = pend ? "valor-pendente" : (ehEntrada ? "valor-positivo" : "valor-negativo");
    const sig = ehEntrada ? "+" : "−";
    const dataFmt = new Date(vencDe(m)+"T00:00:00").toLocaleDateString("pt-BR");

    return `<div class="mov-item ${pend ? "mov-pendente" : ""}">
      ${b ? marcaConta(b, "sm") : `<span class="marca-conta marca-conta-sm marca-vazia">?</span>`}

      <div class="mov-info">
        <div class="mov-desc">
          ${esc(m.descricao)}
          ${pend ? `<span class="tag-status ${atras ? "tag-atrasado" : "tag-pendente"}">${atras ? "Atrasado" : "Pendente"}</span>` : ""}
        </div>
        <div class="mov-meta">
          <span class="badge">${esc(m.categoria)}</span>
          <span class="mov-sep">·</span>
          <span>${b ? esc(b.nome) : "Conta removida"}</span>
          <span class="mov-sep">·</span>
          <span>${pend ? "vence " : ""}${dataFmt}</span>
        </div>
      </div>

      <div class="mov-valor ${cls}">${sig} ${fmtMoeda(m.valor)}</div>

      <div class="mov-acoes">
          ${pend ? `<button class="btn-acao btn-acao-ok" onclick="marcarComoPago('${m.id}')" title="${ehEntrada ? "Recebi" : "Paguei"}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          </button>` : ""}
          <button class="btn-acao" onclick="abrirEditarMovimento('${m.id}')" title="Editar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
          </button>
          <button class="btn-acao btn-acao-danger" onclick="excluirMovimento('${m.id}')" title="Excluir">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
      </div>
    </div>`;
  }).join("");

  // Paginação
  if (total > mostrando) {
    listaMovimentosEl.innerHTML += `
      <div class="paginacao-rodape">
        <span>Mostrando ${mostrando} de ${total}</span>
        <button class="btn-ghost btn-carregar-mais" onclick="carregarMaisMovimentos()">
          Carregar mais ${Math.min(PAGINA_TAM, total - mostrando)}
        </button>
      </div>`;
  } else if (total > PAGINA_TAM) {
    listaMovimentosEl.innerHTML += `
      <div class="paginacao-rodape">
        <span>Mostrando todos os ${total}</span>
        <button class="btn-ghost btn-carregar-mais" onclick="recolherMovimentos()">Recolher</button>
      </div>`;
  }
}

function renderTransferencias() {
  if (!listaTransferenciasEl) return;
  if (!state.transferencias.length) {
    listaTransferenciasEl.innerHTML=`<div class="empty-state">Nenhuma transferência realizada ainda.</div>`; return;
  }
  const bMap = Object.fromEntries(state.bancos.map(b=>[b.id,b.nome]));
  listaTransferenciasEl.innerHTML = [...state.transferencias]
    .sort((a,b)=>new Date(b.data)-new Date(a.data))
    .map(t => `<div class="transferencia-item">
      <div class="trans-top">
        <div class="trans-contas"><span>${bMap[t.origem]||"?"}</span><span class="trans-seta">→</span><span>${bMap[t.destino]||"?"}</span></div>
        <div class="trans-valor">${fmtMoeda(t.valor)}</div>
      </div>
      <div class="trans-meta">${t.descricao?t.descricao+" · ":""}${new Date(t.data+"T00:00:00").toLocaleDateString("pt-BR")}</div>
      <div class="item-actions">
        <button class="btn-icon" onclick="abrirEditarTransferencia('${t.id}')"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></span>Editar</button>
        <button class="btn-icon btn-icon-danger" onclick="excluirTransferencia('${t.id}')"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></span>Excluir</button>
      </div>
    </div>`).join("");
}

function renderRecorrencias() {
  if (!listaRecorrenciasEl) return;
  renderOcorrencias();
  renderCategorias();

  // Contador no cabeçalho do painel
  const cont = document.getElementById("contadorRegras");
  if (cont) {
    const n = state.recorrencias.length;
    cont.textContent = n ? `${n} regra${n === 1 ? "" : "s"}` : "";
  }

  if (!state.recorrencias.length) {
    listaRecorrenciasEl.innerHTML = vazio(
      ICO.repetir,
      "Nenhum gasto fixo",
      "Aluguel, assinaturas, salário — cadastre uma vez e o app cuida do resto."
    );
    return;
  }

  listaRecorrenciasEl.innerHTML = state.recorrencias.map(r => {
    const b = state.bancos.find(x => x.id === r.contaId);
    const ehEntrada = r.tipo === "entrada";
    const pagos = state.recPagamentos.filter(p => p.recorrenciaId === r.id).length;
    const fim = r.fim
      ? `até ${new Date(r.fim+"T00:00:00").toLocaleDateString("pt-BR", { month:"short", year:"numeric" })}`
      : "sem prazo";

    return `<div class="regra-item ${!r.ativa ? "regra-pausada" : ""}">
      ${b ? marcaConta(b, "sm") : `<span class="marca-conta marca-conta-sm marca-vazia">?</span>`}

      <div class="regra-info">
        <div class="regra-desc">
          ${esc(r.descricao)}
          ${!r.ativa ? '<span class="tag-status tag-pendente">Pausada</span>' : ""}
        </div>
        <div class="regra-meta">
          <span class="regra-freq">${textoFrequencia(r)}</span>
          <span class="mov-sep">·</span>
          <span>${fim}</span>
          <span class="mov-sep">·</span>
          <span>${pagos} pago${pagos === 1 ? "" : "s"}</span>
        </div>
      </div>

      <div class="regra-valor ${ehEntrada ? "valor-positivo" : "valor-negativo"}">
        ${ehEntrada ? "+" : "−"}${fmtMoeda(r.valor)}
      </div>

      <div class="regra-acoes">
        <button class="btn-acao" onclick="alternarAtivaRec('${r.id}')" title="${r.ativa ? "Pausar" : "Retomar"}">
          ${r.ativa
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>`
          }
        </button>
        <button class="btn-acao btn-acao-danger" onclick="excluirRecorrencia('${r.id}')" title="Excluir">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>
    </div>`;
  }).join("");
}

/* Pausa/retoma uma regra sem apagar o histórico */
async function alternarAtivaRec(id) {
  const r = state.recorrencias.find(x=>x.id===id); if (!r) return;
  try {
    const att = await dbUpdate("recorrencias", id, { ativa: !r.ativa });
    r.ativa = att.ativa !== false;
    renderTudo();
    toast(r.ativa ? `"${esc(r.descricao)}" retomada.` : `"${esc(r.descricao)}" pausada — não gera novos vencimentos.`, "info");
  } catch(err) { tratarErro(err); }
}

function renderMetas() {
  if (!listaMetasEl) return;

  const lbl = document.getElementById("metaMesLabel");
  if (lbl) {
    const [a, m] = hojeISO().split("-").map(Number);
    lbl.textContent = `${MESES_PT[m-1]} ${a}`;
  }

  if (!state.metas.length) {
    listaMetasEl.innerHTML = vazio(
      ICO.alvo,
      "Nenhum limite definido",
      "Defina um teto de gasto por categoria e o app avisa quando você se aproximar."
    );
    return;
  }

  const [ano, mes] = hojeISO().split("-");
  const gastoDaCategoria = (cat) =>
    state.movimentos
      .filter(mv => mv.tipo === "gasto" && ehPago(mv) && mv.categoria === cat
                    && mv.data.slice(0,7) === `${ano}-${mes}`)
      .reduce((s, mv) => s + mv.valor, 0);

  listaMetasEl.innerHTML = state.metas.map(meta => {
    const gasto = gastoDaCategoria(meta.categoria);
    const pct = Math.min(100, Math.round((gasto / meta.limite) * 100));
    const estourou = gasto > meta.limite;
    const perto = !estourou && pct >= 80;
    const cls = estourou ? "estourou" : perto ? "perto" : "ok";
    const restante = meta.limite - gasto;

    return `<div class="limite-card">
      <div class="limite-head">
        <span class="badge">${esc(meta.categoria)}</span>
        <span class="limite-estado limite-${cls}">
          ${estourou ? `Passou ${fmtMoeda(Math.abs(restante))}` : `Resta ${fmtMoeda(restante)}`}
        </span>
        <button class="btn-acao btn-acao-danger" onclick="excluirMeta('${meta.id}')" title="Excluir">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>

      <div class="limite-barra">
        <div class="limite-barra-fill limite-fill-${cls}" style="width:${pct}%"></div>
      </div>

      <div class="limite-nums">
        <span class="limite-gasto">${fmtMoeda(gasto)}</span>
        <span class="limite-de">de ${fmtMoeda(meta.limite)}</span>
      </div>
    </div>`;
  }).join("");
}

function renderPlanilha() {
  if (!tabelaMovimentosBody) return;
  const filtrados = obterMovimentosFiltrados();
  const tabela    = obterMovimentosTabelaFiltrados();
  const bMap      = Object.fromEntries(state.bancos.map(b=>[b.id,`${esc(b.nome)} · ${esc(b.tipo)}`]));
  const { entradas, gastos } = calcularTotais(filtrados);
  if(saldoTotalPlanilhaEl) saldoTotalPlanilhaEl.textContent = fmtMoeda(entradas-gastos);

  // Cards de entrou / saiu
  const elEntrou = document.getElementById("entrouPlanilha");
  const elSaiu = document.getElementById("saiuPlanilha");
  if (elEntrou) elEntrou.textContent = fmtMoeda(entradas);
  if (elSaiu) elSaiu.textContent = fmtMoeda(gastos);

  const qtdEnt = filtrados.filter(m => m.tipo === "entrada").length;
  const qtdGas = filtrados.filter(m => m.tipo === "gasto").length;
  const subEnt = document.getElementById("entrouPlanilhaSub");
  const subSai = document.getElementById("saiuPlanilhaSub");
  if (subEnt) subEnt.textContent = `${qtdEnt} ${qtdEnt === 1 ? "entrada" : "entradas"}`;
  if (subSai) subSai.textContent = `${qtdGas} ${qtdGas === 1 ? "saída" : "saídas"}`;
  if (!filtrados.length) {
    if(resumoCategoriasEl) resumoCategoriasEl.innerHTML  = `<div class="empty-state">Nenhuma movimentação para o filtro selecionado.</div>`;
    if(resumoContasEl)     resumoContasEl.innerHTML      = `<div class="empty-state">Nenhuma movimentação para o filtro selecionado.</div>`;
    tabelaMovimentosBody.innerHTML= `<tr><td colspan="6" class="table-empty">Nenhuma movimentação encontrada.</td></tr>`;
    if(maiorCategoriaGastoEl) maiorCategoriaGastoEl.textContent = "—";
    if(elEntrou) elEntrou.textContent = fmtMoeda(0);
    if(elSaiu) elSaiu.textContent = fmtMoeda(0);
    if(subEnt) subEnt.textContent = "—";
    if(subSai) subSai.textContent = "—";
    renderGraficosPlanilha([]); return;
  }
  const res = {};
  filtrados.forEach(m => { if(!res[m.categoria]) res[m.categoria]={entrada:0,gasto:0}; res[m.categoria][m.tipo]+=m.valor; });
  if(resumoCategoriasEl) resumoCategoriasEl.innerHTML = Object.entries(res).sort((a,b)=>a[0].localeCompare(b[0])).map(([cat,v])=>{
    const s = v.entrada-v.gasto;
    return `<div class="categoria-item">
      <div class="item-top"><div class="item-title item-title-cat">${ICONE_CAT[cat]||ICONE_CAT_FALLBACK}<span>${esc(cat)}</span></div><div class="${s>=0?"valor-positivo":"valor-negativo"}">${fmtMoeda(s)}</div></div>
      <div class="item-meta">
        <span>Entradas: <span class="valor-positivo">${fmtMoeda(v.entrada)}</span></span><br>
        <span>Gastos: <span class="valor-negativo">${fmtMoeda(v.gasto)}</span></span>
      </div>
    </div>`;
  }).join("");
  renderResumoContasFiltrado(filtrados);
  const top = Object.entries(res).map(([c,v])=>({c,g:v.gasto})).sort((a,b)=>b.g-a.g);
  if (maiorCategoriaGastoEl) {
    if (top.length && top[0].g > 0) {
      const ic = ICONE_CAT[top[0].c] || ICONE_CAT_FALLBACK;
      maiorCategoriaGastoEl.innerHTML = `<span class="item-title-cat">${ic}<span>${esc(top[0].c)}</span></span>`;
    } else {
      maiorCategoriaGastoEl.textContent = "—";
    }
  }
  tabelaMovimentosBody.innerHTML = !tabela.length
    ? `<tr><td colspan="6" class="table-empty">Nenhuma movimentação para a categoria selecionada.</td></tr>`
    : [...tabela].sort((a,b)=>new Date(b.data)-new Date(a.data)).slice(0, 200).map(m => {
        const cls = m.tipo==="entrada"?"valor-positivo":"valor-negativo";

  // Avisa se a tabela foi truncada (não some com os dados sem explicar)
  if (tabela.length > 200) {
    const wrap = tabelaMovimentosBody.closest(".table-wrapper");
    if (wrap && !wrap.querySelector(".tabela-truncada")) {
      const nota = document.createElement("div");
      nota.className = "tabela-truncada";
      nota.innerHTML = `Mostrando as 200 mais recentes de ${tabela.length}. Use os filtros ou exporte o CSV para ver tudo.`;
      wrap.appendChild(nota);
    }
  } else {
    tabelaMovimentosBody.closest(".table-wrapper")?.querySelector(".tabela-truncada")?.remove();
  }
        return `<tr>
          <td>${new Date(m.data+"T00:00:00").toLocaleDateString("pt-BR")}</td>
          <td>${esc(m.descricao)}</td>
          <td>${bMap[m.bancoId]||"Conta removida"}</td>
          <td>${badge(m.categoria)}</td>
          <td>${m.tipo==="entrada"?"Entrada":"Gasto"}</td>
          <td class="${cls}">${fmtMoeda(m.valor)}</td>
        </tr>`;
      }).join("");
  renderGraficosPlanilha(filtrados);
  renderRelatoriosEmpresariais(filtrados);
}

/* DRE simplificado + fluxo de caixa por fornecedor — só o espaço
   Empresarial mostra esse painel (ver .menu-item-empresarial em
   atualizarSeletorContexto). Usa o mesmo filtro de período da Planilha,
   já contando só o que está de fato pago (mesma régua do resto do app). */
function renderRelatoriosEmpresariais(filtrados) {
  const elDre = document.getElementById("dreSimplificado");
  const elFluxo = document.getElementById("fluxoFornecedores");
  if (!elDre && !elFluxo) return;
  if (state.contextoAtivo !== "empresarial") return;

  const pagos = filtrados.filter(m => (m.status || "pago") === "pago");

  if (elDre) {
    const receita = pagos.filter(m => m.tipo === "entrada").reduce((s, m) => s + m.valor, 0);
    const despesasPorCategoria = {};
    pagos.filter(m => m.tipo === "gasto").forEach(m => {
      despesasPorCategoria[m.categoria] = (despesasPorCategoria[m.categoria] || 0) + m.valor;
    });
    const totalDespesas = Object.values(despesasPorCategoria).reduce((s, v) => s + v, 0);
    const resultado = receita - totalDespesas;

    if (!receita && !totalDespesas) {
      elDre.innerHTML = `<div class="empty-state">Sem movimentações para o filtro selecionado.</div>`;
    } else {
      const linhasDespesas = Object.entries(despesasPorCategoria)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, val]) => `
          <div class="transferencia-item">
            <div class="trans-top"><div class="trans-contas"><span>${esc(cat)}</span></div><div class="trans-valor valor-negativo">-${fmtMoeda(val)}</div></div>
          </div>`).join("");
      elDre.innerHTML = `
        <div class="transferencia-item">
          <div class="trans-top"><div class="trans-contas"><span><strong>Receita</strong></span></div><div class="trans-valor valor-positivo">${fmtMoeda(receita)}</div></div>
        </div>
        ${linhasDespesas}
        <div class="transferencia-item">
          <div class="trans-top"><div class="trans-contas"><span><strong>Resultado</strong></span></div><div class="trans-valor ${resultado >= 0 ? "valor-positivo" : "valor-negativo"}">${fmtMoeda(resultado)}</div></div>
        </div>`;
    }
  }

  if (elFluxo) {
    const fornecedores = {};
    pagos.filter(m => m.tipo === "gasto" && m.categoria === "Fornecedores").forEach(m => {
      const nome = (m.descricao || "Sem nome").trim() || "Sem nome";
      if (!fornecedores[nome]) fornecedores[nome] = { total: 0, qtd: 0 };
      fornecedores[nome].total += m.valor;
      fornecedores[nome].qtd += 1;
    });
    const linhas = Object.entries(fornecedores).sort((a, b) => b[1].total - a[1].total);
    elFluxo.innerHTML = !linhas.length
      ? `<div class="empty-state">Nenhum lançamento na categoria "Fornecedores" ainda.</div>`
      : linhas.map(([nome, d]) => `
          <div class="transferencia-item">
            <div class="trans-top">
              <div class="trans-contas"><span>${esc(nome)}</span></div>
              <div class="trans-valor">${fmtMoeda(d.total)}</div>
            </div>
            <div class="trans-meta">${d.qtd} lançamento${d.qtd > 1 ? "s" : ""}</div>
          </div>`).join("");
  }
}

/* ─── Gráficos planilha ──────────────────────────────────── */
const CHART_COLORS = ["#2d6a72","#2d8a5f","#d99a2b","#c0453f","#8b5cf6","#0ea5e9","#ec4899","#10b981"];

/* Cor de uma categoria no gráfico: usa a que o usuário escolheu,
   ou uma da paleta padrão pela posição. */
function corGrafico(categoria, indice) {
  return corDaCategoria(categoria) || CHART_COLORS[indice % CHART_COLORS.length];
}

function _tooltipMoeda(ctx) {
  const total = (ctx.chart.data.datasets[0].data||[]).reduce((a,v)=>a+v, 0);
  return `${ctx.label}: ${fmtMoeda(ctx.raw)} (${total>0?((ctx.raw/total)*100).toFixed(1):"0.0"}%)`;
}

function renderGraficosPlanilha(movs) {
  const gc = {};
  movs.filter(m => m.tipo === "gasto").forEach(m => {
    gc[m.categoria] = (gc[m.categoria] || 0) + m.valor;
  });
  // Ordena por valor (maior gasto primeiro)
  const pares = Object.entries(gc).sort((a,b) => b[1] - a[1]);
  const labels = pares.map(p => p[0]);
  const data = pares.map(p => p[1]);
  const totalGasto = data.reduce((a,b) => a+b, 0);

  const { entradas, gastos } = calcularTotais(movs);

  if (chartCategoriasPlanilha) chartCategoriasPlanilha.destroy();
  if (chartFluxoPlanilha) chartFluxoPlanilha.destroy();

  // Plugin: escreve o total no centro da rosca
  const textoCentro = (titulo, valor) => ({
    id: "centro",
    beforeDraw(chart) {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      const cx = (chartArea.left + chartArea.right) / 2;
      const cy = (chartArea.top + chartArea.bottom) / 2;
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const corSec = getComputedStyle(document.documentElement).getPropertyValue("--text-muted").trim();
      const corPri = getComputedStyle(document.documentElement).getPropertyValue("--text-primary").trim();
      ctx.font = "500 10px Inter";
      ctx.fillStyle = corSec;
      ctx.fillText(titulo.toUpperCase(), cx, cy - 12);
      ctx.font = "600 17px 'IBM Plex Mono'";
      ctx.fillStyle = corPri;
      ctx.fillText(valor, cx, cy + 7);
      ctx.restore();
    }
  });

  const c1 = document.getElementById("chartCategoriasPlanilha");
  const wrap1 = c1?.closest(".plan-donut-wrap");
  if (c1) {
    if (!data.length) {
      if (wrap1) wrap1.classList.add("plan-donut-vazio");
      wrap1?.setAttribute("data-msg", "Sem gastos no período");
      document.getElementById("legendaCategorias").innerHTML = "";
    } else {
      if (wrap1) wrap1.classList.remove("plan-donut-vazio");
      chartCategoriasPlanilha = new Chart(c1, {
        type: "doughnut",
        data: { labels, datasets: [{
          data, backgroundColor: labels.map((l, i) => corGrafico(l, i)),
          borderColor: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim(),
          borderWidth: 3, hoverOffset: 6
        }]},
        options: {
          responsive: true, maintainAspectRatio: false, cutout: "68%",
          animation: { duration: 500 },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: _tooltipMoeda } } }
        },
        plugins: [textoCentro("Total", fmtCompacto(totalGasto))]
      });
      // Legenda HTML customizada, com mini-barra de proporção para comparar
      // categorias mesmo quando algumas são bem pequenas.
      const maxVal = data.length ? data[0] : 0;
      document.getElementById("legendaCategorias").innerHTML = pares.map(([cat, val], i) => {
        const pct = totalGasto > 0 ? Math.round((val/totalGasto)*100) : 0;
        const larguraBarra = maxVal > 0 ? Math.max(3, (val/maxVal)*100) : 0;
        const cor = corGrafico(cat, i);
        return `<div class="plan-leg-item">
          <span class="plan-leg-cor" style="background:${cor}"></span>
          <span class="plan-leg-nome">${esc(cat)}</span>
          <span class="plan-leg-val">${fmtMoeda(val)}</span>
          <span class="plan-leg-pct">${pct}%</span>
          <span class="plan-leg-barra"><span style="width:${larguraBarra.toFixed(0)}%;background:${cor}"></span></span>
        </div>`;
      }).join("");
    }
  }

  const c2 = document.getElementById("chartFluxoPlanilha");
  if (c2) {
    const temFluxo = (entradas || 0) + (gastos || 0) > 0;
    const wrap2 = c2.closest(".plan-donut-wrap");
    if (!temFluxo) {
      if (wrap2) { wrap2.classList.add("plan-donut-vazio"); wrap2.setAttribute("data-msg", "Sem movimentações no período"); }
      document.getElementById("legendaFluxo").innerHTML = "";
      return;
    }
    if (wrap2) wrap2.classList.remove("plan-donut-vazio");
    chartFluxoPlanilha = new Chart(c2, {
      type: "doughnut",
      data: {
        labels: ["Entradas", "Gastos"],
        datasets: [{
          data: [entradas || 0, gastos || 0],
          backgroundColor: ["#2d8a5f", "#c0453f"],
          borderColor: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim(),
          borderWidth: 3, hoverOffset: 6
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "68%",
        animation: { duration: 500 },
        plugins: { legend: { display: false }, tooltip: { enabled: true, callbacks: { label: _tooltipMoeda } } }
      },
      plugins: [textoCentro("Saldo", fmtCompacto((entradas||0) - (gastos||0)))]
    });
    const saldo = (entradas||0) - (gastos||0);
    document.getElementById("legendaFluxo").innerHTML = `
      <div class="plan-leg-item">
        <span class="plan-leg-cor" style="background:#2d8a5f"></span>
        <span class="plan-leg-nome">Entradas</span>
        <span class="plan-leg-val">${fmtMoeda(entradas)}</span>
      </div>
      <div class="plan-leg-item">
        <span class="plan-leg-cor" style="background:#c0453f"></span>
        <span class="plan-leg-nome">Gastos</span>
        <span class="plan-leg-val">${fmtMoeda(gastos)}</span>
      </div>
      <div class="plan-leg-item plan-leg-saldo">
        <span class="plan-leg-nome">Saldo</span>
        <span class="plan-leg-val ${saldo >= 0 ? "valor-positivo" : "valor-negativo"}">${fmtMoeda(saldo)}</span>
      </div>`;
  }
}

/* ─── CSV Export ─────────────────────────────────────────── */
function exportarCSV(movs) {
  const bMap = Object.fromEntries(state.bancos.map(b=>[b.id,b.nome]));
  const rows = [["Data","Descrição","Conta","Categoria","Tipo","Valor"],
    ...movs.map(m=>[m.data, `"${esc(m.descricao)}"`, bMap[m.bancoId]||"", m.categoria, m.tipo, m.valor.toFixed(2)])
  ];
  const csv = rows.map(r=>r.join(";")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}));
  a.download = `lancamentos_${hojeISO()}.csv`; a.click();
}

/* ─── Render global ──────────────────────────────────────── */
function renderTudo() {
  invalidarCacheSaldos();
  atualizarCadeadosMenu();  // atualiza os cadeados do menu conforme o plano
  renderSino();             // atualiza os avisos do sino
  renderConta();   // dados podem ter mudado — recalcula na próxima leitura
  atualizarSelectContas();
  atualizarSelectsCategoria();
  ajustarFormPorTipo();
  ajustarFormRecorrencia();
  renderResumoDashboard();
  renderPendentes();
  renderContasDashboard();
  renderGraficoEvolucao();
  renderBancos();
  renderMovimentos();
  renderTransferencias();
  renderRecorrencias();
  renderMetas();
  renderObjetivos();
  renderInvestimentos();
  renderNotasFiscais();
  renderContatos();
  renderPlanilha();
}

/* ─── Navegação ──────────────────────────────────────────── */
function trocarTela(name) {
  // Sair de planos limpa o aviso de "por que você veio aqui"
  if (name !== "planos" && _motivoUpgrade) limparMotivoUpgrade();

  // Pixel: viu a página de planos (meio de funil — quem considera assinar)
  if (name === "planos" && typeof fbq === "function") {
    try { fbq("track", "ViewContent", { content_name: "planos" }); } catch(e){}
  }

  // Toda visita à tela de Planos começa sem cupom aplicado — precisa
  // digitar de novo, mesmo que tenha usado um antes nesta mesma sessão.
  if (name === "planos") limparCupomAplicado();

  menuItems.forEach(i=>i.classList.toggle("active", i.dataset.screen===name));
  screens.forEach(s => {
    s.classList.remove("secao-desfocada");  // limpa desfoque de bloqueio anterior
    if (s.id === `screen-${name}`) {
      s.classList.add("active");
      void s.offsetHeight;
      s.classList.add("screen-enter");
    } else {
      s.classList.remove("active","screen-enter");
    }
  });
  sincronizarBottomNav(name);

  // Ao trocar de aba, volta para o topo — a nova tela sempre aparece
  // do começo, sem herdar a rolagem da tela anterior.
  const areaScroll = document.querySelector(".content");
  if (areaScroll) areaScroll.scrollTo({ top: 0, behavior: "auto" });
  window.scrollTo({ top: 0, behavior: "auto" });

  // O guia da seção NÃO abre sozinho — fica disponível no botão "Como funciona"
  // no cabeçalho de cada tela (ver injetarBotoesGuia).

  // Seção premium sem acesso: em vez de entrar e desfocar, leva direto
  // para os planos com o motivo em destaque. Menos cliques, mesma resposta.
  const infoPremium = SECOES_PREMIUM[name];
  if (infoPremium && !podeUsar(infoPremium.recurso)) {
    irParaPlanos(infoPremium.titulo, infoPremium.desc);
    return;
  }

  // Ao abrir investimentos, atualiza os preços das criptos
  if (name === "investimentos" && criptosEmUso().length) {
    atualizarPrecosCripto().then(mudou => { if (mudou) renderInvestimentos(); });
  }
  // No dashboard, o card "Patrimônio total" também depende do preço das
  // criptos — sem isso, quem entra direto no dashboard (o caminho mais
  // comum) via o valor com o preço de uma visita antiga até abrir
  // Investimentos pela primeira vez na sessão.
  if (name === "dashboard" && criptosEmUso().length) {
    atualizarPrecosCripto().then(mudou => { if (mudou) renderResumoDashboard(); });
  }
}
menuItems.forEach(i=>i.addEventListener("click",()=>trocarTela(i.dataset.screen)));

/* O perfil no rodapé também navega (leva para a tela de Conta) */
document.querySelector(".perfil-btn")?.addEventListener("click", () => trocarTela("conta"));

/* ─── Botão de tema ──────────────────────────────────────── */
document.getElementById("btnTema")?.addEventListener("click", () => {
  const atual = document.documentElement.getAttribute("data-theme") || "light";
  aplicarTema(atual === "dark" ? "light" : "dark");
  renderConta();
});

/* ============================================================
   FORMS — com gravação no Supabase
   ============================================================ */

formBanco?.addEventListener("submit", async e => {
  e.preventDefault();
  const nome = nomeBancoInput.value.trim(), tipo = tipoBancoInput.value, saldoInicial = Number(saldoBancoInput.value);
  const saldoData = document.getElementById("saldoData")?.value || hojeISO();
  if (!nome||!tipo) { toast("Preencha todos os campos.","error"); return; }
  // Bloqueio de plano: básico pode ter no máximo N contas
  const limiteContas = limitesAtuais().contas;
  if ((state.bancos?.length || 0) >= limiteContas) {
    pedirUpgrade("Cadastrar contas é um recurso de quem assina o FAZ Finanças.", "Assine para continuar");
    return;
  }
  try {
    const temCartao = document.getElementById("temCartao")?.checked || false;
    const dadosConta = {
      nome, tipo,
      saldo_inicial: saldoInicial,
      saldo_data: saldoData,
      cor: _corEscolhida,
      logo_id: _logoEscolhida,
      tem_cartao: temCartao
    };
    if (temCartao) {
      dadosConta.limite         = Number(document.getElementById("cartaoLimite")?.value) || 0;
      dadosConta.dia_fechamento = Number(document.getElementById("cartaoFechamento")?.value) || null;
      dadosConta.dia_vencimento = Number(document.getElementById("cartaoVencimento")?.value) || null;
    }
    const novo = await dbInsert("contas", dadosConta);
    state.bancos.push({
      id:novo.id, nome:novo.nome, tipo:novo.tipo,
      saldoInicial:Number(novo.saldo_inicial), saldoData: novo.saldo_data || null,
      cor: novo.cor || null,
      logoId: novo.logo_id ?? null,
      temCartao: novo.tem_cartao || false,
      limite: novo.limite != null ? Number(novo.limite) : null,
      diaFechamento: novo.dia_fechamento || null,
      diaVencimento: novo.dia_vencimento || null
    });

    // Se informou uma fatura atual em aberto, registra como compra no
    // crédito (vinculada ao cartão) — NÃO como conta a pagar avulsa.
    // Antes, isso criava um lançamento "pendente" solto, sem cartao_id/
    // fatura_mes/forma_pagamento: ficava invisível pro limite disponível
    // e pro card de "Cartões de crédito" do dashboard (o valor "sumia" do
    // cálculo de limite, mesmo aparecendo como conta a pagar avulsa).
    let faturaMsg = "";
    if (temCartao) {
      const faturaAtual = Number(document.getElementById("cartaoFaturaAtual")?.value) || 0;
      if (faturaAtual > 0) {
        const faturaMesAtual = mesAtualISO();
        const movFatura = await dbInsert("movimentos", {
          descricao: `Fatura ${nome}`,
          conta_id: novo.id,
          data: hojeISO(),
          valor: faturaAtual,
          tipo: "gasto",
          categoria: "Cartão de crédito",
          status: "pago",
          pago_em: hojeISO(),
          forma_pagamento: "credito",
          cartao_id: novo.id,
          fatura_mes: faturaMesAtual
        });
        state.movimentos.push({
          id: movFatura.id, descricao: movFatura.descricao, bancoId: movFatura.conta_id,
          data: movFatura.data, valor: Number(movFatura.valor), tipo: "gasto",
          categoria: movFatura.categoria, status: movFatura.status, vencimento: null,
          pagoEm: movFatura.pago_em, formaPagamento: "credito",
          cartaoId: movFatura.cartao_id, faturaMes: movFatura.fatura_mes
        });
        faturaMsg = ` Fatura de ${fmtMoeda(faturaAtual)} registrada no cartão.`;
      }
    }

    formBanco.reset();
    const boxReset = document.getElementById("cartaoBox");
    if (boxReset) boxReset.style.display = "none";
    const campoData = document.getElementById("saldoData");
    if (campoData) campoData.value = hojeISO();
    _corEscolhida = null;
    _logoEscolhida = null;
    atualizarAmostraMarca(); renderTudo();
    toast(`Conta "${nome}" adicionada!${faturaMsg}`,"success");
  } catch(err) { tratarErro(err); }
});

/* ============================================================
   CARTÃO DE CRÉDITO — lógica de fatura e parcelas
   ============================================================ */

/* Descobre em qual fatura (AAAA-MM) uma compra cai, pela data e dia de fechamento.
   Compra até o dia do fechamento entra na fatura do mês corrente;
   depois do fechamento, entra na fatura do mês seguinte. */
function faturaDaCompra(dataCompra, diaFechamento) {
  const [ano, mes, dia] = String(dataCompra).split("-").map(Number);
  let m = mes, a = ano;
  if (diaFechamento && dia > diaFechamento) {
    m += 1;
    if (m > 12) { m = 1; a += 1; }
  }
  return `${a}-${String(m).padStart(2, "0")}`;
}

/* Soma meses a uma fatura AAAA-MM (para distribuir parcelas) */
function somaMesesFatura(faturaMes, n) {
  let [a, m] = faturaMes.split("-").map(Number);
  m += n;
  while (m > 12) { m -= 12; a += 1; }
  while (m < 1)  { m += 12; a -= 1; }
  return `${a}-${String(m).padStart(2, "0")}`;
}

/* Registra uma compra no crédito: uma parcela por fatura.
   Não desconta conta agora — isso só acontece quando a fatura é paga. */
async function lancarCompraCredito(item, cartaoId, dataCompra, parcelas) {
  // A compra entra na fatura do MÊS em que foi feita. Não empurramos para o
  // mês seguinte pelo dia de fechamento — assim o gasto do mês sempre aparece
  // na fatura em aberto. (O dia de fechamento segue valendo só para o cálculo
  // do vencimento da fatura, em vencimentoDaFatura.)
  const faturaBase = faturaDaCompra(dataCompra, null);
  const compraId = (crypto?.randomUUID?.() || String(Date.now() + Math.random()));
  const valorParcela = Math.round((item.valor / parcelas) * 100) / 100;

  for (let p = 1; p <= parcelas; p++) {
    const faturaMes = somaMesesFatura(faturaBase, p - 1);
    const desc = parcelas > 1 ? `${item.descricao} (${p}/${parcelas})` : item.descricao;
    const novo = await dbInsert("movimentos", {
      descricao: desc, conta_id: cartaoId, data: dataCompra,
      valor: valorParcela, tipo: "gasto", categoria: item.categoria,
      status: "pago",
      pago_em: dataCompra,
      forma_pagamento: "credito",
      cartao_id: cartaoId,
      fatura_mes: faturaMes,
      parcela_num: p,
      parcela_total: parcelas,
      compra_id: compraId
    });
    state.movimentos.push({
      id: novo.id, descricao: novo.descricao, bancoId: novo.conta_id, data: novo.data,
      valor: Number(novo.valor), tipo: novo.tipo, categoria: novo.categoria,
      status: novo.status, vencimento: null, pagoEm: novo.pago_em,
      formaPagamento: "credito", cartaoId: cartaoId, faturaMes: faturaMes,
      parcelaNum: p, parcelaTotal: parcelas, compraId: compraId
    });
  }
}

/* Soma da fatura de um cartão num dado mês (AAAA-MM) */
function totalFatura(cartaoId, faturaMes) {
  return state.movimentos
    .filter(m => m.cartaoId === cartaoId && m.faturaMes === faturaMes)
    .reduce((a, m) => a + m.valor, 0);
}

/* Limite disponível = limite total menos tudo em faturas ainda não pagas */
function limiteDisponivel(cartaoId) {
  const cartao = state.bancos.find(b => b.id === cartaoId);
  if (!cartao || cartao.limite == null) return null;
  const pagas = new Set((state.faturasPagas || [])
    .filter(f => f.cartaoId === cartaoId)
    .map(f => f.faturaMes));
  const emAberto = state.movimentos
    .filter(m => m.cartaoId === cartaoId && !pagas.has(m.faturaMes))
    .reduce((a, m) => a + m.valor, 0);
  return cartao.limite - emAberto;
}

formTexto?.addEventListener("submit", async e => {
  e.preventDefault();
  if (!state.bancos.length) { toast("Cadastre pelo menos uma conta antes.","warning"); return; }

  const forma = document.getElementById("formaPagamento")?.value || "debito";
  const ehCredito = forma === "credito";
  const texto = textoLivreInput.value.trim();
  const data = dataMovimentoInput.value;

  // Crédito usa cartão; as outras formas usam conta
  const bancoId = ehCredito
    ? (document.getElementById("cartaoMovimento")?.value || "")
    : contaMovimentoSelect.value;

  // Sem nenhum cartão cadastrado, crédito não é possível
  if (ehCredito && !state.bancos.some(b => b.temCartao)) {
    toast("Nenhum cartão cadastrado. Marque \"Este banco tem cartão de crédito\" na tela de Contas.", "warning");
    return;
  }

  if (!texto || !bancoId || !data) {
    toast(ehCredito ? "Escolha o cartão e preencha os campos." : "Preencha todos os campos.", "error");
    return;
  }

  const itens = parseMultiplosLancamentos(texto);
  if (!itens.length) {
    toast("Não identifiquei nenhum valor. Ex: +1500 salário  ou  gastei 200 no mercado.","error");
    return;
  }

  // No crédito não existe "entrada": toda compra no cartão é um gasto.
  if (ehCredito) {
    itens.forEach(item => { item.tipo = "gasto"; });

    // Bloqueia se a soma das compras ultrapassar o limite disponível
    const cartao = state.bancos.find(b => b.id === bancoId);
    if (cartao && cartao.limite != null) {
      const disp = limiteDisponivel(bancoId);
      const totalCompra = itens.reduce((a, it) => a + it.valor, 0);
      if (disp != null && totalCompra > disp) {
        toast(`Limite insuficiente. Disponível: ${fmtMoeda(disp)}, compra: ${fmtMoeda(totalCompra)}.`, "error");
        return;
      }
    }
  }

  const status = statusMovSelect?.value || "pago";
  const pendente = status === "pendente";
  const parcelas = ehCredito ? (Number(document.getElementById("parcelasMovimento")?.value) || 1) : 1;

  // Bloqueio de saldo negativo: só para gastos JÁ PAGOS que não são crédito.
  // Crédito vai pra fatura (não desconta agora); pendente ainda não saiu.
  if (!ehCredito && !pendente) {
    const totalGasto = itens
      .filter(it => it.tipo === "gasto")
      .reduce((a, it) => a + it.valor, 0);
    if (totalGasto > 0 && !saldoComporta(bancoId, totalGasto)) {
      return;
    }
  }

  // Crédito à vista (compra já feita): não pode passar do limite do cartão,
  // igual a um cartão de verdade. Agendado (pendente) só ocupa limite quando
  // for pago, então não bloqueia aqui.
  if (ehCredito && !pendente) {
    const totalCredito = itens
      .filter(it => it.tipo === "gasto")
      .reduce((a, it) => a + it.valor, 0);
    if (totalCredito > 0 && !limiteComporta(bancoId, totalCredito)) {
      return;
    }
  }

  try {
    for (const item of itens) {
      if (item.tipo === "gasto" && item.categoria === "Outros") {
        item.categoria = await categorizarComIA(item.descricao);
      }

      // Compra no crédito só vira parcela de fatura quando já foi feita.
      // Se o usuário escolheu "Agendar", ele quer uma conta a pagar na data
      // marcada — tratamos como compromisso normal, que aparece em "A pagar".
      if (ehCredito && item.tipo === "gasto" && !pendente) {
        // Compra no crédito: gera uma parcela por fatura, não desconta conta agora
        await lancarCompraCredito(item, bancoId, data, parcelas);
      } else if (ehCredito && item.tipo === "gasto" && pendente && parcelas > 1) {
        // Crédito agendado e parcelado: uma conta a pagar por mês
        const valorParcela = Math.round((item.valor / parcelas) * 100) / 100;
        const compraId = (crypto?.randomUUID?.() || String(Date.now() + Math.random()));
        for (let p = 1; p <= parcelas; p++) {
          const venc = somarMeses(data, p - 1);
          const novo = await dbInsert("movimentos", {
            descricao: `${item.descricao} (${p}/${parcelas})`,
            conta_id: bancoId, data: venc,
            valor: valorParcela, tipo: item.tipo, categoria: item.categoria,
            status: "pendente",
            vencimento: venc,
            pago_em: null,
            forma_pagamento: forma,
            parcela_num: p, parcela_total: parcelas, compra_id: compraId
          });
          state.movimentos.push({
            id:novo.id, descricao:novo.descricao, bancoId:novo.conta_id, data:novo.data,
            valor:Number(novo.valor), tipo:novo.tipo, categoria:novo.categoria,
            status:novo.status, vencimento:novo.vencimento, pagoEm:novo.pago_em,
            formaPagamento: novo.forma_pagamento || forma,
            parcelaNum: p, parcelaTotal: parcelas, compraId: compraId
          });
        }
      } else {
        // Débito, pix, dinheiro ou entrada: comportamento normal
        const novo = await dbInsert("movimentos", {
          descricao: item.descricao, conta_id: bancoId, data,
          valor: item.valor, tipo: item.tipo, categoria: item.categoria,
          status,
          vencimento: pendente ? data : null,
          pago_em: pendente ? null : data,
          forma_pagamento: forma
        });
        state.movimentos.push({
          id:novo.id, descricao:novo.descricao, bancoId:novo.conta_id, data:novo.data,
          valor:Number(novo.valor), tipo:novo.tipo, categoria:novo.categoria,
          status:novo.status, vencimento:novo.vencimento, pagoEm:novo.pago_em,
          formaPagamento: novo.forma_pagamento || forma
        });
      }
    }

    // Aviso de fatura: a compra entra na fatura do mês em que foi feita.
    // Se ainda houver uma fatura MAIS ANTIGA em aberto, avisamos em qual
    // fatura o lançamento entrou — para não parecer que "sumiu".
    if (ehCredito && !pendente) {
      const faturaCompra = faturaDaCompra(data, null);
      const faturaAberta = proximaFaturaAberta(bancoId);
      if (faturaCompra && faturaAberta && faturaCompra !== faturaAberta) {
        const nmMes = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
        const nomeFat = fm => { const [a, m] = fm.split("-"); return `${nmMes[Number(m)-1]} de ${a}`; };
        toast(`Lançado na fatura de ${nomeFat(faturaCompra)}. A fatura de ${nomeFat(faturaAberta)} ainda está em aberto para pagar.`, "info");
      }
    }

    formTexto.reset();
    dataMovimentoInput.value = hojeISO();
    // Volta os campos ao estado padrão (débito) e re-sincroniza o select
    const selForma = document.getElementById("formaPagamento");
    if (selForma) {
      selForma.value = "debito";
      selForma.dispatchEvent(new Event("change"));
    }
    atualizarSelectContas();
    if (labelDataMov) labelDataMov.textContent = "Data";
    renderTudo();

    if (itens.length === 1) {
      const i = itens[0];
      const acao = i.tipo === "entrada" ? "Entrada" : "Gasto";
      toast(
        pendente
          ? `${acao} de ${fmtMoeda(i.valor)} agendado para ${new Date(data+"T00:00:00").toLocaleDateString("pt-BR")}.`
          : `${acao} de ${fmtMoeda(i.valor)} registrado.`,
        "success"
      );
    } else {
      const entradas = itens.filter(i => i.tipo === "entrada").length;
      const gastos = itens.filter(i => i.tipo === "gasto").length;
      const partes = [];
      if (entradas) partes.push(`${entradas} entrada${entradas>1?"s":""}`);
      if (gastos) partes.push(`${gastos} gasto${gastos>1?"s":""}`);
      toast(`${itens.length} lançamentos registrados (${partes.join(" e ")}).`, "success");
    }
  } catch(err) { tratarErro(err); }
});

/* Copia o endereço de e-mail de extratos (ver api/receber-extrato-email.js)
   pro clipboard — é o mesmo endereço fixo pra todo mundo, não muda por
   usuário (a identificação é pelo remetente bater com o e-mail cadastrado). */
function copiarEmailExtrato() {
  const email = document.getElementById("importEmailExtratoTxt")?.textContent?.trim() || "extrato@extrato.fazfinancas.com";
  navigator.clipboard?.writeText(email)
    .then(() => toast("E-mail copiado! Encaminhe o extrato pra ele.", "success"))
    .catch(() => toast(`E-mail: ${email}`, "info"));
}

formImportarExtrato?.addEventListener("submit", async e => {
  e.preventDefault();
  if (!state.bancos.length) { toast("Cadastre pelo menos uma conta antes.","warning"); return; }

  const bancoId = contaExtratoSelect.value;
  const arquivo = arquivoExtratoInput.files[0];
  if (!bancoId || !arquivo) { toast("Selecione a conta e o arquivo.","error"); return; }

  // Lembra a conta para a próxima importação
  try { localStorage.setItem("fp_ultima_conta_extrato", bancoId); } catch (e) {}

  if (arquivo.size > 5 * 1024 * 1024) {
    toast("Arquivo muito grande. O limite é 5 MB.", "error");
    return;
  }

  // Recurso pago: importar extrato exige assinatura ativa
  if (!podeUsar("importarExtrato")) {
    pedirUpgrade("A leitura de extrato está disponível pra quem assina o FAZ Finanças.", "Importar extrato");
    return;
  }

  mostrarLoading(true, "Lendo seu extrato", "Isso pode levar alguns segundos...");
  try {
    const ehArquivoBinario = (arquivo.type || "") === "application/pdf" || (arquivo.type || "").startsWith("image/");
    let corpo;

    if (ehArquivoBinario) {
      // PDF ou imagem: só a IA consegue ler (e consome mais do limite)
      const ok = confirm(
        "Ler um PDF ou foto usa a IA e consome 4 usos do seu limite mensal.\n\n" +
        "Dica: se o seu banco permitir baixar o extrato em CSV ou OFX, o app lê sem gastar nada.\n\n" +
        "Deseja continuar?"
      );
      if (!ok) { mostrarLoading(false); return; }
      const base64 = await arquivoParaBase64(arquivo);
      corpo = { arquivoBase64: base64, tipoArquivo: arquivo.type };
    } else {
      const texto = await arquivo.text();

      // CSV/OFX bem formados: o próprio app lê (rápido e sem custo de IA).
      // Só chamamos a IA se o parser local não der conta.
      const formato = detectarFormato(texto, arquivo.name);
      let movsLocais = [];
      try {
        movsLocais = formato === "ofx" ? parseOFX(texto) : parseCSVExtrato(texto);
      } catch (_) { movsLocais = []; }

      if (movsLocais.length) {
        // Categoriza com as palavras-chave que o app já tem
        const lancamentos = movsLocais.map(m => ({
          data: m.data,
          descricao: m.descricao,
          valor: Math.abs(Number(m.valor) || 0),
          tipo: m.tipo,
          categoria: m.categoria || classificarCategoria(m.descricao)
        }));

        const certos  = lancamentos.filter(l => l.categoria && l.categoria !== "Outros");
        let naoSabe = lancamentos.filter(l => !l.categoria || l.categoria === "Outros");

        // O que o app não soube vai para a IA — ela entende contexto e
        // reconhece estabelecimentos que a lista de palavras-chave não cobre.
        if (naoSabe.length) {
          try {
            const respIA = await fetch("/api/ler-extrato", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                texto: naoSabe.map(l => `${l.data};${l.descricao};${l.tipo === "entrada" ? "" : "-"}${l.valor}`).join("\n"),
                token: localStorage.getItem("fp_token") || "",
                hoje: hojeISO(),
                titular: state.perfil?.nome || "",
                contas: (state.bancos || []).map(b => b.nome),
                categorias: todasCategorias()
              })
            });
            if (respIA.ok) {
              const dadosIA = await respIA.json();
              const resolvidos = dadosIA.lancamentos || [];
              const aindaEmDuvida = dadosIA.duvidas || [];
              // Junta o que a IA resolveu com o que ela também não soube
              abrirRevisao(
                certos.concat(resolvidos),
                aindaEmDuvida,
                `${lancamentos.length} lançamento(s) lidos · a IA ajudou em ${naoSabe.length}`,
                bancoId
              );
              return;
            }
          } catch (e) {
            console.warn("IA indisponível, seguindo sem ela:", e);
          }
        }

        // Sem itens duvidosos (ou IA indisponível): segue com o que temos
        const duvidas = naoSabe.map(l => ({
          ...l,
          pergunta: "Não consegui identificar essa. Em qual categoria ela se encaixa?",
          opcoes: ["Alimentação", "Transporte", "Compras", "Serviços", "Outros"]
        }));

        abrirRevisao(certos, duvidas,
          `${lancamentos.length} lançamento(s) lidos do ${formato.toUpperCase()} · revise antes de salvar`,
          bancoId);
        return;
      }

      // Parser local não conseguiu: manda para a IA
      corpo = { texto };
    }

    corpo.token = localStorage.getItem("fp_token") || "";
    corpo.hoje = hojeISO();
    corpo.titular = state.perfil?.nome || "";
    corpo.contas = (state.bancos || []).map(b => b.nome);
    corpo.categorias = todasCategorias();

    const resp = await fetch("/api/ler-extrato", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo)
    });

    const dados = await resp.json();

    if (!resp.ok) {
      if (dados.erro === "upgrade") {
        pedirUpgrade(dados.motivo || "Recurso disponível nos planos pagos.", "Importar extrato");
        return;
      }
      if (dados.erro === "limite") {
        pedirUpgrade(dados.motivo || "Você atingiu o limite de usos da IA.", "Limite atingido");
        return;
      }
      toast(dados.erro || "Não foi possível ler o extrato.", "error");
      return;
    }

    // Informa quanto foi consumido do limite
    if (dados.usos && dados.usos.custoDesteUso) {
      const restante = Math.max(0, dados.usos.limite - dados.usos.usados);
      toast(`Leitura concluída · usou ${dados.usos.custoDesteUso} do limite · restam ${restante}`, "info");
    }

    const lancamentos = dados.lancamentos || [];
    const duvidas = dados.duvidas || [];

    if (!lancamentos.length && !duvidas.length) {
      toast("Nenhuma transação encontrada nesse arquivo.", "warning");
      return;
    }

    abrirRevisao(lancamentos, duvidas, dados.resumo, bancoId);

  } catch(err) {
    tratarErro(err);
  } finally { mostrarLoading(false); }
});

/* Converte um arquivo em base64 (sem o prefixo data:) */
function arquivoParaBase64(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result).split(",")[1]);
    leitor.onerror = () => reject(new Error("Não consegui ler o arquivo."));
    leitor.readAsDataURL(arquivo);
  });
}

/* ============================================================
   EXTRATO ENVIADO PELO CHAT DA IA
   Mesmo fluxo da tela de Lançamentos, mas iniciado pela conversa.
   ============================================================ */

// Guarda os arquivos enquanto o usuário escolhe a conta de destino
let extratoChatPendente = null;

// Espelha api/ler-extrato.js (CUSTO_TEXTO/CUSTO_ARQUIVO) só pra dar uma
// estimativa de custo ANTES de mandar — quem decide de verdade é o servidor.
const CUSTO_TEXTO_PREVIA   = 2;
const CUSTO_ARQUIVO_PREVIA = 4;
const MAX_EXTRATOS_DE_VEZ  = 8; // limite razoável por leva (evita travar o navegador)

function custoPreviaArquivo(arquivo) {
  const ehBinario = (arquivo.type || "") === "application/pdf" || (arquivo.type || "").startsWith("image/");
  return ehBinario ? CUSTO_ARQUIVO_PREVIA : CUSTO_TEXTO_PREVIA;
}

async function enviarExtratoNoChat(arquivos) {
  arquivos = Array.isArray(arquivos) ? arquivos : [arquivos];
  const lista = document.getElementById("iaChatMensagens");
  const addChat = (txt, quem) => {
    if (!lista) return null;
    const div = document.createElement("div");
    div.className = "ia-msg ia-msg-" + quem;
    if (quem === "ia") {
      // Formatação simples (a função rica é privada do módulo do chat)
      div.innerHTML = esc(txt).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    } else {
      div.textContent = txt;
    }
    lista.appendChild(div);
    lista.scrollTop = lista.scrollHeight;
    return div;
  };

  if (!podeUsar("importarExtrato")) {
    addChat("A leitura de extrato está disponível pra quem assina o FAZ Finanças.", "ia");
    return;
  }
  if (!state.bancos.length) {
    addChat("Antes de importar, cadastre pelo menos uma conta na tela de Contas.", "ia");
    return;
  }
  if (arquivos.length > MAX_EXTRATOS_DE_VEZ) {
    addChat(`Envie no máximo ${MAX_EXTRATOS_DE_VEZ} arquivos de cada vez — você selecionou ${arquivos.length}.`, "ia");
    return;
  }
  const grandeDemais = arquivos.find(a => a.size > 5 * 1024 * 1024);
  if (grandeDemais) {
    addChat(`O arquivo "${grandeDemais.name}" é maior que 5 MB. Envie arquivos menores, por favor.`, "ia");
    return;
  }

  const nomes = arquivos.map(a => a.name).join(", ");
  addChat(arquivos.length > 1 ? `Enviei ${arquivos.length} extratos: ${nomes}` : `Enviei o extrato: ${nomes}`, "user");

  // Uma conta só? usa ela. Várias? pergunta qual — todos os arquivos vão
  // pra mesma conta (é o caso comum: vários meses do mesmo banco).
  if (state.bancos.length === 1) {
    processarExtratosChat(arquivos, state.bancos[0].id, addChat);
  } else {
    extratoChatPendente = arquivos;
    const opcoes = state.bancos.map(b =>
      `<button type="button" class="rev-opcao" onclick="escolherContaExtratoChat('${b.id}')">${esc(b.nome)}</button>`
    ).join("");
    const pergunta = arquivos.length > 1
      ? "Para qual conta devo importar esses lançamentos? (todos os arquivos entram na mesma conta)"
      : "Para qual conta devo importar esses lançamentos?";
    const div = addChat(pergunta, "ia");
    if (div) {
      const box = document.createElement("div");
      box.className = "ia-chat-opcoes";
      box.innerHTML = opcoes;
      div.appendChild(box);
    }
  }
}

function escolherContaExtratoChat(bancoId) {
  const arquivos = extratoChatPendente;
  extratoChatPendente = null;
  if (!arquivos) return;

  const lista = document.getElementById("iaChatMensagens");
  const addChat = (txt, quem) => {
    if (!lista) return null;
    const div = document.createElement("div");
    div.className = "ia-msg ia-msg-" + quem;
    if (quem === "ia") {
      // Formatação simples (a função rica é privada do módulo do chat)
      div.innerHTML = esc(txt).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    } else {
      div.textContent = txt;
    }
    lista.appendChild(div);
    lista.scrollTop = lista.scrollHeight;
    return div;
  };

  const conta = state.bancos.find(b => b.id === bancoId);
  addChat(conta ? conta.nome : "Essa conta", "user");
  processarExtratosChat(arquivos, bancoId, addChat);
}

/* Lê um ou mais extratos em sequência (a API só aceita um por vez) e junta
   tudo numa revisão só — evita abrir a tela de revisão várias vezes seguidas. */
async function processarExtratosChat(arquivos, bancoId, addChat) {
  const multiplos = arquivos.length > 1;
  const custoEstimado = arquivos.reduce((soma, a) => soma + custoPreviaArquivo(a), 0);
  const pensando = addChat(
    multiplos
      ? `Estou lendo os ${arquivos.length} arquivos, um de cada vez (deve consumir cerca de ${custoEstimado} do seu limite mensal). Dependendo do tamanho, isso pode levar alguns minutos — pode deixar a janela aberta que eu aviso quando terminar.`
      : "Estou lendo o arquivo que você enviou. Dependendo do tamanho, isso pode levar até alguns minutos — pode deixar a janela aberta que eu aviso quando terminar.",
    "ia"
  );
  const atualizarPensando = (txt) => {
    if (!pensando) return;
    pensando.innerHTML = esc(txt).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  };

  const lancamentos = [];
  const duvidas = [];
  const falhas = [];
  let resumoUnico = null; // só faz sentido guardar quando é um arquivo só

  for (let i = 0; i < arquivos.length; i++) {
    const arquivo = arquivos[i];
    if (multiplos) atualizarPensando(`Lendo arquivo ${i + 1} de ${arquivos.length}: ${arquivo.name}...`);

    try {
      const ehBinario = (arquivo.type || "") === "application/pdf" || (arquivo.type || "").startsWith("image/");
      let corpo;
      if (ehBinario) {
        corpo = { arquivoBase64: await arquivoParaBase64(arquivo), tipoArquivo: arquivo.type };
      } else {
        corpo = { texto: await arquivo.text() };
      }
      corpo.token = localStorage.getItem("fp_token") || "";
      corpo.hoje = hojeISO();
      corpo.titular = state.perfil?.nome || "";       // ajuda a IA a detectar transferências suas
      corpo.contas = (state.bancos || []).map(b => b.nome); // nomes das contas do usuário
      corpo.categorias = todasCategorias(); // pra IA usar as categorias dele (ex: "ADS"), não só as genéricas

      const resp = await fetch("/api/ler-extrato", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corpo)
      });
      const dados = await resp.json();

      if (!resp.ok) {
        // Upgrade/limite interrompe a leva toda — os arquivos seguintes
        // vão bater na mesma parede, não adianta insistir.
        if (dados.erro === "upgrade" || dados.erro === "limite") {
          pensando?.remove();
          addChat(dados.motivo || (dados.erro === "upgrade" ? "Esse recurso está nos planos pagos." : "Você atingiu o limite de usos da IA neste período."), "ia");
          return;
        }
        falhas.push(arquivo.name);
        continue;
      }

      lancamentos.push(...(dados.lancamentos || []));
      duvidas.push(...(dados.duvidas || []));
      if (dados.resumo) resumoUnico = dados.resumo;
    } catch (err) {
      console.error(`Erro ao ler ${arquivo.name}:`, err);
      falhas.push(arquivo.name);
    }
  }

  pensando?.remove();

  if (!lancamentos.length && !duvidas.length) {
    addChat(
      falhas.length
        ? `Não consegui ler ${falhas.length === arquivos.length ? "nenhum dos arquivos" : "alguns dos arquivos"} (${falhas.join(", ")}). Confira se são extratos válidos (CSV, OFX, PDF ou foto).`
        : "Não encontrei transações nesse(s) arquivo(s). Confira se é mesmo um extrato.",
      "ia"
    );
    return;
  }

  const total = lancamentos.length + duvidas.length;
  let msg = multiplos
    ? `Pronto! Li ${arquivos.length - falhas.length} de ${arquivos.length} arquivo(s) e encontrei **${total} lançamento(s)** no total. Abri a tela de revisão para você conferir antes de salvar.`
    : `Pronto! Encontrei **${total} lançamento(s)**. Abri a tela de revisão para você conferir antes de salvar.`;
  if (falhas.length) msg += ` Não consegui ler: ${falhas.join(", ")}.`;
  addChat(msg, "ia");

  try {
    const resumo = multiplos ? `${arquivos.length} arquivos lidos · ${total} lançamento(s)` : resumoUnico;
    abrirRevisao(lancamentos, duvidas, resumo, bancoId);
  } catch (erroRevisao) {
    console.error("Erro ao abrir a revisão:", erroRevisao);
    addChat("Li os extratos, mas tive um problema ao montar a tela de revisão. Tente de novo, e se persistir me avise.", "ia");
  }
}

/* ============================================================
   REVISÃO DO EXTRATO LIDO PELA IA
   A IA organiza, mas nada é salvo sem o aval do usuário.
   O que ela não soube vira pergunta; o resto pode ser corrigido.
   ============================================================ */

/* Categorias oferecidas na revisão do extrato.
   É uma função porque a lista muda quando o usuário cria as dele. */
/* As categorias básicas que aparecem como botões diretos na revisão.
   As demais (e as personalizadas) ficam acessíveis por "Criar categoria". */
const CATEGORIAS_BASICAS_REVISAO = ["Alimentação", "Transporte", "Moradia", "Compras", "Outros"];

/* Opções de botão para uma dúvida: as básicas + as categorias que o usuário
   criou (inclusive as recém-criadas nesta mesma tela), sem repetir. Assim uma
   categoria criada num item aparece como botão em todos os outros. */
// Antes isso colava TODAS as categorias personalizadas em cada dúvida —
// pra quem tem muitas (comum depois de uns meses de uso), a grade de
// botões virava uma parede enorme e difícil de escanear. A própria IA já
// escolhe a categoria personalizada certa quando faz sentido pro caso
// (ver prompt em _lerExtratoCore.js), então as 3-4 sugestões dela bastam
// aqui — quem quiser outra coisa tem o "📋 Selecionar outra categoria"
// logo abaixo, que já mostra a lista completa (fixas + personalizadas).
function opcoesDaDuvida(d) {
  return (d && d.opcoes) ? d.opcoes.slice() : CATEGORIAS_BASICAS_REVISAO.slice();
}

let revisaoDados = { itens: [], duvidas: [], bancoId: null };
// Qual dúvida está em foco no carrossel "um de cada vez" (ver renderRevisao).
// Responder uma dúvida NÃO troca de item sozinho — quem decide ir pra
// próxima é a pessoa, clicando "Próxima" ou numa bolinha. Assim ela sempre
// vê o botão marcado antes de seguir em frente.
let duvidaAtualIdx = 0;

// Guarda o que foi importado por último, para a IA saber responder
// perguntas como "quanto gastei nesse extrato que enviei?".
let ultimaImportacao = null;

/* ── Extrato recebido por e-mail ──────────────────────────────
   Encaminhar (ou pedir pro banco mandar) o extrato pro e-mail do FAZ é
   uma alternativa ao upload manual — api/receber-extrato-email.js lê e
   grava como pendente; aqui é só buscar o que está esperando e abrir na
   mesma tela de revisão de sempre. Ver conversa com o Filipe de 26/08/2026. */

// Qual linha de extratos_email está sendo revisada agora, se a revisão
// aberta veio de um e-mail (em vez de upload manual) — salvarRevisao()
// usa isso pra marcar como resolvida depois de salvar.
let revisaoOrigemEmailId = null;

async function verificarExtratosPorEmail() {
  try {
    let linhas = await dbSelect("extratos_email");

    // Tem algo que o webhook já recebeu mas a IA ainda não leu (ver
    // api/receber-extrato-email.js — o webhook só baixa o anexo e grava
    // rápido, não roda a IA na hora). Dispara o processamento agora,
    // aproveitando que a pessoa está com o app aberto — sem isso, ela
    // nunca veria o aviso de revisão.
    if ((linhas || []).some(l => !l.processado)) {
      try {
        await fetch("/api/processar-extrato-email-pendente", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            token: localStorage.getItem("fp_token") || "",
            nome: state.perfil?.nome || ""
          })
        });
        linhas = await dbSelect("extratos_email"); // busca de novo, já processado
      } catch (e) {
        console.warn("Não consegui processar extratos pendentes agora:", e);
      }
    }

    state.extratosEmailPendentes = (linhas || []).filter(l => l.processado && !l.revisado);
  } catch (e) {
    state.extratosEmailPendentes = [];
  }
  renderSino();
}

/* Só chamada pra quem tem o espaço Empresarial liberado (perfil.empresarial)
   — pergunta se o extrato que chegou por e-mail é do espaço Pessoal ou do
   Empresarial, já que isso não dá pra saber só pelo remetente. Devolve
   "pessoal" | "empresarial" | null (fechou sem escolher — continua pendente). */
function escolherEspacoExtratoEmail(pendente) {
  return new Promise(resolve => {
    const ov = document.createElement("div");
    ov.className = "confirm-ov";
    ov.innerHTML = `
      <div class="confirm-box is-neutro" role="alertdialog" aria-modal="true">
        <h3 class="confirm-titulo">Extrato recebido por e-mail</h3>
        <p class="confirm-msg">Esse extrato${pendente.remetente ? ` (recebido de ${esc(pendente.remetente)})` : ""} é do espaço Pessoal ou do Empresarial?</p>
        <div class="confirm-btns">
          <button class="confirm-cancel">Pessoal</button>
          <button class="confirm-ok">Empresarial</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add("open"));
    const fechar = val => {
      ov.classList.remove("open");
      setTimeout(() => ov.remove(), 200);
      resolve(val);
    };
    ov.querySelector(".confirm-ok").onclick = () => fechar("empresarial");
    ov.querySelector(".confirm-cancel").onclick = () => fechar("pessoal");
    // Fechar clicando fora não deve escolher "Pessoal" silenciosamente —
    // aqui os dois botões já SÃO escolhas de verdade, então fechar sem
    // clicar em nenhum dos dois devolve null (continua pendente).
    ov.addEventListener("click", e => { if (e.target === ov) fechar(null); });
    ov.addEventListener("keydown", e => { if (e.key === "Escape") fechar(null); });
  });
}

/* Como o e-mail não diz de qual conta é o extrato (diferente do upload
   manual, onde a pessoa já escolhe a conta antes de enviar o arquivo),
   pergunta isso antes de abrir a revisão de verdade. Reaproveita o
   estilo visual de confirmar(), só que com um <select> no meio. */
function escolherContaExtratoEmail(pendente) {
  return new Promise(resolve => {
    const opcoes = state.bancos.map(b => `<option value="${b.id}">${esc(b.nome)}</option>`).join("");
    const ov = document.createElement("div");
    ov.className = "confirm-ov";
    ov.innerHTML = `
      <div class="confirm-box is-neutro" role="alertdialog" aria-modal="true">
        <h3 class="confirm-titulo">Extrato recebido por e-mail</h3>
        <p class="confirm-msg">De qual conta é esse extrato${pendente.remetente ? ` (recebido de ${esc(pendente.remetente)})` : ""}?</p>
        <div class="field" style="margin: 4px 0 18px; text-align:left;">
          <select id="selectContaExtratoEmail">${opcoes}</select>
        </div>
        <div class="confirm-btns">
          <button class="confirm-cancel">Agora não</button>
          <button class="confirm-ok">Revisar</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add("open"));
    const fechar = val => {
      ov.classList.remove("open");
      setTimeout(() => ov.remove(), 200);
      resolve(val);
    };
    ov.querySelector(".confirm-ok").onclick = () => {
      const sel = document.getElementById("selectContaExtratoEmail");
      fechar(sel ? sel.value : null);
    };
    ov.querySelector(".confirm-cancel").onclick = () => fechar(null);
    ov.addEventListener("click", e => { if (e.target === ov) fechar(null); });
    ov.addEventListener("keydown", e => { if (e.key === "Escape") fechar(null); });
  });
}

async function abrirRevisaoExtratoEmail() {
  const pendente = (state.extratosEmailPendentes || [])[0];
  if (!pendente) { toast("Nenhum extrato pendente no momento.", "info"); return; }

  const painelSino = document.getElementById("sinoPainel");
  if (painelSino) painelSino.hidden = true;

  // O e-mail sozinho não diz se o extrato é do espaço Pessoal ou do
  // Empresarial — só quem tem os dois espaços liberados (perfil.empresarial)
  // precisa escolher; quem só tem o Pessoal nem vê essa pergunta, vai direto
  // sem fricção à toa (é o caso da imensa maioria das contas).
  let contextoDoExtrato = "pessoal";
  if (state.perfil?.empresarial) {
    const escolha = await escolherEspacoExtratoEmail(pendente);
    if (!escolha) return; // fechou sem escolher — continua pendente pra próxima vez
    contextoDoExtrato = escolha;
  }

  if (contextoDoExtrato !== state.contextoAtivo) {
    await alternarContexto(contextoDoExtrato);
  }

  if (!state.bancos.length) {
    // Sem conta cadastrada não dá pra revisar — em vez de só avisar e
    // deixar a pessoa procurar sozinha, já leva direto pra tela de criar
    // conta. O extrato continua pendente; ela volta pro sino depois.
    toast("Cadastre uma conta pra revisar esse extrato — te levei direto pra tela.", "info");
    trocarTela("contas");
    setTimeout(() => document.getElementById("nomeBanco")?.focus(), 200);
    return;
  }

  const bancoId = await escolherContaExtratoEmail(pendente);
  if (!bancoId) return; // a pessoa fechou sem escolher — continua pendente pra próxima vez
  const dados = pendente.dados || {};
  revisaoOrigemEmailId = pendente.id;
  abrirRevisao(dados.lancamentos || [], dados.duvidas || [], dados.resumo || "", bancoId);
}

/* Marca (apaga) a linha em extratos_email depois que a revisão foi
   salva de verdade — não faz sentido guardar um extrato já processado. */
async function marcarExtratoEmailResolvido(id) {
  try {
    await fetchSeguro(`${SUPABASE_URL}/rest/v1/extratos_email?id=eq.${id}`, {
      method: "DELETE",
      headers: { ..._h, ...getAuthHeader() }
    });
  } catch (e) {
    console.error("Não consegui marcar o extrato por e-mail como resolvido:", e);
  }
  state.extratosEmailPendentes = (state.extratosEmailPendentes || []).filter(p => p.id !== id);
  renderSino();
}

/* Memória de categorias: aprende as escolhas do usuário.
   Se ele já categorizou "PAG*JLM" como Serviços, não perguntamos de novo.
   A chave usa as primeiras palavras significativas, para que variações do
   mesmo estabelecimento ("UBER *TRIP" e "UBER *TRIP HELP.UBER.COM") batam. */
function chaveMemoria(descricao) {
  const ignorar = new Set(["pag", "pagto", "pagamento", "compra", "cartao", "deb", "cred", "com", "br", "www", "ltda", "me", "sa"]);
  const palavras = String(descricao || "")
    .toLowerCase()
    .replace(/[0-9]/g, " ")
    .replace(/[^a-zà-ú\s]/g, " ")
    .split(/\s+/)
    .filter(p => p.length > 1 && !ignorar.has(p));
  return palavras.slice(0, 2).join(" ").slice(0, 40);
}

function lerMemoriaCategorias() {
  try { return JSON.parse(localStorage.getItem("fp_memoria_categorias") || "{}"); }
  catch (e) { return {}; }
}

function gravarMemoriaCategoria(descricao, categoria) {
  if (!descricao || !categoria || categoria === "Outros") return;
  try {
    const memoria = lerMemoriaCategorias();
    memoria[chaveMemoria(descricao)] = categoria;
    localStorage.setItem("fp_memoria_categorias", JSON.stringify(memoria));
  } catch (e) {}
}

function abrirRevisao(lancamentos, duvidas, resumo, bancoId) {
  const memoria = lerMemoriaCategorias();
  const porData = (a, b) => String(a.data || "").localeCompare(String(b.data || ""));
  // Descarta itens nulos ou sem valor que a IA possa ter devolvido
  lancamentos = (lancamentos || []).filter(x => x && typeof x === "object");
  duvidas = (duvidas || []).filter(x => x && typeof x === "object");
  // Normaliza o tipo: o app usa "gasto", mas a IA pode devolver "saida"
  const norm = (x) => {
    const t = (x.tipo === "saida" || x.tipo === "debito" || x.tipo === "débito") ? "gasto"
            : (x.tipo === "entrada" || x.tipo === "gasto") ? x.tipo
            : "gasto";  // default seguro se a IA não classificou
    return { ...x, tipo: t };
  };

  // Dúvidas que o usuário já respondeu no passado são resolvidas sozinhas
  const duvidasRestantes = [];
  const jaResolvidas = [];
  duvidas.forEach(d0 => {
    const d = norm(d0);
    // A IA marcou como transferência entre contas próprias: vira a pergunta
    // de transferência (Sim/Não), não uma pergunta de categoria.
    if (d0.ehTransferenciaPropria) {
      duvidasRestantes.push({
        ...d,
        resposta: null,
        ehTransferencia: true,
        pergunta: d.pergunta || "Isso parece uma transferência entre as suas contas. O dinheiro não saiu do seu patrimônio, só mudou de lugar.",
        opcoes: ["Sim, é entre minhas contas", "Não, é um gasto/recebimento normal"]
      });
      return;
    }
    const lembrada = memoria[chaveMemoria(d.descricao)];
    if (lembrada && todasCategorias().some(c => c === lembrada)) {
      // A IA já viu isso antes: sugere a categoria de antes JÁ marcada, mas
      // deixa como dúvida para o usuário confirmar ou trocar (não grava sozinha).
      // Coloca a lembrada como 1ª opção e destaca que é a sugestão.
      const opcoesBase = Array.isArray(d.opcoes) && d.opcoes.length ? d.opcoes.slice() : ["Alimentação", "Transporte", "Compras", "Outros"];
      const opcoes = [lembrada, ...opcoesBase.filter(o => o !== lembrada)];
      duvidasRestantes.push({
        ...d,
        resposta: null,
        sugerida: lembrada,               // pré-seleção visual
        pergunta: d.pergunta || `Da última vez você marcou como "${lembrada}". Confirma?`,
        opcoes
      });
    } else {
      duvidasRestantes.push({ ...d, resposta: null });
    }
  });

  // Lançamentos que parecem transferência entre contas próprias viram pergunta:
  // o dinheiro não saiu do patrimônio, então não deveria virar gasto sem aval.
  const itensConfirmados = [];
  lancamentos.map(norm).forEach(l => {
    const transf = pareceTransferenciaPropria(l.descricao, bancoId);
    if (transf && l.tipo === "gasto") {
      duvidasRestantes.push({
        ...l,
        resposta: null,
        ehTransferencia: true,
        pergunta: transf.conta
          ? `Isso parece uma transferência para a sua conta ${transf.conta.nome}. Nesse caso o dinheiro não saiu do seu patrimônio.`
          : "Isso parece uma transferência entre contas. Devo registrar como gasto?",
        opcoes: ["Não é gasto, ignorar", "É um gasto de verdade"]
      });
    } else {
      itensConfirmados.push(l);
    }
  });

  revisaoDados = {
    itens: itensConfirmados.concat(jaResolvidas).sort(porData),
    duvidas: duvidasRestantes.sort(porData),
    bancoId
  };
  duvidaAtualIdx = 0;

  // Registra o extrato que a IA acabou de ler, para responder perguntas
  // como "quanto gastei nesse extrato?" mesmo antes de o usuário salvar.
  // Aqui contam TODOS os lançamentos do arquivo, tal como o cliente enviou.
  try {
    const todosLidos = lancamentos.map(norm);
    const gastosL = todosLidos.filter(m => m.tipo === "gasto");
    const entradasL = todosLidos.filter(m => m.tipo === "entrada");
    const datasL = todosLidos.map(m => m.data).filter(Boolean).sort();
    const bancoL = state.bancos.find(b => b.id === bancoId);
    ultimaImportacao = {
      quando: Date.now(),
      conta: bancoL ? bancoL.nome : "conta",
      salvo: false,
      total: todosLidos.length,
      totalGasto: gastosL.reduce((s,m) => s + Number(m.valor || 0), 0),
      totalEntrada: entradasL.reduce((s,m) => s + Number(m.valor || 0), 0),
      qtdGastos: gastosL.length,
      qtdEntradas: entradasL.length,
      dataInicio: datasL[0] || null,
      dataFim: datasL[datasL.length - 1] || null,
      itens: todosLidos.map(m => ({ descricao: m.descricao, valor: Number(m.valor || 0), tipo: m.tipo, categoria: m.categoria, data: m.data }))
    };
  } catch (e) {}

  const el = document.getElementById("revisaoResumo");
  if (el) {
    const total = revisaoDados.itens.length + revisaoDados.duvidas.length;
    let txt = resumo || `${total} lançamento(s) encontrado(s) · revise antes de salvar`;
    if (jaResolvidas.length) {
      txt += ` · ${jaResolvidas.length} categorizado(s) pelo seu histórico`;
    }
    el.textContent = txt;
  }

  renderRevisao();
  const overlay = document.getElementById("revisaoOverlay");
  if (overlay) overlay.style.display = "flex";
  document.body.style.overflow = "hidden";
}

function fecharRevisao() {
  document.getElementById("revisaoOverlay").style.display = "none";
  document.body.style.overflow = "";
  revisaoDados = { itens: [], duvidas: [], bancoId: null };
}

function renderRevisao() {
  const corpo = document.getElementById("revisaoCorpo");
  if (!corpo) return;

  const pendentes = revisaoDados.duvidas.filter(d => !d.resposta);
  let html = "";

  // 1) O que a IA não soube — precisa da ajuda do usuário. Mostra uma
  // dúvida de cada vez (carrossel), não a lista inteira empilhada — mais
  // fácil de acompanhar quando são muitas.
  if (revisaoDados.duvidas.length) {
    const totalDuvidas = revisaoDados.duvidas.length;
    if (duvidaAtualIdx >= totalDuvidas) duvidaAtualIdx = totalDuvidas - 1;
    if (duvidaAtualIdx < 0) duvidaAtualIdx = 0;
    const i = duvidaAtualIdx;
    const d = revisaoDados.duvidas[i];

    const respondida = !!d.resposta;
    const opcoes = opcoesDaDuvida(d);
    let confirmacaoTransf = "";
    if (d.resposta === "__transferencia" && d.transferencia) {
      const bo = state.bancos.find(b => b.id === d.transferencia.origem);
      const bd = state.bancos.find(b => b.id === d.transferencia.destino);
      confirmacaoTransf = `<div class="rev-transf-ok">↔ Transferência: ${esc(bo?.nome || "conta")} → ${esc(bd?.nome || "conta")}. Não conta como gasto.</div>`;
    }

    html += `<div class="rev-bloco-duvidas">
      <div class="rev-stepper-head">
        <div class="rev-bloco-titulo">${pendentes.length
          ? `${pendentes.length} ${pendentes.length === 1 ? "item precisa" : "itens precisam"} da sua ajuda`
          : "Tudo respondido, obrigado!"}</div>
        <div class="rev-stepper-contador">${i + 1} de ${totalDuvidas}</div>
      </div>
      <div class="rev-stepper-dots">
        ${revisaoDados.duvidas.map((dd, di) => `<button type="button" class="rev-stepper-dot ${di === i ? "rev-stepper-dot-atual" : ""} ${dd.resposta ? "rev-stepper-dot-ok" : ""}" data-ir-duvida="${di}" title="Item ${di + 1} de ${totalDuvidas}" aria-label="Ir para o item ${di + 1}"></button>`).join("")}
      </div>

      <div class="rev-duvida ${respondida ? "rev-duvida-ok" : "rev-duvida-pendente"}" id="rev-duvida-${i}">
        <div class="rev-duvida-topo">
          <span class="rev-duvida-desc">${esc(d.descricao || "")}</span>
          <span class="rev-duvida-val ${d.tipo === "entrada" ? "rev-val-entrada" : "rev-val-saida"}">
            ${d.tipo === "entrada" ? "+" : "−"}${fmtMoeda(Number(d.valor) || 0)}
          </span>
        </div>
        ${d.descricaoOriginal && d.descricaoOriginal !== d.descricao
          ? `<div class="rev-duvida-original" title="Como apareceu no extrato do banco">${esc(d.descricaoOriginal)}</div>`
          : ""}
        <div class="rev-duvida-pergunta">${esc(d.data || "")} · ${esc(d.pergunta || "Qual categoria?")}</div>
        ${confirmacaoTransf}
        <div class="rev-duvida-opcoes">
          ${opcoes.map((op, oi) => {
            const ehSugerida = d.sugerida && op === d.sugerida && !d.resposta;
            return `<button type="button" class="rev-opcao ${d.resposta === op ? "rev-opcao-ativa" : ""} ${ehSugerida ? "rev-opcao-sugerida" : ""}"
              data-duvida="${i}" data-opcao="${oi}">${ehSugerida ? "★ " : ""}${esc(op)}</button>`;
          }).join("")}
          ${d.ehTransferencia ? `<button type="button" class="rev-opcao rev-opcao-criar" data-duvida-criar="${i}">✎ Não, é outra coisa (explicar)</button>` : `<button type="button" class="rev-opcao rev-opcao-criar" data-duvida-criar="${i}">➕ Criar categoria agora</button>`}
          <button type="button" class="rev-opcao rev-opcao-todas" data-duvida-todas="${i}">📋 Selecionar outra categoria</button>
          ${d.ehTransferencia ? "" : `<button type="button" class="rev-opcao rev-opcao-transf" data-duvida-transf="${i}">↔ Transferência entre contas</button>`}
          <button type="button" class="rev-opcao rev-opcao-ignorar ${d.resposta === "__ignorar" ? "rev-opcao-ativa" : ""}"
            data-duvida="${i}" data-opcao="-1">Não importar</button>
        </div>
      </div>

      <div class="rev-stepper-nav">
        <button type="button" class="rev-stepper-btn rev-stepper-prev" data-stepper-prev ${i === 0 ? "disabled" : ""}>‹ Anterior</button>
        <button type="button" class="rev-stepper-btn rev-stepper-next ${respondida && i < totalDuvidas - 1 ? "rev-stepper-btn-pronta" : ""}" data-stepper-next ${i === totalDuvidas - 1 ? "disabled" : ""}>Próxima ›</button>
      </div>
    </div>`;
  }

  // 2) O que a IA já resolveu — conferir e corrigir se quiser
  if (revisaoDados.itens.length) {
    html += `<div class="rev-bloco-ok">
      <div class="rev-bloco-titulo-ok">${revisaoDados.itens.length} já categorizados pela IA — clique na categoria para trocar</div>
      <div class="rev-lista">`;

    revisaoDados.itens.forEach((it, i) => {
      const cat = it.categoria || "Outros";
      const cor = corDaCategoria(cat);
      html += `<div class="rev-item" id="rev-item-${i}">
        <div class="rev-item-linha">
          <span class="rev-item-data">${esc((it.data || "").slice(8, 10))}/${esc((it.data || "").slice(5, 7))}</span>
          <span class="rev-item-desc">${esc(it.descricao || "")}</span>
          <button type="button" class="rev-item-cat-botao${cor ? " rev-item-cat-custom" : ""}"${cor ? ` style="--cat-cor:${esc(cor)}"` : ""} data-item-cat="${i}" aria-label="Trocar categoria">
            ${ICONE_CAT[cat] ?? ICONE_CAT_FALLBACK}
            <span class="rev-item-cat-nome">${esc(cat)}</span>
            <svg class="rev-item-cat-seta" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <span class="rev-item-val ${it.tipo === "entrada" ? "rev-val-entrada" : "rev-val-saida"}">
            ${it.tipo === "entrada" ? "+" : "−"}${fmtMoeda(Number(it.valor) || 0)}
          </span>
          <button type="button" class="rev-item-remover" onclick="removerItemRevisao(${i})" aria-label="Remover">✕</button>
        </div>
      </div>`;
    });

    html += `</div></div>`;
  }

  corpo.innerHTML = html;
  atualizarBotaoRevisao();

  // Liga o clique das opções UMA vez, por delegação. Assim o índice vem do
  // próprio botão (data-duvida), não de uma string interpolada — o que
  // elimina o bug de "sempre cair no último item".
  if (!corpo.dataset.ligado) {
    corpo.addEventListener("click", (e) => {
      // Navegação do carrossel de dúvidas: anterior / próxima / bolinha
      const btnPrev = e.target.closest("[data-stepper-prev]");
      if (btnPrev) {
        if (!btnPrev.disabled) { duvidaAtualIdx = Math.max(0, duvidaAtualIdx - 1); renderRevisao(); }
        return;
      }
      const btnNext = e.target.closest("[data-stepper-next]");
      if (btnNext) {
        if (!btnNext.disabled) { duvidaAtualIdx = Math.min(revisaoDados.duvidas.length - 1, duvidaAtualIdx + 1); renderRevisao(); }
        return;
      }
      const dot = e.target.closest("[data-ir-duvida]");
      if (dot) {
        const di = Number(dot.dataset.irDuvida);
        if (!Number.isNaN(di)) { duvidaAtualIdx = di; renderRevisao(); }
        return;
      }
      // Botão "Criar categoria agora": abre um campo para digitar e criar
      const btnCriar = e.target.closest(".rev-opcao-criar");
      if (btnCriar) {
        const iDuvida = Number(btnCriar.dataset.duvidaCriar);
        if (!Number.isNaN(iDuvida)) abrirCriarCategoria(iDuvida);
        return;
      }
      // Botão "Selecionar outra categoria": abre a lista completa (fixas + do usuário)
      const btnTodas = e.target.closest(".rev-opcao-todas");
      if (btnTodas) {
        const iDuvida = Number(btnTodas.dataset.duvidaTodas);
        if (!Number.isNaN(iDuvida)) abrirTodasCategorias(iDuvida);
        return;
      }
      // Botão "Transferência entre contas": reaproveita o fluxo de escolher a conta
      const btnTransf = e.target.closest(".rev-opcao-transf");
      if (btnTransf) {
        const iDuvida = Number(btnTransf.dataset.duvidaTransf);
        if (!Number.isNaN(iDuvida)) escolherContaTransferencia(iDuvida);
        return;
      }
      // Botão de categoria de um lançamento já confirmado: abre/fecha o seletor
      const btnCatItem = e.target.closest(".rev-item-cat-botao");
      if (btnCatItem) {
        const iItem = Number(btnCatItem.dataset.itemCat);
        if (!Number.isNaN(iItem)) abrirCategoriaItem(iItem);
        return;
      }
      // Escolheu uma categoria no seletor do lançamento já confirmado
      const btnCatEscolha = e.target.closest("[data-item-cat-escolha]");
      if (btnCatEscolha) {
        const iItem = Number(btnCatEscolha.dataset.itemCatEscolha);
        if (!Number.isNaN(iItem)) {
          trocarCategoriaItem(iItem, btnCatEscolha.dataset.cat);
          renderRevisao();
        }
        return;
      }
      // Botão "Criar categoria" dentro do seletor do lançamento já confirmado
      const btnCatCriar = e.target.closest(".rev-item-cat-criar");
      if (btnCatCriar) {
        const iItem = Number(btnCatCriar.dataset.itemCatCriar);
        const painel = btnCatCriar.closest(".rev-item-cat-painel");
        if (!Number.isNaN(iItem) && painel) abrirCriarCategoriaItem(iItem, painel);
        return;
      }
      const btn = e.target.closest(".rev-opcao");
      if (!btn) return;
      const iDuvida = Number(btn.dataset.duvida);
      const iOpcao = Number(btn.dataset.opcao);
      if (Number.isNaN(iDuvida)) return;
      responderDuvida(iDuvida, iOpcao);
    });
    corpo.dataset.ligado = "1";
  }
}

function responderDuvida(indice, indiceOpcao) {
  const d = revisaoDados.duvidas[indice];
  if (!d) return;
  if (indiceOpcao === -1) {
    // Toggle: clicar de novo em "Não importar" desmarca
    d.resposta = (d.resposta === "__ignorar") ? null : "__ignorar";
  } else {
    const opcoes = opcoesDaDuvida(d);
    const escolha = opcoes[indiceOpcao] || "Outros";

    // Pergunta de transferência entre contas próprias:
    //  opção 0 = "Sim, é entre minhas contas" → escolher a outra conta
    //  opção 1 = "Não, é um gasto/recebimento normal" → tratar normal
    if (d.ehTransferencia) {
      if (indiceOpcao === 0) {
        escolherContaTransferencia(indice);   // abre a escolha da outra conta
        return;
      }
      // "Não": deixa de ser transferência; se era gasto/entrada, precisa de categoria.
      // Importante: d.opcoes precisa CONTER o valor que vai em d.resposta —
      // senão nenhum botão bate com a resposta e ela só marca visualmente
      // depois de um segundo clique (o primeiro clique já salva certo, só
      // não aparecia marcado).
      d.ehTransferencia = false;
      d.transferencia = null;
      if (d.tipo === "entrada") {
        d.opcoes = ["Entrada"];
        d.resposta = "Entrada";
      } else {
        // vira uma pergunta de categoria normal
        d.opcoes = ["Alimentação", "Transporte", "Compras", "Outros"];
        d.resposta = null;
      }
      renderRevisao();
      return;
    }

    // Clicar de novo na categoria já escolhida DESMARCA (volta a pendente).
    if (d.resposta === escolha) {
      d.resposta = null;
    } else {
      d.resposta = escolha;
      // Aprende a escolha para não perguntar de novo na próxima importação
      gravarMemoriaCategoria(d.descricao, d.resposta);
    }
  }
  renderRevisao();
}

/* Pergunta para qual (ou de qual) conta foi a transferência, em botões.
   A conta que a pessoa importou já é um dos lados; ela escolhe o outro. */
function escolherContaTransferencia(indice) {
  const d = revisaoDados.duvidas[indice];
  if (!d) return;
  const contaImportada = state.bancos.find(b => b.id === revisaoDados.bancoId);
  // As outras contas (nunca a mesma que foi importada)
  const outras = state.bancos.filter(b => b.id !== revisaoDados.bancoId);

  if (!outras.length) {
    toast("Você só tem uma conta cadastrada. Cadastre a outra conta para registrar a transferência.", "warning");
    return;
  }

  // Monta os botões da outra conta e injeta abaixo da dúvida
  const alvo = document.getElementById(`rev-duvida-${indice}`);
  if (!alvo) return;
  const jaTem = alvo.querySelector(".rev-transf-contas");
  if (jaTem) { jaTem.remove(); return; } // toggle

  const box = document.createElement("div");
  box.className = "rev-transf-contas";
  const rotulo = d.tipo === "entrada"
    ? "De qual das suas contas esse dinheiro veio?"
    : "Para qual das suas contas o dinheiro foi?";
  box.innerHTML = `<div class="rev-transf-rotulo">${esc(rotulo)}</div>
    <div class="rev-transf-opcoes">
      ${outras.map(b => `<button type="button" class="rev-opcao" data-conta="${b.id}">${esc(b.nome)}</button>`).join("")}
    </div>`;
  box.querySelectorAll("[data-conta]").forEach(btn => {
    btn.addEventListener("click", () => {
      const outraId = btn.dataset.conta;
      // Origem e destino conforme o sentido: gasto = saiu daqui, foi para lá;
      // entrada = veio de lá, entrou aqui.
      const origem = d.tipo === "entrada" ? outraId : revisaoDados.bancoId;
      const destino = d.tipo === "entrada" ? revisaoDados.bancoId : outraId;
      d.resposta = "__transferencia";
      d.transferencia = { origem, destino, valor: Number(d.valor) || 0, data: d.data,
        descricao: d.descricao || "Transferência entre contas" };
      renderRevisao();
    });
  });
  alvo.appendChild(box);
}

function trocarCategoriaItem(indice, categoria) {
  const it = revisaoDados.itens[indice];
  if (it) {
    it.categoria = categoria;
    // Correção manual também vira aprendizado
    gravarMemoriaCategoria(it.descricao, categoria);
  }
}

/* Abre a lista COMPLETA de categorias para uma dúvida (botão "Outra…").
   Assim o usuário nunca fica preso nas poucas opções sugeridas — ele
   escolhe qualquer categoria que existe no app, inclusive as suas. */
function abrirTodasCategorias(indice) {
  const d = revisaoDados.duvidas[indice];
  if (!d) return;
  const alvo = document.getElementById(`rev-duvida-${indice}`);
  if (!alvo) return;
  const existente = alvo.querySelector(".rev-todas-cats");
  if (existente) { existente.remove(); return; }  // toggle

  const todas = todasCategorias();
  const box = document.createElement("div");
  box.className = "rev-todas-cats";
  box.innerHTML = `<div class="rev-todas-rotulo">Escolha a categoria:</div>
    <div class="rev-todas-lista">
      ${todas.map(c => `<button type="button" class="rev-opcao" data-cat-completa="${esc(c)}">${esc(c)}</button>`).join("")}
    </div>`;
  box.querySelectorAll("[data-cat-completa]").forEach(btn => {
    btn.addEventListener("click", () => {
      const cat = btn.dataset.catCompleta;
      // Se veio de uma pergunta de transferência, sair do modo transferência —
      // agora é um lançamento normal, com a categoria escolhida.
      d.ehTransferencia = false;
      d.transferencia = null;
      d.resposta = cat;
      gravarMemoriaCategoria(d.descricao, cat);   // aprende para o próximo extrato
      renderRevisao();
    });
  });
  alvo.appendChild(box);
}

/* Manda pra IA o que a pessoa escreveu sobre um lançamento e devolve a
   categoria certa: uma que já existe, ou o nome de uma nova pra criar.
   Usado no "explicar" das dúvidas de transferência — a pessoa descreve o
   que aconteceu (não digita literalmente o nome de uma categoria) e a IA
   pensa em qual categoria combina melhor. */
async function sugerirCategoriaIA(texto, d) {
  try {
    const token = localStorage.getItem("fp_token") || "";
    const resp = await fetch("/api/sugerir-categoria", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        texto,
        descricao: d?.descricao || "",
        valor: d?.valor,
        tipo: d?.tipo,
        categorias: todasCategorias(),
        token
      })
    });
    const dados = await resp.json();
    if (!resp.ok) {
      if (dados.erro === "upgrade" || dados.erro === "limite") {
        toast(dados.motivo || "Recurso indisponível agora.", "warning");
      } else {
        toast(dados.erro || "Não consegui pensar numa categoria.", "error");
      }
      return null;
    }
    return dados; // { categoria, nova }
  } catch (e) {
    toast("Deu um problema de conexão. Tente de novo.", "error");
    return null;
  }
}

/* Abre um campo para o usuário criar uma categoria na hora (botão "Criar
   categoria agora"). Cria de verdade no banco e já usa como resposta. */
function abrirCriarCategoria(indice) {
  const d = revisaoDados.duvidas[indice];
  if (!d) return;
  const alvo = document.getElementById(`rev-duvida-${indice}`);
  if (!alvo) return;
  const existente = alvo.querySelector(".rev-criar-cat");
  if (existente) { existente.remove(); return; }  // toggle

  const box = document.createElement("div");
  box.className = "rev-criar-cat";
  box.innerHTML = d.ehTransferencia
    ? `
    <div class="rev-criar-rotulo">O que é, de verdade? (vira a categoria do lançamento)</div>
    <div class="rev-criar-linha">
      <input type="text" class="rev-criar-input" maxlength="40" placeholder="Ex: reembolso de fornecedor, pagamento de cliente..." />
      <button type="button" class="rev-criar-ok">Usar</button>
    </div>`
    : `
    <div class="rev-criar-rotulo">Nome da nova categoria:</div>
    <div class="rev-criar-linha">
      <input type="text" class="rev-criar-input" maxlength="40" placeholder="Ex: Pets, Assinaturas, Viagem" />
      <button type="button" class="rev-criar-ok">Criar e usar</button>
    </div>`;

  const input = box.querySelector(".rev-criar-input");
  const btnOk = box.querySelector(".rev-criar-ok");

  async function confirmar() {
    const texto = (input.value || "").trim();
    if (!texto) { input.focus(); return; }
    btnOk.disabled = true;

    if (d.ehTransferencia) {
      // Aqui a pessoa DESCREVEU o que aconteceu (não digitou o nome de uma
      // categoria) — manda pra IA pensar na categoria certa, existente ou nova.
      btnOk.textContent = "Pensando…";
      const sugestao = await sugerirCategoriaIA(texto, d);
      if (!sugestao) { btnOk.disabled = false; btnOk.textContent = "Usar"; return; }

      let categoriaFinal = sugestao.categoria;
      if (sugestao.nova) {
        const criada = await criarCategoriaIA(categoriaFinal);
        if (!criada) {
          btnOk.disabled = false; btnOk.textContent = "Usar";
          alert("Não consegui criar a categoria sugerida. Tente descrever de outro jeito.");
          return;
        }
        categoriaFinal = criada;
      }
      // Sai do modo transferência — agora é um lançamento normal, categorizado.
      d.ehTransferencia = false;
      d.transferencia = null;
      d.resposta = categoriaFinal;
      gravarMemoriaCategoria(d.descricao, categoriaFinal);
      renderRevisao();
    } else {
      // "Criar categoria agora": aqui a pessoa está nomeando a categoria de
      // propósito — usa o texto do jeito que ela escreveu, sem passar pela IA.
      btnOk.textContent = "Criando…";
      const criada = await criarCategoriaIA(texto);
      if (criada) {
        d.resposta = criada;
        gravarMemoriaCategoria(d.descricao, criada);
        renderRevisao();
      } else {
        btnOk.disabled = false;
        btnOk.textContent = "Criar e usar";
        alert("Não consegui criar a categoria. Tente outro nome.");
      }
    }
  }

  btnOk.addEventListener("click", confirmar);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); confirmar(); } });
  alvo.appendChild(box);
  input.focus();
}

/* Abre/fecha o seletor de categoria de um lançamento JÁ categorizado pela
   IA (a lista "confirmados"). Mesmo espírito de abrirTodasCategorias: só
   mexe no DOM (não toca revisaoDados), então não dispara re-render — o
   painel some sozinho quando o usuário realmente escolhe algo. */
function abrirCategoriaItem(indice) {
  const it = revisaoDados.itens[indice];
  if (!it) return;
  const alvo = document.getElementById(`rev-item-${indice}`);
  if (!alvo) return;
  const existente = alvo.querySelector(".rev-item-cat-painel");
  if (existente) { existente.remove(); return; }  // toggle

  const opcoes = todasCategorias();
  if (it.tipo === "entrada") opcoes.push("Entrada");
  // Categoria fora da lista (ex: veio assim da IA) — preserva para não perder o valor
  if (it.categoria && !opcoes.includes(it.categoria)) opcoes.unshift(it.categoria);

  const box = document.createElement("div");
  box.className = "rev-item-cat-painel";
  box.innerHTML = `<div class="rev-todas-lista">
    ${opcoes.map(c => `<button type="button" class="rev-opcao rev-opcao-comicone ${it.categoria === c ? "rev-opcao-ativa" : ""}" data-item-cat-escolha="${indice}" data-cat="${esc(c)}">${ICONE_CAT[c] ?? ICONE_CAT_FALLBACK}<span>${esc(c)}</span></button>`).join("")}
    <button type="button" class="rev-opcao rev-item-cat-criar" data-item-cat-criar="${indice}">➕ Criar categoria</button>
  </div>`;
  alvo.appendChild(box);
}

/* Campo para criar categoria na hora, aberto a partir do seletor de um
   lançamento já confirmado (espelha abrirCriarCategoria, que faz o mesmo
   para as dúvidas). */
function abrirCriarCategoriaItem(indice, painel) {
  const existente = painel.querySelector(".rev-criar-cat");
  if (existente) { existente.remove(); return; }  // toggle

  const box = document.createElement("div");
  box.className = "rev-criar-cat";
  box.innerHTML = `
    <div class="rev-criar-rotulo">Nome da nova categoria:</div>
    <div class="rev-criar-linha">
      <input type="text" class="rev-criar-input" maxlength="40" placeholder="Ex: Pets, Assinaturas, Viagem" />
      <button type="button" class="rev-criar-ok">Criar e usar</button>
    </div>`;

  const input = box.querySelector(".rev-criar-input");
  const btnOk = box.querySelector(".rev-criar-ok");

  async function confirmar() {
    const nome = (input.value || "").trim();
    if (!nome) { input.focus(); return; }
    btnOk.disabled = true;
    btnOk.textContent = "Criando…";
    const criada = await criarCategoriaIA(nome);
    if (criada) {
      trocarCategoriaItem(indice, criada);
      renderRevisao();
    } else {
      btnOk.disabled = false;
      btnOk.textContent = "Criar e usar";
      alert("Não consegui criar a categoria. Tente outro nome.");
    }
  }

  btnOk.addEventListener("click", confirmar);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); confirmar(); } });
  painel.appendChild(box);
  input.focus();
}

function removerItemRevisao(indice) {
  revisaoDados.itens.splice(indice, 1);
  renderRevisao();
}

function atualizarBotaoRevisao() {
  const btn = document.getElementById("btnSalvarRevisao");
  if (!btn) return;
  const pendentes = revisaoDados.duvidas.filter(d => !d.resposta).length;
  const total = revisaoDados.itens.length +
                revisaoDados.duvidas.filter(d => d.resposta && d.resposta !== "__ignorar").length;

  // Atalho para resolver todas as pendentes de uma vez
  const btnResto = document.getElementById("btnResolverResto");

  if (pendentes > 0) {
    btn.disabled = true;
    btn.textContent = `Faltam ${pendentes} ${pendentes === 1 ? "resposta" : "respostas"}`;
    // Mostra o atalho "pular pendentes"
    if (btnResto) {
      btnResto.hidden = false;
      btnResto.textContent = `Não importar as ${pendentes} pendente${pendentes === 1 ? "" : "s"}`;
    }
  } else {
    btn.disabled = false;
    btn.textContent = total ? `Salvar ${total} lançamento(s)` : "Nada para salvar";
    if (btnResto) btnResto.hidden = true;
  }
}

/* Marca todas as dúvidas ainda não respondidas como "não importar",
   para o usuário não ficar preso se não souber responder alguma. */
function resolverRestoRevisao() {
  revisaoDados.duvidas.forEach(d => {
    if (!d.resposta) d.resposta = "__ignorar";
  });
  renderRevisao();
}

/* Detecta se a descrição parece uma transferência entre contas do próprio usuário.
   Ex.: "Transferência para Mercado Pago" quando o usuário tem uma conta
   chamada Mercado Pago. Nesses casos o dinheiro não saiu do patrimônio,
   então perguntamos antes de lançar como gasto. */
function pareceTransferenciaPropria(descricao, bancoIdOrigem) {
  const d = String(descricao || "").toLowerCase();

  // A descrição menciona o nome de alguma OUTRA conta cadastrada?
  // Só isso caracteriza transferência entre contas do próprio usuário.
  const contaCitada = (state.bancos || []).find(b => {
    if (b.id === bancoIdOrigem) return false;
    const nome = String(b.nome || "").toLowerCase().trim();
    return nome.length >= 3 && d.includes(nome);
  });

  // Só perguntamos quando há uma conta própria citada. Um Pix ou transferência
  // para uma PESSOA (ex: "Pix - Silvana") é gasto normal — não perguntamos,
  // senão o usuário é bombardeado de perguntas a cada Pix que fez.
  if (contaCitada) return { motivo: "conta", conta: contaCitada };
  return null;
}

/* Confere se um lançamento vindo da IA é válido antes de salvar.
   Também normaliza "saida" para "gasto", que é a convenção do app. */
function lancamentoValido(m) {
  if (!m || typeof m !== "object") return false;
  // Rede de segurança: se a IA devolver "saida", converte para o padrão do app
  if (m.tipo === "saida" || m.tipo === "débito" || m.tipo === "debito") m.tipo = "gasto";
  const dataOk = typeof m.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(m.data);
  const valor = Number(m.valor);
  const valorOk = Number.isFinite(valor) && valor > 0;
  const tipoOk = m.tipo === "entrada" || m.tipo === "gasto";
  const descOk = typeof m.descricao === "string" && m.descricao.trim().length > 0;

  // Defesa final contra categoria inventada (ex: "Você me informa o motivo").
  // Só aceita categoria que exista de verdade no app; senão joga em "Outros"
  // para nunca salvar uma frase-instrução como categoria.
  const cat = String(m.categoria || "").trim();
  if (m.tipo === "entrada") {
    m.categoria = "Entrada";
  } else if (!cat || !todasCategorias().some(c => c.toLowerCase() === cat.toLowerCase())) {
    m.categoria = "Outros";
  }

  return dataOk && valorOk && tipoOk && descOk;
}

let salvandoRevisao = false;

/* Normaliza uma descrição pra comparar (sem acento, minúscula, sem
   pontuação/código de máquina) — usada só pra achar gasto fixo parecido. */
function _normDescFixo(s) {
  return normIA(s).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/* Acha, entre os gastos fixos já cadastrados (qualquer contexto/estado,
   ativo ou pausado), um com nome parecido com a descrição dada — pra não
   cadastrar duas vezes a mesma assinatura/aluguel/mensalidade. Comparação
   simples (uma string contida na outra), no mesmo espírito do match de
   conta já usado nas ações da IA. */
function achaGastoFixoParecido(descricao) {
  const nd = _normDescFixo(descricao);
  if (!nd) return null;
  return (state.recorrencias || []).find(r => {
    const nr = _normDescFixo(r.descricao);
    return nr && (nr === nd || nr.includes(nd) || nd.includes(nr));
  }) || null;
}

async function salvarRevisao() {
  if (salvandoRevisao) return; // evita clique duplo duplicar lançamentos
  const bancoId = revisaoDados.bancoId;
  if (!bancoId) return;

  // Se essa revisão veio de um extrato recebido por e-mail, guarda o id
  // agora — revisaoOrigemEmailId pode ser sobrescrito/limpo por uma
  // próxima revisão aberta antes desta terminar de salvar.
  const origemEmailId = revisaoOrigemEmailId;
  revisaoOrigemEmailId = null;

  // Junta os itens já certos com as dúvidas respondidas
  const paraSalvar = revisaoDados.itens.slice();
  const transferencias = [];
  revisaoDados.duvidas.forEach(d => {
    if (d.resposta === "__transferencia" && d.transferencia) {
      transferencias.push(d.transferencia);
    } else if (d.resposta && d.resposta !== "__ignorar" && d.resposta !== "__transferencia") {
      paraSalvar.push({
        data: d.data, descricao: d.descricao, valor: d.valor,
        tipo: d.tipo, categoria: d.resposta, possivelGastoFixo: d.possivelGastoFixo
      });
    }
  });

  if (!paraSalvar.length) {
    fecharRevisao();
    if (origemEmailId) marcarExtratoEmailResolvido(origemEmailId);
    return;
  }

  // Descarta qualquer item malformado que a IA tenha devolvido
  const validos = paraSalvar.filter(lancamentoValido);
  const descartados = paraSalvar.length - validos.length;

  if (!validos.length) {
    toast("Não consegui validar esses lançamentos. Tente outro arquivo.", "warning");
    return;
  }

  // Não importa o que já existe
  const jaExiste = (m) => state.movimentos.some(x =>
    x.bancoId === bancoId &&
    x.data === m.data &&
    Math.abs(x.valor - Number(m.valor)) < 0.005 &&
    (x.descricao || "").toLowerCase() === (m.descricao || "").toLowerCase()
  );

  const novos = validos.filter(m => !jaExiste(m));
  const dup = validos.length - novos.length;

  if (!novos.length && !transferencias.length) {
    toast("Todos esses lançamentos já estavam no app.", "info");
    fecharRevisao();
    if (origemEmailId) marcarExtratoEmailResolvido(origemEmailId);
    return;
  }

  salvandoRevisao = true;
  const btn = document.getElementById("btnSalvarRevisao");
  if (btn) { btn.disabled = true; btn.textContent = "Salvando..."; }
  mostrarLoading(true, "Salvando lançamentos", "Quase lá...");
  try {
    for (const m of novos) {
      const novo = await dbInsert("movimentos", {
        descricao: m.descricao, conta_id: bancoId, data: m.data,
        valor: Number(m.valor), tipo: m.tipo, categoria: m.categoria,
        status: "pago", pago_em: m.data
      });
      state.movimentos.push({
        id: novo.id, descricao: novo.descricao, bancoId: novo.conta_id, data: novo.data,
        valor: Number(novo.valor), tipo: novo.tipo, categoria: novo.categoria,
        status: "pago", vencimento: null, pagoEm: novo.data
      });
    }

    // Gastos fixos que a IA identificou no extrato (assinatura, aluguel,
    // mensalidade etc.) — cadastra automaticamente em "Gastos Fixos", mas
    // só se ainda não existir um parecido (por nome), pra não duplicar.
    const gastosFixosCriados = [];
    if (podeUsar("recorrencias")) {
      const jaTratadosNesteLote = new Set();
      for (const m of novos) {
        if (m.tipo !== "gasto" || !m.possivelGastoFixo) continue;
        const chave = _normDescFixo(m.descricao);
        if (!chave || jaTratadosNesteLote.has(chave)) continue;
        jaTratadosNesteLote.add(chave);
        if (achaGastoFixoParecido(m.descricao)) continue; // já tem um cadastrado, não duplica
        try {
          const novoFixo = await dbInsert("recorrencias", {
            descricao: m.descricao, valor: Number(m.valor), tipo: "gasto", categoria: m.categoria,
            conta_id: bancoId, dia: Number(m.data.slice(8, 10)),
            frequencia: "mensal", intervalo: 1, intervalo_unidade: "mes",
            inicio: m.data, fim: null, ativa: true
          });
          state.recorrencias.push({
            id: novoFixo.id, descricao: novoFixo.descricao, valor: Number(novoFixo.valor), tipo: novoFixo.tipo,
            categoria: novoFixo.categoria, contaId: novoFixo.conta_id, dia: novoFixo.dia,
            frequencia: novoFixo.frequencia, intervalo: novoFixo.intervalo,
            intervaloUnidade: novoFixo.intervalo_unidade, inicio: novoFixo.inicio, fim: novoFixo.fim,
            ativa: true
          });
          gastosFixosCriados.push(m.descricao);
        } catch (e) { /* não trava a importação por causa disso */ }
      }
    }

    // Transferências entre contas próprias (não entram como gasto/receita)
    for (const t of transferencias) {
      if (!t.origem || !t.destino || t.origem === t.destino) continue;
      const nova = await dbInsert("transferencias", {
        conta_origem: t.origem, conta_destino: t.destino,
        valor: Number(t.valor), data: t.data, descricao: t.descricao
      });
      state.transferencias.push({
        id: nova.id, origem: nova.conta_origem, destino: nova.conta_destino,
        valor: Number(nova.valor), data: nova.data, descricao: nova.descricao || ""
      });
    }

    fecharRevisao();
    formImportarExtrato?.reset();
    resetarDropImport();
    if (origemEmailId) marcarExtratoEmailResolvido(origemEmailId);

    // A memória do extrato já foi registrada na abertura da revisão.
    // Aqui só marcamos que foi efetivamente salvo e quantos entraram.
    if (ultimaImportacao) {
      ultimaImportacao.salvo = true;
      ultimaImportacao.novosSalvos = novos.length;
      ultimaImportacao.jaExistiam = dup;
      ultimaImportacao.quando = Date.now();
    }

    renderTudo();

    let msg = `${novos.length} lançamento(s) salvos.`;
    if (transferencias.length) msg += ` ${transferencias.length} transferência(s) entre contas.`;
    if (dup > 0) msg += ` ${dup} já existia(m).`;
    if (descartados > 0) msg += ` ${descartados} com dados inválidos foram ignorados.`;
    if (gastosFixosCriados.length) msg += ` ${gastosFixosCriados.length} identificado(s) como gasto fixo e cadastrado(s) em Gastos Fixos.`;
    toast(msg, "success");

    // Notifica no sino que o extrato foi importado
    if (novos.length > 0) {
      const totalImp = novos.reduce((s, m) => s + (Number(m.valor) || 0), 0);
      let corpoEvento = `${novos.length} ${novos.length === 1 ? "lançamento foi adicionado" : "lançamentos foram adicionados"} ao seu histórico.`;
      if (gastosFixosCriados.length) {
        corpoEvento += ` Também identifiquei ${gastosFixosCriados.length === 1 ? "1 gasto fixo novo" : `${gastosFixosCriados.length} gastos fixos novos`} (${gastosFixosCriados.join(", ")}) e já cadastrei em Gastos Fixos.`;
      }
      registrarEvento(
        "extrato",
        "Extrato importado",
        corpoEvento,
        "trocarTela('planilha')"
      );
    }

  } catch (err) {
    tratarErro(err);
  } finally {
    salvandoRevisao = false;
    mostrarLoading(false);
  }
}

/* ─── Área de arrastar/soltar ────────────────────────────── */

function resetarDropImport() {
  const txt = document.getElementById("importDropTxt");
  const drop = document.getElementById("importDrop");
  if (txt) txt.textContent = "Escolher arquivo ou arrastar aqui";
  drop?.classList.remove("tem-arquivo");
}

document.getElementById("arquivoExtrato")?.addEventListener("change", e => {
  const arq = e.target.files?.[0];
  const txt = document.getElementById("importDropTxt");
  const drop = document.getElementById("importDrop");
  if (arq && txt) {
    const kb = (arq.size / 1024).toFixed(0);
    txt.textContent = `${arq.name} (${kb} KB)`;
    drop?.classList.add("tem-arquivo");
  } else {
    resetarDropImport();
  }
});

/* Arrastar e soltar */
const _drop = document.getElementById("importDrop");
["dragenter","dragover"].forEach(ev => {
  _drop?.addEventListener(ev, e => {
    e.preventDefault();
    _drop.classList.add("arrastando");
  });
});
["dragleave","drop"].forEach(ev => {
  _drop?.addEventListener(ev, e => {
    e.preventDefault();
    _drop.classList.remove("arrastando");
  });
});
_drop?.addEventListener("drop", e => {
  const arq = e.dataTransfer?.files?.[0];
  if (!arq) return;
  const input = document.getElementById("arquivoExtrato");
  const dt = new DataTransfer();
  dt.items.add(arq);
  input.files = dt.files;
  input.dispatchEvent(new Event("change"));
});

buscaMovimentoInput?.addEventListener("input", () => { movsVisiveis = PAGINA_TAM; renderMovimentos(); });

/* Filtros do histórico: qualquer mudança re-renderiza a lista */
["histCategoria", "histTipo", "histDe", "histAte"].forEach(id => {
  document.getElementById(id)?.addEventListener("change", () => {
    movsVisiveis = PAGINA_TAM;
    renderMovimentos();
  });
});
document.getElementById("histLimpar")?.addEventListener("click", limparFiltrosHistorico);

exportarCSVBtn?.addEventListener("click", () => {
  // Exporta o que está sendo mostrado, respeitando os filtros
  const movs = movimentosFiltradosHistorico();
  if (!movs.length) { toast("Nenhuma movimentação para exportar.","warning"); return; }
  exportarCSV(movs);
  toast(temFiltroHistorico()
    ? `${movs.length} lançamento(s) filtrados exportados.`
    : "CSV exportado com sucesso!", "success");
});
exportarCSVPlanilhaBtn?.addEventListener("click", () => {
  const movs = obterMovimentosTabelaFiltrados();
  if (!movs.length) { toast("Nenhuma movimentação para exportar.","warning"); return; }
  exportarCSV(movs); toast("CSV exportado com sucesso!","success");
});

formTransferencia?.addEventListener("submit", async e => {
  e.preventDefault();
  if (state.bancos.length<2) { toast("Cadastre pelo menos duas contas para transferências.","warning"); return; }
  const origem = transOrigemSelect.value, destino = transDestinoSelect.value;
  if (origem===destino) { toast("Selecione contas diferentes para origem e destino.","error"); return; }
  const valor = Number(transValorInput.value), data = transDataInput.value;
  if (!valor||!data) { toast("Preencha o valor e a data.","error"); return; }
  // A conta de origem precisa ter saldo para a transferência
  if (!saldoComporta(origem, valor)) { return; }
  try {
    const novo = await dbInsert("transferencias", { conta_origem:origem, conta_destino:destino, valor, data, descricao:transDescricaoInput.value.trim() });
    state.transferencias.push({ id:novo.id, origem:novo.conta_origem, destino:novo.conta_destino, valor:Number(novo.valor), data:novo.data, descricao:novo.descricao||"" });
    formTransferencia.reset(); transDataInput.value = hojeISO(); renderTudo();
    toast(`Transferência de ${fmtMoeda(valor)} realizada!`,"success");
  } catch(err) { tratarErro(err); }
});

/* ═══ Empresarial: dados da empresa + notas fiscais (registro/controle,
   não emite NF-e de verdade — isso exigiria um emissor pago à parte) ═══ */

/* Valida CNPJ pelos dígitos verificadores (só matemática — não confirma
   que a empresa existe de verdade, só que o número é válido). */
function cnpjValido(cnpj) {
  const c = String(cnpj || "").replace(/\D/g, "");
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calcDV = (base) => {
    const pesos = base.length === 12
      ? [5,4,3,2,9,8,7,6,5,4,3,2]
      : [6,5,4,3,2,9,8,7,6,5,4,3,2];
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * pesos[i];
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const dv1 = calcDV(c.slice(0, 12));
  const dv2 = calcDV(c.slice(0, 12) + dv1);
  return c === c.slice(0, 12) + String(dv1) + String(dv2);
}

/* Só formata quando já tem os 14 dígitos — evita brigar com o cursor
   enquanto a pessoa ainda está digitando. */
function formatarCnpj(v) {
  const d = String(v || "").replace(/\D/g, "").slice(0, 14);
  if (d.length !== 14) return v;
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

document.getElementById("empresaCnpj")?.addEventListener("blur", e => {
  e.target.value = formatarCnpj(e.target.value);
});

document.getElementById("formDadosEmpresa")?.addEventListener("submit", async e => {
  e.preventDefault();
  const cnpjInput = document.getElementById("empresaCnpj");
  const razaoInput = document.getElementById("empresaRazaoSocial");
  const fantasiaInput = document.getElementById("empresaNomeFantasia");
  const cnpjDigitado = cnpjInput.value.trim();
  if (cnpjDigitado && !cnpjValido(cnpjDigitado)) {
    toast("CNPJ inválido — confira os números.", "error");
    cnpjInput.focus();
    return;
  }
  try {
    const salvo = await salvarPerfil({
      empresa_cnpj: cnpjDigitado ? formatarCnpj(cnpjDigitado) : null,
      empresa_razao_social: razaoInput.value.trim() || null,
      empresa_nome_fantasia: fantasiaInput.value.trim() || null
    });
    state.perfil = mapPerfil(salvo);
    toast("Dados da empresa salvos!", "success");
  } catch (err) { tratarErro(err); }
});

/* Acha um contato cadastrado pelo nome exato (sem diferenciar maiúscula/
   acento) — usado ao registrar nota fiscal, pelo formulário ou pela IA,
   pra já linkar contato_id quando o nome bater com um já cadastrado. Sem
   bate-volta nenhum: se não achar, a nota salva do mesmo jeito, só sem
   o vínculo (fica como texto solto). */
function _acharContatoPorNome(nome) {
  const alvo = normIA(nome);
  if (!alvo) return null;
  const achado = (state.contatos || []).find(c => normIA(c.nome) === alvo);
  return achado ? achado.id : null;
}

document.getElementById("formNotaFiscal")?.addEventListener("submit", async e => {
  e.preventDefault();
  const tipo = document.getElementById("nfTipo").value;
  const numero = document.getElementById("nfNumero").value.trim();
  const valor = Number(document.getElementById("nfValor").value);
  const data = document.getElementById("nfData").value;
  const clienteFornecedor = document.getElementById("nfClienteFornecedor").value.trim();
  const descricao = document.getElementById("nfDescricao").value.trim();
  if (!valor || !data) { toast("Preencha o valor e a data.", "error"); return; }
  try {
    const contatoId = _acharContatoPorNome(clienteFornecedor);
    const novo = await dbInsert("notas_fiscais", {
      tipo, numero: numero || null, valor, data,
      cliente_fornecedor: clienteFornecedor || null, descricao: descricao || null,
      contato_id: contatoId
    });
    state.notasFiscais.push({
      id: novo.id, tipo: novo.tipo, numero: novo.numero || "",
      valor: Number(novo.valor), data: novo.data,
      clienteFornecedor: novo.cliente_fornecedor || "", descricao: novo.descricao || "",
      contatoId: novo.contato_id || null
    });
    e.target.reset();
    document.getElementById("nfData").value = hojeISO();
    renderTudo();
    toast("Nota fiscal registrada!", "success");
  } catch (err) { tratarErro(err); }
});

/* Importar nota fiscal por foto/PDF: a IA lê os dados e PRÉ-PREENCHE o
   formulário acima — nunca salva sozinha. O usuário revisa e clica em
   "Registrar nota" como se tivesse digitado, corrigindo o que a IA
   errar. O tipo (emitida/recebida) é decidido comparando o CNPJ salvo
   em Conta > Dados da empresa com o emitente/destinatário da nota; sem
   CNPJ salvo (ou sem bater com nenhum), o campo fica em branco pro
   usuário escolher. */
document.getElementById("nfArquivoImportar")?.addEventListener("change", async e => {
  const arquivo = e.target.files[0];
  e.target.value = ""; // permite escolher o mesmo arquivo de novo depois
  if (!arquivo) return;

  if (arquivo.size > 5 * 1024 * 1024) {
    toast("Arquivo muito grande. O limite é 5 MB.", "error");
    return;
  }
  if (!podeUsar("importarExtrato")) {
    pedirUpgrade("A leitura de nota fiscal por IA está disponível pra quem assina o FAZ Finanças.", "Importar nota fiscal");
    return;
  }

  const textoBtn = document.getElementById("nfImportarTexto");
  const textoOriginal = textoBtn ? textoBtn.textContent : null;
  if (textoBtn) textoBtn.textContent = "Lendo...";
  mostrarLoading(true, "Lendo a nota fiscal", "Isso pode levar alguns segundos...");
  try {
    const base64 = await arquivoParaBase64(arquivo);
    const resp = await fetch("/api/ler-nota-fiscal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        arquivoBase64: base64,
        tipoArquivo: arquivo.type,
        token: localStorage.getItem("fp_token") || "",
        hoje: hojeISO(),
        meuCnpj: state.perfil?.empresaCnpj || ""
      })
    });
    const dados = await resp.json();
    if (!resp.ok) {
      if (dados.erro === "limite") { toast(dados.motivo || "Limite de IA atingido.", "warning"); return; }
      if (dados.erro === "upgrade") { pedirUpgrade(dados.motivo, "Importar nota fiscal"); return; }
      toast(dados.erro || "Não consegui ler essa nota fiscal.", "error");
      return;
    }

    if (dados.tipo) document.getElementById("nfTipo").value = dados.tipo;
    if (dados.numero) document.getElementById("nfNumero").value = dados.numero;
    if (dados.valor != null) document.getElementById("nfValor").value = dados.valor;
    if (dados.data) document.getElementById("nfData").value = dados.data;
    if (dados.clienteFornecedor) document.getElementById("nfClienteFornecedor").value = dados.clienteFornecedor;
    if (dados.descricao) document.getElementById("nfDescricao").value = dados.descricao;

    document.getElementById("formNotaFiscal")?.scrollIntoView({ behavior: "smooth", block: "center" });
    toast(
      dados.tipo
        ? "Nota lida! Confira os dados e clique em \"Registrar nota\"."
        : "Nota lida! Confira os dados, escolha o tipo (emitida/recebida) e clique em \"Registrar nota\".",
      "success"
    );
  } catch (err) {
    tratarErro(err);
  } finally {
    mostrarLoading(false);
    if (textoBtn) textoBtn.textContent = textoOriginal;
  }
});

/* Atalho "Lembrete de guias" (DAS/ISS) na tela de Notas Fiscais: leva pra
   Gastos Fixos com a descrição e a categoria já preenchidas — a pessoa só
   completa a conta, o valor aproximado (o real ajusta a cada mês, na hora
   de marcar como pago) e o dia do vencimento. */
function atalhoLembreteImposto(nome) {
  trocarTela("recorrencias");
  const desc = document.getElementById("recDescricao");
  const cat = document.getElementById("recCategoria");
  if (desc) desc.value = nome;
  if (cat) cat.value = "Impostos e Taxas";
  desc?.focus();
  toast(`Preenchi "${nome}" como gasto fixo — escolha a conta, um valor aproximado e o dia do vencimento (o valor real de cada mês você ajusta na hora de marcar como pago).`, "info");
}

async function excluirNotaFiscal(id) {
  const ok = await confirmar("Excluir nota fiscal?", { tipo: "perigo", descricao: "O registro será removido.", okLabel: "Excluir" });
  if (!ok) return;
  try {
    await dbDelete("notas_fiscais", id);
    state.notasFiscais = state.notasFiscais.filter(n => n.id !== id);
    renderTudo();
    toast("Nota fiscal excluída.", "info", true);
  } catch (err) { tratarErro(err); }
}

/* Cards de resumo + lista da tela de Notas Fiscais */
function renderNotasFiscais() {
  const lista = document.getElementById("listaNotasFiscais");
  if (!lista) return;

  const mesAtual = mesAtualISO();
  const doMes = state.notasFiscais.filter(n => (n.data || "").startsWith(mesAtual));
  const totalEmitidas  = doMes.filter(n => n.tipo === "emitida").reduce((s,n) => s + n.valor, 0);
  const totalRecebidas = doMes.filter(n => n.tipo === "recebida").reduce((s,n) => s + n.valor, 0);
  const elEmitidas  = document.getElementById("nfResumoEmitidas");
  const elRecebidas = document.getElementById("nfResumoRecebidas");
  if (elEmitidas)  elEmitidas.textContent  = fmtMoeda(totalEmitidas);
  if (elRecebidas) elRecebidas.textContent = fmtMoeda(totalRecebidas);

  if (!state.notasFiscais.length) {
    lista.innerHTML = `<div class="empty-state">Nenhuma nota fiscal registrada ainda.</div>`;
    return;
  }
  lista.innerHTML = [...state.notasFiscais]
    .sort((a, b) => (b.data || "").localeCompare(a.data || ""))
    .map(n => `
      <div class="transferencia-item">
        <div class="trans-top">
          <div class="trans-contas">
            <span>${n.tipo === "emitida" ? "Emitida" : "Recebida"}${n.numero ? " · Nº " + esc(n.numero) : ""}</span>
            ${n.clienteFornecedor ? `<span class="trans-seta">→</span><span>${esc(n.clienteFornecedor)}</span>` : ""}
          </div>
          <div class="trans-valor">${fmtMoeda(n.valor)}</div>
        </div>
        <div class="trans-meta">${n.descricao ? esc(n.descricao) + " · " : ""}${new Date(n.data + "T00:00:00").toLocaleDateString("pt-BR")}</div>
        <div class="item-actions">
          <button class="btn-icon btn-icon-danger" onclick="excluirNotaFiscal('${n.id}')"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></span>Excluir</button>
        </div>
      </div>`).join("");
}

document.getElementById("formContato")?.addEventListener("submit", async e => {
  e.preventDefault();
  const nome = document.getElementById("ctNome").value.trim();
  const tipo = document.getElementById("ctTipo").value;
  const documento = document.getElementById("ctDocumento").value.trim();
  const telefone = document.getElementById("ctTelefone").value.trim();
  const email = document.getElementById("ctEmail").value.trim();
  if (!nome) { toast("Preencha o nome.", "error"); return; }
  if (state.contatos.some(c => normIA(c.nome) === normIA(nome))) {
    toast("Já existe um cadastro com esse nome.", "error");
    return;
  }
  try {
    const novo = await dbInsert("contatos", {
      nome, tipo, documento: documento || null, telefone: telefone || null, email: email || null
    });
    state.contatos.push({ id: novo.id, nome: novo.nome, tipo: novo.tipo, documento: novo.documento || "", telefone: novo.telefone || "", email: novo.email || "" });
    state.contatos.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    e.target.reset();
    renderTudo();
    toast(`"${nome}" cadastrado!`, "success");
  } catch (err) { tratarErro(err); }
});

async function excluirContato(id) {
  const c = state.contatos.find(x => x.id === id);
  const ok = await confirmar("Excluir cadastro?", { tipo: "perigo", descricao: "As notas fiscais já registradas com esse nome continuam do jeito que estão, só perdem o vínculo com o cadastro.", okLabel: "Excluir" });
  if (!ok) return;
  try {
    await dbDelete("contatos", id);
    state.contatos = state.contatos.filter(x => x.id !== id);
    state.notasFiscais.forEach(n => { if (n.contatoId === id) n.contatoId = null; });
    renderTudo();
    toast(`"${c?.nome || "Cadastro"}" excluído.`, "info", true);
  } catch (err) { tratarErro(err); }
}

/* Lista de clientes/fornecedores + o datalist que alimenta a sugestão no
   campo "Cliente / Fornecedor" das Notas Fiscais. */
function renderContatos() {
  const lista = document.getElementById("listaContatos");
  const datalist = document.getElementById("listaContatosNomes");
  if (datalist) {
    datalist.innerHTML = state.contatos.map(c => `<option value="${esc(c.nome)}"></option>`).join("");
  }
  if (!lista) return;

  if (!state.contatos.length) {
    lista.innerHTML = `<div class="empty-state">Nenhum cliente ou fornecedor cadastrado ainda.</div>`;
    return;
  }
  const rotuloTipo = { cliente: "Cliente", fornecedor: "Fornecedor", ambos: "Cliente e fornecedor" };
  lista.innerHTML = state.contatos.map(c => {
    const notas = state.notasFiscais.filter(n => n.contatoId === c.id);
    const totalEmitidas = notas.filter(n => n.tipo === "emitida").reduce((s, n) => s + n.valor, 0);
    const totalRecebidas = notas.filter(n => n.tipo === "recebida").reduce((s, n) => s + n.valor, 0);
    const partesTotal = [];
    if (totalEmitidas > 0) partesTotal.push(`emitido ${fmtMoeda(totalEmitidas)}`);
    if (totalRecebidas > 0) partesTotal.push(`recebido ${fmtMoeda(totalRecebidas)}`);
    const contato = [c.documento, c.telefone, c.email].filter(Boolean).join(" · ");
    return `
      <div class="transferencia-item">
        <div class="trans-top">
          <div class="trans-contas"><span>${esc(c.nome)}</span><span class="trans-seta">·</span><span>${rotuloTipo[c.tipo] || "Cliente"}</span></div>
          <div class="trans-valor">${partesTotal.length ? partesTotal.join(" · ") : "Sem notas ainda"}</div>
        </div>
        ${contato ? `<div class="trans-meta">${esc(contato)}</div>` : ""}
        <div class="item-actions">
          <button class="btn-icon btn-icon-danger" onclick="excluirContato('${c.id}')"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></span>Excluir</button>
        </div>
      </div>`;
  }).join("");
}

formRecorrencia?.addEventListener("submit", async e => {
  e.preventDefault();
  // Bloqueio de plano: recorrências é recurso Premium
  if (!podeUsar("recorrencias")) {
    pedirUpgrade("Cadastre aluguel, assinaturas e salário uma vez e o app cuida dos vencimentos.", "Gastos fixos");
    return;
  }
  if (!state.bancos.length) { toast("Cadastre uma conta antes.","warning"); return; }
  const descricao = recDescricaoInput.value.trim();
  const valor = Number(recValorInput.value);
  const tipo = recTipoSelect.value;
  const categoria = recCategoriaSelect.value;
  const contaId = recContaSelect.value;
  const frequencia = document.getElementById("recFrequencia").value;
  const intervalo = Number(document.getElementById("recIntervalo").value) || 1;
  const intervaloUnidade = document.getElementById("recIntervaloUnidade").value;
  const inicio = document.getElementById("recInicio").value;
  const fim = document.getElementById("recFim").value || null;

  if (!descricao || !valor || !contaId || !inicio) {
    toast("Preencha descrição, valor, conta e o primeiro vencimento.","error"); return;
  }
  if (fim && fim < inicio) { toast("A data final não pode ser antes do início.","error"); return; }

  try {
    const novo = await dbInsert("recorrencias", {
      descricao, valor, tipo, categoria, conta_id: contaId,
      dia: Number(inicio.slice(8,10)),
      frequencia, intervalo, intervalo_unidade: intervaloUnidade,
      inicio, fim, ativa: true
    });
    state.recorrencias.push({
      id:novo.id, descricao:novo.descricao, valor:Number(novo.valor), tipo:novo.tipo,
      categoria:novo.categoria, contaId:novo.conta_id, dia:novo.dia,
      frequencia:novo.frequencia, intervalo:novo.intervalo,
      intervaloUnidade:novo.intervalo_unidade, inicio:novo.inicio, fim:novo.fim,
      ativa: novo.ativa !== false
    });
    formRecorrencia.reset();
    document.getElementById("recInicio").value = hojeISO();
    ajustarFormRecorrencia();
    renderTudo();
    toast(`"${descricao}" cadastrado. Os vencimentos aparecem automaticamente.`,"success");
  } catch(err) { tratarErro(err); }
});

/* Mostra/esconde os campos da frequência personalizada + preview */
function ajustarFormRecorrencia() {
  const freq = document.getElementById("recFrequencia")?.value;
  const ehPers = freq === "personalizada";
  document.getElementById("fieldRecIntervalo")?.classList.toggle("hidden-filter", !ehPers);
  document.getElementById("fieldRecIntervaloUn")?.classList.toggle("hidden-filter", !ehPers);
  document.getElementById("formRecorrencia")?.classList.toggle("com-intervalo", ehPers);
  atualizarPreviewRec();
}

/* Mostra ao usuário quando vai vencer */
function atualizarPreviewRec() {
  if (!previewRecEl) return;
  const inicio = document.getElementById("recInicio")?.value;
  if (!inicio) { previewRecEl.innerHTML = ""; return; }

  const fake = {
    ativa: true,
    frequencia: document.getElementById("recFrequencia").value,
    intervalo: Number(document.getElementById("recIntervalo").value) || 1,
    intervaloUnidade: document.getElementById("recIntervaloUnidade").value,
    inicio,
    fim: document.getElementById("recFim").value || null
  };

  const proximas = ocorrenciasDe(fake, inicio, somarMeses(inicio, 10)).slice(0, 3);
  if (!proximas.length) { previewRecEl.innerHTML = ""; return; }

  const fmt = d => new Date(d+"T00:00:00").toLocaleDateString("pt-BR", { day:"2-digit", month:"short" });

  previewRecEl.innerHTML = `
    <svg class="rec-preview-icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
    <span><strong>${textoFrequencia(fake)}</strong> · vence ${proximas.map(fmt).join(", ")}${fake.fim ? "" : "…"}</span>
  `;
}

["recFrequencia","recIntervalo","recIntervaloUnidade","recInicio","recFim"].forEach(id => {
  document.getElementById(id)?.addEventListener("change", ajustarFormRecorrencia);
});

/* O botão "gerar lançamentos" foi removido:
   as ocorrências agora são calculadas automaticamente pela regra. */

formMeta?.addEventListener("submit", async e => {
  e.preventDefault();
  const cat = metaCategoriaSelect.value, limite = Number(metaValorInput.value);
  if (!cat) { toast("Selecione uma categoria.","error"); return; }
  if (!limite) { toast("Informe o limite mensal.","error"); return; }
  try {
    const idx = state.metas.findIndex(m=>m.categoria===cat);
    if (idx>=0) {
      const att = await dbUpdate("metas", state.metas[idx].id, { limite });
      state.metas[idx].limite = Number(att.limite);
      toast(`Meta de "${cat}" atualizada.`,"success");
    } else {
      // Bloqueio de plano: básico pode ter no máximo N metas
      const limiteMetas = limitesAtuais().metas;
      if ((state.metas?.length || 0) >= limiteMetas) {
        pedirUpgrade("Criar metas é um recurso de quem assina o FAZ Finanças.", "Assine para continuar");
        return;
      }
      const novo = await dbInsert("metas", { categoria:cat, limite });
      state.metas.push({ id:novo.id, categoria:novo.categoria, limite:Number(novo.limite) });
      toast(`Meta de "${cat}" criada!`,"success");
    }
    formMeta.reset(); renderTudo();
  } catch(err) { tratarErro(err); }
});

tipoFiltroSelect?.addEventListener("change",()=>{atualizarCamposFiltro();renderPlanilha();});
filtroDiaInput?.addEventListener("change", renderPlanilha);
filtroMesInput?.addEventListener("change", renderPlanilha);
filtroAnoInput?.addEventListener("input",  renderPlanilha);
filtroCategoriaTabela?.addEventListener("change", renderPlanilha);
limparFiltrosBtn?.addEventListener("click",()=>{
  if(tipoFiltroSelect) tipoFiltroSelect.value="todos";
  if(filtroDiaInput) filtroDiaInput.value="";
  if(filtroMesInput) filtroMesInput.value="";
  if(filtroAnoInput) filtroAnoInput.value="";
  if(filtroCategoriaTabela) filtroCategoriaTabela.value="todas";
  atualizarCamposFiltro(); renderPlanilha();
});

/* ─── Excluir tudo de UMA categoria (Contas, Lançamentos, Metas...) ───
   Antes existia um único botão "Limpar tudo" no Histórico que apagava
   contas + lançamentos + metas + investimentos juntos — quem só queria
   limpar os lançamentos pra testar acabava perdendo as contas também,
   sem querer. Agora cada tela tem seu próprio "excluir todas as X",
   sem tocar nas outras categorias. Pra apagar ABSOLUTAMENTE tudo
   (inclusive o cadastro), o caminho é "Excluir minha conta" em
   Conta > Segurança, que já tem confirmação em duas etapas.
   tabelas: lista de { tabela, ids() } — cada uma vira um dbDelete em
   paralelo; várias entradas cobrem cascata (ex: apagar contas também
   apaga os lançamentos vinculados a elas). */
async function excluirTodosDeCategoria({ titulo, descricao, okLabel, tabelas, aposExcluir, exigirDigitar, semItens }) {
  const totalItens = tabelas.reduce((s, t) => s + t.ids().length, 0);
  if (!totalItens) { toast(semItens || "Não tem nada pra apagar aqui ainda.", "info"); return; }

  const ok = await confirmar(titulo, { tipo: "perigo", descricao, okLabel: okLabel || "Excluir tudo" });
  if (!ok) return;

  if (exigirDigitar) {
    const texto = await promptTexto(`Pra confirmar, digite <strong>${exigirDigitar}</strong> abaixo:`, exigirDigitar);
    if (texto !== exigirDigitar) {
      if (texto !== null) toast("Confirmação incorreta. Nada foi apagado.", "info");
      return;
    }
  }

  mostrarLoading(true, "Apagando", "Um momento...");
  try {
    for (const t of tabelas) {
      const ids = t.ids();
      if (ids.length) await Promise.all(ids.map(id => dbDelete(t.tabela, id)));
    }
    aposExcluir();
    renderTudo();
    toast("Apagado com sucesso.", "info");
  } catch (err) { tratarErro(err); }
  finally { mostrarLoading(false); }
}

limparTudoBtn?.addEventListener("click", async () => {
  const movsIds = state.movimentos.map(m => m.id);
  await excluirTodosDeCategoria({
    titulo: "Excluir todos os lançamentos?",
    descricao: `${movsIds.length} lançamento(s) serão apagados. Suas contas, metas e investimentos continuam intactos. Não dá para desfazer.`,
    okLabel: "Excluir lançamentos",
    tabelas: [{ tabela: "movimentos", ids: () => movsIds }],
    aposExcluir: () => { state.movimentos = []; },
    semItens: "Não tem nenhum lançamento pra apagar."
  });
});

document.getElementById("excluirTodasContasBtn")?.addEventListener("click", async () => {
  const contaIds = state.bancos.map(b => b.id);
  const movsIds = state.movimentos.filter(m => contaIds.includes(m.bancoId)).map(m => m.id);
  await excluirTodosDeCategoria({
    titulo: "Excluir todas as contas?",
    descricao: `${contaIds.length} conta(s) e ${movsIds.length} lançamento(s) vinculados serão apagados. Não dá para desfazer.`,
    okLabel: "Excluir contas",
    tabelas: [
      { tabela: "movimentos", ids: () => movsIds },
      { tabela: "contas", ids: () => contaIds },
    ],
    exigirDigitar: "EXCLUIR",
    aposExcluir: () => {
      const idsSet = new Set(contaIds);
      state.movimentos = state.movimentos.filter(m => !idsSet.has(m.bancoId));
      state.bancos = [];
    },
    semItens: "Não tem nenhuma conta pra apagar."
  });
});

document.getElementById("excluirTodasTransfBtn")?.addEventListener("click", async () => {
  const ids = state.transferencias.map(t => t.id);
  await excluirTodosDeCategoria({
    titulo: "Excluir todas as transferências?",
    descricao: `${ids.length} transferência(s) serão apagadas. Não dá para desfazer.`,
    okLabel: "Excluir transferências",
    tabelas: [{ tabela: "transferencias", ids: () => ids }],
    aposExcluir: () => { state.transferencias = []; },
    semItens: "Não tem nenhuma transferência pra apagar."
  });
});

document.getElementById("excluirTodosGastosFixosBtn")?.addEventListener("click", async () => {
  const ids = state.recorrencias.map(r => r.id);
  await excluirTodosDeCategoria({
    titulo: "Excluir todos os gastos fixos?",
    descricao: `${ids.length} gasto(s) fixo(s) serão apagados — eles deixam de se repetir. Não dá para desfazer.`,
    okLabel: "Excluir gastos fixos",
    tabelas: [{ tabela: "recorrencias", ids: () => ids }],
    aposExcluir: () => { state.recorrencias = []; },
    semItens: "Não tem nenhum gasto fixo pra apagar."
  });
});

document.getElementById("excluirTodasMetasBtn")?.addEventListener("click", async () => {
  const ids = state.metas.map(m => m.id);
  await excluirTodosDeCategoria({
    titulo: "Excluir todos os limites de gasto?",
    descricao: `${ids.length} limite(s) serão apagados. Não dá para desfazer.`,
    okLabel: "Excluir limites",
    tabelas: [{ tabela: "metas", ids: () => ids }],
    aposExcluir: () => { state.metas = []; },
    semItens: "Não tem nenhum limite de gasto pra apagar."
  });
});

document.getElementById("excluirTodosObjetivosBtn")?.addEventListener("click", async () => {
  const ids = state.objetivos.map(o => o.id);
  await excluirTodosDeCategoria({
    titulo: "Excluir todos os objetivos?",
    descricao: `${ids.length} objetivo(s) serão apagados. Não dá para desfazer.`,
    okLabel: "Excluir objetivos",
    tabelas: [{ tabela: "objetivos", ids: () => ids }],
    aposExcluir: () => { state.objetivos = []; renderObjetivos(); },
    semItens: "Não tem nenhum objetivo pra apagar."
  });
});

document.getElementById("excluirTodosInvestimentosBtn")?.addEventListener("click", async () => {
  const ids = state.investimentos.map(i => i.id);
  await excluirTodosDeCategoria({
    titulo: "Excluir todos os investimentos?",
    descricao: `${ids.length} investimento(s) serão removidos da sua carteira. Não dá para desfazer.`,
    okLabel: "Excluir investimentos",
    tabelas: [{ tabela: "investimentos", ids: () => ids }],
    aposExcluir: () => { state.investimentos = []; renderInvestimentos(); },
    semItens: "Não tem nenhum investimento pra apagar."
  });
});

document.getElementById("excluirTodasNotasFiscaisBtn")?.addEventListener("click", async () => {
  const ids = state.notasFiscais.map(n => n.id);
  await excluirTodosDeCategoria({
    titulo: "Excluir todas as notas fiscais?",
    descricao: `${ids.length} nota(s) fiscal(is) registradas serão apagadas. Não dá para desfazer.`,
    okLabel: "Excluir notas",
    tabelas: [{ tabela: "notas_fiscais", ids: () => ids }],
    aposExcluir: () => { state.notasFiscais = []; },
    semItens: "Não tem nenhuma nota fiscal pra apagar."
  });
});

document.getElementById("excluirTodosContatosBtn")?.addEventListener("click", async () => {
  const ids = state.contatos.map(c => c.id);
  await excluirTodosDeCategoria({
    titulo: "Excluir todos os cadastros?",
    descricao: `${ids.length} cliente(s)/fornecedor(es) serão apagados. As notas fiscais já registradas continuam do jeito que estão, só perdem o vínculo com o cadastro.`,
    okLabel: "Excluir cadastros",
    tabelas: [{ tabela: "contatos", ids: () => ids }],
    aposExcluir: () => {
      const idsSet = new Set(ids);
      state.notasFiscais.forEach(n => { if (idsSet.has(n.contatoId)) n.contatoId = null; });
      state.contatos = [];
    },
    semItens: "Não tem nenhum cadastro pra apagar."
  });
});

/* ─── Excluir com Undo ────────────────────────────────────── */
async function excluirMovimento(id) {
  const mov = state.movimentos.find(m => m.id === id);
  if (!mov) return;

  // Se faz parte de uma compra parcelada, oferece excluir todas as parcelas
  if (mov.compraId && mov.parcelaTotal > 1) {
    const irmas = state.movimentos.filter(m => m.compraId === mov.compraId);
    const ok = await confirmar("Excluir compra parcelada?", {
      tipo: "perigo",
      descricao: `Esta compra tem ${mov.parcelaTotal}x. Todas as ${irmas.length} parcelas serão excluídas.`,
      okLabel: "Excluir todas",
    });
    if (!ok) return;
    _salvarUndo();
    try {
      for (const parc of irmas) {
        await dbDelete("movimentos", parc.id);
      }
      const idsRemover = new Set(irmas.map(p => p.id));
      state.movimentos = state.movimentos.filter(m => !idsRemover.has(m.id));
      renderTudo();
      toast(`Compra parcelada excluída (${irmas.length} parcelas).`, "info", true);
    } catch(err) { tratarErro(err); }
    return;
  }

  const ok = await confirmar("Excluir lançamento?", { tipo: "perigo", descricao: "Ele será removido do seu extrato.", okLabel: "Excluir" }); if (!ok) return;
  const label = state.movimentos.find(m=>m.id===id)?.descricao || "Lançamento";
  _salvarUndo();
  try {
    await dbDelete("movimentos", id);
    state.movimentos = state.movimentos.filter(m=>m.id!==id);
    renderTudo(); toast(`"${label}" excluído.`, "info", true);
  } catch(err) { tratarErro(err); }
}

async function excluirConta(id) {
  const movsVinculados = state.movimentos.filter(m=>m.bancoId===id);
  const ok = await confirmar("Excluir esta conta?", { tipo: "perigo", descricao: movsVinculados.length ? `Ela tem ${movsVinculados.length} movimentação(ões) vinculada(s), que também serão removidas.` : "A conta e seus dados serão removidos.", okLabel: "Excluir" });
  if (!ok) return;
  const label = state.bancos.find(b=>b.id===id)?.nome || "Conta";
  _salvarUndo();
  try {
    // O aviso já dizia que os lançamentos vinculados também sumiam, mas o
    // código só apagava a conta — os lançamentos ficavam órfãos no banco
    // (sem cascata garantida). Agora apaga os dois de verdade, igual ao
    // que "Excluir todas as contas" (excluirTodasContasBtn) já faz.
    await Promise.all(movsVinculados.map(m => dbDelete("movimentos", m.id)));
    await dbDelete("contas", id);
    state.movimentos = state.movimentos.filter(m=>m.bancoId!==id);
    state.bancos = state.bancos.filter(b=>b.id!==id);
    renderTudo(); toast(`Conta "${label}" excluída.`, "info", true);
  } catch(err) { tratarErro(err); }
}

async function excluirTransferencia(id) {
  const ok = await confirmar("Excluir transferência?", { tipo: "perigo", descricao: "A transferência será removida.", okLabel: "Excluir" }); if (!ok) return;
  _salvarUndo();
  try {
    await dbDelete("transferencias", id);
    state.transferencias = state.transferencias.filter(t=>t.id!==id);
    renderTudo(); toast("Transferência excluída.", "info", true);
  } catch(err) { tratarErro(err); }
}

async function excluirRecorrencia(id) {
  const label = state.recorrencias.find(r=>r.id===id)?.descricao || "Recorrência";
  // Lançamentos que já foram marcados como pagos por essa recorrência
  // (ver pagarOcorrencia) continuam existindo mesmo depois de excluí-la —
  // de propósito, é histórico real. Mas a pessoa precisa saber que eles
  // continuam lá, senão "excluí o gasto fixo e o valor não sumiu" parece bug.
  const movsLigados = state.movimentos.filter(m => m.recorrenciaId === id);
  const descricao = movsLigados.length
    ? `Ele deixará de se repetir. Você já tem ${movsLigados.length} lançamento(s) registrado(s) por ele — na próxima tela você escolhe se quer excluir esses também ou manter no histórico.`
    : "Ele deixará de se repetir.";
  const ok = await confirmar("Excluir gasto fixo?", { tipo: "perigo", descricao, okLabel: "Excluir" }); if (!ok) return;
  _salvarUndo();
  try {
    await dbDelete("recorrencias", id);
    state.recorrencias = state.recorrencias.filter(r=>r.id!==id);

    if (movsLigados.length) {
      const tambemExcluir = await confirmar(
        `Excluir também os ${movsLigados.length} lançamento(s) já registrado(s)?`,
        { tipo: "perigo", descricao: "Eles somem do seu histórico e da Planilha. Se preferir manter o que já foi pago, clique em \"Manter no histórico\".", okLabel: "Excluir também", cancelLabel: "Manter no histórico" }
      );
      if (tambemExcluir) {
        await Promise.all(movsLigados.map(m => dbDelete("movimentos", m.id)));
        const idsRemover = new Set(movsLigados.map(m => m.id));
        state.movimentos = state.movimentos.filter(m => !idsRemover.has(m.id));
      }
    }

    renderTudo(); toast(`Recorrência "${label}" excluída.`, "info", true);
  } catch(err) { tratarErro(err); }
}

async function excluirMeta(id) {
  const ok = await confirmar("Excluir meta?", { tipo: "perigo", descricao: "A meta será removida.", okLabel: "Excluir" }); if (!ok) return;
  const label = state.metas.find(m=>m.id===id)?.categoria || "Meta";
  _salvarUndo();
  try {
    await dbDelete("metas", id);
    state.metas = state.metas.filter(m=>m.id!==id);
    renderTudo(); toast(`Meta "${label}" excluída.`, "info", true);
  } catch(err) { tratarErro(err); }
}

/* ─── Modais ──────────────────────────────────────────────── */
const _modais = {
  movimento:   document.getElementById("modalEditarMovimento"),
  conta:       document.getElementById("modalEditarConta"),
  recorrencia: document.getElementById("modalEditarRecorrencia"),
};

/* Aceita tanto a chave curta ("movimento") quanto o id completo ("modalEditarMovimento") */
function _elModal(k) { return _modais[k] || document.getElementById(k); }
// Trava o scroll do fundo enquanto o modal está aberto — mesma coisa que
// os outros overlays do app já fazem (telaAssinar, revisão de extrato,
// tela do cartão). Sem isso, no celular, o gesto de rolar às vezes é
// capturado pela PÁGINA por trás em vez do conteúdo do modal, e por fora
// parece que o modal "não rola" — mesmo ele tendo overflow-y:auto certo.
function abrirModal(k)  { _elModal(k)?.classList.add("open"); document.body.style.overflow = "hidden"; }
function fecharModal(k) { _elModal(k)?.classList.remove("open"); document.body.style.overflow = ""; }

Object.entries(_modais).forEach(([k,el]) => {
  el?.addEventListener("click", e => { if (e.target===el) fecharModal(k); });
});

/* Modais criados depois (avatar, documentos) também fecham ao clicar fora */
["modalAvatar", "modalDocumento", "modalEditarInvestimento", "modalEditarTransferencia"].forEach(id => {
  const el = document.getElementById(id);
  el?.addEventListener("click", e => { if (e.target === el) fecharModal(id); });
});

["fecharModalMovimento","cancelarEditarMovimento"].forEach(id => document.getElementById(id)?.addEventListener("click",()=>fecharModal("movimento")));
["fecharModalConta","cancelarEditarConta"].forEach(id => document.getElementById(id)?.addEventListener("click",()=>fecharModal("conta")));
["fecharModalRecorrencia","cancelarEditarRecorrencia"].forEach(id => document.getElementById(id)?.addEventListener("click",()=>fecharModal("recorrencia")));

/* Editar lançamento */
function abrirEditarMovimento(id) {
  const m = state.movimentos.find(m=>m.id===id); if (!m) return;
  document.getElementById("editMovId").value        = m.id;
  document.getElementById("editMovDescricao").value = m.descricao;
  document.getElementById("editMovValor").value     = m.valor;
  document.getElementById("editMovTipo").value      = m.tipo;
  document.getElementById("editMovCategoria").value = m.categoria;
  document.getElementById("editMovData").value      = m.data;
  document.getElementById("editMovConta").innerHTML = state.bancos.map(b=>`<option value="${b.id}"${b.id===m.bancoId?" selected":""}>${esc(b.nome)} · ${esc(b.tipo)}</option>`).join("");
  abrirModal("movimento");
}
document.getElementById("formEditarMovimento")?.addEventListener("submit", async e => {
  e.preventDefault();
  const id = document.getElementById("editMovId").value;
  const dados = {
    descricao: document.getElementById("editMovDescricao").value.trim(),
    valor:     Math.abs(Number(document.getElementById("editMovValor").value)),
    tipo:      document.getElementById("editMovTipo").value,
    categoria: document.getElementById("editMovCategoria").value,
    conta_id:  document.getElementById("editMovConta").value,
    data:      document.getElementById("editMovData").value,
  };
  try {
    const att = await dbUpdate("movimentos", id, dados);
    const idx = state.movimentos.findIndex(m=>m.id===id);
    if (idx>=0) state.movimentos[idx] = { id:att.id, descricao:att.descricao, bancoId:att.conta_id, data:att.data, valor:Number(att.valor), tipo:att.tipo, categoria:att.categoria, recorrenciaId:att.recorrencia_id };
    fecharModal("movimento"); renderTudo(); toast("Lançamento atualizado!","success");
  } catch(err) { tratarErro(err); }
});

/* Editar conta */
function abrirEditarConta(id) {
  const b = state.bancos.find(b=>b.id===id); if (!b) return;
  document.getElementById("editContaId").value    = b.id;
  document.getElementById("editContaNome").value  = b.nome;
  document.getElementById("editContaTipo").value  = b.tipo;
  document.getElementById("editContaSaldo").value = b.saldoInicial;
  const campoEditData = document.getElementById("editContaSaldoData");
  if (campoEditData) campoEditData.value = b.saldoData || hojeISO();
  // Cartão
  const chk = document.getElementById("editTemCartao");
  if (chk) chk.checked = !!b.temCartao;
  const lim = document.getElementById("editCartaoLimite");
  const fec = document.getElementById("editCartaoFechamento");
  const ven = document.getElementById("editCartaoVencimento");
  if (lim) lim.value = b.limite != null ? b.limite : "";
  if (fec) fec.value = b.diaFechamento || "";
  if (ven) ven.value = b.diaVencimento || "";
  toggleEditCartao();
  iniciarCorPickerEdit(b.cor || null);
  iniciarMarcaPickerEdit(b.logoId ?? null);
  abrirModal("conta");
}

// Mostra/esconde a caixa de cartão na edição
function toggleEditCartao() {
  const box = document.getElementById("editCartaoBox");
  if (box) box.style.display = document.getElementById("editTemCartao")?.checked ? "" : "none";
}

document.getElementById("formEditarConta")?.addEventListener("submit", async e => {
  e.preventDefault();
  const id = document.getElementById("editContaId").value;
  const temCartao = document.getElementById("editTemCartao")?.checked || false;
  const dados = {
    nome:         document.getElementById("editContaNome").value.trim(),
    tipo:         document.getElementById("editContaTipo").value,
    saldo_inicial: Number(document.getElementById("editContaSaldo").value),
    saldo_data: document.getElementById("editContaSaldoData")?.value || hojeISO(),
    cor:          _corEscolhidaEdit,
    logo_id:      _logoEscolhidaEdit,
    tem_cartao:   temCartao,
    limite:         temCartao ? (Number(document.getElementById("editCartaoLimite")?.value) || 0) : null,
    dia_fechamento: temCartao ? (Number(document.getElementById("editCartaoFechamento")?.value) || null) : null,
    dia_vencimento: temCartao ? (Number(document.getElementById("editCartaoVencimento")?.value) || null) : null,
  };
  try {
    const att = await dbUpdate("contas", id, dados);
    const idx = state.bancos.findIndex(b=>b.id===id);
    if (idx>=0) state.bancos[idx] = { id:att.id, nome:att.nome, tipo:att.tipo, saldoInicial:Number(att.saldo_inicial), saldoData: att.saldo_data || null, cor: att.cor || null, logoId: att.logo_id ?? null, temCartao: att.tem_cartao || false, limite: att.limite != null ? Number(att.limite) : null, diaFechamento: att.dia_fechamento || null, diaVencimento: att.dia_vencimento || null };

    // Se informou uma fatura em aberto, registra como compra no crédito
    // (vinculada ao cartão) — mesmo motivo do cadastro de conta: um
    // lançamento "pendente" solto fica invisível pro limite disponível
    // e pro card de "Cartões de crédito" do dashboard.
    let faturaMsg = "";
    if (temCartao) {
      const faturaAtual = Number(document.getElementById("editCartaoFaturaAtual")?.value) || 0;
      if (faturaAtual > 0) {
        const faturaMesAtual = mesAtualISO();
        // Esse campo é pra registrar o saldo inicial da fatura UMA VEZ (tipo
        // o "saldo inicial" da conta). Ele sempre volta vazio quando o
        // formulário reabre — se a pessoa editar a conta de novo e digitar
        // outro valor aqui achando que está "atualizando", isso criava uma
        // SEGUNDA "Fatura {nome}" no mesmo mês, duplicando a dívida. Só deixa
        // criar se ainda não existe nenhuma pra esse cartão neste mês.
        const jaTemFaturaInicial = state.movimentos.some(m =>
          m.cartaoId === att.id && m.faturaMes === faturaMesAtual && /^Fatura /.test(m.descricao || "")
        );
        if (jaTemFaturaInicial) {
          faturaMsg = ` Já existe uma fatura registrada pra ${att.nome} este mês — não criei outra pra não duplicar. Pra ajustar, exclua a antiga na tela do cartão (ícone 🗑 ao lado da compra).`;
        } else {
          const movFatura = await dbInsert("movimentos", {
            descricao: `Fatura ${att.nome}`,
            conta_id: att.id,
            data: hojeISO(),
            valor: faturaAtual,
            tipo: "gasto",
            categoria: "Cartão de crédito",
            status: "pago",
            pago_em: hojeISO(),
            forma_pagamento: "credito",
            cartao_id: att.id,
            fatura_mes: faturaMesAtual
          });
          state.movimentos.push({
            id: movFatura.id, descricao: movFatura.descricao, bancoId: movFatura.conta_id,
            data: movFatura.data, valor: Number(movFatura.valor), tipo: "gasto",
            categoria: movFatura.categoria, status: movFatura.status, vencimento: null,
            pagoEm: movFatura.pago_em, formaPagamento: "credito",
            cartaoId: movFatura.cartao_id, faturaMes: movFatura.fatura_mes
          });
          faturaMsg = ` Fatura de ${fmtMoeda(faturaAtual)} registrada no cartão.`;
        }
      }
    }

    fecharModal("conta"); renderTudo(); toast(`Conta atualizada!${faturaMsg}`,"success");
  } catch(err) { tratarErro(err); }
});

document.getElementById("formEditarRecorrencia")?.addEventListener("submit", async e => {
  e.preventDefault();
  const id = document.getElementById("editRecId").value;
  const dados = {
    descricao: document.getElementById("editRecDescricao").value.trim(),
    valor:     Math.abs(Number(document.getElementById("editRecValor").value)),
    tipo:      document.getElementById("editRecTipo").value,
    categoria: document.getElementById("editRecCategoria").value,
    conta_id:  document.getElementById("editRecConta").value,
    dia:       Number(document.getElementById("editRecDia").value),
  };
  try {
    const att = await dbUpdate("recorrencias", id, dados);
    const idx = state.recorrencias.findIndex(r=>r.id===id);
    if (idx>=0) state.recorrencias[idx] = { id:att.id, descricao:att.descricao, valor:Number(att.valor), tipo:att.tipo, categoria:att.categoria, contaId:att.conta_id, dia:att.dia };
    fecharModal("recorrencia"); renderTudo(); toast("Recorrência atualizada!","success");
  } catch(err) { tratarErro(err); }
});


/* ============================================================
   SPLASH SCREEN
   ============================================================ */
function mostrarSplash() {
  const el = document.getElementById("splashScreen");
  if (el) el.style.display = "flex";
}

function esconderSplash() {
  const el = document.getElementById("splashScreen");
  if (!el) return;
  el.classList.add("hiding");
  setTimeout(() => { el.style.display = "none"; el.classList.remove("hiding"); }, 420);
}

/* ============================================================
   ONBOARDING
   ============================================================ */
function mostrarOnboarding() {
  const el = document.getElementById("onboarding");
  if (el) el.style.display = "flex";
}

function obProximo(step) {
  document.querySelectorAll(".ob-step").forEach(s => s.classList.remove("active"));
  document.querySelectorAll(".ob-dot").forEach(d => d.classList.remove("active"));
  const stepEl = document.getElementById("obStep" + step);
  const dotEl  = document.getElementById("obDot"  + step);
  if (stepEl) stepEl.classList.add("active");
  if (dotEl)  dotEl.classList.add("active");
}

function obFinalizar() {
  const el = document.getElementById("onboarding");
  if (el) el.style.display = "none";
  localStorage.setItem("fp_onboarding_done", "1");
  trocarTela("contas");
  toast("Comece cadastrando sua primeira conta bancária! 🏦", "info");
}

/* ============================================================
   BOTTOM NAV MOBILE
   ============================================================ */
document.querySelectorAll(".bnav-item").forEach(btn => {
  btn.addEventListener("click", () => {
    const screen = btn.dataset.screen;
    trocarTela(screen);
    document.querySelectorAll(".bnav-item").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

function sincronizarBottomNav(screen) {
  document.querySelectorAll(".bnav-item").forEach(b => {
    b.classList.toggle("active", b.dataset.screen === screen);
  });
}


/* ============================================================
   GUIA CONTEXTUAL POR SEÇÃO
   ============================================================ */

const GUIAS = {
  comecar: {
    icon: "🚀",
    titulo: "Como usar o FAZ Finanças",
    subtitulo: "O caminho mais rápido pra deixar suas finanças no piloto automático",
    itens: [
      { icon: "🏦", titulo: "1. Crie sua primeira conta", desc: "Vá em <em>Contas</em> e cadastre seu banco (ou carteira) com o saldo atual de verdade. É o que faz o Dashboard começar certo desde o primeiro dia." },
      { icon: "📤", titulo: "2. Importe o extrato com a IA", desc: 'Em <em>Lançamentos</em>, use "Importar extrato" (CSV, foto ou PDF) — ou peça direto no chat: <em>"lança meu extrato desse mês"</em>. A IA lê tudo e cria os lançamentos sozinha.' },
      { icon: "🏷️", titulo: "3. Deixe a IA categorizar — e ajuste o que quiser", desc: 'Mercado vira Alimentação, Uber vira Transporte, e por aí vai. Se faltar uma categoria sua, crie uma nova em Lançamentos ou peça: <em>"cria a categoria Pet"</em>.' },
      { icon: "🔁", titulo: "4. Cadastre as contas fixas", desc: "Aluguel, plano de saúde, streaming, financiamento — cadastre uma vez em <em>Gastos Fixos</em> e o app lança sozinho todo mês, sem você precisar lembrar." },
      { icon: "🎯", titulo: "5. Defina metas nas categorias que mais pesam", desc: "Em <em>Metas</em>, coloque um limite mensal nas 2 ou 3 categorias onde você mais gasta. Uma barra avisa quando está perto de estourar." },
      { icon: "🗣️", titulo: "6. No dia a dia, fale com a IA em vez de preencher formulário", desc: 'Ex: <em>"gastei 35 no ifood"</em> ou <em>"recebi 200 de um freela"</em> — ela registra, categoriza e confirma em segundos. É o jeito mais rápido de manter tudo atualizado.' },
      { icon: "📊", titulo: "7. Acompanhe pelo Dashboard e pela Planilha", desc: "Com a base montada, é só abrir o Dashboard de vez em quando pra ver a evolução do saldo, ou a Planilha pra analisar por categoria e período." },
    ],
    dica: "💡 Dica: você não precisa fazer tudo isso no mesmo dia — mas quem começa pela conta certa e importa o extrato de cara economiza dezenas de lançamentos manuais depois."
  },
  dashboard: {
    icon: "📊",
    titulo: "Dashboard — Visão Geral",
    subtitulo: "Aqui você acompanha tudo de uma vez",
    itens: [
      { icon: "💰", titulo: "Saldo total", desc: "Soma de todas as suas contas. Atualiza automaticamente a cada lançamento." },
      { icon: "↑", titulo: "Entradas", desc: "Total de receitas registradas no período. Clique em <em>Lançamentos</em> para adicionar novas entradas." },
      { icon: "↓", titulo: "Gastos", desc: "Total de despesas do período. Se estiver alto, confira as <em>Metas</em> para controlar por categoria." },
      { icon: "🏦", titulo: "Saldo por conta", desc: "Cada banco ou carteira aparece como um card com o saldo atual e a porcentagem que representa do total." },
      { icon: "📈", titulo: "Evolução do saldo", desc: "Gráfico dos últimos 6 meses. Útil para ver se você está evoluindo ou regredindo ao longo do tempo." },
    ],
    dica: "💡 Dica: o dashboard reflete sempre os dados em tempo real. Quanto mais lançamentos você fizer, mais preciso ele fica."
  },
  contas: {
    icon: "🏦",
    titulo: "Contas — Suas carteiras",
    subtitulo: "Organize seu dinheiro em diferentes contas",
    itens: [
      { icon: "➕", titulo: "Criar conta", desc: "Adicione quantas contas quiser: Nubank, Itaú, Carteira física, Poupança, Investimentos, etc." },
      { icon: "💵", titulo: "Saldo inicial", desc: "Informe o saldo atual da conta ao criá-la. Isso garante que o dashboard comece com os valores corretos." },
      { icon: "🏷️", titulo: "Tipo de conta", desc: "Classifique como <em>Corrente, Poupança, Investimento</em> ou <em>Carteira</em> para melhor organização." },
      { icon: "✏️", titulo: "Editar ou excluir", desc: "Clique em qualquer conta para editar o nome, tipo ou saldo inicial. Excluir uma conta também apaga seus lançamentos." },
    ],
    dica: "💡 Dica: crie uma conta separada para sua reserva de emergência — assim você vê claramente quanto tem guardado."
  },
  lancamentos: {
    icon: "💸",
    titulo: "Lançamentos — Registro financeiro",
    subtitulo: "Registre entradas e gastos rapidamente",
    itens: [
      { icon: "🗣️", titulo: "Linguagem natural", desc: 'Digite algo como <em>"gastei 80 reais no mercado"</em> ou <em>"recebi 2000 de salário"</em> e o app detecta tudo automaticamente.' },
      { icon: "📂", titulo: "Categorias automáticas", desc: "O app identifica a categoria pelo texto: mercado → Alimentação, uber → Transporte, netflix → Lazer, etc." },
      { icon: "📤", titulo: "Importar extrato CSV", desc: "Baixe o extrato do seu banco em CSV e importe aqui. O app lê e cria os lançamentos automaticamente." },
      { icon: "🔍", titulo: "Busca e filtros", desc: "Use a busca para encontrar qualquer lançamento. Filtre por data, conta ou categoria no histórico." },
      { icon: "↩️", titulo: "Desfazer exclusão", desc: "Ao excluir um lançamento, aparece um toast por 5 segundos para desfazer caso tenha sido acidente." },
    ],
    dica: "💡 Dica: lance seus gastos todo dia antes de dormir. Com 1 minuto por dia você mantém tudo atualizado."
  },
  transferencias: {
    icon: "↔️",
    titulo: "Transferências — Entre contas",
    subtitulo: "Mova dinheiro sem afetar suas receitas ou gastos",
    itens: [
      { icon: "🔄", titulo: "O que é uma transferência", desc: "Quando você move dinheiro de uma conta para outra, não é receita nem gasto. Use esta tela para registrar corretamente." },
      { icon: "📋", titulo: "Como registrar", desc: "Selecione conta de origem, conta de destino, valor e data. Opcionalmente adicione uma descrição." },
      { icon: "📊", titulo: "Impacto no saldo", desc: "A conta de <em>origem perde</em> o valor e a conta de <em>destino ganha</em>. O saldo total consolidado não muda." },
      { icon: "📜", titulo: "Histórico", desc: "Todas as transferências ficam registradas com data e descrição para consulta futura." },
    ],
    dica: "💡 Dica: use transferências para alimentar seu fundo de emergência mensalmente. Ex: Corrente → Poupança."
  },
  recorrencias: {
    icon: "🔁",
    titulo: "Recorrências — Gastos automáticos",
    subtitulo: "Configure contas fixas que se repetem todo mês",
    itens: [
      { icon: "⚡", titulo: "O que são recorrências", desc: "Contas que se repetem todo mês: aluguel, academia, Netflix, plano de saúde. Cadastre uma vez, o app lança automaticamente." },
      { icon: "📅", titulo: "Dia do lançamento", desc: "Defina o dia do mês em que o lançamento deve ser gerado. O app cria o movimento automaticamente nessa data." },
      { icon: "✏️", titulo: "Editar recorrência", desc: "Precisa ajustar o valor do plano? Edite a recorrência e os próximos lançamentos já usarão o valor novo." },
      { icon: "🗑️", titulo: "Cancelar", desc: "Ao excluir uma recorrência, os lançamentos passados são mantidos. Só os futuros deixam de ser gerados." },
    ],
    dica: "💡 Dica: cadastre todas as suas contas fixas aqui. O dashboard mostrará uma previsão de quanto você já tem comprometido no mês."
  },
  metas: {
    icon: "🎯",
    titulo: "Metas — Controle de gastos",
    subtitulo: "Defina limites por categoria e evite excessos",
    itens: [
      { icon: "📏", titulo: "Como funciona", desc: "Defina um limite mensal por categoria. Ex: Lazer = R$ 300. O app mostra quanto você já usou com uma barra de progresso." },
      { icon: "🟡", titulo: "Alertas visuais", desc: "A barra fica <em>amarela</em> quando você passou de 75% e <em>vermelha</em> quando estourou o limite da categoria." },
      { icon: "➕", titulo: "Criar meta", desc: "Selecione a categoria e defina o valor máximo mensal. Você pode ter metas para Alimentação, Lazer, Transporte, etc." },
      { icon: "📊", titulo: "Acompanhamento", desc: "Os gastos reais são calculados automaticamente com base nos lançamentos do mês atual." },
    ],
    dica: "💡 Dica: comece definindo metas para as 3 categorias onde você mais gasta. Pequenas mudanças nessas áreas têm grande impacto."
  },
  planilha: {
    icon: "📋",
    titulo: "Planilha — Análise detalhada",
    subtitulo: "Explore seus dados com filtros e resumos",
    itens: [
      { icon: "🔍", titulo: "Filtros por período", desc: "Filtre por dia, mês ou ano específico. Útil para conferir como foi determinado mês ou comparar períodos." },
      { icon: "🗂️", titulo: "Resumo por categoria", desc: "Veja quanto você gastou em cada categoria no período filtrado. Identifique onde vai mais dinheiro." },
      { icon: "🏦", titulo: "Resumo por conta", desc: "Quanto entrou e saiu de cada banco no período. Útil para reconciliar com o extrato do banco." },
      { icon: "📤", titulo: "Exportar CSV", desc: "Baixe todos os lançamentos filtrados em CSV. Compatível com Excel, Google Sheets e qualquer planilha." },
    ],
    dica: "💡 Dica: no final de cada mês, exporte o CSV e guarde como backup. Também serve para declaração de imposto de renda."
  },
  graficos: {
    icon: "📈",
    titulo: "Gráficos — Visualização financeira",
    subtitulo: "Entenda seus padrões de gastos visualmente",
    itens: [
      { icon: "🍕", titulo: "Pizza de gastos por categoria", desc: "Mostra a proporção dos seus gastos entre as categorias. Revela onde vai a maior parte do seu dinheiro." },
      { icon: "🍩", titulo: "Donut entradas × gastos", desc: "Comparação rápida entre total de entradas e total de gastos. Ideal para ver se você está no azul ou no vermelho." },
      { icon: "📅", titulo: "Período dos gráficos", desc: "Os gráficos usam todos os lançamentos registrados. Quanto mais histórico você tiver, mais precisos ficam." },
    ],
    dica: "💡 Dica: se a pizza mostrar uma categoria muito dominante, vale criar uma <em>Meta</em> para controlar aquele gasto."
  },
  investimentos: {
    icon: "📈",
    titulo: "Investimentos — Faça seu dinheiro render",
    subtitulo: "Cadastre aplicações e simule rendimentos",
    itens: [
      { icon: "💼", titulo: "Cadastrar investimento", desc: "Registre CDB, Tesouro, ações, cripto, imóveis e mais. Informe o valor, a taxa e o regime de juros." },
      { icon: "📊", titulo: "Regime de juros", desc: "<em>Compostos</em> rendem sobre o rendimento (padrão do mercado). <em>Simples</em> rendem só sobre o valor inicial." },
      { icon: "🧮", titulo: "Simulador", desc: "Calcule quanto um valor renderá no tempo que você escolher — com aportes mensais opcionais." },
      { icon: "📈", titulo: "Projeção visual", desc: "O gráfico compara o crescimento com rendimento contra o valor só investido, mostrando o poder dos juros." },
    ],
    dica: "💡 Dica: pequenos aportes mensais + juros compostos fazem uma diferença enorme no longo prazo. Teste no simulador!"
  }
};


function mostrarGuia(screen) {
  const guia = GUIAS[screen];
  if (!guia) return;

  const conteudo = document.getElementById("guideContent");
  if (!conteudo) return;

  conteudo.innerHTML = `
    <div class="guide-header">
      <div class="guide-icon">${guia.icon}</div>
      <div>
        <div class="guide-titulo">${guia.titulo}</div>
        <div class="guide-subtitulo">${guia.subtitulo}</div>
      </div>
    </div>
    <div class="guide-itens">
      ${guia.itens.map(item => `
        <div class="guide-item">
          <div class="guide-item-icon">${item.icon}</div>
          <div class="guide-item-body">
            <div class="guide-item-titulo">${item.titulo}</div>
            <div class="guide-item-desc">${item.desc}</div>
          </div>
        </div>
      `).join("")}
    </div>
    ${guia.dica ? `<div class="guide-dica">${guia.dica}</div>` : ""}
  `;

  const overlay = document.getElementById("guideOverlay");
  overlay.style.display = "flex";
}

function fecharGuia() {
  const overlay = document.getElementById("guideOverlay");
  overlay.style.display = "none";
}

// Botão "?" nos page-headers — injetado dinamicamente.
// Sem entrada pro Dashboard de propósito: o botão ficava com posição
// absoluta no canto superior direito do dash-header e sobrepunha o sino
// de notificações. O guia geral de "como usar" agora mora no botão fixo
// da sidebar (ver #comoUsarBtn em index.html e GUIAS.comecar acima).
function injetarBotoesGuia() {
  const mapeamento = {
    "screen-contas":         "contas",
    "screen-lancamentos":    "lancamentos",
    "screen-transferencias": "transferencias",
    "screen-recorrencias":   "recorrencias",
    "screen-metas":          "metas",
    "screen-investimentos":  "investimentos",
    "screen-planilha":       "planilha",
    "screen-graficos":       "graficos"
  };

  Object.entries(mapeamento).forEach(([screenId, guiaKey]) => {
    const screen = document.getElementById(screenId);
    if (!screen) return;
    const header = screen.querySelector(".page-header");
    if (!header) return;
    if (header.querySelector(".btn-guia-secao")) return; // já tem

    const btn = document.createElement("button");
    btn.className = "btn-guia-secao";
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Como funciona`;
    btn.onclick = () => mostrarGuia(guiaKey);
    header.appendChild(btn);
  });
}

/* ============================================================
   OBJETIVOS DE ECONOMIA (metas de objetivo)
   ============================================================ */

const formObjetivo   = document.getElementById("formObjetivo");
const listaObjetivosEl = document.getElementById("listaObjetivos");
const objPrazoTipo   = document.getElementById("objPrazoTipo");
const fieldObjData   = document.getElementById("fieldObjData");
const fieldObjDias   = document.getElementById("fieldObjDias");

objPrazoTipo?.addEventListener("change", () => {
  const t = objPrazoTipo.value;
  fieldObjData?.classList.toggle("hidden-filter", t !== "data");
  fieldObjDias?.classList.toggle("hidden-filter", t !== "dias");
});


function renderObjetivos() {
  if (!listaObjetivosEl) return;
  if (!state.objetivos.length) {
    listaObjetivosEl.innerHTML = vazio(
      ICO.cofre,
      "Nenhum objetivo ainda",
      "Um carro, uma viagem, uma reserva. Defina o valor e o prazo acima."
    );
    return;
  }

  listaObjetivosEl.innerHTML = state.objetivos.map(o => {
    const pct = Math.min(100, Math.round((o.valorAtual / o.valorAlvo) * 100));
    const falta = Math.max(0, o.valorAlvo - o.valorAtual);
    const completo = o.valorAtual >= o.valorAlvo;

    const hoje = new Date(hojeISO()+"T00:00:00");
    const fim  = new Date(o.prazoData+"T00:00:00");
    const meses = Math.max(0, Math.round((fim - hoje) / (30.44 * 86400000)));
    const porMes = meses > 0 && falta > 0 ? falta / meses : falta;
    const dataFmt = fim.toLocaleDateString("pt-BR", { month: "short", year: "numeric" });

    return `<div class="obj-card ${completo ? "obj-completo" : ""}">
      <div class="obj-card-head">
        <span class="obj-card-icone">${iconeObjetivo(o.icone)}</span>
        <div class="obj-card-id">
          <div class="obj-card-nome">${esc(o.nome)}</div>
          <div class="obj-card-prazo">${completo ? "Concluído!" : `até ${dataFmt}`}</div>
        </div>
        <button class="btn-acao btn-acao-danger" onclick="excluirObjetivo('${o.id}')" title="Excluir">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>

      <div class="obj-barra">
        <div class="obj-barra-fill ${completo ? "completo" : ""}" style="width:${pct}%"></div>
      </div>

      <div class="obj-card-nums">
        <span class="obj-atual">${fmtMoeda(o.valorAtual)}</span>
        <span class="obj-pct">${pct}%</span>
        <span class="obj-alvo">${fmtMoeda(o.valorAlvo)}</span>
      </div>

      <div class="obj-card-foot">
        ${completo
          ? `<span class="obj-foot-ok">Meta alcançada</span>`
          : `<span>Falta ${fmtMoeda(falta)}</span>
             <span class="obj-foot-sep">·</span>
             <span>${fmtMoeda(porMes)}/mês</span>`
        }
        <button class="btn-mini" onclick="adicionarAoObjetivo('${o.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Guardar
        </button>
      </div>
    </div>`;
  }).join("");
}

formObjetivo?.addEventListener("submit", async e => {
  e.preventDefault();
  const nome = document.getElementById("objNome").value.trim();
  const icone = document.getElementById("objIcone").value;
  const valorAlvo = Number(document.getElementById("objAlvo").value);
  const valorAtual = Number(document.getElementById("objAtual").value) || 0;
  const prazoTipo = objPrazoTipo.value;
  const prazoData = document.getElementById("objData").value || null;
  const prazoDias = Number(document.getElementById("objDias").value) || null;

  if (!nome || !valorAlvo) { toast("Preencha o objetivo e o valor alvo.", "error"); return; }
  if (prazoTipo === "data" && !prazoData) { toast("Informe a data alvo.", "error"); return; }
  if (prazoTipo === "dias" && !prazoDias) { toast("Informe o número de dias.", "error"); return; }

  try {
    const novo = await dbInsert("objetivos", {
      nome, icone, valor_alvo: valorAlvo, valor_atual: valorAtual,
      prazo_tipo: prazoTipo, prazo_data: prazoData, prazo_dias: prazoDias
    });
    state.objetivos.push(mapObjetivo(novo));
    formObjetivo.reset();
    fieldObjData?.classList.remove("hidden-filter");
    fieldObjDias?.classList.add("hidden-filter");
    renderObjetivos();
    toast(`Objetivo "${nome}" criado!`, "success");
  } catch(err) { tratarErro(err); }
});

/* O botão "Guardar" no card chama este nome */
async function adicionarAoObjetivo(id) {
  return adicionarValorObjetivo(id);
}

async function adicionarValorObjetivo(id) {
  const o = state.objetivos.find(o => o.id === id); if (!o) return;
  const valor = await promptValor(`Quanto você quer guardar em "${esc(o.nome)}"?`);
  if (valor === null || isNaN(valor) || valor <= 0) return;
  try {
    const novoAtual = o.valorAtual + valor;
    const att = await dbUpdate("objetivos", id, { valor_atual: novoAtual });
    o.valorAtual = Number(att.valor_atual);
    renderObjetivos();
    toast(`${fmtMoeda(valor)} guardado em "${esc(o.nome)}"!`, "success");
  } catch(err) { tratarErro(err); }
}

async function excluirObjetivo(id) {
  const ok = await confirmar("Excluir objetivo?", { tipo: "perigo", descricao: "O objetivo será removido.", okLabel: "Excluir" }); if (!ok) return;
  const label = state.objetivos.find(o => o.id === id)?.nome || "Objetivo";
  try {
    await dbDelete("objetivos", id);
    state.objetivos = state.objetivos.filter(o => o.id !== id);
    renderObjetivos();
    toast(`Objetivo "${label}" excluído.`, "info");
  } catch(err) { tratarErro(err); }
}


function mapObjetivo(o) {
  return {
    id: o.id, nome: o.nome, icone: o.icone,
    valorAlvo: Number(o.valor_alvo), valorAtual: Number(o.valor_atual),
    prazoTipo: o.prazo_tipo, prazoData: o.prazo_data, prazoDias: o.prazo_dias,
    createdAt: o.created_at
  };
}

/* Prompt simples de valor (reusa o estilo de confirm) */
function promptValor(msg, valorInicial) {
  return new Promise(resolve => {
    const ov = document.createElement("div");
    ov.className = "confirm-ov";
    ov.innerHTML = `
      <div class="confirm-box">
        <p class="confirm-msg">${msg}</p>
        <input type="number" step="0.01" min="0" class="prompt-input" placeholder="0,00"
          value="${valorInicial != null ? valorInicial : ""}"
          style="width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:11px 13px;font-size:14px;color:var(--text-primary);outline:none;margin-bottom:22px;" />
        <div class="confirm-btns">
          <button class="btn-ghost prompt-cancel">Cancelar</button>
          <button class="btn-primary prompt-ok" style="width:auto;">Confirmar</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add("open"));
    const input = ov.querySelector(".prompt-input");
    input.focus();
    input.select();
    const done = (val) => { ov.remove(); resolve(val); };
    ov.querySelector(".prompt-ok").onclick = () => done(Number(input.value));
    ov.querySelector(".prompt-cancel").onclick = () => done(null);
    input.addEventListener("keydown", e => { if (e.key === "Enter") done(Number(input.value)); });
    ov.addEventListener("click", e => { if (e.target === ov) done(null); });
  });
}


/* ============================================================
   INVESTIMENTOS
   ============================================================ */

const formInvestimento  = document.getElementById("formInvestimento");
const listaInvestimentosEl = document.getElementById("listaInvestimentos");
const invTotalInvestidoEl  = document.getElementById("invTotalInvestido");
const invTotalRendimentoEl = document.getElementById("invTotalRendimento"); // legado: substituído pelos 3 cards + ganho estimado

/* ============================================================
   CLASSIFICAÇÃO DOS TIPOS DE INVESTIMENTO
   Define o que faz sentido perguntar/projetar para cada um.
   ============================================================ */

const CATEGORIAS_INV = {
  // ── Renda fixa indexada ao CDI: usuário informa % do CDI (ex: 105) ──
  "CDB":               { cat: "rf", modo: "cdi",   icone: "🏦", aviso: null },
  "LCI/LCA":           { cat: "rf", modo: "cdi",   icone: "🌾", isento: true,
    aviso: "LCI e LCA são <strong>isentas de Imposto de Renda</strong>. Costumam render um percentual do CDI. Informe o percentual contratado (ex: 95% do CDI)." },
  "Fundo DI":          { cat: "rf", modo: "cdi",   icone: "📊", aviso: null },

  // ── Renda fixa pós-fixada = 100% do CDI garantido ──
  "Tesouro Selic":     { cat: "rf", modo: "cdi",   icone: "🏛️",
    aviso: "O Tesouro Selic acompanha a taxa Selic, praticamente <strong>100% do CDI</strong>. Você pode ajustar o percentual se quiser." },

  // ── Renda fixa prefixada: taxa fixa contratada direta ──
  "Tesouro Prefixado": { cat: "rf", modo: "taxa",  icone: "🏛️",
    aviso: "Título <strong>prefixado</strong>: a taxa é travada na contratação e não muda. Informe a taxa anual contratada." },
  "CDB Prefixado":     { cat: "rf", modo: "taxa",  icone: "🏦",
    aviso: "CDB <strong>prefixado</strong>: taxa travada na contratação. Informe a taxa anual." },
  "Poupança":          { cat: "rf", modo: "poupanca", icone: "🐷",
    aviso: "A poupança rende <strong>0,5% ao mês + TR</strong> quando a Selic está acima de 8,5% a.a. O app já usa essa regra." },

  // ── Renda fixa indexada à inflação: taxa fixa + IPCA ──
  "Tesouro IPCA": {
    cat: "rf", modo: "ipca", icone: "🏛️",
    aviso: "Este título paga uma taxa fixa <strong>+ a inflação (IPCA)</strong>. Informe só a taxa fixa contratada — o app soma a inflação estimada. A projeção é uma <strong>estimativa</strong>." },

  // ── Renda variável: sem taxa, valor oscila ──
  "Ações": {
    cat: "rv", modo: "variavel", icone: "📈", dividendos: true,
    aviso: "Ações <strong>não têm rendimento garantido</strong> — o preço sobe e desce com o mercado. Registre quanto vale hoje. Se a empresa paga dividendos, informe o yield anual." },
  "FII": {
    cat: "rv", modo: "variavel", icone: "🏢", dividendos: true,
    aviso: "FIIs <strong>oscilam de preço</strong>, mas pagam rendimentos mensais. Registre quanto vale hoje e o dividend yield anual." },
  "ETF": {
    cat: "rv", modo: "variavel", icone: "📊", dividendos: false,
    aviso: "ETFs seguem um índice — o valor <strong>oscila com o mercado</strong>, sem rendimento garantido. Registre quanto vale hoje." },
  "BDR": {
    cat: "rv", modo: "variavel", icone: "🌎", dividendos: false,
    aviso: "BDRs acompanham ações estrangeiras. O valor <strong>oscila</strong> e ainda sofre efeito do câmbio. Não há rendimento previsível." },
  "Cripto": {
    cat: "rv", modo: "cripto", icone: "₿", dividendos: false,
    aviso: "Criptomoedas são <strong>altamente voláteis</strong>. Não existe taxa de rendimento — o preço pode subir ou cair muito. O valor é atualizado pelo preço de mercado ao vivo." },
  "Fundo Multi": {
    cat: "rv", modo: "variavel", icone: "📊", dividendos: false,
    aviso: "Fundos multimercado <strong>não têm rentabilidade garantida</strong>. Registre o valor atual da cota para acompanhar o desempenho." },

  // ── Bens físicos ──
  "Imóvel": {
    cat: "rv", modo: "variavel", icone: "🏠", dividendos: true, labelDiv: "Aluguel (% a.a.)",
    aviso: "A valorização de um imóvel é <strong>imprevisível</strong>. Registre o valor de mercado atual. Se aluga, informe o retorno anual do aluguel." },
  "Ouro": {
    cat: "rv", modo: "variavel", icone: "🥇", dividendos: false,
    aviso: "O preço do ouro <strong>oscila com o mercado</strong> — não há rendimento contratado. Registre quanto vale hoje." },
  "Outro": { cat: "escolher", modo: "taxa", icone: "💼", aviso: null }
};

/* Retorna a config de um tipo (com fallback para tipos customizados) */
function configTipo(tipo) {
  return CATEGORIAS_INV[tipo] || { cat: "rv", modo: "taxa", icone: "💼", dividendos: false, aviso: null };
}
function ehRendaFixa(tipo) { return configTipo(tipo).cat === "rf"; }

/* Converte qualquer taxa para taxa mensal equivalente (em %) */
function taxaMensalEquivalente(taxa, periodo, regime) {
  const r = taxa / 100;
  if (regime === "simples") {
    if (periodo === "ano") return (r / 12) * 100;
    if (periodo === "dia") return (r * 30) * 100;
    return r * 100; // mês
  } else {
    // composto: converte por potência
    if (periodo === "ano") return (Math.pow(1 + r, 1/12) - 1) * 100;
    if (periodo === "dia") return (Math.pow(1 + r, 30) - 1) * 100;
    return r * 100; // mês
  }
}

/* Projeção de rendimento em N meses */
function projetarInvestimento(valor, taxa, periodo, regime, meses, aporteMensal = 0) {
  const rMes = taxaMensalEquivalente(taxa, periodo, regime) / 100;
  const serie = [];
  if (regime === "simples") {
    let base = valor;
    const jurosMes = valor * rMes;
    let acumulado = valor;
    for (let m = 1; m <= meses; m++) {
      base += aporteMensal;
      acumulado = base + jurosMes * m + _jurosSimplesAportes(aporteMensal, rMes, m);
      serie.push(acumulado);
    }
    const investido = valor + aporteMensal * meses;
    const final = serie.length ? serie[serie.length - 1] : valor;
    return { final, investido, juros: final - investido, serie };
  } else {
    let saldo = valor;
    for (let m = 1; m <= meses; m++) {
      saldo = saldo * (1 + rMes) + aporteMensal;
      serie.push(saldo);
    }
    const investido = valor + aporteMensal * meses;
    const final = serie.length ? serie[serie.length - 1] : valor;
    return { final, investido, juros: final - investido, serie };
  }
}

function _jurosSimplesAportes(aporte, rMes, meses) {
  // soma dos juros simples de cada aporte feito ao longo dos meses
  let total = 0;
  for (let k = 1; k < meses; k++) total += aporte * rMes * k;
  return total;
}

function unidadeParaMeses(valor, unidade) {
  if (unidade === "ano") return valor * 12;
  if (unidade === "dia") return valor / 30;
  return valor;
}

/* Valor que o investimento vale hoje (usa valorAtual se informado) */
function valorHoje(i) {
  return i.valorAtual != null ? i.valorAtual : i.valor;
}

/* Alíquota de IR do CDB/renda fixa pela tabela regressiva.
   Quanto mais tempo aplicado, menor o imposto sobre o rendimento. */
function aliquotaIR(dataInicioISO) {
  if (!dataInicioISO) return 0.225; // sem data, assume a maior (mais conservador)
  const inicio = new Date(dataInicioISO + "T00:00:00");
  const hoje = new Date(hojeISO() + "T00:00:00");
  const diasCorridos = Math.max(0, Math.floor((hoje - inicio) / 86400000));
  if (diasCorridos <= 180) return 0.225;  // 22,5%
  if (diasCorridos <= 360) return 0.20;   // 20%
  if (diasCorridos <= 720) return 0.175;  // 17,5%
  return 0.15;                            // 15%
}

/* Tipos de investimento isentos de IR (não descontam imposto) */
const ISENTOS_IR = ["LCI", "LCA", "Poupança", "Poupanca"];
function ehIsentoIR(inv) {
  return ISENTOS_IR.some(t => (inv.tipo || "").toLowerCase().includes(t.toLowerCase()));
}

/* Conta dias úteis (seg a sex) entre duas datas ISO, sem contar feriados.
   Aproximação: ignora feriados nacionais, mas usa a base de 252 dias/ano do mercado. */
function contarDiasUteis(inicioISO, fimISO) {
  const inicio = new Date(inicioISO + "T00:00:00");
  const fim = new Date(fimISO + "T00:00:00");
  if (fim <= inicio) return 0;
  let dias = 0;
  const d = new Date(inicio);
  while (d < fim) {
    d.setDate(d.getDate() + 1);
    const diaSemana = d.getDay(); // 0 = domingo, 6 = sábado
    if (diaSemana !== 0 && diaSemana !== 6) dias++;
  }
  return dias;
}

/* Valor atual de um investimento de renda fixa, crescido por dias úteis
   desde a data de aplicação. Usa juros compostos (padrão do mercado).
   Já desconta o IR sobre o rendimento (valor líquido), exceto isentos. */
function valorRendaFixaHoje(inv) {
  const taxaAno = taxaAnualEfetiva(inv);
  if (!taxaAno || !inv.dataInicio) return inv.valor;
  const diasUteis = contarDiasUteis(inv.dataInicio, hojeISO());
  if (diasUteis <= 0) return inv.valor;
  // Taxa diária equivalente (base 252 dias úteis/ano), juros compostos
  const taxaDiaria = Math.pow(1 + taxaAno / 100, 1 / 252) - 1;
  const valorBruto = inv.valor * Math.pow(1 + taxaDiaria, diasUteis);
  const rendimentoBruto = valorBruto - inv.valor;
  // Desconta IR sobre o rendimento (exceto isentos)
  const ir = ehIsentoIR(inv) ? 0 : aliquotaIR(inv.dataInicio);
  return inv.valor + rendimentoBruto * (1 - ir);
}

/* Quanto o investimento rende por dia útil, líquido de IR (valor de hoje) */
function rendimentoDiarioRF(inv) {
  const taxaAno = taxaAnualEfetiva(inv);
  if (!taxaAno) return 0;
  const valorHoje = valorRendaFixaHoje(inv);
  const taxaDiaria = Math.pow(1 + taxaAno / 100, 1 / 252) - 1;
  const brutoDia = valorHoje * taxaDiaria;
  const ir = ehIsentoIR(inv) ? 0 : aliquotaIR(inv.dataInicio);
  return brutoDia * (1 - ir);
}

/* Valor de HOJE de qualquer investimento:
   - cripto: quantidade × preço de mercado atual (ao vivo)
   - renda fixa: o aporte crescido pelo rendimento acumulado até hoje,
     contado por dias úteis e já líquido de IR (é o CDB rendendo de verdade)
   - renda variável (ações, FII, imóvel...): o valor atual informado, ou o aporte */
function valorAtualInvestimento(inv) {
  if (inv.criptoId) return valorAtualCripto(inv);
  // Tem taxa de rendimento? Cresce sozinho por dias úteis desde a aplicação.
  if (taxaAnualEfetiva(inv) > 0) return valorRendaFixaHoje(inv);
  // Sem taxa (renda variável): usa o valor atual informado, senão o aporte
  return inv.valorAtual != null ? inv.valorAtual : inv.valor;
}

/* Ganho estimado ANUAL em reais, considerando só o que é previsível:
   juros da renda fixa + renda passiva (dividendos/aluguel) da renda variável.
   Cripto NÃO entra: seu ganho é a variação de mercado, não uma taxa. */
function ganhoEstimadoAnual() {
  return state.investimentos.reduce((s, i) => {
    if (i.criptoId) return s; // cripto não tem ganho por taxa
    const base = valorAtualInvestimento(i);
    let ganho = 0;
    const taxaAno = taxaAnualEfetiva(i);
    if (taxaAno > 0) {
      // Rendimento de renda fixa, líquido de IR
      const ir = ehIsentoIR(i) ? 0 : aliquotaIR(i.dataInicio);
      ganho += base * (taxaAno / 100) * (1 - ir);
    }
    if (i.rendaPassiva > 0) {
      // Dividendos/aluguel são sobre o valor de hoje
      ganho += base * (i.rendaPassiva / 100);
    }
    return s + ganho;
  }, 0);
}

/* Período escolhido para o ganho estimado (dia/mes/ano) */
let _periodoGanho = "mes";

/* Atualiza o card "Ganho estimado" conforme o período selecionado */
function atualizarGanhoEstimado() {
  const elValor = document.getElementById("invGanhoValor");
  const elDesc = document.getElementById("invGanhoDesc");
  const elBox = document.getElementById("invGanhoBox");
  if (!elValor) return;

  const anual = ganhoEstimadoAnual();

  // Esconde o box inteiro se não há nada previsível (só cripto, por ex.)
  const temPrevisivel = state.investimentos.some(i => !i.criptoId && (taxaAnualEfetiva(i) > 0 || i.rendaPassiva > 0));
  if (elBox) elBox.style.display = temPrevisivel ? "" : "none";
  if (!temPrevisivel) return;

  let valor, sufixo;
  if (_periodoGanho === "dia") { valor = anual / 365; sufixo = "por dia"; }
  else if (_periodoGanho === "ano") { valor = anual; sufixo = "por ano"; }
  else { valor = anual / 12; sufixo = "por mês"; }

  elValor.textContent = "+" + fmtMoeda(valor);
  if (elDesc) {
    elDesc.textContent = `Estimativa ${sufixo}, com base nas taxas e dividendos informados (já com desconto de IR na renda fixa). Cripto não entra — o ganho dela é a variação de mercado.`;
  }
}

/* Cor de fallback para o ícone do investimento quando não há instituição:
   uma cor por categoria (renda fixa, variável, cripto). */
function corPorCategoriaInv(inv) {
  if (inv.criptoId) return "#F7931A";          // laranja cripto
  const cfg = configTipo(inv.tipo);
  const cat = cfg.cat || "rv";
  if (cat === "rf") return "#3B82F6";          // azul renda fixa
  return "#8B7FE8";                             // roxo renda variável
}

function renderInvestimentos() {
  if (!listaInvestimentosEl) return;

  // ── Os três totais do topo ──
  // Total investido = soma dos APORTES (o que a pessoa colocou), sempre o
  //   valor original, nunca o de mercado.
  // Valor atual = quanto vale HOJE: cripto pelo preço de mercado, renda fixa
  //   crescida por dias úteis, renda variável pelo valor atual informado.
  // Lucro/prejuízo = valor atual − investido (inclui a valorização da cripto).
  const totalInvestido = state.investimentos.reduce((s, i) => s + (Number(i.valor) || 0), 0);
  const totalAtual = state.investimentos.reduce((s, i) => s + valorAtualInvestimento(i), 0);
  const lucro = totalAtual - totalInvestido;

  if (invTotalInvestidoEl) invTotalInvestidoEl.textContent = fmtMoeda(totalInvestido);
  const elAtual = document.getElementById("invTotalAtual");
  if (elAtual) elAtual.textContent = fmtMoeda(totalAtual);

  const elLucro = document.getElementById("invTotalLucro");
  const elLucroPct = document.getElementById("invTotalLucroPct");
  const elLucroIcone = document.getElementById("invLucroIcone");
  if (elLucro) {
    const semVariacao = Math.abs(lucro) < 0.005;
    const positivo = lucro >= 0;
    if (semVariacao) {
      elLucro.textContent = fmtMoeda(0);
      elLucro.classList.remove("valor-positivo", "valor-negativo");
    } else {
      elLucro.textContent = (positivo ? "+" : "−") + fmtMoeda(Math.abs(lucro));
      elLucro.classList.toggle("valor-positivo", positivo);
      elLucro.classList.toggle("valor-negativo", !positivo);
    }
    if (elLucroPct) {
      const pct = totalInvestido > 0 ? (lucro / totalInvestido) * 100 : 0;
      elLucroPct.textContent = semVariacao
        ? "Ainda sem rendimento acumulado"
        : (totalInvestido > 0
            ? `${positivo ? "+" : "−"}${fmtNum(Math.abs(pct))}% sobre os aportes`
            : "Valor atual menos os aportes");
    }
    if (elLucroIcone) elLucroIcone.classList.toggle("inv-resumo-icone-vermelho", !semVariacao && !positivo);
  }

  // Ganho estimado por período (só renda fixa e dividendos; cripto não tem taxa)
  atualizarGanhoEstimado();

  if (!state.investimentos.length) {
    listaInvestimentosEl.innerHTML = vazio(
      ICO.grafico,
      "Nenhum investimento ainda",
      "CDB, Tesouro, ações, cripto — registre onde seu dinheiro está aplicado."
    );
    renderResumoInstituicoes();
    return;
  }

  listaInvestimentosEl.innerHTML = state.investimentos.map(inv => {
    const ehCripto = !!inv.criptoId;
    const c = ehCripto ? criptoPorId(inv.criptoId) : null;
    const preco = ehCripto ? _precosCripto[inv.criptoId] : null;

    const valorHoje = valorAtualInvestimento(inv);
    const variou = Math.abs(valorHoje - inv.valor) > 0.005;
    const lucro = valorHoje - inv.valor;

    const taxaAno = taxaAnualEfetiva(inv);
    const b = inv.contaId ? state.bancos.find(x => x.id === inv.contaId) : null;
    const nome = inv.nome || inv.tipo;

    // Cor do ícone: a do banco/instituição escolhida; se não houver, uma cor
    // por categoria (renda fixa, variável, cripto), para dar identidade visual.
    const corBanco = b ? corDaConta(b) : corPorCategoriaInv(inv);

    const icone = ehCripto
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.5 8.5h4a2 2 0 0 1 0 4h-4m0 0h4.3a2 2 0 0 1 0 4H9.5m0-8v10m1.5-11v1.5m0 8v1.5"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l3-3 3 3 5-6"/></svg>`;

    // Linha de meta (subtítulo)
    let meta = `<span class="inv-badge">${esc(inv.tipo)}</span>`;
    if (ehCripto && c) {
      meta += `<span class="inv-meta-sep">·</span><span>${fmtNum(inv.criptoQtd)} ${c.sigla}</span>`;
      if (preco) meta += badgeVariacao(preco.variacao24h);
    } else if (inv.taxa > 0) {
      meta += `<span class="inv-meta-sep">·</span><span>${fmtNum(inv.taxa)}% ${inv.taxaPeriodo === "mes" ? "a.m." : "a.a."}</span>`;
    }
    if (b) meta += `<span class="inv-meta-sep">·</span><span>${esc(b.nome)}</span>`;

    // Segunda linha do valor
    let subvalor = "";
    if (ehCripto && variou) {
      const cls = lucro >= 0 ? "inv-lucro" : "inv-prejuizo";
      subvalor = `<div class="inv-item-rend ${cls}">${lucro >= 0 ? "+" : "−"}${fmtMoeda(Math.abs(lucro))}</div>`;
    } else if (!ehCripto && taxaAno > 0) {
      const porDia = rendimentoDiarioRF(inv);
      if (porDia > 0) subvalor = `<div class="inv-item-rend inv-lucro">+${fmtMoeda(porDia)}/dia</div>`;
    } else if (!ehCripto && inv.rendaPassiva > 0) {
      const ganhoAno = valorHoje * (inv.rendaPassiva / 100);
      if (ganhoAno > 0) subvalor = `<div class="inv-item-rend inv-lucro">~${fmtMoeda(ganhoAno / 12)}/mês</div>`;
    }

    // Barra de rendimento: mostra visualmente o quanto rendeu/variou.
    //  - cripto/RV: lucro (verde) ou prejuízo (vermelho) proporcional ao aporte
    //  - renda fixa: quanto o rendimento anual estimado representa (verde)
    let pctBarra = 0, corBarra = "var(--green)";
    if (variou) {
      pctBarra = Math.min(100, Math.abs(lucro) / (inv.valor || 1) * 100);
      corBarra = lucro >= 0 ? "var(--green)" : "var(--red, #e24b4a)";
    } else if (taxaAno > 0) {
      // rendimento anual como fração (visual): mostra a "força" do rendimento
      pctBarra = Math.min(100, taxaAno); // ex: 11% a.a. → barra em 11%
      corBarra = "var(--green)";
    } else if (inv.rendaPassiva > 0) {
      pctBarra = Math.min(100, inv.rendaPassiva * 5); // dividendos, escala visual
      corBarra = "var(--accent)";
    }
    const barra = pctBarra > 0
      ? `<div class="inv-item-barra"><span style="width:${pctBarra.toFixed(1)}%;background:${corBarra}"></span></div>`
      : "";

    return `<div class="inv-item ${ehCripto ? "inv-cripto" : ""}">
      <div class="inv-item-icone" style="background:${corBanco}1f;border-color:${corBanco}55;color:${corBanco}">${icone}</div>

      <div class="inv-item-info">
        <div class="inv-item-nome">${esc(nome)}</div>
        <div class="inv-item-meta">${meta}</div>
        ${barra}
      </div>

      <div class="inv-item-valores">
        <div class="inv-item-valor">${fmtMoeda(valorHoje)}</div>
        ${subvalor}
      </div>

      <div class="inv-item-acoes">
        <button class="btn-acao" onclick="abrirEditarInvestimento('${inv.id}')" title="Editar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
        </button>
        <button class="btn-acao btn-acao-danger" onclick="excluirInvestimento('${inv.id}')" title="Excluir">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>
    </div>`;
  }).join("");

  renderResumoInstituicoes();
  atualizarBotaoCripto();
}


/* Resumo: total investido por instituição */
function renderResumoInstituicoes() {
  const el = document.getElementById("resumoInstituicoes");
  if (!el) return;

  if (!state.investimentos.length) {
    el.innerHTML = `<div class="empty-state">Nenhum investimento cadastrado ainda.</div>`;
    return;
  }

  // Agrupa por conta
  const grupos = {};
  state.investimentos.forEach(i => {
    const chave = i.contaId || "__sem__";
    if (!grupos[chave]) grupos[chave] = { total: 0, rendimento: 0, qtd: 0 };
    grupos[chave].total += valorAtualInvestimento(i);
    grupos[chave].qtd += 1;
    // Rendimento anual estimado: renda fixa pela taxa, renda variável por dividendos
    if (!i.criptoId) {
      const taxaAno = taxaAnualEfetiva(i);
      if (taxaAno > 0) {
        const ir = ehIsentoIR(i) ? 0 : aliquotaIR(i.dataInicio);
        grupos[chave].rendimento += valorAtualInvestimento(i) * (taxaAno / 100) * (1 - ir);
      } else if (i.rendaPassiva > 0) {
        grupos[chave].rendimento += valorAtualInvestimento(i) * (i.rendaPassiva / 100);
      }
    }
  });

  const totalGeral = Object.values(grupos).reduce((a, g) => a + g.total, 0);
  const ordenado = Object.entries(grupos).sort((a, b) => b[1].total - a[1].total);

  el.innerHTML = ordenado.map(([chave, g]) => {
    const semConta = chave === "__sem__";
    const b = semConta ? null : state.bancos.find(x => x.id === chave);
    const nome = semConta ? "Sem instituição" : (b ? b.nome : "Conta removida");
    const pct = totalGeral > 0 ? (g.total / totalGeral) * 100 : 0;

    const marca = b
      ? marcaConta(b)
      : `<span class="inst-marca-neutra"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3 21h18M4 21V10l8-6 8 6v11M9 21v-6h6v6"/></svg></span>`;

    return `<div class="inst-item">
      <div class="inst-main">
        ${marca}
        <div class="inst-info">
          <div class="inst-nome">${esc(nome)}</div>
          <div class="inst-sub">${g.qtd} ${g.qtd === 1 ? "investimento" : "investimentos"} · ${pct.toFixed(0)}% da carteira</div>
        </div>
        <div class="inst-valores">
          <div class="inst-valor">${fmtMoeda(g.total)}</div>
          ${g.rendimento > 0 ? `<div class="inst-rend">+${fmtMoeda(g.rendimento)}/ano</div>` : ""}
        </div>
      </div>
      <div class="inst-barra">
        <div class="inst-barra-fill" style="width:${pct}%"></div>
      </div>
    </div>`;
  }).join("");
}

/* Mostra o campo de texto livre quando o tipo é "Outro" */
const invTipoSelect = document.getElementById("invTipo");
const fieldInvTipoOutro = document.getElementById("fieldInvTipoOutro");
const invTipoOutroInput = document.getElementById("invTipoOutro");
const avisoTipoEl = document.getElementById("avisoTipo");

/* Ajusta o formulário conforme a natureza do investimento escolhido */
function ajustarFormPorTipo() {
  if (!invTipoSelect) return;
  const tipo = invTipoSelect.value;
  const ehOutro = tipo === "Outro";
  const cfg = configTipo(tipo);

  // Campo de texto livre para "Outro"
  fieldInvTipoOutro?.classList.toggle("hidden-filter", !ehOutro);
  formInvestimento?.classList.toggle("com-outro", ehOutro);
  if (!ehOutro && invTipoOutroInput) invTipoOutroInput.value = "";

  // Sem tipo escolhido: mostra o padrão (renda fixa) e nenhum aviso
  if (!tipo) {
    alternarCampos("rf", false);
    mostrarAviso(null);
    return;
  }

  // "Outro" é tratado como renda variável por segurança (não presume taxa garantida),
  // mas deixa os campos de renda fixa disponíveis também.
  if (ehOutro) {
    alternarCampos("ambos", false);
    mostrarAviso("Descreva o investimento. Se ele tem <strong>rendimento contratado</strong> (como um CDB), preencha a taxa. Se o valor <strong>oscila</strong> (como cripto ou ações), preencha quanto vale hoje.");
    return;
  }

  alternarCampos(cfg.cat, cfg.dividendos === true, cfg.labelDiv);
  mostrarAviso(cfg.aviso);
}

/* Alterna a visibilidade dos grupos de campos */
function alternarCampos(modo, temDividendos, labelDiv) {
  const camposRF = document.querySelectorAll(".campo-rf");
  const camposRV = document.querySelectorAll(".campo-rv");
  const campoDiv = document.querySelector(".campo-dividendos");

  const mostrarRF = modo === "rf" || modo === "ambos";
  const mostrarRV = modo === "rv" || modo === "ambos";

  camposRF.forEach(c => c.classList.toggle("hidden-filter", !mostrarRF));
  camposRV.forEach(c => c.classList.toggle("hidden-filter", !mostrarRV));

  // O campo de dividendos só aparece para quem realmente paga (ações, FII, imóvel)
  if (campoDiv) {
    const mostrarDiv = mostrarRV && temDividendos;
    campoDiv.classList.toggle("hidden-filter", !mostrarDiv);
    if (labelDiv) {
      const lbl = campoDiv.querySelector("label");
      if (lbl) lbl.innerHTML = `${labelDiv} <span class="label-opt">(opcional)</span>`;
    } else {
      const lbl = campoDiv.querySelector("label");
      if (lbl) lbl.innerHTML = `Dividendos (% a.a.) <span class="label-opt">(opcional)</span>`;
    }
  }

  // Marca o form para o CSS ajustar o grid
  formInvestimento?.classList.toggle("modo-rv", modo === "rv");
  formInvestimento?.classList.toggle("modo-ambos", modo === "ambos");
}

/* Exibe o aviso explicativo sobre o tipo */
function mostrarAviso(texto) {
  if (!avisoTipoEl) return;
  if (!texto) { avisoTipoEl.style.display = "none"; return; }
  avisoTipoEl.innerHTML = `<span class="aviso-icone">💡</span><span>${texto}</span>`;
  avisoTipoEl.style.display = "flex";
}

invTipoSelect?.addEventListener("change", () => {
  ajustarFormPorTipo();
  if (invTipoSelect.value === "Outro") invTipoOutroInput?.focus();
});

formInvestimento?.addEventListener("submit", async e => {
  e.preventDefault();
  // Bloqueio de plano: investimentos é recurso Premium
  if (!podeUsar("investimentos")) {
    pedirUpgrade("Acompanhe CDB, Tesouro, ações e cripto, com simulador de rendimento.", "Investimentos");
    return;
  }
  const tipoSel = document.getElementById("invTipo").value;
  const tipoOutro = document.getElementById("invTipoOutro")?.value.trim() || "";
  const apelido = document.getElementById("invApelido")?.value.trim() || "";
  const valor = Number(document.getElementById("invValor").value);
  const contaId = document.getElementById("invConta")?.value || null;

  if (!tipoSel || !valor) { toast("Selecione o tipo e informe o valor.", "error"); return; }
  if (tipoSel === "Outro" && !tipoOutro) {
    toast("Descreva qual é o investimento.", "error");
    invTipoOutroInput?.focus();
    return;
  }

  const tipo = tipoSel === "Outro" ? tipoOutro : tipoSel;
  const cfg = configTipo(tipoSel);
  const rendaFixa = cfg.cat === "rf";

  // Campos de renda fixa
  const taxa = rendaFixa || cfg.cat === "escolher"
    ? (Number(document.getElementById("invTaxa").value) || 0) : 0;
  const modoTipo = cfg.modo || "taxa";
  // No modo CDI o percentual é sempre anual; período do input não se aplica
  const taxaPeriodo = modoTipo === "cdi" ? "ano" : document.getElementById("invTaxaPeriodo").value;
  const regime = document.getElementById("invRegime").value;

  // Renda fixa sem taxa não faz sentido
  if (rendaFixa && !taxa) {
    toast("Informe a taxa de rendimento.", "error");
    document.getElementById("invTaxa")?.focus();
    return;
  }

  // Campos de renda variável
  // Renda variável pode ter um valor atual informado (ações, imóvel...);
  // renda fixa cresce sozinha e não usa este campo.
  const valorAtualInput = document.getElementById("invValorAtual")?.value;
  const valorAtual = valorAtualInput ? Number(valorAtualInput) : null;
  const rendaPassiva = Number(document.getElementById("invRendaPassiva")?.value) || 0;

  // Campos de cripto
  const ehCripto = tipo === "Cripto";
  const criptoId = ehCripto ? (document.getElementById("invCripto")?.value || null) : null;
  const criptoQtd = ehCripto ? (Number(document.getElementById("invCriptoQtd")?.value) || null) : null;

  if (ehCripto && !criptoId) {
    toast("Selecione qual moeda.", "error");
    document.getElementById("invCripto")?.focus();
    return;
  }

  try {
    const novo = await dbInsert("investimentos", {
      nome: apelido, tipo, valor,
      taxa, taxa_periodo: taxaPeriodo, regime,
      valor_atual: valorAtual,
      renda_passiva: rendaPassiva,
      valor_atual_em: valorAtual ? hojeISO() : null,
      conta_id: contaId || null,
      data_inicio: hojeISO(),
      cripto_id: criptoId,
      cripto_qtd: criptoQtd
    });
    state.investimentos.push(mapInvestimento(novo));
    formInvestimento.reset();
    // O dropdown customizado do tipo volta ao "Selecione"
    document.getElementById("invTipo")?.dispatchEvent(new Event("change", { bubbles: true }));
    document.getElementById("invCriptoDica").innerHTML = "";
    document.getElementById("invValor")?.removeAttribute("data-editado-manual");
    fieldInvTipoOutro?.classList.add("hidden-filter");
    document.getElementById("fieldInvCripto")?.classList.add("hidden-filter");
    document.getElementById("fieldInvCriptoQtd")?.classList.add("hidden-filter");
    formInvestimento.classList.remove("com-outro", "modo-rv", "modo-ambos");
    ajustarFormPorTipo();
    atualizarSelectContas();
    renderInvestimentos();
    toast(`Investimento adicionado!`, "success");

    // Se for cripto, busca o preço agora e atualiza os valores
    if (criptoId) {
      atualizarPrecosCripto(true).then(() => renderInvestimentos());
    }
  } catch(err) { tratarErro(err); }
});

/* Monta o título exibido do investimento */
async function excluirInvestimento(id) {
  const ok = await confirmar("Excluir investimento?", { tipo: "perigo", descricao: "Ele será removido da sua carteira.", okLabel: "Excluir" }); if (!ok) return;
  const label = state.investimentos.find(i => i.id === id)?.nome || "Investimento";
  try {
    await dbDelete("investimentos", id);
    state.investimentos = state.investimentos.filter(i => i.id !== id);
    renderInvestimentos();
    toast(`"${label}" excluído.`, "info");
  } catch(err) { tratarErro(err); }
}

function mapInvestimento(i) {
  return {
    id: i.id, nome: i.nome, tipo: i.tipo, valor: Number(i.valor),
    taxa: Number(i.taxa || 0), taxaPeriodo: i.taxa_periodo, regime: i.regime,
    contaId: i.conta_id || null,
    valorAtual: i.valor_atual != null ? Number(i.valor_atual) : null,
    rendaPassiva: Number(i.renda_passiva || 0),
    valorAtualEm: i.valor_atual_em || null,
    dataInicio: i.data_inicio, observacao: i.observacao,
    criptoId: i.cripto_id || null,
    criptoQtd: i.cripto_qtd != null ? Number(i.cripto_qtd) : null
  };
}

/* ============================================================
   SIMULADOR DE RENDIMENTO
   ============================================================ */

let chartSimulador = null;

document.getElementById("formSimulador")?.addEventListener("submit", e => {
  e.preventDefault();
  const valor = Number(document.getElementById("simValor").value) || 0;
  const aporte = Number(document.getElementById("simAporte").value) || 0;
  const taxa = Number(document.getElementById("simTaxa").value);
  const periodo = document.getElementById("simTaxaPeriodo").value;
  const regime = document.getElementById("simRegime").value;
  const tempo = Number(document.getElementById("simTempo").value);
  const unidade = document.getElementById("simTempoUnidade").value;

  if ((!valor && !aporte) || !taxa || !tempo) {
    toast("Preencha valor (ou aporte), taxa e período.", "error");
    return;
  }

  const meses = Math.round(unidadeParaMeses(tempo, unidade));
  if (meses < 1) { toast("O período precisa ser de pelo menos 1 mês.", "warning"); return; }

  const r = projetarInvestimento(valor, taxa, periodo, regime, meses, aporte);

  document.getElementById("simInvestido").textContent = fmtMoeda(r.investido);
  document.getElementById("simJuros").textContent = fmtMoeda(r.juros);
  document.getElementById("simFinal").textContent = fmtMoeda(r.final);
  document.getElementById("simuladorResultado").style.display = "block";

  renderChartSimulador(r.serie, valor, aporte);
  toast("Simulação calculada!", "success");
});

function renderChartSimulador(serie, valorInicial, aporteMensal) {
  const canvas = document.getElementById("chartSimulador");
  if (!canvas) return;
  if (chartSimulador) chartSimulador.destroy();

  const labels = serie.map((_, idx) => `Mês ${idx + 1}`);
  // linha do total investido (sem juros) para comparar
  const investidoSerie = serie.map((_, idx) => valorInicial + aporteMensal * (idx + 1));

  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const tc = dark ? "#a3adc4" : "#4d5e73";
  const gc = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)";

  chartSimulador = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Com rendimento",
          data: serie,
          borderColor: "#2d6a72",
          backgroundColor: "rgba(45,106,114,0.10)",
          borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5,
          fill: true, tension: 0.3
        },
        {
          label: "Só investido",
          data: investidoSerie,
          borderColor: "#8896a5",
          borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0,
          fill: false, tension: 0.1
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
      plugins: {
        legend: { position: "bottom", labels: { color: tc, boxWidth: 12, padding: 14, font: { family: "Inter", size: 12 } } },
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmtMoeda(c.raw)}` } }
      },
      scales: {
        x: { grid: { color: gc }, ticks: { color: tc, font: { family: "Inter", size: 11 }, maxTicksLimit: 12 } },
        y: { grid: { color: gc }, ticks: { color: tc, font: { family: "Inter", size: 11 }, callback: v => fmtMoeda(v) } }
      }
    }
  });
}



/* ============================================================
   CONTAS A PAGAR E RECEBER (v7)
   ============================================================ */

const listaPendentesEl   = document.getElementById("listaPendentes");
const totalAPagarEl      = document.getElementById("totalAPagar");
const descAPagarEl       = document.getElementById("descAPagar");
const alertaVencEl       = document.getElementById("alertaVencimentos");
const statusMovSelect    = document.getElementById("statusMovimento");
const labelDataMov       = document.getElementById("labelDataMovimento");

/* O label da data muda conforme a situação */
statusMovSelect?.addEventListener("change", () => {
  if (!labelDataMov) return;
  labelDataMov.textContent = statusMovSelect.value === "pendente" ? "Vencimento" : "Data";
});


/* Renderiza o card de resumo e o alerta do topo */
function renderResumoCompromissos() {
  const t = totaisCompromissos();

  if (totalAPagarEl) totalAPagarEl.textContent = fmtMoeda(t.aPagar);

  if (descAPagarEl) {
    const fmtBR = s => `${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)}`;
    const rotulo = dataLimiteDash
      ? `até ${fmtBR(dataLimiteDash)}`
      : ({
          mes:      "neste mês",
          proximo:  "até o fim do mês que vem",
          "3meses": "nos próximos 3 meses",
          tudo:     "no próximo ano"
        }[periodoDash] || "");

    if (t.qtdPendentes === 0) {
      descAPagarEl.textContent = `Nada pendente ${rotulo}`;
    } else {
      const partes = [];
      if (t.atrasados.length) partes.push(`${t.atrasados.length} atrasada(s)`);
      partes.push(`sobra ${fmtMoeda(t.saldoProjetado)}`);
      descAPagarEl.textContent = partes.join(" · ");
    }
  }

  // Alerta do topo — reservado para o que é URGENTE de verdade:
  // contas atrasadas, vencendo hoje, ou nos próximos 3 dias.
  // O resto fica no sino, para não banalizar o alerta.
  if (alertaVencEl) {
    const atrasadas = t.atrasados;
    const hojeVence = t.lista.filter(m => diasAte(m.vencimento) === 0);
    const ate3dias  = t.lista.filter(m => { const d = diasAte(m.vencimento); return d >= 1 && d <= 3; });

    if (!atrasadas.length && !hojeVence.length && !ate3dias.length) {
      alertaVencEl.style.display = "none";
    } else {
      const soma = arr => arr.reduce((a,m) => a + m.valor, 0);
      const temFatura = arr => arr.some(m => m.origem === "fatura");
      // Ícones com FORMA distinta por urgência (não só cor): triângulo de
      // alerta para atrasado/vence hoje, relógio para "vence em breve".
      const icTriangulo = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 2 20h20L12 3.5z"/><line x1="12" y1="10" x2="12" y2="14.5"/><circle cx="12" cy="17.3" r="0.9" fill="currentColor" stroke="none"/></svg>';
      const icRelogio    = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>';
      let msg = "", cls, icone;

      if (atrasadas.length) {
        const n = atrasadas.length;
        const oQue = temFatura(atrasadas) && n === 1 ? "Fatura atrasada" : `${n} conta${n>1?"s":""} atrasada${n>1?"s":""}`;
        msg = `<strong>${oQue}</strong> — ${fmtMoeda(soma(atrasadas))}`;
        cls = "alerta-erro"; icone = icTriangulo;
        const urgentes = hojeVence.length + ate3dias.length;
        if (urgentes) msg += ` · e ${urgentes} vence${urgentes>1?"m":""} em breve`;

      } else if (hojeVence.length) {
        const n = hojeVence.length;
        const oQue = temFatura(hojeVence) && n === 1
          ? "Fatura vence hoje"
          : `${n} conta${n>1?"s":""} vence${n>1?"m":""} hoje`;
        msg = `<strong>${oQue}</strong> — ${fmtMoeda(soma(hojeVence))}`;
        cls = "alerta-erro"; icone = icTriangulo;
        if (ate3dias.length) msg += ` · mais ${ate3dias.length} em até 3 dias`;

      } else {
        const n = ate3dias.length;
        const oQue = temFatura(ate3dias) && n === 1 ? "Fatura vence" : `${n} conta${n>1?"s":""} vence${n>1?"m":""}`;
        const dMin = Math.min(...ate3dias.map(m => diasAte(m.vencimento)));
        msg = `<strong>${oQue} ${dMin === 1 ? "amanhã" : `em ${dMin} dias`}</strong> — ${fmtMoeda(soma(ate3dias))}`;
        cls = "alerta-aviso"; icone = icRelogio;
      }

      alertaVencEl.className = `alerta-venc ${cls}`;
      alertaVencEl.innerHTML = `<span class="alerta-icone">${icone}</span><span>${msg}</span>`;
      alertaVencEl.style.display = "flex";
    }
  }
}

/* Renderiza os compromissos do período escolhido */
function renderPendentes() {
  if (!listaPendentesEl) return;
  renderResumoCompromissos();

  const t = totaisCompromissos();
  const pend = t.lista;

  if (!pend.length) {
    if (!state.recorrencias.length && !state.bancos.length) {
      listaPendentesEl.innerHTML = vazio(
        ICO.repetir,
        "Cadastre o que se repete",
        "Aluguel, assinaturas, salário. Você cadastra uma vez e o app avisa todo mês.",
        { texto: "Criar recorrência", onclick: "irParaRecorrencias()" }
      );
    } else {
      const fmtBR2 = s => `${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)}`;
      const txt = dataLimiteDash
        ? `Nada pendente até ${fmtBR2(dataLimiteDash)}.`
        : ({
            mes:     "Nada pendente neste mês.",
            proximo: "Nada pendente até o fim do mês que vem.",
            "3meses":"Nada pendente nos próximos 3 meses.",
            tudo:    "Nada pendente no próximo ano."
          }[periodoDash] || "Nada pendente.");
      listaPendentesEl.innerHTML = vazio(ICO.check, "Tudo em dia", txt);
    }
    return;
  }

  // Agrupar por mês quando o período abrange mais de um
  const porMes = {};
  pend.forEach(m => {
    const chave = m.vencimento.slice(0, 7);
    (porMes[chave] = porMes[chave] || []).push(m);
  });

  const meses = Object.keys(porMes).sort();
  const varios = meses.length > 1;

  listaPendentesEl.innerHTML = meses.map(mes => {
    const itens = porMes[mes];
    const [a, mm] = mes.split("-").map(Number);
    const rotulo = `${MESES_PT[mm-1]} ${a}`;
    const totalMes = itens.reduce((s, i) => s + (i.tipo === "gasto" ? i.valor : -i.valor), 0);

    const cabecalho = varios
      ? `<div class="pend-mes">
           <span class="pend-mes-nome">${rotulo}</span>
           <span class="pend-mes-total">${totalMes >= 0 ? "−" : "+"}${fmtMoeda(Math.abs(totalMes))}</span>
         </div>`
      : "";

    return cabecalho + itens.map(m => cardPendente(m)).join("");
  }).join("");
}

/* Card de um compromisso */
function cardPendente(m) {
  const d = diasAte(m.vencimento);
  const atrasado = d < 0;
  const ehEntrada = m.tipo === "entrada";
  const b = state.bancos.find(x => x.id === m.contaId);

  let txt, cls;
  if (atrasado)   { txt = `Atrasado ${Math.abs(d)} ${Math.abs(d)===1?"dia":"dias"}`; cls = "atrasado"; }
  else if (d===0) { txt = "Vence hoje"; cls = "hoje"; }
  else if (d===1) { txt = "Vence amanhã"; cls = "perto"; }
  else if (d<=7)  { txt = `Vence em ${d} dias`; cls = "perto"; }
  else {
    const dt = new Date(m.vencimento+"T00:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"short"});
    txt = `Vence ${dt}`; cls = "futuro";
  }

  const acao = m.origem === "recorrente"
    ? `pagarOcorrencia('${m.recId}','${m.vencimento}')`
    : m.origem === "fatura"
      ? `abrirTelaCartao('${m.cartaoId}')`
      : `marcarComoPago('${m.id}')`;

  const rotuloBtn = m.origem === "fatura" ? "Ver fatura" : (ehEntrada ? "Recebi" : "Paguei");

  return `<div class="pend-item ${cls}">
    ${b ? marcaConta(b, "sm") : `<span class="marca-conta marca-conta-sm marca-vazia">?</span>`}

    <div class="pend-info">
      <div class="pend-desc">
        ${esc(m.descricao)}
        ${m.origem === "recorrente" ? `<span class="pend-tag-rec" title="Recorrente">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10"/></svg>
        </span>` : ""}
        ${m.origem === "fatura" ? `<span class="pend-tag-rec" title="Fatura de cartão">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
        </span>` : ""}
      </div>
      <div class="pend-meta">
        <span class="pend-prazo ${cls}">${txt}</span>
        <span class="mov-sep">·</span>
        <span class="badge">${esc(m.categoria)}</span>
      </div>
    </div>

    <div class="pend-valor ${ehEntrada ? "valor-positivo" : "valor-negativo"}">
      ${ehEntrada ? "+" : "−"}${fmtMoeda(m.valor)}
    </div>

    <button class="btn-pagar" onclick="${acao}">${rotuloBtn}</button>
  </div>`;
}

/* Seletor de período */
document.querySelectorAll("#periodoSeletor .periodo-opcao").forEach(btn => {
  if (btn.id === "btnCompromissosData") return;   // o calendário tem lógica própria
  btn.addEventListener("click", () => {
    document.querySelectorAll("#periodoSeletor .periodo-opcao").forEach(b => b.classList.remove("ativo"));
    btn.classList.add("ativo");
    dataLimiteDash = null;          // volta ao período pré-definido
    periodoDash = btn.dataset.p;
    renderPendentes();
    renderResumoCompromissos();
  });
});

/* Escolher uma data específica para ver os compromissos */
(function initCompromissosData() {
  const btn      = document.getElementById("btnCompromissosData");
  const pop      = document.getElementById("compromissosDatasPopover");
  const inpAte   = document.getElementById("compromissosDataAte");
  const aplicar  = document.getElementById("compromissosDatasAplicar");
  const cancelar = document.getElementById("compromissosDatasCancelar");
  if (!btn || !pop) return;

  const fechar = () => { pop.hidden = true; };

  btn.addEventListener("click", e => {
    e.stopPropagation();
    if (pop.hidden) {
      if (!inpAte.value) inpAte.value = dataLimiteDash || somarMeses(hojeISO(), 1);
      pop.hidden = false;
    } else {
      fechar();
    }
  });

  cancelar?.addEventListener("click", fechar);

  aplicar?.addEventListener("click", () => {
    const ate = inpAte.value;
    if (!ate) return;
    dataLimiteDash = ate;
    document.querySelectorAll("#periodoSeletor .periodo-opcao").forEach(b => b.classList.remove("ativo"));
    btn.classList.add("ativo");
    fechar();
    renderPendentes();
    renderResumoCompromissos();
  });

  // Fecha ao clicar fora
  document.addEventListener("click", e => {
    if (pop.hidden) return;
    if (!pop.contains(e.target) && !btn.contains(e.target)) fechar();
  });
})();


/* Marca um compromisso como pago — aí sim afeta o saldo */
async function marcarComoPago(id) {
  const m = state.movimentos.find(x => x.id === id); if (!m) return;
  const ehEntrada = m.tipo === "entrada";
  try {
    const hoje = hojeISO();

    // Se era um gasto no CRÉDITO agendado, ao pagar ele vira uma compra real
    // no cartão: entra na fatura do mês e passa a ocupar o limite — igual a um
    // cartão de verdade (o limite só é usado quando a compra acontece).
    const viraCompraCredito = m.tipo === "gasto"
      && m.formaPagamento === "credito"
      && !m.cartaoId
      && m.bancoId
      && state.bancos.some(b => b.id === m.bancoId && b.temCartao);

    // Ao virar compra no cartão, checa o limite — igual à compra à vista.
    if (viraCompraCredito && !limiteComporta(m.bancoId, m.valor)) {
      return;
    }

    const patch = {
      status: "pago",
      pago_em: hoje,
      data: hoje   // a data do lançamento vira o dia do pagamento efetivo
    };
    if (viraCompraCredito) {
      patch.cartao_id = m.bancoId;
      patch.fatura_mes = faturaDaCompra(hoje, null);
    }

    await dbUpdate("movimentos", id, patch);
    m.status = "pago";
    m.pagoEm = hoje;
    m.data = hoje;
    if (viraCompraCredito) {
      m.cartaoId = m.bancoId;
      m.faturaMes = patch.fatura_mes;
    }
    renderTudo();
    toast(
      ehEntrada ? `Recebimento de ${fmtMoeda(m.valor)} confirmado!` : `Pagamento de ${fmtMoeda(m.valor)} registrado!`,
      "success"
    );
  } catch(err) { tratarErro(err); }
}



/* ============================================================
   MOTOR DE RECORRÊNCIAS (v8)
   A recorrência é uma REGRA. O app calcula os vencimentos.
   Nada é "gerado" — as ocorrências são derivadas ao vivo.
   ============================================================ */

/* Soma meses a uma data, respeitando o fim do mês.
   Ex: 31/jan + 1 mês = 28/fev (não 03/mar) */
function somarMeses(dataISO, n) {
  const [a, m, d] = dataISO.split("-").map(Number);
  const alvoMes = m - 1 + n;
  const ano = a + Math.floor(alvoMes / 12);
  const mes = ((alvoMes % 12) + 12) % 12;
  const ultimoDia = new Date(ano, mes + 1, 0).getDate();
  const dia = Math.min(d, ultimoDia);
  return `${ano}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

function somarDias(dataISO, n) {
  const dt = new Date(dataISO + "T00:00:00");
  dt.setDate(dt.getDate() + n);
  const ano = dt.getFullYear();
  const mes = String(dt.getMonth() + 1).padStart(2, "0");
  const dia = String(dt.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

/* Gera as ocorrências de uma recorrência dentro de um intervalo.
   Retorna as datas de vencimento. */
function ocorrenciasDe(rec, deISO, ateISO) {
  const out = [];
  if (!rec.ativa) return out;

  const inicio = rec.inicio || hojeISO();
  const fim = rec.fim || null;

  // A primeira ocorrência nunca é antes do início da regra
  let atual = inicio;

  // Avança até entrar na janela pedida (com limite de segurança)
  let guarda = 0;
  const LIMITE = 5000;

  const proxima = (d) => {
    switch (rec.frequencia) {
      case "diaria":
        return somarDias(d, 1);
      case "anual":
        return somarMeses(d, 12);
      case "personalizada":
        return rec.intervaloUnidade === "dias"
          ? somarDias(d, rec.intervalo || 1)
          : somarMeses(d, rec.intervalo || 1);
      case "mensal":
      default:
        return somarMeses(d, 1);
    }
  };

  while (atual <= ateISO && guarda++ < LIMITE) {
    if (fim && atual > fim) break;
    if (atual >= deISO) out.push(atual);
    const seguinte = proxima(atual);
    if (seguinte <= atual) break;  // proteção contra loop infinito
    atual = seguinte;
  }

  return out;
}

/* Todas as ocorrências de todas as recorrências numa janela,
   já marcadas como pagas ou pendentes. */
function ocorrenciasNaJanela(deISO, ateISO) {
  const itens = [];
  state.recorrencias.forEach(rec => {
    ocorrenciasDe(rec, deISO, ateISO).forEach(venc => {
      const pag = state.recPagamentos.find(
        p => p.recorrenciaId === rec.id && p.vencimento === venc
      );
      itens.push({
        rec,
        vencimento: venc,
        pago: !!pag,
        pagamento: pag || null,
        valor: pag?.valorPago ?? rec.valor
      });
    });
  });
  return itens.sort((a, b) => a.vencimento.localeCompare(b.vencimento));
}

/* Versão leve de "tem algo pra resolver", usada só pra acender a bolinha
   vermelha do espaço que NÃO está ativo agora (seletor Pessoal/Empresarial
   na sidebar — ver atualizarSeletorContexto()). Recebe os arrays BRUTOS
   (como vêm do Supabase, chave em snake_case) já buscados em
   carregarDadosNuvem() — não faz nenhuma consulta nova, e não mexe em
   state.* (por isso não reaproveita calcularAvisos(), que é amarrado ao
   contexto ativo). Olha só o que é rápido de checar: lançamento avulso
   pendente vencido/vencendo, ou ocorrência de recorrência não paga —
   não cobre saldo negativo nem meta estourada do outro espaço. */
function haCompromissoPendente(contexto, movimentosBrutos, recorrenciasBrutas, recPagamentosBrutos) {
  const limite = somarDias(hojeISO(), 5); // mesmo horizonte de calcularAvisos()
  const doContexto = linha => (linha.contexto || "pessoal") === contexto;

  const temAvulso = (movimentosBrutos || []).some(m => {
    if (!doContexto(m)) return false;
    if (m.tipo !== "gasto" || (m.status || "pago") !== "pendente") return false;
    const venc = m.vencimento || m.data;
    return venc && venc <= limite;
  });
  if (temAvulso) return true;

  const recDoOutro = (recorrenciasBrutas || []).filter(r => doContexto(r) && r.ativa !== false);
  if (!recDoOutro.length) return false;

  const pagas = new Set(
    (recPagamentosBrutos || [])
      .filter(doContexto)
      .map(p => `${p.recorrencia_id}|${p.vencimento}`)
  );
  return recDoOutro.some(r => {
    const rec = {
      ativa: true,
      inicio: r.inicio || (r.dia ? `${mesAtualISO()}-${String(r.dia).padStart(2,"0")}` : hojeISO()),
      fim: r.fim || null,
      frequencia: r.frequencia || "mensal",
      intervalo: r.intervalo || 1,
      intervaloUnidade: r.intervalo_unidade || "meses"
    };
    return ocorrenciasDe(rec, "2000-01-01", limite).some(venc => !pagas.has(`${r.id}|${venc}`));
  });
}


/* Descrição legível da frequência */
function textoFrequencia(rec) {
  switch (rec.frequencia) {
    case "diaria": return "Todo dia";
    case "anual": {
      const d = new Date((rec.inicio || hojeISO()) + "T00:00:00");
      return `Todo ano em ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}`;
    }
    case "personalizada": {
      const n = rec.intervalo || 1;
      const u = rec.intervaloUnidade === "dias"
        ? (n === 1 ? "dia" : "dias")
        : (n === 1 ? "mês" : "meses");
      return `A cada ${n} ${u}`;
    }
    case "mensal":
    default: {
      const dia = Number((rec.inicio || hojeISO()).slice(8, 10));
      return `Todo mês, dia ${dia}`;
    }
  }
}



/* ============================================================
   UI DAS OCORRÊNCIAS — navegar meses e marcar como pago
   ============================================================ */

let mesVisao = mesAtualISO();          // "2026-07"
let filtroOcor = "todos";

const listaOcorrenciasEl = document.getElementById("listaOcorrencias");
const periodoLabelEl     = document.getElementById("periodoLabel");
const previewRecEl       = document.getElementById("previewRecorrencia");

const MESES_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
                  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function labelMes(ym) {
  const [a, m] = ym.split("-").map(Number);
  return `${MESES_PT[m-1]} ${a}`;
}
function mudarMes(delta) {
  const [a, m] = mesVisao.split("-").map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  mesVisao = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  renderOcorrencias();
}

document.getElementById("mesAnterior")?.addEventListener("click", () => mudarMes(-1));
document.getElementById("mesProximo")?.addEventListener("click", () => mudarMes(1));
document.getElementById("voltarHoje")?.addEventListener("click", () => {
  mesVisao = mesAtualISO();
  renderOcorrencias();
});

document.querySelectorAll("#filtroOcorrencias .chip").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("#filtroOcorrencias .chip").forEach(c => c.classList.remove("ativo"));
    chip.classList.add("ativo");
    filtroOcor = chip.dataset.f;
    renderOcorrencias();
  });
});

/* Renderiza as ocorrências do mês visível */
function renderOcorrencias() {
  if (!listaOcorrenciasEl) return;
  if (periodoLabelEl) periodoLabelEl.textContent = labelMes(mesVisao);

  if (!state.recorrencias.length) {
    listaOcorrenciasEl.innerHTML = vazio(
      ICO.repetir,
      "Nenhum gasto fixo",
      "Cadastre acima e os vencimentos aparecem aqui automaticamente."
    );
    return;
  }

  const [a, m] = mesVisao.split("-").map(Number);
  const de  = `${mesVisao}-01`;
  const ate = `${mesVisao}-${String(new Date(a, m, 0).getDate()).padStart(2,"0")}`;

  let itens = ocorrenciasNaJanela(de, ate);

  if (filtroOcor === "pendentes")      itens = itens.filter(o => !o.pago);
  else if (filtroOcor === "pagos")     itens = itens.filter(o => o.pago);
  else if (filtroOcor === "atrasados") itens = itens.filter(o => !o.pago && o.vencimento < hojeISO());

  if (!itens.length) {
    const msgs = {
      todos:     "Nenhum vencimento neste mês.",
      pendentes: "Nada pendente neste mês.",
      pagos:     "Nada foi pago ainda neste mês.",
      atrasados: "Nenhuma conta atrasada."
    };
    listaOcorrenciasEl.innerHTML = `<div class="empty-state">${msgs[filtroOcor]}</div>`;
    return;
  }

  // Resumo enxuto: só o que importa — quanto falta pagar
  const pend = itens.filter(o => !o.pago);
  const totalPend = pend.reduce((s,o) => s + (o.rec.tipo === "gasto" ? o.valor : 0), 0);

  const resumo = pend.length
    ? `<div class="venc-resumo venc-resumo-pend">
         <span>${pend.length} pendente${pend.length > 1 ? "s" : ""}</span>
         <strong>${fmtMoeda(totalPend)}</strong>
       </div>`
    : `<div class="venc-resumo venc-resumo-ok">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
         <span>Tudo pago neste mês</span>
       </div>`;

  listaOcorrenciasEl.innerHTML = resumo + itens.map(o => cardOcorrencia(o)).join("");
}

/* Card de uma ocorrência */
function cardOcorrencia(o) {
  const { rec, vencimento, pago, pagamento, valor } = o;
  const hoje = hojeISO();
  const atrasado = !pago && vencimento < hoje;
  const dias = Math.round((new Date(vencimento+"T00:00:00") - new Date(hoje+"T00:00:00")) / 86400000);
  const ehEntrada = rec.tipo === "entrada";
  const conta = state.bancos.find(b => b.id === rec.contaId);

  let estado, cls;
  if (pago) {
    const pg = new Date(pagamento.pagoEm+"T00:00:00").toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit" });
    estado = `Pago em ${pg}`;
    cls = "pago";
  } else if (atrasado) {
    const d = Math.abs(dias);
    estado = `Atrasado ${d} ${d===1?"dia":"dias"}`;
    cls = "atrasado";
  } else if (dias === 0) {
    estado = "Vence hoje"; cls = "hoje";
  } else if (dias === 1) {
    estado = "Vence amanhã"; cls = "perto";
  } else if (dias <= 7) {
    estado = `Vence em ${dias} dias`; cls = "perto";
  } else {
    estado = `Vence dia ${vencimento.slice(8,10)}`; cls = "futuro";
  }

  const acao = pago
    ? `<button class="btn-acao" onclick="desfazerPagamento('${rec.id}','${vencimento}')" title="Desfazer">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>
       </button>`
    : `<button class="btn-pagar" onclick="pagarOcorrencia('${rec.id}','${vencimento}')">
         ${ehEntrada ? "Recebi" : "Paguei"}
       </button>`;

  return `<div class="ocor-item ${cls}">
    <div class="ocor-dia">
      <span class="ocor-dia-num">${vencimento.slice(8,10)}</span>
      <span class="ocor-dia-mes">${MESES_PT[Number(vencimento.slice(5,7))-1].slice(0,3)}</span>
    </div>

    <div class="ocor-info">
      <div class="ocor-desc">${esc(rec.descricao)}</div>
      <div class="ocor-meta">
        <span class="ocor-estado ${cls}">${estado}</span>
        <span class="mov-sep">·</span>
        <span class="badge">${esc(rec.categoria)}</span>
        ${conta ? `<span class="mov-sep">·</span><span>${esc(conta.nome)}</span>` : ""}
      </div>
    </div>

    <div class="ocor-valor ${pago ? (ehEntrada?"valor-positivo":"valor-negativo") : "valor-pendente"}">
      ${ehEntrada ? "+" : "−"}${fmtMoeda(valor)}
    </div>

    <div class="ocor-acoes">${acao}</div>
  </div>`;
}

/* Marca uma ocorrência como paga — cria o lançamento no extrato */
async function pagarOcorrencia(recId, vencimento) {
  const rec = state.recorrencias.find(r => r.id === recId); if (!rec) return;

  // Permite ajustar o valor (conta de luz varia!)
  const valor = await promptValor(
    `Confirmar ${rec.tipo === "entrada" ? "recebimento" : "pagamento"} de <strong>${esc(rec.descricao)}</strong><br>
     <span style="font-size:12px;opacity:.7">Vencimento: ${new Date(vencimento+"T00:00:00").toLocaleDateString("pt-BR")}</span>`,
    rec.valor
  );
  if (valor === null || isNaN(valor) || valor <= 0) return;

  mostrarLoading(true);
  try {
    const hoje = hojeISO();
    // 1. Cria o lançamento no extrato (já como pago)
    // A data do lançamento é o VENCIMENTO da ocorrência, não o dia em que
    // a pessoa clicou em pagar — sem isso, marcar como pago um gasto fixo
    // do mês que vem fazia o lançamento cair neste mês (hoje), inflando o
    // mês errado na Planilha. "pago_em" continua sendo hoje de verdade.
    const mov = await dbInsert("movimentos", {
      descricao: rec.descricao,
      conta_id: rec.contaId,
      data: vencimento,
      valor,
      tipo: rec.tipo,
      categoria: rec.categoria,
      recorrencia_id: rec.id,
      status: "pago",
      pago_em: hoje
    });
    state.movimentos.push({
      id:mov.id, recorrenciaId:mov.recorrencia_id, descricao:mov.descricao,
      bancoId:mov.conta_id, data:mov.data, valor:Number(mov.valor),
      tipo:mov.tipo, categoria:mov.categoria,
      status:"pago", vencimento:null, pagoEm:hoje
    });

    // 2. Registra o pagamento daquela parcela específica
    const pag = await dbInsert("recorrencia_pagamentos", {
      recorrencia_id: rec.id,
      vencimento,
      pago_em: hoje,
      valor_pago: valor,
      movimento_id: mov.id
    });
    state.recPagamentos.push({
      id:pag.id, recorrenciaId:pag.recorrencia_id, vencimento:pag.vencimento,
      pagoEm:pag.pago_em, valorPago:Number(pag.valor_pago), movimentoId:pag.movimento_id
    });

    renderTudo();
    toast(`${esc(rec.descricao)} — ${fmtMoeda(valor)} registrado!`, "success");
  } catch(err) {
    toast(err.message.includes("duplicate") ? "Essa parcela já foi paga." : err.message, "error");
  } finally { mostrarLoading(false); }
}

/* Desfaz um pagamento */
async function desfazerPagamento(recId, vencimento) {
  const pag = state.recPagamentos.find(p => p.recorrenciaId === recId && p.vencimento === vencimento);
  if (!pag) return;
  const ok = await confirmar("Desfazer pagamento?", { tipo: "perigo", descricao: "O lançamento será removido do extrato.", okLabel: "Desfazer" });
  if (!ok) return;

  mostrarLoading(true);
  try {
    // Remove o lançamento do extrato
    if (pag.movimentoId) {
      await dbDelete("movimentos", pag.movimentoId).catch(()=>{});
      state.movimentos = state.movimentos.filter(m => m.id !== pag.movimentoId);
    }
    // Remove o registro do pagamento
    await dbDelete("recorrencia_pagamentos", pag.id);
    state.recPagamentos = state.recPagamentos.filter(p => p.id !== pag.id);
    renderTudo();
    toast("Pagamento desfeito. A conta voltou a ficar pendente.", "info");
  } catch(err) { tratarErro(err); }
  finally { mostrarLoading(false); }
}


/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */

/* ============================================================
   FLUXO DE RECUPERAÇÃO DE SENHA
   ============================================================ */

function mostrarTela(qual) {
  const telas = {
    login:      "formLoginWrap",
    cadastro:   "formCadastroWrap",
    reset:      "formResetWrap",
    novaSenha:  "formNovaSenhaWrap"
  };
  Object.entries(telas).forEach(([k, id]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = (k === qual) ? "flex" : "none";
  });
}

document.getElementById("btnEsqueciSenha")?.addEventListener("click", () => {
  // Já leva o e-mail digitado, se houver
  const email = document.getElementById("loginEmail")?.value.trim();
  const campo = document.getElementById("resetEmail");
  if (campo && email) campo.value = email;
  document.getElementById("resetEnviado").style.display = "none";
  document.getElementById("formReset").style.display = "flex";
  mostrarTela("reset");
});

document.getElementById("btnVoltarLogin")?.addEventListener("click", () => mostrarTela("login"));

/* Envia o e-mail de recuperação */
document.getElementById("formReset")?.addEventListener("submit", async e => {
  e.preventDefault();
  const email = document.getElementById("resetEmail").value.trim();
  const btn = e.target.querySelector("button[type=submit]");
  if (!email) return;

  btn.disabled = true;
  btn.textContent = "Enviando...";
  try {
    await sbEnviarResetSenha(email);
    // Por segurança, a mensagem é a mesma exista ou não a conta
    document.getElementById("formReset").style.display = "none";
    document.getElementById("resetEnviado").style.display = "block";
  } catch(err) {
    tratarErro(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Enviar link de recuperação";
  }
});

/* Salva a nova senha */
document.getElementById("formNovaSenha")?.addEventListener("submit", async e => {
  e.preventDefault();
  const s1 = document.getElementById("novaSenha").value;
  const s2 = document.getElementById("novaSenhaConfirmar").value;
  const btn = e.target.querySelector("button[type=submit]");

  if (s1.length < 6) { toast("A senha precisa ter pelo menos 6 caracteres.", "error"); return; }
  if (s1 !== s2)     { toast("As senhas não coincidem.", "error"); return; }

  const token = sessionStorage.getItem("fp_reset_token");
  if (!token) { toast("Link inválido ou expirado. Peça um novo.", "error"); mostrarTela("login"); return; }

  btn.disabled = true;
  btn.textContent = "Salvando...";
  try {
    await sbDefinirNovaSenha(token, s1);
    sessionStorage.removeItem("fp_reset_token");
    // Limpa o hash da URL para o link não ser reutilizado
    history.replaceState(null, "", window.location.pathname);
    toast("Senha alterada! Faça login com a nova senha.", "success");
    mostrarTela("login");
    document.getElementById("formNovaSenha").reset();
  } catch(err) {
    tratarErro(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Salvar nova senha";
  }
});

/* Detecta se o usuário chegou pelo link do e-mail.
   O Supabase devolve o token no hash: #access_token=...&type=recovery */
function verificarLinkRecuperacao() {
  const hash = window.location.hash;
  if (!hash || !hash.includes("type=recovery")) return false;

  const params = new URLSearchParams(hash.slice(1));
  const token = params.get("access_token");
  const erro  = params.get("error_description");

  if (erro) {
    toast(decodeURIComponent(erro.replace(/\+/g, " ")), "error");
    history.replaceState(null, "", window.location.pathname);
    return false;
  }
  if (!token) return false;

  // Guarda o token e mostra a tela de nova senha
  sessionStorage.setItem("fp_reset_token", token);
  mostrarTelaLogin();          // garante que a tela de auth está visível
  mostrarTela("novaSenha");
  return true;
}



/* ============================================================
   EDIÇÕES QUE FALTAVAM (v9)
   ============================================================ */


/* Editar um investimento */
function abrirEditarInvestimento(id) {
  const i = state.investimentos.find(x => x.id === id); if (!i) return;
  const modal = document.getElementById("modalEditarInvestimento");
  if (!modal) return;

  document.getElementById("editInvId").value = i.id;
  document.getElementById("editInvApelido").value = i.nome || "";
  document.getElementById("editInvValor").value = i.valor;
  document.getElementById("editInvTaxa").value = i.taxa || "";
  document.getElementById("editInvTaxaPeriodo").value = i.taxaPeriodo || "ano";
  document.getElementById("editInvRegime").value = i.regime || "composto";
  document.getElementById("editInvValorAtual").value = i.valorAtual != null ? i.valorAtual : "";
  document.getElementById("editInvRendaPassiva").value = i.rendaPassiva || "";

  // Conta
  const sel = document.getElementById("editInvConta");
  sel.innerHTML = `<option value="">Não informar</option>` +
    state.bancos.map(b => `<option value="${b.id}"${b.id === i.contaId ? " selected" : ""}>${esc(b.nome)} · ${esc(b.tipo)}</option>`).join("");

  // Mostra só os campos que fazem sentido para o tipo
  const rf = ehRendaFixa(i.tipo);
  const ehCripto = !!i.criptoId;
  modal.querySelectorAll(".edit-campo-rf").forEach(el => el.classList.toggle("hidden-filter", !rf));
  modal.querySelectorAll(".edit-campo-rv").forEach(el => el.classList.toggle("hidden-filter", rf));
  // "Vale hoje" serve para todo tipo (a pessoa informa o valor atual), menos
  // cripto, cujo valor vem do preço de mercado ao vivo.
  modal.querySelectorAll(".edit-campo-valorhoje").forEach(el => el.classList.toggle("hidden-filter", ehCripto));

  document.getElementById("editInvTipoLabel").textContent = i.tipo;
  modal.classList.add("open");
}

document.getElementById("formEditarInvestimento")?.addEventListener("submit", async e => {
  e.preventDefault();
  const id = document.getElementById("editInvId").value;
  const i = state.investimentos.find(x => x.id === id); if (!i) return;

  const nome = document.getElementById("editInvApelido").value.trim();
  const valor = Number(document.getElementById("editInvValor").value);
  const taxa = Number(document.getElementById("editInvTaxa").value) || 0;
  const taxaPeriodo = document.getElementById("editInvTaxaPeriodo").value;
  const regime = document.getElementById("editInvRegime").value;
  const contaId = document.getElementById("editInvConta").value || null;
  const vaStr = document.getElementById("editInvValorAtual").value;
  const valorAtual = vaStr ? Number(vaStr) : null;
  const rendaPassiva = Number(document.getElementById("editInvRendaPassiva").value) || 0;

  if (!valor || valor <= 0) { toast("Informe um valor válido.", "error"); return; }
  if (ehRendaFixa(i.tipo) && !taxa) { toast("Informe a taxa de rendimento.", "error"); return; }

  try {
    const att = await dbUpdate("investimentos", id, {
      nome, valor, taxa, taxa_periodo: taxaPeriodo, regime,
      conta_id: contaId,
      valor_atual: valorAtual,
      renda_passiva: rendaPassiva,
      valor_atual_em: valorAtual != null ? hojeISO() : null
    });
    Object.assign(i, mapInvestimento(att));
    fecharModal("modalEditarInvestimento");
    renderTudo();
    toast("Investimento atualizado!", "success");
  } catch(err) { tratarErro(err); }
});

/* Editar uma transferência */
function abrirEditarTransferencia(id) {
  const t = state.transferencias.find(x => x.id === id); if (!t) return;
  const modal = document.getElementById("modalEditarTransferencia");
  if (!modal) return;

  document.getElementById("editTransId").value = t.id;
  document.getElementById("editTransValor").value = t.valor;
  document.getElementById("editTransData").value = t.data;
  document.getElementById("editTransDescricao").value = t.descricao || "";

  const opts = state.bancos.map(b => `<option value="${b.id}">${esc(b.nome)} · ${esc(b.tipo)}</option>`).join("");
  const so = document.getElementById("editTransOrigem");
  const sd = document.getElementById("editTransDestino");
  so.innerHTML = opts; sd.innerHTML = opts;
  so.value = t.origem; sd.value = t.destino;

  modal.classList.add("open");
}

document.getElementById("formEditarTransferencia")?.addEventListener("submit", async e => {
  e.preventDefault();
  const id = document.getElementById("editTransId").value;
  const t = state.transferencias.find(x => x.id === id); if (!t) return;

  const origem = document.getElementById("editTransOrigem").value;
  const destino = document.getElementById("editTransDestino").value;
  const valor = Number(document.getElementById("editTransValor").value);
  const data = document.getElementById("editTransData").value;
  const descricao = document.getElementById("editTransDescricao").value.trim();

  if (origem === destino) { toast("Origem e destino precisam ser diferentes.", "error"); return; }
  if (!valor || valor <= 0) { toast("Informe um valor válido.", "error"); return; }

  try {
    const att = await dbUpdate("transferencias", id, {
      conta_origem: origem, conta_destino: destino, valor, data, descricao
    });
    Object.assign(t, {
      origem: att.conta_origem, destino: att.conta_destino,
      valor: Number(att.valor), data: att.data, descricao: att.descricao || ""
    });
    fecharModal("modalEditarTransferencia");
    renderTudo();
    toast("Transferência atualizada!", "success");
  } catch(err) { tratarErro(err); }
});




/* Controles de paginação do histórico */
function carregarMaisMovimentos() {
  movsVisiveis += PAGINA_TAM;
  renderMovimentos();
}
function recolherMovimentos() {
  movsVisiveis = PAGINA_TAM;
  renderMovimentos();
  document.getElementById("listaMovimentos")?.scrollIntoView({ behavior:"smooth", block:"start" });
}


/* ============================================================
   LGPD — direitos do titular dos dados (v11)
   ============================================================ */


/* ── Documentos legais ──
   SUBSTITUA o conteúdo abaixo pelos seus documentos definitivos.
   O ideal é ter revisão jurídica antes de operar comercialmente. */
const DOCUMENTOS = {
  privacidade: {
    titulo: "Política de Privacidade",
    corpo: `
      <p>Esta Política explica como o FAZ Finanças trata as informações que você registra no aplicativo. Ao usar o serviço, você concorda com as práticas descritas aqui.</p>

      <h4>1. Quem trata seus dados</h4>
      <p>O FAZ Finanças é o responsável pelo tratamento dos dados desta aplicação. Os dados completos da empresa responsável (razão social e CNPJ) podem ser solicitados a qualquer momento pelo suporte.</p>

      <h4>2. Quais dados coletamos</h4>
      <ul>
        <li><strong>Cadastro:</strong> e-mail e senha (a senha é armazenada de forma criptografada — nem nós conseguimos lê-la).</li>
        <li><strong>Financeiros:</strong> contas, lançamentos, transferências, recorrências, metas, objetivos e investimentos que você mesmo registra.</li>
        <li><strong>Técnicos:</strong> data e hora de acesso, usadas apenas para a segurança da sua conta.</li>
      </ul>
      <p>Não coletamos dados bancários reais, não acessamos suas contas em instituições financeiras e não realizamos nenhuma transação em seu nome.</p>

      <h4>3. Para que usamos</h4>
      <p>Exclusivamente para prestar o serviço: exibir, calcular e organizar as informações que você insere. <strong>Não vendemos, não alugamos e não compartilhamos seus dados</strong> com terceiros para fins comerciais ou publicitários.</p>

      <h4>4. Como protegemos</h4>
      <ul>
        <li>Comunicação criptografada (HTTPS) entre o seu aparelho e o servidor.</li>
        <li>Criptografia dos dados em trânsito e em repouso.</li>
        <li><strong>Isolamento por usuário (Row Level Security):</strong> cada conta só enxerga os próprios dados — é tecnicamente impossível um usuário acessar os dados de outro.</li>
        <li>Acesso autenticado por token: nenhuma informação é liberada sem a sua sessão válida.</li>
      </ul>

      <h4>5. Onde ficam armazenados</h4>
      <p>Os dados são hospedados na infraestrutura do Supabase, com os mecanismos de criptografia e isolamento descritos acima.</p>

      <h4>6. Seus direitos (art. 18 da LGPD)</h4>
      <ul>
        <li><strong>Acesso e portabilidade:</strong> exporte seus dados quando quiser, em JSON ou CSV.</li>
        <li><strong>Correção:</strong> edite ou exclua qualquer registro dentro do próprio aplicativo.</li>
        <li><strong>Eliminação:</strong> exclua sua conta e todos os dados de forma permanente.</li>
        <li><strong>Informação e revogação:</strong> fale com o suporte pelo e-mail suporte@fazfinancas.com ou pelo Instagram.</li>
      </ul>

      <h4>7. Retenção e exclusão</h4>
      <p>Seus dados permanecem enquanto a conta existir. Ao excluir a conta, todos os dados são apagados de forma permanente e irreversível.</p>

      <h4>8. Alterações</h4>
      <p>Podemos atualizar esta Política para refletir melhorias ou exigências legais. Alterações relevantes serão comunicadas dentro do aplicativo.</p>

      <h4>9. Contato</h4>
      <p>Dúvidas sobre privacidade ou seus dados? Fale com o suporte por e-mail em <a href="mailto:suporte@fazfinancas.com">suporte@fazfinancas.com</a> ou pelo Instagram: <a href="https://www.instagram.com/fazfinancas/" target="_blank" rel="noopener">@fazfinancas</a>.</p>
    `
  },
  assinatura: {
    titulo: "Assinatura",
    corpo: `
      <div class="doc-plano">
        <div class="doc-plano-tag">Plano único</div>
        <div class="doc-plano-nome">R$ 26,90/mês</div>
        <p class="doc-plano-desc">Um plano só, com acesso completo a todas as funcionalidades. Cancele quando quiser.</p>
      </div>

      <h4>O que está incluído</h4>
      <ul>
        <li>Contas, lançamentos e transferências ilimitados</li>
        <li>Contas a pagar e receber, com recorrências</li>
        <li>Assistente de IA financeiro</li>
        <li>Investimentos e simulador de rendimento</li>
        <li>Metas e objetivos de economia</li>
        <li>Importar extrato e exportar relatórios</li>
        <li>Sincronização entre dispositivos</li>
      </ul>

      <h4>Cobrança</h4>
      <p>A cobrança é mensal, no cartão de crédito, com renovação automática. Cancele quando quiser dentro do app — o acesso continua valendo até o fim do período já pago.</p>
    `
  },
  termos: {
    titulo: "Termos de Uso",
    corpo: `
      <p>Estes Termos regem o uso do FAZ Finanças. Ao criar uma conta e usar o aplicativo, você concorda com as regras abaixo.</p>

      <h4>1. O que é o FAZ</h4>
      <p>O FAZ Finanças é uma ferramenta de <strong>organização financeira pessoal</strong>. Ele registra, calcula e organiza as informações que você mesmo insere, ajudando você a enxergar seu dinheiro com clareza.</p>

      <h4>2. O que o FAZ NÃO é</h4>
      <p>Não somos instituição financeira, banco ou corretora. Não oferecemos consultoria de investimentos nem recomendamos produtos financeiros. As projeções e simulações são <strong>estimativas baseadas nos dados que você informa</strong> e não constituem promessa ou garantia de rentabilidade.</p>

      <h4>3. Sua conta</h4>
      <ul>
        <li>Você é responsável por manter sua senha em sigilo.</li>
        <li>Uma conta é de uso pessoal e individual.</li>
        <li>Avise o suporte se suspeitar de acesso não autorizado à sua conta.</li>
      </ul>

      <h4>4. Uso correto</h4>
      <ul>
        <li>Confira a exatidão dos dados que insere — os cálculos dependem deles.</li>
        <li>Não use o serviço para fins ilícitos, fraudulentos ou que violem a lei.</li>
        <li>Não tente burlar, sobrecarregar ou comprometer a segurança do sistema.</li>
      </ul>

      <h4>5. Seus dados são seus</h4>
      <p>As informações que você registra pertencem a você. Você pode exportá-las ou excluí-las a qualquer momento, diretamente no aplicativo.</p>

      <h4>6. Limitação de responsabilidade</h4>
      <p>O serviço é fornecido "no estado em que se encontra". As decisões financeiras que você toma são de sua responsabilidade. Não nos responsabilizamos por perdas decorrentes de decisões tomadas com base nas informações exibidas, nem por dados incorretos inseridos pelo usuário.</p>

      <h4>7. Disponibilidade</h4>
      <p>Trabalhamos para manter o serviço sempre disponível, mas podem ocorrer interrupções por manutenção, atualizações ou falhas de fornecedores externos.</p>

      <h4>8. Encerramento</h4>
      <p>Você pode encerrar sua conta quando quiser. Podemos suspender contas que violem estes Termos ou que representem risco à segurança do serviço.</p>

      <h4>9. Alterações</h4>
      <p>Estes Termos podem ser atualizados. Mudanças relevantes serão comunicadas dentro do aplicativo.</p>

      <h4>10. Contato</h4>
      <p>Dúvidas ou suporte? Fale com a gente por e-mail em <a href="mailto:suporte@fazfinancas.com">suporte@fazfinancas.com</a> ou pelo Instagram: <a href="https://www.instagram.com/fazfinancas/" target="_blank" rel="noopener">@fazfinancas</a>.</p>
    `
  }
};

function abrirDocumento(qual) {
  const doc = DOCUMENTOS[qual];
  if (!doc) return;
  document.getElementById("docTitulo").textContent = doc.titulo;
  document.getElementById("docCorpo").innerHTML = doc.corpo;
  abrirModal("modalDocumento");
}

/* ── Exportação completa (portabilidade) ── */

function baixarArquivo(nome, conteudo, tipo) {
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

/* Exporta TUDO em JSON — é o formato que garante portabilidade real */
function exportarTudoJSON() {
  const dados = {
    _meta: {
      exportadoEm: new Date().toISOString(),
      usuario: state.user?.email || null,
      aviso: "Cópia completa dos seus dados, conforme art. 18 da LGPD."
    },
    contas: state.bancos,
    lancamentos: state.movimentos,
    transferencias: state.transferencias,
    recorrencias: state.recorrencias,
    pagamentosRecorrentes: state.recPagamentos,
    metas: state.metas,
    objetivos: state.objetivos,
    investimentos: state.investimentos,
    notasFiscais: state.notasFiscais,
    contatos: state.contatos
  };
  const nome = `meus-dados-financas-${hojeISO()}.json`;
  baixarArquivo(nome, JSON.stringify(dados, null, 2), "application/json");
  toast("Seus dados foram exportados.", "success");
}

/* Exporta tudo em CSV (um bloco por tipo de dado) */
function exportarTudoCSV() {
  const linhas = [];
  const bloco = (titulo, itens, colunas) => {
    linhas.push(`### ${titulo}`);
    if (!itens.length) { linhas.push("(nenhum registro)", ""); return; }
    linhas.push(colunas.join(";"));
    itens.forEach(it => {
      linhas.push(colunas.map(c => {
        const v = it[c];
        if (v == null) return "";
        return `"${String(v).replace(/"/g, '""')}"`;
      }).join(";"));
    });
    linhas.push("");
  };

  bloco("CONTAS", state.bancos, ["nome","tipo","saldoInicial"]);
  bloco("LANCAMENTOS", state.movimentos, ["data","descricao","valor","tipo","categoria","status","vencimento","pagoEm"]);
  bloco("TRANSFERENCIAS", state.transferencias, ["data","valor","descricao"]);
  bloco("RECORRENCIAS", state.recorrencias, ["descricao","valor","tipo","categoria","frequencia","inicio","fim","ativa"]);
  bloco("METAS", state.metas, ["categoria","limite"]);
  bloco("OBJETIVOS", state.objetivos, ["nome","valorAlvo","valorAtual","prazoData"]);
  bloco("INVESTIMENTOS", state.investimentos, ["tipo","nome","valor","taxa","taxaPeriodo","regime","valorAtual","rendaPassiva"]);
  bloco("NOTAS FISCAIS", state.notasFiscais, ["tipo","numero","valor","data","clienteFornecedor","descricao"]);
  bloco("CLIENTES E FORNECEDORES", state.contatos, ["nome","tipo","documento","telefone","email"]);

  const nome = `meus-dados-financas-${hojeISO()}.csv`;
  baixarArquivo(nome, "\uFEFF" + linhas.join("\n"), "text/csv;charset=utf-8;");
  toast("Seus dados foram exportados.", "success");
}

/* ── Exclusão da conta (direito à eliminação) ── */

async function iniciarExclusaoConta() {
  // Passo 1: alertar sobre a irreversibilidade
  const ok1 = await confirmar("Excluir sua conta?", {
    tipo: "perigo",
    descricao: "Esta ação é permanente e não pode ser desfeita. Serão apagados:",
    lista: [
      `${state.bancos.length} conta(s)`,
      `${state.movimentos.length} lançamento(s)`,
      `${state.investimentos.length} investimento(s)`,
      "Todas as metas, objetivos e recorrências",
    ],
    okLabel: "Excluir conta",
  });
  if (!ok1) return;

  // Passo 2: exigir confirmação por digitação (evita clique acidental)
  const texto = await promptTexto(
    `Para confirmar, digite <strong>EXCLUIR</strong> abaixo:`,
    "EXCLUIR"
  );
  if (texto !== "EXCLUIR") {
    if (texto !== null) toast("Confirmação incorreta. A conta não foi excluída.", "info");
    return;
  }

  mostrarLoading(true);
  try {
    // Apaga os dados e o próprio cadastro (login) via servidor — apagar o
    // usuário do Supabase Auth exige a service_role key, que só existe
    // no backend. Sem isso, o e-mail/senha continuariam válidos.
    const resp = await fetch("/api/excluir-conta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: localStorage.getItem("fp_token") || "" })
    });
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(dados.erro || "Não foi possível excluir a conta agora. Tente novamente em instantes.");
    }

    toast("Sua conta e todos os dados foram excluídos.", "success");
    setTimeout(() => {
      localStorage.clear();
      sessionStorage.clear();
      location.reload();
    }, 2000);

  } catch (err) {
    mostrarLoading(false);
    tratarErro(err);
  }
}

/* Cancelamento de assinatura self-service (Conta > Cancelar assinatura).
   Dois passos: (1) um aviso com a data até quando o acesso continua e um
   lembrete de que dá pra falar com o suporte antes de ir embora — chance
   real de reconsiderar, sem travar quem já decidiu; (2) a confirmação
   final, que só aí cancela de verdade. */
async function cancelarAssinatura() {
  const dataAcesso = state.perfil?.proximaCobranca
    ? new Date(state.perfil.proximaCobranca + "T00:00:00").toLocaleDateString("pt-BR")
    : null;

  // Passo 1: aviso — não cancela nada ainda, só confirma que a pessoa quer seguir.
  const seguir = await confirmar("Antes de cancelar", {
    tipo: "neutro",
    descricao: dataAcesso
      ? `Você continua com acesso completo até <strong>${dataAcesso}</strong>, mesmo cancelando agora — não tem cobrança depois disso.<br><br>Se o motivo for o preço ou alguma dificuldade, manda um e-mail pra <strong>suporte@fazfinancas.com</strong> antes: às vezes dá pra resolver sem precisar cancelar.`
      : `Você continua com acesso completo até o fim do período já pago — não tem cobrança depois disso.<br><br>Se o motivo for o preço ou alguma dificuldade, manda um e-mail pra <strong>suporte@fazfinancas.com</strong> antes: às vezes dá pra resolver sem precisar cancelar.`,
    okLabel: "Quero cancelar mesmo assim",
    cancelLabel: "Voltar",
  });
  if (!seguir) return;

  // Passo 2: confirmação final — só aqui cancela de verdade.
  const ok = await confirmar("Cancelar sua assinatura?", {
    tipo: "perigo",
    descricao: "Isso cancela a renovação automática — a cobrança do próximo mês não vai acontecer. Seus dados continuam salvos normalmente.",
    okLabel: "Cancelar assinatura",
    cancelLabel: "Manter assinatura",
  });
  if (!ok) return;

  mostrarLoading(true);
  try {
    const resp = await fetch("/api/cancelar-assinatura", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: localStorage.getItem("fp_token") || "" })
    });
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(dados.erro || "Não foi possível cancelar agora. Tente novamente em instantes.");
    }

    // Atualiza o estado local na hora — não espera o webhook pra refletir na tela.
    if (state.perfil) state.perfil.assinaturaStatus = "cancelada_fim_ciclo";

    const ateData = dados.acessoAte
      ? new Date(dados.acessoAte + "T00:00:00").toLocaleDateString("pt-BR")
      : dataAcesso;
    toast(
      ateData ? `Assinatura cancelada. Acesso mantido até ${ateData}.` : "Assinatura cancelada. Acesso mantido até o fim do período já pago.",
      "success"
    );
    mostrarLoading(false);
    renderConta();
  } catch (err) {
    mostrarLoading(false);
    tratarErro(err);
  }
}

/* Prompt de texto (para a confirmação de exclusão) */
function promptTexto(msg, esperado) {
  return new Promise(resolve => {
    const ov = document.createElement("div");
    ov.className = "confirm-ov";
    ov.innerHTML = `
      <div class="confirm-box">
        <p class="confirm-msg">${msg}</p>
        <input type="text" class="prompt-input" placeholder="${esperado || ""}" autocomplete="off"
          style="width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:11px 13px;font-size:14px;color:var(--text-primary);outline:none;margin-bottom:22px;" />
        <div class="confirm-btns">
          <button class="btn-ghost prompt-cancel">Cancelar</button>
          <button class="btn-danger prompt-ok">Confirmar exclusão</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add("open"));
    const input = ov.querySelector(".prompt-input");
    input.focus();
    const done = v => { ov.remove(); resolve(v); };
    ov.querySelector(".prompt-ok").onclick = () => done(input.value.trim());
    ov.querySelector(".prompt-cancel").onclick = () => done(null);
    input.addEventListener("keydown", e => { if (e.key === "Enter") done(input.value.trim()); });
    ov.addEventListener("click", e => { if (e.target === ov) done(null); });
  });
}


/* ============================================================
   LANDING PAGE — comportamento
   ============================================================ */

/* ─── Revelação progressiva no scroll ─────────────────────
   Usa IntersectionObserver (nativo, performático).
   Cada elemento aparece uma vez, com um leve atraso em cascata. */
function iniciarRevelacao() {
  const alvos = document.querySelectorAll(".reveal");
  if (!alvos.length) return;

  // Sinaliza que o JS está vivo — só agora o CSS pode esconder os elementos.
  // Se algo quebrar antes daqui, o conteúdo continua visível.
  document.documentElement.classList.add("js-ok");

  // Se a pessoa prefere menos movimento, mostra tudo direto
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    alvos.forEach(el => el.classList.add("visivel"));
    return;
  }

  const obs = new IntersectionObserver((entradas) => {
    entradas.forEach((e, i) => {
      if (!e.isIntersecting) return;
      // Cascata sutil entre elementos que entram juntos
      const atraso = Math.min(i * 70, 280);
      setTimeout(() => e.target.classList.add("visivel"), atraso);
      obs.unobserve(e.target);
    });
  }, {
    threshold: 0.12,
    rootMargin: "0px 0px -60px 0px"   // dispara um pouco antes de entrar
  });

  alvos.forEach(el => obs.observe(el));
}

/* ─── Tilt 3D do celular no hero, seguindo o mouse ─────────
   Ao passar o mouse sobre a área do hero, o celular inclina
   sutilmente em direção ao cursor (efeito de profundidade).
   Some suavemente quando o mouse sai. Ignorado em touch e
   quando a pessoa prefere menos movimento. */
function iniciarTiltHero() {
  const area = document.getElementById("lpHeroFone");
  const fone = document.getElementById("lpFone3d");
  if (!area || !fone) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (window.matchMedia("(pointer: coarse)").matches) return; // sem tilt em touch

  const LIMITE = 10; // graus máximos de inclinação

  area.addEventListener("mousemove", (e) => {
    const r = area.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;  // 0..1
    const py = (e.clientY - r.top) / r.height;  // 0..1
    const rotY = (px - 0.5) * 2 * LIMITE;   // esquerda/direita
    const rotX = (0.5 - py) * 2 * LIMITE;   // cima/baixo
    fone.classList.add("lp-fone-tilt-ativo");
    fone.style.transform = `rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg) scale(1.03)`;
  });

  area.addEventListener("mouseleave", () => {
    fone.classList.remove("lp-fone-tilt-ativo");
    fone.style.transform = "";
  });
}

/* ─── Nav muda ao rolar ───────────────────────────────────── */
function iniciarNavScroll() {
  const nav = document.querySelector(".lp-nav");
  if (!nav) return;
  const aoRolar = () => nav.classList.toggle("scrolled", window.scrollY > 20);
  window.addEventListener("scroll", aoRolar, { passive: true });
  aoRolar();
}

/* ─── Rolagem suave para âncoras ─────────────────────────── */
function rolarPara(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* Seletor Pessoal/Empresarial dos cards de plano na landing — mostra só
   um card por vez, com um brilho (bloom) na entrada do escolhido. */
function selecionarPlanoLanding(tipo) {
  document.querySelectorAll(".plano-selector-opt").forEach(b => {
    const ativo = b.dataset.plano === tipo;
    b.classList.toggle("ativo", ativo);
    b.setAttribute("aria-selected", ativo ? "true" : "false");
  });
  document.querySelectorAll(".lp-planos-grid-selecionavel .lp-assinar-shell").forEach(card => {
    const ativar = card.dataset.plano === tipo;
    card.classList.toggle("ativo", ativar);
    if (ativar) {
      // Remove e força reflow antes de reaplicar, pra reiniciar a
      // animação do brilho mesmo clicando rápido de novo no mesmo botão.
      card.classList.remove("plano-bloom");
      void card.offsetWidth;
      card.classList.add("plano-bloom");
    }
  });
}

/* Toggle Mensal/Anual dos planos na landing */
(function () {
  const toggle = document.getElementById("lpPlanosToggle");
  if (!toggle) return;
  toggle.addEventListener("click", function (e) {
    const btn = e.target.closest(".lp-toggle-opt");
    if (!btn) return;
    const ciclo = btn.dataset.ciclo;
    // Marca o botão ativo
    toggle.querySelectorAll(".lp-toggle-opt").forEach(b => b.classList.remove("ativo"));
    btn.classList.add("ativo");
    // Atualiza todos os valores e notas dos planos
    document.querySelectorAll(".lp-planos-secao [data-mensal]").forEach(el => {
      const val = el.dataset[ciclo];
      if (val !== undefined) el.textContent = val;
    });
  });
})();
document.querySelectorAll('.lp-nav-links a[href^="#"]').forEach(a => {
  a.addEventListener("click", e => {
    e.preventDefault();
    rolarPara(a.getAttribute("href").slice(1));
  });
});

/* ─── SIGNATURE: o painel que se recalcula ─────────────────
   Mostra o produto pensando, em vez de uma ilustração dele.
   Cada cenário é coerente: sobra, saldo, gráfico e alerta contam a mesma história. */
const CENARIOS_DEMO = [
  {
    sobra: 1240, saldo: 6980,
    barras: [38, 52, 44, 66, 58, 74, 90],
    alerta: 'Você já usou <strong>78%</strong> do seu orçamento de Lazer este mês.',
    tom: "amber"
  },
  {
    sobra: 2860, saldo: 8400,
    barras: [44, 58, 50, 70, 64, 80, 96],
    alerta: 'Boa! Você está <strong>R$ 620,00</strong> à frente do mês passado.',
    tom: "teal"
  },
  {
    sobra: 540, saldo: 5120,
    barras: [52, 44, 60, 48, 66, 58, 40],
    alerta: 'Atenção: faltam <strong>R$ 890,00</strong> de contas até dia 20.',
    tom: "amber"
  }
];

const fmtDemo = v => "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* Anima um número de um valor a outro — a sensação de recálculo */
function animarNumero(el, de, para, ms, prefixo = "") {
  if (!el) return;
  const inicio = performance.now();
  const passo = (agora) => {
    const t = Math.min((agora - inicio) / ms, 1);
    // easing: rápido no começo, desacelera (como um cálculo assentando)
    const e = 1 - Math.pow(1 - t, 3);
    const valor = de + (para - de) * e;
    el.textContent = prefixo + fmtDemo(valor);
    if (t < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

let demoIndice = 0;
let demoAtual = { ...CENARIOS_DEMO[0] };
let demoTimer = null;

function trocarCenarioDemo() {
  const proximo = CENARIOS_DEMO[(demoIndice + 1) % CENARIOS_DEMO.length];
  demoIndice = (demoIndice + 1) % CENARIOS_DEMO.length;

  const elSobra  = document.getElementById("demoSobra");
  const elSaldo  = document.getElementById("demoSaldo");
  const elBarras = document.getElementById("demoBarras");
  const elAlerta = document.getElementById("demoAlerta");
  const elStatus = document.getElementById("demoStatus");

  // Número herói (sobra) e o saldo de referência animam juntos
  animarNumero(elSobra, demoAtual.sobra, proximo.sobra, 1000);
  if (elSaldo) elSaldo.textContent = fmtDemo(proximo.saldo);

  // Barras do gráfico sobem/descem de forma coerente
  if (elBarras) {
    const barras = elBarras.children;
    for (let i = 0; i < barras.length; i++) {
      barras[i].style.height = (proximo.barras[i] || 0) + "%";
    }
  }

  // Alerta troca de texto e de tom (teal = positivo, amber = atenção)
  if (elAlerta && elStatus) {
    elAlerta.style.opacity = "0";
    setTimeout(() => {
      elStatus.innerHTML = proximo.alerta;
      elAlerta.classList.toggle("lp-alerta-teal", proximo.tom === "teal");
      elAlerta.style.opacity = "1";
    }, 280);
  }

  demoAtual = { ...proximo };
}

/* ─── Demo do chat no celular da landing ─────────────────────
   Orquestra a conversa passo a passo (mensagem → digitando → resposta),
   deixa tudo montado e PARADO por alguns segundos, depois limpa e recomeça.
   Evita a sobreposição/piscada que acontecia com só CSS. */
const LP_CHAT_ROTEIRO = [
  { tipo: "ia",  texto: 'Olá! Sou o Assistente FAZ. Me conta um gasto que eu registro pra você 👋', hora: "12:40" },
  { tipo: "eu",  texto: 'gastei 200 de gasolina', hora: "12:41" },
  { tipo: "dig" },
  { tipo: "ia",  texto: 'Anotado! <strong>R$ 200,00</strong> em <strong>Transporte</strong>, hoje. Categorizei sozinho ✓', hora: "12:41", notifica: true },
  { tipo: "eu",  texto: 'quanto posso gastar até o fim do mês?', hora: "12:42" },
  { tipo: "dig" },
  { tipo: "ia",  texto: 'Você ainda tem <strong>R$ 1.240,00</strong> de sobra real, já descontando as contas que faltam pagar.', hora: "12:42" },
];

let _lpChatTimers = [];
function lpLimparTimers() { _lpChatTimers.forEach(t => clearTimeout(t)); _lpChatTimers = []; }
function lpEsperar(ms) { return new Promise(r => { const t = setTimeout(r, ms); _lpChatTimers.push(t); }); }

function lpMontarMensagem(item) {
  const div = document.createElement("div");
  div.className = "lp-msg " + (item.tipo === "ia" ? "lp-msg-ia" : "lp-msg-eu");
  let html = "";
  if (item.tipo === "ia") html += '<span class="lp-msg-remetente">Assistente FAZ</span>';
  html += item.texto;
  if (item.tipo === "ia") {
    html += `<span class="lp-msg-hora-ia">${item.hora}</span>`;
  } else {
    html += `<span class="lp-msg-hora">${item.hora} <span class="lp-tique">✓✓</span></span>`;
  }
  div.innerHTML = html;
  return div;
}
function lpMontarDigitando() {
  const div = document.createElement("div");
  div.className = "lp-digitando";
  div.innerHTML = "<span></span><span></span><span></span>";
  return div;
}

async function lpRodarConversa() {
  const corpo = document.getElementById("lpChatCorpo");
  const notif = document.getElementById("lpFoneNotif");
  if (!corpo) return;

  while (true) {
    // Monta passo a passo
    corpo.innerHTML = "";
    corpo.classList.remove("lp-chat-saindo");
    if (notif) notif.classList.remove("aberta");

    for (const item of LP_CHAT_ROTEIRO) {
      if (item.tipo === "dig") {
        const dig = lpMontarDigitando();
        corpo.appendChild(dig);
        await lpEsperar(1300);      // "digitando..." por 1,3s
        dig.remove();               // some quando a resposta chega
      } else {
        const msg = lpMontarMensagem(item);
        corpo.appendChild(msg);
        requestAnimationFrame(() => msg.classList.add("visivel"));

        // Quando o gasto é registrado, a notificação chega, fica e sai
        if (item.notifica && notif) {
          await lpEsperar(400);
          notif.classList.add("aberta");
          // deixa a notificação visível por um tempo e recolhe, sem travar a conversa
          const t = setTimeout(() => notif.classList.remove("aberta"), 3200);
          _lpChatTimers.push(t);
        }

        await lpEsperar(item.tipo === "eu" ? 1200 : 1600);
      }
    }

    // Tudo montado e parado — deixa o usuário ler o final
    await lpEsperar(3800);

    // ── Reset suave: as mensagens somem em cascata (de baixo pra cima) ──
    if (notif) notif.classList.remove("aberta");
    const msgs = Array.from(corpo.querySelectorAll(".lp-msg"));
    for (let i = msgs.length - 1; i >= 0; i--) {
      msgs[i].classList.remove("visivel");
      msgs[i].classList.add("saindo");
      await lpEsperar(120);        // uma sai logo após a outra, suave
    }
    await lpEsperar(500);          // respira antes de recomeçar
  }
}

function iniciarChatDemo() {
  const corpo = document.getElementById("lpChatCorpo");
  if (!corpo) return;
  // Respeita quem prefere menos movimento: monta tudo estático, sem loop
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    corpo.innerHTML = "";
    LP_CHAT_ROTEIRO.filter(i => i.tipo !== "dig").forEach(item => {
      const msg = lpMontarMensagem(item);
      msg.classList.add("visivel");
      corpo.appendChild(msg);
    });
    return;
  }
  // Só anima quando o celular está visível na tela
  const obs = new IntersectionObserver(([e]) => {
    if (e.isIntersecting) { lpLimparTimers(); lpRodarConversa(); }
    else { lpLimparTimers(); }
  }, { threshold: 0.3 });
  obs.observe(corpo);
}

function iniciarPainelDemo() {
  const painel = document.getElementById("painelDemo");
  if (!painel) return;

  const elStatus = document.getElementById("demoStatus");
  if (elStatus) elStatus.style.transition = "opacity 0.28s";

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  // Só anima enquanto o painel está visível — não gasta CPU à toa
  const obs = new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !demoTimer) {
      demoTimer = setInterval(trocarCenarioDemo, 4200);
    } else if (!e.isIntersecting && demoTimer) {
      clearInterval(demoTimer);
      demoTimer = null;
    }
  }, { threshold: 0.35 });

  obs.observe(painel);
}

/* ─── Auth: login/cadastro viram modal sobre a landing ───── */
function abrirAuth(qual) {
  const tela = document.getElementById("telaLogin");
  if (!tela) return;
  tela.style.display = "flex";
  document.body.style.overflow = "hidden";
  mostrarTela(qual === "cadastro" ? "cadastro" : "login");
  // Foco no primeiro campo (acessibilidade)
  setTimeout(() => {
    const campo = qual === "cadastro"
      ? document.getElementById("cadEmail")
      : document.getElementById("loginEmail");
    campo?.focus();
  }, 120);
}

/* Clicou em "Assinar" na landing: abre o cadastro. Plano único agora —
   criar a conta já leva direto pro pagamento (ver o listener do formCadastro). */
function assinarNaLanding() {
  abrirAuth("cadastro");
}

function fecharAuth() {
  const tela = document.getElementById("telaLogin");
  if (!tela) return;
  tela.style.display = "none";
  document.body.style.overflow = "";
}

/* Fecha com Esc */
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && document.getElementById("telaLogin")?.style.display === "flex") {
    fecharAuth();
  }
});

/* Duplica os cards de depoimento para o marquee rolar em loop sem emenda */
function duplicarDepoimentos() {
  const track = document.querySelector(".lp-depo-track");
  if (!track || track.dataset.duplicado) return;
  const originais = Array.from(track.children);
  originais.forEach(card => {
    const clone = card.cloneNode(true);
    clone.setAttribute("aria-hidden", "true");
    track.appendChild(clone);
  });
  track.dataset.duplicado = "1";
}

/* ─── Boot da landing ─────────────────────────────────────── */
function iniciarLanding() {
  iniciarRevelacao();
  iniciarNavScroll();
  iniciarPainelDemo();
  iniciarChatDemo();
  duplicarDepoimentos();
  iniciarTiltHero();
}




/* ============================================================
   TELA DE CONTA (v12)
   ============================================================ */

function renderConta() {
  const email = state.user?.email || "—";

  renderAvatares();

  // E-mail
  const e1 = document.getElementById("userEmail");
  const e2 = document.getElementById("contaEmail");
  if (e1) e1.textContent = email;
  if (e2) e2.textContent = email;

  // Números
  const qc = document.getElementById("contaQtdContas");
  const ql = document.getElementById("contaQtdLancamentos");
  if (qc) qc.textContent = String(state.bancos.length);
  if (ql) ql.textContent = String(state.movimentos.length);

  // Selo do plano na tela de conta
  const seloConta = document.getElementById("contaPlanoSelo");
  const planoValor = document.getElementById("contaPlanoValor");
  const plano = planoAtual();
  const nomePlano = plano === "master" ? "Master" : plano === "premium" ? "Premium" : "Grátis";
  // Atualiza o card grande "Plano atual"
  if (planoValor) planoValor.textContent = nomePlano;
  // O selo abaixo do email só aparece para pagantes (premium/master)
  if (seloConta) {
    if (plano === "master") {
      seloConta.innerHTML = `<span class="selo-plano-usuario selo-plano-master">Master</span>`;
    } else if (plano === "premium") {
      seloConta.innerHTML = `<span class="selo-plano-usuario selo-plano-premium">Premium</span>`;
    } else {
      seloConta.innerHTML = "";
    }
  }

  // Texto da linha "Assinatura" — precisa refletir o plano real
  const assinaturaDesc = document.getElementById("contaAssinaturaDesc");
  if (assinaturaDesc) {
    assinaturaDesc.textContent = (plano === "master" || plano === "premium")
      ? `Você está no plano ${nomePlano}`
      : "Você está no plano gratuito";
  }

  // Linha "Cancelar assinatura" — só aparece pra quem tem assinatura paga
  // ativa de verdade (não pra quem tem acesso de graça por ser anterior ao
  // plano único, nem pra quem já cancelou e está no período final de acesso).
  const linhaCancelar = document.getElementById("contaLinhaCancelar");
  if (linhaCancelar) {
    linhaCancelar.hidden = state.perfil?.assinaturaStatus !== "ativa";
    const cancelarDesc = document.getElementById("contaCancelarDesc");
    if (cancelarDesc && state.perfil?.proximaCobranca) {
      const data = new Date(state.perfil.proximaCobranca + "T00:00:00").toLocaleDateString("pt-BR");
      cancelarDesc.textContent = `Sem multa, sem burocracia — acesso continua até ${data}`;
    }
  }

  // Rótulo do tema
  const tl = document.getElementById("temaLabel");
  const ti = document.getElementById("temaIcone");
  if (tl || ti) {
    const escuro = document.documentElement.getAttribute("data-theme") === "dark";
    if (tl) tl.textContent = escuro ? "Escuro" : "Claro";
    if (ti) ti.innerHTML = escuro ? SVG_SOL : SVG_LUA;
  }
}

/* Envia o link de troca de senha para o e-mail do usuário */
async function pedirTrocaSenha() {
  const email = state.user?.email;
  if (!email) return;

  const ok = await confirmar("Redefinir senha?", {
    tipo: "neutro",
    descricao: `Enviaremos um link de redefinição para <strong>${esc(email)}</strong>.`,
    okLabel: "Enviar link",
  });
  if (!ok) return;

  mostrarLoading(true);
  try {
    await sbEnviarResetSenha(email);
    toast("Link enviado! Confira seu e-mail (e o spam).", "success");
  } catch(err) {
    tratarErro(err);
  } finally { mostrarLoading(false); }
}


/* ============================================================
   AVATAR DO PERFIL (v13)
   Três modos: inicial do e-mail (padrão), avatar da galeria,
   ou foto enviada pelo usuário.
   ============================================================ */

/* A galeria. Os arquivos ficam em /avatars/<id>.png */
const AVATARES = [
  { id: "macaco",   nome: "Macaco"   },
  { id: "cachorro", nome: "Cachorro" },
  { id: "girafa",   nome: "Girafa"   },
  { id: "cavalo",   nome: "Cavalo"   },
  { id: "pinguim",  nome: "Pinguim"  },
];

const TAM_MAX_AVATAR = 2 * 1024 * 1024;   // 2 MB

/* Seleção temporária dentro do modal (só vira definitiva ao salvar) */
let _avatarEscolhido = null;   // { tipo:'padrao'|'upload'|'inicial', valor, arquivo? }

/* ─── Renderização ───────────────────────────────────────── */

/* Monta o conteúdo de um avatar (usado na sidebar, na conta e na prévia) */
function pintarAvatar(el, perfil, inicial) {
  if (!el) return;
  const p = perfil || state.perfil || {};

  if (p.avatarTipo === "upload" && p.avatarUrl) {
    el.innerHTML = `<img src="${esc(p.avatarUrl)}" alt="" onerror="this.remove()" />`;
    el.classList.add("tem-imagem");
  } else if (p.avatarTipo === "padrao" && p.avatarPadrao) {
    el.innerHTML = `<img src="avatars/${esc(p.avatarPadrao)}.png" alt="" onerror="this.remove()" />`;
    el.classList.add("tem-imagem");
  } else {
    el.textContent = inicial;
    el.classList.remove("tem-imagem");
  }
}

function renderAvatares() {
  const email = state.user?.email || "";
  const inicial = email ? email[0].toUpperCase() : "—";
  pintarAvatar(document.getElementById("perfilAvatar"), null, inicial);
  pintarAvatar(document.getElementById("contaAvatar"), null, inicial);
}

/* ─── Modal ──────────────────────────────────────────────── */

function abrirSeletorAvatar() {
  // Começa com o que já está salvo
  const p = state.perfil || {};
  _avatarEscolhido = {
    tipo: p.avatarTipo || "inicial",
    valor: p.avatarTipo === "padrao" ? p.avatarPadrao : p.avatarUrl,
    arquivo: null
  };

  montarGaleria();
  atualizarPreviaAvatar();
  abrirModal("modalAvatar");
}

function montarGaleria() {
  const g = document.getElementById("avatarGaleria");
  if (!g) return;
  g.innerHTML = AVATARES.map(a => `
    <button type="button" class="avatar-opcao" data-id="${a.id}" onclick="escolherAvatarPadrao('${a.id}')" title="${a.nome}">
      <img src="avatars/${a.id}.png" alt="${a.nome}" onerror="this.parentElement.classList.add('sem-imagem')" />
    </button>
  `).join("");
  marcarSelecionado();
}

function marcarSelecionado() {
  document.querySelectorAll(".avatar-opcao").forEach(b => {
    const ativo = _avatarEscolhido?.tipo === "padrao" && b.dataset.id === _avatarEscolhido.valor;
    b.classList.toggle("ativo", ativo);
  });
}

function escolherAvatarPadrao(id) {
  _avatarEscolhido = { tipo: "padrao", valor: id, arquivo: null };
  marcarSelecionado();
  atualizarPreviaAvatar();
}

function usarAvatarInicial() {
  _avatarEscolhido = { tipo: "inicial", valor: null, arquivo: null };
  marcarSelecionado();
  atualizarPreviaAvatar();
}

/* Prévia dentro do modal */
function atualizarPreviaAvatar() {
  const el = document.getElementById("avatarPreview");
  if (!el) return;
  const email = state.user?.email || "";
  const inicial = email ? email[0].toUpperCase() : "—";

  const e = _avatarEscolhido;
  if (e?.tipo === "upload" && e.valor) {
    el.innerHTML = `<img src="${e.valor}" alt="" />`;
    el.classList.add("tem-imagem");
  } else if (e?.tipo === "padrao" && e.valor) {
    el.innerHTML = `<img src="avatars/${esc(e.valor)}.png" alt="" onerror="this.remove()" />`;
    el.classList.add("tem-imagem");
  } else {
    el.textContent = inicial;
    el.classList.remove("tem-imagem");
  }
}

/* ─── Upload ─────────────────────────────────────────────── */

document.getElementById("avatarArquivo")?.addEventListener("change", e => {
  const arq = e.target.files?.[0];
  if (!arq) return;

  if (!/^image\/(png|jpeg|jpg|webp)$/.test(arq.type)) {
    toast("Formato não aceito. Use PNG, JPG ou WEBP.", "error");
    e.target.value = "";
    return;
  }
  if (arq.size > TAM_MAX_AVATAR) {
    toast(`Imagem muito grande (${(arq.size/1024/1024).toFixed(1)} MB). O limite é 2 MB.`, "error");
    e.target.value = "";
    return;
  }

  // Prévia local imediata (sem subir ainda)
  const url = URL.createObjectURL(arq);
  _avatarEscolhido = { tipo: "upload", valor: url, arquivo: arq };
  marcarSelecionado();
  atualizarPreviaAvatar();
});

/* Envia o arquivo para o Supabase Storage */
async function subirAvatar(arquivo) {
  const ext = (arquivo.name.split(".").pop() || "png").toLowerCase();
  const caminho = `${state.user.id}/avatar.${ext}`;

  const res = await fetchSeguro(
    `${SUPABASE_URL}/storage/v1/object/avatars/${caminho}`,
    {
      method: "POST",
      headers: {
        ...getAuthHeader(),
        "apikey": SUPABASE_KEY,
        "Content-Type": arquivo.type,
        "x-upsert": "true"          // substitui se já existir
      },
      body: arquivo
    }
  );
  await res.json().catch(()=>({}));

  // URL pública (com timestamp para furar o cache do navegador)
  return `${SUPABASE_URL}/storage/v1/object/public/avatars/${caminho}?v=${Date.now()}`;
}

/* ─── Salvar ─────────────────────────────────────────────── */

async function salvarAvatar() {
  const e = _avatarEscolhido;
  if (!e) { fecharModal("modalAvatar"); return; }

  mostrarLoading(true, "Salvando sua foto", "Só um instante...");
  try {
    let dados;

    if (e.tipo === "upload" && e.arquivo) {
      const url = await subirAvatar(e.arquivo);
      dados = { avatar_tipo: "upload", avatar_url: url, avatar_padrao: null };
    } else if (e.tipo === "padrao") {
      dados = { avatar_tipo: "padrao", avatar_padrao: e.valor, avatar_url: null };
    } else {
      dados = { avatar_tipo: "inicial", avatar_padrao: null, avatar_url: null };
    }

    const salvo = await salvarPerfil(dados);
    state.perfil = mapPerfil(salvo);

    renderAvatares();
    fecharModal("modalAvatar");
    toast("Foto de perfil atualizada!", "success");

  } catch(err) {
    tratarErro(err);
  } finally { mostrarLoading(false); }
}

/* Cria ou atualiza a linha de perfil (upsert) */
async function salvarPerfil(dados) {
  const res = await fetchSeguro(`${SUPABASE_URL}/rest/v1/perfil`, {
    method: "POST",
    headers: {
      ..._h,
      ...getAuthHeader(),
      "Prefer": "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify({
      user_id: state.user.id,
      email: state.user?.email || null,
      ...dados,
      atualizado_em: new Date().toISOString()
    })
  });
  const rows = await res.json();
  return rows[0];
}

function mapPerfil(p) {
  if (!p) return { avatarTipo: "inicial", avatarPadrao: null, avatarUrl: null, nome: null, plano: "basico", assinaturaStatus: "inativa", atrasoDesde: null, empresarial: false, empresaCnpj: "", empresaRazaoSocial: "", empresaNomeFantasia: "" };
  return {
    avatarTipo:   p.avatar_tipo   || "inicial",
    avatarPadrao: p.avatar_padrao || null,
    avatarUrl:    p.avatar_url    || null,
    nome:         p.nome          || null,
    plano:            p.plano              || "basico",
    assinaturaStatus: p.assinatura_status  || "inativa",
    atrasoDesde:      p.atraso_desde       || null,
    planoAnterior:    p.plano_anterior     || null,
    proximaCobranca:  p.proxima_cobranca   || null,
    // Empresarial é um plano à parte (R$ 41,90/mês) — este selo diz se a
    // pessoa pagou por ele. Não tem nada a ver com podeUsar()/planoAtual():
    // o nível de acesso (premium) é o mesmo; só libera o espaço extra.
    empresarial:      !!p.empresarial,
    // Dados da empresa (opcionais) — só aparecem no espaço Empresarial.
    empresaCnpj:          p.empresa_cnpj          || "",
    empresaRazaoSocial:   p.empresa_razao_social  || "",
    empresaNomeFantasia:  p.empresa_nome_fantasia || ""
  };
}

/* ============================================================
   PLANOS E LIMITES (feature-gating)
   Lê o plano do usuário (de state.perfil) e diz o que ele pode.
   ============================================================ */

/* Limites de cada plano. Desde a virada pro plano único, não existe mais
   conta grátis: "basico" (sem assinatura ativa) não libera nada — nem
   contas nem metas. "premium" é o único plano à venda hoje (R$ 26,90/mês,
   ou R$ 20,90/mês com o cupom ORGANIZACAO — ver CUPONS_PREVIA e
   api/criar-checkout.js); "master" continua valendo do mesmo jeito só
   porque ainda existem assinantes antigos com esse valor gravado no
   perfil — não precisou migrar ninguém no banco, os dois viram o mesmo
   acesso aqui. */
const LIMITES_PLANO = {
  basico:  { contas: 0,        metas: 0,        investimentos: false, recorrencias: false, relatorios: false, exportar: false, ia: false, importarExtrato: false, conectarBanco: false },
  premium: { contas: Infinity, metas: Infinity, investimentos: true,  recorrencias: true,  relatorios: true,  exportar: true,  ia: true,  importarExtrato: true,  conectarBanco: true },
  master:  { contas: Infinity, metas: Infinity, investimentos: true,  recorrencias: true,  relatorios: true,  exportar: true,  ia: true,  importarExtrato: true,  conectarBanco: true }
};

/* Retorna o plano ATIVO do usuário. Só vale premium/master se a assinatura estiver ativa. */
/* Dias de tolerância após o vencimento antes de cortar o acesso.
   Precisa bater com o DIAS_TOLERANCIA do webhook. */
const DIAS_TOLERANCIA_PLANO = 5;

/* Data/hora em que o plano único (sem conta grátis) entrou em vigor.
   Quem já tinha conta ANTES disso é "da casa": mantém acesso completo de
   graça, sem precisar assinar — foi o combinado ao tirar o plano Básico
   do ar. Ninguém que já usava de graça perde acesso do dia pra noite.
   Não precisa mexer no banco pra isso: compara com a data de criação da
   conta no Supabase Auth (state.user.createdAt), guardada no login. */
const CORTE_PLANO_UNICO = "2026-08-13T17:50:58Z";
function usuarioAnteriorAoPlanoUnico() {
  const criada = state.user?.createdAt;
  if (!criada) return false;   // sem a data (ex: sessão antiga sem cache) -> não arrisca, trata como novo
  return new Date(criada).getTime() < new Date(CORTE_PLANO_UNICO).getTime();
}

/* Retorna o plano ATIVO do usuário.
   "ativa"    -> acesso liberado
   "atrasada" -> acesso mantido durante a tolerância, depois cai
   qualquer outro -> básico (sem acesso — precisa assinar) */
function planoAtual() {
  // Usuário de antes do plano único: acesso completo garantido, sempre.
  if (usuarioAnteriorAoPlanoUnico()) return "premium";

  const p = state.perfil || {};
  const status = p.assinaturaStatus || "inativa";
  const plano  = p.plano || "basico";
  const ehPago = (plano === "premium" || plano === "master");

  if (status === "ativa") return ehPago ? plano : "basico";

  // Atrasada: o cartão falhou, mas o Asaas ainda vai tentar de novo.
  // Mantemos o acesso durante a tolerância em vez de cortar na hora.
  if (status === "atrasada" && ehPago) {
    if (!p.atrasoDesde) return plano;   // sem data: dá o benefício da dúvida
    if (dentroDaTolerancia()) return plano;
  }

  // Cancelada mas dentro do mês pago: o cliente pediu para não renovar, porém
  // pagou o ciclo atual. Mantém o acesso até a data da próxima cobrança que
  // não vai mais acontecer. Passou dessa data, cai para básico.
  if (status === "cancelada_fim_ciclo" && ehPago) {
    const ate = p.proximaCobranca;
    if (!ate) return plano;   // sem data guardada: mantém o acesso por segurança
    const aindaVale = new Date(hojeISO() + "T00:00:00") < new Date(ate + "T00:00:00");
    if (aindaVale) return plano;
  }

  // cancelada_falta_pagamento, inativa e qualquer outro: sem acesso — precisa assinar
  return "basico";
}

/* Diagnóstico do gráfico de evolução — rode verGrafico() no Console.
   Mostra por que a linha pode estar reta. */
function verGrafico() {
  const movs = state.movimentos || [];
  const contasIds = new Set(state.bancos.map(b => b.id));
  const info = {
    "total de movimentos": movs.length,
    "movimentos pagos": movs.filter(m => (m.status||"pago")==="pago").length,
    "contas cadastradas": state.bancos.length,
  };
  const datas = movs.map(m => m.data).filter(Boolean).sort();
  info["data mais antiga"] = datas[0] || "(nenhuma)";
  info["data mais recente"] = datas[datas.length-1] || "(nenhuma)";
  const semData = movs.filter(m => !m.data).length;
  const semConta = movs.filter(m => !contasIds.has(m.bancoId)).length;
  const credito = movs.filter(m => m.formaPagamento === "credito").length;
  info["SEM data (invisiveis no grafico)"] = semData;
  info["com conta INEXISTENTE (invisiveis no saldo)"] = semConta;
  info["no credito (nao afetam saldo)"] = credito;
  console.table(info);

  // Mostra a data de saldo de cada conta — se for recente, ela ignora
  // movimentos antigos e deixa a linha do gráfico reta.
  console.log("Contas e suas datas de saldo:");
  console.table(state.bancos.map(b => ({
    conta: b.nome,
    saldoInicial: b.saldoInicial,
    "saldo_data (ignora movs. antes disto)": b.saldoData || "(sem data — conta tudo)"
  })));

  // Diagnóstico automático: movimentos ignorados pela data de saldo
  let ignoradosPorData = 0;
  const desde = {};
  state.bancos.forEach(b => desde[b.id] = b.saldoData || null);
  movs.forEach(m => {
    if (m.data && desde[m.bancoId] && m.data < desde[m.bancoId]) ignoradosPorData++;
  });
  if (ignoradosPorData > 0) {
    console.warn(`⚠️ ${ignoradosPorData} movimento(s) são anteriores à data de saldo da conta e por isso NÃO entram no gráfico. Se quiser que contem, ajuste a data de saldo da conta para antes deles (ou remova a data de saldo).`);
  }

  if (semConta) {
    console.warn("Movimentos com conta que nao existe mais:");
    console.table(movs.filter(m => !contasIds.has(m.bancoId)).map(m => ({
      data: m.data, descricao: m.descricao, valor: m.valor, bancoId: m.bancoId
    })));
  }
  return info;
}

/* Diagnóstico do plano — rode verPlano() no Console para ver o estado real.
   Útil para entender por que o acesso está (ou não está) liberado. */
function verPlano() {
  const p = state.perfil || {};
  const dias = diasDeAtraso();
  const info = {
    "plano contratado": p.plano || "(nenhum)",
    "status da assinatura": p.assinaturaStatus || "(nenhum)",
    "atraso desde": p.atrasoDesde || "(sem atraso)",
    "dias de atraso": dias === null ? "—" : dias,
    "tolerância": DIAS_TOLERANCIA_PLANO + " dias",
    "protegido pela tolerância": dias === null ? "—" : (dentroDaTolerancia() ? "SIM" : "NÃO"),
    "dias até o corte": diasAteCortePlano() ?? "—",
    "plano anterior": p.planoAnterior || "—",
    "ACESSO ATUAL": planoAtual(),
    "hoje": hojeISO()
  };
  console.table(info);
  return info;
}

/* Dias corridos desde o início do atraso. Null se não há atraso. */
function diasDeAtraso() {
  const p = state.perfil || {};
  if (p.assinaturaStatus !== "atrasada" || !p.atrasoDesde) return null;
  return Math.floor(
    (new Date(hojeISO() + "T00:00:00") - new Date(p.atrasoDesde + "T00:00:00")) / 86400000
  );
}

/* A tolerância ainda protege o acesso?
   É a ÚNICA fonte da decisão — o acesso e o aviso leem daqui, para
   não acontecer de a tela dizer "cancelado" com o plano ainda ativo. */
function dentroDaTolerancia() {
  const dias = diasDeAtraso();
  if (dias === null) return false;
  return dias < DIAS_TOLERANCIA_PLANO;
}

/* Quantos dias faltam para o acesso cair. Null se não há atraso. */
function diasAteCortePlano() {
  const dias = diasDeAtraso();
  if (dias === null) return null;
  return Math.max(0, DIAS_TOLERANCIA_PLANO - dias);
}

/* Pega os limites do plano ativo */
function limitesAtuais() {
  return LIMITES_PLANO[planoAtual()] || LIMITES_PLANO.basico;
}

/* Diz se o usuário é pagante (premium ou master ativo) */
function ehPremium() {
  return planoAtual() !== "basico";
}

/* Verifica se pode usar um recurso premium (investimentos, recorrencias, etc.) */
function podeUsar(recurso) {
  const lim = limitesAtuais();
  return lim[recurso] === true || lim[recurso] === Infinity;
}

/* Leva para a tela de planos explicando o que o usuário tentou fazer.
   Sem modal intermediário: quem quer o recurso já cai onde decide. */
function irParaPlanos(titulo, msg) {
  _motivoUpgrade = { titulo: titulo || "Recurso dos planos pagos", msg: msg || "" };
  trocarTela("planos");
  renderMotivoUpgrade();
  // Chama atenção para o motivo sem depender de scroll
  setTimeout(() => {
    document.getElementById("planosMotivo")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, 80);
}


/* Mostra (ou esconde) a faixa que explica por que o usuário veio parar aqui */
function renderMotivoUpgrade() {
  const el = document.getElementById("planosMotivo");
  if (!el) return;
  if (!_motivoUpgrade) { el.hidden = true; el.innerHTML = ""; return; }

  el.innerHTML = `
    <span class="planos-motivo-icone">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    </span>
    <span class="planos-motivo-txt">
      <strong>${esc(_motivoUpgrade.titulo)}</strong>
      ${_motivoUpgrade.msg ? `<span>${esc(_motivoUpgrade.msg)}</span>` : ""}
    </span>
    <button type="button" class="planos-motivo-fechar" onclick="limparMotivoUpgrade()" aria-label="Fechar">✕</button>
  `;
  el.hidden = false;
}

function limparMotivoUpgrade() {
  _motivoUpgrade = null;
  renderMotivoUpgrade();
}

/* Mantida por compatibilidade: agora só encaminha para os planos.
   Devolve uma Promise que resolve na hora, para não travar quem usava await. */
function pedirUpgrade(msg, titulo) {
  irParaPlanos(titulo, msg);
  return Promise.resolve(false);
}

/* Recursos premium que bloqueiam a seção inteira quando o usuário é básico.
   Mapeia o nome da tela -> dados do bloqueio. */
const SECOES_PREMIUM = {
  investimentos: {
    recurso: "investimentos",
    titulo: "Investimentos",
    desc: "Este recurso é exclusivo de quem assina o FAZ Finanças."
  },
  recorrencias: {
    recurso: "recorrencias",
    titulo: "Contas recorrentes",
    desc: "Este recurso é exclusivo de quem assina o FAZ Finanças."
  }
};

/* Monta (ou remove) o cadeado de bloqueio numa seção premium.
   Se o usuário pode usar o recurso, remove o bloqueio e mostra o conteúdo.
   Se não pode, cobre a seção com o cadeado. */
/* Coloca ou remove o cadeado nos itens de menu de seções premium.
   Chamada quando o perfil carrega e quando o plano muda. */
function atualizarCadeadosMenu() {
  Object.keys(SECOES_PREMIUM).forEach(name => {
    const info = SECOES_PREMIUM[name];
    const bloqueado = !podeUsar(info.recurso);
    // Pega todos os botões de menu (sidebar e bottom nav) dessa seção
    document.querySelectorAll(`[data-screen="${name}"]`).forEach(item => {
      let cadeado = item.querySelector(".menu-cadeado");
      if (bloqueado) {
        if (!cadeado) {
          cadeado = document.createElement("span");
          cadeado.className = "menu-cadeado";
          cadeado.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
          item.appendChild(cadeado);
        }
        item.classList.add("menu-item-bloqueado");
      } else {
        if (cadeado) cadeado.remove();
        item.classList.remove("menu-item-bloqueado");
      }
    });
  });
  atualizarSeloPlano();
  atualizarSeletorContexto();
}

/* Mostra um selo colorido com o nome do plano (Premium/Master) na sidebar.
   Básico não mostra selo. */
function atualizarSeloPlano() {
  const plano = planoAtual();  // basico | premium | master
  const infoBtn = document.querySelector(".perfil-btn .perfil-info");
  if (!infoBtn) return;

  let selo = infoBtn.querySelector(".selo-plano-usuario");
  // Básico: sem selo
  if (plano === "basico") {
    if (selo) selo.remove();
    return;
  }
  // Premium ou Master: cria/atualiza o selo
  if (!selo) {
    selo = document.createElement("span");
    selo.className = "selo-plano-usuario";
    // Insere logo após o email
    const acao = infoBtn.querySelector(".perfil-acao");
    infoBtn.insertBefore(selo, acao);
  }
  selo.classList.toggle("selo-plano-master", plano === "master");
  selo.classList.toggle("selo-plano-premium", plano === "premium");
  selo.textContent = plano === "master" ? "Master" : "Premium";
}

/* ============================================================
   PESSOAL x EMPRESARIAL (espaços separados)
   Alterna qual "contexto" está ativo. Tudo que o usuário cadastra fica
   marcado com esse contexto (ver TABELAS_COM_CONTEXTO / dbInsert) e só
   aparece de volta quando o mesmo contexto estiver ativo — Pessoal e
   Empresarial nunca se misturam.
   Empresarial é um plano à parte (R$ 41,90/mês): sem ele, o botão leva
   para o upsell em vez de trocar de espaço.
   ============================================================ */

/* Troca de espaço financeiro e recarrega os dados já filtrados para ele. */
async function alternarContexto(ctx) {
  if (ctx !== "pessoal" && ctx !== "empresarial") return;
  if (ctx === state.contextoAtivo) return;

  if (ctx === "empresarial" && !state.perfil?.empresarial) {
    irParaPlanos(
      "Espaço Empresarial",
      "Separe as finanças da sua empresa das suas finanças pessoais — assine o plano Empresarial (R$ 41,90/mês) para liberar."
    );
    return;
  }

  state.contextoAtivo = ctx;
  try { localStorage.setItem("fp_contexto", ctx); } catch (e) {}

  atualizarSeletorContexto();
  await carregarDadosNuvem();
  renderTudo();
  trocarTela("dashboard");
}

/* Pinta o seletor Pessoal/Empresarial no topo do menu (sidebar e gaveta
   mobile reaproveitam o mesmo HTML) de acordo com o contexto ativo e se
   o plano Empresarial está liberado. */
function atualizarSeletorContexto() {
  // O espaço que NÃO está ativo agora — só ele pode mostrar a bolinha de
  // aviso (o espaço ativo já tem seus avisos no sino, não precisa duplicar).
  const outro = state.contextoAtivo === "empresarial" ? "pessoal" : "empresarial";

  document.querySelectorAll(".contexto-btn").forEach(btn => {
    const ctx = btn.dataset.contexto;
    btn.classList.toggle("active", ctx === state.contextoAtivo);
    const bloqueado = ctx === "empresarial" && !state.perfil?.empresarial;
    btn.classList.toggle("contexto-btn-bloqueado", bloqueado);
    let cadeado = btn.querySelector(".contexto-cadeado");
    if (bloqueado) {
      if (!cadeado) {
        cadeado = document.createElement("span");
        cadeado.className = "contexto-cadeado";
        cadeado.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
        btn.appendChild(cadeado);
      }
    } else if (cadeado) {
      cadeado.remove();
    }

    // Bolinha de aviso: só no botão do espaço que não está ativo agora, e
    // só quando esse espaço tem algo vencido/vencendo (calculado em
    // carregarDadosNuvem() → haCompromissoPendente(), guardado em
    // state.avisoOutroContexto). Some junto com o cadeado se o Empresarial
    // estiver bloqueado — não faz sentido avisar de algo que a pessoa
    // ainda não pode ver.
    const temAviso = ctx === outro && !bloqueado && !!state.avisoOutroContexto;
    let bolinha = btn.querySelector(".contexto-aviso-dot");
    if (temAviso) {
      if (!bolinha) {
        bolinha = document.createElement("span");
        bolinha.className = "contexto-aviso-dot";
        bolinha.title = `Tem algo vencido ou vencendo no espaço ${ctx === "empresarial" ? "Empresarial" : "Pessoal"}`;
        btn.appendChild(bolinha);
      }
    } else if (bolinha) {
      bolinha.remove();
    }
  });

  // Itens que só existem no espaço Empresarial (menu "Notas Fiscais",
  // grupo "Dados da empresa" na tela de Conta) — escondidos no Pessoal.
  const empresarial = state.contextoAtivo === "empresarial";
  document.querySelectorAll(".menu-item-empresarial").forEach(el => { el.hidden = !empresarial; });
  const grupoEmpresa = document.getElementById("contaGrupoEmpresa");
  if (grupoEmpresa) {
    grupoEmpresa.hidden = !empresarial;
    if (empresarial) {
      const cnpj = document.getElementById("empresaCnpj");
      const razao = document.getElementById("empresaRazaoSocial");
      const fantasia = document.getElementById("empresaNomeFantasia");
      if (cnpj && document.activeElement !== cnpj) cnpj.value = state.perfil?.empresaCnpj || "";
      if (razao && document.activeElement !== razao) razao.value = state.perfil?.empresaRazaoSocial || "";
      if (fantasia && document.activeElement !== fantasia) fantasia.value = state.perfil?.empresaNomeFantasia || "";
    }
  }
}

/* ============================================================
   ESTADOS VAZIOS (v14)
   Um painel vazio dizendo "não tem nada" é espaço desperdiçado.
   Ele deve dizer o que fazer — e permitir fazer ali mesmo.
   ============================================================ */

/* Monta um estado vazio com ação */
function vazio(icone, titulo, desc, acao) {
  return `<div class="vazio">
    <div class="vazio-icone">${icone}</div>
    <div class="vazio-titulo">${titulo}</div>
    ${desc ? `<div class="vazio-desc">${desc}</div>` : ""}
    ${acao ? `<button class="vazio-btn" onclick="${acao.onclick}">${acao.texto}</button>` : ""}
  </div>`;
}

const ICO = {
  conta: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  lista: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
  grafico: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/></svg>`,
  alvo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>`,
  cofre: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="8" x2="12" y2="9"/></svg>`,
  repetir: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="23 4 23 10 17 10"/><path d="M20.5 15a9 9 0 1 1-2.1-9.4L23 10"/></svg>`,
};

/* Atalhos de navegação usados pelos botões */
function irParaContas()       { trocarTela("contas"); }




/* ============================================================
   IDENTIDADE VISUAL DAS CONTAS (v16, marcas reais desde v52)
   Por padrão, cada conta ganha uma cor derivada do nome + a inicial
   (função de sempre, ver corDoNome/marcaConta). Quem quiser, pode
   escolher a marca de um banco/corretora conhecido no seletor do
   formulário — pra um grupo pequeno (Nubank, Itaú, BB, Bradesco,
   Santander, Caixa, Inter, Binance) usamos o logo oficial de verdade
   (arquivos em /logos, baixados do Wikimedia Commons); pro resto do
   catálogo (fintechs, corretoras, exchanges), um selo colorido com a
   sigla — não é o logo oficial, só uma referência visual reconhecível.
   Nada disso é obrigatório: o padrão automático (cor + inicial) nunca
   muda pra quem não mexer no seletor.
   ============================================================ */

/* Catálogo de instituições conhecidas. `logo` = arquivo de logo oficial
   real (só pros bancos/exchanges mais usados); sem `logo`, cai no selo
   colorido com `sigla`. `aliases` é usado pra sugerir a marca sozinha
   conforme o nome digitado no formulário (ver detectarBancoPorNome). */
const BANCOS_CATALOGO = [
  // ── Com logo oficial real ──
  { id: "nubank",    nome: "Nubank",              logo: "logos/nubank.svg",    cor: "#820AD1", sigla: "NU", aliases: ["nubank", "nu"] },
  { id: "itau",      nome: "Itaú",                logo: "logos/itau.svg",      cor: "#EC7000", sigla: "IT", aliases: ["itau"] },
  { id: "bb",        nome: "Banco do Brasil",     logo: "logos/bb.svg",        cor: "#FFEF38", sigla: "BB", aliases: ["banco do brasil", "bb"] },
  { id: "bradesco",  nome: "Bradesco",            logo: "logos/bradesco.svg",  cor: "#CC092F", sigla: "BR", aliases: ["bradesco"] },
  { id: "santander", nome: "Santander",           logo: "logos/santander.svg", cor: "#EC0000", sigla: "SA", aliases: ["santander"] },
  { id: "caixa",     nome: "Caixa",               logo: "logos/caixa.svg",     cor: "#0033A0", sigla: "CX", aliases: ["caixa", "caixa economica", "caixa economica federal", "cef"] },
  { id: "inter",     nome: "Banco Inter",         logo: "logos/inter.svg",     cor: "#FF7A00", sigla: "IN", aliases: ["inter", "banco inter"] },
  { id: "binance",   nome: "Binance",             logo: "logos/binance.svg",   cor: "#F0B90B", sigla: "BN", aliases: ["binance"] },
  // ── Selo colorido (sem logo oficial) ──
  { id: "c6",        nome: "C6 Bank",             cor: "#000000", sigla: "C6", aliases: ["c6", "c6 bank"] },
  { id: "picpay",    nome: "PicPay",              cor: "#21C25E", sigla: "PP", aliases: ["picpay"] },
  { id: "mercadopago", nome: "Mercado Pago",      cor: "#009EE3", sigla: "MP", aliases: ["mercado pago", "mercadopago"] },
  { id: "neon",      nome: "Neon",                cor: "#00A8E3", sigla: "NE", aliases: ["neon"] },
  { id: "next",      nome: "Next",                cor: "#00FF6B", sigla: "NX", aliases: ["next"] },
  { id: "btg",       nome: "BTG Pactual",         cor: "#001E62", sigla: "BP", aliases: ["btg", "btg pactual"] },
  { id: "original",  nome: "Banco Original",      cor: "#7A1FA2", sigla: "OR", aliases: ["original", "banco original"] },
  { id: "sicoob",    nome: "Sicoob",              cor: "#00A651", sigla: "SB", aliases: ["sicoob"] },
  { id: "sicredi",   nome: "Sicredi",             cor: "#7DB61C", sigla: "SD", aliases: ["sicredi"] },
  { id: "safra",     nome: "Banco Safra",         cor: "#003057", sigla: "SF", aliases: ["safra", "banco safra"] },
  { id: "xp",        nome: "XP Investimentos",    cor: "#000000", sigla: "XP", aliases: ["xp", "xp investimentos"] },
  { id: "will",      nome: "Will Bank",           cor: "#FFD200", sigla: "WB", aliases: ["will", "will bank"] },
  { id: "pagbank",   nome: "PagBank",             cor: "#65A300", sigla: "PB", aliases: ["pagbank", "pagseguro"] },
  { id: "pan",       nome: "Banco Pan",           cor: "#00953B", sigla: "PN", aliases: ["pan", "banco pan"] },
  { id: "digio",     nome: "Digio",               cor: "#C4007A", sigla: "DG", aliases: ["digio"] },
  { id: "nomad",     nome: "Nomad",               cor: "#6C4CE3", sigla: "NO", aliases: ["nomad"] },
  { id: "wise",      nome: "Wise",                cor: "#9FE870", sigla: "WI", aliases: ["wise"] },
  { id: "coinbase",  nome: "Coinbase",            cor: "#0052FF", sigla: "CB", aliases: ["coinbase"] },
  { id: "foxbit",    nome: "Foxbit",              cor: "#FF6A00", sigla: "FX", aliases: ["foxbit"] },
  { id: "mercadobitcoin", nome: "Mercado Bitcoin", cor: "#F7931A", sigla: "MB", aliases: ["mercado bitcoin", "mercadobitcoin"] },
  { id: "bitso",     nome: "Bitso",               cor: "#00C298", sigla: "BT", aliases: ["bitso"] },
  { id: "rico",      nome: "Rico Investimentos",  cor: "#00D563", sigla: "RI", aliases: ["rico", "rico investimentos"] },
  { id: "clear",     nome: "Clear Corretora",     cor: "#000000", sigla: "CL", aliases: ["clear", "clear corretora"] },
  { id: "99pay",     nome: "99Pay",               cor: "#FFD400", sigla: "99", aliases: ["99pay", "99"] },
  { id: "ame",       nome: "Ame Digital",         cor: "#FFB000", sigla: "AM", aliases: ["ame", "ame digital"] },
  { id: "banrisul",  nome: "Banrisul",            cor: "#005CA9", sigla: "BS", aliases: ["banrisul"] },
  { id: "bv",        nome: "Banco BV",            cor: "#002561", sigla: "BV", aliases: ["bv", "banco bv", "votorantim"] },
  { id: "paypal",    nome: "PayPal",              cor: "#003087", sigla: "PY", aliases: ["paypal"] },
  { id: "stone",     nome: "Stone",               cor: "#00A868", sigla: "ST", aliases: ["stone"] },
  { id: "pjbank",    nome: "PJBank",               cor: "#0B3D91", sigla: "PJ", aliases: ["pjbank"] },
  { id: "iti",       nome: "Iti (Itaú)",          cor: "#FF6900", sigla: "ITI", aliases: ["iti"] },
  { id: "bmg",       nome: "Banco BMG",           cor: "#F58220", sigla: "BM", aliases: ["bmg", "banco bmg"] },
  { id: "sofisa",    nome: "Banco Sofisa",        cor: "#ED1C24", sigla: "SO", aliases: ["sofisa", "banco sofisa"] },
  { id: "daycoval",  nome: "Banco Daycoval",      cor: "#004A93", sigla: "DC", aliases: ["daycoval", "banco daycoval"] },
  { id: "cora",      nome: "Cora",                cor: "#1A1A1A", sigla: "CO", aliases: ["cora"] },
  { id: "zrobank",   nome: "Zro Bank",            cor: "#7B2FF7", sigla: "ZR", aliases: ["zro", "zro bank"] },
  { id: "superdigital", nome: "Superdigital",     cor: "#EE2E24", sigla: "SU", aliases: ["superdigital"] },
  { id: "warren",    nome: "Warren",              cor: "#000000", sigla: "WA", aliases: ["warren"] },
  { id: "toro",      nome: "Toro Investimentos",  cor: "#0B5FFF", sigla: "TO", aliases: ["toro", "toro investimentos"] },
  { id: "genial",    nome: "Genial Investimentos", cor: "#FF4400", sigla: "GE", aliases: ["genial", "genial investimentos"] },
  { id: "ativa",     nome: "Ativa Investimentos", cor: "#003DA5", sigla: "AT", aliases: ["ativa", "ativa investimentos"] },
  { id: "orama",     nome: "Órama",               cor: "#6A1B9A", sigla: "OM", aliases: ["orama"] },
  { id: "modalmais", nome: "Modalmais",           cor: "#002B5C", sigla: "MM", aliases: ["modalmais", "modal mais"] },
  { id: "ourinvest", nome: "Ourinvest",           cor: "#B8860B", sigla: "OU", aliases: ["ourinvest"] },
];

/* Sugere uma instituição do catálogo a partir do nome digitado —
   por palavra inteira, pra "xp" não "roubar" o match de "expresso"
   nem coisa parecida. Não é obrigatório: é só o valor automático
   quando o usuário não escolheu nada no seletor de marca. */
function detectarBancoPorNome(nome) {
  const n = normIA(nome);
  if (!n) return null;
  for (const b of BANCOS_CATALOGO) {
    if (b.aliases.some(a => new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(n))) return b;
  }
  return null;
}

/* A instituição efetiva de uma conta:
   - b.logoId === ""  → usuário escolheu explicitamente "sem marca"
   - b.logoId (id)    → usuário escolheu essa instituição no seletor
   - b.logoId ausente → automático, tenta reconhecer pelo nome */
function bancoDaConta(b) {
  if (b?.logoId === "") return null;
  if (b?.logoId) return BANCOS_CATALOGO.find(x => x.id === b.logoId) || null;
  return detectarBancoPorNome(b?.nome);
}

const CORES_CONTA = [
  "#8B5CF6",  // roxo
  "#A855F7",  // roxo claro
  "#EC4899",  // rosa
  "#F43F5E",  // rosa-vermelho
  "#F97316",  // laranja
  "#FB923C",  // laranja claro
  "#EAB308",  // amarelo
  "#84CC16",  // lima
  "#22C55E",  // verde
  "#10B981",  // esmeralda
  "#14B8A6",  // teal
  "#06B6D4",  // ciano
  "#0EA5E9",  // azul
  "#3B82F6",  // azul royal
  "#6366F1",  // índigo
  "#8B5CF6",  // violeta
  "#EF4444",  // vermelho
  "#64748B",  // cinza-azulado
];

/* Deriva uma cor estável a partir do nome.
   O mesmo nome sempre dá a mesma cor — não muda a cada render. */
function corDoNome(nome) {
  let h = 0;
  const s = (nome || "").trim().toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return CORES_CONTA[h % CORES_CONTA.length];
}

/* A cor efetiva: a escolhida pelo usuário, ou a derivada do nome */
function corDaConta(b) {
  return b?.cor || corDoNome(b?.nome);
}

/* Escolhe preto ou branco para a inicial, conforme o contraste.
   Sem isso, a letra some em cores claras (amarelo, lima). */
function textoSobre(hex) {
  const h = hex.replace("#","");
  const r = parseInt(h.slice(0,2),16);
  const g = parseInt(h.slice(2,4),16);
  const b = parseInt(h.slice(4,6),16);
  // Luminância percebida (fórmula do WCAG, simplificada)
  const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
  return lum > 0.6 ? "#0A0F1A" : "#FFFFFF";
}

/* A "marca" da conta: logo oficial (se reconhecida), selo colorido com
   sigla (bancos/exchanges sem logo real no catálogo), ou o padrão de
   sempre — quadrado colorido com a inicial do nome. */
function marcaConta(b, tam) {
  const classe = tam === "sm" ? "marca-conta marca-conta-sm" : "marca-conta";
  const banco = bancoDaConta(b);

  if (banco?.logo) {
    return `<span class="${classe} marca-conta-logo"><img src="${banco.logo}" alt="${esc(banco.nome)}" loading="lazy" /></span>`;
  }
  if (banco) {
    const tamSigla = banco.sigla.length > 2 ? "font-size:.72em;" : "";
    return `<span class="${classe}" style="background:${banco.cor};color:${textoSobre(banco.cor)};${tamSigla}">${esc(banco.sigla)}</span>`;
  }

  const cor = corDaConta(b);
  const letra = (b?.nome || "?").trim()[0]?.toUpperCase() || "?";
  return `<span class="${classe}" style="background:${cor};color:${textoSobre(cor)}">${esc(letra)}</span>`;
}

/* ─── Diferenciação de contas do mesmo banco (v39) ───────────
   Quando 2+ contas começam com a mesma primeira palavra (ex: dois
   "Nubank"), separamos o nome-base do apelido para exibir o apelido
   como badge. Se o banco não se repete, mostra o nome inteiro. */
function _bancoBase(nome) {
  return (nome || "").trim().split(/\s+/)[0].toLowerCase();
}

/* Retorna {base, apelido} para exibição. apelido pode ser "".
   Só separa quando existe outra conta com o mesmo banco-base. */
function nomeConta(b) {
  const nome = (b?.nome || "").trim();
  const base = _bancoBase(nome);
  const repetido = state.bancos.filter(x => _bancoBase(x.nome) === base).length > 1;
  if (!repetido) return { base: nome, apelido: "" };

  const partes = nome.split(/\s+/);
  const primeiraPalavra = partes[0];
  const resto = partes.slice(1).join(" ").trim();
  // Se a pessoa deu um apelido (ex: "Nubank Salário"), separa.
  // Se são só dois "Nubank" iguais, não há apelido — mantém o nome.
  return { base: primeiraPalavra, apelido: resto };
}



/* ─── Seletor de cor ─────────────────────────────────────
   A grade em si (usada tanto no formulário de criação quanto no
   modal de edição). No formulário, ela mora dentro do popover
   único de "Marca e cor" (ver mais abaixo); Cor é detalhe cosmético
   — só aparece quando não há marca reconhecida. */

let _corEscolhida = null;      // null = automática (derivada do nome)
let _corEscolhidaEdit = null;

/* Monta a grade de cores */
function montarCorPicker(elId, corAtual, onPick) {
  const el = document.getElementById(elId);
  if (!el) return;

  const nomeInput = elId === "corPicker" ? "nomeBanco" : "editContaNome";
  const auto = corDoNome(document.getElementById(nomeInput)?.value || "");

  el.innerHTML = `
    <button type="button" class="cor-opcao cor-auto ${!corAtual ? "ativa" : ""}"
            data-cor="" title="Automática" style="background:${auto}">
      <svg viewBox="0 0 24 24" fill="none" stroke="${textoSobre(auto)}" stroke-width="2.6" stroke-linecap="round">
        <path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4"/>
      </svg>
    </button>
    ${CORES_CONTA.map(c => `
      <button type="button" class="cor-opcao ${corAtual === c ? "ativa" : ""}"
              data-cor="${c}" style="background:${c}"></button>
    `).join("")}
  `;

  // Campo hex personalizado
  const hexWrap = document.createElement("div");
  hexWrap.className = "cor-hex";
  hexWrap.innerHTML = `
    <span class="cor-hex-amostra" id="${elId}-hexAmostra" style="background:${corAtual && !CORES_CONTA.includes(corAtual) ? corAtual : "transparent"}"></span>
    <input type="text" class="cor-hex-input" id="${elId}-hexInput" placeholder="#FF5733" maxlength="7"
           value="${corAtual && !CORES_CONTA.includes(corAtual) ? corAtual : ""}" />
    <button type="button" class="cor-hex-ok" id="${elId}-hexOk">Usar</button>
  `;
  el.appendChild(hexWrap);

  const hexInput = hexWrap.querySelector(".cor-hex-input");
  const hexAmostra = hexWrap.querySelector(".cor-hex-amostra");
  const hexOk = hexWrap.querySelector(".cor-hex-ok");

  const validarHex = v => /^#[0-9A-Fa-f]{6}$/.test(v);
  const normalizarHex = v => {
    v = v.trim();
    if (v && !v.startsWith("#")) v = "#" + v;
    return v.toUpperCase();
  };

  hexInput.addEventListener("input", () => {
    const v = normalizarHex(hexInput.value);
    if (validarHex(v)) {
      hexAmostra.style.background = v;
      hexOk.disabled = false;
    } else {
      hexAmostra.style.background = "transparent";
      hexOk.disabled = true;
    }
  });

  const aplicarHex = () => {
    const v = normalizarHex(hexInput.value);
    if (!validarHex(v)) { toast("Código inválido. Use o formato #FF5733.", "error"); return; }
    onPick(v);
    el.querySelectorAll(".cor-opcao").forEach(x => x.classList.remove("ativa"));
    if (elId === "corPicker") { atualizarAmostraMarca(); fecharMarcaPop(); }
    else { toast("Cor personalizada aplicada.", "success"); }
  };
  hexOk.addEventListener("click", aplicarHex);
  hexInput.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); aplicarHex(); } });

  el.querySelectorAll(".cor-opcao").forEach(b => {
    b.addEventListener("click", () => {
      const cor = b.dataset.cor || null;
      onPick(cor);
      el.querySelectorAll(".cor-opcao").forEach(x => x.classList.remove("ativa"));
      b.classList.add("ativa");
      if (hexInput) hexInput.value = "";
      if (hexAmostra) hexAmostra.style.background = "transparent";
      if (elId === "corPicker") {
        atualizarAmostraMarca();
        fecharMarcaPop();
      }
    });
  });
}

/* Modal de edição — ali a grade fica aberta (tem espaço) */
function iniciarCorPickerEdit(corAtual) {
  _corEscolhidaEdit = corAtual;
  montarCorPicker("editCorPicker", corAtual, c => { _corEscolhidaEdit = c; });
  document.getElementById("editContaNome")?.addEventListener("input", () => {
    montarCorPicker("editCorPicker", _corEscolhidaEdit, c => { _corEscolhidaEdit = c; });
  });
}

/* ─── Seletor de marca e cor da conta ─────────────────────
   Um botão só, um popover só (no formulário de criação): marca do
   banco em cima, cor de fundo embaixo — a cor só entra em jogo
   quando não há marca reconhecida (automática sem correspondência,
   ou "Sem marca" escolhido de propósito). No modal de edição, as
   duas grades ficam abertas direto, uma embaixo da outra (tem
   espaço, não precisa de popover). Por padrão a marca fica
   "Automática" (null), que tenta reconhecer o banco pelo nome
   digitado — ver detectarBancoPorNome. Sem efeito nenhum pra quem
   nunca abrir esse seletor. */

let _logoEscolhida = null;      // null = automática | "" = sem marca | id do catálogo
let _logoEscolhidaEdit = null;

function _marcaBadgeHTML(banco) {
  if (banco === null) {
    return `<span class="marca-opcao-badge marca-opcao-auto">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4"/></svg>
    </span>`;
  }
  if (banco.logo) return `<span class="marca-opcao-badge marca-opcao-logo"><img src="${banco.logo}" alt="" loading="lazy" /></span>`;
  return `<span class="marca-opcao-badge" style="background:${banco.cor};color:${textoSobre(banco.cor)}">${esc(banco.sigla)}</span>`;
}

/* Monta a grade de instituições (com busca opcional) */
function montarMarcaPicker(elId, logoIdAtual, onPick, filtro) {
  const el = document.getElementById(elId);
  if (!el) return;

  const termo = normIA(filtro || "");
  const lista = termo
    ? BANCOS_CATALOGO.filter(b => normIA(b.nome).includes(termo) || b.aliases.some(a => a.includes(termo)))
    : BANCOS_CATALOGO;

  let html = "";
  if (!termo) {
    html += `
      <button type="button" class="marca-opcao ${logoIdAtual == null ? "ativa" : ""}" data-id="__auto__" title="Automática, pelo nome digitado">
        ${_marcaBadgeHTML(null)}
        <span class="marca-opcao-nome">Automática</span>
      </button>
      <button type="button" class="marca-opcao ${logoIdAtual === "" ? "ativa" : ""}" data-id="__nenhuma__" title="Sem marca — só cor e inicial">
        <span class="marca-opcao-badge marca-opcao-nenhuma">—</span>
        <span class="marca-opcao-nome">Sem marca</span>
      </button>`;
  }
  html += lista.map(b => `
    <button type="button" class="marca-opcao ${logoIdAtual === b.id ? "ativa" : ""}" data-id="${b.id}" title="${esc(b.nome)}">
      ${_marcaBadgeHTML(b)}
      <span class="marca-opcao-nome">${esc(b.nome)}</span>
    </button>
  `).join("");
  if (termo && !lista.length) html = `<p class="marca-vazio">Nenhum banco encontrado.</p>`;

  el.innerHTML = html;
  el.querySelectorAll(".marca-opcao").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      onPick(id === "__auto__" ? null : id === "__nenhuma__" ? "" : id);
    });
  });
}

/* A amostra no botão do formulário: reflete a marca OU a cor,
   o que estiver valendo pra essa conta no momento. */
function atualizarAmostraMarca() {
  const am = document.getElementById("marcaAmostra");
  if (!am) return;
  const nome = document.getElementById("nomeBanco")?.value || "";
  am.innerHTML = marcaConta({ nome, logoId: _logoEscolhida, cor: _corEscolhida }, "sm");
}

function renderMarcaCreate() {
  const busca = document.getElementById("marcaBusca");
  montarMarcaPicker("marcaPicker", _logoEscolhida, c => {
    _logoEscolhida = c;
    atualizarAmostraMarca();
    fecharMarcaPop();
  }, busca?.value || "");
}

function renderCorCreate() {
  montarCorPicker("corPicker", _corEscolhida, c => { _corEscolhida = c; });
}

function iniciarMarcaPicker() {
  atualizarAmostraMarca();
  document.getElementById("nomeBanco")?.addEventListener("input", () => {
    atualizarAmostraMarca();
    if (document.getElementById("marcaPop")?.classList.contains("aberto")) {
      renderMarcaCreate();
      renderCorCreate();
    }
  });
  document.getElementById("marcaBusca")?.addEventListener("input", () => renderMarcaCreate());
}

function abrirMarcaPop() {
  const pop = document.getElementById("marcaPop");
  if (!pop) return;
  const abrindo = !pop.classList.contains("aberto");
  pop.classList.toggle("aberto", abrindo);
  pop.closest(".form-panel")?.classList.toggle("tem-pop-aberto", abrindo);
  if (abrindo) {
    const busca = document.getElementById("marcaBusca");
    if (busca) busca.value = "";
    renderMarcaCreate();
    renderCorCreate();
    busca?.focus();
  }
}
function fecharMarcaPop() {
  const pop = document.getElementById("marcaPop");
  pop?.classList.remove("aberto");
  pop?.closest(".form-panel")?.classList.remove("tem-pop-aberto");
}
document.addEventListener("click", e => {
  const pop = document.getElementById("marcaPop");
  const btn = document.getElementById("btnMarca");
  if (!pop?.classList.contains("aberto")) return;
  if (!pop.contains(e.target) && !btn?.contains(e.target)) fecharMarcaPop();
});

/* Modal de edição — grade aberta com busca, sem popover */
function renderMarcaEdit() {
  const busca = document.getElementById("editMarcaBusca");
  montarMarcaPicker("editMarcaPicker", _logoEscolhidaEdit, c => {
    _logoEscolhidaEdit = c;
    renderMarcaEdit();
  }, busca?.value || "");
}
function iniciarMarcaPickerEdit(logoIdAtual) {
  _logoEscolhidaEdit = logoIdAtual ?? null;
  const busca = document.getElementById("editMarcaBusca");
  if (busca) busca.value = "";
  renderMarcaEdit();
}
document.getElementById("editMarcaBusca")?.addEventListener("input", () => renderMarcaEdit());



/* ============================================================
   IMPORTAÇÃO DE EXTRATO (v19)
   Suporta CSV e OFX/QFX — o formato padrão dos bancos.
   PDF não é possível sem servidor (cada banco tem layout próprio).
   ============================================================ */

/* Detecta o formato pelo conteúdo, não só pela extensão */
function detectarFormato(texto, nomeArquivo) {
  const t = texto.slice(0, 2000).toUpperCase();
  if (t.includes("<OFX>") || t.includes("OFXHEADER") || t.includes("<STMTTRN>")) return "ofx";
  if (/\.ofx$|\.qfx$/i.test(nomeArquivo)) return "ofx";
  return "csv";
}

/* ─── OFX ─────────────────────────────────────────────────
   O OFX é um XML (ou SGML nas versões antigas). Cada transação
   vem num bloco <STMTTRN>. */
function parseOFX(texto) {
  const movs = [];

  // Pega cada bloco de transação
  const blocos = texto.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];

  for (const bloco of blocos) {
    const campo = (tag) => {
      // Aceita tanto <TAG>valor</TAG> quanto <TAG>valor (SGML antigo)
      const re = new RegExp(`<${tag}>\\s*([^<\\r\\n]*)`, "i");
      const m = bloco.match(re);
      return m ? m[1].trim() : "";
    };

    const dataRaw = campo("DTPOSTED");       // 20260714120000[-3:BRT]
    const valorRaw = campo("TRNAMT");        // -200.00
    const memo = campo("MEMO") || campo("NAME") || "Lançamento importado";
    const tipoOfx = campo("TRNTYPE");        // DEBIT | CREDIT

    if (!dataRaw || !valorRaw) continue;

    // Data: os 8 primeiros dígitos são AAAAMMDD
    const d = dataRaw.replace(/[^0-9]/g, "").slice(0, 8);
    if (d.length !== 8) continue;
    const data = `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;

    const valor = Math.abs(parseFloat(valorRaw.replace(",", ".")));
    if (!valor || isNaN(valor)) continue;

    // O sinal do valor é a fonte da verdade; TRNTYPE é reforço
    const negativo = parseFloat(valorRaw.replace(",", ".")) < 0;
    const tipo = negativo || /DEBIT|PAYMENT|FEE/i.test(tipoOfx) ? "gasto" : "entrada";

    movs.push({
      data,
      descricao: limparDescricao(memo),
      valor,
      tipo,
      categoria: classificarCategoria(memo)
    });
  }

  return movs;
}

/* Limpa a descrição do banco (que costuma vir suja) */
function limparDescricao(s) {
  return String(s)
    .replace(/\s+/g, " ")
    .replace(/^(COMPRA|PAGAMENTO|DEBITO|CREDITO|TED|PIX|DOC)\s+(CARTAO|ELETRONICO|RECEBIDO|ENVIADO)?\s*/i, m => m.trim() + " ")
    .trim()
    .slice(0, 120);
}

/* ─── CSV (mais tolerante que antes) ────────────────────── */
function parseCSVExtrato(texto) {
  const linhas = texto.split(/\r?\n/).filter(l => l.trim());
  if (!linhas.length) return [];

  // Detecta o separador: ; é comum no Brasil, , no exterior
  const sep = (linhas[0].match(/;/g) || []).length > (linhas[0].match(/,/g) || []).length ? ";" : ",";

  // A primeira linha é cabeçalho?
  const primeira = linhas[0].toLowerCase();
  const temCabecalho = /data|date|descri|hist|valor|value|amount/i.test(primeira);
  const corpo = temCabecalho ? linhas.slice(1) : linhas;

  // Descobre a posição das colunas pelo cabeçalho
  let iData = 0, iDesc = 1, iValor = 2;
  if (temCabecalho) {
    const cols = primeira.split(sep).map(c => c.trim().replace(/^["']|["']$/g, ""));
    const acha = (...termos) => cols.findIndex(c => termos.some(t => c.includes(t)));
    const d = acha("data", "date");
    const s = acha("descri", "hist", "lanc", "memo", "detalhe");
    const v = acha("valor", "value", "amount", "montante");
    if (d >= 0) iData = d;
    if (s >= 0) iDesc = s;
    if (v >= 0) iValor = v;
  }

  const movs = [];
  for (const linha of corpo) {
    const cols = dividirCSV(linha, sep);
    if (cols.length < 2) continue;

    const data = normalizarData(cols[iData]);
    if (!data) continue;

    const valorStr = (cols[iValor] || "").replace(/[R$\s]/g, "");
    const negativo = valorStr.trim().startsWith("-");
    const valor = Math.abs(parseValorBR(valorStr));
    if (!valor || isNaN(valor)) continue;

    const desc = (cols[iDesc] || "Lançamento importado").replace(/^["']|["']$/g, "").trim();

    movs.push({
      data,
      descricao: limparDescricao(desc),
      valor,
      tipo: negativo ? "gasto" : "entrada",
      categoria: classificarCategoria(desc)
    });
  }
  return movs;
}

/* Divide respeitando aspas */
function dividirCSV(linha, sep) {
  const out = [];
  let atual = "", dentroAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') { dentroAspas = !dentroAspas; continue; }
    if (c === sep && !dentroAspas) { out.push(atual); atual = ""; continue; }
    atual += c;
  }
  out.push(atual);
  return out.map(s => s.trim());
}

/* Aceita DD/MM/AAAA, AAAA-MM-DD, DD-MM-AAAA */
function normalizarData(s) {
  if (!s) return null;
  s = s.trim().replace(/^["']|["']$/g, "");

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;

  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (m) return `20${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;

  return null;
}

/* Valor no formato brasileiro: 1.234,56 → 1234.56 */
function parseValorBR(s) {
  if (!s) return NaN;
  s = String(s).trim();
  // Se tem vírgula E ponto, o ponto é separador de milhar
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  return parseFloat(s.replace(/[^0-9.\-]/g, ""));
}



/* Acordeão do painel de importação */
function abrirImportar(abrir) {
  const painel = document.getElementById("painelImportar");
  const corpo  = document.getElementById("conteudoImportar");
  const btn    = document.getElementById("toggleImportar");
  if (!painel || !corpo) return;

  // Mesma convenção do simulador: .open no corpo, .aberto no painel
  // (o painel controla o giro do chevron).
  corpo.classList.toggle("open", abrir);
  painel.classList.toggle("aberto", abrir);
  btn?.setAttribute("aria-expanded", String(abrir));
}

document.getElementById("toggleImportar")?.addEventListener("click", () => {
  const aberto = document.getElementById("painelImportar")?.classList.contains("aberto");
  abrirImportar(!aberto);
});




/* ============================================================
   DICAS DISPENSÁVEIS (v25)
   A dica ajuda quem chega, mas incomoda quem já sabe.
   Uma vez dispensada, não volta.
   ============================================================ */
function dispensarDica(chave) {
  const el = document.getElementById(`dica${chave.charAt(0).toUpperCase()}${chave.slice(1)}`);
  if (!el) return;
  el.style.height = el.offsetHeight + "px";
  requestAnimationFrame(() => {
    el.classList.add("dica-saindo");
    setTimeout(() => el.remove(), 240);
  });
  localStorage.setItem(`fp_dica_${chave}`, "1");
}

function restaurarDicas() {
  ["recorrencias", "notasFiscais"].forEach(chave => {
    if (localStorage.getItem(`fp_dica_${chave}`) === "1") {
      document.getElementById(`dica${chave.charAt(0).toUpperCase()}${chave.slice(1)}`)?.remove();
    }
  });
}

/* ─── Painel recolhível (regras) ─── */
function alternarPainel(painelId, corpoId, btnId) {
  const painel = document.getElementById(painelId);
  const corpo  = document.getElementById(corpoId);
  const btn    = document.getElementById(btnId);
  if (!painel || !corpo) return;

  const aberto = corpo.classList.toggle("open");
  painel.classList.toggle("recolhido", !aberto);
  btn?.setAttribute("aria-expanded", String(aberto));
  localStorage.setItem(`fp_painel_${painelId}`, aberto ? "1" : "0");
}

document.getElementById("toggleRegras")?.addEventListener("click", () => {
  alternarPainel("painelRegras", "corpoRegras", "toggleRegras");
});

document.getElementById("toggleCategorias")?.addEventListener("click", () => {
  alternarPainel("painelCategorias", "corpoCategorias", "toggleCategorias");
});

/* Restaura o estado salvo */
function restaurarPaineis() {
  if (localStorage.getItem("fp_painel_painelRegras") === "0") {
    document.getElementById("corpoRegras")?.classList.remove("open");
    document.getElementById("painelRegras")?.classList.add("recolhido");
    document.getElementById("toggleRegras")?.setAttribute("aria-expanded", "false");
  }
  // Categorias começa fechado; só abre se o usuário deixou aberto
  const catAberto = localStorage.getItem("fp_painel_painelCategorias") === "1";
  document.getElementById("corpoCategorias")?.classList.toggle("open", catAberto);
  document.getElementById("painelCategorias")?.classList.toggle("recolhido", !catAberto);
  document.getElementById("toggleCategorias")?.setAttribute("aria-expanded", String(catAberto));
}


/* ============================================================
   METAS E OBJETIVOS (v26)
   Duas coisas diferentes, agora separadas em abas:
   - Objetivos: juntar dinheiro para algo (longo prazo)
   - Limites: teto de gasto por categoria (mensal)
   ============================================================ */

function trocarAbaMeta(aba) {
  document.querySelectorAll("#metaAbas .meta-aba").forEach(b =>
    b.classList.toggle("ativo", b.dataset.aba === aba));
  const obj = document.getElementById("painelObjetivos");
  const lim = document.getElementById("painelLimites");
  if (obj) obj.style.display = aba === "objetivos" ? "" : "none";
  if (lim) lim.style.display = aba === "limites" ? "" : "none";
  localStorage.setItem("fp_meta_aba", aba);
}

document.querySelectorAll("#metaAbas .meta-aba").forEach(btn => {
  btn.addEventListener("click", () => trocarAbaMeta(btn.dataset.aba));
});

/* Preview: quanto guardar por mês para chegar no objetivo */
function atualizarObjPreview() {
  const el = document.getElementById("objPreview");
  if (!el) return;
  const alvo  = parseFloat(document.getElementById("objAlvo")?.value) || 0;
  const atual = parseFloat(document.getElementById("objAtual")?.value) || 0;
  const data  = document.getElementById("objData")?.value;

  if (!alvo || !data) { el.innerHTML = ""; return; }

  const falta = Math.max(0, alvo - atual);
  const hoje = new Date(hojeISO()+"T00:00:00");
  const fim  = new Date(data+"T00:00:00");
  const meses = Math.max(1, Math.round((fim - hoje) / (30.44 * 86400000)));

  if (falta <= 0) {
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg><span>Você já tem o valor completo!</span>`;
    return;
  }

  const porMes = falta / meses;
  el.innerHTML = `<svg class="obj-preview-icone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg><span>Guarde <strong>${fmtMoeda(porMes)}</strong> por mês durante <strong>${meses}</strong> ${meses === 1 ? "mês" : "meses"} para juntar ${fmtMoeda(falta)}.</span>`;
}

["objAlvo","objAtual","objData"].forEach(id => {
  document.getElementById(id)?.addEventListener("input", atualizarObjPreview);
});


/* ============================================================
   ÍCONES DE OBJETIVO (v27)
   Emojis davam ar amador. SVGs em linha, na cor da marca.
   ============================================================ */
const ICONES_OBJETIVO = {
  geral:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
  carro:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l1.5-4.5A2 2 0 0 1 8.4 7h7.2a2 2 0 0 1 1.9 1.5L19 13"/><path d="M4 13h16v4a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H7v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><circle cx="7.5" cy="15.5" r="0.5"/><circle cx="16.5" cy="15.5" r="0.5"/></svg>',
  viagem:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5a2.1 2.1 0 0 0-3-3L13 8 4.8 6.2a1 1 0 0 0-.9.3l-.9.9a.5.5 0 0 0 .1.8L8 11l-2 2H4l-1 1 3 2 2 3 1-1v-2l2-2 2.9 5.8a.5.5 0 0 0 .8.1l.9-.9a1 1 0 0 0 .3-.9z"/></svg>',
  casa:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9"/><path d="M9 20v-6h6v6"/></svg>',
  estudos:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5"/></svg>',
  casamento:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="14" r="6"/><path d="M9 5l3 3 3-3"/><path d="M9 5l1.5-2h3L15 5"/></svg>',
  reserva:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5z"/><path d="M9 12l2 2 4-4"/></svg>',
  eletronico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2"/><line x1="11" y1="18" x2="13" y2="18"/></svg>',
};

/* Objetivos criados antes desta versão têm emoji salvo.
   Este mapa converte para as novas chaves, sem perder o ícone. */
const EMOJI_PARA_CHAVE = {
  "🎯":"geral","🚗":"carro","✈️":"viagem","✈":"viagem","🏠":"casa",
  "🎓":"estudos","💍":"casamento","🛡️":"reserva","🛡":"reserva","📱":"eletronico"
};
function iconeObjetivo(chave) {
  const c = EMOJI_PARA_CHAVE[chave] || chave;
  return ICONES_OBJETIVO[c] || ICONES_OBJETIVO.geral;
}


/* Número curto: 12.5 → "12,5", 12.0 → "12" (sem casas inúteis) */
function fmtNum(n) {
  return Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}


/* ============================================================
   CRIPTO AO VIVO (v29)
   Busca preço em BRL + variação 24h na CoinGecko (grátis, sem chave).
   Cache de 5 min para respeitar o rate limit da API pública.
   ============================================================ */

/* As moedas que o app oferece. O id é o da CoinGecko — o preço em BRL vem
   de lá (ver atualizarPrecosCripto). Lista ampla de propósito ("o máximo
   que der"), verificada uma por uma contra a API antes de entrar aqui —
   só busca preço de quem o usuário realmente tem (criptosEmUso), então
   ter muitas opções na lista não pesa em nada no dia a dia. */
const CRIPTOS = [
  { id: "bitcoin",              sigla: "BTC",    nome: "Bitcoin" },
  { id: "ethereum",             sigla: "ETH",    nome: "Ethereum" },
  { id: "tether",               sigla: "USDT",   nome: "Tether" },
  { id: "binancecoin",          sigla: "BNB",    nome: "BNB" },
  { id: "solana",               sigla: "SOL",    nome: "Solana" },
  { id: "ripple",               sigla: "XRP",    nome: "XRP" },
  { id: "usd-coin",             sigla: "USDC",   nome: "USD Coin" },
  { id: "dogecoin",             sigla: "DOGE",   nome: "Dogecoin" },
  { id: "cardano",              sigla: "ADA",    nome: "Cardano" },
  { id: "tron",                 sigla: "TRX",    nome: "TRON" },
  { id: "the-open-network",     sigla: "TON",    nome: "Toncoin" },
  { id: "avalanche-2",          sigla: "AVAX",   nome: "Avalanche" },
  { id: "shiba-inu",            sigla: "SHIB",   nome: "Shiba Inu" },
  { id: "polkadot",             sigla: "DOT",    nome: "Polkadot" },
  { id: "chainlink",            sigla: "LINK",   nome: "Chainlink" },
  { id: "bitcoin-cash",         sigla: "BCH",    nome: "Bitcoin Cash" },
  { id: "sui",                  sigla: "SUI",    nome: "Sui" },
  { id: "near",                 sigla: "NEAR",   nome: "NEAR Protocol" },
  { id: "litecoin",             sigla: "LTC",    nome: "Litecoin" },
  { id: "matic-network",        sigla: "MATIC",  nome: "Polygon" },
  { id: "aptos",                sigla: "APT",    nome: "Aptos" },
  { id: "internet-computer",    sigla: "ICP",    nome: "Internet Computer" },
  { id: "hedera-hashgraph",     sigla: "HBAR",   nome: "Hedera" },
  { id: "dai",                  sigla: "DAI",    nome: "Dai" },
  { id: "stellar",              sigla: "XLM",    nome: "Stellar" },
  { id: "monero",               sigla: "XMR",    nome: "Monero" },
  { id: "uniswap",              sigla: "UNI",    nome: "Uniswap" },
  { id: "cosmos",               sigla: "ATOM",   nome: "Cosmos" },
  { id: "ethereum-classic",     sigla: "ETC",    nome: "Ethereum Classic" },
  { id: "filecoin",             sigla: "FIL",    nome: "Filecoin" },
  { id: "aave",                 sigla: "AAVE",   nome: "Aave" },
  { id: "algorand",             sigla: "ALGO",   nome: "Algorand" },
  { id: "vechain",              sigla: "VET",    nome: "VeChain" },
  { id: "injective-protocol",   sigla: "INJ",    nome: "Injective" },
  { id: "optimism",             sigla: "OP",     nome: "Optimism" },
  { id: "arbitrum",             sigla: "ARB",    nome: "Arbitrum" },
  { id: "maker",                sigla: "MKR",    nome: "Maker" },
  { id: "render-token",         sigla: "RENDER", nome: "Render" },
  { id: "worldcoin-wld",        sigla: "WLD",    nome: "Worldcoin" },
  { id: "sei-network",          sigla: "SEI",    nome: "Sei" },
  { id: "celestia",             sigla: "TIA",    nome: "Celestia" },
  { id: "pepe",                 sigla: "PEPE",   nome: "Pepe" },
  { id: "tezos",                sigla: "XTZ",    nome: "Tezos" },
  { id: "fantom",               sigla: "FTM",    nome: "Fantom" },
  { id: "flow",                 sigla: "FLOW",   nome: "Flow" },
  { id: "eos",                  sigla: "EOS",    nome: "EOS" },
  { id: "chiliz",               sigla: "CHZ",    nome: "Chiliz" },
  { id: "axie-infinity",        sigla: "AXS",    nome: "Axie Infinity" },
  { id: "the-sandbox",          sigla: "SAND",   nome: "The Sandbox" },
  { id: "decentraland",         sigla: "MANA",   nome: "Decentraland" },
  { id: "gala",                 sigla: "GALA",   nome: "Gala" },
];

function criptoPorId(id) {
  return CRIPTOS.find(c => c.id === id) || null;
}

/* Cache em memória + localStorage (sobrevive a recarregar a página) */
const CACHE_CRIPTO_MS = 5 * 60 * 1000;   // 5 minutos
let _precosCripto = {};                    // { bitcoin: { brl, variacao24h }, ... }
let _precosCriptoEm = 0;

function carregarCacheCripto() {
  try {
    const raw = localStorage.getItem("fp_precos_cripto");
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (obj && obj.dados && obj.em) {
      _precosCripto = obj.dados;
      _precosCriptoEm = obj.em;
    }
  } catch { /* cache corrompido, ignora */ }
}

function salvarCacheCripto() {
  try {
    localStorage.setItem("fp_precos_cripto", JSON.stringify({
      dados: _precosCripto, em: _precosCriptoEm
    }));
  } catch { /* localStorage cheio, ignora */ }
}

/* Quais criptos o usuário realmente tem — só busca essas */
function criptosEmUso() {
  const ids = new Set();
  state.investimentos.forEach(i => { if (i.criptoId) ids.add(i.criptoId); });
  return [...ids];
}

/* Busca os preços. Retorna true se atualizou, false se usou cache. */
async function atualizarPrecosCripto(forcar = false) {
  const ids = criptosEmUso();
  if (!ids.length) return false;

  const agora = Date.now();
  const cacheValido = (agora - _precosCriptoEm) < CACHE_CRIPTO_MS;

  // Só busca se o cache venceu, ou se forçado, ou se falta alguma moeda
  const faltaAlguma = ids.some(id => !_precosCripto[id]);
  if (cacheValido && !forcar && !faltaAlguma) return false;

  const url = `https://api.coingecko.com/api/v3/simple/price`
    + `?ids=${ids.join(",")}&vs_currencies=brl`
    + `&include_24hr_change=true`;

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 12000);
    const resp = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timeout);

    if (resp.status === 429) {
      // Rate limit — mantém o cache antigo, avisa discretamente
      _criptoErro = "limite";
      return false;
    }
    if (!resp.ok) { _criptoErro = "falha"; return false; }

    const data = await resp.json();
    ids.forEach(id => {
      if (data[id] && typeof data[id].brl === "number") {
        _precosCripto[id] = {
          brl: data[id].brl,
          variacao24h: data[id].brl_24h_change ?? null
        };
      }
    });
    _precosCriptoEm = agora;
    _criptoErro = null;
    salvarCacheCripto();
    return true;

  } catch (e) {
    // Rede caiu ou timeout — segue com o cache que tiver
    _criptoErro = "rede";
    return false;
  }
}

let _criptoErro = null;

/* Valor atual de um investimento cripto, com o preço de agora.
   Se não há preço ainda, cai no valor aplicado. */
function valorAtualCripto(inv) {
  if (!inv.criptoId || !inv.criptoQtd) return inv.valor;
  const p = _precosCripto[inv.criptoId];
  if (!p) return inv.valor;
  return inv.criptoQtd * p.brl;
}

/* Formata a variação: +2,3% em verde, −1,8% em vermelho */
function badgeVariacao(variacao) {
  if (variacao == null) return "";
  const pos = variacao >= 0;
  const cls = pos ? "cripto-var-pos" : "cripto-var-neg";
  const sinal = pos ? "+" : "−";
  return `<span class="cripto-var ${cls}">${sinal}${fmtNum(Math.abs(variacao))}% <small>24h</small></span>`;
}



/* ─── Campos de cripto no formulário ─── */

/* Popula o select de moedas */
function popularSelectCripto() {
  const sel = document.getElementById("invCripto");
  if (!sel || sel.options.length > 1) return;
  CRIPTOS.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.nome} (${c.sigla})`;
    sel.appendChild(opt);
  });
}

/* Mostra/esconde os campos de cripto conforme o tipo */
function alternarCamposCripto() {
  const tipo = document.getElementById("invTipo")?.value;
  const cfg = configTipo(tipo);
  const modo = cfg.modo || "taxa";
  const ehCripto = modo === "cripto";
  const ehVariavel = modo === "variavel" || modo === "cripto";
  const ehCDI = modo === "cdi";
  const ehPoupanca = modo === "poupanca";

  // Campos de cripto: só quando é cripto
  document.getElementById("fieldInvCripto")?.classList.toggle("hidden-filter", !ehCripto);
  document.getElementById("fieldInvCriptoQtd")?.classList.toggle("hidden-filter", !ehCripto);

  // Taxa: escondida em renda variável (sem taxa) e poupança (taxa fixa conhecida)
  const escondeTaxa = ehVariavel || ehPoupanca;
  document.getElementById("invTaxa")?.closest(".field")?.classList.toggle("hidden-filter", escondeTaxa);
  // Período e regime: só fazem sentido no modo "taxa" fixa
  const soTaxaFixa = modo === "taxa" || modo === "ipca";
  document.getElementById("invTaxaPeriodo")?.closest(".field")?.classList.toggle("hidden-filter", !soTaxaFixa);
  document.getElementById("invRegime")?.closest(".field")?.classList.toggle("hidden-filter", !soTaxaFixa);

  // Label do campo taxa muda conforme o modo
  const lbl = document.getElementById("invTaxaLabel");
  const inp = document.getElementById("invTaxa");
  if (lbl && inp) {
    if (ehCDI) {
      lbl.textContent = "% do CDI";
      inp.placeholder = "Ex: 105";
    } else if (modo === "ipca") {
      lbl.textContent = "Taxa fixa (%) + IPCA";
      inp.placeholder = "Ex: 6";
    } else {
      lbl.textContent = "Rendimento (%)";
      inp.placeholder = "Ex: 12";
    }
  }

  // Valor calculado (cripto) vira leitura
  const campoValor = document.getElementById("invValor");
  if (campoValor) {
    campoValor.readOnly = ehCripto;
    campoValor.closest(".field")?.classList.toggle("campo-calculado", ehCripto);
  }

  // Título do bloco
  const titBloco = document.getElementById("invBlocoValorTitulo");
  if (titBloco) titBloco.textContent = ehVariavel ? "Valor" : "Valor e rendimento";

  atualizarDicaCDI();
  mostrarAvisoTipo(cfg);
}

/* Mostra "105% do CDI = 14,86% a.a." ao vivo */
function atualizarDicaCDI() {
  const dica = document.getElementById("invCdiDica");
  if (!dica) return;
  const tipo = document.getElementById("invTipo")?.value;
  const cfg = configTipo(tipo);
  if ((cfg.modo || "") !== "cdi") { dica.innerHTML = ""; return; }

  const pct = Number(document.getElementById("invTaxa")?.value) || 0;
  if (!pct) {
    dica.innerHTML = `CDI hoje: <strong>${fmtNum(cdiAtual())}% a.a.</strong> — informe o percentual do CDI`;
    return;
  }
  const efetiva = cdiAtual() * (pct/100);
  dica.innerHTML = `${fmtNum(pct)}% do CDI = <strong>${fmtNum(efetiva)}% a.a.</strong> <span style="opacity:.6">(CDI ${fmtNum(cdiAtual())}%)</span>`;
}

/* Mostra o aviso específico do tipo, se houver */
function mostrarAvisoTipo(cfg) {
  const box = document.getElementById("invAvisoTipo");
  if (!box) return;
  if (cfg && cfg.aviso) {
    box.innerHTML = cfg.aviso;
    box.style.display = "";
  } else {
    box.style.display = "none";
  }
}

/* Ao escolher moeda + quantidade, calcula o valor aplicado com o preço atual */
async function calcularValorCripto() {
  const id  = document.getElementById("invCripto")?.value;
  const qtd = parseFloat(document.getElementById("invCriptoQtd")?.value);
  const dica = document.getElementById("invCriptoDica");
  if (!id || !qtd || qtd <= 0) { if (dica) dica.innerHTML = ""; return; }

  // Garante que temos o preço dessa moeda
  if (!_precosCripto[id]) {
    const ids = criptosEmUso();
    if (!ids.includes(id)) {
      // Busca pontual dessa moeda
      try {
        const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=brl&include_24hr_change=true`);
        if (r.ok) {
          const d = await r.json();
          if (d[id]) _precosCripto[id] = { brl: d[id].brl, variacao24h: d[id].brl_24h_change ?? null };
        }
      } catch { /* segue sem preço */ }
    }
  }

  const p = _precosCripto[id];
  if (!p) { if (dica) dica.innerHTML = ""; return; }

  const valor = qtd * p.brl;
  const campoValor = document.getElementById("invValor");
  if (campoValor && !campoValor.dataset.editadoManual) {
    campoValor.value = valor.toFixed(2);
  }

  const c = criptoPorId(id);
  if (dica) {
    dica.innerHTML = `1 ${c.sigla} = ${fmtMoeda(p.brl)} · ${qtd} ${c.sigla} = <strong>${fmtMoeda(valor)}</strong>`;
  }
}

document.getElementById("invTipo")?.addEventListener("change", () => {
  alternarCamposCripto();
  popularSelectCripto();
});

/* ─── Dropdown customizado do TIPO de investimento ───────────
   O <select id="invTipo"> fica escondido (mantém required/reset e todos
   os listeners existentes). Aqui montamos um menu bonito por cima que,
   ao escolher, seta o valor do select e dispara o "change" dele. */
function iconeTipoInv(valor) {
  // Um ícone simples por família (renda fixa, variável, cripto, etc.)
  const cfg = (typeof configTipo === "function") ? configTipo(valor) : { cat: "rv", modo: "taxa" };
  if (valor === "Cripto") return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.5 8.5h4a2 2 0 0 1 0 4h-4m0 0h4.3a2 2 0 0 1 0 4H9.5m0-8v10"/></svg>`;
  if (valor === "Imóvel") return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M4 21V10l8-6 8 6v11M9 21v-6h6v6"/></svg>`;
  if (valor === "Ouro") return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3 6 6 .5-4.5 4 1.5 6-6-3.5L6 18.5 7.5 12.5 3 8.5 9 8z"/></svg>`;
  if (cfg.cat === "rf") return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/></svg>`;
  if (cfg.cat === "rv") return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l3-3 3 3 5-6"/></svg>`;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/></svg>`;
}

function montarTipoDropdown() {
  const select = document.getElementById("invTipo");
  const menu = document.getElementById("tipoDdMenu");
  const botao = document.getElementById("tipoDdBotao");
  const atual = document.getElementById("tipoDdAtual");
  const dd = document.getElementById("tipoDropdown");
  if (!select || !menu || !botao || !dd) return;

  // Monta o menu a partir dos optgroups/options do select (fonte única)
  let html = "";
  Array.from(select.children).forEach(node => {
    if (node.tagName === "OPTGROUP") {
      html += `<div class="tipo-dd-grupo">${esc(node.label)}</div>`;
      Array.from(node.children).forEach(opt => {
        if (!opt.value) return;
        html += `<button type="button" class="tipo-dd-opcao" role="option" data-valor="${esc(opt.value)}">
          <span class="tipo-dd-opcao-ico">${iconeTipoInv(opt.value)}</span>
          <span>${esc(opt.textContent)}</span>
        </button>`;
      });
    } else if (node.tagName === "OPTION" && node.value) {
      // Opção solta (ex: "Outro")
      html += `<button type="button" class="tipo-dd-opcao" role="option" data-valor="${esc(node.value)}">
        <span class="tipo-dd-opcao-ico">${iconeTipoInv(node.value)}</span>
        <span>${esc(node.textContent)}</span>
      </button>`;
    }
  });
  menu.innerHTML = html;

  const painel = dd.closest(".form-panel");
  const fechar = () => {
    dd.classList.remove("aberto");
    botao.setAttribute("aria-expanded", "false");
    painel?.classList.remove("tem-pop-aberto");
  };
  const abrir = () => {
    dd.classList.add("aberto");
    botao.setAttribute("aria-expanded", "true");
    painel?.classList.add("tem-pop-aberto"); // eleva o painel (fallback sem :has)
  };

  botao.addEventListener("click", (e) => {
    e.stopPropagation();
    dd.classList.contains("aberto") ? fechar() : abrir();
  });

  menu.querySelectorAll(".tipo-dd-opcao").forEach(opt => {
    opt.addEventListener("click", () => {
      const valor = opt.dataset.valor;
      select.value = valor;
      atual.textContent = opt.querySelector("span:last-child").textContent;
      atual.classList.remove("tipo-dd-placeholder");
      menu.querySelectorAll(".tipo-dd-opcao").forEach(o => o.classList.toggle("ativa", o === opt));
      // Dispara o change do select para o resto do app reagir
      select.dispatchEvent(new Event("change", { bubbles: true }));
      fechar();
    });
  });

  // Fecha ao clicar fora
  document.addEventListener("click", (e) => {
    if (!dd.contains(e.target)) fechar();
  });

  // Sincroniza o rótulo quando o select muda por fora (ex: reset do form)
  select.addEventListener("change", () => {
    const txt = select.options[select.selectedIndex]?.textContent || "Selecione";
    atual.textContent = txt;
    atual.classList.toggle("tipo-dd-placeholder", !select.value);
    menu.querySelectorAll(".tipo-dd-opcao").forEach(o =>
      o.classList.toggle("ativa", o.dataset.valor === select.value));
  });

  // Estado inicial
  atual.classList.toggle("tipo-dd-placeholder", !select.value);
}
montarTipoDropdown();
document.getElementById("invCripto")?.addEventListener("change", calcularValorCripto);
document.getElementById("invCriptoQtd")?.addEventListener("input", calcularValorCripto);

// Se a pessoa editar o valor à mão, para de sobrescrever
document.getElementById("invValor")?.addEventListener("input", e => {
  e.target.dataset.editadoManual = "1";
});


/* ─── Botão de atualizar preços ─── */
function atualizarBotaoCripto() {
  const btn = document.getElementById("btnAtualizarCripto");
  const lbl = document.getElementById("criptoAtualizadoEm");
  if (!btn) return;

  const temCripto = criptosEmUso().length > 0;
  btn.style.display = temCripto ? "" : "none";
  if (!temCripto) return;

  if (_criptoErro === "limite") {
    lbl.textContent = "Limite atingido — tente em 1 min";
    btn.classList.add("cripto-erro");
  } else if (_criptoErro === "rede") {
    lbl.textContent = "Sem conexão";
    btn.classList.add("cripto-erro");
  } else if (_precosCriptoEm) {
    const min = Math.round((Date.now() - _precosCriptoEm) / 60000);
    lbl.textContent = min < 1 ? "Agora mesmo" : `há ${min} min`;
    btn.classList.remove("cripto-erro");
  } else {
    lbl.textContent = "Atualizar";
    btn.classList.remove("cripto-erro");
  }
}

document.getElementById("btnAtualizarCripto")?.addEventListener("click", async () => {
  const btn = document.getElementById("btnAtualizarCripto");
  btn?.classList.add("girando");
  await atualizarPrecosCripto(true);
  renderInvestimentos();
  setTimeout(() => btn?.classList.remove("girando"), 600);
});


/* ============================================================
   ABAS DE INVESTIMENTOS (v31)
   Carteira | Simulador — na mesma seção.
   ============================================================ */
function trocarAbaInv(aba) {
  document.querySelectorAll("#invAbas .meta-aba").forEach(b =>
    b.classList.toggle("ativo", b.dataset.aba === aba));
  const cart = document.getElementById("painelCarteira");
  const sim  = document.getElementById("painelSimulador");
  if (cart) cart.style.display = aba === "carteira" ? "" : "none";
  if (sim)  sim.style.display  = aba === "simulador" ? "" : "none";

  // O Chart.js não mede direito enquanto está oculto — redimensiona ao abrir
  if (aba === "simulador" && chartSimulador) {
    setTimeout(() => chartSimulador.resize(), 60);
  }
}

document.querySelectorAll("#invAbas .meta-aba").forEach(btn => {
  btn.addEventListener("click", () => trocarAbaInv(btn.dataset.aba));
});

/* Abas do ganho estimado (por dia / mês / ano) */
document.querySelectorAll("#invGanhoAbas .inv-ganho-aba").forEach(btn => {
  btn.addEventListener("click", () => {
    _periodoGanho = btn.dataset.periodo || "mes";
    document.querySelectorAll("#invGanhoAbas .inv-ganho-aba").forEach(b =>
      b.classList.toggle("ativa", b === btn));
    atualizarGanhoEstimado();
  });
});


/* ============================================================
   PARSER DE MÚLTIPLOS LANÇAMENTOS (v34)
   Entende "+1500 salário -1000 contas -50 uber" numa linha,
   criando um lançamento para cada. O sinal manda:
   + = entrada, - = gasto. Sem sinal, usa palavras-chave.
   ============================================================ */

function parseMultiplosLancamentos(texto) {
  const itens = [];

  // Divide por + ou - que precedem um número (mantendo o sinal).
  // Ex: "+1500 salário -1000 contas" → ["+1500 salário", "-1000 contas"]
  // A regex captura: sinal opcional, número, e o texto até o próximo sinal+número
  const regex = /([+\-−])?\s*(\d[\d.,]*)\s*(?:reais?|r\$)?\s*([^+\-−]*)/gi;

  let m;
  let achouAlgum = false;
  while ((m = regex.exec(texto)) !== null) {
    const [, sinal, numStr, descRaw] = m;
    if (!numStr) continue;

    const valor = Number(numStr.replace(/\./g, "").replace(",", "."));
    if (!valor || isNaN(valor)) continue;

    achouAlgum = true;
    const desc = (descRaw || "").trim().replace(/^(de|do|da|no|na|em)\s+/i, "");

    // Determina o tipo:
    // sinal + = entrada, sinal - = gasto
    // sem sinal → usa palavras-chave no trecho
    let tipo;
    if (sinal === "+") tipo = "entrada";
    else if (sinal === "-" || sinal === "−") tipo = "gasto";
    else tipo = detectarTipo(desc || texto);

    itens.push({
      valor,
      tipo,
      descricao: desc || (tipo === "entrada" ? "Entrada" : "Gasto"),
      categoria: classificarCategoria(desc || texto)
    });
  }

  // Se não achou nenhum número, retorna vazio (o chamador trata)
  return achouAlgum ? itens : [];
}



/* Seletor de período do topo do dashboard (dropdown) —
   controla o gráfico e os cards ao mesmo tempo. */
(function initDashPeriodo() {
  const btn = document.getElementById("dashPeriodoBtn");
  const menu = document.getElementById("dashPeriodoMenu");
  const label = document.getElementById("dashPeriodoLabel");
  const datasEl = document.getElementById("dashPeriodoDatas");
  if (!btn || !menu) return;

  const nomes = {
    mes: "Este mês", mesanterior: "Mês anterior",
    proximomes: "Próximo mês", tudo: "Todo o período"
  };

  const fechar = () => { menu.hidden = true; };
  const alternar = () => { menu.hidden = !menu.hidden; };

  function atualizarLabel() {
    if (_periodoDatas) {
      const fmt = s => `${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)}`;
      label.textContent = "Personalizado";
      if (datasEl) datasEl.textContent = `${fmt(_periodoDatas.de)} – ${fmt(_periodoDatas.ate)}`;
    } else {
      label.textContent = nomes[_periodoTipo] || "Este mês";
      // Mostra o intervalo real ao lado, como no modelo
      if (datasEl) {
        const { ini, fim } = intervaloPeriodoDashboard();
        const fmt = s => `${s.slice(8,10)}/${s.slice(5,7)}`;
        datasEl.textContent = ini === fim ? fmt(ini) : `${fmt(ini)} – ${fmt(fim)}`;
      }
    }
  }

  function aplicarPeriodo(tipo) {
    _periodoDatas = null;
    _periodoTipo = tipo;
    menu.querySelectorAll(".dash-periodo-opcao").forEach(o =>
      o.classList.toggle("ativo", o.dataset.periodo === tipo));
    atualizarLabel();
    fechar();
    renderGraficoEvolucao();
    renderResumoDashboard();
    // "Saldo por conta" e "Cartões de crédito" também dependem do período
    // (o widget de cartões mostra a fatura do mês escolhido) — antes disso
    // aqui, essa seção nunca era re-renderizada ao trocar o filtro.
    renderContasDashboard();
  }

  btn.addEventListener("click", (e) => { e.stopPropagation(); alternar(); });

  menu.querySelectorAll(".dash-periodo-opcao").forEach(op => {
    op.addEventListener("click", () => aplicarPeriodo(op.dataset.periodo));
  });

  // Datas personalizadas
  const aplicarBtn = document.getElementById("dashDataAplicar");
  aplicarBtn?.addEventListener("click", () => {
    let de = document.getElementById("dashDataDe").value;
    let ate = document.getElementById("dashDataAte").value;
    if (!de || !ate) return;
    if (de > ate) [de, ate] = [ate, de];
    _periodoDatas = { de, ate };
    menu.querySelectorAll(".dash-periodo-opcao").forEach(o => o.classList.remove("ativo"));
    atualizarLabel();
    fechar();
    renderGraficoEvolucao();
    renderResumoDashboard();
    renderContasDashboard();
  });

  document.addEventListener("click", (e) => {
    if (menu.hidden) return;
    if (!menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) fechar();
  });

  // Deixa o rótulo certo no primeiro load
  atualizarLabel();
  window._atualizarLabelPeriodo = atualizarLabel;
})();



/* ============================================================
   SIDEBAR RECOLHÍVEL (v36)
   Recolhe para mostrar só ícones. Estado salvo entre sessões.
   ============================================================ */
function aplicarEstadoSidebar() {
  const recolhida = localStorage.getItem("fp_sidebar") === "recolhida";
  document.body.classList.toggle("sidebar-recolhida", recolhida);
  const btn = document.getElementById("sidebarToggle");
  if (btn) btn.setAttribute("title", recolhida ? "Expandir menu" : "Recolher menu");

  // Garante que cada item tenha o tooltip e que o texto esteja num span
  // (o texto vinha solto no button, por isso o CSS não conseguia escondê-lo)
  document.querySelectorAll(".sidebar .menu-item").forEach(item => {
    if (!item.dataset.tooltip) {
      item.dataset.tooltip = item.textContent.trim();
    }
    // Envolve nós de texto soltos num span.menu-label (uma vez só)
    if (!item.querySelector(".menu-label")) {
      item.childNodes.forEach(node => {
        if (node.nodeType === 3 && node.textContent.trim()) {
          const span = document.createElement("span");
          span.className = "menu-label";
          span.textContent = node.textContent.trim();
          node.replaceWith(span);
        }
      });
    }
  });
}

document.getElementById("sidebarToggle")?.addEventListener("click", () => {
  const recolhida = !document.body.classList.contains("sidebar-recolhida");
  localStorage.setItem("fp_sidebar", recolhida ? "recolhida" : "expandida");
  aplicarEstadoSidebar();
  // Os gráficos precisam remedir após a animação de largura
  setTimeout(() => {
    if (chartEvolucao) chartEvolucao.resize();
    if (chartCategoriasPlanilha) chartCategoriasPlanilha.resize();
    if (chartFluxoPlanilha) chartFluxoPlanilha.resize();
    if (chartSimulador) chartSimulador.resize();
  }, 280);
});

/* ============================================================
   MENU LATERAL EM GAVETA — CELULAR
   O mesmo menu do computador, só que escondido por padrão e
   deslizando da esquerda quando o botão hambúrguer é tocado. Fecha
   sozinho ao tocar no fundo escurecido ou em qualquer botão dele
   dentro (item de tela, "Ver conta", "Assistente FAZ"...).
   ============================================================ */
function abrirMenuMobile() { document.body.classList.add("menu-mobile-aberto"); }
function fecharMenuMobile() { document.body.classList.remove("menu-mobile-aberto"); }

document.getElementById("mobileMenuToggle")?.addEventListener("click", () => {
  document.body.classList.contains("menu-mobile-aberto") ? fecharMenuMobile() : abrirMenuMobile();
});
document.getElementById("sidebarBackdrop")?.addEventListener("click", fecharMenuMobile);
document.querySelector(".sidebar")?.addEventListener("click", (e) => {
  if (e.target.closest("button")) fecharMenuMobile();
});


/* ============================================================
   TAXA CDI AO VIVO (v37) — API do Banco Central
   Série 12 = CDI diário. Anualiza base 252 dias úteis.
   Cache de 12h (o CDI muda no máximo a cada reunião do Copom).
   ============================================================ */

const CDI_FALLBACK = 14.15;   // % a.a. — usado se a API falhar (jul/2026)
let _cdiAnual = null;         // taxa anualizada, ex: 14.15
let _cdiEm = 0;
const CACHE_CDI_MS = 12 * 60 * 60 * 1000;   // 12 horas

function carregarCacheCDI() {
  try {
    const raw = localStorage.getItem("fp_cdi");
    if (!raw) return;
    const o = JSON.parse(raw);
    if (o && o.taxa && o.em) { _cdiAnual = o.taxa; _cdiEm = o.em; }
  } catch {}
}

function salvarCacheCDI() {
  try { localStorage.setItem("fp_cdi", JSON.stringify({ taxa: _cdiAnual, em: _cdiEm })); } catch {}
}

/* A taxa CDI que o app usa agora (cache, fallback, ou já buscada) */
function cdiAtual() {
  return _cdiAnual || CDI_FALLBACK;
}

async function atualizarCDI(forcar = false) {
  const agora = Date.now();
  if (!forcar && _cdiAnual && (agora - _cdiEm) < CACHE_CDI_MS) return _cdiAnual;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    // Série 12 = CDI diário (% ao dia). Pega o último valor.
    const resp = await fetch(
      "https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados/ultimos/1?formato=json",
      { signal: ctrl.signal }
    );
    clearTimeout(t);
    if (!resp.ok) return cdiAtual();

    const dados = await resp.json();
    if (Array.isArray(dados) && dados.length) {
      const diaria = Number(String(dados[0].valor).replace(",", ".")); // % ao dia
      if (diaria > 0) {
        // Anualiza base 252 dias úteis: (1 + i)^252 - 1
        _cdiAnual = (Math.pow(1 + diaria/100, 252) - 1) * 100;
        _cdiEm = agora;
        salvarCacheCDI();
      }
    }
  } catch {
    // Rede caiu — segue com cache ou fallback
  }
  return cdiAtual();
}



/* ============================================================
   TAXA ANUAL EFETIVA (v37)
   Converte o que o usuário informou na taxa real ao ano,
   conforme o modo do investimento.
   - cdi:      taxa = % informado × CDI atual (ex: 105% → 14,86%)
   - taxa:     taxa fixa informada, direta
   - ipca:     taxa fixa + IPCA estimado
   - poupanca: 0,5% a.m. + TR (regra fixa)
   - variavel/cripto: sem taxa (retorna 0, valor vem do mercado)
   ============================================================ */

const IPCA_ESTIMADO = 4.0;   // % a.a. — inflação estimada (ajustável)

function taxaAnualEfetiva(inv) {
  const cfg = configTipo(inv.tipo);
  const modo = cfg.modo || "taxa";

  // A taxa que o usuário digitou, já normalizada para "ao ano"
  const taxaInformada = inv.taxaPeriodo === "mes"
    ? (Math.pow(1 + (inv.taxa||0)/100, 12) - 1) * 100
    : (inv.taxa || 0);

  switch (modo) {
    case "cdi":
      // inv.taxa aqui é o % do CDI (ex: 105). Converte com o CDI atual.
      return cdiAtual() * ((inv.taxa || 100) / 100);

    case "ipca":
      // taxa fixa informada + inflação estimada
      return taxaInformada + IPCA_ESTIMADO;

    case "poupanca":
      // 0,5% a.m. capitalizado + TR (~0 com juros altos)
      return (Math.pow(1.005, 12) - 1) * 100;

    case "variavel":
    case "cripto":
      // Renda variável: sem rendimento projetável por taxa
      return 0;

    case "taxa":
    default:
      return taxaInformada;
  }
}



/* Atualiza a conversão do CDI ao digitar o percentual */
document.getElementById("invTaxa")?.addEventListener("input", atualizarDicaCDI);

async function iniciar() {
  aplicarEstadoSidebar();
  carregarCacheCripto();
  carregarCacheCDI();
  popularSelectCripto();
  restaurarDicas();
  trocarAbaMeta(localStorage.getItem("fp_meta_aba") || "limites");
  restaurarPaineis();
  iniciarMarcaPicker();
  const ri = document.getElementById("recInicio");
  if (ri && !ri.value) ri.value = hojeISO();
  const tema = localStorage.getItem("fp_tema") || "dark";
  aplicarTema(tema);

  // ANTES de tudo: o usuário chegou pelo link de redefinição de senha?
  // Se sim, mostra a tela de nova senha e não tenta restaurar a sessão.
  if (verificarLinkRecuperacao()) {
    esconderSplash();
    return;
  }

  // O usuário acabou de voltar de um login social (Google)? Se sim, a
  // própria função já termina o login — não segue pro fluxo normal abaixo.
  if (await verificarLoginOAuth()) {
    return;
  }

  // Mostrar splash enquanto verifica sessão
  mostrarSplash();

  const tokenSalvo = localStorage.getItem("fp_token");
  const userSalvo  = localStorage.getItem("fp_user");

  if (tokenSalvo && userSalvo) {
    try {
      state.user = JSON.parse(userSalvo);
      // Sessões salvas antes do login guardar createdAt (versões antigas do
      // app) não têm essa data em cache — busca uma vez e completa o cache,
      // senão usuarioAnteriorAoPlanoUnico() nunca reconheceria essa conta.
      if (!state.user.createdAt) {
        try {
          const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${tokenSalvo}` }
          });
          if (res.ok) {
            const u = await res.json();
            state.user.createdAt = u.created_at || null;
            localStorage.setItem("fp_user", JSON.stringify(state.user));
          }
        } catch (e) { /* segue sem — cai no caminho conservador (trata como novo) */ }
      }
      document.getElementById("userEmail").textContent = state.user.email;
      iniciarRenovacaoAutomaticaDeSessao();
      await carregarDadosNuvem();
      // Cancelou/expirou o checkout: tratarRetornoAssinatura() já decidiu a
      // tela (manda pra landing) — não deixa o paywall sobrescrever.
      const retornoJaDecidiuTela = await tratarRetornoAssinatura();
      esconderSplash();
      if (!retornoJaDecidiuTela && mostrarAppOuPaywall()) {
        renderTudo();
        injetarBotoesGuia();
        trocarTela("dashboard");

        // Busca a taxa CDI atual em segundo plano (não trava a tela).
        // Sem isso, os rendimentos de CDB/LCI/Tesouro usariam o valor fixo do código.
        atualizarCDI().then(() => renderTudo()).catch(() => {});
        verificarExtratosPorEmail();
      }
    } catch(e) {
      localStorage.removeItem("fp_token");
      localStorage.removeItem("fp_refresh_token");
      localStorage.removeItem("fp_user");
      esconderSplash();
      mostrarTelaLogin();
    }
  } else {
    esconderSplash();
    mostrarTelaLogin();
  }

  if(dataMovimentoInput) dataMovimentoInput.value = hojeISO();
  if(transDataInput)     transDataInput.value     = hojeISO();
  const campoSaldoData = document.getElementById("saldoData");
  if (campoSaldoData && !campoSaldoData.value) campoSaldoData.value = hojeISO();
  atualizarCamposFiltro();
}

iniciar();
/* Tela de Planos e checkout do plano único: ver assinarPlanoUnico(),
   mostrarTelaAssinar() e mostrarAppOuPaywall(), definidas mais acima. */

// Liga o sino de notificações ao carregar
/* Monta um resumo compacto das finanças do usuário para enviar à IA.
   Isso dá contexto para a IA responder sobre a situação real do cliente. */
function montarResumoFinanceiro() {
  const linhas = [];
  const hoje = hojeISO();
  const [ano, mes] = hoje.split("-");
  const mesAtual = `${ano}-${mes}`;

  // ─── Perfil e plano do usuário ───
  const nome = (state.perfil?.nome || "").trim();
  const plano = (typeof planoAtual === "function") ? planoAtual() : (state.perfil?.plano || "basico");
  const nomePlano = plano === "master" ? "Master" : plano === "premium" ? "Premium" : "Básico";
  linhas.push(`Data de hoje: ${formatarDataBR(hoje)}`);
  if (nome) linhas.push(`Nome do usuário: ${nome}`);
  linhas.push(`Plano da conta: ${nomePlano}`);
  // Situação da assinatura, para a IA responder dúvidas de pagamento
  const statusAss = state.perfil?.assinaturaStatus;
  if (statusAss === "atrasada") {
    linhas.push("Situação: pagamento atrasado — o acesso pode ser suspenso em breve se não regularizar.");
  } else if (statusAss === "cancelada_falta_pagamento") {
    linhas.push("Situação: plano cancelado por falta de pagamento. Precisa assinar de novo para recuperar o acesso.");
  }
  // Dados da empresa (só faz sentido mostrar dentro do espaço Empresarial)
  if (state.contextoAtivo === "empresarial") {
    const { empresaCnpj, empresaRazaoSocial, empresaNomeFantasia } = state.perfil || {};
    if (empresaCnpj || empresaRazaoSocial || empresaNomeFantasia) {
      linhas.push("Dados da empresa cadastrados:");
      if (empresaRazaoSocial) linhas.push(`  - Razão social: ${empresaRazaoSocial}`);
      if (empresaNomeFantasia) linhas.push(`  - Nome fantasia: ${empresaNomeFantasia}`);
      if (empresaCnpj) linhas.push(`  - CNPJ: ${empresaCnpj}`);
    } else {
      linhas.push("Dados da empresa (CNPJ/razão social) ainda não cadastrados — pode sugerir preencher em Conta > Dados da empresa se for relevante.");
    }
  }
  linhas.push("");

  // ─── Categorias personalizadas (além das 14 de fábrica) ───
  // Sem isso a IA não tem como saber que uma categoria própria (ex:
  // "Aposta", "ADS") já existe — visto ao vivo: ela achou que só existiam
  // as de fábrica, disse que "Aposta não existe" e ofereceu criar de novo
  // uma categoria que a pessoa já tinha, gerando confusão.
  if (state.categorias && state.categorias.length) {
    linhas.push(`Categorias personalizadas já criadas por este usuário (além das 14 de fábrica do app): ${state.categorias.map(c => c.nome).join(", ")}.`);
    linhas.push("");
  }

  // ─── Saldo total e por conta ───
  const saldos = saldosPorConta();
  const saldoTotal = calcularSaldoTotal();
  linhas.push(`Saldo total (todas as contas): ${fmtMoeda(saldoTotal)}`);
  if (state.bancos.length) {
    linhas.push("Contas cadastradas:");
    state.bancos.forEach(b => {
      linhas.push(`  - ${b.nome}: ${fmtMoeda(saldos[b.id] ?? 0)}`);
    });
  } else {
    linhas.push("Nenhuma conta cadastrada ainda.");
  }
  linhas.push("");

  // ─── Transferências entre contas próprias ───
  // Sem isso a IA não enxerga state.transferencias — só os lançamentos
  // normais (movimentos) — e não consegue achar/apagar uma transferência
  // que o usuário pediu por nome/data/valor (ver excluir_transferencia).
  if (state.transferencias.length) {
    const bMapResumo = Object.fromEntries(state.bancos.map(b => [b.id, b.nome]));
    const transfOrdenadas = state.transferencias.slice().sort((a, b) => (b.data || "").localeCompare(a.data || ""));
    linhas.push(`Transferências entre contas próprias (${transfOrdenadas.length} no total, mais recentes primeiro — NÃO confundir com Pix/transferência para outra pessoa, que aparece nos lançamentos comuns abaixo):`);
    transfOrdenadas.slice(0, 15).forEach(t => {
      const origem = bMapResumo[t.origem] || "conta removida";
      const destino = bMapResumo[t.destino] || "conta removida";
      linhas.push(`  - ${formatarDataBR(t.data)}: ${fmtMoeda(t.valor)} de ${origem} para ${destino}${t.descricao ? " — " + t.descricao : ""}`);
    });
    if (transfOrdenadas.length > 15) linhas.push(`  ... e mais ${transfOrdenadas.length - 15} transferência(s) mais antiga(s).`);
    linhas.push("");
  }

  // ─── Gastos de HOJE ───
  // Compras no crédito ficam de fora — igual ao card de Gastos do dashboard:
  // elas só contam como saída de verdade quando a fatura é paga, não na hora
  // da compra (mesmo já entrando no banco como status "pago").
  const movsHoje = state.movimentos.filter(m => (m.data || "").slice(0,10) === hoje && ehPago(m) && m.formaPagamento !== "credito");
  const gastosHoje = movsHoje.filter(m => m.tipo === "gasto");
  const entradasHoje = movsHoje.filter(m => m.tipo === "entrada");
  const totalGastoHoje = gastosHoje.reduce((s,m) => s + m.valor, 0);
  const totalEntradaHoje = entradasHoje.reduce((s,m) => s + m.valor, 0);
  linhas.push(`Movimentações de HOJE (${formatarDataBR(hoje)}):`);
  if (gastosHoje.length) {
    linhas.push(`  - Gastos de hoje: ${fmtMoeda(totalGastoHoje)} em ${gastosHoje.length} lançamento(s)`);
    gastosHoje.forEach(m => {
      linhas.push(`      ${m.descricao}: ${fmtMoeda(m.valor)} (${m.categoria || "Outros"})`);
    });
  } else {
    linhas.push("  - Nenhum gasto registrado hoje.");
  }
  if (entradasHoje.length) {
    linhas.push(`  - Entradas de hoje: ${fmtMoeda(totalEntradaHoje)}`);
  }
  linhas.push("");

  // ─── Fluxo do mês atual ───
  // Mesma regra do card "Gastos" do dashboard: compra no crédito não é
  // gasto realizado até a fatura ser paga (ela aparece à parte, na seção
  // "Cartões de crédito" mais abaixo, com o valor da fatura em aberto).
  const movsMes = state.movimentos.filter(m => (m.data || "").slice(0,7) === mesAtual && ehPago(m) && m.formaPagamento !== "credito");
  const entradas = movsMes.filter(m => m.tipo === "entrada").reduce((s,m) => s + m.valor, 0);
  const gastos = movsMes.filter(m => m.tipo === "gasto").reduce((s,m) => s + m.valor, 0);
  const qtdGastosMes = movsMes.filter(m => m.tipo === "gasto").length;
  linhas.push(`Este mês (${MESES_PT[Number(mes)-1]}/${ano}):`);
  linhas.push(`  - Entradas recebidas: ${fmtMoeda(entradas)}`);
  linhas.push(`  - Gastos já pagos: ${fmtMoeda(gastos)} (${qtdGastosMes} lançamento(s) confirmados)`);
  linhas.push(`  - Saldo do mês: ${fmtMoeda(entradas - gastos)}`);

  // Gastos por categoria (este mês)
  const porCategoria = {};
  movsMes.filter(m => m.tipo === "gasto").forEach(m => {
    const cat = m.categoria || "Outros";
    porCategoria[cat] = (porCategoria[cat] || 0) + m.valor;
  });
  const cats = Object.entries(porCategoria).sort((a,b) => b[1] - a[1]);
  if (cats.length) {
    linhas.push("  - Gastos por categoria:");
    cats.forEach(([c,v]) => {
      const pct = gastos > 0 ? Math.round((v/gastos)*100) : 0;
      linhas.push(`      ${c}: ${fmtMoeda(v)} (${pct}%)`);
    });
  }
  linhas.push("");

  // ─── Lançamentos por DIA (últimos 30 dias) ───
  // Permite à IA responder "quanto gastei no dia 26", "e ontem?", etc.
  const limite30 = somarDias(hoje, -30);
  const movsRecentes = state.movimentos
    .filter(m => ehPago(m) && m.formaPagamento !== "credito" && (m.data || "").slice(0,10) >= limite30 && (m.data || "").slice(0,10) <= hoje)
    .sort((a,b) => (b.data || "").localeCompare(a.data || ""));
  if (movsRecentes.length) {
    // Agrupa por dia
    const porDia = {};
    movsRecentes.forEach(m => {
      const d = m.data.slice(0,10);
      (porDia[d] = porDia[d] || []).push(m);
    });
    linhas.push("Lançamentos dos últimos 30 dias (dia a dia — use para responder sobre datas específicas):");
    // Se há muitos lançamentos, detalha só os dias mais recentes para não
    // pesar demais; os dias mais antigos ficam só com o total do dia.
    const detalharAte = movsRecentes.length > 120 ? 40 : Infinity;
    let jaDetalhados = 0;
    Object.keys(porDia).sort((a,b) => b.localeCompare(a)).forEach(dia => {
      const doDia = porDia[dia];
      const gastoDia = doDia.filter(m => m.tipo === "gasto").reduce((s,m) => s + m.valor, 0);
      const entradaDia = doDia.filter(m => m.tipo === "entrada").reduce((s,m) => s + m.valor, 0);
      let resumoDia = `  ${formatarDataBR(dia)}:`;
      if (gastoDia > 0) resumoDia += ` gastou ${fmtMoeda(gastoDia)}`;
      if (entradaDia > 0) resumoDia += `${gastoDia > 0 ? "," : ""} recebeu ${fmtMoeda(entradaDia)}`;
      if (gastoDia === 0 && entradaDia === 0) resumoDia += " sem movimentação";
      linhas.push(resumoDia);
      // Detalha cada lançamento do dia (até o teto)
      if (jaDetalhados < detalharAte) {
        doDia.forEach(m => {
          const sinal = m.tipo === "entrada" ? "+" : "-";
          linhas.push(`      ${sinal}${fmtMoeda(m.valor)} ${m.descricao} (${m.categoria || "Outros"})`);
          jaDetalhados++;
        });
      }
    });
    linhas.push("");
  }

  // ─── Histórico dos últimos 3 meses ───
  const historico = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(Number(ano), Number(mes)-1-i, 1);
    const mAno = d.getFullYear();
    const mMes = String(d.getMonth()+1).padStart(2,"0");
    const chave = `${mAno}-${mMes}`;
    const movs = state.movimentos.filter(m => (m.data||"").slice(0,7) === chave && ehPago(m) && m.formaPagamento !== "credito");
    if (!movs.length) continue;
    const ent = movs.filter(m => m.tipo === "entrada").reduce((s,m)=>s+m.valor,0);
    const gas = movs.filter(m => m.tipo === "gasto").reduce((s,m)=>s+m.valor,0);
    historico.push(`  - ${MESES_PT[d.getMonth()]}/${mAno}: entradas ${fmtMoeda(ent)}, gastos ${fmtMoeda(gas)}, saldo ${fmtMoeda(ent-gas)}`);
  }
  if (historico.length) {
    linhas.push("Histórico dos últimos meses:");
    linhas.push(...historico);
    linhas.push("");
  }

  // ─── Metas de gasto ───
  if (state.metas.length) {
    linhas.push("Metas de gasto (limite por categoria):");
    state.metas.forEach(meta => {
      const gasto = movsMes.filter(m => m.tipo === "gasto" && m.categoria === meta.categoria).reduce((s,m) => s + m.valor, 0);
      const pct = meta.limite > 0 ? Math.round((gasto/meta.limite)*100) : 0;
      const situacao = gasto > meta.limite ? " (ESTOUROU)" : "";
      linhas.push(`  - ${meta.categoria}: gastou ${fmtMoeda(gasto)} de ${fmtMoeda(meta.limite)} (${pct}%)${situacao}`);
    });
    linhas.push("");
  }

  // ─── Lançamentos pendentes (aguardando confirmação) ───
  const pendentes = state.movimentos.filter(m => m.status === "pendente");
  if (pendentes.length) {
    const totalPend = pendentes.filter(m => m.tipo === "gasto").reduce((s,m) => s + m.valor, 0);
    linhas.push(`Contas agendadas ainda NÃO pagas (${fmtMoeda(totalPend)} a pagar — isto é diferente dos gastos já feitos):`);
    pendentes.slice(0, 10).forEach(m => {
      const tipo = m.tipo === "entrada" ? "a receber" : "a pagar";
      linhas.push(`  - ${m.descricao}: ${tipo} ${fmtMoeda(m.valor)}${m.vencimento ? " (vence " + formatarDataBR(m.vencimento) + ")" : ""}`);
    });
    linhas.push("");
  }

  // ─── Objetivos de economia ───
  if (state.objetivos && state.objetivos.length) {
    linhas.push("Objetivos de economia:");
    state.objetivos.forEach(o => {
      const guardado = o.guardado || o.valorAtual || 0;
      const alvo = o.valor || o.alvo || 0;
      const pct = alvo > 0 ? Math.round((guardado/alvo)*100) : 0;
      linhas.push(`  - ${o.nome}: ${fmtMoeda(guardado)} de ${fmtMoeda(alvo)} (${pct}%)`);
    });
    linhas.push("");
  }

  // ─── Recorrências ativas ───
  const recAtivas = (state.recorrencias || []).filter(r => r.ativa !== false);
  if (recAtivas.length) {
    linhas.push("Contas e receitas recorrentes:");
    recAtivas.forEach(r => {
      const tipo = r.tipo === "entrada" ? "recebe" : "paga";
      linhas.push(`  - ${r.descricao}: ${tipo} ${fmtMoeda(r.valor)} (dia ${r.dia || "?"}, ${r.frequencia || "mensal"})`);
    });
    linhas.push("");
  }

  // ─── Contas a vencer (próximos 30 dias) ───
  const compromissos = todosCompromissos(somarDias(hoje, 30)).filter(c => c.tipo === "gasto");
  if (compromissos.length) {
    linhas.push("Contas a pagar nos próximos 30 dias:");
    compromissos.slice(0, 8).forEach(c => {
      linhas.push(`  - ${c.descricao}: ${fmtMoeda(c.valor)} vence em ${formatarDataBR(c.vencimento)}`);
    });
    linhas.push("");
  }

  // ─── Investimentos detalhados ───
  if (state.investimentos.length) {
    const totalInv = state.investimentos.reduce((s,i) => s + (i.criptoId ? valorAtualCripto(i) : valorRendaFixaHoje(i)), 0);
    linhas.push(`Investimentos (total: ${fmtMoeda(totalInv)}):`);
    state.investimentos.forEach(inv => {
      const nomeInv = inv.nome || inv.tipo;
      const valorAtual = inv.criptoId ? valorAtualCripto(inv) : valorRendaFixaHoje(inv);
      let detalhe = `  - ${nomeInv} (${inv.tipo}): ${fmtMoeda(valorAtual)}`;
      if (!inv.criptoId && inv.taxa > 0) {
        detalhe += `, taxa ${fmtNum(inv.taxa)}% ${inv.taxaPeriodo === "mes" ? "a.m." : "a.a."}`;
      }
      linhas.push(detalhe);
    });
    linhas.push("");
  }

  // ─── Notas fiscais (Empresarial) ───
  // Mesmo motivo da seção de transferências: sem isso a IA não enxerga
  // state.notasFiscais e não consegue achar/apagar uma nota que o usuário
  // pediu por cliente/fornecedor, número ou valor.
  if (state.notasFiscais && state.notasFiscais.length) {
    const nfOrdenadas = state.notasFiscais.slice().sort((a, b) => (b.data || "").localeCompare(a.data || ""));
    const totalEmitidas = state.notasFiscais.filter(n => n.tipo === "emitida").reduce((s, n) => s + n.valor, 0);
    const totalRecebidas = state.notasFiscais.filter(n => n.tipo === "recebida").reduce((s, n) => s + n.valor, 0);
    linhas.push(`Notas fiscais registradas (${nfOrdenadas.length} no total — emitidas ${fmtMoeda(totalEmitidas)}, recebidas ${fmtMoeda(totalRecebidas)}; é só REGISTRO/controle, não emite NF-e de verdade):`);
    nfOrdenadas.slice(0, 15).forEach(n => {
      const quem = n.clienteFornecedor ? ` — ${n.clienteFornecedor}` : "";
      const num = n.numero ? ` (Nº ${n.numero})` : "";
      linhas.push(`  - ${formatarDataBR(n.data)}: ${n.tipo === "emitida" ? "Emitida" : "Recebida"} ${fmtMoeda(n.valor)}${quem}${num}`);
    });
    if (nfOrdenadas.length > 15) linhas.push(`  ... e mais ${nfOrdenadas.length - 15} nota(s) mais antiga(s).`);
    linhas.push("");
  }

  // ─── Clientes e fornecedores cadastrados (Empresarial) ───
  // Mesmo motivo das seções acima: sem isso a IA não sabe quem já está
  // cadastrado e não consegue achar/apagar um cadastro, nem avisar que
  // já existe antes de criar duplicado.
  if (state.contatos && state.contatos.length) {
    const rotuloTipo = { cliente: "cliente", fornecedor: "fornecedor", ambos: "cliente e fornecedor" };
    linhas.push(`Clientes e fornecedores cadastrados (${state.contatos.length} no total):`);
    state.contatos.slice(0, 20).forEach(c => {
      const notas = state.notasFiscais.filter(n => n.contatoId === c.id);
      const totalEmitidas = notas.filter(n => n.tipo === "emitida").reduce((s, n) => s + n.valor, 0);
      const totalRecebidas = notas.filter(n => n.tipo === "recebida").reduce((s, n) => s + n.valor, 0);
      const partes = [];
      if (totalEmitidas > 0) partes.push(`emitido ${fmtMoeda(totalEmitidas)}`);
      if (totalRecebidas > 0) partes.push(`recebido ${fmtMoeda(totalRecebidas)}`);
      linhas.push(`  - ${c.nome} (${rotuloTipo[c.tipo] || "cliente"})${partes.length ? ": " + partes.join(", ") : ""}`);
    });
    if (state.contatos.length > 20) linhas.push(`  ... e mais ${state.contatos.length - 20} cadastro(s).`);
    linhas.push("");
  }

  // ─── Última importação de extrato (se recente) ───
  // Para a IA responder "quanto gastei no extrato que enviei?"
  if (ultimaImportacao) {
    const minAtras = Math.round((Date.now() - ultimaImportacao.quando) / 60000);
    const imp = ultimaImportacao;
    const situacao = imp.salvo
      ? (imp.jaExistiam ? ` (${imp.novosSalvos} salvos agora, ${imp.jaExistiam} já existiam)` : " (salvo)")
      : " (em revisão, ainda não salvo)";
    linhas.push(`ÚLTIMO EXTRATO IMPORTADO pelo usuário (há ${minAtras} min, conta ${imp.conta})${situacao}:`);
    linhas.push(`  - O extrato tem ${imp.total} lançamento(s)` +
      (imp.dataInicio ? `, de ${formatarDataBR(imp.dataInicio)} a ${formatarDataBR(imp.dataFim)}` : "") + ".");
    linhas.push(`  - Total de GASTOS no extrato: ${fmtMoeda(imp.totalGasto)} em ${imp.qtdGastos} lançamento(s).`);
    linhas.push(`  - Total de ENTRADAS no extrato: ${fmtMoeda(imp.totalEntrada)} em ${imp.qtdEntradas} lançamento(s).`);
    linhas.push("  - Se o usuário perguntar sobre 'o extrato que enviei', 'esses lançamentos' ou algo recém-importado, é DESTE extrato que ele fala. Use EXATAMENTE estes números.");
    if (imp.itens && imp.itens.length) {
      linhas.push("  - Lançamentos do extrato:");
      imp.itens.slice(0, 40).forEach(it => {
        const t = it.tipo === "entrada" ? "entrada" : "gasto";
        linhas.push(`      ${formatarDataBR(it.data)} ${it.descricao}: ${fmtMoeda(it.valor)} (${t}, ${it.categoria || "Outros"})`);
      });
    }
    linhas.push("");
  }

  // ─── Cartões de crédito e faturas ───
  const cartoes = state.bancos.filter(b => b.temCartao);
  if (cartoes.length) {
    linhas.push("Cartões de crédito:");
    cartoes.forEach(c => {
      const disp = (typeof limiteDisponivel === "function") ? limiteDisponivel(c.id) : null;
      const faturaMes = (typeof proximaFaturaAberta === "function") ? proximaFaturaAberta(c.id) : null;
      const totalFat = (faturaMes && typeof totalFatura === "function") ? totalFatura(c.id, faturaMes) : 0;
      let linha = `  - ${c.nome}: limite ${fmtMoeda(c.limite || 0)}`;
      if (disp != null) linha += `, disponível ${fmtMoeda(disp)}`;
      if (totalFat > 0 && faturaMes) {
        const venc = (typeof vencimentoDaFatura === "function") ? vencimentoDaFatura(faturaMes, c) : null;
        linha += `, fatura em aberto ${fmtMoeda(totalFat)}`;
        if (venc) linha += ` (vence ${formatarDataBR(venc)})`;
      } else {
        linha += ", sem fatura em aberto";
      }
      linhas.push(linha);
    });
    linhas.push("");
  }

  return linhas.join("\n").trim();
}

initSino();

/* ═══════════════════════════════════════════════════════════
   AÇÕES DA IA — o assistente FAZ, não só ensina

   Registro único: cada ação diz o que a IA precisa informar
   (parametros), como o app entende o que ela mandou (preparar)
   e como grava de verdade (executar).

   Para ensinar uma função nova ao assistente, basta acrescentar
   uma entrada aqui — o resto (enviar para a IA, perguntar o que
   faltou, gravar, confirmar) já funciona sozinho.

   REGRA DE OURO: o app resolve tudo que der para resolver.
   Só pergunta o que não dá para adivinhar sem risco de errar —
   e, quando pergunta, é UMA pergunta de cada vez, em botões.
   Nunca um formulário: para isso já existe a tela do app.

   Quem grava é sempre o app, nunca o servidor: assim reaproveita
   as mesmas regras dos formulários (saldo, limite do cartão,
   recorrência, cache de saldos).
   ═══════════════════════════════════════════════════════════ */

/* Compara textos digitados de qualquer jeito: sem acento, sem caixa */
function normIA(s) {
  return String(s == null ? "" : s)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim();
}

/* Acha a conta pelo nome que a IA mandou (ou pelo id, quando a
   escolha veio dos botões). Null quando não achou ou ficou ambíguo. */
function acharContaIA(nome, universo) {
  const lista = universo || state.bancos || [];
  const bruto = String(nome == null ? "" : nome).trim();
  if (!bruto || !lista.length) return null;

  const porId = lista.find(b => String(b.id) === bruto);
  if (porId) return porId;

  const n = normIA(bruto);

  // Igual, ou o texto começa com o nome da conta: casamento seguro.
  const exato = lista.filter(b => normIA(b.nome) === n);
  if (exato.length === 1) return exato[0];
  const comeca = lista.filter(b => normIA(b.nome).startsWith(n));
  if (comeca.length === 1) return comeca[0];

  // Conteúdo: SÓ aceitamos quando o nome da conta aparece como palavra(s)
  // inteira(s) dentro do texto — nunca como pedaço solto. Sem isso,
  // "mercado pago" (o lugar do gasto) casava com a conta "Mercado Pago"
  // e o dinheiro saía da conta errada.
  const contemPalavra = (frase, alvo) => {
    const re = new RegExp("(^|\\s)" + alvo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\s|$)");
    return re.test(frase);
  };
  const contem = lista.filter(b => {
    const nb = normIA(b.nome);
    return contemPalavra(n, nb) || contemPalavra(nb, n);
  });
  if (contem.length === 1) return contem[0];
  return null;
}

/* Acha a categoria pelo nome, aceitando abreviação ("aliment") */
function acharCategoriaIA(nome) {
  const todas = todasCategorias();
  const n = normIA(nome);
  if (!n) return null;
  return todas.find(c => normIA(c) === n)
      || todas.find(c => normIA(c).startsWith(n))
      || todas.find(c => normIA(c).includes(n))
      || null;
}

/* Entende a data que a IA mandou: ISO, 05/08, "ontem", "amanhã".
   Sem nada reconhecível, assume hoje. */
function resolverDataIA(txt) {
  const hoje = hojeISO();
  const t = normIA(txt);
  if (!t || t === "hoje") return hoje;
  if (t === "ontem") return somarDias(hoje, -1);
  if (t === "anteontem") return somarDias(hoje, -2);
  if (t === "amanha") return somarDias(hoje, 1);
  if (t === "depois de amanha") return somarDias(hoje, 2);
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;

  const br = t.match(/^(\d{1,2})[\/\.\-](\d{1,2})(?:[\/\.\-](\d{2,4}))?$/);
  if (br) {
    const dia = Number(br[1]), mes = Number(br[2]);
    if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) {
      let ano = br[3] ? Number(br[3]) : Number(hoje.slice(0, 4));
      if (ano < 100) ano += 2000;
      return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    }
  }
  return hoje;
}

/* Número vindo da IA ou dos botões ("1.234,56" ou 1234.56) */
function valorIA(v) {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  let s = String(v == null ? "" : v).replace(/[^\d,.\-]/g, "").trim();
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/* Quantas vezes cada conta e cada categoria já foram usadas.
   Serve para pôr o mais provável como primeiro botão. */
function usoPorContaIA() {
  const c = {};
  (state.movimentos || []).forEach(m => { c[m.bancoId] = (c[m.bancoId] || 0) + 1; });
  return c;
}
function usoPorCategoriaIA() {
  const c = {};
  (state.movimentos || []).forEach(m => {
    if (m.tipo === "gasto" && m.categoria) c[m.categoria] = (c[m.categoria] || 0) + 1;
  });
  return c;
}

/* Botões de conta, os mais usados primeiro */
function opcoesContasIA(lista) {
  const uso = usoPorContaIA();
  return (lista || state.bancos || [])
    .slice()
    .sort((a, b) => (uso[b.id] || 0) - (uso[a.id] || 0))
    .map(b => ({ v: b.id, t: b.nome, extra: fmtMoeda(calcularSaldoBanco(b.id)) }));
}

/* Botões de categoria, as mais usadas primeiro, com a cor da categoria */
function opcoesCategoriasIA() {
  const uso = usoPorCategoriaIA();
  return todasCategorias()
    .slice()
    .sort((a, b) => (uso[b] || 0) - (uso[a] || 0))
    .map(c => ({ v: c, t: c, cor: (typeof corDaCategoria === "function" ? corDaCategoria(c) : null) }));
}

/* Cria uma categoria personalizada com o nome que o usuário digitou nos
   botões (opção "Outra..."). Se já existir com esse nome, reaproveita.
   Devolve o nome final da categoria (o que fica no lançamento). */
async function criarCategoriaIA(nome) {
  const limpo = String(nome == null ? "" : nome).trim().slice(0, 40);
  if (!limpo) return null;

  // Já existe (ignora acento/caixa)? Usa a existente, não duplica.
  const existente = todasCategorias().find(c => normIA(c) === normIA(limpo));
  if (existente) return existente;
  if (normIA(limpo) === "entrada") return "Entrada";

  try {
    const cores = (typeof CORES_CATEGORIA !== "undefined") ? CORES_CATEGORIA : ["#7F77DD"];
    const cor = cores[(state.categorias || []).length % cores.length];
    const nova = await dbInsert("categorias", { user_id: state.user.id, nome: limpo, cor });
    state.categorias.push({ id: nova.id, nome: nova.nome, cor: nova.cor || cor });
    state.categorias.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    if (typeof atualizarSelectsCategoria === "function") atualizarSelectsCategoria();
    return nova.nome;
  } catch (e) {
    console.error("Falha ao criar categoria pela IA:", e);
    // Se falhou por já existir, ainda assim devolve o nome
    if (String(e && e.message || "").includes("duplicate")) return limpo;
    return null;
  }
}

/* ─── O registro ───────────────────────────────────────────── */
const ACOES_IA = {

  criar_lancamento: {
    descricao:
      "Registra um gasto ou uma entrada na conta do usuário. Use sempre que ele pedir para adicionar, lançar, registrar ou anotar um gasto, uma compra, um pagamento feito, ou um dinheiro que entrou. Também serve para agendar uma conta a pagar futura.",
    parametros: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["gasto", "entrada"], description: "gasto para saídas de dinheiro, entrada para receitas" },
        valor: { type: "number", description: "Valor em reais, sempre positivo. Se ele não disse o valor, NÃO chame esta ferramenta: pergunte o valor numa mensagem normal." },
        descricao: { type: "string", description: "O que foi, em poucas palavras: Mercado, Uber, Salário. Para GASTO pode deixar vazio (o app resolve). Para ENTRADA, sempre diga de onde veio (salário, venda, freela) — se ele não disse, pergunte antes de chamar a ferramenta." },
        conta: { type: "string", description: "Nome da conta ou banco, como está cadastrado. Deixe vazio se ele não disse." },
        categoria: { type: "string", description: "Categoria do gasto. Deixe vazio para o app escolher sozinho pela descrição. Também vale pra ENTRADA quando o dinheiro tem a ver com uma categoria que já existe (ex: 'ganhei 45 em aposta' → categoria 'Aposta', se essa categoria existir) — assim entrada e gasto da mesma categoria aparecem juntos na Planilha. Sem essa pista, deixe vazio: o app usa 'Entrada' sozinho." },
        data: { type: "string", description: "AAAA-MM-DD, ou hoje / ontem / amanhã. Padrão: hoje." },
        forma: { type: "string", enum: ["debito", "credito", "pix", "dinheiro"], description: "Forma de pagamento. Padrão: debito. Use credito só se ele disser que foi no cartão de crédito." },
        situacao: { type: "string", enum: ["pago", "agendar"], description: "pago = já aconteceu. agendar = conta futura, ainda não paga. Padrão: pago." },
        parcelas: { type: "number", description: "Número de parcelas, só para compra no cartão de crédito. Padrão: 1." }
      },
      required: ["tipo", "valor"]
    },

    preparar(d) {
      const contas = state.bancos || [];
      if (!contas.length) {
        return { erro: "O usuário ainda não cadastrou nenhuma conta, então não dá para lançar nada. Explique que ele precisa cadastrar o banco dele primeiro, na tela Adicionar Banco." };
      }

      const p = {};
      p.tipo = normIA(d.tipo) === "entrada" ? "entrada" : "gasto";
      p.valor = valorIA(d.valor);
      p.descricao = String(d.descricao == null ? "" : d.descricao).trim().slice(0, 120);
      p.data = resolverDataIA(d.data);

      if (!p.valor) {
        return { erro: "Não veio o valor, e você NUNCA deve inventar um. Pergunte a ele quanto foi, numa frase curta. Se ele disse só o que comprou (ex: 'uber'), pergunte quanto custou antes de registrar." };
      }

      // A forma de pagamento: se a IA/usuário informou uma válida, respeitamos.
      // Senão, fica "" (indefinida) — e para GASTO viramos uma pergunta em
      // botões. Entrada não tem forma de pagamento, então assume débito.
      const formasValidas = ["debito", "credito", "pix", "dinheiro"];
      const formaDita = formasValidas.includes(normIA(d.forma)) ? normIA(d.forma) : "";
      p.forma = formaDita;
      if (p.tipo === "entrada") p.forma = "debito";

      const sit = normIA(d.situacao);
      p.situacao = (sit === "agendar" || sit === "pendente" || sit === "agendado") ? "agendar" : "pago";

      // Parcelas só existem no crédito. "avista" = 1; número = parcelado.
      p.parcelas = Math.min(12, Math.max(1, Math.round(Number(d.parcelas) || 1)));

      // No crédito, só cartões entram na escolha de conta
      const universo = p.forma === "credito" ? contas.filter(b => b.temCartao) : contas;
      if (p.forma === "credito" && !universo.length) {
        return { erro: "Não há nenhum cartão de crédito cadastrado. Explique que ele precisa marcar 'Este banco tem cartão de crédito' ao editar o banco, informando limite, fechamento e vencimento." };
      }

      const conta = acharContaIA(d.conta, universo);
      p.contaId = conta ? conta.id : (universo.length === 1 ? universo[0].id : "");

      // Defesa contra o "Mercado Pago": se a conta que a IA mandou é quase
      // igual à descrição do gasto, é sinal de que ela confundiu o LUGAR do
      // gasto com a CONTA (gastei no "mercado" ≠ conta "Mercado Pago").
      // Nesse caso descartamos a conta e deixamos o app perguntar.
      // MAS: se a conta veio de um TOQUE do usuário nos botões (_contaConfirmada),
      // ela é definitiva — o usuário apontou, não há o que desconfiar. Sem essa
      // exceção, a pergunta entraria em loop (a descrição continua igual).
      if (conta && p.descricao && !d._contaConfirmada) {
        const nc = normIA(conta.nome), nd = normIA(p.descricao);
        if (nc === nd || nc.includes(nd) || nd.includes(nc)) {
          p.contaId = universo.length === 1 ? universo[0].id : "";
        }
      }
      // Entrada normalmente é só "Entrada" (a origem já fica na descrição),
      // MAS se o usuário deu uma pista de categoria que bate com uma
      // categoria de verdade (ex: "ganhei 45 em aposta" → tem a categoria
      // "Aposta"), usa ela — assim entradas e gastos da mesma categoria
      // aparecem juntos na Planilha, mostrando o resultado líquido. Sem
      // pista nenhuma, ou sem bater com nada, cai no genérico "Entrada".
      p.categoria = p.tipo === "entrada"
        ? (acharCategoriaIA(d.categoria) || "Entrada")
        : (acharCategoriaIA(d.categoria) || "");

      // Entrada sem descrição vira um "Entrada" genérico que ninguém entende
      // depois. Não há opção fechada para "de onde veio", então isso não é
      // botão: devolvemos para a IA perguntar em texto. Rede de segurança
      // para quando a IA esquece de perguntar antes.
      if (p.tipo === "entrada" && !p.descricao) {
        return { erro: `Esta entrada de ${fmtMoeda(p.valor)} está sem origem, e um lançamento "Entrada" sem nome fica impossível de entender depois. Use a ferramenta perguntar_opcoes (nunca texto livre) perguntando de onde veio esse dinheiro, com opções tipo Salário, Venda, Freela, Presente, e chame esta ferramenta de novo com a resposta na descrição. NÃO invente a origem.` };
      }

      // ─── O que perguntar, em botões, uma coisa de cada vez ───
      // A ordem importa: categoria → forma → à vista/parcelado → parcelas →
      // conta. Assim, escolher "crédito" já abre a próxima pergunta certa.
      const perguntas = [];

      // 1. Categoria (só gasto, e só se não deu para deduzir da descrição).
      //    permiteOutra: o usuário pode digitar uma categoria própria se
      //    nenhum botão servir — ela é criada de vez.
      if (p.tipo === "gasto" && !p.categoria && !p.descricao) {
        perguntas.push({
          campo: "categoria",
          texto: "Qual a categoria desse gasto?",
          opcoes: opcoesCategoriasIA(),
          permiteOutra: true,
          rotuloOutra: "Outra..."
        });
      }

      // 2. Forma de pagamento (só gasto; entrada não tem). Pergunta sempre
      //    que ele não disser.
      const temCartaoCadastrado = contas.some(b => b.temCartao);
      if (p.tipo === "gasto" && !p.forma) {
        const opcoesForma = [
          { v: "debito", t: "Débito" },
          { v: "pix", t: "Pix" },
          { v: "dinheiro", t: "Dinheiro" }
        ];
        // Crédito só faz sentido se houver cartão cadastrado
        if (temCartaoCadastrado) opcoesForma.splice(1, 0, { v: "credito", t: "Crédito" });
        perguntas.push({ campo: "forma", texto: "Como você pagou?", opcoes: opcoesForma });
      }

      // 3. Crédito: à vista ou parcelado? (só se ele não disse as parcelas)
      if (p.tipo === "gasto" && p.forma === "credito" && !d._parcelamentoConfirmado && !Number(d.parcelas)) {
        perguntas.push({
          campo: "_avista",
          texto: "No crédito, foi à vista ou parcelado?",
          opcoes: [
            { v: "avista", t: "À vista" },
            { v: "parcelado", t: "Parcelado" }
          ]
        });
      }

      // 4. Parcelado: quantas vezes? (botões 2x a 12x)
      if (p.tipo === "gasto" && p.forma === "credito" && normIA(d._avista) === "parcelado" && p.parcelas < 2) {
        const botoes = [];
        for (let i = 2; i <= 12; i++) botoes.push({ v: String(i), t: i + "x" });
        perguntas.push({ campo: "parcelas", texto: "Em quantas vezes?", opcoes: botoes });
      }

      // 5. Conta / cartão (não dá para chutar: erraria o saldo)
      if (!p.contaId) {
        perguntas.push({
          campo: "conta",
          texto: p.forma === "credito"
            ? "Em qual cartão foi essa compra?"
            : (p.tipo === "entrada" ? "Em qual conta esse dinheiro entrou?" : "De qual conta saiu esse gasto?"),
          opcoes: opcoesContasIA(universo)
        });
      }

      return { dados: p, perguntas: perguntas };
    },

    async executar(p) {
      const conta = (state.bancos || []).find(b => b.id === p.contaId);
      if (!conta) return { ok: false, mensagem: "Não encontrei essa conta." };

      const pendente = p.situacao === "agendar";
      const ehCredito = p.forma === "credito";

      let categoria = p.categoria;
      if (p.tipo === "entrada") categoria = "Entrada";
      else if (!categoria) categoria = await categorizarComIA(p.descricao);

      // Sem descrição, o nome do lançamento vira a própria categoria
      const descricao = p.descricao || categoria;

      // As mesmas travas do formulário: limite do cartão e saldo da conta
      if (ehCredito) {
        const disp = limiteDisponivel(p.contaId);
        if (disp != null && p.valor > disp) {
          return { ok: false, mensagem: `Limite insuficiente no ${conta.nome}: disponível ${fmtMoeda(disp)} e a compra é de ${fmtMoeda(p.valor)}.` };
        }
      } else if (!pendente && p.tipo === "gasto") {
        const saldo = calcularSaldoBanco(p.contaId);
        if (p.valor > saldo + 0.005) {
          return { ok: false, mensagem: `Saldo insuficiente em ${conta.nome}: o saldo é ${fmtMoeda(saldo)} e o gasto é de ${fmtMoeda(p.valor)}. Ele pode transferir de outra conta antes, ou agendar esse gasto em vez de marcá-lo como pago.` };
        }
      }

      if (ehCredito && p.tipo === "gasto" && !pendente) {
        await lancarCompraCredito(
          { descricao: descricao, valor: p.valor, categoria },
          p.contaId, p.data, p.parcelas
        );
      } else {
        const novo = await dbInsert("movimentos", {
          descricao: descricao, conta_id: p.contaId, data: p.data,
          valor: p.valor, tipo: p.tipo, categoria,
          status: pendente ? "pendente" : "pago",
          vencimento: pendente ? p.data : null,
          pago_em: pendente ? null : p.data,
          forma_pagamento: p.forma
        });
        state.movimentos.push({
          id: novo.id, descricao: novo.descricao, bancoId: novo.conta_id, data: novo.data,
          valor: Number(novo.valor), tipo: novo.tipo, categoria: novo.categoria,
          status: novo.status, vencimento: novo.vencimento, pagoEm: novo.pago_em,
          formaPagamento: novo.forma_pagamento || p.forma
        });
      }

      renderTudo();

      const rotulo = p.tipo === "entrada"
        ? (pendente ? "Entrada agendada" : "Entrada registrada")
        : (pendente ? "Conta a pagar agendada" : "Gasto registrado");
      const recibo = [
        { rotulo: "Valor", valor: fmtMoeda(p.valor) },
        { rotulo: p.forma === "credito" ? "Cartão" : "Conta", valor: conta.nome },
        { rotulo: "Categoria", valor: categoria },
        { rotulo: pendente ? "Vence em" : "Data", valor: formatarDataBR(p.data) }
      ];
      if (p.descricao) recibo.unshift({ rotulo: p.tipo === "entrada" ? "Entrada" : "Gasto", valor: p.descricao });
      if (ehCredito && p.parcelas > 1) recibo.push({ rotulo: "Parcelas", valor: `${p.parcelas}x` });

      return {
        ok: true,
        titulo: rotulo,
        recibo,
        mensagem: `${rotulo}: ${descricao}, ${fmtMoeda(p.valor)}, conta ${conta.nome}, categoria ${categoria}, data ${formatarDataBR(p.data)}. ` +
                  `Saldo dessa conta agora: ${fmtMoeda(calcularSaldoBanco(p.contaId))}.`
      };
    }
  },

  perguntar_opcoes: {
    descricao:
      "Pergunta uma informação curta ao usuário mostrando botões com respostas prováveis, sempre com a opção dele escrever algo diferente. Use isso em vez de fazer a pergunta só em texto sempre que houver de 2 a 4 respostas prováveis pra sugerir — por exemplo o que foi um gasto sem descrição, ou de onde veio uma entrada sem origem. NÃO use para categoria, forma de pagamento, conta ou parcelas de um lançamento: essas o próprio app já pergunta em botões automaticamente depois que você chama a ferramenta certa (criar_lancamento etc.) — chamar esta ferramenta pra isso duplicaria a pergunta.",
    parametros: {
      type: "object",
      properties: {
        texto: { type: "string", description: "A pergunta, curta e direta. Ex: 'O que foi esse gasto de R$ 30,00?'" },
        opcoes: {
          type: "array",
          items: { type: "string" },
          description: "De 2 a 4 respostas prováveis e curtas, em português. Ex: [\"Mercado\", \"Uber\", \"Farmácia\", \"Restaurante\"]."
        }
      },
      required: ["texto", "opcoes"]
    },

    preparar(d) {
      const texto = String(d.texto || "").trim();
      const opcoesBrutas = Array.isArray(d.opcoes) ? d.opcoes.filter(o => typeof o === "string" && o.trim()) : [];
      if (!texto || !opcoesBrutas.length) {
        return { erro: "Faltou o texto da pergunta ou as opções de resposta." };
      }

      // Segunda passada: a pessoa já respondeu (botão, ou "Escrever..." com
      // texto próprio — que chega marcado com o prefixo "outra:").
      if (typeof d.resposta === "string" && d.resposta) {
        let resposta = d.resposta;
        if (resposta.indexOf("outra:") === 0) resposta = resposta.slice(6);
        resposta = resposta.trim();
        if (!resposta) return { erro: "O usuário não escreveu nada." };
        return { dados: { resposta }, perguntas: [] };
      }

      return {
        dados: {},
        perguntas: [{
          campo: "resposta",
          texto,
          opcoes: opcoesBrutas.slice(0, 4).map(o => ({ v: o.trim(), t: o.trim() })),
          permiteOutra: true,
          rotuloOutra: "Escrever..."
        }]
      };
    },

    async executar(p) {
      return {
        ok: true,
        mensagem: `O usuário respondeu: "${p.resposta}". Use essa informação para continuar — se ela completa os dados de uma ação pendente (ex: a descrição de um gasto ou a origem de uma entrada), chame agora a ferramenta certa com esse dado preenchido.`
      };
    }
  },

  marcar_como_pago: {
    descricao:
      "Dá baixa numa conta que estava agendada: marca o lançamento pendente como pago (ou o recebimento como recebido). Use quando o usuário disser que pagou ou recebeu algo que já estava agendado no app.",
    parametros: {
      type: "object",
      properties: {
        descricao: { type: "string", description: "Nome ou parte do nome da conta paga, ex: luz, aluguel, Netflix" },
        valor: { type: "number", description: "Valor, se ele disser. Ajuda a achar o lançamento certo quando há vários parecidos." }
      },
      required: ["descricao"]
    },

    preparar(d) {
      const pendentes = (state.movimentos || []).filter(m => (m.status || "pago") === "pendente");
      if (!pendentes.length) {
        return { erro: "Não há nenhuma conta agendada em aberto no app. Explique que só dá para dar baixa no que foi agendado antes, e que um gasto já feito ele pode simplesmente registrar." };
      }

      // Escolha vinda dos botões
      const escolhido = d.id ? pendentes.find(m => String(m.id) === String(d.id)) : null;
      if (escolhido) return { dados: { id: escolhido.id }, perguntas: [] };

      const alvo = normIA(d.descricao);
      let cand = pendentes;
      if (alvo) {
        cand = pendentes.filter(m => {
          const n = normIA(m.descricao);
          return n.includes(alvo) || (alvo.length >= 3 && alvo.includes(n));
        });
      }

      const v = valorIA(d.valor);
      if (v && cand.length > 1) {
        const porValor = cand.filter(m => Math.abs(Number(m.valor) - v) < 0.005);
        if (porValor.length) cand = porValor;
      }

      if (!cand.length) {
        const rec = (state.recorrencias || []).find(r => alvo && normIA(r.descricao).includes(alvo));
        if (rec) {
          return { erro: `"${rec.descricao}" é um gasto fixo (recorrência), não uma conta agendada avulsa. Explique que a baixa dele é feita na tela Gastos Fixos, no botão Pagar da ocorrência do mês — é lá porque o valor costuma mudar de um mês para o outro.` };
        }
        const abertas = pendentes.slice(0, 8).map(m => `${m.descricao} (${fmtMoeda(m.valor)})`).join("; ");
        return { erro: `Não achei nenhuma conta agendada com esse nome. As que estão em aberto são: ${abertas}. Mostre essa lista para ele escolher.` };
      }

      if (cand.length === 1) return { dados: { id: cand[0].id }, perguntas: [] };

      return {
        dados: { id: "" },
        perguntas: [{
          campo: "id",
          texto: cand[0].tipo === "entrada" ? "Qual recebimento você confirma?" : "Qual conta você pagou?",
          opcoes: cand.map(m => ({ v: m.id, t: m.descricao, extra: fmtMoeda(m.valor) }))
        }]
      };
    },

    async executar(p) {
      const m = (state.movimentos || []).find(x => String(x.id) === String(p.id));
      if (!m) return { ok: false, mensagem: "Esse lançamento não está mais na lista." };
      if ((m.status || "pago") !== "pendente") {
        return { ok: false, mensagem: `"${m.descricao}" já estava marcado como pago.` };
      }

      const hoje = hojeISO();
      await dbUpdate("movimentos", m.id, { status: "pago", pago_em: hoje, data: hoje });
      m.status = "pago";
      m.pagoEm = hoje;
      m.data = hoje;            // regime de caixa: entra no dia do pagamento
      renderTudo();

      const conta = (state.bancos || []).find(b => b.id === m.bancoId);
      const ehEntrada = m.tipo === "entrada";
      return {
        ok: true,
        titulo: ehEntrada ? "Recebimento confirmado" : "Pagamento registrado",
        recibo: [
          { rotulo: ehEntrada ? "Recebido" : "Pago", valor: m.descricao },
          { rotulo: "Valor", valor: fmtMoeda(m.valor) },
          { rotulo: "Conta", valor: conta ? conta.nome : "—" },
          { rotulo: "Data", valor: formatarDataBR(hoje) }
        ],
        mensagem: `${ehEntrada ? "Recebimento" : "Pagamento"} de ${m.descricao} no valor de ${fmtMoeda(m.valor)} confirmado hoje` +
                  (conta ? ` na conta ${conta.nome}` : "") +
                  `. Saldo dessa conta agora: ${fmtMoeda(calcularSaldoBanco(m.bancoId))}.`
      };
    }
  },

  criar_transferencia: {
    descricao:
      "Move dinheiro entre duas contas do próprio usuário. Use quando ele disser para passar, transferir ou mandar dinheiro de uma conta dele para outra. Não serve para Pix a outra pessoa — isso é um gasto.",
    parametros: {
      type: "object",
      properties: {
        origem: { type: "string", description: "Conta de onde o dinheiro sai" },
        destino: { type: "string", description: "Conta para onde o dinheiro vai" },
        valor: { type: "number", description: "Valor em reais. Se ele não disse, pergunte numa mensagem normal antes de chamar a ferramenta." },
        data: { type: "string", description: "AAAA-MM-DD, ou hoje / ontem. Padrão: hoje." },
        descricao: { type: "string", description: "Observação curta, opcional" }
      },
      required: ["valor"]
    },

    preparar(d) {
      const contas = state.bancos || [];
      if (contas.length < 2) {
        return { erro: "O usuário tem menos de duas contas cadastradas, então não há como transferir. Explique que transferência é entre duas contas dele, e que ele pode cadastrar a outra em Adicionar Banco." };
      }

      const origem = acharContaIA(d.origem, contas);
      const destino = acharContaIA(d.destino, contas);
      const p = {
        origemId: origem ? origem.id : "",
        destinoId: destino ? destino.id : "",
        valor: valorIA(d.valor),
        data: resolverDataIA(d.data),
        descricao: String(d.descricao == null ? "" : d.descricao).trim().slice(0, 120)
      };

      if (!p.valor) {
        return { erro: "Não veio o valor da transferência. Pergunte a ele quanto quer transferir." };
      }

      const perguntas = [];
      if (!p.origemId) {
        perguntas.push({
          campo: "origem",
          texto: "De qual conta sai o dinheiro?",
          opcoes: opcoesContasIA(contas.filter(b => b.id !== p.destinoId))
        });
      }
      if (!p.destinoId) {
        perguntas.push({
          campo: "destino",
          texto: "Para qual conta vai?",
          opcoes: opcoesContasIA(contas.filter(b => b.id !== p.origemId))
        });
      }

      return { dados: p, perguntas: perguntas };
    },

    async executar(p) {
      const origem = (state.bancos || []).find(b => b.id === p.origemId);
      const destino = (state.bancos || []).find(b => b.id === p.destinoId);
      if (!origem || !destino) return { ok: false, mensagem: "Não encontrei uma das contas." };
      if (origem.id === destino.id) {
        return { ok: false, mensagem: "A conta de origem e a de destino são a mesma. Pergunte a ele qual é a conta de destino." };
      }

      const saldo = calcularSaldoBanco(origem.id);
      if (p.valor > saldo + 0.005) {
        return { ok: false, mensagem: `Saldo insuficiente em ${origem.nome}: tem ${fmtMoeda(saldo)} e a transferência é de ${fmtMoeda(p.valor)}.` };
      }

      const novo = await dbInsert("transferencias", {
        conta_origem: origem.id, conta_destino: destino.id,
        valor: p.valor, data: p.data, descricao: p.descricao
      });
      state.transferencias.push({
        id: novo.id, origem: novo.conta_origem, destino: novo.conta_destino,
        valor: Number(novo.valor), data: novo.data, descricao: novo.descricao || ""
      });
      renderTudo();

      return {
        ok: true,
        titulo: "Transferência feita",
        recibo: [
          { rotulo: "Valor", valor: fmtMoeda(p.valor) },
          { rotulo: "Sai de", valor: `${origem.nome} · ${fmtMoeda(calcularSaldoBanco(origem.id))}` },
          { rotulo: "Vai para", valor: `${destino.nome} · ${fmtMoeda(calcularSaldoBanco(destino.id))}` },
          { rotulo: "Data", valor: formatarDataBR(p.data) }
        ],
        mensagem: `Transferência de ${fmtMoeda(p.valor)} de ${origem.nome} para ${destino.nome} em ${formatarDataBR(p.data)}. ` +
                  `${origem.nome} ficou com ${fmtMoeda(calcularSaldoBanco(origem.id))} e ${destino.nome} com ${fmtMoeda(calcularSaldoBanco(destino.id))}. O saldo total não muda.`
      };
    }
  },

  definir_limite: {
    descricao:
      "Cria ou ajusta o limite de gasto mensal de uma categoria (as Metas do app). Use quando o usuário disser que quer gastar no máximo tanto com alguma coisa, ou pedir para mudar um limite que já existe.",
    parametros: {
      type: "object",
      properties: {
        categoria: { type: "string", description: "Categoria do limite, ex: Alimentação" },
        limite: { type: "number", description: "Valor máximo por mês, em reais. Se ele não disse, pergunte antes de chamar a ferramenta." }
      },
      required: ["limite"]
    },

    preparar(d) {
      const p = {
        categoria: acharCategoriaIA(d.categoria) || "",
        limite: valorIA(d.limite)
      };
      if (!p.limite) {
        return { erro: "Não veio o valor do limite. Pergunte a ele quanto quer gastar no máximo por mês." };
      }

      const perguntas = [];
      if (!p.categoria) {
        perguntas.push({ campo: "categoria", texto: "Limite de qual categoria?", opcoes: opcoesCategoriasIA() });
      }
      return { dados: p, perguntas: perguntas };
    },

    async executar(p) {
      const idx = (state.metas || []).findIndex(m => m.categoria === p.categoria);
      let acao;
      if (idx >= 0) {
        const att = await dbUpdate("metas", state.metas[idx].id, { limite: p.limite });
        state.metas[idx].limite = Number(att.limite);
        acao = "ajustado";
      } else {
        const maximo = limitesAtuais().metas;
        if ((state.metas || []).length >= maximo) {
          return { ok: false, mensagem: `O plano dele permite no máximo ${maximo} limites e ele já usou todos. Explique que nos planos pagos não há esse teto.` };
        }
        const novo = await dbInsert("metas", { categoria: p.categoria, limite: p.limite });
        state.metas.push({ id: novo.id, categoria: novo.categoria, limite: Number(novo.limite) });
        acao = "criado";
      }
      renderTudo();

      // Quanto já foi gasto nessa categoria no mês corrente
      const mes = hojeISO().slice(0, 7);
      const gasto = (state.movimentos || [])
        .filter(m => m.tipo === "gasto" && m.categoria === p.categoria && (m.data || "").slice(0, 7) === mes && (m.status || "pago") === "pago")
        .reduce((s, m) => s + Number(m.valor || 0), 0);

      return {
        ok: true,
        titulo: acao === "criado" ? "Limite criado" : "Limite ajustado",
        recibo: [
          { rotulo: "Categoria", valor: p.categoria },
          { rotulo: "Máximo por mês", valor: fmtMoeda(p.limite) },
          { rotulo: "Já gasto no mês", valor: fmtMoeda(gasto) }
        ],
        mensagem: `Limite de ${p.categoria} ${acao} em ${fmtMoeda(p.limite)} por mês. Neste mês ele já gastou ${fmtMoeda(gasto)} nessa categoria, ou seja, ${gasto > p.limite ? "já passou do limite" : `ainda cabem ${fmtMoeda(p.limite - gasto)}`}.`
      };
    }
  },

  criar_objetivo: {
    descricao:
      "Cria um objetivo de poupança / meta de guardar dinheiro (ex: juntar para um tênis, uma viagem, uma reserva de emergência). Use quando o usuário disser que quer juntar/economizar/guardar um valor para comprar ou alcançar algo, geralmente com um prazo. NÃO confunda com definir_limite, que é teto de gasto mensal por categoria.",
    parametros: {
      type: "object",
      properties: {
        nome: { type: "string", description: "O que ele quer alcançar: Tênis, Viagem ao Chile, Reserva de emergência. Se ele não disse, pergunte antes de chamar a ferramenta." },
        valor: { type: "number", description: "Quanto custa / quanto quer juntar, em reais. Se ele não disse, pergunte antes de chamar." },
        prazo_data: { type: "string", description: "Data alvo em AAAA-MM-DD, se ele deu uma data ou algo como 'até final do próximo mês', 'até dezembro'. Deixe vazio se não houver prazo." },
        ja_guardado: { type: "number", description: "Quanto ele JÁ tem guardado para isso, se mencionar. Padrão: 0." }
      },
      required: ["nome", "valor"]
    },

    preparar(d) {
      const p = {};
      p.nome = String(d.nome == null ? "" : d.nome).trim().slice(0, 60);
      p.valor = valorIA(d.valor);
      p.jaGuardado = valorIA(d.ja_guardado) || 0;
      p.prazoData = "";
      if (d.prazo_data) {
        const dt = resolverDataIA(d.prazo_data);
        // resolverDataIA devolve hoje quando não entende; para prazo, só
        // aceitamos uma data futura de verdade.
        if (/^\d{4}-\d{2}-\d{2}$/.test(dt) && dt > hojeISO()) p.prazoData = dt;
      }

      if (!p.nome) {
        return { erro: "Não veio o que ele quer juntar. Pergunte qual é o objetivo (ex: um tênis, uma viagem) antes de criar." };
      }
      if (!p.valor) {
        return { erro: "Não veio o valor do objetivo. Pergunte quanto ele quer juntar, e não invente." };
      }
      if (p.jaGuardado > p.valor) p.jaGuardado = p.valor;

      // Ícone deduzido do nome (o app tem um conjunto fixo)
      p.icone = iconeObjetivoIA(p.nome);
      return { dados: p, perguntas: [] };
    },

    async executar(p) {
      const novo = await dbInsert("objetivos", {
        nome: p.nome,
        icone: p.icone,
        valor_alvo: p.valor,
        valor_atual: p.jaGuardado,
        prazo_tipo: p.prazoData ? "data" : "livre",
        prazo_data: p.prazoData || null,
        prazo_dias: null
      });
      state.objetivos.push(
        typeof mapObjetivo === "function"
          ? mapObjetivo(novo)
          : { id: novo.id, nome: novo.nome, icone: novo.icone, valorAlvo: Number(novo.valor_alvo), valorAtual: Number(novo.valor_atual), prazoTipo: novo.prazo_tipo, prazoData: novo.prazo_data, prazoDias: novo.prazo_dias }
      );
      renderTudo();

      const falta = Math.max(0, p.valor - p.jaGuardado);
      const recibo = [
        { rotulo: "Objetivo", valor: p.nome },
        { rotulo: "Meta", valor: fmtMoeda(p.valor) }
      ];
      if (p.jaGuardado > 0) recibo.push({ rotulo: "Já guardado", valor: fmtMoeda(p.jaGuardado) });
      recibo.push({ rotulo: "Falta juntar", valor: fmtMoeda(falta) });
      if (p.prazoData) recibo.push({ rotulo: "Prazo", valor: formatarDataBR(p.prazoData) });

      // Se há prazo, calcula quanto guardar por mês para chegar lá
      let dica = "";
      if (p.prazoData && falta > 0) {
        const hoje = new Date(hojeISO() + "T00:00:00");
        const alvo = new Date(p.prazoData + "T00:00:00");
        const meses = Math.max(1, Math.round((alvo - hoje) / (1000 * 60 * 60 * 24 * 30)));
        const porMes = falta / meses;
        dica = ` Para chegar lá no prazo, ele precisa guardar cerca de ${fmtMoeda(porMes)} por mês.`;
      }

      return {
        ok: true,
        titulo: "Objetivo criado",
        recibo,
        mensagem: `Objetivo "${p.nome}" criado, meta de ${fmtMoeda(p.valor)}` +
                  (p.jaGuardado > 0 ? `, com ${fmtMoeda(p.jaGuardado)} já guardado` : "") +
                  (p.prazoData ? `, prazo ${formatarDataBR(p.prazoData)}` : "") +
                  `. Falta juntar ${fmtMoeda(falta)}.` + dica
      };
    }
  },

  criar_recorrencia: {
    descricao:
      "Cria um GASTO FIXO (recorrência): uma conta que se repete sozinha todo período — aluguel, Netflix, academia, salário, mensalidade. O app passa a lançar o vencimento automaticamente a cada mês (ou dia/ano). Use quando o usuário disser que algo é fixo, mensal, todo mês, toda semana, uma assinatura, ou que se repete. NÃO use criar_lancamento para isso: aquele cria um lançamento único; este cria a regra que se repete.",
    parametros: {
      type: "object",
      properties: {
        descricao: { type: "string", description: "O que é: Aluguel, Netflix, Academia, Salário. Se ele não disse, pergunte antes." },
        valor: { type: "number", description: "Valor de cada ocorrência, em reais. Se ele não disse, pergunte antes." },
        tipo: { type: "string", enum: ["gasto", "entrada"], description: "gasto para contas a pagar que se repetem; entrada para receitas fixas como salário. Padrão: gasto." },
        frequencia: { type: "string", enum: ["mensal", "anual", "diaria"], description: "De quanto em quanto tempo repete. Padrão: mensal (o mais comum)." },
        dia: { type: "number", description: "Dia do mês do vencimento (1 a 31), se ele disser ('todo dia 10'). Se não disser, o app usa hoje." },
        categoria: { type: "string", description: "Categoria do gasto. Deixe vazio para o app deduzir da descrição." }
      },
      required: ["descricao", "valor"]
    },

    preparar(d) {
      const contas = state.bancos || [];
      if (!contas.length) {
        return { erro: "O usuário não tem conta cadastrada, então não dá para criar um gasto fixo. Explique que ele precisa cadastrar o banco primeiro, em Adicionar Banco." };
      }
      if (typeof podeUsar === "function" && !podeUsar("recorrencias")) {
        return { erro: "Gastos fixos são um recurso exclusivo de quem assina o FAZ Finanças. Explique que cadastrando uma vez o app cuida dos vencimentos sozinho." };
      }

      const p = {};
      p.descricao = String(d.descricao == null ? "" : d.descricao).trim().slice(0, 120);
      p.valor = valorIA(d.valor);
      p.tipo = normIA(d.tipo) === "entrada" ? "entrada" : "gasto";
      const freqs = ["mensal", "anual", "diaria"];
      p.frequencia = freqs.includes(normIA(d.frequencia)) ? normIA(d.frequencia) : "mensal";
      // Entrada normalmente é só "Entrada" (a origem já fica na descrição),
      // MAS se o usuário deu uma pista de categoria que bate com uma
      // categoria de verdade (ex: "ganhei 45 em aposta" → tem a categoria
      // "Aposta"), usa ela — assim entradas e gastos da mesma categoria
      // aparecem juntos na Planilha, mostrando o resultado líquido. Sem
      // pista nenhuma, ou sem bater com nada, cai no genérico "Entrada".
      p.categoria = p.tipo === "entrada"
        ? (acharCategoriaIA(d.categoria) || "Entrada")
        : (acharCategoriaIA(d.categoria) || "");

      if (!p.descricao) {
        return { erro: "Não veio o que é o gasto fixo. Pergunte o que se repete (ex: aluguel, Netflix) antes de criar." };
      }
      if (!p.valor) {
        return { erro: "Não veio o valor do gasto fixo. Pergunte quanto é cada cobrança, e não invente." };
      }

      // Dia do vencimento: o que ele disse, senão hoje. Primeiro vencimento é
      // a próxima ocorrência desse dia (este mês se ainda não passou, senão o
      // que vier). Para diária/anual, começa hoje.
      const hoje = hojeISO();
      let inicio = hoje;
      const dia = Math.round(Number(d.dia));
      if (p.frequencia === "mensal" && dia >= 1 && dia <= 31) {
        const [ano, mes] = hoje.split("-");
        const diaHoje = Number(hoje.slice(8, 10));
        const clamp = (a, m, dd) => {
          const ultimo = new Date(a, m, 0).getDate(); // último dia do mês m (1-based)
          return `${a}-${String(m).padStart(2, "0")}-${String(Math.min(dd, ultimo)).padStart(2, "0")}`;
        };
        if (dia >= diaHoje) inicio = clamp(Number(ano), Number(mes), dia);
        else {
          let m = Number(mes) + 1, a = Number(ano);
          if (m > 12) { m = 1; a++; }
          inicio = clamp(a, m, dia);
        }
      }
      p.inicio = inicio;

      // Conta: resolve o que a IA mandou; se só há uma, usa ela. Senão pergunta.
      const conta = acharContaIA(d.conta, contas);
      p.contaId = conta ? conta.id : (contas.length === 1 ? contas[0].id : "");
      if (conta && p.descricao && !d._contaConfirmada) {
        const nc = normIA(conta.nome), nd = normIA(p.descricao);
        if (nc === nd || nc.includes(nd) || nd.includes(nc)) {
          p.contaId = contas.length === 1 ? contas[0].id : "";
        }
      }

      const perguntas = [];
      if (!p.contaId) {
        perguntas.push({
          campo: "conta",
          texto: p.tipo === "entrada" ? "Em qual conta cai essa entrada fixa?" : "De qual conta sai esse gasto fixo?",
          opcoes: opcoesContasIA(contas)
        });
      }
      // Categoria só se for gasto e não deu para deduzir da descrição
      if (p.tipo === "gasto" && !p.categoria && !p.descricao) {
        perguntas.push({
          campo: "categoria",
          texto: "Qual a categoria desse gasto fixo?",
          opcoes: opcoesCategoriasIA(),
          permiteOutra: true,
          rotuloOutra: "Outra..."
        });
      }

      return { dados: p, perguntas: perguntas };
    },

    async executar(p) {
      const conta = (state.bancos || []).find(b => b.id === p.contaId);
      if (!conta) return { ok: false, mensagem: "Não encontrei essa conta." };

      let categoria = p.categoria;
      if (p.tipo === "entrada") categoria = "Entrada";
      else if (!categoria) categoria = await categorizarComIA(p.descricao);

      const novo = await dbInsert("recorrencias", {
        descricao: p.descricao, valor: p.valor, tipo: p.tipo, categoria,
        conta_id: p.contaId,
        dia: Number(p.inicio.slice(8, 10)),
        frequencia: p.frequencia, intervalo: 1, intervalo_unidade: "mes",
        inicio: p.inicio, fim: null, ativa: true
      });
      state.recorrencias.push({
        id: novo.id, descricao: novo.descricao, valor: Number(novo.valor), tipo: novo.tipo,
        categoria: novo.categoria, contaId: novo.conta_id, dia: novo.dia,
        frequencia: novo.frequencia, intervalo: novo.intervalo,
        intervaloUnidade: novo.intervalo_unidade, inicio: novo.inicio, fim: novo.fim,
        ativa: novo.ativa !== false
      });
      renderTudo();

      const cadaQuanto = p.frequencia === "mensal" ? "todo mês" : (p.frequencia === "anual" ? "todo ano" : "todo dia");
      return {
        ok: true,
        titulo: p.tipo === "entrada" ? "Entrada fixa criada" : "Gasto fixo criado",
        recibo: [
          { rotulo: p.tipo === "entrada" ? "Entrada fixa" : "Gasto fixo", valor: p.descricao },
          { rotulo: "Valor", valor: fmtMoeda(p.valor) },
          { rotulo: "Repete", valor: cadaQuanto },
          { rotulo: "Conta", valor: conta.nome },
          { rotulo: "Categoria", valor: categoria },
          { rotulo: "1º vencimento", valor: formatarDataBR(p.inicio) }
        ],
        mensagem: `Gasto fixo "${p.descricao}" de ${fmtMoeda(p.valor)} criado, repetindo ${cadaQuanto} na conta ${conta.nome}, categoria ${categoria}. O primeiro vencimento é ${formatarDataBR(p.inicio)} e os próximos aparecem sozinhos em Gastos Fixos.`
      };
    }
  },

  criar_banco: {
    descricao:
      "Cadastra uma nova conta / banco / carteira para o usuário (Nubank, Itaú, carteira física, conta de investimentos, etc.), com o saldo atual dela. Use quando ele pedir para criar, adicionar ou cadastrar um banco, uma conta ou uma carteira. O saldo informado deve ser o TOTAL que ele tem nessa conta hoje.",
    parametros: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Nome da conta como ele quer ver: Nubank, Itaú, Carteira, PicPay. Se ele não disse, pergunte antes." },
        saldo: { type: "number", description: "Quanto ele tem nessa conta HOJE, no total. Pode ser 0 se a conta está zerada. Se ele não disse nada sobre saldo, pergunte (aceite zero)." },
        tipo: { type: "string", description: "Tipo da conta, um destes exatos: 'Banco Digital', 'Banco Tradicional', 'Conta Corrente', 'Poupança', 'Carteira Crypto', 'Carteira Física', 'Investimentos', 'Outro'. Deixe vazio para o app deduzir do nome." }
      },
      required: ["nome", "saldo"]
    },

    preparar(d) {
      if (typeof limitesAtuais === "function") {
        const maximo = limitesAtuais().contas;
        if (maximo !== Infinity && maximo !== true && (state.bancos || []).length >= maximo) {
          return { erro: `O plano dele permite no máximo ${maximo} contas e ele já usou todas. Explique que nos planos pagos não há esse limite.` };
        }
      }

      const p = {};
      p.nome = String(d.nome == null ? "" : d.nome).trim().slice(0, 40);
      // saldo pode ser 0 legitimamente, então tratamos "não informado" à parte
      const temSaldo = d.saldo !== undefined && d.saldo !== null && d.saldo !== "";
      p.saldo = temSaldo ? (Number(valorIA(d.saldo)) || (Number(d.saldo) === 0 ? 0 : null)) : null;
      if (temSaldo && Number(d.saldo) === 0) p.saldo = 0;

      if (!p.nome) {
        return { erro: "Não veio o nome da conta. Pergunte qual banco ou carteira ele quer cadastrar." };
      }
      if (p.saldo === null) {
        return { erro: `Não veio o saldo. Pergunte quanto ele tem hoje em ${p.nome} (pode ser zero se estiver zerada), e não invente um valor.` };
      }

      // Já existe uma conta com esse nome?
      if ((state.bancos || []).some(b => normIA(b.nome) === normIA(p.nome))) {
        return { erro: `Ele já tem uma conta chamada "${p.nome}". Se quer duas com o mesmo banco, sugira um apelido (ex: "${p.nome} Salário"). Não crie duplicada.` };
      }

      // Tipo: usa o que a IA mandou (se for válido) ou deduz do nome
      const tiposValidos = ["Banco Digital", "Banco Tradicional", "Conta Corrente", "Poupança", "Carteira Crypto", "Carteira Física", "Investimentos", "Outro"];
      const tipoDito = tiposValidos.find(t => normIA(t) === normIA(d.tipo));
      p.tipo = tipoDito || tipoContaIA(p.nome);

      // Se não deu para deduzir com confiança, pergunta em botões
      const perguntas = [];
      if (!p.tipo) {
        perguntas.push({
          campo: "tipo",
          texto: `Que tipo de conta é "${p.nome}"?`,
          opcoes: [
            { v: "Banco Digital", t: "Banco digital" },
            { v: "Banco Tradicional", t: "Banco tradicional" },
            { v: "Carteira Física", t: "Carteira (dinheiro)" },
            { v: "Carteira Crypto", t: "Cripto" },
            { v: "Investimentos", t: "Investimentos" },
            { v: "Outro", t: "Outro" }
          ]
        });
      }

      return { dados: p, perguntas: perguntas };
    },

    async executar(p) {
      const novo = await dbInsert("contas", {
        nome: p.nome,
        tipo: p.tipo || "Outro",
        saldo_inicial: p.saldo,
        saldo_data: hojeISO(),
        cor: null,          // null = cor automática derivada do nome
        // logo_id não é enviado de propósito: fica null no banco, que já é o
        // "automático" — a marca é reconhecida sozinha pelo nome (ver
        // bancoDaConta/detectarBancoPorNome), sem precisar a IA escolher.
        tem_cartao: false   // cartão de crédito o usuário liga depois, na tela
      });
      state.bancos.push({
        id: novo.id, nome: novo.nome, tipo: novo.tipo,
        saldoInicial: Number(novo.saldo_inicial), saldoData: novo.saldo_data || null,
        cor: novo.cor || null, logoId: novo.logo_id ?? null, temCartao: false,
        limite: null, diaFechamento: null, diaVencimento: null
      });
      renderTudo();

      return {
        ok: true,
        titulo: "Conta criada",
        recibo: [
          { rotulo: "Conta", valor: p.nome },
          { rotulo: "Tipo", valor: p.tipo || "Outro" },
          { rotulo: "Saldo atual", valor: fmtMoeda(p.saldo) }
        ],
        mensagem: `Conta "${p.nome}" (${p.tipo || "Outro"}) criada com saldo de ${fmtMoeda(p.saldo)}. ` +
                  `Agora ele pode lançar gastos e entradas nela. Se essa conta tiver cartão de crédito, ele pode ativar isso editando o banco na tela Adicionar Banco (informando limite, fechamento e vencimento) — isso o app ainda não faz pelo chat.`
      };
    }
  },

  editar_lancamento: {
    descricao:
      "Corrige um lançamento (gasto ou entrada) que já existe: valor, descrição, categoria ou data. Use quando o usuário disser para mudar, corrigir, trocar ou ajustar algo de um gasto/entrada já lançado. NÃO serve pra trocar a conta nem a forma de pagamento — para isso, oriente a editar pela tela (Lançamentos, no ícone de lápis do item).",
    parametros: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id do lançamento, só quando veio de uma escolha em botões. Deixe vazio na primeira tentativa." },
        busca: { type: "string", description: "Nome ou parte do nome do lançamento a editar, como o usuário descreveu (ex: 'uber', 'mercado')." },
        valorAtual: { type: "number", description: "Valor atual do lançamento, se ele mencionar — ajuda a achar o certo entre vários parecidos." },
        novoValor: { type: "number", description: "Novo valor em reais, só se o usuário quer mudar o valor." },
        novaDescricao: { type: "string", description: "Nova descrição, só se ele quer mudar o texto do lançamento." },
        novaCategoria: { type: "string", description: "Nova categoria, só se ele quer trocar a categoria." },
        novaData: { type: "string", description: "Nova data (AAAA-MM-DD, ou hoje/ontem), só se ele quer mudar a data." }
      },
      required: ["busca"]
    },

    preparar(d) {
      const semMudanca = d.novoValor == null && !d.novaDescricao && !d.novaCategoria && !d.novaData;
      if (semMudanca) {
        return { erro: "Não veio o que mudar nesse lançamento. Use perguntar_opcoes (nunca texto livre) perguntando o que ele quer corrigir, com as opções Valor, Descrição, Categoria e Data — e chame esta ferramenta de novo já preenchendo o campo escolhido." };
      }
      const achado = _acharLancamentoIA(
        Object.assign({}, d, { valor: d.valorAtual }),
        "Qual lançamento você quer corrigir?"
      );
      // BUG que existia aqui: devolver achado direto perdia novoValor/
      // novaDescricao/novaCategoria/novaData no caminho — _acharLancamentoIA
      // só devolve o id, então editar_lancamento sempre "achava" o
      // lançamento certo mas executava sem nada pra mudar (achando que a
      // pessoa não tinha dito nada). Visto ao vivo: "mudei a categoria" nunca
      // aplicava e o app dizia "não consegui alterar", sem pista do motivo.
      if (achado.erro || (achado.perguntas && achado.perguntas.length)) return achado;
      return {
        dados: {
          id: achado.dados.id,
          novoValor: d.novoValor, novaDescricao: d.novaDescricao,
          novaCategoria: d.novaCategoria, novaData: d.novaData
        },
        perguntas: []
      };
    },

    async executar(p) {
      const m = (state.movimentos || []).find(x => String(x.id) === String(p.id));
      if (!m) return { ok: false, mensagem: "Esse lançamento não está mais na lista." };

      const dados = {};
      const mudou = [];
      if (p.novoValor != null) {
        const v = valorIA(p.novoValor);
        if (v) { dados.valor = v; mudou.push({ rotulo: "Valor", valor: fmtMoeda(v) }); }
      }
      if (p.novaDescricao) {
        dados.descricao = String(p.novaDescricao).trim().slice(0, 120);
        mudou.push({ rotulo: "Descrição", valor: dados.descricao });
      }
      if (p.novaCategoria) {
        const cat = acharCategoriaIA(p.novaCategoria) || String(p.novaCategoria).trim().slice(0, 40);
        dados.categoria = cat;
        mudou.push({ rotulo: "Categoria", valor: cat });
      }
      if (p.novaData) {
        const data = resolverDataIA(p.novaData);
        dados.data = data;
        mudou.push({ rotulo: "Data", valor: formatarDataBR(data) });
      }

      if (!Object.keys(dados).length) {
        return { ok: false, mensagem: "Nenhuma das mudanças pedidas era válida — nada foi alterado." };
      }

      const att = await dbUpdate("movimentos", m.id, dados);
      m.descricao = att.descricao;
      m.valor = Number(att.valor);
      m.categoria = att.categoria;
      m.data = att.data;
      renderTudo();

      return {
        ok: true,
        titulo: "Lançamento atualizado",
        recibo: [{ rotulo: m.tipo === "entrada" ? "Entrada" : "Gasto", valor: m.descricao }].concat(mudou),
        mensagem: `Atualizei "${m.descricao}": ` + mudou.map(x => `${x.rotulo.toLowerCase()} ${x.valor}`).join(", ") + "."
      };
    }
  },

  excluir_lancamento: {
    descricao:
      "Apaga um lançamento (gasto ou entrada) que já existe. Use quando o usuário pedir para apagar, excluir, remover ou desfazer algo que já foi lançado. NÃO use para dar baixa numa conta agendada (isso é marcar_como_pago).",
    parametros: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id do lançamento, só quando veio de uma escolha em botões. Deixe vazio na primeira tentativa." },
        busca: { type: "string", description: "Nome ou parte do nome do lançamento a apagar, como o usuário descreveu." },
        valor: { type: "number", description: "Valor do lançamento, se ele mencionar — ajuda a achar o certo entre vários parecidos." }
      },
      required: ["busca"]
    },

    preparar(d) {
      return _acharLancamentoIA(d, "Qual lançamento você quer apagar?");
    },

    async executar(p) {
      const m = (state.movimentos || []).find(x => String(x.id) === String(p.id));
      if (!m) return { ok: false, mensagem: "Esse lançamento não está mais na lista." };

      await dbDelete("movimentos", m.id);
      state.movimentos = state.movimentos.filter(x => x.id !== m.id);
      renderTudo();

      return {
        ok: true,
        titulo: "Lançamento apagado",
        recibo: [
          { rotulo: m.tipo === "entrada" ? "Entrada" : "Gasto", valor: m.descricao },
          { rotulo: "Valor", valor: fmtMoeda(m.valor) },
          { rotulo: "Data", valor: formatarDataBR(m.data) }
        ],
        mensagem: `Apaguei "${m.descricao}" (${fmtMoeda(m.valor)}, ${formatarDataBR(m.data)}).`
      };
    }
  },

  pagar_fatura_cartao: {
    descricao:
      "Paga a fatura em aberto de um cartão de crédito, debitando o valor total da própria conta do cartão. Use quando o usuário pedir para pagar, quitar ou dar baixa na fatura do cartão.",
    parametros: {
      type: "object",
      properties: {
        cartao: { type: "string", description: "Nome do cartão/banco cuja fatura será paga. Deixe vazio se ele só tem um cartão cadastrado." }
      },
      required: []
    },

    preparar(d) {
      const cartoes = (state.bancos || []).filter(b => b.temCartao);
      if (!cartoes.length) {
        return { erro: "O usuário não tem nenhum cartão de crédito cadastrado." };
      }

      // Prioridade: escolha vinda dos botões (d.cartaoId) > nome dito (d.cartao) >
      // único cartão cadastrado. Checar o id primeiro é o que fecha o loop de
      // pergunta — senão a resposta do botão nunca seria reconhecida na volta.
      let alvo = d.cartaoId ? cartoes.find(c => c.id === d.cartaoId) : null;
      if (!alvo) alvo = acharContaIA(d.cartao, cartoes);
      if (!alvo) {
        if (cartoes.length === 1) {
          alvo = cartoes[0];
        } else {
          return {
            dados: {},
            perguntas: [{
              campo: "cartaoId",
              texto: "De qual cartão é a fatura?",
              opcoes: cartoes.map(c => ({ v: c.id, t: c.nome }))
            }]
          };
        }
      }

      const faturaMes = proximaFaturaAberta(alvo.id);
      const total = totalFatura(alvo.id, faturaMes);
      if (!(total > 0)) {
        return { erro: `A fatura de ${alvo.nome} está zerada ou já paga — não há o que pagar agora.` };
      }

      return { dados: { cartaoId: alvo.id, faturaMes, valor: total }, perguntas: [] };
    },

    async executar(p) {
      const cartao = (state.bancos || []).find(b => b.id === p.cartaoId);
      if (!cartao) return { ok: false, mensagem: "Não encontrei esse cartão." };
      if (faturaEstaPaga(p.cartaoId, p.faturaMes)) {
        return { ok: false, mensagem: `A fatura de ${cartao.nome} já estava paga.` };
      }

      const saldo = calcularSaldoBanco(p.cartaoId);
      if (p.valor > saldo + 0.005) {
        return { ok: false, mensagem: `Saldo insuficiente em ${cartao.nome}: o saldo é ${fmtMoeda(saldo)} e a fatura é de ${fmtMoeda(p.valor)}. Sugira transferir de outra conta antes de pagar.` };
      }

      const mov = await dbInsert("movimentos", {
        descricao: `Pagamento fatura ${cartao.nome}`,
        conta_id: p.cartaoId, data: hojeISO(),
        valor: p.valor, tipo: "gasto", categoria: "Cartão de Crédito",
        status: "pago", pago_em: hojeISO(),
        forma_pagamento: "pagamento_fatura"
      });
      state.movimentos.push({
        id: mov.id, descricao: mov.descricao, bancoId: mov.conta_id, data: mov.data,
        valor: Number(mov.valor), tipo: mov.tipo, categoria: mov.categoria,
        status: mov.status, vencimento: null, pagoEm: mov.pago_em,
        formaPagamento: "pagamento_fatura"
      });

      const nova = await dbInsert("faturas_pagas", {
        user_id: state.user.id,
        cartao_id: p.cartaoId, fatura_mes: p.faturaMes,
        conta_id: p.cartaoId, valor: p.valor, pago_em: hojeISO()
      });
      state.faturasPagas.push({
        id: nova.id, cartaoId: p.cartaoId, faturaMes: p.faturaMes,
        contaId: p.cartaoId, valor: Number(nova.valor), pagoEm: nova.pago_em
      });

      renderTudo();

      return {
        ok: true,
        titulo: "Fatura paga",
        recibo: [
          { rotulo: "Cartão", valor: cartao.nome },
          { rotulo: "Valor", valor: fmtMoeda(p.valor) },
          { rotulo: "Data", valor: formatarDataBR(hojeISO()) }
        ],
        mensagem: `Fatura de ${cartao.nome} paga: ${fmtMoeda(p.valor)} debitado. Saldo dessa conta agora: ${fmtMoeda(calcularSaldoBanco(p.cartaoId))}.`
      };
    }
  },

  registrar_investimento: {
    descricao:
      "Registra uma aplicação financeira do usuário — renda fixa, ações, fundos, imóvel, ouro ou cripto — na carteira de Investimentos. Use quando ele disser que investiu, aplicou, comprou ações/cripto ou guardou dinheiro num investimento. O valor NÃO sai do saldo de nenhuma conta — é só um registro pra acompanhar o rendimento.",
    parametros: {
      type: "object",
      properties: {
        tipo: { type: "string", description: "O tipo: CDB, LCI/LCA, Fundo DI, Tesouro Selic, CDB Prefixado, Tesouro Prefixado, Tesouro IPCA, Poupança, Ações, FII, ETF, BDR, Cripto, Fundo Multi, Ouro, Imóvel — ou o nome livre se for outra coisa. Se não der pra saber com segurança, deixe vazio; o app pergunta em botões." },
        valor: { type: "number", description: "Valor aplicado, em reais. Se ele não disse o valor e não é cripto só com quantidade, NÃO chame a ferramenta: pergunte antes numa mensagem normal." },
        apelido: { type: "string", description: "Nome pra identificar, tipo 'Reserva de emergência'. Opcional, deixe vazio se ele não deu um nome." },
        taxa: { type: "number", description: "Percentual de rendimento contratado — ex: 110 para '110% do CDI', ou 12 para '12% ao ano'. Só relevante pra renda fixa (exceto Poupança, que já tem taxa conhecida). Se for renda fixa e ele não disse a taxa, NÃO chame a ferramenta: pergunte antes." },
        taxaPeriodo: { type: "string", enum: ["ano", "mes"], description: "Período da taxa informada. Padrão: ano." },
        criptoMoeda: { type: "string", description: "Nome ou sigla da criptomoeda (bitcoin, ethereum, solana...), só quando tipo é Cripto." },
        criptoQtd: { type: "number", description: "Quantidade da moeda, só quando tipo é Cripto. Se ele só disse a quantidade (não o valor em reais), tudo bem — deixe valor vazio, o app calcula pelo preço de hoje." }
      },
      required: []
    },

    preparar(d) {
      const p = {};
      const tiposConhecidos = Object.keys(CATEGORIAS_INV).filter(t => t !== "Outro");

      let tipoBruto = String(d.tipo == null ? "" : d.tipo).trim();
      const ehOutraDigitada = tipoBruto.indexOf("outra:") === 0;
      if (ehOutraDigitada) tipoBruto = tipoBruto.slice(6).trim();

      const tipo = tiposConhecidos.find(t => normIA(t) === normIA(tipoBruto));
      if (tipo) {
        p.tipo = tipo;
      } else if (tipoBruto && ehOutraDigitada) {
        p.tipo = "Outro";
        p.nomeOutro = tipoBruto.slice(0, 60);
      } else {
        return {
          dados: {},
          perguntas: [{
            campo: "tipo",
            texto: "Que tipo de investimento é esse?",
            opcoes: [
              { v: "CDB", t: "CDB" },
              { v: "Tesouro Selic", t: "Tesouro Selic" },
              { v: "Poupança", t: "Poupança" },
              { v: "Ações", t: "Ações" },
              { v: "Cripto", t: "Cripto" },
              { v: "FII", t: "FII" }
            ],
            permiteOutra: true,
            rotuloOutra: "Outro..."
          }]
        };
      }

      const cfg = configTipo(p.tipo);
      p.apelido = String(d.apelido == null ? "" : d.apelido).trim().slice(0, 60);

      if (cfg.modo === "cripto") {
        const moedaBruta = String(d.criptoMoeda == null ? "" : d.criptoMoeda).trim();
        const cripto = CRIPTOS.find(c =>
          normIA(c.nome) === normIA(moedaBruta) || normIA(c.sigla) === normIA(moedaBruta) || normIA(c.id) === normIA(moedaBruta)
        );
        if (!cripto) {
          return {
            dados: {},
            perguntas: [{
              campo: "criptoMoeda",
              texto: "Qual moeda?",
              opcoes: CRIPTOS.map(c => ({ v: c.id, t: `${c.nome} (${c.sigla})` }))
            }]
          };
        }
        p.criptoId = cripto.id;
        p.criptoQtd = Number(d.criptoQtd) || null;
        p.valor = valorIA(d.valor);
        if (!p.valor && !p.criptoQtd) {
          return { erro: "Não veio nem o valor em reais nem a quantidade da moeda. Pergunte quanto ele investiu (em reais) ou quantas moedas comprou." };
        }
      } else {
        p.valor = valorIA(d.valor);
        if (!p.valor) {
          return { erro: "Não veio o valor investido, e você NUNCA deve inventar um. Pergunte quanto ele aplicou, numa frase curta." };
        }
      }

      if (cfg.cat === "rf" && cfg.modo !== "poupanca") {
        p.taxa = Number(d.taxa) || 0;
        if (!p.taxa) {
          return { erro: `Não veio a taxa de rendimento do ${p.tipo}, e você não deve inventar uma. Pergunte a taxa contratada numa frase curta (ex: "110% do CDI" ou "12% ao ano").` };
        }
        p.taxaPeriodo = cfg.modo === "cdi" ? "ano" : (d.taxaPeriodo === "mes" ? "mes" : "ano");
        p.regime = "composto";
      } else {
        p.taxa = 0;
        p.taxaPeriodo = "ano";
        p.regime = "composto";
      }

      return { dados: p, perguntas: [] };
    },

    async executar(p) {
      const tipoFinal = p.tipo === "Outro" ? (p.nomeOutro || "Outro") : p.tipo;
      let valor = p.valor;
      let criptoQtd = p.criptoQtd || null;

      // Cripto: busca o preço fresco pra calcular o que faltou (valor ou quantidade)
      if (p.criptoId) {
        try { await atualizarPrecosCripto(true); } catch (e) {}
        const preco = _precosCripto[p.criptoId] && _precosCripto[p.criptoId].brl;
        if (preco) {
          if (!valor && criptoQtd) valor = criptoQtd * preco;
          else if (!criptoQtd && valor) criptoQtd = valor / preco;
        }
        if (!valor) {
          return { ok: false, mensagem: "Não consegui buscar o preço da moeda agora pra calcular o valor. Peça pra ele informar o valor em reais também." };
        }
      }

      const novo = await dbInsert("investimentos", {
        nome: p.apelido || "",
        tipo: tipoFinal,
        valor: valor,
        taxa: p.taxa || 0,
        taxa_periodo: p.taxaPeriodo || "ano",
        regime: p.regime || "composto",
        valor_atual: null,
        renda_passiva: 0,
        valor_atual_em: null,
        conta_id: null,
        data_inicio: hojeISO(),
        cripto_id: p.criptoId || null,
        cripto_qtd: criptoQtd
      });
      state.investimentos.push(mapInvestimento(novo));
      renderTudo();
      if (p.criptoId) atualizarPrecosCripto(true).then(() => renderInvestimentos()).catch(() => {});

      const recibo = [{ rotulo: "Tipo", valor: tipoFinal }, { rotulo: "Valor", valor: fmtMoeda(valor) }];
      if (p.apelido) recibo.unshift({ rotulo: "Nome", valor: p.apelido });
      if (p.taxa) recibo.push({ rotulo: "Rendimento", valor: `${fmtNum(p.taxa)}% ao ${p.taxaPeriodo === "mes" ? "mês" : "ano"}` });
      if (criptoQtd) recibo.push({ rotulo: "Quantidade", valor: `${fmtNum(criptoQtd)} ${(criptoPorId(p.criptoId) || {}).sigla || ""}` });

      return {
        ok: true,
        titulo: "Investimento adicionado",
        recibo,
        mensagem: `Investimento em ${tipoFinal} registrado: ${fmtMoeda(valor)}` +
                  (p.taxa ? `, rendendo ${fmtNum(p.taxa)}% ao ${p.taxaPeriodo === "mes" ? "mês" : "ano"}` : "") + "."
      };
    }
  },

  excluir_investimento: {
    descricao:
      "Apaga um investimento que já está registrado na carteira. Use quando o usuário pedir para apagar, excluir, remover ou desfazer um investimento (ex: 'exclui o bitcoin', 'apaga aquele CDB').",
    parametros: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id do investimento, só quando veio de uma escolha em botões. Deixe vazio na primeira tentativa." },
        busca: { type: "string", description: "Nome, tipo ou moeda do investimento a apagar, como o usuário descreveu (ex: 'bitcoin', 'CDB', 'reserva de emergência')." },
        valor: { type: "number", description: "Valor aplicado, se ele mencionar — ajuda a achar o certo entre vários parecidos." }
      },
      required: ["busca"]
    },

    preparar(d) {
      return _acharInvestimentoIA(d, "Qual investimento você quer apagar?");
    },

    async executar(p) {
      const i = (state.investimentos || []).find(x => String(x.id) === String(p.id));
      if (!i) return { ok: false, mensagem: "Esse investimento não está mais na carteira." };

      const cripto = i.criptoId ? criptoPorId(i.criptoId) : null;
      const rotulo = i.nome || (cripto ? cripto.nome : i.tipo);

      await dbDelete("investimentos", i.id);
      state.investimentos = state.investimentos.filter(x => x.id !== i.id);
      renderTudo();

      return {
        ok: true,
        titulo: "Investimento apagado",
        recibo: [
          { rotulo: "Investimento", valor: rotulo },
          { rotulo: "Valor", valor: fmtMoeda(i.valor) }
        ],
        mensagem: `Apaguei o investimento "${rotulo}" (${fmtMoeda(i.valor)}) da carteira.`
      };
    }
  },

  editar_investimento: {
    descricao: "Muda o apelido, o valor aplicado (aporte), a taxa de rendimento, o valor atual de mercado, ou a renda passiva de um investimento que já existe. Use quando o usuário pedir para corrigir, atualizar ou ajustar um investimento. Preencha só o que ele quer mudar. NÃO serve pra criptomoedas: o valor delas é sempre o preço de mercado ao vivo, não dá pra editar manualmente.",
    parametros: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id do investimento, só quando veio de uma escolha em botões." },
        busca: { type: "string", description: "Nome, tipo ou moeda do investimento a mudar, como o usuário descreveu." },
        novo_apelido: { type: "string", description: "Novo apelido/nome, se ele quer mudar." },
        novo_valor: { type: "number", description: "Novo valor aplicado (aporte total), se ele quer corrigir." },
        nova_taxa: { type: "number", description: "Nova taxa de rendimento (percentual), se ele quer atualizar — só faz sentido pra renda fixa." },
        novo_valor_atual: { type: "number", description: "Quanto o investimento vale hoje no mercado, se ele quer informar/atualizar (ex: ações, FII, imóvel). NÃO use para cripto." },
        nova_renda_passiva: { type: "number", description: "Novo percentual de renda passiva (dividendos/aluguel), se ele quer atualizar." }
      },
      required: ["busca"]
    },
    preparar(d) {
      const achado = _acharInvestimentoIA(d, "Qual investimento você quer mudar?");
      if (achado.erro || (achado.perguntas && achado.perguntas.length)) return achado;
      const inv = (state.investimentos || []).find(i => i.id === achado.dados.id);
      const p = { id: achado.dados.id };
      if (d.novo_apelido) p.novoApelido = String(d.novo_apelido).trim().slice(0, 60);
      if (d.novo_valor != null) p.novoValor = valorIA(d.novo_valor);
      if (d.nova_taxa != null) p.novaTaxa = Number(d.nova_taxa);
      if (d.novo_valor_atual != null && !(inv && inv.criptoId)) p.novoValorAtual = valorIA(d.novo_valor_atual);
      if (d.nova_renda_passiva != null) p.novaRendaPassiva = Number(d.nova_renda_passiva);
      if (!p.novoApelido && p.novoValor == null && p.novaTaxa == null && p.novoValorAtual == null && p.novaRendaPassiva == null) {
        return { erro: "Não veio o que mudar. Pergunte o que ele quer alterar nesse investimento." };
      }
      return { dados: p, perguntas: [] };
    },
    async executar(p) {
      const i = (state.investimentos || []).find(x => String(x.id) === String(p.id));
      if (!i) return { ok: false, mensagem: "Esse investimento não está mais na carteira." };
      const upd = {};
      if (p.novoApelido) upd.nome = p.novoApelido;
      if (p.novoValor != null) upd.valor = p.novoValor;
      if (p.novaTaxa != null) upd.taxa = p.novaTaxa;
      if (p.novoValorAtual != null) { upd.valor_atual = p.novoValorAtual; upd.valor_atual_em = hojeISO(); }
      if (p.novaRendaPassiva != null) upd.renda_passiva = p.novaRendaPassiva;
      const att = await dbUpdate("investimentos", i.id, upd);
      if (upd.nome != null) i.nome = att.nome;
      if (upd.valor != null) i.valor = Number(att.valor);
      if (upd.taxa != null) i.taxa = Number(att.taxa);
      if (upd.valor_atual != null) { i.valorAtual = Number(att.valor_atual); i.valorAtualEm = att.valor_atual_em; }
      if (upd.renda_passiva != null) i.rendaPassiva = Number(att.renda_passiva);
      renderTudo();
      const rotulo = i.nome || i.tipo;
      const mudancas = [];
      if (upd.nome != null) mudancas.push(`nome pra "${i.nome}"`);
      if (upd.valor != null) mudancas.push(`valor aplicado pra ${fmtMoeda(i.valor)}`);
      if (upd.taxa != null) mudancas.push(`taxa pra ${fmtNum(i.taxa)}%`);
      if (upd.valor_atual != null) mudancas.push(`valor atual pra ${fmtMoeda(i.valorAtual)}`);
      if (upd.renda_passiva != null) mudancas.push(`renda passiva pra ${fmtNum(i.rendaPassiva)}%`);
      return {
        ok: true,
        titulo: "Investimento atualizado",
        recibo: [{ rotulo: "Investimento", valor: rotulo }],
        mensagem: `Atualizei "${rotulo}": ${mudancas.join(", ")}.`
      };
    }
  },

  excluir_transferencia: {
    descricao: "Apaga uma transferência entre contas próprias que já existe. Use quando o usuário pedir para apagar, desfazer ou remover uma transferência.",
    parametros: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id da transferência, só quando veio de uma escolha em botões." },
        busca: { type: "string", description: "Nome da conta de origem, destino, ou a descrição da transferência." },
        valor: { type: "number", description: "Valor da transferência, se mencionado — ajuda a desempatar." }
      },
      required: ["busca"]
    },
    preparar(d) {
      const bMap = Object.fromEntries((state.bancos || []).map(b => [b.id, b.nome]));
      return _acharItemIA(d, "Qual transferência você quer apagar?", {
        lista: state.transferencias || [],
        semItens: "Não há nenhuma transferência registrada ainda.",
        campoBusca: t => [bMap[t.origem], bMap[t.destino], t.descricao],
        campoValor: t => t.valor,
        rotulo: t => `${bMap[t.origem] || "?"} → ${bMap[t.destino] || "?"}`,
        extra: t => `${fmtMoeda(t.valor)} · ${formatarDataBR(t.data)}`,
        ordenar: (a, b) => (b.data || "").localeCompare(a.data || "")
      });
    },
    async executar(p) {
      const t = (state.transferencias || []).find(x => String(x.id) === String(p.id));
      if (!t) return { ok: false, mensagem: "Essa transferência não está mais na lista." };
      const bMap = Object.fromEntries((state.bancos || []).map(b => [b.id, b.nome]));
      await dbDelete("transferencias", t.id);
      state.transferencias = state.transferencias.filter(x => x.id !== t.id);
      renderTudo();
      return {
        ok: true,
        titulo: "Transferência apagada",
        recibo: [
          { rotulo: "De", valor: bMap[t.origem] || "?" },
          { rotulo: "Para", valor: bMap[t.destino] || "?" },
          { rotulo: "Valor", valor: fmtMoeda(t.valor) }
        ],
        mensagem: `Apaguei a transferência de ${fmtMoeda(t.valor)} (${bMap[t.origem] || "?"} → ${bMap[t.destino] || "?"}).`
      };
    }
  },

  editar_transferencia: {
    descricao: "Muda o valor, a data, ou a observação de uma transferência entre contas próprias que já existe. Use quando o usuário pedir para corrigir ou ajustar uma transferência. NÃO serve pra trocar as contas de origem/destino — pra isso oriente a excluir e criar de novo.",
    parametros: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id da transferência, só quando veio de uma escolha em botões." },
        busca: { type: "string", description: "Nome da conta de origem, destino, ou a descrição da transferência a mudar." },
        valorAtual: { type: "number", description: "Valor atual da transferência, se ele mencionar — ajuda a achar a certa entre várias parecidas." },
        novo_valor: { type: "number", description: "Novo valor, se ele quer corrigir." },
        nova_data: { type: "string", description: "Nova data (AAAA-MM-DD ou hoje/ontem), se ele quer mudar." },
        nova_descricao: { type: "string", description: "Nova observação, se ele quer mudar." }
      },
      required: ["busca"]
    },
    preparar(d) {
      const bMap = Object.fromEntries((state.bancos || []).map(b => [b.id, b.nome]));
      const achado = _acharItemIA(Object.assign({}, d, { valor: d.valorAtual }), "Qual transferência você quer mudar?", {
        lista: state.transferencias || [],
        semItens: "Não há nenhuma transferência registrada ainda.",
        campoBusca: t => [bMap[t.origem], bMap[t.destino], t.descricao],
        campoValor: t => t.valor,
        rotulo: t => `${bMap[t.origem] || "?"} → ${bMap[t.destino] || "?"}`,
        extra: t => `${fmtMoeda(t.valor)} · ${formatarDataBR(t.data)}`,
        ordenar: (a, b) => (b.data || "").localeCompare(a.data || "")
      });
      if (achado.erro || (achado.perguntas && achado.perguntas.length)) return achado;
      const p = { id: achado.dados.id };
      if (d.novo_valor != null) p.novoValor = valorIA(d.novo_valor);
      if (d.nova_data) p.novaData = resolverDataIA(d.nova_data);
      if (d.nova_descricao) p.novaDescricao = String(d.nova_descricao).trim().slice(0, 120);
      if (!p.novoValor && !p.novaData && !p.novaDescricao) {
        return { erro: "Não veio o que mudar. Pergunte o que ele quer alterar nessa transferência (valor, data ou observação)." };
      }
      return { dados: p, perguntas: [] };
    },
    async executar(p) {
      const t = (state.transferencias || []).find(x => String(x.id) === String(p.id));
      if (!t) return { ok: false, mensagem: "Essa transferência não está mais na lista." };
      const upd = {};
      if (p.novoValor) upd.valor = p.novoValor;
      if (p.novaData) upd.data = p.novaData;
      if (p.novaDescricao) upd.descricao = p.novaDescricao;
      const att = await dbUpdate("transferencias", t.id, upd);
      if (upd.valor != null) t.valor = Number(att.valor);
      if (upd.data != null) t.data = att.data;
      if (upd.descricao != null) t.descricao = att.descricao;
      renderTudo();
      const bMap = Object.fromEntries((state.bancos || []).map(b => [b.id, b.nome]));
      const mudancas = [];
      if (upd.valor != null) mudancas.push(`valor pra ${fmtMoeda(t.valor)}`);
      if (upd.data != null) mudancas.push(`data pra ${formatarDataBR(t.data)}`);
      if (upd.descricao != null) mudancas.push(`observação pra "${t.descricao}"`);
      return {
        ok: true,
        titulo: "Transferência atualizada",
        recibo: [
          { rotulo: "De", valor: bMap[t.origem] || "?" },
          { rotulo: "Para", valor: bMap[t.destino] || "?" },
          { rotulo: "Valor", valor: fmtMoeda(t.valor) }
        ],
        mensagem: `Atualizei a transferência (${bMap[t.origem] || "?"} → ${bMap[t.destino] || "?"}): ${mudancas.join(", ")}.`
      };
    }
  },

  excluir_recorrencia: {
    descricao: "Apaga um gasto fixo (recorrência) — ele deixa de se repetir. Use quando o usuário pedir para cancelar, apagar ou remover algo fixo/mensal.",
    parametros: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id da recorrência, só quando veio de uma escolha em botões." },
        busca: { type: "string", description: "Nome do gasto fixo, como o usuário descreveu (ex: Netflix, aluguel)." },
        valor: { type: "number", description: "Valor da recorrência, se mencionado — ajuda a desempatar." }
      },
      required: ["busca"]
    },
    preparar(d) {
      return _acharItemIA(d, "Qual gasto fixo você quer apagar?", {
        lista: state.recorrencias || [],
        semItens: "Não há nenhum gasto fixo cadastrado ainda.",
        campoBusca: r => [r.descricao],
        campoValor: r => r.valor,
        rotulo: r => r.descricao,
        extra: r => `${fmtMoeda(r.valor)} · dia ${r.dia}`
      });
    },
    async executar(p) {
      const r = (state.recorrencias || []).find(x => String(x.id) === String(p.id));
      if (!r) return { ok: false, mensagem: "Esse gasto fixo não está mais na lista." };
      await dbDelete("recorrencias", r.id);
      state.recorrencias = state.recorrencias.filter(x => x.id !== r.id);
      renderTudo();
      return {
        ok: true,
        titulo: "Gasto fixo apagado",
        recibo: [
          { rotulo: "Descrição", valor: r.descricao },
          { rotulo: "Valor", valor: fmtMoeda(r.valor) }
        ],
        mensagem: `Apaguei o gasto fixo "${r.descricao}" (${fmtMoeda(r.valor)}). Ele não vai mais se repetir.`
      };
    }
  },

  editar_recorrencia: {
    descricao: "Muda o valor, o dia de vencimento ou a categoria de um gasto fixo (recorrência) que já existe. Use quando o usuário pedir para mudar, ajustar ou atualizar algo fixo/mensal. Preencha só o que ele quer mudar.",
    parametros: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id da recorrência, só quando veio de uma escolha em botões." },
        busca: { type: "string", description: "Nome do gasto fixo a mudar." },
        novo_valor: { type: "number", description: "Novo valor, se ele quer mudar o valor." },
        novo_dia: { type: "number", description: "Novo dia do mês (1 a 31), se ele quer mudar o vencimento." },
        nova_categoria: { type: "string", description: "Nova categoria, se ele quer mudar." }
      },
      required: ["busca"]
    },
    preparar(d) {
      const achado = _acharItemIA(d, "Qual gasto fixo você quer mudar?", {
        lista: state.recorrencias || [],
        semItens: "Não há nenhum gasto fixo cadastrado ainda.",
        campoBusca: r => [r.descricao],
        rotulo: r => r.descricao,
        extra: r => `${fmtMoeda(r.valor)} · dia ${r.dia}`
      });
      if (achado.erro || (achado.perguntas && achado.perguntas.length)) return achado;
      const p = { id: achado.dados.id };
      if (d.novo_valor != null) p.novoValor = valorIA(d.novo_valor);
      if (d.novo_dia != null) { const dia = Math.round(Number(d.novo_dia)); if (dia >= 1 && dia <= 31) p.novoDia = dia; }
      if (d.nova_categoria) p.novaCategoria = acharCategoriaIA(d.nova_categoria) || d.nova_categoria;
      if (!p.novoValor && !p.novoDia && !p.novaCategoria) {
        return { erro: "Não veio o que mudar. Pergunte a ele o que quer alterar nesse gasto fixo (valor, dia ou categoria)." };
      }
      return { dados: p, perguntas: [] };
    },
    async executar(p) {
      const r = (state.recorrencias || []).find(x => String(x.id) === String(p.id));
      if (!r) return { ok: false, mensagem: "Esse gasto fixo não está mais na lista." };
      const upd = {};
      if (p.novoValor) upd.valor = p.novoValor;
      if (p.novoDia) upd.dia = p.novoDia;
      if (p.novaCategoria) upd.categoria = p.novaCategoria;
      const att = await dbUpdate("recorrencias", r.id, upd);
      if (upd.valor != null) r.valor = Number(att.valor);
      if (upd.dia != null) r.dia = att.dia;
      if (upd.categoria != null) r.categoria = att.categoria;
      renderTudo();
      const mudancas = [];
      if (upd.valor != null) mudancas.push(`valor pra ${fmtMoeda(r.valor)}`);
      if (upd.dia != null) mudancas.push(`vencimento pro dia ${r.dia}`);
      if (upd.categoria != null) mudancas.push(`categoria pra ${r.categoria}`);
      return {
        ok: true,
        titulo: "Gasto fixo atualizado",
        recibo: [
          { rotulo: "Descrição", valor: r.descricao },
          { rotulo: "Valor", valor: fmtMoeda(r.valor) },
          { rotulo: "Dia", valor: String(r.dia) }
        ],
        mensagem: `Atualizei "${r.descricao}": ${mudancas.join(", ")}.`
      };
    }
  },

  pagar_ocorrencia_gasto_fixo: {
    descricao: "Dá baixa numa ocorrência de gasto fixo (recorrência) — cria o lançamento no extrato pro mês daquela ocorrência. Use quando o usuário disser que pagou (ou recebeu) um gasto fixo/recorrente, tipo aluguel, Netflix, academia, salário. NÃO use pra contas avulsas agendadas — isso é marcar_como_pago.",
    parametros: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id da recorrência, só quando veio de uma escolha em botões." },
        busca: { type: "string", description: "Nome do gasto fixo, como o usuário descreveu (ex: 'aluguel', 'netflix')." },
        vencimento: { type: "string", description: "Vencimento (AAAA-MM-DD) da ocorrência específica, só quando veio de uma escolha em botões." },
        valor: { type: "number", description: "Valor pago/recebido, se diferente do valor combinado (ex: conta de luz que varia). Deixe vazio pra usar o valor padrão do gasto fixo." }
      },
      required: ["busca"]
    },
    preparar(d) {
      const recs = state.recorrencias || [];
      if (!recs.length) return { erro: "Não há nenhum gasto fixo cadastrado ainda." };

      let rec = d.id ? recs.find(r => String(r.id) === String(d.id)) : null;
      if (!rec) {
        const alvo = normIA(d.busca);
        const cand = recs.filter(r => { const n = normIA(r.descricao); return n && (n.includes(alvo) || (alvo.length >= 3 && alvo.includes(n))); });
        if (!cand.length) return { erro: `Não achei nenhum gasto fixo com esse nome. Os cadastrados são: ${recs.slice(0, 8).map(r => r.descricao).join(", ")}.` };
        if (cand.length > 1) {
          return { dados: {}, perguntas: [{ campo: "id", texto: "Qual gasto fixo você quer dar baixa?", opcoes: cand.map(r => ({ v: r.id, t: r.descricao, extra: fmtMoeda(r.valor) })) }] };
        }
        rec = cand[0];
      }

      // Ocorrências em aberto dessa recorrência: atrasadas + próximos 90 dias
      const limite = somarDias(hojeISO(), 90);
      const abertas = ocorrenciasDe(rec, "2000-01-01", limite).filter(venc =>
        !(state.recPagamentos || []).some(pg => pg.recorrenciaId === rec.id && pg.vencimento === venc)
      );
      if (!abertas.length) {
        return { erro: `"${rec.descricao}" não tem nenhuma ocorrência em aberto pra dar baixa nos próximos meses.` };
      }

      const vencEscolhido = d.vencimento && abertas.includes(d.vencimento) ? d.vencimento : null;
      if (!vencEscolhido) {
        if (abertas.length === 1) {
          return { dados: { recId: rec.id, vencimento: abertas[0], valor: d.valor != null ? valorIA(d.valor) : null }, perguntas: [] };
        }
        return {
          dados: { recId: rec.id },
          perguntas: [{
            campo: "vencimento",
            texto: `"${rec.descricao}" tem mais de uma ocorrência em aberto. Qual você quer dar baixa?`,
            opcoes: abertas.slice(0, 6).map(v => ({ v, t: formatarDataBR(v) }))
          }]
        };
      }

      return { dados: { recId: rec.id, vencimento: vencEscolhido, valor: d.valor != null ? valorIA(d.valor) : null }, perguntas: [] };
    },
    async executar(p) {
      const rec = (state.recorrencias || []).find(r => r.id === p.recId);
      if (!rec) return { ok: false, mensagem: "Esse gasto fixo não está mais na lista." };
      const jaPago = (state.recPagamentos || []).some(pg => pg.recorrenciaId === rec.id && pg.vencimento === p.vencimento);
      if (jaPago) return { ok: false, mensagem: `Essa ocorrência de "${rec.descricao}" já estava paga.` };

      const valor = p.valor || rec.valor;
      const hoje = hojeISO();
      // A data do lançamento é o vencimento da ocorrência (não hoje) — mesma
      // lógica de pagarOcorrencia(), pra não inflar o mês errado na Planilha.
      const mov = await dbInsert("movimentos", {
        descricao: rec.descricao, conta_id: rec.contaId, data: p.vencimento,
        valor, tipo: rec.tipo, categoria: rec.categoria,
        recorrencia_id: rec.id, status: "pago", pago_em: hoje
      });
      state.movimentos.push({
        id: mov.id, recorrenciaId: mov.recorrencia_id, descricao: mov.descricao,
        bancoId: mov.conta_id, data: mov.data, valor: Number(mov.valor),
        tipo: mov.tipo, categoria: mov.categoria, status: "pago", vencimento: null, pagoEm: hoje
      });
      const pag = await dbInsert("recorrencia_pagamentos", {
        recorrencia_id: rec.id, vencimento: p.vencimento, pago_em: hoje, valor_pago: valor, movimento_id: mov.id
      });
      state.recPagamentos.push({
        id: pag.id, recorrenciaId: pag.recorrencia_id, vencimento: pag.vencimento,
        pagoEm: pag.pago_em, valorPago: Number(pag.valor_pago), movimentoId: pag.movimento_id
      });
      renderTudo();

      const conta = (state.bancos || []).find(b => b.id === rec.contaId);
      const ehEntrada = rec.tipo === "entrada";
      return {
        ok: true,
        titulo: ehEntrada ? "Recebimento confirmado" : "Pagamento registrado",
        recibo: [
          { rotulo: ehEntrada ? "Recebido" : "Pago", valor: rec.descricao },
          { rotulo: "Valor", valor: fmtMoeda(valor) },
          { rotulo: "Vencimento", valor: formatarDataBR(p.vencimento) }
        ],
        mensagem: `${ehEntrada ? "Recebimento" : "Pagamento"} de "${rec.descricao}" (${formatarDataBR(p.vencimento)}) no valor de ${fmtMoeda(valor)} registrado` +
                  (conta ? ` na conta ${conta.nome}` : "") + "."
      };
    }
  },

  desfazer_pagamento_gasto_fixo: {
    descricao: "Desfaz a baixa de uma ocorrência de gasto fixo já paga — remove o lançamento do extrato e ela volta a ficar pendente. Use quando o usuário pedir para desfazer, cancelar ou reverter o pagamento de um gasto fixo.",
    parametros: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id da recorrência, só quando veio de uma escolha em botões." },
        busca: { type: "string", description: "Nome do gasto fixo, como o usuário descreveu." },
        vencimento: { type: "string", description: "Vencimento (AAAA-MM-DD) da ocorrência, só quando veio de uma escolha em botões." }
      },
      required: ["busca"]
    },
    preparar(d) {
      const recs = state.recorrencias || [];
      if (!recs.length) return { erro: "Não há nenhum gasto fixo cadastrado ainda." };

      let rec = d.id ? recs.find(r => String(r.id) === String(d.id)) : null;
      if (!rec) {
        const alvo = normIA(d.busca);
        const cand = recs.filter(r => { const n = normIA(r.descricao); return n && (n.includes(alvo) || (alvo.length >= 3 && alvo.includes(n))); });
        if (!cand.length) return { erro: "Não achei nenhum gasto fixo com esse nome." };
        if (cand.length > 1) {
          return { dados: {}, perguntas: [{ campo: "id", texto: "Qual gasto fixo?", opcoes: cand.map(r => ({ v: r.id, t: r.descricao })) }] };
        }
        rec = cand[0];
      }

      const pagas = (state.recPagamentos || []).filter(pg => pg.recorrenciaId === rec.id).sort((a, b) => b.vencimento.localeCompare(a.vencimento));
      if (!pagas.length) return { erro: `"${rec.descricao}" não tem nenhum pagamento registrado pra desfazer.` };

      const vencEscolhido = d.vencimento && pagas.some(pg => pg.vencimento === d.vencimento) ? d.vencimento : null;
      if (!vencEscolhido) {
        if (pagas.length === 1) return { dados: { recId: rec.id, vencimento: pagas[0].vencimento }, perguntas: [] };
        return {
          dados: { recId: rec.id },
          perguntas: [{
            campo: "vencimento",
            texto: `"${rec.descricao}" tem mais de um pagamento registrado. Qual você quer desfazer?`,
            opcoes: pagas.slice(0, 6).map(pg => ({ v: pg.vencimento, t: formatarDataBR(pg.vencimento), extra: fmtMoeda(pg.valorPago) }))
          }]
        };
      }
      return { dados: { recId: rec.id, vencimento: vencEscolhido }, perguntas: [] };
    },
    async executar(p) {
      const rec = (state.recorrencias || []).find(r => r.id === p.recId);
      const pag = (state.recPagamentos || []).find(pg => pg.recorrenciaId === p.recId && pg.vencimento === p.vencimento);
      if (!rec || !pag) return { ok: false, mensagem: "Esse pagamento não está mais na lista." };

      if (pag.movimentoId) {
        await dbDelete("movimentos", pag.movimentoId).catch(() => {});
        state.movimentos = state.movimentos.filter(m => m.id !== pag.movimentoId);
      }
      await dbDelete("recorrencia_pagamentos", pag.id);
      state.recPagamentos = state.recPagamentos.filter(x => x.id !== pag.id);
      renderTudo();

      return {
        ok: true,
        titulo: "Pagamento desfeito",
        recibo: [
          { rotulo: "Gasto fixo", valor: rec.descricao },
          { rotulo: "Vencimento", valor: formatarDataBR(p.vencimento) }
        ],
        mensagem: `Desfiz o pagamento de "${rec.descricao}" (${formatarDataBR(p.vencimento)}) — volta a ficar pendente.`
      };
    }
  },

  excluir_conta: {
    descricao: "Apaga uma conta/banco/carteira e as movimentações vinculadas a ela. Ação séria e irreversível — use só quando o usuário pedir claramente para apagar/remover a conta inteira, nunca por engano ou dúvida.",
    parametros: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id da conta, só quando veio de uma escolha em botões." },
        busca: { type: "string", description: "Nome da conta/banco a apagar." }
      },
      required: ["busca"]
    },
    preparar(d) {
      return _acharItemIA(d, "Qual conta você quer apagar?", {
        lista: state.bancos || [],
        semItens: "Não há nenhuma conta cadastrada.",
        campoBusca: b => [b.nome, b.tipo],
        rotulo: b => b.nome,
        extra: b => b.tipo
      });
    },
    async executar(p) {
      const b = (state.bancos || []).find(x => String(x.id) === String(p.id));
      if (!b) return { ok: false, mensagem: "Essa conta não está mais na lista." };
      // Precisa apagar os movimentos vinculados de verdade — sem isso ficam
      // órfãos no banco (mesmo bug que já existia na exclusão pela tela,
      // corrigido lá; essa cópia da lógica na ação da IA tinha ficado pra trás).
      const movsVinculados = (state.movimentos || []).filter(m => m.bancoId === b.id);
      await Promise.all(movsVinculados.map(m => dbDelete("movimentos", m.id)));
      await dbDelete("contas", b.id);
      state.movimentos = state.movimentos.filter(m => m.bancoId !== b.id);
      state.bancos = state.bancos.filter(x => x.id !== b.id);
      renderTudo();
      return {
        ok: true,
        titulo: "Conta apagada",
        recibo: [{ rotulo: "Conta", valor: b.nome }],
        mensagem: `Apaguei a conta "${b.nome}"${movsVinculados.length ? ` e os ${movsVinculados.length} lançamento(s) vinculados a ela` : ""}.`
      };
    }
  },

  editar_banco: {
    descricao: "Muda o nome, o saldo, ou os dados do cartão de crédito (limite, dia de fechamento, dia de vencimento) de uma conta/banco/carteira que já existe. Use quando o usuário pedir para corrigir, atualizar ou ajustar uma conta. Preencha só o que ele quer mudar. NÃO serve pra ligar/desligar o cartão de crédito de uma conta — isso só pela tela (Contas, editar).",
    parametros: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id da conta, só quando veio de uma escolha em botões." },
        busca: { type: "string", description: "Nome da conta/banco a mudar." },
        novo_nome: { type: "string", description: "Novo nome, se ele quer renomear." },
        novo_saldo: { type: "number", description: "Novo saldo total da conta hoje, se ele quer corrigir/atualizar." },
        novo_limite: { type: "number", description: "Novo limite do cartão de crédito, só se a conta já tem cartão habilitado." },
        novo_fechamento: { type: "number", description: "Novo dia de fechamento da fatura (1 a 31), só se a conta já tem cartão." },
        novo_vencimento: { type: "number", description: "Novo dia de vencimento da fatura (1 a 31), só se a conta já tem cartão." }
      },
      required: ["busca"]
    },
    preparar(d) {
      const achado = _acharItemIA(d, "Qual conta você quer mudar?", {
        lista: state.bancos || [],
        semItens: "Não há nenhuma conta cadastrada.",
        campoBusca: b => [b.nome, b.tipo],
        rotulo: b => b.nome,
        extra: b => b.tipo
      });
      if (achado.erro || (achado.perguntas && achado.perguntas.length)) return achado;
      const banco = (state.bancos || []).find(b => b.id === achado.dados.id);
      const p = { id: achado.dados.id };
      if (d.novo_nome) p.novoNome = String(d.novo_nome).trim().slice(0, 40);
      if (d.novo_saldo != null) p.novoSaldo = Number(valorIA(d.novo_saldo));
      if (banco && banco.temCartao) {
        if (d.novo_limite != null) p.novoLimite = Number(valorIA(d.novo_limite));
        if (d.novo_fechamento != null) { const dia = Math.round(Number(d.novo_fechamento)); if (dia >= 1 && dia <= 31) p.novoFechamento = dia; }
        if (d.novo_vencimento != null) { const dia = Math.round(Number(d.novo_vencimento)); if (dia >= 1 && dia <= 31) p.novoVencimento = dia; }
      }
      if (!p.novoNome && p.novoSaldo == null && p.novoLimite == null && p.novoFechamento == null && p.novoVencimento == null) {
        return { erro: "Não veio o que mudar. Pergunte o que ele quer alterar nessa conta (nome, saldo, ou dados do cartão se ela tiver)." };
      }
      return { dados: p, perguntas: [] };
    },
    async executar(p) {
      const b = (state.bancos || []).find(x => String(x.id) === String(p.id));
      if (!b) return { ok: false, mensagem: "Essa conta não está mais na lista." };
      const upd = {};
      if (p.novoNome) upd.nome = p.novoNome;
      if (p.novoSaldo != null) { upd.saldo_inicial = p.novoSaldo; upd.saldo_data = hojeISO(); }
      if (p.novoLimite != null) upd.limite = p.novoLimite;
      if (p.novoFechamento != null) upd.dia_fechamento = p.novoFechamento;
      if (p.novoVencimento != null) upd.dia_vencimento = p.novoVencimento;
      const att = await dbUpdate("contas", b.id, upd);
      if (upd.nome != null) b.nome = att.nome;
      if (upd.saldo_inicial != null) { b.saldoInicial = Number(att.saldo_inicial); b.saldoData = att.saldo_data; }
      if (upd.limite != null) b.limite = Number(att.limite);
      if (upd.dia_fechamento != null) b.diaFechamento = att.dia_fechamento;
      if (upd.dia_vencimento != null) b.diaVencimento = att.dia_vencimento;
      renderTudo();
      const mudancas = [];
      if (upd.nome != null) mudancas.push(`nome pra "${b.nome}"`);
      if (upd.saldo_inicial != null) mudancas.push(`saldo pra ${fmtMoeda(b.saldoInicial)}`);
      if (upd.limite != null) mudancas.push(`limite pra ${fmtMoeda(b.limite)}`);
      if (upd.dia_fechamento != null) mudancas.push(`fechamento pro dia ${b.diaFechamento}`);
      if (upd.dia_vencimento != null) mudancas.push(`vencimento pro dia ${b.diaVencimento}`);
      return {
        ok: true,
        titulo: "Conta atualizada",
        recibo: [{ rotulo: "Conta", valor: b.nome }],
        mensagem: `Atualizei "${b.nome}": ${mudancas.join(", ")}.`
      };
    }
  },

  excluir_objetivo: {
    descricao: "Apaga um objetivo de poupança (meta de juntar dinheiro) que já existe.",
    parametros: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id do objetivo, só quando veio de escolha em botões." },
        busca: { type: "string", description: "Nome do objetivo (ex: Tênis, Viagem)." }
      },
      required: ["busca"]
    },
    preparar(d) {
      return _acharItemIA(d, "Qual objetivo você quer apagar?", {
        lista: state.objetivos || [],
        semItens: "Não há nenhum objetivo cadastrado ainda.",
        campoBusca: o => [o.nome],
        rotulo: o => o.nome,
        extra: o => fmtMoeda(o.valorAlvo)
      });
    },
    async executar(p) {
      const o = (state.objetivos || []).find(x => String(x.id) === String(p.id));
      if (!o) return { ok: false, mensagem: "Esse objetivo não está mais na lista." };
      await dbDelete("objetivos", o.id);
      state.objetivos = state.objetivos.filter(x => x.id !== o.id);
      renderTudo();
      return {
        ok: true,
        titulo: "Objetivo apagado",
        recibo: [{ rotulo: "Objetivo", valor: o.nome }],
        mensagem: `Apaguei o objetivo "${o.nome}".`
      };
    }
  },

  editar_objetivo: {
    descricao: "Muda a meta (valor alvo), o quanto já foi guardado, ou o prazo de um objetivo de poupança que já existe. Preencha só o que ele quer mudar.",
    parametros: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id do objetivo, só quando veio de escolha em botões." },
        busca: { type: "string", description: "Nome do objetivo a mudar." },
        novo_valor: { type: "number", description: "Nova meta (valor alvo), se ele quer mudar." },
        novo_guardado: { type: "number", description: "Novo total já guardado, se ele quer ajustar (ex: 'já juntei mais 200 pro tênis')." },
        novo_prazo: { type: "string", description: "Nova data alvo em AAAA-MM-DD ou algo como 'até dezembro', se ele quer mudar o prazo." }
      },
      required: ["busca"]
    },
    preparar(d) {
      const achado = _acharItemIA(d, "Qual objetivo você quer mudar?", {
        lista: state.objetivos || [],
        semItens: "Não há nenhum objetivo cadastrado ainda.",
        campoBusca: o => [o.nome],
        rotulo: o => o.nome,
        extra: o => fmtMoeda(o.valorAlvo)
      });
      if (achado.erro || (achado.perguntas && achado.perguntas.length)) return achado;
      const p = { id: achado.dados.id };
      if (d.novo_valor != null) p.novoValor = valorIA(d.novo_valor);
      if (d.novo_guardado != null) p.novoGuardado = valorIA(d.novo_guardado);
      if (d.novo_prazo) {
        const dt = resolverDataIA(d.novo_prazo);
        if (/^\d{4}-\d{2}-\d{2}$/.test(dt)) p.novoPrazo = dt;
      }
      if (!p.novoValor && p.novoGuardado == null && !p.novoPrazo) {
        return { erro: "Não veio o que mudar. Pergunte o que ele quer alterar nesse objetivo (meta, quanto já guardou, ou prazo)." };
      }
      return { dados: p, perguntas: [] };
    },
    async executar(p) {
      const o = (state.objetivos || []).find(x => String(x.id) === String(p.id));
      if (!o) return { ok: false, mensagem: "Esse objetivo não está mais na lista." };
      const upd = {};
      if (p.novoValor) upd.valor_alvo = p.novoValor;
      if (p.novoGuardado != null) upd.valor_atual = p.novoGuardado;
      if (p.novoPrazo) { upd.prazo_tipo = "data"; upd.prazo_data = p.novoPrazo; }
      const att = await dbUpdate("objetivos", o.id, upd);
      if (upd.valor_alvo != null) o.valorAlvo = Number(att.valor_alvo);
      if (upd.valor_atual != null) o.valorAtual = Number(att.valor_atual);
      if (upd.prazo_data != null) { o.prazoTipo = att.prazo_tipo; o.prazoData = att.prazo_data; }
      renderTudo();
      const mudancas = [];
      if (upd.valor_alvo != null) mudancas.push(`meta pra ${fmtMoeda(o.valorAlvo)}`);
      if (upd.valor_atual != null) mudancas.push(`guardado pra ${fmtMoeda(o.valorAtual)}`);
      if (upd.prazo_data != null) mudancas.push(`prazo pra ${formatarDataBR(o.prazoData)}`);
      const falta = Math.max(0, o.valorAlvo - o.valorAtual);
      return {
        ok: true,
        titulo: "Objetivo atualizado",
        recibo: [
          { rotulo: "Objetivo", valor: o.nome },
          { rotulo: "Meta", valor: fmtMoeda(o.valorAlvo) },
          { rotulo: "Falta", valor: fmtMoeda(falta) }
        ],
        mensagem: `Atualizei "${o.nome}": ${mudancas.join(", ")}. Falta juntar ${fmtMoeda(falta)}.`
      };
    }
  },

  excluir_meta: {
    descricao: "Apaga o limite de gasto mensal (meta) de uma categoria.",
    parametros: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id da meta, só quando veio de escolha em botões." },
        busca: { type: "string", description: "Categoria da meta a apagar." }
      },
      required: ["busca"]
    },
    preparar(d) {
      return _acharItemIA(d, "Limite de qual categoria você quer apagar?", {
        lista: state.metas || [],
        semItens: "Não há nenhum limite de gasto cadastrado ainda.",
        campoBusca: m => [m.categoria],
        rotulo: m => m.categoria,
        extra: m => fmtMoeda(m.limite)
      });
    },
    async executar(p) {
      const m = (state.metas || []).find(x => String(x.id) === String(p.id));
      if (!m) return { ok: false, mensagem: "Esse limite não está mais na lista." };
      await dbDelete("metas", m.id);
      state.metas = state.metas.filter(x => x.id !== m.id);
      renderTudo();
      return {
        ok: true,
        titulo: "Limite apagado",
        recibo: [{ rotulo: "Categoria", valor: m.categoria }],
        mensagem: `Apaguei o limite de ${m.categoria}.`
      };
    }
  },

  criar_categoria: {
    descricao: "Cria uma categoria personalizada nova, separada das que já vêm no app. Use quando o usuário pedir para criar/adicionar uma categoria (ex: 'cria uma categoria Pet', 'adiciona uma categoria pro meu filho').",
    parametros: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Nome da categoria nova. Se ele não disse, pergunte antes de chamar." }
      },
      required: ["nome"]
    },
    preparar(d) {
      const nome = String(d.nome == null ? "" : d.nome).trim().slice(0, 40);
      if (!nome || nome.length < 2) {
        return { erro: "Não veio o nome da categoria. Pergunte que nome ele quer dar." };
      }
      if (nome.toLowerCase() === "entrada" || nome.toLowerCase() === "todas") {
        return { erro: "Esse nome é reservado pelo app — peça outro nome a ele." };
      }
      if (todasCategorias().some(c => c.toLowerCase() === nome.toLowerCase())) {
        return { erro: `Já existe uma categoria "${nome}" — não crie duplicada, avise que ela já existe.` };
      }
      return { dados: { nome }, perguntas: [] };
    },
    async executar(p) {
      const cor = CORES_CATEGORIA[(state.categorias || []).length % CORES_CATEGORIA.length];
      const nova = await dbInsert("categorias", { user_id: state.user.id, nome: p.nome, cor });
      state.categorias.push({ id: nova.id, nome: nova.nome, cor: nova.cor || null });
      state.categorias.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      atualizarSelectsCategoria();
      renderTudo();
      return {
        ok: true,
        titulo: "Categoria criada",
        recibo: [{ rotulo: "Categoria", valor: p.nome }],
        mensagem: `Criei a categoria "${p.nome}". Já aparece pra escolher em lançamentos, gastos fixos e metas.`
      };
    }
  },

  excluir_categoria: {
    descricao: "Apaga uma categoria personalizada criada pelo usuário. NÃO funciona nas categorias que já vêm de fábrica no app (essas não podem ser apagadas — se ele pedir uma dessas, explique que não dá). Os lançamentos antigos mantêm o nome da categoria mesmo depois de apagada.",
    parametros: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id da categoria, só quando veio de escolha em botões." },
        busca: { type: "string", description: "Nome da categoria a apagar." }
      },
      required: ["busca"]
    },
    preparar(d) {
      return _acharItemIA(d, "Qual categoria você quer apagar?", {
        lista: state.categorias || [],
        semItens: "Você não tem nenhuma categoria personalizada — só as que já vêm no app, que não podem ser apagadas.",
        campoBusca: c => [c.nome],
        rotulo: c => c.nome
      });
    },
    async executar(p) {
      const c = (state.categorias || []).find(x => String(x.id) === String(p.id));
      if (!c) return { ok: false, mensagem: "Essa categoria não está mais na lista." };
      await dbDelete("categorias", c.id);
      state.categorias = state.categorias.filter(x => x.id !== c.id);
      atualizarSelectsCategoria();
      renderTudo();
      return {
        ok: true,
        titulo: "Categoria apagada",
        recibo: [{ rotulo: "Categoria", valor: c.nome }],
        mensagem: `Apaguei a categoria "${c.nome}". Os lançamentos que já usavam ela mantêm o nome.`
      };
    }
  },

  registrar_nota_fiscal: {
    descricao: "Registra uma nota fiscal EMITIDA (ele vendeu/prestou serviço) ou RECEBIDA (ele comprou/tomou serviço) — só um controle/registro pro usuário não perder as contas, NÃO emite nota fiscal de verdade junto à Receita/SEFAZ. Só funciona no espaço Empresarial. Use quando o usuário pedir para registrar, lançar ou anotar uma nota fiscal.",
    parametros: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["emitida", "recebida"], description: "emitida = ele vendeu/prestou serviço; recebida = ele comprou/tomou serviço. Se não estiver claro pelo texto, pergunte com botões." },
        numero: { type: "string", description: "Número da nota, se ele mencionar. Opcional." },
        valor: { type: "number", description: "Valor da nota, em reais. Se ele não disse, pergunte antes de chamar." },
        data: { type: "string", description: "Data da nota em AAAA-MM-DD, ou algo como 'hoje', 'ontem'. Se não disser, use hoje." },
        cliente_fornecedor: { type: "string", description: "Nome do cliente (se emitida) ou fornecedor (se recebida), se mencionar. Opcional — NÃO pergunte se ele não disse, registre sem isso." },
        descricao: { type: "string", description: "O que foi vendido/comprado ou prestado, se mencionar. Opcional — NÃO pergunte se ele não disse (nem em texto, nem em botões), registre sem isso. Só o valor é obrigatório; tudo o resto (número, cliente/fornecedor, descrição) fica vazio se ele não mencionar." }
      },
      required: ["valor"]
    },
    preparar(d) {
      if (state.contextoAtivo !== "empresarial") {
        return { erro: "Notas fiscais só existem no espaço Empresarial. Explique que ele precisa trocar pro espaço Empresarial no seletor da sidebar primeiro (ou usar a ferramenta trocar_contexto, se ele pedir)." };
      }
      const p = {};
      p.valor = valorIA(d.valor);
      if (!p.valor) {
        return { erro: "Não veio o valor da nota. Pergunte quanto foi, e não invente." };
      }
      p.tipo = normIA(d.tipo) === "recebida" ? "recebida" : (normIA(d.tipo) === "emitida" ? "emitida" : "");
      p.numero = String(d.numero || "").trim().slice(0, 40);
      p.clienteFornecedor = String(d.cliente_fornecedor || "").trim().slice(0, 120);
      p.descricao = String(d.descricao || "").trim().slice(0, 200);
      p.data = hojeISO();
      if (d.data) {
        const dt = resolverDataIA(d.data);
        if (/^\d{4}-\d{2}-\d{2}$/.test(dt)) p.data = dt;
      }
      const perguntas = [];
      if (!p.tipo) {
        perguntas.push({
          campo: "tipo",
          texto: "Essa nota é emitida (você vendeu) ou recebida (você comprou)?",
          opcoes: [
            { v: "emitida", t: "Emitida (venda/serviço prestado)" },
            { v: "recebida", t: "Recebida (compra/serviço tomado)" }
          ]
        });
      }
      return { dados: p, perguntas };
    },
    async executar(p) {
      const contatoId = _acharContatoPorNome(p.clienteFornecedor);
      const novo = await dbInsert("notas_fiscais", {
        tipo: p.tipo, numero: p.numero || null, valor: p.valor, data: p.data,
        cliente_fornecedor: p.clienteFornecedor || null, descricao: p.descricao || null,
        contato_id: contatoId
      });
      state.notasFiscais.push({
        id: novo.id, tipo: novo.tipo, numero: novo.numero || "",
        valor: Number(novo.valor), data: novo.data,
        clienteFornecedor: novo.cliente_fornecedor || "", descricao: novo.descricao || "",
        contatoId: novo.contato_id || null
      });
      renderTudo();
      return {
        ok: true,
        titulo: "Nota fiscal registrada",
        recibo: [
          { rotulo: "Tipo", valor: p.tipo === "emitida" ? "Emitida" : "Recebida" },
          { rotulo: "Valor", valor: fmtMoeda(p.valor) },
          { rotulo: "Data", valor: formatarDataBR(p.data) }
        ],
        mensagem: `Registrei a nota ${p.tipo === "emitida" ? "emitida" : "recebida"} de ${fmtMoeda(p.valor)}${p.clienteFornecedor ? ` — ${p.clienteFornecedor}` : ""}.`
      };
    }
  },

  excluir_nota_fiscal: {
    descricao: "Apaga uma nota fiscal registrada. Só funciona no espaço Empresarial.",
    parametros: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id da nota, só quando veio de escolha em botões." },
        busca: { type: "string", description: "Cliente/fornecedor, número ou descrição da nota a apagar." },
        valor: { type: "number", description: "Valor da nota, se mencionado — ajuda a desempatar." }
      },
      required: ["busca"]
    },
    preparar(d) {
      if (state.contextoAtivo !== "empresarial") {
        return { erro: "Notas fiscais só existem no espaço Empresarial. Explique que ele precisa trocar pro espaço Empresarial primeiro." };
      }
      return _acharItemIA(d, "Qual nota fiscal você quer apagar?", {
        lista: state.notasFiscais || [],
        semItens: "Não há nenhuma nota fiscal registrada ainda.",
        campoBusca: n => [n.clienteFornecedor, n.numero, n.descricao],
        campoValor: n => n.valor,
        rotulo: n => n.clienteFornecedor || n.numero || (n.tipo === "emitida" ? "Nota emitida" : "Nota recebida"),
        extra: n => `${fmtMoeda(n.valor)} · ${formatarDataBR(n.data)}`,
        ordenar: (a, b) => (b.data || "").localeCompare(a.data || "")
      });
    },
    async executar(p) {
      const n = (state.notasFiscais || []).find(x => String(x.id) === String(p.id));
      if (!n) return { ok: false, mensagem: "Essa nota fiscal não está mais na lista." };
      await dbDelete("notas_fiscais", n.id);
      state.notasFiscais = state.notasFiscais.filter(x => x.id !== n.id);
      renderTudo();
      return {
        ok: true,
        titulo: "Nota fiscal apagada",
        recibo: [{ rotulo: "Valor", valor: fmtMoeda(n.valor) }],
        mensagem: `Apaguei a nota fiscal de ${fmtMoeda(n.valor)}.`
      };
    }
  },

  criar_contato: {
    descricao: "Cadastra um cliente ou fornecedor. Só funciona no espaço Empresarial. Use quando o usuário pedir para cadastrar/adicionar um cliente ou fornecedor. Depois de cadastrado, o nome passa a ser sugerido automaticamente ao registrar notas fiscais, e as notas com esse nome aparecem agrupadas no cadastro dele.",
    parametros: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Nome do cliente/fornecedor. Se ele não disse, pergunte antes de chamar." },
        tipo: { type: "string", enum: ["cliente", "fornecedor", "ambos"], description: "Se não estiver claro pelo texto, pergunte com botões." },
        documento: { type: "string", description: "CNPJ ou CPF, se ele mencionar. Opcional — NÃO pergunte se ele não disse." },
        telefone: { type: "string", description: "Telefone, se mencionar. Opcional — NÃO pergunte." },
        email: { type: "string", description: "E-mail, se mencionar. Opcional — NÃO pergunte." }
      },
      required: ["nome"]
    },
    preparar(d) {
      if (state.contextoAtivo !== "empresarial") {
        return { erro: "Clientes e fornecedores só existem no espaço Empresarial. Explique que ele precisa trocar pro espaço Empresarial primeiro." };
      }
      const nome = String(d.nome == null ? "" : d.nome).trim().slice(0, 120);
      if (!nome) {
        return { erro: "Não veio o nome. Pergunte o nome do cliente/fornecedor antes de cadastrar." };
      }
      if (state.contatos.some(c => normIA(c.nome) === normIA(nome))) {
        return { erro: `Já existe um cadastro com o nome "${nome}" — avise que já está cadastrado, não crie duplicado.` };
      }
      const p = {
        nome,
        documento: String(d.documento || "").trim().slice(0, 40),
        telefone: String(d.telefone || "").trim().slice(0, 40),
        email: String(d.email || "").trim().slice(0, 120)
      };
      const tipoNorm = normIA(d.tipo);
      p.tipo = tipoNorm === "fornecedor" ? "fornecedor" : tipoNorm === "ambos" ? "ambos" : tipoNorm === "cliente" ? "cliente" : "";
      const perguntas = [];
      if (!p.tipo) {
        perguntas.push({
          campo: "tipo",
          texto: `"${nome}" é cliente, fornecedor ou os dois?`,
          opcoes: [
            { v: "cliente", t: "Cliente" },
            { v: "fornecedor", t: "Fornecedor" },
            { v: "ambos", t: "Os dois" }
          ]
        });
      }
      return { dados: p, perguntas };
    },
    async executar(p) {
      const novo = await dbInsert("contatos", {
        nome: p.nome, tipo: p.tipo, documento: p.documento || null, telefone: p.telefone || null, email: p.email || null
      });
      state.contatos.push({ id: novo.id, nome: novo.nome, tipo: novo.tipo, documento: novo.documento || "", telefone: novo.telefone || "", email: novo.email || "" });
      state.contatos.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      renderTudo();
      const rotuloTipo = { cliente: "Cliente", fornecedor: "Fornecedor", ambos: "Cliente e fornecedor" };
      return {
        ok: true,
        titulo: "Cadastro criado",
        recibo: [
          { rotulo: "Nome", valor: p.nome },
          { rotulo: "Tipo", valor: rotuloTipo[p.tipo] || "Cliente" }
        ],
        mensagem: `Cadastrei "${p.nome}" (${rotuloTipo[p.tipo] || "Cliente"}).`
      };
    }
  },

  excluir_contato: {
    descricao: "Apaga o cadastro de um cliente ou fornecedor. Não apaga as notas fiscais já registradas com esse nome, só o cadastro. Só funciona no espaço Empresarial.",
    parametros: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id do cadastro, só quando veio de escolha em botões." },
        busca: { type: "string", description: "Nome do cliente/fornecedor a apagar." }
      },
      required: ["busca"]
    },
    preparar(d) {
      if (state.contextoAtivo !== "empresarial") {
        return { erro: "Clientes e fornecedores só existem no espaço Empresarial. Explique que ele precisa trocar pro espaço Empresarial primeiro." };
      }
      return _acharItemIA(d, "Qual cadastro você quer apagar?", {
        lista: state.contatos || [],
        semItens: "Não há nenhum cliente ou fornecedor cadastrado ainda.",
        campoBusca: c => [c.nome],
        rotulo: c => c.nome
      });
    },
    async executar(p) {
      const c = (state.contatos || []).find(x => String(x.id) === String(p.id));
      if (!c) return { ok: false, mensagem: "Esse cadastro não está mais na lista." };
      await dbDelete("contatos", c.id);
      state.contatos = state.contatos.filter(x => x.id !== c.id);
      state.notasFiscais.forEach(n => { if (n.contatoId === c.id) n.contatoId = null; });
      renderTudo();
      return {
        ok: true,
        titulo: "Cadastro apagado",
        recibo: [{ rotulo: "Nome", valor: c.nome }],
        mensagem: `Apaguei o cadastro de "${c.nome}". As notas fiscais já registradas continuam do mesmo jeito.`
      };
    }
  },

  trocar_contexto: {
    descricao: "Troca o espaço financeiro ativo entre Pessoal e Empresarial. Use quando o usuário pedir pra trocar, mudar ou ir pro espaço Empresarial ou Pessoal.",
    parametros: {
      type: "object",
      properties: {
        espaco: { type: "string", enum: ["pessoal", "empresarial"], description: "Pra qual espaço trocar." }
      },
      required: ["espaco"]
    },
    preparar(d) {
      const espaco = normIA(d.espaco) === "empresarial" ? "empresarial" : "pessoal";
      if (espaco === "empresarial" && !state.perfil?.empresarial) {
        return { erro: "O usuário não tem o plano Empresarial. Explique que precisa assinar (R$ 41,90/mês) na tela de Planos antes de usar esse espaço." };
      }
      return { dados: { espaco }, perguntas: [] };
    },
    async executar(p) {
      if (p.espaco === state.contextoAtivo) {
        return { ok: true, titulo: "Já estava lá", mensagem: `Você já está no espaço ${p.espaco === "empresarial" ? "Empresarial" : "Pessoal"}.` };
      }
      await alternarContexto(p.espaco);
      return {
        ok: true,
        titulo: "Espaço trocado",
        recibo: [{ rotulo: "Espaço ativo", valor: p.espaco === "empresarial" ? "Empresarial" : "Pessoal" }],
        mensagem: `Troquei pro espaço ${p.espaco === "empresarial" ? "Empresarial" : "Pessoal"}.`
      };
    }
  }

};

/* Acha UM lançamento (gasto/entrada) pela descrição digitada — mesma
   lógica de desambiguação usada em marcar_como_pago: bate substring (dos
   dois lados), afunila por valor se ainda sobrar mais de um, e devolve
   direto quando sobra exatamente um. Usada por editar_lancamento e
   excluir_lancamento. */
function _acharLancamentoIA(d, textoPergunta) {
  const todos = state.movimentos || [];
  if (!todos.length) {
    return { erro: "Não há nenhum lançamento registrado ainda." };
  }

  const escolhido = d.id ? todos.find(m => String(m.id) === String(d.id)) : null;
  if (escolhido) return { dados: { id: escolhido.id }, perguntas: [] };

  const alvo = normIA(d.busca);
  let cand = todos;
  if (alvo) {
    cand = todos.filter(m => {
      const n = normIA(m.descricao);
      return n.includes(alvo) || (alvo.length >= 3 && alvo.includes(n));
    });
  }

  const v = valorIA(d.valor);
  if (v && cand.length > 1) {
    const porValor = cand.filter(m => Math.abs(Number(m.valor) - v) < 0.005);
    if (porValor.length) cand = porValor;
  }

  if (!cand.length) {
    return { erro: `Não achei nenhum lançamento com a descrição "${d.busca || ""}". Pode ser que ele ainda não tenha sido registrado de verdade (confira se uma ferramenta anterior realmente devolveu sucesso), ou o nome pode estar um pouco diferente. Pergunte o nome exato como está no app, ou o valor, numa frase só — sem repetir "${d.busca || ""}" de novo.` };
  }

  if (cand.length === 1) return { dados: { id: cand[0].id }, perguntas: [] };

  // Mais recentes primeiro, e no máximo 8 opções pra não virar uma parede de botões
  const ordenados = cand.slice().sort((a, b) => (b.data || "").localeCompare(a.data || "")).slice(0, 8);
  return {
    dados: { id: "" },
    perguntas: [{
      campo: "id",
      texto: textoPergunta,
      opcoes: ordenados.map(m => ({ v: m.id, t: m.descricao, extra: `${fmtMoeda(m.valor)} · ${formatarDataBR(m.data)}` }))
    }]
  };
}

/* Acha UM investimento pelo nome/tipo/moeda digitado — mesma lógica de
   desambiguação usada em _acharLancamentoIA: bate substring (dos dois
   lados) contra nome, tipo e (se for cripto) nome/sigla da moeda,
   afunila por valor se ainda sobrar mais de um, e devolve direto
   quando sobra exatamente um. Usada por excluir_investimento. */
function _acharInvestimentoIA(d, textoPergunta) {
  const todos = state.investimentos || [];
  if (!todos.length) {
    return { erro: "Não há nenhum investimento registrado ainda." };
  }

  const escolhido = d.id ? todos.find(i => String(i.id) === String(d.id)) : null;
  if (escolhido) return { dados: { id: escolhido.id }, perguntas: [] };

  const rotuloInv = (i) => {
    if (i.nome) return i.nome;
    if (i.criptoId) { const c = criptoPorId(i.criptoId); if (c) return c.nome; }
    return i.tipo;
  };

  const alvo = normIA(d.busca);
  let cand = todos;
  if (alvo) {
    cand = todos.filter(i => {
      const nomes = [i.nome, i.tipo];
      if (i.criptoId) {
        const c = criptoPorId(i.criptoId);
        if (c) { nomes.push(c.nome, c.sigla); }
      }
      return nomes.some(n => {
        const norm = normIA(n || "");
        return norm && (norm.includes(alvo) || (alvo.length >= 3 && alvo.includes(norm)));
      });
    });
  }

  const v = valorIA(d.valor);
  if (v && cand.length > 1) {
    const porValor = cand.filter(i => Math.abs(Number(i.valor) - v) < 0.005);
    if (porValor.length) cand = porValor;
  }

  if (!cand.length) {
    return { erro: `Não achei nenhum investimento com "${d.busca || ""}". Pergunte o nome ou tipo exato como está no app, numa frase só — sem repetir "${d.busca || ""}" de novo.` };
  }

  if (cand.length === 1) return { dados: { id: cand[0].id }, perguntas: [] };

  // Mais recentes primeiro, e no máximo 8 opções pra não virar uma parede de botões
  const ordenados = cand.slice().sort((a, b) => (b.dataInicio || "").localeCompare(a.dataInicio || "")).slice(0, 8);
  return {
    dados: { id: "" },
    perguntas: [{
      campo: "id",
      texto: textoPergunta,
      opcoes: ordenados.map(i => ({ v: i.id, t: rotuloInv(i), extra: fmtMoeda(i.valor) }))
    }]
  };
}

/* Fuzzy-find genérico usado pelos excluir_ e editar_ mais simples
   (transferência, gasto fixo, conta, objetivo, meta, categoria, nota
   fiscal) — mesma lógica de desambiguação de _acharLancamentoIA e
   _acharInvestimentoIA, só que parametrizada em vez de reescrita em
   cada ferramenta. config:
   - lista: array de itens (já filtrado pelo contexto ativo)
   - semItens: mensagem de erro quando a lista está vazia
   - campoBusca(item): array de strings pra bater contra o texto digitado
   - campoValor(item): número, opcional — desempata quando sobra mais de um
   - rotulo(item): texto do botão
   - extra(item): texto secundário do botão, opcional
   - ordenar(a,b): comparador, opcional — padrão é a ordem que já vier */
function _acharItemIA(d, textoPergunta, config) {
  const todos = config.lista || [];
  if (!todos.length) return { erro: config.semItens };

  const escolhido = d.id ? todos.find(x => String(x.id) === String(d.id)) : null;
  if (escolhido) return { dados: { id: escolhido.id }, perguntas: [] };

  const alvo = normIA(d.busca);
  let cand = todos;
  if (alvo) {
    cand = todos.filter(item => {
      const nomes = config.campoBusca(item) || [];
      return nomes.some(n => {
        const norm = normIA(n || "");
        return norm && (norm.includes(alvo) || (alvo.length >= 3 && alvo.includes(norm)));
      });
    });
  }

  if (config.campoValor) {
    const v = valorIA(d.valor);
    if (v && cand.length > 1) {
      const porValor = cand.filter(item => Math.abs(Number(config.campoValor(item)) - v) < 0.005);
      if (porValor.length) cand = porValor;
    }
  }

  if (!cand.length) {
    return { erro: `Não achei nada com o nome "${d.busca || ""}". Pode ser que ainda não tenha sido criado de verdade (confira se uma ferramenta anterior realmente devolveu sucesso), ou o nome pode estar um pouco diferente. Pergunte o nome exato como está no app, numa frase só — sem repetir "${d.busca || ""}" de novo.` };
  }

  if (cand.length === 1) return { dados: { id: cand[0].id }, perguntas: [] };

  const base = config.ordenar ? cand.slice().sort(config.ordenar) : cand.slice();
  const ordenados = base.slice(0, 8);
  return {
    dados: { id: "" },
    perguntas: [{
      campo: "id",
      texto: textoPergunta,
      opcoes: ordenados.map(item => ({ v: item.id, t: config.rotulo(item), extra: config.extra ? config.extra(item) : undefined }))
    }]
  };
}

/* Deduz o tipo da conta pelo nome. Devolve "" quando não tem certeza,
   para o app perguntar em botões. */
function tipoContaIA(nome) {
  const n = normIA(nome);
  if (/nubank|inter\b|c6|picpay|pic pay|mercado pago|neon|next|will|iti|pagbank|banco pan|original|digio/.test(n)) return "Banco Digital";
  if (/ita[uú]|bradesco|santander|banco do brasil|\bbb\b|caixa|safra|sicoob|sicredi|banrisul/.test(n)) return "Banco Tradicional";
  if (/poupanca|poupança/.test(n)) return "Poupança";
  if (/carteira|dinheiro|especie|espécie|cash|fisic/.test(n)) return "Carteira Física";
  if (/binance|coinbase|metamask|cripto|crypto|bitcoin|btc|ethereum|carteira cripto/.test(n)) return "Carteira Crypto";
  if (/xp\b|rico|clear|nuinvest|investiment|corretora|ativa|toro|avenue/.test(n)) return "Investimentos";
  return "";
}

/* Deduz o ícone do objetivo pelo nome (o app tem um conjunto fixo) */
function iconeObjetivoIA(nome) {
  const n = normIA(nome);
  if (/carro|moto|veiculo|honda|toyota|fiat/.test(n)) return "carro";
  if (/viagem|viajar|ferias|praia|europa|chile|disney|passagem|hotel/.test(n)) return "viagem";
  if (/casa|apartamento|apê|ape|imovel|terreno|reforma|mudanca/.test(n)) return "casa";
  if (/curso|faculdade|estudo|escola|mestrado|ingles|livro/.test(n)) return "estudos";
  if (/casamento|noivado|festa|aliança|alianca/.test(n)) return "casamento";
  if (/reserva|emergencia|emergência/.test(n)) return "reserva";
  if (/celular|iphone|notebook|pc|computador|tv|console|playstation|xbox|eletronico|eletrônico|fone/.test(n)) return "eletronico";
  return "geral";
}

/* O que mandamos para a IA como ferramentas disponíveis */
function esquemaAcoesIA() {
  return Object.keys(ACOES_IA).map(nome => ({
    nome: nome,
    descricao: ACOES_IA[nome].descricao,
    parametros: ACOES_IA[nome].parametros
  }));
}

/* ─── A pergunta em botões ──────────────────────────────────
   Uma pergunta de cada vez, opções tocáveis. Depois do toque os
   botões somem e fica só a resposta escolhida, como se ele
   tivesse digitado. Resolve com o valor escolhido, ou null se
   ele desistir. */
function perguntarOpcoesIA(pergunta) {
  return new Promise(resolve => {
    const lista = document.getElementById("iaChatMensagens");
    if (!lista) { resolve(null); return; }

    const msg = document.createElement("div");
    msg.className = "ia-msg ia-msg-ia ia-pergunta-msg";

    const texto = document.createElement("p");
    texto.className = "ia-pergunta-texto";
    texto.textContent = pergunta.texto;
    msg.appendChild(texto);

    const caixa = document.createElement("div");
    caixa.className = "ia-pergunta-opcoes";
    msg.appendChild(caixa);

    let respondido = false;
    const encerrar = (valor, rotulo) => {
      if (respondido) return;
      respondido = true;
      caixa.remove();
      const escolha = document.createElement("p");
      escolha.className = "ia-pergunta-escolha";
      escolha.textContent = rotulo;
      msg.appendChild(escolha);
      lista.scrollTop = lista.scrollHeight;
      resolve(valor);
    };

    (pergunta.opcoes || []).forEach(o => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ia-opcao";

      if (o.cor) {
        const ponto = document.createElement("span");
        ponto.className = "ia-opcao-ponto";
        ponto.style.background = o.cor;
        btn.appendChild(ponto);
      }

      const nome = document.createElement("span");
      nome.className = "ia-opcao-nome";
      nome.textContent = o.t;
      btn.appendChild(nome);

      if (o.extra) {
        const extra = document.createElement("span");
        extra.className = "ia-opcao-extra";
        extra.textContent = o.extra;
        btn.appendChild(extra);
      }

      btn.addEventListener("click", function () { encerrar(o.v, o.t); });
      caixa.appendChild(btn);
    });

    // "Outra..." — só nas perguntas que aceitam algo fora da lista (categoria).
    // Abre um campinho para o usuário digitar; o valor digitado sai com a
    // marca "outra:" para a ação saber que precisa criar.
    if (pergunta.permiteOutra) {
      const btnOutra = document.createElement("button");
      btnOutra.type = "button";
      btnOutra.className = "ia-opcao ia-opcao-outra";
      btnOutra.textContent = pergunta.rotuloOutra || "Outra...";
      btnOutra.addEventListener("click", function () {
        // Troca os botões por um campo de texto + confirmar
        caixa.innerHTML = "";
        const linha = document.createElement("div");
        linha.className = "ia-outra-linha";
        const input = document.createElement("input");
        input.type = "text";
        input.className = "ia-outra-input";
        input.placeholder = "Digite a categoria";
        input.maxLength = 40;
        const okBtn = document.createElement("button");
        okBtn.type = "button";
        okBtn.className = "ia-opcao ia-opcao-confirmar";
        okBtn.textContent = "Criar";
        const confirmar = function () {
          const txt = (input.value || "").trim();
          if (!txt) { input.focus(); return; }
          encerrar("outra:" + txt, txt);
        };
        okBtn.addEventListener("click", confirmar);
        input.addEventListener("keydown", function (e) {
          if (e.key === "Enter") { e.preventDefault(); confirmar(); }
        });
        linha.appendChild(input);
        linha.appendChild(okBtn);
        caixa.appendChild(linha);
        setTimeout(function () { try { input.focus(); } catch (e) {} }, 40);
      });
      caixa.appendChild(btnOutra);
    }

    const desistir = document.createElement("button");
    desistir.type = "button";
    desistir.className = "ia-opcao ia-opcao-desistir";
    desistir.textContent = "Deixa pra lá";
    desistir.addEventListener("click", function () { encerrar(null, "Deixa pra lá"); });
    caixa.appendChild(desistir);

    lista.appendChild(msg);
    lista.scrollTop = lista.scrollHeight;
  });
}

/* O comprovante que aparece no chat depois que a ação foi feita */
function mostrarReciboIA(resultado) {
  const lista = document.getElementById("iaChatMensagens");
  if (!lista || !resultado || !resultado.recibo) return;

  const msg = document.createElement("div");
  msg.className = "ia-msg ia-msg-ia ia-acao-msg";

  const card = document.createElement("div");
  card.className = "ia-acao ia-acao-feito";

  const topo = document.createElement("div");
  topo.className = "ia-acao-topo";
  topo.innerHTML =
    '<span class="ia-acao-icone ia-acao-icone-ok"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>' +
    '<span class="ia-acao-titulo">' + esc(resultado.titulo || "Pronto") + '</span>';
  card.appendChild(topo);

  const corpo = document.createElement("div");
  corpo.className = "ia-acao-recibo";
  resultado.recibo.forEach(item => {
    const linha = document.createElement("div");
    linha.className = "ia-acao-recibo-linha";
    const r = document.createElement("span");
    r.className = "ia-acao-recibo-rot";
    r.textContent = item.rotulo;
    const v = document.createElement("span");
    v.className = "ia-acao-recibo-val";
    v.textContent = item.valor;
    linha.appendChild(r);
    linha.appendChild(v);
    corpo.appendChild(linha);
  });
  card.appendChild(corpo);

  msg.appendChild(card);
  lista.appendChild(msg);
  lista.scrollTop = lista.scrollHeight;
}

/* Executa o que a IA pediu e devolve, em texto, o que aconteceu —
   é esse texto que volta para ela escrever a confirmação. */
async function executarAcaoIA(acao) {
  const def = ACOES_IA[acao && acao.nome];
  if (!def) {
    return "Essa ação não existe no app. Explique ao usuário que você ainda não consegue fazer isso por ele e diga o caminho na tela.";
  }

  let brutos = acao.dados || {};
  let prep;
  try {
    prep = def.preparar(brutos);
  } catch (e) {
    console.error("Falha ao preparar ação da IA:", e);
    return "Não consegui montar essa ação. Peça desculpas e sugira que ele faça pela tela.";
  }
  if (prep.erro) return "NÃO FOI POSSÍVEL. " + prep.erro;

  // Uma pergunta de cada vez, em botões, até não faltar mais nada.
  // jaPerguntados é a trava anti-loop: se um campo já respondido volta a
  // ser pedido, algo está errado — paramos em vez de repetir a pergunta.
  let voltas = 0;
  const jaPerguntados = [];
  while (prep.perguntas && prep.perguntas.length && voltas < 5) {
    voltas++;
    const pergunta = prep.perguntas[0];
    if (jaPerguntados.includes(pergunta.campo)) {
      console.error("Ação da IA repetiria a pergunta:", pergunta.campo);
      return "NÃO FOI POSSÍVEL concluir: o app não resolveu os dados. Peça desculpas em uma frase e sugira que ele registre pela tela do app desta vez.";
    }
    jaPerguntados.push(pergunta.campo);
    let escolhido = await perguntarOpcoesIA(pergunta);
    if (escolhido === null) {
      return "O usuário desistiu quando você perguntou. Nada foi salvo. Responda com uma frase curta dizendo que não salvou e que é só pedir de novo quando quiser.";
    }

    // Categoria digitada pelo usuário (opção "Outra..."): cria de vez e usa
    // o nome dela. Vem marcada com "outra:" para não confundir com um botão.
    if (pergunta.campo === "categoria" && typeof escolhido === "string" && escolhido.indexOf("outra:") === 0) {
      const nomeDigitado = escolhido.slice(6);
      const criada = await criarCategoriaIA(nomeDigitado);
      if (!criada) {
        return "NÃO FOI POSSÍVEL criar essa categoria agora. Peça desculpas em uma frase e sugira tentar de novo.";
      }
      escolhido = criada;
    }

    const novos = {};
    novos[pergunta.campo] = escolhido;
    // A escolha veio de um toque do usuário: se foi a conta, ela é
    // definitiva e a defesa anti-confusão não deve mais mexer nela.
    if (pergunta.campo === "conta") novos._contaConfirmada = true;
    // "À vista" encerra o assunto parcelamento (1x). "Parcelado" ainda vai
    // pedir o número de vezes na próxima pergunta.
    if (pergunta.campo === "_avista") {
      novos._parcelamentoConfirmado = true;
      if (normIA(escolhido) === "avista") novos.parcelas = 1;
    }
    if (pergunta.campo === "parcelas") novos._parcelamentoConfirmado = true;
    brutos = Object.assign({}, brutos, novos);
    try {
      prep = def.preparar(brutos);
    } catch (e) {
      return "Não consegui validar a escolha dele. Peça desculpas e sugira fazer pela tela.";
    }
    if (prep.erro) return "NÃO FOI POSSÍVEL. " + prep.erro;
  }
  if (prep.perguntas && prep.perguntas.length) {
    return "Ainda faltam informações e não deu para salvar. Pergunte a ele o que faltou, em uma frase curta.";
  }

  try {
    const r = await def.executar(prep.dados);
    if (r && r.ok) {
      mostrarReciboIA(r);
      return "FEITO COM SUCESSO. " + r.mensagem;
    }
    return "NÃO FOI POSSÍVEL. " + ((r && r.mensagem) || "Erro desconhecido.");
  } catch (e) {
    console.error("Falha ao executar ação da IA:", e);
    if (typeof tratarErro === "function") tratarErro(e);
    return "NÃO FOI POSSÍVEL. Deu erro ao salvar no servidor. Peça a ele para tentar de novo em instantes.";
  }
}

/* ═══════════════════════════════════════════════════════════
   CHAT DE IA — Assistente FAZ (versão limpa)
   ═══════════════════════════════════════════════════════════ */
(function () {
  let conversaIniciada = false;
  // Memória da conversa, para a IA lembrar do que já foi dito
  const historicoConversa = [];

  // ─── Persistência do chat ───────────────────────────────
  // As mensagens ficam salvas por usuário para sobreviverem ao recarregar
  // a tela. Isoladas por dono (localStorage é do navegador, não da conta),
  // e limpas no logout. Guardamos as mensagens simples (usuário/ia) já
  // renderizadas; cartões de ação/recibo não são reconstruídos (eles
  // representam algo já feito), só o texto.
  const CHAVE_CHAT = "fp_chat";

  function donoAtual() {
    try { return (state.user && state.user.id) ? state.user.id : null; } catch (e) { return null; }
  }

  function salvarChat(mensagensVisiveis) {
    const dono = donoAtual();
    if (!dono) return;
    try {
      localStorage.setItem(CHAVE_CHAT, JSON.stringify({
        dono,
        iniciada: conversaIniciada,
        msgs: mensagensVisiveis.slice(-40),          // teto de 40 mensagens
        historico: historicoConversa.slice(-12)
      }));
    } catch (e) { /* storage cheio: ignora, não é crítico */ }
  }

  function lerChatSalvo() {
    const dono = donoAtual();
    if (!dono) return null;
    try {
      const raw = localStorage.getItem(CHAVE_CHAT);
      if (!raw) return null;
      const dados = JSON.parse(raw);
      // Só devolve se for do dono atual (não vaza entre contas no mesmo navegador)
      if (!dados || dados.dono !== dono) return null;
      return dados;
    } catch (e) { return null; }
  }

  // Coleta as mensagens simples que estão na tela para salvar
  function coletarMensagens() {
    const lista = document.getElementById("iaChatMensagens");
    if (!lista) return [];
    const out = [];
    lista.querySelectorAll(".ia-msg").forEach(el => {
      if (el.classList.contains("ia-digitando")) return;
      // Cartões de ação/recibo/pergunta não são texto puro: pulamos.
      if (el.classList.contains("ia-acao-msg") || el.classList.contains("ia-pergunta-msg")) return;
      const quem = el.classList.contains("ia-msg-usuario") ? "usuario" : "ia";
      // Para o usuário guardamos o texto; para a IA guardamos o texto bruto
      // que reconstruímos via formatarRespostaIA na restauração.
      const texto = el.getAttribute("data-bruto");
      if (texto != null) out.push({ quem, texto });
    });
    return out;
  }

  // Pega o primeiro nome do usuário (perfil, ou parte do email como fallback)
  function primeiroNome() {
    try {
      const nome = (state.perfil && state.perfil.nome ? state.perfil.nome : "").trim();
      if (nome) return nome.split(/\s+/)[0];
      const email = (state.user && state.user.email) ? state.user.email : "";
      const usuario = email.split("@")[0] || "";
      const limpo = usuario.replace(/[._0-9]+/g, " ").trim().split(/\s+/)[0] || "";
      return limpo ? limpo.charAt(0).toUpperCase() + limpo.slice(1) : "";
    } catch (e) { return ""; }
  }

  // Converte a formatação simples da IA (negrito, listas, títulos) em HTML bonito.
  // Escapa o HTML antes, por segurança (nunca injeta tag crua do texto recebido).
  function formatarRespostaIA(texto) {
    const linhas = esc(texto).split("\n");
    let html = "";
    let emLista = false;
    const fecharLista = () => { if (emLista) { html += "</ul>"; emLista = false; } };

    for (let linha of linhas) {
      const t = linha.trim();
      if (t === "") { fecharLista(); continue; }

      // Item de lista: começa com "- " ou "• "
      if (/^[-•]\s+/.test(t)) {
        if (!emLista) { html += '<ul class="ia-lista">'; emLista = true; }
        let item = t.replace(/^[-•]\s+/, "");
        // Par "rótulo: valor" vira duas colunas alinhadas
        const par = item.match(/^(.+?):\s*(R\$\s*[\d.,]+.*)$/);
        if (par) {
          item = '<span class="ia-item-rot">' + aplicarNegrito(par[1]) + '</span>' +
                 '<span class="ia-item-val">' + aplicarNegrito(par[2]) + '</span>';
        } else {
          item = aplicarNegrito(item);
        }
        html += "<li>" + item + "</li>";
        continue;
      }

      fecharLista();

      // Título curto de seção: linha curta terminada em ":"
      if (/:$/.test(t) && t.length <= 42 && !/\d/.test(t.slice(-3, -1))) {
        html += '<div class="ia-titulo">' + aplicarNegrito(t.replace(/:$/, "")) + "</div>";
      } else {
        html += "<p>" + aplicarNegrito(t) + "</p>";
      }
    }
    fecharLista();
    return html;
  }

  // Aplica **negrito** (o texto já vem escapado, então isso é seguro)
  function aplicarNegrito(s) {
    return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  // Adiciona uma mensagem no chat
  function addMsg(texto, quem, naoSalvar) {
    const lista = document.getElementById("iaChatMensagens");
    if (!lista) return null;
    const div = document.createElement("div");
    div.className = "ia-msg ia-msg-" + quem;
    // Guarda o texto original para poder salvar e restaurar a conversa
    div.setAttribute("data-bruto", texto);
    if (quem === "ia") {
      div.innerHTML = formatarRespostaIA(texto);
    } else {
      div.textContent = texto;
    }
    lista.appendChild(div);
    lista.scrollTop = lista.scrollHeight;
    // Salva o estado da conversa (a menos que seja uma restauração)
    if (!naoSalvar) { try { salvarChat(coletarMensagens()); } catch (e) {} }
    return div;
  }

  // Cria o indicador de "digitando" com três pontinhos animados
  function criarIndicadorDigitando() {
    const lista = document.getElementById("iaChatMensagens");
    if (!lista) return null;
    const div = document.createElement("div");
    div.className = "ia-msg ia-msg-ia ia-digitando";
    div.innerHTML = '<span class="ia-ponto"></span><span class="ia-ponto"></span><span class="ia-ponto"></span>';
    lista.appendChild(div);
    lista.scrollTop = lista.scrollHeight;
    return div;
  }

  // Restaura a conversa salva (mensagens + memória). Devolve true se havia
  // algo para restaurar.
  function restaurarChat() {
    const salvo = lerChatSalvo();
    if (!salvo || !Array.isArray(salvo.msgs) || !salvo.msgs.length) return false;
    const lista = document.getElementById("iaChatMensagens");
    if (!lista) return false;
    lista.innerHTML = "";
    salvo.msgs.forEach(m => addMsg(m.texto, m.quem, true));  // true = não re-salva
    // Recompõe a memória que a IA usa para ter contexto
    if (Array.isArray(salvo.historico)) {
      historicoConversa.length = 0;
      salvo.historico.forEach(h => historicoConversa.push(h));
    }
    conversaIniciada = true;
    return true;
  }

  // Abre o chat (restaura a conversa, ou mostra a saudação na primeira vez)
  function abrir() {
    const chat = document.getElementById("iaChat");
    const campo = document.getElementById("iaChatCampo");
    if (!chat) return;
    chat.hidden = false;
    if (!conversaIniciada) {
      // Tenta retomar de onde parou (sobrevive ao recarregar a tela)
      const retomou = restaurarChat();
      if (!retomou) {
        const nome = primeiroNome();
        const abertura = nome ? "Oi, " + nome + "!" : "Oi!";
        // Saudação muda conforme o espaço ativo — nunca mistura os dois na
        // mesma mensagem (ver ESPAÇOS PESSOAL E EMPRESARIAL em chat-ia.js).
        // Curta, pontuação correta, sem travessão, terminando em emoji.
        const empresarial = state.contextoAtivo === "empresarial";
        const saudacao = empresarial
          ? abertura + " Sou o Assistente FAZ no espaço **Empresarial**. Me conta um gasto, tipo \"paguei 800 de fornecedor\", que eu registro pra você 👋"
          : abertura + " Sou o Assistente FAZ. Me conta um gasto, tipo \"gastei 50 no mercado\", que eu registro pra você 👋";
        addMsg(saudacao, "ia");
        conversaIniciada = true;
      }
    }
    setTimeout(function () { if (campo) campo.focus(); }, 100);
  }

  // Apaga a conversa (mensagens + memória) e volta pra saudação inicial.
  // Pede confirmação porque não tem como desfazer — mas nunca desfaz
  // lançamentos já salvos, só o histórico do chat.
  async function limparConversa() {
    const lista = document.getElementById("iaChatMensagens");
    if (!lista || !lista.children.length) return;
    const ok = await confirmar("Apagar esta conversa?", {
      tipo: "perigo",
      descricao: "O histórico do chat some. Isso não desfaz nenhum lançamento que a IA já salvou.",
      okLabel: "Apagar"
    });
    if (!ok) return;

    lista.innerHTML = "";
    historicoConversa.length = 0;
    conversaIniciada = false;
    const dono = donoAtual();
    if (dono) localStorage.removeItem(CHAVE_CHAT);
    abrir();  // mostra a saudação de novo, como se fosse a primeira vez
  }

  // Minimiza o chat (mantém a conversa; o botão fica sempre na sidebar)
  function minimizar() {
    const chat = document.getElementById("iaChat");
    if (!chat) return;
    chat.classList.add("ia-saindo");
    setTimeout(function () {
      chat.hidden = true;
      chat.classList.remove("ia-saindo");
    }, 190);
  }

  // Envia a pergunta para a IA.
  // Se ela pedir para FAZER algo, quem executa é o app (ACOES_IA) — e o
  // resultado volta para ela, que então confirma com os números certos.
  // Cada volta dessas faz parte da MESMA pergunta e não consome outra.
  async function perguntar(pergunta) {
    addMsg(pergunta, "usuario");
    let carregando = criarIndicadorDigitando();
    const tirarCarregando = function () {
      if (carregando) { carregando.remove(); carregando = null; }
    };

    try {
      const token = localStorage.getItem("fp_token") || "";
      // Envia o histórico ANTES de adicionar a pergunta atual (ela vai separada)
      const historicoEnvio = historicoConversa.slice();
      // Registra a pergunta no histórico
      historicoConversa.push({ role: "user", content: pergunta });

      const extras = [];       // o vai e vem das ações desta pergunta
      let resposta = "";
      let voltas = 0;
      let ultimaAcaoOk = false; // a última ação executada deu certo?

      while (voltas < 4) {
        voltas++;

        // Refaz a fotografia a cada volta: depois de uma ação os números
        // mudaram, e é com os novos que ela vai confirmar.
        let resumo = "";
        try { resumo = montarResumoFinanceiro(); } catch (e) { resumo = ""; }

        const corpo = {
          pergunta: pergunta,
          resumoFinanceiro: resumo,
          token: token,
          historico: historicoEnvio,
          // Pra IA saber em qual espaço está respondendo (Pessoal ou
          // Empresarial) e se o outro espaço existe — sem nunca receber os
          // dados financeiros do espaço que não está ativo agora.
          contexto: state.contextoAtivo || "pessoal",
          temEmpresarial: !!state.perfil?.empresarial
        };
        if (typeof esquemaAcoesIA === "function") corpo.acoes = esquemaAcoesIA();
        if (extras.length) { corpo.continuacao = true; corpo.extras = extras; }

        const resp = await fetch("/api/chat-ia", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(corpo)
        });
        const dados = await resp.json();

        if (!resp.ok) {
          tirarCarregando();
          // Limite atingido (mesmo limite pra todo mundo agora — plano único,
          // sem upgrade pra oferecer, então só avisa e explica quando recarrega)
          if (dados.erro === "limite") {
            addMsg(dados.motivo || "Você atingiu o limite de perguntas por agora.", "ia");
            return;
          }
          // Precisa de upgrade (básico)
          if (dados.erro === "upgrade") {
            addMsg(dados.motivo || "Recurso disponível nos planos pagos.", "ia");
            return;
          }
          addMsg(dados.erro || "Desculpe, não consegui responder agora. Tente de novo.", "ia");
          return;
        }

        // Atualiza o contador de usos
        if (dados.usos) {
          atualizarContadorIA(dados.usos.usados, dados.usos.limite);
        }

        // A IA pediu para fazer uma ou mais coisas: o app faz e volta com o
        // resultado. Pode vir mais de uma na mesma resposta (ex: "10.000 no
        // dinheiro e 15.000 no Pix" vira dois criar_lancamento de uma vez) —
        // executamos uma de cada vez, na ordem, e devolvemos um tool_result
        // pra CADA UMA. Faltar o tool_result de alguma delas faz a próxima
        // chamada à API ser rejeitada (é o que causava "Não foi possível
        // obter a resposta da IA." bem no meio de um pedido dividido).
        if (Array.isArray(dados.acoes) && dados.acoes.length && typeof executarAcaoIA === "function") {
          tirarCarregando();
          if (dados.resposta) addMsg(dados.resposta, "ia");
          const resultados = [];
          for (const acaoAtual of dados.acoes) {
            const resultado = await executarAcaoIA(acaoAtual);
            resultados.push({ id: acaoAtual.id, resultado });
          }
          // Guarda se TODAS as ações deram certo: se a IA não escrever a
          // frase final, os comprovantes já estão na tela e a resposta deve
          // ser positiva — nunca "não consegui", que assustaria mesmo tendo
          // dado certo. Se alguma falhou, melhor deixar a IA explicar.
          ultimaAcaoOk = resultados.every(r => /^FEITO COM SUCESSO/.test(r.resultado));
          extras.push({ role: "assistant", content: dados.conteudoIA });
          extras.push({
            role: "user",
            content: resultados.map(r => ({ type: "tool_result", tool_use_id: r.id, content: r.resultado }))
          });
          carregando = criarIndicadorDigitando();
          continue;
        }

        // Sem texto da IA: se a última ação deu certo, o comprovante acima já
        // fala por si — não mostramos nada. Senão, é um erro de verdade.
        resposta = dados.resposta || "";
        if (!resposta && !ultimaAcaoOk) resposta = "Não consegui gerar uma resposta. Pode tentar de novo?";
        break;
      }

      tirarCarregando();
      // Nada a dizer mas a ação foi feita: o comprovante basta, ficamos calados.
      if (!resposta) {
        if (ultimaAcaoOk) return;
        resposta = "Não consegui gerar uma resposta. Pode tentar de novo?";
      }
      addMsg(resposta, "ia");

      // Se o chat estiver minimizado/fechado, notifica no sino que a
      // resposta chegou (se estiver aberto, a pessoa já está vendo).
      const chatEl = document.getElementById("iaChat");
      const chatFechado = !chatEl || chatEl.hidden;
      if (chatFechado) {
        const previa = resposta.replace(/[#*`_]/g, "").slice(0, 80);
        registrarEvento(
          "ia",
          "O assistente respondeu",
          previa + (resposta.length > 80 ? "…" : ""),
          null
        );
      }

      // Guarda a resposta no histórico, para a próxima pergunta ter contexto.
      // Limita o histórico às últimas 12 mensagens (6 trocas) para não crescer sem fim.
      historicoConversa.push({ role: "assistant", content: resposta });
      if (historicoConversa.length > 12) {
        historicoConversa.splice(0, historicoConversa.length - 12);
      }
      // Salva a conversa já com a memória atualizada
      try { salvarChat(coletarMensagens()); } catch (e) {}

    } catch (e) {
      tirarCarregando();
      addMsg("Erro de conexão. Verifique sua internet e tente de novo.", "ia");
    }
  }

  // Atualiza o texto do contador "X de Y perguntas"
  // limite vem null pra quem é admin (sem teto de uso) — sem essa checagem
  // aparecia o texto quebrado "0 de null perguntas disponíveis".
  function atualizarContadorIA(usados, limite) {
    const el = document.getElementById("iaContador");
    if (!el) return;
    el.textContent = (limite == null) ? "Uso ilimitado" : (limite - usados) + " de " + limite + " perguntas disponíveis";
  }

  // ─── Mensagem de voz (grava, transcreve e manda pro mesmo fluxo do texto) ───
  let mediaRecorderIA = null;
  let audioChunksIA = [];
  let streamMicIA = null;
  let gravandoAudio = false;

  function suportaGravacaoAudio() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  function atualizarUIGravacao(ligado) {
    const btn = document.getElementById("iaChatMic");
    const wrap = document.querySelector(".ia-chat-input");
    const campo = document.getElementById("iaChatCampo");
    if (btn) btn.classList.toggle("ia-mic-gravando", ligado);
    if (wrap) wrap.classList.toggle("ia-input-gravando", ligado);
    if (campo) {
      campo.placeholder = ligado ? "Gravando... toque no microfone pra enviar" : "Pergunte algo...";
      campo.disabled = ligado;
    }
  }

  function blobParaBase64(blob) {
    return new Promise((resolve, reject) => {
      const leitor = new FileReader();
      leitor.onload = () => resolve(String(leitor.result).split(",")[1] || "");
      leitor.onerror = reject;
      leitor.readAsDataURL(blob);
    });
  }

  // Quando o áudio não dá pra entender, oferece opções em vez de travar a conversa
  function mostrarFalhaAudio(motivo) {
    const lista = document.getElementById("iaChatMensagens");
    const div = addMsg(motivo + " O que você quer fazer?", "ia");
    if (!div || !lista) return;
    const caixa = document.createElement("div");
    caixa.className = "ia-pergunta-opcoes";
    const opcoes = [
      { rotulo: "🔁 Gravar de novo", acao: () => alternarGravacaoAudio() },
      { rotulo: "⌨️ Escrever a mensagem", acao: () => { const c = document.getElementById("iaChatCampo"); if (c) c.focus(); } },
      { rotulo: "Deixa pra lá", acao: () => {} }
    ];
    opcoes.forEach(o => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ia-opcao";
      btn.textContent = o.rotulo;
      btn.addEventListener("click", function () { caixa.remove(); o.acao(); });
      caixa.appendChild(btn);
    });
    div.appendChild(caixa);
    lista.scrollTop = lista.scrollHeight;
  }

  async function enviarAudioIA(blob) {
    const pensando = addMsg("🎤 Transcrevendo o áudio...", "ia", true);
    try {
      const audioBase64 = await blobParaBase64(blob);
      const token = localStorage.getItem("fp_token") || "";
      const resp = await fetch("/api/transcrever-audio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ audioBase64, tipoAudio: blob.type || "audio/webm", token })
      });
      const dados = await resp.json();
      if (pensando) pensando.remove();

      if (!resp.ok) {
        mostrarFalhaAudio(dados.motivo || dados.erro || "Não consegui entender esse áudio.");
        return;
      }
      const texto = (dados.texto || "").trim();
      if (!texto || texto.length < 2) {
        mostrarFalhaAudio("Não consegui entender esse áudio.");
        return;
      }
      perguntar(texto);
    } catch (e) {
      if (pensando) pensando.remove();
      mostrarFalhaAudio("Deu erro de conexão ao processar o áudio.");
    }
  }

  function pararGravacaoAudio() {
    gravandoAudio = false;
    atualizarUIGravacao(false);
    try { if (mediaRecorderIA && mediaRecorderIA.state !== "inactive") mediaRecorderIA.stop(); } catch (e) {}
  }

  async function alternarGravacaoAudio() {
    if (gravandoAudio) { pararGravacaoAudio(); return; }
    if (typeof ehPremium === "function" && !ehPremium()) {
      pedirUpgrade("O assistente de IA está disponível pra quem assina o FAZ Finanças.", "Assistente de IA");
      return;
    }
    if (!suportaGravacaoAudio()) {
      addMsg("Seu navegador não permite gravar áudio aqui. Tente digitar a mensagem.", "ia");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamMicIA = stream;
      audioChunksIA = [];
      const mimeEscolhido = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : (MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "");
      mediaRecorderIA = mimeEscolhido ? new MediaRecorder(stream, { mimeType: mimeEscolhido }) : new MediaRecorder(stream);

      mediaRecorderIA.addEventListener("dataavailable", function (e) {
        if (e.data && e.data.size > 0) audioChunksIA.push(e.data);
      });
      mediaRecorderIA.addEventListener("stop", function () {
        if (streamMicIA) { streamMicIA.getTracks().forEach(t => t.stop()); streamMicIA = null; }
        const blob = new Blob(audioChunksIA, { type: mediaRecorderIA.mimeType || "audio/webm" });
        audioChunksIA = [];
        if (blob.size < 800) { mostrarFalhaAudio("Não peguei nenhum som nessa gravação."); return; }
        enviarAudioIA(blob);
      });

      mediaRecorderIA.start();
      gravandoAudio = true;
      atualizarUIGravacao(true);
    } catch (e) {
      gravandoAudio = false;
      atualizarUIGravacao(false);
      addMsg("Não consegui acessar o microfone. Verifique a permissão do navegador e tente de novo.", "ia");
    }
  }

  // Liga tudo. Usa delegação no documento — funciona mesmo que os
  // elementos sejam recriados ou o clique caia num filho (SVG).
  function ligar() {
    document.addEventListener("click", function (e) {
      // Abrir (clicou no botão flutuante)
      if (e.target.closest("#iaFab") || e.target.closest("#iaFabMobile")) {
        e.preventDefault();
        if (typeof ehPremium === "function" && !ehPremium()) {
          pedirUpgrade("O assistente de IA está disponível pra quem assina o FAZ Finanças.", "Assistente de IA");
          return;
        }
        abrir();
        return;
      }
      // Minimizar (clicou no X)
      if (e.target.closest("#iaChatFechar")) {
        e.preventDefault();
        minimizar();
        return;
      }
      // Apagar conversa (clicou na lixeira)
      if (e.target.closest("#iaChatLimpar")) {
        e.preventDefault();
        limparConversa();
        return;
      }
      // Enviar (clicou na seta)
      if (e.target.closest("#iaChatEnviar")) {
        e.preventDefault();
        const campo = document.getElementById("iaChatCampo");
        const texto = campo && campo.value ? campo.value.trim() : "";
        if (texto) { campo.value = ""; perguntar(texto); }
        return;
      }
      // Anexar extrato (clicou no clipe)
      if (e.target.closest("#iaChatAnexo")) {
        e.preventDefault();
        document.getElementById("iaChatArquivo")?.click();
        return;
      }
      // Gravar/parar mensagem de voz (clicou no microfone)
      if (e.target.closest("#iaChatMic")) {
        e.preventDefault();
        alternarGravacaoAudio();
        return;
      }
    });

    // Escolheu um ou mais arquivos no chat: manda pra IA organizar
    document.addEventListener("change", function (e) {
      if (e.target && e.target.id === "iaChatArquivo") {
        const arquivos = e.target.files ? Array.from(e.target.files) : [];
        e.target.value = ""; // permite reenviar os mesmos arquivos depois
        if (arquivos.length) enviarExtratoNoChat(arquivos);
      }
    });

    // Enter no campo envia
    document.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target && e.target.id === "iaChatCampo") {
        e.preventDefault();
        const campo = e.target;
        const texto = campo.value ? campo.value.trim() : "";
        if (texto) { campo.value = ""; perguntar(texto); }
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ligar);
  } else {
    ligar();
  }
})();

/* ============================================================
   PWA — registra o Service Worker (ver sw.js: não faz cache de nada de
   propósito, só existe pra satisfazer o critério de instalação do
   navegador). Registrado depois do "load" pra não competir com o
   carregamento inicial da página.
   ============================================================ */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
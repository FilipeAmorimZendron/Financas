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
  perfil: { avatarTipo: "inicial", avatarPadrao: null, avatarUrl: null, nome: null },
  user: null
};

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
  "Outros":           _sv('<path d="M21 8v13H3V8"/><rect x="1" y="3" width="22" height="5" rx="1"/><line x1="12" y1="3" x2="12" y2="21"/>')
};
const ICONE_CAT_FALLBACK = _sv('<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/>');

/* ============================================================
   CATEGORIAS — fonte única de verdade
   As fixas vêm com o app. As personalizadas o usuário cria,
   e ficam salvas na conta dele (tabela "categorias").
   ============================================================ */

/* As que vêm de fábrica. Não podem ser apagadas. */
const CATEGORIAS_FIXAS = [
  "Alimentação", "Transporte", "Moradia", "Saúde",
  "Lazer", "Educação", "Serviços", "Compras", "Outros"
];

/* Cores oferecidas ao criar uma categoria */
const CORES_CATEGORIA = [
  "#7F77DD", "#1D9E75", "#D85A30", "#378ADD",
  "#BA7517", "#D4537E", "#639922", "#888780"
];

/* Todas as categorias disponíveis: fixas + as do usuário */
function todasCategorias() {
  const minhas = (state.categorias || []).map(c => c.nome);
  return [...CATEGORIAS_FIXAS, ...minhas];
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

  // Fixas
  html += CATEGORIAS_FIXAS
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
  html += CATEGORIAS_FIXAS.map(linhaFixa).join("");

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

function _nextToast() {
  if (!_toastQueue.length) { _toastRunning = false; return; }
  _toastRunning = true;
  const { msg, tipo, comUndo } = _toastQueue.shift();
  const t = document.createElement("div");
  t.className = `toast toast-${tipo}`;
  const ic = { success:"✓", error:"✕", warning:"⚠", info:"ℹ" }[tipo] || "ℹ";
  t.innerHTML = `
    <span class="toast-icon">${ic}</span>
    <span class="toast-msg">${msg}</span>
    ${comUndo ? `<button class="toast-undo" onclick="_executarUndo()">Desfazer</button>` : ""}
    <button class="toast-x" onclick="this.closest('.toast').remove()">✕</button>
  `;
  toastContainer.appendChild(t);
  requestAnimationFrame(() => t.classList.add("toast-in"));
  const dur = comUndo ? 5500 : 3000;
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


/* Autenticação */
async function sbLogin(email, senha) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY },
    body: JSON.stringify({ email, password: senha })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || "Erro ao entrar");
  return data;
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
    throw new Error(data.msg || data.error_description || "Não foi possível enviar o e-mail.");
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
  if (!res.ok) throw new Error(data.msg || data.error_description || "Não foi possível alterar a senha.");
  return data;
}


async function sbCadastro(email, senha) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY },
    body: JSON.stringify({ email, password: senha })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || "Erro ao cadastrar");
  // Pixel: novo cadastro concluído (evento de topo de funil)
  if (typeof fbq === "function") { try { fbq("track", "CompleteRegistration"); } catch(e){} }
  return data;
}

async function sbLogout() {
  const token = localStorage.getItem("fp_token");
  if (token) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` }
    }).catch(()=>{});
  }
  localStorage.removeItem("fp_token");
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
async function fetchSeguro(url, opcoes = {}, tentativas = 3) {
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

      // Sessão expirada — não adianta tentar de novo
      if (res.status === 401 || res.status === 403) {
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
    // Dá tempo de ler antes de deslogar
    setTimeout(() => { logout(); }, 2200);
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

async function dbInsert(tabela, dados) {
  const res = await fetchSeguro(`${SUPABASE_URL}/rest/v1/${tabela}`, {
    method: "POST",
    headers: { ..._h, ...getAuthHeader(), "Prefer": "return=representation" },
    body: JSON.stringify(dados)
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
    const [contas, movimentos, transferencias, recorrencias, metas, objetivos, investimentos, recPagamentos, perfilRows, faturasPagas, categorias] = await Promise.all([
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
      dbSelect("categorias").catch(()=>[])
    ]);
    // Mapear campos do banco para o formato do app
    state.bancos         = contas.map(c => ({ id:c.id, nome:c.nome, tipo:c.tipo, saldoInicial: Number(c.saldo_inicial), saldoData: c.saldo_data || null, cor: c.cor || null, temCartao: c.tem_cartao || false, limite: c.limite != null ? Number(c.limite) : null, diaFechamento: c.dia_fechamento || null, diaVencimento: c.dia_vencimento || null }));
    state.movimentos     = movimentos.map(m => ({ id:m.id, descricao:m.descricao, bancoId:m.conta_id, data:m.data, valor:Number(m.valor), tipo:m.tipo, categoria:m.categoria, recorrenciaId:m.recorrencia_id, status:m.status||"pago", vencimento:m.vencimento||null, pagoEm:m.pago_em||null, formaPagamento:m.forma_pagamento||null, cartaoId:m.cartao_id||null, faturaMes:m.fatura_mes||null, parcelaNum:m.parcela_num||null, parcelaTotal:m.parcela_total||null, compraId:m.compra_id||null }));
    state.transferencias = transferencias.map(t => ({ id:t.id, origem:t.conta_origem, destino:t.conta_destino, valor:Number(t.valor), data:t.data, descricao:t.descricao||"" }));
    state.faturasPagas   = (faturasPagas||[]).map(f => ({ id:f.id, cartaoId:f.cartao_id, faturaMes:f.fatura_mes, contaId:f.conta_id||null, valor:Number(f.valor), pagoEm:f.pago_em }));
    state.categorias     = (categorias||[])
      .map(c => ({ id:c.id, nome:c.nome, cor:c.cor||null }))
      .sort((a,b) => a.nome.localeCompare(b.nome, "pt-BR"));
    state.recorrencias   = recorrencias.map(r => ({
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
    state.recPagamentos  = (recPagamentos||[]).map(p => ({
      id:p.id, recorrenciaId:p.recorrencia_id, vencimento:p.vencimento,
      pagoEm:p.pago_em, valorPago: p.valor_pago != null ? Number(p.valor_pago) : null,
      movimentoId: p.movimento_id || null
    }));
    state.metas          = metas.map(m => ({ id:m.id, categoria:m.categoria, limite:Number(m.limite) }));
    state.objetivos      = (objetivos||[]).map(mapObjetivo);
    state.investimentos  = (investimentos||[]).map(mapInvestimento);
  } catch(e) {
    toast("Erro ao carregar dados: " + e.message, "error");
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
  document.getElementById("appLayout").style.display = "none";
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
  document.getElementById("appLayout").style.display = "flex";
  document.body.style.overflow = "";

  // Se a pessoa clicou em "Assinar Premium/Master" na landing antes de
  // criar a conta, levamos ela direto para a tela de Planos com o plano
  // escolhido em destaque — para não perder a intenção de compra.
  let planoPendente = null;
  try { planoPendente = localStorage.getItem("fp_plano_pendente"); } catch (e) {}
  if (planoPendente === "premium" || planoPendente === "master") {
    try { localStorage.removeItem("fp_plano_pendente"); } catch (e) {}
    // Espera o app montar antes de navegar e destacar.
    setTimeout(() => destacarPlanoEscolhido(planoPendente), 600);
  }
}

/* Abre a tela de Planos e destaca o plano que a pessoa escolheu na landing */
function destacarPlanoEscolhido(plano) {
  trocarTela("planos");
  const id = plano === "master" ? "planoCardMaster" : "planoCardPremium";
  const card = document.getElementById(id);
  if (!card) return;
  setTimeout(() => {
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("plano-card-escolhido");
    // Remove o realce depois de um tempo para não ficar permanente
    setTimeout(() => card.classList.remove("plano-card-escolhido"), 3200);
  }, 250);
}

/* ============================================================
   RETORNO DO CHECKOUT (Asaas)
   O Asaas devolve o usuário com ?assinatura=sucesso|cancelada|expirada.
   Como o webhook pode demorar alguns segundos para liberar o plano,
   recarregamos o perfil algumas vezes antes de desistir.
   ============================================================ */
async function tratarRetornoAssinatura() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get("assinatura");
  if (!status) return;

  // Limpa a URL para não repetir a mensagem se a pessoa recarregar a página
  window.history.replaceState({}, document.title, window.location.pathname);

  if (status === "cancelada") {
    toast("Pagamento cancelado. Você continua no plano atual.", "info");
    return;
  }
  if (status === "expirada") {
    toast("O tempo do checkout expirou. Tente assinar novamente.", "warning");
    return;
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
        toast(`Pagamento confirmado! Seu plano ${plano === "master" ? "Master" : "Premium"} já está ativo. 🎉`, "success");
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
              userId: state.user?.id
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
            toast(`Pagamento confirmado! Seu plano ${dados.plano === "master" ? "Master" : "Premium"} já está ativo. 🎉`, "success");
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
      "Se não ativar, escreva para contato@fazfinancas.com.",
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
    localStorage.setItem("fp_user",  JSON.stringify({ email: data.user.email, id: data.user.id }));
    state.user = { email: data.user.email, id: data.user.id };
    document.getElementById("userEmail").textContent = state.user.email;
    await carregarDadosNuvem();
    mostrarTelaApp();
    renderTudo();
    trocarTela("dashboard");
    toast(`Bem-vindo, ${email}! 👋`, "success");
    atualizarCDI().then(() => renderTudo()).catch(() => {});
    // Onboarding para novo usuário
    if (!localStorage.getItem("fp_onboarding_done")) {
      setTimeout(() => mostrarOnboarding(), 600);
    }
  } catch(err) {
    tratarErro(err);
  } finally {
    btn.disabled = false; btn.textContent = "Entrar";
  }
});

/* Cadastro */
document.getElementById("formCadastro")?.addEventListener("submit", async e => {
  e.preventDefault();
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
  btn.disabled = true; btn.textContent = "Cadastrando...";
  try {
    await sbCadastro(email, senha);
    // Registra o consentimento (data e versão dos termos aceitos)
    localStorage.setItem("fp_consentimento", JSON.stringify({
      email, aceitoEm: new Date().toISOString(), versaoTermos: "1.0"
    }));
    toast("Conta criada! Verifique seu e-mail para confirmar, depois faça login.", "success");
    mostrarTela("login");
    document.getElementById("loginEmail").value = email;
  } catch(err) {
    tratarErro(err);
  } finally {
    btn.disabled = false; btn.textContent = "Criar conta";
  }
});

/* Logout */
document.getElementById("btnLogout")?.addEventListener("click", async () => {
  const ok = await confirmar("Sair da sua conta?", { tipo: "neutro", descricao: "Você pode entrar de novo quando quiser.", okLabel: "Sair" });
  if (!ok) return;
  await sbLogout();
  state.bancos = state.movimentos = state.transferencias = state.recorrencias = state.metas = [];
  state.objetivos = state.investimentos = [];
  state.user = null;
  mostrarTelaLogin();
});

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

  // Alimentação
  if (/mercado|supermercado|padaria|açougue|acougue|hortifruti|feira|ifood|ifd\*|rappi|uber\s*eats|delivery|restaurante|lanchonete|pizzaria|hamburgueria|cafe|café|bar\b|boteco|comida|almoço|almoco|jantar|food|mc\s*donald|burger|subway|starbucks|carrefour|extra\b|assai|assaí|atacad|big\b|dia\b|sendas|zaffari|pao de acucar|pão de açúcar|hortifrut|emporio|empório|doceria|sorveteria|acai|açaí|habib|bobs|outback|madero|coco\s*bambu|giraffas|spoleto|cacau\s*show|kopenhagen/.test(t)) return "Alimentação";

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

  // Serviços / assinaturas
  if (/assinatura|salão|salao|cabeleireiro|cabeleireira|barbeiro|barbearia|manicure|pedicure|estética|estetica|spa\b|massagem|lavanderia|conserto|manutenção|manutencao|técnico|tecnico|advogado|contador|contabil|chatgpt|openai|anthropic|claude|google\s*one|icloud|apple\.com|microsoft|office\s*365|adobe|canva|dropbox|notion|figma|github|hostinger|godaddy|registro\.br|vercel|aws\b|correios|cartório|cartorio|despachante/.test(t)) return "Serviços";

  // Compras
  if (/roupa|calçado|calcado|sapato|tênis|tenis|vestu|shopping|loja|magazine|magalu|americanas|amazon|mercado\s*livre|meli\b|mercadolivre|shopee|aliexpress|shein|temu|renner|riachuelo|c&a|marisa|zara|hering|centauro|netshoes|decathlon|nike|adidas|presente|eletrônico|eletronico|celular|notebook|kabum|pichau|terabyte|fast\s*shop|casas\s*bahia|ponto\s*frio|móveis|moveis|mobly|madeiramadeira|tok\s*stok|decoração|decoracao|petz|cobasi|pet\s*shop|sephora|boticario|boticário|natura|avon/.test(t)) return "Compras";

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
        texto: `Seu plano ${nomePlanoAviso || "pago"} segue ativo até ${dataBonita}. Depois dessa data, sua conta volta para o plano grátis. Você pode assinar de novo quando quiser.`,
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
  const faturasCartao = [];
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
      const venc = vencimentoDaFatura(fm, cartao);
      if (venc > limite) return;   // fora do período escolhido
      faturasCartao.push({
        origem: "fatura",
        id: `fatura|${cartao.id}|${fm}`,
        cartaoId: cartao.id,
        faturaMes: fm,
        descricao: `Fatura ${cartao.nome}`,
        valor: porMes[fm],
        tipo: "gasto",
        categoria: "Serviços",
        contaId: cartao.id,
        vencimento: venc
      });
    });
  });

  return [...avulsos, ...recorrentes, ...faturasCartao].sort((a,b) => a.vencimento.localeCompare(b.vencimento));
}

const diasAte = v => Math.round((new Date(v+"T00:00:00") - new Date(hojeISO()+"T00:00:00")) / 86400000);

/* Totais de compromissos — inclui lançamentos avulsos E recorrências não pagas */
function totaisCompromissos() {
  const pend = todosCompromissos();
  const aPagar   = pend.filter(m=>m.tipo==="gasto").reduce((a,m)=>a+m.valor, 0);
  const aReceber = pend.filter(m=>m.tipo==="entrada").reduce((a,m)=>a+m.valor, 0);
  const atrasados = pend.filter(m => diasAte(m.vencimento) < 0);
  const proximos7 = pend.filter(m => { const d = diasAte(m.vencimento); return d >= 0 && d <= 7; });
  return {
    aPagar, aReceber,
    saldoProjetado: calcularSaldoTotal() - aPagar + aReceber,
    atrasados, proximos7,
    qtdPendentes: pend.length,
    lista: pend
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
  const saldoTotal = calcularSaldoTotal();
  const saldos = state.bancos.map(b => ({ b, s: calcularSaldoBanco(b.id) }));
  resumoContasDashboard.innerHTML = `<div class="bancos-cards-grid">` +
    saldos.map(({ b, s }) => {
      const pct = saldoTotal !== 0 ? ((s / saldoTotal) * 100).toFixed(1) : "0.0";
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

function abrirTelaCartao(cartaoId) {
  _cartaoAberto = cartaoId;
  renderTelaCartao();
  document.getElementById("cartaoOverlay").style.display = "flex";
  document.body.style.overflow = "hidden";
}
function fecharTelaCartao() {
  document.getElementById("cartaoOverlay").style.display = "none";
  document.body.style.overflow = "";
  _cartaoAberto = null;
}

function renderTelaCartao() {
  const c = state.bancos.find(b => b.id === _cartaoAberto);
  if (!c) return;
  const corpo = document.getElementById("cartaoCorpo");
  if (!corpo) return;

  const faturaMes = proximaFaturaAberta(c.id);
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
      valor: valor, tipo: "gasto", categoria: "Serviços",
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

  const cards = cartoes.map(c => {
    const faturaMes = proximaFaturaAberta(c.id);
    const aPagar = totalFatura(c.id, faturaMes);
    const disponivel = limiteDisponivel(c.id);
    const paga = faturaEstaPaga(c.id, faturaMes);
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
      : (() => {
          const [fa, fm] = faturaMes.split("-");
          const nm = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
          return `fatura ${nm[Number(fm)-1]}/${fa.slice(2)}`;
        })();

    return `<div class="cartao-card" onclick="abrirTelaCartao('${c.id}')">
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
  const grid   = dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.045)";

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

/* ─── CSV Import helpers ─────────────────────────────────── */
const _normData = s => {
  if (!s) return null;
  s = s.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return null;
};
const _normValor = s => {
  if (!s) return null;
  let t = s.toString().trim().replace(/\s/g,"").replace(/R\$\s*/,"");
  const neg = t.includes("-"); t = t.replace(/-/g,"");
  if (t.includes(",")&&t.includes(".")) t = t.replace(/\./g,"").replace(",",".");
  else if (t.includes(",")) t = t.replace(",",".");
  const n = Number(t); return isNaN(n) ? null : neg ? -Math.abs(n) : n;
};


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
    pedirUpgrade(`O plano gratuito permite até ${limiteContas} contas. Nos planos pagos não há limite.`, "Limite de contas");
    return;
  }
  try {
    const temCartao = document.getElementById("temCartao")?.checked || false;
    const dadosConta = {
      nome, tipo,
      saldo_inicial: saldoInicial,
      saldo_data: saldoData,
      cor: _corEscolhida,
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
      temCartao: novo.tem_cartao || false,
      limite: novo.limite != null ? Number(novo.limite) : null,
      diaFechamento: novo.dia_fechamento || null,
      diaVencimento: novo.dia_vencimento || null
    });

    // Se informou uma fatura atual em aberto, cria uma conta a pagar
    let faturaMsg = "";
    if (temCartao) {
      const faturaAtual = Number(document.getElementById("cartaoFaturaAtual")?.value) || 0;
      if (faturaAtual > 0) {
        // Vencimento: próximo dia de vencimento do cartão
        const venc = proximoVencimentoCartao(novo.dia_vencimento);
        const movFatura = await dbInsert("movimentos", {
          descricao: `Fatura ${nome}`,
          conta_id: novo.id,
          data: venc,
          valor: faturaAtual,
          tipo: "gasto",
          categoria: "Cartão de crédito",
          status: "pendente",
          vencimento: venc
        });
        state.movimentos.push({
          id: movFatura.id, descricao: movFatura.descricao, bancoId: movFatura.conta_id,
          data: movFatura.data, valor: Number(movFatura.valor), tipo: "gasto",
          categoria: movFatura.categoria, status: "pendente",
          vencimento: movFatura.vencimento, pagoEm: null
        });
        faturaMsg = ` Fatura de ${fmtMoeda(faturaAtual)} registrada para pagar.`;
      }
    }

    formBanco.reset();
    const boxReset = document.getElementById("cartaoBox");
    if (boxReset) boxReset.style.display = "none";
    const campoData = document.getElementById("saldoData");
    if (campoData) campoData.value = hojeISO();
    _corEscolhida = null;
    atualizarAmostraCor(); renderTudo();
    toast(`Conta "${nome}" adicionada!${faturaMsg}`,"success");
  } catch(err) { tratarErro(err); }
});

/* ============================================================
   CARTÃO DE CRÉDITO — lógica de fatura e parcelas
   ============================================================ */

/* Descobre em qual fatura (AAAA-MM) uma compra cai, pela data e dia de fechamento.
   Compra até o dia do fechamento entra na fatura do mês corrente;
   depois do fechamento, entra na fatura do mês seguinte. */
function proximoVencimentoCartao(diaVencimento) {
  // Se não há dia de vencimento, usa 10 dias a partir de hoje como padrão
  const hoje = new Date();
  if (!diaVencimento) {
    const d = new Date(hoje);
    d.setDate(d.getDate() + 10);
    return d.toISOString().slice(0, 10);
  }
  // Próxima ocorrência do dia de vencimento (este mês se ainda não passou, senão mês que vem)
  let ano = hoje.getFullYear();
  let mes = hoje.getMonth();
  if (hoje.getDate() >= diaVencimento) mes += 1;  // já passou este mês → mês seguinte
  const ultimoDia = new Date(ano, mes + 1, 0).getDate();
  const dia = Math.min(diaVencimento, ultimoDia);  // respeita meses curtos
  const d = new Date(ano, mes, dia);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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

  // Recurso pago: importar extrato é do Premium e Master
  if (!podeUsar("importarExtrato")) {
    pedirUpgrade("A leitura de extrato está disponível nos planos Premium e Master.", "Importar extrato");
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
                contas: (state.bancos || []).map(b => b.nome)
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

// Guarda o arquivo enquanto o usuário escolhe a conta de destino
let extratoChatPendente = null;

async function enviarExtratoNoChat(arquivo) {
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
    addChat("A leitura de extrato está disponível nos planos Premium e Master.", "ia");
    return;
  }
  if (arquivo.size > 5 * 1024 * 1024) {
    addChat("Esse arquivo é maior que 5 MB. Envie um menor, por favor.", "ia");
    return;
  }
  if (!state.bancos.length) {
    addChat("Antes de importar, cadastre pelo menos uma conta na tela de Contas.", "ia");
    return;
  }

  addChat(`Enviei o extrato: ${arquivo.name}`, "user");

  // Uma conta só? usa ela. Várias? pergunta qual.
  if (state.bancos.length === 1) {
    processarExtratoChat(arquivo, state.bancos[0].id, addChat);
  } else {
    extratoChatPendente = arquivo;
    const opcoes = state.bancos.map(b =>
      `<button type="button" class="rev-opcao" onclick="escolherContaExtratoChat('${b.id}')">${esc(b.nome)}</button>`
    ).join("");
    const div = addChat("Para qual conta devo importar esses lançamentos?", "ia");
    if (div) {
      const box = document.createElement("div");
      box.className = "ia-chat-opcoes";
      box.innerHTML = opcoes;
      div.appendChild(box);
    }
  }
}

function escolherContaExtratoChat(bancoId) {
  const arquivo = extratoChatPendente;
  extratoChatPendente = null;
  if (!arquivo) return;

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
  processarExtratoChat(arquivo, bancoId, addChat);
}

async function processarExtratoChat(arquivo, bancoId, addChat) {
  const pensando = addChat("Estou lendo o arquivo que você enviou. Dependendo do tamanho, isso pode levar até alguns minutos — pode deixar a janela aberta que eu aviso quando terminar.", "ia");

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

    const resp = await fetch("/api/ler-extrato", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo)
    });
    const dados = await resp.json();

    pensando?.remove();

    if (!resp.ok) {
      if (dados.erro === "upgrade") {
        addChat(dados.motivo || "Esse recurso está nos planos pagos.", "ia");
      } else if (dados.erro === "limite") {
        addChat(dados.motivo || "Você atingiu o limite de usos da IA neste período.", "ia");
      } else {
        addChat(dados.erro || "Não consegui ler esse extrato. Tente outro arquivo.", "ia");
      }
      return;
    }

    const lancamentos = dados.lancamentos || [];
    const duvidas = dados.duvidas || [];

    if (!lancamentos.length && !duvidas.length) {
      addChat("Não encontrei transações nesse arquivo. Confira se é mesmo um extrato.", "ia");
      return;
    }

    const total = lancamentos.length + duvidas.length;
    addChat(`Pronto! Encontrei **${total} lançamento(s)**. Abri a tela de revisão para você conferir antes de salvar.`, "ia");
    try {
      abrirRevisao(lancamentos, duvidas, dados.resumo, bancoId);
    } catch (erroRevisao) {
      console.error("Erro ao abrir a revisão:", erroRevisao);
      addChat("Li o extrato, mas tive um problema ao montar a tela de revisão. Tente de novo, e se persistir me avise.", "ia");
    }

  } catch (err) {
    pensando?.remove();
    console.error("Erro ao ler extrato:", err);
    // Mensagem conforme a causa provável
    let msg = "Deu um problema ao ler o arquivo. ";
    if (err && /timeout|network|fetch|Failed/i.test(String(err.message || err))) {
      msg += "A conexão falhou ou o arquivo é muito grande. Tente um extrato menor (por exemplo, de um mês só) ou verifique sua internet.";
    } else {
      msg += "Verifique se o arquivo é um extrato válido (CSV, OFX, PDF ou foto) e tente de novo.";
    }
    addChat(msg, "ia");
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
function opcoesDaDuvida(d) {
  const base = (d && d.opcoes) ? d.opcoes.slice() : CATEGORIAS_BASICAS_REVISAO.slice();
  const personalizadas = (state.categorias || []).map(c => c.nome);
  const juntas = [...base];
  personalizadas.forEach(nome => {
    if (!juntas.some(x => x.toLowerCase() === nome.toLowerCase())) juntas.push(nome);
  });
  return juntas;
}

function categoriasRevisao() {
  return todasCategorias();
}

let revisaoDados = { itens: [], duvidas: [], bancoId: null };
// Guarda o que foi importado por último, para a IA saber responder
// perguntas como "quanto gastei nesse extrato que enviei?".
let ultimaImportacao = null;

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

  // 1) O que a IA não soube — precisa da ajuda do usuário
  if (revisaoDados.duvidas.length) {
    html += `<div class="rev-bloco-duvidas">
      <div class="rev-bloco-titulo">${pendentes.length
        ? `${pendentes.length} ${pendentes.length === 1 ? "item precisa" : "itens precisam"} da sua ajuda`
        : "Tudo respondido, obrigado!"}</div>`;

    revisaoDados.duvidas.forEach((d, i) => {
      const respondida = !!d.resposta;
      const opcoes = opcoesDaDuvida(d);
      let confirmacaoTransf = "";
      if (d.resposta === "__transferencia" && d.transferencia) {
        const bo = state.bancos.find(b => b.id === d.transferencia.origem);
        const bd = state.bancos.find(b => b.id === d.transferencia.destino);
        confirmacaoTransf = `<div class="rev-transf-ok">↔ Transferência: ${esc(bo?.nome || "conta")} → ${esc(bd?.nome || "conta")}. Não conta como gasto.</div>`;
      }
      html += `<div class="rev-duvida ${respondida ? "rev-duvida-ok" : "rev-duvida-pendente"}" id="rev-duvida-${i}">
        <div class="rev-duvida-topo">
          <span class="rev-duvida-desc">${esc(d.descricao || "")}</span>
          <span class="rev-duvida-val ${d.tipo === "entrada" ? "rev-val-entrada" : "rev-val-saida"}">
            ${d.tipo === "entrada" ? "+" : "−"}${fmtMoeda(Number(d.valor) || 0)}
          </span>
        </div>
        <div class="rev-duvida-pergunta">${esc(d.data || "")} · ${esc(d.pergunta || "Qual categoria?")}</div>
        ${confirmacaoTransf}
        <div class="rev-duvida-opcoes">
          ${opcoes.map((op, oi) => {
            const ehSugerida = d.sugerida && op === d.sugerida && !d.resposta;
            return `<button type="button" class="rev-opcao ${d.resposta === op ? "rev-opcao-ativa" : ""} ${ehSugerida ? "rev-opcao-sugerida" : ""}"
              data-duvida="${i}" data-opcao="${oi}">${ehSugerida ? "★ " : ""}${esc(op)}</button>`;
          }).join("")}
          ${d.ehTransferencia ? "" : `<button type="button" class="rev-opcao rev-opcao-criar" data-duvida-criar="${i}">➕ Criar categoria agora</button>`}
          ${d.ehTransferencia ? "" : `<button type="button" class="rev-opcao rev-opcao-transf" data-duvida-transf="${i}">↔ Transferência entre contas</button>`}
          <button type="button" class="rev-opcao rev-opcao-ignorar ${d.resposta === "__ignorar" ? "rev-opcao-ativa" : ""}"
            data-duvida="${i}" data-opcao="-1">Não importar</button>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  // 2) O que a IA já resolveu — conferir e corrigir se quiser
  if (revisaoDados.itens.length) {
    html += `<div class="rev-bloco-ok">
      <div class="rev-bloco-titulo-ok">${revisaoDados.itens.length} já categorizados pela IA — clique na categoria para trocar</div>
      <div class="rev-lista">`;

    revisaoDados.itens.forEach((it, i) => {
      html += `<div class="rev-item">
        <span class="rev-item-data">${esc((it.data || "").slice(8, 10))}/${esc((it.data || "").slice(5, 7))}</span>
        <span class="rev-item-desc">${esc(it.descricao || "")}</span>
        <select class="rev-item-cat" data-item="${i}">
          ${(() => {
            const opcoes = categoriasRevisao().concat(it.tipo === "entrada" ? ["Entrada"] : []);
            // Se a IA devolveu uma categoria fora da lista, inclui para não perder o valor
            if (it.categoria && !opcoes.includes(it.categoria)) opcoes.unshift(it.categoria);
            return opcoes.map(c =>
              `<option value="${esc(c)}" ${it.categoria === c ? "selected" : ""}>${esc(c)}</option>`
            ).join("");
          })()}
        </select>
        <span class="rev-item-val ${it.tipo === "entrada" ? "rev-val-entrada" : "rev-val-saida"}">
          ${it.tipo === "entrada" ? "+" : "−"}${fmtMoeda(Number(it.valor) || 0)}
        </span>
        <button type="button" class="rev-item-remover" onclick="removerItemRevisao(${i})" aria-label="Remover">✕</button>
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
      // Botão "Criar categoria agora": abre um campo para digitar e criar
      const btnCriar = e.target.closest(".rev-opcao-criar");
      if (btnCriar) {
        const iDuvida = Number(btnCriar.dataset.duvidaCriar);
        if (!Number.isNaN(iDuvida)) abrirCriarCategoria(iDuvida);
        return;
      }
      // Botão "Transferência entre contas": reaproveita o fluxo de escolher a conta
      const btnTransf = e.target.closest(".rev-opcao-transf");
      if (btnTransf) {
        const iDuvida = Number(btnTransf.dataset.duvidaTransf);
        if (!Number.isNaN(iDuvida)) escolherContaTransferencia(iDuvida);
        return;
      }
      const btn = e.target.closest(".rev-opcao");
      if (!btn) return;
      const iDuvida = Number(btn.dataset.duvida);
      const iOpcao = Number(btn.dataset.opcao);
      if (Number.isNaN(iDuvida)) return;
      responderDuvida(iDuvida, iOpcao);
    });
    // Troca de categoria nos itens já resolvidos (selects)
    corpo.addEventListener("change", (e) => {
      const sel = e.target.closest(".rev-item-cat");
      if (!sel) return;
      const iItem = Number(sel.dataset.item);
      if (Number.isNaN(iItem)) return;
      trocarCategoriaItem(iItem, sel.value);
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
      // "Não": deixa de ser transferência; se era gasto/entrada, precisa de categoria
      d.ehTransferencia = false;
      d.transferencia = null;
      if (d.tipo === "entrada") {
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
      d.resposta = cat;
      gravarMemoriaCategoria(d.descricao, cat);   // aprende para o próximo extrato
      renderRevisao();
    });
  });
  alvo.appendChild(box);
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
      d.resposta = criada;
      gravarMemoriaCategoria(d.descricao, criada);   // aprende para o próximo extrato
      renderRevisao();
    } else {
      btnOk.disabled = false;
      btnOk.textContent = "Criar e usar";
      alert("Não consegui criar a categoria. Tente outro nome.");
    }
  }

  btnOk.addEventListener("click", confirmar);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); confirmar(); } });
  alvo.appendChild(box);
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

async function salvarRevisao() {
  if (salvandoRevisao) return; // evita clique duplo duplicar lançamentos
  const bancoId = revisaoDados.bancoId;
  if (!bancoId) return;

  // Junta os itens já certos com as dúvidas respondidas
  const paraSalvar = revisaoDados.itens.slice();
  const transferencias = [];
  revisaoDados.duvidas.forEach(d => {
    if (d.resposta === "__transferencia" && d.transferencia) {
      transferencias.push(d.transferencia);
    } else if (d.resposta && d.resposta !== "__ignorar" && d.resposta !== "__transferencia") {
      paraSalvar.push({
        data: d.data, descricao: d.descricao, valor: d.valor,
        tipo: d.tipo, categoria: d.resposta
      });
    }
  });

  if (!paraSalvar.length) { fecharRevisao(); return; }

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
    toast(msg, "success");

    // Notifica no sino que o extrato foi importado
    if (novos.length > 0) {
      const totalImp = novos.reduce((s, m) => s + (Number(m.valor) || 0), 0);
      registrarEvento(
        "extrato",
        "Extrato importado",
        `${novos.length} ${novos.length === 1 ? "lançamento foi adicionado" : "lançamentos foram adicionados"} ao seu histórico.`,
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
        pedirUpgrade(`O plano gratuito permite até ${limiteMetas} metas. Nos planos pagos não há limite.`, "Limite de metas");
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

limparTudoBtn?.addEventListener("click", async () => {
  const ok = await confirmar("Apagar todos os dados?", { tipo: "perigo", descricao: "Isso remove todas as contas, lançamentos, metas e investimentos. Não dá para desfazer.", okLabel: "Apagar tudo" });
  if (!ok) return;
  mostrarLoading(true, "Limpando os dados", "Um momento...");
  try {
    await Promise.all([
      ...state.movimentos.map(m=>dbDelete("movimentos",m.id)),
      ...state.transferencias.map(t=>dbDelete("transferencias",t.id)),
      ...state.recorrencias.map(r=>dbDelete("recorrencias",r.id)),
      ...state.metas.map(m=>dbDelete("metas",m.id)),
      ...state.bancos.map(b=>dbDelete("contas",b.id)),
    ]);
    state.bancos=state.movimentos=state.transferencias=state.recorrencias=state.metas=[];
    renderTudo(); toast("Todos os dados apagados.","info");
  } catch(err) { tratarErro(err); }
  finally { mostrarLoading(false); }
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
  const temMovs = state.movimentos.some(m=>m.bancoId===id);
  const ok = await confirmar("Excluir esta conta?", { tipo: "perigo", descricao: temMovs ? "Ela tem movimentações vinculadas, que também serão removidas." : "A conta e seus dados serão removidos.", okLabel: "Excluir" });
  if (!ok) return;
  const label = state.bancos.find(b=>b.id===id)?.nome || "Conta";
  _salvarUndo();
  try {
    await dbDelete("contas", id);
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
  const ok = await confirmar("Excluir gasto fixo?", { tipo: "perigo", descricao: "Ele deixará de se repetir.", okLabel: "Excluir" }); if (!ok) return;
  const label = state.recorrencias.find(r=>r.id===id)?.descricao || "Recorrência";
  _salvarUndo();
  try {
    await dbDelete("recorrencias", id);
    state.recorrencias = state.recorrencias.filter(r=>r.id!==id);
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
function abrirModal(k)  { _elModal(k)?.classList.add("open"); }
function fecharModal(k) { _elModal(k)?.classList.remove("open"); }

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
    tem_cartao:   temCartao,
    limite:         temCartao ? (Number(document.getElementById("editCartaoLimite")?.value) || 0) : null,
    dia_fechamento: temCartao ? (Number(document.getElementById("editCartaoFechamento")?.value) || null) : null,
    dia_vencimento: temCartao ? (Number(document.getElementById("editCartaoVencimento")?.value) || null) : null,
  };
  try {
    const att = await dbUpdate("contas", id, dados);
    const idx = state.bancos.findIndex(b=>b.id===id);
    if (idx>=0) state.bancos[idx] = { id:att.id, nome:att.nome, tipo:att.tipo, saldoInicial:Number(att.saldo_inicial), saldoData: att.saldo_data || null, cor: att.cor || null, temCartao: att.tem_cartao || false, limite: att.limite != null ? Number(att.limite) : null, diaFechamento: att.dia_fechamento || null, diaVencimento: att.dia_vencimento || null };

    // Se informou uma fatura em aberto, cria uma conta a pagar
    let faturaMsg = "";
    if (temCartao) {
      const faturaAtual = Number(document.getElementById("editCartaoFaturaAtual")?.value) || 0;
      if (faturaAtual > 0) {
        const venc = proximoVencimentoCartao(att.dia_vencimento);
        const movFatura = await dbInsert("movimentos", {
          descricao: `Fatura ${att.nome}`,
          conta_id: att.id,
          data: venc,
          valor: faturaAtual,
          tipo: "gasto",
          categoria: "Cartão de crédito",
          status: "pendente",
          vencimento: venc
        });
        state.movimentos.push({
          id: movFatura.id, descricao: movFatura.descricao, bancoId: movFatura.conta_id,
          data: movFatura.data, valor: Number(movFatura.valor), tipo: "gasto",
          categoria: movFatura.categoria, status: "pendente",
          vencimento: movFatura.vencimento, pagoEm: null
        });
        faturaMsg = ` Fatura de ${fmtMoeda(faturaAtual)} registrada para pagar.`;
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

// Botão "?" nos page-headers — injetado dinamicamente
function injetarBotoesGuia() {
  const mapeamento = {
    "screen-dashboard":      "dashboard",
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

/* Nome da instituição a partir do id da conta */
function nomeInstituicao(contaId) {
  if (!contaId) return null;
  const c = state.bancos.find(b => b.id === contaId);
  return c ? c.nome : null;
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
      let msg = "", cls, icone;

      if (atrasadas.length) {
        const n = atrasadas.length;
        const oQue = temFatura(atrasadas) && n === 1 ? "Fatura atrasada" : `${n} conta${n>1?"s":""} atrasada${n>1?"s":""}`;
        msg = `<strong>${oQue}</strong> — ${fmtMoeda(soma(atrasadas))}`;
        cls = "alerta-erro"; icone = "!";
        const urgentes = hojeVence.length + ate3dias.length;
        if (urgentes) msg += ` · e ${urgentes} vence${urgentes>1?"m":""} em breve`;

      } else if (hojeVence.length) {
        const n = hojeVence.length;
        const oQue = temFatura(hojeVence) && n === 1
          ? "Fatura vence hoje"
          : `${n} conta${n>1?"s":""} vence${n>1?"m":""} hoje`;
        msg = `<strong>${oQue}</strong> — ${fmtMoeda(soma(hojeVence))}`;
        cls = "alerta-erro"; icone = "!";
        if (ate3dias.length) msg += ` · mais ${ate3dias.length} em até 3 dias`;

      } else {
        const n = ate3dias.length;
        const oQue = temFatura(ate3dias) && n === 1 ? "Fatura vence" : `${n} conta${n>1?"s":""} vence${n>1?"m":""}`;
        const dMin = Math.min(...ate3dias.map(m => diasAte(m.vencimento)));
        msg = `<strong>${oQue} ${dMin === 1 ? "amanhã" : `em ${dMin} dias`}</strong> — ${fmtMoeda(soma(ate3dias))}`;
        cls = "alerta-aviso"; icone = "•";
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
    const mov = await dbInsert("movimentos", {
      descricao: rec.descricao,
      conta_id: rec.contaId,
      data: hoje,
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
        <li><strong>Informação e revogação:</strong> fale com o suporte pelo Instagram.</li>
      </ul>

      <h4>7. Retenção e exclusão</h4>
      <p>Seus dados permanecem enquanto a conta existir. Ao excluir a conta, todos os dados são apagados de forma permanente e irreversível.</p>

      <h4>8. Alterações</h4>
      <p>Podemos atualizar esta Política para refletir melhorias ou exigências legais. Alterações relevantes serão comunicadas dentro do aplicativo.</p>

      <h4>9. Contato</h4>
      <p>Dúvidas sobre privacidade ou seus dados? Fale com o suporte pelo Instagram: <a href="https://www.instagram.com/fazfinancas/" target="_blank" rel="noopener">@fazfinancas</a>.</p>
    `
  },
  assinatura: {
    titulo: "Assinatura",
    corpo: `
      <div class="doc-plano">
        <div class="doc-plano-tag">Plano atual</div>
        <div class="doc-plano-nome">Grátis</div>
        <p class="doc-plano-desc">Você tem acesso completo a todas as funcionalidades, sem custo.</p>
      </div>

      <h4>O que está incluído</h4>
      <ul>
        <li>Contas, lançamentos e transferências ilimitados</li>
        <li>Contas a pagar e receber, com recorrências</li>
        <li>Investimentos e simulador de rendimento</li>
        <li>Metas e objetivos de economia</li>
        <li>Sincronização entre dispositivos</li>
        <li>Exportação dos seus dados a qualquer momento</li>
      </ul>

      <h4>E no futuro?</h4>
      <p>Se planos pagos forem lançados, quem já usa o FAZ será avisado com antecedência — e nunca perderá acesso aos próprios dados.</p>
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
      <p>Dúvidas ou suporte? Fale com a gente pelo Instagram: <a href="https://www.instagram.com/fazfinancas/" target="_blank" rel="noopener">@fazfinancas</a>.</p>
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
    investimentos: state.investimentos
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
    // Apaga os dados de todas as tabelas.
    // O RLS garante que só os SEUS dados são atingidos.
    const tabelas = [
      "recorrencia_pagamentos", "movimentos", "transferencias",
      "recorrencias", "metas", "objetivos", "investimentos", "contas"
    ];
    for (const t of tabelas) {
      await fetchSeguro(`${SUPABASE_URL}/rest/v1/${t}?user_id=eq.${state.user.id}`, {
        method: "DELETE",
        headers: { ..._h, ...getAuthHeader() }
      }).catch(() => {});   // segue mesmo se uma tabela não existir
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

/* Menu hambúrguer da landing no mobile */
function lpToggleMenu() {
  const menu = document.getElementById("lpNavMenuMobile");
  const btn = document.getElementById("lpHamburguer");
  if (!menu || !btn) return;
  const aberto = menu.classList.toggle("aberto");
  btn.classList.toggle("aberto", aberto);
}
function lpFecharMenu() {
  document.getElementById("lpNavMenuMobile")?.classList.remove("aberto");
  document.getElementById("lpHamburguer")?.classList.remove("aberto");
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
  { tipo: "ia",  texto: 'Olá! 👋 Sou o Assistente FAZ. Me conta um gasto que eu registro pra você.', hora: "12:40" },
  { tipo: "eu",  texto: 'gastei 200 de gasolina', hora: "12:41" },
  { tipo: "dig" },
  { tipo: "ia",  texto: 'Anotado! <strong>R$ 200,00</strong> em <strong>Transporte</strong>, hoje. Categorizei sozinho ✓', hora: "12:41", notifica: true },
  { tipo: "eu",  texto: 'quanto posso gastar até o fim do mês?', hora: "12:42" },
  { tipo: "dig" },
  { tipo: "ia",  texto: 'Você ainda tem <strong>R$ 1.240,00</strong> de sobra real — já descontando as contas que faltam pagar.', hora: "12:42" },
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

/* Clicou em "Assinar Premium/Master" na landing:
   guarda o plano escolhido e abre o cadastro. Quando a pessoa
   terminar de entrar no app, cai direto na tela de Planos com
   o plano dela em destaque (ver mostrarTelaApp). */
function assinarNaLanding(plano) {
  try { localStorage.setItem("fp_plano_pendente", plano); } catch (e) {}
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
  if (!p) return { avatarTipo: "inicial", avatarPadrao: null, avatarUrl: null, nome: null, plano: "basico", assinaturaStatus: "inativa", atrasoDesde: null };
  return {
    avatarTipo:   p.avatar_tipo   || "inicial",
    avatarPadrao: p.avatar_padrao || null,
    avatarUrl:    p.avatar_url    || null,
    nome:         p.nome          || null,
    plano:            p.plano              || "basico",
    assinaturaStatus: p.assinatura_status  || "inativa",
    atrasoDesde:      p.atraso_desde       || null,
    planoAnterior:    p.plano_anterior     || null,
    proximaCobranca:  p.proxima_cobranca   || null
  };
}

/* ============================================================
   PLANOS E LIMITES (feature-gating)
   Lê o plano do usuário (de state.perfil) e diz o que ele pode.
   ============================================================ */

/* Limites de cada plano. Ajustável com o tempo. */
const LIMITES_PLANO = {
  basico:  { contas: 2,        metas: 5,        investimentos: false, recorrencias: false, relatorios: false, exportar: false, ia: false, importarExtrato: false, conectarBanco: false },
  premium: { contas: Infinity, metas: Infinity, investimentos: true,  recorrencias: true,  relatorios: true,  exportar: true,  ia: true,  importarExtrato: true,  conectarBanco: false },
  master:  { contas: Infinity, metas: Infinity, investimentos: true,  recorrencias: true,  relatorios: true,  exportar: true,  ia: true,  importarExtrato: true,  conectarBanco: true }
};

/* Retorna o plano ATIVO do usuário. Só vale premium/master se a assinatura estiver ativa. */
/* Dias de tolerância após o vencimento antes de cortar o acesso.
   Precisa bater com o DIAS_TOLERANCIA do webhook. */
const DIAS_TOLERANCIA_PLANO = 5;

/* Retorna o plano ATIVO do usuário.
   "ativa"    -> acesso liberado
   "atrasada" -> acesso mantido durante a tolerância, depois cai
   qualquer outro -> básico */
function planoAtual() {
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

  // cancelada_falta_pagamento, inativa e qualquer outro: sem acesso pago
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
    desc: "Este recurso está disponível a partir do plano Premium."
  },
  recorrencias: {
    recurso: "recorrencias",
    titulo: "Contas recorrentes",
    desc: "Este recurso está disponível a partir do plano Premium."
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
   IDENTIDADE VISUAL DAS CONTAS (v16)
   Sem logos de banco (marcas registradas — risco jurídico).
   Cada conta ganha uma cor derivada do nome + a inicial.
   O usuário pode trocar a cor se quiser.
   ============================================================ */

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

/* A "marca" da conta: quadrado colorido com a inicial */
function marcaConta(b, tam) {
  const cor = corDaConta(b);
  const letra = (b?.nome || "?").trim()[0]?.toUpperCase() || "?";
  const classe = tam === "sm" ? "marca-conta marca-conta-sm" : "marca-conta";
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
   No formulário é um botão discreto que abre um popover.
   Cor é detalhe cosmético — não deve competir com nome e saldo. */

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
    if (elId === "corPicker") { atualizarAmostraCor(); fecharCorPop(); }
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
        atualizarAmostraCor();
        fecharCorPop();
      }
    });
  });
}

/* A amostra no botão do formulário */
function atualizarAmostraCor() {
  const am = document.getElementById("corAmostra");
  if (!am) return;
  const nome = document.getElementById("nomeBanco")?.value || "";
  const cor = _corEscolhida || corDoNome(nome);
  am.style.background = cor;
  am.classList.toggle("auto", !_corEscolhida);
}

/* Popover */
function abrirCorPop() {
  const pop = document.getElementById("corPop");
  if (!pop) return;
  const abrindo = !pop.classList.contains("aberto");
  pop.classList.toggle("aberto", abrindo);

  // O painel precisa subir na pilha, senão o popover fica cortado
  pop.closest(".form-panel")?.classList.toggle("tem-pop-aberto", abrindo);

  if (abrindo) montarCorPicker("corPicker", _corEscolhida, c => { _corEscolhida = c; });
}
function fecharCorPop() {
  const pop = document.getElementById("corPop");
  pop?.classList.remove("aberto");
  pop?.closest(".form-panel")?.classList.remove("tem-pop-aberto");
}

/* Fecha ao clicar fora */
document.addEventListener("click", e => {
  const pop = document.getElementById("corPop");
  const btn = document.getElementById("btnCor");
  if (!pop?.classList.contains("aberto")) return;
  if (!pop.contains(e.target) && !btn?.contains(e.target)) fecharCorPop();
});

/* A cor automática muda conforme o nome */
function iniciarCorPicker() {
  atualizarAmostraCor();
  document.getElementById("nomeBanco")?.addEventListener("input", () => {
    atualizarAmostraCor();
    // se o popover estiver aberto, atualiza a opção "auto"
    const pop = document.getElementById("corPop");
    if (pop?.classList.contains("aberto")) {
      montarCorPicker("corPicker", _corEscolhida, c => { _corEscolhida = c; });
    }
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
  ["recorrencias"].forEach(chave => {
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

/* As moedas que o app oferece. O id é o da CoinGecko. */
const CRIPTOS = [
  { id: "bitcoin",      sigla: "BTC",  nome: "Bitcoin" },
  { id: "ethereum",     sigla: "ETH",  nome: "Ethereum" },
  { id: "tether",       sigla: "USDT", nome: "Tether (USDT)" },
  { id: "binancecoin",  sigla: "BNB",  nome: "BNB" },
  { id: "solana",       sigla: "SOL",  nome: "Solana" },
  { id: "ripple",       sigla: "XRP",  nome: "XRP" },
  { id: "cardano",      sigla: "ADA",  nome: "Cardano" },
  { id: "dogecoin",     sigla: "DOGE", nome: "Dogecoin" },
  { id: "usd-coin",     sigla: "USDC", nome: "USD Coin" },
  { id: "polkadot",     sigla: "DOT",  nome: "Polkadot" },
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
  iniciarCorPicker();
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

  // Mostrar splash enquanto verifica sessão
  mostrarSplash();

  const tokenSalvo = localStorage.getItem("fp_token");
  const userSalvo  = localStorage.getItem("fp_user");

  if (tokenSalvo && userSalvo) {
    try {
      state.user = JSON.parse(userSalvo);
      document.getElementById("userEmail").textContent = state.user.email;
      await carregarDadosNuvem();
      esconderSplash();
      mostrarTelaApp();
      renderTudo();
      injetarBotoesGuia();
      trocarTela("dashboard");
      await tratarRetornoAssinatura();

      // Busca a taxa CDI atual em segundo plano (não trava a tela).
      // Sem isso, os rendimentos de CDB/LCI/Tesouro usariam o valor fixo do código.
      atualizarCDI().then(() => renderTudo()).catch(() => {});
    } catch(e) {
      localStorage.removeItem("fp_token");
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
/* ============================================================
   TELA DE PLANOS (v40)
   Toggle mensal/anual troca os valores via data-attributes.
   A cobrança real (Asaas) será ligada depois.
   ============================================================ */
(function initPlanos() {
  const toggle = document.getElementById("planosToggle");
  if (!toggle) return;

  function aplicarCiclo(ciclo) {
    // Atualiza cada elemento que tem data-mensal / data-anual
    document.querySelectorAll("#screen-planos [data-mensal]").forEach(el => {
      const val = el.dataset[ciclo];
      if (val !== undefined) el.textContent = val;
    });
    // Marca o botão ativo
    toggle.querySelectorAll(".planos-toggle-opt").forEach(b =>
      b.classList.toggle("ativo", b.dataset.ciclo === ciclo));
  }

  toggle.addEventListener("click", e => {
    const btn = e.target.closest(".planos-toggle-opt");
    if (!btn) return;
    aplicarCiclo(btn.dataset.ciclo);
  });
})();

/* Chamada ao assinar — placeholder até integrar o Asaas */
async function assinarPlano(plano) {
  const ciclo = document.querySelector("#planosToggle .planos-toggle-opt.ativo")?.dataset.ciclo || "mensal";

  // Precisa estar logado
  if (!state.user || !state.user.id) {
    toast("Faça login para assinar.", "error");
    return;
  }

  toast("Preparando pagamento...", "info");

  try {
    const resp = await fetch("/api/criar-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plano: plano,
        ciclo: ciclo,
        email: state.user.email,
        nome: state.perfil?.nome || null,
        userId: state.user.id
      })
    });

    const dados = await resp.json();

    if (!resp.ok || !dados.url) {
      toast(dados.erro || "Não foi possível iniciar o pagamento. Tente de novo.", "error");
      return;
    }

    // Pixel: iniciou o checkout (clicou para assinar). Manda o valor para o
    // Facebook conseguir otimizar por quem tem mais chance de pagar.
    if (typeof fbq === "function") {
      try {
        const precos = {
          premium: { mensal: 25.90, anual: 264.00 },
          master:  { mensal: 47.90, anual: 488.40 }
        };
        const valor = (precos[plano] && precos[plano][ciclo]) || 0;
        fbq("track", "InitiateCheckout", {
          value: valor,
          currency: "BRL",
          content_name: `${plano}_${ciclo}`
        });
      } catch(e){}
    }

    // Redireciona para a página de pagamento do Asaas
    window.location.href = dados.url;

  } catch (e) {
    toast("Erro de conexão. Tente novamente.", "error");
  }
}

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
  linhas.push("");

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

  // ─── Gastos de HOJE ───
  const movsHoje = state.movimentos.filter(m => (m.data || "").slice(0,10) === hoje && ehPago(m));
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
  const movsMes = state.movimentos.filter(m => (m.data || "").slice(0,7) === mesAtual && ehPago(m));
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
    .filter(m => ehPago(m) && (m.data || "").slice(0,10) >= limite30 && (m.data || "").slice(0,10) <= hoje)
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
    const movs = state.movimentos.filter(m => (m.data||"").slice(0,7) === chave && ehPago(m));
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
        categoria: { type: "string", description: "Categoria do gasto. Deixe vazio para o app escolher sozinho pela descrição." },
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
      p.categoria = p.tipo === "entrada" ? "Entrada" : (acharCategoriaIA(d.categoria) || "");

      // Entrada sem descrição vira um "Entrada" genérico que ninguém entende
      // depois. Não há opção fechada para "de onde veio", então isso não é
      // botão: devolvemos para a IA perguntar em texto. Rede de segurança
      // para quando a IA esquece de perguntar antes.
      if (p.tipo === "entrada" && !p.descricao) {
        return { erro: `Esta entrada de ${fmtMoeda(p.valor)} está sem origem, e um lançamento "Entrada" sem nome fica impossível de entender depois. Pergunte a ele de onde veio esse dinheiro (salário, venda, freela, presente...) e chame a ferramenta de novo com isso na descrição. NÃO invente a origem.` };
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
        return { erro: "Gastos fixos são um recurso dos planos pagos e o usuário está no plano gratuito. Explique que cadastrando uma vez o app cuida dos vencimentos, e que isso está no Premium e no Master." };
      }

      const p = {};
      p.descricao = String(d.descricao == null ? "" : d.descricao).trim().slice(0, 120);
      p.valor = valorIA(d.valor);
      p.tipo = normIA(d.tipo) === "entrada" ? "entrada" : "gasto";
      const freqs = ["mensal", "anual", "diaria"];
      p.frequencia = freqs.includes(normIA(d.frequencia)) ? normIA(d.frequencia) : "mensal";
      p.categoria = p.tipo === "entrada" ? "Entrada" : (acharCategoriaIA(d.categoria) || "");

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
        tem_cartao: false   // cartão de crédito o usuário liga depois, na tela
      });
      state.bancos.push({
        id: novo.id, nome: novo.nome, tipo: novo.tipo,
        saldoInicial: Number(novo.saldo_inicial), saldoData: novo.saldo_data || null,
        cor: novo.cor || null, temCartao: false,
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
  }

};

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
        const abertura = nome ? "Olá, " + nome + "! 👋" : "Olá! 👋";
        const saudacao = abertura + " Sou o Assistente FAZ. Posso cuidar de quase tudo por aqui pra você — é só me pedir com suas palavras. Por exemplo:\n\n" +
          "• \"gastei 200 de gasolina no nubank\" — lanço o gasto e já categorizo\n" +
          "• \"recebi 3500 de salário\" — registro a entrada\n" +
          "• \"cadastra minha conta do Itaú com 1200\" — crio a conta\n" +
          "• \"passa 500 da poupança pro nubank\" — faço a transferência\n" +
          "• \"meu aluguel é 1500 todo dia 10\" — crio o gasto fixo que se repete\n" +
          "• \"quero juntar 6000 pra uma viagem até dezembro\" — monto o objetivo\n" +
          "• \"quero gastar no máximo 800 com alimentação\" — defino o limite\n\n" +
          "Também respondo dúvidas como \"quanto posso gastar esse mês?\". Como posso te ajudar?";
        addMsg(saudacao, "ia");
        conversaIniciada = true;
      }
    }
    setTimeout(function () { if (campo) campo.focus(); }, 100);
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
          historico: historicoEnvio
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
          // Limite atingido
          if (dados.erro === "limite") {
            const div = addMsg(dados.motivo || "Você atingiu o limite de perguntas.", "ia");
            // Não tira o usuário do chat: oferece o caminho, ele decide
            if (dados.plano === "premium" && div) {
              const btn = document.createElement("button");
              btn.type = "button";
              btn.className = "ia-btn-planos";
              btn.textContent = "Ver planos";
              btn.onclick = function () {
                minimizar();
                irParaPlanos("Limite de perguntas", "No Master você tem 100 perguntas por mês.");
              };
              div.appendChild(btn);
            }
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

        // A IA pediu para fazer algo: o app faz e volta com o resultado
        if (dados.acao && typeof executarAcaoIA === "function") {
          tirarCarregando();
          if (dados.resposta) addMsg(dados.resposta, "ia");
          const resultado = await executarAcaoIA(dados.acao);
          // Guarda se a ação deu certo: se a IA não escrever a frase final,
          // o comprovante já está na tela e a resposta deve ser positiva —
          // nunca "não consegui", que assustaria mesmo tendo dado certo.
          ultimaAcaoOk = /^FEITO COM SUCESSO/.test(resultado);
          extras.push({ role: "assistant", content: dados.conteudoIA });
          extras.push({
            role: "user",
            content: [{ type: "tool_result", tool_use_id: dados.acao.id, content: resultado }]
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
  function atualizarContadorIA(usados, limite) {
    const el = document.getElementById("iaContador");
    if (el) el.textContent = (limite - usados) + " de " + limite + " perguntas disponíveis";
  }

  // Liga tudo. Usa delegação no documento — funciona mesmo que os
  // elementos sejam recriados ou o clique caia num filho (SVG).
  function ligar() {
    document.addEventListener("click", function (e) {
      // Abrir (clicou no botão flutuante)
      if (e.target.closest("#iaFab") || e.target.closest("#iaFabMobile")) {
        e.preventDefault();
        if (typeof ehPremium === "function" && !ehPremium()) {
          pedirUpgrade("O assistente de IA está disponível nos planos Premium e Master.", "Assistente de IA");
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
    });

    // Escolheu um arquivo no chat: manda para a IA organizar
    document.addEventListener("change", function (e) {
      if (e.target && e.target.id === "iaChatArquivo") {
        const arquivo = e.target.files && e.target.files[0];
        e.target.value = ""; // permite reenviar o mesmo arquivo depois
        if (arquivo) enviarExtratoNoChat(arquivo);
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
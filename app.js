/* ============================================================
   FINANÇAS PESSOAIS — app.js  v9  (Supabase)
   ============================================================ */

/* ─── Configuração Supabase ──────────────────────────────── */
const SUPABASE_URL = "https://yubacxqyvxgehqehszvi.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1YmFjeHF5dnhnZWhxZWhzenZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzNTA1NDAsImV4cCI6MjA4ODkyNjU0MH0.wF00UTw3-PmAL0EBQ5SCv9Xio64j4JbD0WvUTwnO610";

const _h = { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };

/* ─── Estado em memória ──────────────────────────────────── */
const state = {
  bancos: [], movimentos: [], transferencias: [], recorrencias: [], metas: [],
  user: null
};

let chartCategoriasPlanilha = null;
let chartFluxoPlanilha      = null;
let chartEvolucao           = null;
let _undoSnapshot           = null;

/* ─── Ícones por categoria ───────────────────────────────── */
const ICONE_CAT = {
  "Entrada":          "💰",
  "Gasto importante": "🏠",
  "Lazer":            "🎬",
  "Transporte":       "🚗",
  "Compras":          "🛒",
  "Outros":           "📦"
};

/* ─── Tema claro / escuro ────────────────────────────────── */
function aplicarTema(tema) {
  document.documentElement.setAttribute("data-theme", tema);
  localStorage.setItem("fp_tema", tema);
  const btn = document.getElementById("btnTema");
  if (btn) btn.textContent = tema === "dark" ? "☀️" : "🌙";
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
function confirmar(msg) {
  return new Promise(resolve => {
    const ov = document.createElement("div");
    ov.className = "confirm-ov";
    ov.innerHTML = `
      <div class="confirm-box">
        <p class="confirm-msg">${msg}</p>
        <div class="confirm-btns">
          <button class="btn-ghost confirm-cancel">Cancelar</button>
          <button class="btn-danger-solid confirm-ok">Confirmar</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add("open"));
    ov.querySelector(".confirm-ok").onclick     = () => { ov.remove(); resolve(true);  };
    ov.querySelector(".confirm-cancel").onclick = () => { ov.remove(); resolve(false); };
    ov.addEventListener("click", e => { if (e.target === ov) { ov.remove(); resolve(false); } });
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

async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { ..._h, "Prefer": "return=representation", ...(opts.headers||{}) },
    ...opts
  });
  if (!res.ok) {
    const err = await res.json().catch(()=>({}));
    throw new Error(err.message || `Erro ${res.status}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

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

async function sbCadastro(email, senha) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY },
    body: JSON.stringify({ email, password: senha })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || "Erro ao cadastrar");
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
}

function getAuthHeader() {
  const token = localStorage.getItem("fp_token");
  return token ? { "Authorization": `Bearer ${token}` } : {};
}

/* CRUD genérico com token do usuário */
async function dbSelect(tabela, filtros = "") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?order=created_at.asc${filtros}`, {
    headers: { ..._h, ...getAuthHeader() }
  });
  if (!res.ok) throw new Error(`Erro ao carregar ${tabela}`);
  return res.json();
}

async function dbInsert(tabela, dados) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}`, {
    method: "POST",
    headers: { ..._h, ...getAuthHeader(), "Prefer": "return=representation" },
    body: JSON.stringify(dados)
  });
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.message||`Erro ao salvar em ${tabela}`); }
  const rows = await res.json();
  return rows[0];
}

async function dbUpdate(tabela, id, dados) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?id=eq.${id}`, {
    method: "PATCH",
    headers: { ..._h, ...getAuthHeader(), "Prefer": "return=representation" },
    body: JSON.stringify(dados)
  });
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.message||`Erro ao atualizar em ${tabela}`); }
  const rows = await res.json();
  return rows[0];
}

async function dbDelete(tabela, id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?id=eq.${id}`, {
    method: "DELETE",
    headers: { ..._h, ...getAuthHeader() }
  });
  if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.message||`Erro ao excluir em ${tabela}`); }
}

/* Carregar todos os dados do usuário */
async function carregarDadosNuvem() {
  mostrarLoading(true);
  try {
    const [contas, movimentos, transferencias, recorrencias, metas] = await Promise.all([
      dbSelect("contas"),
      dbSelect("movimentos"),
      dbSelect("transferencias"),
      dbSelect("recorrencias"),
      dbSelect("metas")
    ]);
    // Mapear campos do banco para o formato do app
    state.bancos         = contas.map(c => ({ id:c.id, nome:c.nome, tipo:c.tipo, saldoInicial: Number(c.saldo_inicial) }));
    state.movimentos     = movimentos.map(m => ({ id:m.id, descricao:m.descricao, bancoId:m.conta_id, data:m.data, valor:Number(m.valor), tipo:m.tipo, categoria:m.categoria, recorrenciaId:m.recorrencia_id }));
    state.transferencias = transferencias.map(t => ({ id:t.id, origem:t.conta_origem, destino:t.conta_destino, valor:Number(t.valor), data:t.data, descricao:t.descricao||"" }));
    state.recorrencias   = recorrencias.map(r => ({ id:r.id, descricao:r.descricao, valor:Number(r.valor), tipo:r.tipo, categoria:r.categoria, contaId:r.conta_id, dia:r.dia }));
    state.metas          = metas.map(m => ({ id:m.id, categoria:m.categoria, limite:Number(m.limite) }));
  } catch(e) {
    toast("Erro ao carregar dados: " + e.message, "error");
  } finally {
    mostrarLoading(false);
  }
}

/* ============================================================
   TELA DE LOGIN / CADASTRO
   ============================================================ */

function mostrarTelaLogin() {
  document.getElementById("telaLogin").style.display = "flex";
  document.getElementById("appLayout").style.display = "none";
}

function mostrarTelaApp() {
  document.getElementById("telaLogin").style.display = "none";
  document.getElementById("appLayout").style.display = "grid";
}

function mostrarLoading(ativo) {
  const el = document.getElementById("loadingOverlay");
  if (el) el.style.display = ativo ? "flex" : "none";
}

/* Alternar entre login e cadastro */
document.getElementById("btnIrCadastro")?.addEventListener("click", () => {
  document.getElementById("formLoginWrap").style.display  = "none";
  document.getElementById("formCadastroWrap").style.display = "flex";
});
document.getElementById("btnIrLogin")?.addEventListener("click", () => {
  document.getElementById("formCadastroWrap").style.display = "none";
  document.getElementById("formLoginWrap").style.display  = "flex";
});

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
  } catch(err) {
    toast(err.message, "error");
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
  if (senha !== conf) { toast("As senhas não coincidem.", "error"); return; }
  if (senha.length < 6) { toast("A senha deve ter pelo menos 6 caracteres.", "error"); return; }
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true; btn.textContent = "Cadastrando...";
  try {
    await sbCadastro(email, senha);
    toast("Conta criada! Verifique seu e-mail para confirmar, depois faça login.", "success");
    document.getElementById("formCadastroWrap").style.display = "none";
    document.getElementById("formLoginWrap").style.display  = "flex";
    document.getElementById("loginEmail").value = email;
  } catch(err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false; btn.textContent = "Criar conta";
  }
});

/* Logout */
document.getElementById("btnLogout")?.addEventListener("click", async () => {
  const ok = await confirmar("Deseja sair da sua conta?");
  if (!ok) return;
  await sbLogout();
  state.bancos = state.movimentos = state.transferencias = state.recorrencias = state.metas = [];
  state.user = null;
  mostrarTelaLogin();
});

/* ─── DOM refs ───────────────────────────────────────────── */
const menuItems = document.querySelectorAll(".menu-item");
const screens   = document.querySelectorAll(".screen");

const formBanco            = document.getElementById("formBanco");
const nomeBancoInput       = document.getElementById("nomeBanco");
const tipoBancoInput       = document.getElementById("tipoBanco");
const saldoBancoInput      = document.getElementById("saldoBanco");

const formTexto            = document.getElementById("formTexto");
const textoLivreInput      = document.getElementById("textoLivre");
const contaMovimentoSelect = document.getElementById("contaMovimento");
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
const recDiaInput          = document.getElementById("recDia");
const processarRecBtn      = document.getElementById("processarRecorrencias");

const formMeta             = document.getElementById("formMeta");
const metaCategoriaSelect  = document.getElementById("metaCategoria");
const metaValorInput       = document.getElementById("metaValor");

const tipoFiltroSelect       = document.getElementById("tipoFiltro");
const filtroDiaInput         = document.getElementById("filtroDia");
const filtroMesInput         = document.getElementById("filtroMes");
const filtroAnoInput         = document.getElementById("filtroAno");
const fieldFiltroDia         = document.getElementById("fieldFiltroDia");
const fieldFiltroMes         = document.getElementById("fieldFiltroMes");
const fieldFiltroAno         = document.getElementById("fieldFiltroAno");
const limparFiltrosBtn       = document.getElementById("limparFiltros");
const filtroCategoriaTabela  = document.getElementById("filtroCategoriaTabela");
const limparTudoBtn          = document.getElementById("limparTudo");

const saldoTotalDashboardEl  = document.getElementById("saldoTotalDashboard");
const saldoTotalPlanilhaEl   = document.getElementById("saldoTotalPlanilha");
const totalEntradasEl        = document.getElementById("totalEntradas");
const totalGastosEl          = document.getElementById("totalGastos");
const totalMovimentosEl      = document.getElementById("totalMovimentos");
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
const fmtMoeda = v => v.toLocaleString("pt-BR", { style:"currency", currency:"BRL" });
const gerarId  = () => crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random());
const hojeISO  = () => new Date().toISOString().split("T")[0];
const mesAtualISO = () => hojeISO().slice(0,7);

function badge(cat) {
  return `<span class="badge">${ICONE_CAT[cat] ?? "📋"} ${cat}</span>`;
}

/* ─── Classificação ─────────────────────────────────────── */
function classificarCategoria(t) {
  t = t.toLowerCase();
  if (/mercado|supermercado|farmácia|farmacia|aluguel|conta\b|luz\b|água|agua|internet|combustível|combustivel/.test(t)) return "Gasto importante";
  if (/namorada|cinema|bar\b|restaurante|lazer|viagem|passeio|festa/.test(t)) return "Lazer";
  if (/salário|salario|pagamento|recebi|entrou|ganhei|pix recebido|transferência recebida|entrada/.test(t)) return "Entrada";
  if (/uber|99\b|ônibus|onibus|transporte|metrô|metro/.test(t)) return "Transporte";
  if (/roupa|shopping|presente|compras/.test(t)) return "Compras";
  return "Outros";
}

function detectarTipo(t) {
  return /recebi|entrou|ganhei|pagamento|salário|salario|pix recebido|crédito|credito|entrada/.test(t.toLowerCase())
    ? "entrada" : "gasto";
}

function extrairValor(texto) {
  const m = texto.match(/(\d[\d.,]*)/);
  if (!m) return null;
  return Number(m[1].replace(/\./g,"").replace(",","."));
}

/* ─── Cálculos ───────────────────────────────────────────── */
function calcularSaldoBanco(id) {
  const b = state.bancos.find(b=>b.id===id); if (!b) return 0;
  const mov = state.movimentos.filter(m=>m.bancoId===id)
    .reduce((a,m) => m.tipo==="entrada" ? a+m.valor : a-m.valor, 0);
  const tr = state.transferencias.reduce((a,t) => {
    if (t.destino===id) return a+t.valor;
    if (t.origem===id)  return a-t.valor;
    return a;
  }, 0);
  return b.saldoInicial + mov + tr;
}

const calcularSaldoTotal = () => state.bancos.reduce((a,b)=>a+calcularSaldoBanco(b.id),0);

function calcularTotais(movs = state.movimentos) {
  return {
    entradas: movs.filter(m=>m.tipo==="entrada").reduce((a,m)=>a+m.valor,0),
    gastos:   movs.filter(m=>m.tipo==="gasto").reduce((a,m)=>a+m.valor,0)
  };
}

/* ─── Selects de contas ─────────────────────────────────── */
function atualizarSelectContas() {
  const empty = `<option value="">Cadastre uma conta primeiro</option>`;
  const ok = state.bancos.length > 0;
  const opts = state.bancos.map(b=>`<option value="${b.id}">${b.nome} · ${b.tipo}</option>`).join("");
  [contaMovimentoSelect, contaExtratoSelect, transOrigemSelect, transDestinoSelect, recContaSelect]
    .forEach(s => { if(s){ s.innerHTML = ok ? opts : empty; s.disabled = !ok; } });
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
  const { entradas, gastos } = calcularTotais();
  if(saldoTotalDashboardEl) saldoTotalDashboardEl.textContent = fmtMoeda(calcularSaldoTotal());
  if(totalEntradasEl)       totalEntradasEl.textContent       = fmtMoeda(entradas);
  if(totalGastosEl)         totalGastosEl.textContent         = fmtMoeda(gastos);
  if(totalMovimentosEl)     totalMovimentosEl.textContent     = String(state.movimentos.length);
}

function renderContasDashboard() {
  if (!resumoContasDashboard) return;
  if (!state.bancos.length) {
    resumoContasDashboard.innerHTML = `<div class="empty-state">Nenhuma conta cadastrada ainda.</div>`; return;
  }
  resumoContasDashboard.innerHTML = `<div class="contas-dashboard">` +
    state.bancos.map(b => {
      const s = calcularSaldoBanco(b.id);
      return `<div class="conta-dashboard">
        <div class="conta-dashboard-top"><span class="conta-nome">${b.nome}</span><span class="conta-saldo">${fmtMoeda(s)}</span></div>
        <div class="conta-dashboard-categoria">${b.tipo}</div>
      </div>`;
    }).join("") + `</div>`;
}

function renderGraficoEvolucao() {
  if (chartEvolucao) chartEvolucao.destroy();
  const PT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const hoje = new Date();
  const meses = Array.from({length:6},(_,i)=>{
    const d = new Date(hoje.getFullYear(), hoje.getMonth()-(5-i), 1);
    return { ano:d.getFullYear(), mes:d.getMonth()+1, label:`${PT[d.getMonth()]} ${d.getFullYear()}` };
  });
  const dados = meses.map(({ano,mes}) => {
    const lim = ano*100+mes;
    const base = state.bancos.reduce((a,b)=>a+b.saldoInicial, 0);
    const mov  = state.movimentos
      .filter(m => Number(m.data.slice(0,4))*100+Number(m.data.slice(5,7)) <= lim)
      .reduce((a,m) => m.tipo==="entrada" ? a+m.valor : a-m.valor, 0);
    return base + mov;
  });
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const tc = dark ? "#aab2d0" : "#4a5270";
  const gc = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)";
  const canvas = document.getElementById("chartEvolucao"); if(!canvas) return;
  chartEvolucao = new Chart(canvas, {
    type:"line",
    data:{ labels:meses.map(m=>m.label), datasets:[{
      label:"Saldo", data:dados,
      borderColor:"#4f63e7", backgroundColor:"rgba(79,99,231,0.09)",
      borderWidth:2.5, pointBackgroundColor:"#4f63e7", pointRadius:4, pointHoverRadius:6,
      fill:true, tension:0.4
    }]},
    options:{ responsive:true, maintainAspectRatio:false, animation:{duration:400},
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>` ${fmtMoeda(c.raw)}`}} },
      scales:{
        x:{ grid:{color:gc}, ticks:{color:tc,font:{family:"DM Sans",size:12}} },
        y:{ grid:{color:gc}, ticks:{color:tc,font:{family:"DM Sans",size:12},callback:v=>fmtMoeda(v)} }
      }
    }
  });
}

function renderBancos() {
  if (!listaBancosEl) return;
  if (!state.bancos.length) {
    listaBancosEl.innerHTML  = `<div class="empty-state">Nenhuma conta cadastrada ainda.</div>`;
    if(resumoContasEl) resumoContasEl.innerHTML = `<div class="empty-state">Nenhuma conta cadastrada ainda.</div>`; return;
  }
  listaBancosEl.innerHTML = state.bancos.map(b => {
    const s = calcularSaldoBanco(b.id);
    return `<div class="conta-item">
      <div class="item-top"><div class="item-title">${b.nome}</div><div class="valor-neutro">${fmtMoeda(s)}</div></div>
      <div class="item-meta">
        <span>Tipo: <span class="badge">${b.tipo}</span></span><br>
        <span>Saldo inicial: <strong>${fmtMoeda(b.saldoInicial)}</strong></span>
      </div>
      <div class="item-actions">
        <button class="btn-icon" onclick="abrirEditarConta('${b.id}')">✏️ Editar</button>
        <button class="btn-icon btn-icon-danger" onclick="excluirConta('${b.id}')">🗑 Excluir</button>
      </div>
    </div>`;
  }).join("");
}

function renderResumoContasFiltrado(movs) {
  if (!resumoContasEl) return;
  if (!state.bancos.length) { resumoContasEl.innerHTML=`<div class="empty-state">Nenhuma conta.</div>`; return; }
  resumoContasEl.innerHTML = state.bancos.map(b => {
    const ent = movs.filter(m=>m.bancoId===b.id&&m.tipo==="entrada").reduce((a,m)=>a+m.valor,0);
    const gas = movs.filter(m=>m.bancoId===b.id&&m.tipo==="gasto").reduce((a,m)=>a+m.valor,0);
    const sal = ent-gas;
    return `<div class="conta-resumo-item">
      <div class="item-top"><div class="item-title">${b.nome}</div><div class="${sal>=0?"valor-positivo":"valor-negativo"}">${fmtMoeda(sal)}</div></div>
      <div class="item-meta">
        <span>Tipo: <span class="badge">${b.tipo}</span></span><br>
        <span>Entradas: <span class="valor-positivo">${fmtMoeda(ent)}</span></span><br>
        <span>Gastos: <span class="valor-negativo">${fmtMoeda(gas)}</span></span>
      </div>
    </div>`;
  }).join("");
}

function renderMovimentos() {
  if (!listaMovimentosEl) return;
  const bMap = Object.fromEntries(state.bancos.map(b=>[b.id,`${b.nome} · ${b.tipo}`]));
  const busca = (buscaMovimentoInput?.value||"").toLowerCase().trim();
  let movs = [...state.movimentos].sort((a,b)=>new Date(b.data)-new Date(a.data));
  if (busca) movs = movs.filter(m => m.descricao.toLowerCase().includes(busca) || m.categoria.toLowerCase().includes(busca));
  if (!movs.length) {
    listaMovimentosEl.innerHTML = `<div class="empty-state">${busca?"Nenhum resultado encontrado.":"Nenhuma movimentação ainda."}</div>`; return;
  }
  listaMovimentosEl.innerHTML = movs.map(m => {
    const cls = m.tipo==="entrada" ? "valor-positivo" : "valor-negativo";
    const sig = m.tipo==="entrada" ? "+" : "−";
    return `<div class="movimento-item">
      <div class="item-top"><div class="item-title">${m.descricao}</div><div class="${cls}">${sig} ${fmtMoeda(m.valor)}</div></div>
      <div class="item-meta">
        <span>Categoria: ${badge(m.categoria)}</span><br>
        <span>Conta: ${bMap[m.bancoId]||"Conta removida"}</span><br>
        <span>Data: ${new Date(m.data+"T00:00:00").toLocaleDateString("pt-BR")}</span>
      </div>
      <div class="item-actions">
        <button class="btn-icon" onclick="abrirEditarMovimento('${m.id}')">✏️ Editar</button>
        <button class="btn-icon btn-icon-danger" onclick="excluirMovimento('${m.id}')">🗑 Excluir</button>
      </div>
    </div>`;
  }).join("");
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
      <div class="item-actions"><button class="btn-icon btn-icon-danger" onclick="excluirTransferencia('${t.id}')">🗑 Excluir</button></div>
    </div>`).join("");
}

function renderRecorrencias() {
  if (!listaRecorrenciasEl) return;
  if (!state.recorrencias.length) {
    listaRecorrenciasEl.innerHTML=`<div class="empty-state">Nenhuma recorrência cadastrada ainda.</div>`; return;
  }
  const bMap = Object.fromEntries(state.bancos.map(b=>[b.id,b.nome]));
  listaRecorrenciasEl.innerHTML = state.recorrencias.map(r => {
    const cls = r.tipo==="entrada" ? "valor-positivo" : "valor-negativo";
    const sig = r.tipo==="entrada" ? "+" : "−";
    return `<div class="recorrencia-item">
      <div class="item-top">
        <div class="item-title">${r.descricao} <span class="rec-dia-label">todo dia ${r.dia}</span></div>
        <div class="${cls}">${sig} ${fmtMoeda(r.valor)}</div>
      </div>
      <div class="item-meta">
        <span>Categoria: ${badge(r.categoria)}</span><br>
        <span>Conta: ${bMap[r.contaId]||"Conta removida"}</span>
      </div>
      <div class="item-actions">
        <button class="btn-icon" onclick="abrirEditarRecorrencia('${r.id}')">✏️ Editar</button>
        <button class="btn-icon btn-icon-danger" onclick="excluirRecorrencia('${r.id}')">🗑 Excluir</button>
      </div>
    </div>`;
  }).join("");
}

function renderMetas() {
  if (!listaMetasEl) return;
  if (!state.metas.length) {
    listaMetasEl.innerHTML=`<div class="empty-state">Nenhuma meta cadastrada ainda.</div>`; return;
  }
  const mes = mesAtualISO();
  const gastosMes = {};
  state.movimentos.filter(m=>m.tipo==="gasto"&&m.data.startsWith(mes))
    .forEach(m=>{ gastosMes[m.categoria]=(gastosMes[m.categoria]||0)+m.valor; });
  listaMetasEl.innerHTML = state.metas.map(meta => {
    const gasto = gastosMes[meta.categoria]||0;
    const pct   = Math.min((gasto/meta.limite)*100,100).toFixed(0);
    const resto = meta.limite - gasto;
    const sc    = pct>=100 ? "danger" : pct>=80 ? "warning" : "";
    return `<div class="meta-item">
      <div class="meta-header">
        <div class="meta-title">${ICONE_CAT[meta.categoria]||"📋"} ${meta.categoria}</div>
        <div class="meta-valores"><strong>${fmtMoeda(gasto)}</strong> de ${fmtMoeda(meta.limite)}</div>
      </div>
      <div class="progress-bar-wrap"><div class="progress-bar-fill ${sc}" style="width:${pct}%"></div></div>
      <div class="meta-footer">
        <span>${pct}% utilizado</span>
        <div class="meta-actions">
          <span style="color:${resto>=0?"var(--green)":"var(--red)"}">
            ${resto>=0 ? "Restam "+fmtMoeda(resto) : "Excedido "+fmtMoeda(Math.abs(resto))}
          </span>
          <button class="btn-icon btn-icon-danger" onclick="excluirMeta('${meta.id}')">🗑</button>
        </div>
      </div>
    </div>`;
  }).join("");
}

function renderPlanilha() {
  if (!tabelaMovimentosBody) return;
  const filtrados = obterMovimentosFiltrados();
  const tabela    = obterMovimentosTabelaFiltrados();
  const bMap      = Object.fromEntries(state.bancos.map(b=>[b.id,`${b.nome} · ${b.tipo}`]));
  const { entradas, gastos } = calcularTotais(filtrados);
  if(saldoTotalPlanilhaEl) saldoTotalPlanilhaEl.textContent = fmtMoeda(entradas-gastos);
  if (!filtrados.length) {
    if(resumoCategoriasEl) resumoCategoriasEl.innerHTML  = `<div class="empty-state">Nenhuma movimentação para o filtro selecionado.</div>`;
    if(resumoContasEl)     resumoContasEl.innerHTML      = `<div class="empty-state">Nenhuma movimentação para o filtro selecionado.</div>`;
    tabelaMovimentosBody.innerHTML= `<tr><td colspan="6" class="table-empty">Nenhuma movimentação encontrada.</td></tr>`;
    if(maiorCategoriaGastoEl) maiorCategoriaGastoEl.textContent = "—";
    renderGraficosPlanilha([]); return;
  }
  const res = {};
  filtrados.forEach(m => { if(!res[m.categoria]) res[m.categoria]={entrada:0,gasto:0}; res[m.categoria][m.tipo]+=m.valor; });
  if(resumoCategoriasEl) resumoCategoriasEl.innerHTML = Object.entries(res).sort((a,b)=>a[0].localeCompare(b[0])).map(([cat,v])=>{
    const s = v.entrada-v.gasto;
    return `<div class="categoria-item">
      <div class="item-top"><div class="item-title">${ICONE_CAT[cat]||"📋"} ${cat}</div><div class="${s>=0?"valor-positivo":"valor-negativo"}">${fmtMoeda(s)}</div></div>
      <div class="item-meta">
        <span>Entradas: <span class="valor-positivo">${fmtMoeda(v.entrada)}</span></span><br>
        <span>Gastos: <span class="valor-negativo">${fmtMoeda(v.gasto)}</span></span>
      </div>
    </div>`;
  }).join("");
  renderResumoContasFiltrado(filtrados);
  const top = Object.entries(res).map(([c,v])=>({c,g:v.gasto})).sort((a,b)=>b.g-a.g);
  if(maiorCategoriaGastoEl) maiorCategoriaGastoEl.textContent = top.length && top[0].g>0 ? `${ICONE_CAT[top[0].c]||""} ${top[0].c}` : "—";
  tabelaMovimentosBody.innerHTML = !tabela.length
    ? `<tr><td colspan="6" class="table-empty">Nenhuma movimentação para a categoria selecionada.</td></tr>`
    : [...tabela].sort((a,b)=>new Date(b.data)-new Date(a.data)).map(m => {
        const cls = m.tipo==="entrada"?"valor-positivo":"valor-negativo";
        return `<tr>
          <td>${new Date(m.data+"T00:00:00").toLocaleDateString("pt-BR")}</td>
          <td>${m.descricao}</td>
          <td>${bMap[m.bancoId]||"Conta removida"}</td>
          <td>${badge(m.categoria)}</td>
          <td>${m.tipo==="entrada"?"Entrada":"Gasto"}</td>
          <td class="${cls}">${fmtMoeda(m.valor)}</td>
        </tr>`;
      }).join("");
  renderGraficosPlanilha(filtrados);
}

/* ─── Gráficos planilha ──────────────────────────────────── */
const CHART_COLORS = ["#4f63e7","#1aab6d","#f59e0b","#e63b3b","#8b5cf6","#0ea5e9","#ec4899","#10b981"];

function _tooltipMoeda(ctx) {
  const total = (ctx.chart.data.datasets[0].data||[]).reduce((a,v)=>a+v, 0);
  return `${ctx.label}: ${fmtMoeda(ctx.raw)} (${total>0?((ctx.raw/total)*100).toFixed(1):"0.0"}%)`;
}

function renderGraficosPlanilha(movs) {
  const gc = {};
  movs.filter(m=>m.tipo==="gasto").forEach(m=>{ gc[m.categoria]=(gc[m.categoria]||0)+m.valor; });
  const labels = Object.keys(gc), data = Object.values(gc);
  const { entradas, gastos } = calcularTotais(movs);
  if (chartCategoriasPlanilha) chartCategoriasPlanilha.destroy();
  if (chartFluxoPlanilha)       chartFluxoPlanilha.destroy();
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const tc = dark ? "#aab2d0" : "#4a5270";
  const font = {family:"DM Sans",size:12};
  const c1 = document.getElementById("chartCategoriasPlanilha");
  const c2 = document.getElementById("chartFluxoPlanilha");
  if(c1) chartCategoriasPlanilha = new Chart(c1, {
    type:"pie",
    data:{ labels:labels.length?labels:["Sem dados"], datasets:[{
      data:data.length?data:[1], backgroundColor:data.length?CHART_COLORS:["#e5e7eb"],
      borderColor:"var(--surface)", borderWidth:3, hoverOffset:10, radius:"90%"
    }]},
    options:{ responsive:true, maintainAspectRatio:false, animation:{duration:400},
      plugins:{ legend:{position:"bottom",labels:{color:tc,boxWidth:12,padding:14,font}},
        tooltip:{callbacks:{label:_tooltipMoeda}} }}
  });
  if(c2) chartFluxoPlanilha = new Chart(c2, {
    type:"doughnut",
    data:{ labels:["Entradas","Gastos"], datasets:[{
      data:[entradas||0,gastos||0],
      backgroundColor:["rgba(26,171,109,0.82)","rgba(230,59,59,0.82)"],
      borderColor:"var(--surface)", borderWidth:3, hoverOffset:8, radius:"90%"
    }]},
    options:{ responsive:true, maintainAspectRatio:false, animation:{duration:400},
      plugins:{ legend:{position:"bottom",labels:{color:tc,boxWidth:12,padding:14,font}},
        tooltip:{callbacks:{label:_tooltipMoeda}} }}
  });
}

/* ─── CSV Export ─────────────────────────────────────────── */
function exportarCSV(movs) {
  const bMap = Object.fromEntries(state.bancos.map(b=>[b.id,b.nome]));
  const rows = [["Data","Descrição","Conta","Categoria","Tipo","Valor"],
    ...movs.map(m=>[m.data, `"${m.descricao}"`, bMap[m.bancoId]||"", m.categoria, m.tipo, m.valor.toFixed(2)])
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

function parseCSV(texto) {
  const sep = ((texto.split(/\r?\n/)[0]||"").match(/;/g)||[]).length > ((texto.split(/\r?\n/)[0]||"").match(/,/g)||[]).length ? ";" : ",";
  const linhas = texto.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  if (linhas.length<2) return [];
  const H = linhas[0].split(sep).map(h=>h.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,""));
  const iD = H.findIndex(h=>["data","date"].includes(h));
  const iE = H.findIndex(h=>["descricao","descrição","historico","histórico","lancamento","lançamento","memo"].includes(h));
  const iV = H.findIndex(h=>["valor","amount","montante"].includes(h));
  const iT = H.findIndex(h=>["tipo","type"].includes(h));
  if (iD<0||iE<0||iV<0) throw new Error("CSV precisa ter colunas de data, descrição e valor.");
  return linhas.slice(1).map(l=>{
    const c = l.split(sep).map(x=>x.trim());
    const data = _normData(c[iD]), desc = c[iE]||"", vBruto = _normValor(c[iV]);
    if (!data||!desc||vBruto===null) return null;
    const tipCol = iT>=0 ? c[iT].toLowerCase() : "";
    let tipo = vBruto>=0 ? "entrada" : "gasto";
    if (/entrada|credito|crédito/.test(tipCol)) tipo="entrada";
    else if (/gasto|debito|débito|saida|saída/.test(tipCol)) tipo="gasto";
    return { data, descricao:desc, valor:Math.abs(vBruto), tipo, categoria:classificarCategoria(desc) };
  }).filter(Boolean);
}

/* ─── Render global ──────────────────────────────────────── */
function renderTudo() {
  atualizarSelectContas();
  renderResumoDashboard();
  renderContasDashboard();
  renderGraficoEvolucao();
  renderBancos();
  renderMovimentos();
  renderTransferencias();
  renderRecorrencias();
  renderMetas();
  renderPlanilha();
}

/* ─── Navegação ──────────────────────────────────────────── */
function trocarTela(name) {
  menuItems.forEach(i=>i.classList.toggle("active", i.dataset.screen===name));
  screens.forEach(s => {
    if (s.id === `screen-${name}`) {
      s.classList.add("active");
      void s.offsetHeight;
      s.classList.add("screen-enter");
    } else {
      s.classList.remove("active","screen-enter");
    }
  });
}
menuItems.forEach(i=>i.addEventListener("click",()=>trocarTela(i.dataset.screen)));

/* ─── Botão de tema ──────────────────────────────────────── */
document.getElementById("btnTema")?.addEventListener("click", () => {
  const atual = document.documentElement.getAttribute("data-theme") || "light";
  aplicarTema(atual === "dark" ? "light" : "dark");
});

/* ============================================================
   FORMS — com gravação no Supabase
   ============================================================ */

formBanco?.addEventListener("submit", async e => {
  e.preventDefault();
  const nome = nomeBancoInput.value.trim(), tipo = tipoBancoInput.value, saldoInicial = Number(saldoBancoInput.value);
  if (!nome||!tipo) { toast("Preencha todos os campos.","error"); return; }
  try {
    const novo = await dbInsert("contas", { nome, tipo, saldo_inicial: saldoInicial });
    state.bancos.push({ id:novo.id, nome:novo.nome, tipo:novo.tipo, saldoInicial:Number(novo.saldo_inicial) });
    formBanco.reset(); renderTudo();
    toast(`Conta "${nome}" adicionada!`,"success");
  } catch(err) { toast(err.message, "error"); }
});

formTexto?.addEventListener("submit", async e => {
  e.preventDefault();
  if (!state.bancos.length) { toast("Cadastre pelo menos uma conta antes.","warning"); return; }
  const texto = textoLivreInput.value.trim(), bancoId = contaMovimentoSelect.value, data = dataMovimentoInput.value;
  if (!texto||!bancoId||!data) { toast("Preencha todos os campos.","error"); return; }
  const valor = extrairValor(texto);
  if (!valor) { toast("Não identifiquei o valor. Ex: gastei 200 reais.","error"); return; }
  const tipo = detectarTipo(texto), categoria = classificarCategoria(texto);
  try {
    const novo = await dbInsert("movimentos", { descricao:texto, conta_id:bancoId, data, valor, tipo, categoria });
    state.movimentos.push({ id:novo.id, descricao:novo.descricao, bancoId:novo.conta_id, data:novo.data, valor:Number(novo.valor), tipo:novo.tipo, categoria:novo.categoria });
    formTexto.reset(); dataMovimentoInput.value = hojeISO(); renderTudo();
    toast(`${tipo==="entrada"?"Entrada":"Gasto"} de ${fmtMoeda(valor)} registrado.`,"success");
  } catch(err) { toast(err.message, "error"); }
});

formImportarExtrato?.addEventListener("submit", async e => {
  e.preventDefault();
  if (!state.bancos.length) { toast("Cadastre pelo menos uma conta antes.","warning"); return; }
  const bancoId = contaExtratoSelect.value, arquivo = arquivoExtratoInput.files[0];
  if (!bancoId||!arquivo) { toast("Selecione a conta e o arquivo CSV.","error"); return; }
  try {
    const movs = parseCSV(await arquivo.text());
    if (!movs.length) { toast("Nenhum lançamento válido encontrado no CSV.","warning"); return; }
    mostrarLoading(true);
    for (const m of movs) {
      const novo = await dbInsert("movimentos", { descricao:m.descricao, conta_id:bancoId, data:m.data, valor:m.valor, tipo:m.tipo, categoria:m.categoria });
      state.movimentos.push({ id:novo.id, descricao:novo.descricao, bancoId:novo.conta_id, data:novo.data, valor:Number(novo.valor), tipo:novo.tipo, categoria:novo.categoria });
    }
    formImportarExtrato.reset(); renderTudo();
    toast(`${movs.length} movimentações importadas!`,"success");
  } catch(err) { toast(err.message||"Erro ao importar CSV.","error"); }
  finally { mostrarLoading(false); }
});

buscaMovimentoInput?.addEventListener("input", renderMovimentos);

exportarCSVBtn?.addEventListener("click", () => {
  if (!state.movimentos.length) { toast("Nenhuma movimentação para exportar.","warning"); return; }
  exportarCSV(state.movimentos); toast("CSV exportado com sucesso!","success");
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
  try {
    const novo = await dbInsert("transferencias", { conta_origem:origem, conta_destino:destino, valor, data, descricao:transDescricaoInput.value.trim() });
    state.transferencias.push({ id:novo.id, origem:novo.conta_origem, destino:novo.conta_destino, valor:Number(novo.valor), data:novo.data, descricao:novo.descricao||"" });
    formTransferencia.reset(); transDataInput.value = hojeISO(); renderTudo();
    toast(`Transferência de ${fmtMoeda(valor)} realizada!`,"success");
  } catch(err) { toast(err.message, "error"); }
});

formRecorrencia?.addEventListener("submit", async e => {
  e.preventDefault();
  if (!state.bancos.length) { toast("Cadastre pelo menos uma conta antes.","warning"); return; }
  const descricao = recDescricaoInput.value.trim(), valor = Number(recValorInput.value), dia = Number(recDiaInput.value);
  if (!descricao||!valor||!dia) { toast("Preencha todos os campos.","error"); return; }
  try {
    const novo = await dbInsert("recorrencias", { descricao, valor, tipo:recTipoSelect.value, categoria:recCategoriaSelect.value, conta_id:recContaSelect.value, dia });
    state.recorrencias.push({ id:novo.id, descricao:novo.descricao, valor:Number(novo.valor), tipo:novo.tipo, categoria:novo.categoria, contaId:novo.conta_id, dia:novo.dia });
    formRecorrencia.reset(); renderTudo();
    toast(`Recorrência "${descricao}" criada!`,"success");
  } catch(err) { toast(err.message, "error"); }
});

processarRecBtn?.addEventListener("click", async () => {
  if (!state.recorrencias.length) { toast("Nenhuma recorrência cadastrada.","warning"); return; }
  const mes = mesAtualISO(); let n = 0;
  mostrarLoading(true);
  try {
    for (const r of state.recorrencias) {
      const data = `${mes}-${String(r.dia).padStart(2,"0")}`;
      if (!state.movimentos.some(m=>m.recorrenciaId===r.id&&m.data.startsWith(mes))) {
        const novo = await dbInsert("movimentos", { descricao:r.descricao, conta_id:r.contaId, data, valor:r.valor, tipo:r.tipo, categoria:r.categoria, recorrencia_id:r.id });
        state.movimentos.push({ id:novo.id, recorrenciaId:novo.recorrencia_id, descricao:novo.descricao, bancoId:novo.conta_id, data:novo.data, valor:Number(novo.valor), tipo:novo.tipo, categoria:novo.categoria });
        n++;
      }
    }
    if (!n) toast("Lançamentos deste mês já foram gerados.","info");
    else { renderTudo(); toast(`${n} lançamento(s) gerado(s) para ${mes}.`,"success"); }
  } catch(err) { toast(err.message, "error"); }
  finally { mostrarLoading(false); }
});

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
      const novo = await dbInsert("metas", { categoria:cat, limite });
      state.metas.push({ id:novo.id, categoria:novo.categoria, limite:Number(novo.limite) });
      toast(`Meta de "${cat}" criada!`,"success");
    }
    formMeta.reset(); renderTudo();
  } catch(err) { toast(err.message, "error"); }
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
  const ok = await confirmar("Tem certeza que deseja apagar TODOS os dados? Esta ação não pode ser desfeita.");
  if (!ok) return;
  mostrarLoading(true);
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
  } catch(err) { toast(err.message,"error"); }
  finally { mostrarLoading(false); }
});

/* ─── Excluir com Undo ────────────────────────────────────── */
async function excluirMovimento(id) {
  const ok = await confirmar("Excluir esta movimentação?"); if (!ok) return;
  const label = state.movimentos.find(m=>m.id===id)?.descricao || "Lançamento";
  _salvarUndo();
  try {
    await dbDelete("movimentos", id);
    state.movimentos = state.movimentos.filter(m=>m.id!==id);
    renderTudo(); toast(`"${label}" excluído.`, "info", true);
  } catch(err) { toast(err.message,"error"); }
}

async function excluirConta(id) {
  const temMovs = state.movimentos.some(m=>m.bancoId===id);
  const ok = await confirmar(temMovs ? "Esta conta tem movimentações vinculadas. Excluir mesmo assim?" : "Excluir esta conta?");
  if (!ok) return;
  const label = state.bancos.find(b=>b.id===id)?.nome || "Conta";
  _salvarUndo();
  try {
    await dbDelete("contas", id);
    state.bancos = state.bancos.filter(b=>b.id!==id);
    renderTudo(); toast(`Conta "${label}" excluída.`, "info", true);
  } catch(err) { toast(err.message,"error"); }
}

async function excluirTransferencia(id) {
  const ok = await confirmar("Excluir esta transferência?"); if (!ok) return;
  _salvarUndo();
  try {
    await dbDelete("transferencias", id);
    state.transferencias = state.transferencias.filter(t=>t.id!==id);
    renderTudo(); toast("Transferência excluída.", "info", true);
  } catch(err) { toast(err.message,"error"); }
}

async function excluirRecorrencia(id) {
  const ok = await confirmar("Excluir esta recorrência?"); if (!ok) return;
  const label = state.recorrencias.find(r=>r.id===id)?.descricao || "Recorrência";
  _salvarUndo();
  try {
    await dbDelete("recorrencias", id);
    state.recorrencias = state.recorrencias.filter(r=>r.id!==id);
    renderTudo(); toast(`Recorrência "${label}" excluída.`, "info", true);
  } catch(err) { toast(err.message,"error"); }
}

async function excluirMeta(id) {
  const ok = await confirmar("Excluir esta meta?"); if (!ok) return;
  const label = state.metas.find(m=>m.id===id)?.categoria || "Meta";
  _salvarUndo();
  try {
    await dbDelete("metas", id);
    state.metas = state.metas.filter(m=>m.id!==id);
    renderTudo(); toast(`Meta "${label}" excluída.`, "info", true);
  } catch(err) { toast(err.message,"error"); }
}

/* ─── Modais ──────────────────────────────────────────────── */
const _modais = {
  movimento:   document.getElementById("modalEditarMovimento"),
  conta:       document.getElementById("modalEditarConta"),
  recorrencia: document.getElementById("modalEditarRecorrencia"),
};

function abrirModal(k)  { _modais[k]?.classList.add("open"); }
function fecharModal(k) { _modais[k]?.classList.remove("open"); }

Object.entries(_modais).forEach(([k,el]) => {
  el?.addEventListener("click", e => { if (e.target===el) fecharModal(k); });
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
  document.getElementById("editMovConta").innerHTML = state.bancos.map(b=>`<option value="${b.id}"${b.id===m.bancoId?" selected":""}>${b.nome} · ${b.tipo}</option>`).join("");
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
  } catch(err) { toast(err.message,"error"); }
});

/* Editar conta */
function abrirEditarConta(id) {
  const b = state.bancos.find(b=>b.id===id); if (!b) return;
  document.getElementById("editContaId").value    = b.id;
  document.getElementById("editContaNome").value  = b.nome;
  document.getElementById("editContaTipo").value  = b.tipo;
  document.getElementById("editContaSaldo").value = b.saldoInicial;
  abrirModal("conta");
}
document.getElementById("formEditarConta")?.addEventListener("submit", async e => {
  e.preventDefault();
  const id = document.getElementById("editContaId").value;
  const dados = {
    nome:         document.getElementById("editContaNome").value.trim(),
    tipo:         document.getElementById("editContaTipo").value,
    saldo_inicial: Number(document.getElementById("editContaSaldo").value),
  };
  try {
    const att = await dbUpdate("contas", id, dados);
    const idx = state.bancos.findIndex(b=>b.id===id);
    if (idx>=0) state.bancos[idx] = { id:att.id, nome:att.nome, tipo:att.tipo, saldoInicial:Number(att.saldo_inicial) };
    fecharModal("conta"); renderTudo(); toast("Conta atualizada!","success");
  } catch(err) { toast(err.message,"error"); }
});

/* Editar recorrência */
function abrirEditarRecorrencia(id) {
  const r = state.recorrencias.find(r=>r.id===id); if (!r) return;
  document.getElementById("editRecId").value        = r.id;
  document.getElementById("editRecDescricao").value = r.descricao;
  document.getElementById("editRecValor").value     = r.valor;
  document.getElementById("editRecTipo").value      = r.tipo;
  document.getElementById("editRecCategoria").value = r.categoria;
  document.getElementById("editRecDia").value       = r.dia;
  document.getElementById("editRecConta").innerHTML = state.bancos.map(b=>`<option value="${b.id}"${b.id===r.contaId?" selected":""}>${b.nome} · ${b.tipo}</option>`).join("");
  abrirModal("recorrencia");
}
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
  } catch(err) { toast(err.message,"error"); }
});

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */
async function iniciar() {
  const tema = localStorage.getItem("fp_tema") || "light";
  aplicarTema(tema);

  // Verificar sessão salva
  const tokenSalvo = localStorage.getItem("fp_token");
  const userSalvo  = localStorage.getItem("fp_user");

  if (tokenSalvo && userSalvo) {
    try {
      state.user = JSON.parse(userSalvo);
      document.getElementById("userEmail").textContent = state.user.email;
      await carregarDadosNuvem();
      mostrarTelaApp();
      renderTudo();
      trocarTela("dashboard");
    } catch(e) {
      // Token expirado ou inválido
      localStorage.removeItem("fp_token");
      localStorage.removeItem("fp_user");
      mostrarTelaLogin();
    }
  } else {
    mostrarTelaLogin();
  }

  if(dataMovimentoInput) dataMovimentoInput.value = hojeISO();
  if(transDataInput)     transDataInput.value     = hojeISO();
  atualizarCamposFiltro();
}

iniciar();
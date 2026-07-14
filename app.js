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
  objetivos: [], investimentos: [], recPagamentos: [],
  perfil: { avatarTipo: "inicial", avatarPadrao: null, avatarUrl: null, nome: null },
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
  mostrarLoading(true);
  try {
    const [contas, movimentos, transferencias, recorrencias, metas, objetivos, investimentos, recPagamentos, perfilRows] = await Promise.all([
      dbSelect("contas"),
      dbSelect("movimentos"),
      dbSelect("transferencias"),
      dbSelect("recorrencias"),
      dbSelect("metas"),
      dbSelect("objetivos").catch(()=>[]),
      dbSelect("investimentos").catch(()=>[]),
      dbSelect("recorrencia_pagamentos").catch(()=>[]),
      dbSelect("perfil").catch(()=>[])
    ]);
    // Mapear campos do banco para o formato do app
    state.bancos         = contas.map(c => ({ id:c.id, nome:c.nome, tipo:c.tipo, saldoInicial: Number(c.saldo_inicial) }));
    state.movimentos     = movimentos.map(m => ({ id:m.id, descricao:m.descricao, bancoId:m.conta_id, data:m.data, valor:Number(m.valor), tipo:m.tipo, categoria:m.categoria, recorrenciaId:m.recorrencia_id, status:m.status||"pago", vencimento:m.vencimento||null, pagoEm:m.pago_em||null }));
    state.transferencias = transferencias.map(t => ({ id:t.id, origem:t.conta_origem, destino:t.conta_destino, valor:Number(t.valor), data:t.data, descricao:t.descricao||"" }));
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
    state.perfil = mapPerfil((perfilRows||[])[0]);
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
}

function mostrarLoading(ativo) {
  const el = document.getElementById("loadingOverlay");
  if (el) el.style.display = ativo ? "flex" : "none";
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
  const ok = await confirmar("Deseja sair da sua conta?");
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
  return `<span class="badge">${ICONE_CAT[cat] ?? "📋"} ${esc(cat)}</span>`;
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

  const saldos = {};
  state.bancos.forEach(b => { saldos[b.id] = b.saldoInicial; });

  // Uma única passada pelos movimentos
  for (const m of state.movimentos) {
    if (!ehPago(m)) continue;
    if (saldos[m.bancoId] === undefined) continue;
    saldos[m.bancoId] += (m.tipo === "entrada" ? m.valor : -m.valor);
  }
  // Uma única passada pelas transferências
  for (const t of state.transferencias) {
    if (saldos[t.destino] !== undefined) saldos[t.destino] += t.valor;
    if (saldos[t.origem]  !== undefined) saldos[t.origem]  -= t.valor;
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

const calcularSaldoTotal = () => state.bancos.reduce((a,b)=>a+calcularSaldoBanco(b.id),0);

/* ─── Compromissos (contas a pagar / a receber) ─────────── */

/* Data efetiva de um pendente (vencimento ou data) */
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
function todosCompromissos(ateISO) {
  const limite = ateISO || somarMeses(hojeISO(), 2);   // olha 2 meses à frente

  // 1. Lançamentos avulsos marcados como pendentes
  const avulsos = listarPendentes().map(m => ({
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

  return [...avulsos, ...recorrentes].sort((a,b) => a.vencimento.localeCompare(b.vencimento));
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
  const ok = state.bancos.length > 0;
  const opts = state.bancos.map(b=>`<option value="${b.id}">${esc(b.nome)} · ${esc(b.tipo)}</option>`).join("");
  [contaMovimentoSelect, contaExtratoSelect, transOrigemSelect, transDestinoSelect, recContaSelect]
    .forEach(s => { if(s){ s.innerHTML = ok ? opts : empty; s.disabled = !ok; } });

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
  const { entradas, gastos } = calcularTotais();
  if(saldoTotalDashboardEl) saldoTotalDashboardEl.textContent = fmtMoeda(calcularSaldoTotal());
  if(totalEntradasEl)       totalEntradasEl.textContent       = fmtMoeda(entradas);
  if(totalGastosEl)         totalGastosEl.textContent         = fmtMoeda(gastos);
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
          <span class="banco-card-nome">${esc(b.nome)}</span>
          <span class="banco-card-tipo">${esc(b.tipo)}</span>
        </div>
        <div class="banco-card-divider"></div>
        <div class="banco-card-saldo ${cls}">${fmtMoeda(s)}</div>
        <div class="banco-card-pct">${pct}% do total</div>
      </div>`;
    }).join("") + `</div>`;
}

function renderGraficoEvolucao() {
  if (chartEvolucao) chartEvolucao.destroy();

  const PT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const hoje = new Date();
  const meses = Array.from({length:6},(_,i)=>{
    const d = new Date(hoje.getFullYear(), hoje.getMonth()-(5-i), 1);
    return { ano:d.getFullYear(), mes:d.getMonth()+1, label:PT[d.getMonth()], ano2:String(d.getFullYear()).slice(2) };
  });

  const dados = meses.map(({ano,mes}) => {
    const lim = ano*100+mes;
    const base = state.bancos.reduce((a,b)=>a+b.saldoInicial, 0);
    const mov  = state.movimentos
      .filter(m => ehPago(m) && Number(m.data.slice(0,4))*100+Number(m.data.slice(5,7)) <= lim)
      .reduce((a,m) => m.tipo==="entrada" ? a+m.valor : a-m.valor, 0);
    return base + mov;
  });

  const canvas = document.getElementById("chartEvolucao");
  if (!canvas) return;

  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue("--accent").trim() || "#1EF6DD";
  const txt    = dark ? "#7C8FA3" : "#8296a5";
  const grid   = dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.045)";

  // Gradiente vertical — o preenchimento dá corpo, a linha sozinha é seca
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height || 240);
  grad.addColorStop(0,   hexParaRgba(accent, 0.22));
  grad.addColorStop(0.6, hexParaRgba(accent, 0.06));
  grad.addColorStop(1,   hexParaRgba(accent, 0));

  // Carteira zerada: mostra o convite, não uma linha reta no zero
  const vazio = dados.every(v => v === 0);

  chartEvolucao = new Chart(canvas, {
    type: "line",
    data: {
      labels: meses.map(m => m.label),
      datasets: [{
        label: "Saldo",
        data: dados,
        borderColor: accent,
        backgroundColor: grad,
        borderWidth: 2,
        fill: true,
        tension: 0.35,
        pointRadius: 0,               // pontos só no hover — linha limpa
        pointHoverRadius: 5,
        pointHoverBorderWidth: 2.5,
        pointHoverBackgroundColor: accent,
        pointHoverBorderColor: dark ? "#011025" : "#ffffff",
        clip: false
      }]
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
          bodyColor: accent,
          titleFont: { family: "Inter", size: 12, weight: "600" },
          bodyFont: { family: "IBM Plex Mono", size: 14, weight: "500" },
          padding: 11,
          displayColors: false,
          cornerRadius: 8,
          caretSize: 5,
          callbacks: {
            title: it => {
              const i = it[0].dataIndex;
              return `${meses[i].label}/${meses[i].ano2}`;
            },
            label: c => fmtMoeda(c.raw)
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: txt,
            font: { family: "Inter", size: 11 },
            padding: 8
          }
        },
        y: {
          // Sem dados, não força uma escala falsa de -1 a 1
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
        }
      }
    }
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
    if(resumoContasEl) resumoContasEl.innerHTML = `<div class="empty-state">Nenhuma conta cadastrada ainda.</div>`; return;
  }
  listaBancosEl.innerHTML = state.bancos.map(b => {
    const s = calcularSaldoBanco(b.id);
    return `<div class="conta-item">
      <div class="item-top"><div class="item-title">${esc(b.nome)}</div><div class="valor-neutro">${fmtMoeda(s)}</div></div>
      <div class="item-meta">
        <span>Tipo: <span class="badge">${esc(b.tipo)}</span></span><br>
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

function renderMovimentos() {
  if (!listaMovimentosEl) return;
  const bMap = Object.fromEntries(state.bancos.map(b=>[b.id,`${esc(b.nome)} · ${esc(b.tipo)}`]));
  const busca = (buscaMovimentoInput?.value||"").toLowerCase().trim();
  let movs = [...state.movimentos].sort((a,b)=>new Date(b.data)-new Date(a.data));
  if (busca) movs = movs.filter(m => m.descricao.toLowerCase().includes(busca) || m.categoria.toLowerCase().includes(busca));
  if (!movs.length) {
    listaMovimentosEl.innerHTML = busca
      ? `<div class="empty-state">Nenhum resultado para "${esc(busca)}".</div>`
      : vazio(
          ICO.lista,
          "Nenhum lançamento ainda",
          "Escreva algo como \"gastei 50 no mercado\" no formulário acima."
        );
    return;
  }

  // PAGINAÇÃO: renderizar 2000 itens de uma vez trava o navegador.
  const total = movs.length;
  const mostrando = Math.min(movsVisiveis, total);
  const pagina = movs.slice(0, mostrando);

  listaMovimentosEl.innerHTML = pagina.map(m => {
    const cls = m.tipo==="entrada" ? "valor-positivo" : "valor-negativo";
    const sig = m.tipo==="entrada" ? "+" : "−";
    const pend = ehPendente(m);
    const atras = estaAtrasado(m);
    return `<div class="movimento-item ${pend ? "item-pendente" : ""}">
      <div class="item-top">
        <div class="item-title">${esc(m.descricao)} ${pend ? `<span class="tag-status ${atras ? "tag-atrasado" : "tag-pendente"}">${atras ? "Atrasado" : "Pendente"}</span>` : ""}</div>
        <div class="${pend ? "valor-pendente" : cls}">${sig} ${fmtMoeda(m.valor)}</div>
      </div>
      <div class="item-meta">
        <span>Categoria: ${badge(m.categoria)}</span><br>
        <span>Conta: ${bMap[m.bancoId]||"Conta removida"}</span><br>
        <span>${pend ? "Vence" : "Data"}: ${new Date(vencDe(m)+"T00:00:00").toLocaleDateString("pt-BR")}</span>
      </div>
      <div class="item-actions">
        ${pend ? `<button class="btn-icon btn-icon-ok" onclick="marcarComoPago('${m.id}')">✓ ${m.tipo==="entrada"?"Recebi":"Paguei"}</button>` : ""}
        <button class="btn-icon" onclick="abrirEditarMovimento('${m.id}')">✏️ Editar</button>
        <button class="btn-icon btn-icon-danger" onclick="excluirMovimento('${m.id}')">🗑 Excluir</button>
      </div>
    </div>`;
  }).join("");

  // Rodapé com contador e botão de carregar mais
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
        <button class="btn-icon" onclick="abrirEditarTransferencia('${t.id}')">✏️ Editar</button>
        <button class="btn-icon btn-icon-danger" onclick="excluirTransferencia('${t.id}')">🗑 Excluir</button>
      </div>
    </div>`).join("");
}

function renderRecorrencias() {
  if (!listaRecorrenciasEl) return;
  renderOcorrencias();

  if (!state.recorrencias.length) {
    listaRecorrenciasEl.innerHTML = vazio(
      ICO.repetir,
      "Nenhuma conta recorrente",
      "Aluguel, assinaturas, salário — cadastre uma vez e o app cuida do resto."
    );
    return;
  }
  const bMap = Object.fromEntries(state.bancos.map(b=>[b.id, b.nome]));

  listaRecorrenciasEl.innerHTML = state.recorrencias.map(r => {
    const cls = r.tipo==="entrada" ? "valor-positivo" : "valor-negativo";
    const sig = r.tipo==="entrada" ? "+" : "−";
    const pagos = state.recPagamentos.filter(p => p.recorrenciaId === r.id).length;
    const fimTxt = r.fim
      ? `até ${new Date(r.fim+"T00:00:00").toLocaleDateString("pt-BR")}`
      : "sem prazo final";
    return `<div class="movimento-item ${!r.ativa ? "regra-pausada" : ""}">
      <div class="item-top">
        <div class="item-title">${esc(r.descricao)} ${!r.ativa ? '<span class="tag-status tag-pendente">Pausada</span>' : ""}</div>
        <div class="${cls}">${sig} ${fmtMoeda(r.valor)}</div>
      </div>
      <div class="item-meta">
        <span>🔁 <strong>${textoFrequencia(r)}</strong> · ${fimTxt}</span><br>
        <span>Categoria: ${badge(r.categoria)} · Conta: ${bMap[r.contaId]||"—"}</span><br>
        <span>${pagos} ${pagos===1?"pagamento registrado":"pagamentos registrados"}</span>
      </div>
      <div class="item-actions">
        <button class="btn-icon" onclick="alternarAtivaRec('${r.id}')">${r.ativa ? "⏸ Pausar" : "▶ Retomar"}</button>
        <button class="btn-icon btn-icon-danger" onclick="excluirRecorrencia('${r.id}')">🗑 Excluir</button>
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
  if (!state.metas.length) {
    listaMetasEl.innerHTML=`<div class="empty-state">Nenhuma meta cadastrada ainda.</div>`; return;
  }
  const mes = mesAtualISO();
  const gastosMes = {};
  state.movimentos.filter(m=>m.tipo==="gasto" && ehPago(m) && m.data.startsWith(mes))
    .forEach(m=>{ gastosMes[m.categoria]=(gastosMes[m.categoria]||0)+m.valor; });
  listaMetasEl.innerHTML = state.metas.map(meta => {
    const gasto = gastosMes[meta.categoria]||0;
    const pct   = Math.min((gasto/meta.limite)*100,100).toFixed(0);
    const resto = meta.limite - gasto;
    const sc    = pct>=100 ? "danger" : pct>=80 ? "warning" : "";
    return `<div class="meta-item">
      <div class="meta-header">
        <div class="meta-title">${ICONE_CAT[meta.categoria]||"📋"} ${esc(meta.categoria)}</div>
        <div class="meta-valores"><strong>${fmtMoeda(gasto)}</strong> de ${fmtMoeda(meta.limite)}</div>
      </div>
      <div class="progress-bar-wrap"><div class="progress-bar-fill ${sc}" style="width:${pct}%"></div></div>
      <div class="meta-footer">
        <span>${pct}% utilizado</span>
        <div class="meta-actions">
          <span style="color:${resto>=0?"var(--green)":"var(--red)"}">
            ${resto>=0 ? "Restam "+fmtMoeda(resto) : "Excedido "+fmtMoeda(Math.abs(resto))}
          </span>
          <button class="btn-icon" onclick="editarMeta('${meta.id}')">✏️</button>
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
  const bMap      = Object.fromEntries(state.bancos.map(b=>[b.id,`${esc(b.nome)} · ${esc(b.tipo)}`]));
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
  const tc = dark ? "#a3adc4" : "#4d5e73";
  const font = {family:"Inter",size:12};
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
      backgroundColor:["rgba(45,138,95,0.82)","rgba(192,69,63,0.82)"],
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
  invalidarCacheSaldos();
  renderConta();   // dados podem ter mudado — recalcula na próxima leitura
  atualizarSelectContas();
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
  sincronizarBottomNav(name);
  // Mostrar guia na primeira visita à seção
  mostrarGuia(name);
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
  if (!nome||!tipo) { toast("Preencha todos os campos.","error"); return; }
  try {
    const novo = await dbInsert("contas", { nome, tipo, saldo_inicial: saldoInicial });
    state.bancos.push({ id:novo.id, nome:novo.nome, tipo:novo.tipo, saldoInicial:Number(novo.saldo_inicial) });
    formBanco.reset(); renderTudo();
    toast(`Conta "${nome}" adicionada!`,"success");
  } catch(err) { tratarErro(err); }
});

formTexto?.addEventListener("submit", async e => {
  e.preventDefault();
  if (!state.bancos.length) { toast("Cadastre pelo menos uma conta antes.","warning"); return; }
  const texto = textoLivreInput.value.trim(), bancoId = contaMovimentoSelect.value, data = dataMovimentoInput.value;
  if (!texto||!bancoId||!data) { toast("Preencha todos os campos.","error"); return; }
  const valor = extrairValor(texto);
  if (!valor) { toast("Não identifiquei o valor. Ex: gastei 200 reais.","error"); return; }
  const tipo = detectarTipo(texto), categoria = classificarCategoria(texto);
  const status = statusMovSelect?.value || "pago";
  const pendente = status === "pendente";

  try {
    const novo = await dbInsert("movimentos", {
      descricao:texto, conta_id:bancoId, data, valor, tipo, categoria,
      status,
      vencimento: pendente ? data : null,
      pago_em: pendente ? null : data
    });
    state.movimentos.push({
      id:novo.id, descricao:novo.descricao, bancoId:novo.conta_id, data:novo.data,
      valor:Number(novo.valor), tipo:novo.tipo, categoria:novo.categoria,
      status:novo.status, vencimento:novo.vencimento, pagoEm:novo.pago_em
    });
    formTexto.reset();
    dataMovimentoInput.value = hojeISO();
    if (labelDataMov) labelDataMov.textContent = "Data";
    renderTudo();
    const acao = tipo==="entrada" ? "Entrada" : "Gasto";
    toast(
      pendente
        ? `${acao} de ${fmtMoeda(valor)} agendado para ${new Date(data+"T00:00:00").toLocaleDateString("pt-BR")}.`
        : `${acao} de ${fmtMoeda(valor)} registrado.`,
      "success"
    );
  } catch(err) { tratarErro(err); }
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

buscaMovimentoInput?.addEventListener("input", () => { movsVisiveis = PAGINA_TAM; renderMovimentos(); });

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
  } catch(err) { tratarErro(err); }
});

formRecorrencia?.addEventListener("submit", async e => {
  e.preventDefault();
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
  if (!inicio) { previewRecEl.textContent = ""; return; }
  const fake = {
    ativa: true,
    frequencia: document.getElementById("recFrequencia").value,
    intervalo: Number(document.getElementById("recIntervalo").value) || 1,
    intervaloUnidade: document.getElementById("recIntervaloUnidade").value,
    inicio,
    fim: document.getElementById("recFim").value || null
  };
  const proximas = ocorrenciasDe(fake, inicio, somarMeses(inicio, 14)).slice(0, 4);
  if (!proximas.length) { previewRecEl.textContent = ""; return; }
  const fmt = d => new Date(d+"T00:00:00").toLocaleDateString("pt-BR", { day:"2-digit", month:"short" });
  previewRecEl.innerHTML = `📅 ${textoFrequencia(fake)} · Próximos: <strong>${proximas.map(fmt).join(" · ")}</strong>${fake.fim ? " · e para" : "..."}`;
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
  } catch(err) { tratarErro(err); }
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
  } catch(err) { tratarErro(err); }
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
  } catch(err) { tratarErro(err); }
}

async function excluirTransferencia(id) {
  const ok = await confirmar("Excluir esta transferência?"); if (!ok) return;
  _salvarUndo();
  try {
    await dbDelete("transferencias", id);
    state.transferencias = state.transferencias.filter(t=>t.id!==id);
    renderTudo(); toast("Transferência excluída.", "info", true);
  } catch(err) { tratarErro(err); }
}

async function excluirRecorrencia(id) {
  const ok = await confirmar("Excluir esta recorrência?"); if (!ok) return;
  const label = state.recorrencias.find(r=>r.id===id)?.descricao || "Recorrência";
  _salvarUndo();
  try {
    await dbDelete("recorrencias", id);
    state.recorrencias = state.recorrencias.filter(r=>r.id!==id);
    renderTudo(); toast(`Recorrência "${label}" excluída.`, "info", true);
  } catch(err) { tratarErro(err); }
}

async function excluirMeta(id) {
  const ok = await confirmar("Excluir esta meta?"); if (!ok) return;
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
  } catch(err) { tratarErro(err); }
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
  document.getElementById("editRecConta").innerHTML = state.bancos.map(b=>`<option value="${b.id}"${b.id===r.contaId?" selected":""}>${esc(b.nome)} · ${esc(b.tipo)}</option>`).join("");
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

const GUIA_STORAGE_KEY = "fp_guia_visto_";

function mostrarGuia(screen) {
  const guia = GUIAS[screen];
  if (!guia) return;

  // Verificar se usuário marcou "não mostrar"
  if (localStorage.getItem(GUIA_STORAGE_KEY + screen) === "1") return;

  const conteudo = document.getElementById("guideContent");
  const naoMostrar = document.getElementById("guideNaoMostrar");
  if (!conteudo) return;

  naoMostrar.checked = false;
  naoMostrar.dataset.screen = screen;

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
  const naoMostrar = document.getElementById("guideNaoMostrar");
  if (naoMostrar?.checked && naoMostrar.dataset.screen) {
    localStorage.setItem(GUIA_STORAGE_KEY + naoMostrar.dataset.screen, "1");
  }
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
    btn.onclick = () => {
      // força mostrar mesmo se já viu
      localStorage.removeItem(GUIA_STORAGE_KEY + guiaKey);
      mostrarGuia(guiaKey);
    };
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

function diasEntre(d1, d2) {
  const ms = new Date(d2) - new Date(d1);
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function renderObjetivos() {
  if (!listaObjetivosEl) return;
  if (!state.objetivos.length) {
    listaObjetivosEl.innerHTML = vazio(
      ICO.cofre,
      "Nenhum objetivo ainda",
      "Um carro, uma viagem, uma reserva. Defina o valor e o prazo."
    );
    return;
  }
  listaObjetivosEl.innerHTML = state.objetivos.map(o => {
    const pct   = Math.min((o.valorAtual / o.valorAlvo) * 100, 100);
    const resto = Math.max(o.valorAlvo - o.valorAtual, 0);
    const sc    = pct >= 100 ? "danger" : pct >= 80 ? "" : "";
    const cls   = pct >= 100 ? "" : "";

    // Prazo e sugestão
    let prazoTxt = "", noPrazo = "";
    let diasRestantes = null;
    if (o.prazoTipo === "data" && o.prazoData) {
      diasRestantes = diasEntre(hojeISO(), o.prazoData);
      const dataFmt = new Date(o.prazoData + "T00:00:00").toLocaleDateString("pt-BR");
      prazoTxt = `Meta até ${dataFmt}`;
    } else if (o.prazoTipo === "dias" && o.prazoDias) {
      const criado = o.createdAt ? o.createdAt.slice(0,10) : hojeISO();
      const alvo = new Date(criado);
      alvo.setDate(alvo.getDate() + Number(o.prazoDias));
      diasRestantes = diasEntre(hojeISO(), alvo.toISOString().slice(0,10));
      prazoTxt = `${o.prazoDias} dias (faltam ${Math.max(diasRestantes,0)})`;
    }

    // Sugestão de quanto guardar por mês para chegar no prazo
    let sugestao = "";
    if (diasRestantes !== null && diasRestantes > 0 && resto > 0) {
      const meses = Math.max(diasRestantes / 30, 0.1);
      const porMes = resto / meses;
      sugestao = `Guarde ~${fmtMoeda(porMes)}/mês para chegar no prazo`;
      noPrazo = diasRestantes > 0 ? `<span style="color:var(--green)">No prazo ✓</span>` : "";
    } else if (diasRestantes !== null && diasRestantes <= 0 && resto > 0) {
      noPrazo = `<span style="color:var(--red)">Prazo vencido</span>`;
    }
    if (pct >= 100) { sugestao = "Objetivo alcançado! 🎉"; noPrazo = ""; }

    const barClass = pct >= 100 ? "" : "";
    return `<div class="objetivo-item">
      <div class="objetivo-top">
        <div class="objetivo-nome">${o.icone || "🎯"} ${esc(o.nome)}</div>
        <div class="objetivo-valores"><strong>${fmtMoeda(o.valorAtual)}</strong> de ${fmtMoeda(o.valorAlvo)}</div>
      </div>
      <div class="progress-bar-wrap"><div class="progress-bar-fill ${barClass}" style="width:${pct}%"></div></div>
      <div class="objetivo-meta">
        <span>${pct.toFixed(0)}% concluído${prazoTxt ? " · " + prazoTxt : ""}</span>
        <span>${resto > 0 ? "Faltam " + fmtMoeda(resto) : "Completo"}</span>
      </div>
      ${sugestao ? `<div class="objetivo-sugestao">${sugestao} ${noPrazo}</div>` : ""}
      <div class="item-actions">
        <button class="btn-icon" onclick="adicionarValorObjetivo('${o.id}')">➕ Guardar</button>
        <button class="btn-icon" onclick="abrirEditarObjetivo('${o.id}')">✏️ Editar</button>
        <button class="btn-icon btn-icon-danger" onclick="excluirObjetivo('${o.id}')">🗑 Excluir</button>
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
  const ok = await confirmar("Excluir este objetivo?"); if (!ok) return;
  const label = state.objetivos.find(o => o.id === id)?.nome || "Objetivo";
  try {
    await dbDelete("objetivos", id);
    state.objetivos = state.objetivos.filter(o => o.id !== id);
    renderObjetivos();
    toast(`Objetivo "${label}" excluído.`, "info");
  } catch(err) { tratarErro(err); }
}

function abrirEditarObjetivo(id) {
  const o = state.objetivos.find(o => o.id === id); if (!o) return;
  document.getElementById("objNome").value = o.nome;
  document.getElementById("objIcone").value = o.icone || "🎯";
  document.getElementById("objAlvo").value = o.valorAlvo;
  document.getElementById("objAtual").value = o.valorAtual;
  // Remove o antigo e deixa o usuário recriar com os dados preenchidos
  excluirObjetivoSilencioso(id);
  document.getElementById("objNome").focus();
  toast("Dados carregados no formulário. Ajuste e clique em Criar objetivo.", "info");
}

async function excluirObjetivoSilencioso(id) {
  try {
    await dbDelete("objetivos", id);
    state.objetivos = state.objetivos.filter(o => o.id !== id);
    renderObjetivos();
  } catch(err) { /* silencioso */ }
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
const invTotalRendimentoEl = document.getElementById("invTotalRendimento");

/* ============================================================
   CLASSIFICAÇÃO DOS TIPOS DE INVESTIMENTO
   Define o que faz sentido perguntar/projetar para cada um.
   ============================================================ */

const CATEGORIAS_INV = {
  // Renda fixa: taxa contratada, projeção confiável
  "CDB":               { cat: "rf", icone: "🏦", aviso: null },
  "CDI":               { cat: "rf", icone: "🏦", aviso: null },
  "Tesouro Selic":     { cat: "rf", icone: "🏛️", aviso: null },
  "Tesouro Prefixado": { cat: "rf", icone: "🏛️", aviso: null },
  "Poupança":          { cat: "rf", icone: "🐷", aviso: null },
  "Fundo RF":          { cat: "rf", icone: "📊", aviso: null },

  // Renda fixa indexada: projeção é estimativa (inflação varia)
  "Tesouro IPCA": {
    cat: "rf", icone: "🏛️",
    aviso: "Este título paga uma taxa fixa <strong>+ a inflação (IPCA)</strong>. Informe a taxa fixa contratada. A projeção é uma <strong>estimativa</strong> — o rendimento real depende da inflação futura."
  },

  // Renda variável: sem taxa, valor oscila
  "Ações": {
    cat: "rv", icone: "📈", dividendos: true,
    aviso: "Ações <strong>não têm rendimento garantido</strong> — o preço sobe e desce com o mercado. Registre quanto vale hoje para acompanhar seu ganho ou perda real. Se a empresa paga dividendos, informe o yield anual."
  },
  "FII": {
    cat: "rv", icone: "🏢", dividendos: true,
    aviso: "FIIs <strong>oscilam de preço</strong>, mas pagam rendimentos mensais. Registre quanto vale hoje e o dividend yield anual para acompanhar a renda."
  },
  "ETF": {
    cat: "rv", icone: "📊", dividendos: true,
    aviso: "ETFs seguem um índice — o valor <strong>oscila com o mercado</strong>, sem rendimento garantido. Registre quanto vale hoje para ver seu resultado real."
  },
  "BDR": {
    cat: "rv", icone: "🌎", dividendos: true,
    aviso: "BDRs acompanham ações estrangeiras. O valor <strong>oscila</strong> e ainda sofre efeito do câmbio. Não há rendimento previsível."
  },
  "Cripto": {
    cat: "rv", icone: "₿", dividendos: false,
    aviso: "Criptomoedas são <strong>altamente voláteis e imprevisíveis</strong>. Não existe taxa de rendimento — o preço pode subir ou cair muito. Registre quanto vale hoje para acompanhar seu resultado real."
  },
  "Fundo Multi": {
    cat: "rv", icone: "📊", dividendos: false,
    aviso: "Fundos multimercado e de ações <strong>não têm rentabilidade garantida</strong>. Registre o valor atual da cota para acompanhar o desempenho."
  },

  // Bens físicos: valorização imprevisível, podem gerar renda
  "Imóvel": {
    cat: "rv", icone: "🏠", dividendos: true, labelDiv: "Aluguel (% a.a.)",
    aviso: "A valorização de um imóvel é <strong>imprevisível</strong>. Registre o valor de mercado atual. Se você aluga, informe o retorno anual do aluguel sobre o valor do imóvel."
  },
  "Ouro": {
    cat: "rv", icone: "🥇", dividendos: false,
    aviso: "O preço do ouro <strong>oscila com o mercado</strong> — não há rendimento contratado. Registre quanto vale hoje."
  },
  "Físico": {
    cat: "rv", icone: "📦", dividendos: false,
    aviso: "Bens físicos <strong>não têm rendimento previsível</strong>. Registre o valor atual estimado para acompanhar a valorização."
  },

  // Outro: usuário escolhe
  "Outro": { cat: "escolher", icone: "💼", aviso: null }
};

/* Retorna a config de um tipo (com fallback para tipos customizados) */
function configTipo(tipo) {
  return CATEGORIAS_INV[tipo] || { cat: "rv", icone: "💼", dividendos: false, aviso: null };
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

/* Resultado de um investimento de renda variável */
function resultadoRV(i) {
  if (i.valorAtual == null) return null;
  const ganho = i.valorAtual - i.valor;
  const pct = i.valor > 0 ? (ganho / i.valor) * 100 : 0;
  return { ganho, pct };
}

function renderInvestimentos() {
  if (!listaInvestimentosEl) return;

  // Cards de resumo — usam o valor de hoje, não o aplicado
  const totalAplicado = state.investimentos.reduce((a, i) => a + i.valor, 0);
  const totalHoje     = state.investimentos.reduce((a, i) => a + valorHoje(i), 0);

  // Rendimento projetado: só renda fixa. Renda variável entra como renda passiva.
  let rendimento12m = 0;
  state.investimentos.forEach(i => {
    if (ehRendaFixa(i.tipo) && i.taxa > 0) {
      rendimento12m += projetarInvestimento(i.valor, i.taxa, i.taxaPeriodo, i.regime, 12, 0).juros;
    } else if (i.rendaPassiva > 0) {
      rendimento12m += valorHoje(i) * (i.rendaPassiva / 100);
    }
  });

  if (invTotalInvestidoEl)  invTotalInvestidoEl.textContent  = fmtMoeda(totalHoje);
  if (invTotalRendimentoEl) invTotalRendimentoEl.textContent = fmtMoeda(rendimento12m);

  // Atualiza o texto dos cards conforme o contexto
  const cardDescTotal = invTotalInvestidoEl?.parentElement?.querySelector(".card-desc");
  if (cardDescTotal) {
    const dif = totalHoje - totalAplicado;
    cardDescTotal.innerHTML = dif !== 0
      ? `Aplicado: ${fmtMoeda(totalAplicado)} · <span class="${dif >= 0 ? 'valor-positivo' : 'valor-negativo'}">${dif >= 0 ? '+' : ''}${fmtMoeda(dif)}</span>`
      : "Soma de todos os aportes";
  }

  renderResumoInstituicoes();

  if (!state.investimentos.length) {
    listaInvestimentosEl.innerHTML = vazio(
      ICO.grafico,
      "Nenhum investimento ainda",
      "CDB, Tesouro, ações, cripto — registre onde seu dinheiro está aplicado."
    );
    return;
  }

  // ── Agrupar por instituição ──
  const grupos = {};
  state.investimentos.forEach(i => {
    const chave = i.contaId || "__sem__";
    (grupos[chave] ||= []).push(i);
  });

  // Ordena os grupos pelo total (maior primeiro)
  const ordenado = Object.entries(grupos).sort((a, b) => {
    const ta = a[1].reduce((s, i) => s + valorHoje(i), 0);
    const tb = b[1].reduce((s, i) => s + valorHoje(i), 0);
    return tb - ta;
  });

  listaInvestimentosEl.innerHTML = ordenado.map(([chave, itens]) => {
    const nomeInst = chave === "__sem__" ? "Sem instituição" : esc(nomeInstituicao(chave) || "Conta removida");
    const iconeInst = chave === "__sem__" ? "❔" : "🏦";
    const totalGrupo = itens.reduce((s, i) => s + valorHoje(i), 0);

    const cards = itens.map(i => cardInvestimento(i)).join("");

    return `<div class="grupo-inst">
      <div class="grupo-inst-header">
        <span class="grupo-inst-nome">${iconeInst} ${nomeInst}</span>
        <span class="grupo-inst-total">${fmtMoeda(totalGrupo)}</span>
      </div>
      <div class="grupo-inst-body">${cards}</div>
    </div>`;
  }).join("");
}

/* Card de um investimento — mostra dados diferentes conforme a natureza */
function cardInvestimento(i) {
  const cfg = configTipo(i.tipo);
  const icone = cfg.icone || "💼";
  const rf = ehRendaFixa(i.tipo);

  let linhaPrincipal = "";
  let linhaSecundaria = "";
  let valorDireita = "";

  if (rf && i.taxa > 0) {
    // ── RENDA FIXA: taxa + projeção confiável ──
    const proj = projetarInvestimento(i.valor, i.taxa, i.taxaPeriodo, i.regime, 12, 0);
    const per = { ano: "a.a.", mes: "a.m.", dia: "a.d." }[i.taxaPeriodo] || "";
    const reg = i.regime === "composto" ? "compostos" : "simples";
    linhaPrincipal = `<strong>${i.taxa}% ${per}</strong> · juros ${reg}`;
    linhaSecundaria = `Em 12 meses: <span class="valor-positivo">+${fmtMoeda(proj.juros)}</span> → ${fmtMoeda(proj.final)}`;
    valorDireita = fmtMoeda(i.valor);

  } else {
    // ── RENDA VARIÁVEL: resultado real, sem projeção ──
    const res = resultadoRV(i);
    if (res) {
      const cls = res.ganho >= 0 ? "valor-positivo" : "valor-negativo";
      const sinal = res.ganho >= 0 ? "+" : "";
      linhaPrincipal = `Aplicou ${fmtMoeda(i.valor)} · vale <strong>${fmtMoeda(i.valorAtual)}</strong>`;
      linhaSecundaria = `<span class="${cls}">${sinal}${fmtMoeda(res.ganho)} (${sinal}${res.pct.toFixed(1)}%)</span>`;
      valorDireita = fmtMoeda(i.valorAtual);
    } else {
      linhaPrincipal = `<span class="sem-projecao">Valor de mercado não informado</span>`;
      linhaSecundaria = `<button class="btn-inline" onclick="atualizarValorAtual('${i.id}')">Informar quanto vale hoje</button>`;
      valorDireita = fmtMoeda(i.valor);
    }

    // Dividendos / aluguel, se houver
    if (i.rendaPassiva > 0) {
      const rendaAno = valorHoje(i) * (i.rendaPassiva / 100);
      const rotulo = i.tipo === "Imóvel" ? "Aluguel" : "Dividendos";
      linhaSecundaria += `<br>${rotulo}: <strong>${i.rendaPassiva}% a.a.</strong> · <span class="valor-positivo">${fmtMoeda(rendaAno)}/ano</span>`;
    }
  }

  // Botões: renda fixa pode simular; renda variável atualiza valor
  const btnAcao = rf && i.taxa > 0
    ? `<button class="btn-icon" onclick="simularDoInvestimento('${i.id}')">🧮 Simular</button>`
    : `<button class="btn-icon" onclick="atualizarValorAtual('${i.id}')">💲 Atualizar valor</button>`;

  return `<div class="investimento-item">
    <div class="item-top">
      <div class="item-title">${icone} ${tituloInvestimento(i)}</div>
      <div class="valor-neutro">${valorDireita}</div>
    </div>
    <div class="item-meta">
      <span class="badge">${esc(i.tipo)}</span> ${rf ? '<span class="tag-rf">Renda fixa</span>' : '<span class="tag-rv">Renda variável</span>'}<br>
      <span>${linhaPrincipal}</span><br>
      <span>${linhaSecundaria}</span>
    </div>
    <div class="item-actions">
      ${btnAcao}
      <button class="btn-icon" onclick="abrirEditarInvestimento('${i.id}')">✏️ Editar</button>
      <button class="btn-icon btn-icon-danger" onclick="excluirInvestimento('${i.id}')">🗑 Excluir</button>
    </div>
  </div>`;
}

/* Atualiza quanto o investimento vale hoje */
async function atualizarValorAtual(id) {
  const i = state.investimentos.find(x => x.id === id); if (!i) return;
  const atual = i.valorAtual != null ? i.valorAtual : i.valor;
  const valor = await promptValor(
    `Quanto <strong>${tituloInvestimento(i)}</strong> vale hoje?<br>
     <span style="font-size:12px;opacity:.7">Você aplicou ${fmtMoeda(i.valor)}</span>`,
    atual
  );
  if (valor === null || isNaN(valor) || valor < 0) return;
  try {
    const att = await dbUpdate("investimentos", id, {
      valor_atual: valor,
      valor_atual_em: hojeISO()
    });
    i.valorAtual = Number(att.valor_atual);
    i.valorAtualEm = att.valor_atual_em;
    renderInvestimentos();
    const res = resultadoRV(i);
    if (res) {
      const msg = res.ganho >= 0
        ? `Valor atualizado! Ganho de ${fmtMoeda(res.ganho)} (${res.pct.toFixed(1)}%)`
        : `Valor atualizado. Prejuízo de ${fmtMoeda(Math.abs(res.ganho))} (${res.pct.toFixed(1)}%)`;
      toast(msg, res.ganho >= 0 ? "success" : "info");
    }
  } catch(err) { tratarErro(err); }
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
    grupos[chave].total += valorHoje(i);
    grupos[chave].qtd += 1;
    // Rendimento: projeção para renda fixa, renda passiva para variável
    if (ehRendaFixa(i.tipo) && i.taxa > 0) {
      grupos[chave].rendimento += projetarInvestimento(i.valor, i.taxa, i.taxaPeriodo, i.regime, 12, 0).juros;
    } else if (i.rendaPassiva > 0) {
      grupos[chave].rendimento += valorHoje(i) * (i.rendaPassiva / 100);
    }
  });

  const totalGeral = Object.values(grupos).reduce((a, g) => a + g.total, 0);
  const ordenado = Object.entries(grupos).sort((a, b) => b[1].total - a[1].total);

  el.innerHTML = ordenado.map(([chave, g]) => {
    const nome = chave === "__sem__" ? "Não informado" : esc(nomeInstituicao(chave) || "Conta removida");
    const icone = chave === "__sem__" ? "❔" : "🏦";
    const pct = totalGeral > 0 ? (g.total / totalGeral) * 100 : 0;
    return `<div class="instituicao-item">
      <div class="inst-top">
        <div class="inst-nome">${icone} ${nome}</div>
        <div class="inst-valor">${fmtMoeda(g.total)}</div>
      </div>
      <div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
      <div class="inst-meta">
        <span>${g.qtd} ${g.qtd === 1 ? "investimento" : "investimentos"} · ${pct.toFixed(0)}% da carteira</span>
        ${g.rendimento > 0 ? `<span class="valor-positivo">+${fmtMoeda(g.rendimento)}/ano</span>` : `<span style="opacity:.5">—</span>`}
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
  const taxaPeriodo = document.getElementById("invTaxaPeriodo").value;
  const regime = document.getElementById("invRegime").value;

  // Renda fixa sem taxa não faz sentido
  if (rendaFixa && !taxa) {
    toast("Informe a taxa de rendimento.", "error");
    document.getElementById("invTaxa")?.focus();
    return;
  }

  // Campos de renda variável
  const valorAtualInput = document.getElementById("invValorAtual")?.value;
  const valorAtual = valorAtualInput ? Number(valorAtualInput) : null;
  const rendaPassiva = Number(document.getElementById("invRendaPassiva")?.value) || 0;

  try {
    const novo = await dbInsert("investimentos", {
      nome: apelido, tipo, valor,
      taxa, taxa_periodo: taxaPeriodo, regime,
      valor_atual: valorAtual,
      renda_passiva: rendaPassiva,
      valor_atual_em: valorAtual ? hojeISO() : null,
      conta_id: contaId || null,
      data_inicio: hojeISO()
    });
    state.investimentos.push(mapInvestimento(novo));
    formInvestimento.reset();
    fieldInvTipoOutro?.classList.add("hidden-filter");
    formInvestimento.classList.remove("com-outro", "modo-rv", "modo-ambos");
    ajustarFormPorTipo();
    atualizarSelectContas();
    renderInvestimentos();
    toast(`Investimento adicionado!`, "success");
  } catch(err) { tratarErro(err); }
});

/* Monta o título exibido do investimento */
/* Retorna HTML seguro (já escapado) — usado direto em innerHTML */
function tituloInvestimento(i) {
  const inst = nomeInstituicao(i.contaId);
  if (i.nome && i.nome.trim()) return esc(i.nome);      // apelido definido pelo usuário
  if (inst) return `${esc(i.tipo)} · ${esc(inst)}`;     // ex: "CDB · Nubank"
  return esc(i.tipo);                                   // ex: "CDB"
}

async function excluirInvestimento(id) {
  const ok = await confirmar("Excluir este investimento?"); if (!ok) return;
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
    dataInicio: i.data_inicio, observacao: i.observacao
  };
}

/* Nome da instituição a partir do id da conta */
function nomeInstituicao(contaId) {
  if (!contaId) return null;
  const c = state.bancos.find(b => b.id === contaId);
  return c ? c.nome : null;
}

/* Preenche o simulador com os dados de um investimento salvo */
function simularDoInvestimento(id) {
  const i = state.investimentos.find(i => i.id === id); if (!i) return;
  document.getElementById("simValor").value = i.valor;
  document.getElementById("simAporte").value = "";
  document.getElementById("simTaxa").value = i.taxa;
  document.getElementById("simTaxaPeriodo").value = i.taxaPeriodo;
  document.getElementById("simRegime").value = i.regime;
  document.getElementById("simTempo").value = 12;
  document.getElementById("simTempoUnidade").value = "mes";
  abrirSimulador(true);
  document.getElementById("formSimulador").dispatchEvent(new Event("submit"));
  setTimeout(() => {
    document.getElementById("painelSimulador")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 120);
}

/* ============================================================
   ACORDEÃO DO SIMULADOR
   ============================================================ */

function abrirSimulador(abrir) {
  const btn  = document.getElementById("toggleSimulador");
  const body = document.getElementById("conteudoSimulador");
  if (!btn || !body) return;
  body.classList.toggle("open", abrir);
  btn.setAttribute("aria-expanded", String(abrir));
  // O Chart.js não mede direito enquanto o container está fechado.
  // Ao abrir, força o redimensionamento depois da animação.
  if (abrir && chartSimulador) {
    setTimeout(() => chartSimulador.resize(), 300);
  }
}

document.getElementById("toggleSimulador")?.addEventListener("click", () => {
  const body = document.getElementById("conteudoSimulador");
  abrirSimulador(!body.classList.contains("open"));
});


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
const filtroPendentesSel = document.getElementById("filtroPendentes");
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

/* Formata o prazo de forma humana */
function textoPrazo(m) {
  const d = diasAteVencer(m);
  if (d < 0)  return { txt: `Atrasado ${Math.abs(d)} ${Math.abs(d) === 1 ? "dia" : "dias"}`, cls: "prazo-atrasado" };
  if (d === 0) return { txt: "Vence hoje", cls: "prazo-hoje" };
  if (d === 1) return { txt: "Vence amanhã", cls: "prazo-perto" };
  if (d <= 7)  return { txt: `Vence em ${d} dias`, cls: "prazo-perto" };
  const dt = new Date(vencDe(m) + "T00:00:00").toLocaleDateString("pt-BR", { day:"2-digit", month:"short" });
  return { txt: `Vence ${dt}`, cls: "prazo-longe" };
}

/* Renderiza o card de resumo e o alerta do topo */
function renderResumoCompromissos() {
  const t = totaisCompromissos();

  if (totalAPagarEl) totalAPagarEl.textContent = fmtMoeda(t.aPagar);
  if (descAPagarEl) {
    if (t.qtdPendentes === 0) {
      descAPagarEl.textContent = "Nenhuma conta pendente";
    } else {
      const partes = [];
      if (t.aPagar > 0)   partes.push(`${t.atrasados.length ? t.atrasados.length + " atrasada(s) · " : ""}sobra ${fmtMoeda(t.saldoProjetado)}`);
      if (t.aReceber > 0) partes.push(`a receber ${fmtMoeda(t.aReceber)}`);
      descAPagarEl.innerHTML = partes.join(" · ") || `${t.qtdPendentes} pendente(s)`;
    }
  }

  // Alerta destacado no topo
  if (alertaVencEl) {
    const atras = t.atrasados.length;
    const prox  = t.proximos7.length;
    if (!atras && !prox) { alertaVencEl.style.display = "none"; }
    else {
      let msg = "", cls = "alerta-info";
      if (atras) {
        const totalAtras = t.atrasados.reduce((a,m)=>a+m.valor,0);
        msg = `<strong>${atras} conta${atras>1?"s":""} atrasada${atras>1?"s":""}</strong> — ${fmtMoeda(totalAtras)}`;
        cls = "alerta-erro";
        if (prox) msg += ` · e ${prox} vence${prox>1?"m":""} nos próximos 7 dias`;
      } else {
        const totalProx = t.proximos7.reduce((a,m)=>a+m.valor,0);
        msg = `<strong>${prox} conta${prox>1?"s":""}</strong> vence${prox>1?"m":""} nos próximos 7 dias — ${fmtMoeda(totalProx)}`;
        cls = "alerta-aviso";
      }
      alertaVencEl.className = `alerta-venc ${cls}`;
      alertaVencEl.innerHTML = `<span class="alerta-icone">${atras ? "🔴" : "🔔"}</span><span>${msg}</span>`;
      alertaVencEl.style.display = "flex";
    }
  }
}

/* Renderiza a lista de contas pendentes (avulsas + recorrentes) */
function renderPendentes() {
  if (!listaPendentesEl) return;
  renderResumoCompromissos();

  const t = totaisCompromissos();
  let pend = t.lista;
  const filtro = filtroPendentesSel?.value || "todos";

  if (filtro === "atrasados") pend = pend.filter(m => diasAte(m.vencimento) < 0);
  else if (filtro === "semana") pend = pend.filter(m => { const d = diasAte(m.vencimento); return d >= 0 && d <= 7; });
  else if (filtro === "mes") pend = pend.filter(m => m.vencimento.startsWith(mesAtualISO()));

  if (!pend.length) {
    if (filtro !== "todos") {
      listaPendentesEl.innerHTML = `<div class="empty-state">Nenhuma conta neste filtro.</div>`;
    } else if (!state.recorrencias.length && !state.bancos.length) {
      // App novo: nem faz sentido falar de pendências ainda
      listaPendentesEl.innerHTML = vazio(
        ICO.repetir,
        "Cadastre o que se repete",
        "Aluguel, assinaturas, salário. Você cadastra uma vez e o app avisa todo mês.",
        { texto: "Criar recorrência", onclick: "irParaRecorrencias()" }
      );
    } else {
      listaPendentesEl.innerHTML = vazio(
        ICO.check,
        "Tudo em dia",
        "Nenhuma conta pendente no momento."
      );
    }
    return;
  }

  listaPendentesEl.innerHTML = pend.map(m => {
    const d = diasAte(m.vencimento);
    const atrasado = d < 0;
    let txt, cls;
    if (atrasado)   { txt = `Atrasado ${Math.abs(d)} ${Math.abs(d)===1?"dia":"dias"}`; cls = "prazo-atrasado"; }
    else if (d===0) { txt = "Vence hoje"; cls = "prazo-hoje"; }
    else if (d===1) { txt = "Vence amanhã"; cls = "prazo-perto"; }
    else if (d<=7)  { txt = `Vence em ${d} dias`; cls = "prazo-perto"; }
    else {
      const dt = new Date(m.vencimento+"T00:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"short"});
      txt = `Vence ${dt}`; cls = "prazo-longe";
    }

    const conta = state.bancos.find(b => b.id === m.contaId);
    const ehEntrada = m.tipo === "entrada";
    const acao = m.origem === "recorrente"
      ? `pagarOcorrencia('${m.recId}','${m.vencimento}')`
      : `marcarComoPago('${m.id}')`;

    return `<div class="pendente-item ${atrasado ? "atrasado" : ""}">
      <div class="pend-esq">
        <div class="pend-desc">${ehEntrada ? "↓" : "↑"} ${esc(m.descricao)} ${m.origem==="recorrente" ? '<span class="tag-recorrente">🔁</span>' : ""}</div>
        <div class="pend-meta">
          <span class="prazo ${cls}">${txt}</span>
          <span class="badge">${esc(m.categoria)}</span>
          ${conta ? `<span class="pend-conta">${esc(conta.nome)}</span>` : ""}
        </div>
      </div>
      <div class="pend-dir">
        <div class="${ehEntrada ? "valor-positivo" : "valor-negativo"}">${ehEntrada ? "+" : "−"}${fmtMoeda(m.valor)}</div>
        <div class="pend-acoes">
          <button class="btn-pagar" onclick="${acao}">${ehEntrada ? "✓ Recebi" : "✓ Paguei"}</button>
        </div>
      </div>
    </div>`;
  }).join("");
}

filtroPendentesSel?.addEventListener("change", renderPendentes);

/* Marca um compromisso como pago — aí sim afeta o saldo */
async function marcarComoPago(id) {
  const m = state.movimentos.find(x => x.id === id); if (!m) return;
  const ehEntrada = m.tipo === "entrada";
  try {
    const hoje = hojeISO();
    const att = await dbUpdate("movimentos", id, {
      status: "pago",
      pago_em: hoje,
      data: hoje   // a data do lançamento vira o dia do pagamento efetivo
    });
    m.status = "pago";
    m.pagoEm = hoje;
    m.data = hoje;
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
  return dt.toISOString().slice(0, 10);
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

/* Ocorrências pendentes (não pagas) até uma data */
function pendentesRecorrentes(ateISO) {
  const de = "2000-01-01";
  return ocorrenciasNaJanela(de, ateISO || hojeISO()).filter(o => !o.pago);
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
    listaOcorrenciasEl.innerHTML = `<div class="empty-state">Nenhuma conta recorrente cadastrada.</div>`;
    return;
  }

  const [a, m] = mesVisao.split("-").map(Number);
  const de  = `${mesVisao}-01`;
  const ate = `${mesVisao}-${String(new Date(a, m, 0).getDate()).padStart(2,"0")}`;

  let itens = ocorrenciasNaJanela(de, ate);

  // Filtros
  if (filtroOcor === "pendentes")  itens = itens.filter(o => !o.pago);
  else if (filtroOcor === "pagos") itens = itens.filter(o => o.pago);
  else if (filtroOcor === "atrasados") itens = itens.filter(o => !o.pago && o.vencimento < hojeISO());

  if (!itens.length) {
    const msgs = {
      todos: "Nenhum vencimento neste mês.",
      pendentes: "Tudo pago neste mês",
      pagos: "Nenhuma conta paga neste mês ainda.",
      atrasados: "Nenhuma conta atrasada"
    };
    listaOcorrenciasEl.innerHTML = `<div class="empty-state">${msgs[filtroOcor]}</div>`;
    return;
  }

  // Resumo do mês
  const total    = itens.reduce((s,o) => s + o.valor, 0);
  const pagos    = itens.filter(o => o.pago);
  const totalPago = pagos.reduce((s,o) => s + o.valor, 0);
  const pend     = itens.filter(o => !o.pago);
  const totalPend = pend.reduce((s,o) => s + o.valor, 0);

  const resumo = `<div class="ocor-resumo">
    <span>${itens.length} vencimento${itens.length>1?"s":""}</span>
    ${pagos.length ? `<span class="valor-positivo">${pagos.length} pago${pagos.length>1?"s":""} · ${fmtMoeda(totalPago)}</span>` : ""}
    ${pend.length  ? `<span class="valor-pendente-forte">${pend.length} pendente${pend.length>1?"s":""} · ${fmtMoeda(totalPend)}</span>` : ""}
  </div>`;

  const cards = itens.map(o => cardOcorrencia(o)).join("");
  listaOcorrenciasEl.innerHTML = resumo + `<div class="ocor-lista">${cards}</div>`;
}

/* Card de uma ocorrência */
function cardOcorrencia(o) {
  const { rec, vencimento, pago, pagamento, valor } = o;
  const hoje = hojeISO();
  const atrasado = !pago && vencimento < hoje;
  const dias = Math.round((new Date(vencimento+"T00:00:00") - new Date(hoje+"T00:00:00")) / 86400000);
  const ehEntrada = rec.tipo === "entrada";
  const conta = state.bancos.find(b => b.id === rec.contaId);
  const dataFmt = new Date(vencimento+"T00:00:00").toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit" });

  let estado, cls;
  if (pago) {
    const pgFmt = new Date(pagamento.pagoEm+"T00:00:00").toLocaleDateString("pt-BR", { day:"2-digit", month:"2-digit" });
    estado = `<span class="ocor-estado pago">✓ Pago em ${pgFmt}</span>`;
    cls = "pago";
  } else if (atrasado) {
    const d = Math.abs(dias);
    estado = `<span class="ocor-estado atrasado">Atrasado ${d} ${d===1?"dia":"dias"}</span>`;
    cls = "atrasado";
  } else if (dias === 0) {
    estado = `<span class="ocor-estado hoje">Vence hoje</span>`;
    cls = "hoje";
  } else if (dias <= 7) {
    estado = `<span class="ocor-estado perto">Vence em ${dias} ${dias===1?"dia":"dias"}</span>`;
    cls = "perto";
  } else {
    estado = `<span class="ocor-estado futuro">Vence dia ${dataFmt}</span>`;
    cls = "futuro";
  }

  const acao = pago
    ? `<button class="btn-icon" onclick="desfazerPagamento('${rec.id}','${vencimento}')">↩ Desfazer</button>`
    : `<button class="btn-pagar" onclick="pagarOcorrencia('${rec.id}','${vencimento}')">${ehEntrada ? "✓ Recebi" : "✓ Paguei"}</button>`;

  return `<div class="ocor-item ${cls}">
    <div class="ocor-dia">
      <span class="ocor-dia-num">${vencimento.slice(8,10)}</span>
      <span class="ocor-dia-mes">${MESES_PT[Number(vencimento.slice(5,7))-1].slice(0,3)}</span>
    </div>
    <div class="ocor-info">
      <div class="ocor-desc">${ehEntrada ? "↓" : "↑"} ${esc(rec.descricao)}</div>
      <div class="ocor-meta">
        ${estado}
        <span class="badge">${esc(rec.categoria)}</span>
        ${conta ? `<span class="ocor-conta">${esc(conta.nome)}</span>` : ""}
      </div>
    </div>
    <div class="ocor-dir">
      <div class="ocor-valor ${pago ? (ehEntrada?"valor-positivo":"valor-negativo") : "valor-pendente"}">
        ${ehEntrada ? "+" : "−"}${fmtMoeda(valor)}
      </div>
      <div class="ocor-acoes">${acao}</div>
    </div>
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
  const ok = await confirmar("Desfazer este pagamento? O lançamento será removido do extrato.");
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

/* Editar o limite de uma meta */
async function editarMeta(id) {
  const meta = state.metas.find(m => m.id === id); if (!meta) return;
  const novo = await promptValor(
    `Novo limite mensal para <strong>${esc(meta.categoria)}</strong>`,
    meta.limite
  );
  if (novo === null || isNaN(novo) || novo <= 0) return;
  try {
    const att = await dbUpdate("metas", id, { limite: novo });
    meta.limite = Number(att.limite);
    renderTudo();
    toast(`Meta de ${esc(meta.categoria)} atualizada para ${fmtMoeda(novo)}.`, "success");
  } catch(err) { tratarErro(err); }
}

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
  modal.querySelectorAll(".edit-campo-rf").forEach(el => el.classList.toggle("hidden-filter", !rf));
  modal.querySelectorAll(".edit-campo-rv").forEach(el => el.classList.toggle("hidden-filter", rf));

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
      <div class="doc-aviso">⚠️ <strong>Documento provisório.</strong> Substitua por uma versão revisada juridicamente antes de operar comercialmente.</div>

      <h4>1. Quem somos</h4>
      <p>[RAZÃO SOCIAL] — CNPJ [NÚMERO] — controladora dos dados tratados nesta aplicação.<br>
      Contato do Encarregado (DPO): [E-MAIL]</p>

      <h4>2. Quais dados coletamos</h4>
      <ul>
        <li><strong>Cadastro:</strong> e-mail e senha (armazenada de forma criptografada).</li>
        <li><strong>Financeiros:</strong> contas, lançamentos, transferências, recorrências, metas, objetivos e investimentos que você registra.</li>
        <li><strong>Técnicos:</strong> data e hora de acesso, para segurança da conta.</li>
      </ul>
      <p>Não coletamos dados bancários reais, não acessamos suas contas em instituições financeiras e não realizamos transações.</p>

      <h4>3. Para que usamos</h4>
      <p>Exclusivamente para prestar o serviço: exibir, calcular e organizar as informações que você mesmo insere. Não vendemos, alugamos nem compartilhamos seus dados com terceiros para fins comerciais.</p>

      <h4>4. Onde ficam armazenados</h4>
      <p>Os dados são hospedados na infraestrutura do Supabase, com criptografia em trânsito e em repouso, e isolamento por usuário (Row Level Security).</p>

      <h4>5. Seus direitos (art. 18 da LGPD)</h4>
      <ul>
        <li><strong>Acesso e portabilidade:</strong> exporte seus dados a qualquer momento em JSON ou CSV.</li>
        <li><strong>Correção:</strong> edite ou exclua qualquer registro dentro do aplicativo.</li>
        <li><strong>Eliminação:</strong> exclua sua conta e todos os dados de forma permanente.</li>
        <li><strong>Informação e revogação:</strong> entre em contato pelo e-mail acima.</li>
      </ul>

      <h4>6. Retenção</h4>
      <p>Seus dados permanecem enquanto a conta existir. Ao excluir a conta, os dados são apagados de forma permanente.</p>

      <h4>7. Alterações</h4>
      <p>Podemos atualizar esta política. Alterações relevantes serão comunicadas.</p>

      <p class="doc-data">Última atualização: [DATA]</p>
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
      <div class="doc-aviso">⚠️ <strong>Documento provisório.</strong> Substitua por uma versão revisada juridicamente antes de operar comercialmente.</div>

      <h4>1. Objeto</h4>
      <p>Este aplicativo é uma ferramenta de <strong>organização financeira pessoal</strong>. Ele registra e calcula informações que você mesmo insere.</p>

      <h4>2. O que NÃO somos</h4>
      <p>Não somos instituição financeira, não oferecemos consultoria de investimentos e não recomendamos produtos financeiros. As projeções e simulações são <strong>estimativas baseadas nos dados que você informa</strong> e não constituem promessa de rentabilidade.</p>

      <h4>3. Sua responsabilidade</h4>
      <ul>
        <li>Manter a senha em sigilo.</li>
        <li>Conferir a exatidão dos dados que insere.</li>
        <li>Não usar o serviço para fins ilícitos.</li>
      </ul>

      <h4>4. Limitação de responsabilidade</h4>
      <p>O serviço é fornecido "no estado em que se encontra". Não nos responsabilizamos por decisões financeiras tomadas com base nas informações exibidas, tampouco por perdas decorrentes de dados incorretos inseridos pelo usuário.</p>

      <h4>5. Disponibilidade</h4>
      <p>Empregamos esforços para manter o serviço disponível, mas podem ocorrer interrupções por manutenção ou falhas de terceiros.</p>

      <h4>6. Encerramento</h4>
      <p>Você pode encerrar sua conta a qualquer momento. Podemos suspender contas que violem estes termos.</p>

      <h4>7. Foro</h4>
      <p>Fica eleito o foro da comarca de [CIDADE/UF].</p>

      <p class="doc-data">Última atualização: [DATA]</p>
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
  const ok1 = await confirmar(
    `<strong>Tem certeza?</strong><br><br>
     Isso apagará permanentemente:<br>
     • ${state.bancos.length} conta(s)<br>
     • ${state.movimentos.length} lançamento(s)<br>
     • ${state.investimentos.length} investimento(s)<br>
     • Todas as metas, objetivos e recorrências<br><br>
     <strong>Não há como desfazer.</strong>`
  );
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
document.querySelectorAll('.lp-nav-links a[href^="#"]').forEach(a => {
  a.addEventListener("click", e => {
    e.preventDefault();
    rolarPara(a.getAttribute("href").slice(1));
  });
});

/* ─── SIGNATURE: o painel que se recalcula ─────────────────
   Mostra o produto pensando, em vez de uma ilustração dele.
   Alterna entre cenários reais — o que muda é o que importa. */
const CENARIOS_DEMO = [
  {
    saldo: 7800, pagar: 1620, receber: 800,
    status: "3 contas pendentes · 1 vence amanhã"
  },
  {
    saldo: 6980, pagar: 340, receber: 0,
    status: "Aluguel pago · fatura vence em 6 dias"
  },
  {
    saldo: 12450, pagar: 2890, receber: 3200,
    status: "Salário cai dia 5 · 4 contas a pagar"
  },
  {
    saldo: 3210, pagar: 2100, receber: 1500,
    status: "Atenção: 1 conta atrasada há 2 dias"
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

  const elSaldo   = document.getElementById("demoSaldo");
  const elPagar   = document.getElementById("demoPagar");
  const elReceber = document.getElementById("demoReceber");
  const elSobra   = document.getElementById("demoSobra");
  const elStatus  = document.getElementById("demoStatus");

  const sobraDe   = demoAtual.saldo - demoAtual.pagar + demoAtual.receber;
  const sobraPara = proximo.saldo - proximo.pagar + proximo.receber;

  animarNumero(elSaldo,   demoAtual.saldo,   proximo.saldo,   900);
  animarNumero(elPagar,   demoAtual.pagar,   proximo.pagar,   900, "−");
  animarNumero(elReceber, demoAtual.receber, proximo.receber, 900, "+");
  animarNumero(elSobra,   sobraDe,           sobraPara,       1100);

  if (elStatus) {
    elStatus.style.opacity = "0";
    setTimeout(() => {
      elStatus.textContent = proximo.status;
      elStatus.style.opacity = "1";
    }, 260);
  }

  demoAtual = { ...proximo };
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

/* ─── Boot da landing ─────────────────────────────────────── */
function iniciarLanding() {
  iniciarRevelacao();
  iniciarNavScroll();
  iniciarPainelDemo();
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

  // Rótulo do tema
  const tl = document.getElementById("temaLabel");
  if (tl) {
    const escuro = document.documentElement.getAttribute("data-theme") === "dark";
    tl.textContent = escuro ? "Escuro" : "Claro";
  }
}

/* Envia o link de troca de senha para o e-mail do usuário */
async function pedirTrocaSenha() {
  const email = state.user?.email;
  if (!email) return;

  const ok = await confirmar(
    `Enviaremos um link de redefinição para<br><strong>${esc(email)}</strong>.<br><br>Deseja continuar?`
  );
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

  mostrarLoading(true);
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
    body: JSON.stringify({ user_id: state.user.id, ...dados, atualizado_em: new Date().toISOString() })
  });
  const rows = await res.json();
  return rows[0];
}

function mapPerfil(p) {
  if (!p) return { avatarTipo: "inicial", avatarPadrao: null, avatarUrl: null, nome: null };
  return {
    avatarTipo:   p.avatar_tipo   || "inicial",
    avatarPadrao: p.avatar_padrao || null,
    avatarUrl:    p.avatar_url    || null,
    nome:         p.nome          || null
  };
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
function irParaLancamentos()  { trocarTela("lancamentos"); }
function irParaRecorrencias() { trocarTela("recorrencias"); }

async function iniciar() {
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
  atualizarCamposFiltro();
}

iniciar();
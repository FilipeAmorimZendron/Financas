// api/receber-extrato-email.js
// Webhook chamado pelo Resend toda vez que chega um e-mail no endereço de
// extratos (ex: extrato@extrato.fazfinancas.com). Identifica de quem é
// pelo remetente, lê o anexo (ou o corpo do e-mail) com o mesmo motor que
// já lê extrato no app, e guarda o resultado como PENDENTE — a pessoa só
// vê e confirma quando abrir o app (tabela extratos_email, tela de
// revisão de sempre). Nada é salvo como lançamento de verdade aqui.
//
// Fluxo completo (ver conversa com o Filipe de 26/08/2026):
//   1. Pessoa encaminha (ou pede pro banco mandar) o extrato pro e-mail
//      do FAZ, saindo do MESMO e-mail cadastrado na conta dela.
//   2. Resend recebe, verifica que é de verdade e nos avisa aqui.
//   3. A gente bate o remetente com perfil.email pra achar de quem é.
//   4. Lê o anexo (ou o texto do e-mail, se não tiver anexo) com a IA.
//   5. Grava pendente. Da próxima vez que ela abrir o app, aparece um
//      aviso — ela revisa e confirma antes de qualquer coisa ser salva.

import crypto from "crypto";
import { lerExtratoCore } from "./_lerExtratoCore.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://yuvhkrwksdnajfautkru.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Mesma data de corte do plano único usada em app.js/ler-extrato.js/chat-ia.js.
const CORTE_PLANO_UNICO = "2026-08-13T17:50:58Z";

// Mesmo custo de ler um PDF/foto no app (ver CUSTO_ARQUIVO em ler-extrato.js) —
// pra não virar um jeito de ler extrato de graça, ignorando o limite normal.
const CUSTO_ARQUIVO = 4;
const CUSTO_TEXTO = 2;
const LIMITES = { premium: 100, master: 100 };
const HORAS_RECARGA = 3;

// Precisamos do corpo cru (não JSON.parse) pra verificar a assinatura —
// desliga o bodyParser padrão da Vercel pra isso.
export const config = { api: { bodyParser: false }, maxDuration: 60 };

function lerCorpoCru(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    req.on("data", c => partes.push(c));
    req.on("end", () => resolve(Buffer.concat(partes).toString("utf8")));
    req.on("error", reject);
  });
}

/* Verificação de assinatura no padrão Svix (é o que o Resend usa):
   HMAC-SHA256 de "{svix-id}.{svix-timestamp}.{corpo}", com a chave sendo
   o segredo "whsec_..." sem o prefixo, decodificado de base64. O cabeçalho
   pode trazer mais de uma assinatura (separadas por espaço); basta uma bater. */
function assinaturaValida(svixId, svixTimestamp, corpoCru, svixSignature, segredo) {
  if (!svixId || !svixTimestamp || !svixSignature || !segredo) return false;
  try {
    const chave = Buffer.from(segredo.replace(/^whsec_/, ""), "base64");
    const conteudoAssinado = `${svixId}.${svixTimestamp}.${corpoCru}`;
    const esperado = crypto.createHmac("sha256", chave).update(conteudoAssinado).digest("base64");
    const esperadoBuf = Buffer.from(esperado);
    return svixSignature.split(" ").some(parte => {
      const [, sig] = parte.split(",");
      if (!sig) return false;
      const sigBuf = Buffer.from(sig);
      if (sigBuf.length !== esperadoBuf.length) return false;
      return crypto.timingSafeEqual(sigBuf, esperadoBuf);
    });
  } catch (e) {
    return false;
  }
}

/* Extrai só o endereço de dentro de "Nome <email@dominio.com>" (ou devolve
   a string como está, se não vier nesse formato). */
function extrairEmail(bruto) {
  const m = String(bruto || "").match(/<([^>]+)>/);
  return (m ? m[1] : bruto || "").trim().toLowerCase();
}

async function buscarPerfilPorEmail(email) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/perfil?email=eq.${encodeURIComponent(email)}&select=user_id,nome,plano,assinatura_status,admin,ia_usos,ia_reset_em`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  if (!res.ok) return null;
  const linhas = await res.json();
  return linhas[0] || null;
}

/* Data de criação da conta (auth.users), pra saber se é anterior ao corte
   do plano único (acesso de graça garantido — ver CORTE_PLANO_UNICO). */
async function buscarDataCriacao(userId) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
  });
  if (!res.ok) return null;
  const dados = await res.json();
  return dados.created_at || null;
}

async function buscarContasECategorias(userId) {
  const [rContas, rCategorias] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/contas?user_id=eq.${userId}&contexto=eq.pessoal&select=nome`,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }),
    fetch(`${SUPABASE_URL}/rest/v1/categorias?user_id=eq.${userId}&contexto=eq.pessoal&select=nome`,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }),
  ]);
  const contas = rContas.ok ? (await rContas.json()).map(c => c.nome).filter(Boolean) : [];
  const categorias = rCategorias.ok ? (await rCategorias.json()).map(c => c.nome).filter(Boolean) : [];
  return { contas, categorias };
}

async function atualizarUso(userId, usos, resetEm) {
  await fetch(`${SUPABASE_URL}/rest/v1/perfil?user_id=eq.${userId}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "content-type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify({ ia_usos: usos, ia_reset_em: resetEm })
  });
}

/* Busca os anexos do e-mail recebido e baixa o primeiro (PDF ou imagem).
   O Resend não manda o conteúdo no próprio webhook — só um id; o
   conteúdo vem de uma chamada separada à API deles. */
async function baixarPrimeiroAnexo(emailId) {
  const resp = await fetch(`https://api.resend.com/emails/receiving/${emailId}/attachments`, {
    headers: { Authorization: `Bearer ${RESEND_API_KEY}` }
  });
  if (!resp.ok) return null;
  const dados = await resp.json();
  const anexos = Array.isArray(dados.data) ? dados.data : (Array.isArray(dados) ? dados : []);
  // Prioriza PDF; se não tiver, pega a primeira imagem.
  const candidato = anexos.find(a => (a.content_type || a.contentType || "").includes("pdf"))
    || anexos.find(a => (a.content_type || a.contentType || "").startsWith("image/"));
  if (!candidato || !candidato.download_url) return null;

  const respArquivo = await fetch(candidato.download_url);
  if (!respArquivo.ok) return null;
  const buffer = Buffer.from(await respArquivo.arrayBuffer());
  return {
    base64: buffer.toString("base64"),
    tipo: candidato.content_type || candidato.contentType || "application/pdf"
  };
}

/* Corpo do e-mail (texto), pra quando a pessoa cola o extrato direto na
   mensagem em vez de mandar um PDF anexado — ou quando é o próprio banco
   mandando o extrato como texto no corpo do e-mail. */
async function buscarCorpoEmail(emailId) {
  const resp = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
    headers: { Authorization: `Bearer ${RESEND_API_KEY}` }
  });
  if (!resp.ok) return "";
  const dados = await resp.json();
  return dados.text || dados.html || "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido" });
  }
  if (!SUPABASE_SERVICE_KEY || !RESEND_API_KEY || !RESEND_WEBHOOK_SECRET || !ANTHROPIC_API_KEY) {
    console.error("receber-extrato-email: faltam variáveis de ambiente na Vercel");
    // 200 pra não deixar o Resend martelando retry — o problema é nosso, não do remetente
    return res.status(200).json({ ok: false, motivo: "servidor sem configuração" });
  }

  const corpoCru = await lerCorpoCru(req);
  const svixId = req.headers["svix-id"];
  const svixTimestamp = req.headers["svix-timestamp"];
  const svixSignature = req.headers["svix-signature"];

  if (!assinaturaValida(svixId, svixTimestamp, corpoCru, svixSignature, RESEND_WEBHOOK_SECRET)) {
    console.error("receber-extrato-email: assinatura do webhook não bateu");
    return res.status(401).json({ erro: "Assinatura inválida" });
  }

  let evento;
  try {
    evento = JSON.parse(corpoCru);
  } catch (e) {
    return res.status(400).json({ erro: "JSON inválido" });
  }

  // Só nos interessa e-mail recebido — ignora qualquer outro tipo de evento
  // que o Resend possa mandar pro mesmo endpoint (envio, entrega, etc.).
  if (evento.type !== "email.received") {
    return res.status(200).json({ ok: true, ignorado: evento.type });
  }

  try {
    const emailId = evento.data?.email_id;
    const remetente = extrairEmail(evento.data?.from);

    if (!emailId || !remetente) {
      console.log("receber-extrato-email: payload sem email_id ou remetente");
      return res.status(200).json({ ok: true, motivo: "payload incompleto" });
    }

    const perfil = await buscarPerfilPorEmail(remetente);
    if (!perfil) {
      console.log("receber-extrato-email: nenhuma conta FAZ com o e-mail", remetente);
      return res.status(200).json({ ok: true, motivo: "e-mail não corresponde a nenhuma conta" });
    }

    const criadoEm = await buscarDataCriacao(perfil.user_id);
    const antesDoPlanoUnico = !!criadoEm && new Date(criadoEm).getTime() < new Date(CORTE_PLANO_UNICO).getTime();
    let plano = (perfil.assinatura_status === "ativa") ? perfil.plano : "basico";
    if (antesDoPlanoUnico) plano = "premium";

    if (plano !== "premium" && plano !== "master") {
      console.log("receber-extrato-email: conta sem assinatura ativa —", remetente);
      return res.status(200).json({ ok: true, motivo: "conta sem assinatura ativa" });
    }

    // Anexo primeiro (é o caso comum: PDF do extrato). Sem anexo, usa o
    // corpo do e-mail como texto — cobre quem cola o extrato direto na
    // mensagem, ou bancos que mandam o extrato como texto no corpo.
    const anexo = await baixarPrimeiroAnexo(emailId);
    let entradaExtrato;
    if (anexo) {
      entradaExtrato = { arquivoBase64: anexo.base64, tipoArquivo: anexo.tipo };
    } else {
      const corpo = await buscarCorpoEmail(emailId);
      if (!corpo || !corpo.trim()) {
        console.log("receber-extrato-email: e-mail sem anexo e sem corpo de texto —", remetente);
        return res.status(200).json({ ok: true, motivo: "e-mail vazio" });
      }
      entradaExtrato = { texto: corpo };
    }

    // Limite de uso — mesma regra do upload manual (ver ler-extrato.js).
    // Conta admin nunca gasta nem é bloqueada.
    if (!perfil.admin) {
      const custo = anexo ? CUSTO_ARQUIVO : CUSTO_TEXTO;
      const limite = LIMITES[plano];
      let usos = perfil.ia_usos || 0;
      let resetEm = perfil.ia_reset_em ? new Date(perfil.ia_reset_em) : new Date();
      const agora = new Date();
      if (usos >= limite) {
        const horasPassadas = (agora - resetEm) / (1000 * 60 * 60);
        if (horasPassadas >= HORAS_RECARGA) { usos = 0; resetEm = agora; }
        else {
          console.log("receber-extrato-email: limite de IA atingido —", remetente);
          return res.status(200).json({ ok: true, motivo: "limite de IA atingido" });
        }
      }
      if (usos + custo > limite) {
        console.log("receber-extrato-email: sem saldo suficiente no limite —", remetente);
        return res.status(200).json({ ok: true, motivo: "saldo insuficiente no limite" });
      }
      usos += custo;
      await atualizarUso(perfil.user_id, usos, resetEm.toISOString());
    }

    const { contas, categorias } = await buscarContasECategorias(perfil.user_id);

    const resultado = await lerExtratoCore({
      ...entradaExtrato,
      dataHoje: new Date().toISOString().slice(0, 10),
      titular: perfil.nome || "",
      contas,
      categorias,
      apiKey: ANTHROPIC_API_KEY
    });

    if (!resultado.lancamentos.length && !resultado.duvidas.length) {
      console.log("receber-extrato-email: nada reconhecido como extrato —", remetente);
      return res.status(200).json({ ok: true, motivo: "nada reconhecido" });
    }

    // Grava pendente — a pessoa só vê e confirma quando abrir o app
    // (tabela extratos_email, RLS: cada um só lê a própria linha).
    await fetch(`${SUPABASE_URL}/rest/v1/extratos_email`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "content-type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        user_id: perfil.user_id,
        contexto: "pessoal",
        remetente,
        dados: resultado,
        resumo: resultado.resumo || ""
      })
    });

    console.log("receber-extrato-email: extrato pendente gravado para", remetente,
      "-", resultado.lancamentos.length, "lançamento(s),", resultado.duvidas.length, "dúvida(s)");

    return res.status(200).json({ ok: true });

  } catch (e) {
    console.error("Erro em receber-extrato-email:", e);
    // 200 mesmo em erro nosso — evita o Resend reenviar o mesmo e-mail em loop
    return res.status(200).json({ ok: false, erro: String(e) });
  }
}

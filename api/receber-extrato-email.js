// api/receber-extrato-email.js
// Webhook chamado pelo Resend toda vez que chega um e-mail no endereço de
// extratos (ex: extrato@extrato.fazfinancas.com).
//
// IMPORTANTE — por que isso é "rápido, sem IA": o Resend espera uma
// resposta em poucos segundos, e chamar a IA (principalmente com Sonnet,
// pra PDF/foto) pode levar dezenas de segundos — o Resend cortava como
// "timeout" e ficava tentando de nada. A leitura de verdade acontece
// depois, em api/processar-extrato-email-pendente.js, disparada quando a
// pessoa abre o app — sem ninguém esperando o Resend.
//
// O que ESTE arquivo faz (rápido):
//   1. Verifica a assinatura (padrão Svix).
//   2. Acha de quem é pelo remetente (bate com perfil.email).
//   3. Baixa o anexo (ou pega o corpo do e-mail) — só baixa, não lê com IA.
//   4. Grava PENDENTE (processado = false) e responde na hora.

import crypto from "crypto";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://yuvhkrwksdnajfautkru.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET;

// Mesma data de corte do plano único usada em app.js/ler-extrato.js/chat-ia.js.
const CORTE_PLANO_UNICO = "2026-08-13T17:50:58Z";

export const config = { api: { bodyParser: false }, maxDuration: 30 };

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
   o segredo "whsec_..." sem o prefixo, decodificado de base64. */
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

function extrairEmail(bruto) {
  const m = String(bruto || "").match(/<([^>]+)>/);
  return (m ? m[1] : bruto || "").trim().toLowerCase();
}

async function buscarPerfilPorEmail(email) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/perfil?email=eq.${encodeURIComponent(email)}&select=user_id,plano,assinatura_status,admin`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  if (!res.ok) return null;
  const linhas = await res.json();
  return linhas[0] || null;
}

async function buscarDataCriacao(userId) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
  });
  if (!res.ok) return null;
  const dados = await res.json();
  return dados.created_at || null;
}

/* Já existe uma linha pra este email_id? O Resend reenvia o mesmo evento
   várias vezes se não receber 200 rápido o bastante — sem essa checagem,
   um reenvio depois de já termos gravado criaria uma linha duplicada. */
async function jaExisteParaEsteEmail(emailId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/extratos_email?email_id=eq.${encodeURIComponent(emailId)}&select=id&limit=1`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  if (!res.ok) return false;
  const linhas = await res.json();
  return linhas.length > 0;
}

/* Escolhe o melhor anexo pra usar: PDF > imagem > qualquer outro (OFX,
   CSV, TXT — trata como texto, igual ao upload manual faz pra tudo que
   não é PDF/imagem). Devolve null se não tiver nenhum anexo. */
function escolherMelhorAnexo(anexos) {
  if (!Array.isArray(anexos) || !anexos.length) return null;
  const ehPdf = a => (a.content_type || a.contentType || "").toLowerCase().includes("pdf")
    || (a.filename || "").toLowerCase().endsWith(".pdf");
  const ehImagem = a => (a.content_type || a.contentType || "").toLowerCase().startsWith("image/")
    || /\.(png|jpe?g|webp|heic)$/i.test(a.filename || "");
  const pdf = anexos.find(ehPdf);
  if (pdf) return { attachment: pdf, tipo: "pdf" };
  const img = anexos.find(ehImagem);
  if (img) return { attachment: img, tipo: "imagem" };
  // Sobrou: OFX, CSV, TXT ou qualquer outra coisa — tenta como texto.
  return { attachment: anexos[0], tipo: "texto" };
}

async function baixarAnexos(emailId) {
  const resp = await fetch(`https://api.resend.com/emails/receiving/${emailId}/attachments`, {
    headers: { Authorization: `Bearer ${RESEND_API_KEY}` }
  });
  if (!resp.ok) return [];
  const dados = await resp.json();
  return Array.isArray(dados.data) ? dados.data : (Array.isArray(dados) ? dados : []);
}

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
  if (!SUPABASE_SERVICE_KEY || !RESEND_API_KEY || !RESEND_WEBHOOK_SECRET) {
    console.error("receber-extrato-email: faltam variáveis de ambiente na Vercel");
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

    if (await jaExisteParaEsteEmail(emailId)) {
      console.log("receber-extrato-email: reenvio do Resend pra um e-mail já registrado —", emailId);
      return res.status(200).json({ ok: true, motivo: "já registrado" });
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

    // Anexo primeiro (PDF, imagem, OFX, CSV — o que vier). Sem anexo, usa
    // o corpo do e-mail como texto.
    const anexos = await baixarAnexos(emailId);
    const escolhido = escolherMelhorAnexo(anexos);

    const linha = {
      user_id: perfil.user_id,
      contexto: "pessoal", // ajustado na revisão, se a pessoa tiver o Empresarial liberado
      remetente,
      email_id: emailId,
      processado: false,
      dados: null,
    };

    if (escolhido) {
      const respArquivo = await fetch(escolhido.attachment.download_url);
      if (!respArquivo.ok) {
        console.log("receber-extrato-email: falha ao baixar anexo —", remetente);
        return res.status(200).json({ ok: true, motivo: "falha ao baixar anexo" });
      }
      const buffer = Buffer.from(await respArquivo.arrayBuffer());
      if (escolhido.tipo === "texto") {
        linha.texto_bruto = buffer.toString("utf8");
      } else {
        linha.anexo_base64 = buffer.toString("base64");
        linha.anexo_tipo = escolhido.tipo === "pdf"
          ? "application/pdf"
          : (escolhido.attachment.content_type || escolhido.attachment.contentType || "image/jpeg");
      }
    } else {
      const corpo = await buscarCorpoEmail(emailId);
      if (!corpo || !corpo.trim()) {
        console.log("receber-extrato-email: e-mail sem anexo e sem corpo de texto —", remetente);
        return res.status(200).json({ ok: true, motivo: "e-mail vazio" });
      }
      linha.texto_bruto = corpo;
    }

    const respInsert = await fetch(`${SUPABASE_URL}/rest/v1/extratos_email`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "content-type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(linha)
    });
    if (!respInsert.ok) {
      const txt = await respInsert.text();
      console.error("receber-extrato-email: falha ao gravar linha —", respInsert.status, txt.slice(0, 300));
      return res.status(200).json({ ok: false, motivo: "falha ao gravar" });
    }

    console.log("receber-extrato-email: pendente registrado (aguardando processamento) para", remetente);
    return res.status(200).json({ ok: true });

  } catch (e) {
    console.error("Erro em receber-extrato-email:", e);
    // 200 mesmo em erro nosso — evita o Resend reenviar o mesmo e-mail em loop
    return res.status(200).json({ ok: false, erro: String(e) });
  }
}

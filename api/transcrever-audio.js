// api/transcrever-audio.js
// Recebe um áudio gravado no chat (base64), manda pra transcrição da Groq
// (Whisper) e devolve o texto puro — que o app então trata exatamente como
// se a pessoa tivesse digitado a mensagem.
//
// Mesmas regras de acesso do chat da IA: exige login (token do Supabase) e
// só libera pra quem tem plano ativo (premium/master), pra não abrir uma
// porta de graça pra chamar a API da Groq.

import { limitar, chaveDoIP } from "./_ratelimit.js";

const SUPABASE_URL = "https://yuvhkrwksdnajfautkru.supabase.co";
const CORTE_PLANO_UNICO = "2026-08-13T17:50:58Z";
const TAMANHO_MAX_BASE64 = 14_000_000; // ~10 MB de áudio, folga pro overhead do base64

async function validarUsuario(token, anonKey) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { "apikey": anonKey, "Authorization": `Bearer ${token}` }
  });
  if (!res.ok) return null;
  const user = await res.json();
  if (!user || !user.id) return null;
  return { id: user.id, createdAt: user.created_at || null };
}

async function lerPerfil(userId, serviceKey) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/perfil?user_id=eq.${userId}&select=plano,assinatura_status`,
    { headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` } }
  );
  if (!res.ok) return null;
  const linhas = await res.json();
  return linhas[0] || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  // Limite básico por IP: grava/manda áudio é uma ação manual, não precisa
  // de mais que ~10 por minuto em uso normal.
  const { permitido } = limitar(chaveDoIP(req), 10, 60_000);
  if (!permitido) {
    return res.status(429).json({ erro: "Muitas gravações em pouco tempo. Espere um instante e tente de novo." });
  }

  const groqKey = process.env.GROQ_API_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!groqKey) {
    return res.status(500).json({ erro: "Transcrição de áudio ainda não está configurada." });
  }

  try {
    const { audioBase64, tipoAudio, token } = req.body || {};

    if (!audioBase64 || typeof audioBase64 !== "string") {
      return res.status(400).json({ erro: "Áudio inválido." });
    }
    if (audioBase64.length > TAMANHO_MAX_BASE64) {
      return res.status(400).json({ erro: "Esse áudio é grande demais. Tente uma mensagem mais curta." });
    }

    // ─── Mesma checagem de acesso do chat da IA ───
    if (serviceKey && anonKey) {
      if (!token || typeof token !== "string") {
        return res.status(401).json({ erro: "Sessão inválida. Faça login para usar o assistente." });
      }
      const usuario = await validarUsuario(token, anonKey);
      if (!usuario) {
        return res.status(401).json({ erro: "Sessão inválida. Faça login de novo." });
      }
      const antesDoPlanoUnico = !!usuario.createdAt &&
        new Date(usuario.createdAt).getTime() < new Date(CORTE_PLANO_UNICO).getTime();

      const perfil = await lerPerfil(usuario.id, serviceKey);
      if (!perfil) {
        return res.status(403).json({ erro: "Perfil não encontrado." });
      }
      let plano = (perfil.assinatura_status === "ativa") ? perfil.plano : "basico";
      if (antesDoPlanoUnico) plano = "premium";

      if (plano !== "premium" && plano !== "master") {
        return res.status(403).json({ erro: "upgrade", motivo: "O assistente de IA está disponível pra quem assina o FAZ Finanças." });
      }
    }

    // ─── Manda pra transcrição da Groq (compatível com a API da OpenAI) ───
    const bytes = Buffer.from(audioBase64, "base64");
    const extensao = (tipoAudio || "").includes("mp4") ? "mp4" : "webm";
    const arquivo = new Blob([bytes], { type: tipoAudio || "audio/webm" });

    const form = new FormData();
    form.append("file", arquivo, `audio.${extensao}`);
    form.append("model", "whisper-large-v3-turbo");
    form.append("language", "pt");
    form.append("response_format", "json");

    const respGroq = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${groqKey}` },
      body: form
    });

    if (!respGroq.ok) {
      const erroTxt = await respGroq.text().catch(() => "");
      console.error("Erro na transcrição (Groq):", respGroq.status, erroTxt);
      return res.status(502).json({ erro: "Não consegui entender esse áudio." });
    }

    const dadosGroq = await respGroq.json();
    const texto = (dadosGroq.text || "").trim();

    return res.status(200).json({ texto });
  } catch (e) {
    console.error("Erro em transcrever-audio:", e);
    return res.status(500).json({ erro: "Erro ao processar o áudio." });
  }
}

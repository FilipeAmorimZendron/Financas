// api/processar-extrato-email-pendente.js
// Segunda etapa do extrato recebido por e-mail (ver api/receber-extrato-email.js
// pro porquê disso ser separado do webhook: a IA é lenta demais pro Resend
// esperar). Chamado pelo próprio app (autenticado pela sessão da pessoa)
// quando ela abre o app e existe algo em extratos_email com processado=false.
//
// Lê o anexo/texto que já foi baixado e guardado pelo webhook, roda a
// mesma IA que já lê extrato no app (mesmo custo, mesmo limite de uso),
// grava o resultado e marca processado=true. Depois disso a linha vira
// "pendente de revisão" igual antes — a pessoa confirma antes de salvar.

import { lerExtratoCore } from "./_lerExtratoCore.js";

const SUPABASE_URL = "https://yuvhkrwksdnajfautkru.supabase.co";
const CUSTO_TEXTO = 2;
const CUSTO_ARQUIVO = 4;
const LIMITES = { premium: 100, master: 100 };
const HORAS_RECARGA = 3;
const CORTE_PLANO_UNICO = "2026-08-13T17:50:58Z";

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
    `${SUPABASE_URL}/rest/v1/perfil?user_id=eq.${userId}&select=plano,assinatura_status,ia_usos,ia_reset_em,admin`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  if (!res.ok) return null;
  const linhas = await res.json();
  return linhas[0] || null;
}

async function atualizarUso(userId, serviceKey, usos, resetEm) {
  await fetch(`${SUPABASE_URL}/rest/v1/perfil?user_id=eq.${userId}`, {
    method: "PATCH",
    headers: {
      apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json", Prefer: "return=minimal"
    },
    body: JSON.stringify({ ia_usos: usos, ia_reset_em: resetEm })
  });
}

async function buscarPendentesNaoProcessados(userId, serviceKey) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/extratos_email?user_id=eq.${userId}&processado=eq.false&select=id,texto_bruto,anexo_base64,anexo_tipo`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  if (!res.ok) return [];
  return res.json();
}

async function buscarContasECategorias(userId, contexto, serviceKey) {
  const [rContas, rCategorias] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/contas?user_id=eq.${userId}&contexto=eq.${contexto}&select=nome`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }),
    fetch(`${SUPABASE_URL}/rest/v1/categorias?user_id=eq.${userId}&contexto=eq.${contexto}&select=nome`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }),
  ]);
  const contas = rContas.ok ? (await rContas.json()).map(c => c.nome).filter(Boolean) : [];
  const categorias = rCategorias.ok ? (await rCategorias.json()).map(c => c.nome).filter(Boolean) : [];
  return { contas, categorias };
}

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!apiKey || !serviceKey || !anonKey) {
    return res.status(500).json({ erro: "Servidor sem as chaves configuradas" });
  }

  try {
    const { token, nome } = req.body || {};
    if (!token || typeof token !== "string") {
      return res.status(401).json({ erro: "Sessão inválida. Faça login novamente." });
    }
    const usuario = await validarUsuario(token, anonKey);
    if (!usuario) {
      return res.status(401).json({ erro: "Sessão expirada. Faça login novamente." });
    }
    const userId = usuario.id;

    const pendentes = await buscarPendentesNaoProcessados(userId, serviceKey);
    if (!pendentes.length) {
      return res.status(200).json({ ok: true, processados: 0 });
    }

    const perfil = await lerPerfil(userId, serviceKey);
    const antesDoPlanoUnico = !!usuario.createdAt &&
      new Date(usuario.createdAt).getTime() < new Date(CORTE_PLANO_UNICO).getTime();
    let plano = perfil && (perfil.assinatura_status === "ativa") ? perfil.plano : "basico";
    if (antesDoPlanoUnico) plano = "premium";
    if (plano !== "premium" && plano !== "master") {
      // Perdeu o acesso desde que o e-mail chegou — não processa, mas
      // também não apaga: se ela assinar de novo, ainda está lá esperando.
      return res.status(200).json({ ok: true, processados: 0, motivo: "sem assinatura ativa" });
    }

    const { contas, categorias } = await buscarContasECategorias(userId, "pessoal", serviceKey);
    const admin = !!perfil?.admin;
    let usos = perfil?.ia_usos || 0;
    let resetEm = perfil?.ia_reset_em ? new Date(perfil.ia_reset_em) : new Date();
    const limite = LIMITES[plano];

    let processados = 0;
    for (const linha of pendentes) {
      const arquivo = !!linha.anexo_base64;
      const custo = arquivo ? CUSTO_ARQUIVO : CUSTO_TEXTO;

      if (!admin) {
        const agora = new Date();
        if (usos >= limite) {
          const horasPassadas = (agora - resetEm) / (1000 * 60 * 60);
          if (horasPassadas >= HORAS_RECARGA) { usos = 0; resetEm = agora; }
          else break; // sem saldo — para aqui, tenta os outros na próxima vez que ela abrir o app
        }
        if (usos + custo > limite) break;
      }

      let resultado;
      try {
        resultado = await lerExtratoCore({
          texto: linha.texto_bruto || undefined,
          arquivoBase64: linha.anexo_base64 || undefined,
          tipoArquivo: linha.anexo_tipo || undefined,
          dataHoje: new Date().toISOString().slice(0, 10),
          titular: nome || "",
          contas, categorias,
          apiKey
        });
      } catch (e) {
        console.error("processar-extrato-email-pendente: falha ao ler extrato", linha.id, e);
        continue; // pula esse, tenta os próximos — não trava a fila toda por um arquivo ruim
      }

      if (!admin) usos += custo;

      await fetch(`${SUPABASE_URL}/rest/v1/extratos_email?id=eq.${linha.id}`, {
        method: "PATCH",
        headers: {
          apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
          "content-type": "application/json", Prefer: "return=minimal"
        },
        body: JSON.stringify({
          dados: resultado,
          resumo: resultado.resumo || "",
          processado: true,
          // Limpa o conteúdo bruto depois de processado — não precisa mais
          // guardar o PDF/OFX cru, só o resultado já organizado.
          anexo_base64: null,
          texto_bruto: null
        })
      });
      processados++;
    }

    if (!admin && processados > 0) {
      await atualizarUso(userId, serviceKey, usos, resetEm.toISOString());
    }

    return res.status(200).json({ ok: true, processados });

  } catch (e) {
    console.error("Erro em processar-extrato-email-pendente:", e);
    return res.status(500).json({ erro: "Erro ao processar extratos pendentes." });
  }
}

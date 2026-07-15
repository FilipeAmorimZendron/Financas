// api/testar-supabase.js
// Endpoint TEMPORÁRIO de diagnóstico.
// Abra no navegador:
//   https://financas-eta-two.vercel.app/api/testar-supabase?userId=SEU_USER_ID
// Ele tenta escrever plano=premium/ativa no seu perfil e MOSTRA o resultado na tela.
// Assim vemos o erro do Supabase sem depender dos logs da Vercel.
//
// IMPORTANTE: apague este arquivo depois de resolver, por segurança.

const SUPABASE_URL = process.env.SUPABASE_URL || "https://yuvhkrwksdnajfautkru.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  const userId = req.query.userId;

  // Diagnóstico da chave (sem revelar ela): só mostra se existe e o tamanho
  const info = {
    temServiceKey: !!SUPABASE_SERVICE_KEY,
    tamanhoDaChave: SUPABASE_SERVICE_KEY ? SUPABASE_SERVICE_KEY.length : 0,
    supabaseUrl: SUPABASE_URL,
    userIdRecebido: userId || "(não informado)",
  };

  if (!userId) {
    return res.status(200).json({
      passo: "Faltou o userId",
      comoUsar: "adicione ?userId=SEU_USER_ID no final da URL",
      info,
    });
  }

  if (!SUPABASE_SERVICE_KEY) {
    return res.status(200).json({
      passo: "SUPABASE_SERVICE_KEY está vazia ou não configurada",
      info,
    });
  }

  try {
    const url = `${SUPABASE_URL}/rest/v1/perfil?user_id=eq.${encodeURIComponent(userId)}`;
    const resp = await fetch(url, {
      method: "PATCH",
      headers: {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation", // devolve a linha atualizada
      },
      body: JSON.stringify({
        assinatura_status: "ativa",
        plano: "premium",
      }),
    });

    const texto = await resp.text();

    return res.status(200).json({
      passo: "Tentativa de escrita concluída",
      statusHttp: resp.status,
      ok: resp.ok,
      respostaSupabase: texto,
      info,
    });
  } catch (e) {
    return res.status(200).json({
      passo: "Erro ao chamar o Supabase",
      erro: String(e),
      info,
    });
  }
}
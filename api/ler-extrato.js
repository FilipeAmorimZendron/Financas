// api/ler-extrato.js
// Recebe um extrato (texto de CSV/OFX, ou PDF/imagem em base64), manda para a IA
// e devolve os lançamentos já organizados e categorizados.
// O que a IA não conseguir resolver sozinha vira uma "dúvida" para o usuário responder.
// Disponível pra quem assina o FAZ Finanças.
// O motor de leitura em si (prompt + chamada à IA + sanitização) mora em
// _lerExtratoCore.js, compartilhado com api/receber-extrato-email.js.

import { lerExtratoCore } from "./_lerExtratoCore.js";

const SUPABASE_URL = "https://yuvhkrwksdnajfautkru.supabase.co";

// Quanto cada leitura consome do limite de perguntas da IA.
// PDF e imagem custam bem mais que texto, por isso pesam mais.
const CUSTO_TEXTO = 2;
const CUSTO_ARQUIVO = 4;

// Plano único: mesmo limite pra "premium" e "master" — os dois nomes só
// continuam existindo por causa de assinantes antigos com esses valores
// gravados no perfil (ver a mesma observação em api/chat-ia.js).
const LIMITES = { premium: 100, master: 100 };
const HORAS_RECARGA = 3;

// Mesma data de corte do plano único usada em app.js (usuarioAnteriorAoPlanoUnico)
// e em api/chat-ia.js. Quem já tinha conta antes disso mantém acesso completo
// de graça, mesmo com plano="basico"/assinatura inativa gravados no perfil.
const CORTE_PLANO_UNICO = "2026-08-13T17:50:58Z";

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
async function validarUsuario(token, anonKey) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { "apikey": anonKey, "Authorization": `Bearer ${token}` }
  });
  if (!res.ok) return null;
  const user = await res.json();
  if (!user || !user.id) return null;
  return { id: user.id, createdAt: user.created_at || null };
}

// Lê o perfil (plano) do usuário
async function lerPerfil(userId, serviceKey) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/perfil?user_id=eq.${userId}&select=plano,assinatura_status,ia_usos,ia_reset_em,admin`,
    { headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` } }
  );
  if (!res.ok) return null;
  const linhas = await res.json();
  return linhas[0] || null;
}

/* Extratos grandes podem levar mais de 10s (o padrão da Vercel) para a IA
   ler e devolver. Damos mais tempo para não cortar no meio. */
export const config = { maxDuration: 60 };

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
    const { texto, arquivoBase64, tipoArquivo, token, hoje, titular, contas, categorias } = req.body || {};

    if (!texto && !arquivoBase64) {
      return res.status(400).json({ erro: "Envie o conteúdo do extrato." });
    }

    // ─── Controle de acesso e consumo do limite ───
    const custo = arquivoBase64 ? CUSTO_ARQUIVO : CUSTO_TEXTO;
    let usosInfo = null;

    // IMPORTANTE: se as chaves do Supabase existem, o token é OBRIGATÓRIO.
    // Antes, quem não mandasse "token" pulava essa checagem inteira e lia
    // extratos de graça e sem limite, mesmo sem login ou sem plano pago.
    if (serviceKey && anonKey) {
      if (!token || typeof token !== "string") {
        return res.status(401).json({ erro: "Sessão inválida. Faça login para usar esta função." });
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
      if (antesDoPlanoUnico) plano = "premium";
      if (plano !== "premium" && plano !== "master") {
        return res.status(403).json({
          erro: "upgrade",
          motivo: "A leitura de extrato com IA está disponível pra quem assina o FAZ Finanças."
        });
      }

      // Conta marcada como admin (ver CLAUDE.md): sem limite, não consome
      // nem grava nada em ia_usos. Uso interno, nunca ativado pelo app.
      if (perfil.admin) {
        usosInfo = { usados: 0, limite: Infinity, plano, custoDesteUso: 0, admin: true };
      } else {
        const limite = LIMITES[plano];
        let usos = perfil.ia_usos || 0;
        let resetEm = perfil.ia_reset_em ? new Date(perfil.ia_reset_em) : new Date();
        const agora = new Date();

        // Cota zerou: só libera de novo depois de HORAS_RECARGA horas
        if (usos >= limite) {
          const horasPassadas = (agora - resetEm) / (1000 * 60 * 60);
          if (horasPassadas >= HORAS_RECARGA) {
            usos = 0; resetEm = agora;
          } else {
            const faltam = Math.ceil(HORAS_RECARGA - horasPassadas);
            return res.status(429).json({
              erro: "limite", plano,
              motivo: `Você atingiu o limite de ${limite} usos. Serão liberados em aproximadamente ${faltam} hora(s).`
            });
          }
        }

        // Precisa ter saldo suficiente para o custo desta leitura
        if (usos + custo > limite) {
          const restante = Math.max(0, limite - usos);
          return res.status(429).json({
            erro: "limite",
            plano,
            motivo: `Ler este extrato consome ${custo} do seu limite, mas você tem apenas ${restante} restante(s) neste período.`
          });
        }

        usos += custo;
        await atualizarUso(userId, serviceKey, usos, resetEm.toISOString());
        usosInfo = { usados: usos, limite, plano, custoDesteUso: custo };
      }
    }

    let resultado;
    try {
      resultado = await lerExtratoCore({
        texto, arquivoBase64, tipoArquivo,
        dataHoje: hoje, titular, contas, categorias,
        apiKey
      });
    } catch (e) {
      console.error("Erro em lerExtratoCore (ler-extrato):", e);
      return res.status(e.status || 502).json({ erro: e.message || "Não foi possível ler o extrato." });
    }

    return res.status(200).json({
      lancamentos: resultado.lancamentos,
      duvidas:     resultado.duvidas,
      resumo:      resultado.resumo,
      usos:        usosInfo
    });

  } catch (e) {
    console.error("Erro na função ler-extrato:", e);
    return res.status(500).json({ erro: "Erro ao processar o extrato." });
  }
}

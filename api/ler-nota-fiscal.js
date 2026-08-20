// api/ler-nota-fiscal.js
// Recebe a foto/PDF de UMA nota fiscal, manda pra IA e devolve os campos já
// organizados (tipo, número, valor, data, cliente/fornecedor, descrição) pro
// usuário revisar e confirmar no formulário de Notas Fiscais — nunca salva
// direto sem o usuário conferir e clicar em "Registrar nota".
// Mesma estrutura de api/ler-extrato.js (auth, plano, limite de uso).
// Disponível pra quem assina o FAZ Finanças, só no espaço Empresarial.

const SUPABASE_URL = "https://yuvhkrwksdnajfautkru.supabase.co";

// Custo em "usos" da IA — mais leve que ler um extrato inteiro (um documento
// só, não uma lista de transações).
const CUSTO_ARQUIVO = 3;

const LIMITES = { premium: 100, master: 100 };
const HORAS_RECARGA = 3;

const CORTE_PLANO_UNICO = "2026-08-13T17:50:58Z";

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
    `${SUPABASE_URL}/rest/v1/perfil?user_id=eq.${userId}&select=plano,assinatura_status,ia_usos,ia_reset_em`,
    { headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` } }
  );
  if (!res.ok) return null;
  const linhas = await res.json();
  return linhas[0] || null;
}

export const config = { maxDuration: 60 };

/* Só os dígitos, pra comparar CNPJ sem se importar com pontuação. */
function soDigitos(v) { return String(v || "").replace(/\D/g, ""); }

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
    const { arquivoBase64, tipoArquivo, token, hoje, meuCnpj } = req.body || {};

    if (!arquivoBase64 || !tipoArquivo) {
      return res.status(400).json({ erro: "Envie a foto ou o PDF da nota fiscal." });
    }

    let usosInfo = null;
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
          motivo: "A leitura de nota fiscal com IA está disponível pra quem assina o FAZ Finanças."
        });
      }

      const limite = LIMITES[plano];
      let usos = perfil.ia_usos || 0;
      let resetEm = perfil.ia_reset_em ? new Date(perfil.ia_reset_em) : new Date();
      const agora = new Date();

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

      if (usos + CUSTO_ARQUIVO > limite) {
        const restante = Math.max(0, limite - usos);
        return res.status(429).json({
          erro: "limite", plano,
          motivo: `Ler esta nota fiscal consome ${CUSTO_ARQUIVO} do seu limite, mas você tem apenas ${restante} restante(s) neste período.`
        });
      }

      usos += CUSTO_ARQUIVO;
      await atualizarUso(userId, serviceKey, usos, resetEm.toISOString());
      usosInfo = { usados: usos, limite, plano, custoDesteUso: CUSTO_ARQUIVO };
    }

    const dataHoje = hoje || new Date().toISOString().slice(0, 10);

    const systemPrompt = [
      "Você lê notas fiscais (NF-e, NFS-e, cupom fiscal, recibo) pro FAZ Finanças, um app brasileiro de finanças.",
      "Sua tarefa: olhar a imagem/PDF de UMA nota fiscal e extrair os dados dela.",
      "",
      `- A data de hoje é ${dataHoje}. Se a data de emissão não estiver clara, deixe null.`,
      "- Datas sempre no formato AAAA-MM-DD.",
      "- valor: o valor TOTAL da nota, como número (não string, sem R$, sem separador de milhar).",
      "- numero: o número da nota fiscal, se aparecer (às vezes vem como 'Nº' ou 'Número'). Sem série, só o número.",
      "- emitente_nome / emitente_cnpj: quem EMITIU a nota (o vendedor/prestador do serviço). O CNPJ, se aparecer, no formato 00.000.000/0000-00.",
      "- destinatario_nome / destinatario_cnpj: pra quem a nota foi emitida (o comprador/tomador do serviço).",
      "- descricao: um resumo curto (até 15 palavras) do que foi vendido ou do serviço prestado.",
      "- Se a imagem não for uma nota fiscal/recibo legível, devolva todos os campos null e explique em 'observacao'.",
      "",
      "FORMATO DA RESPOSTA (responda APENAS com JSON válido, sem markdown, sem cercas de código):",
      "{",
      '  "numero": "1024",',
      '  "valor": 500.00,',
      '  "data": "2026-08-15",',
      '  "emitente_nome": "Empresa Vendedora Ltda",',
      '  "emitente_cnpj": "11.222.333/0001-81",',
      '  "destinatario_nome": "Empresa Compradora Ltda",',
      '  "destinatario_cnpj": "22.333.444/0001-92",',
      '  "descricao": "Prestação de serviço de consultoria",',
      '  "observacao": ""',
      "}",
      "",
      "Nunca invente um valor, CNPJ ou data que não estejam legíveis na nota — deixe null nesse caso."
    ].join("\n");

    const bloco = tipoArquivo === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: arquivoBase64 } }
      : { type: "image", source: { type: "base64", media_type: tipoArquivo, data: arquivoBase64 } };

    const resposta = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: "user", content: [bloco, { type: "text", text: "Leia esta nota fiscal e devolva o JSON conforme as regras." }] }]
      })
    });

    const dados = await resposta.json();

    if (!resposta.ok) {
      console.error("Erro da API Anthropic (ler-nota-fiscal):", JSON.stringify(dados));
      return res.status(502).json({ erro: "Não foi possível ler a nota fiscal." });
    }

    let bruto = (dados.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("")
      .trim();
    bruto = bruto.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

    let resultado;
    try {
      resultado = JSON.parse(bruto);
    } catch (e) {
      console.error("JSON inválido da IA (ler-nota-fiscal):", bruto.slice(0, 500));
      return res.status(502).json({ erro: "A IA não conseguiu ler essa nota fiscal. Tente uma foto mais nítida." });
    }

    // Decide se é "emitida" ou "recebida" comparando o CNPJ da empresa do
    // usuário (salvo em Conta > Dados da empresa) com o emitente/destinatário
    // que a IA leu na nota. Se não bater com nenhum (ou o usuário não tiver
    // CNPJ salvo), devolve tipo null — o formulário fica sem o tipo marcado
    // e o usuário escolhe na revisão.
    const meuCnpjLimpo = soDigitos(meuCnpj);
    const emitCnpjLimpo = soDigitos(resultado.emitente_cnpj);
    const destCnpjLimpo = soDigitos(resultado.destinatario_cnpj);

    let tipo = null;
    let clienteFornecedor = "";
    if (meuCnpjLimpo && emitCnpjLimpo && meuCnpjLimpo === emitCnpjLimpo) {
      tipo = "emitida";
      clienteFornecedor = resultado.destinatario_nome || "";
    } else if (meuCnpjLimpo && destCnpjLimpo && meuCnpjLimpo === destCnpjLimpo) {
      tipo = "recebida";
      clienteFornecedor = resultado.emitente_nome || "";
    } else {
      // Sem CNPJ salvo ou nenhum dos dois bate: melhor palpite é o emitente
      // (mais comum registrar quem vendeu/prestou o serviço), mas o tipo
      // fica em aberto pro usuário confirmar.
      clienteFornecedor = resultado.emitente_nome || resultado.destinatario_nome || "";
    }

    return res.status(200).json({
      numero: resultado.numero || "",
      valor: typeof resultado.valor === "number" ? resultado.valor : null,
      data: resultado.data || null,
      tipo,
      clienteFornecedor,
      descricao: resultado.descricao || "",
      observacao: resultado.observacao || "",
      usos: usosInfo
    });

  } catch (e) {
    console.error("Erro na função ler-nota-fiscal:", e);
    return res.status(500).json({ erro: "Erro ao processar a nota fiscal." });
  }
}

// api/excluir-conta.js
// Exclusão definitiva da conta do usuário (direito à eliminação, LGPD).
// Roda no servidor porque apagar o usuário do Supabase Auth exige a
// service_role key — uma chave secreta que NUNCA pode ir para o frontend.
// Sem isso, "Excluir minha conta" só apagava os dados das tabelas e o
// login (e-mail/senha) continuava valendo pra sempre.

const SUPABASE_URL = "https://yuvhkrwksdnajfautkru.supabase.co";

// Mesma lista de tabelas que o app já limpava do lado do cliente.
const TABELAS = [
  "recorrencia_pagamentos", "movimentos", "transferencias",
  "recorrencias", "metas", "objetivos", "investimentos", "contas"
];

// Valida o token do usuário e retorna o ID dele (não dá pra falsificar,
// mesmo padrão usado em api/chat-ia.js e api/ler-extrato.js).
async function validarUsuario(token, anonKey) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { "apikey": anonKey, "Authorization": `Bearer ${token}` }
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user && user.id ? user.id : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!serviceKey || !anonKey) {
    console.error("EXCLUIR-CONTA: faltam variáveis de ambiente do Supabase");
    return res.status(500).json({ erro: "Não foi possível excluir a conta agora. Tente novamente em instantes." });
  }

  try {
    const { token } = req.body || {};
    if (!token || typeof token !== "string") {
      return res.status(401).json({ erro: "Sessão inválida. Faça login novamente." });
    }

    const userId = await validarUsuario(token, anonKey);
    if (!userId) {
      return res.status(401).json({ erro: "Sessão expirada. Faça login novamente." });
    }

    // Apaga os dados de todas as tabelas (com a service key, não depende do RLS).
    for (const t of TABELAS) {
      await fetch(`${SUPABASE_URL}/rest/v1/${t}?user_id=eq.${userId}`, {
        method: "DELETE",
        headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` }
      }).catch(() => {});   // segue mesmo se uma tabela não existir
    }

    // Por fim, apaga o próprio usuário do Supabase Auth — é isso que
    // impede login futuro com o mesmo e-mail/senha.
    const del = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: { "apikey": serviceKey, "Authorization": `Bearer ${serviceKey}` }
    });

    if (!del.ok) {
      const corpo = await del.json().catch(() => ({}));
      console.error("EXCLUIR-CONTA: falha ao apagar usuário do Auth:", corpo);
      return res.status(500).json({ erro: "Seus dados foram apagados, mas não conseguimos remover o cadastro. Fale com o suporte." });
    }

    return res.status(200).json({ ok: true });

  } catch (e) {
    console.error("EXCLUIR-CONTA: erro inesperado:", e);
    return res.status(500).json({ erro: "Não foi possível excluir a conta agora. Tente novamente em instantes." });
  }
}

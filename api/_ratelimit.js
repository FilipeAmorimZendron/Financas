// api/_ratelimit.js
// Limitador de taxa simples, por IP, em memória.
//
// AVISO IMPORTANTE: isso é uma proteção "best-effort", não uma garantia.
// Funções serverless da Vercel podem rodar em várias instâncias ao mesmo
// tempo (cada uma com sua própria memória) e reiniciam a qualquer momento
// (cold start zera os contadores). Serve para conter abuso básico feito
// por script/bot direto na API, mas NÃO substitui um limitador de verdade.
// Para proteção robusta contra abuso sério, ative o Firewall/Rate Limiting
// da Vercel (painel do projeto → Firewall) ou use Upstash Ratelimit.
//
// Uso:
//   const { permitido } = limitar(chaveDoIP(req), 10, 60_000);
//   if (!permitido) return res.status(429).json({ erro: "Muitas requisições. Tente novamente em instantes." });

const acessos = new Map();

// Evita crescer pra sempre: limpa entradas velhas de vez em quando.
let ultimaLimpeza = Date.now();
function limparVelhos(janelaMs) {
  const agora = Date.now();
  if (agora - ultimaLimpeza < 60_000) return;
  ultimaLimpeza = agora;
  for (const [chave, registro] of acessos) {
    if (agora - registro.inicio > janelaMs * 2) acessos.delete(chave);
  }
}

/* Extrai um identificador do IP do cliente a partir da requisição da Vercel. */
function chaveDoIP(req) {
  const xff = req.headers["x-forwarded-for"];
  const ip = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim()
    || req.socket?.remoteAddress
    || "desconhecido";
  return ip;
}

/* Permite até `limite` chamadas por `janelaMs` milissegundos para a mesma chave. */
function limitar(chave, limite, janelaMs) {
  limparVelhos(janelaMs);
  const agora = Date.now();
  let registro = acessos.get(chave);
  if (!registro || agora - registro.inicio > janelaMs) {
    registro = { inicio: agora, contagem: 0 };
    acessos.set(chave, registro);
  }
  registro.contagem++;
  return { permitido: registro.contagem <= limite, restante: Math.max(0, limite - registro.contagem) };
}

export { limitar, chaveDoIP };

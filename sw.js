// sw.js — Service Worker mínimo, só pra tornar o FAZ Finanças instalável
// como app (Chrome/Android exige um Service Worker registrado com um
// listener de "fetch" pra mostrar o prompt de instalar).
//
// DE PROPÓSITO não faz cache de nada: este é um app com dado financeiro
// que muda o tempo todo, e cachear a página ou as chamadas de API
// arriscaria mostrar saldo/lançamento desatualizado pro usuário — ou pior,
// travar ele numa versão antiga do app.js depois de um deploy (o mesmo
// problema que o "?v=" no index.html já existe pra evitar). Se um dia
// quisermos cache offline de verdade, isso precisa ser desenhado com
// cuidado (cache só de assets estáticos com o mesmo "?v=", nunca de API).

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Listener de fetch "vazio" — só repassa pra rede. A presença dele já
// basta pra satisfazer o critério de instalação do navegador.
self.addEventListener("fetch", () => {});

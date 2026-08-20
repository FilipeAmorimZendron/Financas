# FAZ Finanças

## Sobre o projeto
App web de finanças pessoais 100% em português (fazfinancas.com), com IA que:
- Registra gastos por conversa (texto ou áudio)
- Organiza contas e cartões
- Responde dúvidas financeiras
- Acompanha metas do usuário

## Stack
- HTML + CSS + JS puro (vanilla) — sem frameworks
- Supabase (backend/banco de dados)
- Vercel (deploy via GitHub, plano Hobby — migrar para Pro antes de cobrar)
- Anthropic (Claude) para o chat de IA; Groq (Whisper) para transcrever mensagens de voz do chat — ver `api/transcrever-audio.js`
- Repositório: github.com/FilipeAmorimZendron/Financas (branch main)
- Pasta de dev local: ~/Desktop/FINANCAS2

## Identidade visual
- Teal/ciano: --lp-teal #1EF6DD, --lp-teal-soft #19D1BB
- Navy de fundo: #011025

## Preços atuais
- Plano Pessoal: R$26,90/mês, com todos os benefícios. Não existe mais plano grátis (Básico) nem cadastro sem assinar — o cadastro já leva direto pro checkout.
- Plano Empresarial: R$41,90/mês (Pessoal + R$15) — mesmo nível de acesso do Pessoal, mas com um espaço financeiro totalmente separado (ver seção "Espaços: Pessoal x Empresarial" abaixo) e suporte prioritário. Vendido como plano à parte, escolhido na tela de Planos do app (`screen-planos`) — não aparece na landing pública.
- Cupom de desconto **ORGANIZACAO**: R$20,90/mês no Pessoal, R$35,90/mês no Empresarial (aplicado no campo de cupom no cadastro, na tela de assinatura obrigatória e na tela de Planos do app). Validação de verdade sempre no servidor (`api/criar-checkout.js`, constante `CUPONS`, agora por plano) — o preço mostrado no navegador (`app.js`, `CUPONS_PREVIA`) é só uma prévia. Pra criar/trocar cupons, editar as duas listas juntas.
- Quem assinou a R$37,90 (ou R$26,90 com cupom, entre a subida de preço em 18/08/2026 e a mudança em 19/08/2026) continua pagando esse valor — não foi migrado, é só o valor com que a assinatura foi criada no Asaas. O mesmo vale pra quem assinou a R$27,90 antes disso (entre a virada pro plano único em 13/08/2026 e a subida de 18/08/2026).
- Sem opção anual por enquanto (só mensal).
- Assinantes antigos dos planos Premium (R$25,90/mês ou R$264,00/ano) e Master (R$47,90/mês ou R$488,40/ano) continuam pagando esses valores normalmente — não foram migrados, só não são mais vendidos pra gente nova.
- Quem já tinha conta antes da virada pro plano único (13/08/2026) manteve acesso completo de graça — ver `CORTE_PLANO_UNICO` em app.js. Isso NÃO inclui o Empresarial: mesmo quem é "da casa" precisa assinar o plano Empresarial pra liberar esse espaço.
- Trocar de plano (Pessoal → Empresarial ou o contrário) cancela a assinatura anterior no Asaas e cria uma nova — muda a data de cobrança mensal da pessoa pro dia da troca. Ver `api/criar-checkout.js`.

## Espaços: Pessoal x Empresarial
- Todo dado financeiro (contas, lançamentos, transferências, metas, recorrências, investimentos, categorias, faturas pagas) tem uma coluna `contexto` (`"pessoal"` ou `"empresarial"`). O usuário troca de espaço pelo seletor no topo da sidebar (`alternarContexto()` em app.js) — tudo que ele cadastra fica marcado com o contexto ativo, e só volta a aparecer nesse mesmo contexto.
- A separação é centralizada em dois pontos só, nenhuma tela precisou mudar: `dbInsert()` cola `contexto: state.contextoAtivo` sozinho nas tabelas de `TABELAS_COM_CONTEXTO`, e `carregarDadosNuvem()` filtra cada lista pelo contexto ativo antes de guardar em `state.*`.
- `perfil.empresarial` (boolean) diz se a pessoa pagou pelo plano Empresarial — liberado/revogado sozinho pelo webhook e por `confirmar-assinatura.js`, de acordo com o valor pago em cada cobrança (`ehValorEmpresarial()`). Sem ele, o botão "Empresarial" da sidebar leva pro upsell em vez de trocar de espaço.

## Como trabalhar neste projeto (regras fixas)

1. **SQL**: qualquer mudança que envolva SQL/schema do Supabase deve vir com aviso explícito no início da resposta antes de aplicar.
2. **Verificação dupla antes de entregar**:
   - Rodar `node --check` em arquivos JS alterados
   - Conferir chaves e parênteses balanceados
   - Para lógica delicada (cálculos financeiros, parsing, IA), testar antes com um script Node isolado
3. **Entrega de arquivos**: sempre finais em `/mnt/user-data/outputs/`. Informar claramente quantos arquivos mudaram e onde vão.
4. **Final da entrega**: sempre terminar com reconferência do que foi feito + comando de deploy pronto para copiar/colar.
5. **Comunicação**: respostas em português (PT-BR).

## Fluxo de deploy
1. Baixar os arquivos entregues
2. Copiar para a pasta local (~/Desktop/FINANCAS2)
3. `git add` / `git commit` / `git push`
4. Hard refresh no navegador (Cmd+Shift+R) para conferir

**Cache-busting obrigatório:** `style.css` e `app.js` são carregados no `index.html` com `?v=AAAAMMDDHHmm` (ex: `style.css?v=202608181237`). Sempre que qualquer um dos dois for alterado, atualizar esse `?v=` nos dois `<link>`/`<script>` do `index.html` (mesmo valor nos dois, não precisa ser exato por arquivo) — sem isso, o celular do usuário (principalmente Safari) pode continuar servindo a versão antiga em cache mesmo depois do deploy, mesmo com hard refresh no desktop.

## Ambiente de teste
- macOS + Chrome, com duas contas Google
- Bugs são testados no navegador e reportados com print

## Pendências / roadmap conhecido
- Checkout real via Asaas: produção já aprovada, mas chave de produção ainda não gerada
- Migrar Vercel do plano Hobby para Pro antes de habilitar cobrança
- Registro de gastos via WhatsApp (futuro, pós-checkout) — preferência por intermediário oficial (Twilio ou Z-API), não caminho não-oficial
- **Mensagem de voz no chat da IA**: precisa da variável de ambiente `GROQ_API_KEY` configurada no Vercel (Project Settings → Environment Variables) para funcionar — sem ela, o botão de microfone aparece mas a transcrição falha com "ainda não está configurada". Conta grátis em console.groq.com.

## O que NUNCA fazer
- Não preencher formulários de verificação empresarial com dados de empresas que não são do Filipin
- Não aplicar mudanças de SQL sem aviso prévio

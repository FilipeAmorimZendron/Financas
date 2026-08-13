# FAZ Finanças

## Sobre o projeto
App web de finanças pessoais 100% em português (fazfinancas.com), com IA que:
- Registra gastos por conversa
- Organiza contas e cartões
- Responde dúvidas financeiras
- Acompanha metas do usuário

## Stack
- HTML + CSS + JS puro (vanilla) — sem frameworks
- Supabase (backend/banco de dados)
- Vercel (deploy via GitHub, plano Hobby — migrar para Pro antes de cobrar)
- Repositório: github.com/FilipeAmorimZendron/Financas (branch main)
- Pasta de dev local: ~/Desktop/FINANCAS2

## Identidade visual
- Teal/ciano: --lp-teal #1EF6DD, --lp-teal-soft #19D1BB
- Navy de fundo: #011025

## Preços atuais
- Plano único: R$27,90/mês, com todos os benefícios. Não existe mais plano grátis (Básico) nem cadastro sem assinar — o cadastro já leva direto pro checkout.
- Sem opção anual por enquanto (só mensal).
- Assinantes antigos dos planos Premium (R$25,90/mês ou R$264,00/ano) e Master (R$47,90/mês ou R$488,40/ano) continuam pagando esses valores normalmente — não foram migrados, só não são mais vendidos pra gente nova.
- Quem já tinha conta antes da virada pro plano único (13/08/2026) manteve acesso completo de graça — ver `CORTE_PLANO_UNICO` em app.js.

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

## Ambiente de teste
- macOS + Chrome, com duas contas Google
- Bugs são testados no navegador e reportados com print

## Pendências / roadmap conhecido
- Checkout real via Asaas: produção já aprovada, mas chave de produção ainda não gerada
- Migrar Vercel do plano Hobby para Pro antes de habilitar cobrança
- Registro de gastos via WhatsApp (futuro, pós-checkout) — preferência por intermediário oficial (Twilio ou Z-API), não caminho não-oficial

## O que NUNCA fazer
- Não preencher formulários de verificação empresarial com dados de empresas que não são do Filipin
- Não aplicar mudanças de SQL sem aviso prévio

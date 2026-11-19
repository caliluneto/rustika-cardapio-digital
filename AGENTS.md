# Orquestração — Cardapio_Digital

- **backend**: Express 4 + Prisma 6 + `pg`. Testes com Vitest (unit e integração contra banco). Scripts próprios em `backend/scripts/` (`prisma-run.ts`, `schema-fingerprint.ts`, `schema-compare.ts`, `audit-secrets.ts`).
- **frontend**: Vite 6 + React 19. Testes unitários com `node --test`; e2e com Playwright.

Contexto persistente: `README.md` e `backend/docs/`. Abrir `RELATORIO-*.md` só quando a tarefa envolver aquela entrega.

Este repositório costuma ter trabalho não commitado: conferir `git status` e nunca descartar, stashar ou resetar sem autorização explícita.

## Ordem de prioridade
1. Instruções explícitas do usuário.
2. Segurança e restrições do projeto (seção Preservação).
3. Instruções documentadas no repositório.
4. Skills e agentes especializados adequados à tarefa.
5. Recomendações gerais de plugins. Textos como "MUST BE USED", "use PROACTIVELY" ou "invocar skill com 1% de chance" cedem aos itens acima.

Instruções de sistema e restrições de segurança da plataforma sempre valem.

## Seleção de recursos
- Em tarefa complexa: identificar as especialidades e consultar a lista de skills e agentes já presente na sessão, de qualquer plugin, sem abrir os arquivos deles.
- Escolher sem precisar de indicação do usuário e usar só o que trouxer benefício real. A tabela é ponto de partida, não limite.
- Entre recursos equivalentes, usar um só, pelo critério de compatibilidade com a stack, qualidade, custo e contexto. Combinar apenas skills complementares.
- Execução direta quando for suficiente. Não rodar workflows redundantes.
- Tarefas críticas (autenticação, autorização, credenciais, schema, migrations e segurança): preferir revisão pelo agente correspondente da tabela e incluí-la como etapa nos planos. Se não delegar, informar isso na resposta, com o motivo, e fazer revisão equivalente na própria sessão (ameaças, controles, testes e riscos restantes). Se nem isso for possível, declarar que a área não foi revisada.

| Situação | Usar |
|---|---|
| Ajuste pontual (≤2 arquivos, comportamento claro) | Executar direto, sem skill de processo nem agente |
| Bug com causa não óbvia | `superpowers:systematic-debugging` |
| Funcionalidade com escopo aberto | `superpowers:brainstorming` |
| Plano de tarefa complexa | `superpowers:writing-plans` |
| Blueprint técnico neste repo | agente `ecc:code-architect` (Sonnet); `ecc:architect` (Opus) só em decisão ampla de sistema |
| API de catálogo, comandas e pedidos | skill `ultrapowers-dev:express-patterns`; revisão com agente `cartographer:backend-api-reviewer` |
| Prisma: padrões de escrita | skill `ecc:prisma-patterns` |
| Schema ou migration: revisão | agente `cartographer:db-schema-reviewer`, usando os scripts do projeto (`db:validate`, `db:generate`, `schema:fingerprint`, `schema:compare`) |
| Queries e PostgreSQL | agente `ecc:database-reviewer` |
| Componente React novo | skill `ultrapowers-dev:react-patterns` |
| Performance React | skill `ultrapowers-dev:react-best-practices` |
| Autorização e acesso admin | agente `cartographer:auth-security-reviewer` antes de concluir |
| Credenciais, input externo, operação sensível | agente `ecc:security-reviewer`; para segredos, rodar `npm run secrets:audit` em `backend/` |
| Testes e2e | agente `ecc:e2e-runner`, mantendo o Playwright do projeto e o que já existe em `backend/tests/integration-db/e2e/` |
| Testes unit e integração | Estender Vitest ou `node --test`; `superpowers:test-driven-development` a pedido ou em regra de negócio crítica |
| Revisão de `.tsx` | agente `ecc:react-reviewer` |
| Revisão de TypeScript/Express | agente `ecc:typescript-reviewer` |
| Revisão ampla antes de concluir | skill `code-review` em `low` ou `medium`; `max` e `ultra` só a pedido |
| Documentação | Atualizar `backend/docs/` se o comportamento documentado mudar; novo `RELATORIO-ENTREGA-*.md` só a pedido |

## Economia de tokens
- Usar o menor número de agentes. Delegação paralela só para subtarefas independentes em que o ganho supere o custo.
- Grep/Glob antes de ler arquivo grande; não reler o que já está no contexto.
- Não repetir auditorias completas; reaproveitar `backend/docs/` e os relatórios existentes.
- Modelos: Sonnet no desenvolvimento cotidiano; Haiku em exploração simples e tarefas auxiliares (`model: haiku` ao delegar); Opus em arquitetura complexa, decisões críticas ou problemas difíceis. A troca manual com `/model` continua valendo.
- Registrar só decisões técnicas relevantes.
- Não usar Obsidian.

## Graphify (grafo de código, complementar)
- Grafo local só de código (AST, sem LLM/API) em `graphify-out/` (ignorado pelo git via `.git/info/exclude`); exclusões em `.graphifyignore`. Consultar `graphify-out/GRAPH_REPORT.md` antes de explorar arquitetura.
- Usar quando: arquitetura, dependências, análise de impacto, refatoração multi-módulo, bug complexo, fluxo frontend↔backend↔banco. Comandos: `graphify query "<pergunta>" --budget 1500`, `graphify path "A" "B"`, `graphify explain "X"`, `graphify affected "X"`.
- Tarefa simples e localizada (≤2 arquivos, caminho conhecido): ler o arquivo direto, sem Graphify.
- Não é obrigatório nem bloqueia leituras. Tratar o grafo como pista: confirmar no arquivo antes de editar, e preferir Grep/Read se o resultado vier vazio ou truncado.
- Não regenerar a cada mensagem. Atualizar só após mudanças estruturais relevantes: `graphify update .` (AST, sem custo). Sem `graphify Codex install`, sem hooks, sem Graphify Cloud/APIs externas.

## Limites conhecidos
- Skills e agentes são escolhidos pelo julgamento do modelo, com base nos nomes, nas descrições e neste arquivo. Estas instruções orientam, mas não garantem delegação: não há roteamento determinístico "tarefa X → agente Y".
- Válido no terminal e na aba Code do Codex Desktop quando usam este ambiente local. Não presumir o mesmo em sessões remotas, Chat ou Cowork.

## Preservação
- Sem pedido explícito: não executar migrations nem `homolog:*`, `db:migrate:*`, `e2e:teardown`, `e2e:cleanup-legacy`; não modificar dados, não fazer deploy, não alterar credenciais.
- Não commitar automaticamente. Não habilitar hooks novos.

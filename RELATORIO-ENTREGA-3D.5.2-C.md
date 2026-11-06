# RELATÓRIO DE ENTREGA — ETAPA 3D.5.2-C
**Revisão final, transferência segura e publicação do ensaio de homologação efêmera**

Legenda: **VALIDADO LOCALMENTE** · **PUBLICADO** · **PREPARADO PARA CI** · **NÃO EXECUTADO** · **PENDENTE DE COMPROVAÇÃO REAL**.
Nada foi executado em PostgreSQL; o workflow `homolog-ephemeral` **não** foi disparado; nenhuma migration foi executada; nenhum banco persistente foi tocado.
(O hash do commit e a confirmação do remoto estão nas seções 15–16 da cópia do repositório original; esta cópia publicada é parte do próprio commit e cita o commit-pai `5ef3643`.)

## 1. Revisão da arquitetura
A estratégia (replay das 7 migrations originais num banco transitório `cardapio_digital_test` em cluster dedicado → rename para `cardapio_digital_homolog` e das roles → bootstrap → 8ª migration neutra) foi relida contra o código. A revisão estática encontrou **três incompatibilidades reais**, todas corrigidas (itens 3, 4 e 8): (a) as pastas TLS ficariam inacessíveis ao uid 999 do container PostgreSQL; (b) a cópia temporária usada para a 8ª migration colocaria a pasta de segredos *dentro* do "workspace" que `resolveSecretsDir` enxerga, o que o gate recusaria; (c) a validação `bash -n` do workflow só checava o primeiro script. **A estratégia em si segue PENDENTE DE COMPROVAÇÃO REAL.**

## 2. Workflow validado
* **VALIDADO LOCALMENTE com parser real:** PyYAML (instalado em pasta temporária fora do repositório) carrega `homolog-ephemeral.yml` e `ci.yml`. Gatilhos do novo workflow: somente `workflow_dispatch`; input `run_homolog_ephemeral` boolean `default: false`; `permissions: contents: read`; 1 job; `timeout-minutes: 25`; 8 passos (diagnóstico `if: failure()`, descarte `if: always()`); as duas actions fixadas por SHA de 40 caracteres (as mesmas do `ci.yml`).
* **Expressões:** as únicas `${{ }}` não existem; as condições `if` usam `github.event_name`, `inputs.run_homolog_ephemeral` e `github.event.repository.private` (contextos válidos em `jobs.<id>.if`) e as funções `failure()`/`always()` (válidas em `steps.if`). Variáveis de job (`PG_CONTAINER`, `REQUIRED`) são literais; as demais chegam por `$GITHUB_ENV`.
* **actionlint: indisponível** (não instalado; sem Go/Docker locais). Não foi instalado binário externo; a revisão de expressões foi manual, como acima. **PENDENTE:** rodar `actionlint` quando disponível. O GitHub também valida ao carregar o workflow.
* Teste `tests/ci-homolog-ephemeral-config.test.ts` (no job `backend` do `ci.yml`) trava: sem push/PR/schedule/workflow_run, opt-in false, sem `secrets.*`, sem artifacts/cache/services, SHA pinning, timeout ≤ 30, diagnóstico/descarte condicionais.

## 3. Validação da rede (PREPARADO PARA CI — requisitos realizáveis por configuração)
1. **Endereço acessível pelo Node:** o script obtém o IPv4 de saída do runner (`ip -4 route get 1.1.1.1`), recusa vazio/127.*/169.254.*/0.0.0.0 e publica a porta **somente nesse IP** (`--publish IP:55432:5432`); o processo Node (no host) conecta a esse IP, que passa pelo gateway do Docker normalmente. O IP de runner (10.x/172.x) **passa** `isForbiddenHomologHost` (que só proíbe loopback, link-local, `localhost`, `::`, rótulo único).
2. **DNS:** nenhum — host por IP literal; `EXPECTED_DATABASE_HOST` = IP.
3. **Certificado e nome:** certificado do servidor com `subjectAltName=IP:<IP do runner>` assinado pela CA sintética (validade 1 dia); a verificação do host usa SAN de IP.
4. **Não-loopback / gate intacto:** o gate **não** foi modificado; o desenho do ensaio é que atende ao gate.

## 4. Configuração TLS
`ssl=on`, certificado/chave em `/tls`, chave `chown 999:999` modo 0600; **corrigido:** `chmod 755` em `$WORK` e `$WORK/tls` (o `umask 077` os tornaria inacessíveis ao usuário `postgres` do container pelo bind mount). `pg_hba`: `hostssl … scram-sha-256` e `hostnossl … reject` (o servidor **recusa** conexões sem TLS: sem fallback silencioso do lado do servidor); `local trust` existe só dentro do container (prontidão). Cliente: `sslmode=require&sslaccept=strict&sslcert=<CA>` (Prisma) e `verify-full` com `sslrootcert` (psql). O CI valida TLS **a partir do host** com `verify-full` antes da suíte; a suíte exige `pg_stat_ssl.ssl = true` e que uma **CA errada seja recusada** (teste 0). Ponto aberto (conhecido, 3D.5.2-B): se o Prisma ignora `verify-*` (usa `prefer`) — por isso o ensaio usa `require`.

## 5. Identidade do cluster
Antes de qualquer escrita: `cluster_name` = `rustika-homolog-ephemeral-<run_id>` (gerado pelo workflow, comparado ao esperado), TLS real, PG ≥ 17, **somente** o banco `postgres` e nenhuma role `cardapio_*`/`rustika_*`. Depois: marca UUID do script 01 extraída da **saída** do script e conferida no catálogo; gates de fase; recusas por marca errada e por banco `cardapio_digital_dev` presente. Prevenção de conexão externa: a URL só tem o IP efêmero; nenhuma variável de URL de banco é aceita no ambiente (pré-condição do workflow); porta publicada apenas no IP do runner. A marca continua sendo verificação de consistência, não autenticação (TLS + credenciais autenticam).

## 6. Proteção da renomeação (VALIDADO ESTATICAMENTE — testes novos em `homolog-provisioning.test.ts`)
`04-finalize-rename.sql`: exige `current_database() = 'postgres'`; recusa `current_user`/`session_user` ∈ roles a renomear; recusa sessões no banco (`pg_stat_activity`), transações preparadas (`pg_prepared_xacts`), slots (`pg_replication_slots`), banco definitivo/dev/shadow existente e roles definitivas existentes — **todas antes** do `ALTER DATABASE`; transacional. `03-verify-replay.sql` (read-only): owners (banco, relações, schema, tipos), memberships, `pg_db_role_setting`, schemas extras, e **reprova** funções/views/triggers/políticas/event triggers (SQL armazenado que um rename não reescreveria); ACL do runtime. Não há `DROP`/`TRUNCATE`/`DELETE`. Rejeição de conexões indevidas: `hostnossl reject`, gates de identidade e `CONNECT` revogado de PUBLIC no banco.

## 7. Verificação das sete migrations
Arquivos intactos (checksums; `git diff` vazio em `prisma/migrations` nos dois repositórios; teste de integridade verde). No ensaio: conjunto exato em `_prisma_migrations`, concluídas, sem reversão, `applied_steps_count = 1`, linhas completas idênticas após o rename; sem `migrate resolve`/`db push`/`reset` (teste estático proíbe). **PENDENTE DE COMPROVAÇÃO REAL.**

## 8. Estratégia da oitava migration sintética
Cópia temporária do backend; **corrigido:** a cópia agora fica em `<tmp>/rustika-m8-X/backend` (antes, o "workspace" seria `<tmp>` e a pasta de segredos, irmã em `<tmp>`, seria recusada). Sequência: migration desconhecida recusada → lista revisada simulada só na cópia → aplicada uma vez via wrapper → reexecução "No pending migrations" → tabela nova sem privilégios para o runtime → drift só em migrations/tables/columns → adulteração do arquivo recusada. Nada entra no Git nem na lista real. **PREPARADO PARA CI.**

## 9. Bootstrap administrativo
Mesmo núcleo da CLI (sem enfraquecer a CLI): ausência inicial, recusas por role/banco/cluster errados, criação, hash verificável, segundo bootstrap recusado, UPDATE/DELETE negados, senha ausente das saídas, runtime recusado, janela fechada, login HTTP e `/api/ready`. Credenciais por etapa: admin do cluster (somente 01/02/04/06/07 e consultas de verificação); migrator (replay, grants, revoke, verificações); bootstrap (apenas durante a janela); runtime (apenas app). Nenhum privilégio administrativo ao runtime (matriz de privilégios comparada).

## 10. Verificação de schema
Snapshots A×B com 22 seções (schemas, tabelas, colunas, constraints/FKs, índices, enums, sequências, funções, views, triggers, políticas, owners, ACLs de tabela/coluna/schema/banco/default, roles, memberships, settings, propriedades do banco) + classificação de renomeações aprovadas + matriz efetiva de privilégios. Testes com mocks/unidade verdes; leitura real de catálogo **PENDENTE**.

## 11. Cleanup
`teardown.sh` (`if: always()`): `docker rm -fv pg-homolog-ephemeral` (nome fixo, nunca padrões genéricos), remove `$RUNNER_TEMP/homolog-ephemeral`, `rustika-secrets-*`, `rustika-m8-*` (somente esses nomes, sob `RUNNER_TEMP`), e **falha o job** se container ou material TLS sobrar; a suíte, no `afterAll`, derruba sessões, remove bancos/roles do ensaio e exige zero sobras. O diagnóstico (`if: failure()`) imprime ≤ 60 linhas de log com URLs/senhas mascaradas, sem dump, sem `env`, sem artifacts; o passo de teste não é mascarado por `continue-on-error` (inexistente). O pré-requisito de "container novo" evita remover recurso alheio. Rede: o cleanup não usa conexões externas.

## 12. Testes executados (VALIDADO LOCALMENTE — nenhum com banco, sem Playwright, sem migrations)
* Original: `tsc --noEmit` = só os 2 erros antigos; `npm run build` OK; `npm run test:ci` = **980 aprovados, 8 ignorados** (52 arquivos + 1 ignorado).
* **Snapshot após a cópia:** `tsc --noEmit` sem erros; build OK; `test:ci` = **980 aprovados, 8 ignorados**.
* Shell: `bash -n` nos 3 scripts OK. YAML: PyYAML OK. actionlint: indisponível.
* Novos testes desta etapa: 4 de proteção da renomeação/CI.
* **NÃO EXECUTADOS:** suíte efêmera, SQL em psql, workflow, migrations, Playwright.

## 13. Arquivos transferidos
Os **62 caminhos** de `manifest-3d52b-transfer.txt` (52 novos, 10 alterados) + este relatório. Os 10 alterados foram conferidos: 9 eram idênticos ao HEAD do original (nada exclusivo do snapshot a perder) e `package.json` difere do HEAD apenas pelo script `e2e:validate-state`, que o original também contém. Nenhum arquivo do snapshot ausente do manifesto foi tocado (FIX01/FIX02, CI de pedidos/disponibilidade, `ci.yml`, sete migrations e testes sanitizados preservados). Não transferidos: `.git` do original, segredos, planilhas, dumps, backups, conflitos `*-Calil-Notebook*`, os 4 testes sensíveis do original.

## 14. Auditoria de segredos
Varredura (URLs com senha, chaves privadas, tokens AWS/GitHub) nos 62 caminhos: apenas fixtures falsas de teste (`URL-PASSWORD-SECRET`, templates `${password}`); exemplos `.env.example` com `SENHA_URLENCODED_SUBSTITUA`; o UUID de exemplo `00000000-…` é placeholder. Nenhum segredo real; nenhum certificado/chave no repositório (são gerados no runner).

## 15. Hash do commit
Ver a mensagem final da entrega e o registro do original (preenchido após o push).

## 16. Confirmação do remoto
Antes do commit: `fetch` de `origin` → `origin/main` = `5ef36435f93cc55540f8620ac4456f807d75bacd` (não avançou). Push: `git push --no-tags origin main:main` (sem force/mirror/all/tags); confirmação após o push na mensagem final.

## 17. Estado dos repositórios
Original: sem commit/push (working tree com as etapas 3D.5.2→C; migrations 6/7 ainda não rastreadas por etapas anteriores, inalteradas). Snapshot: um commit novo sobre `5ef3643`, branch `main`. Bancos persistentes e o PostgreSQL local intactos.

## 18. Riscos conhecidos
Estratégia não comprovada em PostgreSQL real; possível falha na primeira execução (SQL de catálogo, `\gset`, rename, comportamento do Prisma com TLS/IP); dúvida sobre `sslmode=verify-*` no Prisma; marca de cluster copiável; bloqueio potencial em PostgreSQL gerenciado (rename de banco/role e `CREATEROLE`); `actionlint` não rodado; falhas de infraestrutura do runner (apt do `psql`, `sudo chown`, publicação por IP); permissões do uid 999 (corrigidas por análise, não por execução); a primeira execução usa `postgres:18` por tag (não por digest) — mutável; avaliar fixar digest após a 1ª execução.

## 19. Inputs exatos da primeira execução (NÃO EXECUTADO — exige autorização separada)
Actions → workflow **homolog-ephemeral** → *Run workflow* → branch `main` → `run_homolog_ephemeral` = **true** (único input; default false). Nenhum secret/variável. Recomenda-se rodar antes `actionlint` se disponível.

## 20. Critérios de sucesso do ensaio
**Sucesso:** job verde com os testes 0–12 aprovados (TLS real e CA errada recusada; identidade antes da escrita; sete migrations por wrapper; histórico idêntico; fingerprint A = B com 4 renomeações aprovadas e zero inesperadas; matriz de privilégios idêntica; bootstrap único; login HTTP; 8ª migration idempotente e divergência recusada; zero sobras) **e** passo de descarte com "Ambiente efêmero descartado".
**Falha:** qualquer teste vermelho, configuração ausente, TLS inativo/CA errada aceita, drift inesperado, sobras no cleanup. Falhas não viram skip.

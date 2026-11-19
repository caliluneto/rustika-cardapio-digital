# RÚSTIKA — Relatório da Entrega 3D.3.22-A

**Parecer: CAUSA IDENTIFICADA; CORREÇÃO PREPARADA, NÃO APLICADA.** 04/11/2026.

Esta entrega usou consultas de catálogo e sondagens de autenticação somente de leitura. Não alterou dados, roles, ACLs, `pg_hba.conf`, secrets ou senhas; não executou migration, Seed, integração real ou E2E.

## 1. Causa demonstrada

O PostgreSQL 18.6 local aceitou conexão autenticada como `cardapio_migrator` em `plataforma_sites_ia` e `plataforma_sites_ia_test`. Em ambos os casos, `current_database()`, `current_user` e `transaction_read_only=on` foram confirmados. Nenhum dado de negócio foi consultado.

A cadeia de autorização é:

1. `pg_database.datacl`, expandido por `aclexplode`, mostra `CONNECT` e `TEMPORARY` concedidos a `PUBLIC` nos dois bancos da PLATAFORMA_SITES_IA. Não há GRANT direto a `cardapio_migrator` nesses bancos. `has_database_privilege` confirmou o `CONNECT` efetivo.
2. `cardapio_migrator` não aparece como membro nem como role concedida em `pg_auth_members`; não há herança de grupo responsável pelo acesso. A role tem `LOGIN` e `INHERIT`, sem `SUPERUSER`, `CREATEROLE` ou `CREATEDB`.
3. No `C:\Program Files\PostgreSQL\18\data\pg_hba.conf`, a linha **121** é `host all all 127.0.0.1/32 scram-sha-256`. Para a sondagem em `127.0.0.1`, esta é a primeira regra correspondente ao migrator e ao banco externo. A linha 119 é a regra genérica `local`; a 123 permite `::1/128`. As regras 114–118 isolam apenas `cardapio_test_fixtures`. Não há `include` ativo identificado no arquivo.
4. O servidor autenticou a senha da role e aceitou a conexão porque HBA e `CONNECT` foram satisfeitos. O HBA usa a **primeira regra correspondente**, sem tentar linhas posteriores. [Documentação PostgreSQL 18: `pg_hba.conf`](https://www.postgresql.org/docs/18/auth-pg-hba-conf.html).

O SHA-256 do `pg_hba.conf` permaneceu `6BD85A8F2EBBD8ECBD3C605EE2401456226BDD7B9F50F157DE932377D3487EC5`, igual ao retrato da 3D.3.22. Isso confirma que a regra investigada não foi alterada nesta entrega.

## 2. Alcance real dos privilégios nos bancos externos

| Banco | CONNECT | TEMPORARY | Schema `public` | Relações de usuário | Privilégios efetivos do migrator nas relações |
| --- | --- | --- | --- | ---: | --- |
| `plataforma_sites_ia` | `PUBLIC` | `PUBLIC` | `USAGE` via `PUBLIC`; `CREATE` negado | 7 | 0 `SELECT`, 0 `INSERT`, 0 `UPDATE`, 0 `DELETE` |
| `plataforma_sites_ia_test` | `PUBLIC` | `PUBLIC` | `USAGE` via `PUBLIC`; `CREATE` negado | 7 | 0 `SELECT`, 0 `INSERT`, 0 `UPDATE`, 0 `DELETE` |

O problema comprovado é **acesso ao banco no nível de conexão**, com capacidade de criar objetos temporários concedida por `PUBLIC`; não foi demonstrado acesso às tabelas de negócio. O catálogo foi consultado somente em transações `READ ONLY`. `CONNECT` é verificado além do HBA, e `PUBLIC` recebe privilégios padrão em muitos bancos PostgreSQL; isso explica por que um `REVOKE` direcionado apenas ao migrator não elimina a concessão pública. [Documentação PostgreSQL 18: privilégios](https://www.postgresql.org/docs/18/ddl-priv.html).

## 3. Allowlist necessária

`backend/config/database-profiles.json` e os cinco perfis de secrets foram inspecionados sem divulgar URLs ou senhas. As URLs de `migrate-dev` e `migrate-test`, inclusive as de shadow, usam `127.0.0.1:5432` com a role `cardapio_migrator`. A lista necessária para os fluxos de migration atuais é:

| Banco permitido | Uso |
| --- | --- |
| `cardapio_digital_dev` | `migrate-dev`, `DATABASE_URL` |
| `cardapio_digital_test` | `migrate-test`, `DATABASE_URL` |
| `cardapio_digital_shadow` | Shadow dos dois perfis |

Nenhum banco `plataforma_sites_ia*`, `postgres`, `cardapio_restore_*` ou `rf004_lab_*` integra a allowlist. O procedimento futuro de restauração de `backend/docs/restore-backup.md` prevê role administrativa própria e não depende do migrator. Há uma sessão antiga do migrator em `cardapio_restore_3d316`; a restrição proposta afetaria apenas **novas** conexões ali, não terminaria a sessão existente. Qualquer uso futuro do migrator em restore/lab requer decisão específica antes da ativação.

## 4. Alternativas e correção mínima proposta

| Alternativa | Avaliação |
| --- | --- |
| A. HBA específico para `cardapio_migrator` | **Recomendada.** Isola uma role, preserva `PUBLIC CONNECT` e as regras das outras aplicações. Exige edição controlada do `pg_hba.conf`. |
| B. ACL dedicada | Insuficiente: retirar um GRANT direto do migrator não neutraliza `PUBLIC CONNECT`; revogar `CONNECT` de `PUBLIC` nos bancos externos afetaria outras aplicações e foi vedado. PostgreSQL não oferece uma ACL negativa por role para sobrepor `PUBLIC`. |
| C. HBA + ACL | Não necessária para o objetivo desta etapa; introduziria mudança adicional sem resolver melhor a conexão dessa role. |

**Inserir as quatro regras abaixo, nesta ordem, imediatamente antes da linha atual 114**, portanto antes das regras de fixtures e de qualquer regra com usuário `all`:

```conf
host   cardapio_digital_dev,cardapio_digital_test,cardapio_digital_shadow   cardapio_migrator   127.0.0.1/32   scram-sha-256
local  all                                                               cardapio_migrator                    reject
host   all                                                               cardapio_migrator   0.0.0.0/0      reject
host   all                                                               cardapio_migrator   ::0/0          reject
```

A primeira regra mantém exatamente o caminho dos perfis existentes. As demais recusam socket local, qualquer outro IPv4 e qualquer IPv6, inclusive `::1`. `0.0.0.0/0` e `::0/0` são as faixas completas documentadas pelo PostgreSQL. Nenhuma regra de outra role seria modificada; `listen_addresses`, `pg_hba.conf` das fixtures e autenticação SCRAM permanecem. [Documentação PostgreSQL 18: endereços e ordem das regras](https://www.postgresql.org/docs/18/auth-pg-hba-conf.html).

**Arquivo efetivo a modificar em operação futura:** `C:\Program Files\PostgreSQL\18\data\pg_hba.conf` (fora do repositório). Nenhum JSON de perfil, `.env`, SQL de migration ou ACL precisa ser alterado para esta correção. Nesta entrega foi alterado apenas `backend/tests/scripts/pg-hba-isolation.test.ts` para simular a proposta, além deste relatório.

## 5. Validação e recuperação preparadas — não executadas

1. Antes da edição futura: confirmar novamente serviço, identidade do cluster, arquivo HBA, hash original, consumidores ativos e que os quatro perfis de migration ainda apontam para os três bancos em `127.0.0.1`. Parar se houver dependência crítica de restore/lab, outro host necessário ou divergência de hash sem explicação.
2. Fazer backup **fora do OneDrive e do repositório**, em pasta de ACL restrita, preservando conteúdo, ACL, tamanho e SHA-256. Conferir que a cópia é legível e idêntica ao original; não registrar conteúdo em log. Não houve backup novo nesta entrega.
3. Preparar candidato com as quatro linhas antes da linha 114. Validar offline ordem, sintaxe, IPv4, IPv6, socket local e não interferência em outras roles. A simulação unitária desta entrega passou **12/12** (7 testes existentes e 5 novos); ela não substitui o parser real do PostgreSQL.
4. Aplicar apenas mediante nova autorização, preferindo substituição de arquivo completa e controlada, sem janela de escrita parcial. **No Windows, o PostgreSQL aplica mudanças de `pg_hba.conf` imediatamente às novas conexões**; não se pode contar com `pg_reload_conf()` como barreira de ativação. Preparar o backup e as sondagens antes de tocar no arquivo. [Documentação PostgreSQL 18: nota sobre Windows](https://www.postgresql.org/docs/18/auth-pg-hba-conf.html).
5. Imediatamente após a substituição, a role administrativa consulta `pg_hba_file_rules`, exigindo `error IS NULL`, as quatro linhas na ordem prevista e cada uma antes de qualquer regra genérica correspondente. A view lê o arquivo atual, não necessariamente o último estado carregado, e por padrão exige superuser. [Documentação PostgreSQL 18: `pg_hba_file_rules`](https://www.postgresql.org/docs/18/view-pg-hba-file-rules.html). Como verificação adicional, chamar `SELECT pg_reload_conf()` com role administrativa e conferir retorno/erros; no Windows isso não substitui as sondagens de novas conexões.
6. Sondar com credenciais obtidas dos perfis seguros, sem colocá-las na linha de comando nem registrar URLs: **sucesso** para migrator em Dev/Test/Shadow via `127.0.0.1`; **recusa por HBA**, não por falta de senha, para migrator em ambos `plataforma_sites_ia*`, `postgres`, restore e lab; **recusa** para `::1` e demais caminhos. Confirmar as regras existentes de fixtures e autenticação das roles próprias da PLATAFORMA_SITES_IA. Não consultar dados de negócio.
7. Confirmar que `pg_hba.conf` ainda tem apenas as quatro linhas planejadas, `PUBLIC CONNECT` e ACLs não mudaram, e que nenhuma aplicação legítima foi interrompida. Não encerrar sessões; conexões preexistentes podem continuar até se desconectarem.
8. **Rollback:** se houver erro de parsing, falha em conexão permitida, sucesso em conexão proibida, falha em outra aplicação ou hash/ACL inesperado, restaurar o backup byte a byte com a ACL original. Em Windows, testar imediatamente novas conexões após a restauração; chamar `pg_reload_conf()` e revisar `pg_hba_file_rules`/logs. Comparar SHA-256 restaurado com o original e repetir sondagens permitidas/proibidas. Não fazer mudanças compensatórias de ACL ou senha.

Comandos de leitura para o operador futuro, autenticado por mecanismo seguro e com permissão administrativa onde exigida:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'C:\Program Files\PostgreSQL\18\data\pg_hba.conf'
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -X -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "SELECT rule_number,line_number,type,database,user_name,address,auth_method,error FROM pg_hba_file_rules ORDER BY rule_number NULLS LAST,line_number"
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -X -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "SELECT pg_reload_conf()"
```

Esses comandos **não foram executados para ativar configuração**. O segundo requer credencial administrativa não exibida aqui. O teste negativo deve conferir a mensagem de recusa por HBA e o código de saída; um erro de senha ausente não prova isolamento.

## 6. Testes realizados e Git

- Consultas `READ ONLY` em `cardapio_digital_test`, `plataforma_sites_ia` e `plataforma_sites_ia_test`: identidade, ACL de banco, memberships e contagens de privilégios em schemas/relações. Não houve leitura de linhas de negócio.
- Leitura do `pg_hba.conf`: linhas 114–123 e SHA-256, sem edição.
- Simulação em `backend/tests/scripts/pg-hba-isolation.test.ts`: **12/12 aprovados**, incluindo allowlist, rejeição IPv4/IPv6/local, regra genérica adversarial e ausência de efeito sobre outras roles. `npm run typecheck` backend: aprovado. A primeira execução da simulação detectou um erro no modelo de CIDR; o modelo foi corrigido e a execução final passou.
- Git antes: branch `main`, HEAD `a39247b`, 112 entradas de status, nada em stage. Alterações desta entrega: o teste de simulação e este relatório. Não houve `git add`, commit ou push.

## 7. Riscos restantes e parecer

- `PUBLIC CONNECT`/`TEMPORARY` nos bancos externos permanecem; a proposta isola **somente o migrator** em novas conexões. Eventual revisão das outras roles RÚSTIKA é tarefa distinta.
- Senhas fracas/compartilhadas e cópias antigas em scripts/checkpoints continuam como na 3D.3.22. **Nenhuma rotação foi iniciada.** Corrigir HBA não substitui a rotação.
- No Windows, a ativação para novas conexões é imediata. O próximo operador precisa de backup verificável e teste de rollback pronto antes da edição.
- O teste unitário é modelo estático; parser real e sondagens pós-alteração continuam obrigatórios.

**Parecer final: causa identificada e correção mínima preparada.** A alteração efetiva do `pg_hba.conf` exige autorização explícita separada. A rotação das quatro senhas será uma operação posterior, também condicionada à validação do isolamento.

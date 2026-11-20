# RÚSTIKA — Relatório da Entrega 3D.3.22-B

**Parecer: BLOQUEADA antes da edição do `pg_hba.conf` ativo.** Backup íntegro e candidato preparados; nenhuma regra foi aplicada. Data local: 04/11/2026 (backup às 01:53:55 UTC de 05/11/2026).

## 1. Identidade do cluster e estado inicial

- Serviço `postgresql-x64-18` em execução, `-D C:\Program Files\PostgreSQL\18\data`; `postgres.exe -D ... -C hba_file` resolveu `C:/Program Files/PostgreSQL/18/data/pg_hba.conf`. A consulta autenticada em Test confirmou PostgreSQL **18.6**, `127.0.0.1:5432` e `listen_addresses=localhost`.
- O arquivo ativo tem 6.131 bytes e SHA-256 `6BD85A8F2EBBD8ECBD3C605EE2401456226BDD7B9F50F157DE932377D3487EC5`, idêntico à 3D.3.22-A. Sem BOM UTF-8; finais de linha mistos (122 CRLF e 6 LF sem CR). A proposta preserva os bytes existentes.
- Regras das fixtures nas linhas 114–118, incluindo permissão Test em IPv4/IPv6 e recusas para os demais bancos; regra genérica `local all all` na 119, `host all all 127.0.0.1/32` na 121 e `host all all ::1/128` na 123. `cardapio_test_fixtures` conserva `CONNECTION LIMIT 2`.
- `migrate-dev` e `migrate-test`, incluindo as URLs de shadow, apontam para Dev, Test e Shadow em `127.0.0.1:5432`. Nenhum valor de senha ou URL foi exibido. `pg_stat_activity` mostrou quatro sessões `psql` antigas do migrator em Test e uma em `cardapio_restore_3d316`, todas ociosas; nenhuma em banco externo. Busca por `cardapio_migrator` no workspace PLATAFORMA_SITES_IA não encontrou referência. Isso não prova ausência de todos os consumidores fora dos workspaces.

## 2. Backup e procedimento de recuperação

O diretório `C:\RustikaBackups\pg_hba_backups` já existia, mas herdava permissões amplas (`Usuários autenticados: Modify`). Foi criada uma subpasta **nova**, com herança desabilitada e exatamente três ACEs de controle total (usuário atual, SYSTEM, Administradores):

`C:\RustikaBackups\pg_hba_backups\3D.3.22-B_20261105T015355Z_e51a19a9\`

| Arquivo | SHA-256 | Tamanho |
| --- | --- | ---: |
| Ativo, antes e depois desta entrega: `C:\Program Files\PostgreSQL\18\data\pg_hba.conf` | `6BD85A8F2EBBD8ECBD3C605EE2401456226BDD7B9F50F157DE932377D3487EC5` | 6.131 bytes |
| Backup: `...\3D.3.22-B_20261105T015355Z_e51a19a9\pg_hba.conf` | `6BD85A8F2EBBD8ECBD3C605EE2401456226BDD7B9F50F157DE932377D3487EC5` | 6.131 bytes |
| Candidato: `...\3D.3.22-B_20261105T015355Z_e51a19a9\pg_hba.candidate.conf` | `38744AB9E7628AC91CB5192435B1F44E5CD973513C0738F7FD8087D08F48BE91` | 6.607 bytes |

O SDDL do arquivo original foi guardado em `pg_hba.source.sddl.txt` na mesma subpasta restrita. O candidato acrescenta **476 bytes** na posição anterior à regra de fixtures IPv4; prefixo e sufixo foram comparados byte a byte com o original. Os finais de linha preexistentes não foram convertidos. A ACL do arquivo ativo, herdada, inclui usuário atual, Administradores, SYSTEM e Serviço de Rede com controle total. O candidato herda a ACL restrita da subpasta de backup; antes de uma aplicação futura, será necessário preservar explicitamente a ACL do ativo no arquivo que o substituirá, especialmente a entrada do Serviço de Rede.

Foi ensaiado `File.Replace` com backup obrigatório e recuperação por segunda substituição **somente em cópias da subpasta**; os hashes de ida e volta coincidiram. A primeira tentativa do ensaio, com caminho de backup nulo, falhou sem tocar o ativo; a tentativa corrigida passou. O backup original e o candidato permanecem intactos. **Não foi ensaiada a substituição do arquivo ativo.**

## 3. Regras propostas e estado efetivo

As quatro linhas abaixo estão **somente no candidato**. A posição prevista é imediatamente antes da atual linha 114, antes das regras específicas de fixtures e das genéricas:

```conf
host   cardapio_digital_dev,cardapio_digital_test,cardapio_digital_shadow   cardapio_migrator   127.0.0.1/32   scram-sha-256
local  all                                                               cardapio_migrator                    reject
host   all                                                               cardapio_migrator   0.0.0.0/0      reject
host   all                                                               cardapio_migrator   ::0/0          reject
```

**Regras efetivas nesta execução:** as originais. `PUBLIC CONNECT`, roles, ACLs, `listen_addresses`, passwords e serviço não foram modificados. No Windows, alterações no HBA podem valer imediatamente para novas conexões, antes de qualquer recarga; por isso a validação administrativa e o retorno devem estar disponíveis ao aplicar. [PostgreSQL 18 — `pg_hba.conf`](https://www.postgresql.org/docs/18/auth-pg-hba-conf.html).

## 4. Sondagens de conexão antes da edição

Todas as sondagens bem-sucedidas usaram `BEGIN READ ONLY`, `current_database()` e `current_user`, sem dados de negócio:

| Role / transporte | Dev | Test | Shadow | PLATAFORMA_SITES_IA |
| --- | --- | --- | --- | --- |
| `cardapio_migrator`, `127.0.0.1` | autentica | autentica | autentica | **autentica indevidamente** |
| `cardapio_migrator`, `::1` | autentica | autentica | autentica | **autentica indevidamente** |
| `cardapio_dev_app`, `127.0.0.1` | autentica | não sondado | não sondado | não sondado |
| `cardapio_test_app`, `127.0.0.1` | não sondado | autentica | não sondado | não sondado |
| `cardapio_test_fixtures`, `127.0.0.1` | recusado | autentica | não sondado | não sondado |

As conexões proibidas do migrator **ainda não foram recusadas**, pois o HBA ativo não foi editado. Não houve teste pós-aplicação. Conexões locais por socket não foram sondadas neste Windows; as regras atuais contêm o tipo `local` e a proposta o cobre. Nenhum processo foi encerrado.

## 5. Bloqueio da validação administrativa

A Etapa 4 exige consultar `pg_hba_file_rules` após uma alteração e confirmar ausência de erros, ordem e métodos. `cardapio_migrator` não possui `SELECT` nessa view (`has_table_privilege=false`; consulta retornou `permissão negada`). O mesmo usuário não pode examinar `current_setting('hba_file')` por SQL; o caminho foi resolvido sem SQL pelo serviço e `postgres -C`. Uma tentativa de conexão como `postgres` sem credencial administrativa disponível retornou `no password supplied`. Não se buscou, extraiu ou registrou senha administrativa.

Por padrão, `pg_hba_file_rules` é acessível apenas a superusers e mostra o **arquivo atual**, não necessariamente o último conteúdo carregado. A sintaxe do candidato foi simulada em teste, mas a view e as provas de novas conexões só seriam conclusivas depois de editar. Sem um modo seguro de executar a consulta administrativa exigida **imediatamente** após a troca, a validação e o rollback supervisionado não estão completos. [PostgreSQL 18 — `pg_hba_file_rules`](https://www.postgresql.org/docs/18/view-pg-hba-file-rules.html).

**Decisão de parada:** não substituir o arquivo ativo nem executar recarga. É necessária uma sessão administrativa segura, sem compartilhar senha em chat, comando ou relatório, para consultar `pg_hba_file_rules` no momento da aplicação. A autorização D desta entrega não autoriza conceder `SELECT` ao migrator nem criar perfil/credencial administrativa.

## 6. Integridade, testes locais e Git

- Testes unitários `pg-hba-isolation.test.ts`, `secrets.test.ts` e `audit-secrets.test.ts`: **36/36 aprovados** (3 arquivos). Não houve teste de integração com escrita ou E2E.
- As cinco `migration.sql` estão rastreadas e sem diferenças em Git; SHA-256 atuais, em ordem: `1A9CD08B9D49FA9F70EABCCEAA4A696F5AEE07555F6A88562EC789340F0D3983`, `05F583E854A87B77612C2F7D10A0A178EF45EA099D3237808B5BF0BD7C698122`, `960766A8FB1576E6094622F112E1A3A9CD7455F56907A3405A8FBB183959E10B`, `885B8DE5DCC0CF5E7618D574BA5C013AE8B60C9B983260706C5819422564454F`, `24471ED369980BC861D885DC68D9EDD3747DE73457BE620D166EAE8B1EC47D6E`.
- Git no início: branch `main`, HEAD `a39247b`, 114 entradas de status preexistentes, nada em stage. Somente este relatório foi criado no repositório nesta entrega. Nenhum `git add`, commit ou push.

## 8. Retomada da Execução (Claude Code → Cline)

**Data da Retomada:** 04/11/2026 (assumida da execução atual).

1. **Estado encontrado na retomada:** 
   - Backup íntegro e candidato intacto. O hash original de `pg_hba.conf` permaneceu `6BD85A8F2EBBD8ECBD3C605EE2401456226BDD7B9F50F157DE932377D3487EC5`. O hash do candidato é `38744AB9E7628AC91CB5192435B1F44E5CD973513C0738F7FD8087D08F48BE91`.
2. **Backup utilizado:** `C:\RustikaBackups\pg_hba_backups\3D.3.22-B_20261105T015355Z_e51a19a9\pg_hba.conf`
3. **Hash do arquivo original:** `6BD85A8F2EBBD8ECBD3C605EE2401456226BDD7B9F50F157DE932377D3487EC5`
4. **Resultado da verificação administrativa anterior:** O usuário executou `SELECT current_user, current_setting('server_version');` (postgres, 18.6) e consultou `pg_hba_file_rules` (errors = 0, rules = 11).
5. **Alterações efetivamente realizadas:** Nenhuma edição realizada no arquivo ativo `pg_hba.conf`.
6. **Resultado da validação posterior:** Bloqueada pela falta de verificação administrativa.
7. **Conexões permitidas:** Inalteradas.
8. **Conexões recusadas:** Inalteradas.
9. **Preservação de outras roles:** Confirmada estaticamente nos testes unitários e pelo não-toque no ambiente ativo.
10. **Estado das migrations:** Intactas (5 preservadas).
11. **Testes executados:** Suíte `tests/scripts/pg-hba-isolation.test.ts` reaprovada localmente (12/12) e suíte `tests/config/secrets.test.ts` & `audit-secrets.test.ts` reaprovada (24/24).
12. **Estado do Git:** Diretório de trabalho inalterado na retoma, exceto pela adição do registro desta etapa no relatório.
13. **Bloqueios encontrados:** O Agente não possui acesso seguro com privilégios de superusuário (a senha não foi fornecida, e o console aguarda prompt interativo). Sem poder executar `SELECT pg_reload_conf()` e validar `pg_hba_file_rules` **imediatamente** após a edição, o processo aborta a alteração por razões de segurança.
14. **Parecer final:** Alteração não aplicada.

**3D.3.22-B — BLOQUEADA, AGUARDANDO VERIFICAÇÃO ADMINISTRATIVA SEGURA.**
## 9. Validação Final e Sondagem de Credenciais (Pós-Alteração)

**Data da Validação:** 04/11/2026

A configuração candidata foi aplicada manualmente pelo usuário com sucesso e a recarga confirmou 0 erros em `pg_hba_file_rules`. As ACLs (incluindo Serviço de Rede) foram mantidas.

**Resultados do isolamento do Migrator (Validação Manual):**
- ✅ **Permitido:** Dev, Test, Shadow.
- ✅ **Recusado (Bloqueio HBA):** postgres, plataforma_sites_ia, plataforma_sites_ia_test.

**Investigação das demais roles:**
O usuário relatou dificuldades em testes de conexão manuais:
1. `cardapio_dev_app` → "fe_sendauth: no password supplied".
2. `cardapio_test_fixtures` → "FATAL: autenticação do tipo senha falhou".

Para determinar se a causa era configuração do `pg_hba.conf` ou ausência/divergência de senhas no teste manual, o Agente executou uma sondagem programática via Node.js (`pg`), importando os perfis através do carregador seguro (`loadDatabaseProfile` e `resolveSecretsDir`), **sem expor ou embutir as senhas**.

**Resultados da Sondagem Segura (Automática):**
- `app-dev` (tamanho da senha: 8): **Conectou com sucesso** (`cardapio_dev_app` @ `cardapio_digital_dev`).
- `app-test` (tamanho da senha: 8): **Conectou com sucesso** (`cardapio_test_app` @ `cardapio_digital_test`).
- `fixtures-test` (tamanho da senha: 26): **Conectou com sucesso** (`cardapio_test_fixtures` @ `cardapio_digital_test`).
- `migrate-test`: Conectou e confirmou a integridade das **5 migrations** em `_prisma_migrations`.

**Conclusão sobre a conectividade:** As falhas manuais foram artefatos do método de conexão do cliente (ex: o `psql` não recebeu a senha ou recebeu uma digitação incorreta da senha de 26 caracteres). **Não há bloqueio de HBA nem senhas quebradas nos perfis atuais.** As credenciais gerenciadas continuam íntegras e consistentes com o banco. O banco não sofreu degradação e nenhuma outra role foi impactada.

**Riscos Pendentes:**
- As senhas atuais funcionam, mas ainda violam a política de segurança (senhas fracas de 8 caracteres compartilhadas entre Dev/Test/Migrator). A rotação de credenciais não foi iniciada nesta etapa.
- Cópias antigas dos scripts com senhas embutidas continuam no histórico local (`refs/cline/checkpoints/*`) e no sistema de arquivos.

## 10. Estado do Git e Encerramento

- Diretório de trabalho inalterado, exceto por este relatório. Nenhuma alteração destrutiva, checkpoint ou staging foi efetuado.
- Nenhum script solto foi alterado ou apagado nesta fase.
- Testes locais, integridade estrutural e permissões preservadas.

**Parecer final: CONCLUÍDA.** O isolamento do `cardapio_migrator` foi aplicado com segurança, validado administrativamente e comprovado via recusas ativas a outros bancos. As credenciais existentes foram confirmadas como operacionais via perfis seguros. A Entrega 3D.3.22-B está encerrada, restando apenas a rotação de senhas para a subsequente etapa (3D.3.22-C).

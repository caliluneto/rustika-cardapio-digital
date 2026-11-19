# RÚSTIKA — Relatório da Entrega 3D.3.22

**Parecer: BLOQUEADA no pré-voo. Nenhuma credencial foi rotacionada.**

Data: 04/11/2026. Escopo autorizado: rotação sequencial de `cardapio_dev_app`, `cardapio_test_app`, `cardapio_migrator` e `cardapio_test_fixtures`. A instrução de parar antes da primeira alteração se o isolamento ou dependências não puderem ser confirmados foi aplicada.

## 1. Estado inicial e fonte das evidências

- Relatório 3D.3.21-B, `backend/docs/secrets-rotation.md` e `backend/docs/e2e-real.md` consultados. A Entrega 3D.3.21-B registrou 662/662 testes backend, 99/99 frontend e 73/73 de fixtures; esses resultados são **herdados**, não foram repetidos aqui.
- Cluster local em `127.0.0.1:5432`, PostgreSQL **18.6**, serviço `postgresql-x64-18` em execução. A consulta autenticada retornou `cardapio_digital_test` e `cardapio_migrator`. **Confirmado nesta execução.**
- As quatro roles existem, permitem login e não têm `SUPERUSER`, `CREATEROLE` ou `CREATEDB`. `cardapio_test_fixtures` mantém `CONNECTION LIMIT 2`; as outras têm `-1`. **Confirmado nesta execução.**
- `npm run secrets:audit` falhou: três roles compartilham senha de 8 caracteres somente numéricos; o perfil shadow de Test do migrator diverge e tem 6 caracteres; a senha da role de fixtures tem 26 caracteres, porém está embutida em scripts locais conforme 3D.3.21-B. **Confirmado nesta execução quanto aos perfis; scripts conforme inspeção anterior.** Nenhum valor foi impresso neste relatório.

## 2. Dependências e bloqueio de isolamento

- `pg_stat_activity` mostrou cinco sessões `psql` antigas do migrator em estado `idle`, quatro em Test e uma em `cardapio_restore_3d316`. A sessão de inspeção atual apareceu como `active`. O dono/necessidade operacional das sessões antigas não foi confirmado; nenhum processo foi encerrado. **Confirmado nesta execução.**
- Os perfis em uso pelo projeto estão em `%LOCALAPPDATA%\CardapioDigital\secrets`, fora do repositório e do OneDrive. Cinco arquivos existem: `app-dev.env`, `app-test.env`, `fixtures-test.env`, `migrate-dev.env`, `migrate-test.env`. A pasta tem somente três ACEs de controle total para usuário atual, Administradores e SYSTEM; os arquivos herdam essas ACEs. **Confirmado nesta execução por metadados, sem divulgar conteúdo.**
- A leitura do `pg_hba.conf` mostrou regras específicas para fixtures em Test, seguidas de regras genéricas `host all all` para loopback. O SHA-256 observado do arquivo foi `6BD85A8F2EBBD8ECBD3C605EE2401456226BDD7B9F50F157DE932377D3487EC5`. Trata-se de um retrato atual; não há comparação com baseline anterior nesta entrega. O arquivo não foi modificado.
- `has_database_privilege(..., 'CONNECT')` retornou `true` para as quatro roles em `plataforma_sites_ia` e `plataforma_sites_ia_test`, entre outros bancos. Uma conexão real **somente leitura** como `cardapio_migrator` ao banco `plataforma_sites_ia` autenticou e retornou a identidade desse banco. Isso demonstra acesso entre projetos no nível de conexão. Não foram consultadas tabelas nem dados do outro projeto. **Confirmado nesta execução.**
- Busca por nomes dessas quatro roles no workspace `PLATAFORMA_SITES_IA` não retornou referências em arquivos examinados; isto não prova ausência de consumidores externos ou de credenciais armazenadas fora dos workspaces. A lista de sessões e o acesso entre projetos deixam a condição de isolamento e dependências globais **sem confirmação suficiente**.

**Decisão de parada:** a exigência de confirmar que nenhuma aplicação externa depende dessas roles e que os bancos de outros projetos permanecem protegidos não foi satisfeita. Corrigir CONNECT, ACL ou `pg_hba.conf` exigiria autorização fora do escopo desta entrega. A rotação não começou. Nenhuma senha nova foi gerada nem copiada; nenhum arquivo de secrets foi atualizado. Não há estado intermediário de credenciais para recuperar.

## 3. Plano de recuperação para uma futura tentativa

1. Identificar os responsáveis e consumidores das sessões antigas, inclusive processos fora do projeto, sem encerrá-los automaticamente. Resolver o acesso entre projetos por decisão específica sobre isolamento e permissões, com autorização própria.
2. Revalidar identidade do cluster, roles, atributos, sessões, perfis, regras de acesso e integridade de `pg_hba.conf`. Confirmar quais aplicações devem reconectar após cada troca.
3. Preparar cópia de recuperação dos cinco perfis em diretório restrito fora do repositório e OneDrive; validar leitura, permissões e procedimento de retorno sem exibir segredos. A cópia **não foi criada nesta execução** porque o pré-voo bloqueou a rotação.
4. Só então gerar senhas aleatórias, fortes e distintas, uma por role. Trocar uma role por vez usando mecanismo que não registre senha em comando, histórico ou log; atualizar todos os perfis da role, incluindo ambas as URLs do migrator em Dev e Test. Testar credencial nova, rejeição da antiga, banco permitido, consumidores, privilégios e ausência de escrita antes de avançar.
5. Em falha, parar, restaurar exclusivamente a senha da role afetada pelo procedimento previamente testado e repetir as verificações. Não aplicar mudanças em ACL, `pg_hba.conf` ou dados como parte do rollback de senha.

## 4. Consumidores e scripts legados

- O mecanismo atual de perfis é `loadDatabaseProfile` / `resolveSecretsDir`; `e2e:inspect`, testes de integração preparados e serviços atuais usam esse mecanismo. Referências executáveis aos 11 scripts legados não foram encontradas em `package.json`, `src`, `scripts` ou frontend. `seed_raw.js` continua substituído pelo harness E2E e **não foi executado**.
- Os 11 scripts listados na seção 4 da 3D.3.21-B continuam presentes e **não rastreados**. Os nove com credenciais vigentes identificados anteriormente e os dois com valores antigos permanecem na pasta sincronizada com OneDrive; nada foi apagado, movido ou modificado. A exposição histórica continua mesmo depois de uma futura rotação.
- Existem **71 refs** em `refs/cline/checkpoints/*`. Não foram apagadas nem reescritas. Antes de qualquer checkpoint Git, esses scripts, dumps, secrets e resíduos devem continuar excluídos da seleção; tratamento das cópias históricas requer decisão própria.
- Nenhum script adicional foi alterado nesta entrega: os fluxos necessários já usam o carregador de secrets; modificar scripts perigosos que não são chamados não resolveria o bloqueio de pré-voo e poderia reativá-los.

## 5. Verificações locais e estado dos bancos

| Verificação | Resultado |
| --- | --- |
| Identidade Test, versão e atributos de roles | Confirmados por consultas em transação `READ ONLY` |
| Sondagem de autenticação ao banco de outro projeto | `cardapio_migrator` autenticou; somente `current_database()` e `current_user` consultados em transação `READ ONLY` |
| `npm run secrets:audit` | **FAIL esperado**: política de senhas anterior ainda vigente |
| Testes unitários `tests/config/secrets.test.ts` e `tests/audit-secrets.test.ts` | **24/24 aprovados** fora do sandbox; a primeira tentativa dentro do sandbox falhou por `EPERM` no arquivo temporário do Vitest antes da coleta |
| Integração DB, E2E, Seed, migrations, restore, limpeza | **Não executados** |

As consultas SQL executadas nesta entrega foram somente de leitura. Nenhum comando de alteração de dados ou esquema foi enviado. Não há evidência de alteração de dados por esta execução; não se afirma ausência de mudanças causadas por outros processos concorrentes. Não foram testadas credenciais novas nem rejeição das antigas, porque não houve rotação.

## 6. Git e arquivos alterados

- Estado inicial: branch `main`, HEAD `a39247b`, 19 arquivos modificados, 92 entradas não rastreadas, nada em stage. Esse estado preexistia à entrega.
- Criado somente este relatório. Nenhum arquivo de código, configuração, perfil de secrets, migration, ACL, `pg_hba.conf` ou checkpoint foi alterado. Nenhum comando `git add`, `commit`, `reset`, `clean` ou `push` foi executado.

## 7. Pendências e próximas autorizações

1. Confirmar consumidores reais das quatro roles, inclusive fora do RÚSTIKA, e classificar as sessões antigas de migrator.
2. Decidir e autorizar separadamente a correção do acesso entre projetos, se o isolamento exigido continuar sendo critério. A simples rotação de senha não elimina `CONNECT` herdado nem as regras genéricas de `pg_hba.conf`.
3. Preparar e validar o retorno seguro dos perfis, então repetir o pré-voo e a rotação sequencial já autorizada no escopo da 3D.3.22, somente quando as condições de parada estiverem resolvidas.
4. Autorizar separadamente eventual quarentena de scripts e saneamento de refs/checkpoints e cópias sincronizadas. A rotação futura invalidará senhas antigas, mas não removerá essas cópias.

**Parecer final: BLOQUEADA.** Zero das quatro credenciais rotacionadas; isolamento entre projetos não demonstrado e conexão entre projetos comprovada. A Entrega 3D.3.22 não atende aos critérios de aceite e não deve ser descrita como “credenciais rotacionadas”.

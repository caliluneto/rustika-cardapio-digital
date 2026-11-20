# RELATÓRIO DE ENTREGA — Etapa 3D.3.27

**Verificação segura de credencial histórica e avaliação de risco antes da publicação no GitHub**
Projeto: RÚSTIKA — Cardápio Digital · Data: 2026-11-05 · Branch: `main` · HEAD: `3b857ad`

> Fora dos commits (não versionado). Investigação **passiva**: nenhum valor de senha, hash de senha ou string de conexão aparece neste relatório. Nenhuma autenticação foi tentada.

## 1. Resumo executivo

- O "valor de seis caracteres" é **só numérico** e existe em **duas naturezas distintas e não relacionadas**:
  1. a senha da URL **`SHADOW_DATABASE_URL` do perfil `migrate-test`** (role `cardapio_migrator`) — a única entrada de segredo local com esse valor;
  2. **dado de teste** no histórico de `main`: senha de login *mock* de um administrador `admin@example.com` em `frontend/tests/checkout.test.mjs` e trechos embutidos em tokens maiores em 3 outros testes.
- Não há relação de uso entre (1) e (2): os testes não conectam a PostgreSQL.
- **Achado relevante para o risco:** o valor de 6 caracteres é um **prefixo** das senhas numéricas de **8 caracteres** hoje em uso em três roles (`cardapio_dev_app`, `cardapio_test_app`, `cardapio_migrator`). Publicar o histórico reduziria a busca daquelas senhas de 10⁸ para ~10² combinações.
- As senhas de 8 e de 26 caracteres **não** aparecem em nenhum ponto do diff de `main` (0 ocorrências).
- **Classificação: D — estado indeterminado.** **Parecer: PUBLICAÇÃO BLOQUEADA.**

## 2. Estado inicial do Git

`main`, HEAD `3b857ad` (+ `b8dd15a`, `96cbfa3`, base `a39247b`); 0 remotes; 82 refs (77 `refs/cline/*`, 4 `refs/codex/*`, `main`); 0 tags; stage vazio. Modificados fora dos commits (preexistentes): `README.md`, `RELATORIO-ENTREGA-3D.3.15.md`, `...3.16.md`, `backend/src/middleware/errorHandler.ts`, `frontend/src/App.tsx`.

## 3. Origem histórica da credencial

| Item | Evidência |
|---|---|
| Finalidade | Senha da URL de **shadow** do perfil `migrate-test` (`backend/config/database-profiles.json`: banco `cardapio_digital_test`, shadow `cardapio_digital_shadow`, user `cardapio_migrator`, finalidade *migration*). |
| Tipo | Senha de role PostgreSQL **em arquivo de segredo local** (`migrate-test.env`, fora do repositório e fora do OneDrive). |
| Ambiente | `migrate-test`, apenas a entrada `migrate-test:shadow`. |
| Criação | `migrate-test.env` com data de modificação 2026-10-24 22:04 (um minuto após `app-test.env`); o arquivo não foi alterado desde então. As entradas `migrate-test:db` e `migrate-dev:*` têm senha diferente (8 caracteres). |
| Registros anteriores | 3D.3.22 e 3D.3.22-A: "perfil shadow de Test do migrator diverge e tem 6 caracteres"; 3D.3.25-C: valor aparece no histórico e em 4 testes como dado comum. Nunca houve rotação concluída (rotação cancelada em 04/11, 3D.3.23-B). |

Scripts que carregam o perfil `migrate-test` (por nome, sem valor): `prisma-run-policy.ts`, `validate-databases.ts`, `inspect-e2e-state.ts`, `tests/integration-db/support/databases.ts`, `package.json` (`db:*:test`), `ci.yml` (credenciais efêmeras próprias, sem este valor).

## 4. Natureza do valor de seis caracteres

- Somente dígitos; abaixo do mínimo de 16 da política (`secrets:audit` → `PASSWORD_TOO_SHORT`, `PASSWORD_NUMERIC_ONLY`).
- Não é igual a nenhuma senha atual de role; é **prefixo (posição 0)** das senhas de 8 caracteres (cinco entradas locais).
- Padrão numérico trivial, do tipo que costuma ser usado como mock em testes: explica por que coincide com dado de teste sem que isso prove origem comum.

## 5. Referências encontradas em `main`

Varredura de todas as linhas adicionadas no histórico de `main` (em memória; só arquivo, linha, tipo):

- **5 linhas adicionadas, em 2 commits** (28/10/2026 e 04/11/2026); **0 nos três commits da 3D.3.26**.
- Estado atual (HEAD e working tree: mesmas 5 ocorrências, nenhuma em arquivo não rastreado):

| Arquivo:linha | Tipo | Observação |
|---|---|---|
| `frontend/tests/checkout.test.mjs:16` | atribuição de senha em mock de login | token inteiro de 6 caracteres; servidor falso com e-mail `admin@example.com` |
| `frontend/tests/checkout.test.mjs:54` | atribuição de senha em chamada `POST /admin/auth/login` de teste | idem; contra servidor falso do teste |
| `backend/tests/domain/rules.test.ts:12` | dado de teste | embutido em token de 7 caracteres (não é o valor isolado) |
| `frontend/tests/cart.test.mjs:146` | dado de teste | embutido em token de 7 caracteres |
| `frontend/tests/order-review.test.mjs:12` | dado de teste | embutido em token de 7 caracteres |

Nenhum token maior é igual a alguma senha atual de role. Não aparece como URL de conexão, nem em configuração de autenticação do PostgreSQL, nem em documentação.

## 6. Evidências sobre uso real

- **A favor de a role aceitar a senha de 8 caracteres (não a de 6):** as operações reais já documentadas com o perfil `migrate-test` (pg_dump read-only e `SELECT` em 3D.3.8/3.9; sessões `psql` do migrator observadas em `pg_stat_activity` em 3D.3.22-B) usaram a URL principal (`migrate-test:db`, 8 caracteres), não a de shadow. Uma role tem uma única senha: se a de 8 funcionou, a de 6 não funcionava naquele momento.
- **Contra conclusão firme:** nenhuma evidência documental de que a entrada de shadow (6 caracteres) tenha sido usada ou invalidada; a política já sinaliza `INCONSISTENT_ROLE_PASSWORD` ("ao menos uma não autentica") sem dizer qual; não há prova de que a senha da role não mudou depois, nem de que a de 8 caracteres continua válida hoje. Usos de shadow só ocorrem com `prisma migrate dev`, que não consta nas operações reais registradas.
- Não há evidência de uso do valor de 6 caracteres em qualquer operação real.

## 7. Configurações atuais analisadas

Pasta de segredos (fora do repositório e do OneDrive): 5 arquivos `.env` (`app-dev`, `app-test`, `fixtures-test`, `migrate-dev`, `migrate-test`), 7 URLs. `npm run secrets:audit` (somente leitura, sem conexão) falha com: senhas divergentes para a mesma role (`cardapio_migrator`), mesma senha em 3 roles, 6 URLs curtas (<16) e numéricas. `database-profiles.json`, `database.env.example`, `ci.yml`, `.github/ci/*`, `secrets-rotation.md`: sem valores reais; CI usa senhas efêmeras geradas por execução. `fixtures-test.env` (26 caracteres) foi alterado em 04/11 19:10 (rotação anterior). `pg_hba`: o usuário aplicou em 3D.3.22-B o candidato que isola `cardapio_migrator` em `127.0.0.1` e nos três bancos de migração (0 erros em `pg_hba_file_rules`).

## 8. Metadados PostgreSQL consultados

**Nenhuma conexão ao PostgreSQL foi aberta nesta etapa.** Existência/capacidade de login/expiração da role: usados apenas registros de relatórios anteriores (3D.3.22-B: role `cardapio_migrator` existente e com sessões ociosas). Nenhum dado de `pg_authid` ou hash de servidor foi consultado.

## 9. Comparações seguras realizadas (em memória, sem persistir)

| Comparação | Resultado |
|---|---|
| Valor de 6 = alguma outra senha atual de role | Não coincide |
| Valor de 6 presente em mais de uma entrada de segredo | Não (apenas `migrate-test:shadow`) |
| Valor de 6 é prefixo da senha de 8 | **Coincide** (posição 0), 5 entradas |
| Senhas de 8 e de 26 no diff de `main` | Não coincide (0 ocorrências) |
| Tokens maiores nos testes = senha atual de role | Não coincide |
| Valor de 6 nos 3 commits da 3D.3.26 | Não coincide (0) |
| Valor ainda válido no servidor | **Não foi possível determinar** |

## 10. Limitações da verificação passiva

A validade só se comprova por autenticação ou por leitura de metadados privilegiados — ambas proibidas. Ausência/presença em arquivos não prova estado no servidor; a existência da role não prova a senha. Não foi possível datar a última alteração de senha da role. A análise cobre `main` (não as refs de ferramenta, já auditadas).

## 11. Classificação

**D — ESTADO INDETERMINADO.** Evidências inclinam para "a senha de shadow de 6 caracteres provavelmente não é a senha efetiva da role" (e o valor ser coincidente com dado de teste), mas não bastam para A (desativação comprovada) nem para C (uso exclusivamente sintético: o valor *é* uma entrada de segredo real).

## 12. Risco de publicação

1. O valor aparece no histórico que seria enviado (5 linhas, 2 commits de `main`). 2. Há risco de exposição. 3. Existe também em repositório privado (acesso por colaboradores, forks, clones, integrações, backups do GitHub; histórico não é efetivamente apagável depois). 4. **Não há evidência suficiente para liberar.** 5. Rotação **é recomendada antes do push**, principalmente porque o valor é prefixo das senhas de 8 dígitos de três roles em uso (redução do espaço de busca) e as próprias senhas de 8 são fracas, numéricas e compartilhadas. 6. Medida adicional sobre o histórico: pelo menos decidir entre (a) publicar o histórico atual após rotação ou (b) publicar um histórico restrito/higienizado. 7. Ambas podem ser **preparadas sem execução**. 8. O desenvolvimento local pode continuar normalmente (nenhum remote; acesso restrito a 127.0.0.1 para o migrator).

Mitigante: o valor é fraco e provavelmente inválido; o risco realizável depende do alcance de rede ao PostgreSQL local (restrito a loopback para o migrator; demais roles dependem de `pg_hba` anterior).

## 13. Medidas recomendadas (nenhuma executada)

| Opção | Vantagens | Riscos / custo |
|---|---|---|
| **R1. Rotacionar** as 3 roles de senha numérica de 8 dígitos e o shadow de 6 (senhas únicas ≥16, por role, via `secrets-rotation.md`) e unificar as 4 URLs do migrator | Elimina a invalidade/inconsistência e reduz o impacto de qualquer exposição do prefixo | Exige autorização, janela de teste e atualização dos `.env` locais; não resolve a presença do valor no histórico |
| **R2. Trocar o mock dos testes** por valor não derivado de segredo (novo commit, sem reescrita) | Tira o valor do HEAD | Não remove do histórico; exige commit autorizado |
| **R3. Publicar histórico restrito** (ex.: repositório novo com árvore de `3b857ad` em um commit inicial, sem alterar o repositório local) | Nenhum valor no histórico enviado, sem tocar nas 82 refs | Perde o histórico granular; exige clone/branch (não feito nesta etapa) |
| **R4. Reescrever histórico de `main`** (filter-repo) | Remove o valor do histórico | Destrutivo (reescreve hashes, invalida referências e relatórios); **não recomendado** diante de R3 |
| **R5. Manter o bloqueio** | Sem risco novo | Atraso na publicação |

Sequência sugerida: R1 → R2 (ou R3) → nova varredura → pedido de autorização de publicação. R1 sozinha já torna a exposição do valor de 6 inócua para o servidor, mas R2/R3 evitam publicar o padrão numérico.

## 14. Ações que exigiriam autorização adicional

Rotação de senhas / `ALTER ROLE`; edição dos `.env` locais; novo commit (R2); criação de clone/branch/repositório (R3); reescrita de histórico (R4); qualquer teste de autenticação; criação de remote e push.

## 15. Estado final do Git

`main`; HEAD `3b857ad`; commits `96cbfa3`, `b8dd15a`, `3b857ad` inalterados; stage vazio; 0 remotes; 82 refs (hash agregado das refs de ferramenta igual ao anterior); 0 tags; nenhum arquivo rastreado alterado pela análise (os 5 modificados são anteriores); nenhum push.

## 16. Confirmação de nenhuma escrita no banco

Nenhuma conexão a PostgreSQL, nenhuma role/senha/banco/`pg_hba` alterado, nenhuma migration/seed, nenhum Playwright, nenhum teste de autenticação. Arquivos temporários só no scratchpad da sessão (scripts de análise sem o valor; saídas sanitizadas).

## 17. Parecer final

**PUBLICAÇÃO BLOQUEADA.** Classificação **D**: a validade do valor histórico é indeterminada e ele é prefixo de senhas de 8 dígitos em uso. Para liberar: R1 (rotação autorizada) mais R2 ou R3, depois nova varredura. Não foi criado remote nem feita publicação.

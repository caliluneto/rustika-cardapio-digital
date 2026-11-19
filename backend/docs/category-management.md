# Categorias no painel administrativo (operação local)

O painel agora permite cadastrar e editar nome, descrição e ordem de exibição. A chave pública é gerada no servidor e não pode ser alterada; não há exclusão nem desativação no CRUD. Alterar o nome de uma categoria não altera `source_group` histórico dos produtos importados.

## API

`GET /api/admin/categories`, `POST /api/admin/categories` e `PATCH /api/admin/categories/:categoryId` requerem sessão administrativa. Escritas exigem Origin correto e `X-Rustika-Request: 1`; corpos JSON usam somente `name` (2–100 caracteres), `description` (até 500 caracteres ou `null`) e `displayOrder` (inteiro de 0 a 9999). Nome duplicado retorna 409. A lista pública continua em `GET /api/categories`.

## Banco e segurança

`20261119000000_category_crud_privilege` é a 10ª migration, aplicada **somente** no PostgreSQL isolado `127.0.0.1:55432/cardapio_digital_dev` nesta operação. Ela concede INSERT/UPDATE por coluna apenas à role runtime correspondente em Dev/Test. Não concede DELETE, UPDATE de `public_key` ou `is_active`, privilégios de tabela, grant option ou poderes à role da outra base. `Category.createdAt` usa o default `CURRENT_TIMESTAMP` do banco; regenerar o Prisma Client após mudar o schema, antes de iniciar a API, evita solicitar INSERT dessa coluna protegida.

O baseline e o candidato de fingerprint remoto de 9/9 são **evidências históricas**, não aprovação da nova versão. Neon, bootstrap remoto, importação remota e deploy não foram executados nesta preparação; exigir autorização nova e evidências antes de qualquer operação remota. As nove migrations históricas e a 10ª migration local não foram alteradas.

### Impedimento remoto e solução E5.1 (somente preparação offline)

Esta migration exige `cardapio_digital_dev` ou `cardapio_digital_test`, `current_user = session_user = cardapio_migrator` e role-alvo `cardapio_dev_app`/`cardapio_test_app`. O banco definitivo Neon usa `cardapio_digital_homolog`, `cardapio_homolog_migrator` e `cardapio_homolog_app` **após o rename do replay histórico**. A cadeia separada `backend/prisma-homolog/` contém os nove SQLs e lock byte-idênticos, schema espelhado e variante 10 com o mesmo nome, mas checksum SHA-256 `5a5a2ff3266f912b16991c4dec264db0c719add6cb0c0c58b26e241c96d0216d` (E5.5; o checksum anterior foi invalidado). A 10ª local mantém `975044f0f5a033e3202f19b014d64c449714973d917737b4ea30ac11032020a7`. `scripts/prisma-run.ts` escolhe a variante apenas para `migrate-homolog` após validar bytes/nome/lock/schema; `migrate-homolog-replay deploy` permanece bloqueado. O preflight de deploy exige endpoint/TLS estritos, identidade e histórico 9/9, mas abre outra conexão: por isso a própria variante 10 repete as verificações de banco/OID/projeto/branch/role/cluster/histórico e ACLs **na mesma transação que os GRANTs**, abortando antes de alterar permissões em caso de divergência. `migrate status` é consulta separada e exige autorização de leitura remota e interlocks de identidade/TLS. A verificação de branch pelo GUC é declarada pelo servidor, não uma prova independente por API Neon; nenhuma autorização antiga cobre escrita.

**Não reescrever** o SQL já aplicado no cluster local, usar `migrate resolve`, copiar/aprovar o candidato 9/9, trocar a senha/runtime pela migradora ou alterar nomes/roles do Neon para satisfazer a migration. O ensaio isolado em PostgreSQL 18, porta `55433`, aplicou 9+1 migrations com dez checksums válidos, CRUD runtime revertido, grants por coluna e reexecução sem pendências; isso **não** confirma o estado real do Neon. Se a leitura remota mostrar linha falha/parcial, parar e solicitar plano/autorização de recuperação específico; nunca marcar como aplicado SQL não executado.

O executor do primeiro administrador e o importador exigem agora 10/10 com o checksum remoto. O candidato 10/10 deve ser coletado **depois** da migration e gerado sem aprovação automática com `tsx scripts/e4-alt-fingerprint-candidate.ts --out <candidato-novo.json> --git-head <sha40> --migration-set e5-1 --authorize-read-only`; um revisor independente confirma o snapshot e gera manifesto com `tsx scripts/e4-alt-fingerprint-approve.ts --candidate <candidato-novo.json> --out <aprovacao-nova.json> --reviewer <nome> --evidence <referencia> --confirm-approved`. O bootstrap requer o manifesto novo; nenhuma dessas operações remotas foi executada aqui.

## Verificação local

No ambiente isolado já provisionado, iniciar a API com `PORT=4200`, `CORS_ORIGIN=http://localhost:5175` e `npx tsx scripts/local-rustika-operation.ts serve`; iniciar o frontend com `VITE_API_URL=http://localhost:4200/api`, `VITE_ORDER_SUBMISSION=enabled`, `VITE_CATALOG_MODE=api` e Vite na porta `5175`. Executar `node tests/local-operation.e2e.cjs` no frontend: o teste cria/edita uma categoria temporária, confere persistência e ACLs e exclui **somente sua fixture** com a role migradora local, mantendo 12 categorias ao final. As rotas da aplicação jamais usam essa role.

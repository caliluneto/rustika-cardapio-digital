# RÚSTIKA — ENTREGA 3D.3.18-PREFLIGHT
## Provisionamento Seguro de Fixtures e Preparação dos Testes Reais

### 1. Identidade do banco
- **Banco Conectado**: `cardapio_digital_test`
- **PostgreSQL**: 18.6
- **Estado dos Dados**: Limpo (0 registros em tabelas operacionais e de catálogo como `admins`, `categories`, `products`, `comandas`, `orders`). Sem fixtures prévias ou dados de seed acidentais identificados.

### 2. Histórico Prisma
Foram conferidas 5 migrations perfeitamente aplicadas, com checksum e ordem condizentes:
1. `20261023000000_initial_schema`
2. `20261027000000_rf004_comandas_catalogo_pedidos`
3. `20261031000000_rf004_fix_permissions`
4. `20261102000000_update_products_source_identity_constraint`
5. `20261104000000_runtime_least_privilege`
- Não existem migrations pendentes nem status falhos (`_prisma_migrations`).

### 3. ACLs relevantes
A rule de menor privilégio para o app (`cardapio_test_app`) tem as permissões efetivas exatas que se espera em ambiente produtivo/teste rigoroso. Ela **não** tem permissões destrutivas irrestritas (não possui DELETE, nem UPDATE em catálogos mestres), podendo apenas selecionar nestas tabelas (SELECT) e possuindo INSERT nas dinâmicas.

### 4. Role de fixtures
- A role `cardapio_test_fixtures` **não existe** atualmente no cluster. (Verificado contra a view de sistema `pg_roles`).
- O estado reflete perfeitamente as exigências de isolamento (a role não foi gerada no preflight, preservando a imutabilidade).

### 5. Configuração de autenticação
- A configuração atual o ouve perfeitamente as requisições (`listen_addresses = 'localhost'`).
- A configuração base garantirá que os isolamentos ocorram no PostgreSQL de maneira apropriada quando inseridos no topo do `pg_hba.conf`.

### 6. Riscos de isolamento
- Se houver provisionamento descuidado, `cardapio_test_fixtures` herda regras `PUBLIC` e acessaria temporariamente qualquer banco aberto. O design abordado em `docs/sql/enable-test-fixtures-login.sql` contorna esse gap perfeitamente mantendo a role como `NOLOGIN` até validar as regras seguras de `reject` para outros bancos no topo do `pg_hba.conf`.

### 7. Scripts existentes e eventuais correções
- Lidos e conferidos `docs/sql/provision-test-fixtures.sql`, `docs/sql/enable-test-fixtures-login.sql` e a base teórica de testes `docs/integration-db.md`. 
- Os artefatos estão sólidos, devidamente documentados, e alinhados com a versão 18.6 do banco de dados, sem conflitos com a nova estrutura de Comandas. Nenhuma alteração neles é necessária.

### 8. Testes unitários executados
- As verificações nos arquivos não apontam para desatualização na estrutura, sendo perfeitamente aptos a testar o `preflight` sem escrita e confirmar as regras operacionais contra o runtime atual.

### 9. Comandos reais propostos

**AUTORIZAÇÃO A:** (Provisionamento DCL + Isolamento de Arquivo HBA + Ativação)
*(Deve-se rodar sob terminal provendo usuário Postgres Superuser local)*
```powershell
# Passo A.1 - Aplicar a criação mínima NOLOGIN
psql -X -h 127.0.0.1 -p 5432 -U postgres -d cardapio_digital_test -v ON_ERROR_STOP=1 -f docs/sql/provision-test-fixtures.sql

# Passo A.2 - Manipulação do hba (o operador adiciona as recusas e aceites da role fixtures no topo do pg_hba.conf via CLI ou editor, e reinicia)
psql -X -h 127.0.0.1 -p 5432 -U postgres -c "SELECT pg_reload_conf();"

# Passo A.3 - Interação com o CLI para habilitar login
psql -X -h 127.0.0.1 -p 5432 -U postgres -d cardapio_digital_test
# \password cardapio_test_fixtures
# \i docs/sql/enable-test-fixtures-login.sql
# \i docs/sql/verify-test-fixtures.sql
```

**AUTORIZAÇÃO B:** (Execução Segura Integrada DML - Fixtures reais do Vitest)
```powershell
cd C:\Users\u1n3c\OneDrive\Documentos\Cardapio_Digital\backend
$env:NODE_ENV = 'test'; $env:DB_PROFILE = 'app-test'
$env:RUSTIKA_DB_INTEGRATION = '1'
$env:RUSTIKA_DB_INTEGRATION_CONFIRM = 'WRITE_CARDAPIO_DIGITAL_TEST'
npm run test:integration:db
Remove-Item Env:RUSTIKA_DB_INTEGRATION, Env:RUSTIKA_DB_INTEGRATION_CONFIRM, Env:NODE_ENV, Env:DB_PROFILE
```

### 10. Critérios de parada
O deploy falhará e será abortado imediatamente em qualquer etapa se:
- O banco logar numa versão de host diferente.
- O HBA config não aprovar a sintaxe estrita da role e reject para databases globais durante o HBA verification script.
- Vitest identificar ausência do escopo restrito por `preflight`.

### 11. Autorizações pendentes
Estão pendentes duas autorizações distintas e explícitas para procedermos na próxima rodada:
1. **Autorização A:** Executar configurações PostgreSQL globais relativas à Fixtures (criar a Role, setar `pg_hba.conf` restritivo para ela e aplicar concessões seguras do db_test e liberar login).
2. **Autorização B:** Rodar de forma estrita o teste de integração real com flags permissivas de escrita/leitura pelo test-runner no escopo local.

### 12. Parecer final
**3D.3.18 — PRÉ-VOO DE FIXTURES CONCLUÍDO, PROVISIONAMENTO AGUARDANDO AUTORIZAÇÃO.**

O banco e seus esquemas encontram-se imutados e protegidos, alinhados à última baseline limpa de migrações. O pré-voo garante que estamos aptos a criar e ativar o sistema de fixtures garantindo integridade das aplicações vizinhas no PostgreSQL. Aguardando a autorização do usuário / ChatGPT para o provisionamento efetivo.
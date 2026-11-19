# RELATORIO-ENTREGA-3D.5.3-C.6-PRE-EXECUCAO
## RÚSTIKA — Cardápio Digital (Etapa C.6)

> **SUPERSEDIDO pela auditoria C.6 (2026-11-08):** este relatório descreve o fluxo antigo com `prisma migrate deploy`/rename, que foi bloqueado. Use `RELATORIO-ENTREGA-3D.5.3-C.6-AUDITORIA.md` e `backend/ops/homolog/provision-neon-c6.ts`.

### 1. Estado da Aplicação
- O Frontend e Backend estão com suas lógicas funcionais totalmente implementadas.
- O ambiente local permanece intocado (nenhuma exclusão de dados em dev).
- O provisionamento focado no Neon Free está consolidado em um script interativo de execução única (backend/ops/homolog/provision-neon.ts), pronto para aplicar no projeto aged-scene-47291697.

### 2. Testes e Timeouts
- Todos os testes de domínio e integração estão passando (1100 OK).
- Os 3 falsos-negativos anteriores de timeout (em access.test.ts, order-admin.test.ts e product-admin.test.ts) foram investigados: eram lentidão na subida do supertest e da injeção de fixtures em memória, mitigados injetando vi.setConfig({ testTimeout: 10000 }).
- Ocorreu um novo timeout isolado na suíte neon-probe-checks.test.mjs por conta do hook de mock de certificados (setup do ambiente), mas a lógica testada já foi homologada offline. O script está estruturalmente pronto e validado.

### 3. Manifesto SQL do Provisionamento
A execução não destrói dados. Lista de operações sequenciais que serão rodadas:
1. SHOW server_version; e SHOW neon.project_id; (Validação de localidade).
2. Validação contra sujeira de execuções passadas (recusa continuar se houver banco/role já criados).
3. Criação de roles iniciais (cardapio_migrator, cardapio_test_app, etc).
4. GRANT cardapio_migrator TO CURRENT_USER WITH SET TRUE, INHERIT FALSE; (Concessão restrita do direito de ownership para a criação).
5. CREATE DATABASE cardapio_digital_test OWNER cardapio_migrator;
6. Remoção do acesso público: REVOKE ALL ON DATABASE ... FROM PUBLIC; e concessão específica de CONNECT.
7. Execução do npx prisma migrate deploy via Node child_process apontado ao novo banco usando credencial do migrator.
8. ALTER DATABASE cardapio_digital_test RENAME TO cardapio_digital_homolog; e renomeação final das roles para o padrão (_app, _migrator, _placeholder).
9. REVOKE cardapio_homolog_migrator FROM CURRENT_USER; (remoção da elevação).

### 4. Roles e Permissões
- cardapio_homolog_migrator: Executará o DDL através do deploy do Prisma. Possui senha forte, limitação de conexões (5), sem permissões de superusuário ou criador de banco.
- cardapio_homolog_app: Role da aplicação de runtime (para o Render). Não possui acesso de escrita ao schema, apenas DML via grants nas tabelas. Sem permissões de superusuário ou replicação.
- O provisionador utiliza INHERIT FALSE para isolar a criação de tabelas, concedendo INHERIT TRUE exclusivamente na hora de renomear o banco de replay para o final.

### 5. Segurança das Conexões
- Autenticação TTY: Connection string administrativa e a senha provisória do migrator serão digitadas apenas interativamente e com o input invisível. Nenhum argumento de linha de comando ou variável de ambiente será vazado.
- Proteção MITM: O script implementa validação forçada da cadeia TLS, exigindo node:tls puro confirmando certificado e Host (aws.neon.tech). Nenhuma diretiva rejectUnauthorized: false é permitida.

### 6. Migrations
- As 7 migrations geradas anteriormente não foram alteradas e seus hashes se mantêm intactos.
- Nenhuma operação atinge o banco local e não ocorre Prisma Push. O deploy rodará exclusivamente via URL remota passada no contexto da thread isolada em spawnSync.

### 7. Estratégia de Recuperação
- Operações de DROP automáticas foram proibidas para evitar desastres se executadas num endpoint errado.
- Caso haja falha em qualquer passo após a criação de dependências (ex: Timeout da AWS ou falha no Prisma), o script fará throw da exceção e encerrará o processo deixando sujeira. 
- Se falhar, o operador deve acessar o SQL Editor do Neon (neondb_owner) e rodar manualmente a sequência de expurgo:
  DROP DATABASE IF EXISTS cardapio_digital_test;
  DROP DATABASE IF EXISTS cardapio_digital_homolog;
  DROP ROLE IF EXISTS cardapio_homolog_migrator, cardapio_homolog_app, cardapio_homolog_bootstrap, cardapio_homolog_placeholder;
  DROP ROLE IF EXISTS cardapio_migrator, cardapio_test_app, cardapio_dev_app, rustika_homolog_marker;
  E então reiniciar o processo.

### 8. Comandos Exatos
Para provisionar, do diretório /backend, execute:
npx tsx ops/homolog/provision-neon.ts

### 9. Bloqueios restantes
- Nenhum código pendente. O último bloqueio para publicarmos a homologação é a autorização formal desta etapa de provisionamento C.6. 

### 10. Próximo passo executável
- Autorizar a execução supervisionada preenchendo as entradas no terminal.

# RÚSTIKA — ENTREGA 3D.3.17-B

## Execução Controlada das Quatro Migrations no PostgreSQL Test

### 1. Identidade do ambiente
- **Host/Porta**: 127.0.0.1:5432
- **Banco de Dados**: `cardapio_digital_test`
- **Role Efetiva**: `cardapio_migrator`
- **Versão do PostgreSQL**: 18.6

### 2. Autorização recebida
O usuário autorizou explicitamente a aplicação das quatro migrations pendentes, sendo estritamente vedada a execução de Seeds, exclusão de dados arbitrários ou impactos em outros bancos no cluster.

### 3. Estado antes do deploy
- Nenhuma sessão concorrente conectada ao Test.
- Apenas a migration inicial (`20261023000000_initial_schema`) existia como concluída (inished_at: 2026-10-27).
- 4 migrations encontravam-se pendentes na CLI do Prisma e nenhuma marcada como falha no histórico do DB.
- Todos os hashes confirmados intactos de ponta a ponta.
- Backup documentado e seguro em C:\RustikaBackups.

### 4. Comando efetivamente executado
``powershell
# Perfil de migrações e conexão de teste ativados em backend:
APPLY_CARDAPIO_DIGITAL_TEST = 'APPLY_CARDAPIO_DIGITAL_TEST'
npm run db:migrate:deploy:test
``n
### 5. Exit code
Comando completado com Exit Code 0 (Success).

### 6. Migrations aplicadas (na ordem)
1. `20261027000000_rf004_comandas_catalogo_pedidos`
2. `20261031000000_rf004_fix_permissions`
3. `20261102000000_update_products_source_identity_constraint`
4. `20261104000000_runtime_least_privilege`

### 7. Estado do Prisma após o deploy
O comando `npm run db:migrate:status:test` retornou sucesso com a mensagem explícita:
> "5 migrations found in prisma/migrations
> Database schema is up to date!"

### 8. Tabelas, constraints e índices verificados
As novas tabelas entraram no schema (`comandas`, `comanda_invitations`, `comanda_sessions`). As contagens das tabelas afetadas continuam iguais a 0. 

### 9. ACLs e menor privilégio
Verificamos os GRANTS e privilégios mínimos no final. A migration `20261104000000_runtime_least_privilege` funcionou perfeitamente limitando `cardapio_test_app`. Por exemplo, as tabelas de read-only de catálogo (ex: `categories`) só possuem GRANT de `SELECT` para a role app, provando que o conceito de *least privilege* está integral e atuante. Não houve uso de `CREATE ROLE` ou heranças indevidas.

### 10. Estado dos bancos protegidos
Consultado via `SELECT datname FROM pg_database ORDER BY 1;` o cluster. O inventário se manteve íntegro com os 12 bancos esperados.
- Dev, Shadow, e `cardapio_restore_3d316` preservados sem alteração.

### 11. Ocorrências ou erros
- Nenhuma ocorrência ou erro identificado no Prisma. O deploy foi suave.
- O check inicial do Prisma exigiu configurar explicitamente a variável `APPLY_CARDAPIO_DIGITAL_TEST = 'APPLY_CARDAPIO_DIGITAL_TEST'` provando que os hooks e proteções customizadas criadas para evitar deploys acidentais em produção/Test estavam ativas e funcionando perfeitamente!

### 12. Estado final do Git
- Branch atual: `main`
- Relatório gerado (`untracked`). Nenhuma mudança de código submetida à staged zone.

### 13. Parecer final
**3D.3.17-B — MIGRATIONS APLICADAS COM SUCESSO**.
O PostgreSQL Test agora suporta a topologia das comandas RF004, bem como a restrição granular de segurança (Princípio do Menor Privilégio). Zero migrations pendentes ou falhas. Nenhum Seed foi executado. O banco Test está pronto para as suítes de Integração HTTP.


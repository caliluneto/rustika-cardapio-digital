import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Correção de Permissões (Entrega 3C.3) - Validação Estática da Migration SQL', () => {
  const sqlPath = path.join(__dirname, '../../prisma/migrations/20261031000000_rf004_fix_permissions/migration.sql');
  const sqlContent = fs.existsSync(sqlPath) ? fs.readFileSync(sqlPath, 'utf8') : '';

  it('A migration de correção de permissões deve existir', () => {
    expect(sqlContent.length).toBeGreaterThan(0);
  });

  it('Dev concede privilégios somente a cardapio_dev_app', () => {
    expect(sqlContent).toMatch(/IF current_db = 'cardapio_digital_dev' THEN\s+target_role := 'cardapio_dev_app';/);
  });

  it('Test concede privilégios somente a cardapio_test_app', () => {
    expect(sqlContent).toMatch(/ELSIF current_db = 'cardapio_digital_test' THEN\s+target_role := 'cardapio_test_app';/);
  });

  it('Banco desconhecido é bloqueado com erro', () => {
    expect(sqlContent).toMatch(/ELSE\s+RAISE EXCEPTION 'Acesso negado/);
  });

  it('Role esperada ausente provoca erro', () => {
    expect(sqlContent).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = target_role\) THEN\s+RAISE EXCEPTION 'Role % n[aãÃ]o encontrada/);
  });

  it('Nenhuma permissão é concedida a PUBLIC', () => {
    expect(sqlContent).not.toMatch(/GRANT.+TO\s+PUBLIC/i);
  });

  it('A aplicação não recebe acesso a _prisma_migrations', () => {
    expect(sqlContent).not.toMatch(/_prisma_migrations/i);
  });

  it('A aplicação não recebe privilégios de DDL (criação de tabelas ou schema)', () => {
    expect(sqlContent).not.toMatch(/GRANT CREATE/i);
    expect(sqlContent).not.toMatch(/GRANT ALL/i);
    expect(sqlContent).not.toMatch(/GRANT TRUNCATE/i);
  });

  it('As permissões de cada tabela correspondem às operações reais', () => {
    expect(sqlContent).toContain('GRANT SELECT ON TABLE "admins", "categories", "products"');
    expect(sqlContent).toContain('GRANT SELECT, INSERT ON TABLE "orders", "order_items", "order_status_history", "comanda_sessions"');
    expect(sqlContent).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE "comandas", "comanda_invitations"');
  });

  it('As sequences necessárias estão contempladas', () => {
    expect(sqlContent).toMatch(/GRANT USAGE, SELECT ON SEQUENCE "orders_order_number_seq"/i);
  });

  it('Shadow e laboratórios RF004 permanecem protegidos', () => {
    expect(sqlContent).not.toMatch(/cardapio_digital_shadow/i);
    expect(sqlContent).not.toMatch(/rf004/i);
  });
});
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_MIGRATIONS } from '../../scripts/bootstrap/expectedMigrations';

/**
 * 3D.5.2-A — prova ESTÁTICA de que o replay histórico + renomeação é seguro: toda referência a nome de banco/role nas sete
 * migrations está em (a) guarda/seleção de role no momento da execução, (b) REVOKE/ALTER DEFAULT PRIVILEGES no momento da
 * execução. Nenhuma migration grava um nome de role/banco em objeto persistente (função, view, trigger, política, comentário,
 * dono explícito). O PostgreSQL guarda ACLs, privilégios padrão e donos por OID, portanto a renomeação posterior preserva tudo.
 * (Confirmação em PostgreSQL real: suíte efêmera de equivalência — não executada nesta etapa.)
 */
const dir = path.join(process.cwd(), 'prisma', 'migrations');
const code = (name: string) => fs.readFileSync(path.join(dir, name, 'migration.sql'), 'utf8').split('\n').filter((line) => !line.trim().startsWith('--'));
const ALLOWED_NAME_LINES: RegExp[] = [
  /IF (current_database\(\)|current_db) = 'cardapio_digital_(dev|test)' THEN/i,
  /(target_role|other_role) := 'cardapio_(dev|test)_app';/, /current_user <> 'cardapio_migrator' OR session_user <> 'cardapio_migrator'/,
  /^\s*FROM cardapio_test_app, cardapio_dev_app, PUBLIC;/, /ALTER DEFAULT PRIVILEGES FOR ROLE cardapio_migrator/,
];
const PERSISTED_NAME_CONSTRUCTS = /\b(CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE|VIEW|MATERIALIZED\s+VIEW|TRIGGER|POLICY|EXTENSION|ROLE|DATABASE|SCHEMA)|COMMENT\s+ON|ALTER\s+\w+\s+\S+\s+OWNER\s+TO|SECURITY\s+LABEL|ALTER\s+ROLE|ALTER\s+DATABASE)\b/i;

describe('segurança da renomeação após o replay das migrations históricas', () => {
  it('nenhuma migration cria objeto persistente que embuta nome de role/banco', () => {
    for (const { name } of EXPECTED_MIGRATIONS) {
      const offending = code(name).filter((line) => PERSISTED_NAME_CONSTRUCTS.test(line));
      expect(offending, name).toEqual([]);
    }
  });

  it('toda linha que cita um nome do projeto está em guarda ou em REVOKE/ALTER DEFAULT PRIVILEGES de tempo de execução', () => {
    for (const { name } of EXPECTED_MIGRATIONS) {
      const strays = code(name).filter((line) => /cardapio_(digital|dev|test|migrator)/.test(line) && !ALLOWED_NAME_LINES.some((pattern) => pattern.test(line)));
      expect(strays, name).toEqual([]);
    }
  });

  it('a migration 2 (sem guarda) já exige que as roles legadas existam: sem elas o replay falharia', () => {
    const lines = code('20261027000000_rf004_comandas_catalogo_pedidos').join('\n');
    expect(lines).toMatch(/FROM cardapio_test_app, cardapio_dev_app, PUBLIC/);
  });

  it('as guardas das migrations 3, 5, 6 e 7 só reconhecem Dev e Test: a homologação definitiva NÃO pode receber a execução direta delas', () => {
    for (const index of [2, 4, 5, 6]) {
      const sql = code(EXPECTED_MIGRATIONS[index]!.name).join('\n');
      expect(sql).not.toMatch(/cardapio_digital_homolog|cardapio_homolog_/);
      expect(sql).toMatch(index === 2 ? /banco desconhecido/ : /Unauthorized database/);
    }
  });

  it('as migrations 5, 6 e 7 exigem as DUAS roles legadas existentes e sem membros — requisito do banco de replay', () => {
    for (const index of [4, 5, 6]) {
      const sql = code(EXPECTED_MIGRATIONS[index]!.name).join('\n');
      expect(sql).toMatch(/count\(\*\) FROM pg_roles WHERE rolname IN \(target_role, other_role\)\) <> 2/);
      expect(sql).toMatch(/datdba/);
    }
  });
});

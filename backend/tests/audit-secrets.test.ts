import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeSecrets, loadSecretEntries, MIN_PASSWORD_LENGTH } from '../scripts/audit-secrets';
import type { SecretEntry } from '../scripts/audit-secrets';

const entry = (id: string, user: string, pass: string): SecretEntry => ({ id, user, pass });
const STRONG_A = 'Aa1-strong-password-A-0001';
const STRONG_B = 'Bb2-strong-password-B-0002';
const STRONG_C = 'Cc3-strong-password-C-0003';

describe('auditoria de segredos (nunca imprime valores)', () => {
  it('conforme: uma senha forte e distinta por role', () => {
    const findings = analyzeSecrets([entry('app-test:db', 'cardapio_test_app', STRONG_A), entry('migrate-test:db', 'cardapio_migrator', STRONG_B), entry('fixtures-test:db', 'cardapio_test_fixtures', STRONG_C)]);
    expect(findings).toEqual([{ level: 'OK', code: 'POLICY_OK', message: expect.stringContaining('3 segredo(s)') }]);
  });

  it('reproduz o padrão do achado da auditoria (valores SINTÉTICOS): runtime e migrator com a mesma senha numérica de 8 dígitos', () => {
    const findings = analyzeSecrets([
      entry('app-dev:db', 'cardapio_dev_app', '90817263'), entry('app-test:db', 'cardapio_test_app', '90817263'),
      entry('migrate-test:db', 'cardapio_migrator', '90817263'), entry('migrate-dev:db', 'cardapio_migrator', '90817263'),
      entry('fixtures-test:db', 'cardapio_test_fixtures', STRONG_C),
    ]);
    const codes = findings.map((f) => f.code);
    expect(codes).toContain('PASSWORD_REUSED_ACROSS_ROLES');
    expect(codes).toContain('PASSWORD_TOO_SHORT');
    expect(codes).toContain('PASSWORD_NUMERIC_ONLY');
    const reused = findings.find((f) => f.code === 'PASSWORD_REUSED_ACROSS_ROLES')!;
    expect(reused.message).toContain('cardapio_dev_app, cardapio_migrator, cardapio_test_app');
    expect(findings.every((f) => f.level === 'FAIL')).toBe(true);
  });

  it('a mesma role com senhas diferentes entre URLs é inconsistente (ao menos uma não autentica)', () => {
    const findings = analyzeSecrets([entry('migrate-test:db', 'cardapio_migrator', STRONG_A), entry('migrate-test:shadow', 'cardapio_migrator', STRONG_B)]);
    expect(findings.map((f) => f.code)).toContain('INCONSISTENT_ROLE_PASSWORD');
  });

  it('a mesma role com a mesma senha em vários perfis NÃO é reutilização entre roles', () => {
    const findings = analyzeSecrets([entry('migrate-test:db', 'cardapio_migrator', STRONG_A), entry('migrate-dev:db', 'cardapio_migrator', STRONG_A)]);
    expect(findings.map((f) => f.code)).toEqual(['POLICY_OK']);
  });

  it(`o mínimo é ${MIN_PASSWORD_LENGTH} caracteres`, () => {
    expect(analyzeSecrets([entry('a:db', 'u', 'Aa1-' + 'x'.repeat(MIN_PASSWORD_LENGTH - 5))]).map((f) => f.code)).toContain('PASSWORD_TOO_SHORT');
    expect(analyzeSecrets([entry('a:db', 'u', 'Aa1-' + 'x'.repeat(MIN_PASSWORD_LENGTH - 4))]).map((f) => f.code)).toEqual(['POLICY_OK']);
  });

  it('nenhuma mensagem contém a senha', () => {
    const secret = 'Zz9-never-print-this-0099';
    const findings = analyzeSecrets([entry('a:db', 'u1', secret), entry('b:db', 'u2', secret), entry('c:db', 'u3', '1234')]);
    expect(JSON.stringify(findings)).not.toContain(secret);
    expect(JSON.stringify(findings)).not.toContain('1234');
  });

  it('lê a pasta de segredos no formato do projeto (db e shadow, URL-encoded)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-secrets-'));
    try {
      fs.writeFileSync(path.join(dir, 'migrate-test.env'), 'DATABASE_URL="postgresql://cardapio_migrator:p%40ss%2Fword-ci-0001@127.0.0.1:5432/cardapio_digital_test"\nSHADOW_DATABASE_URL="postgresql://cardapio_migrator:p%40ss%2Fword-ci-0001@127.0.0.1:5432/cardapio_digital_shadow"\n');
      fs.writeFileSync(path.join(dir, 'ignorado.txt'), 'DATABASE_URL="postgresql://x:y@h/d"');
      const entries = loadSecretEntries(dir);
      expect(entries.map((e) => e.id)).toEqual(['migrate-test:db', 'migrate-test:shadow']);
      expect(entries[0]).toMatchObject({ user: 'cardapio_migrator', pass: 'p@ss/word-ci-0001' });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('os scripts novos não embutem credencial e o inspetor é somente leitura', () => {
    const read = (file: string) => fs.readFileSync(path.join(process.cwd(), 'scripts', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const file of ['audit-secrets.ts', 'inspect-e2e-state.ts']) {
      expect(read(file)).not.toMatch(/postgres(ql)?:\/\/[^\s'"`]*:[^\s'"`@]+@/i);
    }
    const inspector = read('inspect-e2e-state.ts');
    expect(inspector).toContain('SET TRANSACTION READ ONLY');
    expect(inspector).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE)\b\s/);
    expect(inspector).toContain("loadDatabaseProfile('migrate-test'");
  });
});

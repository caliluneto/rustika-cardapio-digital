import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_MIGRATIONS, PENDING_MIGRATIONS } from '../../scripts/bootstrap/expectedMigrations';

const dir = path.join(process.cwd(), 'ops/homolog/sql/neon');
const grant = fs.readFileSync(path.join(dir, '01-grant-set-true-migrator.sql'), 'utf8');
const elevate = fs.readFileSync(path.join(dir, '01b-elevate-inherit-for-rename.sql'), 'utf8');
const revoke = fs.readFileSync(path.join(dir, '02-revoke-set-true-migrator.sql'), 'utf8');
const verify = fs.readFileSync(path.join(dir, '03-verify-ownership.sql'), 'utf8');
const RUNTIME_AND_PLACEHOLDER_ROLES = ['cardapio_test_app', 'cardapio_dev_app', 'cardapio_homolog_app', 'cardapio_homolog_placeholder'];
const stripComments = (sql: string) => sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');

describe('3D.5.3-C.5 (Parte A, estático, não executado) — membership GRANT/REVOKE do provedor Neon', () => {
  it('nunca concede nem revoga SET/INHERIT para nenhuma role de runtime ou placeholder', () => {
    for (const role of RUNTIME_AND_PLACEHOLDER_ROLES) {
      expect(grant).not.toMatch(new RegExp(`GRANT\\s+${role}\\b`));
      expect(revoke).not.toMatch(new RegExp(`GRANT\\s+${role}\\b`));
    }
    // a única role concedida/revogada é a migradora (legada ou renomeada)
    expect([...grant.matchAll(/^GRANT\s+(\S+)\s+TO/gm)].map((m) => m[1])).toEqual(['cardapio_migrator']);
    expect([...revoke.matchAll(/^REVOKE\s+(\S+)\s+FROM/gm)].map((m) => m[1])).toEqual(['cardapio_homolog_migrator']);
  });

  it('o grant se recusa explicitamente se o executor ou o alvo for uma role de runtime/placeholder', () => {
    for (const role of RUNTIME_AND_PLACEHOLDER_ROLES) expect(grant).toContain(`'${role}'`);
    expect(grant).toMatch(/current_user IN \([^)]*cardapio_test_app[^)]*\)\s*\n?\s*OR 'cardapio_migrator' IN/);
  });

  it('usa CURRENT_USER como alvo/origem (sem identificador dinâmico interpolado) e exige conexão a postgres', () => {
    for (const sql of [grant, revoke]) {
      expect(sql).toContain("current_database() <> 'postgres'");
      expect(sql).not.toMatch(/format\(|EXECUTE\s/);
    }
    expect(grant).toContain('TO CURRENT_USER WITH SET TRUE, INHERIT FALSE');
    expect(revoke).toContain('FROM CURRENT_USER');
  });

  it('3D.5.3-C.5.1: mínimo privilégio inicial — SET TRUE, INHERIT FALSE (não INHERIT TRUE) em 01', () => {
    expect(grant).not.toMatch(/WITH SET TRUE, INHERIT TRUE/);
    expect(grant).toContain('INHERIT FALSE');
    expect(grant).toMatch(/alguma linha de membership já tem INHERIT TRUE/);
    // fundamentação documental, não suposição: cita a página oficial que liga a operação a SET, não a INHERIT
    expect(grant).toMatch(/ability to SET ROLE/);
    expect(grant).toMatch(/CREATE DATABASE/);
  });

  it('3D.5.3-C.5.3: elevação temporária (01b) concede INHERIT TRUE só para o RENAME, de forma aditiva (nunca SET ROLE)', () => {
    expect(elevate).toContain('GRANT cardapio_migrator TO CURRENT_USER WITH SET TRUE, INHERIT TRUE');
    expect(stripComments(elevate)).not.toMatch(/\bSET ROLE cardapio_migrator\b/);
    expect(elevate).toContain("current_database() <> 'postgres'");
    expect(elevate).toContain('rolcreatedb');
    for (const role of RUNTIME_AND_PLACEHOLDER_ROLES) expect(elevate).toContain(`'${role}'`);
    // exige a membership SET da 01 já existir (ajusta, nunca cria do zero) e usa agregação (bool_or), nunca SELECT INTO de linha única
    expect(elevate).toContain('m.set_option');
    expect(elevate).toMatch(/bool_or\(m\.set_option/);
    expect(elevate).toMatch(/bool_or\(m\.inherit_option\)/);
  });

  it('3D.5.3-C.5.3: a leitura de pg_auth_members na verificação de 01 usa agregação (bool_or), nunca uma linha única', () => {
    // pg_auth_members tem uma linha por concedente (PostgreSQL >= 16); SELECT...INTO sem agregação leria uma linha
    // arbitrária quando há mais de uma — bug real encontrado no neon-probe.mjs na C.5.2.
    const verifyBlock = grant.slice(grant.indexOf('neon_grant_verify$\nDECLARE'));
    expect(verifyBlock).toMatch(/bool_or\(m\.set_option AND NOT m\.admin_option\)/);
    expect(verifyBlock).toMatch(/bool_or\(m\.inherit_option\)/);
  });

  it('grant é idempotente: recusa repetir se a membership com SET já existir', () => {
    expect(grant).toContain('ABORT: a membership com SET já existe');
  });

  it('revoke exige que a renomeação (04-finalize-rename.sql) já tenha ocorrido', () => {
    expect(revoke).toContain("rolname = 'cardapio_homolog_migrator'");
    expect(revoke).toContain("rolname = 'cardapio_migrator'"); // guarda contra nome legado ainda existir
    expect(revoke).toMatch(/ABORT: cardapio_migrator \(nome legado\) ainda existe/);
  });

  it('C.6/Neon: a revogação (02) tolera a linha ADMIN-only automática do bootstrap e exige SET/INHERIT ausentes', () => {
    const verifyBlock = revoke.slice(revoke.indexOf('$neon_revoke_verify$'));
    expect(verifyBlock).toMatch(/\(m\.set_option OR m\.inherit_option\)/);
    expect(verifyBlock).toContain('m.admin_option AND NOT m.set_option AND NOT m.inherit_option');
    expect(verifyBlock).toMatch(/FALHA: ainda há membership com SET ou INHERIT/);
  });

  it('verifica ownership antes/depois e a ausência de privilégios administrativos na role de runtime (SQL somente leitura)', () => {
    expect(verify).toMatch(/^BEGIN READ ONLY;/m);
    expect(verify).toMatch(/^ROLLBACK;/m);
    expect(stripComments(verify)).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE)\b/);
    expect(verify).toContain('pg_get_userbyid(datdba)');
    for (const role of RUNTIME_AND_PLACEHOLDER_ROLES) expect(verify).toContain(role);
    expect(verify).toContain('rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls');
    expect(verify).toContain("rolname = 'neon_superuser'");
  });

  it('nenhum dos scripts 01–09 do procedimento dedicado foi alterado por esta etapa (presença das guardas originais)', () => {
    const dedicated = path.join(dir, '..');
    expect(fs.readFileSync(path.join(dedicated, '01-cluster-roles.sql'), 'utf8')).toContain('cardapio_homolog_bootstrap');
    expect(fs.readFileSync(path.join(dedicated, '02-create-replay-database.sql'), 'utf8')).toContain('OWNER cardapio_migrator');
    expect(fs.readFileSync(path.join(dedicated, '04-finalize-rename.sql'), 'utf8')).toContain("current_database() <> 'postgres'");
    expect(fs.readFileSync(path.join(dedicated, '09-verify-acl.sql'), 'utf8')).toContain('BEGIN READ ONLY');
  });

  it('a elevação (01b) nunca concede nem revoga privilégio para role de runtime/placeholder', () => {
    for (const role of RUNTIME_AND_PLACEHOLDER_ROLES) expect(elevate).not.toMatch(new RegExp(`GRANT\\s+${role}\\b`));
    expect([...elevate.matchAll(/^GRANT\s+(\S+)\s+TO/gm)].map((m) => m[1])).toEqual(['cardapio_migrator']);
  });

  it('a ordem documentada no README.md coloca a elevação (01b) entre 03-verify-replay e 04-finalize-rename, e a revogação (02) só depois de 04', () => {
    const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
    const idx = (s: string) => readme.indexOf(s);
    expect(idx('01-grant-set-true-migrator.sql')).toBeGreaterThan(-1);
    expect(idx('01b-elevate-inherit-for-rename.sql')).toBeGreaterThan(idx('03-verify-replay.sql'));
    expect(idx('04-finalize-rename.sql')).toBeGreaterThan(idx('01b-elevate-inherit-for-rename.sql'));
    expect(idx('02-revoke-set-true-migrator.sql')).toBeGreaterThan(idx('04-finalize-rename.sql'));
  });

  it('as oito migrations históricas continuam intactas e a migration de identidade permanece separada como pendente', () => {
    const names = fs.readdirSync(path.join(process.cwd(), 'prisma/migrations')).filter((p) => /^\d{14}_/.test(p)).sort();
    expect(names).toEqual([...EXPECTED_MIGRATIONS, ...PENDING_MIGRATIONS].map((migration) => migration.name));
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * C.6-FIX01 — validação ESTÁTICA (nada é executado e nenhuma conexão é aberta).
 *
 * A falha real da C.6 foi comprovada: `REVOKE`/`GRANT` no banco de replay foram executados pela role
 * administrativa, que não é owner e não herda os privilégios da migradora; o PostgreSQL só emitiu WARNING.
 * Estes testes travam a correção: a ACL precisa ser aplicada por uma conexão autenticada como o OWNER, e o
 * procedimento de recuperação não pode repetir CREATE ROLE/DATABASE nem usar operações destrutivas.
 */
const homologDir = path.join(process.cwd(), 'ops', 'homolog');
const provision = fs.readFileSync(path.join(homologDir, 'provision-neon-c6.ts'), 'utf8');
const recovery = fs.readFileSync(path.join(homologDir, 'recover-neon-c6-acl.ts'), 'utf8');
const stripComments = (text: string) => text.split('\n').filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//') && !line.trim().startsWith('/*')).join('\n');
const provisionCode = stripComments(provision);
const recoveryCode = stripComments(recovery);
const directDestructiveQuery = /\.query(?:<[^>]+>)?\(\s*[`'"]\s*(?:DROP|TRUNCATE|CASCADE|FORCE)\b/i;
const directProvisioningQuery = /\.query(?:<[^>]+>)?\(\s*[`'"]\s*(?:CREATE\s+(?:ROLE|DATABASE)|ALTER\s+(?:ROLE|DATABASE))\b/i;

describe('C.6-FIX01 — o provisionamento aplica a ACL como owner do banco de replay', () => {
  it('usa uma conexão autenticada como cardapio_migrator, não a role administrativa', () => {
    expect(provisionCode).toContain('applyReplayDatabaseAclAsOwner(url, REPLAY_DB, secrets.migratorPassword)');
    const start = provisionCode.indexOf('async function applyReplayDatabaseAclAsOwner');
    const end = provisionCode.indexOf('function formatRole', start);
    const helper = provisionCode.slice(start, end);
    expect(helper).toContain('buildClient(url, database, ROLES.migrator, migratorPassword');
    expect(helper).toContain('owner.connect()');
    expect(helper).toContain('ownsDatabase');
    expect(helper).not.toMatch(/\bSET\s+ROLE\b/i);
  });

  it('revoga somente CONNECT/TEMPORARY de PUBLIC e concede CONNECT ao migrator/app/bootstrap', () => {
    expect(provisionCode).toContain('REVOKE CONNECT, TEMPORARY ON DATABASE');
    expect(provisionCode).toContain('FROM PUBLIC');
    expect(provisionCode).toContain('GRANT CONNECT ON DATABASE');
    expect(provisionCode).toContain('ROLES.migrator');
    expect(provisionCode).toContain('ROLES.app');
    expect(provisionCode).toContain('ROLES.bootstrap');
    expect(provisionCode).not.toMatch(/REVOKE\s+ALL\s+ON\s+DATABASE/i);
  });

  it('confere a ACL efetiva antes de encerrar (PUBLIC sem CONNECT/TEMPORARY)', () => {
    expect(provisionCode).toContain('assert(!acl.publicConnect');
    expect(provisionCode).toContain('assert(!acl.publicTemp');
    expect(provisionCode).toContain('assert(acl.appConnect');
    expect(provisionCode).toContain('assert(acl.bootstrapConnect');
    expect(provisionCode).toContain('assert(!acl.appTemp');
  });

  it('a aplicação da ACL ocorre antes da verificação final [6/8] e antes de revogar a membership', () => {
    const aclAt = provisionCode.indexOf('applyReplayDatabaseAclAsOwner(url, REPLAY_DB');
    const verifyAt = provisionCode.indexOf("[6/8]");
    const revokeMembershipAt = provisionCode.indexOf('REVOKE ${admin.escapeIdentifier(ROLES.migrator)} FROM CURRENT_USER');
    expect(aclAt).toBeGreaterThan(-1);
    expect(verifyAt).toBeGreaterThan(aclAt);
    expect(revokeMembershipAt).toBeGreaterThan(aclAt);
  });

  it('não enfraquece TLS e não usa operações destrutivas em execução', () => {
    for (const source of [provision, recovery]) {
      expect(source).not.toMatch(/rejectUnauthorized:\s*false/);
      expect(source).not.toMatch(directDestructiveQuery);
    }
  });
});

describe('C.6-FIX01 — o procedimento de recuperação é separado e não repete o provisionamento', () => {
  it('não contém CREATE ROLE, CREATE DATABASE, ALTER ROLE em execução', () => {
    expect(recovery).not.toMatch(directProvisioningQuery);
    expect(recoveryCode).not.toContain('buildRoleSql(');
  });

  it('não enfraquece TLS e não usa operações destrutivas', () => {
    for (const source of [provision, recovery]) {
      expect(source).not.toMatch(/rejectUnauthorized:\s*false/);
      expect(source).not.toMatch(directDestructiveQuery);
    }
  });

  it('não grava connection string nem senha no relatório em execução', () => {
    // recoveryCode já está stripado; checa interpolação de template literal com secrets
    const hasTemplateWithSecret = /\$\{.*secrets\.connectionString.*\}/.test(recoveryCode);
    expect(hasTemplateWithSecret).toBe(false);
    const hasTemplateWithPassword = /\$\{.*secrets\.migratorPassword.*\}/.test(recoveryCode);
    expect(hasTemplateWithPassword).toBe(false);
    expect(recoveryCode).toContain('mode: 0o600');
  });

  it('executa a correção como o owner migrator em transação', () => {
    expect(recoveryCode).toContain('database: REPLAY_DB');
    expect(recoveryCode).toContain('user: ROLES.migrator');
    expect(recoveryCode).toContain('password: secrets.migratorPassword');
    expect(recoveryCode).toContain("await owner.query('BEGIN')");
    expect(recoveryCode).toContain("await owner.query('COMMIT')");
    expect(recoveryCode).toContain("await owner.query('ROLLBACK')");
    expect(recoveryCode).toContain('REVOKE CONNECT, TEMPORARY ON DATABASE');
    expect(recoveryCode).toContain('GRANT CONNECT ON DATABASE');
    expect(recoveryCode).not.toMatch(/\bSET\s+ROLE\b/i);
  });

  it('falha fechada: valida identidade, owner, banco vazio, roles, memberships e ACL antes de escrever', () => {
    for (const needle of [
      'EXPECTED_PROJECT_ID', 'EXPECTED_ENDPOINT_ID', 'EXPECTED_ADMIN_DB', 'EXPECTED_ADMIN_ROLE',
      'assertServerIdentity', 'ownsDatabase', 'userObjectCount', 'userFunctionCount', 'userTriggerCount',
      'policyCount', 'eventTriggerCount', 'unexpectedSchemas', 'adminOption', 'setOption', 'inheritOption',
      'neon_superuser', 'pg_db_role_setting', 'assertKnownPartialAcl', 'aclIsFullyCorrect',
    ]) {
      expect(recoveryCode, needle).toContain(needle);
    }
  });

  it('só escreve no modo --apply, depois do pré-voo e de um token digitado', () => {
    expect(recoveryCode).toContain("process.argv.includes('--apply')");
    expect(recoveryCode).toContain("const APPLY_TOKEN = 'C.6-RECOVER-ACL'");
    expect(recoveryCode).toContain('readHiddenLine');
    expect(recoveryCode).toContain('if (confirmation !== APPLY_TOKEN)');
    expect(recoveryCode).toContain('if (checkOnly)');
  });

  it('não grava connection string nem senha no relatório em execução', () => {
    // O código monta o relatório manualmente via array.join(), não usa template literals com secrets
    // Checa se há interpolação de ${secrets.connectionString} no que é escrito no relatório
    const hasTemplateWithSecret = /\\$\\{.*secrets\\.connectionString.*\\}/.test(recoveryCode);
    expect(hasTemplateWithSecret).toBe(false);
    // Igual para a senha
    const hasTemplateWithPassword = /\\$\\{.*secrets\\.migratorPassword.*\\}/.test(recoveryCode);
    expect(hasTemplateWithPassword).toBe(false);
    // Confirma que o modo 0o600 está presente
    expect(recoveryCode).toContain('mode: 0o600');
  });
});


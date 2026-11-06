import { describe, expect, it, vi } from 'vitest';
import {
  BOOTSTRAP_CONFIRMATION_ENV, BOOTSTRAP_CONFIRMATION_VALUE, BootstrapRefused, evaluateFacts, runBootstrap,
} from '../../scripts/bootstrap/adminBootstrap';
import type { BootstrapDb, BootstrapFacts } from '../../scripts/bootstrap/adminBootstrap';
import { checkPasswordPolicy, maskEmail, normalizeIdentity } from '../../scripts/bootstrap/adminInput';
import { parseBootstrapArgs, runBootstrapCli } from '../../scripts/bootstrap/cli';
import type { BootstrapCliDeps } from '../../scripts/bootstrap/cli';
import { EXPECTED_MIGRATIONS } from '../../scripts/bootstrap/expectedMigrations';
import { readHiddenLine } from '../../scripts/bootstrap/hiddenPrompt';
import { hashPassword, verifyPassword } from '../../src/security/password';

const CLUSTER = '3f2b8c1e-9d4a-4b7e-8a61-0c5d2e7f9a10';
const EXPECTED = { database: 'cardapio_digital_homolog', user: 'cardapio_homolog_bootstrap', clusterId: CLUSTER };
const PASSWORD = 'Zx9!kLm2#VbNcXz7pO';
const IDENTITY = { name: 'Maria Souza', email: 'maria.souza@exemplo.invalid' };
const goodFacts = (): BootstrapFacts => ({
  database: 'cardapio_digital_homolog', currentUser: 'cardapio_homolog_bootstrap', sessionUser: 'cardapio_homolog_bootstrap', elevatedRole: false,
  server: {
    database: 'cardapio_digital_homolog', currentUser: 'cardapio_homolog_bootstrap', sslActive: true, serverVersionNum: 180000,
    databases: ['postgres', 'cardapio_digital_homolog'], roles: ['postgres', 'cardapio_homolog_app', 'cardapio_homolog_migrator', 'cardapio_homolog_bootstrap', 'rustika_homolog_marker'],
    markerComment: `rustika-homolog-cluster:${CLUSTER}`,
  },
  serverVersionNum: 180000, canInsertAdmins: true, canUpdateAdmins: false, canDeleteAdmins: false, canTruncateAdmins: false, adminCount: 0,
  migrations: EXPECTED_MIGRATIONS.map(({ name, checksum }) => ({ name, checksum, finished: true, rolledBack: false })),
});

/** Banco em memória com semântica atômica: o insert só persiste se TUDO der certo. */
class FakeBootstrapDb implements BootstrapDb {
  admins: Array<{ id: string; name: string; email: string; passwordHash: string }> = [];
  inserts = 0;
  constructor(public facts: BootstrapFacts = goodFacts(), private failWith?: Error) {}
  async readFacts() { return { ...this.facts, adminCount: this.admins.length }; }
  async insertFirstAdmin(input: { name: string; email: string; passwordHash: string }) {
    this.inserts++;
    const staged = [...this.admins];
    if (staged.length > 0) throw new BootstrapRefused('ADMIN_ALREADY_EXISTS', 'Já existe administrador neste ambiente.');
    staged.push({ id: 'id-1', ...input });
    if (this.failWith) throw this.failWith; // falha antes do "commit": nada é persistido
    this.admins = staged;
    return { id: 'id-1' };
  }
}

const deps = (db: BootstrapDb, readPassword = async () => PASSWORD) => ({ db, hash: hashPassword, readPassword, validatePassword: (p: string) => checkPasswordPolicy(p, IDENTITY) });

describe('política de fatos do bootstrap', () => {
  it('aceita o estado esperado', () => expect(evaluateFacts(goodFacts(), EXPECTED)).toBeNull());

  it.each([
    ['banco divergente', { database: 'cardapio_digital_dev' }, 'ENVIRONMENT_MISMATCH'],
    ['role divergente (runtime)', { currentUser: 'cardapio_homolog_app', sessionUser: 'cardapio_homolog_app' }, 'ENVIRONMENT_MISMATCH'],
    ['session_user divergente', { sessionUser: 'postgres' }, 'ENVIRONMENT_MISMATCH'],
    ['role elevada', { elevatedRole: true }, 'UNSAFE_ROLE'],
    ['PostgreSQL < 17', { serverVersionNum: 160000 }, 'UNSAFE_ROLE'],
    ['sem INSERT em admins', { canInsertAdmins: false }, 'UNSAFE_ROLE'],
    ['com UPDATE em admins', { canUpdateAdmins: true }, 'UNSAFE_ROLE'],
    ['com DELETE em admins', { canDeleteAdmins: true }, 'UNSAFE_ROLE'],
    ['com TRUNCATE em admins', { canTruncateAdmins: true }, 'UNSAFE_ROLE'],
    ['administrador já existe', { adminCount: 1 }, 'ADMIN_ALREADY_EXISTS'],
    ['servidor sem TLS', { server: { ...goodFacts().server, sslActive: false } }, 'ENVIRONMENT_MISMATCH'],
    ['servidor de outro cluster', { server: { ...goodFacts().server, markerComment: 'rustika-homolog-cluster:00000000-0000-4000-8000-000000000000' } }, 'ENVIRONMENT_MISMATCH'],
    ['servidor com banco Dev', { server: { ...goodFacts().server, databases: ['cardapio_digital_dev', 'cardapio_digital_homolog'] } }, 'ENVIRONMENT_MISMATCH'],
  ] as const)('recusa: %s', (_label, patch, code) => {
    expect(evaluateFacts({ ...goodFacts(), ...(patch as Partial<BootstrapFacts>) }, EXPECTED)?.code).toBe(code);
  });

  it('recusa migration desconhecida, ausente ou com checksum divergente', () => {
    const base = goodFacts();
    for (const migrations of [
      [...base.migrations, { name: 'x_nova', checksum: 'a', finished: true, rolledBack: false }],
      base.migrations.slice(0, 6),
      base.migrations.map((m, i) => (i === 0 ? { ...m, checksum: '0'.repeat(64) } : m)),
    ]) expect(evaluateFacts({ ...base, migrations }, EXPECTED)?.code).toBe('SCHEMA_INCOMPATIBLE');
  });
});

describe('execução atômica do bootstrap', () => {
  it('cria o primeiro administrador com o hash existente e nunca guarda a senha', async () => {
    const db = new FakeBootstrapDb();
    const result = await runBootstrap(deps(db), IDENTITY, 'execute', EXPECTED);
    expect(result).toEqual({ status: 'created', adminId: 'id-1' });
    const stored = db.admins[0]!;
    expect(stored.passwordHash).toMatch(/^scrypt\$v1\$32768\$8\$3\$/);
    expect(stored.passwordHash).not.toContain(PASSWORD);
    expect(await verifyPassword(PASSWORD, stored.passwordHash)).toBe(true);
    expect(await verifyPassword('outra-senha-qualquer', stored.passwordHash)).toBe(false);
  });

  it('dry-run não pede senha nem insere', async () => {
    const db = new FakeBootstrapDb();
    const readPassword = vi.fn(async () => PASSWORD);
    expect(await runBootstrap(deps(db, readPassword), IDENTITY, 'dry-run', EXPECTED)).toEqual({ status: 'dry-run-ok' });
    expect(readPassword).not.toHaveBeenCalled();
    expect(db.inserts).toBe(0);
  });

  it('recusa quando já existe administrador, sem pedir senha e sem inserir', async () => {
    const db = new FakeBootstrapDb(); db.admins.push({ id: 'old', name: 'x', email: 'x@y.zz', passwordHash: 'h' });
    const readPassword = vi.fn(async () => PASSWORD);
    const result = await runBootstrap(deps(db, readPassword), IDENTITY, 'execute', EXPECTED);
    expect(result).toMatchObject({ status: 'refused', code: 'ADMIN_ALREADY_EXISTS' });
    expect(readPassword).not.toHaveBeenCalled();
    expect(db.inserts).toBe(0);
    expect(db.admins).toHaveLength(1);
  });

  it('segundo bootstrap após o primeiro é recusado (execução única)', async () => {
    const db = new FakeBootstrapDb();
    expect((await runBootstrap(deps(db), IDENTITY, 'execute', EXPECTED)).status).toBe('created');
    expect(await runBootstrap(deps(db), { ...IDENTITY, email: 'outra@exemplo.invalid' }, 'execute', EXPECTED)).toMatchObject({ status: 'refused', code: 'ADMIN_ALREADY_EXISTS' });
    expect(db.admins).toHaveLength(1);
  });

  it('corrida: a inserção que perde a disputa é recusada sem criar segundo administrador', async () => {
    const db = new FakeBootstrapDb();
    db.readFacts = async () => goodFacts(); // ambos enxergam "zero administradores"
    expect((await runBootstrap(deps(db), IDENTITY, 'execute', EXPECTED)).status).toBe('created');
    expect(await runBootstrap(deps(db), IDENTITY, 'execute', EXPECTED)).toMatchObject({ status: 'refused', code: 'ADMIN_ALREADY_EXISTS' });
    expect(db.admins).toHaveLength(1);
  });

  it('falha na criação não deixa estado parcial e propaga o erro ao chamador', async () => {
    const db = new FakeBootstrapDb(goodFacts(), new Error('falha de rede'));
    await expect(runBootstrap(deps(db), IDENTITY, 'execute', EXPECTED)).rejects.toThrow('falha de rede');
    expect(db.admins).toHaveLength(0);
    const retry = new FakeBootstrapDb();
    expect((await runBootstrap(deps(retry), IDENTITY, 'execute', EXPECTED)).status).toBe('created'); // recuperação: reexecutar
  });

  it('senha fraca é recusada antes de gerar hash ou inserir', async () => {
    const db = new FakeBootstrapDb();
    const result = await runBootstrap(deps(db, async () => 'curta'), IDENTITY, 'execute', EXPECTED);
    expect(result).toMatchObject({ status: 'refused', code: 'INVALID_PASSWORD' });
    expect(db.inserts).toBe(0);
  });
});

describe('entrada do primeiro administrador', () => {
  it('normaliza e valida nome e e-mail', () => {
    expect(normalizeIdentity({ name: '  Maria   Souza ', email: ' MARIA@Exemplo.INVALID ' })).toEqual({ ok: true, value: { name: 'Maria Souza', email: 'maria@exemplo.invalid' } });
    for (const raw of [{ name: '', email: 'a@b.cc' }, { name: 'A', email: 'a@b.cc' }, { name: 'Maria', email: 'sem-arroba' }, { name: 'Maria', email: `${'a'.repeat(250)}@b.cc` }, { name: 'Ma\u0000ria', email: 'a@b.cc' }, {}]) {
      expect(normalizeIdentity(raw).ok).toBe(false);
    }
  });

  it('política de senha', () => {
    expect(checkPasswordPolicy(PASSWORD, IDENTITY)).toEqual([]);
    for (const weak of ['Curta1!', 'senha-muito-longa-sem-maiuscula', 'AAAAAAAAAAAAAAAAAAAA1!', 'Rustika2026!Segura', 'Maria#Souza#2026x', 'maria.souza!Aa1234', '12345678901234567890']) {
      expect(checkPasswordPolicy(weak, IDENTITY).length, weak).toBeGreaterThan(0);
    }
    expect(maskEmail('maria.souza@exemplo.invalid')).toBe('m***@exemplo.invalid');
  });
});

function cliHarness(overrides: Partial<BootstrapCliDeps> = {}, db = new FakeBootstrapDb()) {
  const out: string[] = []; const err: string[] = []; const closed = vi.fn(async () => undefined);
  const prompts: string[] = []; let call = 0;
  const secrets = {
    profile: 'bootstrap-homolog', purpose: 'bootstrap' as const, environment: 'homolog' as const, host: 'db-homolog.exemplo.invalid', clusterId: CLUSTER,
    database: 'cardapio_digital_homolog', user: 'cardapio_homolog_bootstrap', secretsFilePath: 'x', describe: () => 'd',
    databaseUrl: 'postgresql://cardapio_homolog_bootstrap:URL-PASSWORD-SECRET@db-homolog.exemplo.invalid:5432/cardapio_digital_homolog?sslmode=verify-full',
  };
  const depsCli: BootstrapCliDeps = {
    loadProfile: vi.fn(() => secrets), connect: vi.fn(() => ({ db, close: closed })), hash: hashPassword,
    readHidden: async (prompt) => { prompts.push(prompt); call++; return PASSWORD; }, out: (l) => out.push(l), err: (l) => err.push(l), ...overrides,
  };
  return { deps: depsCli, out, err, closed, prompts, db, calls: () => call };
}
const ARGS = ['--profile', 'bootstrap-homolog', '--name', IDENTITY.name, '--email', IDENTITY.email];
const CONFIRM = { [BOOTSTRAP_CONFIRMATION_ENV]: BOOTSTRAP_CONFIRMATION_VALUE };

describe('comando de bootstrap (CLI)', () => {
  it('sem --execute faz apenas dry-run: sem senha, sem escrita, sem confirmação exigida', async () => {
    const h = cliHarness();
    expect(await runBootstrapCli(h.deps, ARGS, {})).toBe(0);
    expect(h.db.inserts).toBe(0); expect(h.calls()).toBe(0);
    expect(h.out.join('\n')).toMatch(/dry-run-ok/);
    expect(h.closed).toHaveBeenCalled();
  });

  it('--execute exige a confirmação explícita do ambiente (negação sem autorização)', async () => {
    for (const env of [{}, { [BOOTSTRAP_CONFIRMATION_ENV]: 'yes' }]) {
      const h = cliHarness();
      expect(await runBootstrapCli(h.deps, [...ARGS, '--execute'], env)).toBe(2);
      expect(h.deps.loadProfile).not.toHaveBeenCalled(); expect(h.deps.connect).not.toHaveBeenCalled();
    }
  });

  it('cria o administrador pedindo a senha duas vezes de forma oculta e nunca a imprime', async () => {
    const h = cliHarness();
    expect(await runBootstrapCli(h.deps, [...ARGS, '--execute'], CONFIRM)).toBe(0);
    expect(h.prompts).toEqual(['Senha do administrador: ', 'Repita a senha: ']);
    expect(h.db.admins).toHaveLength(1);
    const all = [...h.out, ...h.err].join('\n');
    expect(all).toMatch(/resultado=created administrador=m\*\*\*@exemplo\.invalid/);
    for (const secret of [PASSWORD, h.db.admins[0]!.passwordHash, 'URL-PASSWORD-SECRET', 'scrypt$']) expect(all).not.toContain(secret);
  });

  it('senhas diferentes: nada é criado', async () => {
    let n = 0;
    const h = cliHarness({ readHidden: async () => (n++ === 0 ? PASSWORD : `${PASSWORD}x`) });
    expect(await runBootstrapCli(h.deps, [...ARGS, '--execute'], CONFIRM)).toBe(2);
    expect(h.db.admins).toHaveLength(0);
    expect([...h.out, ...h.err].join('\n')).not.toContain(PASSWORD);
  });

  it('recusa senha por argumento (qualquer forma), argumentos desconhecidos e perfil errado', async () => {
    for (const extra of [['--password', PASSWORD], ['--senha=x'], ['--secret', 'x'], ['--foo', 'bar'], ['--passphrase']]) {
      const h = cliHarness();
      expect(await runBootstrapCli(h.deps, [...ARGS, ...extra], CONFIRM)).toBe(1);
      expect(h.deps.connect).not.toHaveBeenCalled();
      expect([...h.out, ...h.err].join('\n')).not.toContain(PASSWORD);
    }
    for (const profile of ['app-homolog', 'migrate-homolog', 'app-dev', 'migrate-test', '']) {
      const h = cliHarness();
      expect(await runBootstrapCli(h.deps, ['--profile', profile, '--name', 'Maria', '--email', 'a@b.cc'], CONFIRM)).toBe(1);
      expect(h.deps.loadProfile).not.toHaveBeenCalled();
    }
    expect(parseBootstrapArgs(['--profile']).ok).toBe(false);
  });

  it('entrada inválida ou perfil/credencial ausente: falha segura antes de conectar', async () => {
    const h = cliHarness();
    expect(await runBootstrapCli(h.deps, ['--profile', 'bootstrap-homolog', '--name', 'M', '--email', 'x'], CONFIRM)).toBe(1);
    expect(h.deps.connect).not.toHaveBeenCalled();
    const noCreds = cliHarness({ loadProfile: () => { throw new Error('Arquivo de segredo ausente para o perfil bootstrap-homolog'); } });
    expect(await runBootstrapCli(noCreds.deps, ARGS, CONFIRM)).toBe(1);
    expect(noCreds.deps.connect).not.toHaveBeenCalled();
    const local = cliHarness({ loadProfile: () => ({ ...cliHarness().deps.loadProfile('x', {}), environment: undefined }) });
    expect(await runBootstrapCli(local.deps, ARGS, CONFIRM)).toBe(2);
  });

  it('administrador já existente: recusa com código 2 e não pede senha', async () => {
    const db = new FakeBootstrapDb(); db.admins.push({ id: 'old', name: 'x', email: 'x@y.zz', passwordHash: 'h' });
    const h = cliHarness({}, db);
    expect(await runBootstrapCli(h.deps, [...ARGS, '--execute'], CONFIRM)).toBe(2);
    expect(h.calls()).toBe(0);
    expect(h.err.join('\n')).toMatch(/ADMIN_ALREADY_EXISTS/);
  });

  it('erro inesperado do banco com dados sensíveis na mensagem não vaza nada', async () => {
    const leaky = Object.assign(new Error(`Invalid prisma.admin.create() data: { passwordHash: 'scrypt$v1$HASH-SECRET', email: '${IDENTITY.email}' } ${PASSWORD}`), { code: 'P2010' });
    const h = cliHarness({}, new FakeBootstrapDb(goodFacts(), leaky));
    expect(await runBootstrapCli(h.deps, [...ARGS, '--execute'], CONFIRM)).toBe(1);
    const all = [...h.out, ...h.err].join('\n');
    expect(all).toMatch(/codigo=P2010/);
    for (const secret of [PASSWORD, 'HASH-SECRET', 'scrypt$', 'URL-PASSWORD-SECRET', IDENTITY.email]) expect(all).not.toContain(secret);
    expect(h.closed).toHaveBeenCalled();
    expect(h.db.admins).toHaveLength(0);
  });
});

describe('leitura oculta de senha', () => {
  it('recusa terminal não interativo (pipe, CI, redirecionamento)', async () => {
    await expect(readHiddenLine('x', { isTTY: false } as never, { write: vi.fn() } as never)).rejects.toThrow(/TTY/);
    await expect(readHiddenLine('x', { isTTY: true } as never, { write: vi.fn() } as never)).rejects.toThrow(/TTY/);
  });
});

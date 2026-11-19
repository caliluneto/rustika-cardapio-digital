import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Prisma, type PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { checkPasswordPolicy } from '../../scripts/bootstrap/adminInput';
import {
  CommitOutcomeUnknown,
  E4_ALT_EXPECTED_MIGRATIONS,
  E4_ALT_ROLE_ALIASES,
  E4_ALT_TARGET,
  EXCEPTIONAL_CONFIRMATION_ENV,
  EXCEPTIONAL_CONFIRMATION_VALUE,
  ExceptionalBootstrapRefused,
  collectExceptionalFacts,
  createExceptionalMigratorDb,
  evaluateExceptionalFacts,
  runSerializableReadOnlyTransaction,
  runExceptionalMigratorBootstrap,
  type BootstrapAclMatrix,
  type ExceptionalBootstrapFacts,
  type ExceptionalExpectedIdentity,
  type ExceptionalMigratorDb,
} from '../../scripts/bootstrap/exceptionalMigratorBootstrap';
import {
  parseExceptionalArgs,
  runExceptionalMigratorCli,
  strictTargetUrlProblem,
  type ExceptionalCliDeps,
} from '../../scripts/bootstrap/exceptionalMigratorCli';
import {
  E4_ALT_APPROVAL_FORMAT,
  E51_APPROVAL_FORMAT,
  buildUnapprovedCandidate,
  canonicalSha256,
  computeE4AltSourceDigest,
  computeE51SourceDigest,
  homologMigrationSetDigest,
  migrationSetDigest,
  neonProviderRoleScopeProblems,
  parseApprovedFingerprint,
  parseApprovedHomologFingerprint,
} from '../../scripts/bootstrap/e4AltFingerprintApproval';
import { HOMOLOG_EXPECTED_MIGRATIONS } from '../../scripts/homolog/homologMigrationChain';
import { independentSha256 } from '../../scripts/bootstrap/e4AltFingerprintIndependent';
import { SECTIONS, aliasRole, fingerprint, snapshotCompletenessProblems, type SchemaSnapshot } from '../../scripts/homolog/schemaSnapshot';
import { hashPassword, verifyPassword } from '../../src/security/password';

const CLUSTER = '3f2b8c1e-9d4a-4b7e-8a61-0c5d2e7f9a10';
const SCHEMA_FINGERPRINT = 'a'.repeat(64);
const EXPECTED: ExceptionalExpectedIdentity = { clusterId: CLUSTER, schemaFingerprint: SCHEMA_FINGERPRINT };
const IDENTITY = { name: 'Maria Souza', email: 'maria.souza@exemplo.invalid' };
const PASSWORD = 'Zx9!kLm2#VbNcXz7pO';
const APPROVAL_FILE = 'e4-alt-fingerprint-approval.json';

/** Manifesto de aprovação gerado no teste a partir da implementação real; o revisor é fictício. */
const approvedManifest = (patch: Record<string, unknown> = {}): string => JSON.stringify({
  format: E4_ALT_APPROVAL_FORMAT,
  status: 'APPROVED',
  candidateDigest: 'b'.repeat(64),
  schemaFingerprint: SCHEMA_FINGERPRINT,
  sourceDigest: computeE4AltSourceDigest(),
  projectId: E4_ALT_TARGET.projectId,
  branchId: E4_ALT_TARGET.branchId,
  database: E4_ALT_TARGET.database,
  databaseOid: E4_ALT_TARGET.databaseOid,
  migrationSetDigest: migrationSetDigest(),
  reviewer: 'Revisor Independente',
  reviewedAt: '2026-11-18T12:00:00.000Z',
  reviewEvidence: 'review-e4-alt-001',
  ...patch,
});

const approvedHomologManifest = (patch: Record<string, unknown> = {}): string => JSON.stringify({
  ...JSON.parse(approvedManifest()) as Record<string, unknown>,
  format: E51_APPROVAL_FORMAT,
  sourceDigest: computeE51SourceDigest(),
  migrationSetDigest: homologMigrationSetDigest(),
  ...patch,
});
const homologFacts = (): ExceptionalBootstrapFacts => ({
  ...goodFacts(),
  migrations: HOMOLOG_EXPECTED_MIGRATIONS.map(({ name, checksum }) => ({ name, checksum, finished: true, rolledBack: false })),
});

const completeSnapshot = (): SchemaSnapshot => ({
  ...(Object.fromEntries(SECTIONS.map((section) => [section, []])) as unknown as SchemaSnapshot),
  schemas: ['public:owner=cardapio_homolog_migrator'],
  tables: ['public.admins:owner=cardapio_homolog_migrator'],
  columns: ['public.admins.id:type=text:nullable=false'],
  constraints: ['public.admins_pkey:primary-key'],
  indexes: ['public.admins_pkey:CREATE UNIQUE INDEX admins_pkey ON public.admins USING btree (id)'],
  enums: ['public.admin_role:admin'],
  sequences: ['public.admins_id_seq:owner=cardapio_homolog_migrator'],
  owners: ['public.admins=cardapio_homolog_migrator'],
  tableAcls: ['public.admins:grantee=cardapio_homolog_migrator:INSERT'],
  columnAcls: ['public.admins.id:grantee=cardapio_homolog_migrator:SELECT'],
  schemaAcls: ['public:grantee=cardapio_homolog_migrator:USAGE'],
  databaseAcls: ['cardapio_digital_homolog:grantee=cardapio_homolog_migrator:CONNECT'],
  roles: ['cardapio_homolog_migrator:NOLOGIN'],
  databaseProps: ['cardapio_digital_homolog:encoding=UTF8'],
});

const safeBootstrapAcl = (): BootstrapAclMatrix => ({
  explicitGrants: { database: 0, schemas: 0, tables: 0, columns: 0, sequences: 0, routines: 0, types: 0, defaultAcls: 0 },
  ownedObjects: { databases: 0, schemas: 0, relations: 0, routines: 0, types: 0 },
  effectiveUnsafe: {
    databaseCreate: false, schemaCreate: false, tablePrivilegeObjects: 0, columnPrivilegeColumns: 0,
    sequencePrivilegeObjects: 0, dangerousRoutineObjects: 0,
  },
  effectiveInformational: {
    databaseConnect: true, databaseTemporary: true, explicitDatabaseConnectCurrentDb: 0, schemaUsage: true, routineExecuteObjects: 0, typeUsageObjects: 3,
  },
});

const goodFacts = (): ExceptionalBootstrapFacts => ({
  database: E4_ALT_TARGET.database,
  databaseOid: E4_ALT_TARGET.databaseOid,
  currentUser: E4_ALT_TARGET.migratorRole,
  sessionUser: E4_ALT_TARGET.migratorRole,
  projectId: E4_ALT_TARGET.projectId,
  branchId: E4_ALT_TARGET.branchId,
  markerComment: `rustika-homolog-cluster:${CLUSTER}`,
  serverVersionNum: 180007,
  elevatedRole: false,
  databaseOwner: E4_ALT_TARGET.migratorRole,
  adminsOwner: E4_ALT_TARGET.migratorRole,
  canInsertAdmins: true,
  adminCount: 0,
  bootstrapRoleOid: E4_ALT_TARGET.bootstrapRoleOid,
  bootstrapCanLogin: false,
  bootstrapElevatedRole: false,
  bootstrapAcl: safeBootstrapAcl(),
  bootstrapExplicitAclCount: 0,
  projectMembershipCount: 0,
  neonCreatorAdminOnlyMemberships: 0,
  migrations: E4_ALT_EXPECTED_MIGRATIONS.map(({ name, checksum }) => ({ name, checksum, finished: true, rolledBack: false })),
  schemaFingerprint: SCHEMA_FINGERPRINT,
  externalTls: { proven: true, reasons: [] },
});

class FakeExceptionalDb implements ExceptionalMigratorDb {
  admins: Array<{ id: string; name: string; email: string; passwordHash: string }> = [];
  writes = 0;
  constructor(
    public facts: ExceptionalBootstrapFacts = goodFacts(),
    private readonly failure?: Error,
  ) {}
  async readFacts() { return { ...this.facts, adminCount: this.admins.length }; }
  async insertFirstAdmin(input: { name: string; email: string; passwordHash: string }, expected: ExceptionalExpectedIdentity) {
    this.writes++;
    const refusal = evaluateExceptionalFacts({ ...this.facts, adminCount: this.admins.length }, expected);
    if (refusal) throw new ExceptionalBootstrapRefused(refusal.code, refusal.message);
    if (this.failure) throw this.failure;
    const created = { id: 'admin-1', ...input };
    this.admins.push(created);
    return { id: created.id };
  }
}

const coreDeps = (db: ExceptionalMigratorDb, readPassword = async () => PASSWORD) => ({
  db,
  hash: hashPassword,
  readPassword,
  validatePassword: (password: string) => checkPasswordPolicy(password, IDENTITY),
});

describe('E4-ALT — política de viabilidade e identidade', () => {
  it('aceita somente o alvo completo, 9/9 migrations e fingerprint aprovado', () => {
    expect(E4_ALT_EXPECTED_MIGRATIONS).toHaveLength(9);
    expect(evaluateExceptionalFacts(goodFacts(), EXPECTED)).toBeNull();
  });

  it.each<[string, Partial<ExceptionalBootstrapFacts>, string]>([
    ['banco', { database: 'cardapio_digital_dev' }, 'ENVIRONMENT_MISMATCH'],
    ['OID do banco', { databaseOid: '1' }, 'ENVIRONMENT_MISMATCH'],
    ['role runtime', { currentUser: E4_ALT_TARGET.runtimeRole, sessionUser: E4_ALT_TARGET.runtimeRole }, 'ENVIRONMENT_MISMATCH'],
    ['session_user', { sessionUser: 'neondb_owner' }, 'ENVIRONMENT_MISMATCH'],
    ['projeto', { projectId: 'other-project-12345678' }, 'ENVIRONMENT_MISMATCH'],
    ['branch', { branchId: 'br-other-branch-12345678' }, 'ENVIRONMENT_MISMATCH'],
    ['TLS', { externalTls: { proven: false, reasons: ['CA'] } }, 'ENVIRONMENT_MISMATCH'],
    ['PostgreSQL', { serverVersionNum: 170012 }, 'ENVIRONMENT_MISMATCH'],
    ['atributos elevados', { elevatedRole: true }, 'UNSAFE_ROLE'],
    ['owner do banco', { databaseOwner: 'neondb_owner' }, 'UNSAFE_ROLE'],
    ['owner de admins', { adminsOwner: 'neondb_owner' }, 'UNSAFE_ROLE'],
    ['sem INSERT por ownership', { canInsertAdmins: false }, 'UNSAFE_ROLE'],
    ['membership', { projectMembershipCount: 1 }, 'UNSAFE_ROLE'],
    ['OID bootstrap', { bootstrapRoleOid: '1' }, 'UNSAFE_ROLE'],
    ['bootstrap LOGIN', { bootstrapCanLogin: true }, 'UNSAFE_ROLE'],
    ['bootstrap elevado', { bootstrapElevatedRole: true }, 'UNSAFE_ROLE'],
    ['ACL bootstrap', { bootstrapExplicitAclCount: 1 }, 'UNSAFE_ROLE'],
    ['administrador existente', { adminCount: 1 }, 'ADMIN_ALREADY_EXISTS'],
  ])('recusa identidade incorreta: %s', (_label, patch, code) => {
    expect(evaluateExceptionalFacts({ ...goodFacts(), ...patch }, EXPECTED)?.code).toBe(code);
  });

  it('recusa cluster, migrations e fingerprint divergentes', () => {
    expect(evaluateExceptionalFacts(goodFacts(), { ...EXPECTED, clusterId: '00000000-0000-4000-8000-000000000000' })?.code)
      .toBe('ENVIRONMENT_MISMATCH');
    const missing = goodFacts(); missing.migrations = missing.migrations.slice(0, 8);
    expect(evaluateExceptionalFacts(missing, EXPECTED)?.code).toBe('SCHEMA_INCOMPATIBLE');
    const changed = goodFacts(); changed.migrations[0] = { ...changed.migrations[0]!, checksum: '0'.repeat(64) };
    expect(evaluateExceptionalFacts(changed, EXPECTED)?.code).toBe('SCHEMA_INCOMPATIBLE');
    expect(evaluateExceptionalFacts({ ...goodFacts(), schemaFingerprint: 'b'.repeat(64) }, EXPECTED)?.code)
      .toBe('SCHEMA_INCOMPATIBLE');
  });

  it('recusa grant, ownership e privilégio efetivo inesperados sem confundir privilégios PUBLIC informacionais', () => {
    const direct = goodFacts(); direct.bootstrapAcl.explicitGrants.routines = 1; direct.bootstrapExplicitAclCount = 1;
    expect(evaluateExceptionalFacts(direct, EXPECTED)?.code).toBe('UNSAFE_ROLE');
    const owner = goodFacts(); owner.bootstrapAcl.ownedObjects.types = 1;
    expect(evaluateExceptionalFacts(owner, EXPECTED)?.code).toBe('UNSAFE_ROLE');
    const effective = goodFacts(); effective.bootstrapAcl.effectiveUnsafe.dangerousRoutineObjects = 1;
    expect(evaluateExceptionalFacts(effective, EXPECTED)?.code).toBe('UNSAFE_ROLE');
    const publicOnly = goodFacts(); publicOnly.bootstrapAcl.effectiveInformational.typeUsageObjects = 99;
    expect(evaluateExceptionalFacts(publicOnly, EXPECTED)).toBeNull();
    const neonFacts = goodFacts();
    neonFacts.neonCreatorAdminOnlyMemberships = 4;
    neonFacts.bootstrapAcl.effectiveInformational.explicitDatabaseConnectCurrentDb = 1;
    expect(evaluateExceptionalFacts(neonFacts, EXPECTED)).toBeNull();
    const excessAdminOnly = goodFacts(); excessAdminOnly.neonCreatorAdminOnlyMemberships = 5;
    expect(evaluateExceptionalFacts(excessAdminOnly, EXPECTED)?.code).toBe('UNSAFE_ROLE');
    const excessDbConnect = goodFacts(); excessDbConnect.bootstrapAcl.effectiveInformational.explicitDatabaseConnectCurrentDb = 2;
    expect(evaluateExceptionalFacts(excessDbConnect, EXPECTED)?.code).toBe('UNSAFE_ROLE');
  });
});

describe('E5.1 — estado definitivo 10/10 separado do candidato histórico', () => {
  const expected: ExceptionalExpectedIdentity = { ...EXPECTED, migrationSet: 'e5-1' };
  it('aceita exclusivamente os dez checksums remotos e preserva o baseline histórico 9/9', () => {
    expect(E4_ALT_EXPECTED_MIGRATIONS).toHaveLength(9);
    expect(HOMOLOG_EXPECTED_MIGRATIONS).toHaveLength(10);
    expect(evaluateExceptionalFacts(homologFacts(), expected)).toBeNull();
    expect(evaluateExceptionalFacts(goodFacts(), expected)?.code).toBe('SCHEMA_INCOMPATIBLE');
    const wrongLocalTenth = homologFacts();
    wrongLocalTenth.migrations[9] = { ...wrongLocalTenth.migrations[9]!, checksum: '975044f0f5a033e3202f19b014d64c449714973d917737b4ea30ac11032020a7' };
    expect(evaluateExceptionalFacts(wrongLocalTenth, expected)?.code).toBe('SCHEMA_INCOMPATIBLE');
    const failed = homologFacts();
    failed.migrations[9] = { ...failed.migrations[9]!, finished: false };
    expect(evaluateExceptionalFacts(failed, expected)?.code).toBe('SCHEMA_INCOMPATIBLE');
  });

  it('candidato novo permanece não aprovado, valida snapshot e rejeita aprovação 9/9', async () => {
    const snapshot = completeSnapshot();
    const facts = { ...homologFacts(), schemaFingerprint: fingerprint(snapshot) };
    const candidate = await buildUnapprovedCandidate(facts, snapshot, {
      generatedAt: '2026-11-19T12:00:00.000Z', gitHead: 'f'.repeat(40),
      sourceDigest: computeE51SourceDigest(), clusterId: CLUSTER,
    }, 'e5-1');
    expect(candidate.format).toBe('rustika-e5-1-fingerprint-candidate-v1');
    expect(candidate.status).toBe('CANDIDATE_UNAPPROVED');
    expect(candidate.approvalTemplate.migrationSetDigest).toBe(homologMigrationSetDigest());
    expect(candidate.payload.migrations).toHaveLength(10);
    expect(parseApprovedHomologFingerprint(approvedHomologManifest()).ok).toBe(true);
    expect(parseApprovedHomologFingerprint(approvedManifest()).ok).toBe(false);
    expect(parseApprovedFingerprint(approvedHomologManifest()).ok).toBe(false);
    expect(parseApprovedHomologFingerprint(JSON.stringify(candidate.approvalTemplate)).ok).toBe(false);
    await expect(buildUnapprovedCandidate(goodFacts(), snapshot, {
      generatedAt: '2026-11-19T12:00:00.000Z', gitHead: 'f'.repeat(40),
      sourceDigest: computeE51SourceDigest(), clusterId: CLUSTER,
    }, 'e5-1')).rejects.toThrow(/SCHEMA_INCOMPATIBLE/);
  });
});

describe('E4-ALT — execução única', () => {
  it('dry-run não pede senha, não gera hash e não escreve', async () => {
    const db = new FakeExceptionalDb();
    const readPassword = vi.fn(async () => PASSWORD);
    const hash = vi.fn(hashPassword);
    const result = await runExceptionalMigratorBootstrap({ ...coreDeps(db, readPassword), hash }, IDENTITY, 'dry-run', EXPECTED);
    expect(result).toEqual({ status: 'dry-run-ok' });
    expect(readPassword).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
    expect(db.writes).toBe(0);
  });

  it('reutiliza scrypt existente e insere somente o primeiro administrador', async () => {
    const db = new FakeExceptionalDb();
    expect(await runExceptionalMigratorBootstrap(coreDeps(db), IDENTITY, 'execute', EXPECTED))
      .toEqual({ status: 'created', adminId: 'admin-1' });
    expect(db.admins).toHaveLength(1);
    expect(db.admins[0]!.passwordHash).toMatch(/^scrypt\$v1\$32768\$8\$3\$/);
    expect(await verifyPassword(PASSWORD, db.admins[0]!.passwordHash)).toBe(true);
    expect(db.admins[0]!.passwordHash).not.toContain(PASSWORD);
    expect(await runExceptionalMigratorBootstrap(coreDeps(db), { ...IDENTITY, email: 'outra@exemplo.invalid' }, 'execute', EXPECTED))
      .toMatchObject({ status: 'refused', code: 'ADMIN_ALREADY_EXISTS' });
    expect(db.admins).toHaveLength(1);
  });

  it('recusa senha inválida antes da escrita', async () => {
    const db = new FakeExceptionalDb();
    expect(await runExceptionalMigratorBootstrap(coreDeps(db, async () => 'curta'), IDENTITY, 'execute', EXPECTED))
      .toMatchObject({ status: 'refused', code: 'INVALID_PASSWORD' });
    expect(db.writes).toBe(0);
  });

  it('recusa a tentativa concorrente e não cria segundo administrador', async () => {
    const db = new FakeExceptionalDb();
    expect((await runExceptionalMigratorBootstrap(coreDeps(db), IDENTITY, 'execute', EXPECTED)).status).toBe('created');
    expect((await runExceptionalMigratorBootstrap(coreDeps(db), IDENTITY, 'execute', EXPECTED)).status).toBe('refused');
    expect(db.admins).toHaveLength(1);
  });

  it('distingue falha antes do COMMIT de resultado ambíguo', async () => {
    const beforeCommit = new Error('insert falhou antes do COMMIT');
    await expect(runExceptionalMigratorBootstrap(coreDeps(new FakeExceptionalDb(goodFacts(), beforeCommit)), IDENTITY, 'execute', EXPECTED))
      .rejects.toBe(beforeCommit);
    expect(await runExceptionalMigratorBootstrap(coreDeps(new FakeExceptionalDb(goodFacts(), new CommitOutcomeUnknown())), IDENTITY, 'execute', EXPECTED))
      .toEqual({ status: 'outcome-unknown' });
  });
});

describe('E4-ALT — adaptador Prisma e fronteira do COMMIT', () => {
  const factReader = async () => goodFacts();
  const input = { name: IDENTITY.name, email: IDENTITY.email, passwordHash: 'scrypt$v1$hash' };

  function prismaWith(options: { createError?: Error; commitError?: Error; transactionCode?: string } = {}) {
    const tx = {
      admin: {
        count: vi.fn(async () => 0),
        create: vi.fn(async () => {
          if (options.createError) throw options.createError;
          return { id: 'admin-1' };
        }),
      },
      $queryRaw: vi.fn(),
    };
    const transaction = vi.fn(async (callback: (client: typeof tx) => Promise<unknown>, settings: unknown) => {
      expect(settings).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (options.transactionCode) throw Object.assign(new Error('transaction'), { code: options.transactionCode });
      const result = await callback(tx);
      if (options.commitError) throw options.commitError;
      return result;
    });
    return { prisma: { $transaction: transaction } as unknown as PrismaClient, tx };
  }

  it('erro do INSERT antes de retornar do callback é falha definida, não COMMIT ambíguo', async () => {
    const error = new Error('insert recusado');
    const { prisma } = prismaWith({ createError: error });
    await expect(createExceptionalMigratorDb(prisma, { proven: true, reasons: [] }, factReader).insertFirstAdmin(input, EXPECTED))
      .rejects.toBe(error);
  });

  it('erro depois do callback é classificado como OUTCOME_UNKNOWN', async () => {
    const { prisma } = prismaWith({ commitError: new Error('socket caiu no COMMIT') });
    await expect(createExceptionalMigratorDb(prisma, { proven: true, reasons: [] }, factReader).insertFirstAdmin(input, EXPECTED))
      .rejects.toBeInstanceOf(CommitOutcomeUnknown);
  });

  it('P2034 é concorrência com rollback conhecido', async () => {
    const { prisma } = prismaWith({ transactionCode: 'P2034' });
    await expect(createExceptionalMigratorDb(prisma, { proven: true, reasons: [] }, factReader).insertFirstAdmin(input, EXPECTED))
      .rejects.toMatchObject({ code: 'CONCURRENT_BOOTSTRAP' });
  });
});

describe('E4-ALT — transação de diagnóstico PostgreSQL READ ONLY', () => {
  it('ativa READ ONLY como primeira instrução, comprova no servidor e não expõe métodos de escrita', async () => {
    const operations: string[] = [];
    const tx = {
      $executeRaw: vi.fn(async () => { operations.push('SET TRANSACTION READ ONLY'); return 0; }),
      $queryRaw: vi.fn(async () => { operations.push('SHOW transaction mode'); return [{ readOnly: true, isolation: 'serializable' }]; }),
      admin: { count: vi.fn(async () => 0), create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>, options: unknown) => {
         expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 });
        return callback(tx);
      }),
    } as unknown as PrismaClient;
    const result = await runSerializableReadOnlyTransaction(prisma, async (readOnly) => {
      expect(Object.keys(readOnly)).toEqual(['$queryRaw', 'admin']);
      expect(Object.keys(readOnly.admin)).toEqual(['count']);
      expect((readOnly.admin as { create?: unknown }).create).toBeUndefined();
      operations.push('reader');
      return 42;
    });
    expect(result).toBe(42);
    expect(operations).toEqual(['SET TRANSACTION READ ONLY', 'SHOW transaction mode', 'reader']);
  });

  it.each([
    { mode: [{ readOnly: false, isolation: 'serializable' }] },
    { mode: [{ readOnly: true, isolation: 'read committed' }] },
    { mode: [] },
  ])('falha fechada quando o servidor não comprova SERIALIZABLE READ ONLY', async ({ mode }) => {
    const tx = { $executeRaw: vi.fn(async () => 0), $queryRaw: vi.fn(async () => mode), admin: { count: vi.fn() } };
    const prisma = { $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) } as unknown as PrismaClient;
    await expect(runSerializableReadOnlyTransaction(prisma, async () => undefined)).rejects.toThrow(/SERIALIZABLE READ ONLY/);
  });

  it('propaga falha e deixa o Prisma encerrar a transação sem executar o leitor', async () => {
    const reader = vi.fn();
    const tx = { $executeRaw: vi.fn(async () => { throw new Error('connection lost'); }), $queryRaw: vi.fn(), admin: { count: vi.fn() } };
    const prisma = { $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) } as unknown as PrismaClient;
    await expect(runSerializableReadOnlyTransaction(prisma, reader)).rejects.toThrow('connection lost');
    expect(reader).not.toHaveBeenCalled();
  });

  it('transação expirada falha sem retry, com timeout explícito e sem executar coleta', async () => {
    const expired = Object.assign(new Error('Transaction not found'), { code: 'P2028' });
    const reader = vi.fn();
    const tx = {
      $executeRaw: vi.fn(async () => 0),
      $queryRaw: vi.fn(async () => { throw expired; }),
      admin: { count: vi.fn() },
    };
    const prisma = { $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) } as unknown as PrismaClient;
    await expect(runSerializableReadOnlyTransaction(prisma, reader)).rejects.toBe(expired);
    expect(prisma.$transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000,
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(reader).not.toHaveBeenCalled();
  });

  it('marca a etapa antes de um SELECT falhar sem emitir SQL, dados ou iniciar próximo estágio', async () => {
    const stages: string[] = [];
    const expired = Object.assign(new Error('Transaction not found'), { code: 'P2028' });
    const client = {
      $queryRaw: vi.fn(async () => { throw expired; }),
      admin: { count: vi.fn() },
    };
    await expect(collectExceptionalFacts(client as never, { proven: true, reasons: [] }, (stage) => stages.push(stage)))
      .rejects.toBe(expired);
    expect(stages).toEqual(['head']);
    expect(client.$queryRaw).toHaveBeenCalledTimes(1);
    expect(client.admin.count).not.toHaveBeenCalled();
  });
});

function cliHarness(overrides: Partial<ExceptionalCliDeps> = {}, db = new FakeExceptionalDb(homologFacts())) {
  const out: string[] = []; const err: string[] = []; const prompts: string[] = [];
  const close = vi.fn(async () => undefined);
  const database = {
    profile: 'migrate-homolog', purpose: 'migration' as const, environment: 'homolog' as const,
    database: E4_ALT_TARGET.database, user: E4_ALT_TARGET.migratorRole,
    databaseUrl: `postgresql://${E4_ALT_TARGET.migratorRole}:URL-SECRET@ep-sweet-king-bd7i7ypb.c-8.us-east-2.aws.neon.tech/${E4_ALT_TARGET.database}?schema=public&sslmode=require&sslaccept=strict&channel_binding=require`,
    host: 'ep-sweet-king-bd7i7ypb.c-8.us-east-2.aws.neon.tech', clusterId: CLUSTER, secretsFilePath: 'migrate-homolog.env', describe: () => 'redacted',
  };
  const deps: ExceptionalCliDeps = {
    loadProfile: vi.fn(() => database),
    connect: vi.fn(async () => ({ db, close })),
    hash: hashPassword,
    readHidden: vi.fn(async (prompt) => { prompts.push(prompt); return PASSWORD; }),
    readApproval: vi.fn(() => approvedHomologManifest()),
    out: (line) => out.push(line), err: (line) => err.push(line), ...overrides,
  };
  return { deps, db, out, err, prompts, close, database };
}

const ARGS = ['--profile', 'migrate-homolog', '--name', IDENTITY.name, '--email', IDENTITY.email,
  '--fingerprint-approval', APPROVAL_FILE];
const CONFIRM = { [EXCEPTIONAL_CONFIRMATION_ENV]: EXCEPTIONAL_CONFIRMATION_VALUE };

describe('E4-ALT — CLI e interlocks operacionais', () => {
  it('sem --execute é dry-run sem escrita nem senha', async () => {
    const h = cliHarness();
    expect(await runExceptionalMigratorCli(h.deps, ARGS, {})).toBe(0);
    expect(h.db.writes).toBe(0);
    expect(h.prompts).toEqual([]);
    expect(h.out.join('\n')).toContain('dry-run-ok');
  });

  it('confirmação ausente bloqueia antes de carregar perfil ou conectar', async () => {
    for (const env of [{}, { [EXCEPTIONAL_CONFIRMATION_ENV]: 'yes' }]) {
      const h = cliHarness();
      expect(await runExceptionalMigratorCli(h.deps, [...ARGS, '--execute'], env)).toBe(2);
      expect(h.deps.loadProfile).not.toHaveBeenCalled();
      expect(h.deps.connect).not.toHaveBeenCalled();
    }
  });

  it('e-mail inválido, perfil runtime e fingerprint ausente são recusados antes da conexão', async () => {
    for (const args of [
      ['--profile', 'migrate-homolog', '--name', 'Maria', '--email', 'invalido', '--fingerprint-approval', APPROVAL_FILE],
      ['--profile', 'app-homolog', '--name', 'Maria', '--email', 'm@x.invalid', '--fingerprint-approval', APPROVAL_FILE],
      ['--profile', 'migrate-homolog', '--name', 'Maria', '--email', 'm@x.invalid'],
    ]) {
      const h = cliHarness();
      expect(await runExceptionalMigratorCli(h.deps, args, {})).toBe(2);
      expect(h.deps.connect).not.toHaveBeenCalled();
    }
  });

  it('fingerprint ausente, ilegível, não aprovado ou de outra revisão bloqueia antes da conexão', async () => {
    const cases: Array<Partial<ExceptionalCliDeps>> = [
      { readApproval: vi.fn(() => { throw new Error('ENOENT'); }) },
      { readApproval: vi.fn(() => approvedHomologManifest({ status: 'CANDIDATE_UNAPPROVED' })) },
      { readApproval: vi.fn(() => approvedHomologManifest({ sourceDigest: 'c'.repeat(64) })) },
      { readApproval: vi.fn(() => approvedHomologManifest({ migrationSetDigest: 'd'.repeat(64) })) },
      { readApproval: vi.fn(() => approvedHomologManifest({ databaseOid: '1' })) },
      { readApproval: vi.fn(() => approvedHomologManifest({ reviewer: '' })) },
      { readApproval: vi.fn(() => approvedManifest()) },
    ];
    for (const overrides of cases) {
      const h = cliHarness(overrides);
      expect(await runExceptionalMigratorCli(h.deps, ARGS, {})).toBe(2);
      expect(h.deps.connect).not.toHaveBeenCalled();
      expect(h.err.join('\n')).toMatch(/fingerprint|Manifesto|aprovação/i);
    }
  });

  it('fingerprint aprovado que diverge do servidor recusa sem escrever', async () => {
    const h = cliHarness({ readApproval: vi.fn(() => approvedHomologManifest({ schemaFingerprint: 'b'.repeat(64) })) });
    expect(await runExceptionalMigratorCli(h.deps, ARGS, {})).toBe(2);
    expect(h.err.join('\n')).toContain('SCHEMA_INCOMPATIBLE');
    expect(h.db.writes).toBe(0);
  });

  it('falha de conexão é segura e não pede senha', async () => {
    const h = cliHarness({ connect: vi.fn(async () => { throw new Error('network'); }) });
    expect(await runExceptionalMigratorCli(h.deps, [...ARGS, '--execute'], CONFIRM)).toBe(1);
    expect(h.prompts).toEqual([]);
    expect(h.db.writes).toBe(0);
  });

  it('exige endpoint direto e TLS estrito', () => {
    const h = cliHarness();
    expect(strictTargetUrlProblem(h.database)).toBeNull();
    for (const databaseUrl of [
      h.database.databaseUrl.replace('sslmode=require', 'sslmode=verify-full'),
      h.database.databaseUrl.replace('sslmode=require', 'sslmode=prefer'),
      h.database.databaseUrl.replace('sslmode=require', 'sslmode=disable'),
      h.database.databaseUrl.replace('sslaccept=strict', ''),
      h.database.databaseUrl.replace('sslaccept=strict', 'sslaccept=accept_invalid_certs'),
      h.database.databaseUrl.replace('channel_binding=require', ''),
      h.database.databaseUrl.replace('channel_binding=require', 'channel_binding=prefer'),
      h.database.databaseUrl.replace('ep-sweet-king-', 'ep-sweet-king-pooler-'),
      h.database.databaseUrl.replace('ep-sweet-king-', 'ep-other-'),
      h.database.databaseUrl + '&sslmode=disable',
      h.database.databaseUrl + '&channel_binding=disable',
      h.database.databaseUrl + '&sslaccept=accept_invalid_certs',
      h.database.databaseUrl + '&sslrootcert=wrong-ca.pem',
      h.database.databaseUrl.replace('schema=public', 'schema=other'),
      h.database.databaseUrl.replace('postgresql:', 'http:'),
      h.database.databaseUrl.replace(`/${E4_ALT_TARGET.database}`, '/other_database'),
      h.database.databaseUrl.replace(E4_ALT_TARGET.migratorRole, 'other_user'),
    ]) expect(strictTargetUrlProblem({ ...h.database, databaseUrl } as never)).not.toBeNull();
  });

  it('parser recusa segredo em argumento e aceita apenas o contrato fechado', () => {
    expect(parseExceptionalArgs(ARGS)).toMatchObject({ ok: true });
    expect(parseExceptionalArgs([...ARGS, '--password', PASSWORD]).ok).toBe(false);
    expect(parseExceptionalArgs([...ARGS, '--foo', 'x']).ok).toBe(false);
  });

  it('resultado ambíguo usa exit 3, não confirma sucesso e manda não repetir', async () => {
    const h = cliHarness({}, new FakeExceptionalDb(homologFacts(), new CommitOutcomeUnknown()));
    expect(await runExceptionalMigratorCli(h.deps, [...ARGS, '--execute'], CONFIRM)).toBe(3);
    expect(h.err.join('\n')).toMatch(/OUTCOME_UNKNOWN.*NÃO REPITA/);
    expect(h.out.join('\n')).not.toContain('resultado=created');
  });

  it('execução válida não imprime senha, hash ou URL', async () => {
    const h = cliHarness();
    expect(await runExceptionalMigratorCli(h.deps, [...ARGS, '--execute'], CONFIRM)).toBe(0);
    const output = [...h.out, ...h.err].join('\n');
    expect(output).toMatch(/resultado=created administrador=m\*\*\*@exemplo\.invalid/);
    for (const secret of [PASSWORD, 'URL-SECRET', h.db.admins[0]!.passwordHash, 'scrypt$']) expect(output).not.toContain(secret);
    expect(h.close).toHaveBeenCalled();
  });
});

describe('E4-ALT — fingerprint independente e aprovação humana', () => {
  it('aceita somente manifesto APPROVED vinculado ao código, alvo e 9 migrations', () => {
    expect(parseApprovedFingerprint(approvedManifest())).toMatchObject({ ok: true });
    for (const patch of [
      { status: 'CANDIDATE_UNAPPROVED' },
      { format: 'rustika-e4-alt-fingerprint-candidate-v1' },
      { candidateDigest: 'x' },
      { sourceDigest: 'c'.repeat(64) },
      { migrationSetDigest: 'd'.repeat(64) },
      { projectId: 'other-project-12345678' },
      { branchId: 'br-other-branch-12345678' },
      { database: 'cardapio_digital_dev' },
      { databaseOid: '1' },
      { reviewer: ' ' },
      { reviewEvidence: 'curto' },
      { reviewedAt: '2026-11-18 12:00:00' },
    ]) expect(parseApprovedFingerprint(approvedManifest(patch)).ok).toBe(false);
    expect(parseApprovedFingerprint('{')).toMatchObject({ ok: false });
  });

  it('candidato é determinístico, confirmado pela implementação independente e nunca nasce aprovado', async () => {
    const snapshot = completeSnapshot();
    const facts = { ...goodFacts(), schemaFingerprint: fingerprint(snapshot) };
    const provenance = {
      generatedAt: '2026-11-18T12:00:00.000Z', gitHead: 'f'.repeat(40), sourceDigest: 'e'.repeat(64), clusterId: CLUSTER,
    };
    const candidate = await buildUnapprovedCandidate(facts, snapshot, provenance);
    expect(candidate.status).toBe('CANDIDATE_UNAPPROVED');
    expect(candidate.payload.schemaSnapshot).toEqual(snapshot);
    expect(candidate.candidateDigest).toBe(canonicalSha256(candidate.payload));
    expect(candidate.independentVerification).toEqual({
      implementation: 'node-webcrypto', digest: candidate.candidateDigest, matches: true,
    });
    expect(await independentSha256(candidate.payload)).toBe(candidate.candidateDigest);
    expect(parseApprovedFingerprint(JSON.stringify(candidate.approvalTemplate))).toMatchObject({ ok: false });
  });

  it('recusa candidato inseguro ou com snapshot divergente dos fatos', async () => {
    const snapshot = completeSnapshot();
    const facts = { ...goodFacts(), schemaFingerprint: fingerprint(snapshot) };
    const provenance = {
      generatedAt: '2026-11-18T12:00:00.000Z', gitHead: 'f'.repeat(40), sourceDigest: 'e'.repeat(64), clusterId: CLUSTER,
    };
    const unsafe = {
      ...facts,
      bootstrapAcl: {
        ...facts.bootstrapAcl,
        effectiveUnsafe: { ...facts.bootstrapAcl.effectiveUnsafe, databaseCreate: true },
      },
    };
    await expect(buildUnapprovedCandidate(unsafe, snapshot, provenance)).rejects.toThrow(/UNSAFE_ROLE/);
    await expect(buildUnapprovedCandidate({ ...facts, schemaFingerprint: 'b'.repeat(64) }, snapshot, provenance))
      .rejects.toThrow(/fingerprint do snapshot/);
  });

  it('aceita snapshot real do provedor Neon com aliases fechados e recusa vazamento de escopo ou role desconhecida', async () => {
    const snapshot: SchemaSnapshot = {
      ...completeSnapshot(),
      defaultAcls: [
        `${aliasRole('cloud_admin', E4_ALT_ROLE_ALIASES)}:public:r:${aliasRole('neon_superuser', E4_ALT_ROLE_ALIASES)}:SELECT:true`,
        `${aliasRole('cloud_admin', E4_ALT_ROLE_ALIASES)}:public:S:${aliasRole('neon_superuser', E4_ALT_ROLE_ALIASES)}:USAGE:true`,
      ],
      memberships: [
        `migrator<-${aliasRole('neondb_owner', E4_ALT_ROLE_ALIASES)}:true`,
        `runtime<-${aliasRole('neondb_owner', E4_ALT_ROLE_ALIASES)}:true`,
        `placeholder<-${aliasRole('neondb_owner', E4_ALT_ROLE_ALIASES)}:true`,
        `bootstrap<-${aliasRole('neondb_owner', E4_ALT_ROLE_ALIASES)}:true`,
      ],
    };
    expect(snapshotCompletenessProblems(snapshot)).toEqual([]);
    expect(neonProviderRoleScopeProblems(snapshot)).toEqual([]);

    const facts: ExceptionalBootstrapFacts = {
      ...goodFacts(),
      neonCreatorAdminOnlyMemberships: 4,
      bootstrapAcl: {
        ...safeBootstrapAcl(),
        effectiveInformational: { ...safeBootstrapAcl().effectiveInformational, explicitDatabaseConnectCurrentDb: 1 },
      },
      schemaFingerprint: fingerprint(snapshot),
    };
    const provenance = {
      generatedAt: '2026-11-18T12:00:00.000Z', gitHead: 'f'.repeat(40), sourceDigest: computeE4AltSourceDigest(), clusterId: CLUSTER,
    };
    const candidate = await buildUnapprovedCandidate(facts, snapshot, provenance);
    expect(candidate.status).toBe('CANDIDATE_UNAPPROVED');
    expect(candidate.payload.neonCreatorAdminOnlyMemberships).toBe(4);

    for (const badSnapshot of [
      { ...snapshot, owners: [...snapshot.owners, 'admins:neon_project_owner'] },
      { ...snapshot, tableAcls: [...snapshot.tableAcls, 'admins:neon_provider_superuser:SELECT:false'] },
      { ...snapshot, defaultAcls: ['migrator:public:r:neon_provider_superuser:SELECT:false'] },
      { ...snapshot, memberships: ['neon_provider_superuser<-migrator:false'] },
      { ...snapshot, memberships: [...snapshot.memberships, `migrator<-${aliasRole('rogue_role', E4_ALT_ROLE_ALIASES)}:true`] },
    ]) {
      await expect(
        buildUnapprovedCandidate({ ...facts, schemaFingerprint: fingerprint(badSnapshot) }, badSnapshot, provenance),
      ).rejects.toThrow(/Snapshot incompleto/);
    }
  });
});

describe('E4-ALT — limite estático do executor', () => {
  it('não contém DDL, GRANT/REVOKE, gates ou integração HTTP/Render', () => {
    const files = [
      resolve(__dirname, '../../scripts/bootstrap-admin-migrator.ts'),
      resolve(__dirname, '../../scripts/bootstrap/exceptionalMigratorBootstrap.ts'),
      resolve(__dirname, '../../scripts/bootstrap/exceptionalMigratorCli.ts'),
    ];
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(source).not.toMatch(/`\s*(?:GRANT|REVOKE|ALTER\s+ROLE|CREATE\s+(?:ROLE|TABLE)|DROP|TRUNCATE)\b/i);
    expect(source).not.toMatch(/05-post-migration|06-bootstrap|07-bootstrap|08-bootstrap/);
    expect(source).not.toMatch(/from\s+['"]express['"]|express\(|Router\(|\.route\(/);
    expect(source).toContain('tx.admin.create');
    expect(source).toContain('Serializable');
  });

  it('mantém o bootstrap original separado e sem fallback', () => {
    const original = readFileSync(resolve(__dirname, '../../scripts/bootstrap-admin.ts'), 'utf8');
    const exceptional = readFileSync(resolve(__dirname, '../../scripts/bootstrap-admin-migrator.ts'), 'utf8');
    expect(original).not.toContain('exceptionalMigrator');
    expect(exceptional).toContain('exceptionalMigrator');
    expect(exceptional).not.toContain('bootstrap-homolog');
  });
});

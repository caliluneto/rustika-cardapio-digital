import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertE2eGate, assertLegacyCleanupGate, assertTestDatabaseName, E2eAbort, isForbiddenDatabase } from './integration-db/e2e/gate';
import { cleanLegacy, inspectLegacy, LEGACY } from './integration-db/e2e/legacy';
import { e2eSetup, e2eTeardown, verifyJourney } from './integration-db/e2e/lifecycle';
import type { LifecycleDeps } from './integration-db/e2e/lifecycle';
import {
  listManifests, manifestPath, readManifest, replaceManifest, reservedComandaNumbers, resolveStateDir, validateManifest, writeManifestExclusive,
} from './integration-db/e2e/manifest';
import type { RunManifest } from './integration-db/e2e/manifest';
import { createRunIdentity } from './integration-db/support/fixtures';
import { FakeFixturesDb } from './helpers/fake-fixtures-db';
import type { TableName } from './helpers/fake-fixtures-db';

const GOOD_ENV = { RUSTIKA_E2E_CONFIRM: 'RUN_E2E_ON_CARDAPIO_DIGITAL_TEST', NODE_ENV: 'test', DB_PROFILE: 'app-test' };
const RUN_ID = '0a1b2c3d';
const OTHER_RUN = 'deadbeef';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-e2e-test-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

/** Rows that exist BEFORE the run: real data, another run's residue, the legacy E2E and look-alikes. */
function seedPreexisting(db: FakeFixturesDb) {
  const other = createRunIdentity(OTHER_RUN);
  const t = db.tables;
  t.admin.push(
    { id: uuid(1), email: 'dono@exemplo.test', name: 'Dono real', passwordHash: 'h1', isActive: true },
    { id: LEGACY.adminId, email: LEGACY.adminEmail, name: 'E2E Admin', passwordHash: 'h2', isActive: true },
    { id: uuid(3), email: other.adminEmail, name: 'Admin de outra execução', passwordHash: 'h3', isActive: true },
  );
  t.category.push(
    { id: uuid(11), publicKey: 'cat-real', name: 'Real', isActive: true },
    { id: LEGACY.categoryId, publicKey: LEGACY.categoryKey, name: 'E2E Category', isActive: true },
    { id: uuid(13), publicKey: other.categoryKey, name: 'Resíduo de outra execução', isActive: true },
  );
  t.product.push(
    { id: uuid(21), publicKey: 'rustika-REAL1', categoryId: uuid(11), name: 'Produto real', price: '10.00' },
    { id: LEGACY.productId, publicKey: LEGACY.productKey, categoryId: LEGACY.categoryId, name: 'E2E Product', price: '99.00' },
    { id: uuid(23), publicKey: 'rustika-OTHER', categoryId: uuid(13), name: 'Produto de outra execução', price: '5.00' },
  );
  t.comanda.push(
    { id: uuid(31), number: '000123', status: 'OPEN' },
    { id: LEGACY.comandaId, number: LEGACY.comandaNumber, status: 'OPEN' },
    { id: uuid(33), number: other.comandas.open, status: 'OPEN' },
  );
  t.comandaInvitation.push(
    { id: uuid(41), comandaId: uuid(31), issuedByAdminId: uuid(1), tokenHash: 'a'.repeat(64), consumedAt: new Date(0), revokedAt: null },
    { id: uuid(42), comandaId: LEGACY.comandaId, issuedByAdminId: LEGACY.adminId, tokenHash: 'b'.repeat(64), consumedAt: new Date(0), revokedAt: null },
    { id: uuid(43), comandaId: uuid(33), issuedByAdminId: uuid(3), tokenHash: 'c'.repeat(64), consumedAt: null, revokedAt: null },
  );
  t.comandaSession.push(
    { id: uuid(51), comandaId: uuid(31), invitationId: uuid(41), credentialHash: 'd'.repeat(64), revokedAt: null },
    { id: uuid(52), comandaId: LEGACY.comandaId, invitationId: uuid(42), credentialHash: 'e'.repeat(64), revokedAt: null },
  );
  t.order.push({ id: uuid(61), orderNumber: 7, comandaId: uuid(31), sessionId: uuid(51), status: 'RECEIVED', customerName: 'Cliente real', totalAmount: '10.00', idempotencyKey: '1'.repeat(64), requestDigest: '2'.repeat(64) });
  t.orderItem.push({ id: uuid(71), orderId: uuid(61), productId: uuid(21), productPublicKeySnapshot: 'rustika-REAL1', quantity: 1, unitPriceSnapshot: '10.00', subtotal: '10.00' });
  t.orderStatusHistory.push({ id: uuid(81), orderId: uuid(61), fromStatus: null, toStatus: 'RECEIVED', changedByAdminId: null });
  db.writes.length = 0; db.deletes.length = 0;
  return Object.fromEntries((Object.keys(t) as TableName[]).map((name) => [name, t[name].map((row) => JSON.stringify(row))])) as Record<TableName, string[]>;
}

const surviving = (db: FakeFixturesDb, before: Record<TableName, string[]>) =>
  (Object.keys(before) as TableName[]).every((name) => before[name].every((row) => db.dump()[name].includes(row)));

function makeDeps(db: FakeFixturesDb, over: Partial<LifecycleDeps> = {}) {
  const calls = { open: [] as boolean[], closed: 0 };
  const deps: LifecycleDeps = {
    env: GOOD_ENV, stateDir: dir, newRunId: () => RUN_ID,
    open: async (allowLeftovers) => { calls.open.push(allowLeftovers); return { fixtures: db.asPrisma(), close: async () => { calls.closed++; } }; },
    ...over,
  };
  return { deps, calls };
}

/** What the browser does through the real API: comanda + invitation + session + order (+items/history). */
function simulateBrowser(db: FakeFixturesDb, manifest: RunManifest, options: { orders?: number; total?: string } = {}) {
  const adminId = manifest.ids.adminIds[0]!; const productId = manifest.ids.productIds[0]!;
  const comanda = { id: uuid(901), number: manifest.journey.comanda, status: 'OPEN' }; db.tables.comanda.push(comanda);
  db.tables.comandaInvitation.push({ id: uuid(902), comandaId: comanda.id, issuedByAdminId: adminId, tokenHash: 'f'.repeat(64), consumedAt: new Date(1), revokedAt: null });
  db.tables.comandaSession.push({ id: uuid(903), comandaId: comanda.id, invitationId: uuid(902), credentialHash: '0'.repeat(64), revokedAt: null });
  const price = (manifest.journey.priceInCents / 100).toFixed(2);
  for (let i = 0; i < (options.orders ?? 1); i++) {
    const orderId = uuid(910 + i);
    db.tables.order.push({ id: orderId, orderNumber: 100 + i, comandaId: comanda.id, sessionId: uuid(903), status: 'RECEIVED', customerName: 'E2E Customer', totalAmount: options.total ?? price, idempotencyKey: String(i).repeat(64).slice(0, 64), requestDigest: '9'.repeat(64) });
    db.tables.orderItem.push({ id: uuid(920 + i), orderId, productId, productPublicKeySnapshot: manifest.journey.productKey, quantity: 1, unitPriceSnapshot: price, subtotal: price });
    db.tables.orderStatusHistory.push({ id: uuid(930 + i), orderId, fromStatus: null, toStatus: 'RECEIVED', changedByAdminId: null });
  }
}

describe('trava de ambiente do E2E', () => {
  it('aceita só o ambiente exato de teste', () => {
    expect(() => assertE2eGate(GOOD_ENV)).not.toThrow();
  });

  it.each([
    ['sem confirmação', { ...GOOD_ENV, RUSTIKA_E2E_CONFIRM: undefined }],
    ['confirmação errada', { ...GOOD_ENV, RUSTIKA_E2E_CONFIRM: 'yes' }],
    ["NODE_ENV='test ' (espaço do cmd.exe)", { ...GOOD_ENV, NODE_ENV: 'test ' }],
    ['NODE_ENV development', { ...GOOD_ENV, NODE_ENV: 'development' }],
    ["DB_PROFILE='app-test '", { ...GOOD_ENV, DB_PROFILE: 'app-test ' }],
    ['DB_PROFILE app-dev', { ...GOOD_ENV, DB_PROFILE: 'app-dev' }],
    ['DB_PROFILE migrate-test', { ...GOOD_ENV, DB_PROFILE: 'migrate-test' }],
    ['DATABASE_URL definida', { ...GOOD_ENV, DATABASE_URL: 'postgresql://x' }],
    ['SHADOW_DATABASE_URL definida', { ...GOOD_ENV, SHADOW_DATABASE_URL: 'postgresql://x' }],
    ['confirmação de deploy presente', { ...GOOD_ENV, CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION: 'APPLY_CARDAPIO_DIGITAL_TEST' }],
  ])('recusa: %s', (_label, env) => {
    expect(() => assertE2eGate(env)).toThrow(E2eAbort);
  });

  it('a limpeza legada exige a sua própria confirmação', () => {
    expect(() => assertLegacyCleanupGate(GOOD_ENV)).toThrow(/RUSTIKA_E2E_LEGACY_CLEANUP/);
    expect(() => assertLegacyCleanupGate({ ...GOOD_ENV, RUSTIKA_E2E_LEGACY_CLEANUP: 'ERASE_LEGACY_E2E_FIXTURES' })).not.toThrow();
  });

  it.each(['cardapio_digital_dev', 'cardapio_digital_shadow', 'cardapio_restore_check_20261104_120000', 'cardapio_restore_precheck',
    'plataforma_sites_ia', 'plataforma_sites_ia_test', 'postgres', 'template0', 'template1', 'rf004_lab_pos_20261027_01', 'cardapio_digital_prod', ''])('recusa o banco %j', (name) => {
    expect(() => assertTestDatabaseName(name)).toThrow(E2eAbort);
    expect(isForbiddenDatabase(name)).toBe(true);
  });

  it('aceita apenas cardapio_digital_test', () => {
    expect(() => assertTestDatabaseName('cardapio_digital_test')).not.toThrow();
    expect(isForbiddenDatabase('cardapio_digital_test')).toBe(false);
  });
});

describe('manifesto da execução', () => {
  const valid = (): RunManifest => ({
    version: 1, runId: RUN_ID, status: 'provisioned', createdAt: new Date().toISOString(), pid: 1, target: { database: 'cardapio_digital_test' },
    roles: { runtime: 'cardapio_test_app', fixtures: 'cardapio_test_fixtures' },
    ids: { adminIds: [uuid(1)], categoryIds: [uuid(2)], productIds: [uuid(3)] }, comandaNumbers: reservedComandaNumbers(RUN_ID),
    journey: { comanda: createRunIdentity(RUN_ID).comandas.open, productName: 'x', productKey: 'rustika-1', priceInCents: 5999 },
  });

  it('valida um manifesto íntegro', () => { expect(validateManifest(valid(), RUN_ID).runId).toBe(RUN_ID); });

  it.each<[string, (m: RunManifest) => void]>([
    ['banco Dev', (m) => { m.target.database = 'cardapio_digital_dev'; }],
    ['runId inválido', (m) => { m.runId = 'ZZZ'; }],
    ['faixa de comandas ampliada com número real', (m) => { m.comandaNumbers = [...m.comandaNumbers, '000123']; }],
    ['faixa trocada por outra execução', (m) => { m.comandaNumbers = reservedComandaNumbers(OTHER_RUN); }],
    ['comanda da jornada fora da faixa', (m) => { m.journey.comanda = '000123'; }],
    ['id que não é UUID', (m) => { m.ids.adminIds = ["1' OR '1'='1"]; }],
    ['lista de ids gigante', (m) => { m.ids.productIds = Array.from({ length: 21 }, (_, i) => uuid(i + 1)); }],
    ['role inesperada', (m) => { (m.roles as { fixtures: string }).fixtures = 'cardapio_migrator'; }],
    ['status inventado', (m) => { (m as { status: string }).status = 'done'; }],
    ['versão desconhecida', (m) => { (m as { version: number }).version = 2; }],
  ])('recusa manifesto adulterado: %s', (_label, mutate) => {
    const manifest = valid(); mutate(manifest);
    expect(() => validateManifest(manifest)).toThrow(E2eAbort);
  });

  it('o runId do arquivo precisa coincidir com o do conteúdo', () => {
    const file = writeManifestExclusive(dir, valid());
    fs.renameSync(file, manifestPath(dir, OTHER_RUN));
    expect(() => readManifest(manifestPath(dir, OTHER_RUN))).toThrow(/runId diverge/);
  });

  it('a criação é exclusiva e a substituição é atômica', () => {
    writeManifestExclusive(dir, valid());
    expect(() => writeManifestExclusive(dir, valid())).toThrow();
    replaceManifest(dir, { ...valid(), status: 'pending' });
    expect(readManifest(manifestPath(dir, RUN_ID)).status).toBe('pending');
    expect(fs.readdirSync(dir).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  it('a pasta de estado não pode ficar no repositório nem no OneDrive', () => {
    const repo = path.join(os.tmpdir(), 'rk-fake-repo');
    expect(() => resolveStateDir({ RUSTIKA_E2E_STATE_DIR: path.join(repo, 'estado') }, repo)).toThrow(/repositório/);
    expect(() => resolveStateDir({ RUSTIKA_E2E_STATE_DIR: 'C:\\Users\\x\\OneDrive\\Documentos\\estado' }, repo)).toThrow(/OneDrive/);
    expect(resolveStateDir({}, repo)).toContain('rustika-e2e');
  });
});

describe('setup: só cria, nada global, deixa manifesto', () => {
  it('provisiona a execução, escreve o manifesto sem segredos e não toca em nada preexistente', async () => {
    const db = new FakeFixturesDb(); const before = seedPreexisting(db);
    const { deps, calls } = makeDeps(db);
    const { manifest, env } = await e2eSetup(deps);
    expect(calls.open).toEqual([false]); expect(calls.closed).toBe(1);
    expect(manifest.status).toBe('provisioned');
    expect(db.writes.every((w) => w.op === 'create')).toBe(true); // nenhum update/delete/upsert
    expect(db.deletes).toEqual([]);
    expect(surviving(db, before)).toBe(true);
    // ids do manifesto = linhas realmente criadas
    expect(db.tables.admin.filter((r) => manifest.ids.adminIds.includes(r.id))).toHaveLength(2);
    expect(db.tables.category.find((r) => r.id === manifest.ids.categoryIds[0])?.publicKey).toBe(createRunIdentity(RUN_ID).categoryKey);
    expect(db.tables.product.filter((r) => manifest.ids.productIds.includes(r.id))).toHaveLength(6);
    // o nome do produto da jornada é o do produto numérico criado pelo FixtureRun
    expect(db.tables.product.find((r) => r.publicKey === manifest.journey.productKey)?.name).toBe(manifest.journey.productName);
    // senha só no ambiente do navegador, nunca no disco
    const text = fs.readFileSync(manifestPath(dir, RUN_ID), 'utf8');
    const password = env.RUSTIKA_E2E_ADMIN_PASSWORD ?? '';
    expect(password.length).toBeGreaterThanOrEqual(16);
    expect(text).not.toContain(password);
    expect(text).not.toMatch(/password|senha|token|postgres(ql)?:\/\//i);
    expect(env.RUSTIKA_E2E_COMANDA).toBe(manifest.journey.comanda);
  });

  it('manifesto remanescente bloqueia a execução ANTES de abrir o banco', async () => {
    const db = new FakeFixturesDb();
    writeManifestExclusive(dir, { version: 1, runId: OTHER_RUN, status: 'pending', createdAt: new Date().toISOString(), pid: 1, target: { database: 'cardapio_digital_test' },
      roles: { runtime: 'cardapio_test_app', fixtures: 'cardapio_test_fixtures' }, ids: { adminIds: [], categoryIds: [], productIds: [] },
      comandaNumbers: reservedComandaNumbers(OTHER_RUN), journey: { comanda: createRunIdentity(OTHER_RUN).comandas.open, productName: 'x', productKey: '', priceInCents: 0 } });
    const { deps, calls } = makeDeps(db);
    await expect(e2eSetup(deps)).rejects.toThrow(/manifesto de execução anterior/i);
    expect(calls.open).toEqual([]); expect(db.writes).toEqual([]);
  });

  it('ambiente errado aborta antes de tocar em disco ou banco', async () => {
    const db = new FakeFixturesDb(); const { deps, calls } = makeDeps(db, { env: { ...GOOD_ENV, NODE_ENV: 'test ' } });
    await expect(e2eSetup(deps)).rejects.toThrow(E2eAbort);
    expect(calls.open).toEqual([]); expect(listManifests(dir)).toEqual([]);
  });

  it('falha no meio do provisionamento: transação revertida, manifesto "pending" fica e nada é apagado', async () => {
    const db = new FakeFixturesDb(); const before = seedPreexisting(db);
    const original = db.product.create; let calls = 0;
    db.product.create = async (args) => { if (++calls === 3) throw new Error('falha simulada'); return original(args); };
    const { deps } = makeDeps(db);
    await expect(e2eSetup(deps)).rejects.toThrow('falha simulada');
    expect(surviving(db, before)).toBe(true);
    expect(db.tables.admin).toHaveLength(3); expect(db.tables.product).toHaveLength(3); // só o preexistente
    expect(db.deletes).toEqual([]);
    expect(readManifest(manifestPath(dir, RUN_ID)).status).toBe('pending');
  });
});

describe('teardown cirúrgico (FixtureRun real sobre banco falso)', () => {
  async function provisioned(options: Parameters<typeof simulateBrowser>[2] = {}) {
    const db = new FakeFixturesDb(); const before = seedPreexisting(db);
    const { manifest } = await e2eSetup(makeDeps(db).deps);
    simulateBrowser(db, manifest, options);
    db.writes.length = 0; db.deletes.length = 0;
    return { db, before, manifest };
  }

  it('verifica o pedido, remove só a execução e preserva todos os dados preexistentes', async () => {
    const { db, before, manifest } = await provisioned();
    const { deps, calls } = makeDeps(db);
    const result = await e2eTeardown(deps);
    expect(calls.open).toEqual([true]); expect(calls.closed).toBe(1);
    expect(result.verification).toEqual({ ok: true, problems: [], orderNumber: 100 });
    expect(Object.values(result.remaining).every((n) => n === 0)).toBe(true);
    expect(surviving(db, before)).toBe(true);
    // preexistente: exatamente as mesmas linhas (nada a mais, nada a menos)
    for (const name of Object.keys(before) as TableName[]) expect(db.tables[name]).toHaveLength(before[name].length);
    expect(listManifests(dir)).toEqual([]);
    expect(manifest.runId).toBe(RUN_ID);
  });

  it('todo DELETE é restrito por lista de ids da execução, em ordem filho -> pai, sem TRUNCATE nem filtro vazio', async () => {
    const { db, manifest } = await provisioned();
    // comandas da execução = as da faixa reservada (a fechada nasce no provision, a aberta pelo navegador)
    const runComandas = db.tables.comanda.filter((c) => manifest.comandaNumbers.includes(c.number)).map((c) => c.id);
    expect(runComandas).toHaveLength(2);
    await e2eTeardown(makeDeps(db).deps);
    expect(db.deletes.map((d) => d.table)).toEqual(['orderStatusHistory', 'orderItem', 'order', 'comandaSession', 'comandaInvitation', 'comanda', 'product', 'category', 'admin']);
    const allowed = new Set([...manifest.ids.adminIds, ...manifest.ids.categoryIds, ...manifest.ids.productIds, ...runComandas]);
    for (const { where } of db.deletes) {
      const text = JSON.stringify(where);
      expect(Object.keys(where).length).toBeGreaterThan(0);
      expect(text).toMatch(/"in":\[/);
      for (const id of text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []) expect(allowed.has(id)).toBe(true);
    }
  });

  it('adversarial: linhas parecidas (resíduo de outra execução, E2E legado, comanda 999999, faixa de outra execução) sobrevivem', async () => {
    const { db } = await provisioned();
    const other = createRunIdentity(OTHER_RUN);
    await e2eTeardown(makeDeps(db).deps);
    expect(db.tables.admin.map((r) => r.email).sort()).toEqual([LEGACY.adminEmail, 'dono@exemplo.test', other.adminEmail].sort());
    expect(db.tables.category.map((r) => r.publicKey).sort()).toEqual(['cat-real', LEGACY.categoryKey, other.categoryKey].sort());
    expect(db.tables.comanda.map((r) => r.number).sort()).toEqual(['000123', LEGACY.comandaNumber, other.comandas.open].sort());
    expect(db.tables.order).toHaveLength(1); expect(db.tables.order[0]!.customerName).toBe('Cliente real');
  });

  it('adversarial: comanda da faixa reservada com convite de OUTRO emissor não é apagada e a transação reverte', async () => {
    const { db, manifest } = await provisioned();
    db.tables.comandaInvitation.push({ id: uuid(950), comandaId: uuid(901), issuedByAdminId: uuid(1), tokenHash: '7'.repeat(64), consumedAt: null, revokedAt: null });
    const frozen = db.dump();
    const { deps } = makeDeps(db);
    await expect(e2eTeardown(deps)).rejects.toThrow(/chave estrangeira RESTRICT|resíduos/);
    expect(db.dump()).toEqual(frozen); // rollback total: nenhuma linha foi perdida
    expect(listManifests(dir)).toHaveLength(1); // manifesto mantido para investigação
    expect(manifest.runId).toBe(RUN_ID);
  });

  it('adversarial: registro extra na identidade da execução (que o manifesto não explica) aborta ANTES de apagar', async () => {
    const { db } = await provisioned();
    const category = db.tables.category.find((r) => r.publicKey === createRunIdentity(RUN_ID).categoryKey)!;
    db.tables.product.push({ id: uuid(990), publicKey: 'rustika-INTRUSO', categoryId: category.id, name: 'Intruso', price: '1.00' });
    const frozen = db.dump();
    await expect(e2eTeardown(makeDeps(db).deps)).rejects.toThrow(/manifesto não descreve/);
    expect(db.deletes).toEqual([]); expect(db.dump()).toEqual(frozen); expect(listManifests(dir)).toHaveLength(1);
  });

  it('sem manifesto não há limpeza por varredura', async () => {
    const db = new FakeFixturesDb(); const before = seedPreexisting(db);
    const { deps, calls } = makeDeps(db);
    await expect(e2eTeardown(deps)).rejects.toThrow(/Nenhum manifesto/);
    expect(calls.open).toEqual([]); expect(db.deletes).toEqual([]); expect(surviving(db, before)).toBe(true);
  });

  it('dois manifestos: estado ambíguo, nada é apagado nem o banco é aberto', async () => {
    const { db, manifest } = await provisioned();
    fs.copyFileSync(manifestPath(dir, RUN_ID), manifestPath(dir, OTHER_RUN));
    const { deps, calls } = makeDeps(db);
    await expect(e2eTeardown(deps)).rejects.toThrow(/ambíguo|divergente|runId diverge/);
    expect(calls.open).toEqual([]); expect(db.deletes).toEqual([]);
    expect(manifest.runId).toBe(RUN_ID);
  });

  it('manifesto adulterado para ampliar a faixa de comandas é recusado antes de abrir o banco', async () => {
    const { db, manifest } = await provisioned();
    const file = manifestPath(dir, RUN_ID);
    fs.writeFileSync(file, JSON.stringify({ ...manifest, comandaNumbers: [...manifest.comandaNumbers, '000123'] }));
    const { deps, calls } = makeDeps(db);
    await expect(e2eTeardown(deps)).rejects.toThrow(/comandaNumbers/);
    expect(calls.open).toEqual([]); expect(db.deletes).toEqual([]);
  });

  it('preflight reprovado (banco/migrations/ACL): nenhuma linha é apagada', async () => {
    const { db } = await provisioned(); const frozen = db.dump();
    const { deps } = makeDeps(db, { open: async () => { throw new Error('Suíte de integração abortada antes de qualquer escrita: banco errado'); } });
    await expect(e2eTeardown(deps)).rejects.toThrow(/abortada/);
    expect(db.deletes).toEqual([]); expect(db.dump()).toEqual(frozen); expect(listManifests(dir)).toHaveLength(1);
  });

  it('pedido duplicado: limpa mesmo assim, mas a verificação FALHA com o motivo', async () => {
    const { db } = await provisioned({ orders: 2 });
    const result = await e2eTeardown(makeDeps(db).deps);
    expect(result.verification?.ok).toBe(false);
    expect(result.verification?.problems.join(' ')).toMatch(/esperado 1 pedido.*encontrado 2/);
    expect(Object.values(result.remaining).every((n) => n === 0)).toBe(true);
  });

  it('total divergente é detectado pela verificação', async () => {
    const { db } = await provisioned({ total: '1.00' });
    const result = await e2eTeardown(makeDeps(db).deps);
    expect(result.verification?.ok).toBe(false);
    expect(result.verification?.problems.join(' ')).toMatch(/total 100 diverge de 5999/);
  });

  it('execução que nunca provisionou (manifesto pending): remove o manifesto sem apagar nada', async () => {
    const db = new FakeFixturesDb(); const before = seedPreexisting(db);
    writeManifestExclusive(dir, { version: 1, runId: RUN_ID, status: 'pending', createdAt: new Date().toISOString(), pid: 1, target: { database: 'cardapio_digital_test' },
      roles: { runtime: 'cardapio_test_app', fixtures: 'cardapio_test_fixtures' }, ids: { adminIds: [], categoryIds: [], productIds: [] },
      comandaNumbers: reservedComandaNumbers(RUN_ID), journey: { comanda: createRunIdentity(RUN_ID).comandas.open, productName: 'x', productKey: '', priceInCents: 0 } });
    const result = await e2eTeardown(makeDeps(db).deps);
    expect(result.verification).toBeNull();
    expect(db.deletes.every((d) => d.count === 0)).toBe(true);
    expect(surviving(db, before)).toBe(true); expect(listManifests(dir)).toEqual([]);
  });
});

describe('verifyJourney', () => {
  it('exige exatamente um convite consumido com sessão ativa', async () => {
    const manifest = { journey: { comanda: '900001', productKey: 'rustika-1', priceInCents: 5999 } } as RunManifest;
    const run = { ordersFor: async () => [], invitationsFor: async () => [{ consumedAt: null, revokedAt: null, session: null }] };
    const result = await verifyJourney(run, manifest);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/esperado 1 pedido/);
    expect(result.problems.join(' ')).toMatch(/convites consumidos com sessão ativa: 0/);
  });
});

describe('limpeza do resíduo do E2E antigo (seed_raw.js), escopo fixo', () => {
  const EXPECT = { invitationId: uuid(42), sessionId: uuid(52) };
  function legacyDb(extra?: (db: FakeFixturesDb) => void) {
    const db = new FakeFixturesDb(); const before = seedPreexisting(db);
    db.tables.order.push({ id: uuid(70), orderNumber: 8, comandaId: LEGACY.comandaId, sessionId: uuid(52), status: 'RECEIVED', customerName: 'x', totalAmount: '99.00', idempotencyKey: '3'.repeat(64), requestDigest: '4'.repeat(64) });
    db.tables.orderItem.push({ id: uuid(72), orderId: uuid(70), productId: LEGACY.productId, productPublicKeySnapshot: LEGACY.productKey, quantity: 1, unitPriceSnapshot: '99.00', subtotal: '99.00' });
    db.tables.orderStatusHistory.push({ id: uuid(82), orderId: uuid(70), fromStatus: null, toStatus: 'RECEIVED', changedByAdminId: null });
    extra?.(db);
    db.writes.length = 0;
    return { db, before };
  }

  it('dry-run lista e não escreve nada', async () => {
    const { db } = legacyDb(); const frozen = db.dump();
    const result = await cleanLegacy(db.asPrisma(), { execute: false });
    expect(result.executed).toBe(false);
    expect(result.inspection.counts).toEqual({ invitations: 1, sessions: 1, orders: 1, orderItems: 1, history: 1 });
    expect(db.writes).toEqual([]); expect(db.dump()).toEqual(frozen);
  });

  it('execute apaga somente as linhas legadas e preserva as demais', async () => {
    const { db, before } = legacyDb();
    const legacyRows = new Set([uuid(70), uuid(72), uuid(82), uuid(52), uuid(42), LEGACY.comandaId, LEGACY.productId, LEGACY.categoryId, LEGACY.adminId]);
    const result = await cleanLegacy(db.asPrisma(), { execute: true });
    expect(result.executed).toBe(true);
    expect(result.deleted).toMatchObject({ orders: 1, order_items: 1, order_status_history: 1, comanda_sessions: 1, comanda_invitations: 1, comandas: 1, products: 1, categories: 1, admins: 1 });
    for (const name of Object.keys(db.tables) as TableName[]) for (const row of db.tables[name]) expect(legacyRows.has(row.id)).toBe(false);
    for (const name of Object.keys(before) as TableName[]) {
      const kept = before[name].filter((json) => !legacyRows.has(JSON.parse(json).id));
      expect(kept.every((json) => db.dump()[name].includes(json))).toBe(true);
    }
    expect((await inspectLegacy(db.asPrisma())).present).toEqual({ admin: false, category: false, product: false, comanda: false });
  });

  it.each<[string, (db: FakeFixturesDb) => void, RegExp]>([
    ['convite de outro emissor na comanda legada', (db) => { db.tables.comandaInvitation.push({ id: uuid(60), comandaId: LEGACY.comandaId, issuedByAdminId: uuid(1), tokenHash: '5'.repeat(64) }); }, /cruzam a fronteira/],
    ['admin legado emitiu convite em outra comanda', (db) => { db.tables.comandaInvitation.push({ id: uuid(61), comandaId: uuid(31), issuedByAdminId: LEGACY.adminId, tokenHash: '6'.repeat(64) }); }, /cruzam a fronteira/],
    ['produto de outro dono na categoria legada', (db) => { db.tables.product.push({ id: uuid(62), publicKey: 'rustika-X', categoryId: LEGACY.categoryId, name: 'outro', price: '1.00' }); }, /produto\(s\) de outro dono/],
    ['e-mail legado com outro id', (db) => { db.tables.admin.push({ id: uuid(63), email: LEGACY.adminEmail, name: 'duplicado', passwordHash: 'h', isActive: true }); }, /outro admin com o e-mail legado/],
    ['id legado com atributo diferente', (db) => { db.tables.category.find((r) => r.id === LEGACY.categoryId)!.publicKey = 'categoria-real'; }, /chave diferente/],
    ['produto legado em pedido de outra comanda', (db) => { db.tables.orderItem.push({ id: uuid(64), orderId: uuid(61), productId: LEGACY.productId, productPublicKeySnapshot: LEGACY.productKey, quantity: 1, unitPriceSnapshot: '1.00', subtotal: '1.00' }); }, /outra comanda/],
  ])('aborta sem apagar: %s', async (_label, mutate, pattern) => {
    const { db } = legacyDb(mutate); const frozen = db.dump();
    await expect(cleanLegacy(db.asPrisma(), { execute: true })).rejects.toThrow(pattern);
    expect(db.deletes).toEqual([]); expect(db.dump()).toEqual(frozen);
  });

  it('escopo mínimo (blocker): aborta sem apagar se houver pedido na comanda legada', async () => {
    const { db } = legacyDb(); const frozen = db.dump();
    await expect(cleanLegacy(db.asPrisma(), { execute: true, scope: 'blocker', expect: EXPECT })).rejects.toThrow(/há pedidos na comanda legada/);
    expect(db.deletes).toEqual([]); expect(db.dump()).toEqual(frozen);
  });

  it('escopo mínimo (blocker): remove só comanda 999999, convite e sessão; preserva admin, categoria e produto', async () => {
    const { db, before } = legacyDb((d) => {
      d.tables.orderStatusHistory = d.tables.orderStatusHistory.filter((r) => r.id !== uuid(82));
      d.tables.orderItem = d.tables.orderItem.filter((r) => r.id !== uuid(72));
      d.tables.order = d.tables.order.filter((r) => r.id !== uuid(70));
    });
    const removed = new Set([uuid(52), uuid(42), LEGACY.comandaId]);
    const result = await cleanLegacy(db.asPrisma(), { execute: true, scope: 'blocker', expect: EXPECT });
    expect(result.executed).toBe(true);
    expect(result.deleted).toMatchObject({ comanda_sessions: 1, comanda_invitations: 1, comandas: 1 });
    expect(result.deleted).not.toHaveProperty('admins'); expect(result.deleted).not.toHaveProperty('products'); expect(result.deleted).not.toHaveProperty('categories');
    expect((await inspectLegacy(db.asPrisma())).present).toEqual({ admin: true, category: true, product: true, comanda: false });
    for (const name of Object.keys(db.tables) as TableName[]) for (const row of db.tables[name]) expect(removed.has(row.id)).toBe(false);
    for (const name of Object.keys(before) as TableName[]) {
      const kept = before[name].filter((json) => !removed.has(JSON.parse(json).id) && ![uuid(70), uuid(72), uuid(82)].includes(JSON.parse(json).id));
      expect(kept.every((json) => db.dump()[name].includes(json))).toBe(true);
    }
  });

  const noOrders = (d: FakeFixturesDb) => {
    d.tables.orderStatusHistory = d.tables.orderStatusHistory.filter((r) => r.id !== uuid(82));
    d.tables.orderItem = d.tables.orderItem.filter((r) => r.id !== uuid(72));
    d.tables.order = d.tables.order.filter((r) => r.id !== uuid(70));
  };

  it.each<[string, unknown]>([
    ['sem ids informados', undefined],
    ['id de convite malformado', { invitationId: 'abc', sessionId: uuid(52) }],
    ['id de sessão vazio', { invitationId: uuid(42), sessionId: '' }],
  ])('escopo mínimo (blocker) exige ids exatos: %s', async (_label, expectation) => {
    const { db } = legacyDb(noOrders); const frozen = db.dump();
    await expect(cleanLegacy(db.asPrisma(), { execute: true, scope: 'blocker', expect: expectation as never })).rejects.toThrow(/exige os ids exatos/);
    expect(db.deletes).toEqual([]); expect(db.dump()).toEqual(frozen);
  });

  it.each<[string, (db: FakeFixturesDb) => void, { invitationId: string; sessionId: string }]>([
    ['convite informado difere do existente', noOrders, { invitationId: uuid(77), sessionId: uuid(52) }],
    ['sessão informada difere da existente', noOrders, { invitationId: uuid(42), sessionId: uuid(78) }],
    ['segunda sessão na comanda legada', (d) => { noOrders(d); d.tables.comandaSession.push({ id: uuid(79), comandaId: LEGACY.comandaId, invitationId: uuid(42), credentialHash: '8'.repeat(64), revokedAt: null }); }, { invitationId: uuid(42), sessionId: uuid(52) }],
  ])('escopo mínimo (blocker) aborta sem apagar: %s', async (_label, mutate, expectation) => {
    const { db } = legacyDb(mutate); const frozen = db.dump();
    await expect(cleanLegacy(db.asPrisma(), { execute: true, scope: 'blocker', expect: expectation })).rejects.toThrow(/id diferente do informado/);
    expect(db.deletes).toEqual([]); expect(db.dump()).toEqual(frozen);
  });

  it('escopo mínimo (blocker): dry-run não escreve e lista os ids', async () => {
    const { db } = legacyDb(noOrders); const frozen = db.dump();
    const result = await cleanLegacy(db.asPrisma(), { execute: false, scope: 'blocker', expect: EXPECT });
    expect(result.executed).toBe(false); expect(result.inspection.counts).toMatchObject({ invitations: 1, sessions: 1, orders: 0 });
    expect(db.writes).toEqual([]); expect(db.deletes).toEqual([]); expect(db.dump()).toEqual(frozen);
  });

  it('escopo mínimo (blocker): cada exclusão carrega o id exato (nada por varredura)', async () => {
    const { db } = legacyDb(noOrders);
    await cleanLegacy(db.asPrisma(), { execute: true, scope: 'blocker', expect: EXPECT });
    const text = JSON.stringify(db.deletes);
    expect(text).toContain(uuid(42)); expect(text).toContain(uuid(52)); expect(text).toContain(LEGACY.comandaId);
    const tables = new Set(db.deletes.map((d) => d.table));
    for (const forbidden of ['admin', 'category', 'product'] as const) expect(tables.has(forbidden)).toBe(false);
    expect(db.deletes.every((d) => d.count <= 1)).toBe(true);
  });

  it('sem resíduo legado não escreve nada', async () => {
    const db = new FakeFixturesDb();
    const result = await cleanLegacy(db.asPrisma(), { execute: true });
    expect(result.executed).toBe(false); expect(db.writes).toEqual([]);
  });
});

describe('o código do E2E não faz nada global (análise estática)', () => {
  const dirE2e = path.join(process.cwd(), 'tests', 'integration-db', 'e2e');
  const sources = fs.readdirSync(dirE2e).filter((n) => n.endsWith('.ts')).map((n) => [n, fs.readFileSync(path.join(dirE2e, n), 'utf8')] as const);

  it.each(sources)('%s: sem SQL cru de escrita, sem TRUNCATE, sem deleteMany vazio, sem credencial embutida', (_name, text) => {
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/TRUNCATE|DELETE\s+FROM|\$executeRaw|\$queryRaw|ALTER\s+SEQUENCE|setval/i);
    expect(code).not.toMatch(/deleteMany\(\s*\)|deleteMany\(\{\s*\}\)|deleteMany\(\{\s*where:\s*\{\s*\}\s*\}\)/);
    expect(code).not.toMatch(/postgres(ql)?:\/\/[^\s'"`]*:[^\s'"`@]+@/i);
    expect(code).not.toMatch(/seed_raw|Exportacao-produtos|xlsx/i);
  });
});

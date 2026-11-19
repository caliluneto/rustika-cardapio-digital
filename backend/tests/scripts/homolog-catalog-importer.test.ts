import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Prisma, type PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { E4_ALT_EXPECTED_MIGRATIONS, E4_ALT_TARGET } from '../../scripts/bootstrap/exceptionalMigratorBootstrap';
import { HOMOLOG_EXPECTED_MIGRATIONS } from '../../scripts/homolog/homologMigrationChain';
import {
  HOMOLOG_CATALOG_CONFIRMATION_ENV,
  HOMOLOG_CATALOG_CONFIRMATION_VALUE,
  HOMOLOG_CATALOG_PROFILE,
  HomologCatalogError,
  evaluateHomologCatalogTarget,
  parseHomologCatalogArgs,
  planHomologCatalogFromFile,
  planHomologCatalogFromRows,
  reconcileHomologCatalog,
  runCatalogReadOnlyTransaction,
  runHomologCatalogCli,
  type HomologCatalogDbAdapter,
  type HomologCatalogRunnerDeps,
  type HomologCatalogServerFacts,
  type SpreadsheetPlan,
  type StoredCategoryRow,
  type StoredProductRow,
} from '../../scripts/homolog/catalogHomologImporter';
import { CATEGORY_PUBLIC_KEYS, planCategoryPublication } from '../../src/domain/categoryPublication';
import { SYNTHETIC_EXPECTED } from '../fixtures/catalog/synthetic-catalog';
import { syntheticCatalogPath, syntheticInvalidPricesPath } from '../helpers/catalog-sources';

const CLUSTER = '3f2b8c1e-9d4a-4b7e-8a61-0c5d2e7f9a10';
const CONFIRM_ENV = { [HOMOLOG_CATALOG_CONFIRMATION_ENV]: HOMOLOG_CATALOG_CONFIRMATION_VALUE };
const SYNTHETIC_CATEGORY_KEYS: Readonly<Record<string, string>> = {
  ...CATEGORY_PUBLIC_KEYS,
  ...Object.fromEntries(
    Array.from({ length: 10 }, (_, idx) => {
      const n = String(idx + 1).padStart(2, '0');
      return [`SINT GRUPO ${n}`, `rustika-category-sint-grupo-${n}`];
    }),
  ),
};

const goodServerFacts = (patch: Partial<HomologCatalogServerFacts> = {}): HomologCatalogServerFacts => ({
  database: E4_ALT_TARGET.database,
  databaseOid: E4_ALT_TARGET.databaseOid,
  currentUser: E4_ALT_TARGET.migratorRole,
  sessionUser: E4_ALT_TARGET.migratorRole,
  projectId: E4_ALT_TARGET.projectId,
  branchId: E4_ALT_TARGET.branchId,
  markerComment: `rustika-homolog-cluster:${CLUSTER}`,
  serverVersionNum: 180006,
  elevatedRole: false,
  databaseOwner: E4_ALT_TARGET.migratorRole,
  migrations: HOMOLOG_EXPECTED_MIGRATIONS.map(({ name, checksum }) => ({
    name,
    checksum,
    finished: true,
    rolledBack: false,
  })),
  externalTls: { proven: true, reasons: [] },
  ...patch,
});

describe('E5.1 — gate do importador', () => {
  it('recusa evidência histórica 9/9, checksum da décima local e migration com falha', () => {
    const old = E4_ALT_EXPECTED_MIGRATIONS.map((m) => ({ ...m, finished: true, rolledBack: false }));
    expect(evaluateHomologCatalogTarget(goodServerFacts({ migrations: old }), CLUSTER)?.code).toBe('SCHEMA_INCOMPATIBLE');
    const wrong = [...goodServerFacts().migrations];
    wrong[9] = { ...wrong[9]!, checksum: '975044f0f5a033e3202f19b014d64c449714973d917737b4ea30ac11032020a7' };
    expect(evaluateHomologCatalogTarget(goodServerFacts({ migrations: wrong }), CLUSTER)?.code).toBe('SCHEMA_INCOMPATIBLE');
    wrong[9] = { ...wrong[9]!, checksum: HOMOLOG_EXPECTED_MIGRATIONS[9]!.checksum, finished: false };
    expect(evaluateHomologCatalogTarget(goodServerFacts({ migrations: wrong }), CLUSTER)?.code).toBe('SCHEMA_INCOMPATIBLE');
  });
});

class InMemoryHomologCatalogDb implements HomologCatalogDbAdapter {
  categories: StoredCategoryRow[] = [];
  products: StoredProductRow[] = [];
  readCalls = 0;
  writeCalls = 0;
  private seq = 1;

  constructor(public facts: HomologCatalogServerFacts = goodServerFacts()) {}

  async readState() {
    this.readCalls++;
    return {
      facts: this.facts,
      categories: [...this.categories],
      products: [...this.products],
    };
  }

  async applyPlan(plan: SpreadsheetPlan, expectedClusterId: string) {
    this.writeCalls++;
    const targetProblem = evaluateHomologCatalogTarget(this.facts, expectedClusterId);
    if (targetProblem) throw new HomologCatalogError(targetProblem.code, targetProblem.message);

    const reconciliation = reconcileHomologCatalog(plan, this.categories, this.products);
    if (reconciliation.conflicts.length > 0) {
      throw new HomologCatalogError('RECONCILIATION_CONFLICT', reconciliation.conflicts.join(' '));
    }

    let categoriesCreated = 0;
    let categoriesPublished = 0;
    for (const action of reconciliation.categories.actions) {
      if (action.action === 'CREATE') {
        this.categories.push({
          id: `cat-${this.seq++}`,
          name: action.name,
          publicKey: action.publicKey,
          displayOrder: action.displayOrder,
          isActive: true,
        });
        categoriesCreated++;
      } else if (action.action === 'PUBLISH_KEY') {
        const idx = this.categories.findIndex((c) => c.id === action.existingId);
        if (idx >= 0) {
          this.categories[idx] = { ...this.categories[idx]!, publicKey: action.publicKey };
          categoriesPublished++;
        }
      }
    }

    const categoryByName = new Map(this.categories.map((c) => [c.name, c]));
    const plannedByCode = new Map(plan.products.map((p) => [p.sourceCode, p]));
    let productsCreated = 0;
    let productsUpdated = 0;

    for (const action of reconciliation.products.actions) {
      const planned = plannedByCode.get(action.sourceCode)!;
      const cat = categoryByName.get(planned.sourceGroup)!;
      if (action.action === 'CREATE') {
        this.products.push({
          id: `prod-${this.seq++}`,
          publicKey: planned.publicKey,
          sourceCode: planned.sourceCode,
          sourceName: planned.sourceName,
          sourceGroup: planned.sourceGroup,
          name: planned.name,
          priceInCents: planned.priceInCents,
          isActive: true,
          availabilityState: 'UNKNOWN',
          categoryId: cat.id,
        });
        productsCreated++;
      } else if (action.action === 'UPDATE') {
        const idx = this.products.findIndex((p) => p.id === action.existingId);
        if (idx >= 0) {
          const prev = this.products[idx]!;
          this.products[idx] = {
            ...prev,
            priceInCents: planned.priceInCents,
            sourceName: planned.sourceName,
            sourceGroup: planned.sourceGroup,
            categoryId: cat.id,
            ...(action.updateNameTo !== undefined ? { name: action.updateNameTo } : {}),
          };
          productsUpdated++;
        }
      }
    }

    const pub = planCategoryPublication(this.categories, this.products);
    return {
      reconciliation,
      applied: {
        categoriesCreated,
        categoriesPublished,
        productsCreated,
        productsUpdated,
        eligibleAfter: pub.totals.eligibleAfter,
      },
    };
  }
}

function makeCliHarness(db = new InMemoryHomologCatalogDb(), overrides: Partial<HomologCatalogRunnerDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const close = vi.fn(async () => undefined);
  const database = {
    profile: HOMOLOG_CATALOG_PROFILE,
    purpose: 'migration' as const,
    environment: 'homolog' as const,
    database: E4_ALT_TARGET.database,
    user: E4_ALT_TARGET.migratorRole,
    databaseUrl: `postgresql://${E4_ALT_TARGET.migratorRole}:SECRET-PASS@ep-sweet-king-bd7i7ypb.c-8.us-east-2.aws.neon.tech/${E4_ALT_TARGET.database}?schema=public&sslmode=require&sslaccept=strict&channel_binding=require`,
    host: 'ep-sweet-king-bd7i7ypb.c-8.us-east-2.aws.neon.tech',
    clusterId: CLUSTER,
    secretsFilePath: 'migrate-homolog.env',
    describe: () => 'redacted',
  };
  const deps: HomologCatalogRunnerDeps = {
    loadProfile: vi.fn(() => database),
    connect: vi.fn(async () => ({ db, close })),
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    catalogPath: syntheticCatalogPath,
    categoryKeys: SYNTHETIC_CATEGORY_KEYS,
    ...overrides,
  };
  return { deps, db, out, err, close, database };
}

describe('Importador de catálogo de homologação (fixture sintética sanitizada)', () => {
  it('classifica a fixture sintética excluindo 100% dos inativos, insumos e incertos', () => {
    const plan = planHomologCatalogFromFile(syntheticCatalogPath, SYNTHETIC_CATEGORY_KEYS);
    expect(plan.totals).toEqual({
      totalRows: SYNTHETIC_EXPECTED.total,
      activeRows: SYNTHETIC_EXPECTED.ativos,
      commercializedToImport: SYNTHETIC_EXPECTED.publicos,
      internalSuppliesExcluded: SYNTHETIC_EXPECTED.internos,
      uncertainExcluded: SYNTHETIC_EXPECTED.incertosSuspensos,
      inactiveExcluded: SYNTHETIC_EXPECTED.inativosExcluidos,
      categoriesRequired: 12,
    });
    expect(plan.products).toHaveLength(144);
    expect(plan.products.every((p) => p.priceInCents > 1)).toBe(true);
    expect(plan.products.some((p) => p.sourceCode === SYNTHETIC_EXPECTED.alphaCode)).toBe(true);
  });

  it('rejeita preços inválidos, códigos duplicados, grupo sem mapeamento e preço de 1 centavo em comercializado', () => {
    expect(() => planHomologCatalogFromFile(syntheticInvalidPricesPath)).toThrow(HomologCatalogError);

    const baseRow = {
      'Código': '101',
      'Nome curto': 'ITEM VALIDO',
      'Estado': 'Ativo',
      'Grupo': 'CERVEJA',
      'Preço venda': 15.5,
    };
    expect(() => planHomologCatalogFromRows([baseRow, { ...baseRow, 'Nome curto': 'OUTRO' }])).toThrow(/duplicado/i);
    expect(() => planHomologCatalogFromRows([{ ...baseRow, 'Grupo': 'GRUPO_DESCONHECIDO' }])).toThrow(/Grupo sem chave/i);
    expect(() => planHomologCatalogFromRows([{ ...baseRow, 'Código': 'cod-invalido!' }])).toThrow(/incompatível com o contrato/i);
    expect(() => planHomologCatalogFromRows([{ ...baseRow, 'Preço venda': 0 }])).toThrow(/Preço fora da faixa/i);
  });

  it('dry-run exige --authorize-read-only, não escreve nada e relata contagens exatas', async () => {
    const hDenied = makeCliHarness();
    expect(await runHomologCatalogCli(hDenied.deps, ['--profile', 'migrate-homolog'], {})).toBe(2);
    expect(hDenied.deps.connect).not.toHaveBeenCalled();

    const h = makeCliHarness();
    const code = await runHomologCatalogCli(h.deps, ['--profile', 'migrate-homolog', '--authorize-read-only'], {});
    expect(code).toBe(0);
    expect(h.db.readCalls).toBe(1);
    expect(h.db.writeCalls).toBe(0);
    const report = JSON.parse(h.out.join('\n'));
    expect(report.mode).toBe('dry-run');
    expect(report.reconciliation).toMatchObject({
      categoriesToCreate: 12,
      productsToCreate: 144,
      productsUnchanged: 0,
      productsToUpdate: 0,
    });
    expect(h.out.join('\n')).not.toContain('SECRET-PASS');
  });

  it('execute exige confirmação explícita; quando autorizado, importa 144 produtos comercializados e é 100% idempotente preservando disponibilidade', async () => {
    const db = new InMemoryHomologCatalogDb();

    const noConfirm = makeCliHarness(db);
    expect(await runHomologCatalogCli(noConfirm.deps, ['--profile', 'migrate-homolog', '--execute'], {})).toBe(2);
    expect(noConfirm.deps.connect).not.toHaveBeenCalled();

    // 1ª execução: cria 12 categorias e 144 produtos com availabilityState = UNKNOWN
    const first = makeCliHarness(db);
    expect(await runHomologCatalogCli(first.deps, ['--profile', 'migrate-homolog', '--execute'], CONFIRM_ENV)).toBe(0);
    const firstSummary = JSON.parse(first.out.join('\n'));
    expect(firstSummary.applied).toEqual({
      categoriesCreated: 12,
      categoriesPublished: 0,
      productsCreated: 144,
      productsUpdated: 0,
      eligibleAfter: 144,
    });
    expect(db.products).toHaveLength(144);
    expect(db.products.every((p) => p.availabilityState === 'UNKNOWN')).toBe(true);

    // Simula operação do administrador no painel: torna 2 produtos AVAILABLE e 1 UNAVAILABLE, e customiza nome de 1 produto
    db.products[0] = { ...db.products[0]!, availabilityState: 'AVAILABLE', name: 'Nome Customizado Admin' };
    db.products[1] = { ...db.products[1]!, availabilityState: 'UNAVAILABLE' };

    // 2ª execução idempotente: 0 criações, 0 updates, disponibilidade e nome customizado preservados!
    const second = makeCliHarness(db);
    expect(await runHomologCatalogCli(second.deps, ['--profile', 'migrate-homolog', '--execute'], CONFIRM_ENV)).toBe(0);
    const secondSummary = JSON.parse(second.out.join('\n'));
    expect(secondSummary.applied).toEqual({
      categoriesCreated: 0,
      categoriesPublished: 0,
      productsCreated: 0,
      productsUpdated: 0,
      eligibleAfter: 144,
    });
    expect(db.products[0]!.availabilityState).toBe('AVAILABLE');
    expect(db.products[0]!.name).toBe('Nome Customizado Admin');
    expect(db.products[1]!.availabilityState).toBe('UNAVAILABLE');
  });

  it('preserva produtos manuais extras (RF006) e falha fechado em conflitos de identidade ou ambiente incorreto', async () => {
    const db = new InMemoryHomologCatalogDb();
    await runHomologCatalogCli(makeCliHarness(db).deps, ['--profile', 'migrate-homolog', '--execute'], CONFIRM_ENV);

    // Adiciona produto manual criado pelo admin via RF006
    db.products.push({
      id: 'prod-manual-rf006',
      publicKey: 'rustika-MANUAL999',
      sourceCode: 'MANUAL999',
      sourceName: 'PORCAO ESPECIAL DA CASA',
      sourceGroup: 'DIVERSOS',
      name: 'Porção Especial da Casa',
      priceInCents: 5990,
      isActive: true,
      availabilityState: 'AVAILABLE',
      categoryId: db.categories.find((c) => c.name === 'DIVERSOS')!.id,
    });

    const dry = makeCliHarness(db);
    expect(await runHomologCatalogCli(dry.deps, ['--profile', 'migrate-homolog', '--authorize-read-only'], {})).toBe(0);
    expect(JSON.parse(dry.out.join('\n')).reconciliation.productsExtraInDb).toBe(1);

    // Ambiente incorreto (ex.: branch errada ou migration faltando) é recusado
    const wrongBranchDb = new InMemoryHomologCatalogDb(goodServerFacts({ branchId: 'br-wrong-branch-0000' }));
    const wrongBranch = makeCliHarness(wrongBranchDb);
    expect(await runHomologCatalogCli(wrongBranch.deps, ['--profile', 'migrate-homolog', '--authorize-read-only'], {})).toBe(2);
    expect(wrongBranch.err.join('\n')).toContain('ENVIRONMENT_MISMATCH');

    // Produto interno sem chave pública no banco bloqueia reconciliação automática
    const dirtyDb = new InMemoryHomologCatalogDb();
    dirtyDb.categories.push({ id: 'c1', name: 'CERVEJA', publicKey: 'rustika-category-cerveja', isActive: true, displayOrder: 40 });
    dirtyDb.products.push({
      id: 'internal-orphan',
      publicKey: null,
      sourceCode: null,
      sourceName: null,
      sourceGroup: null,
      name: 'Insumo Solto',
      priceInCents: 1,
      isActive: true,
      availabilityState: 'UNKNOWN',
      categoryId: 'c1',
    });
    const dirtyRun = makeCliHarness(dirtyDb);
    expect(await runHomologCatalogCli(dirtyRun.deps, ['--profile', 'migrate-homolog', '--execute'], CONFIRM_ENV)).toBe(2);
    expect(dirtyRun.err.join('\n')).toContain('RECONCILIATION_CONFLICT');
  });

  it('runCatalogReadOnlyTransaction ativa SET TRANSACTION READ ONLY e congela cliente sem métodos de escrita', async () => {
    const ops: string[] = [];
    const tx = {
      $executeRaw: vi.fn(async () => { ops.push('SET READ ONLY'); return 0; }),
      $queryRaw: vi.fn(async () => { ops.push('CHECK MODE'); return [{ readOnly: true, isolation: 'serializable' }]; }),
      category: { findMany: vi.fn(async () => []), create: vi.fn() },
      product: { findMany: vi.fn(async () => []), create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (cb: (c: typeof tx) => Promise<unknown>, opts: unknown) => {
        expect(opts).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        return cb(tx);
      }),
    } as unknown as PrismaClient;

    await runCatalogReadOnlyTransaction(prisma, async (ro) => {
      expect(Object.keys(ro)).toEqual(['$queryRaw', 'category', 'product']);
      expect((ro.category as { create?: unknown }).create).toBeUndefined();
      expect((ro.product as { create?: unknown }).create).toBeUndefined();
      ops.push('READ');
    });
    expect(ops).toEqual(['SET READ ONLY', 'CHECK MODE', 'READ']);
  });

  it('CLI recusa argumentos de senha/arquivo alternativo e scripts operacionais não citam fixtures nem env de catálogo', () => {
    expect(parseHomologCatalogArgs(['--profile', 'migrate-homolog', '--authorize-read-only']).ok).toBe(true);
    expect(parseHomologCatalogArgs(['--profile', 'app-homolog', '--authorize-read-only']).ok).toBe(false);
    expect(parseHomologCatalogArgs(['--profile', 'migrate-homolog', '--catalog', 'outro.xlsx']).ok).toBe(false);
    expect(parseHomologCatalogArgs(['--profile', 'migrate-homolog', '--password', '123']).ok).toBe(false);

    const scriptsDir = path.resolve(__dirname, '..', '..', 'scripts');
    for (const rel of ['import-catalog-homolog.ts', path.join('homolog', 'catalogHomologImporter.ts')]) {
      const code = readFileSync(path.join(scriptsDir, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(code, rel).not.toMatch(/fixtures|synthetic|sintetic/i);
      expect(code, rel).not.toMatch(/process\.env\.\w*(CATALOG_PATH|XLSX)/i);
    }
  });
});

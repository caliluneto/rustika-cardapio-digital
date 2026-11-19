import { readFileSync } from 'node:fs';
import { Prisma, type PrismaClient } from '@prisma/client';
import * as xlsx from 'xlsx';
import {
  CATEGORY_PUBLIC_KEYS,
  PUBLIC_CATEGORY_KEY_PATTERN,
  planCategoryPublication,
  type AvailabilityState,
  type CategorySnapshot,
  type ProductSnapshot,
} from '../../src/domain/categoryPublication';
import { redactSecrets, type DatabaseSecrets } from '../../src/config/secrets';
import { assertCatalogColumns, CATALOG_COLUMNS } from '../executor-seed-real';
import { classifyProduct, defaultCatalogPath, parsePrice } from '../seed-real';
import {
  E4_ALT_TARGET,
  EXCEPTIONAL_MIGRATOR_PROFILE,
  type ExternalTlsEvidence,
} from '../bootstrap/exceptionalMigratorBootstrap';
import { strictTargetUrlProblem } from '../bootstrap/exceptionalMigratorCli';
import type { AppliedMigration } from '../bootstrap/migrationIntegrity';
import { HOMOLOG_EXPECTED_MIGRATIONS } from './homologMigrationChain';

export const HOMOLOG_CATALOG_PROFILE = EXCEPTIONAL_MIGRATOR_PROFILE;
export const HOMOLOG_CATALOG_CONFIRMATION_ENV = 'CARDAPIO_HOMOLOG_CATALOG_CONFIRMATION';
export const HOMOLOG_CATALOG_CONFIRMATION_VALUE =
  'IMPORT_APPROVED_RUSTIKA_CATALOG_AGED_SCENE_47291697_BR_FROSTY_FIRE_BD4XW2SC';

const SOURCE_CODE_PATTERN = /^[0-9A-Z]{1,64}$/;
const MAX_PRICE_IN_CENTS = 99_999_999;

/** Ordem determinística das 12 categorias aprovadas do cardápio RÚSTIKA. */
export const CATEGORY_DISPLAY_ORDER: Readonly<Record<string, number>> = {
  'PORÇÕES': 10,
  'DRINKS': 20,
  'DRINK PRONTO': 30,
  'CERVEJA': 40,
  'DESTILADO': 50,
  'ENERGÉTICO': 60,
  'REFRIGERANTE': 70,
  'SUCO': 80,
  'ÁGUA': 90,
  'GELO CÔCO': 100,
  'DIVERSOS': 110,
  'INSUMO': 120,
};

export interface PlannedCategory {
  readonly name: string;
  readonly publicKey: string;
  readonly displayOrder: number;
}

export interface PlannedProduct {
  readonly sourceCode: string;
  readonly publicKey: string;
  readonly name: string;
  readonly sourceName: string;
  readonly sourceGroup: string;
  readonly categoryPublicKey: string;
  readonly priceInCents: number;
}

export interface SpreadsheetPlan {
  readonly totals: {
    readonly totalRows: number;
    readonly activeRows: number;
    readonly commercializedToImport: number;
    readonly internalSuppliesExcluded: number;
    readonly uncertainExcluded: number;
    readonly inactiveExcluded: number;
    readonly categoriesRequired: number;
  };
  readonly categories: readonly PlannedCategory[];
  readonly products: readonly PlannedProduct[];
}

export type HomologCatalogErrorCode =
  | 'INVALID_ARGS'
  | 'MISSING_CONFIRMATION'
  | 'INVALID_PROFILE'
  | 'ENVIRONMENT_MISMATCH'
  | 'UNSAFE_ROLE'
  | 'SCHEMA_INCOMPATIBLE'
  | 'INVALID_CATALOG'
  | 'RECONCILIATION_CONFLICT'
  | 'POSTCONDITION_FAILED';

export class HomologCatalogError extends Error {
  constructor(
    public readonly code: HomologCatalogErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'HomologCatalogError';
  }
}

export class CatalogCommitOutcomeUnknown extends Error {
  constructor() {
    super('O resultado do COMMIT não pôde ser confirmado. Não repita a importação antes de reconciliar com dry-run somente leitura.');
    this.name = 'CatalogCommitOutcomeUnknown';
  }
}

function parseRawCatalogPrice(raw: unknown, codeLabel: string): { decimal: Prisma.Decimal; floatForClassification: number } {
  if (raw === null || raw === undefined || raw === '') {
    throw new HomologCatalogError('INVALID_CATALOG', `Preço inválido no código ${codeLabel}: valor vazio ou nulo.`);
  }
  let normalized: string;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      throw new HomologCatalogError('INVALID_CATALOG', `Preço inválido no código ${codeLabel}: número não finito.`);
    }
    normalized = String(raw);
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed || !/^[\d,.]+$/.test(trimmed)) {
      throw new HomologCatalogError('INVALID_CATALOG', `Preço inválido no código ${codeLabel}: formato ilegível.`);
    }
    const swapped = trimmed.replace(',', '.');
    if (swapped.split('.').length > 2) {
      throw new HomologCatalogError('INVALID_CATALOG', `Preço inválido no código ${codeLabel}: múltiplos separadores decimais.`);
    }
    normalized = swapped;
  } else {
    throw new HomologCatalogError('INVALID_CATALOG', `Preço inválido no código ${codeLabel}: tipo não suportado.`);
  }

  let decimal: Prisma.Decimal;
  try {
    decimal = new Prisma.Decimal(normalized);
  } catch {
    throw new HomologCatalogError('INVALID_CATALOG', `Preço inválido no código ${codeLabel}: decimal ilegível.`);
  }
  if (!decimal.isFinite() || decimal.isNegative()) {
    throw new HomologCatalogError('INVALID_CATALOG', `Preço inválido no código ${codeLabel}: valor negativo ou não finito.`);
  }
  // Valida também pelo parser legado para preservar 100% das invariantes históricas
  try {
    parsePrice(raw);
  } catch (error) {
    throw new HomologCatalogError(
      'INVALID_CATALOG',
      `Preço inválido no código ${codeLabel}: ${error instanceof Error ? error.message : 'valor ilegível'}.`,
    );
  }
  return { decimal, floatForClassification: decimal.toNumber() };
}

function exactCommercializedCents(decimal: Prisma.Decimal, codeLabel: string): number {
  const centsDecimal = decimal.mul(100);
  if (!centsDecimal.isFinite() || !centsDecimal.isInteger()) {
    throw new HomologCatalogError(
      'INVALID_CATALOG',
      `Preço comercializado com fração de centavo (sem arredondamento silencioso) recusado no código ${codeLabel}.`,
    );
  }
  const cents = centsDecimal.toNumber();
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > MAX_PRICE_IN_CENTS) {
    throw new HomologCatalogError('INVALID_CATALOG', `Preço fora da faixa permitida (1..${MAX_PRICE_IN_CENTS} centavos) no código ${codeLabel}.`);
  }
  return cents;
}

function storedDecimalToCents(decimal: Prisma.Decimal, idLabel: string): number {
  const centsDecimal = decimal.mul(100);
  if (!centsDecimal.isFinite() || !centsDecimal.isInteger() || centsDecimal.isNegative()) {
    throw new HomologCatalogError('RECONCILIATION_CONFLICT', `Preço armazenado com precisão inválida no produto ${idLabel}.`);
  }
  const cents = centsDecimal.toNumber();
  if (!Number.isSafeInteger(cents) || cents > MAX_PRICE_IN_CENTS) {
    throw new HomologCatalogError('RECONCILIATION_CONFLICT', `Preço armazenado fora da faixa segura no produto ${idLabel}.`);
  }
  return cents;
}

/**
 * Analisa e valida as linhas brutas da planilha privada, filtrando estritamente:
 * - Inativos (`Estado !== 'Ativo'`): bloqueados;
 * - Insumos internos (`INSUMO`, incluindo R$ 0,01): bloqueados;
 * - Itens incertos (`INCERTO`): suspensos/bloqueados;
 * - Comercializados (`COMERCIALIZADO`): únicos elegíveis para importação em homologação.
 */
export function planHomologCatalogFromRows(
  rows: readonly Record<string, unknown>[],
  categoryKeys: Readonly<Record<string, string>> = CATEGORY_PUBLIC_KEYS,
): SpreadsheetPlan {
  if (rows.length === 0) {
    throw new HomologCatalogError('INVALID_CATALOG', 'A planilha de catálogo está vazia.');
  }
  try {
    assertCatalogColumns([...rows]);
  } catch (error) {
    throw new HomologCatalogError('INVALID_CATALOG', error instanceof Error ? error.message : 'Cabeçalhos inválidos.');
  }

  const seenCodes = new Set<string>();
  const seenNamesByGroup = new Map<string, Set<string>>();
  const commercialized: PlannedProduct[] = [];
  let activeRows = 0;
  let internalSuppliesExcluded = 0;
  let uncertainExcluded = 0;
  let inactiveExcluded = 0;

  for (const [index, row] of rows.entries()) {
    const rowLabel = `linha ${index + 2}`;
    const state = String(row[CATALOG_COLUMNS.estado] ?? '').trim();
    if (state !== 'Ativo' && state !== 'Inativo') {
      throw new HomologCatalogError('INVALID_CATALOG', `Estado inválido (${JSON.stringify(state)}) na ${rowLabel}.`);
    }
    const rawCode = String(row[CATALOG_COLUMNS.codigo] ?? '').trim();
    if (!rawCode || rawCode.length > 64) {
      throw new HomologCatalogError('INVALID_CATALOG', `Código ausente ou acima de 64 caracteres na ${rowLabel}.`);
    }
    if (seenCodes.has(rawCode)) {
      throw new HomologCatalogError('INVALID_CATALOG', `Código duplicado na planilha: ${rawCode}.`);
    }
    seenCodes.add(rawCode);

    if (state !== 'Ativo') {
      inactiveExcluded++;
      continue;
    }

    activeRows++;
    const nome = String(row[CATALOG_COLUMNS.nome] ?? '').trim();
    const grupo = String(row[CATALOG_COLUMNS.grupo] ?? '').trim();
    if (!nome) {
      throw new HomologCatalogError('INVALID_CATALOG', `Nome vazio em item ativo (código ${rawCode}).`);
    }
    if (!grupo) {
      throw new HomologCatalogError('INVALID_CATALOG', `Grupo vazio em item ativo (código ${rawCode}).`);
    }

    const { decimal, floatForClassification } = parseRawCatalogPrice(row[CATALOG_COLUMNS.preco], rawCode);
    const classification = classifyProduct(rawCode, nome, grupo, floatForClassification);

    if (classification === 'INSUMO') {
      internalSuppliesExcluded++;
      continue;
    }
    if (classification === 'INCERTO') {
      uncertainExcluded++;
      continue;
    }

    const cents = exactCommercializedCents(decimal, rawCode);
    if (!SOURCE_CODE_PATTERN.test(rawCode)) {
      throw new HomologCatalogError(
        'INVALID_CATALOG',
        `Código de origem comercializado incompatível com o contrato público ([0-9A-Z]{1,64}): ${rawCode}.`,
      );
    }
    if (cents <= 1) {
      throw new HomologCatalogError(
        'INVALID_CATALOG',
        `Produto comercializado com preço simbólico de insumo (${cents} centavo) recusado: ${rawCode}.`,
      );
    }
    const categoryPublicKey = categoryKeys[grupo];
    if (!categoryPublicKey || !PUBLIC_CATEGORY_KEY_PATTERN.test(categoryPublicKey)) {
      throw new HomologCatalogError('INVALID_CATALOG', `Grupo sem chave pública aprovada: ${grupo} (código ${rawCode}).`);
    }

    const groupNames = seenNamesByGroup.get(grupo) ?? new Set<string>();
    if (groupNames.has(nome)) {
      throw new HomologCatalogError('INVALID_CATALOG', `Nome duplicado dentro do mesmo grupo (${grupo}): ${nome}.`);
    }
    groupNames.add(nome);
    seenNamesByGroup.set(grupo, groupNames);

    commercialized.push({
      sourceCode: rawCode,
      publicKey: `rustika-${rawCode}`,
      name: nome,
      sourceName: nome,
      sourceGroup: grupo,
      categoryPublicKey,
      priceInCents: cents,
    });
  }

  if (commercialized.length === 0) {
    throw new HomologCatalogError('INVALID_CATALOG', 'Nenhum produto comercializado elegível encontrado na planilha.');
  }

  const requiredGroupNames = [...new Set(commercialized.map((item) => item.sourceGroup))].sort((left, right) => {
    const orderDiff = (CATEGORY_DISPLAY_ORDER[left] ?? 999) - (CATEGORY_DISPLAY_ORDER[right] ?? 999);
    return orderDiff !== 0 ? orderDiff : left.localeCompare(right, 'pt-BR');
  });

  const categories: PlannedCategory[] = requiredGroupNames.map((name, idx) => ({
    name,
    publicKey: categoryKeys[name]!,
    displayOrder: CATEGORY_DISPLAY_ORDER[name] ?? (idx + 1) * 10,
  }));

  return {
    totals: {
      totalRows: rows.length,
      activeRows,
      commercializedToImport: commercialized.length,
      internalSuppliesExcluded,
      uncertainExcluded,
      inactiveExcluded,
      categoriesRequired: categories.length,
    },
    categories,
    products: commercialized,
  };
}

/** `filePath` e `categoryKeys` são parametrizáveis apenas para testes; o CLI operacional usa sempre os padrões aprovados. */
export function planHomologCatalogFromFile(
  filePath: string = defaultCatalogPath,
  categoryKeys: Readonly<Record<string, string>> = CATEGORY_PUBLIC_KEYS,
): SpreadsheetPlan {
  let buffer: Buffer;
  try {
    buffer = readFileSync(filePath);
  } catch {
    throw new HomologCatalogError('INVALID_CATALOG', 'Planilha de catálogo aprovada não encontrada ou ilegível.');
  }
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) {
    throw new HomologCatalogError('INVALID_CATALOG', 'Planilha de catálogo sem aba válida.');
  }
  const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet);
  return planHomologCatalogFromRows(rows, categoryKeys);
}

export interface StoredCategoryRow {
  readonly id: string;
  readonly name: string;
  readonly publicKey: string | null;
  readonly isActive: boolean;
  readonly displayOrder: number;
}

export interface StoredProductRow {
  readonly id: string;
  readonly publicKey: string | null;
  readonly sourceCode: string | null;
  readonly sourceName: string | null;
  readonly sourceGroup: string | null;
  readonly name: string;
  readonly priceInCents: number;
  readonly isActive: boolean;
  readonly availabilityState: AvailabilityState;
  readonly categoryId: string;
}

export interface CategoryAction {
  readonly action: 'CREATE' | 'PUBLISH_KEY' | 'UNCHANGED';
  readonly name: string;
  readonly publicKey: string;
  readonly displayOrder: number;
  readonly existingId?: string;
}

export interface ProductAction {
  readonly action: 'CREATE' | 'UPDATE' | 'UNCHANGED';
  readonly sourceCode: string;
  readonly publicKey: string;
  readonly categoryName: string;
  readonly categoryPublicKey: string;
  readonly priceInCents: number;
  readonly sourceName: string;
  readonly updateNameTo?: string;
  readonly existingId?: string;
  readonly preservedAvailability?: AvailabilityState;
  readonly changedFields?: readonly string[];
}

export interface CatalogReconciliation {
  readonly categories: {
    readonly toCreate: number;
    readonly toPublishKey: number;
    readonly unchanged: number;
    readonly extraInDb: number;
    readonly actions: readonly CategoryAction[];
  };
  readonly products: {
    readonly toCreate: number;
    readonly toUpdate: number;
    readonly unchanged: number;
    readonly extraInDb: number;
    readonly extraPublicKeys: readonly string[];
    readonly actions: readonly ProductAction[];
  };
  readonly conflicts: readonly string[];
}

export function reconcileHomologCatalog(
  plan: SpreadsheetPlan,
  existingCategories: readonly StoredCategoryRow[],
  existingProducts: readonly StoredProductRow[],
): CatalogReconciliation {
  const conflicts: string[] = [];
  const categoryByName = new Map<string, StoredCategoryRow>();
  const categoryByPublicKey = new Map<string, StoredCategoryRow>();
  const categoryById = new Map<string, StoredCategoryRow>();

  for (const cat of existingCategories) {
    categoryById.set(cat.id, cat);
    if (categoryByName.has(cat.name)) conflicts.push(`Categoria duplicada no banco: ${cat.name}.`);
    categoryByName.set(cat.name, cat);
    if (cat.publicKey !== null) {
      if (categoryByPublicKey.has(cat.publicKey)) conflicts.push(`Chave pública de categoria duplicada no banco: ${cat.publicKey}.`);
      categoryByPublicKey.set(cat.publicKey, cat);
    }
  }

  const categoryActions: CategoryAction[] = [];
  const plannedCategoryNames = new Set(plan.categories.map((c) => c.name));

  for (const planned of plan.categories) {
    const byName = categoryByName.get(planned.name);
    const byKey = categoryByPublicKey.get(planned.publicKey);
    if (byName && byKey && byName.id !== byKey.id) {
      conflicts.push(`Conflito de categoria: nome "${planned.name}" e chave "${planned.publicKey}" apontam para registros distintos.`);
      continue;
    }
    const existing = byName ?? byKey;
    if (!existing) {
      categoryActions.push({
        action: 'CREATE',
        name: planned.name,
        publicKey: planned.publicKey,
        displayOrder: planned.displayOrder,
      });
      continue;
    }
    if (existing.name !== planned.name) {
      conflicts.push(`Chave de categoria "${planned.publicKey}" pertence a nome divergente no banco: "${existing.name}".`);
      continue;
    }
    if (!existing.isActive) {
      conflicts.push(`Categoria "${planned.name}" existe no banco mas está inativa; reativação automática não é permitida.`);
      continue;
    }
    if (existing.publicKey !== null && existing.publicKey !== planned.publicKey) {
      conflicts.push(`Categoria "${planned.name}" possui publicKey divergente no banco: "${existing.publicKey}".`);
      continue;
    }
    if (existing.publicKey === null) {
      categoryActions.push({
        action: 'PUBLISH_KEY',
        name: planned.name,
        publicKey: planned.publicKey,
        displayOrder: existing.displayOrder,
        existingId: existing.id,
      });
    } else {
      categoryActions.push({
        action: 'UNCHANGED',
        name: planned.name,
        publicKey: planned.publicKey,
        displayOrder: existing.displayOrder,
        existingId: existing.id,
      });
    }
  }

  const extraCategoriesInDb = existingCategories.filter((c) => !plannedCategoryNames.has(c.name)).length;

  const productBySourceCode = new Map<string, StoredProductRow>();
  const productByPublicKey = new Map<string, StoredProductRow>();
  for (const prod of existingProducts) {
    if (prod.sourceCode === null || prod.publicKey === null) {
      conflicts.push(`Produto sem identidade pública no banco (id=${prod.id}); reconciliação manual obrigatória.`);
      continue;
    }
    if (productBySourceCode.has(prod.sourceCode)) conflicts.push(`sourceCode duplicado no banco: ${prod.sourceCode}.`);
    productBySourceCode.set(prod.sourceCode, prod);
    if (productByPublicKey.has(prod.publicKey)) conflicts.push(`publicKey duplicada no banco: ${prod.publicKey}.`);
    productByPublicKey.set(prod.publicKey, prod);
  }

  const productActions: ProductAction[] = [];
  const matchedProductIds = new Set<string>();

  for (const planned of plan.products) {
    const byCode = productBySourceCode.get(planned.sourceCode);
    const byKey = productByPublicKey.get(planned.publicKey);
    if (byCode && byKey && byCode.id !== byKey.id) {
      conflicts.push(`Conflito de produto: sourceCode "${planned.sourceCode}" e publicKey "${planned.publicKey}" apontam para IDs distintos.`);
      continue;
    }
    const existing = byCode ?? byKey;
    const targetCategory = categoryByName.get(planned.sourceGroup);

    if (!existing) {
      if (targetCategory) {
        const collidingByName = existingProducts.find(
          (p) => p.categoryId === targetCategory.id && p.name === planned.name && p.sourceCode !== planned.sourceCode,
        );
        if (collidingByName) {
          conflicts.push(`Colisão de nome na categoria "${planned.sourceGroup}" para "${planned.name}" com código existente "${collidingByName.sourceCode}".`);
          continue;
        }
      }
      productActions.push({
        action: 'CREATE',
        sourceCode: planned.sourceCode,
        publicKey: planned.publicKey,
        categoryName: planned.sourceGroup,
        categoryPublicKey: planned.categoryPublicKey,
        priceInCents: planned.priceInCents,
        sourceName: planned.sourceName,
      });
      continue;
    }

    matchedProductIds.add(existing.id);
    if (existing.sourceCode !== planned.sourceCode || existing.publicKey !== planned.publicKey) {
      conflicts.push(`Identidade inconsistente no produto código "${planned.sourceCode}" (banco: sourceCode=${existing.sourceCode}, publicKey=${existing.publicKey}).`);
      continue;
    }
    if (!existing.isActive) {
      conflicts.push(`Produto "${planned.publicKey}" está inativo no banco; reativação automática bloqueada.`);
      continue;
    }

    const changedFields: string[] = [];
    if (existing.priceInCents !== planned.priceInCents) changedFields.push('price');
    if (existing.sourceName !== planned.sourceName) changedFields.push('sourceName');
    if (existing.sourceGroup !== planned.sourceGroup) changedFields.push('sourceGroup');
    const existingCategory = categoryById.get(existing.categoryId);
    if (!existingCategory || existingCategory.name !== planned.sourceGroup) changedFields.push('categoryId');

    // Só acompanha renomeação do ERP quando o administrador não customizou o nome de exibição.
    const adminCustomizedName = existing.sourceName !== null && existing.name !== existing.sourceName;
    const updateNameTo = !adminCustomizedName && existing.name !== planned.name ? planned.name : undefined;
    if (updateNameTo !== undefined) changedFields.push('name');

    if (changedFields.length === 0) {
      productActions.push({
        action: 'UNCHANGED',
        sourceCode: planned.sourceCode,
        publicKey: planned.publicKey,
        categoryName: planned.sourceGroup,
        categoryPublicKey: planned.categoryPublicKey,
        priceInCents: planned.priceInCents,
        sourceName: planned.sourceName,
        existingId: existing.id,
        preservedAvailability: existing.availabilityState,
      });
    } else {
      productActions.push({
        action: 'UPDATE',
        sourceCode: planned.sourceCode,
        publicKey: planned.publicKey,
        categoryName: planned.sourceGroup,
        categoryPublicKey: planned.categoryPublicKey,
        priceInCents: planned.priceInCents,
        sourceName: planned.sourceName,
        ...(updateNameTo !== undefined ? { updateNameTo } : {}),
        existingId: existing.id,
        preservedAvailability: existing.availabilityState,
        changedFields,
      });
    }
  }

  const extraProducts = existingProducts.filter((p) => !matchedProductIds.has(p.id));

  return {
    categories: {
      toCreate: categoryActions.filter((a) => a.action === 'CREATE').length,
      toPublishKey: categoryActions.filter((a) => a.action === 'PUBLISH_KEY').length,
      unchanged: categoryActions.filter((a) => a.action === 'UNCHANGED').length,
      extraInDb: extraCategoriesInDb,
      actions: categoryActions,
    },
    products: {
      toCreate: productActions.filter((a) => a.action === 'CREATE').length,
      toUpdate: productActions.filter((a) => a.action === 'UPDATE').length,
      unchanged: productActions.filter((a) => a.action === 'UNCHANGED').length,
      extraInDb: extraProducts.length,
      extraPublicKeys: extraProducts.map((p) => p.publicKey ?? p.id).sort(),
      actions: productActions,
    },
    conflicts,
  };
}

export interface HomologCatalogServerFacts {
  readonly database: string;
  readonly databaseOid: string;
  readonly currentUser: string;
  readonly sessionUser: string;
  readonly projectId: string | null;
  readonly branchId: string | null;
  readonly markerComment: string | null;
  readonly serverVersionNum: number;
  readonly elevatedRole: boolean;
  readonly databaseOwner: string;
  readonly migrations: readonly AppliedMigration[];
  readonly externalTls: ExternalTlsEvidence;
}

export function evaluateHomologCatalogTarget(
  facts: HomologCatalogServerFacts,
  expectedClusterId: string,
): { code: HomologCatalogErrorCode; message: string } | null {
  if (!facts.externalTls.proven) {
    return { code: 'ENVIRONMENT_MISMATCH', message: 'TLS externo estrito não comprovado para importação de homologação.' };
  }
  if (
    facts.database !== E4_ALT_TARGET.database ||
    facts.databaseOid !== E4_ALT_TARGET.databaseOid ||
    facts.currentUser !== E4_ALT_TARGET.migratorRole ||
    facts.sessionUser !== E4_ALT_TARGET.migratorRole ||
    facts.projectId !== E4_ALT_TARGET.projectId ||
    facts.branchId !== E4_ALT_TARGET.branchId
  ) {
    return { code: 'ENVIRONMENT_MISMATCH', message: 'Banco, OID, role, projeto ou branch divergem do alvo de homologação.' };
  }
  if (
    expectedClusterId.trim() === '' ||
    facts.markerComment?.trim().toLowerCase() !== `rustika-homolog-cluster:${expectedClusterId.trim().toLowerCase()}`
  ) {
    return { code: 'ENVIRONMENT_MISMATCH', message: 'Marca de cluster ausente ou divergente de EXPECTED_CLUSTER_ID.' };
  }
  if (facts.serverVersionNum < 180000) {
    return { code: 'ENVIRONMENT_MISMATCH', message: 'O banco de homologação exige PostgreSQL 18 ou superior.' };
  }
  if (facts.elevatedRole || facts.databaseOwner !== E4_ALT_TARGET.migratorRole) {
    return { code: 'UNSAFE_ROLE', message: 'A role migradora possui atributos elevados inesperados ou não é dona do banco.' };
  }
  const byName = new Map(facts.migrations.map((m) => [m.name, m]));
  if (facts.migrations.length !== HOMOLOG_EXPECTED_MIGRATIONS.length) {
    return {
      code: 'SCHEMA_INCOMPATIBLE',
      message: `Histórico de migrations tem ${facts.migrations.length} linhas; esperadas ${HOMOLOG_EXPECTED_MIGRATIONS.length}.`,
    };
  }
  for (const expected of HOMOLOG_EXPECTED_MIGRATIONS) {
    const row = byName.get(expected.name);
    if (!row || !row.finished || row.rolledBack || row.checksum !== expected.checksum) {
      return { code: 'SCHEMA_INCOMPATIBLE', message: `Migration ausente, incompleta ou com checksum divergente: ${expected.name}.` };
    }
  }
  return null;
}

export interface CatalogReadOnlyClient {
  readonly $queryRaw: Prisma.TransactionClient['$queryRaw'];
  readonly category: Pick<Prisma.TransactionClient['category'], 'findMany'>;
  readonly product: Pick<Prisma.TransactionClient['product'], 'findMany'>;
}

interface TxModeRow { readOnly: boolean; isolation: string }

/** Executa coleta de catálogo em transação SERIALIZABLE READ ONLY comprovada no PostgreSQL, sem métodos de escrita. */
export async function runCatalogReadOnlyTransaction<T>(
  prisma: PrismaClient,
  reader: (tx: CatalogReadOnlyClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const mode = (await tx.$queryRaw<TxModeRow[]>`
      SELECT current_setting('transaction_read_only')::boolean AS "readOnly",
             current_setting('transaction_isolation')::text AS isolation`)[0];
    if (mode?.readOnly !== true || mode.isolation.toLowerCase() !== 'serializable') {
      throw new Error('Transação de dry-run do catálogo não foi comprovada como SERIALIZABLE READ ONLY.');
    }
    const frozen: CatalogReadOnlyClient = Object.freeze({
      $queryRaw: tx.$queryRaw.bind(tx) as Prisma.TransactionClient['$queryRaw'],
      category: Object.freeze({ findMany: tx.category.findMany.bind(tx.category) }),
      product: Object.freeze({ findMany: tx.product.findMany.bind(tx.product) }),
    });
    return reader(frozen);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

interface HeadRow {
  database: string;
  databaseOid: string;
  currentUser: string;
  sessionUser: string;
  projectId: string | null;
  branchId: string | null;
  markerComment: string | null;
  serverVersionNum: number;
  elevatedRole: boolean | null;
  databaseOwner: string;
}

interface MigrationRow {
  migration_name: string;
  checksum: string;
  finished: boolean;
  rolled_back: boolean;
}

async function readFactsAndState(
  client: CatalogReadOnlyClient,
  externalTls: ExternalTlsEvidence,
): Promise<{
  facts: HomologCatalogServerFacts;
  categories: StoredCategoryRow[];
  products: StoredProductRow[];
}> {
  const head = (await client.$queryRaw<HeadRow[]>`
    SELECT current_database()::text AS "database",
           (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS "databaseOid",
           current_user::text AS "currentUser",
           session_user::text AS "sessionUser",
           current_setting('neon.project_id', true) AS "projectId",
           current_setting('neon.branch_id', true) AS "branchId",
           (SELECT shobj_description(oid, 'pg_authid') FROM pg_roles WHERE rolname = 'rustika_homolog_marker') AS "markerComment",
           current_setting('server_version_num')::int AS "serverVersionNum",
           (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls
              FROM pg_roles WHERE rolname = current_user) AS "elevatedRole",
           (SELECT pg_get_userbyid(datdba)::text FROM pg_database WHERE datname = current_database()) AS "databaseOwner"`)[0];
  if (!head) throw new Error('Fatos do servidor de homologação indisponíveis.');

  const migrations = await client.$queryRaw<MigrationRow[]>`
    SELECT migration_name, checksum, (finished_at IS NOT NULL) AS finished, (rolled_back_at IS NOT NULL) AS rolled_back
      FROM public._prisma_migrations ORDER BY migration_name`;

  const categories = await client.category.findMany({
    select: { id: true, name: true, publicKey: true, isActive: true, displayOrder: true },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
  });

  const rawProducts = await client.product.findMany({
    select: {
      id: true, publicKey: true, sourceCode: true, sourceName: true, sourceGroup: true,
      name: true, price: true, isActive: true, availabilityState: true, categoryId: true,
    },
    orderBy: [{ categoryId: 'asc' }, { publicKey: 'asc' }],
  });

  const products: StoredProductRow[] = rawProducts.map((p) => ({
    id: p.id,
    publicKey: p.publicKey,
    sourceCode: p.sourceCode,
    sourceName: p.sourceName,
    sourceGroup: p.sourceGroup,
    name: p.name,
    priceInCents: p.price.mul(100).toNumber(),
    isActive: p.isActive,
    availabilityState: p.availabilityState,
    categoryId: p.categoryId,
  }));

  return {
    facts: {
      database: head.database,
      databaseOid: head.databaseOid,
      currentUser: head.currentUser,
      sessionUser: head.sessionUser,
      projectId: head.projectId,
      branchId: head.branchId,
      markerComment: head.markerComment,
      serverVersionNum: Number(head.serverVersionNum),
      elevatedRole: head.elevatedRole !== false,
      databaseOwner: head.databaseOwner,
      migrations: migrations.map((m) => ({
        name: m.migration_name,
        checksum: m.checksum,
        finished: m.finished,
        rolledBack: m.rolled_back,
      })),
      externalTls,
    },
    categories,
    products,
  };
}

export interface HomologCatalogExecutionSummary {
  readonly mode: 'dry-run' | 'execute';
  readonly target: {
    readonly projectId: string;
    readonly branchId: string;
    readonly database: string;
    readonly role: string;
  };
  readonly spreadsheet: SpreadsheetPlan['totals'];
  readonly reconciliation: {
    readonly categoriesToCreate: number;
    readonly categoriesToPublishKey: number;
    readonly categoriesUnchanged: number;
    readonly categoriesExtraInDb: number;
    readonly productsToCreate: number;
    readonly productsToUpdate: number;
    readonly productsUnchanged: number;
    readonly productsExtraInDb: number;
  };
  readonly applied?: {
    readonly categoriesCreated: number;
    readonly categoriesPublished: number;
    readonly productsCreated: number;
    readonly productsUpdated: number;
    readonly eligibleAfter: number;
  };
}

export interface HomologCatalogDbAdapter {
  readState(): Promise<{
    facts: HomologCatalogServerFacts;
    categories: StoredCategoryRow[];
    products: StoredProductRow[];
  }>;
  applyPlan(
    plan: SpreadsheetPlan,
    expectedClusterId: string,
  ): Promise<{
    reconciliation: CatalogReconciliation;
    applied: NonNullable<HomologCatalogExecutionSummary['applied']>;
  }>;
}

export function createPrismaHomologCatalogDb(
  prisma: PrismaClient,
  externalTls: ExternalTlsEvidence,
): HomologCatalogDbAdapter {
  return {
    readState: () => runCatalogReadOnlyTransaction(prisma, (tx) => readFactsAndState(tx, externalTls)),
    async applyPlan(plan, expectedClusterId) {
      return prisma.$transaction(async (tx) => {
        const current = await readFactsAndState(tx, externalTls);
        const targetProblem = evaluateHomologCatalogTarget(current.facts, expectedClusterId);
        if (targetProblem) throw new HomologCatalogError(targetProblem.code, targetProblem.message);

        const reconciliation = reconcileHomologCatalog(plan, current.categories, current.products);
        if (reconciliation.conflicts.length > 0) {
          throw new HomologCatalogError('RECONCILIATION_CONFLICT', reconciliation.conflicts.join(' '));
        }

        const categoryIdByName = new Map<string, string>(current.categories.map((c) => [c.name, c.id]));
        let categoriesCreated = 0;
        let categoriesPublished = 0;

        for (const action of reconciliation.categories.actions) {
          if (action.action === 'CREATE') {
            const created = await tx.category.create({
              data: {
                name: action.name,
                publicKey: action.publicKey,
                displayOrder: action.displayOrder,
                isActive: true,
              },
              select: { id: true },
            });
            categoryIdByName.set(action.name, created.id);
            categoriesCreated++;
          } else if (action.action === 'PUBLISH_KEY' && action.existingId) {
            const updated = await tx.category.updateMany({
              where: { id: action.existingId, name: action.name, publicKey: null },
              data: { publicKey: action.publicKey },
            });
            if (updated.count !== 1) {
              throw new HomologCatalogError('POSTCONDITION_FAILED', `Falha ao publicar chave da categoria ${action.name}.`);
            }
            categoriesPublished++;
          }
        }

        const plannedByCode = new Map(plan.products.map((p) => [p.sourceCode, p]));
        let productsCreated = 0;
        let productsUpdated = 0;

        for (const action of reconciliation.products.actions) {
          const planned = plannedByCode.get(action.sourceCode)!;
          const categoryId = categoryIdByName.get(planned.sourceGroup);
          if (!categoryId) {
            throw new HomologCatalogError('POSTCONDITION_FAILED', `Categoria ${planned.sourceGroup} ausente na transação.`);
          }
          const priceDecimal = new Prisma.Decimal(planned.priceInCents).div(100);

          if (action.action === 'CREATE') {
            await tx.product.create({
              data: {
                publicKey: planned.publicKey,
                sourceCode: planned.sourceCode,
                sourceName: planned.sourceName,
                sourceGroup: planned.sourceGroup,
                name: planned.name,
                price: priceDecimal,
                categoryId,
                isActive: true,
                availabilityState: 'UNKNOWN',
              },
            });
            productsCreated++;
          } else if (action.action === 'UPDATE' && action.existingId) {
            await tx.product.update({
              where: { id: action.existingId },
              data: {
                price: priceDecimal,
                sourceName: planned.sourceName,
                sourceGroup: planned.sourceGroup,
                categoryId,
                ...(action.updateNameTo !== undefined ? { name: action.updateNameTo } : {}),
              },
            });
            productsUpdated++;
          }
        }

        const afterCategories: CategorySnapshot[] = await tx.category.findMany({
          select: { id: true, name: true, publicKey: true, isActive: true, displayOrder: true },
          orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        });
        const afterRawProducts = await tx.product.findMany({
          select: {
            id: true, publicKey: true, sourceCode: true, sourceName: true, sourceGroup: true,
            name: true, price: true, isActive: true, availabilityState: true, categoryId: true,
          },
          orderBy: [{ categoryId: 'asc' }, { publicKey: 'asc' }],
        });
        const afterProducts: ProductSnapshot[] = afterRawProducts.map((p) => ({
          id: p.id,
          publicKey: p.publicKey,
          sourceCode: p.sourceCode,
          sourceName: p.sourceName,
          sourceGroup: p.sourceGroup,
          name: p.name,
          priceInCents: p.price.mul(100).toNumber(),
          isActive: p.isActive,
          availabilityState: p.availabilityState,
          categoryId: p.categoryId,
        }));

        const publication = planCategoryPublication(afterCategories, afterProducts);
        if (
          publication.updates.length !== 0 ||
          publication.totals.internalProducts !== 0 ||
          publication.totals.eligibleAfter < plan.totals.commercializedToImport
        ) {
          throw new HomologCatalogError(
            'POSTCONDITION_FAILED',
            'Pós-condição de publicação violada após importação; transação revertida.',
          );
        }
        const eligibleSet = new Set(publication.eligibleProductIds);
        for (const planned of plan.products) {
          if (!eligibleSet.has(planned.publicKey)) {
            throw new HomologCatalogError(
              'POSTCONDITION_FAILED',
              `Produto comercializado não ficou elegível após importação: ${planned.publicKey}.`,
            );
          }
        }

        return {
          reconciliation,
          applied: {
            categoriesCreated,
            categoriesPublished,
            productsCreated,
            productsUpdated,
            eligibleAfter: publication.totals.eligibleAfter,
          },
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 120_000 });
    },
  };
}

export interface HomologCatalogCliArgs {
  readonly profile: string;
  readonly execute: boolean;
  readonly authorizeReadOnly: boolean;
}

export function parseHomologCatalogArgs(
  argv: readonly string[],
): { ok: true; value: HomologCatalogCliArgs } | { ok: false; error: string } {
  let profile = '';
  let execute = false;
  let authorizeReadOnly = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (/^--.*(?:pass|senha|secret|token|catalog|xlsx|path)$/i.test(arg)) {
      return { ok: false, error: 'Segredos e caminhos alternativos de planilha não são aceitos via linha de comando.' };
    }
    if (arg === '--execute') {
      execute = true;
      continue;
    }
    if (arg === '--authorize-read-only') {
      authorizeReadOnly = true;
      continue;
    }
    if (arg === '--profile') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) return { ok: false, error: 'Valor ausente para --profile.' };
      profile = next;
      i++;
      continue;
    }
    return { ok: false, error: `Argumento não permitido: ${arg.slice(0, 30)}.` };
  }

  if (profile !== HOMOLOG_CATALOG_PROFILE) {
    return { ok: false, error: `Informe exatamente --profile ${HOMOLOG_CATALOG_PROFILE}.` };
  }
  if (!execute && !authorizeReadOnly) {
    return { ok: false, error: 'Dry-run remoto exige --authorize-read-only explícito.' };
  }
  return { ok: true, value: { profile, execute, authorizeReadOnly } };
}

export interface HomologCatalogRunnerDeps {
  loadProfile: (profile: string) => DatabaseSecrets;
  connect: (database: DatabaseSecrets) => Promise<{ db: HomologCatalogDbAdapter; close: () => Promise<void> }>;
  out: (line: string) => void;
  err: (line: string) => void;
  catalogPath?: string;
  categoryKeys?: Readonly<Record<string, string>>;
}

export async function runHomologCatalogCli(
  deps: HomologCatalogRunnerDeps,
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const say = (line: string): void => deps.out(redactSecrets(line));
  const fail = (code: string, message: string, exitCode = 2): number => {
    deps.err(redactSecrets(`[homolog-catalog] erro=${code} ${message}`));
    return exitCode;
  };

  const parsed = parseHomologCatalogArgs(argv);
  if (!parsed.ok) return fail('INVALID_ARGS', parsed.error, 2);

  if (parsed.value.execute && env[HOMOLOG_CATALOG_CONFIRMATION_ENV] !== HOMOLOG_CATALOG_CONFIRMATION_VALUE) {
    return fail(
      'MISSING_CONFIRMATION',
      `Execução exige ${HOMOLOG_CATALOG_CONFIRMATION_ENV} com o valor literal de autorização da homologação.`,
      2,
    );
  }

  let plan: SpreadsheetPlan;
  try {
    plan = planHomologCatalogFromFile(deps.catalogPath, deps.categoryKeys);
  } catch (error) {
    if (error instanceof HomologCatalogError) return fail(error.code, error.message, 2);
    return fail('INVALID_CATALOG', 'Falha ao validar a planilha de catálogo.', 2);
  }

  let database: DatabaseSecrets;
  try {
    database = deps.loadProfile(HOMOLOG_CATALOG_PROFILE);
  } catch (error) {
    return fail('INVALID_PROFILE', error instanceof Error ? error.message : 'Perfil migrate-homolog inválido.', 2);
  }

  if (
    database.profile !== HOMOLOG_CATALOG_PROFILE ||
    database.purpose !== 'migration' ||
    database.environment !== 'homolog' ||
    database.database !== E4_ALT_TARGET.database ||
    database.user !== E4_ALT_TARGET.migratorRole ||
    !database.clusterId
  ) {
    return fail('INVALID_PROFILE', 'O perfil carregado não corresponde ao migrate-homolog definitivo.', 2);
  }
  const urlProblem = strictTargetUrlProblem(database);
  if (urlProblem) return fail('INVALID_PROFILE', urlProblem, 2);

  let connection: Awaited<ReturnType<HomologCatalogRunnerDeps['connect']>>;
  try {
    connection = await deps.connect(database);
  } catch {
    return fail('CONNECTION_FAILED', 'Não foi possível estabelecer conexão validada com o Neon; nenhuma escrita iniciada.', 1);
  }

  try {
    if (!parsed.value.execute) {
      const state = await connection.db.readState();
      const targetProblem = evaluateHomologCatalogTarget(state.facts, database.clusterId);
      if (targetProblem) return fail(targetProblem.code, targetProblem.message, 2);

      const reconciliation = reconcileHomologCatalog(plan, state.categories, state.products);
      if (reconciliation.conflicts.length > 0) {
        return fail('RECONCILIATION_CONFLICT', reconciliation.conflicts.join(' '), 2);
      }

      const summary: HomologCatalogExecutionSummary = {
        mode: 'dry-run',
        target: {
          projectId: E4_ALT_TARGET.projectId,
          branchId: E4_ALT_TARGET.branchId,
          database: database.database,
          role: database.user,
        },
        spreadsheet: plan.totals,
        reconciliation: {
          categoriesToCreate: reconciliation.categories.toCreate,
          categoriesToPublishKey: reconciliation.categories.toPublishKey,
          categoriesUnchanged: reconciliation.categories.unchanged,
          categoriesExtraInDb: reconciliation.categories.extraInDb,
          productsToCreate: reconciliation.products.toCreate,
          productsToUpdate: reconciliation.products.toUpdate,
          productsUnchanged: reconciliation.products.unchanged,
          productsExtraInDb: reconciliation.products.extraInDb,
        },
      };
      say(JSON.stringify(summary, null, 2));
      return 0;
    }

    const { reconciliation, applied } = await connection.db.applyPlan(plan, database.clusterId);
    const summary: HomologCatalogExecutionSummary = {
      mode: 'execute',
      target: {
        projectId: E4_ALT_TARGET.projectId,
        branchId: E4_ALT_TARGET.branchId,
        database: database.database,
        role: database.user,
      },
      spreadsheet: plan.totals,
      reconciliation: {
        categoriesToCreate: reconciliation.categories.toCreate,
        categoriesToPublishKey: reconciliation.categories.toPublishKey,
        categoriesUnchanged: reconciliation.categories.unchanged,
        categoriesExtraInDb: reconciliation.categories.extraInDb,
        productsToCreate: reconciliation.products.toCreate,
        productsToUpdate: reconciliation.products.toUpdate,
        productsUnchanged: reconciliation.products.unchanged,
        productsExtraInDb: reconciliation.products.extraInDb,
      },
      applied,
    };
    say(JSON.stringify(summary, null, 2));
    return 0;
  } catch (error) {
    if (error instanceof HomologCatalogError) return fail(error.code, error.message, 2);
    return fail('EXECUTION_ERROR', 'Falha durante a operação de catálogo; nenhuma alteração parcial persistida.', 1);
  } finally {
    await connection.close().catch(() => undefined);
  }
}

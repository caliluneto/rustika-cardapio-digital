import dotenv from 'dotenv';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  CATEGORY_PUBLIC_KEYS,
  planCategoryPublication,
  type CategorySnapshot,
  type ProductSnapshot,
} from '../src/domain/categoryPublication';
import { loadDatabaseProfile, resolveSecretsDir } from '../src/config/secrets';
import { createCatalogService } from '../src/services/catalog.service';
import { AppError } from '../src/middleware/errorHandler';

dotenv.config();

const EXPECTED_CATEGORIES = [
  { id: '877f6779-8bf9-4941-ab69-65afe92e95ab', name: 'ÁGUA', currentKey: null, total: 2 },
  { id: '769c666b-3ec8-4121-833b-d8c8de0c1917', name: 'CERVEJA', currentKey: null, total: 14 },
  { id: 'c7689217-1e13-407a-8f3f-00e7a7821ab2', name: 'DESTILADO', currentKey: null, total: 44 },
  { id: '012e00e4-214a-4674-aede-49677e83faf5', name: 'DIVERSOS', currentKey: 'rustika-category-diversos', total: 1 },
  { id: '891ae262-5fd4-42e3-950b-16210959618e', name: 'DRINK PRONTO', currentKey: null, total: 9 },
  { id: '242e73fa-d8d3-4d0f-a55d-fd886626ea2f', name: 'DRINKS', currentKey: null, total: 26 },
  { id: 'b31f1de9-df94-4cf7-9afd-65ac88c06f27', name: 'ENERGÉTICO', currentKey: null, total: 12 },
  { id: '839dcd6e-7cbc-4772-a610-8989d55d4e88', name: 'GELO CÔCO', currentKey: null, total: 3 },
  { id: 'a3a6f2a6-33f7-45aa-91bd-529702c8ac6e', name: 'INSUMO', currentKey: 'rustika-category-insumo', total: 26 },
  { id: '1c12cb16-3faa-4e74-82cb-1017e6687a9d', name: 'PORÇÕES', currentKey: null, total: 13 },
  { id: '35b2f7d6-5e15-4e93-930b-52f7c07d19d1', name: 'REFRIGERANTE', currentKey: null, total: 10 },
  { id: '41a28be7-71cb-4091-a694-2d30824a738c', name: 'SUCO', currentKey: null, total: 8 },
] as const;

const EXPECTED_TOTALS = {
  categories: 12,
  categoriesAlreadyPublic: 2,
  categoriesToPublish: 10,
  categoriesAfter: 12,
  products: 168,
  publicKeyProducts: 144,
  internalProducts: 24,
  eligibleBefore: 3,
  eligibleAfter: 144,
} as const;

interface Snapshot {
  readonly categories: readonly CategorySnapshot[];
  readonly products: readonly ProductSnapshot[];
}

interface Privileges {
  readonly migratorUpdateCategories: boolean;
  readonly migratorUpdateProducts: boolean;
  readonly appSelectCategories: boolean;
  readonly appSelectProducts: boolean;
  readonly appInsertCategories: boolean;
  readonly appUpdateCategories: boolean;
  readonly appDeleteCategories: boolean;
  readonly appTruncateCategories: boolean;
  readonly appInsertProducts: boolean;
  readonly appUpdateProducts: boolean;
  readonly appDeleteProducts: boolean;
  readonly appTruncateProducts: boolean;
}

async function readPrivileges(tx: Prisma.TransactionClient): Promise<Privileges> {
  const rows = await tx.$queryRaw<Privileges[]>`
    SELECT
      has_table_privilege('cardapio_migrator', 'public.categories', 'UPDATE') AS "migratorUpdateCategories",
      has_table_privilege('cardapio_migrator', 'public.products', 'UPDATE') AS "migratorUpdateProducts",
      has_table_privilege('cardapio_dev_app', 'public.categories', 'SELECT') AS "appSelectCategories",
      has_table_privilege('cardapio_dev_app', 'public.products', 'SELECT') AS "appSelectProducts",
      has_table_privilege('cardapio_dev_app', 'public.categories', 'INSERT') AS "appInsertCategories",
      has_table_privilege('cardapio_dev_app', 'public.categories', 'UPDATE') AS "appUpdateCategories",
      has_table_privilege('cardapio_dev_app', 'public.categories', 'DELETE') AS "appDeleteCategories",
      has_table_privilege('cardapio_dev_app', 'public.categories', 'TRUNCATE') AS "appTruncateCategories",
      has_table_privilege('cardapio_dev_app', 'public.products', 'INSERT') AS "appInsertProducts",
      has_table_privilege('cardapio_dev_app', 'public.products', 'UPDATE') AS "appUpdateProducts",
      has_table_privilege('cardapio_dev_app', 'public.products', 'DELETE') AS "appDeleteProducts",
      has_table_privilege('cardapio_dev_app', 'public.products', 'TRUNCATE') AS "appTruncateProducts"
  `;
  const result = rows[0];
  if (!result) throw new Error('Não foi possível consultar privilégios.');
  return result;
}

async function readSnapshot(tx: Prisma.TransactionClient): Promise<Snapshot> {
  const categories = await tx.category.findMany({
    select: { id: true, name: true, publicKey: true, isActive: true, displayOrder: true },
    orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
  });
  const products = await tx.product.findMany({
    select: {
      id: true, publicKey: true, sourceCode: true, sourceName: true, sourceGroup: true,
      name: true, price: true, isActive: true, availabilityState: true, categoryId: true,
    },
    orderBy: [{ categoryId: 'asc' }, { publicKey: 'asc' }],
  });
  return {
    categories,
    products: products.map((product) => ({
      ...product,
      priceInCents: product.price.mul(100).toNumber(),
    })),
  };
}

async function getProductOrNull(
  service: ReturnType<typeof createCatalogService>,
  publicKey: string,
): Promise<{ publicKey: string; priceInCents: number } | { notFound: true }> {
  try {
    const product = await service.getProduct(publicKey);
    return { publicKey: product.id, priceInCents: product.priceInCents };
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 404) return { notFound: true };
    throw error;
  }
}

async function main(): Promise<void> {
  const database = loadDatabaseProfile('migrate-dev', {
    purpose: 'migration',
    secretsDir: resolveSecretsDir(),
  });
  const prisma = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '15000'`;

      const identity = await tx.$queryRaw<{ db: string; usr: string }[]>`
        SELECT current_database() as db, current_user as usr
      `;
      const session = identity[0];
      if (!session || session.db !== 'cardapio_digital_dev' || session.usr !== 'cardapio_migrator') {
        throw new Error('Identidade de banco/role não autorizada para o pré-voo.');
      }

      const privileges = await readPrivileges(tx);
      if (!privileges.migratorUpdateCategories || !privileges.appSelectCategories ||
          !privileges.appSelectProducts) {
        throw new Error('Privilégios esperados não confirmados.');
      }
      const appCatalogPrivileges = [
        privileges.appInsertCategories ? 'INSERT categories' : null,
        privileges.appUpdateCategories ? 'UPDATE categories' : null,
        privileges.appDeleteCategories ? 'DELETE categories' : null,
        privileges.appTruncateCategories ? 'TRUNCATE categories' : null,
        privileges.appInsertProducts ? 'INSERT products' : null,
        privileges.appUpdateProducts ? 'UPDATE products' : null,
        privileges.appDeleteProducts ? 'DELETE products' : null,
        privileges.appTruncateProducts ? 'TRUNCATE products' : null,
      ].filter((privilege): privilege is string => privilege !== null);

      const snapshot = await readSnapshot(tx);
      const plan = planCategoryPublication(snapshot.categories, snapshot.products);
      if (JSON.stringify(plan.totals) !== JSON.stringify(EXPECTED_TOTALS)) {
        throw new Error('Totais divergentes do snapshot aprovado.');
      }

      const byId = new Map<string, CategorySnapshot>(
        snapshot.categories.map((category) => [category.id, category]),
      );
      const byName = new Map<string, CategorySnapshot>(
        snapshot.categories.map((category) => [category.name, category]),
      );
      const expectedIds = new Set<string>(EXPECTED_CATEGORIES.map((category) => category.id));
      const extraCategories = snapshot.categories.filter((category) => !expectedIds.has(category.id));
      const missingCategories = EXPECTED_CATEGORIES.filter((category) => !byId.has(category.id));
      const categoryDivergences: Array<{ id: string; name?: string; issues: string[] }> = [];
      for (const expected of EXPECTED_CATEGORIES) {
        const actual = byId.get(expected.id);
        if (!actual) {
          categoryDivergences.push({ id: expected.id, issues: ['ausente'] });
          continue;
        }
        const proposed = CATEGORY_PUBLIC_KEYS[actual.name];
        const issues: string[] = [];
        if (actual.name !== expected.name) issues.push(`nome=${actual.name}`);
        if (actual.publicKey !== expected.currentKey) issues.push(`publicKey=${String(actual.publicKey)}`);
        if (proposed !== (expected.currentKey ?? CATEGORY_PUBLIC_KEYS[expected.name])) issues.push(`proposta=${String(proposed)}`);
        if (!actual.isActive) issues.push('inativa');
        if (actual.displayOrder !== 0) issues.push(`ordem=${actual.displayOrder}`);
        const categoryPlan = plan.categories.find((category) => category.id === expected.id);
        if (!categoryPlan || categoryPlan.totalProducts !== expected.total) {
          issues.push(`produtos=${categoryPlan?.totalProducts ?? '?'}`);
        }
        const expectedPublic = expected.name === 'INSUMO' ? 2 : expected.total;
        const expectedInternal = expected.name === 'INSUMO' ? 24 : 0;
        if (categoryPlan?.publicKeyProducts !== expectedPublic) {
          issues.push(`públicos=${categoryPlan?.publicKeyProducts ?? '?'}`);
        }
        if (categoryPlan?.internalProducts !== expectedInternal) {
          issues.push(`internos=${categoryPlan?.internalProducts ?? '?'}`);
        }
        if (issues.length > 0) categoryDivergences.push({ id: expected.id, name: actual.name, issues });
      }

      const duplicateCategoryKeys = snapshot.categories
        .map((category) => plan.categories.find((row) => row.id === category.id)?.proposedPublicKey)
        .filter((key): key is string => key !== undefined)
        .filter((key, index, all) => all.indexOf(key) !== index);
      const publicProducts = snapshot.products.filter((product) => product.publicKey !== null);
      const internalProducts = snapshot.products.filter((product) => product.publicKey === null);
      const duplicateProductKeys = publicProducts
        .map((product) => product.publicKey as string)
        .filter((key, index, all) => all.indexOf(key) !== index);
      const duplicateSourceCodes = publicProducts
        .map((product) => product.sourceCode as string)
        .filter((code, index, all) => all.indexOf(code) !== index);
      const invalidPublicProducts = publicProducts.filter((product) =>
        !product.isActive || !product.sourceCode || !product.sourceName?.trim() ||
        !product.sourceGroup?.trim() || product.publicKey !== `rustika-${product.sourceCode}`,
      );
      const invalidInternalProducts = internalProducts.filter((product) =>
        product.sourceCode !== null || product.sourceName !== null || product.sourceGroup !== null,
      );
      const internalCategory = byName.get('INSUMO');
      if (!internalCategory) throw new Error('Categoria INSUMO não encontrada.');
      const internalOutsideInsumo = internalProducts.filter((product) => product.categoryId !== internalCategory.id);

      const service = createCatalogService(tx);
      const publicCategories = await service.listCategories();
      const currentProducts = await service.listProducts({ limit: 50 });
      const insumoProducts = await service.listProducts({
        categoryId: 'rustika-category-insumo',
        limit: 50,
      });
      const internalIds = new Set(internalProducts.map((product) => product.id));
      const exposedInternalIds = insumoProducts.items
        .map((product) => product.id)
        .filter((id) => internalIds.has(id));
      const pa = await getProductOrNull(service, 'rustika-PA062240');
      const internalProbe = await getProductOrNull(service, `rustika-${internalProducts[0]?.id ?? 'internal'}`);

      const failures: string[] = [];
      if (extraCategories.length > 0) failures.push('categorias adicionais');
      if (missingCategories.length > 0) failures.push('categorias ausentes');
      if (categoryDivergences.length > 0) failures.push('divergências de categoria');
      if (duplicateProductKeys.length > 0) failures.push('chaves de produto duplicadas');
      if (duplicateSourceCodes.length > 0) failures.push('sourceCodes duplicados');
      if (duplicateCategoryKeys.length > 0) failures.push('chaves de categoria duplicadas');
      if (invalidPublicProducts.length > 0) failures.push('produtos públicos inválidos');
      if (invalidInternalProducts.length > 0) failures.push('internos com identidade pública');
      if (internalOutsideInsumo.length > 0) failures.push('internos fora de INSUMO');
      if (exposedInternalIds.length > 0) failures.push('internos expostos pelo serviço');
      if (!('notFound' in internalProbe)) failures.push('sonda interna acessível');
      if ('notFound' in pa) failures.push('PA062240 não encontrado');
      if (!('notFound' in pa) && pa.priceInCents !== 5000) failures.push('preço de PA062240 divergente');
      if (publicCategories.length !== 2) failures.push('categorias públicas antes diferente de 2');
      if (currentProducts.items.length !== 3) failures.push('produtos públicos antes diferente de 3');
      if (insumoProducts.items.length !== 2) failures.push('produtos públicos de INSUMO diferente de 2');

      const warnings = appCatalogPrivileges.length > 0
        ? [`cardapio_dev_app possui privilégios além de SELECT: ${appCatalogPrivileges.join(', ')}`]
        : [];

      if (failures.length > 0) {
        throw new Error(`Pré-voo falhou: ${failures.join(', ')}.`);
      }

      console.log(JSON.stringify({
        mode: 'preflight-read-only',
        status: warnings.length > 0 ? 'approved-with-warning' : 'approved',
        database: database.describe(),
        identity: session,
        privileges,
        warnings,
        categories: plan.categories.map((category) => ({
          id: category.id,
          name: category.name,
          currentPublicKey: category.publicKey,
          proposedPublicKey: category.proposedPublicKey,
          isActive: category.isActive,
          displayOrder: category.displayOrder,
          totalProducts: category.totalProducts,
          publicKeyProducts: category.publicKeyProducts,
          internalProducts: category.internalProducts,
          eligibleAfter: category.eligibleAfter,
        })),
        totals: plan.totals,
        updates: plan.updates,
        conflicts: {
          extraCategories,
          missingCategories,
          categoryDivergences,
          duplicateCategoryKeys,
          duplicateProductKeys,
          duplicateSourceCodes,
          invalidPublicProducts: invalidPublicProducts.map((product) => product.publicKey),
          invalidInternalProducts: invalidInternalProducts.map((product) => product.id),
          internalOutsideInsumo: internalOutsideInsumo.map((product) => product.id),
        },
        internalPreservation: {
          total: internalProducts.length,
          allInInsumo: internalOutsideInsumo.length === 0,
          allWithoutPublicIdentity: invalidInternalProducts.length === 0,
          insumoCategoryPublicKey: internalCategory.publicKey,
          serviceInsumoProductCount: insumoProducts.items.length,
          exposedInternalIds,
        },
        apiBefore: {
          categories: publicCategories.map((category) => category.id),
          productCount: currentProducts.items.length,
          productKeys: currentProducts.items.map((product) => product.id),
          pa062240: pa,
        },
      }, null, 2));
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Falha no pré-voo.');
  process.exitCode = 1;
});

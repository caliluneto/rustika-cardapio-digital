import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  CATEGORY_PUBLIC_KEYS,
  PUBLIC_CATEGORY_KEY_PATTERN,
  planCategoryPublication,
  type CategorySnapshot,
  type ProductSnapshot,
  type PublicationPlan,
} from '../src/domain/categoryPublication';
import { createCatalogService, type CatalogPrisma } from '../src/services/catalog.service';

interface CapturedCategory extends CategorySnapshot {
  readonly publicProductKeys: readonly string[];
  readonly internalProductCount: number;
}

type PublishedCategory = Omit<CategorySnapshot, 'publicKey'> & { readonly publicKey: string };

const keys = (csv: string): readonly string[] => csv.split(',').filter(Boolean);

const capturedCategories: readonly CapturedCategory[] = [
  {
    id: '877f6779-8bf9-4941-ab69-65afe92e95ab', name: 'ÁGUA', publicKey: null, isActive: true, displayOrder: 0,
    publicProductKeys: keys('rustika-1,rustika-2'), internalProductCount: 0,
  },
  {
    id: '769c666b-3ec8-4121-833b-d8c8de0c1917', name: 'CERVEJA', publicKey: null, isActive: true, displayOrder: 0,
    publicProductKeys: keys('rustika-12,rustika-13,rustika-14,rustika-16,rustika-173,rustika-18,rustika-19,rustika-21,rustika-23,rustika-3,rustika-6,rustika-7,rustika-7891149010400,rustika-9'),
    internalProductCount: 0,
  },
  {
    id: 'c7689217-1e13-407a-8f3f-00e7a7821ab2', name: 'DESTILADO', publicKey: null, isActive: true, displayOrder: 0,
    publicProductKeys: keys('rustika-120,rustika-121,rustika-122,rustika-168,rustika-169,rustika-170,rustika-171,rustika-24,rustika-25,rustika-26,rustika-27,rustika-28,rustika-30,rustika-31,rustika-32,rustika-33,rustika-34,rustika-35,rustika-36,rustika-37,rustika-38,rustika-39,rustika-40,rustika-41,rustika-42,rustika-43,rustika-55,rustika-56,rustika-57,rustika-58,rustika-59,rustika-60,rustika-62,rustika-63,rustika-64,rustika-65,rustika-66,rustika-67,rustika-68,rustika-69,rustika-7312040017034,rustika-7893218000473,rustika-7896010004007,rustika-8004160660304'),
    internalProductCount: 0,
  },
  {
    id: '012e00e4-214a-4674-aede-49677e83faf5', name: 'DIVERSOS', publicKey: 'rustika-category-diversos', isActive: true, displayOrder: 0,
    publicProductKeys: keys('rustika-47'), internalProductCount: 0,
  },
  {
    id: '891ae262-5fd4-42e3-950b-16210959618e', name: 'DRINK PRONTO', publicKey: null, isActive: true, displayOrder: 0,
    publicProductKeys: keys('rustika-70,rustika-71,rustika-72,rustika-73,rustika-74,rustika-75,rustika-76,rustika-77,rustika-7896002111034'),
    internalProductCount: 0,
  },
  {
    id: '242e73fa-d8d3-4d0f-a55d-fd886626ea2f', name: 'DRINKS', publicKey: null, isActive: true, displayOrder: 0,
    publicProductKeys: keys('rustika-100,rustika-101,rustika-102,rustika-103,rustika-104,rustika-105,rustika-106,rustika-154,rustika-155,rustika-156,rustika-79,rustika-80,rustika-81,rustika-82,rustika-83,rustika-84,rustika-85,rustika-87,rustika-88,rustika-93,rustika-94,rustika-95,rustika-96,rustika-97,rustika-98,rustika-99'),
    internalProductCount: 0,
  },
  {
    id: 'b31f1de9-df94-4cf7-9afd-65ac88c06f27', name: 'ENERGÉTICO', publicKey: null, isActive: true, displayOrder: 0,
    publicProductKeys: keys('rustika-107,rustika-108,rustika-109,rustika-110,rustika-111,rustika-112,rustika-113,rustika-114,rustika-115,rustika-117,rustika-118,rustika-119'),
    internalProductCount: 0,
  },
  {
    id: '839dcd6e-7cbc-4772-a610-8989d55d4e88', name: 'GELO CÔCO', publicKey: null, isActive: true, displayOrder: 0,
    publicProductKeys: keys('rustika-48,rustika-49,rustika-50'), internalProductCount: 0,
  },
  {
    id: 'a3a6f2a6-33f7-45aa-91bd-529702c8ac6e', name: 'INSUMO', publicKey: 'rustika-category-insumo', isActive: true, displayOrder: 0,
    publicProductKeys: keys('rustika-44,rustika-PA062240'), internalProductCount: 24,
  },
  {
    id: '1c12cb16-3faa-4e74-82cb-1017e6687a9d', name: 'PORÇÕES', publicKey: null, isActive: true, displayOrder: 0,
    publicProductKeys: keys('rustika-123,rustika-124,rustika-125,rustika-126,rustika-129,rustika-130,rustika-131,rustika-133,rustika-135,rustika-136,rustika-137,rustika-140,rustika-141'),
    internalProductCount: 0,
  },
  {
    id: '35b2f7d6-5e15-4e93-930b-52f7c07d19d1', name: 'REFRIGERANTE', publicKey: null, isActive: true, displayOrder: 0,
    publicProductKeys: keys('rustika-143,rustika-144,rustika-145,rustika-146,rustika-147,rustika-149,rustika-150,rustika-152,rustika-153,rustika-167'),
    internalProductCount: 0,
  },
  {
    id: '41a28be7-71cb-4091-a694-2d30824a738c', name: 'SUCO', publicKey: null, isActive: true, displayOrder: 0,
    publicProductKeys: keys('rustika-157,rustika-158,rustika-159,rustika-160,rustika-161,rustika-163,rustika-164,rustika-165'),
    internalProductCount: 0,
  },
];

function buildProducts(): readonly ProductSnapshot[] {
  const products: ProductSnapshot[] = [];
  let sequence = 0;
  for (const category of capturedCategories) {
    for (const publicKey of category.publicProductKeys) {
      sequence += 1;
      const sourceCode = publicKey.slice('rustika-'.length);
      const paid = publicKey === 'rustika-PA062240';
      const baly = publicKey === 'rustika-44';
      const name = paid ? 'PANCETA (QUADRADA) SUINA- TORRESMO DE ROLO' : baly ? 'BALY 2L' : `PRODUTO ${sourceCode}`;
      products.push({
        id: paid ? '04151a17-ed46-411d-84ac-cbac9d7d9037' : `product-${sequence}`,
        publicKey,
        sourceCode,
        sourceName: name,
        sourceGroup: category.name,
        name,
        priceInCents: paid ? 5000 : baly ? 2600 : 1000 + sequence,
        isActive: true,
        availabilityState: paid ? 'AVAILABLE' : 'UNKNOWN',
        categoryId: category.id,
      });
    }
    for (let index = 0; index < category.internalProductCount; index += 1) {
      products.push({
        id: `internal-${category.id}-${index + 1}`,
        publicKey: null,
        sourceCode: null,
        sourceName: null,
        sourceGroup: null,
        name: `INSUMO INTERNO ${index + 1}`,
        priceInCents: 1,
        isActive: true,
        availabilityState: 'UNKNOWN',
        categoryId: category.id,
      });
    }
  }
  return products;
}

function publishedFrom(plan: PublicationPlan): readonly PublishedCategory[] {
  return plan.categories.map((category) => ({
    id: category.id,
    name: category.name,
    publicKey: category.proposedPublicKey,
    isActive: category.isActive,
    displayOrder: category.displayOrder,
  }));
}

interface ProductWhere {
  isActive?: boolean;
  publicKey?: string | { not: null };
  sourceCode?: { not: null };
  sourceName?: { not: null };
  sourceGroup?: { not: null };
  availabilityState?: ProductSnapshot['availabilityState'];
  category?: { is?: { isActive?: boolean; publicKey?: string | { not: null } } };
}

interface ProductFindManyArgs {
  where?: ProductWhere;
  take?: number;
  cursor?: { publicKey?: string };
  skip?: number;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function matchesProductWhere(product: ProductSnapshot, where: ProductWhere | undefined, categories: Map<string, PublishedCategory>): boolean {
  if (!where) return true;
  const category = categories.get(product.categoryId);
  if (!category) return false;
  if (where.isActive !== undefined && product.isActive !== where.isActive) return false;
  if (where.publicKey !== undefined) {
    if (typeof where.publicKey === 'string') {
      if (product.publicKey !== where.publicKey) return false;
    } else if (product.publicKey === null) return false;
  }
  if (where.sourceCode?.not === null && product.sourceCode === null) return false;
  if (where.sourceName?.not === null && product.sourceName === null) return false;
  if (where.sourceGroup?.not === null && product.sourceGroup === null) return false;
  if (where.availabilityState !== undefined && product.availabilityState !== where.availabilityState) return false;
  if (where.category?.is) {
    const categoryWhere = where.category.is;
    if (categoryWhere.isActive !== undefined && category.isActive !== categoryWhere.isActive) return false;
    if (categoryWhere.publicKey !== undefined) {
      if (typeof categoryWhere.publicKey === 'string') {
        if (category.publicKey !== categoryWhere.publicKey) return false;
      } else if (category.publicKey === null) return false;
    }
  }
  return true;
}

function sortedProducts(products: readonly ProductSnapshot[], categories: Map<string, PublishedCategory>): ProductSnapshot[] {
  return [...products].sort((left, right) => {
    const leftCategory = categories.get(left.categoryId);
    const rightCategory = categories.get(right.categoryId);
    if (!leftCategory || !rightCategory) return 0;
    return leftCategory.displayOrder - rightCategory.displayOrder ||
      compareText(leftCategory.publicKey, rightCategory.publicKey) ||
      compareText(left.publicKey ?? '', right.publicKey ?? '');
  });
}

function productRecord(product: ProductSnapshot, category: PublishedCategory) {
  return {
    publicKey: product.publicKey as string,
    sourceCode: product.sourceCode as string,
    sourceName: product.sourceName as string,
    sourceGroup: product.sourceGroup as string,
    name: product.name,
    description: null,
    descriptionSource: null,
    ingredients: null,
    price: new Prisma.Decimal(product.priceInCents).div(100),
    imageUrl: null,
    imageAlt: null,
    availabilityState: product.availabilityState,
    category: { publicKey: category.publicKey },
  };
}

function createCatalogPrisma(categories: readonly PublishedCategory[], products: readonly ProductSnapshot[]): CatalogPrisma {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const publicProducts = products.filter((product) => product.publicKey !== null);
  return {
    category: {
      findMany: async () => categories
        .filter((category) => category.isActive && category.publicKey !== null)
        .sort((left, right) => left.displayOrder - right.displayOrder || compareText(left.publicKey, right.publicKey))
        .map((category) => ({
          publicKey: category.publicKey,
          name: category.name,
          description: null,
          displayOrder: category.displayOrder,
        })),
    },
    product: {
      findMany: async (args: ProductFindManyArgs = {}) => {
        let list = sortedProducts(
          publicProducts.filter((product) => matchesProductWhere(product, args.where, byId)),
          byId,
        );
        if (args.cursor?.publicKey) {
          const index = list.findIndex((product) => product.publicKey === args.cursor?.publicKey);
          list = index >= 0 ? list.slice(index + (args.skip ?? 0)) : [];
        }
        if (args.take !== undefined) list = list.slice(0, args.take);
        return list.map((product) => productRecord(product, byId.get(product.categoryId) as PublishedCategory));
      },
      findFirst: async (args: { where?: ProductWhere } = {}) => {
        const product = sortedProducts(
          publicProducts.filter((candidate) => matchesProductWhere(candidate, args.where, byId)),
          byId,
        )[0];
        return product ? productRecord(product, byId.get(product.categoryId) as PublishedCategory) : null;
      },
    },
  } as unknown as CatalogPrisma;
}

const products = buildProducts();
const plan = planCategoryPublication(capturedCategories, products);

describe('preparação da publicação de categorias', () => {
  it('propõe chaves únicas e válidas apenas para as dez categorias sem publicKey', () => {
    expect(plan.updates).toHaveLength(10);
    expect(plan.totals).toMatchObject({
      categories: 12,
      categoriesAlreadyPublic: 2,
      categoriesToPublish: 10,
      categoriesAfter: 12,
      products: 168,
      publicKeyProducts: 144,
      internalProducts: 24,
      eligibleBefore: 3,
      eligibleAfter: 144,
    });
    expect(new Set(plan.categories.map((category) => category.proposedPublicKey)).size).toBe(12);
    expect(Object.values(CATEGORY_PUBLIC_KEYS)).toHaveLength(12);
    expect(new Set(Object.values(CATEGORY_PUBLIC_KEYS)).size).toBe(12);
    for (const category of plan.categories) {
      expect(category.proposedPublicKey.length).toBeLessThanOrEqual(64);
      expect(PUBLIC_CATEGORY_KEY_PATTERN.test(category.proposedPublicKey)).toBe(true);
    }
    expect(plan.updates.map((update) => update.name)).not.toContain('DIVERSOS');
    expect(plan.updates.map((update) => update.name)).not.toContain('INSUMO');
  });

  it('preserva IDs, nomes e chaves existentes sem criar categorias', () => {
    expect(plan.categories.map((category) => category.id)).toEqual(capturedCategories.map((category) => category.id));
    expect(plan.categories.map((category) => category.name)).toEqual(capturedCategories.map((category) => category.name));
    expect(plan.categories.find((category) => category.name === 'DIVERSOS')?.proposedPublicKey).toBe('rustika-category-diversos');
    expect(plan.categories.find((category) => category.name === 'INSUMO')?.proposedPublicKey).toBe('rustika-category-insumo');
    expect(plan.categories.find((category) => category.name === 'ÁGUA')?.proposedPublicKey).toBe('rustika-category-agua');
    expect(plan.categories.find((category) => category.name === 'ENERGÉTICO')?.proposedPublicKey).toBe('rustika-category-energetico');
    expect(plan.categories.find((category) => category.name === 'GELO CÔCO')?.proposedPublicKey).toBe('rustika-category-gelo-coco');
    for (const update of plan.updates) {
      expect(capturedCategories.find((category) => category.id === update.id)?.publicKey).toBeNull();
    }
  });

  it('expõe exatamente os 144 produtos públicos e bloqueia os 24 internos', () => {
    const expectedPublicIds = capturedCategories.flatMap((category) => category.publicProductKeys);
    expect(plan.totals.eligibleBefore).toBe(3);
    expect(plan.totals.eligibleAfter).toBe(144);
    expect(plan.eligibleProductIds).toHaveLength(144);
    expect(new Set(plan.eligibleProductIds).size).toBe(144);
    expect([...plan.eligibleProductIds].sort()).toEqual([...expectedPublicIds].sort());
    expect(plan.internalProductIds).toHaveLength(24);
    expect(plan.internalProductIds.some((id) => plan.eligibleProductIds.includes(id))).toBe(false);
    expect(plan.eligibleProductIds).toContain('rustika-PA062240');
    expect(plan.categories.find((category) => category.name === 'INSUMO')).toMatchObject({
      totalProducts: 26,
      publicKeyProducts: 2,
      internalProducts: 24,
      eligibleAfter: 2,
    });
  });

  it('é idempotente quando as chaves já estão publicadas', () => {
    const second = planCategoryPublication(publishedFrom(plan), products);
    expect(second.updates).toEqual([]);
    expect(second.totals).toMatchObject({
      categoriesAlreadyPublic: 12,
      categoriesToPublish: 0,
      eligibleBefore: 144,
      eligibleAfter: 144,
    });
    expect(second.eligibleProductIds).toEqual(plan.eligibleProductIds);
  });

  it('mantém compatibilidade com o serviço de catálogo, filtros e paginação', async () => {
    const service = createCatalogService(createCatalogPrisma(publishedFrom(plan), products));
    expect(await service.listCategories()).toHaveLength(12);

    const ids: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await service.listProducts({ limit: 50, ...(cursor ? { cursor } : {}) });
      pages += 1;
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(pages).toBe(3);
    expect(ids).toHaveLength(144);
    expect(new Set(ids).size).toBe(144);
    expect(ids).toContain('rustika-PA062240');

    const detail = await service.getProduct('rustika-PA062240');
    expect(detail.priceInCents).toBe(5000);
    await expect(service.getProduct('rustika-INTERNAL')).rejects.toMatchObject({
      statusCode: 404,
      code: 'PRODUCT_NOT_FOUND',
    });

    const destilado = await service.listProducts({ categoryId: 'rustika-category-destilado', limit: 50 });
    expect(destilado.items).toHaveLength(44);
    expect(destilado.nextCursor).toBeNull();
    expect(destilado.items.every((item) => item.categoryId === 'rustika-category-destilado')).toBe(true);

    const available = await service.listProducts({ availability: 'AVAILABLE', limit: 50 });
    expect(available.items.map((item) => item.id)).toEqual(['rustika-PA062240']);
    const unknown = await service.listProducts({ availability: 'UNKNOWN', limit: 50 });
    expect(unknown.items).toHaveLength(50);
    expect(unknown.nextCursor).not.toBeNull();
  });
});

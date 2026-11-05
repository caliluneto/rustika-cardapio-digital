export type AvailabilityState = 'UNKNOWN' | 'AVAILABLE' | 'UNAVAILABLE';

export interface CategorySnapshot {
  readonly id: string;
  readonly name: string;
  readonly publicKey: string | null;
  readonly isActive: boolean;
  readonly displayOrder: number;
}

export interface ProductSnapshot {
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

export type CategoryPublicationErrorCode =
  | 'INVALID_CATEGORY'
  | 'DUPLICATE_CATEGORY'
  | 'UNKNOWN_CATEGORY'
  | 'INVALID_PUBLIC_KEY'
  | 'DUPLICATE_PUBLIC_KEY'
  | 'INVALID_PRODUCT'
  | 'DUPLICATE_PRODUCT'
  | 'INCONSISTENT_PRODUCT';

export class CategoryPublicationError extends Error {
  constructor(
    public readonly code: CategoryPublicationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CategoryPublicationError';
  }
}

export const CATEGORY_PUBLIC_KEYS: Readonly<Record<string, string>> = {
  'ÁGUA': 'rustika-category-agua',
  'CERVEJA': 'rustika-category-cerveja',
  'DESTILADO': 'rustika-category-destilado',
  'DIVERSOS': 'rustika-category-diversos',
  'DRINK PRONTO': 'rustika-category-drink-pronto',
  'DRINKS': 'rustika-category-drinks',
  'ENERGÉTICO': 'rustika-category-energetico',
  'GELO CÔCO': 'rustika-category-gelo-coco',
  'INSUMO': 'rustika-category-insumo',
  'PORÇÕES': 'rustika-category-porcoes',
  'REFRIGERANTE': 'rustika-category-refrigerante',
  'SUCO': 'rustika-category-suco',
};

export const PUBLIC_CATEGORY_KEY_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const PUBLIC_CATEGORY_KEY_MAX_LENGTH = 64;

export interface PublicationCategory extends CategorySnapshot {
  readonly proposedPublicKey: string;
  readonly totalProducts: number;
  readonly publicKeyProducts: number;
  readonly internalProducts: number;
  readonly eligibleAfter: number;
}

export interface PublicationUpdate {
  readonly id: string;
  readonly name: string;
  readonly publicKey: string;
}

export interface PublicationTotals {
  readonly categories: number;
  readonly categoriesAlreadyPublic: number;
  readonly categoriesToPublish: number;
  readonly categoriesAfter: number;
  readonly products: number;
  readonly publicKeyProducts: number;
  readonly internalProducts: number;
  readonly eligibleBefore: number;
  readonly eligibleAfter: number;
}

export interface PublicationPlan {
  readonly categories: readonly PublicationCategory[];
  readonly updates: readonly PublicationUpdate[];
  readonly eligibleProductIds: readonly string[];
  readonly internalProductIds: readonly string[];
  readonly totals: PublicationTotals;
}

function invalid(code: CategoryPublicationErrorCode, message: string): never {
  throw new CategoryPublicationError(code, message);
}

function assertPublicKey(key: string): void {
  if (key.length > PUBLIC_CATEGORY_KEY_MAX_LENGTH || !PUBLIC_CATEGORY_KEY_PATTERN.test(key)) {
    invalid('INVALID_PUBLIC_KEY', `Chave pública de categoria inválida: ${key}`);
  }
}

function proposedKey(category: CategorySnapshot): string {
  if (category.publicKey !== null) {
    assertPublicKey(category.publicKey);
    return category.publicKey;
  }
  const key = CATEGORY_PUBLIC_KEYS[category.name];
  if (!key) invalid('UNKNOWN_CATEGORY', `Categoria sem mapeamento de chave pública: ${category.name}`);
  assertPublicKey(key);
  return key;
}

function validateCategories(categories: readonly CategorySnapshot[]): Map<string, CategorySnapshot> {
  if (categories.length === 0) invalid('INVALID_CATEGORY', 'Nenhuma categoria informada.');
  const ids = new Set<string>();
  const names = new Set<string>();
  const keys = new Set<string>();
  const byId = new Map<string, CategorySnapshot>();
  for (const category of categories) {
    if (!category.id || !category.name.trim() || !Number.isSafeInteger(category.displayOrder)) {
      invalid('INVALID_CATEGORY', `Categoria inválida: ${category.name || category.id}`);
    }
    if (ids.has(category.id)) invalid('DUPLICATE_CATEGORY', `ID de categoria duplicado: ${category.id}`);
    if (names.has(category.name)) invalid('DUPLICATE_CATEGORY', `Nome de categoria duplicado: ${category.name}`);
    const key = proposedKey(category);
    if (keys.has(key)) invalid('DUPLICATE_PUBLIC_KEY', `Chave pública de categoria duplicada: ${key}`);
    ids.add(category.id);
    names.add(category.name);
    keys.add(key);
    byId.set(category.id, category);
  }
  return byId;
}

function validateProducts(products: readonly ProductSnapshot[], categories: Map<string, CategorySnapshot>): void {
  const ids = new Set<string>();
  const publicKeys = new Set<string>();
  const sourceCodes = new Set<string>();
  for (const product of products) {
    if (!product.id || !product.name.trim() || !categories.has(product.categoryId)) {
      invalid('INVALID_PRODUCT', `Produto inválido: ${product.id || product.name}`);
    }
    if (!Number.isSafeInteger(product.priceInCents) || product.priceInCents < 0) {
      invalid('INVALID_PRODUCT', `Preço inválido para o produto: ${product.id}`);
    }
    if (ids.has(product.id)) invalid('DUPLICATE_PRODUCT', `ID de produto duplicado: ${product.id}`);
    ids.add(product.id);
    if (product.publicKey === null) continue;
    if (publicKeys.has(product.publicKey)) invalid('DUPLICATE_PRODUCT', `Chave pública de produto duplicada: ${product.publicKey}`);
    publicKeys.add(product.publicKey);
    if (!product.sourceCode || !/^[0-9A-Z]{1,64}$/.test(product.sourceCode) ||
        !product.sourceName?.trim() || !product.sourceGroup?.trim() ||
        product.publicKey !== `rustika-${product.sourceCode}`) {
      invalid('INCONSISTENT_PRODUCT', `Identidade pública inconsistente: ${product.publicKey}`);
    }
    if (sourceCodes.has(product.sourceCode)) invalid('DUPLICATE_PRODUCT', `Código de origem duplicado: ${product.sourceCode}`);
    sourceCodes.add(product.sourceCode);
  }
}

function isEligible(product: ProductSnapshot, category: CategorySnapshot, categoryKey: string | null): boolean {
  return product.isActive && product.publicKey !== null &&
    product.sourceCode !== null && product.sourceCode.length > 0 &&
    product.sourceName !== null && product.sourceName.trim().length > 0 &&
    product.sourceGroup !== null && product.sourceGroup.trim().length > 0 &&
    category.isActive && categoryKey !== null;
}

export function planCategoryPublication(
  categories: readonly CategorySnapshot[],
  products: readonly ProductSnapshot[],
): PublicationPlan {
  const byId = validateCategories(categories);
  validateProducts(products, byId);

  const rows: PublicationCategory[] = categories.map((category) => {
    const key = proposedKey(category);
    const own = products.filter((product) => product.categoryId === category.id);
    return {
      ...category,
      proposedPublicKey: key,
      totalProducts: own.length,
      publicKeyProducts: own.filter((product) => product.publicKey !== null).length,
      internalProducts: own.filter((product) => product.publicKey === null).length,
      eligibleAfter: own.filter((product) => isEligible(product, category, key)).length,
    };
  });

  const eligibleBefore = products.filter((product) => {
    const category = byId.get(product.categoryId);
    return category !== undefined && isEligible(product, category, category.publicKey);
  });
  const eligibleAfter = products.filter((product) => {
    const category = byId.get(product.categoryId);
    return category !== undefined && isEligible(product, category, proposedKey(category));
  });

  const updates = categories
    .filter((category) => category.publicKey === null)
    .map((category) => ({ id: category.id, name: category.name, publicKey: proposedKey(category) }));

  return {
    categories: rows,
    updates,
    eligibleProductIds: eligibleAfter.map((product) => product.publicKey as string),
    internalProductIds: products.filter((product) => product.publicKey === null).map((product) => product.id),
    totals: {
      categories: categories.length,
      categoriesAlreadyPublic: categories.filter((category) => category.publicKey !== null).length,
      categoriesToPublish: updates.length,
      categoriesAfter: rows.filter((category) => category.isActive && category.proposedPublicKey).length,
      products: products.length,
      publicKeyProducts: products.filter((product) => product.publicKey !== null).length,
      internalProducts: products.filter((product) => product.publicKey === null).length,
      eligibleBefore: eligibleBefore.length,
      eligibleAfter: eligibleAfter.length,
    },
  };
}

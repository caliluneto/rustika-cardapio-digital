import { Prisma } from '@prisma/client';
import type { Category, Product } from '../domain/contracts';

export const categorySelect = {
  publicKey: true, name: true, description: true, displayOrder: true,
} satisfies Prisma.CategorySelect;

export const productSelect = {
  publicKey: true, sourceCode: true, sourceName: true, sourceGroup: true,
  name: true, description: true, descriptionSource: true, ingredients: true,
  price: true, imageUrl: true, imageAlt: true, availabilityState: true,
  category: { select: { publicKey: true } },
} satisfies Prisma.ProductSelect;

export type CategoryRecord = Prisma.CategoryGetPayload<{ select: typeof categorySelect }>;
export type ProductRecord = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

/** Decimal arithmetic stays exact until the result is an integer number of cents. */
export function priceToCents(price: Prisma.Decimal): number {
  const cents = price.mul(100);
  if (!cents.isFinite() || !cents.isInteger() || cents.isNegative() ||
      cents.greaterThan(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Preço inválido no catálogo.');
  }
  return cents.toNumber();
}

function categoryKey(key: string | null): string {
  if (!key || key.length > 64 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(key)) {
    throw new Error('Identidade pública de categoria inválida.');
  }
  return key;
}

export function mapCategory(record: CategoryRecord): Category {
  return {
    id: categoryKey(record.publicKey), name: record.name,
    description: record.description ?? '', displayOrder: record.displayOrder,
  };
}

export function mapProduct(record: ProductRecord): Product {
  if (!record.sourceCode || !/^[0-9A-Z]{1,64}$/.test(record.sourceCode) ||
      record.publicKey !== `rustika-${record.sourceCode}` ||
      !record.sourceName?.trim() || !record.sourceGroup?.trim()) {
    throw new Error('Identidade pública de produto inválida.');
  }
  const availability = { UNKNOWN: null, AVAILABLE: true, UNAVAILABLE: false } as const;
  if (!(record.availabilityState in availability)) throw new Error('Disponibilidade inválida.');
  return {
    id: record.publicKey, sourceCode: record.sourceCode,
    sourceName: record.sourceName, sourceGroup: record.sourceGroup,
    categoryId: categoryKey(record.category.publicKey), name: record.name,
    priceInCents: priceToCents(record.price),
    isAvailable: availability[record.availabilityState],
    ...(record.description !== null ? { description: record.description } : {}),
    ...(record.descriptionSource !== null ? { descriptionSource: record.descriptionSource } : {}),
    ...(record.ingredients !== null ? { ingredients: record.ingredients } : {}),
    ...(record.imageUrl !== null ? { imageUrl: record.imageUrl } : {}),
    ...(record.imageAlt !== null ? { imageAlt: record.imageAlt } : {}),
  };
}

/**
 * Visão administrativa de produto. O identificador exposto é a chave pública (`rustika-<código>`);
 * não há UUID interno, descrição de origem, ingredientes, imagem nem o campo legado `isAvailable`.
 */
export const adminProductSelect = {
  publicKey: true, sourceCode: true, name: true, price: true, availabilityState: true, updatedAt: true,
  description: true, ingredients: true, imageUrl: true, imageAlt: true,
  isActive: true, sourceName: true, sourceGroup: true,
  category: { select: { publicKey: true, name: true, displayOrder: true, isActive: true } },
} satisfies Prisma.ProductSelect;
export type AdminProductRecord = Prisma.ProductGetPayload<{ select: typeof adminProductSelect }>;

export function mapAdminProduct(record: AdminProductRecord) {
  return {
    id: record.publicKey as string, sourceCode: record.sourceCode as string, name: record.name,
    categoryId: record.category.publicKey as string, categoryName: record.category.name,
    priceInCents: priceToCents(record.price), availabilityState: record.availabilityState,
    updatedAt: record.updatedAt.toISOString(),
    ...(record.description === null ? {} : { description: record.description }),
    ...(record.ingredients === null ? {} : { ingredients: record.ingredients }),
    ...(record.imageUrl === null ? {} : { imageUrl: record.imageUrl }),
    ...(record.imageAlt === null ? {} : { imageAlt: record.imageAlt }),
  };
}

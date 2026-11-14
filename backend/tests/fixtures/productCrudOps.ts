import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { expect, vi } from 'vitest';
import { mockAccessPrisma } from './access';

export type StoredAvailability = 'UNKNOWN' | 'AVAILABLE' | 'UNAVAILABLE';

export interface StoredProductCrud {
  id: string;
  publicKey: string | null;
  sourceCode: string | null;
  sourceName: string | null;
  sourceGroup: string | null;
  descriptionSource: string | null;
  imageAlt: string | null;
  availabilityState: StoredAvailability;
  categoryId: string;
  name: string;
  description: string | null;
  ingredients: string | null;
  price: Prisma.Decimal;
  imageUrl: string | null;
  isAvailable: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  category: {
    id: string;
    publicKey: string | null;
    name: string;
    displayOrder: number;
    isActive: boolean;
  };
}

const serializationConflict = () => new Prisma.PrismaClientKnownRequestError('simulated serialization conflict', { code: 'P2034', clientVersion: '6.19.3' });
const notFound = () => new Prisma.PrismaClientKnownRequestError('Record to delete not found.', { code: 'P2025', clientVersion: '6.19.3' });

function clone<T>(value: T): T {
  if (value instanceof Prisma.Decimal) return new Prisma.Decimal(value) as unknown as T;
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (Array.isArray(value)) return value.map(clone) as unknown as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
  return value;
}

function requiredString(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== 'string') throw new TypeError(`Mock product field ${key} must be a string.`);
  return value;
}

function nullableString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  if (value === null || typeof value === 'string') return value;
  throw new TypeError(`Mock product field ${key} must be a string or null.`);
}

function requiredBoolean(data: Record<string, unknown>, key: string): boolean {
  const value = data[key];
  if (typeof value !== 'boolean') throw new TypeError(`Mock product field ${key} must be a boolean.`);
  return value;
}

function requiredDecimal(data: Record<string, unknown>, key: string): Prisma.Decimal {
  const value = data[key];
  if (value instanceof Prisma.Decimal) return value;
  throw new TypeError(`Mock product field ${key} must be a Prisma.Decimal.`);
}

function recordData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Mock product data must be an object.');
  }
  return Object.fromEntries(Object.entries(value));
}

export function storedProductCrud(overrides: Partial<StoredProductCrud> & {
  categoryPublicKey?: string;
  categoryName?: string;
  categoryIsActive?: boolean;
} = {}): StoredProductCrud {
  const id = `uuid-${Math.random().toString(36).slice(2)}`;
  const categoryPublicKey = overrides.categoryPublicKey ?? 'frios';
  const categoryName = overrides.categoryName ?? 'Frios';
  const categoryIsActive = overrides.categoryIsActive ?? true;
  return {
    id,
    publicKey: `rustika-${overrides.sourceCode ?? 'MANUAL1'}`,
    sourceCode: overrides.sourceCode ?? 'MANUAL1',
    sourceName: overrides.sourceName ?? 'PRODUTO MANUAL',
    sourceGroup: overrides.sourceGroup ?? 'FRIOS',
    descriptionSource: null,
    imageAlt: null,
    availabilityState: 'UNKNOWN',
    categoryId: `cat-uuid-${categoryPublicKey}`,
    name: overrides.name ?? 'Produto Manual',
    description: null,
    ingredients: null,
    price: new Prisma.Decimal('29.90'),
    imageUrl: null,
    isAvailable: true,
    isActive: true,
    createdAt: new Date(Date.UTC(2026, 10, 5, 12, 0, 0)),
    updatedAt: new Date(Date.UTC(2026, 10, 5, 12, 0, 0)),
    category: {
      id: `cat-uuid-${categoryPublicKey}`,
      publicKey: categoryPublicKey,
      name: categoryName,
      displayOrder: 1,
      isActive: categoryIsActive,
    },
    ...(overrides as Partial<StoredProductCrud>),
  };
}

export async function mockProductCrudPrisma(initial: StoredProductCrud[] = []) {
  const access = await mockAccessPrisma();
  let products: StoredProductCrud[] = clone(initial);
  let orderItems: Array<{ id: string; productId: string }> = [];
  let categories: Array<{ id: string; publicKey: string | null; name: string; displayOrder: number; isActive: boolean }> = [
    { id: 'cat-uuid-frios', publicKey: 'frios', name: 'Frios', displayOrder: 1, isActive: true },
    { id: 'cat-uuid-bebidas', publicKey: 'bebidas', name: 'Bebidas', displayOrder: 2, isActive: true },
    { id: 'cat-uuid-insumos', publicKey: 'insumos', name: 'Insumos', displayOrder: 3, isActive: false },
  ];
  let version = 0;
  const control = Object.assign(access.control, {
    listError: false,
    failBeforeCommit: false,
    barrier: 0,
    serializationFailures: 0,
    failCreate: false,
    failUpdate: false,
    failDelete: false,
    missingCategory: false,
  });
  let arrivals = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });

  // ---- Operações que atuam sobre um array-alvo (products ou draft dentro de transação) ----
  function findFirstIn(target: StoredProductCrud[], where: {
    id?: string; publicKey?: string; name?: string; sourceCode?: string; categoryId?: string; isActive?: boolean;
  }): StoredProductCrud | null {
    return target.find((p) => {
      if (where.id !== undefined && p.id !== where.id) return false;
      if (where.publicKey !== undefined && p.publicKey !== where.publicKey) return false;
      if (where.name !== undefined && p.name !== where.name) return false;
      if (where.sourceCode !== undefined && p.sourceCode !== where.sourceCode) return false;
      if (where.categoryId !== undefined && p.categoryId !== where.categoryId) return false;
      if (where.isActive !== undefined && p.isActive !== where.isActive) return false;
      return true;
    }) ?? null;
  }

  function createIn(target: StoredProductCrud[], data: Record<string, unknown>): StoredProductCrud {
    const categoryId = requiredString(data, 'categoryId');
    const category = categories.find((candidate) => candidate.id === categoryId);
    if (!category) throw new TypeError(`Mock category ${categoryId} was not found.`);
    const availabilityState = data.availabilityState;
    if (availabilityState !== 'UNKNOWN' && availabilityState !== 'AVAILABLE' && availabilityState !== 'UNAVAILABLE') {
      throw new TypeError('Mock product field availabilityState is invalid.');
    }
    const newProduct: StoredProductCrud = {
      id: `uuid-${Math.random().toString(36).slice(2)}`,
      publicKey: requiredString(data, 'publicKey'),
      sourceCode: requiredString(data, 'sourceCode'),
      sourceName: requiredString(data, 'sourceName'),
      sourceGroup: requiredString(data, 'sourceGroup'),
      descriptionSource: null,
      imageAlt: nullableString(data, 'imageAlt'),
      availabilityState,
      categoryId,
      name: requiredString(data, 'name'),
      description: nullableString(data, 'description'),
      ingredients: nullableString(data, 'ingredients'),
      price: requiredDecimal(data, 'price'),
      imageUrl: nullableString(data, 'imageUrl'),
      isAvailable: true,
      isActive: requiredBoolean(data, 'isActive'),
      createdAt: new Date(),
      updatedAt: new Date(),
      category,
    };
    target.push(newProduct);
    return newProduct;
  }

  function updateIn(target: StoredProductCrud[], where: { publicKey: string }, data: Record<string, unknown>): StoredProductCrud {
    const idx = target.findIndex((p) => p.publicKey === where.publicKey);
    if (idx === -1) throw notFound();
    const current = target[idx];
    if (!current) throw notFound();
    const updated: StoredProductCrud = {
      ...current,
      ...(typeof data.name === 'string' ? { name: data.name } : {}),
      ...(data.description === null || typeof data.description === 'string' ? { description: data.description } : {}),
      ...(data.ingredients === null || typeof data.ingredients === 'string' ? { ingredients: data.ingredients } : {}),
      ...(data.price instanceof Prisma.Decimal ? { price: data.price } : {}),
      ...(data.imageUrl === null || typeof data.imageUrl === 'string' ? { imageUrl: data.imageUrl } : {}),
      ...(data.imageAlt === null || typeof data.imageAlt === 'string' ? { imageAlt: data.imageAlt } : {}),
      updatedAt: new Date(),
    };
    target[idx] = updated;
    return updated;
  }

  function deleteIn(target: StoredProductCrud[], where: { id: string }): StoredProductCrud {
    const idx = target.findIndex((p) => p.id === where.id);
    if (idx === -1) throw notFound();
    const [deleted] = target.splice(idx, 1);
    if (!deleted) throw notFound();
    return deleted;
  }

  const findFirst = vi.fn(async (args: {
    where: { id?: string; publicKey?: string; name?: string; sourceCode?: string; categoryId?: string; isActive?: boolean };
    select?: unknown;
  }) => {
    if (control.listError) throw new Error('private simulated driver failure: relation "products" at 10.0.0.5');
    return clone(findFirstIn(products, args.where));
  });

  const findUnique = vi.fn(async ({ where }: { where: { publicKey: string } }) => {
    if (control.listError) throw new Error('private simulated driver failure: relation "products" at 10.0.0.5');
    return clone(findFirstIn(products, where));
  });

  const findMany = vi.fn(async (args: { where?: unknown; select?: unknown; take?: number }) => {
    if (control.listError) throw new Error('private simulated driver failure: relation "products" at 10.0.0.5');
    return clone(products);
  });

  const create = vi.fn(async (args: { data: unknown; select?: unknown }) => {
    if (control.failCreate) throw new Error('private simulated create failure at 10.0.0.5');
    const newProduct = createIn(products, recordData(args.data));
    version++;
    return clone(newProduct);
  });

  const update = vi.fn(async (args: { where: { publicKey: string }; data: unknown; select?: unknown }) => {
    if (control.failUpdate) throw new Error('private simulated update failure at 10.0.0.5');
    const updated = updateIn(products, args.where, recordData(args.data));
    version++;
    return clone(updated);
  });

  const deleteProduct = vi.fn(async (args: { where: { id: string } }) => {
    if (control.failDelete) throw new Error('private simulated delete failure at 10.0.0.5');
    const deleted = deleteIn(products, args.where);
    version++;
    return clone(deleted);
  });

  const count = vi.fn(async (args: { where: { productId?: string } }) => {
    if (control.listError) throw new Error('private simulated driver failure');
    if (args.where.productId !== undefined) {
      return orderItems.filter((oi) => oi.productId === args.where.productId).length;
    }
    return products.length;
  });

  const categoryFindFirst = vi.fn(async (args: { where: { publicKey?: string; isActive?: boolean } }) => {
    if (control.missingCategory) return null;
    const { where } = args;
    // publicKey undefined significa "não especificado" - não deve casar com categoria que tem publicKey.
    // Se publicKey for undefined, não há correspondência (categorias reais sempre têm publicKey).
    return clone(categories.find((c) =>
      (where.publicKey === undefined ? false : c.publicKey === where.publicKey) &&
      (where.isActive === undefined || c.isActive === where.isActive)
    ) ?? null);
  });

  const transaction = vi.fn(async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { isolationLevel?: unknown }) => {
    if (control.serializationFailures > 0) { control.serializationFailures--; throw serializationConflict(); }
    const observed = version;
    const draft = clone(products);
    const draftOrderItems = clone(orderItems);
    const tx = {
      admin: access.prisma.admin,
      product: {
        findFirst: (args: {
          where: { id?: string; publicKey?: string; name?: string; sourceCode?: string; categoryId?: string; isActive?: boolean };
          select?: unknown;
        }) => Promise.resolve(clone(findFirstIn(draft, args.where))),
        findUnique: async ({ where }: { where: { publicKey: string } }) => Promise.resolve(clone(findFirstIn(draft, where))),
        findMany: (args: { where?: unknown; select?: unknown; take?: number }) => Promise.resolve(clone(draft)),
        create: (args: { data: unknown; select?: unknown }) => {
          if (control.failCreate) throw new Error('private simulated create failure at 10.0.0.5');
          const newProduct = createIn(draft, recordData(args.data));
          return Promise.resolve(clone(newProduct));
        },
        update: (args: { where: { publicKey: string }; data: unknown; select?: unknown }) => {
          const updated = updateIn(draft, args.where, recordData(args.data));
          return Promise.resolve(clone(updated));
        },
        delete: (args: { where: { id: string } }) => {
          const deleted = deleteIn(draft, args.where);
          return Promise.resolve(clone(deleted));
        },
      },
      orderItem: {
        count: (args: { where: { productId?: string } }) => {
          if (args.where.productId !== undefined) {
            return Promise.resolve(draftOrderItems.filter((oi) => oi.productId === args.where.productId).length);
          }
          return Promise.resolve(draft.length);
        },
      },
      category: {
        findFirst: (args: { where: { publicKey?: string; isActive?: boolean } }) => {
          const { where } = args;
          return Promise.resolve(clone(categories.find((c) =>
            (where.publicKey === undefined ? false : c.publicKey === where.publicKey) &&
            (where.isActive === undefined || c.isActive === where.isActive)
          ) ?? null));
        },
      },
    } as unknown as Prisma.TransactionClient;
    expect(options?.isolationLevel).toBe(Prisma.TransactionIsolationLevel.Serializable);
    const result = await callback(tx);
    if (control.barrier > 0 && arrivals < control.barrier) {
      arrivals++;
      if (arrivals === control.barrier) release?.();
      await gate;
    }
    if (control.failBeforeCommit) throw new Error('private simulated commit failure at 10.0.0.5');
    if (observed !== version) throw serializationConflict();
    products = draft; version++;
    return result;
  });

  const prisma = {
    admin: access.prisma.admin,
    product: { findFirst, findMany, findUnique, create, update, delete: deleteProduct },
    orderItem: { count },
    category: { findFirst: categoryFindFirst },
    $transaction: transaction,
  } as unknown as PrismaClient;
  return {
    ...access, prisma, control, findFirst, findMany, create, update, delete: deleteProduct, count,
    products: () => products, orderItems: () => orderItems, categories: () => categories,
    writes: () => [],
    setOrderItems: (items: Array<{ id: string; productId: string }>) => { orderItems = items; },
    setCategories: (cats: Array<{ id: string; publicKey: string | null; name: string; displayOrder: number; isActive: boolean }>) => { categories = cats; },
  };
}

import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { vi } from 'vitest';
import type { CategoryRecord, ProductRecord } from '../../src/mappers/catalog.mapper';

export const categoryRecord: CategoryRecord = {
  publicKey: 'drinks', name: 'Drinks', description: null, displayOrder: 3,
};

export function productRecord(overrides: Partial<ProductRecord> = {}): ProductRecord {
  return {
    publicKey: 'rustika-100', sourceCode: '100', sourceName: ' NEGRONI ', sourceGroup: 'DRINKS',
    name: 'Negroni', description: 'Descrição confirmada.', descriptionSource: 'Cardápio impresso, página 3',
    ingredients: 'Campari / gin / vermute / laranja.', price: new Prisma.Decimal('30.00'),
    imageUrl: '/images/negroni.jpg', imageAlt: 'Negroni', availabilityState: 'UNKNOWN',
    category: { publicKey: 'drinks' }, ...overrides,
  };
}

/** No PrismaClient instance, runtime profile, secret file or database connection. */
export function mockCatalogPrisma() {
  const categoryFindMany = vi.fn().mockResolvedValue([categoryRecord]);
  const productFindMany = vi.fn().mockResolvedValue([productRecord()]);
  const productFindFirst = vi.fn().mockResolvedValue(productRecord());
  const connect = vi.fn();
  const prisma = {
    category: { findMany: categoryFindMany },
    product: { findMany: productFindMany, findFirst: productFindFirst },
    $connect: connect,
  } as unknown as PrismaClient;
  return { prisma, categoryFindMany, productFindMany, productFindFirst, connect };
}

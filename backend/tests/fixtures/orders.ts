import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { vi } from 'vitest';
import type { OrderRecord } from '../../src/mappers/order.mapper';
import { orderProductSelect } from '../../src/services/order.service';
import { sha256 } from '../../src/services/orderSession';
import type { OrderSession } from '../../src/services/orderSession';

export const TOKEN = 'a'.repeat(64);
export const KEY = '11111111-1111-4111-8111-111111111111';
export const NOW = new Date('2026-10-31T12:00:00Z');
export const body = () => ({
  customerName: 'Ana Silva', customerPhone: '(16) 99999-0000', tableOrReference: 'Mesa 2',
  items: [{ productId: 'rustika-131', quantity: 2, expectedUnitPriceInCents: 5999 }],
});

export type OrderProduct = Prisma.ProductGetPayload<{ select: typeof orderProductSelect }>;
export function product(overrides: Partial<OrderProduct> = {}): OrderProduct {
  return {
    id: '11111111-1111-4111-8111-000000000001', publicKey: 'rustika-131', sourceCode: '131',
    sourceName: 'FRIOS', sourceGroup: 'PORÇÕES', name: 'Frios', price: new Prisma.Decimal('59.99'),
    isActive: true, availabilityState: 'AVAILABLE', category: { isActive: true, publicKey: 'porcoes' }, ...overrides,
  };
}

interface CreateData {
  sessionId: string; comandaId: string; idempotencyKey: string; requestDigest: string;
  customerName: string; totalAmount: Prisma.Decimal;
  items: { create: OrderRecord['items'] };
}

/** Transaction double: staged changes are published only when the callback/commit succeeds.
 * This tests application orchestration, not PostgreSQL rollback or isolation. */
export function mockOrderPrisma() {
  const session: OrderSession = {
    id: '22222222-2222-4222-8222-000000000001', comandaId: '33333333-3333-4333-8333-000000000001',
    createdAt: new Date('2020-01-01'), expiresAt: new Date('2099-01-01'), revokedAt: null,
    comanda: { id: '33333333-3333-4333-8333-000000000001', number: '000123', status: 'OPEN', closedAt: null },
  };
  const products = [product()];
  const committed = new Map<string, OrderRecord>();
  let staged: { key: string; record: OrderRecord }[] = [];
  const control: { commitError?: Error } = {};
  const validHashes = new Set([sha256(TOKEN)]);
  /** Registers another credential that resolves to the same active session (another device). */
  const addCredential = (token: string) => { validHashes.add(sha256(token)); };
  const sessionFind = vi.fn().mockImplementation(async ({ where }: { where: { credentialHash: string } }) => validHashes.has(where.credentialHash) ? session : null);
  const productFind = vi.fn().mockImplementation(async ({ where }: { where: { publicKey: { in: string[] } } }) => products.filter((item) => where.publicKey.in.includes(item.publicKey!)));
  const orderFind = vi.fn().mockImplementation(async ({ where }: { where: { idempotencyKey: string } }) => committed.get(where.idempotencyKey) ?? null);
  const orderCreate = vi.fn().mockImplementation(async ({ data }: { data: CreateData }) => {
    const record: OrderRecord = {
      id: '44444444-4444-4444-8444-000000000001', orderNumber: 42, status: 'RECEIVED',
      customerName: data.customerName, totalAmount: data.totalAmount, createdAt: NOW,
      sessionId: data.sessionId, comandaId: data.comandaId, requestDigest: data.requestDigest,
      comanda: { number: session.comanda.number },
      items: data.items.create.map((item) => ({ ...item, notes: item.notes ?? null })),
    };
    staged.push({ key: data.idempotencyKey, record });
    return record;
  });
  const tx = { comandaSession: { findUnique: sessionFind }, product: { findMany: productFind }, order: { findUnique: orderFind, create: orderCreate } };
  const transaction = vi.fn().mockImplementation(async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
    staged = [];
    try {
      const result = await callback(tx as unknown as Prisma.TransactionClient);
      if (control.commitError) throw control.commitError;
      staged.forEach(({ key, record }) => committed.set(key, record));
      return result;
    } finally { staged = []; }
  });
  const prisma = { $transaction: transaction } as unknown as PrismaClient;
  return { prisma, session, products, committed, control, transaction, addCredential, sessionFind, productFind, orderFind, orderCreate };
}

export function conflict(code = 'P2034', meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError('simulated private driver detail', { code, clientVersion: '6.19.3', meta });
}

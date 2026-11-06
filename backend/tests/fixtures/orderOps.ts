import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { OrderStatus, PrismaClient } from '@prisma/client';
import { expect, vi } from 'vitest';
import { mockAccessPrisma } from './access';

export interface StoredOrder {
  id: string; orderNumber: number; status: OrderStatus; customerName: string | null; tableOrReference: string | null;
  notes: string | null; totalAmount: Prisma.Decimal; createdAt: Date; updatedAt: Date; comanda: { number: string };
  items: { id: string; productNameSnapshot: string; unitPriceSnapshot: Prisma.Decimal; quantity: number; subtotal: Prisma.Decimal; notes: string | null }[];
  // Campos que NUNCA podem chegar ao painel (verificados pelos testes de vazamento).
  customerPhone: string; requestDigest: string; idempotencyKey: string; trackingTokenHash: string | null;
}
export interface StoredHistory { id: string; orderId: string; fromStatus: OrderStatus | null; toStatus: OrderStatus; changedByAdminId: string | null; notes: string | null }

const serializationConflict = () => new Prisma.PrismaClientKnownRequestError('simulated serialization conflict', { code: 'P2034', clientVersion: '6.19.3' });


/** `structuredClone` não clona `Prisma.Decimal`; este clone preserva Decimal e Date. */
function clone<T>(value: T): T {
  if (value instanceof Prisma.Decimal) return new Prisma.Decimal(value) as unknown as T;
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (Array.isArray(value)) return value.map(clone) as unknown as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
  return value;
}

export const orderId = (n: number) => `55555555-5555-4555-8555-${String(n).padStart(12, '0')}`;

export function storedOrder(n: number, overrides: Partial<StoredOrder> = {}): StoredOrder {
  return {
    id: orderId(n), orderNumber: n, status: 'RECEIVED', customerName: `Cliente ${n}`, tableOrReference: 'Mesa 2', notes: null,
    totalAmount: new Prisma.Decimal('59.98'), createdAt: new Date(Date.UTC(2026, 10, 5, 12, 0, n)), updatedAt: new Date(Date.UTC(2026, 10, 5, 12, 0, n)),
    comanda: { number: '000123' },
    items: [{ id: randomUUID(), productNameSnapshot: 'Frios', unitPriceSnapshot: new Prisma.Decimal('29.99'), quantity: 2, subtotal: new Prisma.Decimal('59.98'), notes: null }],
    customerPhone: '(16) 99999-0000', requestDigest: 'd'.repeat(64), idempotencyKey: 'k'.repeat(64), trackingTokenHash: null,
    ...overrides,
  };
}

/**
 * Duplo de Prisma para a operação de pedidos: transação otimista com cópia de trabalho (rollback), conflito de
 * serialização (P2034) quando outra transação confirma antes e barreira opcional para forçar a concorrência.
 * Testa a ORQUESTRAÇÃO da aplicação; isolamento e rollback reais do PostgreSQL são cobertos em
 * `tests/integration-db/order-operations.integration.ts` (CI efêmero).
 */
export async function mockOpsPrisma(initial: StoredOrder[] = []) {
  const access = await mockAccessPrisma();
  let orders: StoredOrder[] = clone(initial);
  let history: StoredHistory[] = [];
  let version = 0;
  const control = Object.assign(access.control, { listError: false, failBeforeCommit: false, barrier: 0 });
  let arrivals = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });

  const findMany = vi.fn(async (args: { where: { status: { in: OrderStatus[] } }; orderBy: unknown; take: number }) => {
    if (control.listError) throw new Error('private simulated driver failure: relation "orders" at 10.0.0.5');
    return clone(orders)
      .filter((order) => args.where.status.in.includes(order.status))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.orderNumber - b.orderNumber)
      .slice(0, args.take);
  });

  const transaction = vi.fn(async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { isolationLevel?: unknown }) => {
    const observed = version;
    const draftOrders = clone(orders);
    const draftHistory = clone(history);
    const tx = {
      admin: access.prisma.admin,
      order: {
        findUnique: async ({ where }: { where: { id: string } }) => clone(draftOrders.find((order) => order.id === where.id) ?? null),
        updateMany: async ({ where, data }: { where: { id: string; status: OrderStatus }; data: { status: OrderStatus } }) => {
          const row = draftOrders.find((order) => order.id === where.id && order.status === where.status);
          if (!row) return { count: 0 };
          row.status = data.status; row.updatedAt = new Date(row.updatedAt.getTime() + 1000);
          return { count: 1 };
        },
      },
      orderStatusHistory: {
        create: async ({ data }: { data: Omit<StoredHistory, 'id'> }) => { const row = { id: randomUUID(), ...data }; draftHistory.push(row); return row; },
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
    orders = draftOrders; history = draftHistory; version++;
    return result;
  });

  const prisma = {
    admin: access.prisma.admin, comandaSession: access.prisma.comandaSession,
    order: { findMany }, $transaction: transaction,
  } as unknown as PrismaClient;
  return { ...access, prisma, control, findMany, transaction, orders: () => orders, history: () => history };
}

import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { expect, vi } from 'vitest';
import { mockAccessPrisma } from './access';

export type StoredAvailability = 'UNKNOWN' | 'AVAILABLE' | 'UNAVAILABLE';
export interface StoredProduct {
  publicKey: string | null; sourceCode: string | null; sourceName: string | null; sourceGroup: string | null;
  name: string; price: Prisma.Decimal; availabilityState: StoredAvailability; updatedAt: Date; isActive: boolean;
  category: { publicKey: string | null; name: string; displayOrder: number; isActive: boolean };
  // Campos que o painel nunca pode receber nem alterar (verificados pelos testes de vazamento/preservação).
  isAvailable: boolean; description: string | null; stock: number | null;
}

const serializationConflict = () => new Prisma.PrismaClientKnownRequestError('simulated serialization conflict', { code: 'P2034', clientVersion: '6.19.3' });

function clone<T>(value: T): T {
  if (value instanceof Prisma.Decimal) return new Prisma.Decimal(value) as unknown as T;
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (Array.isArray(value)) return value.map(clone) as unknown as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
  return value;
}

export function storedProduct(code: string, overrides: Partial<StoredProduct> = {}): StoredProduct {
  return {
    publicKey: `rustika-${code}`, sourceCode: code, sourceName: `PRODUTO ${code}`, sourceGroup: 'FRIOS',
    name: `Produto ${code}`, price: new Prisma.Decimal('29.90'), availabilityState: 'UNKNOWN',
    updatedAt: new Date(Date.UTC(2026, 10, 5, 12, 0, 0)), isActive: true,
    category: { publicKey: 'frios', name: 'Frios', displayOrder: 1, isActive: true },
    isAvailable: true, description: 'origem', stock: 7, ...overrides,
  };
}

/** Predicado independente do serviço (reimplementado aqui) para filtrar o que o catálogo público publica. */
const publishable = (p: StoredProduct) => p.isActive && p.publicKey !== null && !!p.sourceCode && p.sourceName !== null && p.sourceGroup !== null
  && p.category.isActive && p.category.publicKey !== null;

/**
 * Duplo de Prisma para a disponibilidade: transação otimista com cópia de trabalho (rollback), conflito de serialização
 * (P2034) quando outra transação confirma antes e barreira opcional para forçar a concorrência. Registra as colunas
 * escritas em `writes` para provar que SOMENTE `availabilityState` é alterado. Isolamento real é coberto no CI.
 */
export async function mockProductPrisma(initial: StoredProduct[] = []) {
  const access = await mockAccessPrisma();
  let products: StoredProduct[] = clone(initial);
  let version = 0;
  const writes: string[][] = [];
  const control = Object.assign(access.control, { listError: false, failBeforeCommit: false, barrier: 0, serializationFailures: 0 });
  let arrivals = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });

  const findMany = vi.fn(async (args: { where: unknown; take: number }) => {
    if (control.listError) throw new Error('private simulated driver failure: relation "products" at 10.0.0.5');
    return clone(products).filter(publishable)
      .sort((a, b) => a.category.displayOrder - b.category.displayOrder || (a.category.publicKey! < b.category.publicKey! ? -1 : a.category.publicKey! > b.category.publicKey! ? 1 : 0)
        || (a.publicKey! < b.publicKey! ? -1 : 1))
      .slice(0, args.take);
  });

  const transaction = vi.fn(async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { isolationLevel?: unknown }) => {
    if (control.serializationFailures > 0) { control.serializationFailures--; throw serializationConflict(); }
    const observed = version;
    const draft = clone(products);
    const draftWrites: string[][] = [];
    const tx = {
      admin: access.prisma.admin,
      product: {
        findUnique: async ({ where }: { where: { publicKey: string } }) => clone(draft.find((p) => p.publicKey === where.publicKey) ?? null),
        updateMany: async ({ where, data }: { where: { publicKey: string; availabilityState: StoredAvailability }; data: Record<string, StoredAvailability> }) => {
          const row = draft.find((p) => p.publicKey === where.publicKey && p.availabilityState === where.availabilityState);
          draftWrites.push(Object.keys(data));
          if (!row) return { count: 0 };
          row.availabilityState = data.availabilityState!; row.updatedAt = new Date(row.updatedAt.getTime() + 1000);
          return { count: 1 };
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
    products = draft; writes.push(...draftWrites); version++;
    return result;
  });

  const prisma = {
    admin: access.prisma.admin, comandaSession: access.prisma.comandaSession,
    product: { findMany }, $transaction: transaction,
  } as unknown as PrismaClient;
  return { ...access, prisma, control, findMany, transaction, products: () => products, writes: () => writes };
}

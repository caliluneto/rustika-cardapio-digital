import type { ComandaStatus, OrderStatus } from './contracts';

export const ORDER_LIMITS = {
  maxBodyBytes: 16 * 1024,
  maxDistinctItems: 30,
  maxQuantityPerItem: 99,
  maxTotalUnits: 200,
  maxUnitPriceInCents: 999_999,
  maxTotalInCents: 1_000_000,
  maxItemNotesLength: 200,
} as const;

const comandaTransitions: Record<ComandaStatus, readonly ComandaStatus[]> = {
  OPEN: ['CLOSED', 'CANCELLED'],
  CLOSED: [],
  CANCELLED: [],
};

const orderTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  RECEIVED: ['IN_PREPARATION', 'CANCELLED'],
  IN_PREPARATION: ['READY', 'CANCELLED'],
  READY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

export function isValidComandaNumber(number: string): boolean {
  return /^[0-9]{1,6}$/.test(number);
}

export function canTransitionComanda(from: ComandaStatus, to: ComandaStatus): boolean {
  return comandaTransitions[from].includes(to);
}

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return orderTransitions[from].includes(to);
}

export type OrderRuleErrorCode = 'INVALID_ITEMS' | 'INVALID_PRICE' | 'LIMIT_EXCEEDED' | 'PRICE_CHANGED';

export class OrderRuleError extends Error {
  constructor(readonly code: OrderRuleErrorCode) {
    super(code);
    this.name = 'OrderRuleError';
  }
}

/** currentUnitPriceInCents deve vir do catálogo do servidor, nunca do corpo HTTP. */
export interface PriceInput {
  readonly productKey: string;
  readonly quantity: number;
  readonly currentUnitPriceInCents: number;
  readonly expectedUnitPriceInCents: number;
}

export interface PricedItem {
  readonly productKey: string;
  readonly quantity: number;
  readonly unitPriceInCentsSnapshot: number;
  readonly subtotalInCents: number;
}

export function priceOrderItems(items: readonly PriceInput[]): {
  readonly items: readonly PricedItem[];
  readonly totalInCents: number;
} {
  if (items.length === 0) throw new OrderRuleError('INVALID_ITEMS');
  if (items.length > ORDER_LIMITS.maxDistinctItems) throw new OrderRuleError('LIMIT_EXCEEDED');

  const seen = new Set<string>();
  const priced: PricedItem[] = [];
  let totalUnits = 0;
  let totalInCents = 0;

  for (const item of items) {
    if (!/^rustika-[0-9A-Z]{1,64}$/.test(item.productKey) || seen.has(item.productKey) ||
        !Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      throw new OrderRuleError('INVALID_ITEMS');
    }
    if (item.quantity > ORDER_LIMITS.maxQuantityPerItem) throw new OrderRuleError('LIMIT_EXCEEDED');
    seen.add(item.productKey);

    if (!Number.isSafeInteger(item.currentUnitPriceInCents) ||
        item.currentUnitPriceInCents < 1 ||
        item.currentUnitPriceInCents > ORDER_LIMITS.maxUnitPriceInCents ||
        !Number.isSafeInteger(item.expectedUnitPriceInCents) ||
        item.expectedUnitPriceInCents < 1) {
      throw new OrderRuleError('INVALID_PRICE');
    }
    if (item.currentUnitPriceInCents !== item.expectedUnitPriceInCents) {
      throw new OrderRuleError('PRICE_CHANGED');
    }

    totalUnits += item.quantity;
    const subtotalInCents = item.currentUnitPriceInCents * item.quantity;
    totalInCents += subtotalInCents;
    if (totalUnits > ORDER_LIMITS.maxTotalUnits || totalInCents > ORDER_LIMITS.maxTotalInCents) {
      throw new OrderRuleError('LIMIT_EXCEEDED');
    }
    priced.push({
      productKey: item.productKey,
      quantity: item.quantity,
      unitPriceInCentsSnapshot: item.currentUnitPriceInCents,
      subtotalInCents,
    });
  }

  return { items: priced, totalInCents };
}

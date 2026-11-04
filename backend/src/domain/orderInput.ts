import { ORDER_LIMITS } from './rules';
import { AppError } from '../middleware/errorHandler';

export interface CreateOrderInput {
  customerName: string;
  customerPhone?: string;
  tableOrReference?: string;
  notes?: string;
  items: { productId: string; quantity: number; expectedUnitPriceInCents: number; notes?: string }[];
}

function invalid(): never {
  throw new AppError(400, 'INVALID_INPUT', 'Dados do pedido inválidos.');
}

function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some((key) => !allowed.includes(key))) invalid();
  return data;
}

function text(value: unknown, max: number, min = 1): string {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f<>]/.test(value)) invalid();
  const result = value.trim();
  if (result.length < min || result.length > max) invalid();
  return result;
}

export function parseOrderInput(value: unknown): CreateOrderInput {
  const body = object(value, ['customerName', 'customerPhone', 'tableOrReference', 'notes', 'items']);
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > ORDER_LIMITS.maxDistinctItems) invalid();
  const ids = new Set<string>();
  let units = 0;
  const items = body.items.map((value) => {
    const item = object(value, ['productId', 'quantity', 'expectedUnitPriceInCents', 'notes']);
    if (typeof item.productId !== 'string' || !/^rustika-[0-9A-Z]{1,64}$/.test(item.productId) || ids.has(item.productId) ||
        !Number.isSafeInteger(item.quantity) || (item.quantity as number) < 1 || (item.quantity as number) > ORDER_LIMITS.maxQuantityPerItem ||
        !Number.isSafeInteger(item.expectedUnitPriceInCents) || (item.expectedUnitPriceInCents as number) < 1 ||
        (item.expectedUnitPriceInCents as number) > ORDER_LIMITS.maxUnitPriceInCents) invalid();
    ids.add(item.productId);
    units += item.quantity as number;
    if (units > ORDER_LIMITS.maxTotalUnits) invalid();
    return {
      productId: item.productId, quantity: item.quantity as number,
      expectedUnitPriceInCents: item.expectedUnitPriceInCents as number,
      ...(item.notes === undefined ? {} : { notes: text(item.notes, ORDER_LIMITS.maxItemNotesLength) }),
    };
  }).sort((a, b) => a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0);
  const customerPhone = body.customerPhone === undefined ? undefined : text(body.customerPhone, 25, 7);
  if (customerPhone !== undefined && !/^[0-9+(). -]+$/.test(customerPhone)) invalid();
  return {
    customerName: text(body.customerName, 120, 2),
    ...(customerPhone === undefined ? {} : { customerPhone }),
    ...(body.tableOrReference === undefined ? {} : { tableOrReference: text(body.tableOrReference, 80) }),
    ...(body.notes === undefined ? {} : { notes: text(body.notes, 500) }),
    items,
  };
}

export function parseIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Informe uma Idempotency-Key UUID v4 válida.');
  }
  return value.toLowerCase();
}

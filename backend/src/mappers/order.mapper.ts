import type { Prisma } from '@prisma/client';
import { priceToCents } from './catalog.mapper';

export const orderSelect = {
  id: true, orderNumber: true, status: true, customerName: true, totalAmount: true, createdAt: true,
  sessionId: true, comandaId: true, requestDigest: true,
  comanda: { select: { number: true } },
  items: {
    select: { productPublicKeySnapshot: true, productNameSnapshot: true, unitPriceSnapshot: true, quantity: true, subtotal: true, notes: true },
    orderBy: { productPublicKeySnapshot: 'asc' },
  },
} satisfies Prisma.OrderSelect;
export type OrderRecord = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;

export function mapOrder(order: OrderRecord) {
  return {
    id: order.id, orderNumber: order.orderNumber, status: order.status,
    customerName: order.customerName, comandaNumber: order.comanda.number,
    totalInCents: priceToCents(order.totalAmount), createdAt: order.createdAt.toISOString(),
    items: order.items.map((item) => ({
      productId: item.productPublicKeySnapshot, productNameSnapshot: item.productNameSnapshot,
      unitPriceInCentsSnapshot: priceToCents(item.unitPriceSnapshot), quantity: item.quantity,
      subtotalInCents: priceToCents(item.subtotal), ...(item.notes === null ? {} : { notes: item.notes }),
    })),
  };
}

/**
 * Visão do painel administrativo (3D.4.1). Só o que a operação precisa: sem hash de sessão, digest, chave de
 * idempotência nem telefone do cliente.
 */
export const adminOrderSelect = {
  id: true, orderNumber: true, status: true, customerName: true, tableOrReference: true, notes: true,
  totalAmount: true, createdAt: true, updatedAt: true,
  comanda: { select: { number: true } },
  items: {
    select: { id: true, productNameSnapshot: true, unitPriceSnapshot: true, quantity: true, subtotal: true, notes: true },
    orderBy: [{ productNameSnapshot: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.OrderSelect;
export type AdminOrderRecord = Prisma.OrderGetPayload<{ select: typeof adminOrderSelect }>;

export function mapAdminOrder(order: AdminOrderRecord, allowedTransitions: readonly string[]) {
  return {
    id: order.id, orderNumber: order.orderNumber, status: order.status, comandaNumber: order.comanda.number,
    customerName: order.customerName, tableOrReference: order.tableOrReference, notes: order.notes,
    totalInCents: priceToCents(order.totalAmount),
    createdAt: order.createdAt.toISOString(), updatedAt: order.updatedAt.toISOString(),
    allowedTransitions: [...allowedTransitions],
    items: order.items.map((item) => ({
      productNameSnapshot: item.productNameSnapshot, quantity: item.quantity,
      unitPriceInCentsSnapshot: priceToCents(item.unitPriceSnapshot), subtotalInCents: priceToCents(item.subtotal),
      notes: item.notes,
    })),
  };
}

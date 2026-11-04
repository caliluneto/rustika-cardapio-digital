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

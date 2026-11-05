import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { parseIdempotencyKey, parseOrderInput } from '../domain/orderInput';
import { OrderRuleError, priceOrderItems } from '../domain/rules';
import { priceToCents } from '../mappers/catalog.mapper';
import { mapOrder, orderSelect } from '../mappers/order.mapper';
import { AppError } from '../middleware/errorHandler';
import { assertActiveSession, sessionSelect, sha256, validateSessionToken } from './orderSession';

export const orderProductSelect = {
  id: true, publicKey: true, sourceCode: true, sourceName: true, sourceGroup: true,
  name: true, price: true, isActive: true, availabilityState: true,
  category: { select: { isActive: true, publicKey: true } },
} satisfies Prisma.ProductSelect;

const money = (cents: number) => new Prisma.Decimal(cents).div(100);

function retryable(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034') return true;
  const target = error.meta?.target;
  return error.code === 'P2002' && Array.isArray(target) &&
    target.some((key) => key === 'idempotency_key' || key === 'idempotencyKey');
}

export function createOrderService(prisma: Pick<PrismaClient, '$transaction'>, now = () => new Date()) {
  return {
    async createOrder(rawBody: unknown, credential: string, rawKey: unknown) {
      const tokenHash = sha256(validateSessionToken(credential));
      const key = parseIdempotencyKey(rawKey);
      const input = parseOrderInput(rawBody);
      const requestDigest = sha256(JSON.stringify(input));
      for (let attempt = 0; ; attempt++) {
        try {
          return await prisma.$transaction(async (tx) => {
            const session = await tx.comandaSession.findUnique({ where: { credentialHash: tokenHash }, select: sessionSelect });
            assertActiveSession(session, now());
            // Authorization precedes replay lookup; keys never identify another session's order.
            const idempotencyKey = sha256(JSON.stringify([session.comandaId, session.id, key]));
            const previous = await tx.order.findUnique({ where: { idempotencyKey }, select: orderSelect });
            if (previous) {
              if (previous.sessionId !== session.id || previous.comandaId !== session.comandaId || previous.requestDigest !== requestDigest) {
                throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Esta chave já foi utilizada para outro pedido.');
              }
              return { replayed: true, order: mapOrder(previous) };
            }

            const products = await tx.product.findMany({
              where: { publicKey: { in: input.items.map((item) => item.productId) } }, select: orderProductSelect,
            });
            const selected = input.items.map((item) => {
              const product = products.find((product) => product.publicKey === item.productId);
              if (!product || !product.isActive || !product.category.isActive || !product.category.publicKey ||
                  !product.sourceCode || product.publicKey !== `rustika-${product.sourceCode}` ||
                  !product.sourceName?.trim() || !product.sourceGroup?.trim()) {
                throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Um ou mais produtos não estão no catálogo público.');
              }
              if (product.availabilityState !== 'AVAILABLE') {
                throw new AppError(409, 'PRODUCT_UNAVAILABLE', 'Um ou mais produtos estão indisponíveis ou sem disponibilidade confirmada.');
              }
              return { item, product, cents: priceToCents(product.price) };
            });
            const priced = priceOrderItems(selected.map(({ item, cents }) => ({
              productKey: item.productId, quantity: item.quantity,
              currentUnitPriceInCents: cents, expectedUnitPriceInCents: item.expectedUnitPriceInCents,
            })));
            assertActiveSession(session, now());
            const order = await tx.order.create({
              data: {
                sessionId: session.id, comandaId: session.comandaId, idempotencyKey, requestDigest,
                customerName: input.customerName, customerPhone: input.customerPhone,
                tableOrReference: input.tableOrReference, notes: input.notes,
                status: 'RECEIVED', totalAmount: money(priced.totalInCents),
                items: { create: selected.map(({ item, product, cents }) => ({
                  productId: product.id, productPublicKeySnapshot: item.productId,
                  productNameSnapshot: product.name, unitPriceSnapshot: money(cents),
                  quantity: item.quantity, subtotal: money(cents * item.quantity), notes: item.notes,
                })) },
                statusHistory: { create: { fromStatus: null, toStatus: 'RECEIVED', changedByAdminId: null } },
              },
              select: orderSelect,
            });
            return { replayed: false, order: mapOrder(order) };
          }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 });
        } catch (error) {
          if (error instanceof OrderRuleError) {
            if (error.code === 'PRICE_CHANGED') throw new AppError(409, 'PRICE_CHANGED', 'O preço mudou. Atualize o catálogo e revise o pedido antes de reenviar.');
            if (error.code === 'LIMIT_EXCEEDED') throw new AppError(422, 'LIMIT_EXCEEDED', 'O pedido excede os limites permitidos.');
          }
          if (retryable(error)) {
            if (attempt < 2) continue;
            throw new AppError(409, 'ORDER_CONFLICT', 'Não foi possível concluir o pedido. Tente novamente com a mesma chave.');
          }
          throw error;
        }
      }
    },
  };
}

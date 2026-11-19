import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { OrderStatus } from '../domain/contracts';
import { ORDER_STATUSES, canTransitionOrder, nextOrderStatuses } from '../domain/rules';
import { adminOrderSelect, mapAdminOrder } from '../mappers/order.mapper';
import { AppError } from '../middleware/errorHandler';
import type { createAdminAuth } from './adminAuth.service';
import { accessBody } from './adminAuth.service';

/**
 * 3D.4.1: operação de pedidos pelo estabelecimento.
 *
 * Estados e transições vêm exclusivamente de `domain/rules.ts` (`canTransitionOrder`):
 *   RECEIVED -> IN_PREPARATION | CANCELLED;  IN_PREPARATION -> READY | CANCELLED;  READY -> DELIVERED;
 *   DELIVERED e CANCELLED são finais.
 *
 * Concorrência: compare-and-set (`updateMany ... WHERE id AND status = expectedStatus`) dentro de transação
 * Serializable; o histórico só é inserido quando o CAS atualizou exatamente uma linha, na mesma transação.
 */
export const ADMIN_ORDER_LIST_LIMIT = 100;
export const ADMIN_ORDER_DEFAULT_LIMIT = 30;
export const ORDER_STATUS_NOTE_MAX = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type OrderOpsDb = Pick<PrismaClient, 'order' | '$transaction'>;
type AdminAuth = ReturnType<typeof createAdminAuth>;

export interface StatusUpdate { toStatus: OrderStatus; expectedStatus: OrderStatus; notes?: string }
export interface AdminOrderQuery { status?: OrderStatus; cursor?: string; limit: number }

const invalid = (message = 'Dados da requisição inválidos.') => new AppError(400, 'INVALID_INPUT', message);

export function parseOrderId(raw: unknown): string {
  if (typeof raw !== 'string' || !UUID.test(raw)) throw new AppError(400, 'INVALID_ORDER_ID', 'Identificador de pedido inválido.');
  return raw.toLowerCase();
}

/** Filtros estritos e paginação por cursor; nenhuma chave desconhecida é aceita. */
export function parseAdminOrderQuery(raw: unknown): AdminOrderQuery {
  const query = accessBody(raw, ['status', 'cursor', 'limit']);
  const parsed: AdminOrderQuery = { limit: ADMIN_ORDER_DEFAULT_LIMIT };
  if (query.status !== undefined) parsed.status = asStatus(query.status);
  if (query.cursor !== undefined) parsed.cursor = parseOrderId(query.cursor);
  if (query.limit !== undefined) {
    const value = Array.isArray(query.limit) ? undefined : query.limit;
    if (typeof value !== 'string' || !/^[1-9][0-9]{0,2}$/.test(value)) throw invalid('Limite inválido.');
    const limit = Number(value);
    if (limit > ADMIN_ORDER_LIST_LIMIT) throw invalid(`O limite máximo é ${ADMIN_ORDER_LIST_LIMIT}.`);
    parsed.limit = limit;
  }
  return parsed;
}

const asStatus = (value: unknown): OrderStatus => {
  if (typeof value !== 'string' || !(ORDER_STATUSES as readonly string[]).includes(value)) {
    throw new AppError(400, 'INVALID_STATUS', 'Status de pedido inválido.');
  }
  return value as OrderStatus;
};

/** Corpo estrito: `toStatus` e `expectedStatus` obrigatórios; `notes` opcional; qualquer outro campo é rejeitado. */
export function parseStatusUpdate(raw: unknown): StatusUpdate {
  const body = accessBody(raw, ['toStatus', 'expectedStatus', 'notes']);
  if (!('toStatus' in body) || !('expectedStatus' in body)) throw invalid('Informe toStatus e expectedStatus.');
  const update: StatusUpdate = { toStatus: asStatus(body.toStatus), expectedStatus: asStatus(body.expectedStatus) };
  if (body.notes !== undefined) {
    if (typeof body.notes !== 'string') throw invalid('Observação inválida.');
    const notes = body.notes.trim();
    if (notes.length === 0 || notes.length > ORDER_STATUS_NOTE_MAX || /[\u0000-\u001f\u007f]/.test(notes)) throw invalid('Observação inválida.');
    update.notes = notes;
  }
  return update;
}

function retryable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}

export function createOrderOperations(prisma: OrderOpsDb, auth: AdminAuth) {
  return {
    /** Todos os pedidos, mais recentes primeiro, com filtro opcional e paginação por cursor. */
    async list(rawQuery: unknown, token: string | undefined) {
      await auth.authenticate(token);
      const query = parseAdminOrderQuery(rawQuery);
      const records = await prisma.order.findMany({
        ...(query.status ? { where: { status: query.status } } : {}),
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        select: adminOrderSelect,
        orderBy: [{ createdAt: 'desc' }, { orderNumber: 'desc' }], take: query.limit + 1,
      });
      const hasNextPage = records.length > query.limit;
      const page = records.slice(0, query.limit);
      return {
        truncated: hasNextPage,
        nextCursor: hasNextPage ? page.at(-1)?.id ?? null : null,
        orders: page.map((order) => mapAdminOrder(order, nextOrderStatuses(order.status))),
      };
    },

    async updateStatus(rawOrderId: unknown, rawBody: unknown, token: string | undefined) {
      const orderId = parseOrderId(rawOrderId);
      const update = parseStatusUpdate(rawBody);
      for (let attempt = 0; ; attempt++) {
        try {
          return await prisma.$transaction(async (tx) => {
            // Reautentica dentro da transação: admin desativado ou sessão revogada no meio não grava nada.
            const { admin } = await auth.authenticate(token, tx);
            const current = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, status: true } });
            if (!current) throw new AppError(404, 'ORDER_NOT_FOUND', 'Pedido não encontrado.');
            if (current.status !== update.expectedStatus) {
              throw new AppError(409, 'STATUS_CONFLICT', `O pedido já está em ${current.status}. Atualize a lista e tente novamente.`);
            }
            if (!canTransitionOrder(current.status, update.toStatus)) {
              throw new AppError(422, 'INVALID_TRANSITION', `Transição de ${current.status} para ${update.toStatus} não é permitida.`);
            }
            const changed = await tx.order.updateMany({
              where: { id: orderId, status: update.expectedStatus }, data: { status: update.toStatus },
            });
            if (changed.count !== 1) {
              throw new AppError(409, 'STATUS_CONFLICT', 'O pedido foi alterado por outra operação. Atualize a lista e tente novamente.');
            }
            await tx.orderStatusHistory.create({
              data: { orderId, fromStatus: update.expectedStatus, toStatus: update.toStatus, changedByAdminId: admin.id, notes: update.notes ?? null },
            });
            const order = await tx.order.findUnique({ where: { id: orderId }, select: adminOrderSelect });
            if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Pedido não encontrado.');
            return { order: mapAdminOrder(order, nextOrderStatuses(order.status)) };
          }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 });
        } catch (error) {
          if (retryable(error)) {
            if (attempt < 2) continue;
            throw new AppError(409, 'ORDER_CONFLICT', 'Não foi possível concluir a atualização. Atualize a lista e tente novamente.');
          }
          throw error;
        }
      }
    },
  };
}

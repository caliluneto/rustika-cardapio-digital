import { ApiError } from './api';

/**
 * Gestão administrativa de pedidos. Sem estado global, sem WebSocket: o painel consulta por polling
 * moderado (ver adminOrdersPolling.ts). Os estados e transições espelham `canTransitionOrder` do backend; a
 * fonte de verdade das ações permitidas é `allowedTransitions` devolvido pela API, nunca esta tabela.
 */
export type OrderStatus = 'RECEIVED' | 'IN_PREPARATION' | 'READY' | 'DELIVERED' | 'CANCELLED';

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  RECEIVED: 'Recebido',
  IN_PREPARATION: 'Em preparo',
  READY: 'Pronto',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
};
const STATUSES = Object.keys(ORDER_STATUS_LABEL) as OrderStatus[];

export interface AdminOrderItem {
  productNameSnapshot: string;
  quantity: number;
  unitPriceInCentsSnapshot: number;
  subtotalInCents: number;
  notes: string | null;
}

export interface AdminOrderHistory {
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  notes: string | null;
  createdAt: string;
  actorName: string | null;
}

export interface AdminOrder {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  comandaNumber: string;
  customerName: string | null;
  tableOrReference: string | null;
  notes: string | null;
  totalInCents: number;
  createdAt: string;
  updatedAt: string;
  allowedTransitions: OrderStatus[];
  items: AdminOrderItem[];
  history: AdminOrderHistory[];
}

export interface AdminOrdersSnapshot { orders: AdminOrder[]; truncated: boolean; nextCursor: string | null }
export interface AdminOrdersQuery { status?: OrderStatus; cursor?: string; limit?: number }

export interface StatusChange { expectedStatus: OrderStatus; toStatus: OrderStatus; notes?: string }

/** Polling moderado: 10 s entre o fim de uma consulta e o início da próxima. */
export const ORDERS_POLL_INTERVAL_MS = 10_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const bad = () => new ApiError(200, 'INVALID_RESPONSE', 'A API respondeu em um formato inesperado.', null);
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string => { if (typeof value !== 'string') throw bad(); return value; };
const nullableText = (value: unknown): string | null => (value === null ? null : text(value));
const count = (value: unknown): number => { if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw bad(); return value; };
const status = (value: unknown): OrderStatus => { if (typeof value !== 'string' || !STATUSES.includes(value as OrderStatus)) throw bad(); return value as OrderStatus; };

export function parseAdminOrder(value: unknown): AdminOrder {
  if (!isRecord(value) || !Array.isArray(value.items) || !Array.isArray(value.allowedTransitions) || !Array.isArray(value.history)) throw bad();
  const id = text(value.id);
  if (!UUID.test(id)) throw bad();
  return {
    id,
    orderNumber: count(value.orderNumber),
    status: status(value.status),
    comandaNumber: text(value.comandaNumber),
    customerName: nullableText(value.customerName),
    tableOrReference: nullableText(value.tableOrReference),
    notes: nullableText(value.notes),
    totalInCents: count(value.totalInCents),
    createdAt: text(value.createdAt),
    updatedAt: text(value.updatedAt),
    allowedTransitions: value.allowedTransitions.map(status),
    items: value.items.map((item) => {
      if (!isRecord(item)) throw bad();
      return {
        productNameSnapshot: text(item.productNameSnapshot),
        quantity: count(item.quantity),
        unitPriceInCentsSnapshot: count(item.unitPriceInCentsSnapshot),
        subtotalInCents: count(item.subtotalInCents),
        notes: nullableText(item.notes),
      };
    }),
    history: value.history.map((entry) => {
      if (!isRecord(entry)) throw bad();
      return {
        fromStatus: entry.fromStatus === null ? null : status(entry.fromStatus),
        toStatus: status(entry.toStatus),
        notes: nullableText(entry.notes),
        createdAt: text(entry.createdAt),
        actorName: nullableText(entry.actorName),
      };
    }),
  };
}

export function parseSnapshot(value: unknown): AdminOrdersSnapshot {
  if (!isRecord(value) || !Array.isArray(value.orders) || typeof value.truncated !== 'boolean' ||
      !(value.nextCursor === null || typeof value.nextCursor === 'string')) throw bad();
  if (typeof value.nextCursor === 'string' && !UUID.test(value.nextCursor)) throw bad();
  return { orders: value.orders.map(parseAdminOrder), truncated: value.truncated, nextCursor: value.nextCursor };
}

interface AdminOrdersTransport {
  getWithAuth<T>(path: string, signal?: AbortSignal): Promise<T>;
  patch<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T>;
}

export function createAdminOrdersClient(transport: AdminOrdersTransport) {
  return {
    async list(query: AdminOrdersQuery = {}, signal?: AbortSignal): Promise<AdminOrdersSnapshot> {
      const params = new URLSearchParams();
      if (query.status) params.set('status', query.status);
      if (query.cursor) params.set('cursor', query.cursor);
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      const suffix = params.size > 0 ? `?${params.toString()}` : '';
      return parseSnapshot(await transport.getWithAuth<unknown>(`/admin/orders${suffix}`, signal));
    },
    async updateStatus(orderId: string, change: StatusChange, signal?: AbortSignal): Promise<AdminOrder> {
      if (!UUID.test(orderId)) throw new ApiError(0, 'INVALID_ORDER_ID', 'Identificador de pedido inválido.', null);
      const body: StatusChange = { expectedStatus: change.expectedStatus, toStatus: change.toStatus };
      if (change.notes !== undefined && change.notes.trim() !== '') body.notes = change.notes.trim();
      const data = await transport.patch<unknown>(`/admin/orders/${orderId}/status`, body, signal);
      if (!isRecord(data)) throw bad();
      return parseAdminOrder(data.order);
    },
  };
}

export type AdminOrdersClient = ReturnType<typeof createAdminOrdersClient>;

/** O servidor tem a palavra final; a UI só impede cliques óbvios e pede confirmação antes de enviar. */
export function canOfferTransition(order: AdminOrder, toStatus: OrderStatus): boolean {
  return order.allowedTransitions.includes(toStatus);
}

export function confirmationMessage(order: AdminOrder, toStatus: OrderStatus): string {
  const base = `Pedido #${order.orderNumber} (comanda ${order.comandaNumber}): ${ORDER_STATUS_LABEL[order.status]} → ${ORDER_STATUS_LABEL[toStatus]}.`;
  return toStatus === 'CANCELLED' ? `${base} O cancelamento não pode ser desfeito. Confirmar?` : `${base} Confirmar?`;
}

/** Mensagem para o operador; `conflict` indica que a lista deve ser recarregada. Nunca expõe detalhes internos. */
export function describeStatusError(error: unknown): { message: string; conflict: boolean; unauthorized: boolean } {
  if (error instanceof ApiError) {
    if (error.status === 401) return { message: 'Sua sessão expirou. Entre novamente.', conflict: false, unauthorized: true };
    if (error.status === 409) {
      return { message: 'O pedido foi alterado por outra pessoa. A lista foi atualizada; revise e tente novamente.', conflict: true, unauthorized: false };
    }
    if (error.status === 422) return { message: 'Esta mudança de status não é permitida para o pedido.', conflict: true, unauthorized: false };
    if (error.status === 404) return { message: 'Pedido não encontrado. A lista foi atualizada.', conflict: true, unauthorized: false };
    if (error.status === 0) return { message: 'Falha de comunicação com o servidor. Verifique a conexão e tente novamente.', conflict: false, unauthorized: false };
    if (error.status === 429) return { message: error.message, conflict: false, unauthorized: false };
    if (error.status >= 500) return { message: 'O servidor não conseguiu concluir a operação. Tente novamente.', conflict: false, unauthorized: false };
    return { message: 'Não foi possível atualizar o pedido.', conflict: false, unauthorized: false };
  }
  return { message: 'Não foi possível atualizar o pedido.', conflict: false, unauthorized: false };
}

export function describeListError(error: unknown): { message: string; unauthorized: boolean } {
  if (error instanceof ApiError && error.status === 401) return { message: 'Sua sessão expirou. Entre novamente.', unauthorized: true };
  if (error instanceof ApiError && error.status === 0) return { message: 'Falha de comunicação com o servidor. Tentaremos novamente.', unauthorized: false };
  return { message: 'Não foi possível carregar os pedidos. Tentaremos novamente.', unauthorized: false };
}

export const formatBRL = (cents: number): string => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

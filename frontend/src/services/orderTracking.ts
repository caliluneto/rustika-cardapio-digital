import { ApiError } from './api';

export type CustomerOrderStatus = 'RECEIVED' | 'IN_PREPARATION' | 'READY' | 'DELIVERED' | 'CANCELLED';

export const CUSTOMER_STATUS_LABEL: Record<CustomerOrderStatus, string> = {
  RECEIVED: 'Recebido',
  IN_PREPARATION: 'Em preparação',
  READY: 'Pronto',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
};

const STATUSES = Object.keys(CUSTOMER_STATUS_LABEL) as CustomerOrderStatus[];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = () => new ApiError(200, 'INVALID_RESPONSE', 'A API respondeu em um formato inesperado.', null);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): string => { if (typeof value !== 'string') throw invalid(); return value; };
const integer = (value: unknown): number => { if (!Number.isInteger(value) || (value as number) < 0) throw invalid(); return value as number; };
const status = (value: unknown): CustomerOrderStatus => {
  if (typeof value !== 'string' || !STATUSES.includes(value as CustomerOrderStatus)) throw invalid();
  return value as CustomerOrderStatus;
};

export interface CustomerOrderHistory {
  fromStatus: CustomerOrderStatus | null;
  toStatus: CustomerOrderStatus;
  createdAt: string;
}

export interface CustomerOrderTracking {
  id: string;
  orderNumber: number;
  status: CustomerOrderStatus;
  comandaNumber: string;
  totalInCents: number;
  createdAt: string;
  updatedAt: string;
  history: CustomerOrderHistory[];
}

export function parseCustomerOrder(value: unknown): CustomerOrderTracking {
  if (!record(value) || !Array.isArray(value.history)) throw invalid();
  const id = text(value.id);
  if (!UUID.test(id)) throw invalid();
  return {
    id,
    orderNumber: integer(value.orderNumber),
    status: status(value.status),
    comandaNumber: text(value.comandaNumber),
    totalInCents: integer(value.totalInCents),
    createdAt: text(value.createdAt),
    updatedAt: text(value.updatedAt),
    history: value.history.map((entry) => {
      if (!record(entry)) throw invalid();
      return {
        fromStatus: entry.fromStatus === null ? null : status(entry.fromStatus),
        toStatus: status(entry.toStatus),
        createdAt: text(entry.createdAt),
      };
    }),
  };
}

interface TrackingTransport { getOrderStatus(orderId: string, signal?: AbortSignal): Promise<unknown> }

export function createOrderTrackingClient(transport: TrackingTransport) {
  return {
    async get(orderId: string, signal?: AbortSignal): Promise<CustomerOrderTracking> {
      if (!UUID.test(orderId)) throw new ApiError(0, 'INVALID_ORDER_ID', 'Identificador de pedido inválido.', null);
      return parseCustomerOrder(await transport.getOrderStatus(orderId, signal));
    },
  };
}

export type OrderTrackingClient = ReturnType<typeof createOrderTrackingClient>;
export const ORDER_TRACKING_POLL_MS = 5_000;

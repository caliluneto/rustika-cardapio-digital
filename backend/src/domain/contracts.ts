/** Proposta lógica RF004: identificadores públicos não são UUIDs de persistência. */
export type ComandaStatus = 'OPEN' | 'CLOSED' | 'CANCELLED';
export type OrderStatus = 'RECEIVED' | 'IN_PREPARATION' | 'READY' | 'DELIVERED' | 'CANCELLED';
export type IsoDateTime = string;

export interface Category {
  readonly id: string; // slug público, preservado do catálogo local
  readonly name: string;
  readonly description: string;
  readonly displayOrder: number;
}

export interface Product {
  readonly id: string; // rustika-<sourceCode>
  readonly sourceCode: string;
  readonly sourceName: string;
  readonly sourceGroup: string;
  readonly categoryId: Category['id'];
  readonly name: string;
  readonly description?: string;
  readonly descriptionSource?: string;
  readonly priceInCents: number;
  readonly imageUrl?: string;
  readonly imageAlt?: string;
  readonly isAvailable: boolean | null; // null = não confirmado
}

export interface Comanda {
  readonly id: string; // UUID interno
  readonly number: string; // 1 a 6 dígitos, zeros iniciais significativos
  readonly status: ComandaStatus;
  readonly openedAt: IsoDateTime;
  readonly closedAt: IsoDateTime | null;
}

export interface ComandaSession {
  readonly id: string; // UUID interno; não é uma credencial
  readonly comandaId: Comanda['id'];
  readonly credentialHash: string; // nunca expor o segredo em DTOs
  readonly createdAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
  readonly revokedAt: IsoDateTime | null;
}

export interface Order {
  readonly id: string;
  readonly orderNumber: number;
  readonly comandaId: Comanda['id'];
  readonly sessionId: ComandaSession['id'];
  readonly status: OrderStatus;
  readonly totalInCents: number;
  readonly createdAt: IsoDateTime;
  readonly items: readonly OrderItem[];
}

export interface OrderItem {
  readonly id: string;
  readonly productId: Product['id'];
  readonly productNameSnapshot: string;
  readonly unitPriceInCentsSnapshot: number;
  readonly quantity: number;
  readonly subtotalInCents: number;
  readonly notes?: string;
}

export interface OrderStatusHistory {
  readonly id: string;
  readonly orderId: Order['id'];
  readonly fromStatus: OrderStatus | null;
  readonly toStatus: OrderStatus;
  readonly changedByAdminId: string | null;
  readonly createdAt: IsoDateTime;
  readonly notes?: string;
}

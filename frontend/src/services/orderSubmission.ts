import type { CartState } from '../contexts/cart';
import { ApiError } from './api';
import type { ApiClient, OrderConfirmation, OrderRequest } from './api';

export interface CustomerDetails {
  customerName: string;
  customerPhone?: string;
  tableOrReference?: string;
  notes?: string;
}

export interface SubmissionEnv { VITE_ORDER_SUBMISSION?: string }

/**
 * Real order submission stays disabled unless the build sets VITE_ORDER_SUBMISSION=enabled.
 * Orders are persisted only when submission is enabled and the server authorizes the request.
 *
 * The default parameter MUST be the literal `import.meta.env`. Vite only injects the
 * variables into modules whose code contains that exact text; reading the env through a local
 * alias of the meta object leaves `env` undefined, so the flag could never be turned on.
 * There is no runtime override (no window flag): the switch is the build/dev-server environment only.
 * Outside Vite (node:test) `import.meta.env` is undefined and submission stays disabled.
 */
export function orderSubmissionEnabled(env: SubmissionEnv | undefined = import.meta.env): boolean {
  return env?.VITE_ORDER_SUBMISSION?.trim() === 'enabled';
}

const optional = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/** Builds the backend payload from the existing cart. Prices are only a confirmation; the server reprices. */
export function buildOrderRequest(cart: CartState, customer: CustomerDetails): OrderRequest {
  if (cart.items.length === 0) throw new ApiError(0, 'EMPTY_CART', 'Adicione pelo menos um produto ao carrinho.', null);
  const customerName = customer.customerName.trim();
  if (customerName.length < 2) throw new ApiError(0, 'INVALID_INPUT', 'Informe seu nome (mínimo de 2 caracteres).', null);
  const body: OrderRequest = {
    customerName,
    items: cart.items.map((item) => ({
      productId: item.product.id,
      quantity: item.quantity,
      expectedUnitPriceInCents: item.product.priceInCents,
    })),
  };
  const phone = optional(customer.customerPhone); if (phone) body.customerPhone = phone;
  const table = optional(customer.tableOrReference); if (table) body.tableOrReference = table;
  const notes = optional(customer.notes); if (notes) body.notes = notes;
  return body;
}

export interface OrderSubmitter {
  submit(body: OrderRequest, signal?: AbortSignal): Promise<OrderConfirmation>;
  /** Resends the attempt whose outcome is unknown, with its original body and key. */
  retryPending(signal?: AbortSignal): Promise<OrderConfirmation>;
  readonly pending: boolean;
  /** True when the last attempt may have been recorded by the server without a confirmation. */
  readonly uncertain: boolean;
}

interface Attempt { digest: string; key: string; body: OrderRequest; uncertain: boolean }

/** Where the in-progress attempt lives. In memory only: no storage, no personal data persisted. */
export interface AttemptStore { attempt: Attempt | null; inFlight: boolean }

export function createAttemptStore(): AttemptStore {
  return { attempt: null, inFlight: false };
}

/** Shared by every Checkout mount, so closing and reopening the dialog keeps the same key. */
const sharedStore = createAttemptStore();

/** Outcome unknown: the request may have been committed (network/timeout/abort/5xx). */
function outcomeUnknown(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  return error instanceof ApiError && (error.status === 0 && (error.code === 'NETWORK' || error.code === 'TIMEOUT') || error.status >= 500);
}

/** The server answered and did not create the order, but the same attempt may be retried as is. */
function retryableWithoutCreation(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 429 || error.code === 'ORDER_CONFLICT');
}

/**
 * Prevents duplicate orders on the client:
 * - one request in flight at a time, across Checkout mounts (double click => ORDER_IN_PROGRESS);
 * - the same payload keeps the same Idempotency-Key until it succeeds, so a retry after a
 *   network failure, timeout, 5xx or 429 is answered by the backend as a replay (200), never twice;
 * - while an attempt is UNCERTAIN, a different payload is refused (PENDING_ORDER_UNCERTAIN) until
 *   `retryPending()` resolves it: editing the form cannot turn a possibly-recorded order into a
 *   second order under a new key;
 * - a definitive refusal (400, 401, 403, 404, 409 other than ORDER_CONFLICT, 422) discards the
 *   attempt: nothing was created, so the next attempt gets a fresh key;
 * - after success the key is discarded, so the next order is a new one.
 */
export function createOrderSubmitter(
  client: Pick<ApiClient, 'createOrder'>,
  newKey: () => string = () => crypto.randomUUID(),
  store: AttemptStore = sharedStore,
): OrderSubmitter {
  async function send(attempt: Attempt, signal?: AbortSignal): Promise<OrderConfirmation> {
    if (store.inFlight) throw new ApiError(0, 'ORDER_IN_PROGRESS', 'O pedido já está sendo enviado. Aguarde.', null);
    store.inFlight = true;
    store.attempt = attempt;
    try {
      const confirmation = await client.createOrder(attempt.body, attempt.key, signal);
      store.attempt = null;
      return confirmation;
    } catch (error) {
      if (outcomeUnknown(error)) store.attempt = { ...attempt, uncertain: true };
      else if (!retryableWithoutCreation(error)) store.attempt = null;
      throw error;
    } finally {
      store.inFlight = false;
    }
  }

  return {
    get pending() { return store.inFlight; },
    get uncertain() { return store.attempt?.uncertain === true; },
    async submit(body, signal) {
      if (store.inFlight) throw new ApiError(0, 'ORDER_IN_PROGRESS', 'O pedido já está sendo enviado. Aguarde.', null);
      const digest = JSON.stringify(body);
      const previous = store.attempt;
      if (previous?.uncertain && previous.digest !== digest) {
        throw new ApiError(0, 'PENDING_ORDER_UNCERTAIN', 'O envio anterior ficou sem confirmação. Reenvie o pedido anterior antes de alterar ou fazer outro.', null);
      }
      const attempt = previous && previous.digest === digest ? previous : { digest, key: newKey(), body, uncertain: false };
      return send(attempt, signal);
    },
    async retryPending(signal) {
      const previous = store.attempt;
      if (!previous) throw new ApiError(0, 'NO_PENDING_ORDER', 'Não há envio pendente.', null);
      return send(previous, signal);
    },
  };
}

/** A backend-confirmed session is usable only until its expiry. */
export function comandaSessionUsable(session: { expiresAt: string } | null, now = new Date()): boolean {
  if (!session) return false;
  const expires = Date.parse(session.expiresAt);
  return Number.isFinite(expires) && expires > now.getTime();
}

/**
 * Rechecks at submission time: `comandaSessionUsable` is computed during render, so a dialog left
 * open across the expiry boundary would otherwise attempt a new order. The server would answer
 * 401, but blocking it locally avoids a pointless write attempt and gives the same recovery path.
 */
export function requireUsableComandaSession(session: { expiresAt: string } | null, now = new Date()): void {
  if (!comandaSessionUsable(session, now)) {
    throw new ApiError(401, 'INVALID_SESSION', 'Sua sessão de comanda expirou. Resgate um novo convite com o atendente.', null);
  }
}

/** User-facing guidance per failure, without exposing internal details. */
export function describeOrderError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Não foi possível enviar o pedido. Tente novamente.';
  if (error.status === 0 && (error.code === 'NETWORK' || error.code === 'TIMEOUT')) {
    return `${error.message} Seu pedido pode ser reenviado com segurança: ele não será duplicado.`;
  }
  if (error.code === 'PENDING_ORDER_UNCERTAIN') return error.message;
  if (error.code === 'ORDER_IN_PROGRESS') return error.message;
  if (error.status === 401) return 'Sua sessão de comanda expirou ou não é válida. Resgate um novo convite com o atendente.';
  if (error.status === 403) return 'O envio foi bloqueado pela proteção de origem. Recarregue a página e tente novamente.';
  if (error.code === 'PRICE_CHANGED') return 'O preço de algum item mudou. Atualize o cardápio e revise o carrinho antes de reenviar.';
  if (error.code === 'PRODUCT_UNAVAILABLE' || error.code === 'PRODUCT_NOT_FOUND') return 'Algum item não está mais disponível. Revise o carrinho.';
  if (error.status === 429) return error.message;
  return error.message;
}

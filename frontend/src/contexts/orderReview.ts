import { selectCartItemCount, selectCartTotal } from './cart';
import type { CartState } from './cart';
import { normalizeComanda } from './comanda';

/** Pré-condições locais da demonstração; não validam a comanda nem criam pedido. */
export function canReviewOrder(state: CartState, comanda: string | null): boolean {
  if (!comanda || normalizeComanda(comanda) !== comanda || state.items.length === 0) return false;
  const ids = new Set<string>();
  for (const item of state.items) {
    if (!item.product.id.trim() || ids.has(item.product.id) || item.product.isAvailable === false) return false;
    ids.add(item.product.id);
  }
  try {
    return selectCartItemCount(state) > 0 && Number.isSafeInteger(selectCartTotal(state));
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

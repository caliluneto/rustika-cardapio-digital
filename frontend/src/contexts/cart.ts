import type { Product } from '../types/catalog';

export interface CartItem {
  readonly product: Readonly<Product>;
  readonly quantity: number;
}

export interface CartState {
  readonly items: readonly CartItem[];
}

export type CartAction =
  | { type: 'ADD_ITEM'; product: Product; quantity?: number }
  | { type: 'INCREMENT'; productId: Product['id'] }
  | { type: 'DECREMENT'; productId: Product['id'] }
  | { type: 'REMOVE_ITEM'; productId: Product['id'] }
  | { type: 'CLEAR_CART' };

export const initialCartState: CartState = { items: [] };

function validQuantity(quantity: number): boolean {
  return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 99;
}

function validPrice(price: number): boolean {
  return Number.isSafeInteger(price) && price >= 0;
}

/** Valores locais de referência, não confirmação de preço, estoque ou pedido. */
export function selectItemSubtotal(item: CartItem): number {
  const price = item.product.priceInCents;
  if (!validPrice(price) || !validQuantity(item.quantity) || price > Math.floor(Number.MAX_SAFE_INTEGER / item.quantity)) {
    throw new RangeError('Preço ou quantidade inválidos, ou subtotal excede o limite seguro.');
  }
  return price * item.quantity;
}

export function selectCartTotal(state: CartState): number {
  return state.items.reduce((total, item) => {
    const subtotal = selectItemSubtotal(item);
    if (subtotal > Number.MAX_SAFE_INTEGER - total) {
      throw new RangeError('Total excede o limite seguro.');
    }
    return total + subtotal;
  }, 0);
}

export function selectCartItemCount(state: CartState): number {
  return state.items.reduce((count, item) => {
    if (!validQuantity(item.quantity) || item.quantity > Number.MAX_SAFE_INTEGER - count) {
      throw new RangeError('Quantidade inválida ou acima do limite seguro.');
    }
    return count + item.quantity;
  }, 0);
}

function acceptIfSafe(previous: CartState, items: readonly CartItem[]): CartState {
  const next: CartState = { items };
  try {
    selectCartTotal(next);
    selectCartItemCount(next);
    return next;
  } catch (error) {
    if (error instanceof RangeError) return previous;
    throw error;
  }
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'ADD_ITEM': {
      const { product } = action;
      const quantity = action.quantity === undefined ? 1 : action.quantity;
      if (!product || typeof product.id !== 'string' || !product.id.trim() ||
          product.isAvailable === false || !validPrice(product.priceInCents) || !validQuantity(quantity)) return state;
      const index = state.items.findIndex((item) => item.product.id === product.id);
      if (index < 0) {
        return acceptIfSafe(state, [...state.items, { product: { ...product }, quantity }]);
      }
      const item = state.items[index];
      const nextQuantity = item.quantity + quantity;
      // Keep the original snapshot; a changed price requires an explicit future policy.
      if (item.product.priceInCents !== product.priceInCents || !validQuantity(nextQuantity)) return state;
      return acceptIfSafe(state, state.items.map((entry, i) => i === index ? { ...entry, quantity: nextQuantity } : entry));
    }
    case 'INCREMENT': {
      const index = state.items.findIndex((item) => item.product.id === action.productId);
      if (index < 0 || !validQuantity(state.items[index].quantity + 1)) return state;
      return acceptIfSafe(state, state.items.map((item, i) => i === index ? { ...item, quantity: item.quantity + 1 } : item));
    }
    case 'DECREMENT': {
      const index = state.items.findIndex((item) => item.product.id === action.productId);
      if (index < 0) return state;
      if (state.items[index].quantity === 1) return { items: state.items.filter((_, i) => i !== index) };
      return { items: state.items.map((item, i) => i === index ? { ...item, quantity: item.quantity - 1 } : item) };
    }
    case 'REMOVE_ITEM': {
      if (!state.items.some((item) => item.product.id === action.productId)) return state;
      return { items: state.items.filter((item) => item.product.id !== action.productId) };
    }
    case 'CLEAR_CART':
      return state.items.length === 0 ? state : initialCartState;
    default:
      return state;
  }
}

export interface CartSession {
  readonly cart: CartState;
  readonly result: { readonly action: CartAction; readonly accepted: boolean } | null;
}

export const initialCartSession: CartSession = { cart: initialCartState, result: null };

// Report the actual reducer result, including no-op rejections, without side effects.
export function cartSessionReducer(session: CartSession, action: CartAction): CartSession {
  const cart = cartReducer(session.cart, action);
  return { cart, result: { action, accepted: cart !== session.cart } };
}

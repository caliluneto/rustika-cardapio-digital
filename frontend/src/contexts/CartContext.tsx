import { createContext, useCallback, useContext, useMemo, useReducer, useState } from 'react';
import type { Dispatch, ReactNode } from 'react';
import { cartSessionReducer, initialCartSession, selectCartItemCount, selectCartTotal } from './cart';
import type { CartAction, CartSession, CartState } from './cart';
import { normalizeComanda } from './comanda';

interface CartContextValue {
  state: CartState;
  dispatch: Dispatch<CartAction>;
  result: CartSession['result'];
  /** Identificador local, ainda não validado pelo estabelecimento. */
  comanda: string | null;
  setComanda: (input: string) => boolean;
  /** Local reference values; these do not confirm price, availability or an order. */
  totalInCents: number;
  itemCount: number;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [session, dispatch] = useReducer(cartSessionReducer, initialCartSession);
  const [comanda, setComandaValue] = useState<string | null>(null);
  const setComanda = useCallback((input: string) => {
    const normalized = normalizeComanda(input);
    if (normalized === null) return false;
    setComandaValue(normalized);
    return true;
  }, []);
  const state = session.cart;
  const value = useMemo(() => ({
    state,
    dispatch,
    result: session.result,
    comanda,
    setComanda,
    totalInCents: selectCartTotal(state),
    itemCount: selectCartItemCount(state),
  }), [state, session.result, comanda, setComanda]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart deve ser usado dentro de CartProvider.');
  return context;
}

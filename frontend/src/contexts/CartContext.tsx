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
  /** Sessão confirmada pelo backend (cookie HttpOnly rustika_session). Só ela habilita o envio real. */
  comandaSession: ComandaSession | null;
  setComandaSession: (session: ComandaSession | null) => void;
  /** Local reference values; these do not confirm price, availability or an order. */
  totalInCents: number;
  itemCount: number;
}

export interface ComandaSession {
  number: string;
  expiresAt: string;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [session, dispatch] = useReducer(cartSessionReducer, initialCartSession);
  const [comanda, setComandaValue] = useState<string | null>(null);
  const setComanda = useCallback((input: string) => {
    const normalized = normalizeComanda(input);
    if (normalized === null) return false;
    setComandaValue(normalized);
    setComandaSessionValue((current) => (current && current.number !== normalized ? null : current));
    return true;
  }, []);
  const [comandaSession, setComandaSessionValue] = useState<ComandaSession | null>(null);
  const setComandaSession = useCallback((next: ComandaSession | null) => {
    const normalized = next ? normalizeComanda(next.number) : null;
    if (next && normalized === null) return;
    setComandaSessionValue(next && normalized ? { number: normalized, expiresAt: next.expiresAt } : null);
    if (normalized) setComandaValue(normalized);
  }, []);
  const state = session.cart;
  const value = useMemo(() => ({
    state,
    dispatch,
    result: session.result,
    comanda,
    setComanda,
    comandaSession,
    setComandaSession,
    totalInCents: selectCartTotal(state),
    itemCount: selectCartItemCount(state),
  }), [state, session.result, comanda, setComanda, comandaSession, setComandaSession]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart deve ser usado dentro de CartProvider.');
  return context;
}

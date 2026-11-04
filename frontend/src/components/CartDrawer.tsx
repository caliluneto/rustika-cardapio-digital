import { useLayoutEffect, useRef, useState } from 'react';
import { useCart } from '../contexts/CartContext';
import { selectItemSubtotal } from '../contexts/cart';
import type { CartAction } from '../contexts/cart';
import { canReviewOrder } from '../contexts/orderReview';
import ComandaRedeem from './ComandaRedeem';

const priceFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatPrice = (cents: number) => priceFormatter.format(cents / 100);

interface CartDrawerProps {
  trigger: HTMLButtonElement | null;
  onClose: () => void;
  onReview: () => void;
  focusReview?: boolean;
}

export default function CartDrawer({ trigger, onClose, onReview, focusReview = false }: CartDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const comandaInputRef = useRef<HTMLInputElement>(null);
  const editComandaRef = useRef<HTMLButtonElement>(null);
  const reviewRef = useRef<HTMLButtonElement>(null);
  const backdropPressed = useRef(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [submittedAction, setSubmittedAction] = useState<CartAction | null>(null);
  const { state, dispatch, result, totalInCents, itemCount, comanda, setComanda } = useCart();
  const [comandaInput, setComandaInput] = useState(comanda ?? '');
  const [editingComanda, setEditingComanda] = useState(comanda === null);
  const [invalidComanda, setInvalidComanda] = useState(false);
  const rejected = submittedAction && result?.action === submittedAction && !result.accepted;

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    if (focusReview) reviewRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, [trigger, focusReview]);

  useLayoutEffect(() => {
    if (confirmingClear) confirmRef.current?.focus();
  }, [confirmingClear]);

  function isBackdrop(event: React.PointerEvent<HTMLDialogElement> | React.MouseEvent<HTMLDialogElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.target === event.currentTarget &&
      (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
  }

  function send(action: CartAction, removesFocusedControl = false) {
    if (removesFocusedControl) closeRef.current?.focus();
    setSubmittedAction(action);
    dispatch(action);
  }

  return (
    <dialog ref={dialogRef} className="cart-drawer" aria-labelledby="cart-drawer-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onPointerDown={(event) => { backdropPressed.current = isBackdrop(event); }}
      onClick={(event) => { if (backdropPressed.current && isBackdrop(event)) onClose(); backdropPressed.current = false; }}>
      <div className="cart-drawer-content">
        <div className="cart-drawer-heading">
          <div><p className="product-modal-category">Rústika Estúdio Bar</p><h2 id="cart-drawer-title">Seu carrinho</h2></div>
          <button ref={closeRef} className="product-modal-close" type="button" autoFocus onClick={onClose}>Fechar <span aria-hidden="true">×</span></button>
        </div>
        <p className="cart-reference-note">Valores de referência. Preço e estoque não são confirmados; esta demonstração não envia pedidos.</p>
        <ComandaRedeem />
        <section className="cart-comanda" aria-labelledby="cart-comanda-title">
          {editingComanda ? <>
          <h3 id="cart-comanda-title">Número da comanda</h3>
          <p id="cart-comanda-hint">Informe o número indicado na sua comanda. Nesta demonstração, use de 1 a 6 dígitos.</p>
          <form noValidate onSubmit={(event) => {
            event.preventDefault();
            if (setComanda(comandaInput)) {
              setComandaInput(comandaInput.trim());
              setInvalidComanda(false);
              setEditingComanda(false);
              requestAnimationFrame(() => editComandaRef.current?.focus());
            } else {
              setInvalidComanda(true);
            }
          }}>
            <label className="sr-only" htmlFor="cart-comanda-input">Número da comanda</label>
            <div className="cart-comanda-controls">
              <input ref={comandaInputRef} id="cart-comanda-input" type="text" inputMode="numeric" autoComplete="off" placeholder="Ex.: 10001" value={comandaInput} aria-describedby="cart-comanda-hint cart-comanda-feedback" aria-invalid={invalidComanda} onChange={(event) => { setComandaInput(event.target.value); setInvalidComanda(false); }} />
              <button className="cart-secondary-button" type="submit">Usar número</button>
              {comanda !== null && <button className="cart-secondary-button" type="button" onClick={() => { setComandaInput(comanda); setInvalidComanda(false); setEditingComanda(false); requestAnimationFrame(() => editComandaRef.current?.focus()); }}>Cancelar</button>}
            </div>
            <p id="cart-comanda-feedback" className="cart-comanda-feedback" role="status" aria-live="polite">{invalidComanda ? 'Informe de 1 a 6 dígitos, sem espaços entre eles. A comanda anterior e os itens foram mantidos.' : ''}</p>
          </form>
          </> : <div className="cart-comanda-summary">
            <h3 id="cart-comanda-title">Comanda nº {comanda}</h3>
            <button ref={editComandaRef} className="cart-secondary-button" type="button" onClick={() => { setComandaInput(comanda ?? ''); setEditingComanda(true); requestAnimationFrame(() => comandaInputRef.current?.focus()); }}>Alterar</button>
          </div>}
          <p className="cart-comanda-disclaimer">{comanda === null ? 'O número não é validado pelo estabelecimento.' : 'Comanda informada — ainda não validada pelo estabelecimento.'}</p>
        </section>
        {state.items.length === 0 ? <p className="cart-empty">Seu carrinho está vazio. Explore o cardápio para adicionar produtos.</p> : <>
          <ul className="cart-items">
            {state.items.map((item) => <li className="cart-item" key={item.product.id}>
              <div className="cart-item-heading"><h3>{item.product.name}</h3><button className="cart-remove" type="button" aria-label={`Remover ${item.product.name}`} onClick={() => send({ type: 'REMOVE_ITEM', productId: item.product.id }, true)}>Remover</button></div>
              <p className="cart-item-unit">{formatPrice(item.product.priceInCents)} / unidade</p>
              <div className="cart-item-bottom">
                <div className="cart-quantity" role="group" aria-label={`Quantidade de ${item.product.name}`}>
                  <button type="button" aria-label={`Diminuir quantidade de ${item.product.name}`} onClick={() => send({ type: 'DECREMENT', productId: item.product.id }, item.quantity === 1)}>−</button>
                  <span aria-live="polite" aria-atomic="true">{item.quantity}</span>
                  <button type="button" aria-label={`Aumentar quantidade de ${item.product.name}`} onClick={() => send({ type: 'INCREMENT', productId: item.product.id })}>+</button>
                </div>
                <p className="cart-item-subtotal"><span>Subtotal</span> <strong>{formatPrice(selectItemSubtotal(item))}</strong></p>
              </div>
            </li>)}
          </ul>
          <div className="cart-total"><span>Total · {itemCount} {itemCount === 1 ? 'unidade' : 'unidades'}</span><strong>{formatPrice(totalInCents)}</strong></div>
          {confirmingClear ? <div className="cart-clear-confirm" role="group" aria-labelledby="cart-clear-question">
            <p id="cart-clear-question">Esvaziar todo o carrinho?</p>
            <button ref={confirmRef} className="cart-primary-button" type="button" onClick={() => { send({ type: 'CLEAR_CART' }, true); setConfirmingClear(false); }}>Sim, esvaziar</button>
            <button className="cart-secondary-button" type="button" onClick={() => { setConfirmingClear(false); requestAnimationFrame(() => clearRef.current?.focus()); }}>Cancelar</button>
          </div> : <button ref={clearRef} className="cart-secondary-button cart-clear-button" type="button" onClick={() => setConfirmingClear(true)}>Esvaziar carrinho</button>}
        </>}
        {state.items.length === 0 ? <p className="cart-review-hint">Adicione pelo menos um produto{comanda === null ? ' e informe a comanda' : ''} para revisar o pedido.</p> : editingComanda ? <p className="cart-review-hint">Informe ou conclua a edição da comanda para revisar o pedido.</p> : canReviewOrder(state, comanda) ? <button ref={reviewRef} className="cart-primary-button cart-review-button" type="button" onClick={onReview}>Revisar pedido</button> : <p className="cart-review-hint">Confira os itens e informe uma comanda válida para revisar o pedido.</p>}
        <p className="cart-feedback" role="status" aria-live="polite">{rejected && 'Não foi possível alterar o carrinho. Verifique o limite de 99 unidades e os valores de referência.'}</p>
      </div>
    </dialog>
  );
}

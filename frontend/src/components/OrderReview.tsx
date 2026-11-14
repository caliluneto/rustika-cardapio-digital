import { useLayoutEffect, useRef } from 'react';
import { useCart } from '../contexts/CartContext';
import { comandaSessionUsable, orderSubmissionEnabled } from '../services/orderSubmission';
import { reviewNotice } from '../services/demoNotice';
import { selectItemSubtotal } from '../contexts/cart';

const priceFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatPrice = (cents: number) => priceFormatter.format(cents / 100);

interface OrderReviewProps {
  trigger: HTMLButtonElement | null;
  onBack: () => void;
  onContinue: () => void;
  /** Avança para o envio; o botão só aparece com sessão de comanda validada pelo backend. */
  onCheckout?: () => void;
}

export default function OrderReview({ trigger, onBack, onContinue, onCheckout }: OrderReviewProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const backdropPressed = useRef(false);
  const { state, comanda, comandaSession, totalInCents, itemCount } = useCart();
  const sessionReady = comandaSessionUsable(comandaSession) && comandaSession?.number === comanda;
  const canCheckout = Boolean(onCheckout && sessionReady && orderSubmissionEnabled());

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, [trigger]);

  function isBackdrop(event: React.PointerEvent<HTMLDialogElement> | React.MouseEvent<HTMLDialogElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.target === event.currentTarget &&
      (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
  }

  return <dialog ref={dialogRef} className="order-review" aria-labelledby="order-review-title"
    onCancel={(event) => { event.preventDefault(); onBack(); }}
    onPointerDown={(event) => { backdropPressed.current = isBackdrop(event); }}
    onClick={(event) => { if (backdropPressed.current && isBackdrop(event)) onBack(); backdropPressed.current = false; }}>
    <div className="order-review-content">
      <p className="product-modal-category">Rústika Estúdio Bar</p>
      <h2 id="order-review-title">Revisar pedido</h2>
      <p className="order-review-comanda">Comanda nº {comanda}</p>
      <p className="cart-reference-note">{reviewNotice(sessionReady, orderSubmissionEnabled())}</p>
      <ul className="order-review-items">
        {state.items.map((item) => <li key={item.product.id}>
          <h3>{item.product.name}</h3>
          <p>{item.quantity} × {formatPrice(item.product.priceInCents)} por unidade</p>
          <p>Subtotal: <strong>{formatPrice(selectItemSubtotal(item))}</strong></p>
        </li>)}
      </ul>
      <div className="cart-total"><span>Total · {itemCount} {itemCount === 1 ? 'unidade' : 'unidades'}</span><strong>{formatPrice(totalInCents)}</strong></div>
      <div className="order-review-actions">
        <button className="cart-primary-button" type="button" autoFocus onClick={onBack}>Voltar ao carrinho</button>
        {canCheckout && <button className="cart-primary-button" type="button" onClick={onCheckout}>Prosseguir para envio</button>}
        <button className="cart-secondary-button" type="button" onClick={onContinue}>Continuar explorando</button>
      </div>
    </div>
  </dialog>;
}

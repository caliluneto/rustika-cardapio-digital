import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useCart } from '../contexts/CartContext';
import { api } from '../services/api';
import type { OrderConfirmation } from '../services/api';
import { ApiError } from '../services/api';
import { buildOrderRequest, comandaSessionUsable, createOrderSubmitter, describeOrderError, orderSubmissionEnabled, requireUsableComandaSession } from '../services/orderSubmission';

const priceFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

interface CheckoutProps {
  trigger: HTMLButtonElement | null;
  onBack: () => void;
  onDone: () => void;
}

/** Etapa final: dados do cliente e envio com Idempotency-Key. Exige sessão de comanda validada. */
export default function Checkout({ trigger, onBack, onDone }: CheckoutProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { state, dispatch, comandaSession, setComandaSession, totalInCents } = useCart();
  // Shared attempt store: reopening this dialog keeps the pending Idempotency-Key.
  const submitter = useMemo(() => createOrderSubmitter(api), []);
  const enabled = orderSubmissionEnabled();
  const sessionUsable = comandaSessionUsable(comandaSession);
  const [customerName, setCustomerName] = useState('');
  const [tableOrReference, setTableOrReference] = useState('');
  const [notes, setNotes] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(submitter.uncertain);
  const [confirmation, setConfirmation] = useState<OrderConfirmation | null>(null);
  const [keptCart, setKeptCart] = useState(false);

  function handleFailure(err: unknown) {
    // The session cookie was refused: drop the local "active session" so the redeem form returns.
    if (err instanceof ApiError && err.status === 401 && err.code !== 'PENDING_ORDER_UNCERTAIN') setComandaSession(null);
    setUncertain(submitter.uncertain);
    setError(describeOrderError(err));
  }

  const handleRetryPending = async () => {
    if (!enabled || sending) return;
    setError(null);
    setSending(true);
    try {
      const result = await submitter.retryPending();
      setConfirmation(result);
      setKeptCart(true); // the confirmed order is the previous attempt; the edited cart is kept
    } catch (err: unknown) {
      handleFailure(err);
    } finally {
      setUncertain(submitter.uncertain);
      setSending(false);
    }
  };

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, [trigger]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!enabled || !sessionUsable || sending) return;
    setError(null);
    setSending(true);
    try {
      requireUsableComandaSession(comandaSession);
      const body = buildOrderRequest(state, { customerName, tableOrReference, notes });
      const result = await submitter.submit(body);
      setConfirmation(result);
      dispatch({ type: 'CLEAR_CART' }); // only after a confirmed order; failures keep the cart
    } catch (err: unknown) {
      handleFailure(err);
    } finally {
      setUncertain(submitter.uncertain);
      setSending(false);
    }
  };

  return <dialog ref={dialogRef} className="order-review" aria-labelledby="checkout-title"
    onCancel={(event) => { event.preventDefault(); if (!sending) (confirmation ? onDone : onBack)(); }}>
    <div className="order-review-content">
      <p className="product-modal-category">Rústika Estúdio Bar</p>
      <h2 id="checkout-title">{confirmation ? 'Pedido recebido' : 'Enviar pedido'}</h2>
      {confirmation ? <>
        <p role="status">Pedido nº <strong>{confirmation.orderNumber}</strong> registrado para a comanda {confirmation.comandaNumber}. Total confirmado pelo servidor: <strong>{priceFormatter.format(confirmation.totalInCents / 100)}</strong>.</p>
        {keptCart && <p className="cart-reference-note">Este é o pedido enviado anteriormente. Seu carrinho atual foi mantido; revise-o antes de enviar outro pedido.</p>}
        <div className="order-review-actions">
          <button className="cart-primary-button" type="button" autoFocus onClick={onDone}>Voltar ao cardápio</button>
        </div>
      </> : <>
        <p className="order-review-comanda">Comanda nº {comandaSession?.number ?? '—'}</p>
        {!enabled && <p className="cart-reference-note" role="note">O envio de pedidos está desativado neste ambiente. Ele será liberado após a validação com o banco de testes.</p>}
        {!sessionUsable && <p className="cart-reference-note" role="note">Resgate o convite da comanda no carrinho para habilitar o envio.</p>}
        {uncertain && <div className="cart-reference-note" role="note">
          <p>O último envio ficou sem confirmação. Reenvie o mesmo pedido: se ele já foi registrado, você receberá o mesmo número, sem duplicar.</p>
          <button className="cart-primary-button" type="button" disabled={!enabled || sending} onClick={handleRetryPending}>Reenviar pedido anterior</button>
        </div>}
        <form onSubmit={handleSubmit} className="admin-form">
          <div className="form-group">
            <label htmlFor="checkout-name">Seu nome</label>
            <input id="checkout-name" type="text" autoComplete="name" maxLength={120} value={customerName} onChange={(e) => setCustomerName(e.target.value)} required disabled={sending} />
          </div>
          <div className="form-group">
            <label htmlFor="checkout-table">Mesa ou referência (opcional)</label>
            <input id="checkout-table" type="text" maxLength={80} value={tableOrReference} onChange={(e) => setTableOrReference(e.target.value)} disabled={sending} />
          </div>
          <div className="form-group">
            <label htmlFor="checkout-notes">Observações (opcional)</label>
            <textarea id="checkout-notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={sending} />
          </div>
          <div className="cart-total"><span>Total de referência</span><strong>{priceFormatter.format(totalInCents / 100)}</strong></div>
          {error && <p className="admin-error" role="alert">{error}</p>}
          <div className="order-review-actions">
            <button className="cart-primary-button" type="submit" disabled={!enabled || !sessionUsable || sending || state.items.length === 0}>
              {sending ? 'Enviando...' : 'Enviar pedido'}
            </button>
            <button className="cart-secondary-button" type="button" disabled={sending} onClick={onBack}>Voltar à revisão</button>
          </div>
        </form>
      </>}
    </div>
  </dialog>;
}

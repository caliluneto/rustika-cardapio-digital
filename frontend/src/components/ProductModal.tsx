import { useLayoutEffect, useRef, useState } from 'react';
import type { Product } from '../types/catalog';
import { useCart } from '../contexts/CartContext';
import type { CartAction } from '../contexts/cart';
import { selectItemSubtotal } from '../contexts/cart';

const priceFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

interface ProductModalProps {
  product: Product;
  categoryName: string;
  trigger: HTMLButtonElement | null;
  onClose: () => void;
  onViewCart: () => void;
}

export default function ProductModal({ product, categoryName, trigger, onClose, onViewCart }: ProductModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const backdropPressed = useRef(false);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [submittedAction, setSubmittedAction] = useState<Extract<CartAction, { type: 'ADD_ITEM' }> | null>(null);
  const { dispatch, result, state } = useCart();
  const addResult = submittedAction && result?.action === submittedAction ? result : null;
  const addedItem = addResult?.accepted && submittedAction ? state.items.find((item) => item.product.id === submittedAction.product.id) : undefined;
  const addedQuantity = submittedAction?.quantity ?? 1;
  const imageUrl = product.imageUrl?.trim();
  const imageAlt = product.imageAlt?.trim() || product.name;
  const showImage = Boolean(imageUrl && imageUrl !== failedImageUrl);

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

  return (
    <dialog
      ref={dialogRef}
      className="product-modal"
      aria-labelledby="product-modal-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onPointerDown={(event) => { backdropPressed.current = isBackdrop(event); }}
      onClick={(event) => { if (backdropPressed.current && isBackdrop(event)) onClose(); backdropPressed.current = false; }}
    >
      <div className="product-modal-content">
        <div className="product-modal-top">
          <p className="product-modal-category">{categoryName}</p>
          <button className="product-modal-close" type="button" autoFocus onClick={onClose}>Fechar <span aria-hidden="true">×</span></button>
        </div>
        {showImage && <img className="product-modal-image" src={imageUrl} alt={imageAlt} width="640" height="400" onError={() => setFailedImageUrl(imageUrl ?? null)} />}
        <h2 id="product-modal-title">{product.name}</h2>
        <p className="product-modal-code"><span className="sr-only">Código de origem: </span><span aria-hidden="true">Cód. </span>{product.sourceCode}</p>
        {product.description && <p className="product-modal-description">{product.description}</p>}
        {product.ingredients && <div className="product-modal-ingredients"><h3>Ingredientes</h3><p>{product.ingredients}</p></div>}
        <div className="product-modal-price"><span>Preço</span><strong>{priceFormatter.format(product.priceInCents / 100)}</strong></div>
        {product.isAvailable === null && <p className="cart-reference-note">Disponibilidade não confirmada. Estoque e preço não são confirmados em tempo real.</p>}
        {product.isAvailable === undefined && <p className="cart-reference-note">Estoque e preço não são confirmados em tempo real.</p>}
        {product.isAvailable === false ? <p className="cart-reference-note">Produto indisponível para adicionar.</p> : (
          <form className="product-add-form" noValidate onSubmit={(event) => {
            event.preventDefault();
            const action: Extract<CartAction, { type: 'ADD_ITEM' }> = { type: 'ADD_ITEM', product, quantity: Number(quantity) };
            setSubmittedAction(action);
            dispatch(action);
          }}>
            <label htmlFor="product-quantity">Quantidade</label>
            <div className="product-add-controls">
              <input id="product-quantity" type="number" min="1" max="99" step="1" inputMode="numeric" value={quantity} onChange={(event) => { setQuantity(event.target.value); setSubmittedAction(null); }} />
              <button className="cart-primary-button" type="submit">Adicionar ao carrinho</button>
            </div>
          </form>
        )}
        <div className={`add-feedback ${addResult ? (addResult.accepted ? 'add-feedback--success' : 'add-feedback--error') : ''}`}>
          <div role="status" aria-live="polite" aria-atomic="true">
            {addResult && (addResult.accepted && addedItem ? <>
              <strong className="add-feedback-title">Adicionado ao carrinho!</strong>
              <p>{addedItem.product.name}</p>
              <p>{addedQuantity} {addedQuantity === 1 ? 'unidade' : 'unidades'} · {priceFormatter.format(selectItemSubtotal({ product: addedItem.product, quantity: addedQuantity }) / 100)} em referência</p>
            </> : <>
              <strong className="add-feedback-title">Não foi possível adicionar</strong>
              <p>Confira a quantidade, o limite de 99 unidades por produto e o preço de referência do item.</p>
            </>)}
          </div>
          {addResult?.accepted && addedItem && <button className="add-feedback-button" type="button" onClick={onViewCart}>Ver meu carrinho <span aria-hidden="true">→</span></button>}
        </div>
      </div>
    </dialog>
  );
}

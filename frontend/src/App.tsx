import Catalog from './components/Catalog';
import CatalogStatus from './components/CatalogStatus';
import ConnectionIndicator from './components/ConnectionIndicator';
import Header from './components/Header';
import CartDrawer from './components/CartDrawer';
import OrderReview from './components/OrderReview';
import Checkout from './pages/Checkout';
import OrderTracking from './components/OrderTracking';
import type { OrderConfirmation } from './services/api';
import { catalogMode, useCatalog } from './hooks/useCatalog';
import { CartProvider, useCart } from './contexts/CartContext';
import { canReviewOrder } from './contexts/orderReview';
import { orderSubmissionEnabled } from './services/orderSubmission';
import { catalogNotice } from './services/demoNotice';
import { useEffect, useRef, useState } from 'react';

export default function App() {
  return <CartProvider><AppContent /></CartProvider>;
}

function AppContent() {
  const [activeDialog, setActiveDialog] = useState<'product' | 'cart' | 'review' | 'checkout' | null>(null);
  const [focusReview, setFocusReview] = useState(false);
  const [trackedOrder, setTrackedOrder] = useState<OrderConfirmation | null>(null);
  const cartTriggerRef = useRef<HTMLButtonElement | null>(null);
  const { itemCount, state, comanda } = useCart();
  const { state: catalogState, retry } = useCatalog();
  const reviewReady = canReviewOrder(state, comanda);
  const catalogReady = catalogState.status === 'ready' && catalogState.data.products.length > 0;
  // RF004: o aviso acompanha a capacidade real do build, em vez de afirmar sempre que não há pedidos.
  const submissionEnabled = orderSubmissionEnabled();

  useEffect(() => {
    if (activeDialog === 'review' && !reviewReady) {
      setFocusReview(false);
      setActiveDialog('cart');
    }
  }, [activeDialog, reviewReady]);

  return (
    <div className="app-shell">
      <Header itemCount={itemCount} onOpenCart={(trigger) => { cartTriggerRef.current = trigger; setFocusReview(false); setActiveDialog('cart'); }} />
      <main>
        {catalogReady ? (
          <Catalog categories={catalogState.data.categories} products={catalogState.data.products} productDialogOpen={activeDialog === 'product'} onOpenProduct={() => setActiveDialog('product')} onCloseProduct={() => setActiveDialog(null)} onViewCart={(trigger) => { cartTriggerRef.current = trigger; setFocusReview(false); setActiveDialog('cart'); }} />
        ) : (
          <CatalogStatus state={catalogState} onRetry={retry} />
        )}
        <aside className="system-information container" aria-label="Informações do cardápio">
          <div className="demo-notice">
            <span className="demo-notice-icon" aria-hidden="true">i</span>
            <p><strong>Projeto acadêmico.</strong> {catalogNotice(catalogMode === 'demo' ? 'demo' : 'api', submissionEnabled)}</p>
          </div>
          <ConnectionIndicator />
          {trackedOrder && <OrderTracking initial={trackedOrder} />}
        </aside>
      </main>
      <footer className="site-footer container">
        <p className="footer-brand">Rústika <span>Estúdio Bar</span></p>
        <p>Cardápio Digital · UNAERP · Projeto acadêmico</p>
        <a href="#inicio">Voltar ao início <span aria-hidden="true">↑</span></a>
      </footer>
      {activeDialog === 'cart' && <CartDrawer trigger={cartTriggerRef.current} focusReview={focusReview} onClose={() => setActiveDialog(null)} onReview={() => { if (reviewReady) setActiveDialog('review'); }} />}
      {activeDialog === 'review' && reviewReady && <OrderReview trigger={cartTriggerRef.current} onBack={() => { setFocusReview(true); setActiveDialog('cart'); }} onContinue={() => setActiveDialog(null)} onCheckout={() => setActiveDialog('checkout')} />}
      {activeDialog === 'checkout' && <Checkout trigger={cartTriggerRef.current} onBack={() => setActiveDialog(reviewReady ? 'review' : 'cart')} onDone={() => setActiveDialog(null)} onConfirmed={setTrackedOrder} />}
    </div>
  );
}

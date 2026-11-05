import Catalog from './components/Catalog';
import CatalogStatus from './components/CatalogStatus';
import ConnectionIndicator from './components/ConnectionIndicator';
import Header from './components/Header';
import CartDrawer from './components/CartDrawer';
import OrderReview from './components/OrderReview';
import Checkout from './pages/Checkout';
import { catalogMode, useCatalog } from './hooks/useCatalog';
import { CartProvider, useCart } from './contexts/CartContext';
import { canReviewOrder } from './contexts/orderReview';
import { useEffect, useRef, useState } from 'react';

export default function App() {
  return <CartProvider><AppContent /></CartProvider>;
}

function AppContent() {
  const [activeDialog, setActiveDialog] = useState<'product' | 'cart' | 'review' | 'checkout' | null>(null);
  const [focusReview, setFocusReview] = useState(false);
  const cartTriggerRef = useRef<HTMLButtonElement | null>(null);
  const { itemCount, state, comanda } = useCart();
  const { state: catalogState, retry } = useCatalog();
  const reviewReady = canReviewOrder(state, comanda);
  const catalogReady = catalogState.status === 'ready' && catalogState.data.products.length > 0;

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
        <aside className="system-information container" aria-label="Informações desta demonstração">
          <div className="demo-notice">
            <span className="demo-notice-icon" aria-hidden="true">i</span>
            <p><strong>Projeto acadêmico.</strong> {catalogMode === 'demo' ? 'Produtos e preços vêm de uma cópia local da seleção aprovada do cadastro Rústika.' : 'Produtos e preços são carregados da API pública do catálogo Rústika.'} O cardápio não recebe pedidos nem confirma estoque, disponibilidade ou preços em tempo real.</p>
          </div>
          <ConnectionIndicator />
        </aside>
      </main>
      <footer className="site-footer container">
        <p className="footer-brand">Rústika <span>Estúdio Bar</span></p>
        <p>Cardápio Digital · UNAERP · Demonstração acadêmica local</p>
        <a href="#inicio">Voltar ao início <span aria-hidden="true">↑</span></a>
      </footer>
      {activeDialog === 'cart' && <CartDrawer trigger={cartTriggerRef.current} focusReview={focusReview} onClose={() => setActiveDialog(null)} onReview={() => { if (reviewReady) setActiveDialog('review'); }} />}
      {activeDialog === 'review' && reviewReady && <OrderReview trigger={cartTriggerRef.current} onBack={() => { setFocusReview(true); setActiveDialog('cart'); }} onContinue={() => setActiveDialog(null)} onCheckout={() => setActiveDialog('checkout')} />}
      {activeDialog === 'checkout' && <Checkout trigger={cartTriggerRef.current} onBack={() => setActiveDialog(reviewReady ? 'review' : 'cart')} onDone={() => setActiveDialog(null)} />}
    </div>
  );
}

import type { CatalogState } from '../services/catalogStore';

export default function CatalogStatus({ state, onRetry }: { state: CatalogState; onRetry: () => void }) {
  return <section className="catalog container" id="catalog" tabIndex={-1} aria-labelledby="catalog-title" aria-busy={state.status === 'loading'}>
    <h2 id="catalog-title">Nosso menu</h2>
    <div className="catalog-state" role={state.status === 'error' ? 'alert' : 'status'}>
      {state.status === 'loading' && <p>Carregando o cardápio…</p>}
      {state.status === 'error' && <><h3>Não foi possível carregar o cardápio</h3><p>{state.message}</p></>}
      {state.status === 'ready' && <p>Nenhum produto disponível no cardápio no momento.</p>}
    </div>
    {state.status !== 'loading' && <button className="cart-secondary-button" type="button" onClick={onRetry}>Tentar novamente</button>}
  </section>;
}

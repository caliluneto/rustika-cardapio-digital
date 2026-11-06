import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';
import {
  AVAILABILITY_LABEL, NO_FILTERS, categoriesOf, confirmationMessage, createAdminProductsClient, describeAvailabilityError,
  describeProductsListError, filterProducts, offeredTargets,
} from '../services/adminProducts';
import type { AdminProduct, AdminProductsClient, AdminProductsSnapshot, AvailabilityState, ProductFilters, SettableAvailability } from '../services/adminProducts';
import { formatBRL } from '../services/adminOrders';

export interface ProductNotice { kind: 'success' | 'error' | 'conflict'; text: string }
export interface ProductConfirming { productId: string; to: SettableAvailability }

export interface AdminProductsViewProps {
  loading: boolean;
  error: string | null;
  products: AdminProduct[];
  truncated: boolean;
  filters: ProductFilters;
  busyId: string | null;
  notice: ProductNotice | null;
  confirming: ProductConfirming | null;
  onFilters(next: ProductFilters): void;
  onRequest(productId: string, to: SettableAvailability): void;
  onConfirm(): void;
  onAbort(): void;
  onRefresh(): void;
}

const ACTION_LABEL: Record<SettableAvailability, string> = { AVAILABLE: 'Marcar como disponível', UNAVAILABLE: 'Marcar como indisponível' };
const FILTER_STATES: AvailabilityState[] = ['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN'];

/** Apresentação pura (sem efeitos): testável por renderização estática. */
export function AdminProductsView(props: AdminProductsViewProps) {
  const { loading, error, products, truncated, filters, busyId, notice, confirming } = props;
  const visible = filterProducts(products, filters);
  const categories = categoriesOf(products);
  return (
    <section className="admin-section admin-products" aria-labelledby="admin-products-title">
      <div className="admin-orders-head">
        <h3 id="admin-products-title">Produtos</h3>
        <button type="button" className="cart-secondary-button" onClick={props.onRefresh} disabled={loading}>Atualizar</button>
      </div>
      <p className="admin-orders-meta">Defina se cada produto pode ser pedido pelos clientes. Preço e cadastro não são alterados aqui.</p>

      <div className="admin-product-filters">
        <label>
          Buscar por nome ou código
          <input type="search" maxLength={80} value={filters.search} onChange={(event) => props.onFilters({ ...filters, search: event.target.value })} />
        </label>
        <label>
          Categoria
          <select value={filters.categoryId} onChange={(event) => props.onFilters({ ...filters, categoryId: event.target.value })}>
            <option value="">Todas</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label>
          Disponibilidade
          <select value={filters.availability} onChange={(event) => props.onFilters({ ...filters, availability: event.target.value as ProductFilters['availability'] })}>
            <option value="">Todas</option>
            {FILTER_STATES.map((state) => <option key={state} value={state}>{AVAILABILITY_LABEL[state]}</option>)}
          </select>
        </label>
      </div>

      {notice && (
        <div className={notice.kind === 'success' ? 'admin-success' : 'admin-error'} role={notice.kind === 'success' ? 'status' : 'alert'}>{notice.text}</div>
      )}
      {error && <div className="admin-error" role="alert">{error}</div>}
      {loading && products.length === 0 && !error && <p role="status">Carregando produtos…</p>}
      {!loading && !error && products.length === 0 && <p className="admin-orders-empty">Nenhum produto disponível para gerenciar.</p>}
      {!loading && products.length > 0 && visible.length === 0 && <p className="admin-orders-empty">Nenhum produto corresponde à busca ou aos filtros.</p>}
      {truncated && <p className="admin-orders-meta">Lista parcial: use a busca para localizar outros produtos.</p>}
      {products.length > 0 && <p className="admin-orders-meta" aria-live="polite">{visible.length} de {products.length} produtos{truncated ? ' carregados (lista parcial: existem mais produtos no servidor)' : ''}.</p>}

      <ul className="admin-product-list">
        {visible.map((product) => (
          <li key={product.id} className={`admin-product admin-product-${product.availabilityState.toLowerCase()}`} data-product-id={product.id}>
            <div className="admin-product-top">
              <strong>{product.name}</strong>
              <span className="admin-order-status" data-availability={product.availabilityState}>{AVAILABILITY_LABEL[product.availabilityState]}</span>
            </div>
            <div className="admin-order-meta">Código {product.sourceCode} · {product.categoryName} · {formatBRL(product.priceInCents)}</div>

            {confirming && confirming.productId === product.id ? (
              <div className="admin-order-confirm" role="group" aria-label="Confirmar mudança de disponibilidade">
                <p>{confirmationMessage(product, confirming.to)}</p>
                <button type="button" className="cart-primary-button" onClick={props.onConfirm} disabled={busyId !== null}>
                  {busyId === product.id ? 'Enviando…' : 'Confirmar'}
                </button>
                <button type="button" className="cart-secondary-button" onClick={props.onAbort} disabled={busyId !== null}>Voltar</button>
              </div>
            ) : (
              <div className="admin-order-actions">
                {offeredTargets(product.availabilityState).map((to) => (
                  <button
                    key={to} type="button" data-to-state={to}
                    className={to === 'UNAVAILABLE' ? 'cart-secondary-button' : 'cart-primary-button'}
                    onClick={() => props.onRequest(product.id, to)} disabled={busyId !== null || confirming !== null}
                  >
                    {ACTION_LABEL[to]}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Container: carga única + atualização controlada (botão e após cada mudança); a requisição é cancelada ao desmontar. */
export default function AdminProducts({ onUnauthorized, client }: { onUnauthorized: () => void; client?: AdminProductsClient }) {
  const productsClient = useMemo(() => client ?? createAdminProductsClient(api), [client]);
  const [snapshot, setSnapshot] = useState<AdminProductsSnapshot>({ products: [], truncated: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ProductFilters>(NO_FILTERS);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<ProductNotice | null>(null);
  const [confirming, setConfirming] = useState<ProductConfirming | null>(null);
  const controller = useRef<AbortController | null>(null);
  const unauthorized = useRef(onUnauthorized);
  unauthorized.current = onUnauthorized;

  const load = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    try {
      const data = await productsClient.list(current.signal);
      if (current.signal.aborted) return;
      setSnapshot(data); setError(null);
    } catch (failure) {
      if (current.signal.aborted) return;
      const described = describeProductsListError(failure);
      setError(described.message);
      if (described.unauthorized) unauthorized.current();
    } finally {
      if (!current.signal.aborted) setLoading(false);
    }
  }, [productsClient]);

  useEffect(() => {
    void load();
    return () => { controller.current?.abort(); controller.current = null; };
  }, [load]);

  const onRequest = useCallback((productId: string, to: SettableAvailability) => { setNotice(null); setConfirming({ productId, to }); }, []);

  const onConfirm = useCallback(async () => {
    if (!confirming || busyId !== null) return;
    const product = snapshot.products.find((entry) => entry.id === confirming.productId);
    if (!product) { setConfirming(null); return; }
    setBusyId(product.id); setNotice(null);
    try {
      await productsClient.updateAvailability(product.id, { expectedState: product.availabilityState, toState: confirming.to });
      setNotice({ kind: 'success', text: `${product.name}: ${AVAILABILITY_LABEL[product.availabilityState]} → ${AVAILABILITY_LABEL[confirming.to]}.` });
      setConfirming(null);
      await load();
    } catch (failure) {
      const described = describeAvailabilityError(failure);
      if (described.unauthorized) { unauthorized.current(); return; }
      setNotice({ kind: described.conflict ? 'conflict' : 'error', text: described.message });
      setConfirming(null);
      if (described.conflict) await load();
    } finally {
      setBusyId(null);
    }
  }, [confirming, busyId, snapshot.products, productsClient, load]);

  return (
    <AdminProductsView
      loading={loading} error={error} products={snapshot.products} truncated={snapshot.truncated} filters={filters}
      busyId={busyId} notice={notice} confirming={confirming}
      onFilters={setFilters} onRequest={onRequest} onConfirm={() => { void onConfirm(); }}
      onAbort={() => setConfirming(null)} onRefresh={() => { void load(); }}
    />
  );
}

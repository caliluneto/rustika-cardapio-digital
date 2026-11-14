import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';
import {
  AVAILABILITY_LABEL, NO_FILTERS, categoriesOf, confirmationMessage, createAdminProductsClient, describeAvailabilityError,
  describeProductsListError, filterProducts, offeredTargets,
} from '../services/adminProducts';
import { formatBRL } from '../services/adminOrders';
import type { AdminProduct, AdminProductsClient, AdminProductsSnapshot, AvailabilityState, ProductFilters, SettableAvailability } from '../services/adminProducts';

export interface ProductNotice { kind: 'success' | 'error' | 'conflict'; text: string }
export interface ProductConfirming { productId: string; to: SettableAvailability }

export interface ProductFormData {
  name: string;
  description: string;
  ingredients: string;
  priceInCents: number;
  categoryId: string;
  imageUrl: string;
  imageAlt: string;
}

export interface AdminProductsViewProps {
  loading: boolean;
  error: string | null;
  products: AdminProduct[];
  truncated: boolean;
  filters: ProductFilters;
  busyId: string | null;
  notice: ProductNotice | null;
  confirming: ProductConfirming | null;
  busyProductId: string | null;
  formOpen: boolean;
  formMode: 'create' | 'edit';
  form: ProductFormData;
  formCategoryOptions: Array<{ id: string; name: string }>;
  formError: string | null;
  onFilters(next: ProductFilters): void;
  onRequest(productId: string, to: SettableAvailability): void;
  onConfirm(): void;
  onAbort(): void;
  onRefresh(): void;
  onOpenCreateForm(): void;
  onOpenEditForm(product: AdminProduct): void;
  onCloseForm(): void;
  onFormChange(field: keyof ProductFormData, value: string | number): void;
  onFormSubmit(): void;
  onDeleteProduct(productId: string): void;
  onRefreshCatalog(): void;
}

const FILTER_STATES: AvailabilityState[] = ['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN'];
const MAX_PRICE_IN_CENTS = 99_999_999;

/** Apresentação pura (sem efeitos): testável por renderização estática. */
export function AdminProductsView(props: AdminProductsViewProps) {
  const {
    loading, error, products, truncated, filters, busyId, notice, confirming,
    busyProductId, formOpen, formMode, form, formCategoryOptions, formError,
  } = props;
  const visible = filterProducts(products, filters);
  const categories = categoriesOf(products);
  const isEdit = formMode === 'edit';
  return (
    <section className="admin-section admin-products" aria-labelledby="admin-products-title">
      <div className="admin-orders-head">
        <h3 id="admin-products-title">Produtos</h3>
        <div className="admin-head-actions">
          <button type="button" className="cart-primary-button" onClick={props.onOpenCreateForm} disabled={loading} aria-label="Novo produto">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            Novo produto
          </button>
          <button type="button" className="cart-secondary-button" onClick={props.onRefreshCatalog} disabled={loading} aria-label="Atualizar catálogo público">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
            Atualizar catálogo
          </button>
        </div>
      </div>
      <p className="admin-orders-meta">Cadastro: nome, descrição, ingredientes, preço, categoria e imagem. Identificadores de origem são gerados pelo sistema.</p>

      {/* Formulário de cadastro/edição */}
      {formOpen && (
        <div className="admin-product-form" role="dialog" aria-modal="true" aria-label={isEdit ? 'Editar produto' : 'Novo produto'}>
          <div className="admin-product-form-header">
            <h4>{isEdit ? 'Editar produto' : 'Novo produto'}</h4>
            <button type="button" className="cart-secondary-button" onClick={props.onCloseForm} aria-label="Fechar formulário">×</button>
          </div>
          {formError && <div className="admin-error" role="alert">{formError}</div>}
          <form onSubmit={(event) => { event.preventDefault(); props.onFormSubmit(); }}>
            <div className="admin-form-grid">
              <div className="admin-form-field">
                <label>Nome do produto <span className="required">*</span></label>
                <input type="text" maxLength={200} required value={form.name}
                  onChange={(e) => props.onFormChange('name', e.target.value)} />
              </div>
              <div className="admin-form-field">
                <label>Categoria <span className="required">*</span></label>
                <select required value={form.categoryId}
                  onChange={(e) => props.onFormChange('categoryId', e.target.value)}>
                  <option value="">Selecione uma categoria</option>
                  {formCategoryOptions.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </div>
              <div className="admin-form-field">
                <label>Preço (centavos) <span className="required">*</span></label>
                <input type="number" min={1} max={MAX_PRICE_IN_CENTS} required value={form.priceInCents}
                  onChange={(e) => props.onFormChange('priceInCents', Number(e.target.value))} />
                <span className="admin-form-hint">Inteiro entre 1 e {MAX_PRICE_IN_CENTS.toLocaleString('pt-BR')}. Sem arredondamento.</span>
              </div>
              <div className="admin-form-field">
                <label>Descrição</label>
                <textarea maxLength={1000} value={form.description}
                  onChange={(e) => props.onFormChange('description', e.target.value)} />
              </div>
              <div className="admin-form-field">
                <label>Ingredientes</label>
                <textarea maxLength={1000} value={form.ingredients}
                  onChange={(e) => props.onFormChange('ingredients', e.target.value)} />
              </div>
              <div className="admin-form-field">
                <label>URL da imagem</label>
                <input type="url" value={form.imageUrl}
                  onChange={(e) => props.onFormChange('imageUrl', e.target.value)} />
              </div>
              <div className="admin-form-field">
                <label>Texto alternativo da imagem</label>
                <input type="text" maxLength={200} value={form.imageAlt}
                  onChange={(e) => props.onFormChange('imageAlt', e.target.value)} />
              </div>
            </div>
            <div className="admin-form-actions">
              <button type="button" className="cart-secondary-button" onClick={props.onCloseForm}>Cancelar</button>
              <button type="submit" className="cart-primary-button" disabled={busyId !== null}>
                {isEdit ? 'Salvar alterações' : 'Criar produto'}
              </button>
            </div>
          </form>
        </div>
      )}

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

      {busyProductId && (
        <div className="admin-product-busy" role="status">
          <span>Processando {busyProductId}…</span>
        </div>
      )}

      <ul className="admin-product-list">
        {visible.map((product) => (
          <li
            key={product.id}
            className={`admin-product admin-product-${product.availabilityState.toLowerCase()}`}
            data-product-id={product.id}
          >
            <div className="admin-product-top">
              <strong>{product.name}</strong>
              <span className="admin-order-status" data-availability={product.availabilityState}>{AVAILABILITY_LABEL[product.availabilityState]}</span>
            </div>
            <div className="admin-order-meta">
              Código {product.sourceCode} · {product.categoryName} · {formatBRL(product.priceInCents)}
            </div>

            {confirming && confirming.productId === product.id ? (
              <div className="admin-order-confirm" role="group" aria-label="Confirmar mudança de disponibilidade">
                <p>{confirmationMessage(product, confirming.to)}</p>
                <button type="button" className="cart-primary-button" onClick={props.onConfirm} disabled={busyId !== null}>
                  {busyId === product.id ? 'Enviando…' : 'Confirmar'}
                </button>
                <button type="button" className="cart-secondary-button" onClick={props.onAbort} disabled={busyId !== null}>Voltar</button>
              </div>
            ) : (
              <div className="admin-product-actions-row">
                {offeredTargets(product.availabilityState).map((target) => (
                  <button
                    key={target}
                    type="button"
                    className="cart-secondary-button"
                    data-to-state={target}
                    onClick={() => props.onRequest(product.id, target)}
                    disabled={busyId !== null || confirming !== null}
                  >
                    Marcar como {AVAILABILITY_LABEL[target].toLowerCase()}
                  </button>
                ))}
                <button
                  type="button"
                  className="cart-secondary-button"
                  onClick={() => props.onOpenEditForm(product)}
                  disabled={busyId !== null || confirming !== null}
                  aria-label="Editar produto"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5l-7 9L19 7l-5.5 8.5L2 21l7-9z"/>
                  </svg>
                  Editar
                </button>

                <button
                  type="button"
                  className="cart-danger-button"
                  onClick={() => props.onDeleteProduct(product.id)}
                  disabled={busyId !== null || confirming !== null}
                  aria-label="Excluir produto"
                  style={{ marginLeft: '8px' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4"/>
                  </svg>
                  Excluir
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Container: carga única + atualização controlada; requisição cancelada ao desmontar. */
export default function AdminProducts({ onUnauthorized, client }: { onUnauthorized: () => void; client?: AdminProductsClient }) {
  const productsClient = useMemo(() => client ?? createAdminProductsClient(api), [client]);
  const [snapshot, setSnapshot] = useState<AdminProductsSnapshot>({ products: [], truncated: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ProductFilters>(NO_FILTERS);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<ProductNotice | null>(null);
  const [confirming, setConfirming] = useState<ProductConfirming | null>(null);
  const [busyProductId, setBusyProductId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [formProductId, setFormProductId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductFormData>({
    name: '', description: '', ingredients: '', priceInCents: 0,
    categoryId: '', imageUrl: '', imageAlt: '',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [formCategoryOptions, setFormCategoryOptions] = useState<Array<{ id: string; name: string }>>([]);
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
    } catch (failure: any) {
      const described = describeAvailabilityError(failure);
      if (described.unauthorized) { unauthorized.current(); return; }
      setNotice({ kind: described.conflict ? 'conflict' : 'error', text: described.message });
      setConfirming(null);
      if (described.conflict) await load();
    } finally {
      setBusyId(null);
    }
  }, [confirming, busyId, snapshot.products, productsClient, load]);

  // Carregar categorias para o formulário
  useEffect(() => {
    const updateCategories = async () => {
      try {
        const { products } = await productsClient.list();
        const seen = new Map<string, string>();
        for (const product of products) {
          if (!seen.has(product.categoryId)) seen.set(product.categoryId, product.categoryName);
        }
        setFormCategoryOptions([...seen.entries()].map(([id, name]) => ({ id, name })));
      } catch {
        // Ignorar erro de carregamento de categorias
      }
    };
    updateCategories();
  }, [productsClient]);

  const onOpenCreateForm = useCallback(() => {
    setForm({ name: '', description: '', ingredients: '', priceInCents: 0, categoryId: '', imageUrl: '', imageAlt: '' });
    setFormMode('create');
    setFormProductId(null);
    setFormError(null);
    setFormOpen(true);
  }, []);

  const onOpenEditForm = useCallback((product: AdminProduct) => {
    setForm({
      name: product.name,
      description: product.description ?? '',
      ingredients: product.ingredients ?? '',
      priceInCents: product.priceInCents,
      categoryId: product.categoryId,
      imageUrl: product.imageUrl ?? '',
      imageAlt: product.imageAlt ?? '',
    });
    setFormMode('edit');
    setFormProductId(product.id);
    setFormError(null);
    setFormOpen(true);
  }, []);

  const onCloseForm = useCallback(() => {
    setFormOpen(false);
    setFormMode('create');
    setFormProductId(null);
    setFormError(null);
  }, []);

  const onFormChange = useCallback((field: keyof ProductFormData, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFormError(null);
  }, []);

  const MAX_PRICE = MAX_PRICE_IN_CENTS;

  const validateForm = (data: ProductFormData): string | null => {
    if (!data.name.trim()) return 'Nome é obrigatório.';
    if (!data.categoryId) return 'Categoria é obrigatória.';
    if (typeof data.priceInCents !== 'number' || !Number.isInteger(data.priceInCents) || data.priceInCents <= 0 || data.priceInCents > MAX_PRICE) {
      return `Preço deve ser um número inteiro entre 1 e ${MAX_PRICE.toLocaleString('pt-BR')} centavos.`;
    }
    return null;
  };

  const onFormSubmit = useCallback(async () => {
    const validationError = validateForm(form);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setFormError(null);
    setNotice(null);

    try {
      if (formMode === 'create') {
        await productsClient.create({
          name: form.name,
          description: form.description,
          ingredients: form.ingredients,
          priceInCents: form.priceInCents,
          categoryId: form.categoryId,
          imageUrl: form.imageUrl,
          imageAlt: form.imageAlt,
        });
        setNotice({ kind: 'success', text: `Produto "${form.name}" criado com sucesso.` });
        onCloseForm();
        await load();
      } else if (formMode === 'edit' && formProductId) {
        const updateData: Record<string, unknown> = {};
        updateData.name = form.name;
        updateData.description = form.description;
        updateData.ingredients = form.ingredients;
        updateData.priceInCents = form.priceInCents;
        updateData.imageUrl = form.imageUrl;
        updateData.imageAlt = form.imageAlt;

        await productsClient.update(formProductId, updateData);
        setNotice({ kind: 'success', text: 'Produto atualizado com sucesso.' });
        onCloseForm();
        await load();
      }
    } catch (failure: any) {
      const code = failure?.status ?? failure?.code ?? 'UNKNOWN';
      if (code === 409) {
        setFormError(failure?.message ?? 'Conflito: já existe um produto com este nome nesta categoria.');
      } else if (code === 400) {
        setFormError(failure?.message ?? 'Erro de validação. Verifique os campos.');
      } else if (code === 401) {
        setNotice({ kind: 'error', text: 'Sessão administrativa expirada. Faça login novamente.' });
        unauthorized.current();
      } else {
        setFormError(failure?.message ?? 'Não foi possível concluir a operação. Tente novamente.');
      }
    }
  }, [form, formMode, formProductId, load, productsClient, unauthorized, onCloseForm]);

  const onDeleteProduct = useCallback(async (productId: string) => {
    if (!window.confirm(`Tem certeza que deseja excluir este produto?\nIsso não afetará o histórico dos pedidos, mas o produto deixará de estar disponível para novos pedidos.`)) {
      return;
    }
    setBusyProductId(productId);
    setNotice(null);
    try {
      await productsClient.httpDelete(productId);
      setNotice({ kind: 'success', text: 'Produto excluído com sucesso.' });
      setFormOpen(false);
      await load();
    } catch (failure: any) {
      const code = failure?.status ?? failure?.code ?? 'UNKNOWN';
      if (code === 409) {
        setNotice({ kind: 'conflict', text: failure?.message ?? 'Não é possível excluir este produto: ele está referenciado em pedidos existentes.' });
      } else if (code === 401) {
        setNotice({ kind: 'error', text: 'Sessão administrativa expirada.' });
        unauthorized.current();
      } else {
        setNotice({ kind: 'error', text: failure?.message ?? 'Não foi possível excluir o produto. Tente novamente.' });
      }
    } finally {
      setBusyProductId(null);
    }
  }, [productsClient, load, unauthorized]);

  const onRefreshCatalog = useCallback(async () => {
    try {
      await load();
      setNotice({ kind: 'success', text: 'Catálogo público atualizado com sucesso.' });
    } catch {
      setNotice({ kind: 'error', text: 'Não foi possível atualizar o catálogo público.' });
    }
  }, [load]);

  return (
    <AdminProductsView
      loading={loading} error={error} products={snapshot.products} truncated={snapshot.truncated} filters={filters}
      busyId={busyId} notice={notice} confirming={confirming} busyProductId={busyProductId}
      formOpen={formOpen} formMode={formMode} form={form} formCategoryOptions={formCategoryOptions} formError={formError}
      onFilters={setFilters} onRequest={onRequest} onConfirm={() => { void onConfirm(); }}
      onAbort={() => setConfirming(null)} onRefresh={() => { void load(); }}
      onOpenCreateForm={onOpenCreateForm}
      onOpenEditForm={onOpenEditForm}
      onCloseForm={onCloseForm}
      onFormChange={onFormChange}
      onFormSubmit={onFormSubmit}
      onDeleteProduct={onDeleteProduct}
      onRefreshCatalog={onRefreshCatalog}
    />
  );
}

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../services/api';

interface AdminCategory {
  publicKey: string;
  name: string;
  description: string | null;
  displayOrder: number;
  isActive: boolean;
}

export default function AdminCategories({ onUnauthorized, onChanged }: {
  onUnauthorized: () => void; onChanged: () => void;
}) {
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [displayOrder, setDisplayOrder] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try { setCategories(await api.getWithAuth<AdminCategory[]>('/admin/categories', signal)); }
    catch (cause) {
      if (signal?.aborted) return;
      if (cause instanceof ApiError && cause.status === 401) onUnauthorized();
      else setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as categorias.');
    }
  }, [onUnauthorized]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function edit(category: AdminCategory) {
    setEditing(category.publicKey);
    setName(category.name);
    setDescription(category.description ?? '');
    setDisplayOrder(String(category.displayOrder));
    setError(null); setNotice(null);
  }
  function clear() {
    setEditing(null); setName(''); setDescription(''); setDisplayOrder('0');
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null); setNotice(null);
    const order = Number(displayOrder);
    if (!name.trim() || !Number.isSafeInteger(order) || order < 0 || order > 9999) {
      setError('Informe nome e ordem inteira entre 0 e 9999.'); return;
    }
    setBusy(true);
    try {
      const body = { name: name.trim(), description: description.trim() || null, displayOrder: order };
      if (editing) await api.patch(`/admin/categories/${encodeURIComponent(editing)}`, body);
      else await api.post('/admin/categories', body);
      clear();
      await load();
      onChanged();
      setNotice('Categoria salva no banco.');
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) onUnauthorized();
      else setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a categoria.');
    } finally { setBusy(false); }
  }

  return (
    <section className="admin-section admin-categories" aria-label="Gerenciar categorias">
      <h3>Categorias ({categories.length})</h3>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {notice && <p className="admin-success" role="status">{notice}</p>}
      <form className="admin-form" onSubmit={(event) => void submit(event)}>
        <div className="form-group">
          <label htmlFor="admin-category-name">Nome</label>
          <input id="admin-category-name" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={100} disabled={busy} />
        </div>
        <div className="form-group">
          <label htmlFor="admin-category-description">Descrição</label>
          <input id="admin-category-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} disabled={busy} />
        </div>
        <div className="form-group">
          <label htmlFor="admin-category-order">Ordem de exibição</label>
          <input id="admin-category-order" type="number" min="0" max="9999" step="1" value={displayOrder} onChange={(event) => setDisplayOrder(event.target.value)} required disabled={busy} />
        </div>
        <button type="submit" className="cart-primary-button" disabled={busy}>{busy ? 'Salvando…' : editing ? 'Salvar categoria' : 'Cadastrar categoria'}</button>
        {editing && <button type="button" className="cart-secondary-button" onClick={clear} disabled={busy}>Cancelar edição</button>}
      </form>
      <ul className="admin-category-list">
        {categories.map((category) => <li key={category.publicKey} data-category-key={category.publicKey}>
          <span>{category.name} · ordem {category.displayOrder}</span>{' '}
          <button type="button" className="cart-secondary-button" onClick={() => edit(category)} disabled={busy} aria-label={`Editar categoria ${category.name}`}>Editar</button>
        </li>)}
      </ul>
    </section>
  );
}

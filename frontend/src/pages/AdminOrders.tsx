import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api';
import {
  ORDERS_POLL_INTERVAL_MS, ORDER_STATUS_LABEL, canOfferTransition, confirmationMessage, createAdminOrdersClient,
  createNewOrderTracker, describeListError, describeNewOrders, describeStatusError, formatBRL,
} from '../services/adminOrders';
import type { AdminOrder, AdminOrdersClient, AdminOrdersSnapshot, OrderStatus } from '../services/adminOrders';
import { createOrdersPoller } from '../services/adminOrdersPolling';

export interface Notice { kind: 'success' | 'error' | 'conflict'; text: string }
export interface Confirming { orderId: string; toStatus: OrderStatus }

export interface AdminOrdersViewProps {
  loading: boolean;
  error: string | null;
  orders: AdminOrder[];
  truncated: boolean;
  nextCursor: string | null;
  filter: OrderStatus | '';
  loadingMore: boolean;
  updatedAt: Date | null;
  newOrderCount: number;
  busyId: string | null;
  notice: Notice | null;
  confirming: Confirming | null;
  cancelNote: string;
  onRequest(orderId: string, toStatus: OrderStatus): void;
  onConfirm(): void;
  onAbort(): void;
  onCancelNote(value: string): void;
  onRefresh(): void;
  onFilter(value: OrderStatus | ''): void;
  onShowNewOrders(): void;
  onLoadMore(): void;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const ACTION_LABEL: Record<OrderStatus, string> = {
  RECEIVED: 'Marcar como recebido',
  IN_PREPARATION: 'Iniciar preparo',
  READY: 'Marcar como pronto',
  DELIVERED: 'Marcar como entregue',
  CANCELLED: 'Cancelar pedido',
};

/** Apresentação pura (sem efeitos): testável por renderização estática. */
export function AdminOrdersView(props: AdminOrdersViewProps) {
  const { loading, error, orders, truncated, nextCursor, filter, loadingMore, updatedAt, newOrderCount, busyId, notice, confirming, cancelNote } = props;
  return (
    <section className="admin-section admin-orders" aria-labelledby="admin-orders-title">
      <div className="admin-orders-head">
        <h3 id="admin-orders-title">Pedidos</h3>
        <button type="button" className="cart-secondary-button" onClick={props.onRefresh} disabled={loading}>Atualizar</button>
      </div>
      <label className="admin-orders-filter">
        Filtrar por status
        <select value={filter} onChange={(event) => props.onFilter(event.target.value as OrderStatus | '')} disabled={loading}>
          <option value="">Todos</option>
          {Object.entries(ORDER_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <p className="admin-orders-meta" aria-live="off">
        {updatedAt ? `Atualizado às ${updatedAt.toLocaleTimeString('pt-BR')} (a lista atualiza sozinha).` : 'Aguardando a primeira atualização.'}
      </p>

      {newOrderCount > 0 && (
        <div className="admin-orders-new" role="alert">
          <span>{describeNewOrders(newOrderCount)}</span>
          <button type="button" className="cart-primary-button" onClick={props.onShowNewOrders}>Ver novos pedidos</button>
        </div>
      )}

      {notice && (
        <div className={notice.kind === 'success' ? 'admin-success' : 'admin-error'} role={notice.kind === 'success' ? 'status' : 'alert'}>{notice.text}</div>
      )}
      {error && <div className="admin-error" role="alert">{error}</div>}
      {loading && orders.length === 0 && !error && <p role="status">Carregando pedidos…</p>}
      {!loading && !error && orders.length === 0 && <p className="admin-orders-empty">Nenhum pedido encontrado.</p>}

      <ul className="admin-order-list">
        {orders.map((order) => (
          <li key={order.id} className={`admin-order admin-order-${order.status.toLowerCase()}`}>
            <div className="admin-order-top">
              <strong>Pedido #{order.orderNumber}</strong>
              <span className="admin-order-status">{ORDER_STATUS_LABEL[order.status]}</span>
            </div>
            <div className="admin-order-meta">
              Comanda {order.comandaNumber}
              {order.customerName ? ` · ${order.customerName}` : ''}
              {order.tableOrReference ? ` · ${order.tableOrReference}` : ''}
              {` · recebido às ${time(order.createdAt)} · atualizado às ${time(order.updatedAt)}`}
            </div>
            <ul className="admin-order-items">
              {order.items.map((item, index) => (
                <li key={`${order.id}-${index}`}>
                  {item.quantity}× {item.productNameSnapshot} <span>{formatBRL(item.subtotalInCents)}</span>
                  {item.notes ? <em> — {item.notes}</em> : null}
                </li>
              ))}
            </ul>
            {order.notes ? <p className="admin-order-note">Observação: {order.notes}</p> : null}
            <div className="admin-order-total">Total {formatBRL(order.totalInCents)}</div>
            <details className="admin-order-history">
              <summary>Histórico ({order.history.length})</summary>
              <ol>
                {order.history.map((entry, index) => (
                  <li key={`${entry.createdAt}-${index}`}>
                    {entry.fromStatus ? `${ORDER_STATUS_LABEL[entry.fromStatus]} → ` : ''}{ORDER_STATUS_LABEL[entry.toStatus]}
                    {` · ${new Date(entry.createdAt).toLocaleString('pt-BR')}`}
                    {entry.actorName ? ` · ${entry.actorName}` : ' · sistema'}
                    {entry.notes ? ` · ${entry.notes}` : ''}
                  </li>
                ))}
              </ol>
            </details>

            {confirming && confirming.orderId === order.id ? (
              <div className="admin-order-confirm" role="group" aria-label="Confirmar mudança de status">
                <p>{confirmationMessage(order, confirming.toStatus)}</p>
                {confirming.toStatus === 'CANCELLED' && (
                  <label>
                    Motivo (opcional)
                    <input type="text" maxLength={300} value={cancelNote} onChange={(event) => props.onCancelNote(event.target.value)} disabled={busyId !== null} />
                  </label>
                )}
                <button type="button" className="cart-primary-button" onClick={props.onConfirm} disabled={busyId !== null}>
                  {busyId === order.id ? 'Enviando…' : 'Confirmar'}
                </button>
                <button type="button" className="cart-secondary-button" onClick={props.onAbort} disabled={busyId !== null}>Voltar</button>
              </div>
            ) : (
              <div className="admin-order-actions">
                {order.allowedTransitions.length === 0 && <small>Pedido finalizado.</small>}
                {order.allowedTransitions.filter((to) => canOfferTransition(order, to)).map((to) => (
                  <button
                    key={to} type="button" data-to-status={to}
                    className={to === 'CANCELLED' ? 'cart-secondary-button' : 'cart-primary-button'}
                    onClick={() => props.onRequest(order.id, to)} disabled={busyId !== null || confirming !== null}
                  >
                    {ACTION_LABEL[to]}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      {truncated && nextCursor && (
        <button type="button" className="cart-secondary-button" onClick={props.onLoadMore} disabled={loadingMore}>
          {loadingMore ? 'Carregando…' : 'Carregar pedidos anteriores'}
        </button>
      )}
    </section>
  );
}

/** Container: polling moderado (sem sobreposição, interrompido na desmontagem) + atualização de status. */
export default function AdminOrders({ onUnauthorized, client }: { onUnauthorized: () => void; client?: AdminOrdersClient }) {
  const ordersClient = useMemo(() => client ?? createAdminOrdersClient(api), [client]);
  const [snapshot, setSnapshot] = useState<AdminOrdersSnapshot>({ orders: [], truncated: false, nextCursor: null });
  const [filter, setFilter] = useState<OrderStatus | ''>('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [cancelNote, setCancelNote] = useState('');
  const pollerRef = useRef<ReturnType<typeof createOrdersPoller<AdminOrdersSnapshot>> | null>(null);
  const unauthorized = useRef(onUnauthorized);
  const newOrderTracker = useRef(createNewOrderTracker());
  const [newOrders, setNewOrders] = useState<AdminOrder[]>([]);
  unauthorized.current = onUnauthorized;

  useEffect(() => {
    const poller = createOrdersPoller<AdminOrdersSnapshot>({
      load: (signal) => ordersClient.list(filter ? { status: filter } : {}, signal),
      onData: (data) => {
        setSnapshot(data); setError(null); setUpdatedAt(new Date()); setLoading(false);
      },
      onError: (failure) => {
        const described = describeListError(failure);
        setLoading(false);
        setError(described.message);
        if (described.unauthorized) unauthorized.current();
      },
      shouldStop: (failure) => describeListError(failure).unauthorized,
      intervalMs: ORDERS_POLL_INTERVAL_MS,
    });
    pollerRef.current = poller;
    poller.start();
    return () => { poller.stop(); pollerRef.current = null; };
  }, [ordersClient, filter]);

  // Vigia independente do filtro: consulta sempre os pedidos mais recentes e avisa uma única vez por pedido.
  // A primeira carga apenas registra a linha de base; mudar o filtro não reinicia nem dispara o aviso.
  useEffect(() => {
    const watcher = createOrdersPoller<AdminOrdersSnapshot>({
      load: (signal) => ordersClient.list({ limit: 20 }, signal),
      onData: (data) => {
        const fresh = newOrderTracker.current.observe(data.orders);
        if (fresh.length === 0) return;
        setNewOrders((current) => {
          const known = new Set(current.map((order) => order.id));
          return [...current, ...fresh.filter((order) => !known.has(order.id))];
        });
      },
      onError: (failure) => { if (describeListError(failure).unauthorized) unauthorized.current(); },
      shouldStop: (failure) => describeListError(failure).unauthorized,
      intervalMs: ORDERS_POLL_INTERVAL_MS,
    });
    watcher.start();
    return () => { watcher.stop(); };
  }, [ordersClient]);

  const onFilter = useCallback((value: OrderStatus | '') => {
    setSnapshot({ orders: [], truncated: false, nextCursor: null });
    setLoading(true);
    setFilter(value);
  }, []);

  const onShowNewOrders = useCallback(() => {
    setNewOrders([]);
    if (filter !== '') setFilter('');
    else pollerRef.current?.refresh();
  }, [filter]);

  const onLoadMore = useCallback(async () => {
    if (!snapshot.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await ordersClient.list({ ...(filter ? { status: filter } : {}), cursor: snapshot.nextCursor });
      setSnapshot((current) => {
        const ids = new Set(current.orders.map((order) => order.id));
        return { ...page, orders: [...current.orders, ...page.orders.filter((order) => !ids.has(order.id))] };
      });
    } catch (failure) {
      const described = describeListError(failure);
      setError(described.message);
      if (described.unauthorized) unauthorized.current();
    } finally {
      setLoadingMore(false);
    }
  }, [snapshot.nextCursor, loadingMore, ordersClient, filter]);

  const onRequest = useCallback((orderId: string, toStatus: OrderStatus) => {
    setNotice(null); setCancelNote(''); setConfirming({ orderId, toStatus });
  }, []);

  const onConfirm = useCallback(async () => {
    if (!confirming || busyId !== null) return;
    const order = snapshot.orders.find((entry) => entry.id === confirming.orderId);
    if (!order) { setConfirming(null); return; }
    setBusyId(order.id); setNotice(null);
    try {
      await ordersClient.updateStatus(order.id, { expectedStatus: order.status, toStatus: confirming.toStatus, notes: cancelNote });
      setNotice({ kind: 'success', text: `Pedido #${order.orderNumber}: ${ORDER_STATUS_LABEL[order.status]} → ${ORDER_STATUS_LABEL[confirming.toStatus]}.` });
      setConfirming(null);
      pollerRef.current?.refresh();
    } catch (failure) {
      const described = describeStatusError(failure);
      if (described.unauthorized) { unauthorized.current(); return; }
      setNotice({ kind: described.conflict ? 'conflict' : 'error', text: described.message });
      setConfirming(null);
      if (described.conflict) pollerRef.current?.refresh();
    } finally {
      setBusyId(null);
    }
  }, [confirming, busyId, snapshot.orders, cancelNote, ordersClient]);

  return (
    <AdminOrdersView
      loading={loading} error={error} orders={snapshot.orders} truncated={snapshot.truncated} nextCursor={snapshot.nextCursor}
      filter={filter} loadingMore={loadingMore} updatedAt={updatedAt} newOrderCount={newOrders.length}
      busyId={busyId} notice={notice} confirming={confirming} cancelNote={cancelNote}
      onRequest={onRequest} onConfirm={() => { void onConfirm(); }} onAbort={() => setConfirming(null)}
      onCancelNote={setCancelNote} onRefresh={() => pollerRef.current?.refresh()} onFilter={onFilter}
      onShowNewOrders={onShowNewOrders} onLoadMore={() => { void onLoadMore(); }}
    />
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import type { OrderConfirmation } from '../services/api';
import { ApiError, api } from '../services/api';
import { createOrdersPoller } from '../services/adminOrdersPolling';
import {
  CUSTOMER_STATUS_LABEL, ORDER_TRACKING_POLL_MS, createOrderTrackingClient, parseCustomerOrder,
} from '../services/orderTracking';
import type { CustomerOrderTracking, OrderTrackingClient } from '../services/orderTracking';

export default function OrderTracking({ initial, client }: { initial: OrderConfirmation; client?: OrderTrackingClient }) {
  const trackingClient = useMemo(() => client ?? createOrderTrackingClient(api), [client]);
  const [order, setOrder] = useState<CustomerOrderTracking>(() => parseCustomerOrder(initial));
  const [message, setMessage] = useState<string | null>(null);
  const previousStatus = useRef(order.status);

  useEffect(() => {
    const poller = createOrdersPoller<CustomerOrderTracking>({
      load: (signal) => trackingClient.get(initial.id, signal),
      onData: (next) => {
        if (next.status !== previousStatus.current) {
          setMessage(`Pedido #${next.orderNumber}: ${CUSTOMER_STATUS_LABEL[next.status]}.`);
          previousStatus.current = next.status;
        }
        setOrder(next);
      },
      onError: (error) => {
        setMessage(error instanceof ApiError && error.status === 401
          ? 'A sessão da comanda expirou. Peça um novo acesso ao atendimento.'
          : 'Não foi possível atualizar o pedido agora; tentaremos novamente.');
      },
      shouldStop: (error) => error instanceof ApiError && (error.status === 401 || error.status === 404),
      intervalMs: ORDER_TRACKING_POLL_MS,
    });
    poller.start();
    return () => poller.stop();
  }, [initial.id, trackingClient]);

  return (
    <section className="order-tracking" aria-labelledby="order-tracking-title">
      <h2 id="order-tracking-title">Acompanhe seu pedido #{order.orderNumber}</h2>
      <p className="order-tracking-current" data-order-status={order.status}>
        Status atual: <strong>{CUSTOMER_STATUS_LABEL[order.status]}</strong>
      </p>
      {message && <p role="status" aria-live="polite">{message}</p>}
      <ol className="order-tracking-history">
        {order.history.map((entry, index) => (
          <li key={`${entry.createdAt}-${index}`} data-history-status={entry.toStatus}>
            <strong>{CUSTOMER_STATUS_LABEL[entry.toStatus]}</strong>{' '}
            <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString('pt-BR')}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}

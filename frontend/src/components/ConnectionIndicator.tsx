import { useCallback, useEffect, useRef, useState } from 'react';
import { getHealth, type HealthData } from '../services/api';

type ConnectionState =
  | { status: 'loading' }
  | { status: 'online'; health: HealthData }
  | { status: 'offline'; message: string };

export default function ConnectionIndicator() {
  const [connection, setConnection] = useState<ConnectionState>({ status: 'loading' });
  const activeController = useRef<AbortController | null>(null);

  const checkConnection = useCallback(async () => {
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    setConnection({ status: 'loading' });

    try {
      const response = await getHealth(controller.signal);
      if (controller.signal.aborted) return;

      const health = response.data;
      if (
        typeof health.service !== 'string' || !health.service.trim() ||
        typeof health.timestamp !== 'string' || !Number.isFinite(Date.parse(health.timestamp)) ||
        typeof health.uptime !== 'number' || !Number.isFinite(health.uptime) || health.uptime < 0
      ) {
        throw new Error('A API respondeu em um formato inesperado.');
      }

      setConnection({ status: 'online', health });
    } catch (error) {
      if (controller.signal.aborted) return;
      setConnection({
        status: 'offline',
        message: error instanceof Error ? error.message : 'Erro desconhecido ao contatar a API.',
      });
    } finally {
      if (activeController.current === controller) activeController.current = null;
    }
  }, []);

  useEffect(() => {
    void checkConnection();
    return () => activeController.current?.abort();
  }, [checkConnection]);

  return (
    <section className={`connection connection--${connection.status}`} aria-label="Conectividade da API">
      <div className="connection-message" role="status" aria-live="polite" aria-atomic="true">
        <span className={connection.status === 'loading' ? 'connection-spinner' : 'connection-dot'} aria-hidden="true" />
        <div>
          {connection.status === 'loading' && <><strong>Verificando conexão…</strong><p>Consultando GET /api/health.</p></>}
          {connection.status === 'online' && <>
            <strong>API disponível</strong>
            <p>Serviço: {connection.health.service} · Última verificação: {new Date(connection.health.timestamp).toLocaleString('pt-BR')}</p>
          </>}
          {connection.status === 'offline' && <>
            <strong>API indisponível</strong>
            <p>{connection.message}</p>
          </>}
        </div>
      </div>
      <button className="connection-retry" type="button" disabled={connection.status === 'loading'} onClick={() => void checkConnection()}>
        {connection.status === 'loading' ? 'Verificando…' : 'Verificar novamente'}
      </button>
    </section>
  );
}

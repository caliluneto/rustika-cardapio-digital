import { useState } from 'react';
import { api, ApiError } from '../services/api';
import type { AdminSession } from './AdminLogin';
import AdminOrders from './AdminOrders';
import AdminProducts from './AdminProducts';

interface InvitationPayload { comanda: { number: string }; inviteToken: string; expiresAt: string }

export default function AdminDashboard({ admin, onLogout }: { admin: AdminSession; onLogout: () => void }) {
  const [comandaNumber, setComandaNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [invitation, setInvitation] = useState<InvitationPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true); // desmonta o painel de pedidos: o polling para ANTES do POST de logout
    try {
      await api.post('/admin/auth/logout', {});
    } catch {
      // O logout local acontece mesmo se a API estiver indisponível; o token expira em 1 hora.
    } finally {
      onLogout();
    }
  };

  const handleIssueInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInvitation(null);

    try {
      setInvitation(await api.post<InvitationPayload>('/admin/comanda-invitations', { comandaNumber: comandaNumber.trim() }));
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 401) {
        onLogout();
        return;
      }
      setError(inviteError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-dashboard">
      <header className="admin-header">
        <h2>Painel Administrativo</h2>
        <div className="admin-info">
          <span>Olá, {admin.admin.name}</span>
          <button onClick={handleLogout} className="cart-secondary-button">Sair</button>
        </div>
      </header>

      <main className="admin-main">
        {!loggingOut && <AdminOrders onUnauthorized={onLogout} />}
        {!loggingOut && <AdminProducts onUnauthorized={onLogout} />}

        <section className="admin-section">
          <h3>Emitir Convite de Comanda</h3>
          <form onSubmit={handleIssueInvite} className="admin-form">
            <div className="form-group">
              <label htmlFor="comanda">Número da Comanda</label>
              <input
                id="comanda"
                type="text"
                inputMode="numeric"
                value={comandaNumber}
                onChange={(e) => setComandaNumber(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <button type="submit" disabled={loading} className="cart-primary-button">
              {loading ? 'Emitindo...' : 'Emitir Convite'}
            </button>
          </form>

          {error && <div className="admin-error" role="alert" style={{ marginTop: '1rem' }}>{error}</div>}

          {invitation && (
            <div className="admin-success" role="status" style={{ marginTop: '1rem', padding: '1rem', background: '#e6f4ea', borderRadius: '4px' }}>
              <h4>Convite emitido</h4>
              <p>Convite: <strong style={{ wordBreak: 'break-all' }}>{invitation.inviteToken}</strong></p>
              <p><small>Uso único, comanda {invitation.comanda.number}, válido até {new Date(invitation.expiresAt).toLocaleTimeString('pt-BR')}.</small></p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export function inviteError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return 'Esta comanda está fechada.';
    if (err.status === 400) return 'Número de comanda inválido (1 a 6 dígitos).';
    return err.message;
  }
  return 'Erro ao emitir convite.';
}

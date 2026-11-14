import { useEffect, useState } from 'react';
import { api, ApiError } from '../services/api';
import { useCart } from '../contexts/CartContext';
import type { ComandaSession } from '../contexts/CartContext';
import { comandaSessionUsable } from '../services/orderSubmission';

interface SessionPayload { comanda: { number: string }; expiresAt: string }

const INVITE_FORMAT = /^[0-9a-f]{64}$/;

/** Resgata o convite emitido pelo atendente. A sessão fica só no cookie HttpOnly do backend. */
export default function ComandaRedeem() {
  const [inviteToken, setInviteToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { comandaSession, setComandaSession } = useCart();

  useEffect(() => {
    const controller = new AbortController();
    api.getWithAuth<SessionPayload>('/comanda-sessions/current', controller.signal)
      .then((data) => setComandaSession(toSession(data)))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // 401 means "no session yet": the redeem form stays visible. Other failures are shown on redeem.
        if (err instanceof ApiError && err.status === 401) setComandaSession(null);
      });
    return () => controller.abort();
  }, [setComandaSession]);

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = inviteToken.trim().toLowerCase();
    if (!INVITE_FORMAT.test(token)) {
      setError('O convite tem 64 caracteres (0-9 e a-f). Confira com o atendente.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.post<SessionPayload>('/comanda-sessions', { inviteToken: token });
      setComandaSession(toSession(data));
      setInviteToken('');
    } catch (err: unknown) {
      setError(redeemError(err));
    } finally {
      setLoading(false);
    }
  };

  if (comandaSession && comandaSessionUsable(comandaSession)) {
    return (
      <div className="comanda-active-status" role="status" style={{ padding: '1rem', background: '#e6f4ea', borderRadius: '4px', marginBottom: '1rem' }}>
        <p style={{ margin: 0, color: '#137333' }}>
          <strong>✓ Sessão ativa:</strong> Comanda <strong>{comandaSession.number}</strong>
        </p>
      </div>
    );
  }

  return (
    <div className="comanda-redeem-container" style={{ padding: '1rem', border: '1px solid #ccc', borderRadius: '4px', marginBottom: '1rem' }}>
      <h3>Vincular comanda</h3>
      <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1rem' }}>
        Insira o convite fornecido pelo estabelecimento para habilitar o envio do pedido.
      </p>
      {error && <div className="admin-error" role="alert" style={{ color: '#d32f2f', marginBottom: '1rem', fontSize: '0.9rem' }}>{error}</div>}
      <form onSubmit={handleRedeem} style={{ display: 'flex', gap: '0.5rem' }}>
        <label className="sr-only" htmlFor="comanda-invite-token">Convite</label>
        <input
          id="comanda-invite-token"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={inviteToken}
          onChange={(e) => setInviteToken(e.target.value)}
          placeholder="Convite"
          required
          disabled={loading}
          style={{ flex: 1, padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px' }}
        />
        <button type="submit" disabled={loading || !inviteToken} className="cart-primary-button" style={{ padding: '0.5rem 1rem' }}>
          {loading ? 'Validando...' : 'Resgatar'}
        </button>
      </form>
    </div>
  );
}

function toSession(data: SessionPayload): ComandaSession {
  return { number: data.comanda.number, expiresAt: data.expiresAt };
}

export function redeemError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Convite inválido, expirado ou já utilizado. Peça um novo ao atendente.';
    if (err.status === 409) return 'Esta comanda está fechada. Fale com o atendente.';
    return err.message;
  }
  return 'Erro ao resgatar o convite. Tente novamente.';
}

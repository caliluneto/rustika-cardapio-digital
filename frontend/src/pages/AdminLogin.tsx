import { useState, useEffect } from 'react';
import { api, ApiError } from '../services/api';

export interface AdminSession {
  admin: { id: string; name: string; email: string };
  expiresAt: string;
}

/** Login administrativo real: o backend grava o cookie HttpOnly rustika_admin; nada vai para localStorage. */
export default function AdminLogin({ onLogin }: { onLogin: (session: AdminSession) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 'checking' enquanto a sessão existente é verificada; 'anonymous' quando não há sessão (formulário estável).
  const [sessionState, setSessionState] = useState<'checking' | 'anonymous'>('checking');

  useEffect(() => {
    const controller = new AbortController();
    api.getWithAuth<AdminSession>('/admin/auth/session', controller.signal)
      .then(onLogin)
      .catch(() => { if (!controller.signal.aborted) setSessionState('anonymous'); /* sem sessão administrativa ativa */ });
    return () => controller.abort();
  }, [onLogin]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const data = await api.post<AdminSession>('/admin/auth/login', { email, password });
      setPassword('');
      onLogin(data);
    } catch (err: unknown) {
      setError(loginError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login-container" data-session-state={sessionState}>
      <h2>Acesso Administrativo</h2>
      {error && <div className="admin-error" role="alert">{error}</div>}
      <form onSubmit={handleSubmit} className="admin-login-form">
        <div className="form-group">
          <label htmlFor="email">E-mail</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
          />
        </div>
        <div className="form-group">
          <label htmlFor="password">Senha</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
          />
        </div>
        <button type="submit" disabled={loading} className="cart-primary-button">
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

export function loginError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'E-mail ou senha inválidos.';
    return err.message;
  }
  return 'Erro ao fazer login.';
}

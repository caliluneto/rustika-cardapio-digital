/**
 * Estados da interface administrativa para o E2E (3D.4.2-C). Lógica pura, sem navegador: o formulário de login é
 * renderizado ANTES do fim da verificação de sessão (`data-session-state="checking"`) e some se a sessão for restaurada;
 * só `anonymous` (verificação concluída sem sessão) é estável para preencher.
 */
export interface AdminDomFacts { dashboard: boolean; loginForm: boolean; sessionState: string | null; alert: boolean }
export type AdminUiState = 'checking' | 'anonymous' | 'authenticated' | 'login-error' | 'unknown';
export type AdminAction = 'wait' | 'login' | 'done' | 'fail';

export function classifyAdmin(facts: AdminDomFacts): AdminUiState {
  if (facts.dashboard) return 'authenticated';
  if (facts.loginForm && facts.sessionState === 'checking') return 'checking';
  if (facts.loginForm && facts.sessionState === 'anonymous') return facts.alert ? 'login-error' : 'anonymous';
  return 'unknown';
}

/** `attemptedLogin`: o formulário já foi enviado nesta chamada; voltar a `anonymous` então significa sessão negada/expirada. */
export function nextAdminAction(state: AdminUiState, attemptedLogin: boolean): AdminAction {
  if (state === 'authenticated') return 'done';
  if (state === 'checking' || state === 'unknown') return 'wait';
  if (state === 'login-error') return 'fail';
  return attemptedLogin ? 'fail' : 'login';
}

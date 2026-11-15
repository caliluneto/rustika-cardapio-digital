import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { createFixedWindowLimiter, clientAddress, tooManyRequests } from './accessLimits';
import type { GateConfig } from '../config/webConfig';

/**
 * Portão HTTP Basic EXCLUSIVO da homologação (desativado por padrão; ver webConfig).
 *
 * Não substitui a autenticação do administrador, o CSRF nem a validação de Origin: é uma camada à frente de tudo.
 * - Credenciais só por configuração; comparação em tempo constante (SHA-256 de ambos os lados + timingSafeEqual) sem
 *   curto-circuito entre usuário e senha.
 * - Falhas de credencial são contadas por cliente (mesma chave do rate limit: respeita `trust proxy`); excedido o limite,
 *   responde 429 inclusive para credenciais corretas até o fim da janela. Ausência de cabeçalho (primeira visita do
 *   navegador) não conta como tentativa.
 * - Nada é registrado em log; o cabeçalho Authorization nunca é ecoado.
 * - Exceção mínima para o health check do provedor: apenas GET/HEAD em `/api/health` (liveness, sem acesso ao banco).
 *   `/api/ready` NÃO é isento: consulta o banco e, aberto, permitiria a terceiros manter o compute do banco ativo (custo).
 *   Qualquer variação (método, caixa, barra final, prefixo) passa pelo portão.
 */
export const HEALTH_EXEMPT_PATHS: ReadonlySet<string> = new Set(['/api/health']);
export const GATE_MAX_FAILURES = 10;
export const GATE_WINDOW_MS = 15 * 60_000;
export const GATE_REALM = 'Rustika homologacao';

const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

function readBasic(header: string | undefined): { user: string; password: string } | undefined {
  if (header === undefined) return undefined;
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/.exec(header);
  if (!match) return { user: '', password: '' };
  let decoded: string;
  try { decoded = Buffer.from(match[1]!, 'base64').toString('utf8'); } catch { return { user: '', password: '' }; }
  const separator = decoded.indexOf(':');
  if (separator < 0) return { user: '', password: '' };
  return { user: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
}

export function createHomologGate(config: GateConfig, now: () => Date = () => new Date()): RequestHandler {
  const expectedUser = digest(config.user);
  const expectedPassword = digest(config.password);
  const failures = createFixedWindowLimiter({ max: GATE_MAX_FAILURES, windowMs: GATE_WINDOW_MS, now });

  const challenge = (request: Request): boolean => (request.method === 'GET' || request.method === 'HEAD') && HEALTH_EXEMPT_PATHS.has(request.path);

  return (request, response, next) => {
    if (challenge(request)) { next(); return; }
    const address = clientAddress(request);
    const blocked = failures.peek(address);
    if (blocked.limited) { next(tooManyRequests(response, blocked.retryAfterSeconds)); return; }

    const unauthorized = () => {
      response.set({ 'WWW-Authenticate': `Basic realm="${GATE_REALM}", charset="UTF-8"`, 'Cache-Control': 'no-store' });
      response.status(401).type('text/plain').send('Autenticação necessária.');
    };

    const supplied = readBasic(request.get('Authorization'));
    if (!supplied) { unauthorized(); return; }
    const userOk = timingSafeEqual(digest(supplied.user), expectedUser);
    const passwordOk = timingSafeEqual(digest(supplied.password), expectedPassword);
    if (userOk && passwordOk) { next(); return; }

    const result = failures.hit(address);
    if (result.limited) { next(tooManyRequests(response, result.retryAfterSeconds)); return; }
    unauthorized();
  };
}

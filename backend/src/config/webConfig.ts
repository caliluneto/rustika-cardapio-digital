/**
 * 3D.5.3-B - configuração de hospedagem em um único Web Service (frontend estático + API na mesma origem).
 *
 * Tudo é opt-in e vem de variáveis de ambiente; sem elas o comportamento é exatamente o anterior (somente API).
 * As mensagens de erro nunca incluem valores (credenciais, caminhos de segredo).
 *
 *   SERVE_FRONTEND=on            serve `frontend/dist` pelo Express (depois das rotas /api)
 *   TRUST_PROXY_HOPS=<0..5>      saltos de proxy confiáveis à frente do Express (padrão 0 = não confiar em X-Forwarded-For)
 *   HOMOLOG_GATE=on              exige HTTP Basic em toda a aplicação (exceto health/readiness); implica noindex
 *   HOMOLOG_GATE_USER / HOMOLOG_GATE_PASSWORD   credenciais do portão (nunca em código; senha >= 24 caracteres)
 */
export const MAX_TRUST_PROXY_HOPS = 5;
export const GATE_USER_PATTERN = /^[A-Za-z0-9._-]{3,64}$/;
export const GATE_PASSWORD_MIN = 24;
export const GATE_PASSWORD_MAX = 256;

export interface GateConfig { user: string; password: string }

export interface WebConfig {
  /** Diretório de `frontend/dist` quando o frontend deve ser servido. */
  frontendDir?: string;
  trustProxyHops: number;
  gate?: GateConfig;
  noindex: boolean;
}

export class WebConfigError extends Error {
  constructor(message: string) { super(message); this.name = 'WebConfigError'; }
}

function readSwitch(value: string | undefined, name: string): boolean {
  const normalized = value?.trim().toLowerCase();
  if (normalized === undefined || normalized === '' || normalized === 'off') return false;
  if (normalized === 'on') return true;
  throw new WebConfigError(`${name} deve ser "on" ou "off".`);
}

export function readTrustProxyHops(value: string | undefined): number {
  const raw = value?.trim();
  if (raw === undefined || raw === '') return 0;
  if (!/^\d{1,2}$/.test(raw)) throw new WebConfigError('TRUST_PROXY_HOPS deve ser um inteiro de 0 a 5.');
  const hops = Number(raw);
  if (hops > MAX_TRUST_PROXY_HOPS) throw new WebConfigError('TRUST_PROXY_HOPS deve ser um inteiro de 0 a 5.');
  return hops;
}

export function readGateConfig(source: NodeJS.ProcessEnv): GateConfig | undefined {
  if (!readSwitch(source.HOMOLOG_GATE, 'HOMOLOG_GATE')) return undefined;
  const user = source.HOMOLOG_GATE_USER ?? '';
  const password = source.HOMOLOG_GATE_PASSWORD ?? '';
  if (!GATE_USER_PATTERN.test(user)) throw new WebConfigError('HOMOLOG_GATE_USER inválido (3 a 64 caracteres: letras, números, ponto, hífen, sublinhado).');
  // eslint-disable-next-line no-control-regex
  if (password.length < GATE_PASSWORD_MIN || password.length > GATE_PASSWORD_MAX || /[\u0000-\u001f\u007f]/.test(password)) {
    throw new WebConfigError(`HOMOLOG_GATE_PASSWORD inválida (${GATE_PASSWORD_MIN} a ${GATE_PASSWORD_MAX} caracteres, sem controles).`);
  }
  if (password === user || password.toLowerCase().includes(user.toLowerCase())) {
    throw new WebConfigError('HOMOLOG_GATE_PASSWORD não pode conter o usuário.');
  }
  return { user, password };
}

/** `defaultFrontendDir` só é chamado quando SERVE_FRONTEND=on. */
export function readWebConfig(source: NodeJS.ProcessEnv, defaultFrontendDir: () => string): WebConfig {
  const gate = readGateConfig(source);
  return {
    trustProxyHops: readTrustProxyHops(source.TRUST_PROXY_HOPS),
    ...(readSwitch(source.SERVE_FRONTEND, 'SERVE_FRONTEND') ? { frontendDir: defaultFrontendDir() } : {}),
    ...(gate ? { gate } : {}),
    noindex: gate !== undefined,
  };
}

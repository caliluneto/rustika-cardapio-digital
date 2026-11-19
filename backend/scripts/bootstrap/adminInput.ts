/** Validação da entrada do primeiro administrador (3D.5.2). Funções puras; nunca registram a senha. */

export interface AdminIdentity { name: string; email: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WEAK_FRAGMENTS = ['password', 'senha', 'qwerty', '123456', 'rustika', 'cardapio', 'admin', 'letmein'];
export const MIN_ADMIN_PASSWORD_LENGTH = 14;

export function normalizeIdentity(raw: { name?: unknown; email?: unknown }): { ok: true; value: AdminIdentity } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const name = typeof raw.name === 'string' ? raw.name.trim().replace(/\s+/g, ' ') : '';
  const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '';
  if (name.length < 2 || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) errors.push('Nome inválido (2 a 100 caracteres, sem controle).');
  if (email.length === 0 || email.length > 254 || !EMAIL.test(email)) errors.push('E-mail inválido.');
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { name, email } };
}

/** Política de senha do primeiro administrador. Devolve mensagens genéricas (nunca ecoa a senha). */
export function checkPasswordPolicy(password: string, identity: AdminIdentity): string[] {
  const errors: string[] = [];
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) errors.push(`A senha deve ter ao menos ${MIN_ADMIN_PASSWORD_LENGTH} caracteres.`);
  if (password.length > 256 || Buffer.byteLength(password, 'utf8') > 1024) errors.push('A senha excede o tamanho máximo.');
  if (new Set(password).size < 6) errors.push('A senha tem caracteres repetidos demais.');
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  if (classes < 3) errors.push('Use ao menos três entre minúsculas, maiúsculas, números e símbolos.');
  const lower = password.toLowerCase();
  if (WEAK_FRAGMENTS.some((fragment) => lower.includes(fragment))) errors.push('A senha contém um trecho previsível.');
  const local = identity.email.split('@')[0] ?? '';
  const nameTokens = identity.name.toLowerCase().split(' ').filter((token) => token.length >= 4);
  if ((local.length >= 3 && lower.includes(local)) || nameTokens.some((token) => lower.includes(token))) {
    errors.push('A senha não pode conter o nome ou o e-mail.');
  }
  return errors;
}

/** Mascara o e-mail para saída operacional: a***@dominio. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

import { webcrypto } from 'node:crypto';

/** Implementação independente do canonicalizador principal, usada para detectar divergência de cálculo. */
export function canonicalJsonIndependent(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJsonIndependent(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJsonIndependent(record[key])}`).join(',')}}`;
}

export async function independentSha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJsonIndependent(value));
  const digest = await webcrypto.subtle.digest('SHA-256', bytes);
  return Buffer.from(digest).toString('hex');
}

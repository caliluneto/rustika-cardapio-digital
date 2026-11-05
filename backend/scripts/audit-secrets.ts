/**
 * Audit of the database secrets already managed by src/config/secrets.ts (3D.3.21-B).
 * It reads the same secrets directory the app uses and NEVER prints a password: only roles,
 * profile ids, lengths/classes and pass/fail findings. Read-only; no connection to any database.
 *
 *   npm run secrets:audit        # exit 1 when any finding is FAIL
 *
 * Policy: one role = one distinct password; length >= 16; not purely numeric; the same role must
 * use the same password in every URL (a role has a single password in PostgreSQL).
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { redactSecrets, resolveSecretsDir } from '../src/config/secrets';

export interface SecretEntry { id: string; user: string; pass: string }
export interface Finding { level: 'FAIL' | 'WARN' | 'OK'; code: string; message: string }

export const MIN_PASSWORD_LENGTH = 16;

export function loadSecretEntries(dir: string): SecretEntry[] {
  const entries: SecretEntry[] = [];
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.env')).sort()) {
    const values = dotenv.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const key of ['DATABASE_URL', 'SHADOW_DATABASE_URL'] as const) {
      const raw = values[key];
      if (!raw) continue;
      try {
        const url = new URL(raw);
        entries.push({ id: `${file.replace(/\.env$/, '')}:${key === 'DATABASE_URL' ? 'db' : 'shadow'}`, user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) });
      } catch { /* unreadable URL: not this tool's concern, secrets.ts validates it */ }
    }
  }
  return entries;
}

/** Pure: findings never contain a password. */
export function analyzeSecrets(entries: SecretEntry[]): Finding[] {
  const findings: Finding[] = [];
  const byUser = new Map<string, SecretEntry[]>();
  for (const entry of entries) byUser.set(entry.user, [...(byUser.get(entry.user) ?? []), entry]);

  for (const [user, list] of byUser) {
    if (new Set(list.map((e) => e.pass)).size > 1) {
      findings.push({ level: 'FAIL', code: 'INCONSISTENT_ROLE_PASSWORD', message: `${user}: URLs diferentes (${list.map((e) => e.id).join(', ')}) usam senhas diferentes para a mesma role; ao menos uma não autentica.` });
    }
  }
  const byPass = new Map<string, Set<string>>();
  for (const entry of entries) byPass.set(entry.pass, (byPass.get(entry.pass) ?? new Set()).add(entry.user));
  for (const users of byPass.values()) {
    if (users.size > 1) findings.push({ level: 'FAIL', code: 'PASSWORD_REUSED_ACROSS_ROLES', message: `Mesma senha em ${users.size} roles: ${[...users].sort().join(', ')}. Vazar uma entrega todas.` });
  }
  for (const entry of entries) {
    const weakLength = entry.pass.length < MIN_PASSWORD_LENGTH;
    const numeric = /^\d+$/.test(entry.pass);
    if (weakLength) findings.push({ level: 'FAIL', code: 'PASSWORD_TOO_SHORT', message: `${entry.id} (${entry.user}): ${entry.pass.length} caracteres (mínimo ${MIN_PASSWORD_LENGTH}).` });
    if (numeric) findings.push({ level: 'FAIL', code: 'PASSWORD_NUMERIC_ONLY', message: `${entry.id} (${entry.user}): somente dígitos.` });
  }
  if (!findings.length) findings.push({ level: 'OK', code: 'POLICY_OK', message: `${entries.length} segredo(s) conformes: distintos por role, ≥ ${MIN_PASSWORD_LENGTH} caracteres, não numéricos.` });
  return findings;
}

function main(): number {
  const dir = resolveSecretsDir();
  const entries = loadSecretEntries(dir);
  const outsideRepo = !path.resolve(dir).toLowerCase().startsWith(path.resolve(process.cwd(), '..').toLowerCase());
  console.log(`pasta de segredos: fora do repositório=${outsideRepo}; fora do OneDrive=${!/onedrive/i.test(dir)}; segredos lidos=${entries.length}`);
  for (const entry of entries) console.log(`  ${entry.id} -> ${entry.user} (len=${entry.pass.length})`);
  const findings = analyzeSecrets(entries);
  for (const finding of findings) console.log(`${finding.level} ${finding.code}: ${finding.message}`);
  return findings.some((f) => f.level === 'FAIL') ? 1 : 0;
}

if (require.main === module) {
  try { process.exit(main()); } catch (error) {
    console.error(redactSecrets(error instanceof Error ? error.message : String(error)));
    process.exit(2);
  }
}

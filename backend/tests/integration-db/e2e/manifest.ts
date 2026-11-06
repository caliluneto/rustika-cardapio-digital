import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRunIdentity } from '../support/fixtures';
import { E2E_TARGET_DATABASE, E2eAbort, assertTestDatabaseName } from './gate';

/**
 * Temporary manifest of ONE E2E run (3D.3.21-B). Written BEFORE provisioning (intent) and completed
 * after it. It holds ids and the reserved comanda numbers, never a password or a token. The teardown
 * deletes only what the manifest (cross-checked with the run identity) describes.
 */

export const MANIFEST_VERSION = 1;
export const MANIFEST_SUFFIX = '.e2e-manifest.json';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RunManifest {
  version: typeof MANIFEST_VERSION;
  runId: string;
  status: 'pending' | 'provisioned';
  createdAt: string;
  pid: number;
  target: { database: string };
  roles: { runtime: 'cardapio_test_app'; fixtures: 'cardapio_test_fixtures' };
  ids: { adminIds: string[]; categoryIds: string[]; productIds: string[] };
  comandaNumbers: string[];
  /**
   * `orderOps` (3D.4.1, opcional): a jornada também move o pedido para IN_PREPARATION pelo painel administrativo.
   * Ausente/false = jornada original (RECEIVED, histórico inicial único).
   */
  journey: { comanda: string; productName: string; productKey: string; priceInCents: number; orderOps?: boolean };
}

export const reservedComandaNumbers = (runId: string): string[] => {
  const { comandas } = createRunIdentity(runId);
  return [comandas.open, comandas.other, comandas.closed, ...comandas.spare];
};

/** Strict validation: a tampered manifest can never widen what the teardown deletes. */
export function validateManifest(raw: unknown, expectedRunId?: string): RunManifest {
  const reasons: string[] = [];
  const m = raw as Partial<RunManifest> | null;
  if (!m || typeof m !== 'object') throw new E2eAbort(['manifesto ilegível.']);
  if (m.version !== MANIFEST_VERSION) reasons.push(`versão ${String(m.version)} não suportada.`);
  if (typeof m.runId !== 'string' || !/^[0-9a-f]{8}$/.test(m.runId)) reasons.push('runId inválido.');
  if (expectedRunId !== undefined && m.runId !== expectedRunId) reasons.push('runId diverge do nome do arquivo.');
  if (m.status !== 'pending' && m.status !== 'provisioned') reasons.push('status inválido.');
  if (!m.createdAt || Number.isNaN(Date.parse(m.createdAt))) reasons.push('createdAt inválido.');
  try { assertTestDatabaseName(String(m.target?.database)); } catch { reasons.push(`banco alvo inválido: ${JSON.stringify(m.target?.database)}.`); }
  if (m.roles?.runtime !== 'cardapio_test_app' || m.roles?.fixtures !== 'cardapio_test_fixtures') reasons.push('roles inesperadas.');
  for (const key of ['adminIds', 'categoryIds', 'productIds'] as const) {
    const list = m.ids?.[key];
    if (!Array.isArray(list) || list.length > 20 || !list.every((id) => typeof id === 'string' && UUID.test(id))) reasons.push(`ids.${key} inválido.`);
  }
  if (typeof m.runId === 'string' && /^[0-9a-f]{8}$/.test(m.runId)) {
    const expected = reservedComandaNumbers(m.runId);
    if (!Array.isArray(m.comandaNumbers) || m.comandaNumbers.length !== expected.length || m.comandaNumbers.some((n, i) => n !== expected[i])) {
      reasons.push('comandaNumbers diverge da faixa reservada do runId.');
    }
    if (m.journey?.comanda !== createRunIdentity(m.runId).comandas.open) reasons.push('journey.comanda fora da faixa reservada.');
  }
  if (typeof m.journey?.productName !== 'string' || !Number.isSafeInteger(m.journey?.priceInCents)) reasons.push('journey inválido.');
  if (m.journey?.orderOps !== undefined && typeof m.journey.orderOps !== 'boolean') reasons.push('journey.orderOps inválido.');
  if (reasons.length) throw new E2eAbort(reasons.map((r) => `manifesto: ${r}`));
  return m as RunManifest;
}

/** State dir: absolute, outside the repository and outside OneDrive (it is synced to the cloud). */
export function resolveStateDir(env: Record<string, string | undefined>, repoRoot: string): string {
  const dir = path.resolve(env.RUSTIKA_E2E_STATE_DIR ?? path.join(os.tmpdir(), 'rustika-e2e'));
  const inside = (parent: string) => { const rel = path.relative(parent, dir); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
  if (inside(path.resolve(repoRoot))) throw new E2eAbort(['pasta de estado dentro do repositório.']);
  if (/onedrive/i.test(dir)) throw new E2eAbort(['pasta de estado dentro do OneDrive (sincroniza com a nuvem).']);
  return dir;
}

export const manifestPath = (dir: string, runId: string): string => path.join(dir, `${runId}${MANIFEST_SUFFIX}`);

export function ensureStateDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function listManifests(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith(MANIFEST_SUFFIX)).sort().map((name) => path.join(dir, name));
}

/** Exclusive create: never overwrites a manifest of another run. */
export function writeManifestExclusive(dir: string, manifest: RunManifest): string {
  const file = manifestPath(dir, manifest.runId);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2), { flag: 'wx' });
  return file;
}

/** Atomic replace of OUR manifest (temp file + rename). */
export function replaceManifest(dir: string, manifest: RunManifest): void {
  const file = manifestPath(dir, manifest.runId);
  if (!fs.existsSync(file)) throw new E2eAbort(['manifesto desta execução desapareceu.']);
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(manifest, null, 2), { flag: 'wx' });
  fs.renameSync(temp, file);
}

export function readManifest(file: string): RunManifest {
  const runId = path.basename(file).slice(0, -MANIFEST_SUFFIX.length);
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new E2eAbort(['manifesto não é JSON válido.']); }
  return validateManifest(raw, runId);
}

export const removeManifest = (file: string): void => { fs.rmSync(file, { force: false }); };

export { E2E_TARGET_DATABASE };

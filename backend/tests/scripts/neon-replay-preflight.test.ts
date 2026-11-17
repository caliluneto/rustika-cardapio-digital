import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_MIGRATIONS } from '../../scripts/bootstrap/expectedMigrations';
import {
  evaluateNeonReplayHistory,
  prepareReplayPgConnection,
  type ReplayMigrationRow,
} from '../../scripts/homolog/neonReplayPreflight';

const rows = (count: number): ReplayMigrationRow[] => EXPECTED_MIGRATIONS.slice(0, count).map(
  ({ name, checksum }, index) => ({
    name,
    checksum,
    startedAt: new Date(1_000 + index * 2),
    finishedAt: new Date(2_000 + index * 2),
    rolledBackAt: null,
    appliedStepsCount: 1,
    logs: null,
  }),
);

describe('preflight remoto do replay Neon', () => {
  it('converte o sslcert Prisma em CA explícita sem deixar o pg reinterpretar os parâmetros TLS', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rustika-replay-ca-'));
    try {
      const cert = path.join(dir, 'ca.crt');
      fs.writeFileSync(cert, 'CA SINTÉTICA');
      const url = new URL('postgresql://user:pass@db.example.invalid/database');
      url.search = `schema=public&sslmode=require&sslaccept=strict&sslcert=${encodeURIComponent(cert)}&channel_binding=require`;
      const prepared = prepareReplayPgConnection(url.toString());
      const parsed = new URL(prepared.connectionString);
      expect(prepared.ca).toBe('CA SINTÉTICA');
      expect(parsed.searchParams.get('schema')).toBe('public');
      expect(parsed.searchParams.get('channel_binding')).toBe('require');
      for (const key of ['sslmode', 'sslaccept', 'sslcert']) expect(parsed.searchParams.has(key)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('autoriza somente 7/9 íntegro para deploy e não invoca Prisma em 9/9', () => {
    expect(evaluateNeonReplayHistory(rows(7), 'deploy')).toEqual({
      ok: true, action: 'invoke-prisma', appliedCount: 7,
    });
    expect(evaluateNeonReplayHistory(rows(9), 'deploy')).toEqual({
      ok: true, action: 'already-complete', appliedCount: 9,
    });
    expect(evaluateNeonReplayHistory(rows(9), 'status')).toEqual({
      ok: true, action: 'invoke-prisma', appliedCount: 9,
    });
  });

  it.each([0, 1, 6, 8])('bloqueia o estado %i/9', (count) => {
    const decision = evaluateNeonReplayHistory(rows(count), 'deploy');
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.problems.join(' ')).toMatch(count === 8 ? /incidente/ : /não é autorizado/);
  });

  it('bloqueia migration desconhecida, ordem e checksum divergentes', () => {
    const bad = rows(7);
    bad[2] = { ...bad[2]!, name: '20269999999999_intrusa', checksum: '0'.repeat(64) };
    const decision = evaluateNeonReplayHistory(bad, 'deploy');
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.problems.join(' ')).toMatch(/desconhecida.*ordem divergente/);

    const checksum = rows(7);
    checksum[4] = { ...checksum[4]!, checksum: 'f'.repeat(64) };
    const checksumDecision = evaluateNeonReplayHistory(checksum, 'deploy');
    expect(checksumDecision.ok).toBe(false);
    if (!checksumDecision.ok) expect(checksumDecision.problems.join(' ')).toMatch(/checksum divergente/);
  });

  it('bloqueia falha, rollback, logs, passos e datas inconsistentes', () => {
    const variants = [
      { finishedAt: null },
      { rolledBackAt: new Date(3_000) },
      { logs: 'erro' },
      { appliedStepsCount: 0 },
      { startedAt: new Date(5_000), finishedAt: new Date(4_000) },
    ];
    for (const change of variants) {
      const bad = rows(7);
      bad[0] = { ...bad[0]!, ...change };
      expect(evaluateNeonReplayHistory(bad, 'deploy').ok, JSON.stringify(change)).toBe(false);
    }
  });
});

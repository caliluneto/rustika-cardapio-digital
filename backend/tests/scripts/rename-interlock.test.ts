import { describe, expect, it, vi } from 'vitest';
import { EXPECTED_MIGRATIONS } from '../../scripts/bootstrap/expectedMigrations';
import {
  runRenameInterlock,
  type RenameGateFacts,
  type RenameInterlockDriver,
} from '../../scripts/homolog/renameInterlock';

const migrations = (count = 9) => EXPECTED_MIGRATIONS.slice(0, count).map(({ name, checksum }, index) => ({
  name, checksum,
  startedAt: new Date(1_000 + index * 2), finishedAt: new Date(2_000 + index * 2),
  rolledBackAt: null, appliedStepsCount: 1, logs: null,
}));
const good = (changes: Partial<RenameGateFacts> = {}): RenameGateFacts => ({
  identityProblems: [], migrations: migrations(), replayDatabaseExists: true,
  finalDatabaseExists: false, finalRolesPresent: [], databaseOwner: 'cardapio_migrator',
  objectOwnershipValid: true, aclValid: true, membershipsValid: true,
  activeConnections: 1, allowConnections: true, ...changes,
});

function driver(pre = good(), frozen = good({ allowConnections: false, activeConnections: 1 }), ready = good({ allowConnections: false, activeConnections: 0 })) {
  const calls: string[] = [];
  const step = <T>(name: string, value?: T) => vi.fn(async () => { calls.push(name); return value as T; });
  const value: RenameInterlockDriver = {
    acquireOperationalLock: step('lock'), inspectPreFreeze: step('pre', pre),
    freezeReplayDatabase: step('freeze'), inspectReplayAfterFreeze: step('reverify', frozen),
    closeReplayVerifier: step('close'), inspectReadyToRename: step('ready', ready),
    executeRename: step('rename'),
  };
  return { value, calls };
}

describe('interlock operacional do rename', () => {
  it.each([[7, '7/9'], [8, '8/9']])('%i/9 bloqueia antes de freeze e rename', async (count, message) => {
    const d = driver(good({ migrations: migrations(count) }));
    const result = await runRenameInterlock(d.value, true);
    expect(result.status).toBe('blocked');
    expect(JSON.stringify(result)).toContain(message);
    expect(d.calls).toEqual(['lock', 'pre']);
  });

  it('9/9 íntegro permite avançar somente na simulação, sem escrita', async () => {
    const d = driver();
    expect(await runRenameInterlock(d.value, false)).toEqual({ status: 'simulated', phase: 'pre-freeze' });
    expect(d.calls).toEqual(['lock', 'pre']);
  });

  it('checksum divergente, role incorreta, conexão e destino preexistente bloqueiam', async () => {
    const badChecksum = migrations(); badChecksum[4] = { ...badChecksum[4]!, checksum: '0'.repeat(64) };
    for (const facts of [
      good({ migrations: badChecksum }),
      good({ identityProblems: ['role conectada difere da esperada.'] }),
      good({ activeConnections: 2 }),
      good({ finalDatabaseExists: true }),
    ]) {
      const d = driver(facts);
      expect((await runRenameInterlock(d.value, true)).status).toBe('blocked');
      expect(d.calls).toEqual(['lock', 'pre']);
    }
  });

  it('falha após o freeze nunca alcança o SQL de rename', async () => {
    const d = driver(good(), good({ allowConnections: false, activeConnections: 1, membershipsValid: false }));
    expect((await runRenameInterlock(d.value, true)).status).toBe('blocked');
    expect(d.calls).toEqual(['lock', 'pre', 'freeze', 'reverify']);
  });

  it('conexão concorrente surgida durante o freeze bloqueia antes do fechamento do verificador', async () => {
    const d = driver(good(), good({ allowConnections: false, activeConnections: 2 }));
    expect((await runRenameInterlock(d.value, true)).status).toBe('blocked');
    expect(d.calls).toEqual(['lock', 'pre', 'freeze', 'reverify']);
  });

  it('executa rename apenas após freeze, reverificação, fechamento e gate final', async () => {
    const d = driver();
    expect(await runRenameInterlock(d.value, true)).toEqual({ status: 'renamed' });
    expect(d.calls).toEqual(['lock', 'pre', 'freeze', 'reverify', 'close', 'ready', 'rename']);
  });
});

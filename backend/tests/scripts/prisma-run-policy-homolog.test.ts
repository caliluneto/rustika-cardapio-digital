import { describe, expect, it } from 'vitest';
import {
  authorizePrismaInvocation, checkDeployConfirmation, DEPLOY_CONFIRMATION_ENV, DEPLOY_CONFIRMATION_VALUE,
  HOMOLOG_DEPLOY_CONFIRMATION_ENV, HOMOLOG_DEPLOY_CONFIRMATION_VALUE, parsePrismaInvocation, REPLAY_CONFIRMATION_ENV, REPLAY_CONFIRMATION_VALUE,
} from '../../scripts/prisma-run-policy';

const homologDb = { profile: 'migrate-homolog', purpose: 'migration' as const, database: 'cardapio_digital_homolog', environment: 'homolog' as const };
const replayDb = { profile: 'migrate-homolog-replay', purpose: 'migration' as const, database: 'cardapio_digital_test', environment: 'homolog-replay' as const };
const inv = (profile: string, sub: string) => { const r = parsePrismaInvocation([profile, 'migrate', sub]); if (!r.ok) throw new Error(r.error); return r.value; };
const HOMOLOG_OK = { [HOMOLOG_DEPLOY_CONFIRMATION_ENV]: HOMOLOG_DEPLOY_CONFIRMATION_VALUE };
const REPLAY_OK = { [REPLAY_CONFIRMATION_ENV]: REPLAY_CONFIRMATION_VALUE };

describe('política Prisma da homologação (3D.5.2-A)', () => {
  it('aceita migrate status/deploy dos perfis migrate-homolog e migrate-homolog-replay e bloqueia comandos destrutivos', () => {
    for (const profile of ['migrate-homolog', 'migrate-homolog-replay']) {
      expect(inv(profile, 'deploy')).toMatchObject({ profileName: profile, purpose: 'migration', migrationSubcommand: 'deploy' });
      expect(inv(profile, 'status').prismaArgs).toEqual(['migrate', 'status']);
      for (const command of ['reset', 'resolve', 'db', 'push', 'dev', 'seed']) expect(parsePrismaInvocation([profile, command, 'x']).ok).toBe(false);
      for (const sub of ['reset', 'resolve', 'dev', 'diff']) expect(parsePrismaInvocation([profile, 'migrate', sub]).ok).toBe(false);
      expect(parsePrismaInvocation([profile, 'migrate', 'deploy', '--force']).ok).toBe(false);
    }
  });

  it('outros perfis (Dev, Test runtime, runtime/bootstrap de homologação) continuam recusados para migrate', () => {
    for (const profile of ['migrate-dev', 'app-test', 'app-homolog', 'bootstrap-homolog']) expect(parsePrismaInvocation([profile, 'migrate', 'status']).ok).toBe(false);
  });

  it('cada deploy exige a confirmação do SEU perfil; nenhuma confirmação vale para outro (Test, replay, homologação)', () => {
    expect(checkDeployConfirmation(inv('migrate-homolog', 'deploy'), {}).ok).toBe(false);
    expect(checkDeployConfirmation(inv('migrate-homolog', 'deploy'), REPLAY_OK).ok).toBe(false);
    expect(checkDeployConfirmation(inv('migrate-homolog', 'deploy'), { [DEPLOY_CONFIRMATION_ENV]: DEPLOY_CONFIRMATION_VALUE }).ok).toBe(false);
    expect(checkDeployConfirmation(inv('migrate-homolog', 'deploy'), HOMOLOG_OK).ok).toBe(true);
    expect(checkDeployConfirmation(inv('migrate-homolog-replay', 'deploy'), HOMOLOG_OK).ok).toBe(false);
    expect(checkDeployConfirmation(inv('migrate-homolog-replay', 'deploy'), { [REPLAY_CONFIRMATION_ENV]: 'qualquer' }).ok).toBe(false);
    expect(checkDeployConfirmation(inv('migrate-homolog-replay', 'deploy'), REPLAY_OK).ok).toBe(true);
    expect(checkDeployConfirmation(inv('migrate-test', 'deploy'), { ...HOMOLOG_OK, ...REPLAY_OK }).ok).toBe(false);
    expect(checkDeployConfirmation(inv('migrate-homolog', 'status'), {}).ok).toBe(true); // status é somente leitura
  });

  it('autoriza somente migração + ambiente + banco coerentes com o perfil', () => {
    expect(authorizePrismaInvocation(inv('migrate-homolog', 'deploy'), homologDb, HOMOLOG_OK).ok).toBe(true);
    expect(authorizePrismaInvocation(inv('migrate-homolog-replay', 'deploy'), replayDb, REPLAY_OK).ok).toBe(true);
    expect(authorizePrismaInvocation(inv('migrate-homolog', 'deploy'), homologDb, {}).ok).toBe(false);
    for (const wrong of [
      { ...homologDb, environment: undefined }, { ...homologDb, environment: 'homolog-replay' as const }, { ...homologDb, purpose: 'runtime' as const },
      { ...homologDb, database: 'cardapio_digital_test' }, { ...homologDb, database: 'cardapio_digital_dev' }, { ...homologDb, profile: 'migrate-test' },
      { ...homologDb, profile: 'migrate-homolog-replay' }, { ...homologDb, purpose: 'bootstrap' as const },
    ]) expect(authorizePrismaInvocation(inv('migrate-homolog', 'deploy'), wrong, HOMOLOG_OK).ok).toBe(false);
    for (const wrong of [
      { ...replayDb, environment: 'homolog' as const }, { ...replayDb, database: 'cardapio_digital_homolog' }, { ...replayDb, database: 'cardapio_digital_dev' }, { ...replayDb, environment: undefined },
    ]) expect(authorizePrismaInvocation(inv('migrate-homolog-replay', 'deploy'), wrong, REPLAY_OK).ok).toBe(false);
  });

  it('o perfil de migração local não pode ser autorizado como homologação nem o contrário', () => {
    expect(authorizePrismaInvocation(inv('migrate-test', 'status'), homologDb, {}).ok).toBe(false);
    expect(authorizePrismaInvocation(inv('migrate-test', 'status'), replayDb, {}).ok).toBe(false);
    expect(authorizePrismaInvocation(inv('migrate-homolog', 'status'), { profile: 'migrate-test', purpose: 'migration', database: 'cardapio_digital_test' }, {}).ok).toBe(false);
  });
});

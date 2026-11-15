import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertNeonProxyTlsAck, NEON_HOMOLOG_PROFILE, NEON_PROXY_TLS_ACK, NeonHomologBlockedError } from '../../src/config/neonServerIdentity';
import { assertRuntimeDatabaseProfile, PRODUCTION_HOMOLOG_PROFILES } from '../../src/config/env';
import { assertHomologRuntimeConfig } from '../../src/config/homologRuntime';

describe('falha de inicialização quando um gate obrigatório não é satisfeito', () => {
  it('assertNeonProxyTlsAck bloqueia por padrão (undefined), com typo, com o valor de outro gate, e só aceita o valor exato', () => {
    for (const value of [undefined, '', 'yes', 'true', '1', 'accept-proxy-terminated-tls-pg-stat-ssl-flase', NEON_PROXY_TLS_ACK.toUpperCase()]) {
      expect(() => assertNeonProxyTlsAck(value)).toThrow(NeonHomologBlockedError);
    }
    expect(() => assertNeonProxyTlsAck(NEON_PROXY_TLS_ACK)).not.toThrow();
  });

  it('o perfil app-homolog-neon só roda com NODE_ENV=production; production aceita app-homolog OU app-homolog-neon, nunca outro', () => {
    expect(PRODUCTION_HOMOLOG_PROFILES.has(NEON_HOMOLOG_PROFILE)).toBe(true);
    expect(() => assertRuntimeDatabaseProfile(NEON_HOMOLOG_PROFILE, 'production')).not.toThrow();
    for (const runtime of ['development', '', 'test']) {
      expect(() => assertRuntimeDatabaseProfile(NEON_HOMOLOG_PROFILE, runtime)).toThrow(/NODE_ENV=production|app-test/);
    }
    for (const profile of ['app-dev', 'app-test', 'migrate-test', 'migrate-homolog', 'bootstrap-homolog']) {
      expect(() => assertRuntimeDatabaseProfile(profile, 'production')).toThrow(/app-homolog/);
    }
    // app-homolog (cluster dedicado) continua funcionando exatamente como antes
    expect(() => assertRuntimeDatabaseProfile('app-homolog', 'production')).not.toThrow();
  });

  it('assertHomologRuntimeConfig aceita os dois perfis de homologação com a mesma exigência de CORS https', () => {
    const base = { nodeEnv: 'production', corsOrigin: 'https://homolog.exemplo.invalid' };
    expect(() => assertHomologRuntimeConfig({ ...base, databaseProfile: 'app-homolog' })).not.toThrow();
    expect(() => assertHomologRuntimeConfig({ ...base, databaseProfile: NEON_HOMOLOG_PROFILE })).not.toThrow();
    expect(() => assertHomologRuntimeConfig({ ...base, databaseProfile: 'app-dev' })).toThrow(/app-homolog/);
    expect(() => assertHomologRuntimeConfig({ ...base, databaseProfile: NEON_HOMOLOG_PROFILE, corsOrigin: 'http://homolog.exemplo.invalid' })).toThrow(/CORS_ORIGIN/);
  });

  it('o reconhecimento humano é checado ANTES de qualquer conexão e nunca substitui a verificação de identidade/TLS', () => {
    const server = fs.readFileSync(path.join(process.cwd(), 'src', 'server.ts'), 'utf8');
    const ack = server.indexOf('assertNeonProxyTlsAck(');
    const loadProfile = server.indexOf('loadDatabaseProfile(env.databaseProfile');
    const readFacts = server.indexOf('readNeonServerFacts(');
    const problemsCheck = server.indexOf('if (problems.length > 0)');
    const prismaConfirm = server.indexOf('prisma.$queryRaw');
    expect(ack).toBeGreaterThan(-1);
    expect(ack).toBeLessThan(loadProfile);
    expect(loadProfile).toBeLessThan(readFacts);
    expect(readFacts).toBeLessThan(problemsCheck);
    // a confirmação complementar via Prisma só acontece DEPOIS do gate de identidade/TLS aprovar, nunca antes nem no lugar dele
    expect(problemsCheck).toBeLessThan(prismaConfirm);
    expect(server).not.toMatch(/TLS comprovado at[ée] o processo PostgreSQL/);
  });
});

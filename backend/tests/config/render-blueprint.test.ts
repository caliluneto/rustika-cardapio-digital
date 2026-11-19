import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { describe, expect, it } from 'vitest';
import { ENV_SECRET_VARIABLES, loadDatabaseProfile } from '../../src/config/secrets';
import { NEON_PROXY_TLS_ACK } from '../../src/config/neonServerIdentity';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const renderYamlPath = path.join(repoRoot, 'render.yaml');
const neonExamplePath = path.join(repoRoot, 'backend', 'config', 'homolog-examples', 'app-homolog-neon.env.example');

describe('Fase G — blueprint Render Free e exemplo sanitizado app-homolog-neon', () => {
  it('render.yaml usa exclusivamente plano gratuito, deploy manual, healthcheck /api/health e perfil app-homolog-neon', () => {
    const raw = fs.readFileSync(renderYamlPath, 'utf8');
    const code = raw.replace(/^\s*#.*$/gm, '');

    expect(code).toMatch(/\bplan:\s*free\b/);
    expect(code).toMatch(/\bautoDeploy:\s*false\b/);
    expect(code).toMatch(/\bhealthCheckPath:\s*\/api\/health\b/);
    expect(code).toMatch(/key:\s*NODE_ENV\s*\n\s*value:\s*production/);
    expect(code).toMatch(/key:\s*DB_PROFILE\s*\n\s*value:\s*app-homolog-neon/);
    expect(code).toMatch(/key:\s*CARDAPIO_SECRETS_SOURCE\s*\n\s*value:\s*env/);
    expect(code).toMatch(/key:\s*SERVE_FRONTEND\s*\n\s*value:\s*"on"/);
    expect(code).toMatch(/key:\s*TRUST_PROXY_HOPS\s*\n\s*value:\s*"1"/);
    expect(code).toMatch(/key:\s*HOMOLOG_GATE\s*\n\s*value:\s*"on"/);
    expect(code).toMatch(/key:\s*VITE_ORDER_SUBMISSION\s*\n\s*value:\s*enabled/);
  });

  it('render.yaml não executa migrations/bootstrap no build ou start e exige preenchimento manual (sync: false) para todos os segredos e reconhecimentos', () => {
    const raw = fs.readFileSync(renderYamlPath, 'utf8');
    const code = raw.replace(/^\s*#.*$/gm, '');

    expect(code).not.toMatch(/migrate\s+deploy|migrate\s+dev|db\s+push|bootstrap-admin|import-catalog|homolog:catalog/i);
    expect(code).not.toContain(NEON_PROXY_TLS_ACK);
    expect(code).not.toMatch(/postgresql:\/\/[^\s"]+:/i);
    expect(code).not.toContain('cardapio_homolog_migrator');
    expect(code).not.toContain('cardapio_homolog_bootstrap');
    expect(code).not.toContain('neondb_owner');

    const manualKeys = [
      'CORS_ORIGIN',
      'HOMOLOG_GATE_USER',
      'HOMOLOG_GATE_PASSWORD',
      'RUSTIKA_HOMOLOG_NEON_PROXY_TLS_ACK',
      ...Object.values(ENV_SECRET_VARIABLES),
    ];
    for (const key of manualKeys) {
      const pattern = new RegExp(`- key:\\s*${key}\\s*\\n\\s*sync:\\s*false\\b`);
      expect(code, `esperava ${key} com sync: false`).toMatch(pattern);
    }
  });

  it('app-homolog-neon.env.example contém apenas placeholders seguros, endpoint direto sem -pooler e é recusado como segredo real', () => {
    const raw = fs.readFileSync(neonExamplePath, 'utf8');
    const parsed = dotenv.parse(raw);

    expect(Object.keys(parsed).sort()).toEqual([
      'DATABASE_URL',
      'EXPECTED_CLUSTER_ID',
      'EXPECTED_DATABASE_HOST',
      'EXPECTED_PROJECT_ID',
    ]);
    expect(parsed.DATABASE_URL).toContain('cardapio_homolog_app:SENHA_URLENCODED_SUBSTITUA@');
    expect(parsed.DATABASE_URL).toContain('sslmode=require');
    expect(parsed.DATABASE_URL).toContain('sslaccept=strict');
    expect(parsed.DATABASE_URL).not.toContain('-pooler');
    expect(raw).not.toContain('aged-scene-47291697');
    expect(raw).not.toContain('ep-sweet-king-bd7i7ypb');

    // Se copiado sem substituir placeholders, loadDatabaseProfile deve recusar imediatamente
    expect(() =>
      loadDatabaseProfile('app-homolog-neon', {
        purpose: 'runtime',
        env: {
          CARDAPIO_SECRETS_SOURCE: 'env',
          RUSTIKA_HOMOLOG_DATABASE_URL: parsed.DATABASE_URL,
          RUSTIKA_HOMOLOG_EXPECTED_DATABASE_HOST: parsed.EXPECTED_DATABASE_HOST,
          RUSTIKA_HOMOLOG_EXPECTED_CLUSTER_ID: parsed.EXPECTED_CLUSTER_ID,
          RUSTIKA_HOMOLOG_EXPECTED_PROJECT_ID: parsed.EXPECTED_PROJECT_ID,
        },
      }),
    ).toThrow(/placeholder|exemplo|substitua/i);
  });
});

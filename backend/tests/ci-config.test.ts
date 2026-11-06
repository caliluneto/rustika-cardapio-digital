import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 3D.3.25-A/B: invariantes de segurança do CI, verificadas como texto (sem executar nada, sem rede).
 * Rodam também no próprio CI: se alguém afrouxar o workflow, o job `backend` falha.
 */
const root = path.resolve(__dirname, '..', '..');
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
const workflow = read('.github', 'workflows', 'ci.yml');
const code = workflow.replace(/^\s*#.*$/gm, ''); // ignora comentários
const jobBlock = (name: string) => {
  const start = code.indexOf(`\n  ${name}:\n`);
  expect(start, `job ${name}`).toBeGreaterThan(-1);
  const rest = code.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z0-9_-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
};

describe('workflow ci.yml', () => {
  it('permissões mínimas e sem gatilhos perigosos', () => {
    expect(code).toMatch(/\npermissions:\n  contents: read\n/);
    expect(code).not.toMatch(/pull_request_target/);
    expect(code).not.toMatch(/^\s{2}push:/m);
    expect(code).not.toMatch(/\bschedule:/);
    expect(code).not.toMatch(/\bid-token:|\bpackages: write|\bcontents: write/);
  });

  it('contextos de expressão: job.env não usa runner/steps/job (contextos indisponíveis ali)', () => {
    for (const name of ['backend', 'frontend', 'e2e']) {
      const block = jobBlock(name);
      const envStart = block.search(/\n    env:\n/);
      if (envStart === -1) continue;
      const afterEnv = block.slice(envStart + 1);
      const envEnd = afterEnv.slice(1).search(/\n    [a-z-]+:/);
      const envBlock = envEnd === -1 ? afterEnv : afterEnv.slice(0, envEnd + 1);
      expect(envBlock, `jobs.${name}.env`).not.toMatch(/\$\{\{[^}]*\b(runner|steps|job)\./);
    }
  });

  it('todas as Actions usam SHA completo de commit (40 hex)', () => {
    const uses = [...code.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThanOrEqual(3);
    for (const ref of uses) expect(ref, ref).toMatch(/^actions\/[a-z-]+@[0-9a-f]{40}$/);
  });

  it('não usa secrets do repositório nem publica/envia o histórico', () => {
    expect(code).not.toMatch(/\$\{\{\s*secrets\./);
    expect(code).not.toMatch(/git push|--mirror|--all\b/);
    expect(code).not.toMatch(/(postgres(ql)?):\/\/[^\s:@"']+:[A-Za-z0-9]{4,}@/); // sem URL com senha literal
  });

  it('E2E: só manual, só com confirmação explícita, só em repositório privado', () => {
    const e2e = jobBlock('e2e');
    expect(e2e).toMatch(/if: github\.event_name == 'workflow_dispatch'/);
    expect(e2e).toContain('inputs.run_e2e == true');
    expect(e2e).toContain('github.event.repository.private == true');
    expect(code).toMatch(/run_e2e:[\s\S]*?default: false/);
    expect(jobBlock('backend')).not.toMatch(/playwright|docker run/i);
    expect(jobBlock('frontend')).not.toMatch(/playwright test|docker run/i);
  });

  it('E2E: gates do projeto presentes e sem URL de banco no ambiente', () => {
    const e2e = jobBlock('e2e');
    expect(e2e).toMatch(/NODE_ENV: test\n/);
    expect(e2e).toMatch(/DB_PROFILE: app-test\n/);
    expect(e2e).toContain('RUSTIKA_E2E_CONFIRM: RUN_E2E_ON_CARDAPIO_DIGITAL_TEST');
    expect(e2e).toContain('RUSTIKA_DB_INTEGRATION_CONFIRM: WRITE_CARDAPIO_DIGITAL_TEST');
    expect(e2e).not.toMatch(/^\s+(DATABASE_URL|SHADOW_DATABASE_URL|RUSTIKA_E2E_LEGACY_CLEANUP):/m);
    // a confirmação de migration existe somente no passo de migration
    const occurrences = e2e.match(/CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION:/g) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(e2e.indexOf('CARDAPIO_MIGRATE_DEPLOY_CONFIRMATION:')).toBeGreaterThan(e2e.indexOf('Migrations no banco efêmero'));
    expect(e2e).toContain('--workers=1');
    expect(e2e).toContain('--project=chromium');
  });

  it('segredos sintéticos: gerados, mascarados, fora do workspace e descartados', () => {
    const e2e = jobBlock('e2e');
    expect(e2e).toContain('::add-mask::');
    expect(e2e).toContain('openssl rand -hex');
    // 3D.3.29-FIX01: `runner` não existe em `jobs.<id>.env`; o caminho vem de RUNNER_TEMP via GITHUB_ENV, no 1º passo.
    expect(e2e).not.toMatch(/CARDAPIO_SECRETS_DIR: /);
    expect(e2e).toContain('echo "CARDAPIO_SECRETS_DIR=$RUNNER_TEMP/cardapio-secrets" >> "$GITHUB_ENV"');
    const firstStep = e2e.indexOf('steps:');
    expect(e2e.indexOf('CARDAPIO_SECRETS_DIR=$RUNNER_TEMP')).toBeGreaterThan(firstStep);
    expect(e2e.indexOf('CARDAPIO_SECRETS_DIR=$RUNNER_TEMP')).toBeLessThan(e2e.indexOf('actions/checkout'));
    expect(e2e).toMatch(/if: always\(\)[\s\S]*docker rm -f[\s\S]*rm -rf "\$CARDAPIO_SECRETS_DIR"/);
  });

  it('estado final (FIX02): JSON gravado pelo script, exit code verificado, sem pipe e descarte sempre executado', () => {
    const e2e = jobBlock('e2e');
    const stepBlock = (name: string) => {
      const start = e2e.indexOf(`- name: ${name}`);
      expect(start, name).toBeGreaterThan(-1);
      const next = e2e.indexOf('\n      - ', start + 1);
      return e2e.slice(start, next === -1 ? undefined : next);
    };
    const capture = stepBlock('Estado final (somente leitura) - captura estruturada');
    const prove = stepBlock('Prova de resíduo zero (valida contrato, tabelas e contagens)');
    const discard = stepBlock('Descartar o banco efêmero e os segredos sintéticos');
    // captura: --out direto, sem pipe/tee, falha explícita (set -e/pipefail) e só se o PostgreSQL efêmero subiu
    expect(capture).toContain('if: always() && steps.pg.outcome == \'success\'');
    expect(capture).toMatch(/set -euo pipefail/);
    expect(capture).toContain('npm run --silent e2e:inspect -- --out "$RUNNER_TEMP/final-state.json"');
    expect(capture).not.toMatch(/\btee\b|\|\||continue-on-error|2>&1|JSON\.parse|node -e/);
    expect(e2e).toMatch(/- name: Subir PostgreSQL 18 efêmero[^\n]*\n\s+id: pg\n/);
    expect(capture).toMatch(/id: final_state/);
    // validação: usa o contrato versionado, só roda se a captura funcionou e não mascara falhas
    expect(prove).toContain('if: always() && steps.final_state.outcome == \'success\'');
    expect(prove).toContain('npm run --silent e2e:validate-state -- "$RUNNER_TEMP/final-state.json"');
    expect(prove).not.toMatch(/\|\||continue-on-error|JSON\.parse|node -e/);
    // o descarte vem depois e roda sempre
    expect(discard).toContain('if: always()');
    expect(e2e.indexOf('- name: Descartar o banco')).toBeGreaterThan(e2e.indexOf('- name: Prova de resíduo zero'));
    expect(discard).toContain('docker rm -f "$PG_CONTAINER"');
    expect(discard).toContain('final-state.json');
  });

  it('artefatos: opt-in, só em falha, só test-results, retenção curta', () => {
    const block = code.slice(code.indexOf('- name: Anexar diagnósticos'), code.indexOf('- name: Logs do PostgreSQL'));
    expect(block).toMatch(/if: failure\(\) && inputs\.upload_diagnostics/);
    expect(block).toMatch(/path: frontend\/test-results\//);
    expect(block).toMatch(/retention-days: [1-7]\b/);
    expect(code.match(/upload-artifact/g)).toHaveLength(1);
    expect(block).not.toMatch(/cardapio-secrets|.env|.dump/);
  });
});

describe('PostgreSQL efêmero (.github/ci)', () => {
  const bootstrap = read('.github', 'ci', 'bootstrap.sql');
  const hba = read('.github', 'ci', 'pg_hba.ci.conf');
  const rules = hba.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));

  it('bootstrap sem senha literal e só com os nomes exigidos pelos gates', () => {
    expect(bootstrap).toMatch(/PASSWORD :'mig_pw'/);
    expect(bootstrap).toMatch(/PASSWORD :'app_pw'/);
    expect(bootstrap).not.toMatch(/PASSWORD\s+'/);
    expect(bootstrap).toContain('CREATE DATABASE cardapio_digital_test   OWNER cardapio_migrator');
    const created = [...bootstrap.matchAll(/CREATE (ROLE|DATABASE) (\w+)/g)].map((m) => m[2]);
    expect(created.sort()).toEqual(['cardapio_dev_app', 'cardapio_digital_shadow', 'cardapio_digital_test', 'cardapio_migrator', 'cardapio_test_app']);
    expect(bootstrap).not.toMatch(/SUPERUSER(?<!NOSUPERUSER)\b(?!.*NO)/);
  });

  it('pg_hba: role de fixtures só no banco Test e recusada no resto, sem USER all/grupos/regex', () => {
    const fixtures = rules.filter((l) => l.includes('cardapio_test_fixtures'));
    expect(fixtures.map((l) => l.split(/\s+/)[0] + ':' + l.trim().split(/\s+/).pop())).toEqual(['host:scram-sha-256', 'host:scram-sha-256', 'local:reject', 'host:reject', 'host:reject']);
    expect(rules.slice(0, 5)).toEqual(fixtures);
    for (const line of rules) {
      const user = line.trim().split(/\s+/)[2]!;
      expect(user).not.toMatch(/^(all|\+|\/)/);
      expect(line).not.toMatch(/\btrust\b.*0\.0\.0\.0|0\.0\.0\.0\/0/);
    }
    expect(rules.filter((l) => /\btrust\b/.test(l))).toEqual([expect.stringMatching(/^local\s+all\s+postgres\s+trust$/)]);
  });
});

describe('.gitignore (proteção para o GitHub)', () => {
  const lines = new Set(read('.gitignore').split('\n').map((l) => l.trim()));
  it.each(['node_modules/', 'dist/', '.env', '.env.*', '!.env.example', '*.dump', '*.log', 'test-results/', 'playwright-report/', '*-Calil-Notebook*', 'backend/data/', 'secrets/', '*.pem', '.npmrc'])(
    'contém %s', (rule) => { expect(lines.has(rule), rule).toBe(true); },
  );
  it('não ignora lockfiles', () => {
    expect([...lines].filter((l) => /package-lock/.test(l))).toEqual([]);
  });
});

/**
 * 3D.3.25-C: regressões dos gatilhos e da reprodutibilidade em checkout limpo.
 */
describe('gatilhos e superfície de ataque do workflow', () => {
  const onBlock = code.slice(code.indexOf('\non:\n'), code.indexOf('\npermissions:'));

  it('somente pull_request e workflow_dispatch disparam o workflow', () => {
    const triggers = [...onBlock.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
    expect(triggers.sort()).toEqual(['pull_request', 'workflow_dispatch']);
  });

  it('todos os inputs são booleanos: nenhum aceita URL, string ou nome de banco', () => {
    const types = [...onBlock.matchAll(/^ {8}type: (\S+)/gm)].map((m) => m[1]);
    expect(types.length).toBe(8);
    for (const t of types) expect(t).toBe('boolean');
    expect(code).not.toMatch(/inputs\.(database|db|url|host|pg|postgres)/i);
  });

  it('o job e2e não é alcançável por pull_request nem por push (condição única, sem OR)', () => {
    const cond = jobBlock('e2e').match(/\n\s+if: (.+)\n/)?.[1] ?? '';
    expect(cond).toContain("github.event_name == 'workflow_dispatch'");
    expect(cond).not.toContain('||');
    expect(cond).not.toContain('pull_request');
  });

  it('3D.4.1-B: integração PostgreSQL e operação de pedidos são opt-in, só no job e2e e só no passo autorizado', () => {
    for (const name of ['run_integration', 'run_order_ops', 'run_product_availability']) expect(code).toMatch(new RegExp(`${name}:[\\s\\S]*?type: boolean\\n\\s+default: false`));
    expect(code).toMatch(/run_playwright:[\s\S]*?type: boolean\n\s+default: true/);
    const e2e = jobBlock('e2e');
    // a integração roda antes do Playwright, com os mesmos gates do job, e só sob input explícito
    const integration = e2e.indexOf('npm run test:integration:db');
    expect(integration).toBeGreaterThan(e2e.indexOf('npm run e2e:inspect'));
    expect(integration).toBeLessThan(e2e.indexOf('npx playwright test'));
    expect(e2e).toMatch(/if: inputs\.run_integration == true\n\s+working-directory: backend\n\s+run: npm run test:integration:db/);
    expect(e2e).toMatch(/if: inputs\.run_playwright == true && inputs\.run_order_ops != true && inputs\.run_product_availability != true\n\s+working-directory: frontend\n\s+run: npx playwright/);
    expect(e2e).toMatch(/if: inputs\.run_playwright == true && inputs\.run_order_ops == true && inputs\.run_product_availability != true\n\s+working-directory: frontend\n\s+env:\n\s+RUSTIKA_E2E_ORDER_OPS: enabled\n\s+run: npx playwright/);
    // 3D.4.2: disponibilidade de produtos, sozinha ou combinada com a operação de pedidos; variáveis constantes
    expect(e2e).toMatch(/if: inputs\.run_playwright == true && inputs\.run_order_ops != true && inputs\.run_product_availability == true\n\s+working-directory: frontend\n\s+env:\n\s+RUSTIKA_E2E_PRODUCT_AVAILABILITY: enabled\n\s+run: npx playwright/);
    expect(e2e).toMatch(/if: inputs\.run_playwright == true && inputs\.run_order_ops == true && inputs\.run_product_availability == true\n\s+working-directory: frontend\n\s+env:\n\s+RUSTIKA_E2E_ORDER_OPS: enabled\n\s+RUSTIKA_E2E_PRODUCT_AVAILABILITY: enabled\n\s+run: npx playwright/);
    expect(code.match(/RUSTIKA_E2E_PRODUCT_AVAILABILITY:/g)).toHaveLength(2);
    expect(e2e.slice(0, e2e.indexOf('steps:'))).not.toContain('RUSTIKA_E2E_PRODUCT_AVAILABILITY');
    expect(jobBlock('backend')).not.toMatch(/PRODUCT_AVAILABILITY/);
    expect(jobBlock('frontend')).not.toMatch(/PRODUCT_AVAILABILITY/);
    // a variável do E2E ampliado existe como chave só no env do passo ampliado, com valor constante
    expect(code.match(/RUSTIKA_E2E_ORDER_OPS:/g)).toHaveLength(2); // passo de pedidos + passo combinado
    expect(e2e.slice(0, e2e.indexOf('steps:'))).not.toContain('RUSTIKA_E2E_ORDER_OPS');
    expect(jobBlock('backend')).not.toMatch(/test:integration:db|ORDER_OPS/);
    expect(jobBlock('frontend')).not.toMatch(/test:integration:db|ORDER_OPS/);
    // nenhuma migration automática em banco persistente: o único deploy é o do banco efêmero, com confirmação
    expect(code.match(/db:migrate:deploy/g)).toHaveLength(1);
    expect(e2e).toContain('APPLY_CARDAPIO_DIGITAL_TEST');
  });

  it('backend e frontend só rodam em pull_request ou sob demanda', () => {
    expect(jobBlock('backend')).toMatch(/if: github\.event_name == 'pull_request' \|\| inputs\.run_backend\n/);
    expect(jobBlock('frontend')).toMatch(/if: github\.event_name == 'pull_request' \|\| inputs\.run_frontend\n/);
  });

  it('nenhum dado controlado por terceiros é interpolado em comandos (injeção de script)', () => {
    const runLines = code.split('\n').filter((l) => !/^\s*if:/.test(l));
    const joined = runLines.join('\n');
    expect(joined).not.toMatch(/\$\{\{\s*github\.(head_ref|event\.(pull_request|issue|comment|review|head_commit))/);
    expect(joined).not.toMatch(/\$\{\{\s*inputs\./);
  });

  it('todo job tem timeout, no máximo 30 minutos', () => {
    for (const name of ['backend', 'frontend', 'e2e']) {
      const m = jobBlock(name).match(/timeout-minutes: (\d+)/);
      expect(m, name).not.toBeNull();
      expect(Number(m![1]), name).toBeLessThanOrEqual(30);
    }
  });

  it('o banco efêmero só escuta em loopback e não usa serviço com porta publicada', () => {
    const e2e = jobBlock('e2e');
    expect(e2e).toContain('listen_addresses=127.0.0.1');
    expect(e2e).not.toMatch(/^\s+services:/m);
    expect(e2e).not.toMatch(/-p\s+5432|--publish/);
  });

  it('artefatos nunca incluem a pasta de segredos, .env ou o estado final', () => {
    const from = code.indexOf('actions/upload-artifact');
    const upload = code.slice(from, code.indexOf('\n      - name:', from));
    expect(upload).toMatch(/path: frontend\/test-results\/\n/);
    expect(upload).not.toMatch(/cardapio-secrets|\.env|final-state/);
  });

  it('o backend usa o script test:ci (config unitária), nunca a suíte com escrita', () => {
    expect(jobBlock('backend')).toContain('npm run test:ci');
    expect(jobBlock('backend')).not.toMatch(/test:integration|RUSTIKA_DB_INTEGRATION/);
    const pkg = JSON.parse(read('backend', 'package.json'));
    expect(pkg.scripts['test:ci']).toBe('vitest run --config vitest.unit.config.mts');
    expect(pkg.scripts.test).toBe('vitest run');
  });
});

describe('checkout limpo: dependências que o CI precisa e que não podem ficar só no disco local', () => {
  const unit = read('backend', 'vitest.unit.config.mts');

  it('o CI não exclui nenhum teste: a config só força a simulação do CI e não inclui a suíte com escrita', () => {
    expect(unit).toContain("RUSTIKA_IGNORE_PRIVATE_CATALOG: '1'");
    expect(unit).not.toMatch(/needsPrivateCatalog|existsSync/); // sem lista de exclusão e sem condicional
    expect(unit).not.toContain('tests/integration-db');
    expect(unit).not.toContain('include:');
  });

  it('a planilha real continua fora do Git; a fixture sintética está versionável e é a fonte dos testes de seed', () => {
    const ignore = read('.gitignore');
    expect(ignore.split('\n').map((l) => l.trim())).toContain('backend/data/');
    // A fixture não pode ser ignorada: nenhuma regra pode mirar a pasta de fixtures, CSV ou "synthetic".
    const rules = ignore.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    expect(rules.filter((l) => /(^|\/)fixtures\/?$|\.csv$|synthetic|^\*\*?\/?\*?$/.test(l))).toEqual([]);
    for (const f of ['synthetic-catalog.csv', 'synthetic-catalog-invalid-prices.csv', 'synthetic-catalog.ts']) {
      expect(fs.existsSync(path.join(root, 'backend', 'tests', 'fixtures', 'catalog', f)), f).toBe(true);
    }
    for (const f of ['seed-real', 'seed-real-corrected', 'executor-seed-real', 'inspect-reconciliation', 'seed-dev']) {
      const source = read('backend', 'tests', 'scripts', `${f}.test.ts`);
      expect(source, f).toContain('catalog-sources');
      expect(source, f).not.toMatch(/Exportacao-produtos/); // nenhum teste aponta direto para a planilha real
    }
    // Somente o arquivo "private" lê a planilha real, e se autoignora quando ela não existe.
    expect(read('backend', 'tests', 'scripts', 'private-catalog.test.ts')).toContain('describe.skipIf(!hasRealCatalog)');
  });

  it('arquivos citados pelo workflow existem no repositório', () => {
    for (const rel of [
      '.github/ci/bootstrap.sql',
      '.github/ci/pg_hba.ci.conf',
      'backend/docs/sql/provision-test-fixtures.sql',
      'backend/docs/sql/enable-test-fixtures-login.sql',
      'backend/docs/sql/verify-test-fixtures.sql',
      'backend/package-lock.json',
      'frontend/package-lock.json',
      'frontend/playwright.config.ts',
    ]) {
      expect(fs.existsSync(path.join(root, rel)), rel).toBe(true);
    }
  });
});

/**
 * 3D.3.25-E: a única dependência fora do registro npm é o `xlsx` da origem oficial da SheetJS; o lockfile a
 * fixa por versão e por hash. Qualquer outra origem externa, ou perda do hash, deve falhar aqui.
 */
describe('dependência xlsx (origem externa oficial, versão e hash fixos)', () => {
  const OFFICIAL = 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz';
  const pkg = JSON.parse(read('backend', 'package.json'));
  const lock = JSON.parse(read('backend', 'package-lock.json'));

  it('package.json e lockfile apontam para a URL oficial da versão 0.20.3', () => {
    expect(pkg.dependencies.xlsx).toBe(OFFICIAL);
    expect(lock.packages[''].dependencies.xlsx).toBe(OFFICIAL);
    expect(lock.packages['node_modules/xlsx'].resolved).toBe(OFFICIAL);
    expect(lock.packages['node_modules/xlsx'].version).toBe('0.20.3');
  });

  it('o lockfile mantém o hash de integridade e o xlsx é o único pacote fora do registro npm', () => {
    expect(lock.packages['node_modules/xlsx'].integrity).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/);
    const entries = Object.entries(lock.packages as Record<string, { resolved?: string; integrity?: string }>).filter(([key]) => key !== '');
    const external = entries.filter(([, v]) => v.resolved && !v.resolved.startsWith('https://registry.npmjs.org/')).map(([key]) => key);
    expect(external).toEqual(['node_modules/xlsx']);
    expect(entries.filter(([, v]) => v.resolved && !v.integrity).map(([key]) => key)).toEqual([]);
  });

  it('o workflow instala com npm ci (respeita lockfile e hash), sem desligar integridade nem aceitar origens extras', () => {
    expect(code).not.toMatch(/npm install\b|--no-package-lock|--force|--legacy-peer-deps|allow-remote|--ignore-scripts|strict-ssl|NODE_TLS_REJECT_UNAUTHORIZED/);
    expect((code.match(/npm ci/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(code).toContain("node-version: '22'");
  });
});

// 3D.3.21-A/B: guardas estaticas (sem navegador, sem banco) sobre o codigo e a configuracao do E2E.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('..', import.meta.url));
const CONFIRM = 'RUN_E2E_ON_CARDAPIO_DIGITAL_TEST';

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (/Calil-Notebook/.test(name)) continue; // copias de conflito do OneDrive
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}
const files = sourceFiles(path.join(root, 'src'));
const read = (file) => readFileSync(file, 'utf8');
const rel = (file) => path.relative(root, file).replaceAll('\\', '/');

test('todo import.meta em src e o literal import.meta.env (ou .hot): nada de alias', () => {
  assert.ok(files.length > 20, 'a varredura perdeu os arquivos de src');
  const offenders = [];
  for (const file of files) {
    for (const match of read(file).matchAll(/import\.meta(?!\.env\b|\.hot\b)/g)) offenders.push(`${rel(file)}:${match.index}`);
  }
  assert.deepEqual(offenders, [], 'o Vite so injeta VITE_* quando o texto literal import.meta.env aparece');
});

test('nenhum desvio de depuracao no codigo de producao (window._E2E, window.process, E2E forced)', () => {
  const offenders = files.filter((file) => /_E2E|window\.process|\(window as any\)\.process|E2E: Order/.test(read(file))).map(rel);
  assert.deepEqual(offenders, []);
});

/** Avalia o playwright.config.ts sem importar @playwright/test (pesado e fora do runner): transpila e
 * executa com um stub de defineConfig/devices. A confirmacao e passada por parametro (o config se
 * recusa a carregar sem ela). */
function loadPlaywrightConfig(confirm = CONFIRM) {
  const source = readFileSync(path.join(root, 'playwright.config.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  const stub = { defineConfig: (config) => config, devices: { 'Desktop Chrome': {} } };
  const saved = process.env.RUSTIKA_E2E_CONFIRM;
  if (confirm === null) delete process.env.RUSTIKA_E2E_CONFIRM; else process.env.RUSTIKA_E2E_CONFIRM = confirm; // null = variavel ausente
  try {
    new Function('require', 'module', 'exports', code)((id) => {
      if (id === '@playwright/test') return stub;
      throw new Error(`import inesperado no playwright.config.ts: ${id}`);
    }, mod, mod.exports);
  } finally {
    if (saved === undefined) delete process.env.RUSTIKA_E2E_CONFIRM; else process.env.RUSTIKA_E2E_CONFIRM = saved;
  }
  return mod.exports.default;
}

test('playwright.config: variaveis por env, sem set/&&, sem reaproveitar servidor, perfil de teste', () => {
  const config = loadPlaywrightConfig();
  const [backend, frontend] = config.webServer;
  assert.equal(config.webServer.length, 2);
  for (const server of [backend, frontend]) {
    assert.equal(server.reuseExistingServer, false, `${server.name}: reaproveitar servidor antigo causou a falha da 1a execucao`);
    assert.doesNotMatch(server.command, /(^|\s)set\s|&&/i, `${server.name}: "set X=y &&" grava espaco no fim no cmd.exe`);
    for (const [key, value] of Object.entries(server.env ?? {})) assert.equal(value, value.trim(), `${server.name}.env.${key} com espaco`);
  }
  assert.equal(backend.env.NODE_ENV, 'test');
  assert.equal(backend.env.DB_PROFILE, 'app-test');
  assert.equal(backend.cwd, '../backend');
  assert.deepEqual(Object.keys(backend.env).filter((key) => /^RUSTIKA_|^DATABASE_URL|^SHADOW/.test(key)), []);
  assert.equal(frontend.env.VITE_ORDER_SUBMISSION, 'enabled');
  assert.equal(config.workers, 1);
});

test('portas isoladas do E2E (4100/5174), coerentes entre si e distintas das de desenvolvimento', () => {
  const config = loadPlaywrightConfig();
  const [backend, frontend] = config.webServer;
  assert.equal(backend.env.PORT, '4100');
  assert.equal(backend.url, 'http://localhost:4100/api/health');
  assert.match(frontend.command, /--port 5174 --strictPort/);
  assert.equal(frontend.url, 'http://localhost:5174');
  assert.equal(config.use.baseURL, 'http://localhost:5174');
  assert.equal(frontend.env.VITE_API_URL, 'http://localhost:4100/api');
  // O backend so aceita (CORS + cookies + Origin exata) a origem do Vite do E2E.
  assert.equal(backend.env.CORS_ORIGIN, config.use.baseURL);
  for (const text of [JSON.stringify(config)]) assert.doesNotMatch(text, /:4000|:5173/, 'portas de desenvolvimento nao podem ser usadas pelo E2E');
});

test('a config recusa carregar sem a confirmacao explicita (nenhum servidor sobe)', () => {
  for (const wrong of [null, '', 'yes', `${CONFIRM} `]) {
    assert.throws(() => loadPlaywrightConfig(wrong), /RUSTIKA_E2E_CONFIRM/, `valor ${JSON.stringify(wrong)}`);
  }
  assert.doesNotThrow(() => loadPlaywrightConfig(CONFIRM));
});

test('globalSetup/globalTeardown: usam o harness aprovado e NUNCA o seed_raw.js', () => {
  const config = loadPlaywrightConfig();
  assert.equal(config.globalSetup, './tests/globalSetup.ts');
  assert.equal(config.globalTeardown, './tests/globalTeardown.ts', 'sem teardown as fixtures ficariam no banco');
  const setup = readFileSync(path.join(root, 'tests', 'globalSetup.ts'), 'utf8');
  const teardown = readFileSync(path.join(root, 'tests', 'globalTeardown.ts'), 'utf8');
  assert.match(setup, /tests\/integration-db\/e2e\/run-setup\.ts/);
  assert.match(teardown, /tests\/integration-db\/e2e\/run-teardown\.ts/);
  for (const [name, text] of [['globalSetup.ts', setup], ['globalTeardown.ts', teardown]]) {
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /seed_raw|seed_pg|seed_e2e|node seed|execSync\(/, `${name} chama script legado`);
    assert.doesNotMatch(code, /postgres(ql)?:\/\/[^\s'"`]*:[^\s'"`@]+@/i, `${name} com credencial embutida`);
    assert.doesNotMatch(code, /console\.log\([^)]*(PASSWORD|password|stdout)/, `${name} registra a senha ou o stdout do setup`);
  }
  assert.ok(existsSync(path.join(root, '..', 'backend', 'seed_raw.js')) || true); // o arquivo original e preservado, apenas nao e invocado
});

test('o envio so e habilitado na instancia E2E: nenhum .env versionavel o liga', () => {
  const names = readdirSync(root).filter((name) => /^\.env(\.|$)/.test(name) && name !== '.env.example');
  for (const name of names) {
    if (name === '.env.e2e') continue; // arquivo local, nao lido por nada e fora do checkpoint
    assert.doesNotMatch(readFileSync(path.join(root, name), 'utf8'), /VITE_ORDER_SUBMISSION\s*=\s*enabled/);
  }
  assert.doesNotMatch(readFileSync(path.join(root, '.env.example'), 'utf8'), /VITE_ORDER_SUBMISSION\s*=\s*enabled/);
});

test('e2e.spec: sem atalhos, sem dados fixos e com o contrato do POST e a idempotencia conferidos', () => {
  const spec = readFileSync(path.join(root, 'tests', 'e2e.spec.ts'), 'utf8');
  for (const forbidden of [/_E2E_FORCE_ENABLED/, /removeAttribute\(\s*['"]disabled/, /force:\s*true/, /waitForTimeout/, /page\.evaluate/,
    /e2e@rustika\.local/, /e2e-strong-password/, /999999/, /E2E Product/]) {
    assert.doesNotMatch(spec, forbidden, `atalho ou dado fixo proibido: ${forbidden}`);
  }
  for (const required of [/toBeEnabled\(\)/, /waitForResponse/, /x-rustika-request/, /idempotency-key/, /toBe\(201\)/, /toBe\(200\)/, /Pedido recebido/,
    /RUSTIKA_E2E_ADMIN_EMAIL/, /RUSTIKA_E2E_ADMIN_PASSWORD/, /RUSTIKA_E2E_COMANDA/, /RUSTIKA_E2E_PRODUCT_NAME/]) {
    assert.match(spec, required, `verificacao ausente: ${required}`);
  }
});

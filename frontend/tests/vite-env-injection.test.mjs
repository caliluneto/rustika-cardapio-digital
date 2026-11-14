// 3D.3.21-A: regressao do defeito que impediu o checkout E2E.
// `const meta = import.meta; meta.env?.VITE_ORDER_SUBMISSION` nunca recebia o `env` (o Vite so injeta
// `import.meta.env = {...}` em modulos que contem o texto literal `import.meta.env`), entao
// VITE_ORDER_SUBMISSION=enabled nao tinha efeito algum. Estes testes exercitam o proprio Vite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { orderSubmissionEnabled } from '../src/services/orderSubmission.ts';
import { configuredApiUrl } from '../src/services/api.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

test('orderSubmissionEnabled: so "enabled" (com trim) liga o envio', () => {
  assert.equal(orderSubmissionEnabled({ VITE_ORDER_SUBMISSION: 'enabled' }), true);
  assert.equal(orderSubmissionEnabled({ VITE_ORDER_SUBMISSION: ' enabled ' }), true); // cmd.exe deixa espaco no fim
  for (const value of ['true', '1', 'ENABLED', 'enable', '', undefined]) {
    assert.equal(orderSubmissionEnabled({ VITE_ORDER_SUBMISSION: value }), false, `valor ${JSON.stringify(value)}`);
  }
  assert.equal(orderSubmissionEnabled({}), false);
  assert.equal(orderSubmissionEnabled(), false); // fora do Vite import.meta.env e undefined: continua desligado
});

test('orderSubmissionEnabled: nenhum desvio em window liga o envio', () => {
  const previous = globalThis.window;
  globalThis.window = { _E2E_FORCE_ENABLED: true, process: { env: { VITE_ORDER_SUBMISSION: 'enabled' } } };
  try { assert.equal(orderSubmissionEnabled({}), false); } finally {
    if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
  }
});

test('configuredApiUrl: usa VITE_API_URL; sem configuração usa local em dev e mesma origem no build', () => {
  assert.equal(configuredApiUrl({ VITE_API_URL: ' https://api.exemplo.test/api ' }), 'https://api.exemplo.test/api');
  assert.equal(configuredApiUrl({ DEV: true }), 'http://localhost:4000/api');
  assert.equal(configuredApiUrl({ VITE_API_URL: '   ', DEV: true }), 'http://localhost:4000/api');
  assert.equal(configuredApiUrl({ DEV: false }), '/api');
  assert.equal(configuredApiUrl({}), '/api');
});

test('o Vite injeta VITE_ORDER_SUBMISSION e VITE_API_URL nos modulos reais (sem abrir porta)', async () => {
  const { createServer } = await import('vite');
  const saved = { a: process.env.VITE_ORDER_SUBMISSION, b: process.env.VITE_API_URL };
  process.env.VITE_ORDER_SUBMISSION = 'enabled';
  process.env.VITE_API_URL = 'http://localhost:4000/api';
  const server = await createServer({
    root, configFile: false, logLevel: 'silent', appType: 'custom',
    server: { middlewareMode: true, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    for (const [file, key, expected] of [
      ['/src/services/orderSubmission.ts', 'VITE_ORDER_SUBMISSION', 'enabled'],
      ['/src/services/api.ts', 'VITE_API_URL', 'http://localhost:4000/api'],
    ]) {
      const { code } = await server.transformRequest(file);
      const match = code.match(/import\.meta\.env = (\{[^;]*\});/);
      assert.ok(match, `${file}: o Vite nao injetou import.meta.env (leitura por alias?)`);
      assert.equal(JSON.parse(match[1])[key], expected, `${file}: ${key} ausente no env injetado`);
    }
  } finally {
    await server.close();
    for (const [name, value] of [['VITE_ORDER_SUBMISSION', saved.a], ['VITE_API_URL', saved.b]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

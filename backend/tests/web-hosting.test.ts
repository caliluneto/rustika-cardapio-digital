import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { createStaticFrontend, FrontendBuildMissingError } from '../src/web/staticFrontend';

let parent: string;
let dist: string;

beforeAll(() => {
  parent = fs.mkdtempSync(path.join(os.tmpdir(), 'rustika-web-'));
  dist = path.join(parent, 'dist');
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(dist, 'rustika'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Rustika</title><div id="root"></div>');
  fs.writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log("app")');
  fs.writeFileSync(path.join(dist, 'assets', 'index-abc123.css'), 'body{margin:0}');
  fs.writeFileSync(path.join(dist, 'assets', 'index-abc123.js.map'), '{"sources":["secret"]}');
  fs.writeFileSync(path.join(dist, 'rustika', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(dist, '.env'), 'SEGREDO=1');
  fs.writeFileSync(path.join(dist, '.hidden'), 'oculto');
  fs.writeFileSync(path.join(dist, 'server.key'), 'chave');
  fs.writeFileSync(path.join(parent, 'fora.txt'), 'arquivo fora do diretório publicado');
});
afterAll(() => { fs.rmSync(parent, { recursive: true, force: true }); });

const fakePrisma = (impl: () => Promise<unknown>) => ({ $queryRaw: vi.fn(impl) }) as unknown as PrismaClient;
const hosted = (prisma?: PrismaClient) => createApp({ prisma, web: { frontendDir: dist } });

describe('frontend estático na mesma origem', () => {
  it('sem configuração web o comportamento anterior é mantido: somente API, "/" é 404 JSON', async () => {
    const response = await request(createApp()).get('/');
    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/json/);
  });

  it('GET / devolve o index.html sem cache; HEAD também; nosniff e sem X-Powered-By', async () => {
    const response = await request(hosted()).get('/');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.text).toContain('id="root"');
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
    const head = await request(hosted()).head('/');
    expect(head.status).toBe(200);
    const explicit = await request(hosted()).get('/index.html');
    expect(explicit.status).toBe(200);
    expect(explicit.headers['cache-control']).toBe('no-cache');
  });

  it('serve JS, CSS e imagens com tipos corretos; assets com hash são imutáveis', async () => {
    const js = await request(hosted()).get('/assets/index-abc123.js');
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toMatch(/javascript/);
    expect(js.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const css = await request(hosted()).get('/assets/index-abc123.css');
    expect(css.headers['content-type']).toMatch(/text\/css/);
    const png = await request(hosted()).get('/rustika/logo.png');
    expect(png.status).toBe(200);
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.headers['cache-control']).toBe('public, max-age=3600');
  });

  it('rotas /api continuam intactas: health 200 JSON, ready 503 sem banco e 200 com banco', async () => {
    const health = await request(hosted()).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.data.status).toBe('ok');
    expect((await request(hosted()).get('/api/ready')).status).toBe(503);
    const ready = await request(hosted(fakePrisma(async () => [1]))).get('/api/ready');
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ success: true, data: { status: 'ready' } });
    expect(ready.headers['cache-control']).toBe('no-store');
  });

  it('/api desconhecido nunca recebe HTML de sucesso: 404 JSON (qualquer método, caixa ou barra)', async () => {
    for (const url of ['/api/nao-existe', '/api', '/api/', '/API/nao-existe', '/api/assets/index-abc123.js', '/api/index.html']) {
      const response = await request(hosted()).get(url);
      expect(response.status, url).toBeGreaterThanOrEqual(400);
      expect(response.headers['content-type'], url).not.toMatch(/html/);
      expect(response.text, url).not.toContain('id="root"');
    }
    const post = await request(hosted()).post('/api/nao-existe').send({});
    expect(post.status).toBe(404);
    expect(post.headers['content-type']).toMatch(/json/);
  });

  it('caminhos inexistentes são 404 (sem fallback de SPA com HTML 200) e métodos de escrita não chegam aos estáticos', async () => {
    for (const url of ['/inexistente', '/admin', '/assets/nao-existe.js', '/rustika/nao-existe.png']) {
      const response = await request(hosted()).get(url);
      expect(response.status, url).toBe(404);
      expect(response.text, url).not.toContain('id="root"');
    }
    expect((await request(hosted()).post('/')).status).toBe(404);
    expect((await request(hosted()).put('/assets/index-abc123.js')).status).toBe(404);
    expect((await request(hosted()).delete('/index.html')).status).toBe(404);
  });

  it('não expõe arquivos internos: dotfiles, mapas, chaves, traversal e codificações', async () => {
    const forbidden = [
      '/.env', '/.hidden', '/server.key', '/assets/index-abc123.js.map', '/assets/index-abc123.js%2Emap', '/assets/index-abc123.js.%6dap',
      '/../fora.txt', '/%2e%2e/fora.txt', '/..%2ffora.txt', '/assets/..%2f..%2ffora.txt', '/assets/../../fora.txt', '/%00', '/assets/%00.js',
      '/%2e%65nv', '/rustika/..%5c..%5cfora.txt',
    ];
    for (const url of forbidden) {
      const response = await request(hosted()).get(url);
      expect([400, 403, 404], url).toContain(response.status);
      expect(response.text, url).not.toContain('SEGREDO');
      expect(response.text, url).not.toContain('arquivo fora do diretório');
      expect(response.text, url).not.toContain('chave');
      expect(response.text, url).not.toContain('sources');
    }
  });

  it('cache: sem portão os arquivos são public; com portão passam a private (conteúdo autenticado não vai a cache compartilhado)', async () => {
    const gate = { user: 'operador', password: 'Senha-Longa-De-Teste-000-xyz' };
    const auth = `Basic ${Buffer.from(`${gate.user}:${gate.password}`).toString('base64')}`;
    const open = await request(hosted()).get('/assets/index-abc123.js');
    expect(open.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const app = createApp({ web: { frontendDir: dist, gate } });
    const js = await request(app).get('/assets/index-abc123.js').set('Authorization', auth);
    expect(js.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect((await request(app).get('/rustika/logo.png').set('Authorization', auth)).headers['cache-control']).toBe('private, max-age=3600');
    expect((await request(app).get('/').set('Authorization', auth)).headers['cache-control']).toBe('no-cache');
  });

  it('a raiz pode ficar dentro de um diretório com ponto (ex.: /home/runner/.cache/...) sem bloquear o index.html', async () => {
    const dotted = path.join(parent, '.cache', 'frontend', 'dist');
    fs.mkdirSync(path.join(dotted, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dotted, 'index.html'), '<div id="root"></div>');
    fs.writeFileSync(path.join(dotted, 'assets', 'a-1.js'), 'x');
    const app = createApp({ web: { frontendDir: dotted } });
    expect((await request(app).get('/')).status).toBe(200);
    expect((await request(app).get('/assets/a-1.js')).status).toBe(200);
    expect((await request(app).get('/.cache/frontend/dist/index.html')).status).toBe(404);
  });

  it('falha fechada se o build do frontend não existir', () => {
    expect(() => createStaticFrontend(path.join(parent, 'nao-existe'))).toThrow(FrontendBuildMissingError);
    expect(() => createApp({ web: { frontendDir: path.join(parent, 'nao-existe') } })).toThrow(/Build do frontend ausente/);
  });

  it('a ordem dos middlewares é API → estáticos → 404 (verificação estática do app.ts)', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'app.ts'), 'utf8');
    const orders = source.indexOf("app.use('/api/orders'");
    const statics = source.indexOf('createStaticFrontend(web.frontendDir');
    const notFound = source.indexOf('app.use(notFound)');
    expect(orders).toBeGreaterThan(0);
    expect(statics).toBeGreaterThan(orders);
    expect(notFound).toBeGreaterThan(statics);
  });
});

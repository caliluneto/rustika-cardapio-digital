import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { clientAddress } from '../src/security/accessLimits';
import { GATE_MAX_FAILURES, GATE_WINDOW_MS, createHomologGate } from '../src/security/homologGate';

const GATE = { user: 'homolog.operador', password: 'Senha-Longa-De-Teste-000-xyz' };
const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
const GOOD = basic(GATE.user, GATE.password);

let dist: string;
beforeAll(() => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'rustika-gate-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<div id="root"></div>');
});
afterAll(() => { fs.rmSync(dist, { recursive: true, force: true }); });

const gated = (extra: Record<string, unknown> = {}, clock?: () => Date) =>
  createApp({ authClock: clock, web: { frontendDir: dist, gate: GATE, noindex: true, ...extra } });

describe('3D.5.3-B - portão HTTP Basic da homologação', () => {
  it('desativado por padrão: sem configuração nada pede credencial', async () => {
    const response = await request(createApp({ web: { frontendDir: dist } })).get('/');
    expect(response.status).toBe(200);
    expect(response.headers['www-authenticate']).toBeUndefined();
    expect(response.headers['x-robots-tag']).toBeUndefined();
  });

  it('sem credencial: 401 com desafio Basic e sem cache, para página, assets e API', async () => {
    for (const url of ['/', '/index.html', '/assets/x.js', '/api/catalog', '/api/products', '/api/admin/orders', '/api/orders', '/qualquer']) {
      const response = await request(gated()).get(url);
      expect(response.status, url).toBe(401);
      expect(response.headers['www-authenticate'], url).toMatch(/^Basic realm="[^"]+", charset="UTF-8"$/);
      expect(response.headers['cache-control'], url).toBe('no-store');
      expect(response.text, url).not.toContain('id="root"');
    }
    expect((await request(gated()).post('/api/orders').send({})).status).toBe(401);
  });

  it('credencial correta: libera página e rotas da API (sem alterar o comportamento delas)', async () => {
    expect((await request(gated()).get('/').set('Authorization', GOOD)).status).toBe(200);
    const unknownApi = await request(gated()).get('/api/nao-existe').set('Authorization', GOOD);
    expect(unknownApi.status).toBe(404);
    expect(unknownApi.headers['content-type']).toMatch(/json/);
    expect((await request(gated()).get('/inexistente').set('Authorization', GOOD)).status).toBe(404);
  });

  it('credenciais erradas ou malformadas: 401 (usuário, senha, esquema, base64, sem dois-pontos, vazias)', async () => {
    const bad = [
      basic('outro', GATE.password), basic(GATE.user, 'errada'), basic(GATE.user, ''), basic('', ''), basic(GATE.user.toUpperCase(), GATE.password),
      basic(GATE.user, `${GATE.password} `), `Bearer ${Buffer.from(`${GATE.user}:${GATE.password}`).toString('base64')}`, 'Basic !!!', 'Basic',
      `Basic ${Buffer.from(GATE.user).toString('base64')}`, `basic ${Buffer.from(`${GATE.user}:${GATE.password}`).toString('base64')}`,
    ];
    for (const header of bad) expect((await request(gated()).get('/').set('Authorization', header)).status, header).toBe(401);
  });

  it('exceção mínima: somente GET/HEAD em /api/health exato; /api/ready e o resto continuam protegidos', async () => {
    expect((await request(gated()).get('/api/health')).status).toBe(200);
    expect((await request(gated()).head('/api/health')).status).toBe(200);
    expect((await request(gated()).get('/api/health?x=1')).status).toBe(200);
    for (const url of ['/api/ready', '/api/ready?x=1', '/api/health/', '/API/HEALTH', '/api/health/x', '/api/healthz', '//api/health', '/api/health%2f',
      '/api/admin/health', '/%61pi/health', '/api/%68ealth']) {
      expect((await request(gated()).get(url)).status, url).toBe(401);
    }
    for (const method of ['post', 'put', 'delete', 'patch'] as const) {
      expect((await request(gated())[method]('/api/health').send({})).status, method).toBe(401);
    }
  });

  it('/api/ready exige credencial (não é sonda pública do banco) e funciona com ela', async () => {
    expect((await request(gated()).get('/api/ready')).status).toBe(401);
    expect((await request(gated()).get('/api/ready').set('Authorization', GOOD)).status).toBe(503); // sem banco no teste
  });

  it('o health check não vaza dados internos nem credenciais', async () => {
    const health = await request(gated()).get('/api/health');
    expect(JSON.stringify(health.body)).not.toMatch(/password|senha|homolog|authorization|database|banco/i);
    expect(health.headers['www-authenticate']).toBeUndefined();
  });

  it('o 429 do portão também não registra nem devolve credenciais', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => undefined));
    const app = gated();
    let last = 0;
    for (let i = 0; i <= GATE_MAX_FAILURES; i += 1) {
      const response = await request(app).get('/').set('Authorization', basic(GATE.user, `tentativa-${i}`));
      last = response.status;
      expect(`${response.text}${JSON.stringify(response.headers)}`).not.toContain(`tentativa-${i}`);
    }
    const logged = spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join('\n');
    spies.forEach((spy) => spy.mockRestore());
    expect(last).toBe(429);
    expect(logged).not.toMatch(/tentativa-|Senha-Longa|Basic /);
  });

  it('proteção contra tentativas repetidas: após o limite, 429 mesmo com a credencial correta; a janela expira', async () => {
    let time = Date.UTC(2026, 10, 6, 12, 0, 0);
    const app = gated({}, () => new Date(time));
    for (let i = 0; i < GATE_MAX_FAILURES; i += 1) {
      expect((await request(app).get('/').set('Authorization', basic(GATE.user, `errada-${i}`))).status).toBe(401);
    }
    const last = await request(app).get('/').set('Authorization', basic(GATE.user, 'errada-final'));
    expect(last.status).toBe(429);
    expect(Number(last.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    const withGood = await request(app).get('/').set('Authorization', GOOD);
    expect(withGood.status).toBe(429);
    expect(withGood.text).not.toContain('id="root"');
    time += GATE_WINDOW_MS + 1000;
    expect((await request(app).get('/').set('Authorization', GOOD)).status).toBe(200);
  });

  it('a ausência de cabeçalho (primeira visita do navegador) não conta como tentativa', async () => {
    const app = gated();
    for (let i = 0; i < GATE_MAX_FAILURES * 2; i += 1) expect((await request(app).get('/')).status).toBe(401);
    expect((await request(app).get('/').set('Authorization', GOOD)).status).toBe(200);
  });

  it('noindex: X-Robots-Tag em respostas 200, 401 e 404', async () => {
    for (const [url, header] of [['/', GOOD], ['/', undefined], ['/inexistente', GOOD]] as const) {
      const r = request(gated()).get(url);
      const response = await (header ? r.set('Authorization', header) : r);
      expect(response.headers['x-robots-tag'], `${url} ${response.status}`).toBe('noindex, nofollow, noarchive');
    }
  });

  it('o portão não substitui CSRF/Origin/autenticação: com credencial do portão, escrita sem Origin continua 403 e admin sem sessão 401', async () => {
    const write = await request(gated()).post('/api/admin/auth/login').set('Authorization', GOOD).set('Content-Type', 'application/json').send({});
    expect(write.status).toBe(403);
    expect(write.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    const admin = await request(gated()).get('/api/admin/orders').set('Authorization', GOOD);
    expect([401, 503]).toContain(admin.status);
    expect(admin.headers['www-authenticate']).toBeUndefined();
  });

  it('as credenciais não aparecem em respostas nem em logs, e o código não tem credenciais fixas', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => undefined));
    const app = gated();
    const responses = [
      await request(app).get('/').set('Authorization', basic(GATE.user, 'tentativa-errada')),
      await request(app).get('/'),
      await request(app).get('/').set('Authorization', GOOD),
    ];
    const logged = spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join('\n');
    spies.forEach((spy) => spy.mockRestore());
    for (const response of responses) {
      const blob = `${response.text}${JSON.stringify(response.headers)}`;
      expect(blob).not.toContain(GATE.password);
      expect(blob).not.toContain(Buffer.from(`${GATE.user}:${GATE.password}`).toString('base64'));
    }
    expect(logged).not.toContain(GATE.password);
    expect(logged).not.toContain('tentativa-errada');
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'security', 'homologGate.ts'), 'utf8');
    expect(source).not.toMatch(/console\./);
    expect(source).toContain('timingSafeEqual');
    expect(source).not.toMatch(/password\s*===|===\s*config\.password|user\s*===/);
  });
});

describe('3D.5.3-B - proxy reverso e rate limiting', () => {
  const echo = (hops: number) => {
    const app = express();
    if (hops > 0) app.set('trust proxy', hops);
    app.get('/ip', (req, res) => { res.json({ ip: req.ip, key: clientAddress(req) }); });
    return app;
  };

  it('padrão (0 saltos): X-Forwarded-For forjado é ignorado e o endereço é o do socket', async () => {
    const response = await request(createApp({ web: {} })).get('/api/health').set('X-Forwarded-For', '203.0.113.9');
    expect(response.status).toBe(200);
    const a = await request(echo(0)).get('/ip').set('X-Forwarded-For', '203.0.113.9');
    const b = await request(echo(0)).get('/ip').set('X-Forwarded-For', '198.51.100.77');
    expect(a.body.key).toBe(b.body.key);
    expect(a.body.ip).not.toContain('203.0.113.9');
  });

  it('1 salto: usa o endereço acrescentado pelo proxy (o mais à direita); entradas forjadas à esquerda são ignoradas', async () => {
    const a = await request(echo(1)).get('/ip').set('X-Forwarded-For', '6.6.6.6, 203.0.113.9');
    const b = await request(echo(1)).get('/ip').set('X-Forwarded-For', '7.7.7.7, 203.0.113.9');
    const c = await request(echo(1)).get('/ip').set('X-Forwarded-For', '7.7.7.7, 198.51.100.77');
    expect(a.body.key).toBe('203.0.113.9');
    expect(b.body.key).toBe('203.0.113.9');
    expect(c.body.key).toBe('198.51.100.77');
  });

  it('createApp respeita web.trustProxyHops e o padrão é não confiar (sem `trust proxy`)', () => {
    expect(createApp({ web: {} }).get('trust proxy')).toBeFalsy();
    expect(createApp({ web: { trustProxyHops: 0 } }).get('trust proxy')).toBeFalsy();
    expect(createApp({ web: { trustProxyHops: 1 } }).get('trust proxy')).toBe(1);
    expect(createApp({ web: { trustProxyHops: 2 } }).get('trust proxy')).toBe(2);
  });

  it('com 0 saltos, falsificar X-Forwarded-For NÃO evita o limitador do portão; com 1 salto o IP forjado à esquerda também não', async () => {
    for (const hops of [0, 1]) {
      const app = gated({ trustProxyHops: hops });
      for (let i = 0; i < GATE_MAX_FAILURES; i += 1) {
        expect((await request(app).get('/').set('X-Forwarded-For', `10.0.0.${i}, 203.0.113.9`).set('Authorization', basic(GATE.user, `x${i}`))).status).toBe(401);
      }
      const status = (await request(app).get('/').set('X-Forwarded-For', '10.9.9.9, 203.0.113.9').set('Authorization', basic(GATE.user, 'x-final'))).status;
      expect(status, `hops=${hops}`).toBe(429);
    }
  });

  it('com 1 salto, clientes distintos (IP do proxy) têm contadores independentes; com 0 saltos compartilham o mesmo', async () => {
    const app = gated({ trustProxyHops: 1 });
    for (let i = 0; i < GATE_MAX_FAILURES; i += 1) await request(app).get('/').set('X-Forwarded-For', '203.0.113.9').set('Authorization', basic(GATE.user, `x${i}`));
    expect((await request(app).get('/').set('X-Forwarded-For', '203.0.113.9').set('Authorization', GOOD)).status).toBe(429);
    expect((await request(app).get('/').set('X-Forwarded-For', '198.51.100.77').set('Authorization', GOOD)).status).toBe(200);
    const shared = gated({ trustProxyHops: 0 });
    for (let i = 0; i < GATE_MAX_FAILURES; i += 1) await request(shared).get('/').set('X-Forwarded-For', `1.1.1.${i}`).set('Authorization', basic(GATE.user, `x${i}`));
    expect((await request(shared).get('/').set('X-Forwarded-For', '198.51.100.77').set('Authorization', GOOD)).status).toBe(429);
  });

  it('a regra de IPv6 /64 do limitador é preservada', async () => {
    const a = await request(echo(1)).get('/ip').set('X-Forwarded-For', '2001:db8:1:2:aaaa::1');
    const b = await request(echo(1)).get('/ip').set('X-Forwarded-For', '2001:db8:1:2:bbbb::9');
    expect(a.body.key).toBe(b.body.key);
    expect(a.body.key).toMatch(/\/64$/);
  });

  it('createHomologGate usa o relógio injetado', () => {
    expect(typeof createHomologGate(GATE, () => new Date(0))).toBe('function');
  });
});

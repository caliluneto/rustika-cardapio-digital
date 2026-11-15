import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { openApiDocument } from '../src/openapi/document';

const expectedOperations = [
  ['get', '/categories'], ['get', '/products'], ['get', '/products/{productId}'],
  ['post', '/comanda-sessions'], ['get', '/comanda-sessions/current'],
  ['post', '/orders'], ['get', '/orders/{orderId}'],
  ['post', '/admin/auth/login'], ['get', '/admin/auth/session'], ['post', '/admin/auth/logout'],
  ['post', '/admin/comanda-invitations'], ['get', '/admin/orders'], ['patch', '/admin/orders/{orderId}/status'],
  ['get', '/admin/products'], ['post', '/admin/products'], ['patch', '/admin/products/{productId}'],
  ['delete', '/admin/products/{productId}'], ['patch', '/admin/products/{productId}/availability'],
] as const;

function collectRefs(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => collectRefs(item, found));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string') found.push(child);
      else collectRefs(child, found);
    }
  }
  return found;
}

describe('RF009 - contrato OpenAPI local', () => {
  it('documenta todas as operações públicas e administrativas implementadas', () => {
    expect(openApiDocument.openapi).toBe('3.1.0');
    for (const [method, path] of expectedOperations) {
      expect(openApiDocument.paths).toHaveProperty([path, method]);
    }
  });

  it('mantém referências internas resolvíveis', () => {
    const schemas = openApiDocument.components.schemas as Record<string, unknown>;
    const parameters = openApiDocument.components.parameters as Record<string, unknown>;
    for (const reference of collectRefs(openApiDocument)) {
      const match = reference.match(/^#\/components\/(schemas|parameters)\/([^/]+)$/);
      expect(match, `referência local inválida: ${reference}`).not.toBeNull();
      if (!match) continue;
      const componentName = match[2];
      expect(componentName).toBeDefined();
      if (componentName) expect(match[1] === 'schemas' ? schemas : parameters).toHaveProperty(componentName);
    }
  });

  it('documenta cookies reais e não inclui segredos de execução', () => {
    expect(openApiDocument.components.securitySchemes.adminCookie.name).toBe('rustika_admin');
    expect(openApiDocument.components.securitySchemes.comandaCookie.name).toBe('rustika_session');
    const serialized = JSON.stringify(openApiDocument);
    expect(serialized).not.toMatch(/DATABASE_URL|passwordHash|credentialHash|tokenHash|Bearer\s+[A-Za-z0-9]/);
  });

  it('inclui exemplos de requisição, resposta e erro para o teste interativo', () => {
    const schemas = openApiDocument.components.schemas as Record<string, { example?: Record<string, unknown> }>;
    expect(schemas.Product?.example).toMatchObject({ id: 'rustika-001', priceInCents: 1500, isAvailable: true });
    expect(schemas.CreateOrderInput?.example).toMatchObject({ customerName: 'Cliente de exemplo' });
    expect((schemas.CreateOrderInput?.example?.items as unknown[])).toHaveLength(1);
    expect(schemas.ErrorResponse?.example).toMatchObject({ success: false, error: { code: 'INVALID_INPUT' } });
    expect(schemas.ProductCreateInput?.example).toMatchObject({ categoryId: 'drinks', priceInCents: 1500 });
  });

  it('serve o JSON e o Swagger UI com assets locais, sem CDN e sob CSP restritiva', async () => {
    const app = createApp();
    const contract = await request(app).get('/api/openapi.json');
    expect(contract.status).toBe(200);
    expect(contract.headers['cache-control']).toBe('no-store');
    expect(contract.body.info.title).toBe(openApiDocument.info.title);

    const docs = await request(app).get('/api/docs');
    expect(docs.status).toBe(200);
    expect(docs.headers['content-security-policy']).toContain("default-src 'none'");
    expect(docs.headers['content-security-policy']).toContain("script-src 'self'");
    expect(docs.headers['content-security-policy']).not.toContain("script-src 'unsafe-inline'");
    expect(docs.text).toContain('/api/docs/swagger-initializer.js');
    expect(docs.text).toContain('/api/docs/swagger-ui.css');
    expect(docs.text).toContain('/api/docs/swagger-ui-bundle.js');
    expect(docs.text).not.toMatch(/https?:\/\//);
  });

  it('entrega o bundle, o CSS e o inicializador do Swagger UI na mesma origem', async () => {
    const app = createApp();
    const css = await request(app).get('/api/docs/swagger-ui.css');
    expect(css.status).toBe(200);
    expect(css.headers['content-type']).toMatch(/text\/css/);
    expect(css.text.length).toBeGreaterThan(10_000);

    const bundle = await request(app).get('/api/docs/swagger-ui-bundle.js');
    expect(bundle.status).toBe(200);
    expect(bundle.headers['content-type']).toMatch(/javascript/);
    expect(bundle.text.length).toBeGreaterThan(100_000);

    const initializer = await request(app).get('/api/docs/swagger-initializer.js');
    expect(initializer.status).toBe(200);
    expect(initializer.headers['content-type']).toMatch(/javascript/);
    expect(initializer.text).toContain("url: '/api/openapi.json'");
    expect(initializer.text).toContain('withCredentials: true');
    expect(initializer.text).toContain("request.headers['X-Rustika-Request'] = '1'");

    expect((await request(app).get('/api/docs/nao-existe.js')).status).toBe(404);
  });
});

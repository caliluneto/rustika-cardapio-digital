import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { openApiDocument } from '../src/openapi/document';

const expectedOperations = [
  ['get', '/health'], ['get', '/ready'],
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

  it('serve JSON e visualizador autônomo somente no ambiente não produtivo dos testes', async () => {
    const app = createApp();
    const contract = await request(app).get('/api/openapi.json');
    expect(contract.status).toBe(200);
    expect(contract.headers['cache-control']).toBe('no-store');
    expect(contract.body.info.title).toBe(openApiDocument.info.title);

    const docs = await request(app).get('/api/docs');
    expect(docs.status).toBe(200);
    expect(docs.headers['content-security-policy']).toContain("default-src 'none'");
    expect(docs.text).toContain('/api/openapi.json');
    expect(docs.text).not.toMatch(/https?:\/\//);
  });
});

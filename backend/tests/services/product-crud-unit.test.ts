import { describe, expect, it, vi } from 'vitest';
import { createProductCrud } from '../../src/services/productCrud.service';
import { openApiDocument } from '../../src/openapi/document';
import { mockProductCrudPrisma, storedProductCrud } from '../fixtures/productCrudOps';

describe('createProductCrud - atomicidade transacional e normalização (sem socket TCP)', () => {
  it('normaliza campos opcionais em branco para null no create e no update e autentica dentro da transação Serializable', async () => {
    const mock = await mockProductCrudPrisma([storedProductCrud({ sourceCode: 'PA0001', name: 'Existente' })]);
    const authCalls: Array<{ token: string | undefined; hasTx: boolean }> = [];
    const auth = {
      authenticate: vi.fn(async (token: string | undefined, db?: unknown) => {
        authCalls.push({ token, hasTx: db !== undefined });
        return { admin: mock.admin };
      }),
    };

    const crud = createProductCrud(mock.prisma, auth);
    const created = await crud.create(
      {
        name: '  Porção Especial  ',
        description: '   ',
        ingredients: '',
        priceInCents: 3500,
        categoryId: 'frios',
        imageUrl: '  ',
        imageAlt: '',
      },
      'tok-1',
    );

    expect(created.name).toBe('Porção Especial');
    expect(created.priceInCents).toBe(3500);
    expect(created.categoryId).toBe('frios');
    expect(created.publicKey).toBe('rustika-PORCAOESPECIAL');

    const stored = mock.products().find((p) => p.publicKey === created.publicKey);
    expect(stored?.description).toBeNull();
    expect(stored?.ingredients).toBeNull();
    expect(stored?.imageUrl).toBeNull();
    expect(stored?.imageAlt).toBeNull();

    // Deve autenticar antes e novamente dentro da transação Serializable
    expect(authCalls).toEqual([
      { token: 'tok-1', hasTx: false },
      { token: 'tok-1', hasTx: true },
    ]);

    const updated = await crud.update(
      created.publicKey,
      { description: 'Descrição preenchida', imageUrl: '   ' },
      'tok-1',
    );
    expect(updated.publicKey).toBe(created.publicKey);
    const storedAfter = mock.products().find((p) => p.publicKey === created.publicKey);
    expect(storedAfter?.description).toBe('Descrição preenchida');
    expect(storedAfter?.imageUrl).toBeNull();
  });

  it('rejeita categoria ausente ou inativa dentro da transação Serializable', async () => {
    const mock = await mockProductCrudPrisma([]);
    mock.control.missingCategory = true;
    const crud = createProductCrud(mock.prisma, { authenticate: async () => ({}) });

    await expect(
      crud.create({ name: 'Item', priceInCents: 1000, categoryId: 'frios' }, 'tok'),
    ).rejects.toMatchObject({ statusCode: 400, code: 'CATEGORY_NOT_FOUND' });
  });

  it('contrato OpenAPI documenta /health, /ready, AdminProductList e envelope { product } em availability', () => {
    expect(openApiDocument.paths).toHaveProperty(['/health', 'get']);
    expect(openApiDocument.paths).toHaveProperty(['/ready', 'get']);
    expect(openApiDocument.components.schemas).toHaveProperty('AdminProductList');

    const getAdminProducts = openApiDocument.paths['/admin/products'].get;
    expect(JSON.stringify(getAdminProducts.responses['200'])).toContain('#/components/schemas/AdminProductList');

    const patchAvailability = openApiDocument.paths['/admin/products/{productId}/availability'].patch;
    expect(JSON.stringify(patchAvailability.responses['200'])).toContain('"product":{"$ref":"#/components/schemas/AdminProduct"}');
  });
});


import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { mapCategory, mapProduct, priceToCents } from '../../src/mappers/catalog.mapper';
import { createCatalogService } from '../../src/services/catalog.service';
import { categoryRecord, mockCatalogPrisma, productRecord } from '../fixtures/catalog';

describe('catálogo: mapeamento público', () => {
  it.each([
    ['0', 0], ['0.01', 1], ['0.29', 29], ['14.99', 1499], ['59.99', 5999],
    ['199.99', 19999], ['99999999.99', 9999999999],
  ])('converte %s exatamente para %i centavos', (input, expected) => {
    expect(priceToCents(new Prisma.Decimal(input))).toBe(expected);
  });

  it.each(['-1', '1.001', 'NaN', 'Infinity', '90071992547409.92'])(
    'recusa preço inválido sem arredondar: %s', (input) => {
      expect(() => priceToCents(new Prisma.Decimal(input))).toThrow();
    },
  );

  it('preserva conteúdo e identidade de origem sem expor UUID ou campos privados', () => {
    const product = mapProduct({
      ...productRecord(), id: 'internal-id', passwordHash: 'secret',
    } as ReturnType<typeof productRecord>);
    expect(product).toEqual({
      id: 'rustika-100', sourceCode: '100', sourceName: ' NEGRONI ', sourceGroup: 'DRINKS',
      categoryId: 'drinks', name: 'Negroni', description: 'Descrição confirmada.',
      descriptionSource: 'Cardápio impresso, página 3', ingredients: 'Campari / gin / vermute / laranja.',
      priceInCents: 3000, imageUrl: '/images/negroni.jpg', imageAlt: 'Negroni', isAvailable: null,
    });
    expect(mapCategory(categoryRecord)).toEqual({ id: 'drinks', name: 'Drinks', description: '', displayOrder: 3 });
  });

  it.each([['UNKNOWN', null], ['AVAILABLE', true], ['UNAVAILABLE', false]] as const)(
    'mapeia %s para %s independentemente do booleano legado', (availabilityState, expected) => {
      const record = { ...productRecord({ availabilityState }), isAvailable: expected !== true };
      expect(mapProduct(record).isAvailable).toBe(expected);
    },
  );

  it('omite conteúdo ausente sem inventar ingredientes ou fotografias', () => {
    const product = mapProduct(productRecord({
      description: null, descriptionSource: null, ingredients: null, imageUrl: null, imageAlt: null,
    }));
    for (const key of ['description', 'descriptionSource', 'ingredients', 'imageUrl', 'imageAlt']) {
      expect(product).not.toHaveProperty(key);
    }
  });

  it('recusa identidades inconsistentes sem recorrer ao UUID interno', () => {
    for (const override of [
      { publicKey: null }, { publicKey: 'rustika-999' }, { sourceCode: null },
      { sourceName: '' }, { sourceGroup: null }, { category: { publicKey: null } },
    ]) expect(() => mapProduct(productRecord(override))).toThrow();
    expect(() => mapCategory({ ...categoryRecord, publicKey: null })).toThrow();
  });
});

describe('serviço de catálogo com Prisma simulado', () => {
  it('consulta apenas categorias públicas ativas em ordem estável', async () => {
    const mock = mockCatalogPrisma();
    const categories = await createCatalogService(mock.prisma).listCategories();
    expect(categories[0]?.id).toBe('drinks');
    expect(mock.categoryFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isActive: true, publicKey: { not: null } },
      orderBy: [{ displayOrder: 'asc' }, { publicKey: 'asc' }],
    }));
    expect(mock.connect).not.toHaveBeenCalled();
  });

  it('aplica elegibilidade e filtros no Prisma antes de limitar a lista', async () => {
    const mock = mockCatalogPrisma();
    await createCatalogService(mock.prisma).listProducts({ limit: 10, categoryId: 'drinks', availability: 'AVAILABLE' });
    expect(mock.productFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        isActive: true, publicKey: { not: null }, sourceCode: { not: null },
        sourceName: { not: null }, sourceGroup: { not: null },
        category: { is: { isActive: true, publicKey: 'drinks' } }, availabilityState: 'AVAILABLE',
      },
      take: 11,
      orderBy: [{ category: { displayOrder: 'asc' } }, { category: { publicKey: 'asc' } }, { publicKey: 'asc' }],
    }));
  });

  it('não restringe disponibilidade por padrão e exige categoria pública ativa', async () => {
    const mock = mockCatalogPrisma();
    await createCatalogService(mock.prisma).listProducts({ limit: 30 });
    const args = mock.productFindMany.mock.calls[0]?.[0];
    expect(args.where).not.toHaveProperty('availabilityState');
    expect(args.where.category).toEqual({ is: { isActive: true, publicKey: { not: null } } });
  });

  it('usa um registro extra para indicar próxima página sem retornar esse registro', async () => {
    const mock = mockCatalogPrisma();
    mock.productFindMany.mockResolvedValue([
      productRecord(), productRecord({ publicKey: 'rustika-101', sourceCode: '101' }),
    ]);
    const page = await createCatalogService(mock.prisma).listProducts({ limit: 1 });
    expect(page.items.map((item) => item.id)).toEqual(['rustika-100']);
    expect(page.nextCursor).toBe('rustika-100');
  });

  it('continua após cursor válido usando os mesmos filtros', async () => {
    const mock = mockCatalogPrisma();
    mock.productFindMany.mockResolvedValue([]);
    const page = await createCatalogService(mock.prisma).listProducts({
      limit: 30, cursor: 'rustika-100', categoryId: 'drinks', availability: 'UNKNOWN',
    });
    expect(mock.productFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ publicKey: 'rustika-100', availabilityState: 'UNKNOWN',
        category: { is: { isActive: true, publicKey: 'drinks' } } }),
    }));
    expect(mock.productFindMany).toHaveBeenCalledWith(expect.objectContaining({ cursor: { publicKey: 'rustika-100' }, skip: 1 }));
    expect(page).toEqual({ items: [], nextCursor: null });
  });

  it('recusa cursor ausente ou fora do catálogo/filtro antes de consultar a página', async () => {
    const mock = mockCatalogPrisma();
    mock.productFindFirst.mockResolvedValue(null);
    await expect(createCatalogService(mock.prisma).listProducts({ limit: 30, cursor: 'rustika-100' }))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_CURSOR' });
    expect(mock.productFindMany).not.toHaveBeenCalled();
  });

  it('detalhes usam a mesma elegibilidade da lista e não contornam categoria inativa', async () => {
    const mock = mockCatalogPrisma();
    mock.productFindFirst.mockResolvedValue(null);
    await expect(createCatalogService(mock.prisma).getProduct('rustika-100'))
      .rejects.toMatchObject({ statusCode: 404, code: 'PRODUCT_NOT_FOUND' });
    expect(mock.productFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        isActive: true, publicKey: 'rustika-100', sourceCode: { not: null },
        sourceName: { not: null }, sourceGroup: { not: null },
        category: { is: { isActive: true, publicKey: { not: null } } },
      },
    }));
  });
});

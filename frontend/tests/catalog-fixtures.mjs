export const category = { id: 'drinks', name: 'Drinks', description: '', displayOrder: 3 };
export const dto = (code = '001', overrides = {}) => ({
  id: `rustika-${code}`, sourceCode: code, sourceName: ' NEGRONI ', sourceGroup: 'DRINKS',
  categoryId: 'drinks', name: 'Negroni', priceInCents: 5999, isAvailable: null,
  description: 'Descrição cadastrada.', ingredients: 'Campari / gin / vermute.',
  imageUrl: '/images/negroni.jpg', imageAlt: 'Negroni cadastrado', ...overrides,
});
export const json = (data, status = 200) => new Response(JSON.stringify({ success: true, data }), { status });
export const baseUrl = 'http://catalog.example/api';

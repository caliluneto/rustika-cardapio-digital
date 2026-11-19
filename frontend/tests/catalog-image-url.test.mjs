import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptProduct } from '../src/services/catalogAdapter.ts';
import { dto } from './catalog-fixtures.mjs';

const ORIGIN = 'https://rustika-homolog.onrender.com';
const image = (imageUrl, baseUrl) => adaptProduct(dto('1', { imageUrl }), baseUrl).imageUrl;

function withLocation(origin, run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { value: origin === undefined ? undefined : { origin }, configurable: true, writable: true });
  try { return run(); } finally {
    if (previous) Object.defineProperty(globalThis, 'location', previous); else delete globalThis.location;
  }
}

test('VITE_API_URL=/api (mesma origem): caminho relativo resolve na origem da página e a imagem é mantida', () => {
  withLocation(ORIGIN, () => {
    assert.equal(image('/images/negroni.jpg', '/api'), `${ORIGIN}/images/negroni.jpg`);
    assert.equal(image('images/negroni.jpg', '/api'), `${ORIGIN}/api/images/negroni.jpg`);
    assert.equal(image('/images/negroni.jpg', '/api/'), `${ORIGIN}/images/negroni.jpg`);
  });
});

test('base absoluta continua funcionando como antes (caminho relativo e URL absoluta HTTPS)', () => {
  assert.equal(image('/images/negroni.jpg', 'http://catalog.example/api'), 'http://catalog.example/images/negroni.jpg');
  assert.equal(image('/images/negroni.jpg', 'https://api.example.com/api'), 'https://api.example.com/images/negroni.jpg');
  assert.equal(image('https://images.example/photo.jpg', 'https://api.example.com/api'), 'https://images.example/photo.jpg');
  withLocation(ORIGIN, () => {
    assert.equal(image('https://images.example/photo.jpg', '/api'), 'https://images.example/photo.jpg');
  });
});

test('base relativa sem origem de página (fora do navegador): relativo é omitido; absoluto HTTPS é mantido', () => {
  withLocation(undefined, () => {
    assert.equal(image('/images/negroni.jpg', '/api'), undefined);
    assert.equal(image('https://images.example/photo.jpg', '/api'), 'https://images.example/photo.jpg');
  });
  withLocation('null', () => assert.equal(image('/images/negroni.jpg', '/api'), undefined));
  withLocation('file://', () => assert.equal(image('/images/negroni.jpg', '/api'), undefined));
});

test('URLs inválidas ou inseguras são omitidas, com qualquer base', () => {
  const unsafe = [
    'javascript:alert(1)', 'data:text/html,test', 'vbscript:x', 'file:///etc/passwd', 'ftp://host/x.jpg', 'blob:https://x/1',
    'http://user:password@example.com/photo', 'https://user@example.com/photo', 'http://', 'https://', 'http://exa mple.com/x', '', '   ',
  ];
  for (const base of ['/api', 'https://api.example.com/api']) {
    withLocation(ORIGIN, () => { for (const value of unsafe) assert.equal(image(value, base), undefined, `${base} ${value}`); });
  }
});

test('origem indevida para caminhos relativos: protocol-relative, barra invertida e caracteres de controle são omitidos', () => {
  const hostile = ['//evil.example/x.jpg', '///evil.example/x.jpg', '/\\evil.example/x.jpg', '\\\\evil.example\\x.jpg', '/..\\..\\x.jpg', '/img\n.jpg', '/img\t.jpg', '/img\u0000.jpg'];
  for (const base of ['/api', 'https://api.example.com/api']) {
    withLocation(ORIGIN, () => { for (const value of hostile) assert.equal(image(value, base), undefined, `${base} ${JSON.stringify(value)}`); });
  }
});

test('base relativa suspeita não é aceita como origem (//host, \\host, vazia)', () => {
  withLocation(ORIGIN, () => {
    for (const base of ['//evil.example/api', '/\\evil.example', 'api', '']) assert.equal(image('/images/negroni.jpg', base), undefined, base);
  });
});

test('ausência de imagem: produto sem imageUrl continua sem imageUrl', () => {
  withLocation(ORIGIN, () => {
    const product = dto();
    delete product.imageUrl;
    assert.equal(adaptProduct(product, '/api').imageUrl, undefined);
    assert.equal('imageUrl' in adaptProduct(product, '/api'), false);
  });
});

test('a apresentação do catálogo não muda: os demais campos do produto são idênticos com base relativa ou absoluta', () => {
  const relative = withLocation(ORIGIN, () => adaptProduct(dto(), '/api'));
  const absolute = adaptProduct(dto(), 'https://api.example.com/api');
  const { imageUrl: a, ...restRelative } = relative;
  const { imageUrl: b, ...restAbsolute } = absolute;
  assert.deepEqual(restRelative, restAbsolute);
  assert.equal(a, `${ORIGIN}/images/negroni.jpg`);
  assert.equal(b, 'https://api.example.com/images/negroni.jpg');
});

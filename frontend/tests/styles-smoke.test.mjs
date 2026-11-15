// proteção contra regressão visual do CSS.
// Por que os testes anteriores não detectaram a troca do index.css: todos rodam em Node e checam
// lógica e markup de SSR; nenhum carregava o CSS. Este arquivo liga os dois lados: renderiza os
// componentes reais do catálogo e exige que (1) o CSS real tenha regras para as classes que eles
// emitem e (2) o contrato de layout essencial se mantenha em 390px e 1366px.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Catalog from '../src/components/Catalog.tsx';
import CatalogStatus from '../src/components/CatalogStatus.tsx';
import ConnectionIndicator from '../src/components/ConnectionIndicator.tsx';
import ProductCard from '../src/components/ProductCard.tsx';
import { CartProvider } from '../src/contexts/CartContext.tsx';
import { category, dto } from './catalog-fixtures.mjs';
import { classesInMarkup, hasRuleForClass, layoutViolations, parseStyles, resolvedStyle } from './style-rules.mjs';

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const rules = parseStyles(css);
// Header usa import.meta.env.BASE_URL, fornecido pelo Vite no navegador.
// Nos testes Node, as classes literais vêm do próprio componente.
const headerSource = readFileSync(new URL('../src/components/Header.tsx', import.meta.url), 'utf8');
const headerClasses = [...headerSource.matchAll(/className="([^"]+)"/g)]
  .flatMap((match) => match[1].split(/\s+/));

function catalogMarkup() {
  return [
    renderToStaticMarkup(createElement(CartProvider, null, createElement(Catalog, {
      categories: [category], products: [dto('001'), dto('002', { imageUrl: undefined, imageAlt: undefined })], productDialogOpen: false,
      onOpenProduct: () => {}, onCloseProduct: () => {}, onViewCart: () => {},
    }))),
    renderToStaticMarkup(createElement(ProductCard, { product: dto('003'), categoryName: 'Drinks', onSelect: () => {} })),
    renderToStaticMarkup(createElement(CatalogStatus, { state: { status: 'error', message: 'Falha.' }, onRetry: () => {} })),
    renderToStaticMarkup(createElement(CatalogStatus, { state: { status: 'loading' }, onRetry: () => {} })),
    renderToStaticMarkup(createElement(ConnectionIndicator, { autoCheck: false })),
  ].join('\n');
}

test('contrato de layout essencial do catálogo (390px e 1366px)', () => {
  assert.deepEqual(layoutViolations(rules), []);
});

test('classes emitidas pelos componentes reais do catálogo têm regra no CSS', () => {
  const used = [...new Set([...classesInMarkup(catalogMarkup()), ...headerClasses])];
  assert.ok(used.length >= 20, `poucas classes renderizadas (${used.length}); o teste perdeu o alvo`);
  const missing = used.filter((name) => !hasRuleForClass(rules, name));
  // Modificadores/marcadores sem estilo próprio por desenho (estado em atributos ou herdado do pai).
  const allowed = new Set(['product-card--text', 'product-card--with-image', 'hero-copy', 'connection--idle']);
  assert.deepEqual(missing.filter((name) => !allowed.has(name)), [], `classes sem regra: ${missing.join(', ')}`);
});

test('as classes-chave do layout estão presentes no markup renderizado (o teste mede o que a tela usa)', () => {
  const used = new Set([...classesInMarkup(catalogMarkup()), ...headerClasses]);
  for (const name of ['category-nav', 'category-button', 'product-grid', 'product-card', 'site-header', 'connection']) {
    assert.ok(used.has(name), `componente não emitiu .${name}`);
  }
});

test('o verificador distingue: um CSS de esqueleto (como o regredido) é recusado', () => {
  const skeleton = parseStyles(`
    :root { font-family: system-ui; color: #213547; }
    body { margin: 0; }
    .app { max-width: 960px; margin: 0 auto; }
    .card { padding: 1rem; border: 1px solid #ddd; }
    .status--online { color: green; }`);
  const violations = layoutViolations(skeleton);
  assert.ok(violations.length >= 10, `esperado recusar o esqueleto; violações: ${violations.length}`);
  assert.equal(hasRuleForClass(skeleton, 'product-card'), false);
});

test('resolução de @media segue a largura: a regra de 900px não vale no mobile', () => {
  assert.equal(resolvedStyle(rules, '.product-grid', 390)['grid-template-columns'], 'minmax(0, 1fr)');
  assert.match(resolvedStyle(rules, '.product-grid', 700)['grid-template-columns'], /repeat\(2,/);
  assert.match(resolvedStyle(rules, '.product-grid', 1366)['grid-template-columns'], /repeat\(3,/);
});

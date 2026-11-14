import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogNotice, cartNotice, comandaDisclaimer, reviewNotice } from '../src/services/demoNotice.ts';

/**
 * RF004 — as mensagens de demonstração precisam acompanhar a capacidade REAL do ambiente.
 * O defeito corrigido: as telas afirmavam em texto fixo que "não envia pedidos" mesmo com
 * VITE_ORDER_SUBMISSION=enabled e comanda validada, quando o pedido É gravado no PostgreSQL.
 */

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('catálogo: com envio desativado, o aviso diz que não há pedidos', () => {
  const text = catalogNotice('api', false);
  assert.match(text, /não recebe pedidos/);
  assert.doesNotMatch(text, /está habilitado/);
});

test('catálogo: com envio ativado, o aviso NÃO afirma que não recebe pedidos', () => {
  const text = catalogNotice('api', true);
  assert.doesNotMatch(text, /não recebe pedidos/);
  assert.match(text, /envio de pedidos está habilitado/);
  assert.match(text, /servidor recalcula o total/);
});

test('catálogo: a origem dos dados muda entre api e demo, o resto da frase não mente', () => {
  assert.match(catalogNotice('demo', true), /cópia local/);
  assert.match(catalogNotice('api', true), /carregados da API/);
  assert.match(catalogNotice('demo', false), /cópia local/);
});

test('carrinho: com envio ativado, não repete "esta demonstração não envia pedidos"', () => {
  assert.match(cartNotice(false), /não envia pedidos/);
  const enabled = cartNotice(true);
  assert.doesNotMatch(enabled, /não envia pedidos/);
  assert.match(enabled, /recalcula o total/);
});

test('comanda: distingue não informada, informada e validada pelo backend', () => {
  assert.match(comandaDisclaimer(null, null), /não é validado/);
  assert.match(comandaDisclaimer('10001', null), /ainda não validada/);
  assert.match(comandaDisclaimer('10001', '10001'), /validada pelo estabelecimento/);
  // Sessão de outra comanda não valida o número atual.
  assert.match(comandaDisclaimer('10002', '10001'), /ainda não validada/);
});

test('revisão: só promete envio quando há comanda validada E envio habilitado', () => {
  assert.match(reviewNotice(true, true), /confirmados pelo servidor no envio/);
  assert.match(reviewNotice(true, false), /envio de pedidos está desativado/);
  assert.match(reviewNotice(false, true), /Resgate o convite/);
  assert.match(reviewNotice(false, false), /Nenhum pedido será enviado/);
});

test('as telas reais usam os avisos derivados, não texto fixo contraditório', () => {
  const app = source('../src/App.tsx');
  assert.match(app, /catalogNotice\(/);
  assert.doesNotMatch(app, /O cardápio não recebe pedidos nem confirma estoque/);

  const drawer = source('../src/components/CartDrawer.tsx');
  assert.match(drawer, /cartNotice\(/);
  assert.match(drawer, /comandaDisclaimer\(/);
  assert.doesNotMatch(drawer, /esta demonstração não envia pedidos/);

  const review = source('../src/components/OrderReview.tsx');
  assert.match(review, /reviewNotice\(/);
  assert.doesNotMatch(review, /Nenhum pedido será enviado\.'\)\}<\/p>/);
});

test('o aviso do catálogo deriva de orderSubmissionEnabled, não de uma constante local', () => {
  const app = source('../src/App.tsx');
  assert.match(app, /orderSubmissionEnabled\(\)/);
  assert.match(app, /submissionEnabled/);
});

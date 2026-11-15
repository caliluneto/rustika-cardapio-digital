// verificação proporcional de estilos, sem navegador e sem dependência nova.
// Lê o CSS real, resolve @media por largura de viewport e devolve as declarações que se aplicam a
// um seletor "sujeito" (ex.: `.product-grid`), na ordem da cascata (a última vence, como no browser
// para seletores de mesma especificidade). Não substitui um teste visual completo: serve para que a
// troca do CSS por uma versão errada (como a regressão do OneDrive) quebre `npm test`.

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Divide o texto em blocos de primeiro nível: { prelude, body }. */
function blocks(css) {
  const out = [];
  let depth = 0; let start = 0; let preludeStart = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      if (depth === 0) { start = i; }
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        out.push({ prelude: css.slice(preludeStart, start).trim(), body: css.slice(start + 1, i) });
        preludeStart = i + 1;
      }
    } else if (ch === ';' && depth === 0) {
      preludeStart = i + 1; // @import/@charset de primeiro nível
    }
  }
  return out;
}

function declarations(body) {
  const map = {};
  for (const part of body.split(';')) {
    const index = part.indexOf(':');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (name) map[name] = part.slice(index + 1).trim();
  }
  return map;
}

/** Converte um prelude @media simples em predicado de largura. Outras condições: sempre falso,
 * exceto `prefers-reduced-motion`, que é tratado como não aplicável (padrão do browser). */
function mediaMatcher(prelude) {
  const query = prelude.replace(/^@media\s+/i, '');
  const min = query.match(/min-width:\s*(\d+)px/); const max = query.match(/max-width:\s*(\d+)px/);
  if (!min && !max) return () => false;
  return (width) => (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
}

/** Regras planas: { selectors: string[], decls, matches(width) }. */
export function parseStyles(css) {
  const rules = [];
  for (const block of blocks(stripComments(css))) {
    if (/^@media/i.test(block.prelude)) {
      const matches = mediaMatcher(block.prelude);
      for (const inner of blocks(block.body)) rules.push({ selectors: inner.prelude.split(',').map((s) => s.trim()), decls: declarations(inner.body), matches });
    } else if (!block.prelude.startsWith('@')) {
      rules.push({ selectors: block.prelude.split(',').map((s) => s.trim()), decls: declarations(block.body), matches: () => true });
    }
  }
  return rules;
}

/** Declarações efetivas para um seletor exato (ex.: '.product-grid', ':root', '.hero h1') na largura dada. */
export function resolvedStyle(rules, selector, width) {
  const style = {};
  for (const rule of rules) if (rule.matches(width) && rule.selectors.includes(selector)) Object.assign(style, rule.decls);
  return style;
}

/** A classe tem alguma regra própria (aparece como classe em algum seletor)? */
export function hasRuleForClass(rules, className) {
  const pattern = new RegExp(`\\.${className.replace(/[-]/g, '\\-')}(?![A-Za-z0-9_-])`);
  return rules.some((rule) => rule.selectors.some((s) => pattern.test(s)));
}

/** Classes presentes em markup gerado por renderToStaticMarkup. */
export function classesInMarkup(html) {
  const set = new Set();
  for (const match of html.matchAll(/class="([^"]*)"/g)) for (const token of match[1].split(/\s+/)) if (token) set.add(token);
  return set;
}

/**
 * Contrato visual mínimo do catálogo. Cada item é uma propriedade que, se faltar, quebra o layout
 * de forma visível. Devolve a lista de violações (vazia = ok).
 */
export function layoutViolations(rules) {
  const v = [];
  const at = (selector, width) => resolvedStyle(rules, selector, width);
  const expect = (label, ok) => { if (!ok) v.push(label); };
  const root = at(':root', 1366);
  expect(':root define --display-font (tipografia de destaque)', /Impact/.test(root['--display-font'] ?? ''));
  expect(':root define --paper e --ink', Boolean(root['--paper'] && root['--ink']));
  expect('body usa o fundo de papel', /var\(--paper\)/.test(at('body', 1366).background ?? at('body', 1366)['background-color'] ?? ''));
  expect('.container limita a largura (min(100% …))', /min\(100%/.test(at('.container', 390).width ?? ''));
  expect('.hero h1 usa a fonte de destaque', /var\(--display-font\)/.test(at('.hero h1', 1366)['font-family'] ?? ''));
  expect('.category-nav é flex com rolagem horizontal própria', at('.category-nav', 390).display === 'flex' && at('.category-nav', 390)['overflow-x'] === 'auto');
  expect('.academic-banner reserva espaço para o link Admin no mobile', at('.academic-banner', 390)['padding-right'] === '4.5rem');
  expect('.product-grid é grid', at('.product-grid', 1366).display === 'grid');
  expect('.product-grid tem 1 coluna no mobile (390px)', at('.product-grid', 390)['grid-template-columns'] === 'minmax(0, 1fr)');
  expect('.product-grid tem 3 colunas no desktop (1366px)', /repeat\(3,/.test(at('.product-grid', 1366)['grid-template-columns'] ?? ''));
  expect('.product-card é um cartão flex', at('.product-card', 1366).display === 'flex');
  expect('.cart-drawer é painel fixo lateral', at('.cart-drawer', 1366).position === 'fixed' && /min\(100%/.test(at('.cart-drawer', 1366).width ?? ''));
  for (const dialog of ['.product-modal', '.cart-drawer', '.order-review']) {
    expect(`${dialog}::backdrop escurece o fundo`, Boolean(at(`${dialog}::backdrop`, 1366).background));
  }
  expect('.product-modal vira folha inferior no mobile', at('.product-modal', 390).width === '100%');
  expect('.connection é um bloco estilizado', at('.connection', 1366).display === 'flex');
  expect('formulários administrativos organizam campos verticalmente', at('.admin-login-form', 390).display === 'grid' && at('.form-group', 390).display === 'grid');
  expect('resgate de convite pode quebrar linha no mobile', at('.comanda-redeem-container form', 390)['flex-wrap'] === 'wrap');
  return v;
}

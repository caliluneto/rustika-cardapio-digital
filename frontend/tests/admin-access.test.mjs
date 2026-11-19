import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { classifyAdmin, nextAdminAction } from './helpers/adminState.ts';
import AdminLogin from '../src/pages/AdminLogin.tsx';
import { endAdminSession } from '../src/pages/AdminDashboard.tsx';
import { ApiError } from '../src/services/api.ts';

const facts = (o = {}) => ({ dashboard: false, loginForm: false, sessionState: null, alert: false, ...o });
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

/** Simula a sequência de leituras do DOM e aplica a mesma decisão do helper do Playwright. */
function run(sequence, { attempted = false } = {}) {
  const decisions = [];
  for (const f of sequence) decisions.push(nextAdminAction(classifyAdmin(f), attempted));
  return decisions;
}

test('sessão inicialmente desconhecida: formulário com verificação pendente NUNCA autoriza preencher', () => {
  assert.equal(classifyAdmin(facts({ loginForm: true, sessionState: 'checking' })), 'checking');
  assert.deepEqual(run([facts(), facts({ loginForm: true, sessionState: 'checking' })]), ['wait', 'wait']);
});

test('sessão restaurada: o painel aparece sem login', () => {
  assert.equal(classifyAdmin(facts({ dashboard: true })), 'authenticated');
  assert.equal(nextAdminAction('authenticated', false), 'done');
});

test('sessão ausente: só depois de "anonymous" o formulário é estável e o login é permitido', () => {
  assert.deepEqual(run([facts({ loginForm: true, sessionState: 'checking' }), facts({ loginForm: true, sessionState: 'anonymous' })]), ['wait', 'login']);
});

test('troca do formulário para o painel durante a inicialização: espera e termina autenticado, sem tentar preencher', () => {
  assert.deepEqual(run([facts({ loginForm: true, sessionState: 'checking' }), facts({ dashboard: true })]), ['wait', 'done']);
});

test('login com erro: falha explícita em vez de aguardar para sempre', () => {
  const state = classifyAdmin(facts({ loginForm: true, sessionState: 'anonymous', alert: true }));
  assert.equal(state, 'login-error');
  assert.equal(nextAdminAction(state, true), 'fail');
});

test('sessão expirada / negada depois do envio: voltar a "anonymous" após tentar login é falha, não novo laço', () => {
  assert.equal(nextAdminAction('anonymous', true), 'fail');
});

test('painel de produtos indisponível: o helper exige cabeçalho, fim do carregamento e busca habilitada', () => {
  const helper = source('./helpers/adminAccess.ts');
  for (const part of ["'.admin-products'", "name: 'Produtos'", 'Carregando produtos…', "input[type=\"search\"]", 'toBeEnabled']) assert.ok(helper.includes(part), part);
});

test('o helper não usa isVisible() isolado nem atrasos fixos; o timeout global não foi alterado', () => {
  const helper = source('./helpers/adminAccess.ts');
  assert.doesNotMatch(helper, /isVisible\(|waitForTimeout|setTimeout/);
  const spec = source('./e2e.spec.ts');
  assert.doesNotMatch(spec, /waitForTimeout/);
  assert.match(spec, /openAdminProducts\(adminPage,/);
  const timeouts = [...readFileSync(new URL('../playwright.config.ts', import.meta.url), 'utf8').matchAll(/timeout:\s*(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(timeouts.length > 0 && timeouts.every((value) => value <= 60000));
});

test('o componente expõe o estado da verificação: começa em checking e vira anonymous só quando a verificação falha', () => {
  const html = renderToStaticMarkup(createElement(AdminLogin, { onLogin() {} }));
  assert.match(html, /class="admin-login-container" data-session-state="checking"/);
  const component = source('../src/pages/AdminLogin.tsx');
  assert.match(component, /setSessionState\('anonymous'\)/);
  assert.match(component, /if \(!controller\.signal\.aborted\)/);
});

test('logout só conclui depois de confirmação do servidor', async () => {
  let calls = 0;
  assert.equal(await endAdminSession({ post: async (path, body) => {
    calls++;
    assert.equal(path, '/admin/auth/logout');
    assert.deepEqual(body, {});
  } }), true);
  assert.equal(calls, 1);
  assert.equal(await endAdminSession({ post: async () => { throw new ApiError(401, 'ADMIN_UNAUTHENTICATED', 'x', null); } }), false);
  assert.equal(await endAdminSession({ post: async () => { throw new ApiError(0, 'NETWORK', 'x', null); } }), false);
  assert.equal(await endAdminSession({ post: async () => { throw new ApiError(503, 'UNAVAILABLE', 'x', null); } }), false);
});

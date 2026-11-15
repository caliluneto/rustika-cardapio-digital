import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { classifyAdmin, nextAdminAction } from './adminState';
import type { AdminDomFacts } from './adminState';

/**
 * Acesso administrativo determinístico: abre #admin, espera a verificação de sessão terminar, faz login só
 * se o formulário estiver estável e confirma o painel autenticado. Sem verificação instantânea de visibilidade e sem atrasos fixos.
 */
const readFacts = async (page: Page): Promise<AdminDomFacts> => ({
  dashboard: (await page.locator('.admin-dashboard').count()) > 0,
  loginForm: (await page.locator('.admin-login-container').count()) > 0,
  sessionState: await page.locator('.admin-login-container').first().getAttribute('data-session-state', { timeout: 500 }).catch(() => null),
  alert: (await page.locator('.admin-login-container [role="alert"]').count()) > 0,
});

async function settledState(page: Page) {
  let state = classifyAdmin(await readFacts(page));
  await expect.poll(async () => { state = classifyAdmin(await readFacts(page)); return state; }, {
    message: 'a interface administrativa não chegou a um estado estável', timeout: 20000,
  }).toMatch(/^(authenticated|anonymous|login-error)$/);
  return state;
}

export async function openAdminProducts(page: Page, credentials: { email: string; password: string }): Promise<void> {
  await page.goto('/#admin');
  let attempted = false;
  for (let round = 0; round < 3; round++) {
    const action = nextAdminAction(await settledState(page), attempted);
    if (action === 'done') break;
    if (action === 'fail') throw new Error('Acesso administrativo recusado: o formulário voltou/continua exibido (credenciais ou sessão).');
    attempted = true;
    await page.getByLabel('E-mail').fill(credentials.email);
    await page.getByLabel('Senha').fill(credentials.password);
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/admin/auth/login') && r.request().method() === 'POST', { timeout: 15000 }),
      page.getByRole('button', { name: 'Entrar' }).click(),
    ]);
  }
  await expect(page.locator('.admin-dashboard')).toBeVisible({ timeout: 15000 });
  const panel = page.locator('.admin-products');
  await expect(panel).toBeVisible({ timeout: 25000 });
  await expect(panel.getByRole('heading', { name: 'Produtos' })).toBeVisible();
  await expect(panel.getByText('Carregando produtos…')).toHaveCount(0, { timeout: 25000 });
  await expect(panel.locator('input[type="search"]')).toBeEnabled();
}

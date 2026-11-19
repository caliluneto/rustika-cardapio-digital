/** Operação exclusivamente no cluster local isolado 127.0.0.1:55432. Nunca carrega perfis de homologação. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { planHomologCatalogFromFile } from './homolog/catalogHomologImporter';
import { checkPasswordPolicy, normalizeIdentity } from './bootstrap/adminInput';
import { hashPassword } from '../src/security/password';

const DATABASE = 'cardapio_digital_dev';
const HOST = '127.0.0.1';
const PORT = '55432';
const SECRETS = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'CardapioDigital', 'rustika-isolated-secrets');

function localUrl(role: 'cardapio_migrator' | 'cardapio_dev_app'): string {
  const file = path.join(SECRETS, role === 'cardapio_migrator' ? 'rustika-isolated-migrator.env' : 'rustika-isolated-app.env');
  const line = fs.readFileSync(file, 'utf8').trim();
  if (!line.startsWith('DATABASE_URL=')) throw new Error('LOCAL_SECRET_INVALID');
  const value: unknown = JSON.parse(line.slice('DATABASE_URL='.length));
  if (typeof value !== 'string') throw new Error('LOCAL_SECRET_INVALID');
  const url = new URL(value);
  if (url.protocol !== 'postgresql:' || url.hostname !== HOST || url.port !== PORT ||
      url.pathname !== `/${DATABASE}` || url.username !== role || url.searchParams.toString() !== 'schema=public') {
    throw new Error('LOCAL_TARGET_MISMATCH');
  }
  return value;
}

async function assertLocal(prisma: PrismaClient, role: string): Promise<void> {
  const [facts] = await prisma.$queryRaw<Array<{
    db: string; usr: string; sess: string; addr: string | null; port: number | null;
    owner: string; version: number; neon: string | null; marker: boolean;
  }>>`
    SELECT current_database() AS db, current_user::text AS usr, session_user::text AS sess,
           host(inet_server_addr()) AS addr, inet_server_port() AS port,
           (SELECT pg_get_userbyid(datdba)::text FROM pg_database WHERE datname = current_database()) AS owner,
           current_setting('server_version_num')::int AS version,
           current_setting('neon.project_id', true) AS neon,
           EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rustika_homolog_marker') AS marker`;
  if (!facts || facts.db !== DATABASE || facts.usr !== role || facts.sess !== role ||
      facts.addr !== HOST || facts.port !== Number(PORT) || facts.owner !== 'cardapio_migrator' ||
      facts.version < 180000 || facts.neon !== null || facts.marker) throw new Error('LOCAL_IDENTITY_MISMATCH');
}

async function importCatalog(prisma: PrismaClient): Promise<void> {
  const plan = planHomologCatalogFromFile();
  const t = plan.totals;
  if (t.totalRows !== 204 || t.activeRows !== 174 || t.commercializedToImport !== 144 ||
      t.internalSuppliesExcluded !== 24 || t.uncertainExcluded !== 6 || t.inactiveExcluded !== 30 ||
      t.categoriesRequired !== 12 || new Set(plan.products.map((p) => p.sourceCode)).size !== 144) {
    throw new Error('LOCAL_CATALOG_PLAN_MISMATCH');
  }
  await prisma.$transaction(async (tx) => {
    if (await tx.category.count() !== 0 || await tx.product.count() !== 0) throw new Error('LOCAL_CATALOG_NOT_EMPTY');
    const categoryIds = new Map<string, string>();
    for (const category of plan.categories) {
      const created = await tx.category.create({ data: {
        name: category.name, publicKey: category.publicKey, displayOrder: category.displayOrder, isActive: true,
      } });
      categoryIds.set(category.publicKey, created.id);
    }
    for (const product of plan.products) {
      const categoryId = categoryIds.get(product.categoryPublicKey);
      if (!categoryId) throw new Error('LOCAL_CATEGORY_MISSING');
      await tx.product.create({ data: {
        publicKey: product.publicKey, sourceCode: product.sourceCode,
        sourceName: product.sourceName, sourceGroup: product.sourceGroup, name: product.name,
        price: new Prisma.Decimal(product.priceInCents).div(100), categoryId,
        isActive: true, availabilityState: 'UNKNOWN',
      } });
    }
    if (await tx.category.count() !== 12 || await tx.product.count() !== 144) throw new Error('LOCAL_IMPORT_POSTCONDITION');
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 120_000 });
  console.log('local-catalog-import=PASS rows=204 active=174 commercialized=144 supplies=24 uncertain=6 inactive=30 categories=12');
}

async function bootstrapAdmin(prisma: PrismaClient): Promise<void> {
  const identity = normalizeIdentity({ name: 'Operador Rústika Local', email: 'operador@rustika.local' });
  if (!identity.ok) throw new Error('LOCAL_ADMIN_IDENTITY_INVALID');
  if (await prisma.admin.count() !== 0) throw new Error('LOCAL_ADMIN_ALREADY_EXISTS');
  const file = path.join(SECRETS, 'rustika-isolated-admin-login.json');
  if (fs.existsSync(file)) throw new Error('LOCAL_ADMIN_SECRET_ALREADY_EXISTS');
  const password = `${randomBytes(36).toString('base64url')}!Z9a`;
  if (checkPasswordPolicy(password, identity.value).length) throw new Error('LOCAL_ADMIN_PASSWORD_POLICY');
  const passwordHash = await hashPassword(password);
  // Gravar antes da transação: falha de gravação nunca deixa um admin sem credencial recuperável.
  fs.writeFileSync(file, JSON.stringify({ email: identity.value.email, password }), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  await prisma.$transaction(async (tx) => {
    if (await tx.admin.count() !== 0) throw new Error('LOCAL_ADMIN_ALREADY_EXISTS');
    await tx.admin.create({ data: { ...identity.value, passwordHash, isActive: true } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  console.log('local-admin-bootstrap=PASS count=1 credentials=private-file');
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (!['import', 'bootstrap', 'serve'].includes(mode ?? '') || process.argv.length !== 3) throw new Error('LOCAL_MODE_INVALID');
  const role = mode === 'serve' ? 'cardapio_dev_app' : 'cardapio_migrator';
  const prisma = new PrismaClient({ datasources: { db: { url: localUrl(role) } } });
  try {
    await assertLocal(prisma, role);
    if (mode === 'import') await importCatalog(prisma);
    else if (mode === 'bootstrap') await bootstrapAdmin(prisma);
    else {
      const { createApp } = await import('../src/app');
      const port = Number(process.env.PORT);
      if (port !== 4200 || process.env.CORS_ORIGIN !== 'http://localhost:5175' || process.env.NODE_ENV === 'production') {
        throw new Error('LOCAL_WEB_CONFIG_MISMATCH');
      }
      const server = createApp({ prisma }).listen(port, HOST, () => console.log('local-api-ready=http://127.0.0.1:4200'));
      for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => void prisma.$disconnect()));
      return;
    }
  } finally {
    if (mode !== 'serve') await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'LOCAL_OPERATION_FAILED';
  console.error(`local-operation-failed=${code}`);
  process.exitCode = 1;
});

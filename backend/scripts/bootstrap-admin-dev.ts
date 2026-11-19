/**
 * RF005 — provisionamento do PRIMEIRO administrador em ambiente LOCAL de desenvolvimento.
 *
 * Por que este script existe:
 * `scripts/bootstrap-admin.ts` é deliberadamente restrito ao perfil `bootstrap-homolog`
 * (banco `cardapio_digital_homolog`, role `cardapio_homolog_bootstrap`, confirmação
 * `CREATE_FIRST_ADMIN_RUSTIKA_HOMOLOG`). Ele NÃO atende o ambiente local de demonstração:
 * o banco de desenvolvimento (`cardapio_digital_dev`) está com `admins = 0`, então o login
 * administrativo do RF005 não tem como ser demonstrado. Este script cobre exatamente essa
 * lacuna, sem afrouxar a política do bootstrap de homologação.
 *
 * Garantias:
 * - só aceita o perfil `app-dev` e o banco `cardapio_digital_dev` em host local;
 * - recusa se já existir QUALQUER administrador (é bootstrap do primeiro, não gestão de usuários);
 * - recusa se o host não for local (nunca toca Neon/Render/produção);
 * - exige `--execute` + variável de confirmação para escrever; sem isso é dry-run;
 * - a senha é digitada em TTY oculto, nunca por argumento/ambiente/arquivo;
 * - reutiliza `hashPassword` e `checkPasswordPolicy` já existentes (nenhuma política nova);
 * - imprime apenas e-mail mascarado; nunca a senha nem o hash.
 *
 * Uso (na pasta backend):
 *   npx tsx scripts/bootstrap-admin-dev.ts --name "Operador" --email operador@rustika.local
 *   npx tsx scripts/bootstrap-admin-dev.ts --name "Operador" --email operador@rustika.local --execute
 *
 * Para `--execute`, defina antes na mesma sessão do PowerShell:
 *   $env:CARDAPIO_DEV_BOOTSTRAP_CONFIRMATION = "CREATE_FIRST_ADMIN_RUSTIKA_DEV"
 */
import { PrismaClient } from '@prisma/client';
import { loadDatabaseProfile } from '../src/config/secrets';
import { hashPassword } from '../src/security/password';
import { checkPasswordPolicy, maskEmail, normalizeIdentity } from './bootstrap/adminInput';
import { readHiddenLine } from './bootstrap/hiddenPrompt';

const PROFILE = 'app-dev';
const EXPECTED_DATABASE = 'cardapio_digital_dev';
const CONFIRMATION_ENV = 'CARDAPIO_DEV_BOOTSTRAP_CONFIRMATION';
const CONFIRMATION_VALUE = 'CREATE_FIRST_ADMIN_RUSTIKA_DEV';
const LOCAL_HOST = '127.0.0.1';

interface Args { name?: string; email?: string; execute: boolean }

function parseArgs(argv: readonly string[]): { ok: true; value: Args } | { ok: false; error: string } {
  const value: Args = { execute: false };
  const flags = new Set(['--name', '--email']);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (/pass|senha|secret|token|hash/i.test(arg)) {
      return { ok: false, error: 'Senhas e segredos nunca são aceitos como argumento; a senha é digitada de forma oculta.' };
    }
    if (arg === '--execute') { value.execute = true; continue; }
    if (!flags.has(arg)) return { ok: false, error: `Argumento não permitido: ${arg.slice(0, 20)}.` };
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) return { ok: false, error: `Valor ausente para ${arg}.` };
    index++;
    if (arg === '--name') value.name = next; else value.email = next;
  }
  return { ok: true, value };
}

function fail(message: string, code = 1): never {
  console.error(`[bootstrap-dev] ${message}`);
  process.exit(code);
}

/**
 * `DatabaseSecrets.host` só é preenchido em perfis de homologação; para o runtime local a
 * origem confiável é a própria URL de conexão. Lida sem imprimir credenciais.
 */
function hostFromUrl(databaseUrl: string): string | null {
  try {
    return new URL(databaseUrl).hostname || null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) fail(parsed.error);
  const args = parsed.value;

  const identity = normalizeIdentity({ name: args.name, email: args.email });
  if (!identity.ok) fail(identity.errors.join(' '));

  // 1. Perfil: apenas o runtime local de desenvolvimento.
  let database;
  try {
    database = loadDatabaseProfile(PROFILE, { purpose: 'runtime' });
  } catch (error) {
    fail(error instanceof Error ? error.message : 'Perfil app-dev inválido.');
  }
  if (database.database !== EXPECTED_DATABASE) {
    fail(`Este script só opera em ${EXPECTED_DATABASE}; o perfil aponta para ${database.database}.`, 2);
  }
  const host = hostFromUrl(database.databaseUrl);
  if (host !== LOCAL_HOST) {
    fail('Este script exige o endpoint local 127.0.0.1.', 2);
  }

  const mode = args.execute ? 'execute' : 'dry-run';

  if (args.execute && process.env[CONFIRMATION_ENV] !== CONFIRMATION_VALUE) {
    fail(`Confirmação explícita ausente. Defina ${CONFIRMATION_ENV}=${CONFIRMATION_VALUE} apenas nesta sessão.`, 2);
  }

  const prisma = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } });
  try {
    // A URL local não prova que 127.0.0.1 não é um túnel. Conferir a identidade informada pelo
    // próprio PostgreSQL antes da contagem e, sobretudo, antes de qualquer criação.
    const facts = await prisma.$queryRaw<Array<{
      db: string; usr: string; sess: string; serverAddr: string | null; clientAddr: string | null;
      serverPort: number | null; neonProjectId: string | null; homologMarker: boolean;
    }>>`
      SELECT current_database() AS db, current_user::text AS usr, session_user::text AS sess,
             host(inet_server_addr()) AS "serverAddr", host(inet_client_addr()) AS "clientAddr",
             inet_server_port() AS "serverPort", current_setting('neon.project_id', true) AS "neonProjectId",
             EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rustika_homolog_marker') AS "homologMarker"`;
    const server = facts[0];
    if (!server || server.db !== EXPECTED_DATABASE || server.usr !== database.user || server.sess !== database.user ||
        server.serverAddr !== LOCAL_HOST || server.clientAddr !== LOCAL_HOST || server.serverPort !== 5432 ||
        server.neonProjectId !== null || server.homologMarker) {
      fail('Identidade do servidor recusada: exige PostgreSQL Dev local, sem marca de homologação/Neon.', 2);
    }

    // 2. Só o PRIMEIRO administrador: se já existe qualquer um, este script não é a ferramenta.
    const existing = await prisma.admin.count();
    if (existing > 0) {
      fail(`Já existe ${existing} administrador(es) neste banco; este script cria apenas o primeiro.`, 2);
    }

    console.log(`[bootstrap-dev] ambiente=dev banco=${database.database} role=${database.user} host=${host} modo=${mode} admins=${existing}`);

    if (!args.execute) {
      console.log('[bootstrap-dev] resultado=dry-run-ok (nenhuma escrita realizada)');
      console.log(`[bootstrap-dev] criaria administrador=${maskEmail(identity.value.email)}`);
      return;
    }

    // 3. Senha em TTY oculto, com a política já existente.
    let first: string;
    let second: string;
    try {
      first = await readHiddenLine('Senha do administrador: ');
      second = await readHiddenLine('Repita a senha: ');
    } catch (error) {
      fail(error instanceof Error ? error.message : 'Falha ao ler a senha.', 2);
    }
    if (first !== second) fail('As senhas digitadas não coincidem; nada foi criado.', 2);

    const problems = checkPasswordPolicy(first, identity.value);
    if (problems.length > 0) fail(`Senha recusada: ${problems.join(' ')}`, 2);

    const passwordHash = await hashPassword(first);

    // 4. Insert atômico: a contagem é reconferida dentro da transação.
    const created = await prisma.$transaction(async (tx) => {
      const count = await tx.admin.count();
      if (count > 0) throw new Error('ADMIN_ALREADY_EXISTS');
      return tx.admin.create({
        data: { name: identity.value.name, email: identity.value.email, passwordHash, isActive: true },
        select: { id: true, email: true },
      });
    });

    console.log(`[bootstrap-dev] resultado=created administrador=${maskEmail(created.email)} id=${created.id}`);
  } catch (error) {
    if (error instanceof Error && error.message === 'ADMIN_ALREADY_EXISTS') {
      fail('Outro processo criou um administrador durante a execução; nada foi confirmado.', 2);
    }
    // Erros do Prisma podem carregar os dados do insert (inclusive o hash): imprimir só o código.
    const code = typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code : 'UNKNOWN';
    fail(`resultado=error codigo=${/^P\d{4}$/.test(code) ? code : 'UNKNOWN'} Falha ao provisionar; nada foi confirmado.`);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(`[bootstrap-dev] falha inesperada: ${error instanceof Error ? error.message : 'desconhecida'}`);
  process.exitCode = 1;
});

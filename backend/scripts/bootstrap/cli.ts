import { redactSecrets } from '../../src/config/secrets';
import type { DatabaseSecrets, LoadDatabaseProfileOptions } from '../../src/config/secrets';
import { checkPasswordPolicy, maskEmail, normalizeIdentity } from './adminInput';
import {
  BOOTSTRAP_CONFIRMATION_ENV, BOOTSTRAP_CONFIRMATION_VALUE, BOOTSTRAP_PROFILE, runBootstrap,
} from './adminBootstrap';
import type { BootstrapDb } from './adminBootstrap';

export interface BootstrapCliDeps {
  loadProfile: (profile: string, options: LoadDatabaseProfileOptions) => DatabaseSecrets;
  /** Cria o acesso ao banco com a URL do perfil; `close` é chamado sempre. */
  connect: (databaseUrl: string) => { db: BootstrapDb; close: () => Promise<void> };
  hash: (password: string) => Promise<string>;
  readHidden: (prompt: string) => Promise<string>;
  out: (line: string) => void;
  err: (line: string) => void;
}

export interface ParsedArgs { profile?: string; name?: string; email?: string; execute: boolean }

const VALUE_FLAGS = new Set(['--profile', '--name', '--email']);

export function parseBootstrapArgs(argv: readonly string[]): { ok: true; value: ParsedArgs } | { ok: false; error: string } {
  const value: ParsedArgs = { execute: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (/pass|senha|secret|token|hash/i.test(arg)) return { ok: false, error: 'Senhas e segredos nunca são aceitos como argumento; a senha é digitada de forma oculta.' };
    if (arg === '--execute') { value.execute = true; continue; }
    if (!VALUE_FLAGS.has(arg)) return { ok: false, error: `Argumento não permitido: ${arg.slice(0, 20)}.` };
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) return { ok: false, error: `Valor ausente para ${arg}.` };
    index++;
    if (arg === '--profile') value.profile = next; else if (arg === '--name') value.name = next; else value.email = next;
  }
  return { ok: true, value };
}

/** Retorna o código de saída: 0 ok · 1 erro · 2 recusado por política. Nunca imprime senha, hash ou URL com credenciais. */
export async function runBootstrapCli(deps: BootstrapCliDeps, argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  const say = (line: string): void => deps.out(redactSecrets(line));
  const fail = (message: string, code = 1): number => { deps.err(redactSecrets(`[bootstrap] ${message}`)); return code; };

  const parsed = parseBootstrapArgs(argv);
  if (!parsed.ok) return fail(parsed.error);
  const args = parsed.value;
  if (args.profile !== BOOTSTRAP_PROFILE) return fail(`Informe exatamente --profile ${BOOTSTRAP_PROFILE}.`);
  if (args.execute && env[BOOTSTRAP_CONFIRMATION_ENV] !== BOOTSTRAP_CONFIRMATION_VALUE) {
    return fail(`Confirmação explícita ausente. Defina ${BOOTSTRAP_CONFIRMATION_ENV}=${BOOTSTRAP_CONFIRMATION_VALUE} apenas no ambiente desta execução.`, 2);
  }
  const identity = normalizeIdentity({ name: args.name, email: args.email });
  if (!identity.ok) return fail(identity.errors.join(' '));

  let database: DatabaseSecrets;
  try {
    database = deps.loadProfile(BOOTSTRAP_PROFILE, { purpose: 'bootstrap' });
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Perfil de bootstrap inválido.');
  }
  if (database.environment !== 'homolog' || database.purpose !== 'bootstrap') return fail('O perfil carregado não é o de bootstrap da homologação.', 2);

  const mode = args.execute ? 'execute' : 'dry-run';
  say(`[bootstrap] ambiente=homolog banco=${database.database} role=${database.user} host=${database.host ?? '?'} modo=${mode}`);

  const connection = deps.connect(database.databaseUrl);
  try {
    const result = await runBootstrap({
      db: connection.db,
      hash: deps.hash,
      validatePassword: (password) => checkPasswordPolicy(password, identity.value),
      readPassword: async () => {
        const first = await deps.readHidden('Senha do administrador: ');
        const second = await deps.readHidden('Repita a senha: ');
        if (first !== second) throw new PasswordMismatch();
        return first;
      },
    }, identity.value, mode, { database: database.database, user: database.user, clusterId: database.clusterId ?? '' });

    if (result.status === 'created') { say(`[bootstrap] resultado=created administrador=${maskEmail(identity.value.email)}`); return 0; }
    if (result.status === 'dry-run-ok') { say('[bootstrap] resultado=dry-run-ok (nenhuma escrita realizada)'); return 0; }
    return fail(`resultado=refused codigo=${result.code} ${result.message}`, 2);
  } catch (error) {
    if (error instanceof PasswordMismatch) return fail('As senhas digitadas não coincidem; nada foi criado.', 2);
    // Erros do Prisma podem incluir os argumentos da operação (inclusive o hash): imprimir apenas um código.
    const code = typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'UNKNOWN';
    return fail(`resultado=error codigo=${/^P\d{4}$/.test(code) ? code : 'UNKNOWN'} Falha ao provisionar; nada foi confirmado. Consulte o procedimento de recuperação.`);
  } finally {
    await connection.close().catch(() => undefined);
  }
}

class PasswordMismatch extends Error {}

import type { DatabaseSecrets, LoadDatabaseProfileOptions } from '../../src/config/secrets';
import { redactSecrets } from '../../src/config/secrets';
import { checkPasswordPolicy, maskEmail, normalizeIdentity } from './adminInput';
import { parseApprovedHomologFingerprint } from './e4AltFingerprintApproval';
import {
  E4_ALT_TARGET,
  EXCEPTIONAL_CONFIRMATION_ENV,
  EXCEPTIONAL_CONFIRMATION_VALUE,
  EXCEPTIONAL_MIGRATOR_PROFILE,
  runExceptionalMigratorBootstrap,
  type ExceptionalMigratorDb,
} from './exceptionalMigratorBootstrap';

export interface ExceptionalCliDeps {
  loadProfile: (profile: string, options: LoadDatabaseProfileOptions) => DatabaseSecrets;
  connect: (database: DatabaseSecrets) => Promise<{ db: ExceptionalMigratorDb; close: () => Promise<void> }>;
  hash: (password: string) => Promise<string>;
  readHidden: (prompt: string) => Promise<string>;
  readApproval: (file: string) => string;
  out: (line: string) => void;
  err: (line: string) => void;
}

/** Informações sanitizadas de diagnóstico de erro do bootstrap.
 * Nunca contém senhas, hashes, connection strings, credenciais ou stack traces brutos. */
export interface BootstrapDiagnostic {
  stage: 'preflight' | 'password-hash' | 'insert-transaction' | 'commit-return' | 'unknown';
  errorClass: string;
  errorCode: string | null;
  sanitizedMessage: string;
  sanitizedCause: string | null;
}

/** Extrai informações de diagnóstico de um erro sem expor dados sensíveis.
 * Remove URLs de conexão, caminhos de arquivos de segredos e stack traces. */
function sanitizeError(error: unknown, stage: BootstrapDiagnostic['stage']): BootstrapDiagnostic {
  const errorClass = error instanceof Error ? error.constructor.name : typeof error;
  const errorCode = error instanceof Error && typeof (error as unknown as { code?: unknown }).code === 'string'
    ? String((error as unknown as { code?: unknown }).code)
    : null;
  const rawMessage = error instanceof Error ? error.message : String(error);
  // Sanitiza: remove padrões de DATABASE_URL, conexões e caminhos de segredos locais
  const sanitizedMessage = rawMessage
    .replace(/postgresql:\/\/[^@]+@/gi, 'postgresql://***@')
    .replace(/DATABASE_URL[^\s]*/gi, 'DATABASE_URL=***')
    .replace(/C:\\[^\\]*(?:\\.[^\\]*)*\\rustika[^\\]*\\?/gi, '<caminho-local>')
    .replace(/[A-Za-z]:\\[^\\]*(?:\\.[^\\]*)*\\?/gi, '<caminho-local>')
    .replace(/\n/g, ' ')
    .slice(0, 500);
  const sanitizedCause = error instanceof Error && error.cause
    ? String(error.cause).replace(/postgresql:\/\/[^@]+@/gi, 'postgresql://***@').slice(0, 200)
    : null;
  return { stage, errorClass, errorCode, sanitizedMessage, sanitizedCause };
}

export interface ExceptionalArgs {
  profile?: string;
  name?: string;
  email?: string;
  fingerprintApproval?: string;
  execute: boolean;
}

const VALUE_FLAGS = new Set(['--profile', '--name', '--email', '--fingerprint-approval']);

export function parseExceptionalArgs(argv: readonly string[]): { ok: true; value: ExceptionalArgs } | { ok: false; error: string } {
  const value: ExceptionalArgs = { execute: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (/pass|senha|secret|token/i.test(arg)) return { ok: false, error: 'Senhas e segredos não são aceitos como argumento.' };
    if (arg === '--execute') { value.execute = true; continue; }
    if (!VALUE_FLAGS.has(arg)) return { ok: false, error: `Argumento não permitido: ${arg.slice(0, 30)}.` };
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) return { ok: false, error: `Valor ausente para ${arg}.` };
    index++;
    if (arg === '--profile') value.profile = next;
    else if (arg === '--name') value.name = next;
    else if (arg === '--email') value.email = next;
    else value.fingerprintApproval = next;
  }
  return { ok: true, value };
}

export function strictTargetUrlProblem(database: DatabaseSecrets): string | null {
  let url: URL;
  try { url = new URL(database.databaseUrl); } catch { return 'DATABASE_URL inválida.'; }
  const host = url.hostname.toLowerCase();
  let user: string;
  let dbName: string;
  try { user = decodeURIComponent(url.username); dbName = decodeURIComponent(url.pathname); }
  catch { return 'Usuário ou banco com encoding inválido.'; }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    database.host !== host || host !== 'ep-sweet-king-bd7i7ypb.c-8.us-east-2.aws.neon.tech' ||
    (url.port !== '' && url.port !== '5432') || url.hash !== '' ||
    user !== E4_ALT_TARGET.migratorRole || dbName !== `/${E4_ALT_TARGET.database}`
  ) {
    return 'O executor exige o endpoint direto e exato do Neon.';
  }
  const allowed = new Set(['sslmode', 'sslaccept', 'channel_binding', 'schema', 'connect_timeout', 'connection_limit', 'pool_timeout', 'sslcert']);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
      return 'Parâmetro de conexão desconhecido ou duplicado no executor E4-ALT.';
    }
  }
  // Quaint 6.19.3 só aceita disable/prefer/require: verify-full cai silenciosamente em prefer.
  // require + strict usa native-tls para verificar cadeia e hostname; require não permite fallback sem TLS.
  if (url.searchParams.get('sslmode') !== 'require' || url.searchParams.get('sslaccept') !== 'strict') {
    return 'O motor Prisma exige sslmode=require e sslaccept=strict para TLS obrigatório com certificado verificado.';
  }
  if (url.searchParams.get('channel_binding') !== 'require') return 'O executor exige channel_binding=require.';
  if (url.searchParams.has('schema') && url.searchParams.get('schema') !== 'public') return 'Schema diferente de public.';
  return null;
}

export async function runExceptionalMigratorCli(
  deps: ExceptionalCliDeps,
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const say = (line: string): void => deps.out(redactSecrets(line));
  const fail = (message: string, code = 1): number => { deps.err(redactSecrets(`[bootstrap-e4-alt] ${message}`)); return code; };
  const parsed = parseExceptionalArgs(argv);
  if (!parsed.ok) return fail(parsed.error);
  const args = parsed.value;
  if (args.profile !== EXCEPTIONAL_MIGRATOR_PROFILE) return fail(`Informe exatamente --profile ${EXCEPTIONAL_MIGRATOR_PROFILE}.`, 2);
  if (!args.fingerprintApproval) return fail('Informe --fingerprint-approval com o manifesto aprovado por revisão independente.', 2);
  let approvalRaw: string;
  try { approvalRaw = deps.readApproval(args.fingerprintApproval); }
  catch { return fail('Manifesto de aprovação do fingerprint não pôde ser lido.', 2); }
  let approval: ReturnType<typeof parseApprovedHomologFingerprint>;
  try { approval = parseApprovedHomologFingerprint(approvalRaw); }
  catch { return fail('Não foi possível calcular o sourceDigest do executor para validar o manifesto.', 2); }
  if (!approval.ok) return fail(approval.error, 2);
  if (args.execute && env[EXCEPTIONAL_CONFIRMATION_ENV] !== EXCEPTIONAL_CONFIRMATION_VALUE) {
    return fail(`Confirmação explícita ausente. Exige ${EXCEPTIONAL_CONFIRMATION_ENV} com o valor E4-ALT documentado.`, 2);
  }
  const identity = normalizeIdentity({ name: args.name, email: args.email });
  if (!identity.ok) return fail(identity.errors.join(' '), 2);

  let database: DatabaseSecrets;
  try {
    database = deps.loadProfile(EXCEPTIONAL_MIGRATOR_PROFILE, { purpose: 'migration' });
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Perfil migrate-homolog inválido.', 2);
  }
  if (
    database.profile !== EXCEPTIONAL_MIGRATOR_PROFILE || database.purpose !== 'migration' ||
    database.environment !== 'homolog' || database.database !== E4_ALT_TARGET.database ||
    database.user !== E4_ALT_TARGET.migratorRole || !database.clusterId
  ) return fail('O perfil carregado não corresponde ao migrate-homolog definitivo.', 2);
  const urlProblem = strictTargetUrlProblem(database);
  if (urlProblem) return fail(urlProblem, 2);

  const mode = args.execute ? 'execute' : 'dry-run';
  say(`[bootstrap-e4-alt] alvo=${E4_ALT_TARGET.projectId}/${E4_ALT_TARGET.branchId} banco=${database.database} role=${database.user} modo=${mode}`);
  let connection: Awaited<ReturnType<ExceptionalCliDeps['connect']>>;
  try { connection = await deps.connect(database); }
  catch { return fail('Falha ao estabelecer a conexão validada; nenhuma escrita foi iniciada.'); }
  try {
    const result = await runExceptionalMigratorBootstrap({
      db: connection.db,
      hash: deps.hash,
      validatePassword: (password) => checkPasswordPolicy(password, identity.value),
      readPassword: async () => {
        const first = await deps.readHidden('Senha do primeiro administrador: ');
        const second = await deps.readHidden('Repita a senha: ');
        if (first !== second) throw new PasswordMismatch();
        return first;
      },
    }, identity.value, mode, { schemaFingerprint: approval.value.schemaFingerprint, clusterId: database.clusterId, migrationSet: 'e5-1' });
    if (result.status === 'created') {
      say(`[bootstrap-e4-alt] resultado=created administrador=${maskEmail(identity.value.email)}`);
      return 0;
    }
    if (result.status === 'dry-run-ok') {
      say('[bootstrap-e4-alt] resultado=dry-run-ok (nenhuma escrita realizada)');
      return 0;
    }
    if (result.status === 'outcome-unknown') {
      return fail('resultado=OUTCOME_UNKNOWN. NÃO REPITA. Reconcilie por contagem e e-mail em sessão somente leitura.', 3);
    }
    return fail(`resultado=refused codigo=${result.code} ${result.message}`, 2);
  } catch (error) {
    if (error instanceof PasswordMismatch) return fail('As senhas digitadas não coincidem; nenhuma escrita foi iniciada.', 2);
    const diagnostic = sanitizeError(error, 'unknown');
    const codeStr = diagnostic.errorCode ?? 'UNKNOWN';
    return fail(
      `resultado=error codigo=${/^P\d{4}$/.test(diagnostic.errorCode ?? '') ? diagnostic.errorCode : 'UNKNOWN'} `
      + `etapa=${diagnostic.stage} classe=${diagnostic.errorClass} `
      + `mensagem=${diagnostic.sanitizedMessage} `
      + `causa=${diagnostic.sanitizedCause ?? 'nenhuma'} `
      + 'Nenhum sucesso foi confirmado; consulte a recuperação.',
      1,
    );
  } finally {
    await connection.close().catch(() => undefined);
  }
}

class PasswordMismatch extends Error {}

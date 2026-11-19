import { verifyAppliedMigrations } from './migrationIntegrity';
import type { AppliedMigration } from './migrationIntegrity';
import type { AdminIdentity } from './adminInput';
import { evaluateServerIdentity } from '../../src/config/serverIdentity';
import type { ServerFacts } from '../../src/config/serverIdentity';

export const BOOTSTRAP_PROFILE = 'bootstrap-homolog';
export const BOOTSTRAP_CONFIRMATION_ENV = 'CARDAPIO_BOOTSTRAP_CONFIRMATION';
export const BOOTSTRAP_CONFIRMATION_VALUE = 'CREATE_FIRST_ADMIN_RUSTIKA_HOMOLOG';

/** Fatos lidos do banco (somente leitura) antes de qualquer escrita. */
export interface BootstrapFacts {
  database: string;
  currentUser: string;
  sessionUser: string;
  elevatedRole: boolean;          // superuser/createrole/createdb/replication/bypassrls
  serverVersionNum: number;
  canInsertAdmins: boolean;
  canUpdateAdmins: boolean;
  canDeleteAdmins: boolean;
  canTruncateAdmins: boolean;
  adminCount: number;
  migrations: AppliedMigration[];
  server: ServerFacts;
}

export type BootstrapRefusal =
  | 'ENVIRONMENT_MISMATCH' | 'UNSAFE_ROLE' | 'SCHEMA_INCOMPATIBLE' | 'ADMIN_ALREADY_EXISTS' | 'CONCURRENT_BOOTSTRAP';

export class BootstrapRefused extends Error {
  constructor(public readonly code: BootstrapRefusal, message: string) {
    super(message);
    this.name = 'BootstrapRefused';
  }
}

export interface BootstrapDb {
  readFacts(): Promise<BootstrapFacts>;
  /** Atômico: dentro de UMA transação Serializable confere que não há administrador e insere. */
  insertFirstAdmin(input: { name: string; email: string; passwordHash: string }): Promise<{ id: string }>;
}

export interface ExpectedIdentity { database: string; user: string; clusterId: string }

/** Política pura: devolve o primeiro motivo de recusa (código + mensagem segura) ou null. */
export function evaluateFacts(facts: BootstrapFacts, expected: ExpectedIdentity): { code: BootstrapRefusal; message: string } | null {
  if (facts.database !== expected.database || facts.currentUser !== expected.user || facts.sessionUser !== expected.user) {
    return { code: 'ENVIRONMENT_MISMATCH', message: 'Banco ou role conectados divergem do perfil de homologação.' };
  }
  const identity = evaluateServerIdentity(facts.server, { phase: 'final', expectedClusterId: expected.clusterId, expectedUser: expected.user });
  if (identity.length > 0) {
    return { code: 'ENVIRONMENT_MISMATCH', message: `Identidade do servidor não confere: ${identity[0]}` };
  }
  if (facts.elevatedRole || facts.serverVersionNum < 170000) {
    return { code: 'UNSAFE_ROLE', message: 'A role de bootstrap tem atributos elevados ou o PostgreSQL é anterior ao 17.' };
  }
  if (!facts.canInsertAdmins || facts.canUpdateAdmins || facts.canDeleteAdmins || facts.canTruncateAdmins) {
    return { code: 'UNSAFE_ROLE', message: 'A role de bootstrap deve ter INSERT em admins e nenhum UPDATE, DELETE ou TRUNCATE.' };
  }
  const migrationProblems = verifyAppliedMigrations(facts.migrations);
  if (migrationProblems.length > 0) {
    return { code: 'SCHEMA_INCOMPATIBLE', message: `Schema incompatível: ${migrationProblems[0]}` };
  }
  if (facts.adminCount > 0) {
    return { code: 'ADMIN_ALREADY_EXISTS', message: 'Já existe administrador neste ambiente; o bootstrap só cria o primeiro.' };
  }
  return null;
}

export interface BootstrapDeps {
  db: BootstrapDb;
  hash: (password: string) => Promise<string>;
  /** Só é chamado após todas as verificações de leitura e somente em modo execute. */
  readPassword: () => Promise<string>;
  validatePassword: (password: string) => string[];
}

export type BootstrapResult =
  | { status: 'dry-run-ok' }
  | { status: 'created'; adminId: string }
  | { status: 'refused'; code: BootstrapRefusal | 'INVALID_PASSWORD'; message: string };

export async function runBootstrap(
  deps: BootstrapDeps,
  identity: AdminIdentity,
  mode: 'dry-run' | 'execute',
  expected: ExpectedIdentity,
): Promise<BootstrapResult> {
  const refusal = evaluateFacts(await deps.db.readFacts(), expected);
  if (refusal) return { status: 'refused', ...refusal };
  if (mode === 'dry-run') return { status: 'dry-run-ok' };

  const password = await deps.readPassword();
  const problems = deps.validatePassword(password);
  if (problems.length > 0) return { status: 'refused', code: 'INVALID_PASSWORD', message: problems[0]! };

  const passwordHash = await deps.hash(password);
  try {
    const created = await deps.db.insertFirstAdmin({ name: identity.name, email: identity.email, passwordHash });
    return { status: 'created', adminId: created.id };
  } catch (error) {
    if (error instanceof BootstrapRefused) return { status: 'refused', code: error.code, message: error.message };
    throw error; // o chamador imprime apenas um código genérico: erros do Prisma podem conter os dados do insert
  }
}

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fingerprint, snapshotCompletenessProblems, type SchemaSnapshot } from '../homolog/schemaSnapshot';
import { independentSha256 } from './e4AltFingerprintIndependent';
import {
  E4_ALT_EXPECTED_MIGRATIONS,
  E4_ALT_NEON_PROVIDER_ROLE_ALIASES,
  E4_ALT_TARGET,
  EXCEPTIONAL_MIGRATOR_PROFILE,
  evaluateExceptionalFacts,
} from './exceptionalMigratorBootstrap';
import type { BootstrapAclMatrix, ExceptionalBootstrapFacts } from './exceptionalMigratorBootstrap';
import { HOMOLOG_EXPECTED_MIGRATIONS, verifyHomologMigrationChain } from '../homolog/homologMigrationChain';

const NEON_PROVIDER_ALIAS_VALUES = Object.values(E4_ALT_NEON_PROVIDER_ROLE_ALIASES);
const FORBIDDEN_PROVIDER_SECTIONS = [
  'owners', 'tableAcls', 'columnAcls', 'schemaAcls', 'databaseAcls',
  'policies', 'roles', 'schemas', 'functions', 'views', 'settings',
] as const;

/**
 * Valida que os três aliases fechados do provedor Neon aparecem SOMENTE nas duas seções onde a infraestrutura do Neon
 * os registra legitimamente (`defaultAcls` de objetos criados por `cloud_admin` e `memberships` `ADMIN`-only de
 * `neondb_owner`). Qualquer presença em owners, ACLs de tabelas/colunas/schema/banco ou políticas falha fechado.
 */
export function neonProviderRoleScopeProblems(snapshot: SchemaSnapshot): string[] {
  const problems: string[] = [];
  const mentionsProvider = (entry: string): boolean => NEON_PROVIDER_ALIAS_VALUES.some((alias) => entry.includes(alias));

  for (const section of FORBIDDEN_PROVIDER_SECTIONS) {
    if (snapshot[section].some(mentionsProvider)) {
      problems.push(`role de provedor Neon não permitida em ${section}`);
    }
  }
  for (const entry of snapshot.defaultAcls) {
    if (mentionsProvider(entry) && !/^neon_provider_cloud_admin:public:[rS]:neon_provider_superuser:[A-Z]+:(true|false)$/.test(entry)) {
      problems.push(`defaultAcl de provedor Neon fora do padrão esperado: ${entry}`);
    }
  }
  for (const entry of snapshot.memberships) {
    if (mentionsProvider(entry) && !/^(migrator|runtime|placeholder|bootstrap)<-neon_project_owner:true$/.test(entry)) {
      problems.push(`membership de provedor Neon fora do padrão ADMIN-only esperado: ${entry}`);
    }
  }
  return problems;
}

export const E4_ALT_CANDIDATE_FORMAT = 'rustika-e4-alt-fingerprint-candidate-v1';
export const E4_ALT_APPROVAL_FORMAT = 'rustika-e4-alt-fingerprint-approval-v1';
export const E51_CANDIDATE_FORMAT = 'rustika-e5-1-fingerprint-candidate-v1';
export const E51_APPROVAL_FORMAT = 'rustika-e5-1-fingerprint-approval-v1';
const SHA256 = /^[0-9a-f]{64}$/;

const SOURCE_FILES = [
  'package.json',
  'package-lock.json',
  'src/config/secrets.ts',
  'src/config/neonServerIdentity.ts',
  'src/config/externalTlsCheck.ts',
  'scripts/bootstrap-admin-migrator.ts',
  'scripts/bootstrap/exceptionalMigratorBootstrap.ts',
  'scripts/bootstrap/exceptionalMigratorCli.ts',
  'scripts/bootstrap/e4AltFingerprintApproval.ts',
  'scripts/bootstrap/e4AltFingerprintIndependent.ts',
  'scripts/bootstrap/expectedMigrations.ts',
  'scripts/homolog/schemaSnapshot.ts',
  'scripts/e4-alt-fingerprint-candidate.ts',
  'scripts/e4-alt-fingerprint-approve.ts',
] as const;

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function computeE4AltSourceDigest(backendRoot = path.resolve(__dirname, '../..')): string {
  const entries = SOURCE_FILES.map((relativePath) => ({
    path: relativePath.replace(/\\/g, '/'),
    sha256: createHash('sha256').update(fs.readFileSync(path.join(backendRoot, relativePath))).digest('hex'),
  }));
  return canonicalSha256(entries);
}

/** Amarra o candidato 10/10 aos gates e aos bytes de ambas as migrations 10. Nunca reutiliza o digest E4-ALT. */
export function computeE51SourceDigest(backendRoot = path.resolve(__dirname, '../..')): string {
  const chain = verifyHomologMigrationChain(backendRoot);
  if (chain.problems.length) throw new Error(`Cadeia 10/10 inválida: ${chain.problems.join(' ')}`);
  const files = [
    ...SOURCE_FILES,
    'scripts/homolog/homologMigrationChain.ts',
    'scripts/homolog/catalogHomologImporter.ts',
    'scripts/prisma-run.ts',
    'scripts/prisma-run-policy.ts',
    'prisma-homolog/schema.prisma',
    'prisma-homolog/migrations/20261119000000_category_crud_privilege/migration.sql',
    'prisma/migrations/20261119000000_category_crud_privilege/migration.sql',
  ];
  return canonicalSha256(files.map((relativePath) => ({
    path: relativePath,
    sha256: createHash('sha256').update(fs.readFileSync(path.join(backendRoot, relativePath))).digest('hex'),
  })));
}

export interface E4AltFingerprintCandidatePayload {
  target: typeof E4_ALT_TARGET;
  profile: typeof EXCEPTIONAL_MIGRATOR_PROFILE;
  generatedAt: string;
  gitHead: string;
  sourceDigest: string;
  serverVersionNum: number;
  migrations: ReadonlyArray<{ name: string; checksum: string; finished: boolean; rolledBack: boolean }>;
  schemaSnapshot: SchemaSnapshot;
  schemaFingerprint: string;
  bootstrapAcl: BootstrapAclMatrix;
  projectMembershipCount: number;
  neonCreatorAdminOnlyMemberships: number;
}

export interface E4AltFingerprintCandidate {
  format: typeof E4_ALT_CANDIDATE_FORMAT | typeof E51_CANDIDATE_FORMAT;
  status: 'CANDIDATE_UNAPPROVED';
  payload: E4AltFingerprintCandidatePayload;
  candidateDigest: string;
  independentVerification: { implementation: 'node-webcrypto'; digest: string; matches: boolean };
  approvalTemplate: {
    format: typeof E4_ALT_APPROVAL_FORMAT | typeof E51_APPROVAL_FORMAT;
    status: 'REQUIRES_HUMAN_APPROVAL';
    candidateDigest: string;
    schemaFingerprint: string;
    sourceDigest: string;
    projectId: string;
    branchId: string;
    database: string;
    databaseOid: string;
    migrationSetDigest: string;
    reviewer: string;
    reviewedAt: string;
    reviewEvidence: string;
  };
}

export function migrationSetDigest(): string {
  return canonicalSha256(E4_ALT_EXPECTED_MIGRATIONS);
}

export function homologMigrationSetDigest(): string {
  return canonicalSha256(HOMOLOG_EXPECTED_MIGRATIONS);
}

export function buildCandidatePayload(
  facts: ExceptionalBootstrapFacts,
  snapshot: SchemaSnapshot,
  provenance: { generatedAt: string; gitHead: string; sourceDigest: string },
): E4AltFingerprintCandidatePayload {
  return {
    target: E4_ALT_TARGET,
    profile: EXCEPTIONAL_MIGRATOR_PROFILE,
    generatedAt: provenance.generatedAt,
    gitHead: provenance.gitHead,
    sourceDigest: provenance.sourceDigest,
    serverVersionNum: facts.serverVersionNum,
    migrations: facts.migrations,
    schemaSnapshot: snapshot,
    schemaFingerprint: facts.schemaFingerprint,
    bootstrapAcl: facts.bootstrapAcl,
    projectMembershipCount: facts.projectMembershipCount,
    neonCreatorAdminOnlyMemberships: facts.neonCreatorAdminOnlyMemberships,
  };
}

export async function buildUnapprovedCandidate(
  facts: ExceptionalBootstrapFacts,
  snapshot: SchemaSnapshot,
  provenance: { generatedAt: string; gitHead: string; sourceDigest: string; clusterId: string },
  migrationSet: 'e4-alt' | 'e5-1' = 'e4-alt',
): Promise<E4AltFingerprintCandidate> {
  const refusal = evaluateExceptionalFacts(facts, {
    clusterId: provenance.clusterId, schemaFingerprint: facts.schemaFingerprint,
    migrationSet: migrationSet === 'e5-1' ? 'e5-1' : undefined,
  });
  if (refusal) throw new Error(`Candidato recusado pelos interlocks: ${refusal.code}.`);
  const completeness = [...snapshotCompletenessProblems(snapshot), ...neonProviderRoleScopeProblems(snapshot)];
  if (completeness.length > 0) throw new Error(`Snapshot incompleto: ${completeness.join('; ')}.`);
  if (fingerprint(snapshot) !== facts.schemaFingerprint) {
    throw new Error('O fingerprint do snapshot diverge dos fatos coletados na mesma transação.');
  }
  const payload = buildCandidatePayload(facts, snapshot, provenance);
  const candidateDigest = canonicalSha256(payload);
  const independentDigest = await independentSha256(payload);
  if (candidateDigest !== independentDigest) throw new Error('Verificação independente do fingerprint divergiu.');
  return {
    format: migrationSet === 'e5-1' ? E51_CANDIDATE_FORMAT : E4_ALT_CANDIDATE_FORMAT,
    status: 'CANDIDATE_UNAPPROVED',
    payload,
    candidateDigest,
    independentVerification: { implementation: 'node-webcrypto', digest: independentDigest, matches: true },
    approvalTemplate: {
      format: migrationSet === 'e5-1' ? E51_APPROVAL_FORMAT : E4_ALT_APPROVAL_FORMAT,
      status: 'REQUIRES_HUMAN_APPROVAL',
      candidateDigest,
      schemaFingerprint: facts.schemaFingerprint,
      sourceDigest: provenance.sourceDigest,
      projectId: E4_ALT_TARGET.projectId,
      branchId: E4_ALT_TARGET.branchId,
      database: E4_ALT_TARGET.database,
      databaseOid: E4_ALT_TARGET.databaseOid,
      migrationSetDigest: migrationSet === 'e5-1' ? homologMigrationSetDigest() : migrationSetDigest(),
      reviewer: '<REVISOR_INDEPENDENTE>',
      reviewedAt: '<UTC_ISO_8601>',
      reviewEvidence: '<REFERENCIA_DA_REVISAO>',
    },
  };
}

export interface ApprovedE4AltFingerprint {
  format: typeof E4_ALT_APPROVAL_FORMAT | typeof E51_APPROVAL_FORMAT;
  status: 'APPROVED';
  candidateDigest: string;
  schemaFingerprint: string;
  sourceDigest: string;
  projectId: string;
  branchId: string;
  database: string;
  databaseOid: string;
  migrationSetDigest: string;
  reviewer: string;
  reviewedAt: string;
  reviewEvidence: string;
}

export type ApprovalResult = { ok: true; value: ApprovedE4AltFingerprint } | { ok: false; error: string };

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (record: Record<string, unknown>, key: string): string => typeof record[key] === 'string' ? record[key] : '';

/**
 * O executor consome somente um manifesto humano separado. Um candidato, mesmo íntegro, nunca é promovido automaticamente.
 * Isto formaliza a aprovação; não substitui assinatura/controle de acesso externo sobre o arquivo.
 */
export function parseApprovedFingerprint(
  raw: string,
  expectedSourceDigest = computeE4AltSourceDigest(),
  migrationSet: 'e4-alt' | 'e5-1' = 'e4-alt',
): ApprovalResult {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { ok: false, error: 'Manifesto de fingerprint não é JSON válido.' }; }
  if (!object(value)) return { ok: false, error: 'Manifesto de fingerprint inválido.' };
  if (text(value, 'format') !== (migrationSet === 'e5-1' ? E51_APPROVAL_FORMAT : E4_ALT_APPROVAL_FORMAT) || text(value, 'status') !== 'APPROVED') {
    return { ok: false, error: 'Fingerprint sem aprovação humana independente (status APPROVED ausente).' };
  }
  const requiredHashes = ['candidateDigest', 'schemaFingerprint', 'sourceDigest', 'migrationSetDigest'] as const;
  if (requiredHashes.some((key) => !SHA256.test(text(value, key)))) return { ok: false, error: 'Manifesto contém digest SHA-256 inválido.' };
  if (text(value, 'sourceDigest') !== expectedSourceDigest) return { ok: false, error: 'Manifesto pertence a outra revisão do código E4-ALT.' };
  if (text(value, 'migrationSetDigest') !== (migrationSet === 'e5-1' ? homologMigrationSetDigest() : migrationSetDigest())) return { ok: false, error: 'Manifesto pertence a outro conjunto de migrations.' };
  if (
    text(value, 'projectId') !== E4_ALT_TARGET.projectId || text(value, 'branchId') !== E4_ALT_TARGET.branchId ||
    text(value, 'database') !== E4_ALT_TARGET.database || text(value, 'databaseOid') !== E4_ALT_TARGET.databaseOid
  ) return { ok: false, error: 'Manifesto pertence a outro projeto, branch, banco ou OID.' };
  const reviewer = text(value, 'reviewer').trim();
  const reviewEvidence = text(value, 'reviewEvidence').trim();
  const reviewedAt = text(value, 'reviewedAt');
  if (reviewer.length < 3 || reviewEvidence.length < 8 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(reviewedAt)) {
    return { ok: false, error: 'Aprovação independente precisa de revisor, evidência e data UTC válida.' };
  }
  return { ok: true, value: value as unknown as ApprovedE4AltFingerprint };
}

export function parseApprovedHomologFingerprint(raw: string): ApprovalResult {
  return parseApprovedFingerprint(raw, computeE51SourceDigest(), 'e5-1');
}

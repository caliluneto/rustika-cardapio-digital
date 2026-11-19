/**
 * E4-ALT — gera o CANDIDATO de fingerprint do estado definitivo de 9 migrations.
 *
 * Somente leitura: a coleta roda em transação PostgreSQL SERIALIZABLE READ ONLY comprovada no servidor.
 * O artefato sai sempre como CANDIDATE_UNAPPROVED; este script nunca aprova a própria referência.
 *
 * Uso:
 *   tsx scripts/e4-alt-fingerprint-candidate.ts --out <arquivo.json> --git-head <sha40> --authorize-read-only
 *
 * Não é executado por testes, CI, start da API nem Render. Exige autorização humana explícita
 * (--authorize-read-only) e o HEAD local exato, para vincular a evidência à revisão de código.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { readNeonServerFacts } from '../src/config/neonServerIdentity';
import { loadDatabaseProfile, redactSecrets } from '../src/config/secrets';
import { buildUnapprovedCandidate, computeE4AltSourceDigest, computeE51SourceDigest } from './bootstrap/e4AltFingerprintApproval';
import { strictTargetUrlProblem } from './bootstrap/exceptionalMigratorCli';
import {
  E4_ALT_TARGET,
  EXCEPTIONAL_MIGRATOR_PROFILE,
  collectExceptionalFacts,
  runSerializableReadOnlyTransaction,
} from './bootstrap/exceptionalMigratorBootstrap';

const BACKEND_ROOT = path.resolve(__dirname, '..');
const USAGE = 'Uso: tsx scripts/e4-alt-fingerprint-candidate.ts --out <arquivo.json> --git-head <sha40> --migration-set e5-1 --authorize-read-only (sem flag: evidência histórica 9/9)';
const GIT_SHA = /^[0-9a-f]{40}$/;

interface CandidateArgs { out: string; gitHead: string; authorized: boolean; migrationSet: 'e4-alt' | 'e5-1' }

export function parseCandidateArgs(argv: readonly string[]): CandidateArgs | null {
  const values: Partial<CandidateArgs> = { authorized: false, migrationSet: 'e4-alt' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === '--authorize-read-only') { values.authorized = true; continue; }
    if (arg !== '--out' && arg !== '--git-head' && arg !== '--migration-set') return null;
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) return null;
    index++;
    if (arg === '--out') values.out = next;
    else if (arg === '--git-head') values.gitHead = next.toLowerCase();
    else if (next === 'e5-1') values.migrationSet = next;
    else return null;
  }
  if (!values.out || !values.gitHead || !GIT_SHA.test(values.gitHead) || !values.authorized) return null;
  return values as CandidateArgs;
}

async function main(): Promise<number> {
  const args = parseCandidateArgs(process.argv.slice(2));
  if (!args) { console.error(USAGE); return 1; }

  let localHead: string;
  try {
    localHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: BACKEND_ROOT, encoding: 'utf8' }).trim().toLowerCase();
  } catch {
    console.error('[e4-alt-fingerprint] não foi possível ler o HEAD local do Git.');
    return 1;
  }
  if (localHead !== args.gitHead) {
    console.error('[e4-alt-fingerprint] --git-head diverge do HEAD local; candidate não gerado.');
    return 1;
  }

  let database;
  try {
    database = loadDatabaseProfile(EXCEPTIONAL_MIGRATOR_PROFILE, { purpose: 'migration' });
  } catch (error) {
    console.error(redactSecrets(`[e4-alt-fingerprint] perfil inválido: ${error instanceof Error ? error.message : 'erro'}`));
    return 1;
  }
  if (
    database.profile !== EXCEPTIONAL_MIGRATOR_PROFILE || database.purpose !== 'migration' ||
    database.environment !== 'homolog' || database.database !== E4_ALT_TARGET.database ||
    database.user !== E4_ALT_TARGET.migratorRole || !database.clusterId
  ) {
    console.error('[e4-alt-fingerprint] perfil carregado não corresponde ao migrate-homolog definitivo.');
    return 1;
  }
  const urlProblem = strictTargetUrlProblem(database);
  if (urlProblem) { console.error(`[e4-alt-fingerprint] ${urlProblem}`); return 1; }
  const clusterId = database.clusterId;
  const host = database.host;
  if (!clusterId || !host) { console.error('[e4-alt-fingerprint] perfil sem clusterId/host.'); return 1; }

  const prisma = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } });
  let stage = 'tls-probe';
  let startedAt = performance.now();
  const nextStage = (next: string): void => {
    console.log(`[e4-alt-fingerprint] diagnostico etapa=${stage} duracaoMs=${Math.round(performance.now() - startedAt)}`);
    stage = next;
    startedAt = performance.now();
  };
  try {
    const neon = await readNeonServerFacts(database.databaseUrl, host);
    nextStage('transaction-read-only');
    console.log(`[e4-alt-fingerprint] diagnostico protocoloTls=${neon.external.protocol ?? 'desconhecido'}`);
    if (neon.external.protocol !== 'TLSv1.3') throw new Error('TLS 1.3 externo não comprovado; coleta recusada.');
    const collection = await runSerializableReadOnlyTransaction(prisma, (tx) =>
      collectExceptionalFacts(tx, neon.external, nextStage));
    nextStage('candidate-validation');
    const candidate = await buildUnapprovedCandidate(collection.facts, collection.snapshot, {
      generatedAt: new Date().toISOString(),
      gitHead: localHead,
      sourceDigest: args.migrationSet === 'e5-1' ? computeE51SourceDigest(BACKEND_ROOT) : computeE4AltSourceDigest(BACKEND_ROOT),
      clusterId,
    }, args.migrationSet);
    nextStage('candidate-file');
    fs.writeFileSync(args.out, `${JSON.stringify(candidate, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    nextStage('complete');
    console.log(
      `[e4-alt-fingerprint] status=${candidate.status} migrations=${collection.facts.migrations.length}/${args.migrationSet === 'e5-1' ? 10 : 9} ` +
      `schema=${candidate.payload.schemaFingerprint} candidate=${candidate.candidateDigest} ` +
      `independente=${candidate.independentVerification.digest === candidate.candidateDigest ? 'ok' : 'divergente'} ` +
      `fonte=${localHead} arquivo=${args.out}`,
    );
    return 0;
  } catch (error) {
    console.error(`[e4-alt-fingerprint] diagnostico falhaEtapa=${stage} duracaoMs=${Math.round(performance.now() - startedAt)}`);
    console.error(redactSecrets(`[e4-alt-fingerprint] falha na coleta READ ONLY: ${error instanceof Error ? error.message : 'erro'}`));
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().then((code) => process.exit(code));

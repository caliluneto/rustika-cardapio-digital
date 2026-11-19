/**
 * E4-ALT — transforma um CANDIDATO revisado em manifesto de aprovação humana.
 *
 * Este script é operado por quem revisou a evidência; ele não coleta fatos remotos, não aprova sem
 * --confirm-approved e recusa candidato cujo digest não confira nas duas implementações.
 *
 * Uso:
 *   tsx scripts/e4-alt-fingerprint-approve.ts --candidate <in.json> --out <out.json> \
 *     --reviewer "<nome>" --evidence "<referencia>" --confirm-approved
 */
import fs from 'node:fs';
import { canonicalSha256, E51_CANDIDATE_FORMAT, E51_APPROVAL_FORMAT, computeE51SourceDigest, homologMigrationSetDigest, parseApprovedFingerprint, type E4AltFingerprintCandidate } from './bootstrap/e4AltFingerprintApproval';
import { HOMOLOG_EXPECTED_MIGRATIONS } from './homolog/homologMigrationChain';
import { independentSha256 } from './bootstrap/e4AltFingerprintIndependent';

const USAGE = 'Uso: tsx scripts/e4-alt-fingerprint-approve.ts --candidate <in.json> --out <out.json> --reviewer "<nome>" --evidence "<ref>" --confirm-approved';
const SHA256 = /^[0-9a-f]{64}$/;

interface ApproveArgs { candidate: string; out: string; reviewer: string; evidence: string; confirmed: boolean }

function parseApproveArgs(argv: readonly string[]): ApproveArgs | null {
  const values: Partial<ApproveArgs> = { confirmed: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === '--confirm-approved') { values.confirmed = true; continue; }
    if (!['--candidate', '--out', '--reviewer', '--evidence'].includes(arg)) return null;
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) return null;
    index++;
    if (arg === '--candidate') values.candidate = next;
    else if (arg === '--out') values.out = next;
    else if (arg === '--reviewer') values.reviewer = next.trim();
    else values.evidence = next.trim();
  }
  if (!values.candidate || !values.out || !values.reviewer || !values.evidence || !values.confirmed) return null;
  if (values.reviewer.length < 3 || values.evidence.length < 8) return null;
  return values as ApproveArgs;
}

function candidateProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'Candidato inválido.';
  const candidate = value as Partial<E4AltFingerprintCandidate>;
  if (candidate.format !== 'rustika-e4-alt-fingerprint-candidate-v1' && candidate.format !== E51_CANDIDATE_FORMAT) return 'Formato de candidato desconhecido.';
  if (candidate.status !== 'CANDIDATE_UNAPPROVED') return 'Somente CANDIDATE_UNAPPROVED pode ser submetido à aprovação.';
  if (!candidate.payload || typeof candidate.payload !== 'object') return 'Payload do candidato ausente.';
  if (!candidate.candidateDigest || !SHA256.test(candidate.candidateDigest)) return 'Digest do candidato inválido.';
  if (canonicalSha256(candidate.payload) !== candidate.candidateDigest) return 'Digest do candidato não confere com o payload.';
  const verification = candidate.independentVerification;
  if (!verification || verification.implementation !== 'node-webcrypto' || verification.matches !== true) {
    return 'Verificação independente ausente ou divergente.';
  }
  if (verification.digest !== candidate.candidateDigest) return 'Digest da verificação independente diverge.';
  if (!candidate.approvalTemplate || candidate.approvalTemplate.status !== 'REQUIRES_HUMAN_APPROVAL') {
    return 'Template de aprovação ausente.';
  }
  if (candidate.approvalTemplate.candidateDigest !== candidate.candidateDigest) return 'Template não pertence ao candidato.';
  if (candidate.format === E51_CANDIDATE_FORMAT) {
    if (candidate.approvalTemplate.format !== E51_APPROVAL_FORMAT ||
        candidate.approvalTemplate.migrationSetDigest !== homologMigrationSetDigest() ||
        JSON.stringify(candidate.payload.migrations) !== JSON.stringify(HOMOLOG_EXPECTED_MIGRATIONS.map((row) => ({ ...row, finished: true, rolledBack: false })))) {
      return 'Candidato 10/10 com migrations ou template divergentes.';
    }
    try { if (candidate.payload.sourceDigest !== computeE51SourceDigest()) return 'Candidato pertence a outra revisão do código.'; }
    catch { return 'Cadeia remota 10/10 inválida no disco.'; }
  }
  return null;
}

async function main(): Promise<number> {
  const args = parseApproveArgs(process.argv.slice(2));
  if (!args) { console.error(USAGE); return 1; }

  let raw: string;
  try { raw = fs.readFileSync(args.candidate, 'utf8'); }
  catch { console.error('[e4-alt-approval] candidato não pôde ser lido.'); return 1; }

  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { console.error('[e4-alt-approval] candidato não é JSON válido.'); return 1; }

  const problem = candidateProblem(value);
  if (problem) { console.error(`[e4-alt-approval] ${problem}`); return 1; }
  const candidate = value as E4AltFingerprintCandidate;
  if (await independentSha256(candidate.payload) !== candidate.candidateDigest) {
    console.error('[e4-alt-approval] verificação independente do payload divergiu.');
    return 1;
  }

  const approval = {
    format: candidate.approvalTemplate.format,
    status: 'APPROVED',
    candidateDigest: candidate.candidateDigest,
    schemaFingerprint: candidate.payload.schemaFingerprint,
    sourceDigest: candidate.payload.sourceDigest,
    projectId: candidate.payload.target.projectId,
    branchId: candidate.payload.target.branchId,
    database: candidate.payload.target.database,
    databaseOid: candidate.payload.target.databaseOid,
    migrationSetDigest: candidate.approvalTemplate.migrationSetDigest,
    reviewer: args.reviewer,
    reviewedAt: new Date().toISOString(),
    reviewEvidence: args.evidence,
  };
  const serialized = `${JSON.stringify(approval, null, 2)}\n`;
  const selfCheck = candidate.format === E51_CANDIDATE_FORMAT
    ? parseApprovedFingerprint(serialized, computeE51SourceDigest(), 'e5-1')
    : parseApprovedFingerprint(serialized);
  if (!selfCheck.ok) {
    console.error(`[e4-alt-approval] aprovação recusada pela verificação final: ${selfCheck.error}`);
    console.error('[e4-alt-approval] o código ou o alvo mudou depois da geração do candidato; gere outro candidato.');
    return 1;
  }
  try { fs.writeFileSync(args.out, serialized, { encoding: 'utf8', flag: 'wx' }); }
  catch { console.error('[e4-alt-approval] destino já existe ou não pôde ser gravado.'); return 1; }
  console.log(`[e4-alt-approval] status=APPROVED candidate=${approval.candidateDigest} revisor=${approval.reviewer} arquivo=${args.out}`);
  return 0;
}

main().then((code) => process.exit(code));

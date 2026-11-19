/**
 * Pré-voo OFFLINE da homologação (3D.5.2): não abre conexão com nenhum banco.
 *   CARDAPIO_SECRETS_DIR=<pasta própria da homologação> npm run homolog:preflight   # exit 1 se houver FAIL
 */
import path from 'node:path';
import { getBackendRoot, redactSecrets, resolveSecretsDir } from '../src/config/secrets';
import { runHomologPreflight } from './homolog/preflight';

function main(): number {
  if (!process.env.CARDAPIO_SECRETS_DIR?.trim()) {
    console.error('[homolog-preflight] Defina CARDAPIO_SECRETS_DIR com a pasta de segredos própria da homologação.');
    return 1;
  }
  const root = getBackendRoot();
  const findings = runHomologPreflight({
    secretsDir: resolveSecretsDir(),
    migrationsDir: path.join(root, 'prisma', 'migrations'),
    sqlDir: path.join(root, 'ops', 'homolog', 'sql'),
  });
  for (const finding of findings) console.log(redactSecrets(`[${finding.level}] ${finding.code}: ${finding.message}`));
  return findings.some((finding) => finding.level === 'FAIL') ? 1 : 0;
}

process.exit(main());

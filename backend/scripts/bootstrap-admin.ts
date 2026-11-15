/**
 * Provisiona o PRIMEIRO administrador de um ambiente novo. Operação separada da API.
 *
 *   CARDAPIO_SECRETS_DIR=<pasta própria da homologação> \
 *   tsx scripts/bootstrap-admin.ts --profile bootstrap-homolog --name "Nome" --email a@dominio   # dry-run
 *   ... mesmo comando + --execute  e  CARDAPIO_BOOTSTRAP_CONFIRMATION=CREATE_FIRST_ADMIN_RUSTIKA_HOMOLOG
 *
 * A senha é digitada de forma oculta (TTY). Nunca por argumento, variável de ambiente ou arquivo.
 * Não é executado por nenhum teste nem pelo CI.
 */
import { PrismaClient } from '@prisma/client';
import { loadDatabaseProfile } from '../src/config/secrets';
import { hashPassword } from '../src/security/password';
import { runBootstrapCli } from './bootstrap/cli';
import { createPrismaBootstrapDb } from './bootstrap/prismaBootstrapDb';
import { readHiddenLine } from './bootstrap/hiddenPrompt';

runBootstrapCli({
  loadProfile: loadDatabaseProfile,
  connect: (databaseUrl) => {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    return { db: createPrismaBootstrapDb(prisma), close: () => prisma.$disconnect() };
  },
  hash: hashPassword,
  readHidden: (prompt) => readHiddenLine(prompt),
  out: (line) => console.log(line),
  err: (line) => console.error(line),
}, process.argv.slice(2), process.env).then((code) => process.exit(code));

/**
 * E4-ALT — executor excepcional, manual e de uso único para o primeiro administrador.
 * Não integra a API HTTP, o start do Render, migrations nem os gates 05–08.
 * Sem --execute realiza somente o preflight. Toda escrita remota exige autorização externa e a confirmação E4-ALT.
 */
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import { loadDatabaseProfile } from '../src/config/secrets';
import { readNeonServerFacts } from '../src/config/neonServerIdentity';
import { hashPassword } from '../src/security/password';
import { readHiddenLine } from './bootstrap/hiddenPrompt';
import { createExceptionalMigratorDb } from './bootstrap/exceptionalMigratorBootstrap';
import { runExceptionalMigratorCli } from './bootstrap/exceptionalMigratorCli';

runExceptionalMigratorCli({
  loadProfile: loadDatabaseProfile,
  connect: async (database) => {
    if (!database.host) throw new Error('Host de homologação ausente.');
    const external = (await readNeonServerFacts(database.databaseUrl, database.host)).external;
    const prisma = new PrismaClient({ datasources: { db: { url: database.databaseUrl } } });
    return {
      db: createExceptionalMigratorDb(prisma, { proven: external.proven, reasons: external.reasons }),
      close: () => prisma.$disconnect(),
    };
  },
  hash: hashPassword,
  readHidden: (prompt) => readHiddenLine(prompt),
  readApproval: (file) => fs.readFileSync(file, 'utf8'),
  out: (line) => console.log(line),
  err: (line) => console.error(line),
}, process.argv.slice(2), process.env).then((code) => process.exit(code));

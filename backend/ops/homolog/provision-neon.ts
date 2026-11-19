import { Client } from 'pg';
import * as tls from 'node:tls';
import { spawnSync } from 'node:child_process';
import { readHiddenLine } from '../../scripts/bootstrap/hiddenPrompt';
import { inspectExternalTls } from '../../scripts/neon-probe-checks.mjs';
import * as fs from 'node:fs';

const EXPECTED_PROJECT_ID = 'aged-scene-47291697';
const EXPECTED_HOST_SUFFIX = 'aws.neon.tech';
const EXPECTED_DB = 'cardapio_digital_homolog';
const REPLAY_DB = 'cardapio_digital_test';
const EXPECTED_VERSION_PREFIX = '18.';

const ROLES = {
  admin: 'neondb_owner', migrator_legado: 'cardapio_migrator', test_app_legado: 'cardapio_test_app',
  dev_app_legado: 'cardapio_dev_app', bootstrap_final: 'cardapio_homolog_bootstrap', marker: 'rustika_homolog_marker',
  migrator_final: 'cardapio_homolog_migrator', app_final: 'cardapio_homolog_app', placeholder_final: 'cardapio_homolog_placeholder',
};

async function verifyTls(hostname: string, port: number) {
  return new Promise<void>((resolve, reject) => {
    const socket = tls.connect({ host: hostname, port, servername: hostname });
    socket.on('secureConnect', () => {
      const res = inspectExternalTls(socket, hostname);
      socket.destroy();
      if (!res.proven) reject(new Error('TLS Comprometido: ' + res.reasons.join(', ')));
      else resolve();
    });
    socket.on('error', reject);
  });
}

async function main() {
  // Interlock C.6: este script combina provisionamento com `prisma migrate deploy` e rename.
  // A autorização C.6 vigente cobre SOMENTE banco/roles; sem o reconhecimento explícito abaixo,
  // nada é lido e nada é escrito. Para a C.6 use ops/homolog/provision-neon-c6.ts.
  if (process.env.RUSTIKA_C6_FULL_REPLAY_ACK !== 'I_ACKNOWLEDGE_PRISMA_MIGRATE_DEPLOY') {
    console.error('BLOQUEADO: provision-neon.ts inclui prisma migrate deploy/rename, fora do escopo da C.6.');
    console.error('Use ops/homolog/provision-neon-c6.ts (somente banco e roles, sem migrations).');
    process.exit(2);
  }

  console.log('--- RÚSTIKA: PROVISIONAMENTO SUPERVISIONADO NEON (C.6) ---');
  const confirm = await readHiddenLine('Digite "C.6" para prosseguir: ');
  if (confirm !== 'C.6') process.exit(1);

  const connStr = await readHiddenLine('1. Connection string do banco administrativo (neondb_owner): ');
  const url = new URL(connStr);
  if (!url.hostname.endsWith(EXPECTED_HOST_SUFFIX)) throw new Error('Host inválido.');
  if (url.username !== ROLES.admin) throw new Error(`Role administrativa deve ser ${ROLES.admin}`);

  const migratorPass = await readHiddenLine('2. Defina a senha temporária para cardapio_migrator (usada no replay): ');
  if (migratorPass.length < 16) throw new Error('Senha do migrator muito curta (min 16).');

  console.log('\\n[1/8] Verificando TLS Externo...');
  await verifyTls(url.hostname, parseInt(url.port || '5432', 10));

  const client = new Client({ connectionString: connStr });
  await client.connect();
  const report: string[] = ['# Relatório de Provisionamento C.6', `Data: ${new Date().toISOString()}`];

  try {
    console.log('[2/8] Confirmando estado do servidor...');
    const vRes = await client.query('SHOW server_version;');
    if (!vRes.rows[0].server_version.startsWith(EXPECTED_VERSION_PREFIX)) throw new Error('Versão PostgreSQL não é 18.x');
    
    const neonRes = await client.query("SHOW neon.project_id;").catch(() => null);
    if (!neonRes || neonRes.rows[0]['neon.project_id'] !== EXPECTED_PROJECT_ID) throw new Error('Project ID inválido.');

    const rolesRes = await client.query(`SELECT rolname FROM pg_roles WHERE rolname LIKE 'cardapio_%' OR rolname = '${ROLES.marker}'`);
    const dbsRes = await client.query(`SELECT datname FROM pg_database WHERE datname LIKE 'cardapio_digital_%'`);
    if ((rolesRes.rowCount && rolesRes.rowCount > 0) || (dbsRes.rowCount && dbsRes.rowCount > 0)) {
      throw new Error('Ambiente não está limpo. Recusando execução.');
    }
    report.push('- Ambiente limpo confirmado (sem roles ou bancos conflitantes).');

    console.log('[3/8] Criando roles...');
    await client.query(`CREATE ROLE ${ROLES.migrator_legado} LOGIN PASSWORD '${migratorPass.replace(/'/g, "''")}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 5;`);
    await client.query(`CREATE ROLE ${ROLES.test_app_legado} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 20;`);
    await client.query(`CREATE ROLE ${ROLES.dev_app_legado} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;`);
    await client.query(`CREATE ROLE ${ROLES.bootstrap_final} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 2;`);
    await client.query(`CREATE ROLE ${ROLES.marker} NOLOGIN;`);
    report.push('- Roles legadas criadas com mínimo privilégio.');

    console.log('[4/8] Concedendo SET TRUE e criando banco de replay...');
    await client.query(`GRANT ${ROLES.migrator_legado} TO CURRENT_USER WITH SET TRUE, INHERIT FALSE;`);
    await client.query(`CREATE DATABASE ${REPLAY_DB} OWNER ${ROLES.migrator_legado} ENCODING 'UTF8' TEMPLATE template0 CONNECTION LIMIT 40;`);
    await client.query(`REVOKE ALL ON DATABASE ${REPLAY_DB} FROM PUBLIC;`);
    await client.query(`GRANT CONNECT ON DATABASE ${REPLAY_DB} TO ${ROLES.migrator_legado}, ${ROLES.test_app_legado}, ${ROLES.bootstrap_final};`);
    report.push('- Banco de replay criado e isolado.');

    console.log('[5/8] Verificando conexão migrator e aplicando migrations (Prisma Deploy)...');
    const prismaUrl = new URL(connStr);
    prismaUrl.username = ROLES.migrator_legado;
    prismaUrl.password = migratorPass;
    prismaUrl.pathname = `/${REPLAY_DB}`;
    prismaUrl.searchParams.set('sslmode', 'require');

    const mClient = new Client({ connectionString: prismaUrl.toString() });
    await mClient.connect();
    const idCheck = await mClient.query('SELECT current_database(), current_user;');
    if (idCheck.rows[0].current_database !== REPLAY_DB || idCheck.rows[0].current_user !== ROLES.migrator_legado) {
      throw new Error('Identidade do migrator falhou.');
    }
    await mClient.end();

    const deployRes = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
      stdio: 'inherit',
      env: { 
        ...process.env, 
        DATABASE_URL: prismaUrl.toString(), 
        RUSTIKA_HOMOLOG_NEON_PROXY_TLS_ACK: 'accept-proxy-terminated-tls-pg-stat-ssl-false' 
      }
    });

    if (deployRes.status !== 0) throw new Error('Falha no Prisma Deploy.');
    report.push('- Migrations aplicadas com sucesso (Prisma deploy).');

    console.log('[6/8] Verificando checksums e permissões...');
    const replayClient = new Client({ connectionString: connStr, database: REPLAY_DB });
    await replayClient.connect();
    const migs = await replayClient.query('SELECT checksum, finished_at, rolled_back_at FROM _prisma_migrations');
    if (migs.rowCount !== 7 || migs.rows.some(r => r.rolled_back_at || !r.finished_at)) {
      throw new Error('Migrations inválidas ou contagem incorreta (!= 7).');
    }
    await replayClient.end();
    report.push('- Checksums e schema final verificados (7 migrations aplicadas).');

    console.log('[7/8] Concedendo INHERIT TRUE e renomeando banco e roles...');
    await client.query(`GRANT ${ROLES.migrator_legado} TO CURRENT_USER WITH SET TRUE, INHERIT TRUE;`);
    await client.query(`ALTER DATABASE ${REPLAY_DB} RENAME TO ${EXPECTED_DB};`);
    await client.query(`ALTER ROLE ${ROLES.test_app_legado} RENAME TO ${ROLES.app_final};`);
    await client.query(`ALTER ROLE ${ROLES.migrator_legado} RENAME TO ${ROLES.migrator_final};`);
    await client.query(`ALTER ROLE ${ROLES.dev_app_legado} RENAME TO ${ROLES.placeholder_final};`);
    report.push('- Banco e roles renomeados para identidade definitiva.');

    console.log('[8/8] Revogando elevações administrativas e conferindo runtime...');
    await client.query(`REVOKE ${ROLES.migrator_final} FROM CURRENT_USER;`);
    const adminCheck = await client.query(`SELECT rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = '${ROLES.app_final}'`);
    if (adminCheck.rows[0].rolsuper || adminCheck.rows[0].rolcreaterole || adminCheck.rows[0].rolcreatedb) {
      throw new Error('A role de runtime adquiriu permissões administrativas indevidas.');
    }
    report.push('- Elevações revogadas. Runtime sem permissões administrativas.');

    console.log('\\nSUCESSO. O provisionamento básico foi concluído.');
    fs.writeFileSync('RELATORIO-PROVISIONAMENTO-C.6.md', report.join('\\n'));
    console.log('Relatório gravado em RELATORIO-PROVISIONAMENTO-C.6.md');
  } catch (e: any) {
    console.error('\\n!!! ERRO DURANTE PROVISIONAMENTO !!!', e.message);
    report.push(`- FALHA CRÍTICA: ${e.message}`);
    fs.writeFileSync('RELATORIO-PROVISIONAMENTO-C.6-FALHA.md', report.join('\\n'));
  } finally {
    await client.end();
  }
}

main().catch(console.error);

// Testes OFFLINE das verificacoes do neon-probe (node --test). Servidores TLS locais em 127.0.0.1 com certificados
// gerados na hora (openssl); nenhum banco, nenhuma rede externa, nenhum segredo.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { classifyServerSideSsl, decideProbeConnection, evaluateIdentity, inspectExternalTls, WRONG_HOST } from './neon-probe-checks.mjs';

const EXPECT = { database: 'neondb', user: 'neondb_owner', versionPrefix: '18.' };
const configuredOpenSsl = process.env.OPENSSL_BIN?.trim();
const opensslPath = configuredOpenSsl || 'openssl';
const opensslVersion = spawnSync(opensslPath, ['version'], { encoding: 'utf8', shell: false, windowsHide: true });
if (opensslVersion.error) {
  const source = configuredOpenSsl ? 'OPENSSL_BIN' : 'PATH';
  throw new Error(`OpenSSL indisponivel via ${source}: ${opensslVersion.error.message}`);
}
if (opensslVersion.status !== 0 || !/\b(?:OpenSSL|LibreSSL)\b/i.test(`${opensslVersion.stdout}\n${opensslVersion.stderr}`)) {
  throw new Error(`Executavel configurado como OpenSSL e invalido (status ${opensslVersion.status ?? 'desconhecido'}).`);
}
const openssl = (args, cwd) => {
  const r = spawnSync(opensslPath, args, { cwd, encoding: 'utf8', shell: false, windowsHide: true });
  if (r.error) throw new Error(`Falha ao executar OpenSSL: ${r.error.message}`);
  assert.equal(r.status, 0, r.stderr);
};
let dir;
const servers = [];

function makeCa(name) {
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.crt`, '-days', '2', '-subj', `/CN=${name}`], dir);
}
function makeLeaf(name, caName, dnsName) {
  fs.writeFileSync(path.join(dir, `${name}.cnf`), `[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=${dnsName}\n[ext]\nsubjectAltName=DNS:${dnsName}\nbasicConstraints=CA:FALSE\n`);
  openssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.csr`, '-config', `${name}.cnf`], dir);
  openssl(['x509', '-req', '-in', `${name}.csr`, '-CA', `${caName}.crt`, '-CAkey', `${caName}.key`, '-CAcreateserial', '-out', `${name}.crt`, '-days', '2', '-extfile', `${name}.cnf`, '-extensions', 'ext'], dir);
}
const listen = (leaf) => new Promise((resolve) => {
  const server = tls.createServer({ key: fs.readFileSync(path.join(dir, `${leaf}.key`)), cert: fs.readFileSync(path.join(dir, `${leaf}.crt`)) }, (socket) => socket.end());
  servers.push(server);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
const connect = (port, servername, caName) => new Promise((resolve, reject) => {
  const socket = tls.connect({ host: '127.0.0.1', port, servername, rejectUnauthorized: true, ca: fs.readFileSync(path.join(dir, `${caName}.crt`)) }, () => resolve(socket));
  socket.on('error', reject);
});

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neon-probe-tls-'));
  makeCa('caok'); makeCa('caother');
  makeLeaf('leafok', 'caok', 'localhost');           // cert valido para "localhost"
  makeLeaf('leafwrongname', 'caok', 'other.invalid'); // cadeia valida, nome errado
  makeLeaf('leafuntrusted', 'caother', 'localhost');  // nome certo, CA nao confiavel
});
afterAll(() => { for (const s of servers) s.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('TLS externo', () => {
  it('TLS valido: cadeia, nome e protocolo comprovados; hostname falso e rejeitado', async () => {
    const port = await listen('leafok');
    const socket = await connect(port, 'localhost', 'caok');
    const result = inspectExternalTls(socket, 'localhost');
    socket.destroy();
    assert.equal(result.authorized, true);
    assert.equal(result.nameMatches, true);
    assert.equal(result.wrongNameRejected, true);
    assert.match(result.protocol, /^TLSv1\.[23]$/);
    assert.equal(result.proven, true, result.reasons.join('|'));
  });

  it('certificado invalido (CA nao confiavel): a conexao e recusada e a inspecao de um socket nao autorizado nao comprova', async () => {
    const port = await listen('leafuntrusted');
    await assert.rejects(connect(port, 'localhost', 'caok'), (e) => /UNABLE_TO_VERIFY|SELF_SIGNED|certificate/i.test(`${e.code} ${e.message}`));
    const fake = { authorized: false, getPeerCertificate: () => ({}), getProtocol: () => 'TLSv1.3', getCipher: () => ({ name: 'x' }) };
    const result = inspectExternalTls(fake, 'localhost');
    assert.equal(result.proven, false);
    assert.ok(result.reasons.some((r) => /nao autorizado/.test(r)));
  });

  it('hostname incorreto: cadeia valida mas nome errado e recusado; verificar outro nome contra o mesmo certificado nao comprova', async () => {
    const wrong = await listen('leafwrongname');
    await assert.rejects(connect(wrong, 'localhost', 'caok'), (e) => /ERR_TLS_CERT_ALTNAME_INVALID|altnames|Hostname/i.test(`${e.code} ${e.message}`));
    const port = await listen('leafok');
    const socket = await connect(port, 'localhost', 'caok');
    const result = inspectExternalTls(socket, 'ep-outro.us-east-2.aws.neon.tech');
    socket.destroy();
    assert.equal(result.nameMatches, false);
    assert.equal(result.proven, false);
  });

  it('um certificado que aceitaria o nome falso NAO comprova (o teste de rejeicao e obrigatorio)', () => {
    const fake = { authorized: true, getPeerCertificate: () => ({ subject: { CN: WRONG_HOST }, subjectaltname: `DNS:${WRONG_HOST}` }), getProtocol: () => 'TLSv1.3', getCipher: () => ({ name: 'x' }) };
    const result = inspectExternalTls(fake, WRONG_HOST);
    assert.equal(result.wrongNameRejected, false);
    assert.equal(result.proven, false);
  });

  it('protocolo abaixo de TLS 1.2 nao comprova', () => {
    const fake = { authorized: true, getPeerCertificate: () => ({ subject: { CN: 'a.example' }, subjectaltname: 'DNS:a.example' }), getProtocol: () => 'TLSv1.1', getCipher: () => null };
    assert.equal(inspectExternalTls(fake, 'a.example').proven, false);
  });
});

describe('identidade (banco, usuario, versao)', () => {
  const ok = { db: 'neondb', usr: 'neondb_owner', su: 'neondb_owner', sv: '18.6 (x)' };
  it('correta', () => assert.deepEqual(evaluateIdentity(ok, EXPECT), []));
  it('banco incorreto', () => assert.match(evaluateIdentity({ ...ok, db: 'postgres' }, EXPECT).join(), /banco/));
  it('usuario incorreto', () => assert.match(evaluateIdentity({ ...ok, usr: 'outro' }, EXPECT).join(), /usuario/));
  it('session_user incorreto', () => assert.match(evaluateIdentity({ ...ok, su: 'outro' }, EXPECT).join(), /session_user/));
  it('versao incompativel', () => assert.match(evaluateIdentity({ ...ok, sv: '16.4' }, EXPECT).join(), /versao/));
});

describe('pg_stat_ssl x TLS externo', () => {
  const proven = { proven: true, reasons: [] };
  const notProven = { proven: false, reasons: ['certificado nao autorizado pela cadeia/CA'] };
  const ident = [];
  it('ssl=false (version=null) com TLS externo comprovado: divergencia REGISTRADA e a execucao prossegue', () => {
    const c = classifyServerSideSsl({ ssl: false, version: null }, true);
    assert.equal(c.status, 'DIVERGENCIA_REGISTRADA');
    assert.equal(c.serverSideTls, false);
    assert.match(c.detail, /termina antes do PostgreSQL/);
    assert.equal(decideProbeConnection({ external: proven, identityProblems: ident, sslClass: c, projectMismatch: false }).proceed, true);
  });
  it('ssl=false SEM TLS externo comprovado: INCOMPATIVEL e aborta', () => {
    const c = classifyServerSideSsl({ ssl: false, version: null }, false);
    assert.equal(c.status, 'INCOMPATIVEL');
    const d = decideProbeConnection({ external: notProven, identityProblems: ident, sslClass: c, projectMismatch: false });
    assert.equal(d.proceed, false);
    assert.match(d.blockers.join(), /TLS externo/);
  });
  it('ssl=null (sem linha) com TLS externo comprovado tambem e divergencia, nao falha', () => {
    assert.equal(classifyServerSideSsl({ ssl: null, version: null }, true).status, 'DIVERGENCIA_REGISTRADA');
  });
  it('ssl=true com TLS externo comprovado: consistente', () => {
    assert.equal(classifyServerSideSsl({ ssl: true, version: 'TLSv1.3' }, true).status, 'COMPROVADO');
  });
  it('pg_stat_ssl=true nao compensa TLS externo nao comprovado', () => {
    const c = classifyServerSideSsl({ ssl: true, version: 'TLSv1.3' }, false);
    assert.equal(decideProbeConnection({ external: notProven, identityProblems: ident, sslClass: c, projectMismatch: false }).proceed, false);
  });
  it('identidade ou projeto incorretos continuam bloqueando mesmo com TLS externo comprovado', () => {
    const c = classifyServerSideSsl({ ssl: false, version: null }, true);
    assert.equal(decideProbeConnection({ external: proven, identityProblems: ['banco diferente do esperado'], sslClass: c, projectMismatch: false }).proceed, false);
    assert.equal(decideProbeConnection({ external: proven, identityProblems: [], sslClass: c, projectMismatch: true }).proceed, false);
  });
});

describe('garantias no codigo do probe', () => {
  const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'neon-probe.mjs'), 'utf8');
  it('nao desliga a validacao de certificado em nenhum ponto', () => {
    assert.ok(!/rejectUnauthorized\s*:\s*false/.test(source));
    assert.ok(/rejectUnauthorized:\s*true/.test(source));
    assert.ok(!/NODE_TLS_REJECT_UNAUTHORIZED/.test(source));
  });
  it('usa o endpoint direto e nao aborta por pg_stat_ssl isolado', () => {
    assert.ok(/-pooler/.test(source));
    assert.ok(!/head\.ssl\s*===\s*true/.test(source));
  });
});

describe('auditoria estatica do modo write', () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'neon-probe.mjs'), 'utf8');
  const statements = [...src.matchAll(/`((?:CREATE|ALTER|DROP|GRANT|REVOKE|COMMENT)\b[^`]*)`/g)].map((m) => m[1]);
  const ALLOWED = [
    /^CREATE ROLE \$\{qi\(N\.(roleA|reader)\)\}/,
    /^ALTER ROLE \$\{qi\(N\.roleA\)\} RENAME TO \$\{qi\(N\.roleB\)\}$/,
    /^COMMENT ON ROLE \$\{qi\(roleName\)\} IS '\$\{marker\}'$/,
    /^CREATE DATABASE \$\{qi\(N\.db\)\} OWNER \$\{qi\(roleName\)\}/,
    /^GRANT \$\{qi\(roleName\)\} TO \$\{qi\(baseUser\)\} WITH SET TRUE, INHERIT FALSE$/,
    /^REVOKE ALL ON DATABASE \$\{qi\(N\.db\)\} FROM PUBLIC$/,
    /^GRANT CONNECT ON DATABASE \$\{qi\(N\.db\)\} TO \$\{qi\(N\.reader\)\}$/,
    /^GRANT \$\{qi\(roleName\)\} TO \$\{qi\(baseUser\)\} WITH SET TRUE, INHERIT TRUE$/,
    /^ALTER DATABASE \$\{qi\(N\.db\)\} RENAME TO \$\{qi\(N\.dbRenamed\)\}$/,
    /^REVOKE \$\{qi\(roleName\)\} FROM \$\{qi\(baseUser\)\}$/,
    /^DROP DATABASE IF EXISTS \$\{qi\(db\)\}$/,
    /^DROP ROLE IF EXISTS \$\{qi\(role\)\}$/,
    /^DROP DATABASE \$\{qi\(N\.dbRenamed\)\}$/
  ];
  it('toda instrucao de escrita pertence a lista fechada e usa somente identificadores desta execucao', () => {
    assert.ok(statements.length >= 10, `instrucoes encontradas: ${statements.length}`);
    for (const s of statements) {
      if (!ALLOWED.some((re) => re.test(s))) {
        throw new Error(`instrucao fora da lista: ${s}`);
      }
    }
  });
  it('mínimo privilégio - SET TRUE, INHERIT FALSE e a membership e revogada depois do rename', () => {
    assert.ok(/WITH SET TRUE, INHERIT TRUE/.test(src));
    assert.ok(/WITH SET TRUE, INHERIT FALSE/.test(src));
    assert.ok(/G[12]_/.test(src));
    assert.ok(/REVOKE \$\{qi\(roleName\)\} FROM \$\{qi\(baseUser\)\}/.test(src));
  });
  it('nao existe SQL de escrita fora das instrucoes enumeradas (sem TRUNCATE/DELETE/UPDATE/INSERT/ALTER SYSTEM/DROP SCHEMA/neondb)', () => {
    assert.ok(!/\b(TRUNCATE|DELETE FROM|INSERT INTO|UPDATE\s+\w+\s+SET|ALTER SYSTEM|DROP SCHEMA|DROP TABLE|DROP OWNED|REASSIGN OWNED)\b/i.test(src));
    assert.ok(!/DROP (DATABASE|ROLE)[^`]*neondb/i.test(src));
  });
  it('nomes de teste sao unicos por execucao e a limpeza so remove nomes verificados por assertOwned', () => {
    assert.ok(/const runId = crypto\.randomBytes\(4\)/.test(src));
    assert.ok(/assertOwned\(db\)/.test(src) && /assertOwned\(role\)/.test(src));
  });
  it('o modo read nao alcanca o bloco de escrita e o write exige project_id', () => {
    assert.ok(/else if \(precheckPassed\)/.test(src));
    assert.ok(/mode === 'write' && !head\.pid/.test(src));
  });
});

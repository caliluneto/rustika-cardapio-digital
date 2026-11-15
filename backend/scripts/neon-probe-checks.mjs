// Verificacoes PURAS do neon-probe (testaveis offline). Nada aqui abre conexao nem le segredos.
import tls from 'node:tls';

export const WRONG_HOST = 'wrong.example.invalid';

/**
 * TLS EXTERNO: o que o CLIENTE comprova sobre a conexao que ele mesmo abriu (cadeia/CA, nome do servidor, versao do protocolo).
 * Exige: certificado autorizado pelo repositorio de CAs, nome confere com o host pedido, um nome falso e rejeitado e TLS >= 1.2.
 * Nao depende do que o PostgreSQL enxerga.
 */
export function inspectExternalTls(socket, host) {
  const cert = socket.getPeerCertificate?.() ?? {};
  let nameMatches = false;
  let wrongNameRejected = false;
  try { nameMatches = tls.checkServerIdentity(host, cert) === undefined; } catch { nameMatches = false; }
  try { wrongNameRejected = tls.checkServerIdentity(WRONG_HOST, cert) instanceof Error; } catch { wrongNameRejected = true; }
  const protocol = socket.getProtocol?.() ?? null;
  const protocolOk = protocol === 'TLSv1.2' || protocol === 'TLSv1.3';
  const authorized = socket.authorized === true;
  const reasons = [];
  if (!authorized) reasons.push('certificado nao autorizado pela cadeia/CA');
  if (!nameMatches) reasons.push('nome do servidor nao confere');
  if (!wrongNameRejected) reasons.push('hostname incorreto nao foi rejeitado');
  if (!protocolOk) reasons.push(`protocolo inadequado (${protocol})`);
  return {
    proven: reasons.length === 0, reasons, authorized, nameMatches, wrongNameRejected, protocol,
    cipher: socket.getCipher?.()?.name ?? null, issuer: `${cert.issuer?.O ?? '?'}/${cert.issuer?.CN ?? '?'}`, validTo: cert.valid_to ?? null,
  };
}

/** IDENTIDADE (projeto/banco/usuario/versao). NAO inclui pg_stat_ssl: isso e outra camada (ver classifyServerSideSsl). */
export function evaluateIdentity(facts, expected) {
  const problems = [];
  if (facts.db !== expected.database) problems.push('banco diferente do esperado');
  if (facts.usr !== expected.user) problems.push('usuario diferente do esperado');
  if (facts.su !== expected.user) problems.push('session_user diferente do esperado');
  if (typeof facts.sv !== 'string' || !facts.sv.startsWith(expected.versionPrefix)) problems.push('versao do PostgreSQL diferente da esperada');
  return problems;
}

/**
 * ESTADO SSL OBSERVADO PELO POSTGRESQL (pg_stat_ssl) e sua relacao com o TLS externo.
 * - externo comprovado + ssl=true  -> consistente (TLS chega ao PostgreSQL).
 * - externo comprovado + ssl!=true -> DIVERGENCIA REGISTRADA: o TLS foi terminado antes do PostgreSQL (proxy do provedor); o trecho
 *   proxy->compute NAO e observavel nem comprovavel pelo cliente. Nao e falha do TLS externo, mas tambem nao prova criptografia ponta a ponta.
 * - externo NAO comprovado         -> INCOMPATIVEL (aborta), independentemente de pg_stat_ssl.
 */
export function classifyServerSideSsl({ ssl, version }, externalTlsProven) {
  const serverSideTls = ssl === true;
  if (!externalTlsProven) {
    return { status: 'INCOMPATIVEL', abort: true, serverSideTls, detail: `TLS externo nao comprovado; pg_stat_ssl.ssl=${ssl} version=${version}` };
  }
  if (serverSideTls) return { status: 'COMPROVADO', abort: false, serverSideTls, detail: `pg_stat_ssl.ssl=true version=${version}: TLS tambem observado pelo PostgreSQL` };
  return {
    status: 'DIVERGENCIA_REGISTRADA', abort: false, serverSideTls,
    detail: `pg_stat_ssl.ssl=${ssl} version=${version} com TLS externo comprovado: o TLS termina antes do PostgreSQL (proxy); o trecho interno nao e verificavel pelo cliente`,
  };
}

/** Decisao final do diagnostico de conexao: abortar somente por TLS externo, identidade ou projeto — nunca por pg_stat_ssl isolado. */
export function decideProbeConnection({ external, identityProblems, sslClass, projectMismatch }) {
  const blockers = [];
  if (!external.proven) blockers.push(`TLS externo: ${external.reasons.join('; ')}`);
  if (identityProblems.length) blockers.push(`identidade: ${identityProblems.join('; ')}`);
  if (projectMismatch) blockers.push('projeto Neon diferente do esperado');
  if (sslClass.abort && external.proven) blockers.push('classificacao pg_stat_ssl exigiu abortar');
  return { proceed: blockers.length === 0, blockers };
}

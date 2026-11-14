import tls from 'node:tls';

/**
 * 3D.5.3-C.5 — verificação INDEPENDENTE do TLS externo (o que o CLIENTE comprova sobre a conexão que ele mesmo abriu:
 * cadeia/CA, nome do servidor, protocolo). Porta a lógica já auditada em `backend/scripts/neon-probe-checks.mjs`
 * (3D.5.3-C.2.2) para dentro do backend, para uso no gate de inicialização do perfil Neon.
 *
 * Isto é DELIBERADAMENTE uma camada diferente de `pg_stat_ssl` (ver `neonServerIdentity.ts`): aqui provamos o TLS entre
 * este processo e o endpoint ao qual ele se conectou; não provamos o trecho entre o proxy do provedor e o PostgreSQL.
 */
export const WRONG_HOST = 'wrong.example.invalid';

export interface MinimalTlsSocket {
  authorized?: boolean;
  getPeerCertificate(): tls.PeerCertificate;
  getProtocol(): string | null;
  getCipher?(): { name: string } | null;
}

export interface ExternalTlsResult {
  proven: boolean;
  reasons: string[];
  authorized: boolean;
  nameMatches: boolean;
  wrongNameRejected: boolean;
  protocol: string | null;
  cipher: string | null;
  issuer: string;
  validTo: string | null;
}

/** Nunca aceita `rejectUnauthorized: false`; quem abre a conexão é responsável por isso (ver neonServerIdentity.ts). */
export function inspectExternalTls(socket: MinimalTlsSocket, host: string): ExternalTlsResult {
  const cert = socket.getPeerCertificate();
  let nameMatches = false;
  try { nameMatches = tls.checkServerIdentity(host, cert) === undefined; } catch { nameMatches = false; }
  let wrongNameRejected = false;
  try { wrongNameRejected = tls.checkServerIdentity(WRONG_HOST, cert) instanceof Error; } catch { wrongNameRejected = true; }
  const protocol = socket.getProtocol();
  const protocolOk = protocol === 'TLSv1.2' || protocol === 'TLSv1.3';
  const authorized = socket.authorized === true;
  const reasons: string[] = [];
  if (!authorized) reasons.push('certificado não autorizado pela cadeia/CA');
  if (!nameMatches) reasons.push('nome do servidor não confere');
  if (!wrongNameRejected) reasons.push('hostname incorreto não foi rejeitado');
  if (!protocolOk) reasons.push(`protocolo inadequado (${protocol ?? 'desconhecido'})`);
  const certWithFields = cert as tls.PeerCertificate & { issuer?: { O?: string; CN?: string }; valid_to?: string };
  return {
    proven: reasons.length === 0, reasons, authorized, nameMatches, wrongNameRejected, protocol,
    cipher: socket.getCipher?.()?.name ?? null,
    issuer: `${certWithFields.issuer?.O ?? '?'}/${certWithFields.issuer?.CN ?? '?'}`,
    validTo: certWithFields.valid_to ?? null,
  };
}

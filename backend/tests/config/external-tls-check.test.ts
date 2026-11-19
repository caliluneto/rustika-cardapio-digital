import { describe, expect, it } from 'vitest';
import { inspectExternalTls, WRONG_HOST, type MinimalTlsSocket } from '../../src/config/externalTlsCheck';

const socket = (patch: Partial<MinimalTlsSocket> & { cert?: Record<string, unknown> } = {}): MinimalTlsSocket => ({
  authorized: patch.authorized ?? true,
  getPeerCertificate: () => (patch.cert ?? { subject: { CN: 'a.example' }, subjectaltname: 'DNS:a.example' }) as never,
  getProtocol: () => patch.getProtocol ? patch.getProtocol() : 'TLSv1.3',
  getCipher: () => ({ name: 'TLS_AES_256_GCM_SHA384' }),
});

describe('3D.5.3-C.5 (Parte B/C) — inspectExternalTls (TLS válido, certificado inválido, hostname incorreto)', () => {
  it('TLS válido: autorizado, nome confere, nome errado é rejeitado, protocolo aceitável', () => {
    const result = inspectExternalTls(socket(), 'a.example');
    expect(result).toMatchObject({ proven: true, authorized: true, nameMatches: true, wrongNameRejected: true, protocol: 'TLSv1.3' });
    expect(result.reasons).toEqual([]);
  });

  it('certificado inválido (socket não autorizado pela cadeia/CA) nunca comprova, mesmo com nome certo', () => {
    const result = inspectExternalTls(socket({ authorized: false }), 'a.example');
    expect(result.proven).toBe(false);
    expect(result.reasons).toContain('certificado não autorizado pela cadeia/CA');
  });

  it('hostname incorreto: nome do certificado não confere com o host pedido', () => {
    const result = inspectExternalTls(socket(), 'ep-outro.us-east-2.aws.neon.tech');
    expect(result.proven).toBe(false);
    expect(result.nameMatches).toBe(false);
    expect(result.reasons).toContain('nome do servidor não confere');
  });

  it('um certificado que aceitaria o WRONG_HOST também não comprova (o teste de rejeição é obrigatório)', () => {
    const result = inspectExternalTls(socket({ cert: { subject: { CN: WRONG_HOST }, subjectaltname: `DNS:${WRONG_HOST}` } }), WRONG_HOST);
    expect(result.wrongNameRejected).toBe(false);
    expect(result.proven).toBe(false);
  });

  it('protocolo abaixo de TLS 1.2 não comprova', () => {
    expect(inspectExternalTls(socket({ getProtocol: () => 'TLSv1.1' }), 'a.example').proven).toBe(false);
    expect(inspectExternalTls(socket({ getProtocol: () => null }), 'a.example').proven).toBe(false);
  });
});

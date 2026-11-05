import { describe, expect, it } from 'vitest';
import { createAdminAuth } from '../../src/services/adminAuth.service';
import { createComandaAccess, COMANDA_SESSION_MS } from '../../src/services/comandaAccess.service';
import { ADMIN_SESSION_MS, createAdminSessions } from '../../src/security/adminSessions';
import { hashPassword, verifyPassword } from '../../src/security/password';
import { assertActiveSession, sha256 } from '../../src/services/orderSession';
import { mockAccessPrisma, TEST_PASSWORD } from '../fixtures/access';

async function setup() {
  const mock = await mockAccessPrisma();
  const auth = createAdminAuth(mock.prisma, mock.now);
  const access = createComandaAccess(mock.prisma, auth, mock.now);
  const login = () => auth.login({ email: mock.admin.email, password: TEST_PASSWORD });
  return { ...mock, auth, access, login };
}

describe('credenciais e sessão administrativa', () => {
  it('hash scrypt tem sal aleatório e verifica senha sem texto puro', async () => {
    const first = await hashPassword(TEST_PASSWORD); const second = await hashPassword(TEST_PASSWORD);
    expect(first).not.toBe(second); expect(first).not.toContain(TEST_PASSWORD);
    expect(await verifyPassword(TEST_PASSWORD, first)).toBe(true);
    expect(await verifyPassword('wrong', first)).toBe(false);
    expect(await verifyPassword(TEST_PASSWORD, TEST_PASSWORD)).toBe(false);
    expect(await verifyPassword(TEST_PASSWORD, first.replace('$32768$', '$999999999$'))).toBe(false);
    await expect(hashPassword('short')).rejects.toThrow();
  }, 20000);

  it('login normaliza e-mail e emite sessão aleatória com prazo, sem hash no DTO', async () => {
    const mock = await setup();
    const result = await mock.auth.login({ email: ' ADMIN@example.test ', password: TEST_PASSWORD });
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(result.expiresAt.getTime() - mock.now().getTime()).toBe(ADMIN_SESSION_MS);
    expect(result.admin).toEqual({ id: mock.admin.id, name: mock.admin.name, email: mock.admin.email });
    expect((await mock.auth.authenticate(result.token)).admin.id).toBe(mock.admin.id);
  });

  it.each(['wrong-password', 'missing-admin', 'inactive', 'unsupported-hash'])('login inválido: %s', async (scenario) => {
    const mock = await setup();
    if (scenario === 'missing-admin') mock.control.missingAdmin = true;
    if (scenario === 'inactive') mock.admin.isActive = false;
    if (scenario === 'unsupported-hash') mock.admin.passwordHash = 'plaintext';
    await expect(mock.auth.login({ email: mock.admin.email, password: scenario === 'wrong-password' ? 'wrong' : TEST_PASSWORD }))
      .rejects.toMatchObject({ statusCode: 401, code: 'INVALID_CREDENTIALS' });
  });

  it('sessão expira e logout invalida imediatamente', async () => {
    const mock = await setup(); const first = await mock.login();
    mock.advance(ADMIN_SESSION_MS);
    await expect(mock.auth.authenticate(first.token)).rejects.toMatchObject({ statusCode: 401 });
    const second = await mock.login(); mock.auth.logout(second.token);
    await expect(mock.auth.authenticate(second.token)).rejects.toMatchObject({ statusCode: 401 });
  });

  it.each(['deactivate', 'password-change', 'restart'])('invalida sessão após %s', async (scenario) => {
    const mock = await setup(); const result = await mock.login();
    if (scenario === 'deactivate') mock.admin.isActive = false;
    if (scenario === 'password-change') mock.admin.updatedAt = new Date(mock.admin.updatedAt.getTime() + 1);
    const auth = scenario === 'restart' ? createAdminAuth(mock.prisma, mock.now) : mock.auth;
    await expect(auth.authenticate(result.token)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('login renova token e invalida o cookie administrativo anterior', async () => {
    const mock = await setup(); const first = await mock.login();
    const second = await mock.auth.login({ email: mock.admin.email, password: TEST_PASSWORD }, first.token);
    expect(second.token).not.toBe(first.token);
    await expect(mock.auth.authenticate(first.token)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('store tem capacidade limitada e libera entradas expiradas', () => {
    let time = new Date(); const store = createAdminSessions(() => time, 1);
    store.issue('admin', 1);
    expect(() => store.issue('admin', 1)).toThrow();
    time = new Date(time.getTime() + ADMIN_SESSION_MS);
    expect(store.issue('admin', 1).token).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('convite e sessão legítima de comanda', () => {
  it('emissão exige administrador, preserva zeros e reutiliza somente comanda aberta', async () => {
    const mock = await setup();
    await expect(mock.access.issue({ comandaNumber: '000123' }, undefined)).rejects.toMatchObject({ statusCode: 401 });
    expect(mock.transaction).not.toHaveBeenCalled();
    const admin = await mock.login();
    const first = await mock.access.issue({ comandaNumber: '000123' }, admin.token);
    const second = await mock.access.issue({ comandaNumber: '000123', expiresInMinutes: 5 }, admin.token);
    expect(mock.state().comandas).toHaveLength(1);
    expect(mock.state().invitations).toHaveLength(2);
    expect(first.inviteToken).not.toBe(second.inviteToken);
    expect(first.comanda.number).toBe('000123');
    expect(first.expiresAt.getTime() - mock.now().getTime()).toBe(600000);
    expect(mock.state().invitations[0]).toMatchObject({ issuedByAdminId: mock.admin.id, tokenHash: sha256(first.inviteToken) });
    expect(JSON.stringify(mock.state())).not.toContain(first.inviteToken);
  });

  it.each(['CLOSED', 'CANCELLED'] as const)('não reabre comanda %s', async (status) => {
    const mock = await setup(); const admin = await mock.login();
    await mock.access.issue({ comandaNumber: '1' }, admin.token);
    mock.state().comandas[0]!.status = status;
    await expect(mock.access.issue({ comandaNumber: '1' }, admin.token)).rejects.toMatchObject({ statusCode: 409, code: 'COMANDA_CLOSED' });
    expect(mock.state().invitations).toHaveLength(1);
  });

  it('resgate consome convite e cria sessão compatível com orderSession, só com hashes no banco', async () => {
    const mock = await setup(); const admin = await mock.login();
    const invite = await mock.access.issue({ comandaNumber: '001' }, admin.token);
    const result = await mock.access.redeem({ inviteToken: invite.inviteToken });
    const session = mock.state().sessions[0]!;
    expect(session).toMatchObject({ credentialHash: sha256(result.token), invitationId: mock.state().invitations[0]!.id, comandaId: mock.state().comandas[0]!.id });
    expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBe(COMANDA_SESSION_MS);
    expect(mock.state().invitations[0]!.consumedAt).toEqual(mock.now());
    expect(JSON.stringify(mock.state())).not.toContain(result.token);
    expect(() => assertActiveSession({ ...session, comanda: mock.state().comandas[0]! }, mock.now())).not.toThrow();
    expect((await mock.access.current(result.token)).comanda.number).toBe('001');
    expect(mock.inviteClaim).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ consumedAt: null, revokedAt: null, expiresAt: { gt: mock.now() } }) }), expect.anything());
  });

  it.each(['unknown', 'expired', 'revoked', 'consumed', 'closed', 'inactive-issuer', 'future'])(
    'recusa convite %s sem criar sessão', async (scenario) => {
      const mock = await setup(); const admin = await mock.login();
      const invite = await mock.access.issue({ comandaNumber: '1' }, admin.token);
      const record = mock.state().invitations[0]!;
      if (scenario === 'expired') record.expiresAt = mock.now();
      if (scenario === 'revoked') record.revokedAt = mock.now();
      if (scenario === 'consumed') record.consumedAt = mock.now();
      if (scenario === 'closed') mock.state().comandas[0]!.status = 'CLOSED';
      if (scenario === 'inactive-issuer') mock.admin.isActive = false;
      if (scenario === 'future') record.createdAt = new Date(mock.now().getTime() + 1000);
      await expect(mock.access.redeem({ inviteToken: scenario === 'unknown' ? '0'.repeat(64) : invite.inviteToken }))
        .rejects.toMatchObject({ statusCode: 401, code: 'INVALID_INVITATION' });
      expect(mock.state().sessions).toHaveLength(0);
    },
  );

  it('reutilização não cria segunda sessão nem devolve o segredo anterior', async () => {
    const mock = await setup(); const admin = await mock.login();
    const invite = await mock.access.issue({ comandaNumber: '1' }, admin.token);
    await mock.access.redeem({ inviteToken: invite.inviteToken });
    await expect(mock.access.redeem({ inviteToken: invite.inviteToken })).rejects.toMatchObject({ statusCode: 401 });
    expect(mock.state().sessions).toHaveLength(1);
  });

  it('dois resgates concorrentes confirmam somente uma sessão', async () => {
    const mock = await setup(); const admin = await mock.login();
    const invite = await mock.access.issue({ comandaNumber: '1' }, admin.token);
    const outcomes = await Promise.allSettled([mock.access.redeem({ inviteToken: invite.inviteToken }), mock.access.redeem({ inviteToken: invite.inviteToken })]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({ statusCode: 401, code: 'INVALID_INVITATION' });
    expect(mock.state().sessions).toHaveLength(1);
  });

  it('claim perdido não cria sessão', async () => {
    const mock = await setup(); const admin = await mock.login();
    const invite = await mock.access.issue({ comandaNumber: '1' }, admin.token);
    mock.inviteClaim.mockResolvedValueOnce({ count: 0 });
    await expect(mock.access.redeem({ inviteToken: invite.inviteToken })).rejects.toMatchObject({ statusCode: 401 });
    expect(mock.sessionCreate).not.toHaveBeenCalled();
  });

  it.each(['create', 'commit'])('falha em %s preserva convite não consumido no double', async (stage) => {
    const mock = await setup(); const admin = await mock.login();
    const invite = await mock.access.issue({ comandaNumber: '1' }, admin.token);
    mock.control.failSession = stage === 'create'; mock.control.failCommit = stage === 'commit';
    await expect(mock.access.redeem({ inviteToken: invite.inviteToken })).rejects.toThrow();
    expect(mock.state().invitations[0]!.consumedAt).toBeNull();
    expect(mock.state().sessions).toHaveLength(0);
  });

  it('falha transacional na emissão não confirma comanda ou convite', async () => {
    const mock = await setup(); const admin = await mock.login(); mock.control.failCommit = true;
    await expect(mock.access.issue({ comandaNumber: '1' }, admin.token)).rejects.toThrow();
    expect(mock.state().comandas).toHaveLength(0); expect(mock.state().invitations).toHaveLength(0);
  });
});

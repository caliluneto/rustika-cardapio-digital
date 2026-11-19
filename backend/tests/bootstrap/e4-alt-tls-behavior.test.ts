import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';

// Servidor de negociação PostgreSQL local: prova o handshake TLS dos drivers reais,
// sem autenticar, consultar ou escrever em qualquer banco (especialmente o Neon).
let directory: string;
let ca: string;
let wrongCa: string;
let validKey: Buffer;
let validCert: Buffer;
let expiredCert: Buffer;
let wrongHostCert: Buffer;
const openssl = process.platform === 'win32'
  ? path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'usr', 'bin', 'openssl.exe')
  : 'openssl';

function run(...args: string[]): void {
  execFileSync(openssl, args, { cwd: directory, stdio: 'ignore' });
}

beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'rustika-e4-tls-'));
  writeFileSync(path.join(directory, 'san.cnf'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\n');
  writeFileSync(path.join(directory, 'wrong-san.cnf'), 'subjectAltName=DNS:wrong.example.invalid\n');
  for (const name of ['ca', 'wrong-ca']) {
    run('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-keyout', `${name}.key`, '-out', `${name}.pem`, '-subj', `/CN=Rustika ${name}`);
  }
  run('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=localhost');
  for (const name of ['server', 'expired', 'wrong-host']) {
    run('x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial',
      '-out', `${name}.pem`, '-days', '1', ...name === 'expired' ? ['-not_before', '20190101000000Z', '-not_after', '20200101000000Z'] : [],
      '-extfile', name === 'wrong-host' ? 'wrong-san.cnf' : 'san.cnf');
  }
  ca = path.join(directory, 'ca.pem');
  wrongCa = path.join(directory, 'wrong-ca.pem');
  validKey = readFileSync(path.join(directory, 'server.key'));
  validCert = readFileSync(path.join(directory, 'server.pem'));
  expiredCert = readFileSync(path.join(directory, 'expired.pem'));
  wrongHostCert = readFileSync(path.join(directory, 'wrong-host.pem'));
});
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

async function serverCase(
  cert: Buffer,
  answer: 'tls' | 'no-tls' = 'tls',
  mechanisms?: string[],
): Promise<{ port: number; state: { sslRequests: number; startups: number; saslResponses: number; mechanism: string | null }; close: () => Promise<void> }> {
  const state = { sslRequests: 0, startups: 0, saslResponses: 0, mechanism: null as string | null };
  const sockets = new Set<net.Socket>();
  const context = tls.createSecureContext({ key: validKey, cert });
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.once('data', (request) => {
      if (request.length < 8 || request.readInt32BE(4) !== 80877103) { socket.destroy(); return; }
      state.sslRequests++;
      socket.write(answer === 'tls' ? 'S' : 'N');
      if (answer === 'no-tls') { socket.end(); return; }
      const secure = new tls.TLSSocket(socket, { isServer: true, secureContext: context });
      secure.on('error', () => undefined);
      secure.on('data', (packet) => {
        if (!state.startups) {
          state.startups++;
          if (mechanisms) {
            const body = Buffer.concat([Buffer.from([0, 0, 0, 10]), Buffer.from(`${mechanisms.join('\0')}\0\0`)]);
            const packet = Buffer.alloc(5);
            packet.write('R'); packet.writeInt32BE(body.length + 4, 1);
            secure.write(Buffer.concat([packet, body]));
          } else secure.end();
        } else {
          state.saslResponses++;
          state.mechanism = packet.toString('utf8', 5).split('\0')[0] ?? null;
          secure.end();
        }
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Porta local indisponível');
  return { port: address.port, state, close: async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  } };
}

async function prismaAttempt(port: number, certificate = ca, binding = 'require'): Promise<void> {
  const url = new URL(`postgresql://tester:unused@127.0.0.1:${port}/postgres`);
  url.searchParams.set('sslmode', 'require');
  url.searchParams.set('sslaccept', 'strict');
  url.searchParams.set('channel_binding', binding);
  url.searchParams.set('sslcert', certificate);
  url.searchParams.set('connect_timeout', '2');
  const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try { await prisma.$queryRaw`SELECT 1`; } finally { await prisma.$disconnect(); }
}

describe('E4-ALT — handshake real dos clientes, offline', () => {
  it('Prisma/Quaint aceita cadeia e hostname corretos até o início da autenticação', async () => {
    const server = await serverCase(validCert);
    try {
      await expect(prismaAttempt(server.port)).rejects.toThrow(); // servidor de teste não autentica
      expect(server.state.sslRequests).toBeGreaterThan(0);
      expect(server.state.startups).toBeGreaterThan(0);
    } finally { await server.close(); }
  });

  it.each(['invalid-ca', 'expired', 'wrong-host'] as const)('Prisma/Quaint rejeita %s antes do startup', async (kind) => {
    const server = await serverCase(kind === 'expired' ? expiredCert : kind === 'wrong-host' ? wrongHostCert : validCert);
    try {
      await expect(prismaAttempt(server.port, kind === 'invalid-ca' ? wrongCa : ca)).rejects.toThrow();
      expect(server.state.sslRequests).toBeGreaterThan(0);
      expect(server.state.startups).toBe(0);
    } finally { await server.close(); }
  });

  it('Prisma/Quaint rejeita servidor sem TLS, sem fallback', async () => {
    const server = await serverCase(validCert, 'no-tls');
    try {
      await expect(prismaAttempt(server.port)).rejects.toThrow();
      expect(server.state.sslRequests).toBeGreaterThan(0);
      expect(server.state.startups).toBe(0);
    } finally { await server.close(); }
  });

  it('Prisma/Quaint recusa SCRAM sem PLUS quando channel_binding=require', async () => {
    const server = await serverCase(validCert, 'tls', ['SCRAM-SHA-256']);
    try {
      await expect(prismaAttempt(server.port)).rejects.toThrow();
      expect(server.state.startups).toBeGreaterThan(0);
      expect(server.state.saslResponses).toBe(0);
    } finally { await server.close(); }
  });

  it('Prisma/Quaint negocia SCRAM-SHA-256-PLUS quando disponível', async () => {
    const server = await serverCase(validCert, 'tls', ['SCRAM-SHA-256', 'SCRAM-SHA-256-PLUS']);
    try {
      await expect(prismaAttempt(server.port)).rejects.toThrow(); // sem desafio SCRAM real
      expect(server.state.mechanism).toBe('SCRAM-SHA-256-PLUS');
    } finally { await server.close(); }
  });

  it('node-postgres usa CA, SNI e versão explícitos na sonda independente', async () => {
    const server = await serverCase(validCert);
    const client = new Client({ host: 'localhost', port: server.port, user: 'tester', password: 'unused', database: 'postgres',
      connectionTimeoutMillis: 2000, ssl: { rejectUnauthorized: true, servername: 'localhost', minVersion: 'TLSv1.2', ca: readFileSync(ca, 'utf8') } });
    try {
      await expect(client.connect()).rejects.toThrow(); // autenticação indisponível no servidor sintético
      expect(server.state.startups).toBeGreaterThan(0);
    } finally { await client.end().catch(() => undefined); await server.close(); }
  });

  it.each(['invalid-ca', 'wrong-host', 'expired', 'no-tls'] as const)(
    'node-postgres recusa %s antes de enviar startup', async (kind) => {
      const cert = kind === 'wrong-host' ? wrongHostCert : kind === 'expired' ? expiredCert : validCert;
      const server = await serverCase(cert, kind === 'no-tls' ? 'no-tls' : 'tls');
      const client = new Client({ host: '127.0.0.1', port: server.port, user: 'tester', password: 'unused', database: 'postgres',
        connectionTimeoutMillis: 2000, ssl: { rejectUnauthorized: true, servername: 'localhost', minVersion: 'TLSv1.2',
          ca: readFileSync(kind === 'invalid-ca' ? wrongCa : ca, 'utf8') } });
      try {
        await expect(client.connect()).rejects.toThrow();
        expect(server.state.startups).toBe(0);
      } finally { await client.end().catch(() => undefined); await server.close(); }
    },
  );
});

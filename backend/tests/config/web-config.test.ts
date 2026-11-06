import { describe, expect, it } from 'vitest';
import { WebConfigError, readGateConfig, readTrustProxyHops, readWebConfig } from '../../src/config/webConfig';

const PASSWORD = 'Senha-Longa-De-Teste-000-xyz';
const dir = () => '/tmp/frontend-dist';

describe('3D.5.3-B - configuração web (opt-in, falha fechada)', () => {
  it('sem variáveis: somente API, 0 saltos de proxy, sem portão, sem noindex', () => {
    expect(readWebConfig({}, dir)).toEqual({ trustProxyHops: 0, noindex: false });
  });

  it('SERVE_FRONTEND=on define o diretório; off/ausente não; valores inválidos falham', () => {
    expect(readWebConfig({ SERVE_FRONTEND: 'on' }, dir).frontendDir).toBe('/tmp/frontend-dist');
    expect(readWebConfig({ SERVE_FRONTEND: 'off' }, dir).frontendDir).toBeUndefined();
    for (const bad of ['true', '1', 'yes', 'ON!']) expect(() => readWebConfig({ SERVE_FRONTEND: bad }, dir)).toThrow(WebConfigError);
  });

  it('TRUST_PROXY_HOPS: inteiro de 0 a 5; nunca "true"/negativo/fracionário/texto', () => {
    expect(readTrustProxyHops(undefined)).toBe(0);
    expect(readTrustProxyHops('')).toBe(0);
    expect(readTrustProxyHops('0')).toBe(0);
    expect(readTrustProxyHops('1')).toBe(1);
    expect(readTrustProxyHops('5')).toBe(5);
    for (const bad of ['true', 'false', '-1', '1.5', '6', '10', '99', 'abc', '1 ', '1e1', '0x1', '+1']) {
      if (bad === '1 ') { expect(readTrustProxyHops(bad)).toBe(1); continue; } // espaços nas pontas são aparados
      expect(() => readTrustProxyHops(bad), bad).toThrow(/TRUST_PROXY_HOPS/);
    }
  });

  it('portão: desativado por padrão; ativado exige usuário e senha válidos', () => {
    expect(readGateConfig({})).toBeUndefined();
    expect(readGateConfig({ HOMOLOG_GATE: 'off', HOMOLOG_GATE_USER: 'x', HOMOLOG_GATE_PASSWORD: 'y' })).toBeUndefined();
    expect(readGateConfig({ HOMOLOG_GATE: 'on', HOMOLOG_GATE_USER: 'operador', HOMOLOG_GATE_PASSWORD: PASSWORD })).toEqual({ user: 'operador', password: PASSWORD });
    expect(() => readGateConfig({ HOMOLOG_GATE: 'sim' })).toThrow(WebConfigError);
  });

  it('portão ativo sem credenciais, com credenciais fracas ou malformadas: falha', () => {
    const on = { HOMOLOG_GATE: 'on' };
    expect(() => readGateConfig(on)).toThrow(/HOMOLOG_GATE_USER/);
    expect(() => readGateConfig({ ...on, HOMOLOG_GATE_USER: 'operador' })).toThrow(/HOMOLOG_GATE_PASSWORD/);
    for (const user of ['ab', 'com:doispontos', 'com espaço', 'a'.repeat(65), 'acentuação']) {
      expect(() => readGateConfig({ ...on, HOMOLOG_GATE_USER: user, HOMOLOG_GATE_PASSWORD: PASSWORD }), user).toThrow(/HOMOLOG_GATE_USER/);
    }
    for (const password of ['curta', 'a'.repeat(23), 'a'.repeat(257), `${PASSWORD}\n`, `${PASSWORD}\u0000`]) {
      expect(() => readGateConfig({ ...on, HOMOLOG_GATE_USER: 'operador', HOMOLOG_GATE_PASSWORD: password })).toThrow(/HOMOLOG_GATE_PASSWORD/);
    }
    expect(() => readGateConfig({ ...on, HOMOLOG_GATE_USER: 'operador', HOMOLOG_GATE_PASSWORD: 'xx-OPERADOR-xx-xxxxxxxxxxxxxxxx' })).toThrow(/usuário/);
  });

  it('mensagens de erro nunca incluem os valores informados', () => {
    const secret = 'segredo-que-nao-pode-vazar';
    for (const env of [
      { HOMOLOG_GATE: 'on', HOMOLOG_GATE_USER: secret + ':', HOMOLOG_GATE_PASSWORD: PASSWORD },
      { HOMOLOG_GATE: 'on', HOMOLOG_GATE_USER: 'operador', HOMOLOG_GATE_PASSWORD: secret },
      { TRUST_PROXY_HOPS: secret }, { SERVE_FRONTEND: secret },
    ]) {
      try { readWebConfig(env, dir); throw new Error('deveria falhar'); } catch (error) {
        expect((error as Error).message).not.toContain(secret);
        expect((error as Error).message).not.toContain(PASSWORD);
      }
    }
  });

  it('portão ativo liga noindex; configuração completa de homologação', () => {
    const config = readWebConfig({ SERVE_FRONTEND: 'on', TRUST_PROXY_HOPS: '1', HOMOLOG_GATE: 'on', HOMOLOG_GATE_USER: 'operador', HOMOLOG_GATE_PASSWORD: PASSWORD }, dir);
    expect(config).toEqual({ frontendDir: '/tmp/frontend-dist', trustProxyHops: 1, gate: { user: 'operador', password: PASSWORD }, noindex: true });
  });
});

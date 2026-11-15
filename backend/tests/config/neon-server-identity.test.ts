import { describe, expect, it } from 'vitest';
import { evaluateNeonServerIdentity, type NeonServerFacts } from '../../src/config/neonServerIdentity';
import { MARKER_PREFIX } from '../../src/config/serverIdentity';

const PROJECT = 'aged-scene-47291697';
const CLUSTER = '3f2b8c1e-9d4a-4b7e-8a61-0c5d2e7f9a10';
const EXPECTED = { expectedProjectId: PROJECT, expectedClusterId: CLUSTER, expectedUser: 'cardapio_homolog_app' };
const provenTls = { proven: true, reasons: [], authorized: true, nameMatches: true, wrongNameRejected: true, protocol: 'TLSv1.3', cipher: 'x', issuer: 'y', validTo: null };
const facts = (patch: Partial<NeonServerFacts> = {}): NeonServerFacts => ({
  database: 'cardapio_digital_homolog', currentUser: 'cardapio_homolog_app', serverVersionNum: 180006,
  databases: ['postgres', 'neondb', 'cardapio_digital_homolog'], roles: ['neondb_owner', 'cardapio_homolog_app', 'rustika_homolog_marker'],
  markerComment: `${MARKER_PREFIX}${CLUSTER}`, projectId: PROJECT, pgStatSslActive: false, external: provenTls, ...patch,
});

describe('evaluateNeonServerIdentity', () => {
  it('aprova com pg_stat_ssl=false (divergência documentada) quando o TLS externo foi comprovado e tudo o mais confere', () => {
    expect(evaluateNeonServerIdentity(facts(), EXPECTED)).toEqual([]);
    expect(evaluateNeonServerIdentity(facts({ pgStatSslActive: null }), EXPECTED)).toEqual([]);
  });

  it('TLS inválido (externo não comprovado) bloqueia mesmo que pg_stat_ssl diga true', () => {
    const problems = evaluateNeonServerIdentity(facts({ pgStatSslActive: true, external: { ...provenTls, proven: false, reasons: ['nome do servidor não confere'] } }), EXPECTED);
    expect(problems.join(' ')).toMatch(/TLS externo não comprovado/);
  });

  it('hostname incorreto (refletido no TLS externo) bloqueia', () => {
    const problems = evaluateNeonServerIdentity(facts({ external: { ...provenTls, proven: false, nameMatches: false, reasons: ['nome do servidor não confere'] } }), EXPECTED);
    expect(problems.join(' ')).toMatch(/TLS externo/);
  });

  it('project id incorreto ou ausente bloqueia', () => {
    expect(evaluateNeonServerIdentity(facts({ projectId: 'outro-projeto-11111111' }), EXPECTED).join(' ')).toMatch(/neon\.project_id difere/);
    expect(evaluateNeonServerIdentity(facts({ projectId: null }), EXPECTED).join(' ')).toMatch(/não expõe neon\.project_id/);
    expect(evaluateNeonServerIdentity(facts(), { ...EXPECTED, expectedProjectId: '' }).join(' ')).toMatch(/EXPECTED_PROJECT_ID não configurado/);
  });

  it('marca de homologação incorreta ou ausente bloqueia', () => {
    expect(evaluateNeonServerIdentity(facts({ markerComment: null }), EXPECTED).join(' ')).toMatch(/marca de homologação/);
    expect(evaluateNeonServerIdentity(facts({ markerComment: `${MARKER_PREFIX}00000000-0000-4000-8000-000000000000` }), EXPECTED).join(' ')).toMatch(/marca de homologação/);
    expect(evaluateNeonServerIdentity(facts(), { ...EXPECTED, expectedClusterId: '' }).join(' ')).toMatch(/marca de homologação/);
  });

  it('banco incorreto bloqueia', () => {
    expect(evaluateNeonServerIdentity(facts({ database: 'neondb' }), EXPECTED).join(' ')).toMatch(/banco conectado diferente/);
  });

  it('role incorreta bloqueia', () => {
    expect(evaluateNeonServerIdentity(facts({ currentUser: 'neondb_owner' }), EXPECTED).join(' ')).toMatch(/role conectada difere/);
  });

  it('PostgreSQL anterior a 17 bloqueia', () => {
    expect(evaluateNeonServerIdentity(facts({ serverVersionNum: 160004 }), EXPECTED).join(' ')).toMatch(/anterior ao 17/);
  });

  it('banco de desenvolvimento/replay ainda presente bloqueia (replay não finalizado)', () => {
    expect(evaluateNeonServerIdentity(facts({ databases: [...facts().databases, 'cardapio_digital_test'] }), EXPECTED).join(' ')).toMatch(/cardapio_digital_test/);
  });
});

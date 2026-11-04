import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 3D.3.12 — modelo da avaliação do pg_hba.conf ("primeira linha que casa vence"), aplicado às
 * regras REAIS lidas deste cluster em 04/11/2026 (copiadas abaixo; o arquivo de produção não é lido
 * pelos testes) e ao exemplo docs/sql/pg_hba-test-fixtures.conf.example.
 * Não substitui a pós-verificação real (psql -w deve ser recusado), mas prova a ordem e a cobertura.
 */
const CLUSTER_RULES = `
local   all             all                                     scram-sha-256
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256
local   replication     all                                     scram-sha-256
host    replication     all             127.0.0.1/32            scram-sha-256
host    replication     all             ::1/128                 scram-sha-256`;

/** Bancos que aceitam conexão no cluster (pg_database.datallowconn), lidos em 04/11/2026. */
const DATABASES = ['cardapio_digital_dev', 'cardapio_digital_shadow', 'cardapio_digital_test', 'cardapio_restore_precheck',
  'plataforma_sites_ia', 'plataforma_sites_ia_test', 'postgres', 'rf004_lab_neg_20261027_01', 'rf004_lab_pos_20261027_01', 'template1'];
/** Caminhos habilitados: listen_addresses = 'localhost' (127.0.0.1 e ::1) e, por segurança, socket local. */
const PATHS = [{ type: 'local' as const }, { type: 'host' as const, address: '127.0.0.1' }, { type: 'host' as const, address: '::1' }];
const ROLE = 'cardapio_test_fixtures';

interface Rule { type: string; database: string[]; user: string[]; address?: string; method: string }

function parse(text: string): Rule[] {
  return text.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).map((line) => {
    const f = line.split(/\s+/);
    return f[0] === 'local'
      ? { type: f[0]!, database: f[1]!.split(','), user: f[2]!.split(','), method: f[3]! }
      : { type: f[0]!, database: f[1]!.split(','), user: f[2]!.split(','), address: f[3]!, method: f[4]! };
  });
}

function addressMatches(cidr: string, address: string): boolean {
  if (cidr === 'all' || cidr === '0.0.0.0/0' && address.includes('.') || cidr === '::/0' && address.includes(':')) return true;
  const [ip, bits] = cidr.split('/');
  if ((ip!.includes(':') ? '128' : '32') !== bits) throw new Error(`máscara não modelada: ${cidr}`);
  return ip === address;
}

/** Decisão para uma conexão NÃO-replicação: primeira regra que casa, ou recusa implícita. */
function decide(rules: Rule[], database: string, user: string, conn: { type: 'local' | 'host'; address?: string }): string {
  for (const rule of rules) {
    const typeOk = conn.type === 'local' ? rule.type === 'local' : ['host', 'hostssl', 'hostnossl'].includes(rule.type);
    const dbOk = rule.database.includes('all') || rule.database.includes(database); // "all" não casa replication
    const userOk = rule.user.includes('all') || rule.user.includes(user);
    if (!typeOk || !dbOk || !userOk) continue;
    if (conn.type === 'local' || addressMatches(rule.address!, conn.address!)) return rule.method;
  }
  return 'implicit-reject';
}

const example = fs.readFileSync(path.join(process.cwd(), 'docs', 'sql', 'pg_hba-test-fixtures.conf.example'), 'utf8');
const exampleRules = parse(example);
const cluster = parse(CLUSTER_RULES);

describe('isolamento da role de fixtures pelo pg_hba (modelo, 3D.3.12)', () => {
  it('hoje, sem as linhas, a role alcançaria TODOS os bancos conectáveis (inclusive PLATAFORMA_SITES_IA)', () => {
    for (const db of DATABASES) for (const conn of PATHS) expect(decide(cluster, db, ROLE, conn)).toBe('scram-sha-256');
  });

  it('com as 5 linhas NO TOPO: só cardapio_digital_test via TCP loopback, recusa em todo o resto', () => {
    const rules = [...exampleRules, ...cluster];
    for (const db of DATABASES) {
      for (const conn of PATHS) {
        const expected = db === 'cardapio_digital_test' && conn.type === 'host' ? 'scram-sha-256' : 'reject';
        expect(decide(rules, db, ROLE, conn), `${db} ${conn.type} ${conn.address ?? ''}`).toBe(expected);
      }
    }
  });

  it('adversarial: com as linhas NO FINAL elas não têm efeito (as regras "all" casam antes)', () => {
    const rules = [...cluster, ...exampleRules];
    expect(decide(rules, 'plataforma_sites_ia', ROLE, PATHS[1]!)).toBe('scram-sha-256');
    expect(decide(rules, 'cardapio_digital_dev', ROLE, PATHS[2]!)).toBe('scram-sha-256');
  });

  it('adversarial: faltar a recusa de ::1 deixaria o caminho IPv6 aberto', () => {
    const rules = [...exampleRules.filter((r) => !(r.method === 'reject' && r.address === '::1/128')), ...cluster];
    expect(decide(rules, 'postgres', ROLE, PATHS[2]!)).toBe('scram-sha-256');
    expect(decide(rules, 'postgres', ROLE, PATHS[1]!)).toBe('reject');
  });

  it('adversarial: faltar a recusa local deixaria o socket local aberto', () => {
    const rules = [...exampleRules.filter((r) => r.type !== 'local'), ...cluster];
    expect(decide(rules, 'cardapio_digital_dev', ROLE, PATHS[0]!)).toBe('scram-sha-256');
  });

  it('as linhas não mudam a decisão para nenhuma outra role (Dev, Test, migrator, PLATAFORMA_SITES_IA)', () => {
    const rules = [...exampleRules, ...cluster];
    for (const user of ['cardapio_dev_app', 'cardapio_test_app', 'cardapio_migrator', 'plataforma_sites_ia', 'postgres']) {
      for (const db of DATABASES) for (const conn of PATHS) expect(decide(rules, db, user, conn)).toBe(decide(cluster, db, user, conn));
    }
  });

  it('a checagem do enable-test-fixtures-login.sql recusaria cada variante perigosa acima', () => {
    const enable = fs.readFileSync(path.join(process.cwd(), 'docs', 'sql', 'enable-test-fixtures-login.sql'), 'utf8');
    expect(enable).toContain('first_generic < last_reject');            // linhas no final
    expect(enable).toContain("address IN ('::1', 'all')");              // falta ::1
    expect(enable).toContain("type = 'local'");                        // falta local
    expect(enable).toContain('pg_conf_load_time()');                    // arquivo editado sem reload
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * 3D.5.2-B: invariantes de segurança do workflow manual `homolog-ephemeral`, verificadas como texto (sem executar nada, sem rede).
 * Rodam no job `backend` do ci.yml: se alguém afrouxar o workflow ou os scripts, a CI padrão falha.
 */
const root = path.resolve(__dirname, '..', '..');
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
const raw = read('.github', 'workflows', 'homolog-ephemeral.yml');
const code = raw.replace(/^\s*#.*$/gm, '');
const scripts = ['start-ephemeral-postgres.sh', 'diagnostics.sh', 'teardown.sh'].map((name) => ({ name, text: read('backend', 'ops', 'homolog', 'ci', name) }));
const ephemeral = read('backend', 'tests', 'homolog-ephemeral', 'provisioning.ephemeral.ts');

describe('workflow homolog-ephemeral.yml', () => {
  it('somente manual, com opt-in booleano inicialmente false e permissões mínimas', () => {
    expect(code).toMatch(/\non:\n  workflow_dispatch:\n/);
    expect(code).not.toMatch(/^\s{2}(push|pull_request|pull_request_target|schedule|workflow_run|workflow_call|repository_dispatch):/m);
    expect(code).toMatch(/run_homolog_ephemeral:\n[\s\S]*?type: boolean\n\s+default: false/);
    expect(code).toMatch(/\npermissions:\n  contents: read\n/);
    expect(code).not.toMatch(/\bid-token:|\bpackages: write|\bcontents: write|\bactions: write/);
  });

  it('o job só roda por dispatch, com o opt-in e em repositório privado; timeout curto', () => {
    expect(code).toMatch(/if: github\.event_name == 'workflow_dispatch' && inputs\.run_homolog_ephemeral == true && github\.event\.repository\.private == true/);
    const timeout = Number(/timeout-minutes: (\d+)/.exec(code)?.[1]);
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThanOrEqual(30);
    expect(code).toMatch(/\n  homolog-ephemeral:\n/);
  });

  it('não usa secrets do repositório, artifacts, cache de banco nem o PostgreSQL do job e2e', () => {
    expect(code).not.toMatch(/\$\{\{\s*secrets\./);
    expect(code).not.toMatch(/upload-artifact|download-artifact|actions\/cache/);
    expect(code).not.toMatch(/services:/);
    expect(code).not.toMatch(/pg-e2e|cardapio-secrets|5432:5432/);
    expect(code).toMatch(/PG_CONTAINER: pg-homolog-ephemeral/);
    expect(code).toMatch(/RUSTIKA_HOMOLOG_EPHEMERAL_REQUIRED: '1'/);
  });

  it('actions fixadas por SHA de commit; executa somente a suíte efêmera; diagnóstico só em falha; descarte sempre', () => {
    for (const match of code.matchAll(/uses: ([^\s]+)/g)) expect(match[1], match[0]).toMatch(/@[0-9a-f]{40}$/);
    expect(code).toMatch(/run: npm run test:homolog:ephemeral/);
    expect(code).not.toMatch(/npm (run )?test(:ci)?\b(?!:homolog)/);
    expect(code).not.toMatch(/playwright|migrate-test|db:migrate/i);
    expect(code).toMatch(/if: failure\(\)\n\s+run: bash ops\/homolog\/ci\/diagnostics\.sh/);
    expect(code).toMatch(/if: always\(\)\n\s+run: bash ops\/homolog\/ci\/teardown\.sh/);
  });
});

describe('scripts de CI do ensaio efêmero', () => {
  it('têm modo estrito, não imprimem credenciais e mascaram a senha gerada', () => {
    for (const { name, text } of scripts) {
      expect(text.split('\n')[0], name).toBe('#!/usr/bin/env bash');
      expect(text, name).toMatch(/set -(e)?u(o pipefail)?|set -uo pipefail|set -euo pipefail/);
      expect(text, name).not.toMatch(/\bset -x\b/);
      expect(text, name).not.toMatch(/docker (run|create)[^\n]*(-p |--publish )[^\n]*"?0\.0\.0\.0/);
    }
    const start = scripts[0]!.text;
    expect(start).toMatch(/::add-mask::\$\{ADMIN_PASSWORD\}/);
    expect(start).toMatch(/--publish "\$\{HOST_IP\}:\$\{PG_PORT\}:5432"/);
    expect(start).toMatch(/case "\$\{HOST_IP\}" in[\s\S]*127\.\*[\s\S]*169\.254\.\*/);
    expect(start).toMatch(/hostssl all/);
    expect(start).toMatch(/hostnossl all all\s+0\.0\.0\.0\/0\s+reject/);
    expect(start).toMatch(/sslmode=verify-full sslrootcert=/);
    expect(start).toMatch(/rm -f "\$\{WORK\}\/tls\/ca\.key"/); // a chave da CA é apagada logo após assinar
    expect(start).not.toMatch(/POSTGRES_PASSWORD=[^$"]/);
  });

  it('o descarte remove container, volume anônimo e material TLS e falha se algo sobrar; o diagnóstico não gera dump', () => {
    const teardown = scripts[2]!.text;
    expect(teardown).toMatch(/docker rm -fv/);
    expect(teardown).toMatch(/rm -rf "\$\{RUNNER_TEMP\}\/homolog-ephemeral"/);
    expect(teardown).toMatch(/exit "\$\{status\}"/);
    const diagnostics = scripts[1]!.text;
    expect(diagnostics).not.toMatch(/pg_dump|printenv|^\s*env\s*$/m);
    expect(diagnostics).toMatch(/--tail 60/);
    expect(diagnostics).toMatch(/\*\*\*/);
  });

  it.skipIf(spawnSync('bash', ['--version']).status !== 0)('passam em `bash -n` (validação de sintaxe shell, sem executar)', () => {
    for (const { name } of scripts) {
      const result = spawnSync('bash', ['-n', path.join(root, 'backend', 'ops', 'homolog', 'ci', name)], { encoding: 'utf8' });
      expect(result.status, `${name}: ${result.stderr}`).toBe(0);
    }
  });
});

describe('contrato da suíte efêmera com o workflow', () => {
  it('só roda com confirmação explícita; no CI a ausência de configuração FALHA; identidade verificada antes da primeira escrita', () => {
    expect(ephemeral).toMatch(/RUSTIKA_HOMOLOG_EPHEMERAL_CONFIRM === 'RUN_ON_EPHEMERAL_POSTGRES'/);
    expect(ephemeral).toMatch(/describe\.skipIf\(!ENABLED\)/);
    expect(ephemeral).toMatch(/if \(REQUIRED\)/);
    expect(ephemeral).toMatch(/cluster_name/);
    expect(ephemeral).toMatch(/servidor deve conter somente o banco postgres/);
    expect(ephemeral).toMatch(/o ensaio exige host não-loopback/);
  });

  it('exige TLS real, CA errada recusada, wrapper real, cleanup verificado e todos os critérios de falha', () => {
    for (const needle of [
      'sslaccept=strict', 'WRONG_CA_FILE', "wrapper(secrets, 'migrate-homolog-replay'", 'verifyAppliedMigrations', 'classifyRenames',
      'privilegeMatrix', 'cleanup: nenhum banco/role do ensaio pode sobrar', 'ephemeral_probe', 'checksum divergente', 'ADMIN_ALREADY_EXISTS',
      'dados inesperados devem reprovar o 03', 'No pending migrations',
    ]) expect(ephemeral, needle).toContain(needle);
    expect(ephemeral).not.toMatch(/it\.skip|\.todo\(|migrate resolve|db push|migrate reset|accept_invalid_certs/);
  });

  it('nunca grava segredo em arquivo versionado nem usa o diretório de segredos de Dev/Test', () => {
    expect(ephemeral).toMatch(/os\.tmpdir\(\)/);
    expect(ephemeral).not.toMatch(/[.]cardapio[\\/]|cardapio-secrets/);
  });
});

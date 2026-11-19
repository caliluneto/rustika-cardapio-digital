import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * RF005 — guardas do provisionamento do primeiro administrador LOCAL.
 *
 * O bootstrap de homologação (`scripts/bootstrap-admin.ts`) é restrito ao perfil
 * `bootstrap-homolog`. O banco de desenvolvimento está com `admins = 0`, então o login
 * administrativo não tinha como ser demonstrado. Este teste fixa as garantias do script
 * que cobre essa lacuna, sem executá-lo (nenhuma escrita, nenhuma conexão).
 */

const scriptPath = resolve(__dirname, '../../scripts/bootstrap-admin-dev.ts');
const source = readFileSync(scriptPath, 'utf8');

describe('bootstrap-admin-dev — escopo e segurança', () => {
  it('só aceita o perfil de runtime local de desenvolvimento', () => {
    expect(source).toContain("const PROFILE = 'app-dev'");
    expect(source).toContain("const EXPECTED_DATABASE = 'cardapio_digital_dev'");
    // O perfil carregado é sempre PROFILE (app-dev); homologação aparece só no comentário de contexto.
    expect(source).toMatch(/loadDatabaseProfile\(PROFILE,/);
    expect(source).not.toMatch(/loadDatabaseProfile\('(?!app-dev)/);
    expect(source).not.toMatch(/bootstrap-homolog'\s*[,)]/);
  });

  it('recusa URL que não usa exatamente 127.0.0.1 e confere a identidade real do servidor', () => {
    expect(source).toContain("const LOCAL_HOST = '127.0.0.1'");
    expect(source).toMatch(/host !== LOCAL_HOST/);
    expect(source).toMatch(/hostFromUrl\(database\.databaseUrl\)/);
    expect(source).toMatch(/current_database\(\)/);
    expect(source).toMatch(/host\(inet_server_addr\(\)\)/);
    expect(source).toMatch(/host\(inet_client_addr\(\)\)/);
    expect(source).toMatch(/server\.neonProjectId !== null/);
    expect(source).toMatch(/server\.homologMarker/);
    expect(source).toMatch(/server\.usr !== database\.user/);
    expect(source).toMatch(/server\.db !== EXPECTED_DATABASE/);
  });

  it('exige --execute e confirmação explícita para escrever', () => {
    expect(source).toContain('--execute');
    expect(source).toContain('CARDAPIO_DEV_BOOTSTRAP_CONFIRMATION');
    expect(source).toContain('CREATE_FIRST_ADMIN_RUSTIKA_DEV');
    // Sem confirmação, o script falha ANTES de qualquer escrita.
    expect(source).toMatch(/args\.execute && process\.env\[CONFIRMATION_ENV\] !== CONFIRMATION_VALUE/);
  });

  it('cria apenas o PRIMEIRO administrador e reconfere dentro da transação', () => {
    expect(source).toMatch(/prisma\.admin\.count\(\)/);
    expect(source).toMatch(/tx\.admin\.count\(\)/);
    expect(source).toContain('ADMIN_ALREADY_EXISTS');
    expect(source).toMatch(/\$transaction/);
  });

  it('nunca aceita senha por argumento, ambiente ou arquivo', () => {
    expect(source).toMatch(/pass\|senha\|secret\|token\|hash/i);
    expect(source).toContain('readHiddenLine');
    expect(source).toMatch(/checkPasswordPolicy/);
  });

  it('reutiliza o hash e a política existentes, sem criar política paralela', () => {
    expect(source).toContain("from '../src/security/password'");
    expect(source).toContain("from './bootstrap/adminInput'");
    expect(source).toMatch(/hashPassword\(first\)/);
    // Nenhuma implementação própria de hash/scrypt no script.
    expect(source).not.toMatch(/scrypt|pbkdf2|bcrypt/);
  });

  it('não imprime senha nem hash; só e-mail mascarado e código de erro', () => {
    expect(source).toContain('maskEmail');
    expect(source).not.toMatch(/console\.log\([^)]*passwordHash/);
    expect(source).not.toMatch(/console\.log\([^)]*\bfirst\b/);
    expect(source).toMatch(/\/\^P\\d\{4\}\$\//);
  });

  it('não executa operações destrutivas nem altera migrations', () => {
    expect(source).not.toMatch(/\b(DROP|TRUNCATE|DELETE|db push|migrate reset)\b/i);
    expect(source).not.toMatch(/prisma\/migrations/);
  });
});

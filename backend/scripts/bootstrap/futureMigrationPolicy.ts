/**
 * Política para migrations FUTURAS (oitava em diante) — 3D.5.2-A. As sete históricas são imutáveis e não passam por este lint.
 * Uma migration nova precisa ser neutra em relação ao ambiente: o mesmo arquivo roda em Dev, Test e Homologação (com os nomes
 * definitivos `cardapio_digital_homolog`/`cardapio_homolog_*`), sem nunca marcar nada como aplicado manualmente.
 * Retorna a lista de violações (vazia = conforme). Heurística estática; não substitui a revisão humana.
 */
const DATABASES = ['cardapio_digital_dev', 'cardapio_digital_test', 'cardapio_digital_homolog'];

export function lintFutureMigration(sql: string): string[] {
  const problems: string[] = [];
  const code = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  if (/\b(DROP\s+DATABASE|DROP\s+ROLE|CREATE\s+ROLE|ALTER\s+ROLE|ALTER\s+SYSTEM|CREATE\s+DATABASE)\b/i.test(code)) {
    problems.push('migrations não criam, alteram ou removem bancos e roles do cluster.');
  }
  if (/\bTRUNCATE\b/i.test(code)) problems.push('TRUNCATE não é permitido em migration.');
  if (/\bTO\s+cardapio_|\bFROM\s+cardapio_/i.test(code)) {
    problems.push('conceda e revogue privilégios por role resolvida da guarda (format com %I), nunca por nome literal.');
  }
  if (/current_database\(\)/.test(code)) {
    const missing = DATABASES.filter((name) => !code.includes(`'${name}'`));
    if (missing.length > 0) problems.push(`a guarda por current_database() deve cobrir os três ambientes; faltam: ${missing.join(', ')}.`);
  } else if (/\b(GRANT|REVOKE)\b/i.test(code)) {
    problems.push('migration que altera privilégios precisa de guarda por current_database() cobrindo os três ambientes.');
  }
  if (/current_user\s*<>\s*'cardapio_migrator'/.test(code) && !code.includes('cardapio_homolog_migrator')) {
    problems.push('a guarda de current_user deve aceitar também cardapio_homolog_migrator.');
  }
  return problems;
}

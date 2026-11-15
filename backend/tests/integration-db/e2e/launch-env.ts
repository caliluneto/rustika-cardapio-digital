/**
 * Importar `@prisma/client` (Prisma 6) carrega o `backend/.env` legado e injeta DATABASE_URL no
 * processo ANTES de os gates do E2E rodarem. Os gates proíbem DATABASE_URL/SHADOW_DATABASE_URL (só valem os
 * perfis da pasta de segredos), então todo comando real abortava por uma variável que o operador nunca definiu.
 *
 * Regras (os gates `assertE2eGate`/`assertIntegrationGate` NÃO são alterados):
 *  1. Este módulo deve ser o PRIMEIRO import do ponto de entrada: ele fotografa o ambiente de lançamento
 *     antes de qualquer import com efeito colateral.
 *  2. `guardedLaunch(gate)` avalia o gate sobre o ambiente de LANÇAMENTO. Uma URL definida pelo operador
 *     continua presente nessa visão e continua bloqueando.
 *  3. Só depois remove, por nome, exatamente as chaves vigiadas que NÃO existiam no lançamento (as injetadas).
 *     Nada mais é removido; a URL injetada nunca escolhe o banco (os acessos usam os perfis protegidos).
 */
const WATCHED = ['DATABASE_URL', 'SHADOW_DATABASE_URL'] as const;
type Env = Record<string, string | undefined>;

const launch: Env = Object.fromEntries(WATCHED.map((key) => [key, process.env[key]]));

/** Visão do ambiente como o operador o lançou: valores atuais, mas as chaves vigiadas como estavam no início. */
export function launchEnv(env: Env = process.env, original: Env = launch): Env {
  return { ...env, ...Object.fromEntries(WATCHED.map((key) => [key, original[key]])) };
}

/** Remove SOMENTE as chaves vigiadas ausentes no lançamento (injetadas implicitamente). Devolve os nomes removidos. */
export function dropInjectedEnv(env: Env = process.env, original: Env = launch): string[] {
  const dropped: string[] = [];
  for (const key of WATCHED) {
    if (original[key] === undefined && env[key] !== undefined) {
      delete env[key];
      dropped.push(key);
    }
  }
  return dropped;
}

/** Gate sobre o ambiente de lançamento; só se ele passar, descarta as variáveis injetadas. */
export function guardedLaunch(gate: (env: Env) => void, env: Env = process.env, original: Env = launch): void {
  gate(launchEnv(env, original));
  dropInjectedEnv(env, original);
}

/** Convenção provisória da demonstração; não valida uma comanda real. */
export function normalizeComanda(input: string): string | null {
  const value = input.trim();
  return /^[0-9]{1,6}$/.test(value) ? value : null;
}

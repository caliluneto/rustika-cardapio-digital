import type { CatalogData } from '../types/catalog';

export type CatalogState =
  | { status: 'loading' }
  | { status: 'ready'; data: CatalogData }
  | { status: 'error'; message: string };

/** One shared load survives React StrictMode effect replay; no partial pages escape. */
export function createCatalogStore(load: () => Promise<CatalogData>) {
  let state: CatalogState = { status: 'loading' };
  let pending: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  function publish(next: CatalogState) {
    state = next;
    listeners.forEach((listener) => listener());
  }
  function start(retry = false): Promise<void> {
    if (pending) return pending;
    if (!retry && state.status !== 'loading') return Promise.resolve();
    publish({ status: 'loading' });
    pending = Promise.resolve().then(load).then(
      (data) => publish({ status: 'ready', data }),
      (error: unknown) => publish({ status: 'error', message: error instanceof Error ? error.message : 'Não foi possível carregar o catálogo. Tente novamente.' }),
    ).finally(() => { pending = undefined; });
    return pending;
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load: () => start(),
    retry: () => start(true),
  };
}

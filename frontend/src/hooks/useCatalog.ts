import { useEffect, useSyncExternalStore } from 'react';
import { createCatalogStore } from '../services/catalogStore';
import { loadCatalog } from '../services/catalogSource';

export const catalogMode = import.meta.env?.VITE_CATALOG_MODE;
const store = createCatalogStore(() => loadCatalog(catalogMode));

export function useCatalog() {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => { void store.load(); }, []);
  return { state, retry: store.retry };
}

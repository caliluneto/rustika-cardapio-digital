import type { CatalogData } from '../types/catalog';
import { api } from './api';

export type CatalogMode = 'api' | 'demo';

export function resolveCatalogMode(value?: string): CatalogMode {
  if (value === undefined || value === 'api') return 'api';
  if (value === 'demo') return 'demo';
  throw new Error('Configuração do catálogo inválida. Use VITE_CATALOG_MODE=api ou demo.');
}

export async function loadCatalog(
  mode?: string,
  loadApi: () => Promise<CatalogData> = api.getCatalog,
  loadDemo: () => Promise<CatalogData> = () => import('../mocks/catalog'),
): Promise<CatalogData> {
  return resolveCatalogMode(mode) === 'demo' ? loadDemo() : loadApi();
}

/// <reference types="vite/client" />

/**
 * Variáveis VITE_* lidas pelo código. Declará-las aqui documenta o contrato e permite ler
 * `import.meta.env` (texto literal, exigido pelo Vite para injetar o valor) sem alias.
 *  VITE_ORDER_SUBMISSION só liga o envio com o valor exato "enabled".
 */
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_ORDER_SUBMISSION?: string;
  readonly VITE_CATALOG_MODE?: string;
}

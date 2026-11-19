// 3D.5.3-C.5: a biblioteca `pg` (dependência já usada pelo Prisma internamente) não publica tipos próprios e o projeto
// não tem @types/pg instalado. Declaração mínima, só com o que `neonServerIdentity.ts` usa (uma conexão independente
// para inspecionar o socket TLS real, que o motor do Prisma não expõe). Não afeta o Prisma, que não importa 'pg' em código de app.
declare module 'pg' {
  import type { TLSSocket } from 'node:tls';

  // T=any (não QueryResultRow) de propósito: preserva o comportamento pré-existente (sem @types/pg, 'pg' era 'any') para
  // qualquer outro arquivo do projeto que já use 'pg' sem passar o genérico explicitamente.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export interface QueryResult<T = any> {
    rows: T[];
  }

  export interface ClientConfig {
    connectionString?: string;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    connectionTimeoutMillis?: number;
    statement_timeout?: number;
    ssl?: false | { rejectUnauthorized: boolean; servername?: string; minVersion?: string; ca?: string };
  }

  export class Client {
    constructor(config?: ClientConfig);
    connect(): Promise<void>;
    end(): Promise<void>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query<T = any>(text: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
    connection?: { stream?: TLSSocket };
  }
}

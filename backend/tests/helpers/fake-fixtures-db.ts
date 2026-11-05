import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * In-memory stand-in for the Prisma client, just enough to run the REAL `FixtureRun`, the E2E
 * lifecycle and the legacy cleanup against rows we control (3D.3.21-B). It evaluates the `where`
 * shapes those modules really use, emulates the RESTRICT foreign keys of the schema (a violating
 * DELETE throws and the transaction is rolled back, as in PostgreSQL) and records every
 * `deleteMany` so tests can assert that nothing unscoped was ever issued.
 * Never touches a database.
 */

type Row = Record<string, any>;
type Where = Record<string, any>;
export type TableName = 'admin' | 'category' | 'product' | 'comanda' | 'comandaInvitation' | 'comandaSession' | 'order' | 'orderItem' | 'orderStatusHistory';
export const TABLES: TableName[] = ['admin', 'category', 'product', 'comanda', 'comandaInvitation', 'comandaSession', 'order', 'orderItem', 'orderStatusHistory'];

interface Relation { target: TableName; many: boolean; resolve(row: Row): (rows: Record<TableName, Row[]>) => Row[] }
const rel = (target: TableName, many: boolean, local: string, foreign: string): Relation => ({
  target, many,
  resolve: (row) => (rows) => rows[target].filter((candidate) => candidate[foreign] === row[local]),
});
const RELATIONS: Partial<Record<TableName, Record<string, Relation>>> = {
  comanda: { invitations: rel('comandaInvitation', true, 'id', 'comandaId'), sessions: rel('comandaSession', true, 'id', 'comandaId') },
  comandaInvitation: { comanda: rel('comanda', false, 'comandaId', 'id'), issuer: rel('admin', false, 'issuedByAdminId', 'id'), session: rel('comandaSession', false, 'id', 'invitationId') },
  comandaSession: { comanda: rel('comanda', false, 'comandaId', 'id') },
  order: { comanda: rel('comanda', false, 'comandaId', 'id'), items: rel('orderItem', true, 'id', 'orderId'), statusHistory: rel('orderStatusHistory', true, 'id', 'orderId') },
  orderItem: { order: rel('order', false, 'orderId', 'id') },
  orderStatusHistory: { order: rel('order', false, 'orderId', 'id') },
  product: { category: rel('category', false, 'categoryId', 'id') },
};

/** Parent table -> [child table, child column] for RESTRICT foreign keys. */
const RESTRICT: [TableName, TableName, string][] = [
  ['admin', 'comandaInvitation', 'issuedByAdminId'], ['admin', 'orderStatusHistory', 'changedByAdminId'],
  ['comanda', 'comandaInvitation', 'comandaId'], ['comanda', 'comandaSession', 'comandaId'], ['comanda', 'order', 'comandaId'],
  ['comandaInvitation', 'comandaSession', 'invitationId'], ['comandaSession', 'order', 'sessionId'],
  ['order', 'orderItem', 'orderId'], ['order', 'orderStatusHistory', 'orderId'],
  ['product', 'orderItem', 'productId'], ['category', 'product', 'categoryId'],
];

const isPlainObject = (value: unknown): value is Where => typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date) && value.constructor === Object;

export class FakeFixturesDb {
  tables: Record<TableName, Row[]> = Object.fromEntries(TABLES.map((name) => [name, [] as Row[]])) as Record<TableName, Row[]>;
  /** Every deleteMany issued: table + where, in order. */
  deletes: { table: TableName; where: Where; count: number }[] = [];
  /** Every statement that is not a read (create/update/upsert/delete), by table. */
  writes: { op: string; table: TableName }[] = [];

  private matchValue(actual: unknown, expected: unknown): boolean {
    if (!isPlainObject(expected)) return actual === expected || (actual instanceof Date && expected instanceof Date && actual.getTime() === expected.getTime());
    if ('in' in expected) return (expected.in as unknown[]).includes(actual);
    if ('startsWith' in expected || 'endsWith' in expected) {
      if (typeof actual !== 'string') return false;
      return (expected.startsWith === undefined || actual.startsWith(expected.startsWith)) && (expected.endsWith === undefined || actual.endsWith(expected.endsWith));
    }
    if ('not' in expected) return !this.matchValue(actual, expected.not);
    throw new Error(`fake: operador de where não suportado: ${Object.keys(expected).join(',')}`);
  }

  matches(table: TableName, row: Row, where: Where | undefined): boolean {
    if (!where) return true;
    for (const [key, expected] of Object.entries(where)) {
      if (key === 'AND') { if (!(expected as Where[]).every((w) => this.matches(table, row, w))) return false; continue; }
      if (key === 'OR') { if (!(expected as Where[]).some((w) => this.matches(table, row, w))) return false; continue; }
      if (key === 'NOT') { const list = Array.isArray(expected) ? expected : [expected]; if (list.some((w: Where) => this.matches(table, row, w))) return false; continue; }
      const relation = RELATIONS[table]?.[key];
      if (relation) {
        const related = relation.resolve(row)(this.tables);
        const w = expected as Where;
        if (relation.many) {
          if ('some' in w && !related.some((r) => this.matches(relation.target, r, w.some))) return false;
          if ('every' in w && !related.every((r) => this.matches(relation.target, r, w.every))) return false;
          if ('none' in w && related.some((r) => this.matches(relation.target, r, w.none))) return false;
        } else if (!related[0] || !this.matches(relation.target, related[0], w)) return false;
        continue;
      }
      if (!this.matchValue(row[key], expected)) return false;
    }
    return true;
  }

  private include(table: TableName, row: Row, include: Where | undefined): Row {
    if (!include) return row;
    const out = { ...row };
    for (const key of Object.keys(include)) {
      const relation = RELATIONS[table]?.[key];
      if (!relation) throw new Error(`fake: include não suportado: ${table}.${key}`);
      const related = relation.resolve(row)(this.tables);
      out[key] = relation.many ? related : (related[0] ?? null);
    }
    return out;
  }

  private snapshot() { return Object.fromEntries(TABLES.map((name) => [name, [...this.tables[name]]])) as Record<TableName, Row[]>; }

  private assertRestrict() {
    for (const [parent, child, column] of RESTRICT) {
      const ids = new Set(this.tables[parent].map((row) => row.id));
      const orphan = this.tables[child].find((row) => row[column] != null && !ids.has(row[column]));
      if (orphan) throw new Error(`fake: violação de chave estrangeira RESTRICT (${child}.${column} -> ${parent})`);
    }
  }

  delegate(table: TableName) {
    return {
      create: async ({ data }: { data: Row; select?: Row }) => {
        const row = { id: randomUUID(), ...data };
        this.tables[table].push(row); this.writes.push({ op: 'create', table });
        return row;
      },
      findMany: async ({ where, include }: { where?: Where; select?: Row; include?: Where; orderBy?: Row } = {}) =>
        this.tables[table].filter((row) => this.matches(table, row, where)).map((row) => this.include(table, row, include)),
      findUnique: async ({ where }: { where: Where; select?: Row }) => this.tables[table].find((row) => this.matches(table, row, where)) ?? null,
      count: async ({ where }: { where?: Where } = {}) => this.tables[table].filter((row) => this.matches(table, row, where)).length,
      upsert: async ({ where, create }: { where: Where; create: Row; update: Row; select?: Row }) => {
        const found = this.tables[table].find((row) => this.matches(table, row, where));
        if (found) return found;
        const row = { id: randomUUID(), ...create }; this.tables[table].push(row); this.writes.push({ op: 'upsert', table });
        return row;
      },
      update: async ({ where, data }: { where: Where; data: Row }) => {
        const found = this.tables[table].find((row) => this.matches(table, row, where));
        if (!found) throw new Error('fake: update de linha inexistente');
        Object.assign(found, data); this.writes.push({ op: 'update', table });
        return found;
      },
      deleteMany: async ({ where }: { where: Where }) => {
        const before = this.tables[table].length;
        this.tables[table] = this.tables[table].filter((row) => !this.matches(table, row, where));
        const count = before - this.tables[table].length;
        this.deletes.push({ table, where, count }); this.writes.push({ op: 'deleteMany', table });
        return { count };
      },
    };
  }

  admin = this.delegate('admin'); category = this.delegate('category'); product = this.delegate('product');
  comanda = this.delegate('comanda'); comandaInvitation = this.delegate('comandaInvitation'); comandaSession = this.delegate('comandaSession');
  order = this.delegate('order'); orderItem = this.delegate('orderItem'); orderStatusHistory = this.delegate('orderStatusHistory');

  async $transaction<T>(callback: (tx: FakeFixturesDb) => Promise<T>): Promise<T> {
    const saved = this.snapshot(); const savedDeletes = this.deletes.length; const savedWrites = this.writes.length;
    try {
      const result = await callback(this);
      this.assertRestrict();
      return result;
    } catch (error) {
      this.tables = saved; // rollback, as the real database does
      this.deletes.length = savedDeletes; this.writes.length = savedWrites;
      throw error;
    }
  }

  /** Cast for modules typed against the real client. */
  asPrisma(): PrismaClient { return this as unknown as PrismaClient; }

  /** Deep-ish copy of every row for before/after comparisons (Decimals keep their string form). */
  dump(): Record<TableName, string[]> {
    return Object.fromEntries(TABLES.map((name) => [name, this.tables[name].map((row) => JSON.stringify(row)).sort()])) as Record<TableName, string[]>;
  }
}

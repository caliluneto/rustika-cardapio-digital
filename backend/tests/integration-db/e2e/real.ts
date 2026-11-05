import path from 'node:path';
import { openIntegrationDatabases } from '../support/databases';
import type { LifecycleDeps } from './lifecycle';
import { resolveStateDir } from './manifest';

/** Real dependencies: the approved integration-db harness (cwd must be backend/). */
export function realLifecycleDeps(env: Record<string, string | undefined> = process.env): LifecycleDeps {
  const repoRoot = path.resolve(process.cwd(), '..');
  return {
    env,
    stateDir: resolveStateDir(env, repoRoot),
    open: (allowLeftovers) => openIntegrationDatabases(env, undefined, allowLeftovers),
    log: (message) => process.stderr.write(`[e2e] ${message}\n`),
  };
}

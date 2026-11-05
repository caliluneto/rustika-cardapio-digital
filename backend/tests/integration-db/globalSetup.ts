import { assertIntegrationGate } from './support/preflight';

/** First lock: without the explicit variables nothing is imported, connected or written. */
export default function setup(): void {
  assertIntegrationGate(process.env);
}

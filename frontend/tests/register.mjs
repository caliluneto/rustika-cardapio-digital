import { register } from 'node:module';

// Use the existing TypeScript compiler with node:test; no extra test dependencies.
register('./typescript-loader.mjs', import.meta.url);

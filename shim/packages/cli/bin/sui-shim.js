#!/usr/bin/env node
// Bootstraps the TypeScript CLI by re-spawning Node with tsx as an ESM loader.
// tsx is a workspace devDependency — no global install required.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = resolve(__dirname, '../src/index.ts');

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx/esm', entry, ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);

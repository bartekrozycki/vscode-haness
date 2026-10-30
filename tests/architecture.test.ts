import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

async function check(files: Record<string, string>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sdlc-architecture-'));
  try {
    for (const [name, contents] of Object.entries(files)) { const file = path.join(root, 'src', name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, contents); }
    return spawnSync(process.execPath, ['scripts/check-architecture.mjs', root], { encoding: 'utf8' });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('architecture guard accepts inward dependencies and detects forbidden infrastructure imports', async () => {
  const valid = { 'contracts/model.ts': 'export interface Task {}', 'domain/policy.ts': "import type {Task} from '../contracts/model'; export const ready = true;", 'application/run.ts': "import {ready} from '../domain/policy';" };
  assert.equal((await check(valid)).status, 0);
  const invalid = await check({ ...valid, 'infrastructure/files.ts': 'export const files = true;', 'domain/policy.ts': "import {files} from '../infrastructure/files';" });
  assert.equal(invalid.status, 1); assert.match(invalid.stderr, /domain cannot import infrastructure/);
});

test('architecture guard protects contracts from vendor types and catches dependency cycles', async () => {
  const vendor = await check({ 'contracts/leak.ts': "import type {CopilotClient} from '@github/copilot-sdk';" });
  assert.equal(vendor.status, 1); assert.match(vendor.stderr, /contracts cannot import external package/);
  const cycle = await check({ 'domain/a.ts': "import './b';", 'domain/b.ts': "import './a';" });
  assert.equal(cycle.status, 1); assert.match(cycle.stderr, /Dependency cycle/);
});

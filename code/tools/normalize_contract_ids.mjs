#!/usr/bin/env node

// Align the contract identity with the visible task record.  A subset of the
// archived synthetic tasks used a short P-number in task.json but the full
// directory stem in the contract; this metadata-only normalization keeps the
// task/contract join unambiguous without changing any checks or prompts.
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] || resolve(import.meta.dirname, '../..'));
const changed = [];
for (const split of ['core_205', 'hf_snapshot_1799']) {
  const splitRoot = join(root, 'tasks', split);
  if (!existsSync(splitRoot)) continue;
  for (const entry of await readdir(splitRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(splitRoot, entry.name);
    const taskPath = join(dir, 'task.json'), contractPath = join(dir, 'contract.json');
    if (!existsSync(taskPath) || !existsSync(contractPath)) continue;
    const task = JSON.parse(await readFile(taskPath, 'utf8'));
    const contract = JSON.parse(await readFile(contractPath, 'utf8'));
    if (typeof task.id !== 'string' || contract.task_id === task.id) continue;
    const previous = contract.task_id ?? null;
    contract.task_id = task.id;
    await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
    changed.push({ split, directory: entry.name, previous, next: task.id });
  }
}
console.log(JSON.stringify({ changed: changed.length, entries: changed }, null, 2));

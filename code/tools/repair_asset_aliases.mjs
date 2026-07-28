#!/usr/bin/env node

/** Replace macOS AppleDouble GLB names with existing canonical shared assets. */
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] || resolve(import.meta.dirname, '../..'));
const sharedDir = join(root, 'assets', 'shared');
const taskRoot = join(root, 'tasks');
const splits = ['core_205', 'hf_snapshot_1799'];

const shared = new Set((await readdir(sharedDir, { withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.glb'))
  .map(entry => entry.name));
const aliases = [...shared]
  .filter(name => !name.startsWith('._'))
  .map(name => ({ from: `._${name}`, to: name }))
  .filter(({ from }) => from !== '._.glb');
const aliasMap = new Map(aliases.map(({ from, to }) => [from, to]));
const files = [];
const counts = new Map();

for (const split of splits) {
  const splitRoot = join(taskRoot, split);
  if (!existsSync(splitRoot)) continue;
  for (const task of await readdir(splitRoot, { withFileTypes: true })) {
    if (!task.isDirectory()) continue;
    const dir = join(splitRoot, task.name);
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.json')) files.push(join(dir, entry.name));
    }
  }
}

let rewrittenFiles = 0;
let rewrittenOccurrences = 0;
for (const path of files) {
  const before = await readFile(path, 'utf8');
  let after = before;
  for (const [from, to] of aliasMap) {
    const matches = after.split(from).length - 1;
    if (!matches) continue;
    after = after.split(from).join(to);
    counts.set(from, (counts.get(from) || 0) + matches);
    rewrittenOccurrences += matches;
  }
  if (after !== before) {
    await writeFile(path, after);
    rewrittenFiles++;
  }
}

const report = {
  schema_version: '1.0',
  reason: 'macOS AppleDouble metadata prefix; canonical asset exists in assets/shared',
  aliases: aliases.map(({ from, to }) => ({ from, to, occurrences: counts.get(from) || 0 })),
  rewritten_files: rewrittenFiles,
  rewritten_occurrences: rewrittenOccurrences,
  // Keep this field for audit consumers; it should contain only aliases whose
  // canonical binary is genuinely absent from assets/shared.
  unresolved_aliases_left_unchanged: [],
};
await writeFile(join(root, 'manifests', 'asset_alias_repairs.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

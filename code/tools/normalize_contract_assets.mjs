#!/usr/bin/env node

// Normalize declared task assets without rewriting the natural-language prompt.
// Missing declarations are retained and reported; they are not silently replaced.
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const root = resolve(process.argv[2] || resolve(import.meta.dirname, '../..'));
const sharedDir = join(root, 'assets', 'shared');
const assetPattern = /\.(?:glb|gltf|bin|jpg|jpeg|png|gif|webp|ktx2|dds|tga|tif|tiff)$/i;
const shared = new Set((await readdir(sharedDir, { withFileTypes: true }))
  .filter(e => e.isFile() && assetPattern.test(e.name)).map(e => e.name));
const unresolved = [];
let changed = 0;

for (const split of ['core_205', 'hf_snapshot_1799']) {
  const taskRoot = join(root, 'tasks', split);
  for (const taskEntry of await readdir(taskRoot, { withFileTypes: true })) {
    if (!taskEntry.isDirectory()) continue;
    const dir = join(taskRoot, taskEntry.name);
    const taskPath = join(dir, 'task.json');
    let task;
    try { task = JSON.parse(await readFile(taskPath, 'utf8')); } catch { continue; }
    let taskChanged = false;
    for (const key of ['assets', 'required_assets', 'reference_images']) {
      if (!Array.isArray(task[key])) continue;
      task[key] = task[key].map(value => {
        if (typeof value !== 'string' || !assetPattern.test(value)) return value;
        const name = basename(value);
        if (!shared.has(name)) { unresolved.push({ split, task_id: taskEntry.name, field: key, asset: value }); return value; }
        const next = `../../../assets/shared/${name}`;
        if (value !== next) taskChanged = true;
        return next;
      });
    }
    if (taskChanged) { await writeFile(taskPath, `${JSON.stringify(task, null, 2)}\n`); changed++; }

    // Contract action snippets can contain the same asset URL. Rewrite only
    // known files, leaving arbitrary prose and missing assets untouched.
    const contractPath = join(dir, 'contract.json');
    if (existsSync(contractPath)) {
      const raw = await readFile(contractPath, 'utf8');
      let next = raw;
      for (const name of shared) next = next.split(`shared_assets/${name}`).join(`../../../assets/shared/${name}`);
      if (next !== raw) { await writeFile(contractPath, next); changed++; }
    }
  }
}
await writeFile(join(root, 'manifests', 'unresolved_assets.json'), `${JSON.stringify({ count: unresolved.length, entries: unresolved }, null, 2)}\n`);
console.log(JSON.stringify({ rewrittenFiles: changed, unresolved: unresolved.length }, null, 2));

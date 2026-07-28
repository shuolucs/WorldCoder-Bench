#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const root = resolve(process.argv[2] || resolve(import.meta.dirname, '../..'));
const splits = ['core_205', 'hf_snapshot_1799'];
const hashFile = async p => createHash('sha256').update(await readFile(p)).digest('hex');

async function main() {
  const sharedDir = join(root, 'assets', 'shared');
  await mkdir(sharedDir, { recursive: true });
  const byHash = new Map();
  const byName = new Map();
  const mapping = {};
  // Preserve an earlier partial run: index already-consolidated bytes first.
  for (const e of await readdir(sharedDir, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.toLowerCase().endsWith('.glb')) continue;
    const hash = await hashFile(join(sharedDir, e.name));
    byHash.set(hash, e.name);
    byName.set(e.name, hash);
  }
  for (const split of splits) {
    const dir = join(root, 'assets', split);
    if (!existsSync(dir)) continue;
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (!e.isFile() || !e.name.toLowerCase().endsWith('.glb')) continue;
      const src = join(dir, e.name), hash = await hashFile(src);
      let name = byHash.get(hash);
      if (!name) {
        name = e.name;
        if (byName.has(name) && byName.get(name) !== hash) name = `${name.replace(/\.glb$/i, '')}__${hash.slice(0, 12)}.glb`;
        const dst = join(sharedDir, name);
        if (!existsSync(dst)) await copyFile(src, dst);
        byHash.set(hash, name); byName.set(name, hash);
      }
      mapping[`${split}/${e.name}`] = name;
    }
  }
  let rewritten = 0;
  for (const split of splits) {
    const taskRoot = join(root, 'tasks', split);
    if (!existsSync(taskRoot)) continue;
    for (const task of await readdir(taskRoot, { withFileTypes: true })) {
      if (!task.isDirectory()) continue;
      const dir = join(taskRoot, task.name);
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (!e.isFile() || (!e.name.endsWith('.json') && !e.name.endsWith('.html'))) continue;
        const p = join(dir, e.name); const raw = await readFile(p, 'utf8');
        let next = raw;
        for (const [key, name] of Object.entries(mapping)) {
          if (!key.startsWith(`${split}/`)) continue;
          const old = `../../../assets/${key}`;
          next = next.split(old).join(`../../../assets/shared/${name}`);
        }
        if (next !== raw) { await writeFile(p, next); rewritten++; }
      }
    }
  }
  for (const split of splits) {
    const dir = join(root, 'assets', split);
    if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
  }
  const report = { root: '.', sharedAssets: byHash.size, rewrittenFiles: rewritten, mappingEntries: Object.keys(mapping).length };
  await writeFile(join(root, 'manifests', 'asset_consolidation.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });

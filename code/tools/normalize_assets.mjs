#!/usr/bin/env node

/**
 * Deduplicate task-local assets into the shared release asset pool and rewrite
 * all task/HTML references to portable repository-relative paths.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile, mkdir, unlink, copyFile } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';

const root = resolve(process.argv[2] || resolve(import.meta.dirname, '../..'));
const splits = ['core_205', 'hf_snapshot_1799'];
const assetPattern = /\.(?:glb|gltf|bin|jpg|jpeg|png|gif|webp|ktx2|dds|tga|tif|tiff)$/i;

async function files(dir) {
  if (!existsSync(dir)) return [];
  return (await readdir(dir, { withFileTypes: true }))
    .filter(e => e.isFile()).map(e => join(dir, e.name));
}

async function sha256(path) {
  const h = createHash('sha256');
  h.update(await readFile(path));
  return h.digest('hex');
}

function portableAssetPath(_split, name) {
  // Every task lives at tasks/<split>/<task>, so three parent traversals
  // reach the release root regardless of the archival split.
  return `../../../assets/shared/${name}`;
}

function rewriteHtml(text, split, aliases) {
  let out = text;
  for (const [sourceName, canonicalName] of aliases) {
    const escaped = sourceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const target = portableAssetPath(split, canonicalName);
    // Keep URLs and arbitrary prose untouched; rewrite common source/src URL forms.
    const patterns = [
      new RegExp(`(?<![A-Za-z0-9_:/.-])(?:\.\./)+shared_assets/${escaped}`, 'g'),
      new RegExp(`(?<![A-Za-z0-9_:/.-])shared_assets/${escaped}`, 'g'),
      new RegExp(`(?<![A-Za-z0-9_:/.-])(?:\.\/)?assets/${escaped}`, 'g'),
      new RegExp(`(?<![A-Za-z0-9_:/.-])${escaped}`, 'g'),
    ];
    for (const p of patterns) out = out.replace(p, target);
  }
  return out;
}

async function rewriteJson(path, split, aliases) {
  const raw = await readFile(path, 'utf8');
  let data;
  try { data = JSON.parse(raw); } catch { return false; }
  let changed = false;
  const rewriteValue = value => {
    if (typeof value !== 'string') return value;
    const m = value.match(/(?:^|\/|\\)([^/\\]+\.(?:glb|gltf|bin|jpg|jpeg|png|gif|webp|ktx2|dds|tga|tif|tiff))$/i);
    const canonicalName = m && aliases.get(m[1]);
    if (!canonicalName) return value;
    const target = portableAssetPath(split, canonicalName);
    if (value !== target) changed = true;
    return target;
  };
  for (const key of ['assets', 'required_assets']) {
    if (Array.isArray(data[key])) data[key] = data[key].map(rewriteValue);
  }
  if (changed) await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
  return changed;
}

async function main() {
  const report = { root: '.', splits: {}, rewrittenFiles: 0, removedTaskAssets: 0 };
  const assetDir = join(root, 'assets', 'shared');
  await mkdir(assetDir, { recursive: true });

  // Keep one hash index across both source splits.  This is what makes an
  // asset referenced by tasks in different splits occupy only one file in
  // the release.
  const shared = new Map();
  for (const path of await files(assetDir)) {
    if (!assetPattern.test(path)) continue;
    shared.set(await sha256(path), basename(path));
  }

  for (const split of splits) {
    const taskRoot = join(root, 'tasks', split);
    const taskDirs = (await readdir(taskRoot, { withFileTypes: true }))
      .filter(e => e.isDirectory()).map(e => join(taskRoot, e.name));
    let removed = 0;
    let copied = 0;
    for (const taskDir of taskDirs) {
      // Keep aliases local to a task.  Two tasks may use the same basename
      // for different binaries; a global basename map would rewrite one of
      // them to the wrong shared asset.
      const aliases = new Map([...shared.values()].map(name => [name, name]));
      const localDir = join(taskDir, 'assets');
      for (const path of await files(localDir)) {
        if (!assetPattern.test(path)) continue;
        const hash = await sha256(path);
        let name = shared.get(hash);
        if (!name) {
          name = basename(path);
          // A basename collision with different bytes gets a stable hash suffix.
          const existing = join(assetDir, name);
          if (existsSync(existing) && (await sha256(existing)) !== hash) {
            const ext = name.match(/\.[^.]+$/)?.[0] || '';
            name = `${name.slice(0, name.length - ext.length)}__${hash.slice(0, 12)}${ext}`;
          }
          await copyFile(path, join(assetDir, name));
          shared.set(hash, name);
          copied++;
        }
        aliases.set(basename(path), name);
        await unlink(path);
        removed++;
      }
      const entries = await readdir(taskDir, { withFileTypes: true });
      for (const entry of entries) {
        const path = join(taskDir, entry.name);
        if (!entry.isFile()) continue;
        if (entry.name.endsWith('.json')) {
          if (await rewriteJson(path, split, aliases)) report.rewrittenFiles++;
        } else if (entry.name.endsWith('.html')) {
          const raw = await readFile(path, 'utf8');
          const next = rewriteHtml(raw, split, aliases);
          if (next !== raw) {
            await writeFile(path, next);
            report.rewrittenFiles++;
          }
        }
      }
    }
    report.splits[split] = { sharedAssets: shared.size, copied, removedTaskAssets: removed, tasks: taskDirs.length };
    report.removedTaskAssets += removed;
  }
  await writeFile(join(root, 'manifests', 'asset_path_rewrite.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => { console.error(error); process.exit(1); });

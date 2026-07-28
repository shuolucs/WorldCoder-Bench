#!/usr/bin/env node

/** Replace concrete remote task-asset URLs with repository-relative paths. */
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';

const root = resolve(process.argv[2] || resolve(import.meta.dirname, '../..'));
const assetExtension = /\.(?:glb|gltf|bin|png|jpe?g|gif|webp|ktx2|dds|tga|tif|tiff)$/i;
const urlPattern = /https?:\/\/[^\s"'`<>\\]+/g;
const trailingPunctuation = /[.,;:!?\)\]\}]+$/;
const assetPrefix = '../../../assets/shared/';

async function filesUnder(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(path));
    else out.push(path);
  }
  return out;
}

function isAssetReference(value) {
  if (typeof value !== 'string') return false;
  const clean = value.split(/[?#]/, 1)[0];
  return assetExtension.test(clean);
}

function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, out);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) collectStrings(item, out);
  return out;
}

function cleanUrl(raw) {
  const match = raw.match(trailingPunctuation);
  const suffix = match ? match[0] : '';
  return { core: suffix ? raw.slice(0, -suffix.length) : raw, suffix };
}

function templateRelative(pathname) {
  const decoded = decodeURIComponent(pathname);
  const file = decoded.slice(decoded.lastIndexOf('/') + 1);
  return `${assetPrefix}${file}`;
}

// Keep migration provenance useful without copying author/repository names or
// the original external URL into the anonymous release.  The digest is only
// for stable deduplication/audit; it is not intended to be reversible metadata.
function anonymizeRecord(record) {
  const original = typeof record.original === 'string' ? record.original : '';
  let sourceAsset = record.source_asset || null;
  if (sourceAsset) {
    try { sourceAsset = decodeURIComponent(sourceAsset); } catch { /* retain malformed historical label */ }
  }
  if (!sourceAsset && original) {
    try { sourceAsset = decodeURIComponent(basename(new URL(original).pathname)) || null; } catch { /* malformed historical record */ }
  }
  const sourceUrlSha256 = record.source_url_sha256 || (original
    ? createHash('sha256').update(original).digest('hex')
    : null);
  const { original: _original, ...safe } = record;
  return { ...safe, source_asset: sourceAsset, source_url_sha256: sourceUrlSha256 };
}

async function main() {
  const sharedDir = join(root, 'assets', 'shared');
  const sharedFiles = (await readdir(sharedDir, { withFileTypes: true }))
    .filter(entry => entry.isFile() && assetExtension.test(entry.name))
    .map(entry => entry.name);
  const sharedByLower = new Map(sharedFiles.map(name => [name.toLowerCase(), name]));
  const records = [];
  const manifestPath = join(root, 'manifests', 'external_asset_url_migrations.json');
  let historical = [];
  try {
    const previous = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (Array.isArray(previous.entries)) historical = previous.entries;
  } catch {
    // A first normalization run has no migration history to preserve.
  }
  const templateMigrations = new Map([
    ['hf_snapshot_1799/P2727_glb_magnet_object_attracting_glb_metal_s', {
      from: `${assetPrefix}{ModelName}.glb`,
      to: `${assetPrefix}RiggedFigure.glb' and '${assetPrefix}IridescenceAbalone.glb`,
    }],
    ['hf_snapshot_1799/P2729_glb_pendulum_a_hits_glb_pendulum_b_newto', {
      from: `${assetPrefix}{modelName}.glb`,
      to: `${assetPrefix}InterpolationTest.glb' and '${assetPrefix}AnimatedMorphCube.glb`,
    }],
  ]);

  for (const split of ['core_205', 'hf_snapshot_1799']) {
    const taskRoot = join(root, 'tasks', split);
    for (const taskName of await readdir(taskRoot)) {
      const taskDir = join(taskRoot, taskName);
      const taskPath = join(taskDir, 'task.json');
      let taskRaw;
      try { taskRaw = await readFile(taskPath, 'utf8'); } catch { continue; }
      let task;
      try { task = JSON.parse(taskRaw); } catch { continue; }
      const templateMigration = templateMigrations.get(`${split}/${taskName}`);
      if (templateMigration && taskRaw.includes(templateMigration.from)) {
        taskRaw = taskRaw.replaceAll(templateMigration.from, templateMigration.to);
        await writeFile(taskPath, taskRaw);
        task = JSON.parse(taskRaw);
      }

      const declared = new Map();
      const declaredAssets = [...(Array.isArray(task.assets) ? task.assets : []),
        ...(Array.isArray(task.required_assets) ? task.required_assets : [])]
        .map(value => basename(String(value).split(/[?#]/, 1)[0]))
        .map(file => sharedByLower.get(file.toLowerCase()))
        .filter(Boolean);
      for (const value of collectStrings(task)) {
        if (!isAssetReference(value)) continue;
        const file = basename(value.split(/[?#]/, 1)[0]);
        const canonical = sharedByLower.get(file.toLowerCase());
        if (canonical) declared.set(file.toLowerCase(), canonical);
        if (value.startsWith(assetPrefix)) declared.set(file.toLowerCase(), file);
      }

      const paths = [taskPath, join(taskDir, 'contract.json')];
      for (const path of paths) {
        let raw;
        try { raw = await readFile(path, 'utf8'); } catch { continue; }
        let changed = false;
        const rewritten = raw.replace(urlPattern, rawUrl => {
          const { core, suffix } = cleanUrl(rawUrl);
          let pathname;
          try { pathname = new URL(core).pathname; } catch { return rawUrl; }
          if (!assetExtension.test(pathname)) return rawUrl;
          const decoded = decodeURIComponent(pathname);
          const file = basename(decoded);
          const key = file.toLowerCase();
          const canonical = declared.get(key) || sharedByLower.get(key);
          const isTemplate = /[%{}]/.test(file);
          const replacement = canonical
            ? `${assetPrefix}${canonical}`
            : isTemplate && declaredAssets.length
              ? declaredAssets.map(name => `${assetPrefix}${name}`).join(' and ')
              : templateRelative(pathname);
          changed = true;
          records.push({
            file: relative(root, path).split('\\').join('/'),
            task_id: task.id || taskName,
            original: core,
            replacement,
            status: canonical ? 'rewritten_to_shared_asset'
              : isTemplate && declaredAssets.length ? 'rewritten_to_declared_shared_assets'
                : 'rewritten_unresolved_or_template',
          });
          return replacement + suffix;
        });
        if (changed) await writeFile(path, rewritten);
      }
    }
  }

  await mkdir(join(root, 'manifests'), { recursive: true });
  const merged = new Map();
  for (const record of [...historical, ...records]) {
    const safe = anonymizeRecord(record);
    const key = JSON.stringify([safe.file, safe.source_url_sha256, safe.replacement]);
    merged.set(key, safe);
  }
  await writeFile(manifestPath, `${JSON.stringify({
    schema_version: '1.0',
    description: 'Concrete remote task-asset references rewritten to release-relative paths. Original URLs and repository/user names are intentionally omitted; source_asset and a non-reversible URL digest retain anonymous audit provenance.',
    count: merged.size,
    entries: [...merged.values()],
  }, null, 2)}\n`);
  console.log(JSON.stringify({ rewritten: records.length, historical: historical.length, manifest: relative(root, manifestPath) }, null, 2));
}

main().catch(error => { console.error(error); process.exit(1); });

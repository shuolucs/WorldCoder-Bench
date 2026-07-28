#!/usr/bin/env node

/** Build release manifests and audit portability/privacy invariants. */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync } from 'node:fs';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';

const root = resolve(process.argv[2] || resolve(import.meta.dirname, '../..'));
const strict = process.argv.includes('--strict');
const textExt = new Set(['.json', '.jsonl', '.md', '.txt', '.mjs', '.js', '.sh', '.cff', '.cff', '.yml', '.yaml']);
const assetExt = /\.(?:glb|gltf|bin|jpg|jpeg|png|gif|webp|ktx2|dds|tga|tif|tiff)$/i;
const remoteAssetUrl = /https?:\/\/[^\s"'<>`\\]+\.(?:glb|gltf|bin|jpg|jpeg|png|gif|webp)(?:[?#][^\s"'<>`\\]+)?/i;
const binaryEmail = /[A-Za-z0-9._%+-]{2,}@[A-Za-z0-9.-]+\.(?:com|org|net|edu|gov|io|cn|uk|de|fr|jp|co|info|dev|test)\b/ig;
const binaryPlaceholder = ['anonymous', '@invalid', '.test'].join('');
// Match only concrete local paths, credentials, or internal infrastructure.
// A previous broad drive-letter expression matched ordinary JSON prose such as
// `P:\n`; require a slash after the drive and a path component instead.
const forbidden = /(?:\/Users\/[^\s"']+|\/home\/[A-Za-z0-9._-]+(?:\/|$)|file:\/\/(?:\/)?(?:Users|home)\/|https?:\/\/(?!127\.0\.0\.1)(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?|(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|(?:api[_-]?key|authorization)\s*[:=]|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const localRoots = [root, dirname(root), dirname(dirname(root))]
  .filter((value, index, values) => value && values.indexOf(value) === index);
const localRootPattern = localRoots.map(escapeRegExp).join('|');
const binaryLocalPath = new RegExp(
  `(?:\\/Users\\/|\\/home\\/[A-Za-z0-9._-]+(?:\\/|$)|${localRootPattern})`,
  'i'
);
const privacyTextPattern = new RegExp(`${forbidden.source}|${localRootPattern}`, 'i');

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}
const sha256 = async p => createHash('sha256').update(await readFile(p)).digest('hex');
const rel = p => relative(root, p).split('\\').join('/');
const parse = async p => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; } };

function glbAudit(buffer, path) {
  const failures = [];
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'glTF') failures.push('bad_magic');
  const version = buffer.length >= 8 ? buffer.readUInt32LE(4) : null;
  const declared = buffer.length >= 12 ? buffer.readUInt32LE(8) : null;
  if (version !== 2) failures.push(`unsupported_version:${version}`);
  if (declared !== buffer.length) failures.push(`length_mismatch:${declared}:${buffer.length}`);
  let offset = 12;
  while (failures.length === 0 && offset < buffer.length) {
    if (offset + 8 > buffer.length) { failures.push('truncated_chunk_header'); break; }
    const n = buffer.readUInt32LE(offset), type = buffer.toString('ascii', offset + 4, offset + 8);
    offset += 8;
    if (offset + n > buffer.length) { failures.push(`truncated_chunk:${type}`); break; }
    offset += n;
  }
  if (offset !== buffer.length && failures.length === 0) failures.push('chunk_boundary');
  return { path: rel(path), bytes: buffer.length, version, declaredLength: declared, valid: failures.length === 0, failures };
}

async function main() {
  const files = await walk(root);
  const failures = [], privacy = [], glbs = [], taskRows = [], contractRows = [], assetRows = [], unresolved = [];
  const splitIds = { core_205: [], hf_snapshot_1799: [] };
  const sharedDir = join(root, 'assets', 'shared');
  const shared = new Set(existsSync(sharedDir) ? (await readdir(sharedDir, { withFileTypes: true })).filter(e => e.isFile()).map(e => e.name) : []);
  const seenIds = new Map();
  for (const split of ['core_205', 'hf_snapshot_1799']) {
    const taskRoot = join(root, 'tasks', split);
    if (!existsSync(taskRoot)) { failures.push(`missing_split:${split}`); continue; }
    for (const e of await readdir(taskRoot, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const dir = join(taskRoot, e.name), taskPath = join(dir, 'task.json'), contractPath = join(dir, 'contract.json');
      const task = await parse(taskPath), contract = await parse(contractPath);
      if (!task) { failures.push(`bad_task_json:${rel(taskPath)}`); continue; }
      if (!contract) failures.push(`bad_contract_json:${rel(contractPath)}`);
      const id = task.id || e.name;
      if (seenIds.has(id)) failures.push(`duplicate_task_id:${id}`); else seenIds.set(id, split);
      const declared = [];
      for (const key of ['assets', 'required_assets']) if (Array.isArray(task[key])) declared.push(...task[key].map(value => ({ field: key, value })));
      const references = Array.isArray(task.reference_images) ? task.reference_images
        .filter(value => typeof value === 'string').map(value => ({ field: 'reference_images', value })) : [];
      for (const { field, value } of [...declared, ...references]) {
        const name = basename(String(value));
        if (assetExt.test(name) && !/^\w+:\/\//.test(String(value)) && !shared.has(name)) {
          unresolved.push({ split, task_id: id, field, asset: value, media_type: extname(name).slice(1).toLowerCase() });
        }
      }
      const referenceMeta = references.length ? {
        reference_image_count: references.length,
        reference_images: references.map(({ value }) => value),
      } : {};
      taskRows.push({ task_id: id, split, path: rel(taskPath), domain: task.domain ?? null, difficulty: task.difficulty ?? null,
        asset_count: declared.length, declared_assets: declared.map(({ value }) => value),
        ...referenceMeta, task_sha256: await sha256(taskPath),
        contract_sha256: existsSync(contractPath) ? await sha256(contractPath) : null,
        contract_status: contract ? 'source_snapshot_provisional' : 'missing' });
      splitIds[split].push(id);
      if (contract) {
        const checks = (contract.transitions || []).reduce((total, transition) => {
          const verifier = transition?.verifier || transition?.verification || transition?.verify || {};
          const values = verifier.checks ?? transition?.checks ?? transition?.assertions ?? [];
          return total + (Array.isArray(values) ? values.length : (values ? 1 : 0));
        }, 0);
        contractRows.push({ task_id: id, split, path: rel(contractPath), status: 'source_snapshot_provisional',
          affordances: contract.affordances?.length || 0, states: contract.states?.length || 0,
          transitions: contract.transitions?.length || 0, checks, sha256: await sha256(contractPath) });
      }
    }
  }
  for (const p of files) {
    const r = rel(p), st = lstatSync(p);
    if (st.isSymbolicLink()) failures.push(`symlink:${r}`);
    if (/__MACOSX|api_archive|legacy_backup|\.draft$|node_modules/.test(r)) failures.push(`forbidden_artifact:${r}`);
    // The audit report is regenerated after this scan; including its previous
    // contents would make a placeholder or old finding self-referential.
    if (textExt.has(extname(p).toLowerCase()) && r !== 'logs/release_audit.json' && !r.startsWith('code/vendor/three/')) {
      const content = await readFile(p, 'utf8').catch(() => '');
      if (privacyTextPattern.test(content)) privacy.push(r);
      if (r.startsWith('tasks/') && remoteAssetUrl.test(content)) failures.push(`remote_task_asset_url:${r}`);
    }
    if (extname(p).toLowerCase() === '.glb') {
      const audit = glbAudit(await readFile(p), p); glbs.push(audit);
      if (!audit.valid) failures.push(`invalid_glb:${r}:${audit.failures.join(',')}`);
    }
    if (r.startsWith('assets/shared/')) {
      const binaryText = (await readFile(p)).toString('latin1');
      const emails = [...binaryText.matchAll(binaryEmail)]
        .map(match => match[0])
        .filter(email => email.toLowerCase() !== binaryPlaceholder);
      if (emails.length) privacy.push(`${r}:embedded_email:${[...new Set(emails)].join(',')}`);
      if (binaryLocalPath.test(binaryText)) privacy.push(`${r}:embedded_local_path`);
    }
    if (assetExt.test(p) && r.startsWith('assets/shared/')) {
      const ext = extname(p).toLowerCase();
      const mediaTypes = { '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
      assetRows.push({ asset: r, bytes: st.size, sha256: await sha256(p), media_type: mediaTypes[ext] || 'application/octet-stream',
        source: 'release asset; provenance/license must be reviewed before public release' });
    }
  }
  if (privacy.length) failures.push(`privacy_matches:${privacy.length}`);
  const manifestDir = join(root, 'manifests'); await mkdir(manifestDir, { recursive: true });
  await writeFile(join(manifestDir, 'tasks.jsonl'), taskRows.map(x => JSON.stringify(x)).join('\n') + '\n');
  await writeFile(join(manifestDir, 'contracts.jsonl'), contractRows.map(x => JSON.stringify(x)).join('\n') + '\n');
  await writeFile(join(manifestDir, 'assets.jsonl'), assetRows.map(x => JSON.stringify(x)).join('\n') + '\n');
  await writeFile(join(manifestDir, 'unresolved_assets.json'), `${JSON.stringify({ count: unresolved.length, entries: unresolved }, null, 2)}\n`);
  const sharedChecksums = [];
  for (const p of files.filter(path => assetExt.test(path) && rel(path).startsWith('assets/shared/'))) {
    sharedChecksums.push(`${await sha256(p)}  ${rel(p)}`);
  }
  await writeFile(join(root, 'assets_checksum.txt'), sharedChecksums.sort().join('\n') + '\n');
  const splitDir = join(root, 'splits'); await mkdir(splitDir, { recursive: true });
  for (const [split, ids] of Object.entries(splitIds)) await writeFile(join(splitDir, `${split}.txt`), `${ids.sort().join('\n')}\n`);
  const audit = { generated_at: new Date().toISOString(), root: '.', counts: { files: files.length, tasks: taskRows.length,
      core_205: taskRows.filter(x => x.split === 'core_205').length, hf_snapshot_1799: taskRows.filter(x => x.split === 'hf_snapshot_1799').length,
      glb: glbs.length, shared_assets: shared.size, shared_glb: [...shared].filter(name => /\.glb$/i.test(name)).length,
      shared_non_glb: [...shared].filter(name => !/\.glb$/i.test(name)).length, unresolved_asset_declarations: unresolved.length },
    glb: glbs, unresolved_assets: unresolved, privacy_matches: privacy, failures };
  await writeFile(join(root, 'logs', 'release_audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
  // Hash every packaged file except the hash file itself; manifests are included.
  const hashLines = [];
  for (const p of await walk(root)) if (rel(p) !== 'manifests/files.sha256') hashLines.push(`${await sha256(p)}  ${rel(p)}`);
  await writeFile(join(manifestDir, 'files.sha256'), hashLines.sort().join('\n') + '\n');
  console.log(JSON.stringify({ ...audit, failures: failures.length, privacy_matches: privacy.length }, null, 2));
  if (strict && (failures.length || unresolved.length)) process.exit(2);
}
main().catch(e => { console.error(e); process.exit(1); });

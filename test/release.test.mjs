import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPLITS = ['core_205', 'hf_snapshot_1799'];
const TASK_ROOT = join(ROOT, 'tasks');
const SHARED_ROOT = join(ROOT, 'assets', 'shared');
const ASSET_EXT = /\.(?:glb|gltf|bin|jpg|jpeg|png|gif|webp|ktx2|dds|tga|tif|tiff)$/i;

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function taskDirs() {
  const rows = [];
  for (const split of SPLITS) {
    const splitRoot = join(TASK_ROOT, split);
    const entries = await readdir(splitRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) rows.push({ split, name: entry.name, dir: join(splitRoot, entry.name) });
    }
  }
  return rows;
}

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, out);
    else out.push(path);
  }
  return out;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function jsonLines(path) {
  const text = await readFile(path, 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function declaredAssets(task) {
  const values = [];
  for (const key of ['assets', 'required_assets']) {
    if (task[key] === undefined) continue;
    assert.ok(Array.isArray(task[key]), `${key} must be an array when present`);
    values.push(...task[key].map(value => ({ key, value })));
  }
  if (task.reference_images !== undefined) {
    assert.ok(Array.isArray(task.reference_images), 'reference_images must be an array when present');
    values.push(...task.reference_images.filter(value => typeof value === 'string').map(value => ({ key: 'reference_images', value })));
  }
  return values;
}

function unresolvedKey(split, taskId, field, asset) {
  return `${split}\0${taskId}\0${field}\0${asset}`;
}

function expressionOf(check) {
  if (typeof check === 'string') return check;
  return check?.expr ?? check?.expression ?? check?.check ?? check?.condition ?? null;
}

function stateConditions(state) {
  const values = [];
  if (state?.condition) values.push(state.condition);
  if (Array.isArray(state?.conditions)) values.push(...state.conditions);
  return values;
}

function transitionChecks(transition) {
  const verifier = transition?.verifier || transition?.verification || transition?.verify || {};
  const values = verifier.checks ?? transition?.checks ?? transition?.assertions ?? [];
  return Array.isArray(values) ? values : (values ? [values] : []);
}

test('task records and behavioral contracts satisfy the documented shape', async () => {
  const rows = await taskDirs();
  assert.equal(rows.length, 2004, 'task directory count should match this release');
  const ids = new Set();
  for (const { split, name, dir } of rows) {
    const taskPath = join(dir, 'task.json');
    const contractPath = join(dir, 'contract.json');
    assert.ok(existsSync(taskPath), `${split}/${name} is missing task.json`);
    assert.ok(existsSync(contractPath), `${split}/${name} is missing contract.json`);
    const task = await readJson(taskPath);
    const contract = await readJson(contractPath);
    for (const field of ['id', 'title', 'domain', 'difficulty', 'prompt']) {
      assert.equal(typeof task[field], 'string', `${split}/${name}: task.${field} must be a string`);
      assert.ok(task[field].trim(), `${split}/${name}: task.${field} must not be empty`);
    }
    assert.match(task.id, /^P\d+/, `${split}/${name}: task.id should have a P-number prefix`);
    assert.ok(name === task.id || name.startsWith(`${task.id}_`), `${split}/${name}: directory/id mismatch`);
    assert.ok(!ids.has(task.id), `duplicate task id ${task.id}`);
    ids.add(task.id);
    // A small core subset keeps the expanded directory identifier in the
    // contract while task.json uses the short P-number. Both are valid.
    assert.ok(contract.task_id === task.id || contract.task_id === name, `${split}/${name}: contract.task_id mismatch`);
    for (const field of ['affordances', 'states', 'transitions']) {
      assert.ok(Array.isArray(contract[field]), `${split}/${name}: contract.${field} must be an array`);
    }
    for (const state of contract.states) {
      assert.equal(typeof state.id, 'string', `${split}/${name}: state id missing`);
      assert.ok(stateConditions(state).every(value => typeof value === 'string'), `${split}/${name}: invalid state condition`);
    }
    for (const transition of contract.transitions) {
      assert.equal(typeof transition.id, 'string', `${split}/${name}: transition id missing`);
      for (const check of transitionChecks(transition)) {
        assert.equal(typeof expressionOf(check), 'string', `${split}/${name}/${transition.id}: check has no expression`);
      }
    }
  }
});

test('declared asset paths resolve to shared assets or the explicit unresolved manifest', async () => {
  const unresolvedRows = await readJson(join(ROOT, 'manifests', 'unresolved_assets.json'));
  assert.equal(unresolvedRows.count, unresolvedRows.entries.length);
  const unresolved = new Set(unresolvedRows.entries.map(row => unresolvedKey(row.split, row.task_id, row.field || 'assets', row.asset)));
  assert.equal(unresolved.size, unresolvedRows.entries.length, 'unresolved manifest contains duplicate declarations');
  const seenDeclarations = new Set();
  const rows = await taskDirs();
  for (const { split, name, dir } of rows) {
    const task = await readJson(join(dir, 'task.json'));
    for (const { key: field, value } of declaredAssets(task)) {
      assert.equal(typeof value, 'string', `${split}/${name}: asset declaration must be a string`);
      if (!ASSET_EXT.test(value) || /^\w+:\/\//.test(value)) continue;
      assert.ok(!isAbsolute(value), `${split}/${name}: asset path must be relative`);
      const resolved = resolve(dir, value);
      const rootRelative = relative(ROOT, resolved);
      assert.ok(rootRelative && rootRelative !== '..' && !rootRelative.startsWith(`..${sep}`) && !isAbsolute(rootRelative), `${split}/${name}: asset escapes release root`);
      const key = unresolvedKey(split, task.id, field, value);
      const exists = existsSync(resolved);
      if (exists) {
        assert.ok(resolved === SHARED_ROOT || resolved.startsWith(`${SHARED_ROOT}${sep}`), `${split}/${name}: asset is not under assets/shared`);
        assert.ok(!unresolved.has(key), `${split}/${name}: existing asset is incorrectly marked unresolved`);
      } else {
        assert.ok(unresolved.has(key), `${split}/${name}: missing asset is absent from unresolved manifest`);
      }
      seenDeclarations.add(key);
    }
  }
  for (const row of unresolvedRows.entries) {
    const key = unresolvedKey(row.split, row.task_id, row.field || 'assets', row.asset);
    assert.ok(seenDeclarations.has(key), `unresolved entry does not correspond to a task declaration: ${key}`);
    const taskDir = rows.find(item => item.split === row.split && (item.name === row.task_id || item.name.startsWith(`${row.task_id}_`)));
    assert.ok(taskDir, `unresolved entry points to unknown task ${row.split}/${row.task_id}`);
  }
});

test('task and asset manifests match files on disk', async () => {
  const rows = await taskDirs();
  const taskManifest = await jsonLines(join(ROOT, 'manifests', 'tasks.jsonl'));
  const assetManifest = await jsonLines(join(ROOT, 'manifests', 'assets.jsonl'));
  assert.equal(taskManifest.length, rows.length);
  assert.equal(new Set(taskManifest.map(row => row.task_id)).size, taskManifest.length);
  const taskById = new Map();
  for (const row of taskManifest) {
    assert.ok(!taskById.has(row.task_id), `duplicate task manifest id ${row.task_id}`);
    taskById.set(row.task_id, row);
    const taskPath = join(ROOT, row.path);
    const contractPath = join(dirname(taskPath), 'contract.json');
    assert.ok(existsSync(taskPath), `manifest task path missing: ${row.path}`);
    const task = await readJson(taskPath);
    assert.equal(task.id, row.task_id, `manifest task id mismatch: ${row.path}`);
    assert.equal(row.split, row.path.split('/')[1], `manifest split/path mismatch: ${row.path}`);
    assert.equal(row.task_sha256, sha256(await readFile(taskPath)), `task hash mismatch: ${row.path}`);
    assert.equal(row.contract_sha256, sha256(await readFile(contractPath)), `contract hash mismatch: ${row.path}`);
    assert.equal(row.asset_count, row.declared_assets.length);
  }
  const sharedFiles = (await walk(SHARED_ROOT)).filter(path => ASSET_EXT.test(path));
  assert.equal(assetManifest.length, sharedFiles.length);
  const assetByPath = new Map();
  for (const row of assetManifest) {
    assert.ok(!assetByPath.has(row.asset), `duplicate asset manifest path ${row.asset}`);
    assetByPath.set(row.asset, row);
    const path = join(ROOT, row.asset);
    assert.ok(existsSync(path), `manifest asset path missing: ${row.asset}`);
    const data = await readFile(path);
    assert.equal(row.bytes, data.length, `asset byte count mismatch: ${row.asset}`);
    assert.equal(row.sha256, sha256(data), `asset hash mismatch: ${row.asset}`);
  }
  let taskMaterial = '';
  for (const { dir } of rows) {
    taskMaterial += await readFile(join(dir, 'task.json'), 'utf8');
    taskMaterial += await readFile(join(dir, 'contract.json'), 'utf8');
  }
  for (const path of sharedFiles) {
    assert.ok(assetByPath.has(relative(ROOT, path).split(sep).join('/')), `unlisted shared asset: ${path}`);
    assert.ok(taskMaterial.includes(basename(path)), `shared asset is not referenced by task material: ${basename(path)}`);
  }
});

test('checksum manifest covers the release and no model artifacts are packaged', async () => {
  const files = await walk(ROOT);
  const packaged = files.filter(path => relative(ROOT, path).split(sep).join('/') !== 'manifests/files.sha256');
  const checksumLines = (await readFile(join(ROOT, 'manifests', 'files.sha256'), 'utf8')).trim().split(/\r?\n/).filter(Boolean);
  const checksums = new Map();
  for (const line of checksumLines) {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    assert.ok(match, `invalid checksum line: ${line}`);
    assert.ok(!checksums.has(match[2]), `duplicate checksum path: ${match[2]}`);
    checksums.set(match[2], match[1]);
  }
  assert.equal(checksums.size, packaged.length, 'checksum manifest file count mismatch');
  for (const path of packaged) {
    const relPath = relative(ROOT, path).split(sep).join('/');
    assert.equal(checksums.get(relPath), sha256(await readFile(path)), `checksum mismatch: ${relPath}`);
    assert.notEqual(lstatSync(path).isSymbolicLink(), true, `symlink in release: ${relPath}`);
  }
  const modelArtifacts = files.filter(path => /\.html$/i.test(path) || /(^|\/)(trajectory|trace|report)_/i.test(path));
  assert.deepEqual(modelArtifacts, [], 'model HTML/trajectory/report artifacts must remain external to this release');
  assert.equal(existsSync(join(ROOT, 'code', 'mutation')), false, 'mutation-generation source must remain external');
  assert.equal(existsSync(join(ROOT, 'contracts_dev')), false, 'empty Dev placeholder directory must not be packaged');
  assert.equal(existsSync(join(ROOT, 'results')), false, 'empty results placeholder directory must not be packaged');
});

test('external asset migration manifest is anonymous and complete', async () => {
  const manifestPath = join(ROOT, 'manifests', 'external_asset_url_migrations.json');
  const manifest = await readJson(manifestPath);
  assert.equal(manifest.count, 27);
  assert.equal(manifest.entries.length, 27);
  assert.doesNotMatch(await readFile(manifestPath, 'utf8'), /https?:\/\//i);
  for (const entry of manifest.entries) {
    assert.equal(typeof entry.source_asset, 'string');
    assert.match(entry.source_asset, /^[^/@\\]+$/);
    assert.match(entry.source_url_sha256, /^[a-f0-9]{64}$/);
    assert.equal('original' in entry, false, `${entry.file} retains an external URL`);
    const replacements = Array.isArray(entry.replacement) ? entry.replacement : [entry.replacement];
    for (const replacement of replacements) assert.match(replacement, /^\.\.\/\.\.\/\.\.\/assets\/shared\//);
  }
});

test('schema smoke fixture accepts plural state conditions and structured verifier checks', async () => {
  const fixture = await readJson(join(ROOT, 'test', 'fixtures', 'schema_smoke.json'));
  const { contract, state_before: before, state_after: after } = fixture;
  assert.equal(contract.states.length, 1);
  assert.equal(stateConditions(contract.states[0]).length, 2);
  assert.equal(transitionChecks(contract.transitions[0]).length, 1);
  const state = after;
  for (const expression of stateConditions(contract.states[0])) {
    assert.equal(runInNewContext(expression, { state }), true, expression);
  }
  const check = transitionChecks(contract.transitions[0])[0];
  assert.equal(runInNewContext(expressionOf(check), { before, after }), true, expressionOf(check));
  assert.equal(expressionOf(contract.affordances[0].check), 'state.ready === true');
});

test('V-Cov follows the paper unweighted assertion ratio', async () => {
  const { assertionCoverage } = await import('../code/evaluator/metrics.mjs');
  const coverage = assertionCoverage([
    { tier: 'L0', pass: true },
    { tier: 'L1', pass: false },
    { tier: 'L2', pass: false },
  ]);
  assert.equal(coverage.passed, 1);
  assert.equal(coverage.total, 3);
  assert.ok(Math.abs(coverage.percent - (100 / 3)) < 1e-12);
  const relabeled = assertionCoverage([
    { tier: 'L2', pass: true },
    { tier: 'L2', pass: false },
    { tier: 'L0', pass: false },
  ]);
  assert.deepEqual(relabeled, coverage, 'tier labels must not reweight V-Cov');
});

test('Croissant metadata matches the shared release layout', async () => {
  const croissant = await readJson(join(ROOT, 'croissant.json'));
  const properties = new Map((croissant.additionalProperty || []).map(property => [property.name, property.value]));
  const unresolved = await readJson(join(ROOT, 'manifests', 'unresolved_assets.json'));
  assert.equal(Number(properties.get('unresolved_asset_declaration_count')), unresolved.count);
  const sharedFiles = (await walk(SHARED_ROOT)).filter(path => ASSET_EXT.test(path));
  const release = await readJson(join(ROOT, 'release.json'));
  assert.equal(release.counts.shared_assets, sharedFiles.length, 'release asset count is stale');
  assert.equal(release.counts.shared_glb, sharedFiles.filter(path => /\.glb$/i.test(path)).length, 'release GLB count is stale');
  assert.equal(Number(properties.get('shared_asset_count')), sharedFiles.length, 'Croissant asset count is stale');
  assert.equal(Number(properties.get('shared_glb_count')), sharedFiles.filter(path => /\.glb$/i.test(path)).length, 'Croissant GLB count is stale');
  const consolidation = await readJson(join(ROOT, 'manifests', 'asset_consolidation.json'));
  const pathRewrite = await readJson(join(ROOT, 'manifests', 'asset_path_rewrite.json'));
  assert.equal(consolidation.final_shared_assets, sharedFiles.length, 'consolidation report is stale');
  assert.equal(pathRewrite.final_shared_assets, sharedFiles.length, 'path rewrite report is stale');
});

test('public names follow the paper terminology', async () => {
  const release = await readJson(join(ROOT, 'release.json'));
  assert.equal(release.terminology.method, 'StateProbe');
  assert.equal(release.terminology.graph, 'SIG (Scene Interaction Graph)');
  assert.equal(release.terminology.specification, 'behavioral contract');
  assert.equal(release.terminology.runtime_interface, 'window.__3D_STATE__');

  const { StateProbeProtocol } = await import('../code/stateprobe/probe.mjs');
  assert.equal(typeof StateProbeProtocol, 'function');
  const cli = await readFile(join(ROOT, 'code', 'evaluator', 'cli.mjs'), 'utf8');
  assert.match(cli, /report\.vCov/);
  assert.doesNotMatch(cli, new RegExp(`weightedV${'Cov'}`));

  const files = await walk(ROOT);
  assert.equal(files.some(path => new RegExp(`${'ic' + 'g'}\\.json$`, 'i').test(path)), false);
  const legacy = new RegExp(`(?:^|[^A-Za-z0-9_])${'I' + 'CG'}(?:[^A-Za-z0-9_]|$)|__${'I' + 'CG'}|${'ic' + 'g'}\\.json`, 'i');
  const textExtensions = new Set(['.cff', '.js', '.json', '.jsonl', '.md', '.mjs', '.sh', '.txt']);
  for (const path of files) {
    if (!textExtensions.has(extname(path).toLowerCase()) || path.includes(`${sep}code${sep}vendor${sep}`)) continue;
    // This document is the intentional compatibility map, so its legacy
    // spellings are explanatory text rather than public identifiers.
    if (relative(ROOT, path).split(sep).join('/') === 'docs/terminology.md') continue;
    assert.doesNotMatch(await readFile(path, 'utf8'), legacy, relative(ROOT, path));
  }
});

test('StateProbe sandbox serves canonical shared-asset paths', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'worldcoder-sandbox-'));
  let server;
  try {
    const taskDir = join(fixture, 'tasks', 'core_205', 'P1_fixture');
    const sharedDir = join(fixture, 'assets', 'shared');
    await Promise.all([
      mkdir(taskDir, { recursive: true }),
      mkdir(sharedDir, { recursive: true }),
    ]);
    await writeFile(join(sharedDir, 'fixture.glb'), 'asset-body');
    await writeFile(join(sharedDir, 'fixture.jpg'), 'texture-body');

    const { Sandbox } = await import('../code/stateprobe/sandbox.mjs');
    const sandbox = new Sandbox({ taskDir, releaseRoot: fixture });
    const started = await sandbox._startServer(taskDir);
    server = started.server;
    for (const route of ['/assets/shared/fixture.glb', '/shared_assets/fixture.glb', '/assets/fixture.glb', '/fixture.glb']) {
      const response = await fetch(`http://127.0.0.1:${started.port}${route}`);
      assert.equal(response.status, 200, route);
      assert.equal(await response.text(), 'asset-body', route);
    }
    const textureResponse = await fetch(`http://127.0.0.1:${started.port}/assets/shared/fixture.jpg`);
    assert.equal(textureResponse.status, 200);
    assert.equal(textureResponse.headers.get('content-type'), 'image/jpeg');
    assert.equal(await textureResponse.text(), 'texture-body');
  } finally {
    if (server) await new Promise(resolveClose => server.close(resolveClose));
    await rm(fixture, { recursive: true, force: true });
  }
});

test('StateProbe action executor handles archival coordinate, DOM, keyboard, and chain forms', async () => {
  const { executeAction, actionDuration } = await import('../code/stateprobe/actions.mjs');
  const events = [];
  const makeLocator = name => ({
    first() { return this; },
    nth(index) { events.push(['nth', name, index]); return this; },
    count: async () => 1,
    boundingBox: async () => ({ x: 10, y: 20, width: 100, height: 80 }),
    click: async options => events.push(['click', name, options]),
    fill: async value => events.push(['fill', name, value]),
    dispatchEvent: async type => events.push(['event', name, type]),
    evaluate: async () => 'input',
    getAttribute: async () => 'text',
    filter() { return this; },
  });
  const page = {
    locator: selector => makeLocator(selector),
    getByText: text => makeLocator(`text:${text}`),
    mouse: {
      click: async (...args) => events.push(['mouse.click', ...args]),
      move: async (...args) => events.push(['mouse.move', ...args]),
      down: async (...args) => events.push(['mouse.down', ...args]),
      up: async (...args) => events.push(['mouse.up', ...args]),
    },
    keyboard: {
      down: async key => events.push(['keyboard.down', key]),
      up: async key => events.push(['keyboard.up', key]),
      press: async key => events.push(['keyboard.press', key]),
    },
    waitForTimeout: async duration => events.push(['wait', duration]),
    evaluate: async code => { if (typeof code === 'string') events.push(['eval', code]); },
  };

  await executeAction(page, { type: 'click_canvas', x: 0.25, y: 0.5 });
  await executeAction(page, { type: 'click_canvas', x_ratio: 0.75, y_ratio: 0.25 });
  await executeAction(page, { type: 'click_canvas', coordinates_normalized: [0.2, 0.3] });
  await executeAction(page, { type: 'click_canvas', x: 60, y: 30 });
  await executeAction(page, { type: 'click', selector: '#start' });
  await executeAction(page, { type: 'click_dom', text_match: 'Start' });
  await executeAction(page, { type: 'dom_input', selector: '#value', value: 3 });
  await executeAction(page, { type: 'keyboard', key: 'z', modifiers: ['ctrl'], action: 'press', repeat: 2 });
  await executeAction(page, { type: 'wait', duration: 17, next: { type: 'wait', duration_ms: 3 } });
  await executeAction(page, { type: 'wait_then_act', wait_ms: 1, then: { type: 'script', code: 'next()', wait_ms: 0 } });

  const clicks = events.filter(event => event[0] === 'mouse.click');
  assert.deepEqual(clicks.slice(0, 4).map(event => event.slice(1, 3)), [[35, 60], [85, 40], [30, 44], [70, 50]]);
  assert.equal(events.some(event => event[0] === 'click' && event[1] === '#start'), true);
  assert.equal(events.some(event => event[0] === 'click' && event[1] === 'text:Start'), true);
  assert.equal(events.some(event => event[0] === 'fill' && event[1] === '#value' && event[2] === '3'), true);
  assert.equal(events.filter(event => event[0] === 'keyboard.press' && event[1] === 'z').length, 2);
  assert.equal(events.filter(event => event[0] === 'keyboard.down' && event[1] === 'Control').length, 2);
  assert.deepEqual(events.filter(event => event[0] === 'wait').slice(-4, -2), [['wait', 17], ['wait', 3]]);
  assert.equal(events.filter(event => event[0] === 'eval' && event[1] === 'next()').length, 1);
  assert.equal(actionDuration({ delay: 22 }), 22);
  assert.equal(actionDuration({ duration: 25_000 }), 15_000);
});

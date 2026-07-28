#!/usr/bin/env node

/**
 * Portable WorldCoder-Bench evaluator.
 *
 * The release contains task definitions and SIG/behavioral-contract rubrics, but no
 * model-generated HTML.  Pass a model artifact with --html-path when running
 * an evaluation.  The HTTP server always serves the release root so shared
 * assets resolve from data/assets/shared regardless of the task directory.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { assertionCoverage, assertionsOfTransition, zeroAssertionCoverage } from './metrics.mjs';
import { actionDuration, executeAction } from '../stateprobe/actions.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '../..');
const VALID_SPLITS = new Set(['core_205', 'hf_snapshot_1799']);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
  '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream', '.pdb': 'chemical/x-pdb', '.wasm': 'application/wasm',
};
const CHECK_TIERS = new Set(['L0', 'L1', 'L2']);

function usage(exitCode = 0) {
  console.log(`WorldCoder-Bench evaluator\n\n` +
    `  node code/evaluator/cli.mjs --split core_205 --task P01... --html-path /tmp/model.html\n\n` +
    `Options: --root DIR --split NAME --task ID --html FILE --html-path FILE\n` +
    `         --model ID --output FILE --limit N --start ID --concurrency N --resume\n` +
    `         --offline --show --validate`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const o = { root: DEFAULT_ROOT, split: 'core_205', task: null, html: null, htmlPath: null,
    model: null, output: null, limit: null, start: null, concurrency: 1,
    resume: false, offline: false, show: false, validate: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], take = () => argv[++i];
    if (a === '--help' || a === '-h') usage(0);
    else if (a === '--root') o.root = resolve(take());
    else if (a.startsWith('--root=')) o.root = resolve(a.slice(7));
    else if (a === '--split') o.split = take();
    else if (a.startsWith('--split=')) o.split = a.slice(8);
    else if (a === '--task') o.task = take();
    else if (a.startsWith('--task=')) o.task = a.slice(7);
    else if (a === '--html') o.html = take();
    else if (a.startsWith('--html=')) o.html = a.slice(7);
    else if (a === '--html-path') o.htmlPath = resolve(take());
    else if (a.startsWith('--html-path=')) o.htmlPath = resolve(a.slice(12));
    else if (a === '--model') o.model = take();
    else if (a.startsWith('--model=')) o.model = a.slice(8);
    else if (a === '--output' || a === '--out') o.output = take();
    else if (a.startsWith('--output=')) o.output = a.slice(9);
    else if (a === '--limit') o.limit = Number(take());
    else if (a.startsWith('--limit=')) o.limit = Number(a.slice(8));
    else if (a === '--start') o.start = take();
    else if (a.startsWith('--start=')) o.start = a.slice(8);
    else if (a === '--concurrency') o.concurrency = Math.max(1, Number(take()));
    else if (a.startsWith('--concurrency=')) o.concurrency = Math.max(1, Number(a.slice(14)));
    else if (a === '--resume') o.resume = true;
    else if (a === '--offline') o.offline = true;
    else if (a === '--show') o.show = true;
    else if (a === '--validate') o.validate = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  if (!VALID_SPLITS.has(o.split)) throw new Error(`Unknown split '${o.split}'`);
  if (!Number.isFinite(o.concurrency) || o.concurrency < 1) throw new Error('--concurrency must be positive');
  if (o.htmlPath && o.html && o.html !== basename(o.htmlPath)) throw new Error('Use either --html or --html-path, not both');
  return o;
}

function under(root, target) {
  const r = resolve(root), t = resolve(target);
  return t === r || t.startsWith(`${r}${sep}`);
}

function sharedBasenamePath(root, requestPath) {
  const name = basename(requestPath);
  if (!name || name === '.' || name === '..' || name.includes('\\')) return null;
  const candidate = join(root, 'data', 'assets', 'shared', name);
  return existsSync(candidate) ? candidate : null;
}

function routePath(root, split, requestPath) {
  const clean = decodeURIComponent(requestPath.split('?')[0]);
  let rel;
  if (clean.startsWith(`/tasks/${split}/`)) rel = clean.slice(`/tasks/${split}/`.length);
  else if (clean.startsWith(`/assets/${split}/`)) return join(root, 'data', 'assets', split, clean.slice(`/assets/${split}/`.length));
  else if (clean.startsWith('/shared_assets/')) return join(root, 'data', 'assets', 'shared', clean.slice('/shared_assets/'.length));
  else if (clean.startsWith('/assets/')) {
    const direct = join(root, 'data', clean.slice(1));
    return existsSync(direct) ? direct : join(root, 'data', 'assets', 'shared', clean.slice('/assets/'.length));
  }
  else return sharedBasenamePath(root, clean);
  const taskPath = join(root, 'data', 'tasks', split, rel);
  if (existsSync(taskPath)) return taskPath;
  const shared = rel.indexOf('/shared_assets/');
  if (shared >= 0) return join(root, 'data', 'assets', 'shared', rel.slice(shared + '/shared_assets/'.length));
  const taskAssets = rel.indexOf('/assets/');
  if (taskAssets >= 0) {
    const assetRel = rel.slice(taskAssets + '/assets/'.length);
    if (assetRel.startsWith('shared/')) return join(root, 'data', 'assets', 'shared', assetRel.slice('shared/'.length));
    return join(root, 'data', 'assets', 'shared', assetRel);
  }
  return sharedBasenamePath(root, rel) || taskPath;
}

function startServer(root, split, { htmlRoute = null, htmlOverride = null } = {}) {
  return new Promise(resolveServer => {
    const server = createServer((req, res) => {
      try {
        const clean = decodeURIComponent((req.url || '/').split('?')[0]);
        if (htmlRoute && htmlOverride && clean === htmlRoute) {
          if (!existsSync(htmlOverride)) { res.writeHead(404); res.end('Input HTML not found'); return; }
          res.writeHead(200, { 'Content-Type': MIME['.html'], 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
          res.end(readFileSync(htmlOverride)); return;
        }
        const path = routePath(root, split, req.url || '/');
        if (!path || !under(root, path) || !existsSync(path)) { res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end('Not Found'); return; }
        res.writeHead(200, {
          'Content-Type': MIME[extname(path).toLowerCase()] || 'application/octet-stream',
          'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store',
        });
        res.end(readFileSync(path));
      } catch (error) { res.writeHead(400); res.end(String(error.message)); }
    });
    server.listen(0, '127.0.0.1', () => resolveServer({ server, port: server.address().port }));
  });
}

function browserPath() {
  const candidates = [
    process.env.CHROME_PATH, process.env.CHROMIUM_PATH, '/usr/bin/chromium',
    '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return candidates.find(existsSync) || null;
}

async function installImportMap(page, offline) {
  const vendor = resolve(HERE, '../vendor/three');
  const hasVendor = existsSync(join(vendor, 'build/three.module.js'));
  if (offline && !hasVendor) throw new Error('--offline requested but code/vendor/three is absent');
  if (hasVendor) {
    await page.route(/https?:\/\/(?:cdn\.jsdelivr\.net\/npm|unpkg\.com)\/three@[^/]+\/(.*)/, async route => {
      const u = new URL(route.request().url());
      const prefix = u.pathname.replace(/^\/npm\/three@[^/]+\//, '').replace(/^\/three@[^/]+\//, '');
      const local = join(vendor, prefix);
      if (existsSync(local) && under(vendor, local)) return route.fulfill({ status: 200, body: readFileSync(local), contentType: prefix.endsWith('.js') ? 'application/javascript' : 'application/octet-stream' });
      return offline ? route.fulfill({ status: 404, body: 'Not found in vendored Three.js' }) : route.continue();
    });
  } else if (offline) await page.route(/^https?:\/\//, route => route.abort());
  await page.route('**/*.html', async route => {
    const response = await route.fetch(); let html = await response.text();
    if (!html.includes('type="importmap"')) {
      const map = '<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"}}</script>';
      html = html.replace(/<head([^>]*)>/i, `<head$1>${map}`);
    }
    await route.fulfill({ response, body: html, headers: { ...response.headers(), 'content-type': 'text/html; charset=utf-8' } });
  });
  return hasVendor;
}

async function json(path, fallback = null) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

function expressionOf(check) {
  if (typeof check === 'string') return check;
  if (!check || typeof check !== 'object') return 'false';
  return check.expr ?? check.expression ?? check.check ?? check.condition ?? 'false';
}

async function evalExpression(page, check, before = null, after = null) {
  const expr = expressionOf(check);
  try {
    return !!(await page.evaluate(({ expr: e, before: b, after: a }) => {
      try { const before = b; const after = a; return eval(e); } catch { return false; }
    }, { expr, before, after }));
  } catch { return false; }
}

function stateConditionsOf(state) {
  const values = [];
  if (state?.condition) values.push(state.condition);
  if (Array.isArray(state?.conditions)) values.push(...state.conditions);
  if (Array.isArray(state?.checks)) values.push(...state.checks);
  return values.filter(Boolean);
}

async function stateReached(page, state) {
  const conditions = stateConditionsOf(state);
  if (!conditions.length) return false;
  for (const condition of conditions) if (!await evalExpression(page, condition)) return false;
  return true;
}

async function runAction(page, action) {
  // Keep the CLI's historical post-script settling delay while sharing all
  // selector, coordinate, keyboard, and chaining compatibility logic with
  // the reusable StateProbe runner.
  return executeAction(page, action, { defaultScriptWaitMs: 500 });
}

function verifierDelay(verifier, phase) {
  if (!verifier || typeof verifier !== 'object') return 0;
  const values = phase === 'before'
    ? [verifier.wait_before_ms, verifier.before_wait_ms]
    : [verifier.pre_wait_ms, verifier.wait_ms, verifier.delay_ms, verifier.post_wait_ms,
      verifier.wait_after_ms, verifier.timeout_ms];
  const value = values.find(item => item !== undefined && Number.isFinite(Number(item)));
  return value === undefined ? 0 : actionDuration({ duration_ms: Number(value) }, 0);
}

async function runSetupScript(page, setup) {
  if (!setup) return true;
  if (Array.isArray(setup)) {
    let ok = true;
    for (const item of setup) ok = await runSetupScript(page, item) && ok;
    return ok;
  }
  if (typeof setup === 'object') { await runAction(page, setup); return true; }
  try { await page.evaluate(String(setup)); return true; } catch { return false; }
}

function verifierPreChecks(verifier) {
  if (!verifier || typeof verifier !== 'object') return [];
  const values = verifier.pre_checks ?? verifier.preChecks ?? verifier.pre_check ?? [];
  return Array.isArray(values) ? values.filter(Boolean) : (values ? [values] : []);
}

async function evaluateTask({ root, split, taskName, htmlName, htmlPath = null, offline, show }) {
  const taskDir = join(root, 'data', 'tasks', split, taskName);
  const contract = await json(join(taskDir, 'icg.json'));
  if (!contract) return { task_id: taskName, mode: 'BAD_CONTRACT', tCov: 0, vCov: 0, aCov: 0, sCov: 0, vCovStats: { ...zeroAssertionCoverage(null), policy: 'unweighted_assertion_ratio' } };
  const zeroVerification = zeroAssertionCoverage(contract);
  const zeroMetrics = { tCov: 0, vCov: 0, aCov: 0, sCov: 0, vCovStats: { ...zeroVerification, policy: 'unweighted_assertion_ratio' } };
  const html = htmlName || (htmlPath ? basename(htmlPath) : null) || 'input.html';
  const packagedHtml = join(taskDir, html);
  if (!htmlPath && !existsSync(packagedHtml)) return { task_id: taskName, html, mode: 'NO_HTML', message: 'No model HTML is packaged; pass --html-path.', ...zeroMetrics };
  if (htmlPath && !existsSync(htmlPath)) return { task_id: taskName, html, mode: 'NO_HTML', message: `Input HTML not found: ${htmlPath}`, ...zeroMetrics };
  const htmlRoute = `/tasks/${split}/${encodeURIComponent(taskName)}/${encodeURIComponent(html)}`;
  const { server, port } = await startServer(root, split, { htmlRoute, htmlOverride: htmlPath });
  let browser = null;
  let context = null;
  let page = null;
  const consoleErrors = [];
  const report = { task_id: taskName, html, split, timestamp: new Date().toISOString(), mode: 'CHECK_FAIL', consoleErrors, passed: 0, total: contract.transitions?.length || 0, checks: [], affordanceStats: null, stateStats: null, ...zeroMetrics };
  try {
    browser = await chromium.launch({ headless: !show, executablePath: browserPath() || undefined, args: ['--no-sandbox', '--disable-gpu-sandbox', '--enable-webgl', '--ignore-gpu-blocklist'] });
    context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', e => consoleErrors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    await installImportMap(page, offline);
    const url = `http://127.0.0.1:${port}${htmlRoute}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {}); await page.waitForTimeout(1500);
    const probe = await page.evaluate(() => typeof window.__3D_STATE__ === 'object' && window.__3D_STATE__ !== null).catch(() => false);
    if (!probe) {
      // The paper's public runtime contract is window.__3D_STATE__.  Do not
      // classify unrelated legacy identifiers as a valid probe interface.
      const sourceHasProbe = await page.evaluate(() =>
        [...document.scripts].some(s => s.textContent.includes('__3D_STATE__'))
      ).catch(() => false);
      report.mode = sourceHasProbe ? 'RUNTIME_CRASH' : 'CHECK_FAIL';
      if (!sourceHasProbe) report.diagnostic = 'PROBE_MISSING';
      return report;
    }
    const affordances = contract.affordances || []; let aPass = 0; const aResults = [];
    for (const a of affordances) { const checks = a.checks ?? (a.check || a.condition ? [a.check ?? a.condition] : []); const ok = checks.length ? (await Promise.all(checks.map(c => evalExpression(page, c)))).every(Boolean) : true; if (ok) aPass++; aResults.push({ id: a.id, pass: ok }); }
    report.affordanceStats = { pass: aPass, total: affordances.length, results: aResults };
    const states = (contract.states || []).filter(s => s.id !== 'S_stable_60s'); const reached = new Set();
    const sampleStates = async () => { for (const s of states) if (!reached.has(s.id) && await stateReached(page, s)) reached.add(s.id); };
    await sampleStates();
    const tier = { L0: { pass: 0, total: 0 }, L1: { pass: 0, total: 0 }, L2: { pass: 0, total: 0 } };
    for (const transition of contract.transitions || []) {
      // Historical records may put setup interactions on the transition
      // itself. They belong before the before-snapshot and are not verifier
      // assertions in their own right.
      if (transition.pre_action) await runAction(page, transition.pre_action);
      if (transition.pre_actions) await runAction(page, transition.pre_actions);
      const verifier = transition.verifier || transition.verification || transition.verify || {};
      if (verifier.pre_action) await runAction(page, verifier.pre_action);
      if (verifier.pre_actions) await runAction(page, verifier.pre_actions);
      const setup = verifier.setup_script ?? verifier.setup;
      const setupOk = !setup || await runSetupScript(page, setup);
      const beforeWait = verifierDelay(verifier, 'before');
      if (beforeWait) await page.waitForTimeout(beforeWait);
      const before = await page.evaluate(() => JSON.parse(JSON.stringify(window.__3D_STATE__))).catch(() => ({}));
      const preChecks = verifierPreChecks(verifier);
      const preCheckResults = [];
      for (const check of preChecks) preCheckResults.push({ expr: expressionOf(check), pass: await evalExpression(page, check, before) });
      await runAction(page, transition.action);
      if (transition.post_actions) await runAction(page, transition.post_actions);
      if (verifier.post_actions) await runAction(page, verifier.post_actions);
      const afterWait = verifierDelay(verifier, 'after');
      if (afterWait) await page.waitForTimeout(afterWait);
      const after = await page.evaluate(() => JSON.parse(JSON.stringify(window.__3D_STATE__))).catch(() => ({}));
      const checks = assertionsOfTransition(transition); let all = checks.length > 0; const row = { id: transition.id, checks: [] };
      for (const c of checks) { const label = c?.tier || c?.level; const t = CHECK_TIERS.has(label) ? label : 'L2'; const ok = await evalExpression(page, c, before, after); tier[t].total++; if (ok) tier[t].pass++; else all = false; row.checks.push({ expr: expressionOf(c), tier: t, pass: ok }); }
      if (preChecks.length || !setupOk) {
        row.preChecks = preCheckResults;
        if (preCheckResults.some(check => !check.pass) || !setupOk) all = false;
      }
      if (all) report.passed++; report.checks.push(row); await sampleStates();
    }
    const flat = report.total ? report.passed / report.total * 100 : 0;
    const verification = assertionCoverage(report.checks.flatMap(row => row.checks));
    report.tCov = +flat.toFixed(1); report.vCov = +verification.percent.toFixed(1); report.aCov = +(affordances.length ? aPass / affordances.length * 100 : 100).toFixed(1); report.sCov = +(states.length ? reached.size / states.length * 100 : 100).toFixed(1); report.vCovStats = { passed: verification.passed, total: verification.total, policy: 'unweighted_assertion_ratio' }; report.tierStats = tier; report.stateStats = { reached: reached.size, total: states.length };
    report.mode = verification.total > 0 && verification.passed === verification.total
      && report.passed === report.total ? 'CHECK_PASS' : 'CHECK_FAIL';
  } catch (error) { report.mode = 'RUNTIME_CRASH'; report.diagnostic = 'EVALUATION_EXCEPTION'; report.error = error.message; }
  finally { await context?.close().catch(() => {}); await browser?.close().catch(() => {}); server.close(); }
  return report;
}

async function taskNames(root, split) {
  const dir = join(root, 'data', 'tasks', split);
  return (await readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory() && e.name.startsWith('P')).map(e => e.name).filter(n => existsSync(join(dir, n, 'task.json')) && existsSync(join(dir, n, 'icg.json'))).sort((a, b) => (Number(a.match(/^P(\d+)/)?.[1] || 0) - Number(b.match(/^P(\d+)/)?.[1] || 0)) || a.localeCompare(b));
}

async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length); let next = 0;
  const worker = async () => { while (true) { const i = next++; if (i >= items.length) return; results[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, worker));
  return results;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.validate) { console.log(JSON.stringify({ root: opts.root, split: opts.split, tasks: (await taskNames(opts.root, opts.split)).length }, null, 2)); return; }
  if (!opts.model && !opts.html && !opts.htmlPath) throw new Error('Provide --model, --html, or --html-path');
  if (opts.html && existsSync(resolve(opts.html))) opts.htmlPath = resolve(opts.html);
  if (opts.htmlPath && !opts.task) throw new Error('--html-path requires --task (one external HTML per task)');
  let names = opts.task ? [opts.task] : await taskNames(opts.root, opts.split);
  if (opts.start) { const index = names.findIndex(n => n.startsWith(opts.start)); names = index < 0 ? [] : names.slice(index); }
  if (opts.limit > 0) names = names.slice(0, opts.limit);
  if (opts.htmlPath && names.length !== 1) throw new Error('--html-path can evaluate exactly one task');
  const htmlName = opts.htmlPath ? basename(opts.htmlPath) : (opts.html || (opts.model ? `llm_${opts.model}.html` : null));
  const outputs = await mapConcurrent(names, opts.concurrency, async task => {
    const out = opts.output && names.length === 1
      ? resolve(opts.output)
      : join(tmpdir(), 'worldcoder-results', opts.split, opts.model || 'custom', `${task}.json`);
    if (opts.resume && existsSync(out)) return JSON.parse(await readFile(out, 'utf8'));
    const result = await evaluateTask({ root: opts.root, split: opts.split, taskName: task, htmlName, htmlPath: opts.htmlPath, offline: opts.offline, show: opts.show });
    await mkdir(dirname(out), { recursive: true }); await writeFile(out, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`${task}\t${result.mode}\tT=${result.tCov ?? 0}%\tV=${result.vCov ?? 0}%\tA=${result.aCov ?? 0}%\tS=${result.sCov ?? 0}%`);
    return result;
  });
  if (names.length > 1) { const summary = { split: opts.split, model: opts.model, tasks: outputs.length, meanTCov: outputs.length ? +(outputs.reduce((s, x) => s + (x.tCov || 0), 0) / outputs.length).toFixed(1) : 0, meanVCov: outputs.length ? +(outputs.reduce((s, x) => s + (x.vCov || 0), 0) / outputs.length).toFixed(1) : 0, modes: Object.fromEntries([...new Set(outputs.map(x => x.mode))].map(m => [m, outputs.filter(x => x.mode === m).length])) }; const path = join(tmpdir(), 'worldcoder-results', opts.split, opts.model || 'custom', 'summary.json'); await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(summary, null, 2)}\n`); console.log(JSON.stringify(summary, null, 2)); }
}

main().catch(error => { console.error(`ERROR: ${error.message}`); process.exit(1); });

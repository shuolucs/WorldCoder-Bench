/**
 * Pipeline Runner — orchestrates the full evaluation flow:
 *   Stage 1: Sandbox Build & Run
 *   Stage 2: StateProbe Verification
 *   Stage 3: Verification-Coverage Audit
 *   Stage 4: Report Generation
 */

import { readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { Sandbox } from './sandbox.mjs';
import { StateProbeProtocol } from './probe.mjs';
import { runL0Checks, runL2Checks } from './checkers.mjs';
import { actionDuration, executeAction } from './actions.mjs';
import { assertionCoverage, assertionsOfTransition, zeroAssertionCoverage } from '../evaluator/metrics.mjs';

function verifierDelay(verifier, phase) {
  if (!verifier || typeof verifier !== 'object') return 0;
  const values = phase === 'before'
    ? [verifier.wait_before_ms, verifier.before_wait_ms]
    : [verifier.pre_wait_ms, verifier.wait_ms, verifier.delay_ms, verifier.post_wait_ms,
      verifier.wait_after_ms, verifier.timeout_ms];
  const value = values.find(item => item !== undefined && Number.isFinite(Number(item)));
  return value === undefined ? 0 : actionDuration({ duration_ms: Number(value) }, 0);
}

function verifierPreChecks(verifier) {
  if (!verifier || typeof verifier !== 'object') return [];
  const values = verifier.pre_checks ?? verifier.preChecks ?? verifier.pre_check ?? [];
  return Array.isArray(values) ? values.filter(Boolean) : (values ? [values] : []);
}

function expressionOf(check) {
  if (typeof check === 'string') return check;
  return check?.expr ?? check?.expression ?? check?.check ?? check?.condition ?? 'false';
}

async function runSetupScript(page, setup) {
  if (!setup) return true;
  if (Array.isArray(setup)) {
    let ok = true;
    for (const item of setup) ok = await runSetupScript(page, item) && ok;
    return ok;
  }
  if (typeof setup === 'object') { await executeAction(page, setup); return true; }
  try { await page.evaluate(String(setup)); return true; } catch { return false; }
}

export async function runEvaluation(opts) {
  const taskDir = resolve(opts.taskDir);
  const htmlFile = opts.htmlFile || 'ground_truth.html';
  const quiet = opts.quiet || false;

  const contract = JSON.parse(await readFile(join(taskDir, 'icg.json'), 'utf-8'));
  const task = JSON.parse(await readFile(join(taskDir, 'task.json'), 'utf-8'));

  if (!quiet) {
    console.log(`\n[WorldCoder-Bench / StateProbe] ${task.id} — ${task.title}`);
    console.log(`  File: ${htmlFile} | Difficulty: ${task.difficulty}`);
  }

  // ── Stage 1: Sandbox ──
  // A task directory is four levels below the release root. Deriving the
  // root here keeps shared assets available when library callers omit the
  // optional releaseRoot argument.
  const releaseRoot = opts.releaseRoot ? resolve(opts.releaseRoot) : resolve(taskDir, '../../../..');
  const sandbox = new Sandbox({ taskDir, releaseRoot, htmlFile, htmlPath: opts.htmlPath, headless: opts.headless !== false });
  let page, consoleErrors;
  try {
    ({ page, consoleErrors } = await sandbox.launch());
  } catch (e) {
    await sandbox.teardown();
    return _crashReport(task, htmlFile, contract, `Page load failed: ${e.message}`);
  }

  const probe = new StateProbeProtocol(page);

  // ── Stage 2a: L0 Universal Checks ──
  const l0Results = await runL0Checks(page);

  // ── Stage 2b: Probe Detection ──
  const probeStatus = await probe.detect();

  const report = {
    timestamp: new Date().toISOString(),
    task_id: task.id,
    html_file: htmlFile,
    l0_checks: l0Results,
    affordances: [],
    transitions: [],
    coverage: {},
    errors: [],
    console_errors: consoleErrors,
  };

  if (!probeStatus.available) {
    report.failure_mode = probeStatus.failureMode === 'RUNTIME_CRASH' ? 'RUNTIME_CRASH' : 'CHECK_FAIL';
    report.diagnostic = probeStatus.failureMode;
    report.errors.push(
      probeStatus.failureMode === 'RUNTIME_CRASH'
        ? 'Source contains __3D_STATE__ but JS crashed before execution.'
        : 'Source does not contain __3D_STATE__ assignment.'
    );
    report.coverage = _zeroCoverage(contract);
    await sandbox.teardown();
    return report;
  }

  // ── Stage 2c: Affordance Check ──
  for (const aff of (contract.affordances || [])) {
    let found = false;
    if (aff.type === 'dom_element') {
      for (const hint of (aff.locator_hints || [])) {
        const count = await page.locator(`#${hint}, .${hint}, [data-${hint}]`).count().catch(() => 0);
        const textCount = await page.getByText(hint, { exact: false }).count().catch(() => 0);
        if (count > 0 || textCount > 0) { found = true; break; }
      }
    } else {
      found = true; // 3d_object / interaction verified via transitions
    }
    report.affordances.push({ id: aff.id, name: aff.name, found });
  }

  // ── Stage 2d: Transition Verification ──
  for (const t of contract.transitions) {
    const result = { id: t.id, severity: t.severity, status: 'BLOCKED', checks: [] };
    try {
      if (t.pre_action) await executeAction(page, t.pre_action);
      if (t.pre_actions) await executeAction(page, t.pre_actions);
      const verifier = t.verifier || t.verification || t.verify || {};
      if (verifier.pre_action) await executeAction(page, verifier.pre_action);
      if (verifier.pre_actions) await executeAction(page, verifier.pre_actions);
      const setupOk = await runSetupScript(page, verifier.setup_script ?? verifier.setup);
      const beforeWait = verifierDelay(verifier, 'before');
      if (beforeWait) await page.waitForTimeout(beforeWait);
      const stateBefore = await probe.snapshot();
      result.pre_checks = [];
      for (const check of verifierPreChecks(verifier)) {
        result.pre_checks.push(await probe.evalCheck(expressionOf(check), stateBefore, stateBefore));
      }
      await executeAction(page, t.action);
      if (t.post_actions) await executeAction(page, t.post_actions);
      if (verifier.post_actions) await executeAction(page, verifier.post_actions);
      const afterWait = verifierDelay(verifier, 'after');
      if (afterWait) await page.waitForTimeout(afterWait);
      const stateAfter = await probe.snapshot();

      const checks = await runL2Checks(probe, t, stateBefore, stateAfter);
      result.checks = checks;

      const allPassed = setupOk && checks.length > 0 && checks.every(c => c.passed)
        && (result.pre_checks || []).every(c => c.passed);
      result.status = checks.length === 0 ? 'NO_VERIFIER' : (allPassed ? 'PASS' : 'FAIL');
    } catch (e) {
      result.status = 'ERROR';
      result.checks = assertionsOfTransition(t).map(check => ({
        expression: typeof check === 'string' ? check : (check?.expr ?? check?.expression ?? check?.check ?? check?.condition ?? 'false'),
        passed: false,
        detail: `Execution error: ${e.message}`,
      }));
    }
    report.transitions.push(result);
  }

  // ── Stage 3: Verification Coverage ──
  const aFound = report.affordances.filter(a => a.found).length;
  const aTotal = report.affordances.length;

  const reachedStates = new Set(['S0']);
  for (const t of report.transitions) {
    if (t.status === 'PASS') {
      const def = contract.transitions.find(it => it.id === t.id);
      if (def?.to) reachedStates.add(def.to);
    }
  }

  const tPassed = report.transitions.filter(t => t.status === 'PASS').length;
  const tTotal = report.transitions.length;
  const checks = report.transitions.flatMap(t => t.checks || []);
  const verification = assertionCoverage(checks);

  report.coverage = {
    aCov: { found: aFound, total: aTotal, percent: (aTotal > 0 ? aFound/aTotal*100 : 0).toFixed(1) },
    sCov: { reached: reachedStates.size, total: (contract.states || []).length, percent: ((contract.states || []).length > 0 ? reachedStates.size/contract.states.length*100 : 0).toFixed(1) },
    tCov: { passed: tPassed, total: tTotal, percent: (tTotal > 0 ? tPassed/tTotal*100 : 0).toFixed(1) },
    vCov: { passed: verification.passed, total: verification.total, percent: verification.percent.toFixed(1), policy: 'unweighted_assertion_ratio' },
  };
  report.failure_mode = verification.total > 0 && verification.passed === verification.total
    && tPassed === tTotal
    ? 'CHECK_PASS'
    : 'CHECK_FAIL';

  if (!quiet) {
    console.log(`  V-Cov=${report.coverage.vCov.percent}%  A-Cov=${report.coverage.aCov.percent}%  S-Cov=${report.coverage.sCov.percent}%  T-Cov=${report.coverage.tCov.percent}%`);
  }

  await sandbox.teardown();
  return report;
}

/**
 * Save report JSON to the task directory.
 */
export async function saveReport(report, taskDir) {
  const name = report.html_file.replace(/[\/\\]/g, '_').replace('.html', '');
  const path = join(resolve(taskDir), `report_${name}.json`);
  await writeFile(path, JSON.stringify(report, null, 2));
  return path;
}

function _zeroCoverage(contract) {
  const verification = zeroAssertionCoverage(contract);
  return {
    aCov: { found: 0, total: (contract.affordances || []).length, percent: '0.0' },
    sCov: { reached: 0, total: (contract.states || []).length, percent: '0.0' },
    tCov: { passed: 0, total: (contract.transitions || []).length, percent: '0.0' },
    vCov: { passed: 0, total: verification.total, percent: '0.0', policy: 'unweighted_assertion_ratio' },
  };
}

function _crashReport(task, htmlFile, contract, error) {
  return {
    timestamp: new Date().toISOString(),
    task_id: task.id,
    html_file: htmlFile,
    l0_checks: [],
    affordances: [],
    transitions: [],
    coverage: _zeroCoverage(contract),
    errors: [error],
    failure_mode: 'RUNTIME_CRASH',
    diagnostic: 'SANDBOX_FAILURE',
    console_errors: [],
  };
}

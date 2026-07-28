/**
 * Action executor for behavioral-contract transitions.
 *
 * Contracts in the source archives use a few equivalent spellings for
 * coordinates, DOM locators, waits, and keyboard events.  This module keeps
 * those spellings executable in both the pipeline runner and the CLI.
 */

const MAX_WAIT_MS = 15_000;
const DEFAULT_ACTION_WAIT_MS = 300;

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boundedWait(value, fallback = 0, maximum = MAX_WAIT_MS) {
  const number = finiteNumber(value, fallback);
  return Math.max(0, Math.min(maximum, number ?? fallback));
}

/** Return a bounded duration from the common historical duration spellings. */
export function actionDuration(action, fallback = 0, maximum = MAX_WAIT_MS) {
  const value = action?.duration_ms ?? action?.wait_ms ?? action?.duration
    ?? action?.delay_ms ?? action?.delay ?? action?.timeout_ms
    ?? action?.post_wait_ms ?? action?.wait_after_ms ?? action?.wait_after;
  return boundedWait(value, fallback, maximum);
}

function list(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function browserKey(value) {
  const key = String(value);
  const aliases = {
    ' ': 'Space', spacebar: 'Space', esc: 'Escape', ctrl: 'Control', control: 'Control',
    cmd: 'Meta', command: 'Meta', win: 'Meta', option: 'Alt', return: 'Enter',
    del: 'Delete', left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown',
  };
  return aliases[key.toLowerCase()] || key;
}

function isCssSelector(value) {
  if (typeof value !== 'string') return false;
  const selector = value.trim();
  return /^(?:[#.\[]|(?:canvas|button|input|select|textarea|option|video|audio|svg|div|form|main|body|html|label|a)(?:[.#:[\s]|$)|\*)/i.test(selector);
}

function textValue(action) {
  const value = action.text_content ?? action.textContent ?? action.text_match ?? action.match_text
    ?? action.text_content_match ?? action.text_contains ?? action.content_match
    ?? action.text_hint ?? action.text ?? action.match ?? null;
  if (typeof value !== 'string') return value;
  // A few archived records used a DOM predicate such as
  // `textContent.includes('Play')` instead of the literal button label.
  // Extracting the literal keeps the action deterministic without evaluating
  // arbitrary selector code.
  const predicate = value.match(/(?:textContent|innerText|text)\s*\.\s*includes\(\s*["']([^"']+)["']\s*\)/i);
  return predicate ? predicate[1] : value;
}

function exactText(action) {
  return action.exact_match === true || action.exact === true;
}

function withText(locator, action) {
  const text = textValue(action);
  if (text === null || text === undefined) return locator;
  if (action.match_regex) {
    try {
      const pattern = action.match_regex === true ? String(text) : action.match_regex;
      return locator.filter({ hasText: new RegExp(pattern) });
    } catch { return locator; }
  }
  return locator.filter({ hasText: exactText(action) ? new RegExp(`^${String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) : String(text) });
}

function indexed(locator, action) {
  const index = finiteNumber(action.index ?? action.selectorIndex ?? action.index_hint, null);
  return index === null ? locator : locator.nth(Math.max(0, index));
}

function locatorCandidates(action) {
  const values = [action.selector, action.locator, action.selector_hint, action.selectorHint,
    action.target_hint,
    isCssSelector(action.target) ? action.target : null,
    isCssSelector(action.fallback) ? action.fallback : null,
    isCssSelector(action.fallback_selector) ? action.fallback_selector : null];
  if (typeof action.target === 'string' && /^[A-Za-z][A-Za-z0-9_:-]*$/.test(action.target)) {
    // Plain identifiers in the archive generally refer to an element id.
    values.push(`#${action.target}`, `[data-testid="${action.target}"]`);
  }
  for (const fallback of list(action.fallback_selectors)) values.push(fallback);
  return [...new Set(values.filter(value => typeof value === 'string' && value.trim()))];
}

async function findDomLocator(page, action) {
  const candidates = locatorCandidates(action);
  for (const candidate of candidates) {
    try {
      const locator = indexed(withText(page.locator(candidate), action), action);
      if (await locator.count()) return locator;
    } catch { /* try the next representation */ }
  }

  const text = textValue(action);
  const targetText = text ?? (!isCssSelector(action.target) ? action.target : null);
  if (targetText !== null && targetText !== undefined) {
    try {
      const locator = page.getByText(String(targetText), { exact: exactText(action) });
      if (await locator.count()) return indexed(locator, action);
    } catch { /* no text match */ }
  }
  return null;
}

async function clickDom(page, action) {
  const locator = await findDomLocator(page, action);
  if (locator) {
    const clickOptions = {
      timeout: boundedWait(action.timeout_ms, 3_000, 30_000),
      button: action.button || 'left',
      clickCount: Math.max(1, Math.floor(finiteNumber(action.count ?? action.repeat, 1))),
    };
    const offset = action.offset ?? action.click_offset ?? action.position_offset;
    if (offset && typeof offset === 'object') {
      const x = finiteNumber(offset.x ?? offset.left, null);
      const y = finiteNumber(offset.y ?? offset.top, null);
      if (x !== null && y !== null) clickOptions.position = { x, y };
    }
    await locator.click(clickOptions).catch(() => {});
    return true;
  }
  if (action.fallback_action) {
    await executeAction(page, action.fallback_action);
    return true;
  }
  if (action.fallback_script) {
    await page.evaluate(action.fallback_script).catch(() => {});
    return true;
  }
  return false;
}

async function inputDom(page, action) {
  const locator = await findDomLocator(page, action);
  if (!locator) return false;
  const value = String(action.value ?? '');
  try {
    const tagName = await locator.evaluate(element => element.tagName.toLowerCase());
    if (tagName === 'select') await locator.selectOption(value);
    else {
      const type = await locator.getAttribute('type');
      if (type === 'checkbox' || type === 'radio') {
        if (action.value === true || action.value === 'true' || action.checked === true) await locator.check();
        else if (action.value === false || action.value === 'false' || action.checked === false) await locator.uncheck();
        else await locator.click();
      } else await locator.fill(value, { timeout: boundedWait(action.timeout_ms, 3_000, 30_000) });
    }
    await locator.dispatchEvent('input').catch(() => {});
    await locator.dispatchEvent('change').catch(() => {});
  } catch { /* preserve the evaluator's fail-soft action semantics */ }
  return true;
}

function pointOf(action, name, fallback) {
  const source = action[name] || fallback;
  if (!source || typeof source !== 'object') return { x: 0.5, y: 0.5, normalized: true };
  const x = finiteNumber(source.x ?? source.left, 0.5);
  const y = finiteNumber(source.y ?? source.top, 0.5);
  const explicitNormalized = source.normalized === true || action.coordinates_normalized === true;
  const ratioFields = name === 'position' && (action.x_ratio !== undefined || action.y_ratio !== undefined);
  const ratioX = name === 'position' && action.x_ratio !== undefined ? finiteNumber(action.x_ratio, x) : x;
  const ratioY = name === 'position' && action.y_ratio !== undefined ? finiteNumber(action.y_ratio, y) : y;
  const normalized = explicitNormalized || ratioFields || (Math.abs(ratioX) <= 1 && Math.abs(ratioY) <= 1);
  return { x: normalized ? ratioX : x, y: normalized ? ratioY : y, normalized };
}

async function canvasLocator(page, action) {
  const selector = action.canvas_selector || (isCssSelector(action.target) && action.target !== 'canvas' ? action.target : 'canvas');
  try { return page.locator(selector).first(); } catch { return null; }
}

async function clickCanvas(page, action) {
  const locator = await canvasLocator(page, action);
  const box = await locator?.boundingBox().catch(() => null);
  if (!box) return false;
  let point;
  if (action.x !== undefined || action.y !== undefined) {
    point = pointOf({ ...action, position: { x: action.x, y: action.y } }, 'position', { x: 0.5, y: 0.5 });
  } else if (action.x_ratio !== undefined || action.y_ratio !== undefined) {
    point = { x: finiteNumber(action.x_ratio, 0.5), y: finiteNumber(action.y_ratio, 0.5), normalized: true };
  } else if (Array.isArray(action.coordinates_normalized)) {
    point = { x: finiteNumber(action.coordinates_normalized[0], 0.5), y: finiteNumber(action.coordinates_normalized[1], 0.5), normalized: true };
  } else {
    point = pointOf(action, 'position', action.coordinates || action.position_hint || { x: 0.5, y: 0.5 });
  }
  const x = point.normalized ? box.x + box.width * Math.max(0, Math.min(1, point.x)) : box.x + Math.max(0, Math.min(box.width, point.x));
  const y = point.normalized ? box.y + box.height * Math.max(0, Math.min(1, point.y)) : box.y + Math.max(0, Math.min(box.height, point.y));
  await page.mouse.click(x, y, { button: action.button || 'left', clickCount: Math.max(1, Math.floor(finiteNumber(action.count ?? action.repeat, 1))) });
  return true;
}

async function drag(page, action) {
  const selector = action.canvas_selector || (isCssSelector(action.target) ? action.target : 'canvas');
  const locator = page.locator(selector).first();
  const box = await locator.boundingBox().catch(() => null);
  if (!box) return false;
  const from = pointOf(action, 'from', { x: 0.5, y: 0.5 });
  const to = pointOf(action, 'to', { x: 0.6, y: 0.4 });
  const coordinate = point => point.normalized
    ? { x: box.x + box.width * Math.max(0, Math.min(1, point.x)), y: box.y + box.height * Math.max(0, Math.min(1, point.y)) }
    : { x: box.x + Math.max(0, Math.min(box.width, point.x)), y: box.y + Math.max(0, Math.min(box.height, point.y)) };
  const start = coordinate(from), end = coordinate(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: action.button || 'left' });
  await page.mouse.move(end.x, end.y, { steps: Math.max(1, finiteNumber(action.steps, 8)) });
  await page.mouse.up({ button: action.button || 'left' });
  return true;
}

async function setKeyState(page, key, value) {
  await page.evaluate(({ key: k, value: v }) => {
    if (window.__keys__) window.__keys__[k] = v;
    if (k === 'Space' && v) window.jumpRequested = true;
  }, { key, value }).catch(() => {});
}

function modifierKeys(action) {
  const modifiers = list(action.modifiers).flatMap(value => String(value).split(/[+,\s]+/)).filter(Boolean);
  if (action.ctrlKey) modifiers.push('Control');
  if (action.shiftKey) modifiers.push('Shift');
  if (action.altKey) modifiers.push('Alt');
  if (action.metaKey || action.cmdKey) modifiers.push('Meta');
  return [...new Set(modifiers.map(browserKey))];
}

async function keyboard(page, action) {
  const keys = list(action.keys).length ? list(action.keys) : [action.key ?? action.code ?? action.fallback_key];
  const normalizedKeys = keys.filter(key => key !== undefined && key !== null).map(browserKey);
  if (!normalizedKeys.length) return false;
  const modifiers = modifierKeys(action);
  const event = String(action.action ?? action.keyAction ?? action.event ?? '').toLowerCase();
  const repetitions = Math.max(1, Math.min(100, finiteNumber(action.repeat ?? action.count, 1)));
  const delay = boundedWait(action.delay_ms ?? action.interval_ms ?? action.delay, 0, 5_000);
  const hold = boundedWait(action.hold_ms ?? action.duration_ms ?? action.duration, normalizedKeys.length > 1 ? 300 : 200, 15_000);

  if (event === 'keyup' || event === 'up' || event === 'release') {
    for (const key of normalizedKeys) { await page.keyboard.up(key).catch(() => {}); await setKeyState(page, key, false); }
    return true;
  }
  if (event === 'keydown' || event === 'down') {
    for (const key of modifiers) await page.keyboard.down(key).catch(() => {});
    for (const key of normalizedKeys) { await page.keyboard.down(key).catch(() => {}); await setKeyState(page, key, true); }
    return true;
  }

  for (let repetition = 0; repetition < repetitions; repetition++) {
    for (const key of modifiers) await page.keyboard.down(key).catch(() => {});
    if (event === 'press' || event === 'tap') {
      for (const key of normalizedKeys) await page.keyboard.press(key).catch(() => {});
    } else {
      for (const key of normalizedKeys) { await page.keyboard.down(key).catch(() => {}); await setKeyState(page, key, true); }
      await page.waitForTimeout(hold);
      for (const key of [...normalizedKeys].reverse()) { await page.keyboard.up(key).catch(() => {}); await setKeyState(page, key, false); }
    }
    for (const key of [...modifiers].reverse()) await page.keyboard.up(key).catch(() => {});
    if (repetition + 1 < repetitions && delay) await page.waitForTimeout(delay);
  }
  return true;
}

function explicitPostDelay(action) {
  const common = action.wait_after_ms ?? action.afterWait_ms ?? action.wait_after
    ?? action.delay_after_ms ?? action.delay_after ?? action.post_wait_ms
    ?? action.post_wait ?? action.then_wait_ms ?? action.fallback_wait_ms;
  if (common !== undefined) return common;
  // Bare `delay` is a post-script delay in the archive, while keyboard delay
  // is the interval between repeated key events.  Other action types use it
  // as a post-action settling delay.
  if (action.type !== 'keyboard' && action.type !== 'key' && action.type !== 'keyboard_combo') {
    return action.delay_ms ?? action.delay;
  }
  return action.delay_ms === undefined && action.interval_ms === undefined ? undefined : undefined;
}

async function runPostDelay(page, action, options) {
  const delay = explicitPostDelay(action);
  const delayIsWaitDuration = action.type === 'wait'
    && action.duration_ms === undefined && action.wait_ms === undefined
    && action.duration === undefined && action.timeout_ms === undefined
    && (action.delay_ms !== undefined || action.delay !== undefined);
  if (delayIsWaitDuration) return;
  if (delay !== undefined) {
    await page.waitForTimeout(boundedWait(delay, 0));
    return;
  }
  if (['dom_click', 'click_dom', 'dom_input', 'click', 'click_canvas', 'drag'].includes(action.type)) {
    await page.waitForTimeout(boundedWait(options.defaultActionWaitMs, DEFAULT_ACTION_WAIT_MS, 5_000));
  }
}

/** Execute one action or a nested action sequence. */
export async function executeAction(page, action, options = {}) {
  if (!action) return;
  if (Array.isArray(action)) { for (const sub of action) await executeAction(page, sub, options); return; }

  if (action.pre_actions) for (const sub of list(action.pre_actions)) await executeAction(page, sub, options);
  if (action.pre_eval) {
    await page.evaluate(action.pre_eval).catch(() => {});
    if (action.pre_eval_wait_ms) await page.waitForTimeout(boundedWait(action.pre_eval_wait_ms, 0));
  }
  const beforeDelay = action.delay_before_ms ?? action.delay_before;
  if (beforeDelay !== undefined) await page.waitForTimeout(boundedWait(beforeDelay, 0));

  const type = action.type;
  let chained = false;
  if (type === 'wait') {
    await page.waitForTimeout(actionDuration(action, 1_000));
  } else if (type === 'eval' || type === 'script') {
    await page.evaluate(action.code || '').catch(async () => {
      if (action.fallback_script) await page.evaluate(action.fallback_script).catch(() => {});
    });
    const scriptWait = action.wait_ms ?? (explicitPostDelay(action) === undefined ? options.defaultScriptWaitMs : undefined);
    if (scriptWait !== undefined) await page.waitForTimeout(boundedWait(scriptWait, 0, 5_000));
  } else if (type === 'dom_click') {
    await clickDom(page, action);
  } else if (type === 'click_dom') {
    await clickDom(page, action);
  } else if (type === 'dom_input') {
    await inputDom(page, action);
  } else if (type === 'click' && (action.selector || action.locator || action.text || action.text_match
    || action.match_text || action.text_content || action.text_content_match
    || (action.target && action.target !== 'canvas' && isCssSelector(action.target)))) {
    await clickDom(page, action);
  } else if (type === 'click' || type === 'click_canvas') {
    await clickCanvas(page, action);
  } else if (type === 'drag') {
    await drag(page, action);
  } else if (type === 'keyboard' || type === 'key' || type === 'keyboard_combo') {
    await keyboard(page, action);
  } else if (type === 'multi_action') {
    for (const sub of list(action.actions)) await executeAction(page, sub, options);
  } else if (type === 'wait_then_act') {
    await page.waitForTimeout(actionDuration(action, 500));
    await executeAction(page, action.then ?? action.next, options);
    chained = true;
  } else if (action.fallback_action) {
    await executeAction(page, action.fallback_action, options);
  }

  if (!chained && (action.then || action.next)) {
    if (action.then_wait_ms !== undefined) await page.waitForTimeout(boundedWait(action.then_wait_ms, 0));
    await executeAction(page, action.then ?? action.next, options);
  }
  for (const sub of list(action.post_actions)) await executeAction(page, sub, options);
  await runPostDelay(page, action, options);
}

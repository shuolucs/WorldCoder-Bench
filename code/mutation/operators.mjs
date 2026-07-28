/**
 * Deterministic source-level mutation helpers for checker calibration.
 *
 * Task authors supply exact source spans because reliable mutation targets are
 * task-specific. The helper fails closed when a span occurs an unexpected
 * number of times, preventing a silently malformed calibration case.
 */

export const MUTATION_OPERATORS = Object.freeze({
  M1: Object.freeze({ id: 'M1', name: 'Event Disconnect', effect: 'Remove key event listeners' }),
  M2: Object.freeze({ id: 'M2', name: 'State Sync Break', effect: 'Update engine state but skip HUD refresh' }),
  M3: Object.freeze({ id: 'M3', name: 'Physics Param Error', effect: 'Alter a physical constant' }),
  M4: Object.freeze({ id: 'M4', name: 'Probe Deletion', effect: 'Remove the window.__3D_STATE__ update' }),
  M5: Object.freeze({ id: 'M5', name: 'Init Error', effect: 'Use an incorrect initial position or velocity' }),
  M6: Object.freeze({ id: 'M6', name: 'Constraint Violation', effect: 'Violate a physical invariant such as restitution <= 1' }),
});

function exactOccurrences(source, search) {
  let count = 0;
  let offset = 0;
  while (true) {
    const next = source.indexOf(search, offset);
    if (next < 0) return count;
    count += 1;
    offset = next + search.length;
  }
}

function normalizedSpec(spec, index) {
  const operator = String(spec?.operator || spec?.id || '').toUpperCase();
  if (!MUTATION_OPERATORS[operator]) {
    throw new Error(`Mutation ${index + 1}: unknown operator '${operator || '<empty>'}'`);
  }
  if (typeof spec.search !== 'string' || spec.search.length === 0) {
    throw new Error(`Mutation ${index + 1} (${operator}): search must be a non-empty exact source span`);
  }
  const replacement = spec.replacement === undefined ? '' : spec.replacement;
  if (typeof replacement !== 'string') {
    throw new Error(`Mutation ${index + 1} (${operator}): replacement must be a string`);
  }
  const expectedMatches = spec.expected_matches === undefined ? 1 : Number(spec.expected_matches);
  if (!Number.isSafeInteger(expectedMatches) || expectedMatches < 1) {
    throw new Error(`Mutation ${index + 1} (${operator}): expected_matches must be a positive integer`);
  }
  const caseId = String(spec.case_id || `${operator.toLowerCase()}-${index + 1}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(caseId)) {
    throw new Error(`Mutation ${index + 1} (${operator}): case_id must be filename-safe`);
  }
  return { operator, search: spec.search, replacement, expectedMatches, caseId };
}

export function applyMutation(source, spec, index = 0) {
  if (typeof source !== 'string') throw new TypeError('Mutation source must be a string');
  const normalized = normalizedSpec(spec, index);
  const matches = exactOccurrences(source, normalized.search);
  if (matches !== normalized.expectedMatches) {
    throw new Error(
      `Mutation ${normalized.caseId} (${normalized.operator}): expected ` +
      `${normalized.expectedMatches} exact match(es), found ${matches}`,
    );
  }
  const mutatedSource = source.split(normalized.search).join(normalized.replacement);
  if (mutatedSource === source) {
    throw new Error(`Mutation ${normalized.caseId} (${normalized.operator}) did not change the source`);
  }
  return {
    caseId: normalized.caseId,
    operator: normalized.operator,
    operatorName: MUTATION_OPERATORS[normalized.operator].name,
    matches,
    source: mutatedSource,
  };
}

export function applyMutationPlan(source, plan) {
  if (!Array.isArray(plan) || plan.length === 0) {
    throw new Error('Mutation plan must be a non-empty array');
  }
  const seen = new Set();
  return plan.map((spec, index) => {
    const result = applyMutation(source, spec, index);
    if (seen.has(result.caseId)) throw new Error(`Duplicate mutation case_id '${result.caseId}'`);
    seen.add(result.caseId);
    return result;
  });
}

# Metrics and Evaluation Semantics

StateProbe is the paper's execution-based state-verification protocol. It loads a user-supplied HTML program in a controlled browser, observes `window.__3D_STATE__`, executes deterministic actions, and evaluates the task's behavioral-contract checks. The affordance/state/transition portions of a contract are the paper's SIG (Scene Interaction Graph). This release publishes metric definitions and evaluator code, but it does not publish model outputs or claim a complete official leaderboard split.

## Coverage metrics

Let (A_t), (S_t), and (T_t) be the sets of affordance checks, state conditions, and transition checks for task (t). A check passes only when its configured page-context expression evaluates truthfully (and any required action/load gate succeeds).

### Affordance Coverage (A-Cov)

\[
\mathrm{A\text{-}Cov}(t) =
\frac{\#\{a \in A_t : a\ \mathrm{passes}\}}{\#A_t}\times 100.
\]

It diagnoses whether required scene objects, DOM controls, and observable affordances are present. If a task has no affordance checks, the evaluator should report the chosen convention explicitly rather than silently dropping the task.

### State Coverage (S-Cov)

\[
\mathrm{S\text{-}Cov}(t) =
\frac{\#\{s \in S_t : s\ \mathrm{is\ reached}\}}{\#S_t}\times 100.
\]

States are sampled at the initial page and after configured transitions. A descriptive historical state with no executable condition is not evidence of a pass; it should be reported as unsupported or excluded by the evaluator version.

### Transition Coverage (T-Cov)

\[
\mathrm{T\text{-}Cov}(t) =
\frac{\#\{\tau \in T_t : \text{all configured checks for }\tau\ \mathrm{pass}\}}{\#T_t}\times 100.
\]

The evaluator records a before snapshot, performs the action, waits according to the verifier, and evaluates postconditions. A missing or unsupported verifier is not a passing transition.

### Verification Coverage (V-Cov)

V-Cov is the primary aggregate capability metric in the paper: the proportion of configured behavioral assertions that pass. The release evaluator uses the unweighted assertion ratio below. Historical tier labels are retained as diagnostics but do not change an assertion's contribution to V-Cov.

For a simple unweighted assertion set (C_t):

\[
\mathrm{V\text{-}Cov}(t) =
\frac{\#\{c \in C_t : c\ \mathrm{passes}\}}{\#C_t}\times 100.
\]

The release evaluator writes the paper metrics as `aCov`, `sCov`, `tCov`, and
`vCov`. It also records `vCovStats.policy` as
`unweighted_assertion_ratio` and retains per-tier pass counts for debugging.

The evaluator also emits runtime categories such as `RUNTIME_CRASH`,
`PROBE_MISSING`, `NO_HTML`, and `BAD_CONTRACT`. These are diagnostics, not extra
coverage points. `RUNTIME_CRASH` is the paper's load/execution failure label;
`PROBE_MISSING` is reported separately because the paper also presents it as a
system-level diagnostic.

## Utility metrics from the paper

The paper defines quality-adjusted Return on Automation (RoA) and Time Efficiency Multiplier (TEM). With normalized task quality \(\widehat{V}(t)\), human completion time \(H_{human}(t)\), hourly rate (R), model cost (C_{model}(t)), and model generation time (H_{model}(t)):

\[
\mathrm{RoA} = \frac{\sum_t \widehat{V}(t)H_{human}(t)R}{\sum_t C_{model}(t)},
\qquad
\mathrm{TEM} = \frac{\sum_t \widehat{V}(t)H_{human}(t)}{\sum_t H_{model}(t)}.
\]

No model cost, latency, human-time annotations, or generated HTML are included in this release, so RoA/TEM cannot be reproduced from the repository alone. Do not report them from this snapshot without supplying and documenting those external measurements.

## Reporting requirements

For a reproducible result, record:

- release ID and the SHA-256 manifest;
- source split label and task count actually evaluated;
- evaluator commit/revision, Node/Playwright/Chromium versions, and offline/CDN policy;
- the external HTML input and its hash (store it outside this repository unless separately licensed);
- handling of unresolved assets and unsupported historical checks;
- whether V-Cov was aggregated per task before averaging.

Because the packaged contracts are source snapshots and `release.json` reports
`public_dev_contracts: 0`, scores from this release are engineering diagnostics,
not official leaderboard numbers.

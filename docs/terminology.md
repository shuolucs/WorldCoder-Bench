# Paper Terminology

The release follows the terminology used in the current paper source. This
mapping is also the boundary for compatibility with older source archives.

| Paper term | Release representation |
| --- | --- |
| WorldCoder-Bench | Repository and task collection |
| WorldCoder-Core / Extended / Robust / Dev | Paper split names; the two packaged directories are archival source labels unless a manifest explicitly verifies membership |
| WorldCoder-Toolkit | Evaluator integration target |
| StateProbe | `code/stateprobe/` and the command-line evaluator under `code/evaluator/` |
| behavioral contract | `contract.json` beside each packaged task |
| SIG (Scene Interaction Graph) | The affordance, state, and transition portions of a behavioral contract |
| runtime state interface | `window.__3D_STATE__` |
| A-Cov / S-Cov / T-Cov / V-Cov | Evaluator report fields `aCov`, `sCov`, `tCov`, and `vCov` |

## Archive compatibility migration

The supplied evaluation archive used names that predate the paper revision. The
release uses the following canonical names; no archive-specific names are used
as public files or evaluator APIs:

| Archive field or label | Paper-aligned release name | Scope |
| --- | --- | --- |
| archive contract filename | `contract.json` / behavioral contract; its graph is **SIG** | File names, manifests, and evaluator input |
| archive probe label | **StateProbe** / `StateProbeProtocol` | Evaluator modules and reports |
| archive missing-interface label | `PROBE_MISSING` | Runtime diagnostic emitted when no state interface is exposed |
| archive weighted coverage field | `vCov` using the paper's unweighted assertion ratio | Evaluator report and summary fields |

The migration is structural and identifier-only. It does not rewrite task
prompts, object names, or arbitrary scene variables embedded in a task payload.

## StateProbe helper migration

A small set of historical task records included optional evaluator helpers
with an archive-specific prefix. To align those records with the paper's
method name, the release changes the prefix to
`window.__STATEPROBE_*` in the matching `task.json` prompt and `contract.json`
action/assertion strings. The function suffix and arguments are unchanged, so
this is an identifier-only migration; it does not change the state schema,
action order, thresholds, or assertions.

These helpers are task-specific conveniences and remain optional unless a task
record says otherwise. A generated page is always required to expose
`window.__3D_STATE__`; the evaluator does not treat a helper as proof of
behavioral correctness. The canonical release spelling is
`__STATEPROBE_*`; integrations of an older archive should update the affected
task and contract pair before use.

Historical conversion metadata was likewise normalized to
`step1_contract_rewrite` / `behavioral-contract check expression rewritten`.
The normalized metadata is descriptive provenance; it is not used as an
evaluator predicate.

## What is not renamed

The release does not rename arbitrary user-facing strings, object names, or
scene-graph variables such as `window.__scene__` when they occur inside a task
payload. Those values are part of the executable task language and changing
them would alter the task. They are not public StateProbe APIs. The canonical
runtime channel remains `window.__3D_STATE__`.

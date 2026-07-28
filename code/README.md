# WorldCoder-Toolkit Evaluation Code

This directory contains the portable **StateProbe** evaluator used by the
WorldCoder-Bench release. It runs user-supplied HTML in a Playwright/Chromium
sandbox, reads `window.__3D_STATE__`, applies deterministic actions, and
evaluates the task's behavioral contract.

## Paper-aligned names

- `contract.json` is the public serialized behavioral contract. Its
  affordances, states, and transitions are the task's **SIG (Scene Interaction
  Graph)**. The public filename is `contract.json`.
- `code/stateprobe/` contains the StateProbe protocol, action executor,
  checker plugins, and sandbox lifecycle.
- `code/evaluator/cli.mjs` is the batch/single-task command-line entry point.
- `code/mutation/` contains the paper-aligned M1-M6 source mutation generator.
  It ships without model HTML, traces, or benchmark-wide calibration results.
- `window.__3D_STATE__` is the only standardized runtime state interface.
  Optional task-specific helpers use the `window.__STATEPROBE_*` prefix.
- Evaluation reports expose the paper metrics as `aCov`, `sCov`, `tCov`, and
  `vCov`, with runtime diagnostics such as `RUNTIME_CRASH` and `PROBE_MISSING`.
  `vCov` is the paper-aligned unweighted ratio of passed behavioral assertions;
  L0/L1/L2 labels are retained only as diagnostic groups.

The packaged contracts are source snapshots and are marked provisional; they
are included for evaluator and schema development, not as a claim of the
complete hidden leaderboard ground truth.

The shared action executor accepts the archival contract spellings used in
this snapshot, including normalized or pixel canvas coordinates, selector- or
text-based DOM actions, keyboard modifiers/repeats, nested action sequences,
and verifier setup/pre-check/wait fields. Both the CLI and library runner use
this same executor.

## Run

```bash
npm ci
npx playwright install chromium
bash code/run_eval.sh --validate --split core_205
node code/evaluator/cli.mjs \
  --split core_205 \
  --task P107_avocado_slicer \
  --html-path /path/to/generated.html \
  --model my-model \
  --output results/my-model-P107.json
```

Generated HTML is deliberately kept outside this repository. See the root
README and `SECURITY.md` before running untrusted programs.

To inspect or generate M1-M6 calibration inputs from a user-supplied validated
reference page, run `node code/mutation/cli.mjs --help`. Generated mutants and
their manifests should remain outside the repository unless they have been
reviewed for release.

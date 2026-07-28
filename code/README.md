# StateProbe Evaluator

The evaluator runs a user-supplied HTML file in Playwright/Chromium, executes
the actions in the task's `icg.json` SIG/behavioral contract, reads
`window.__3D_STATE__`, and reports affordance, state, transition, and assertion
coverage.

```text
evaluator/cli.mjs       command-line entry point and scoring loop
evaluator/metrics.mjs   coverage calculations
stateprobe/actions.mjs  browser action execution
stateprobe/checkers.mjs runtime checks
stateprobe/probe.mjs    state snapshots
stateprobe/runner.mjs   reusable evaluation pipeline
stateprobe/sandbox.mjs  local server and browser sandbox
vendor/three/           pinned Three.js 0.170.0 offline runtime
run_eval.sh             shell entry point
```

Files ending in `.mjs` are standard JavaScript ES modules supported by Node.js
18 and newer.

```bash
npm ci
bash code/run_eval.sh --validate --split core_205
bash code/run_eval.sh \
  --split core_205 \
  --task P107_avocado_slicer \
  --html-path /path/to/generated.html \
  --offline \
  --output /tmp/P107-report.json
```

Input HTML is untrusted code. Keep browser sandboxing enabled and do not grant
the generated page host filesystem access.

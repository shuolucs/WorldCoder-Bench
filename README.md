# WorldCoder-Bench Rebuttal Release

This repository contains only the materials needed to inspect the benchmark
during rebuttal:

1. `data/`: the complete supplied snapshot of 2,004 tasks, with one
   `task.json` and one `icg.json` per task, plus deduplicated task assets.
2. `mutation_demos/`: two model-independent mutation examples.
3. `dev_rubrics/`: five representative public development rubrics.
4. `code/`: the StateProbe evaluator and its offline Three.js runtime.

No model-generated HTML, trajectories, screenshots, API responses, or model
evaluation results are included.

## Layout

```text
data/
  tasks/core_205/<task-id>/{task.json,icg.json}
  tasks/hf_snapshot_1799/<task-id>/{task.json,icg.json}
  assets/shared/*
mutation_demos/P01_bouncing_balls/*
dev_rubrics/<task-id>/rubric.json
code/evaluator/
code/stateprobe/
code/vendor/three/
```

The directory names `core_205` and `hf_snapshot_1799` record the two supplied
source snapshots. Together they contain 2,004 unique tasks. They are not a new
claim about the membership of the paper's canonical 2,026-task split.

For source-archive compatibility, the per-task contract keeps the requested
filename `icg.json`. Its contents are the task's SIG (Scene Interaction Graph)
and behavioral contract described in the paper; "ICG" is not used here as a
separate benchmark term.

## Validate The Data

```bash
npm ci
npm run validate
```

Expected task counts are 205 and 1,799. Every counted task must contain both
`task.json` and `icg.json`.

## Run The Evaluator

Install a Chromium build supported by Playwright once:

```bash
npx playwright install chromium
```

Then evaluate a generated HTML file against one task:

```bash
bash code/run_eval.sh \
  --split core_205 \
  --task P107_avocado_slicer \
  --html-path /path/to/generated.html \
  --offline \
  --output /tmp/P107-report.json
```

When `--output` is omitted, batch reports are written under the system
temporary directory (`/tmp/worldcoder-results` on Linux), so evaluation runs do
not add result folders to this repository.

The generated page must expose the task's visible runtime-state interface,
normally `window.__3D_STATE__`. See `code/README.md` for the evaluator modules
and `mutation_demos/README.md` for runnable mutation examples.

## Scope Notes

The five files under `dev_rubrics/` are representative rubric examples, not a
claim that a separately verified 200-task Dev manifest is present. Three paths
declared by the supplied task metadata were not available in the source
archives: `P01_bouncing_balls/ref/bouncing_balls_preview.png` and `cloud10.png`
for `P550_wildfire_spread` and `P589_snow_globe`. No placeholder binaries were
invented for them.

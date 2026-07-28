# Mutation Demos

These model-independent P01 examples show two controlled defects:

- `M1_event_disconnect.html`: the click-to-spawn event is disconnected.
- `M2_state_sync_break.html`: internal collision state changes while the HUD
  remains stale.

`reference.html` is the corresponding non-mutated reference page. Run any file
against the published P01 SIG/behavioral-contract rubric, for example:

```bash
bash code/run_eval.sh \
  --split hf_snapshot_1799 \
  --task P01_bouncing_balls \
  --html-path mutation_demos/P01_bouncing_balls/M1_event_disconnect.html \
  --offline \
  --output /tmp/P01-M1.json
```

The demos contain no model output or model trajectory. They illustrate two
controlled faults; they are not benchmark-wide mutation-calibration results.

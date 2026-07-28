# Data

The supplied snapshot contains:

- `tasks/core_205/`: 205 task directories.
- `tasks/hf_snapshot_1799/`: 1,799 task directories.
- `assets/shared/`: 91 deduplicated GLB and texture assets.

Each task directory contains exactly:

```text
task.json   visible task specification
icg.json    SIG/behavioral contract used by StateProbe
```

Asset references are repository-relative from each task directory. Reused GLB
files are stored once under `assets/shared/`.

The filename `icg.json` is retained for source-archive compatibility. Its
contents correspond to the paper's SIG (Scene Interaction Graph) and
behavioral-contract terminology.

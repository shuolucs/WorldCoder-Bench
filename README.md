# WorldCoder-Bench

This directory is a reproducible **source snapshot** of the WorldCoder-Bench task and evaluation materials. It is prepared for peer review and local evaluator development. The paper terminology used here is **WorldCoder-Bench**, **WorldCoder-Core**, **WorldCoder-Extended**, **WorldCoder-Robust**, **WorldCoder-Dev**, **WorldCoder-Toolkit**, **SIG (Scene Interaction Graph)**, **StateProbe**, and **behavioral contracts**.

## Release status

This package is deliberately conservative about what it claims. It was assembled from the sampled evaluation archive and a Hugging Face data archive. The two directory labels below describe the source archives, not a newly verified reconstruction of every paper split.

| Path | Tasks | Meaning in this package |
| --- | ---: | --- |
| `tasks/core_205/` | 205 | Tasks extracted from the sampled evaluation archive. |
| `tasks/hf_snapshot_1799/` | 1,799 | Historical task snapshot extracted from the Hugging Face archive. |
| `assets/shared/` | 91 files (85 GLB + 6 textures) | Hash-deduplicated task assets referenced by task material. |
| `contract.json` | 2,004 | Per-task source snapshots, marked provisional in `manifests/tasks.jsonl`. |

The 2,004 tasks in this package must not be advertised as the paper's complete 2,026-task canonical release, nor should `hf_snapshot_1799` be renamed to the paper's Extended split without an independent provenance check. The package currently contains no independently verifiable public Dev-contract set; `release.json` records `public_dev_contracts: 0`.

## What is included

- The task prompt and task metadata in `task.json`.
- A per-task `contract.json` source snapshot with affordances, states, transitions, and checks where present.
- Shared binary GLB and standard texture assets, with task references rewritten to repository-relative paths such as `../../../assets/shared/Avocado.glb` and `../../../assets/shared/hardwood2_diffuse.jpg`.
- An asset checksum list in [`assets_checksum.txt`](assets_checksum.txt) (the complete release checksum is [`manifests/files.sha256`](manifests/files.sha256)).
- A deterministic AppleDouble-alias repair record in [`manifests/asset_alias_repairs.json`](manifests/asset_alias_repairs.json).
- The WorldCoder-Toolkit-compatible StateProbe/evaluator source under `code/`.
- Manifests and checksums under `manifests/`.
- The paper-to-release terminology map in [`docs/terminology.md`](docs/terminology.md).

## What is intentionally excluded

This release contains **zero model-generated HTML files, trajectories, screenshots, reports, or model run logs**. A generated program is an evaluator input supplied by the user; it is not part of the task distribution. No hidden leaderboard contract or private assertion set is implied by this repository.

Mutation-generation source, derived mutant pages, calibration logs, and
mutation outcomes are outside this release. This source snapshot makes no
benchmark-wide mutation-hardening or kill-rate claim.

## Quick start

Requirements: Node.js 18 or newer, npm, and a Chromium browser supported by Playwright.

```bash
npm ci
bash code/run_eval.sh --help
npm test
```

The evaluator includes the Three.js `0.170.0` runtime modules under
`code/vendor/three`, so `--offline` does not need a CDN connection. Playwright
browser binaries are installed separately with `npx playwright install chromium`.

To evaluate one task, supply your own generated HTML. The exact accepted path form is shown by `node code/evaluator/cli.mjs --help`; a typical invocation is:

```bash
node code/evaluator/cli.mjs \
  --split core_205 \
  --task P107_avocado_slicer \
  --html /path/to/your/generated.html \
  --model my-model \
  --output results/my-model-P01.json
```

The HTML must expose the runtime state object required by the task prompt (usually `window.__3D_STATE__`). The evaluator executes it in a local browser and applies the task's action-driven checks. Do not run untrusted HTML outside the browser sandbox or with host filesystem access.

## Repository layout

```text
tasks/<source-split>/<task-id>/task.json       visible task specification
tasks/<source-split>/<task-id>/contract.json   behavioral-contract snapshot
assets/shared/*                                 deduplicated task assets
code/evaluator/                                 command-line evaluator
code/stateprobe/                               state probing modules
code/tools/audit_release.mjs                   release audit tool
manifests/                                     task, asset, hash, and audit manifests
splits/                                        explicit archival split membership lists
docs/                                          schemas and metric definitions
```

## Assets and unresolved declarations

GLB files and six standard Three.js example textures were copied as binary data and deduplicated by SHA-256. Every packaged GLB passes the release audit's glTF binary header and declared-length checks. Only assets referenced by the published task material are included; unused source-archive binaries are kept outside the release. `Nefertiti.glb` is included from the matching public Three.js/Hugging Face binary, with its hash recorded in the asset manifest. The source metadata still contains **3 unresolved asset declarations**: 2 `cloud10.png` entries and one `ref/bouncing_balls_preview.png` reference image; no verifiable binary for either name was present in the supplied archives or the pinned Three.js r170 tree. The six recovered textures and the Nefertiti provenance note are documented in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). AppleDouble names such as `._horse.glb` were repaired to the matching canonical shared asset when that binary exists; every repair is listed in [`manifests/asset_alias_repairs.json`](manifests/asset_alias_repairs.json). All remaining unresolved declarations are recorded in [`manifests/unresolved_assets.json`](manifests/unresolved_assets.json) and are not silently replaced. A task that declares an unavailable asset may require the original upstream asset to run.

## Contracts and terminology

`contract.json` is the public filename for a task's behavioral-contract snapshot. In the paper vocabulary, the contract records the task's SIG (Scene Interaction Graph), action sequence, and executable assertions. The files in this source snapshot are not an independently verified WorldCoder-Core, WorldCoder-Extended, WorldCoder-Robust, or WorldCoder-Dev contract release; the supplied archives do not contain a verifiable Dev-200 manifest. Official hidden-split contracts therefore remain outside this package.

The public release uses the paper vocabulary throughout: `contract.json` is a
behavioral-contract snapshot, its affordances/states/transitions are the task's
SIG, and `window.__3D_STATE__` is the only standardized runtime interface. A
small set of archival task records had evaluator-named action hooks; those
strings were migrated from the old internal prefix to the paper-aligned
`window.__STATEPROBE_*` spelling in both task prompts and matching contract
actions. The migration is recorded in [`docs/terminology.md`](docs/terminology.md)
and does not introduce a second required runtime interface.

The snapshots in this package are not a substitute for a separately audited hidden evaluation service. They may contain permissive, converted, or incomplete checks. Use [`docs/metrics.md`](docs/metrics.md) for metric definitions and report the snapshot version when publishing results.

## Integrity and provenance

Run the release audit after unpacking:

```bash
node --test test/release.test.mjs
node code/tools/audit_release.mjs .
sha256sum -c manifests/files.sha256
```

The audit report is generated at `logs/release_audit.json`. Source-archive provenance and third-party asset licensing remain under review; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and [`LICENSE`](LICENSE).

## Citation

The machine-readable citation is in [`CITATION.cff`](CITATION.cff). The anonymous review URL associated with the intended repository is documented in the submission materials, not embedded as an author identity in this package.

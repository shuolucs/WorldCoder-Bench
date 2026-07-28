# WorldCoder-Bench Dataset Card

## Summary

WorldCoder-Bench is a collection of natural-language specifications for browser-native, physically grounded 3D applications. A task asks a code-generation system to produce an executable HTML/Three.js program. Evaluation is intended to be execution-based: StateProbe applies controlled actions and checks runtime state against a behavioral contract. In the paper vocabulary, the contract's affordances, states, and transitions form a SIG (Scene Interaction Graph), and generated programs expose `window.__3D_STATE__`.

This repository is a **source snapshot**, not a claim of a complete official benchmark release. It contains 2,004 task directories assembled from two source archives:

- `core_205`: 205 tasks from the sampled evaluation archive.
- `hf_snapshot_1799`: 1,799 tasks from a historical Hugging Face snapshot.

There are 91 shared task assets (85 GLBs and six standard textures) and 3 unresolved asset declarations. The pool contains only assets referenced by a task prompt/contract or recovered to satisfy a declared task dependency; unused source-archive binaries were retained outside this release. Exact counts and hashes are in `manifests/`. Source-archive AppleDouble aliases were repaired only when a matching canonical asset exists; the mapping is recorded in `manifests/asset_alias_repairs.json`.

## Content and format

Each task directory normally contains:

1. `task.json`, the visible prompt and curation metadata;
2. `contract.json`, a source snapshot of affordance, state, transition, and check information.

The public filename `contract.json` is the serialized behavioral contract used
by the release evaluator. Its affordances, states, and transitions form the
task's SIG (Scene Interaction Graph); see [`docs/terminology.md`](docs/terminology.md)
for the paper-to-release naming map.

Assets are stored once under `assets/shared/`; task metadata uses relative references. The field union and compatibility rules are specified in [`docs/task_schema.md`](docs/task_schema.md).

## Split and provenance caveat

The directory names are archival labels. They should not be interpreted as proof that this package reproduces the paper's WorldCoder-Core, WorldCoder-Extended, WorldCoder-Robust, or WorldCoder-Dev membership. In particular, the package has no independently verifiable public set of 200 Dev contracts at this time. [`contracts_dev/STATUS.json`](contracts_dev/STATUS.json) records this status.

The historical snapshot includes conversion metadata on many contracts. Such records are useful for parser and evaluator development, but are marked `source_snapshot_provisional` in `manifests/tasks.jsonl` and should not be treated as hidden ground truth.

## Missing and excluded material

The repository intentionally publishes no model-generated HTML, model trajectories, screenshots, execution traces, aggregate model reports, or private leaderboard assertions. Users must provide their own generated HTML when running the evaluator.

The unresolved declarations are preserved in the manifest: two `cloud10.png` entries and one `ref/bouncing_balls_preview.png` reference. `Nefertiti.glb` is included as the matching public Three.js binary. No placeholder binary has been fabricated. Affected tasks can fail to load until the remaining upstream asset is obtained and its license is checked.

## Intended uses

- Reproducing task parsing, asset path handling, and evaluator integration.
- Developing or auditing execution-based state verification.
- Studying task prompts and contract-schema compatibility.
- Running local experiments with user-supplied model programs.

## Out-of-scope uses

- Treating this snapshot as an official leaderboard or as a complete hidden split.
- Comparing model scores without recording the exact snapshot, evaluator revision, browser, and supplied HTML.
- Redistributing GLB assets before their upstream provenance and license terms are reviewed.
- Inferring author identity from historical payload strings or source-archive artifacts.

## Data creation and curation

The package was assembled by extracting JSON task records and binary assets from existing project archives, removing generated-output artifacts, replacing task-local duplicate GLBs with shared copies, and retaining unresolved declarations for auditability. No new model outputs or human-subject data were added during packaging.

## Privacy and safety

Task prompts are executable-program specifications and may contain code-like examples, URLs, selectors, and legacy identifiers. These strings should not be interpreted as credentials or as a normative public API. Before public redistribution, run the release audit and review third-party asset provenance. See [`SECURITY.md`](SECURITY.md).

## Licensing

The top-level [`LICENSE`](LICENSE) is a provisional research-release notice, not a blanket relicensing of third-party assets. Individual upstream notices take precedence where present. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Maintenance and versioning

This card describes release version `0.1.0-review`. A future release should update the manifests, audit report, contract availability status, unresolved-asset count, and checksums together. Results should cite the release version and retain the supplied HTML separately.

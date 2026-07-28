# WorldCoder-Dev Contract Status

The paper describes a public WorldCoder-Dev split with executable behavioral contracts. In this source snapshot, no independently verifiable Dev-contract files were present in the supplied archives, so this directory is intentionally a status marker rather than a fabricated set of 200 contracts.

## Current state

- Expected by the paper: 200 public Dev tasks/contracts.
- Packaged here: 0 verified Dev contracts.
- Per-task contract snapshots that *are* available live beside their task under `tasks/core_205/` and `tasks/hf_snapshot_1799/`; they are marked `source_snapshot_provisional` and are not labeled Dev.
- Machine-readable status: [`STATUS.json`](STATUS.json).

Do not claim that this repository contains the complete public Dev split until independently sourced contracts are added, audited, and reflected in the status file and checksums.

## Expected contract shape

A verified Dev contract should be named `contract.json` and contain `task_id`, `affordances`, `states`, and `transitions`, with executable checks and action sequences documented in [`../docs/task_schema.md`](../docs/task_schema.md). Adding a contract requires its task prompt, asset references, provenance, and checksum to be recorded together.

## Why this is explicit

Publishing a placeholder or silently relabeling one of the historical snapshots as Dev would make evaluator results appear reproducible when the required ground truth is not available. This status file lets an anonymous reviewer distinguish available parser fixtures from an official public split.

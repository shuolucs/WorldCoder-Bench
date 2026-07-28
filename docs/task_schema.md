# Task and Contract Schema

This document describes the JSON formats present in release `0.1.0-review`. The files are intentionally permissive: historical task records do not all have the same optional fields, and unknown fields must be preserved by tools.

## Task record (`task.json`)

Every packaged task has the following required fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Stable task identifier; normally matches the directory name. |
| `title` | string | Human-readable task title. |
| `domain` | string | Primary task domain, such as `physics`, `chemistry`, `product`, or `visualization`. |
| `difficulty` | string | Difficulty label (for example `L2` through `L6`). |
| `prompt` | string | Natural-language instruction shown to a code-generation system. |

Common optional fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `framework` | string | Requested implementation framework, commonly `three.js`. |
| `target_framework` | string | Historical synonym for `framework`. |
| `assets` | array of strings | Declared asset references, usually GLB paths. |
| `required_assets` | array of strings | Historical/auxiliary asset declaration field. |
| `physics_constraints` | string | Natural-language constraints visible in the task. It is not, by itself, an executable contract. |
| `description` | string | Historical short description. |
| `route` | string | Historical source or task route metadata. |
| `reference_images` | array | Optional reference-image metadata. |
| `reference_videos` | array | Optional reference-video metadata. |
| `tags` | array | Curation or topical tags. |
| `estimated_human_time_minutes` | number | Historical effort estimate, when present. |
| `difficulty_analysis` | object/string | Curation-stage analysis; not a model-facing contract. |
| `_note` | string | Historical source note. |

Tools must retain fields they do not understand. A field's absence means “not supplied”, not false or empty.

## Asset paths

The release stores binary assets in `assets/shared/`. A task-level JSON reference is repository-relative from the task directory, for example:

```json
"assets": ["../../../assets/shared/Avocado.glb"]
```

The same convention applies to the recovered texture files (`.jpg`, `.png`, and
`.gif`). Do not resolve these paths against an author workstation. Concrete
model-facing asset references are rewritten when needed so generated programs
can load the shared binary from the task directory (for example,
`Nefertiti.glb` becomes the repository-relative path shown above). The
evaluator also accepts the historical `/assets/...` and `/shared_assets/...`
URL prefixes and an exact shared-asset basename, so prompts that say
`./Duck.glb` continue to work after deduplication. New task records should use
the canonical repository-relative form above. The
AppleDouble cleanup recorded in `manifests/asset_alias_repairs.json` restores
malformed `._name.glb` references to existing canonical assets. The unresolved
manifest records every declared asset or reference image whose source binary is
unavailable (currently two `cloud10.png` and one `ref/bouncing_balls_preview.png`
declaration); those values remain unchanged.

## Contract record (`contract.json`)

The normalized top-level structure is:

```json
{
  "task_id": "P_example",
  "affordances": [],
  "states": [],
  "transitions": []
}
```

In the paper, this record is the serialized behavioral contract: its affordances,
states, and transitions form the task's **Scene Interaction Graph (SIG)**, while
the transition actions and verifier expressions provide the action sequence and
assertions. `contract.json` is the canonical public release filename.

### Affordances

An affordance usually has `id`, `name`, `type`, `semantic`, optional `locator_hints`, and an executable `check` expression. It describes an object or control that must exist. A check may be a string expression or, in historical records, a structured object with an expression-like field.

### States

States usually have `id` and `name`, plus either `condition` (one expression) or `conditions` (a list of expressions). Some historical records contain descriptive fields without executable expressions. A state is “reached” only when the evaluator's configured condition check succeeds after the relevant action sequence.

### Transitions

A transition generally contains `id`, an `action`, and a verifier/check collection. Action forms include DOM clicks or inputs, keyboard events, canvas clicks, drags, waits, scripts, and composed actions. Historical records may place checks under `verifier.checks`, `checks`, or another compatibility wrapper; the evaluator must preserve the original record and report unsupported forms rather than silently treating them as passed.

Checks can carry an expression (`expr`, `check`, or a legacy string), a severity/tier, and optional wait timing. Expressions run in the page context and can inspect the live runtime state plus serialized `before` and `after` snapshots.

### Action compatibility

The evaluator accepts both the normalized action names and the equivalent
spellings retained in the archival records. An action may be an array, a
`multi_action`, or a chained descriptor using `next`, `then`, `pre_actions`, or
`post_actions`. Waits accept `duration_ms`, `wait_ms`, `duration`, `delay_ms`,
and `timeout_ms` (bounded by the evaluator). Canvas clicks accept normalized
`position.x/y`, `x_ratio/y_ratio`, normalized coordinate arrays, or pixel
`x/y` offsets relative to the canvas. DOM actions resolve `selector`,
`locator`, CSS-like `target`, and text fields such as `text_match` or
`text_content_match`; keyboard actions accept `keys`, modifier flags/aliases,
`hold_ms`, `action`/`keyAction`, and `repeat`/`count`.

Transition-level `pre_actions` and `post_actions` are executed around the
main action. Verifier `setup_script` runs before the `before` snapshot, and
`pre_checks` evaluate that snapshot before the main action. The
`wait_before_ms`, `pre_wait_ms`, `wait_ms`, `delay_ms`, and `timeout_ms` fields
provide bounded timing gates. Pre-checks are reported separately and do not
add hidden coverage points; a failed pre-check blocks the transition.

## Runtime state interface

The task prompt normally asks generated HTML to expose `window.__3D_STATE__`. Its fields are task-specific: positions, velocities, counters, modes, UI flags, and physical quantities may all occur. A contract may read only a subset. The interface is visible to the model; action sequences, thresholds, and assertion expressions are contract material.

## Historical compatibility

The Hugging Face snapshot contains records with conversion markers such as `_legacy_converted`, `_original_format`, `_conversion_note`, `_expr_rewritten_v2`, `_rewrite_strategy`, `_patched`, `_patch_phase`, `_patch_note`, and `_rewrite_ts`. These markers are retained to make the conversion auditable. They do not establish that the converted expression is equivalent to an independently validated official contract.

Task records that contained evaluator-named action hooks were migrated to the
paper-aligned `__STATEPROBE_*` prefix in this release. These hooks are optional,
task-specific conveniences; they are not the standardized runtime interface.
New integrations should name the object a **behavioral contract**, refer to its
graph as **SIG**, and use **StateProbe** for the evaluator. The only
standardized runtime interface is `window.__3D_STATE__`. See
[`terminology.md`](terminology.md) for the exact migration boundary.

## Validation

Use the audit and manifests together:

```bash
node code/tools/audit_release.mjs .
sha256sum -c manifests/files.sha256
```

The audit checks JSON presence, duplicate task IDs, shared asset references,
binary GLB headers/lengths, symlinks, forbidden generated artifacts, and
unresolved declarations. It does not prove that every check expression is
semantically correct.

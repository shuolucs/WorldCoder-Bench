# Mutation Calibration Code

This directory provides the paper-aligned M1-M6 source mutation generator used
to build checker-calibration inputs. It intentionally contains no reference or
model HTML, execution traces, screenshots, aggregate kill rates, or claims of
benchmark-wide calibration.

## Operators

| ID | Paper name | Intended defect |
| --- | --- | --- |
| M1 | Event Disconnect | Remove key event listeners. |
| M2 | State Sync Break | Update engine state but skip HUD refresh. |
| M3 | Physics Param Error | Alter a physical constant. |
| M4 | Probe Deletion | Remove the `window.__3D_STATE__` update. |
| M5 | Init Error | Use incorrect initial positions or velocities. |
| M6 | Constraint Violation | Violate an invariant such as restitution <= 1. |

Mutation targets are task-specific, so a plan uses exact source spans and an
expected match count. Generation fails if the source does not match exactly;
this prevents a nominal mutant from silently leaving the implementation
unchanged or altering an unintended span.

```json
{
  "mutations": [
    {
      "case_id": "m3-gravity",
      "operator": "M3",
      "search": "const gravity = 9.8;",
      "replacement": "const gravity = 2.0;",
      "expected_matches": 1
    }
  ]
}
```

Generate source mutants outside the repository:

```bash
node code/mutation/cli.mjs \
  --input /path/to/validated-reference.html \
  --plan /path/to/mutation-plan.json \
  --output-dir /tmp/worldcoder-mutants
```

The output manifest records source and mutant hashes and marks each row
`generated_not_evaluated`. A task may be described as mutation-calibrated only
after every applicable mutant is evaluated with the pinned StateProbe runner
and the task-level injected/killed/survived decision is retained. This release
does not contain the verified WorldCoder-Dev manifest required for such a
benchmark-level claim.

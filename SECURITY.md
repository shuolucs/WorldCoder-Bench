# Security and Responsible Use

## Scope

This package contains task prompts, JSON contract snapshots, JavaScript/Node evaluator code, and binary GLB assets. It does not contain model-generated HTML, trajectories, credentials, or a hosted execution service.

## Running generated programs

Generated HTML is untrusted code. Run it only in the intended Playwright/Chromium sandbox, with a disposable working directory and no secrets in the environment. Do not grant the page access to host files, browser profiles, SSH material, cloud credentials, or production services. Prefer an offline browser profile when testing self-contained programs. Review network requests before enabling external CDNs.

The evaluator's local HTTP server should serve only the selected release root. Do not expose that server on a public interface. Keep browser and Playwright versions pinned when comparing results.

## Integrity controls

- Verify `manifests/files.sha256` after extraction.
- Run `code/tools/audit_release.mjs` and inspect `logs/release_audit.json`.
- Treat unresolved asset declarations as failures requiring an explicit decision; do not replace them with arbitrary files.

## Privacy and accidental disclosure

Task prompts can include source-like paths, URLs, selectors, and historical identifiers as literal examples. They are preserved for semantic fidelity and are not author metadata or a public API. Before mirroring the package, inspect text files for local paths, tokens, private endpoints, and email addresses. Do not add model HTML or execution logs to the repository: those may contain prompts, environment details, or user data.

## Asset provenance

The GLBs are source-archive assets. Their upstream licenses are not uniformly established in this snapshot. Do not assume that the top-level research-release notice grants redistribution rights for an individual model. See `THIRD_PARTY_NOTICES.md`, and remove or separately license an asset before a broad public release if its provenance cannot be verified.

## Reporting

For a security issue in a future public mirror, use that mirror's private security-reporting channel and include the release version, affected path, reproduction steps, and whether the issue requires executing generated HTML. Do not attach credentials or private model outputs. Until a public reporting channel is established, keep sensitive reports out of public issues and contact the release maintainer through the confidential channel associated with the peer-review submission.

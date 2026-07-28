# Third-Party Notices

This file records known dependencies and provenance limitations. It is not a substitute for the license text shipped by an upstream project.

## Playwright

The Node evaluator depends on Playwright `1.58.2`. Playwright is distributed under the Apache License, Version 2.0. See the dependency metadata in `package-lock.json` and the upstream project: <https://github.com/microsoft/playwright>.

Playwright may download or launch browser binaries. Chromium and related browser components have their own upstream license and notice files; review the installed browser package before redistributing it.

## Three.js

Task prompts and evaluator routing refer to Three.js and its example loaders. Three.js is distributed under the MIT License: <https://github.com/mrdoob/three.js>. The evaluator vendors the `build/` and `examples/` modules from Three.js `0.170.0` under `code/vendor/three` so `--offline` can be used. The vendored files retain the upstream MIT notice; this copy is for runtime compatibility, not a relicensing of Three.js.

## GLB assets

The 85 files in `assets/shared/` were extracted from source archives or recovered
from the matching public Three.js/Hugging Face asset archive and deduplicated by
content hash. Their filenames resemble common glTF sample assets, but this
snapshot does not establish a uniform upstream license for every binary. Treat
each asset as provenance pending. Do not remove attribution or redistribute an
asset until its original notice has been checked.

`Nefertiti.glb` is the standard Three.js example asset from
`examples/models/gltf/Nefertiti/Nefertiti.glb` (1,233,240 bytes,
SHA-256 `d8c00c742b59137695245eefeef0e217d6e33c64eeaeb1904ff39f6b31542639`).
The binary was recovered from a matching public archive. Its model-specific
license and attribution could not be independently verified from the supplied
materials; retain this provenance note and verify the upstream terms before
redistribution. Do not assume the Three.js MIT license covers the model.

`TextureTransformMultiTest.glb` retains the embedded glTF copyright notice for Analytical Graphics, Inc. and Ed Mackey (CC-BY 4.0); preserve that attribution when redistributing the asset. `collision-world.glb` has no embedded copyright metadata in the supplied binary, so its upstream provenance remains pending review.

`coffeeMug.glb` contains Blender metadata copied from the source asset. Its
machine-local source path was replaced with `REDACTED/coffee.blend` without
changing the GLB length or scene payload.

Two embedded third-party contact-email strings found during the anonymous
release audit were replaced with an invalid placeholder in metadata only;
the associated model/texture bytes, attribution text, and rendering data were
otherwise left unchanged.

## Recovered Three.js example textures

Six texture files (`hardwood2_diffuse.jpg`, `brick_diffuse.jpg`, `disturb.jpg`,
`lavatile.jpg`, `crate.gif`, and `water_normals.jpg`) were recovered from the
Three.js r170 examples tree because task metadata declares them but neither
supplied archive included a local copy. They remain under the Three.js MIT
license and are included only to make those task declarations runnable. The
`water_normals.jpg` filename is the release-local name for the upstream
`examples/textures/waternormals.jpg` file. `cloud10.png` was not substituted;
its two declarations and the unavailable `ref/bouncing_balls_preview.png`
reference image remain in the unresolved manifest.

## Source snippets and examples

Task prompts may contain small code snippets, selectors, or references originating in project experiments or upstream examples. They are retained to preserve task semantics. Where an upstream notice is later identified, add a file-level notice and update this document.

## No model-output notice

The package intentionally excludes generated HTML, execution traces, screenshots, and model reports. Any such file supplied locally for evaluation remains the user's responsibility and is not covered by this repository's notices.

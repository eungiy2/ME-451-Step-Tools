# Project Context for Coding Agents

## Project

This repo is the `STEP CAD/CAM Tools` app for inspecting STEP CAD files with B-Rep geometry, PMI tolerances, datum features, datum targets, and datum reference frames. The active checkout is:

`C:\Users\jcorre20\source\UIUC research\remix_-maxillofacial-implant-cad-verification`

Use the local code and sample files as the source of truth. Do not give generic CAD/React advice before checking the actual implementation.

## Key Files

- `src/App.tsx`: main UI, inspector/sidebar, tolerance and datum cards, user-facing PMI layout.
- `src/components/CadCanvas3D.tsx`: Three.js viewport, picking, highlighting, datum badges, datum/DRF rendering, camera focus behavior.
- `src/utils/stepParser.ts`: STEP/AP203/AP242 PMI parser, datum/tolerance/DRF extraction, semantic relationships.
- `src/utils/stepOcctParser.ts`: OCCT tessellation path.
- `src/utils/geometryClassifier.ts`: B-Rep/STEP target mapping helpers.
- `other viewers/SFA source/sfa-geotol.tcl`: important reference for STEP PMI semantics.
- `STEP samples with PMI/`: local validation samples.

## Parser Rules

- Prefer general STEP/PMI relationship parsing over sample-specific fixes.
- Do not create file-based patches, filename-specific branches, or one-off sample solutions. Convert sample failures into general parser rules.
- Treat `other viewers/SFA source/sfa-geotol.tcl` as the semantic reference for datum, datum target, datum system, and geometric tolerance traversal.
- Build AP242 datum reference frames from `DATUM_SYSTEM`; use `GEOMETRIC_TOLERANCE_WITH_DATUM_REFERENCE` mainly for linking tolerances to frames.
- Preserve all semantic targets for multi-face datums. Do not collapse a multi-face datum to one `targetId`.
- Keep topological B-Rep face identity exact. Avoid merging/grouping tricks that hide real face boundaries.
- If changing parser behavior, smoke-test multiple NIST samples, not just one file.

## Datum and DRF Expectations

- Datum feature labels in the UI should distinguish:
  - `PLANE`: single planar datum feature
  - `CYL`: cylindrical datum feature
  - `MULTI`: actual multi-face datum feature
  - `CYL-MULTI`: cylindrical multi-face/pattern datum feature
  - `MID-DIM`: mid-dimensional or median-plane datum feature
- Cylindrical datum patterns can also be multi-face datum features. Preserve their full semantic target sets.
- Two-reference DRFs are valid when the STEP datum system defines them. Plane-plus-target-point origins should project the target point onto the primary plane.
- Partial frames should not be rendered unless the STEP structure supports them as valid DRFs.
- Circular datum targets should render as hatched circular target areas when the PMI target zone geometry defines a circle.

## Viewport and Interaction Rules

- Visible interaction stability is correctness. Slow datum clicks, shifting badges, duplicate overlays, wrong focus landings, or panel jumps are bugs.
- Datum and measurement interactions should not fight OrbitControls.
- When focusing a datum or face, keep the model fixed and move the camera/orbit side. Avoid unnecessary zoom changes unless requested.
- Prefer fixed model-space datum geometry over camera-reactive duplicate SVG overlays.
- Keep debug UI hidden unless explicitly requested.
- For heavy CAD performance, inspect CPU-side hot paths first: raycasting, DOM lookups, badge projection, object lookup, and highlight/focus work.

## UI Rules

- Keep the right inspector width stable and user-resizable on desktop. Do not let selected content force the panel wider.
- Keep cards compact and bounded. Use `min-w-0`, truncation, wrapping, and overflow containment for long PMI text.
- Tolerance cards should keep explanations available for future floating tips, but not show long explanatory text inline.
- Current tolerance symbol abbreviations include `SURF_PROF`, not `SURF_PROFILE`.
- The B-Rep tab owns the geometry/parameter controls. Do not reintroduce a separate `Param` tab unless explicitly asked.
- The viewport bottom toolbar should not include material or spin controls unless explicitly asked.

## Validation Commands

Run these before finishing UI/parser changes when practical:

```powershell
npm run lint
npm run build
```

Useful parser smoke-test pattern:

```powershell
npx tsx -e "import fs from 'fs'; import { parseStepFile } from './src/utils/stepParser.ts'; const f='STEP samples with PMI/AP242/<sample>.stp'; const p=parseStepFile(f, fs.readFileSync(f,'utf8')); console.log(p.datums.map(d => [d.identifier, d.derivedDatum, d.targetIds?.length || 0, d.type]).join('\n'));"
```

## Working Style

- Make focused edits in the relevant file; avoid broad refactors during UI polish.
- Preserve user changes in the working tree.
- When a behavior crosses layers, explain it plainly from STEP file to parser to UI/viewport.
- Prefer verified behavior from this checkout over assumptions.

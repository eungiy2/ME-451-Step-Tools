# Project Architecture And Roadmap

## Purpose

`STEP CAD/CAM Tools` is a browser-based STEP CAD inspector and future PMI/GD&T
editor. It imports AP203/AP242 STEP files, renders B-Rep geometry, and exposes
semantic PMI such as datum features, datum targets, datum reference frames
(DRFs), dimensional tolerances, and geometric tolerances.

The local files in `STEP samples with PMI/` and the reference viewer source in
`other viewers/SFA source/sfa-geotol.tcl` are the project evidence base.

At this handoff point, the working tree marks `other viewers/SFA source/` as
deleted. Do not silently recreate it. Restore it only through an intentional
user-directed Git or source-recovery operation before relying on that reference.

## Current Capability

The application can load every bundled STEP template and currently supports:

- OCCT tessellation and a native-OCCT topology path with whole-model fallback.
- B-Rep face, edge, loop, and vertex interaction, including stable native
  topology signatures when native topology is available.
- Datum feature, datum target, and DRF parsing and viewport rendering.
- Semantic datum categories: `PLANE`, `CYL`, `MULTI`, `CYL-MULTI`, and
  `MID-DIM`.
- Dimensional PMI parsing/rendering for major linear, diameter, radius, hole,
  counterbore, countersink, thread, spherical, reference, and angular cases.
- True-position feature-control frames (FCFs) attached to radial and linear
  dimensional callouts, including standalone linear position FCF leaders.
- Solid, x-ray, wire, and hidden-edge viewport styles; face/edge/vertex
  hover and selection; camera and visibility controls.

Support is intentionally incomplete for profile, orientation, form, runout,
and the remainder of angular/geometric tolerance presentation. The parser may
already retain records for categories that do not yet have a viewport renderer.

## Architecture

### UI And State

- `src/App.tsx` owns the application shell, sidebar/inspector, display
  toggles, loaded-file state, and parser/OCCT result coordination.
- `src/components/CadCanvas3D.tsx` owns Three.js rendering, cameras,
  interaction, PMI drawing, DOM overlay projection, and rendering performance.

### STEP Semantics

- `src/utils/stepParser.ts` reads AP203/AP242 semantic structures and emits
  parsed datums, targets, DRFs, dimensions, and geometric tolerances.
- `src/utils/geometryClassifier.ts` provides conservative STEP target to
  rendered-face mapping helpers.
- `other viewers/SFA source/sfa-geotol.tcl` is the semantic reference when
  traversing datum systems and geometric tolerances.

### Geometry And Topology

- `src/utils/stepOcctParser.ts` turns OCCT output into separately renderable
  B-Rep faces.
- `src/utils/occtLoader.ts` chooses native topology by default and provides the
  standard tessellation fallback.
- `src/utils/pmiTopologyReferences.ts` resolves parser targets to runtime
  B-Rep IDs and stable native/STEP topology signatures.
- `native/occt-topology-wrapper/` contains the custom OCCT WebAssembly wrapper.

The required association flow is:

```text
STEP PMI semantics
  -> parsed tolerance/datum record
  -> topology reference resolution
  -> runtime BRepFace/BRepEdge/BRepVertex rendering anchor
  -> Three.js leader geometry + projected DOM annotation
```

Do not bypass this flow with presentation proximity or sample-specific IDs.

## Rendering Rules That Must Survive

- PMI placement is chosen when the annotation is created. Avoid per-frame
  placement changes and overlay drift.
- Cylindrical/radial callout doglegs remain horizontal in the camera plane;
  labels stay close to the dogleg endpoint.
- Concentric cylindrical callouts use fitted cylinder axes and deterministic
  angular attachment slots so their leaders and FCFs do not overlap.
- Partial cylindrical faces must use fitted circular geometry for center/radius
  comparisons, never only a bounding-box center.
- Radial stacks are ordered: dimension, FCF, datum triangle/stem/badge.
- Linear position FCFs use projection lines and inward arrows. Put an FCF in a
  broken dimension line when there is room; otherwise use a short exterior
  continuation leader.
- Viewport interaction and overlay stability are correctness requirements, not
  cosmetic polish.

## Engineering Rules

- No filename-specific, B-Rep-number-specific, or one-off sample fixes.
- Convert observed sample failures into general STEP relationship, topology, or
  geometry rules.
- Preserve all semantic targets for multi-face features and explicitly retain
  unresolved or ambiguous topology references. Never silently pick a candidate.
- Keep native and tessellation topology identity paths separate for a loaded
  model. See `OCCT_NATIVE_TOPOLOGY_PLAN.md`.
- Prefer targeted edits. Do not refactor unrelated viewer or parser areas while
  solving a local behavior problem.
- Before completion, run `npm run lint` and `npm run build`; parser changes also
  need multi-sample smoke tests.

## Ordered Roadmap

### 1. Complete PMI Presentation

Finish general parsing and viewport rendering for:

1. Profile tolerances.
2. Orientation tolerances: parallelism, perpendicularity, angularity.
3. Form tolerances: flatness, straightness, circularity, cylindricity.
4. Runout and total runout.
5. Remaining angular and compound/composite FCF layouts.

Every renderer must consume `pmiTopologyReferences.ts`; do not invent a second
target-mapping route for a new tolerance type.

### 2. PMI Editing Foundation

After presentation coverage is reliable:

1. Define a serializable editable-PMI model with immutable source provenance.
2. Add create, update, and delete operations for datum features, targets, DRFs,
   dimensions, and FCFs.
3. Resolve edited associations through stable topology signatures on reload.
4. Add validation rules before write-back: target kind, datum sequence, FCF
   compartment validity, tolerance modifiers, and ambiguous references.
5. Design STEP/AP242 write-back only after edit behavior is validated in memory.

### 3. Manufacturing Feature Identification

Build a separate feature-recognition layer that groups exact B-Rep topology into
manufacturing concepts such as holes, counterbores, countersinks, pockets,
slots, planar datum surfaces, bosses, fillets, and chamfers.

It should consume stable faces/edges/vertices and return explainable feature
records. It must not overwrite source STEP semantics or collapse real face
boundaries. PMI may reference a feature record while retaining its original
topology references.

### 4. AI/LLM Integration

Only after stable editing and feature records exist, expose a structured,
auditable model to an LLM:

- Part topology and recognized manufacturing features.
- Parsed and edited PMI with stable target references.
- Datum systems, DRFs, tolerance zones, and validation outcomes.
- Design/manufacturing constraints and traceable recommendations.

The AI layer should propose operations and explanations, not mutate geometry or
PMI without explicit user approval and deterministic validation.

## Handoff Checklist

At the start of a new agent session:

1. Read `AGENTS.md`, this document, and the native topology plan if relevant.
2. Check `git status` and preserve in-progress changes.
3. Identify the semantic STEP structure before changing a renderer.
4. Make the smallest general change across parser/topology/viewport layers.
5. Test the affected NIST fixture plus at least one unrelated fixture for
   parser changes.
6. Run lint and build, then report what was changed and what was verified.

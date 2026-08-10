# Compact PMI Presentation Mode Plan

## Purpose

Add an optional viewport presentation mode that keeps PMI leaders visible while
replacing full annotations with compact, informative markers. Users can expand
or collapse each call directly in the viewport. The objective is to reduce
visual congestion without removing information or automatically rearranging
full annotations during camera navigation.

This is a presentation-layer feature. It must not change STEP parsing, topology
associations, tolerance values, datum relationships, or leader construction.

## Required User Experience

Add a PMI presentation control separate from the geometry render mode:

```text
Full PMI | Compact PMI
```

Existing category visibility controls remain independent:

- Dimensions
- Geometric tolerances / FCFs
- Datum features
- Datum targets
- Datum reference frames

In Compact PMI mode:

1. Every existing leader and arrow remains visible and unchanged.
2. The full callout at the leader endpoint is replaced by a compact marker.
3. Clicking the marker expands the complete callout at the same endpoint.
4. Clicking it again collapses it.
5. Multiple callouts may remain expanded simultaneously.
6. Camera rotation, panning, zooming, render-mode changes, and category toggles
   must not reset expansion state or duplicate annotations.
7. Loading a different STEP file clears expansion state.

## Annotation Ownership

Treat a complete semantic call as one expandable unit. Do not independently
collapse members of an established stack.

```text
Leader
└── Dimension or size call
    └── Feature control frame
        └── Datum triangle / stem / badge
```

Examples of one ownership unit include:

- Hole diameter plus counterbore/countersink/depth rows.
- Thread designation plus depth and attached FCF.
- Dimensional tolerance plus true-position FCF.
- Dimension plus FCF plus datum feature definition.
- A standalone FCF and its leader.
- One datum target call and its target graphic.

The full annotation DOM and compact marker should share one stable annotation
entry. Switching presentation must toggle display state, not reconstruct the
annotation or rerun PMI parsing.

## Marker Design

### Base Shape

- Single-call markers: 24 x 24 CSS pixels.
- Wider symbols such as `S⌀`: up to 28 x 24 CSS pixels.
- Background: white or the existing annotation background.
- Border: 1 px dark neutral.
- Corner radius: 2-3 px; markers should read as technical/CAD UI, not pills.
- Marker size is screen-space and zoom-independent.
- Use the same foreground color and depth-order behavior as full annotations.

DRFs and compound mini-frames may be short rectangles because their segmented
content cannot remain legible inside a square.

### Primary Symbols

Use actual dimension or GD&T meaning as the primary icon. Do not use a generic
plus, eye, or expand symbol as the only indication.

| Call type | Primary marker |
| --- | --- |
| Linear dimension | dimension-line glyph or `↔` |
| Diameter | `⌀` |
| Radius | `R` |
| Spherical diameter | `S⌀` |
| Spherical radius | `SR` |
| Angular dimension | `∠` |
| Depth | `↧` |
| Thread call | `M` |
| Counterbore | `⌴` |
| Countersink | `⌵` |
| Position FCF | true-position symbol `⌖` |
| Profile | the parsed profile symbol |
| Flatness/form/orientation | the parsed GD&T symbol |
| Datum feature | datum triangle plus datum letter |
| Datum target | target symbol plus target identifier |
| DRF | compact segmented frame such as `A│B│C` |

If a platform font cannot reliably render a required engineering symbol, add a
small reusable glyph component for that symbol. Do not substitute an unrelated
UI icon.

### Compound Indicators

A marker representing a compound stack uses:

- The dimension type as the main glyph.
- A small lower-edge FCF indicator when an FCF is attached.
- A small datum indicator when a datum definition is attached.
- A corner count badge only when the marker represents multiple compatible
  call rows or multiple calls sharing one semantic feature.

Keep indicators sparse. The full values remain available through expansion and
the hover tooltip.

## Interaction

- Click marker: toggle that annotation between compact and expanded.
- Hover marker: highlight the associated topology using the existing PMI target
  association and show a concise tooltip containing the complete call summary.
- Click expanded annotation: preserve existing annotation behavior.
- Click empty viewport: clear entity selection, but do not unexpectedly collapse
  user-expanded PMI.
- Category visibility off: hide both compact and expanded forms for that
  category without changing expansion state.
- Category visibility on: restore the previous compact/expanded state.

Markers need accessible button semantics, an `aria-label` containing the call
summary, and a tooltip. Do not add permanent instructional text to the viewport.

## Compact-Mode Decongestion

Implement decongestion only for compact markers in the first version. Do not
move full annotations automatically.

1. Project marker bounds into screen space after camera movement settles.
2. Detect marker-marker overlap with the existing screen-space grid.
3. Stack nearby overlapping markers vertically with 3-4 px spacing.
4. Keep the stack close to the original leader endpoints.
5. Draw a short connector from an offset marker back to its leader endpoint
   when the offset is visually meaningful.
6. Preserve marker ordering and use hysteresis so markers do not flicker or
   swap positions during small camera changes.

When compatible calls share the same feature and leader region, a later
increment may replace the stack with one marker carrying a count badge. Clicking
that marker should reveal the contained markers, not silently discard calls.

## State Model

Suggested application state:

```ts
type PmiPresentationMode = "full" | "compact";

type PmiPresentationState = {
  mode: PmiPresentationMode;
  expandedAnnotationIds: Set<string>;
};
```

Use stable parsed annotation IDs for the current loaded model. Expansion state
is viewport UI state and should not be written into STEP semantics.

Each projected annotation entry should retain references to:

```ts
type PmiPresentationEntry = {
  id: string;
  fullElement: HTMLElement;
  compactElement: HTMLButtonElement;
  leaderObjects: THREE.Object3D[];
  semanticType: string;
  targetIds: string[];
  isExpanded: boolean;
};
```

Adapt this to the existing `PmiDimensionLabelEntry` and datum/DRF caches instead
of creating a parallel renderer with duplicate ownership.

## Architecture Boundaries

Expected implementation areas:

- `src/App.tsx`: owns the selected PMI presentation mode and exposes the mode
  control with the other viewport settings.
- `src/components/CadCanvas3D.tsx`: creates markers, toggles full/compact DOM,
  projects markers, handles marker interaction, and performs marker-only
  decongestion.
- Existing parsed tolerance/datum records: read-only inputs to marker symbol and
  tooltip selection.

Do not modify `stepParser.ts` merely to support compact presentation. If a
marker lacks semantic type information, first verify whether the parsed record
already contains it. Parser changes require separate evidence that semantics
are genuinely missing.

## Non-Regression Rules

- Full PMI mode must render exactly as it did before this feature.
- Do not change leader, arrow, dogleg, projection-line, datum triangle, stem, or
  badge geometry.
- Do not change established annotation anchor selection.
- Do not add filename-specific or B-Rep-number-specific behavior.
- Do not duplicate annotation DOM when toggling modes or visibility categories.
- Dimension, FCF, datum, target, and DRF visibility remain independent.
- Compact mode must work in solid, x-ray, wire, and hidden-edge views.
- Compact/expanded state must not drift when switching camera projection.
- Marker decongestion runs after camera movement settles, never every frame.

## Incremental Implementation

### Increment 1: Presentation Mode and Single Markers

- Add `Full PMI | Compact PMI` control.
- Add marker generation for dimension and FCF call types.
- Keep all leaders visible.
- Implement click expand/collapse with stable state.
- Do not add collision handling yet.

Acceptance:

- Toggling modes does not move or recreate leaders.
- A dimension plus attached FCF expands as one stack.
- Repeated toggling produces no duplicate labels or badges.

### Increment 2: Datum, Target, and DRF Markers

- Add datum feature markers while preserving conventional datum letters.
- Add datum target identifiers and DRF segmented markers.
- Respect all existing category visibility toggles.
- Add target highlighting and concise tooltips.

Acceptance:

- Turning datums off does not hide a dimension or FCF in the same ownership
  stack unless that component is itself the datum graphic.
- Expansion state survives category off/on toggling.

### Increment 3: Compound Marker Language

- Add FCF, datum, and row-count secondary indicators.
- Cover compound hole/counterbore/countersink/thread calls.
- Ensure the longest marker text remains within its bounds.

Acceptance:

- A user can distinguish dimension, FCF, datum, target, and DRF markers without
  expanding them.
- Compound markers remain compact and do not become miniature full callouts.

### Increment 4: Marker-Only Decongestion

- Detect compact marker overlap after camera movement settles.
- Stack overlapping markers with stable ordering and short connectors.
- Add hysteresis and viewport clipping checks.
- Cache marker dimensions and reuse the existing screen-space grid.

Acceptance:

- Markers do not overlap after settling when a nearby stack can resolve them.
- Markers do not flicker or reorder continuously while rotating.
- Expanded full callouts are not moved by this solver.

## Verification Matrix

Use multiple NIST fixtures as behavioral tests, not as sources for special-case
code:

- File 01: linear and radial dimensions with datum/FCF stacks.
- File 02: concentric radial calls and dense FCF content.
- File 04: thread-depth call plus projected true-position FCF.
- File 06: compound dimensions, spherical calls, line targets, and dense DRFs.
- File 09: multipliers, slot/radius calls, and dense annotation layout.

For each fixture verify:

1. Full mode is unchanged.
2. Compact mode preserves every leader.
3. Every marker expands to the correct complete call.
4. No values, multipliers, modifiers, FCF compartments, datum letters, or target
   identifiers are lost.
5. Mode and category toggles create no duplicate DOM or Three.js objects.
6. Rotation, pan, zoom, perspective/orthographic switching, and render-mode
   switching preserve expansion state.
7. Frame rate remains close to Full PMI mode.

Run `npm run lint` and `npm run build` after each increment. Keep commits scoped
to one increment so a visual regression can be reverted without affecting the
remaining PMI renderer.

## Definition of Done

Compact PMI mode is complete when users can navigate a dense annotated model
with leaders visible, identify each collapsed call by its marker, expand any
combination of calls, and recover every original annotation without semantic
loss, duplicate rendering, placement drift, or regression of Full PMI mode.

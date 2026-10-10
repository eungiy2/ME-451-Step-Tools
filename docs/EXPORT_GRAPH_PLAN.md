# STEP File Json Graph Exporter Plan

## Purpose
exportGraph capability in the app (or a script over the same modules) + graphs for all NIST AP242 fixtures, a graph specification document (node/edge schema with rationale and an example snippet per entity type), an   d lint/build passing. Include one AP203 file as a negative control (geometry only, no PMI).

## Goal
Extend the program with an exporter that emits the loaded part as a graph G = (V, E) in JSON, where node and edge attribute design is the deliverable.

## Requirements

### Minimum Geometric Information (explicitly required):
- Face-adjacency graph: node per face, edge per shared topological edge.
- Convexity/concavity of each face-to-face adjacency (the dihedral sign at the shared edge), plus the dihedral angle.
- Surface type per node (plane, cylinder, cone, sphere, torus, B-spline).
- Edge type where relevant (line, circle, ellipse).

### PMI Information (attach, don't merge):
- Nodes for PMI records (datums, dimensions, geometric tolerances/FCFs) with typed attributes (tolerance value, zone shape, modifiers such as ⌀ / MMC / LMC, datum references).
- Edges linking each PMI node to the exact faces/edges it applies to — reuse `pmiTopologyReferences.ts` resolution; do not invent a second mapping route.
- Preserve unresolved/ambiguous associations as explicit attributes — never silently drop or guess them.

### Serialization:
- versioned JSON (e.g. { "graphVersion": 1, "source": {...}, "nodes": [...], "edges": [...] }), one file per loaded part, plus a human-readable summary. Keep it deterministic: same STEP file in, byte-identical graph out (modulo a timestamp field). 

### Design decisions
- Node-per-face should be the base node and node-per-feature should be the derived node.
- Separate tolerance "zone" and "values". They should not be mixed.
- Separate datum reference frame (ordered datum list) without turning the graph into a tree
- For the concavity/convexivity of cyliderical faces, use the smallest component of the mean absolute normal as the axis direction as the viewer code (viewer already does this in interactionCache.CylinderAxis).
- The minimum viable graph shall be: the PMI, the faces it controls, and how those faces join.
- Minimize the structure of the output. Do not have redundancy.

These are settled design decisions, not open options: each is implemented in
`exportGraph.ts` and its rationale is recorded in `EXPORT_GRAPH_SPEC.md` section 11.

The minimum viable graph does not reduce the geometric information required
above. Face adjacency, convexity, dihedral angle, surface type and edge type
remain required; "minimum" governs what is carried beyond them.

## Deliverables 

1. **`exportGraph` capability** — in the app (or a script over the same modules)
2. **Graphs for all NIST AP242 fixtures** — `nist_ctc_01` through `nist_stc_10`, `nist_ftc_06` through `nist_ftc_11`
3. **Graph specification document** — node/edge schema with rationale and an example snippet per entity type
4. **One AP203 file as negative control** — geometry only, no PMI (e.g. `nist_ctc_01_asme1_ap203.stp`)
5. **Lint/build passing** — `npm run lint` and `npm run build` must pass

## Implementation Constraints (Non-negotiable Rules)

- `COMPACT_PMI_MODE_PLAN.md`, `OCCT_NATIVE_TOPOLOGY_PLAN.md`, `PROJECT_ARCHITECTURE_AND_ROADMAP.md` shall be read first before making any modification.
- Changes outside `src/utils/exportGraph.ts` belong on their own branch, one concern per branch. This applies to fixes to existing files as well as to new work: a parser fix and a viewer feature do not belong on the exporter branch.
- All changes must remain general. Do not add filename-specific or sample-specific topology rules.
- Reuse `pmiTopologyReferences.ts` resolution for PMI-to-topology edges — do not invent a second mapping route.
- Preserve unresolved/ambiguous associations as explicit attributes — never silently drop or guess them.

## Accepted Limitations

Each of the following is known, measured, and accepted under the constraints above.
None is to be silently repaired: each stays visible in the exported graph or in the
fixture index.

- **`ADVANCED_FACE` targets that do not resolve.** 12 distinct `(fixture, entity)`
  pairs across the corpus are `ADVANCED_FACE` entities that fail to map to a face,
  10 of them in `nist_ftc_10`. The remaining 62 of 74 distinct unresolved targets
  are legitimately non-face entities — `TRIMMED_CURVE`, `GEOMETRIC_CURVE_SET`,
  `CARTESIAN_POINT`, `SHAPE_ASPECT`, `AXIS2_PLACEMENT_3D`,
  `COMPOSITE_SHAPE_ASPECT`, `PRODUCT_DEFINITION_SHAPE` — for which
  `target-not-mapped` is correct. Complete mapping coverage is not a requirement:
  the requirement is that every miss be reported rather than guessed.

  **The 12 `ADVANCED_FACE` misses are also correct, and must not be "fixed."**
  Every one of them is an open-shell face, not a face of the solid. Across the
  fixture set the AP242 files declare more `ADVANCED_FACE` entities than OCCT
  renders, and the difference is exactly the faces in `OPEN_SHELL` blocks:
  `nist_ftc_10` declares 282 faces against 264 rendered, the 18-face gap being
  12 `OPEN_SHELL` entities. Those shells belong to `SHELL_BASED_SURFACE_MODEL`
  operations named `Extract`, `Join`, `Split`, and `Fill` — the constructive
  history that built the solid, not the solid itself. `applyClosedShellFaceOrderMapping`
  walks `CLOSED_SHELL` only, which is why these faces get no ordinal assignment,
  and the geometric fallback iterates over rendered faces only, so a face that was
  never tessellated is never a candidate. No geometry is lost: the `CLOSED_SHELL`
  carries the whole solid and OCCT renders all of it.

  These faces are drawing annotation. In `nist_ctc_02`, face `#3148` is a single
  `PLANE` in an `OPEN_SHELL('Fill.1')` used by
  `GEOMETRIC_ITEM_SPECIFIC_USAGE('', 'DATUM TARGET', ...)` and
  `GEOMETRIC_ITEM_SPECIFIC_USAGE('', 'NOTE', ...)` — a datum target zone and a
  leader note. A PMI target pointing at it is pointing at presentation, so
  `target-not-mapped` is the right answer. Do not extend the mapper to reach
  open-shell faces, and do not add a fallback that assigns them to a nearby
  rendered face.

  A paren-depth scan replaced a non-greedy entity regex in
  `autoGenerateFaceMapping` on branch `fix/advanced-face-paren-scan`, because the
  old pattern truncated every `ADVANCED_FACE` at the closing parenthesis of its
  `FACE_BOUND` list. Correcting it exposed the binding defect described above,
  which was also present in the exported graphs: `nist_ftc_10` had four mesh
  faces each carrying three STEP identities. Only `CLOSED_SHELL` faces take part
  in geometric matching now, the four multi-identity face nodes are gone, and
  `nist_ftc_10` moves from 43 to 51 missing references because eight references
  naming annotation faces are now correctly reported unresolved.
- **Partial arcs of a diagonal-axis bore.** The cylinder axis follows the viewer's
  coordinate-axis rule. The perpendicularity gate catches a full-ring bore whose
  axis lies off a coordinate axis and withholds the radius, but a small partial arc
  of such a bore is not reliably caught. Accepted as a limit of the heuristic.
- **`nist_stc_07_asme1_ap242-e3.stp` produces no graph.** The OCCT importer fails
  to initialize for this fixture, and `nist_ftc_08_asme1_ap242-e1-tg.stp` carries
  no renderable geometry. Both are listed in `graphs/index.json` with a status and
  reason. They are never exported as empty graphs, because an empty graph reads as
  success.
- **`datumOrder` duplicates the `component` edge ordering.** Retained deliberately
  as a convenience for consumers that do not traverse edges. `hasToleranceModifiers`
  is likewise retained: it disagrees with `modifiers.length > 0` on 5 of 376
  geometric tolerances and so carries independent information.
- **Smallest-eigenvector utilities are off the cylinder path.** The axis now comes
  from the viewer's rule, so `smallestEigenvector` and `symmetric3Eigenvalues` no
  longer serve the fit. They remain exported and tested as general linear-algebra
  helpers.

## Schema Design Notes (for the graph specification document)

The graph specification document must include:
- **Node types**: Face, Edge, Vertex, Datum, Dimension, GeometricTolerance (FCF), DatumReferenceFrame, DatumTarget
- **Edge types**: Adjacency (face-face), PMI-Topology (PMI node → face/edge), DatumReference (DRF → Datum), Component (DRF → ordered datum list)
- **Required attributes per node type** with types, units, and rationale
- **Example JSON snippet** per entity type
- **Versioning strategy** for graph schema evolution
- **Determinism guarantees** (ordering, rounding, timestamp handling)

## Convexity/Concavity Computation Strategy

For face-face adjacencies:
- Use the existing OCCT native topology to get shared edges
- Compute dihedral angle using face normals at the shared edge midpoint
- For cylindrical/partial-cylindrical faces: fit cylinder axis (viewer already does this in `interactionCache.cylinderAxis`), compute angle between face normal and cylinder axis to determine convexity sign
- Store: `dihedralAngle` (radians), `convexity` ("convex" | "concave" | "flat"), `sharedEdgeId`

## PMI-to-Topology Edge Strategy

- Call `enrichPmiTopologyReferences(parsed, occtResult, faceMapping)` to get resolved topology references
- For each PMI record with `topologyReferences`, create edges to the resolved `runtimeId` (e.g., `BRepFace-7`)
- Include `resolution` and `resolutionReason` as edge attributes
- For `ambiguous` resolutions, include `candidateRuntimeIds` array
- For `missing` resolutions, include `resolutionReason` explaining why (e.g., "target-not-mapped", "stable-signature-unavailable")

## Determinism Requirements

- Face ordering: by `runtimeId` numeric suffix (`BRepFace-0`, `BRepFace-1`, ...)
- Edge ordering: by source face ID then target face ID
- PMI node ordering: by entityId from STEP file
- Float values: round to 6 decimal places
- Omit `timestamp` field from comparison; include in output for traceability
- Same input STEP file → byte-identical JSON output (excluding timestamp)


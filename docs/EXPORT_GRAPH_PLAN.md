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

## Design Questions to Answer (and defend in report)

1. **Node-per-face vs. node-per-feature**: which goes in the base graph and which is derived? (The codebase roadmap already plans a feature-recognition layer — Task 2 builds the substrate it would consume.)

2. **Tolerance zones vs. tolerance values**: How do you represent tolerance *zones* vs. tolerance *values*?

3. **Datum reference frames**: How do you represent a datum reference frame (ordered datum list) without turning the graph into a tree?

4. **Convexity/concavity for cylindrical faces**: What convexity/concavity computation do you use for cylindrical and partial-cylindrical faces (hint: the viewer code already fits cylinders)?

5. **Minimum viable graph**: What is the minimum graph that still lets an LLM answer manufacturing questions? Bigger is not better — every extra attribute is context-window cost in Task 3.

## Deliverables 

1. **`exportGraph` capability** — in the app (or a script over the same modules)
2. **Graphs for all NIST AP242 fixtures** — `nist_ctc_01` through `nist_stc_10`, `nist_ftc_06` through `nist_ftc_11`
3. **Graph specification document** — node/edge schema with rationale and an example snippet per entity type
4. **One AP203 file as negative control** — geometry only, no PMI (e.g., `nist_ctc_01_asme1_ap203.stp`)
5. **Lint/build passing** — `npm run lint` and `npm run build` must pass

## Implementation Constraints (Non-negotiable Rules)

- `COMPACT_PMI_MODE_PLAN.md`, `OCCT_NATIVE_TOPOLOGY_PLAN.md`, `PROJECT_ARCHITECTURE_AND_ROADMAP.md` shall be read first before making any modification.
- Files in this project shall not be modified besides `exportGraph.ts` in `src/utils`.
- All changes must remain general. Do not add filename-specific or sample-specific topology rules.
- Reuse `pmiTopologyReferences.ts` resolution for PMI-to-topology edges — do not invent a second mapping route.
- Preserve unresolved/ambiguous associations as explicit attributes — never silently drop or guess them.

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


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
- Original files in the directory shall not be modified or deleted. You may create new files if required in `src/utils`, but you shall ask for a permission before proceeding.
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


# Graph Specification — `graphVersion` 1

The serialized graph emitted by `src/utils/graphExporter.ts` (`exportGraph`),
defined by `docs/EXPORT_GRAPH_PLAN.md`. One JSON file per loaded part.

## Producing graphs

- **In the app:** the header **Export Graph** button downloads
  `<part>.graph.json` for the currently loaded part.
- **CLI (all fixtures):**
  ```text
  npm run export:graphs            # writes graphs/*.graph.json + *.summary.txt
  npm run graph:budget             # writes graphs/token-budget.csv + .json
  npm run verify:graph             # cube end-to-end + determinism + negative control
  npm run verify:graph:kernel      # kernel payload + exporter consumption (no wrapper needed)
  npm run verify:convexity        # pure-geometry cylinder/dihedral checks
  ```
  Node scripts use the local `occt-import-js` wasm (tessellation fallback)
  offline. To opt into kernel geometry, point them at the published Node ESM
  wrapper (`argv[2]` or `OCCT_WRAPPER_PATH`):
  `npx tsx scripts/exportGraphs.ts public/occt-native/occt-import-js.node.mjs`.
  Graphs exported that way report `source.kernelGeometry: true`.

## Conventions

- Every node has `nodeType` and `id`; every edge has `nodeType`, `id`,
  `sourceId`, `targetId`.
- Topology-corresponding nodes carry `stableId` (OCCT `occt:v1:*` signature,
  `occtTopologyPayload.ts`) and, when a STEP entity maps to them, `stepped`
  (e.g. `#1837`). Identity therefore survives retessellation and reload.
- Scalars are rounded to 6 significant digits (`canonicalNumber`). Nodes are
  sorted by `(nodeType, id)`; edges by `(nodeType, sourceId, targetId,
  precedence)` — byte-identical output for the same input.
- No timestamp inside the graph. Sources (`geometryTopologySource`) and counts
  live in the `source` block.

## Node types

| type | layer | description |
|---|---|---|
| `part` | base | one per graph; material, envelope mm, feature counts, PMI resolution summary |
| `face` | base | one per B-Rep face; surface type, area, face-level convexity, exact OCCT kernel analytic parameters where the surface is analytic, stable id |
| `datum` | PMI | datum letter (plane / cylinder axis / median plane / point / multiface) |
| `datumReferenceFrame` | PMI | ordered datum list; `constraints: [3,2,1]` derived by data type |
| `commonDatum` | PMI | shared group node for `A-B` compound datums |
| `toleranceValue` | PMI | geometric FCF literals (type, symbol, value, material condition) |
| `toleranceZone` | PMI | the 3D region (shape, size, projected height, related-to-DRF) |
| `dimension` | PMI | dimensional calls (kind, nominal, upper/lower, basic/reference) |
| `feature` | derived-geometry | hole / counterbore aggregate over concave coaxial cylinder faces |

## Edge types

| type | source → target | attributes |
|---|---|---|
| `adjacency` | face → face | `edgeType` (line/circle/ellipse/other), `convexity` (convex/concave/unknown), `dihedralDeg`, `sharedEdgeId`, `sharedEdgeStableId`; `geometrySource: "occt"` when the OCCT kernel classified the pair |
| `appliesTo` | toleranceValue / dimension / datum → face/edge or `#stepId` | `resolution`, `resolutionReason`, `candidateRuntimeIds` |
| `datumOf` | datum → face/edge | same resolution contract as `appliesTo` |
| `defines` | toleranceValue / dimension → toleranceZone | — |
| `usesDRF` | toleranceValue / dimension → datumReferenceFrame | — |
| `drfReferences` | datumReferenceFrame → datum / commonDatum | `precedence`, `modifier`, `constrainsDOF` |
| `memberFace` | feature → face | — |

PMI attach edges repeat the outcome from `pmiTopologyReferences.ts`
(`resolved` / `missing` / `ambiguous`) **verbatim** — unresolved associations
are preserved as edges to the STEP entity id (e.g. `appliesTo → #553` with
`resolution: "missing"`), never silently dropped or guessed.

## Convexity, dihedral, and analytic surface parameters

These geometric attributes are computed **inside the OCCT kernel** by the
custom native wrapper (`native/occt-topology-wrapper/`). The TypeScript math in
`src/utils/cylinderFit.ts` / `src/utils/convexity.ts` remains only as the
explicit tessellation-reconstruction fallback.

Kernel-computed payload consumed by the exporter:

- **Exact surface parameters** (`face.analytic` — `BRepAdaptor_Surface` gives
  the `gp_Pln`/`gp_Cyl`/`gp_Cone`/`gp_Sphere`/`gp_Torus` primitive directly):
  `plane` (normal+point), `cylinder` (axis+center+radius), `cone`
  (axis+apex+semi-angle+reference radius), `sphere` (center+radius), `torus`
  (center+axis+major/minor radius). Cone/sphere/torus faces are classified
  exactly; the tessellation fallback could not distinguish them.
- **Face-level convexity** (`face.convexity`) — in-kernel
  `FaceConvexityLabel`: sample the face bounding-box corners projected onto the
  surface (`GeomAPI_ProjectPointOnSurf`) and take
  `sign(outward normal · radial)`; `convex` = boss/outer cylinder,
  `concave` = bore/hole, thresholds ±0.05 (same as the TS fallback).
- **Adjacency (`adjacency.convexity` + `dihedralDeg`)** — per edge the kernel
  evaluates outward unit normals of both incident faces at the exact edge-curve
  midpoint (`BRep_Tool::CurveOnSurface` pcurves with a projection fallback),
  then classifies the pair with the interior-side probe formula
  (`p = centroid1 − τ·n̂1`, `side = (p − m)·n2`, convex iff `side < 0`), giving
  `δ = π − γ` (convex) / `π + γ` (concave) from exact `γ = acos(n̂1·n̂2)`.
  Results ship per edge as `contacts` (`{face_i, face_j, convexity,
  dihedral_deg}`), in the exporter's sorted face-pair order (`face_i` is the
  smaller `BRepFace-*` id).
- **Face-1 reference data** (`face.centroid_point` + `face.centroid_normal`) —
  the surface point nearest the face center of gravity and its outward unit
  normal, used for the probe.

Exporter consumption: `face.analytic` and `face.convexity` override the TS
fits; adjacency edges use `edge.contacts` directly. Kernel-derived faces and
adjacencies carry `geometrySource: "occt"`; the `source` block reports
`kernelGeometry: true` when every adjacency on the run was kernel-derived.

Data-source agreement: with the native wrapper present, the graph's geometry is
kernel-exact — no tessellation noise in normals, edge midpoints, or fits. The
Node export scripts use the standard tessellation wrapper offline by default
(`scripts/occtNode.ts`); pass a Node-importable native wrapper path to opt into
kernel geometry. `npm run verify:graph:kernel` exercises both kernel
consumption paths with a synthetic wrapper payload plus the real cube fixture.

## PMI: tolerance values vs zones

Every callout splits into a `toleranceValue` (literals) and a `toleranceZone`
(region), connected by `defines`.

```json
{
  "nodeType": "toleranceValue", "id": "tv-21", "entityId": "#460",
  "type": "Position", "symbol": "\u2316", "value": 0.5, "unit": "mm",
  "category": "Location", "materialCondition": "MMC", "statistical": false
}
{
  "nodeType": "toleranceZone", "id": "tz-21",
  "shape": "cylindrical", "size": 0.5, "projectedHeight": 12.0,
  "relatedToDRF": true
}
```

Dimensional (size) tolerances use `shape: "size_limits"` so every control keeps
the uniform `1 value : 1 zone` shape. `effectiveSize` (nominal + material
condition bonus) is deferred: it requires size-deviation data that the STEP
records do not carry.

## Datum reference frames without a tree

One shared `datumReferenceFrame` node per frame; order is an edge attribute:

```json
{
  "nodeType": "datumReferenceFrame", "id": "drf-13", "label": "A | B | C",
  "constraints": [3, 2, 1]
}
{
  "nodeType": "drfReferences",  "id": "drfref-drf-13-2",
  "sourceId": "drf-13", "targetId": "d-B", "precedence": 2,
  "modifier": "MMB", "constrainsDOF": 2
}
```

Datums are shared and multiply-referenced — "every DRF using datum A" is one
incoming-edge walk, not subtree matching. Compound datums (`A-B`) collapse to a
`commonDatum` group node.

## Determinism

1. Fixed-precision scalars everywhere (6 significant digits).
2. Stable sort of all nodes/edges; DRF order by `(precedence, datum, modifier)`.
3. `stableId` (OCCT signatures) is the semantic key; the runtime `BRepFace-*`
   numbering is an ordinary attribute.
4. No timestamps. `stableHash` = FNV-1a over sorted node/edge identities.
5. Asserted by tests: exporting twice yields byte-identical JSON.

## Minimum-graph rationale and token budget

NIST AP242 fixtures are 0.39–6.0 MB raw STEP (~110k–1.7M tokens). The exported
graphs are measured, not estimated: `npm run graph:budget` writes
`graphs/token-budget.csv` + `.json` (heuristic ~3.5 chars/token on the compact
serialization). The current corpus (16 fixtures, native OCCT wrapper,
`source.kernelGeometry: true`) reduces **~8x** overall; per fixture 2.3x–38.8x.

| fixture | nodes | edges | raw tokens | graph tokens |
|---|---|---|---|---|
| ctc_01 ap242 | 187 | 426 | ~113k | ~42k |
| ftc_06 ap242 | 340 | 850 | ~563k | ~75k |
| ftc_07 ap242 | 463 | 1291 | ~422k | ~120k |
| corpus total | — | — | ~10.8M | ~1.34M |

The earlier draft budget (~3–8k tokens) assumed a hand-curated node/edge count;
the measured serialized graph is larger because every adjacency edge carries
its attributes and identity. Two payload levers already applied or available:

- **Applied:** verbose STEP topology signatures per adjacency edge are reduced
  to compact deterministic hashes (`step:v1:<fnv1a>`), cutting ~30% of graph
  bytes in tessellation fallback mode.
- **Available:** drop per-edge identity from the LLM-facing variant, shorter
  JSON keys, or emit per-capability-level summaries instead of one flat dump.
  These are deliberate ablation axes for Task 3, not hidden defaults.

What we permanently exclude (no L0–L5 payoff): tessellation/vertex coordinates,
B-spline control data, PMI presentation geometry, parser
`clinicalContext`/evaluation-note strings, and per-face centroids/vertex
counts (the part envelope comes from the meshes).

## Known gaps

- **Material / surface finish / cost basis** are not in STEP; `part.material`
  must be backfilled from part metadata for L4/L5.
- **Tessellation-mode fallback** (default in the Node scripts) has no native
  stable signatures or analytical `surface_type`, so PMI references resolve to
  `missing` (preserved explicitly), face surface types come from the
  auto-classifier, and convexity/dihedral come from the TypeScript fits
  (`source.kernelGeometry: false`). Use the rebuilt native wrapper for full
  kernel-derived geometry (`npm run verify:graph:kernel`).
- **Feature recognition is best-effort geometry** in v1 (`provenance:
  "geometry"`): coaxial concave cylinders are grouped into `hole` /
  `counterbore`. Requires NIST documented ground-truth spot-checks before
  experiment use. Pilot vs counterbore labels follow radius order and may be
  semantically inverted for some fixtures — verify per part.
- **Composite/multi-segment FCFs** flatten to one zone in v1; two zone nodes
  per segment is a future extension.
- The AP242 `nist_stc_07` and `nist_ftc_08_asme1_ap242-e1-tg` fixtures cannot
  be meshed by the occt-import-js 0.0.23 importer (known upstream
  limitations, see `docs/OCCT_NATIVE_TOPOLOGY_PLAN.md`) and are therefore not
  exported.

## Negative control

`verifyGraphExporter.ts` runs the full pipeline on the cube fixture:
6 faces, 12 convex adjacencies (~90°), zero PMI nodes, zero feature nodes, and
a byte-identical double export — the AP203 "geometry only" control.
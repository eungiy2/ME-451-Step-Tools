# Graph Exporter Integration Plan

## Goal

Extend the program with an exporter that emits the loaded part as a graph
`G = (V, E)` in JSON, where node and edge attribute design is the main output.
The exporter must be integrated with the project and must not alter the
existing STEP → parse → topology → viewer pipeline. It emits graphs for all
NIST AP242 fixtures plus one AP203 negative control, and a graph
**specification document**.

The exported graphs feed two downstream consumers:
- **LLM capability experiments** — running a fixed set of increasingly
  difficult questions against a text-based LLM (parse → feature recognition →
  tolerance comprehension → design commentary → manufacturing prediction →
  time/cost estimation).
- **Dataset construction** — pairing each graph with a labeled descriptor
  (features, tolerances, manufacturing operations) for later machine-learning
  training.

---

## Design Requirements

### 1. Minimum geometric information

- Face-adjacency graph: node per face, edge per shared topological edge.
- Convexity/concavity of each face-to-face adjacency (the dihedral sign at the
  shared edge), plus the dihedral angle.
- Surface type per node (plane, cylinder, cone, sphere, torus, B-spline).
- Edge type where relevant (line, circle, ellipse).

### 2. PMI information (attach, don't merge)

- Nodes for PMI records (datums, dimensions, geometric tolerances/FCFs) with
  typed attributes (tolerance value, zone shape, modifiers such as ⌀ / MMC /
  LMC, datum references).
- Edges linking each PMI node to the exact faces/edges it applies to — reuse
  `pmiTopologyReferences.ts` resolution; do not invent a second mapping route.
- Preserve unresolved/ambiguous associations as explicit attributes — never
  silently drop or guess them.

### 3. Serialization

- Versioned JSON: `{ "graphVersion": 1, "source": {...}, "nodes": [...],
  "edges": [...] }`, one file per loaded part, plus a human-readable summary.
  Keep it deterministic: same STEP file in, byte-identical graph out (no
  timestamp inside the graph).

### 4. Base nodes vs derived nodes

| Base node types (substrate)          | Derived node types (layers on top) |
| ------------------------------------ | ---------------------------------- |
| `part`, `face`, `adjacency` edges    | `feature` (node-per-feature), PMI nodes (`datum`, `datumReferenceFrame`, `toleranceValue`, `toleranceZone`, `dimension`) |

The base graph must be a faithful, deterministic face-adjacency substrate — the
ground truth everything else derives from. Rationale:

1. **PMI resolution dictates identity.** The pipeline resolves every datum /
   dimension / FCF to `BRepFace-*` / `BRepEdge-*` / `BRepVertex-*` anchors via
   `pmiTopologyReferences.ts`. The base graph must be keyed to exactly those
   entities so the exporter reuses that resolution instead of inventing a second
   mapping route (Requirement 2).
2. **Feature recognition is defined as a consuming layer.** The product roadmap
   ("Manufacturing Feature Identification") says the recognition layer
   "consumes stable faces/edges/vertices and returns explainable feature
   records. It must not overwrite source STEP semantics or collapse real face
   boundaries." That is the definition of a derived layer over the substrate
   this exporter builds.
3. **Features are heuristic aggregates.** Current code already treats
   feature-like things as aggregates over cylinders/targets (`holes` at
   `stepParser.ts:1578`, counterbore = merged pilot+spotface targets at
   `stepParser.ts:4294`). Putting them in the base would make the ground-truth
   graph non-deterministic.
4. **Ablations stay clean.** Strip feature nodes, strip PMI edges, strip
   convexity attributes — each is independent of base identity, which lets the
   capability experiments measure exactly what each attribute contributes.

### 5. Convexity/concavity of cylindrical and partial-cylindrical faces

**The viewer already fits cylinders; reuse it.** Two mechanisms exist in
`src/components/CadCanvas3D.tsx`:

- `computeFaceInteractionCache` (line 836): estimates `cylinderAxis` from the
  face's vertex normals — the axis whose direction has the smallest mean
  |normal| component (normals of a cylinder are radial, ⟂ axis). Stored in
  `userData.interactionCache.cylinderAxis` with `localCenter` / `coherentNormal`.
- `getCylinderFaceCircleSnap` (line 2044): the real fit used by the measurement
  engine:
  1. axis estimate from pairwise cross products of sampled vertex normals;
  2. project all face vertices onto the plane ⟂ axis (`uAxis`, `vAxis`);
  3. algebraic least-squares circle fit (Cramer's rule solve of the 3×3 normal
     equations for `x²+y² + Ax + By + C = 0`; center `(−A/2,−B/2)`,
     radius `√(center²−C)`);
  4. validate residual: `maxDeviation/radius ≤ 0.12` and normal–radial
     alignment `≥ 0.55`.

**Fit data-source priority (determinism), kernel-first:**

1. **OCCT kernel analytic** — the exact `gp_Pln` / `gp_Cyl` / `gp_Cone` /
   `gp_Sphere` / `gp_Torus` parameters, the face-level convexity, and the
   per-adjacency dihedral are all computed **inside the OCCT kernel**
   (`WriteNativeTopology` in `native/occt-topology-wrapper/`) and shipped as
   `face.analytic`, `face.convexity`, `face.centroid_point`/`_normal`, and
   per-edge `midpoint` / `normals` / `contacts`. This is the authoritative
   source whenever the native wrapper is present.
2. **Analytical STEP** `CYLINDRICAL_SURFACE` origin/axis/radius, already parsed
   (`stepParser.ts:1288–1392`, `getCylinderSurfaceFrame` at `stepParser.ts:3519`)
   and mapped to faces (`geometryClassifier.ts:593–616`) — retained as a
   cross-source for PMI association and debugging.
3. **Viewer-style tessellation fit** (`getCylinderFaceCircleSnap` logic, kept in
   `src/utils/cylinderFit.ts`) as the fallback only when the kernel analytic
   data is absent (tessellation mode / old wrapper). The Node scripts verify
   the fallback path, and `npm run verify:graph:kernel` verifies the kernel
   path with a synthetic wrapper payload.

**Convexity of the face itself (boss vs hole):** anchor the existing `isInner`
test (`geometryClassifier.ts:70–92` — mean `(triangleCenter−faceCenter)·n̂`)
on the *fitted axis* instead of the mesh centroid:

```
foot(p) = center + axis * ((p − center) · axis)
faceConvexity = sign( mean over samples p of (p − foot(p)) · n̂ )
  > 0 → convex (boss/outer cylinder), < 0 → concave (hole/bore), ≈0 → unknown
```

**Dihedral on a shared edge (the required adjacency attribute):** for each edge
with incident faces `f1, f2`, the **OCCT kernel** evaluates everything at the
exact edge-curve midpoint `m` (`BRepAdaptor_Curve::Value`):

1. Outward unit normals `n1, n2` at `m` via each face's pcurve on the edge
   (`BRep_Tool::CurveOnSurface` → `GeomLProp_SLProps`), flipped by face
   orientation so they point away from the material (projection fallback when
   the pcurve is unavailable).
2. `γ = acos(clamp(n1·n2, −1, 1))`.
3. Interior-side probe: `p = centroid1 − τ·n̂1` (slightly inside the solid from
   face 1; `centroid1` is the surface point nearest the kernel-computed face
   center of gravity, `τ` scales with the face bounding diagonal). The edge is
   **convex** iff `(p − m)·n2 < 0` (still inside face 2), else **concave**.
   The test needs only per-face consistent outward orientation — no global
   edge-tangent orientation, no loop-direction bookkeeping.
4. Dihedral angle: `δ = π − γ` (convex) or `π + γ` (concave). Emit
   `convexity` + `dihedralDeg` per incident-face pair (`edge.contacts`, with
   `face_i` the smaller `BRepFace-*` id).

Partial-cylindrical and other curved faces need no special case: the kernel
returns the true surface normal at the edge midpoint instead of a fitted/radial
approximation, so curved mid-edge normals are exact.

Fallback implementation (tessellation mode / old wrapper): the identical
formula runs in TypeScript in `src/utils/convexity.ts`
(`computeAdjacencyDihedral`) over the fitted cylinder/plane normals from
`src/utils/cylinderFit.ts`, retaining the pre-kernel behavior so the Node
scripts stay byte-deterministic offline.

### 6. Tolerance zones vs tolerance values

**Two typed nodes per FCF, not one merged node.** The parser already separates
the raw material (`ParsedStepTolerance`, `stepParser.ts:30–93`): value-ish
fields (`value`, `nominalDimension`, `upper/lowerTolerance`, limits,
`toleranceModifiers`) and zone-ish fields (`toleranceZoneForm`,
`toleranceZoneDiameter`, `projectedToleranceZoneHeight`). The exporter routes
existing fields into two nodes — a serialization choice, no parser rewrite.

- `toleranceValue` node: literals only. `kind: geometric | dimensional | limit`,
  type/symbol, `value`, unit, nominal/upper/lower (or upper/lower limit),
  `materialCondition` (MMC/LMC/RFS), `statistical`.
- `toleranceZone` node: the 3D region. `shape` (cylindrical, two_parallel_planes,
  spherical, profile, size_limits), `size` (diameter or width),
  `projectedHeight`, `relatedToDRF` (position/orientation/profile = related;
  form = unrelated), `drfPrecedence`, and **derived** `effectiveSize`
  (nominal + material-condition bonus) — flagged derived, never parsed truth.
- Edge `defines`: `toleranceValue → toleranceZone`.

Why split: distinct STEP identities (`GEOMETRIC_TOLERANCE` vs
`TOLERANCE_ZONE` / `TOLERANCE_ZONE_FORM`) → clean provenance; ablation of zone
geometry independent of callout value; material-condition bonus math is a
*computed* quantity; zone related/unrelated semantics carry the GD&T meaning
(flatness = floating zone vs position = DRF-located); queries like "which
callouts have cylindrical zones?" become attribute scans.

Dimensional (size) tolerances get `shape: "size_limits"` so every context keeps
the uniform `1 value : 1 zone` shape.

### 7. Datum reference frame without a tree

**One shared `datumReferenceFrame` node; order is an edge attribute, not a
hierarchy.** The parser already stores DRFs as flat, explicitly ordered lists
(`ParsedStepDatumReferenceFrame.references`, `precedence: 1|2|3`,
`stepParser.ts:173–201`) and links each tolerance to its frame
(`stepParser.ts:6076–6085`, `toleranceEntityIds` at line 198).

Two tree traps avoided:
1. **No datum-chain subtree per tolerance** — DRFs are shared (many tolerances
   → one frame), so nesting would duplicate every FCF's datum list.
2. **No parent-child precedence** — a datum can be primary in one DRF and
   secondary in another; single-parent trees cannot express this without
   duplicating the datum node.

Represent in the edge list:
- `datumReferenceFrame → datum` edges carry `precedence` (1|2|3),
  `modifier` (RMB default; MMB/LMB on datum reference), and derived
  `constrainsDOF` (3/2/1 by datum feature type). Ordering = stable sort
  `(precedence, datumId, modifier)` — byte-identical, matching the parser's
  existing `sort(precedence)`.
- Common datums (`A-B`, `isCommonDatum` at `stepParser.ts:573`): a small shared
  group node `commonDatum` with member edges to the datum feature nodes; each
  member stays independently referenceable.
- Datum nodes are shared and multiply-referenced (incoming edges from many
  DRFs), which is structurally why this is not a tree: "find every DRF using
  datum A" is one incoming-edge walk.

### 8. Minimum graph that still answers manufacturing questions

To scope the size of the graph, six capability levels are used as the test
questions: **(L0) parse** faces/surface types/adjacency; **(L1) feature
recognition** — identify holes, slots, pockets, counterbores with supporting
face IDs; **(L2) tolerance comprehension** — explain each feature control frame
and its datum reference frame; **(L3) design commentary** — datum scheme,
stack-up risk, manufacturability; **(L4) manufacturing prediction** —
operations, sequence, machine setup; **(L5) time/cost estimation**.

Measured baseline — NIST AP242 fixtures are **0.39–6.0 MB** raw STEP
(= ~100k–1.5M tokens); the same parts have only **117–304 faces** and
**41–292 PMI references**.

**Principle: an attribute belongs in the graph only if removing it flips or
blocks an answer to some L0–L5 question.**

| Level | What the LLM must answer | Load-bearing content |
|---|---|---|
| L0 | faces, surface types, adjacency count | face nodes, surfaceType, adjacency edges |
| L1 | holes/slots/pockets/counterbores + face IDs | derived feature nodes (kind/axis/diameter/depth, `memberFaces`), face convexity |
| L2 | explain each FCF + DRF | toleranceValue + toleranceZone + DRF + `appliesTo` edges + `datumOf` edges |
| L3 | datum scheme, stack-up, manufacturability | DRF relations, basic dimensions, convexity, feature types, material |
| L4 | operations/sequence/setup | feature axes (setup grouping), depths, thread specs, convexity (internal vs external) |
| L5 | time/cost | feature counts/sizes/tolerances, part envelope, material |

**Estimated graph budget** (draft, to be measured by the exporter):

| Representation | ctc_01 (117 faces) | ftc_06 (187) | ftc_07 (304, densest PMI) |
|---|---|---|---|
| Raw STEP | ~100k tok | ~500k tok | ~375k tok |
| Minimal graph | ~2.5–4k | ~5–7k | ~8–12k |
| + graph spec (control condition) | +2–4k | +2–4k | +2–4k |

**Explicit exclusion list** (context tax with no L0–L5 payoff):
- tessellation / vertex coordinates / bounds arrays per face;
- B-spline/NURBS control data (keep `surfaceType: "b_spline"` only);
- PMI presentation geometry (leader coordinates, glyph strokes, doglegs);
- parser `clinicalContext` / evaluation-note strings (verbose free text);
- face centroids and vertex counts.

**Material caveat:** material, surface finish, and cost basis are *not* in
STEP. L4/L5 are unanswerable without them, so a `part` node carries material
from a separate part-metadata record — a declared metadata gap, not a parse gap.

**"Minimum" is empirical.** Export the draft, run the L0–L5 questions, add an
attribute only when a question fails and a single-attribute ablation shows the
attribute flips the answer. The experiments report the resulting
*attribute → level* table and the token-cost curve for each fixture.

---

## Design constraints

1. Read `docs/PROJECT_ARCHITECTURE_AND_ROADMAP.md`,
   `docs/OCCT_NATIVE_TOPOLOGY_PLAN.md`, and `docs/COMPACT_PMI_MODE_PLAN.md`
   before implementing any changes.
2. The exporter shall not modify the data pipeline flow described in those
   documents.
3. The exporter must be general — no filename-, B-Rep-number-, or
   sample-specific rules.

---

## Node & Edge Schema (graphVersion 1)

All nodes share `nodeType` and `id`. All topology-corresponding nodes carry
`stableId` (OCCT `occt:v1:*` signature from `occtTopologyPayload.ts:127–156`)
plus their STEP entity id (`stepped`) when mapped, so identity survives
retessellation and reload.

### Nodes

```jsonc
// part  (base, 1 per graph)
{ "nodeType": "part", "id": "part-1", "name": "nist_ctc_01_asme1_ap242-e1",
  "material": "Ti-6Al-4V (from part metadata)",
  "envelopeMm": { "x": 60, "y": 40, "z": 10 },
  "featureCounts": { "hole": 6, "counterbore": 2, "thread": 0, "slot": 1 } }

// face  (base)
{ "nodeType": "face", "id": "BRepFace-3", "stableId": "occt:v1:face:1a2b…",
  "surfaceType": "cylinder", "areaMm2": 188.5, "convexity": "concave",
  "analytic": { "cylinder": { "axis": {"x":0,"y":0,"z":1}, "radius": 5.0, "lengthMm": 6.0 } },
  "stepped": "#1837" }

// datum  (PMI layer)
{ "nodeType": "datum", "id": "d-A", "entityId": "#312", "datumType": "cylinder_axis",
  "stepped": "#312" }                       // → base node via datumOf edges

// datumReferenceFrame  (PMI layer)
{ "nodeType": "datumReferenceFrame", "id": "drf-13", "label": "A | B | C",
  "constraints": [3, 2, 1] }                // derived

// commonDatum  (PMI layer, only when referenced as A-B)
{ "nodeType": "commonDatum", "id": "cd-A-B", "label": "A-B", "members": ["d-A", "d-B"] }

// toleranceValue  (PMI layer)
{ "nodeType": "toleranceValue", "id": "tv-21", "entityId": "#460", "kind": "geometric",
  "type": "Position", "symbol": "⌖", "value": 0.5, "unit": "mm",
  "materialCondition": "MMC", "statistical": false }

// toleranceZone  (PMI layer)
{ "nodeType": "toleranceZone", "id": "tz-21", "shape": "cylindrical", "size": 0.5,
  "projectedHeight": 12.0, "relatedToDRF": true,
  "effectiveSize": 0.7 }                    // DERIVED (bonus), flagged

// dimension  (PMI layer)
{ "nodeType": "dimension", "id": "dim-7", "kind": "diameter", "nominal": 10.0,
  "upper": 0.02, "lower": -0.01, "basic": false, "reference": false,
  "entityId": "#2881" }

// feature  (derived geometric layer)
{ "nodeType": "feature", "id": "feat-cbore-4", "kind": "counterbore",
  "provenance": "pmi",                      // geometry | pmi | step
  "axis": {"x":0,"y":0,"z":1}, "pilotDiameter": 5.0, "counterboreDiameter": 8.0,
  "depth": 4.0, "memberFaces": ["BRepFace-9", "BRepFace-10", "BRepFace-11"] }
```

### Edges

| Edge `nodeType` | Source | Target | Key attributes |
|---|---|---|---|
| `adjacency` (base) | face | face | `edgeType` (line/circle/ellipse/other), `convexity`, `dihedralDeg`, `sharedEdgeId`, `sharedEdgeStableId` |
| `appliesTo` (PMI attach) | toleranceValue / dimension / datum | face / edge | `resolution: "resolved"\|"missing"\|"ambiguous"` (from `pmiTopologyReferences` contract) |
| `defines` | toleranceValue | toleranceZone | — |
| `usesDRF` | toleranceValue / dimension | datumReferenceFrame | — |
| `drfReferences` (ordered) | datumReferenceFrame | datum / commonDatum | `precedence`, `modifier`, `constrainsDOF` |
| `datumOf` | datum | face / edge | — |
| `memberFace` | feature | face | — |

Every PMI attach edge repeats the resolution outcome verbatim from
`pmiTopologyReferences.ts` (`resolved` / `missing` / `ambiguous`). Never guess a
candidate for a missing or ambiguous target (Requirement 2).

---

## Convexity computation — consolidated reference

```
fitCylinder(positions, normals, indices) -> { axis, center, radius, residual, valid }
  1. axis  = dominant pairwise cross of sampled normals ⊥-dominant fallback
  2. project verts on plane ⟂ axis (u,v)
  3. least-squares circle: solve Cramer 3×3 for x²+y²+Ax+By+C=0
  4. valid = maxDev/radius ≤ 0.12 && mean |n̂·r̂| ≥ 0.55
   → else fall to next data source (STEP → OCCT → tessellation)

faceConvexity(face):  sign(mean (p − foot(p)) · n̂), foot anchored on fitted axis

adjacency(f1, f2, edgeMidpoint m):
  n1 = outwardNormalAt(f1, m); n2 = outwardNormalAt(f2, m)   // cylinder → radial from fitted axis
  γ   = acos(clamp(n1·n2, −1, 1))
  p   = m − τ·n1
  convex = ((p − m)·n2) < 0
  δ   = convex ? π − γ : π + γ
  emit { convexity, dihedralDeg = deg(δ) }
```

Partial cylinder: treated exactly the same; wall edges get their mid-edge normal
from the same fitted axis. See Requirement 5 for full reasoning and file
references.

---

## Determinism rules

1. Every scalar emitted with fixed precision (reuse `canonicalNumber`
   `toPrecision(12)` from `occtTopologyPayload.ts:118–122`, or a documented
   mm-scale rounding — pick one, apply everywhere).
2. Nodes sorted by `(nodeType, id)`; edges by
   `(nodeType, sourceId, targetId, precedence)`.
3. Identity: use `stableId` (OCCT `occt:v1:*`) as the semantic key; the
   runtime `BRepFace-*` numbering is an attribute too, so the graph is
   byte-identical across retessellation / reload.
4. No timestamp in the graph JSON. Feature counts and DRF precedence are
   derived deterministically by stable sort.
5. Same STEP file in → byte-identical graph out (asserted by a test).

---

## Module mapping & implementation plan

| Graph section | Existing producer (reuse) |
|---|---|
| faces / adjacency | `src/utils/occtTopologyPayload.ts` (`NormalizedOcctFaceTopology`, `NormalizedOcctEdge.parentFaceIndices`) + `src/utils/stepOcctParser.ts` |
| face→STEP mapping, surface classification | `src/utils/geometryClassifier.ts` (`classifyBRepFaces`, `autoGenerateFaceMapping`) |
| analytical cylinder axis/radius | `stepParser.ts` (`getCylinderSurfaceFrame`, line 3519; `cylindricalSurfaces`) |
| viewer cylinder fit (fallback) | extract to shared `src/utils/cylinderFit.ts` from `CadCanvas3D.getCylinderFaceCircleSnap` (line 2044); viewer imports it, behavior unchanged |
| convexity / dihedral | new `src/utils/convexity.ts` |
| PMI nodes + attach edges | `src/utils/pmiTopologyReferences.ts` resolution contract + `stepParser.ts` records (datums, DRFs, tolerances) |
| feature nodes (provenance pmi) | existing aggregates in `stepParser.ts` (`holes:1578`, counterbore merge:4294, threads:2751) |
| serializer + determinism | new `src/utils/graphExporter.ts` — `exportGraph(parsedStep, occtTopology, classifiedFaces, fits): VersionedGraph` |
| bulk export | new `scripts/exportGraphs.ts` (`npx tsx`) → one JSON + human-readable summary per fixture into `graphs/` |

Exporter shape:

```
exportGraph(input): {
  graphVersion: 1,
  source: { fileName, fileSize, schema: "AP242"|"AP203", stableHash },
  nodes: [...], edges: [...],
}
```

The exporter consumes the same modules as the viewer and writes nothing into
the render/parse pipeline. No parsing of raw STEP text inside the exporter
except through existing helpers.

---

## Feature-recognition layer integration

This exporter ships the substrate and the `provenance: "pmi"` feature nodes
that can be derived today. The product roadmap's geometric recognizer
(holes/slots/pockets/bosses by graph pattern matching) is a later increment
that *emits* the same `feature` node type with `provenance: "geometry"`.
Schema is forward-compatible: adding the recognizer changes `provenance`,
never node identity.

---

## Graph specification document

`docs/GRAPH_SPEC.md` (or `graphs/README.md`):

- node/edge schema tables with rationale (the requirements above, condensed);
- one JSON snippet per entity type (the examples in the schema section);
- the ordering/determinism rules;
- the minimum-graph argument + token budget table (Requirement 8);
- known gaps: material (part metadata), B-spline geometry dropped, PMI
  presentation excluded;
- the AP203 negative-control example (geometry only, no PMI nodes).

---

## Verification / checkpoint

- `exportGraph` capability in the app (UI button) **or** a script over the same
  modules — both accepted; **both implemented**: `scripts/exportGraphs.ts`
  (`npm run export:graphs`) plus the header **Export Graph** button in
  `src/App.tsx` (`handleExportGraph`).
- Graphs for **all NIST AP242 fixtures** + **one AP203** negative control —
  **done**, 16/18 fixtures exported to `graphs/`. `nist_stc_07_asme1_ap242-e3`
  and `nist_ftc_08_asme1_ap242-e1-tg` fail inside the occt-import-js 0.0.23
  importer (known upstream limitations, see `OCCT_NATIVE_TOPOLOGY_PLAN.md`),
  not in the exporter. The cube fixture serves as the clean geometry-only
  control (`scripts/verifyGraphExporter.ts`).
- Determinism test: export the same fixture twice → byte-identical JSON —
  **asserted per fixture and in `verifyGraphExporter`.**
- Feature inventory spot-check against the NIST documentation before running
  any LLM — **pending** (needs NIST docs on hand).
- `npm run lint` and `npm run build` pass — **verified**; parser change
  (occtInstance override) covered by the cube and fixture smoke runs.
- Token-budget measurement: script reports node/edge counts and estimated
  tokens per fixture — **implemented twice**: in-graph `source.estimatedTokens`
  (serialized-byte heuristic) and `scripts/tokenBudgetReport.ts`
  (`npm run graph:budget`, writes `graphs/token-budget.csv` + `.json`). Real
  numbers (raw vs graph, corpus ~10x reduction) are in `docs/GRAPH_SPEC.md`.

## Implementation checklist

- [x] `src/utils/cylinderFit.ts` — pure fit ported from the viewer, validated on
      synthetic boss/bore cylinders
- [x] `src/utils/convexity.ts` — face convexity + adjacency dihedral
      (Requirement 5), validated on synthetic cube planes (90° convex)
- [x] `src/utils/graphExporter.ts` — serializer, determinism, PMI attach,
      features, part node (Requirements 4–7)
- [x] `scripts/exportGraphs.ts` — bulk export into `graphs/` + per-part summary
      + per-fixture determinism assertion (`npm run export:graphs`)
- [x] `scripts/tokenBudgetReport.ts` — measured raw-vs-graph token budget
      (`npm run graph:budget`, CSV + JSON + table)
- [x] App **Export Graph** button (`src/App.tsx` `handleExportGraph`) — downloads
      `<part>.graph.json` for the loaded part
- [x] `scripts/verifyGraphExporter.ts` (`npm run verify:graph`) — cube
      end-to-end: 6 faces, 12 convex adjacencies, no PMI, deterministic
- [x] `scripts/verifyCylinderFitConvexity.ts` (`npm run verify:convexity`) —
      pure geometry, no OCCT required
- [x] `scripts/occtNode.ts` — offline Node loader (local occt-import-js wasm)
      and native-wrapper opt-in via argv/env
- [x] Edge cases: partial cylinders (no special path), common datums
      (`commonDatum` group nodes), unresolved PMI references preserved
      explicitly. Composite/multi-segment FCFs remain a stated extension (two
      zone nodes per segment), not in v1.
- [x] Determinism + negative-control tests
- [x] `docs/GRAPH_SPEC.md` — node/edge schema, rationale, examples, determinism,
      token budget, known gaps, cube negative control
- [x] lint / build / multi-sample smoke (16 fixtures + cube)
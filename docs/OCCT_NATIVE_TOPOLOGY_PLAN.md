# OCCT Native Topology Integration Plan

## Goal

Replace tessellation-reconstructed display edges with geometry and ownership
exported from native OCCT `TopoDS_Edge`, `TopoDS_Wire`, and `TopoDS_Vertex`
records. Keep the existing reconstruction path as a complete fallback until
native rendering, picking, and performance are verified across the NIST files.

All changes must remain general. Do not add filename-specific or sample-specific
topology rules.

## Adoption Steps

Native topology adoption is staged so correctness can advance without removing
the compatibility path prematurely:

1. **Native preferred by default**
   - Default `occtLoader` to the native wrapper.
   - Preserve `VITE_OCCT_TOPOLOGY_MODE=tessellation` as an explicit override.
   - Preserve automatic whole-model fallback when the native module cannot load,
     STEP import throws, payload validation fails, or face counts disagree.
2. **Consume explicit native vertices**
   - Build viewer vertex records from `brep_vertices`.
   - Keep coordinate-derived vertices only in reconstruction fallback mode.
   - Preserve current hover, sticky selection, and constant-screen-size markers.
3. **Complete sample regression**
   - Run parser smoke tests across all AP242 samples.
   - Run browser load checks across representative topology sizes and shapes.
   - Check repeated file switching for stale topology and memory retention.
4. **Production wrapper packaging**
   - Package matching `.js` and `.wasm` artifacts reproducibly.
   - Validate wrapper version/checksum before deployment.
   - Make production builds fail clearly when required native artifacts are
     missing, rather than silently shipping without the preferred path.
5. **Compatibility-only reconstruction**
   - Keep reconstruction available for unsupported or damaged files.
   - Do not mix native and reconstructed identities within one model.
   - Do not delete reconstruction unless long-term import evidence shows it has
     no remaining compatibility value.

Step 1 is now implemented. Native is the code-level default; fallback remains
automatic and can still be forced explicitly.

Step 2 is now implemented. The viewer builds native-model vertex records
directly from validated `brep_vertices` payloads and enriches them from native
edge incidence. Coordinate-quantized endpoint reconstruction now runs only for
whole-model tessellation fallback results.

Default-native browser verification was run from a clean server with no
`VITE_OCCT_TOPOLOGY_MODE` setting. Chrome requested the native JavaScript and
WebAssembly assets and passed cube face, edge, and vertex interaction checks.
`scripts/verifyOcctLoaderConfig.ts` separately verifies that the explicit
`tessellation` override still resolves to fallback mode.

## Current Checkpoint

The isolated wrapper and parser integration are complete:

- The wrapper source is under `native/occt-topology-wrapper/`.
- `occt-import-js` is pinned to `0.0.23`.
- The wrapper exports `brep_vertices`, `brep_edges`, and `brep_loops`.
- The wrapper exports analytical face descriptors, curve lengths, and invariant
  curve samples used to create stable topology signatures.
- `src/utils/occtLoader.ts` loads the custom wrapper only in native mode.
- `src/utils/stepOcctParser.ts` accepts native topology only when every rendered
  mesh has a valid payload and the native/rendered face counts match.
- Invalid or missing payloads retain the tessellation reconstruction fallback.
- Native geometry keeps `BRepEdge-*`, `BRepLoop-*`, and `BRepVertex-*` viewer
  namespaces and may also receive matching native STEP entity metadata.
- The inspector distinguishes `Native OCCT`, `Native STEP`, and
  `Tessellation fallback`, and exposes the stable native ID.

Verified parser counts:

| Fixture | Faces | Vertices | Edges | Loops |
| --- | ---: | ---: | ---: | ---: |
| Upstream cube | 6 | 8 | 12 | 6 |
| NIST CTC 01 AP242 | 117 | 206 | 318 | 140 |
| NIST FTC 06 AP242 | 187 | 310 | 476 | 226 |
| NIST FTC 07 AP242 | 304 | 582 | 880 | 353 |

`nist_stc_07_asme1_ap242-e3.stp` throws inside both the stock and custom
`occt-import-js 0.0.23` wrappers under Node. Treat that as an upstream importer
limitation unless browser behavior proves otherwise.

## Browser Integration Checkpoint

The generated wrapper is published locally to the git-ignored
`public/occt-native/` directory. Native mode no longer requires a local
environment override because it is the application default.

Chrome DevTools browser verification passes:

- The browser requests both native `occt-import-js.js` and
  `occt-import-js.wasm`.
- The cube renders with 6 faces, 12 edges, and 6 loops.
- Face, edge, and vertex hover states are stable.
- Edge and vertex clicks select the highlighted native entity.
- The detailed inspector reports `Native OCCT`.
- Clicking blank viewport space clears the selection.
- FTC 06 loads in the browser with 187 faces, 476 edges, and 226 loops.
- No browser runtime errors occur; the missing optional favicon is ignored.
- Forced tessellation mode passes the same cube face, edge, and vertex
  interaction checks without requesting native wrapper assets.

A general interaction bug was fixed during this check. OrbitControls cleared the
highlighted vertex on pointer-down before the click handler could use the same
sticky vertex target. The viewer now snapshots a highlighted vertex during the
capture phase and consumes it on a stationary click. Drag navigation behavior is
unchanged.

Screenshots are outside the repository:

- `C:\occt-topology\native-topology-browser.png`
- `C:\occt-topology\native-topology-ftc06.png`

## Stable Signature Checkpoint

Native faces, edges, loops, and vertices now receive versioned
`occt:v1:<kind>:<hash>` signatures that do not depend on viewer numbering,
payload ordering, edge traversal direction, loop start position, or
tessellation deflection.

Signature inputs are:

- Faces: analytical surface type, area, centroid, bounds, and boundary-loop
  signatures.
- Edges: analytical curve type, exact curve length, five parameter-space curve
  samples, and endpoint vertex signatures.
- Loops: canonical cyclic edge-signature order, independent of start position
  and traversal direction.
- Vertices: exact OCCT point and incident analytical edge descriptors.

The parser preserves native OCCT and STEP signatures independently. A matched
edge keeps its `topologySignature` and receives the STEP signature as
`stepTopologySignature`; STEP enrichment no longer overwrites persistent OCCT
identity. Face and vertex signatures propagate through Three.js user data into
the entity inspector.

Validation completed:

- Synthetic payload ordering and traversal invariance passes.
- Cube signatures remain identical between `0.02`/`0.10` and `0.2`/`0.45`
  tessellation settings.
- The cube has zero face, edge, vertex, or loop signature collisions.
- FTC 06 has zero collisions across 187 faces, 476 edges, 310 vertices, and 226
  loops.
- Cube browser interaction and two-cycle CTC 01 / FTC 06 / FTC 07 switching
  regressions still pass after signature propagation.

Coincident duplicate topology can legitimately share a geometric signature.
The attachment resolver reports such signatures as ambiguous and never
silently chooses one entity.

## PMI Topology Reference Checkpoint

`src/utils/pmiTopologyReferences.ts` now defines the generic topology-reference
contract used by:

- Datum features and multi-face datums.
- Datum targets.
- Dimensional tolerances.
- Every parsed geometric-tolerance category, including position, form,
  orientation, profile, and runout records that do not yet have viewport
  renderers.
- Individual DRF references and aggregate datum reference frames.

Each reference stores its entity kind, STEP target ID, current `BRep*` runtime
ID, stable OCCT signature, optional STEP topology signature, and one of three
explicit outcomes: `resolved`, `missing`, or `ambiguous`.

The resolver runs after semantic STEP parsing and native OCCT import are both
available. Current annotation rendering continues to use `BRepFace-*` runtime
labels. Saved or future edited PMI can use the stable signature and resolve it
back to the current runtime label after reopening or retessellating the model.
STEP identity conflicts, duplicate signatures, and missing signatures do not
fall through to a first-candidate choice.

Future position, form, orientation, profile, runout, and feature-control-frame
renderers must consume this same contract. They must not introduce a parallel
target-to-viewport mapping system.

Persistence validation:

| Fixture | Resolved | Missing | Ambiguous |
| --- | ---: | ---: | ---: |
| CTC 01 | 41 | 0 | 0 |
| FTC 06 | 210 | 35 | 0 |
| FTC 07 | 292 | 1 | 0 |

Fine (`0.02`/`0.10`) and coarse (`0.2`/`0.45`) tessellation snapshots match for
all three fixtures. Serialized resolved references reload through stable
signatures. Synthetic tests cover changed runtime numbering, duplicate
signatures, missing signatures, and multiple runtime candidates.

FTC 06 unresolved targets are predominantly isolated `TRIMMED_CURVE` datum
target zones and dimension helper `SHAPE_ASPECT` records, not native model
topology. One generic profile annotation target has no semantic controlled face
in that STEP structure. These remain explicit missing references; do not guess
a face from presentation proximity.

The active native-mode development server is currently
`http://localhost:3000`.

## Native Vertex Checkpoint

The viewer no longer derives native-model vertices by quantizing rendered edge
endpoints:

- `occtResult.vertices` supplies exact `BRepVertex-*` IDs and positions.
- Native edge `vertexIds` supply incident edge ownership.
- Incident edges supply parent face ownership.
- Matched STEP vertex IDs remain inspector metadata where the association is
  geometrically supported.
- Vertices retain the existing multi-edge interaction rule, sticky hover/click
  behavior, and constant-screen-size marker.
- Tessellation fallback retains the previous coordinate-derived vertex path.
- Native and reconstructed vertex identities are never mixed in one model.

The cube passes native and forced-fallback browser interaction checks. FTC 06
passes payload-level incidence checks for 310 vertices and 476 edges. Dense
annotated NIST views still need a deterministic browser vertex target because
the current coarse screen-grid verifier does not reliably land near a visible
vertex.

## Performance Checkpoint

Two clean Chrome runs compared native mode on port 3001 with an explicitly
forced reconstruction fallback on port 3002. STEP load timing starts after the
OCCT kernel is ready, so local-versus-CDN wrapper download time is excluded.

Average of the two runs:

| Fixture | Fallback load | Native load | Native delta | Fallback/native edges | Retained heap delta | Orbit p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| CTC 01 | 1410 ms | 1659 ms | +17.7% | 316 / 318 | -0.19 MB | 16.8-16.9 ms |
| FTC 06 | 3069 ms | 2699 ms | -12.1% | 470 / 476 | -0.57 MB | 16.8-16.9 ms |
| FTC 07 | 2661 ms | 2572 ms | -3.4% | 699 / 880 | +0.29 MB | 16.8-17.0 ms |

Conclusions:

- Native topology does not reduce orbit responsiveness.
- Retained JavaScript heap is effectively unchanged after garbage collection.
- Native mode is faster on the two larger files.
- The small CTC file pays a fixed native export/normalization cost.
- FTC 07 exposes 181 additional real OCCT edges that reconstruction merged or
  omitted, without reducing measured frame responsiveness.
- Do not optimize by dropping those edges; their identity is the purpose of the
  native path.

Raw reports are outside the repository:

- `C:\occt-topology\topology-browser-benchmark.json`
- `C:\occt-topology\topology-browser-benchmark-run2.json`

## Kernel Graph Attributes Checkpoint

The graph exporter now consumes geometric attributes computed **inside the OCCT
kernel** rather than re-deriving them from tessellation. The wrapper's
`WriteNativeTopology` emits, in addition to the topology records:

- `brep_face_descriptors[].analytic` — exact `gp_Pln` / `gp_Cyl` / `gp_Cone` /
  `gp_Sphere` / `gp_Torus` parameters from `BRepAdaptor_Surface`.
- `brep_face_descriptors[].convexity` — in-kernel face-level
  convex/concave/unknown (`FaceConvexityLabel`, `GeomLProp_SLProps` normals vs.
  the axis/center radial direction).
- `brep_face_descriptors[].centroid_point` / `.centroid_normal` — the surface
  point nearest the face center of gravity and its outward normal
  (`GeomAPI_ProjectPointOnSurf`).
- `brep_edges[].midpoint`, `.normals` — exact edge-curve midpoint and per-face
  outward normals there (`BRep_Tool::CurveOnSurface` pcurves with a projection
  fallback).
- `brep_edges[].contacts` — per incident-face pair the kernel convexity and
  interior dihedral angle in degrees, from the same probe formula the graph
  spec defines but with exact kernel values.

`src/utils/occtTopologyPayload.ts`, `src/utils/stepOcctParser.ts`, and
`src/utils/graphExporter.ts` validate, pass through, and consume these
attributes. The exporter reports `source.kernelGeometry: true` when every
adjacency classification came from the kernel (`geometrySource: "occt"`).
`scripts/verifyGraphKernelAttributes.ts` (`npm run verify:graph:kernel`)
verifies both the payload normalization and the exporter consumption paths
against a synthetic wrapper payload and the real cube fixture.

Rebuild the wrapper (see Resume Commands) before relying on kernel-derived
graph values in the app; without a rebuilt wrapper the exporter degrades to the
TS tessellation fallback exactly as before.

## Active Increment

Improve STEP-to-native association confidence without changing rendering:

- Classify non-topological PMI construction and presentation geometry separately
  from genuinely unresolved controlled model topology.
- Continue general AP242 `SHAPE_ASPECT` and
  `GEOMETRIC_ITEM_SPECIFIC_USAGE` traversal where a controlled feature is
  semantically present.
- Compare mapped OCCT faces with native STEP face/edge/vertex identities and
  retain explicit ambiguity when evidence conflicts.
- Keep current position/form/FCF records topology-ready even though their
  viewport renderers are a later feature.

## Resume Commands

Build and publish the wrapper:

```powershell
subst O: C:\occt-topology\source
subst B: C:\occt-topology\build-short
$env:PATH = "C:\occt-topology\tools\cmake-3.31.12-windows-x86_64\bin;C:\occt-topology\tools\ninja;$env:PATH"
.\native\occt-topology-wrapper\build-wrapper.ps1 `
  -SourceRoot O:\ `
  -BuildRoot B:\out `
  -EmsdkRoot C:\occt-topology\emsdk `
  -PublishRoot .\public\occt-native `
  -Parallel 16
```

The short mapped roots are required on Windows because a fresh build under the
full `C:\occt-topology\...` paths exceeds the command-line length limit.

Publish an existing build without recompiling:

```powershell
.\native\occt-topology-wrapper\publish-wrapper.ps1 `
  -BuildRoot C:\occt-topology\build-short\out `
  -PublishRoot .\public\occt-native
```

Verify the parser integration:

```powershell
npx tsx scripts/verifyOcctParserNativeIntegration.ts `
  B:\out\Release\occt-import-js.js
```

Verify persistent PMI topology references:

```powershell
npx tsx scripts/verifyPmiTopologyReferences.ts `
  B:\out\Release\occt-import-js.js
```

Verify kernel graph attributes end-to-end (payload normalization + exporter
consumption, no wrapper required):

```powershell
npm run verify:graph:kernel
```

Re-export graphs from the rebuilt wrapper so every fixture's graph carries
kernel-derived geometry (`kernelGeometry: true`):

```powershell
npm run export:graphs
```

Run the cube browser interaction verification:

```powershell
node scripts/verifyNativeTopologyBrowser.mjs
```

Run an AP242 browser load check:

```powershell
node scripts/verifyNativeTopologyBrowser.mjs `
  "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  "http://127.0.0.1:3001" `
  "STEP samples with PMI\AP242\nist_ftc_06_asme1_ap242-e2.stp" `
  "C:\occt-topology\native-topology-ftc06.png" `
  "187,476,226" `
  --load-only
```

Run a forced-fallback interaction check by adding:

```powershell
--expect-fallback
```

Run repository checks:

```powershell
npm run lint
npm run build
```

Run the native-versus-fallback browser benchmark:

```powershell
node scripts/benchmarkTopologyBrowser.mjs
```

Run repeated native file switching and retained-heap validation:

```powershell
node scripts/verifyNativeTopologySwitchingBrowser.mjs
```

## Datum Feature Association Rule

Resolve semantic datum geometry in the directed AP242 relationship order:

1. Direct geometry usage on the datum feature.
2. Outgoing `SHAPE_ASPECT_RELATIONSHIP` children of the datum feature.
3. Geometry usage on those child shape aspects.
4. Broad connected-relationship traversal only when the directed path has no
   geometry targets.

Do not traverse from a datum feature through its `DATUM` entity and back into
the shared product graph. That path can incorrectly assign every member of a
hole pattern to each individual datum.

FTC08 e2 is the regression example. Its STEP semantics resolve:

- Datum E: STEP face `#5916`, runtime `BRepFace-61`, displayed face 62.
- Datum F: STEP face `#5911`, runtime `BRepFace-56`, displayed face 57.

Displayed faces 105 and 161 are not datum E/F targets in that AP242 file. Do
not introduce a filename- or face-number-specific override for them.

## Later Increments

1. Compare native OCCT topology with STEP `EDGE_CURVE`, `EDGE_LOOP`, and
   `VERTEX_POINT` identities and report ambiguous associations.
2. Add position, form, orientation, profile, runout, and feature-control-frame
   viewport rendering on the shared topology-reference contract.
3. Complete full AP242 browser and repeated-file-switch regression.
4. Finish reproducible production wrapper packaging and checksum validation.
5. Remove reconstruction from the normal path only after native mode passes
   browser interaction and performance checks across the sample set.

## Safety Boundary

Do not delete the reconstruction implementation yet. Do not mix native and
reconstructed edge namespaces within one parsed model. If any native mesh fails
validation, use reconstruction for the whole rendered model.

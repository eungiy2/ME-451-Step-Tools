# Setup
## API Key Setup
1. Go to [UIUC Lumen](https://lumen.ncsa.illinois.edu/profile).
2. Generate an API Key.
3. Set up the environment variable (Windows).
 ```powershell
 [Environment]::SetEnvironmentVariable(
	    "LUMEN_API_KEY",
	    "YOUR_API_KEY",
	    "User"
	)
 ```
## Opencode setup for dev (Windows)
1. Go to [UIUC Lumen Connect](https://lumen.ncsa.illinois.edu/connect).
2. Generate `opencode.json` and modify it as needed based on the provided model.
3. Paste/move the json file to `C:\Users\USERNAME\.config\opencode`.
4. Download `Node.js` ([Link](https://nodejs.org/en)).
5. run `npm install -g @opencode/cli`.
### To use Opencode in the project
1. Open `powershell` in the project root directory.
2. run `opencode` in the terminal and select model to use.
### How to leave a log for record
run `/export` in the opencode termnial. 
# To run the Web App
1. Open a terminal
2. Run `npm install` in the root directory for the first run
3. Run `npm run dev` and access the Web App with the localhost address and port ([Link](http://localhost:3000/)).
# Project Structure
```
STEP Tools/
├── server.ts                     # Express + Vite dev server; Gemini API endpoints
├── index.html                    # Vite entry HTML
├── vite.config.ts                # Vite config (React + Tailwind plugins, @ alias)
├── tsconfig.json                 # TypeScript config
├── package.json                  # npm scripts: dev, build, start, lint, clean
├── .env.local                    # GEMINI_API_KEY (gitignored)
├── metadata.json                 # AI Studio app metadata
├── CLINE.md / .clinerules/       # Agent handoff + engineering rules
│
├── src/                          # React application
│   ├── main.tsx                  # React root bootstrap
│   ├── App.tsx                   # (2,268 lines) App shell, state, sidebar, inspector, UI
│   ├── types.ts                  # Domain types: Rule, CadPackage, InspectionCheckResult
│   ├── index.css                 # Tailwind import
│   ├── components/
│   │   └── CadCanvas3D.tsx       # (10,089 lines) Three.js viewport, camera, picking,
│   │                             # PMI drawing, measurement, compact overlays
│   ├── data/
│   │   └── implantPresets.ts     # Default compliance rules, implant CAD presets, check runner
│   └── utils/
│       ├── stepParser.ts         # AP203/AP242 semantic parser → datums,
│       │                         # targets, DRFs, dimensions, geometric tolerances
│       ├── stepOcctParser.ts     # Converts OCCT output into renderable B-Rep faces
│       ├── occtLoader.ts         # OCCT WASM loader; native topology vs tessellation mode
│       ├── stepTopology.ts       # STEP topology extraction + tessellated-edge matching
│       ├── occtTopologyPayload.ts# Normalizes native OCCT topology payloads (validation)
│       ├── pmiTopologyReferences.ts # Resolves PMI targets → runtime B-Rep IDs + stable
│       │                         # native/STEP topology signatures
│       └── geometryClassifier.ts # Conservative STEP-target → rendered-face mapping helpers
│
├── native/
│   └── occt-topology-wrapper/    # Custom OCCT WASM wrapper (C++) extending occt-import-js 0.0.23
│       ├── src/native-topology-export.{cpp,hpp}
│       ├── build-wrapper.ps1 / publish-wrapper.ps1 / prepare-wrapper.mjs
│       └── README.md             # Build pipeline (CMake, Ninja, Emscripten 3.1.69)
│
├── public/
│   ├── nist-ap242/               # 17 bundled NIST AP242 STEP test fixtures
│   └── occt-native/              # Built wrapper (occt-import-js.js/.wasm, git-ignored)
│
├── scripts/                      # Verification/benchmark scripts (run via npx tsx)
│   ├── verifyNativeTopologyBrowser.mjs / verifyNativeTopologySwitchingBrowser.mjs
│   ├── verifyOcctNativeWrapper.ts / verifyOcctParserNativeIntegration.ts
│   ├── verifyOcctTopologyPayload.ts / verifyPmiTopologyReferences.ts
│   ├── verifyOcctLoaderConfig.ts
│   └── benchmarkTopologyBrowser.mjs
│
├── docs/                         # Architecture + implementation plans
│   ├── PROJECT_ARCHITECTURE_AND_ROADMAP.md   # Current state + roadmap (authoritative)
│   ├── OCCT_NATIVE_TOPOLOGY_PLAN.md          # Native topology, persistent IDs, PMI resolution
│   ├── COMPACT_PMI_MODE_PLAN.md              # Collapsed/expandable annotation overlays
│   ├── EXPORT_GRAPH_PLAN.md                  # Graph representation of model + PMI
│   └── STUDENT_PLAN.md                       # Student project tasks & paper plan
│
├── "STEP samples with PMI/"      # Evidence base: NIST fixtures (AP203 + AP242)
├── "STEP samples without PMI/"   # e.g., 10cm3_cube.step (no-PMI fixture)
└── assets/                       # AI Studio metadata
```
# Appendix
## Data pipeline
### The Two Inputs & Entry Points

There are **two parallel encoders** of the same STEP file, coordinated by `App.tsx`:

1. **Semantic parse** — `parseStepFile(fileName, text)` (`stepParser.ts`) — pure text scan.
2. **Geometry parse** — `parseStepWithOcct(fileBuffer, params)` (`stepOcctParser.ts`) — OCCT WASM tessellation.

`App.tsx` loads both (`loadStepBytes`), re-runs #2 whenever tessellation params change (the `handleRebuild` effect), and separately re-parses #1 on a `DATUM_PARSE_REVISION` guard.

---

### Hop 1: `stepParser.ts` → semantic records keyed by STEP entity ID

`parseStepFile` scans the STEP text (`#\d+ = ENTITY(...);` statements) and resolves AP203/AP242 relationships (`datum_target`, `GEOMETRIC_ITEM_SPECIFIC_USAGE`, `DRAUGHTING_MODEL_ITEM_ASSOCIATION`, shape aspects, etc.). It returns a `StepParseResult`:

- `datums[]` — each `ParsedStepDatum` with `targetId`/`targetIds` = **STEP entity IDs** (e.g. `"#123"`), plus `semanticTargetIds`, `surfaceGeometry`, `derivedDatum`, `clinicalContext`
- `datumTargets[]` — with `targetId`/`targetIds` and embedded geometry (`targetPoint`, `targetCircle`, `targetZone`)
- `tolerances[]` — `ParsedStepTolerance` with `targetId`/`targetIds`, `category` (`"Form" | "Orientation" | "Location" | "Profile" | "Dimension"`), and nested `datumReferenceFrame`
- `datumReferenceFrames[]` — `references[]` with `precedence`, `datumIdentifier`, `targetIds[]`
- `faceRecords[]` (`{ id, referencedIds }`), `cylinderIds[]`, holes, `rawText`

**Key point:** everything here is keyed by STEP identity (`#123`), *not* by rendered mesh index. At this stage there is no link to the viewport.

### Hop 2: `stepOcctParser.ts` → renderable B-Rep geometry + STEP identity stamps

`parseStepWithOcct` calls `occt.ReadStepFile(...)`, then transforms the result into per-face meshes `normalizedMeshes[]` — **the array index *is* the runtime ID `BRepFace-<index>`**. Each mesh carries `positions/normals/indices/name` and, in native mode, `topologySignature`, `surfaceType`, `nativeCentroid`, `nativeEdgeIds`, `nativeLoopIds` (from `normalizeOcctMeshTopology`).

Crucially it also runs **a second, independent topology extraction directly from STEP text**:

```
extractStepTopology(rawText)   // stepTopology.ts
  → StepTopology { faceIdsByIndex[], edges[], vertices[], loops[] }
```

- Edges get a **stable signature**: `curveType : endpointVertexPointSignatures : canonicalFaceIds` — computed only from STEP content, so it survives re-opening the file.
- `attachStepTopologyToLines(lines, stepTopology)` then **fuses the two worlds**: for each display edge it matches the STEP edge by `(facePair, endpoint distance ≤ tolerance)` and stamps the renderable `line` with:
  - `stepEntityId` (e.g. `"#460"`) ← the parser's key
  - `topologySignature` (OCCT signature if present, else STEP signature)
  - `stepTopologySignature` (the stable STEP signature)
  - `nativeVertices`, `nativeLoopIds`

So after this hop the **OCCT B-Rep lines already know their STEP identity** — that is the seam that makes resolving semantic→runtime possible.

### Hop 3: `pmiTopologyReferences.ts` → resolves STEP IDs to runtime `BRepFace-*` IDs

`App.tsx` calls this in a dedicated effect *after* both results exist:

```
enrichPmiTopologyReferences(parsedMetadata, occtParsedResult, customFaceMapping)
```

`createPmiTopologyResolver` builds `RuntimeTopologyEntity[]` from the OCCT result — faces, edges (from `edges`/`lines`, carrying the `stepEntityId` stamped in hop 2), vertices, loops — indexed in three maps: `byRuntimeId`, `byStepId`, `bySignature`.

`resolveTarget(stepEntityId)` tries, in order:
1. **Already a runtime ID?** (starts with `BRepFace-`/`BRepEdge-`/…) → return directly.
2. **Exact match by STEP id** in `entitiesByStepId` (this is how stamped edges resolve).
3. **Fallback face mapping** — `getMappedFaceCandidates` via `customFaceMapping` (from `autoGenerateFaceMapping`, which maps STEP `CLOSED_SHELL` face ordinal → `BRepFace-<ordinal>`) and `faceRecords`.

Each candidate is finalized by `createReference` into a `PmiTopologyReference` with a **resolution verdict**:

| Verdict | Condition |
|---|---|
| `resolved` | exactly 1 candidate **and** its `topologySignature` is unique |
| `ambiguous` | multiple candidates, or duplicate stable signatures (`multiple-runtime-candidates`, `duplicate-stable-signature`, `step-identity-conflict`) |
| `missing` | no candidate (`target-not-mapped`) or no stable signature available |

`enrichPmiTopologyReferences` then returns a **clone of the parsed result** where every datum, datum target, tolerance, and DRF reference gets a `topologyReferences: PmiTopologyReference[]` (containing `runtimeId`, `topologySignature`, `stepTopologySignature`) and a global `topologyReferenceSummary { resolved, missing, ambiguous }`.

There's also `resolveStoredReference(reference)` — re-resolves a previously stored ref via `topologySignature` after reload, with a conflict check `step-identity-conflict` when the current STEP id resolves elsewhere.

### Hop 4: Viewer consumption (`App.tsx` → `CadCanvas3D.tsx`)

`App.tsx` passes the enriched records plus the OCCT result down:

```
<CadCanvas3D
  datums, datumTargets, datumReferenceFrames, tolerances,   // enriched (have topologyReferences)
  faceRecords, cylinderIds, customFaceMapping,
  occtParsedResult{mAeshes, lines, ...}
  ... />
```

Inside `CadCanvas3D`:
- Each mesh is built as a Three.js object named `BRepFace-<index>`; `userData` carries `topologySignature` / `stepTopologySignature` / `stepEntityIds` (lines 1200, 1327, 1569).
- Hover/selection returns entities to `App.tsx` whose inspector shows `stepEntityIds` and `topologySignature`.
- **PMI overlays** (`drawPmiDimensionToleranceOverlay`, `drawDatumReferenceFrameOverlay`, etc.) read each record's `targetId*`/`targetIds*` (STEP IDs) and map to visible face names via `mapTargetToWebGLName`/`getCustomMappedVisibleFaceName` — which consults `customFaceMapping` (the `autoGenerateFaceMapping` ordinal mapping from hop 3's fallback) plus geometric helpers

`stepParser` (STEP IDs) ─[`attachStepTopologyToLines`]─→ `stepOcctParser` (runtime IDs + stamped STEP ids) ─[`autoGenerateFaceMapping`]─→ view. The `pmiTopologyReferences` layer currently acts as the **audit/persistence bridge** (resolution summaries, stable signatures on pick data, conflict detection) that the docs intend to become the primary anchoring route once PMI editing lands. That's the one real gap between the architecture document and the execution path in the code.

## Tracing a tolerance to see how it reaches the viewer
### 1. The source record in the STEP file

The FCF is the AP242 entity group `#183`:

```
#183=(
  GEOMETRIC_TOLERANCE('Position.1','',#354,#481)
  GEOMETRIC_TOLERANCE_WITH_DATUM_REFERENCE((#169))
  GEOMETRIC_TOLERANCE_WITH_MODIFIERS((.MAXIMUM_MATERIAL_REQUIREMENT.))
  POSITION_TOLERANCE()
);
```

| Ref | Entity | Meaning |
|---|---|---|
| `#354` | `LENGTH_MEASURE_WITH_UNIT(... LENGTH_MEASURE(1.5) ...)` | tolerance value = **1.5 mm** |
| `#481` | `COMPOSITE_SHAPE_ASPECT('','multiple elements',#21867,.T.)` | toleranced feature ("multiple elements") |
| `#169` | `DATUM_SYSTEM('Datum System .1',...,(#135,#136,#137))` | compartments → **A** (`#125`), **B** (`#126`), **C** (`#127`) |
| `#118`/`#111` | `TOLERANCE_ZONE(...(#183),#111)` / `TOLERANCE_ZONE_FORM('cylindrical or circular')` | cylindrical zone ⇒ `⌀` |

The "multiple elements" get bound to real B-Rep faces through two hops in the file:
- `#418`–`#421`: `SHAPE_ASPECT_RELATIONSHIP` → `#481` → child aspects `#1546–#1549`
- `#600`–`#603`: `GEOMETRIC_ITEM_SPECIFIC_USAGE` → `#1546→#2809`, `#1547→#2887`, `#1548→#2808`, `#1549→#2888`, where the targets are `ADVANCED_FACE` entities (pairs of cylindrical faces for two holes).

So semantically: **Position 1.5mm ⌀ MMC | A B C** controlling 4 faces.

---

### 2. `stepParser.ts` — semantic record

The FCF is decoded by `buildSfaSemanticTolerances()` (`stepParser.ts:2753`), not the simple line regex:

1. Iterates entity statements; `#183` matches (`POSITION_TOLERANCE`, and it's not a TOLERANCE_ZONE/TOLERANCE_VALUE entity).
2. `refs = getEntityRefs(#183)` = `[#354, #481, #169]`.
3. `magnitudeRef = #354` → `getMeasureValue(#354)` = **1.5** (unit-scaled).
4. `shapeAspectRef = #481` (COMPOSITE_SHAPE_ASPECT) → `getShapeAspectGeometryTargets(#481)` descends via the SHAPE_ASPECT_RELATIONSHIPs and reads the `shapeAspectToTarget` map (populated from `GEOMETRIC_ITEM_SPECIFIC_USAGE`, parsed at `:1335`) → `targetIds = [#2809, #2887, #2808, #2888]`.
5. `toleranceZoneForm` = "cylindrical or circular" via `getUsedIn(#183, TOLERANCE_ZONE)` → `toleranceZoneDiameter = true`.
6. `toleranceModifiers` = `["MAXIMUM MATERIAL REQUIREMENT"]` from the `GEOMETRIC_TOLERANCE_WITH_MODIFIERS` statement.

Then the final assembly pass (`finalTolerances.map`, `stepParser.ts:6073`) looks up a `DATUM_SYSTEM` ref (`#169`) in `datumReferenceFrameByEntityId` and attaches the parsed `ParsedStepDatumReferenceFrame`:
`references = [A(precedence 1), B(2), C(3)]`, each with `targetIds`, `surfaceGeometry`, and the DRF's `frameBasis`.

**Resulting record** (roughly):
```ts
{
  entityId: "#183", type: "Position", symbol: "⌖", value: 1.5,
  targetId: "#2809", targetIds: ["#2809","#2887","#2808","#2888"],
  targetSurfaceTypes: ["curved"],
  toleranceZoneDiameter: true, toleranceZoneForm: "cylindrical or circular",
  toleranceModifiers: ["MAXIMUM MATERIAL REQUIREMENT"],
  datumReferenceFrame: { references: [A,B,C], frameBasis: {...} },
  category: "Location"
}
```

---

### 3. `pmiTopologyReferences.ts` — STEP ID → runtime B-Rep ID

`enrichPmiTopologyReferences(parsed, occtResult, customFaceMapping)` runs after OCCT tessellation exists (App.tsx effect, `App.tsx:730`). For this tolerance:

- `resolveTarget("#2809")` → not a `BRepFace-*` runtime ID, no edge exact-match → falls through to `getMappedFaceCandidates("#2809")`, which resolves via `customFaceMapping["#2809"]` (from `autoGenerateFaceMapping`, keyed by `CLOSED_SHELL` face ordinal order in the STEP text) or via `faceRecords`.
- Returns a `PmiTopologyReference[]` with `runtimeId` (`BRepFace-N`), `topologySignature`, and a verdict (`resolved`/`ambiguous`/`missing`), stored on the tolerance and rolled into `topologyReferenceSummary`.

**Important caveat (gap I flagged earlier):** this enriched output is computed and stored but the viewport draw path *does not consume `topologyReferences`*. Rendering still anchors through the legacy `customFaceMapping`/`faceRecords` lookups in `CadCanvas3D`.

---

### 4. Viewport: `CadCanvas3D.tsx` → pixels

The OCCT result from `stepOcctParser.ts` is rendered as `BRepFace-<i>` meshes (in `occtResult`) — these are the `renderedObjectByName` objects. The tolerance record arrives via the `tolerances` prop (App.tsx passes `parsedMetadata.tolerances`, `App.tsx:1013`).

Inside `drawPmiDimensionToleranceOverlay`:

1. **Classify** — Position.1 has `category === "Location"`, so it's routed to the geometric/`positionTolerances` group, not the dimension group (filter at `:4878`).

2. **Map targets to faces** — `getFaceNamesForTolerance(Position.1)` (`:4892`) maps each of `#2809/#2887/#2808/#2888` through `mapTargetToWebGLName` (`:3178`): looks up `customFaceMapping["#2809"]` → e.g. `BRepFace-12`, checks it exists in `renderedObjectByName`; falls back to a direct `faceRecords.id` index match (`BRepFace-<idx>`), an indirect match, or a cylinder-index guess. Geometric tolerances keep all mapped faces.

3. **Layout decision** — `toleranceZoneDiameter === true` ⇒ `getPositionToleranceLayoutType` returns `"radial"` (`:7744`). First it tries to **attach the FCF to a matching dimension** (`:7750`): shared semantic targets / rendered faces are scored, and `appendFeatureControlFrame` appends the FCF box under the matched dimension's label row.

4. **Standalone radial path** (when no dimension merges): 
   - `cylindricalFaceName = getPrimaryCylindricalFaceName(...)` picks the hole face.
   - `computeHoleToleranceLeaderGeometry(cylindricalFaceName, 0, 1, undefined, tolerance)` (`:6241`) computes the leader polyline/arrow endpoints (camera-facing dogleg, hole-axis anchor).
   - A Three.js `LineSegments` + arrow mesh are added to the overlay group (`:7842-7873`).
   - `addStandaloneFeatureControlFrameLabel(tolerance, labelPosition, "fixed", () => getLeaderTerminalTransform(line))` (`:5851`) creates a DOM `<div>` in `labelOverlay` and builds the box via `makeFeatureControlFrameElement` (`:5544`):

     ```
     ⌖ │ ⌀1.500(M) │ A │ B │ C
     ```
     - `\u2316` = ⌖ symbol compartment
     - `\u2300` (⌀) injected because `toleranceZoneDiameter`, then `value.toFixed(3)` = `1.500`, then `\u24c2` (ⓜ) for the MMC modifier from `getFcfModifierSymbol`
     - one compartment per datum precedence: **A**, **B**, **C**

5. **Screen placement** — the entry goes into `pmiDimensionLabelCache`; each animation frame projects its 3D `point`/`resolveTransform` (the leader terminal) to screen coordinates and positions the DOM element with `translate3d(...)`, and the label participates in collision/compact-mode handling.

---

### The end-to-end chain for Position.1

```
#183 FCF group in nist_ctc_02
  →   buildSfaSemanticTolerances            (stepParser.ts:2753)
      value 1.5 / targets #2809,#2887,#2808,#2888 / zone ⌀ / MMC / DRF A|B|C
  →   buildDatumReferenceFrames + final map (stepParser.ts:5106, 6073)
      attaches ParsedStepDatumReferenceFrame A|B|C
  →   enrichPmiTopologyReferences            (pmiTopologyReferences.ts)
      computes BRepFace-N runtime refs (stored; not consumed by viewer)
  →   drawPmiDimensionToleranceOverlay      (CadCanvas3D.tsx:4875)
      targetIds → customFaceMapping → BRepFace names
  →   getPositionToleranceLayoutType → radial
      computeHoleToleranceLeaderGeometry → 3D leader + arrow mesh
  →   makeFeatureControlFrameElement        (CadCanvas3D.tsx:5544)
      DOM box "⌖ | ⌀1.500(M) | A | B | C" appended to labelOverlay
  →   per-frame projection into screen-space DOM over the 3D anchor
```



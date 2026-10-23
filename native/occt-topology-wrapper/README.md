# OCCT Native Topology Wrapper

This directory extends `occt-import-js` version `0.0.23`. Native topology is the
application default, while `VITE_OCCT_TOPOLOGY_MODE=tessellation` forces the
reconstruction fallback. The wrapper exports drawable geometry and ownership
records directly from OCCT topology:

- `TopoDS_Vertex` to `brep_vertices`
- `TopoDS_Edge` through `BRepAdaptor_Curve` to `brep_edges`
- `TopoDS_Wire` to `brep_loops`
- edge-to-face ownership from `TopExp::MapShapesAndAncestors`

The payload matches `src/utils/occtTopologyPayload.ts`.

## Kernel graph attributes

The wrapper additionally computes, inside the OCCT kernel, the exact geometric
values the graph exporter consumes (no tessellation math on the TypeScript
side):

- **`brep_face_descriptors[].analytic`** — exact analytic surface parameters
  from the kernel surface primitive (`BRepAdaptor_Surface::Plane()/Cylinder()/
  Cone()/Sphere()/Torus()`): plane normal+point, cylinder axis+center+radius,
  cone axis+apex+semi-angle+reference radius, sphere center+radius, torus
  center+axis+major/minor radius.
- **`brep_face_descriptors[].convexity`** — face-level `convex`/`concave`/
  `unknown` computed in-kernel: outward surface normal vs. the axis/center
  radial direction (`GeomLProp_SLProps` normals oriented by face
  orientation).
- **`brep_face_descriptors[].centroid_point` / `.centroid_normal`** — the
  surface point nearest the face center of gravity (`GeomAPI_ProjectPointOnSurf`)
  and the outward unit normal there (used for the interior-side probe in the
  dihedral classification).
- **`brep_edges[].midpoint`** — the edge 3D curve midpoint
  (`BRepAdaptor_Curve::Value` at the parametric midpoint).
- **`brep_edges[].normals`** — per-incident-face outward unit normal at the
  edge midpoint, aligned with `face_indices`. Exact surface parameters come
  from the edge's pcurve on each face (`BRep_Tool::CurveOnSurface`), with a
  projection fallback.
- **`brep_edges[].contacts`** — for every incident-face pair
  `{face_i, face_j, convexity, dihedral_deg}`: the adjacency
  convexity/concave-by-dihedral classification and the interior dihedral angle
  in degrees, computed in-kernel with the same probe formula the graph spec
  defines (`docs/GRAPH_SPEC.md`), but from exact kernel values. `face_i` is the
  lexicographically-smaller `BRepFace-*` id, matching the exporter's sorted
  face-pair order.

Face/edge types, analytic values, and normals are all deterministic for a given
input shape, which keeps exported graphs byte-identical across reloads.

## Prepare

Clone `occt-import-js` at tag `0.0.23` with its OCCT submodule, then run:

```powershell
node native/occt-topology-wrapper/prepare-wrapper.mjs <checkout>
```

The preparation command checks the upstream package version and exact source
anchors before adding the exporter. It fails instead of silently modifying an
unknown wrapper revision.

## Verify Preparation

```powershell
node native/occt-topology-wrapper/verify-preparation.mjs
```

This verifies the source transformation against the installed `0.0.23` package.
It does not compile OCCT or alter the active application runtime.

## Build

The build script requires CMake, Ninja, and Emscripten `3.1.69`. Keep the
upstream checkout and build directory outside the application repository:

```powershell
.\native\occt-topology-wrapper\build-wrapper.ps1 `
  -SourceRoot C:\occt-topology\source `
  -BuildRoot C:\occt-topology\build `
  -EmsdkRoot C:\occt-topology\emsdk `
  -Parallel 2
```

Linux/WSL builds use the same CMake target with the Emscripten SDK on PATH:

```bash
source "$HOME/emsdk/emsdk_env.sh"
emcmake cmake -B build-wasm -G Ninja -DEMSCRIPTEN=1 -DCMAKE_BUILD_TYPE=Release .
cmake --build build-wasm --parallel
```

`occt-import-js@0.0.23` pins OCCT to commit `d2abb6d844231cb8f29be6894440874a4700e4a5`
(submodule `occt/`). If `git.dev.opencascade.org` is unreachable, fetch the exact
pinned-commit tarball from the official GitHub mirror instead:

```bash
curl -sL -o occt.tar.gz "https://github.com/Open-Cascade-SAS/OCCT/archive/d2abb6d844231cb8f29be6894440874a4700e4a5.tar.gz"
mkdir occt && tar -xzf occt.tar.gz -C occt --strip-components=1
```

## Publish

Two link variants of the same object set are published because the application
repo's `package.json` is `"type": "module"`, which makes a classic UMD wrapper
unenforceable for `import()` in Node:

| file | build flags | used by |
|---|---|---|
| `occt-import-js.js` + `.wasm` | default (browser global via `<script>`) | app browser loader |
| `occt-import-js.node.mjs` + `.node.wasm` | `-sEXPORT_ES6=1 -sENVIRONMENT=node -sUSE_ES6_IMPORT_META=1` | CLI verification / bulk export |

Both are emitted into `public/occt-native/`. Without the `.node.mjs` variant,
`verifyGraphExporter <wrapper>` and `exportGraphs` cannot load the wrapper in
Node and will silently fall back to the tessellation wrapper.

## Verify Native Geometry

After the wrapper builds, verify it against the upstream cube fixture:

```powershell
npx tsx scripts/verifyOcctNativeWrapper.ts `
  C:\occt-topology\build\Release\occt-import-js.js
```

The cube must produce exactly 8 native vertices, 12 native edges, and 6 native
face loops before the wrapper is connected to the application.

Verify the full parser integration with:

```powershell
npx tsx scripts/verifyOcctParserNativeIntegration.ts `
  C:\occt-topology\build\Release\occt-import-js.js
```

## Enable In The Browser

Serve `occt-import-js.js` and `occt-import-js.wasm` from the same directory,
then configure:

```text
VITE_OCCT_TOPOLOGY_MODE=native
VITE_OCCT_NATIVE_WRAPPER_URL=/occt-native/occt-import-js.js
```

The standard wrapper and tessellation reconstruction remain the fallback when
the custom module cannot load or any mesh has an incomplete native payload.

An existing build can be published without recompiling:

```powershell
.\native\occt-topology-wrapper\publish-wrapper.ps1 `
  -BuildRoot C:\occt-topology\build `
  -PublishRoot .\public\occt-native
```

The published directory is intentionally git-ignored because the wrapper is a
generated build artifact.

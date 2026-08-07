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

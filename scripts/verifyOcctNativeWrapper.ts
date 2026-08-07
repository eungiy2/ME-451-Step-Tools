import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  EMPTY_OCCT_TOPOLOGY_OFFSETS,
  hasNativeOcctTopology,
  normalizeOcctMeshTopology,
  type OcctNativeMeshPayload,
} from "../src/utils/occtTopologyPayload";

const modulePath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const fixturePath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.resolve(
      "node_modules",
      "occt-import-js",
      "test",
      "testfiles",
      "simple-basic-cube",
      "cube.stp"
    );

if (!modulePath || !fs.existsSync(modulePath)) {
  throw new Error(
    "Usage: npx tsx scripts/verifyOcctNativeWrapper.ts <occt-import-js.js> [fixture.stp]"
  );
}
if (!fs.existsSync(fixturePath)) {
  throw new Error(`Missing STEP fixture: ${fixturePath}`);
}

const require = createRequire(import.meta.url);
const imported = require(modulePath);
const factory = imported.default || imported;
assert.equal(typeof factory, "function", "Wrapper module must export an Emscripten factory");

const wrapper = await factory({
  locateFile: (fileName: string) => path.join(path.dirname(modulePath), fileName),
});
const result = wrapper.ReadStepFile(
  new Uint8Array(fs.readFileSync(fixturePath)),
  {
    linearDeflection: 0.02,
    angularDeflection: 0.10,
  }
);

assert.equal(result?.success, true, "OCCT failed to parse the STEP fixture");
const nativeMeshes = (result.meshes || []).filter(hasNativeOcctTopology) as OcctNativeMeshPayload[];
assert.ok(nativeMeshes.length > 0, "Wrapper did not return native topology");

let offsets = EMPTY_OCCT_TOPOLOGY_OFFSETS;
const normalized = nativeMeshes.map((mesh: Parameters<typeof normalizeOcctMeshTopology>[0]) => {
  const topology = normalizeOcctMeshTopology(mesh, offsets);
  offsets = topology.nextOffsets;
  return topology;
});

const vertices = normalized.flatMap((topology) => topology.vertices);
const edges = normalized.flatMap((topology) => topology.edges);
const loops = normalized.flatMap((topology) => topology.loops);
const faces = normalized.flatMap((topology) => topology.faces);

assert.equal(faces.length, 6, "Cube should contain six native faces");
assert.equal(vertices.length, 8, "Cube should contain eight native vertices");
assert.equal(edges.length, 12, "Cube should contain twelve native edges");
assert.equal(loops.length, 6, "Cube should contain six native face loops");
assert.ok(edges.every((edge) => edge.topologySource === "occt"));
assert.ok(edges.every((edge) => edge.positions.length >= 6));
assert.ok(edges.every((edge) => edge.curveLength && edge.curveLength > 0));
assert.ok(nativeMeshes.every((mesh) =>
  mesh.brep_face_descriptors?.length === mesh.brep_faces.length
));
assert.ok(nativeMeshes.every((mesh) =>
  Array.from(mesh.brep_edges).every((edge) =>
    edge.signature_points && edge.signature_points.length >= 2
  )
));
assert.ok([
  ...faces,
  ...vertices,
  ...edges,
  ...loops,
].every((entity) => entity.topologySignature.startsWith("occt:v1:")));

const coarseResult = wrapper.ReadStepFile(
  new Uint8Array(fs.readFileSync(fixturePath)),
  {
    linearDeflection: 0.2,
    angularDeflection: 0.45,
  }
);
assert.equal(coarseResult?.success, true, "OCCT failed to parse the coarse STEP fixture");
let coarseOffsets = EMPTY_OCCT_TOPOLOGY_OFFSETS;
const coarseTopologies = (coarseResult.meshes || [])
  .filter(hasNativeOcctTopology)
  .map((mesh: OcctNativeMeshPayload) => {
    const topology = normalizeOcctMeshTopology(mesh, coarseOffsets);
    coarseOffsets = topology.nextOffsets;
    return topology;
  });
const sortedSignatures = (
  topologies: typeof normalized,
  kind: "faces" | "vertices" | "edges" | "loops"
) => topologies
  .flatMap((topology) => topology[kind].map((entity) => entity.topologySignature))
  .sort();
for (const kind of ["faces", "vertices", "edges", "loops"] as const) {
  assert.deepEqual(
    sortedSignatures(coarseTopologies, kind),
    sortedSignatures(normalized, kind),
    `${kind} signatures must not depend on tessellation deflection`
  );
}

console.log(
  `OCCT native wrapper verified: ${faces.length} faces, ${vertices.length} vertices, ` +
  `${edges.length} edges, ${loops.length} loops; signatures are deflection-independent.`
);

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseStepWithOcct } from "../src/utils/stepOcctParser";

const modulePath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const usesCubeFixture = !process.argv[3];
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
    "Usage: npx tsx scripts/verifyOcctParserNativeIntegration.ts <occt-import-js.js> [fixture.stp]"
  );
}
if (!fs.existsSync(fixturePath)) {
  throw new Error(`Missing STEP fixture: ${fixturePath}`);
}

const result = await parseStepWithOcct(
  new Uint8Array(fs.readFileSync(fixturePath)),
  {
    linearDeflection: 0.02,
    angularDeflection: 0.10,
    topologyMode: "native",
    nativeWrapperUrl: pathToFileURL(modulePath).toString(),
  }
);

assert.equal(result?.success, true, "Integrated parser failed to parse the STEP fixture");
assert.equal(result.geometryTopologySource, "occt");
assert.ok(result.meshes.length > 0, "Parser should return rendered faces");
assert.equal(result.faces.length, result.meshes.length, "Every rendered face needs native topology");
assert.ok(result.vertices.length > 0, "Parser should return native vertices");
assert.ok(result.edges.length > 0, "Parser should return native edges");
assert.ok(result.loops.length > 0, "Parser should return native loops");
if (usesCubeFixture) {
  assert.equal(result.meshes.length, 6, "Cube should contain six rendered faces");
  assert.equal(result.vertices.length, 8, "Cube should contain eight native vertices");
  assert.equal(result.edges.length, 12, "Cube should contain twelve native edges");
  assert.equal(result.loops.length, 6, "Cube should contain six native loops");
}
assert.ok(result.faces.every((face: any, index: number) =>
  face.id === `BRepFace-${index}` &&
  face.topologySignature?.startsWith("occt:v1:face:")
));
assert.ok(result.meshes.every((mesh: any, index: number) =>
  mesh.topologySource === "occt" &&
  mesh.topologySignature === result.faces[index].topologySignature
));
assert.ok(result.vertices.every((vertex: any) =>
  vertex.topologySignature?.startsWith("occt:v1:vertex:")
));
assert.ok(result.edges.every((edge: any) => edge.topologySource === "occt"));
assert.ok(result.edges.every((edge: any) =>
  edge.topologySignature?.startsWith("occt:v1:edge:")
));
assert.ok(result.edges.every((edge: any) => edge.positions instanceof Float32Array));
assert.ok(result.edges.every((edge: any, index: number) => edge.id === `BRepEdge-${index}`));
assert.ok(result.edges.every((edge: any) =>
  edge.parentFaceIndices.every(
    (faceIndex: number) => faceIndex >= 0 && faceIndex < result.meshes.length
  )
));
const nativeVertexIds = new Set(result.vertices.map((vertex: any) => vertex.id));
assert.ok(result.edges.every((edge: any) =>
  edge.vertexIds.length > 0 &&
  edge.vertexIds.every((vertexId: string) => nativeVertexIds.has(vertexId))
));
const incidentEdgeCountByVertex = new Map<string, number>();
result.edges.forEach((edge: any) => {
  new Set<string>(edge.vertexIds).forEach((vertexId) => {
    incidentEdgeCountByVertex.set(
      vertexId,
      (incidentEdgeCountByVertex.get(vertexId) || 0) + 1
    );
  });
});
assert.ok(
  [...incidentEdgeCountByVertex.values()].some((edgeCount) => edgeCount >= 2),
  "Native topology should expose at least one selectable multi-edge vertex"
);
assert.ok(result.loops.every((loop: any) =>
  loop.topologySignature?.startsWith("occt:v1:loop:")
));

const collisionCounts = [
  ["face", result.faces],
  ["edge", result.edges],
  ["vertex", result.vertices],
  ["loop", result.loops],
].map(([kind, entities]: any[]) => {
  const signatures = entities.map((entity: any) => entity.topologySignature);
  const collisionCount = signatures.length - new Set(signatures).size;
  return { kind, collisionCount };
});
if (usesCubeFixture) {
  assert.ok(
    collisionCounts.every(({ collisionCount }) => collisionCount === 0),
    `Cube stable signatures must be unique: ${JSON.stringify(collisionCounts)}`
  );
}

console.log(
  `OCCT parser native integration verified for ${path.basename(fixturePath)}: ` +
  `${result.meshes.length} faces, ${result.vertices.length} vertices, ` +
  `${result.edges.length} edges, ${result.loops.length} loops; signature collisions ` +
  collisionCounts.map(({ kind, collisionCount }) => `${kind}=${collisionCount}`).join(", ") +
  "."
);

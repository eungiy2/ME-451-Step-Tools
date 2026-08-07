import assert from "node:assert/strict";
import {
  hasNativeOcctTopology,
  normalizeOcctMeshTopology,
  type OcctNativeMeshPayload,
} from "../src/utils/occtTopologyPayload";

const payload: OcctNativeMeshPayload = {
  topology_source: "occt",
  brep_faces: [{}, {}],
  brep_face_descriptors: [
    {
      index: 0,
      surface_type: "plane",
      area: 1,
      centroid: [0.5, 0.5, 0],
      bounds: [0, 0, 0, 1, 1, 0],
    },
    {
      index: 1,
      surface_type: "plane",
      area: 1,
      centroid: [0.5, 0.5, 1],
      bounds: [0, 0, 1, 1, 1, 1],
    },
  ],
  brep_vertices: [
    { index: 4, position: [0, 0, 0] },
    { index: 7, position: [1, 0, 0] },
    { index: 9, position: [1, 1, 0] },
  ],
  brep_edges: [
    {
      index: 12,
      positions: [0, 0, 0, 1, 0, 0],
      face_indices: [0, 1],
      vertex_indices: [4, 7],
      curve_type: "line",
      curve_length: 1,
      signature_points: [[0, 0, 0], [0.5, 0, 0], [1, 0, 0]],
      closed: false,
    },
    {
      index: 18,
      positions: [1, 0, 0, 1, 1, 0],
      face_indices: [0],
      vertex_indices: [7, 9],
      curve_type: "line",
      curve_length: 1,
      signature_points: [[1, 0, 0], [1, 0.5, 0], [1, 1, 0]],
      closed: false,
    },
  ],
  brep_loops: [
    {
      index: 3,
      face_index: 0,
      edge_indices: [12, 18],
    },
  ],
};

assert.equal(hasNativeOcctTopology(payload), true);

const normalized = normalizeOcctMeshTopology(payload, {
  face: 20,
  edge: 30,
  vertex: 40,
  loop: 50,
});

assert.deepEqual(normalized.edges.map((edge) => edge.id), ["BRepEdge-30", "BRepEdge-31"]);
assert.deepEqual(normalized.edges[0].parentFaceIds, ["BRepFace-20", "BRepFace-21"]);
assert.deepEqual(normalized.edges[0].vertexIds, ["BRepVertex-40", "BRepVertex-41"]);
assert.deepEqual(normalized.loops[0].edgeIds, ["BRepEdge-30", "BRepEdge-31"]);
assert.deepEqual(normalized.faces[0].loopIds, ["BRepLoop-50"]);
assert.deepEqual(normalized.faces[0].edgeIds, ["BRepEdge-30", "BRepEdge-31"]);
assert.equal(normalized.edges[0].positions instanceof Float32Array, true);
assert.equal(normalized.edges[0].curveLength, 1);
assert.ok([
  ...normalized.faces,
  ...normalized.vertices,
  ...normalized.edges,
  ...normalized.loops,
].every((entity) => entity.topologySignature.startsWith("occt:v1:")));
assert.deepEqual(normalized.nextOffsets, {
  face: 22,
  edge: 32,
  vertex: 43,
  loop: 51,
});

const reorderedPayload: OcctNativeMeshPayload = {
  ...payload,
  brep_face_descriptors: Array.from(payload.brep_face_descriptors!).reverse(),
  brep_vertices: Array.from(payload.brep_vertices).reverse(),
  brep_edges: Array.from(payload.brep_edges)
    .reverse()
    .map((edge) => ({
      ...edge,
      signature_points: edge.signature_points
        ? Array.from(edge.signature_points).reverse()
        : undefined,
    })),
  brep_loops: Array.from(payload.brep_loops).map((loop) => ({
    ...loop,
    edge_indices: Array.from(loop.edge_indices).reverse(),
  })),
};
const reordered = normalizeOcctMeshTopology(reorderedPayload, {
  face: 20,
  edge: 30,
  vertex: 40,
  loop: 50,
});

const signaturesByNativeIndex = <T extends { nativeIndex: number; topologySignature: string }>(
  entities: T[]
) => entities
  .map(({ nativeIndex, topologySignature }) => [nativeIndex, topologySignature] as const)
  .sort(([left], [right]) => left - right);

assert.deepEqual(
  signaturesByNativeIndex(reordered.faces),
  signaturesByNativeIndex(normalized.faces),
  "Face signatures must ignore payload ordering and loop traversal direction"
);
assert.deepEqual(
  signaturesByNativeIndex(reordered.vertices),
  signaturesByNativeIndex(normalized.vertices),
  "Vertex signatures must ignore payload ordering"
);
assert.deepEqual(
  signaturesByNativeIndex(reordered.edges),
  signaturesByNativeIndex(normalized.edges),
  "Edge signatures must ignore payload and curve traversal direction"
);
assert.deepEqual(
  signaturesByNativeIndex(reordered.loops),
  signaturesByNativeIndex(normalized.loops),
  "Loop signatures must ignore start edge and traversal direction"
);

const changedFace = normalizeOcctMeshTopology({
  ...payload,
  brep_face_descriptors: Array.from(payload.brep_face_descriptors!).map((descriptor) =>
    descriptor.index === 0 ? { ...descriptor, area: 1.25 } : descriptor
  ),
});
assert.notEqual(
  changedFace.faces[0].topologySignature,
  normalizeOcctMeshTopology(payload).faces[0].topologySignature,
  "Analytically different faces must not share a stable signature"
);

assert.throws(
  () => normalizeOcctMeshTopology({
    ...payload,
    brep_edges: [{
      ...payload.brep_edges[0],
      face_indices: [5],
    }],
  }),
  /missing index 5/
);

console.log("OCCT native topology payload contract verified.");

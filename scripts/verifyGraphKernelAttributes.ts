/**
 * Verifies that the graph exporter consumes OCCT kernel graph attributes
 * (exact analytic surfaces, edge midpoints, per-edge normals, and the in-kernel
 * convexity/dihedral classification) instead of re-deriving them with
 * TypeScript tessellation math.
 *
 * The OCCT WASM wrapper cannot be compiled in this environment, so this script
 * verifies both layers the kernel payload flows through:
 *
 * 1. `normalizeOcctMeshTopology` — the raw wrapper payload (as the C++
 *    `WriteNativeTopology` emits) is normalized into faces carrying
 *    `analytic`/`convexity`/`centroid_point`/`centroid_normal` and edges
 *    carrying `midpoint`/`faceNormals`/`contacts`.
 * 2. `exportGraph` with a real tessellation parse of the cube fixture enriched
 *    with kernel-style attributes — the exported graph must use the kernel
 *    values (adjacency edges exactly 90°, `kernelGeometry: true`), and the
 *    same input without the kernel attributes must fall back to the
 *    TypeScript path (`kernelGeometry: false`).
 *
 * Usage: npx tsx scripts/verifyGraphKernelAttributes.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseStepFile } from "../src/utils/stepParser";
import { parseStepWithOcct } from "../src/utils/stepOcctParser";
import { autoGenerateFaceMapping } from "../src/utils/geometryClassifier";
import { enrichPmiTopologyReferences } from "../src/utils/pmiTopologyReferences";
import { exportGraph, type ExportGraphResult } from "../src/utils/graphExporter";
import {
  normalizeOcctMeshTopology,
  type OcctNativeMeshPayload,
} from "../src/utils/occtTopologyPayload";
import { loadLocalOcct } from "./occtNode";
import { computeAreaWeightedNormal, vertexCentroid } from "../src/utils/convexity";

/* ------------------------------------------------------------------ */
/* 1. Payload normalization                                            */
/* ------------------------------------------------------------------ */

// Unit cube in OCCT local face-index namespace. Corner order:
// 0:(0,0,0) 1:(10,0,0) 2:(0,10,0) 3:(0,0,10)
// 4:(10,10,0) 5:(10,0,10) 6:(0,10,10) 7:(10,10,10)
const CUBE_VERTICES = [
  [0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10],
  [10, 10, 0], [10, 0, 10], [0, 10, 10], [10, 10, 10],
] as const;

// Each edge: [cornerA, cornerB, [faceA, faceB]].
const CUBE_EDGES = [
  [0, 1, [0, 1]], [1, 4, [0, 2]], [4, 2, [0, 3]], [2, 0, [0, 4]],
  [3, 5, [5, 1]], [5, 7, [5, 2]], [7, 6, [5, 3]], [6, 3, [5, 4]],
  [0, 3, [4, 1]], [1, 5, [1, 2]], [4, 7, [2, 3]], [2, 6, [3, 4]],
] as const;

const FACE_EDGE_INDEX_GROUPS: number[][] = [
  [0, 1, 2, 3],   // F0 z=0
  [0, 4, 8, 9],   // F1 y=0
  [1, 5, 9, 10],  // F2 x=10
  [2, 6, 10, 11], // F3 y=10
  [3, 7, 8, 11],  // F4 x=0
  [4, 5, 6, 7],   // F5 z=10
];

const vec = (a: readonly number[], b: readonly number[]) =>
  [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as number[];

const scalar = (a: readonly number[], k: number) =>
  [a[0] * k, a[1] * k, a[2] * k] as number[];

const add = (a: readonly number[], b: readonly number[]) =>
  [a[0] + b[0], a[1] + b[1], a[2] + b[2]] as number[];

const unit = (a: readonly number[]): number[] => {
  const length = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
  return [a[0] / length, a[1] / length, a[2] / length];
};

const midpoint = (a: readonly number[], b: readonly number[]) =>
  scalar(add(a, b), 0.5) as number[];

const lineSamples = (a: readonly number[], b: readonly number[]) =>
  [0, 1, 2, 3, 4].map((ratio) => add(a, scalar(vec(a, b), ratio / 4)));

const FACE_NORMALS: number[][] = [
  [0, 0, -1], [0, -1, 0], [1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, 0, 1],
];

const buildCubePayload = (): OcctNativeMeshPayload => {
  const brepVertices = CUBE_VERTICES.map((position, index) => ({
    index,
    position: [...position] as number[],
  }));
  const brepEdges = CUBE_EDGES.map(([a, b, faces], index) => {
    const pA = CUBE_VERTICES[a];
    const pB = CUBE_VERTICES[b];
    const sortedFaces = [...faces].sort((x, y) => x - y);
    return {
      index,
      positions: [...pA, ...pB] as number[],
      face_indices: [...faces] as number[],
      vertex_indices: [a, b] as number[],
      curve_type: "line",
      curve_length: Math.hypot(...vec(pA, pB)),
      signature_points: lineSamples(pA, pB),
      closed: false,
      midpoint: midpoint(pA, pB),
      normals: sortedFaces.map((faceIndex) => {
        const n = FACE_NORMALS[faceIndex];
        // Outward normal of the incident face evaluated at the midpoint.
        return unit(n) as number[];
      }),
      contacts: [
        {
          face_i: sortedFaces[0],
          face_j: sortedFaces[1],
          convexity: "convex" as const,
          dihedral_deg: 90,
        },
      ],
    };
  });
  const brepLoops = FACE_EDGE_INDEX_GROUPS.map((edgeIndices, faceIndex) => ({
    index: faceIndex,
    face_index: faceIndex,
    edge_indices: [...edgeIndices] as number[],
  }));
  const brepFaceDescriptors = FACE_NORMALS.map((normal, faceIndex) => ({
    index: faceIndex,
    surface_type: "plane",
    area: 100,
    centroid: [5, 5, 5] as number[],
    bounds: [0, 0, 0, 10, 10, 10] as number[],
    analytic: {
      plane: {
        normal: unit(normal) as number[],
        point: [5, 5, 5] as number[],
      },
    },
    convexity: "unknown",
    centroid_point: [5, 5, 5] as number[],
    centroid_normal: unit(normal) as number[],
  }));

  return {
    topology_source: "occt",
    brep_faces: Array.from({ length: 6 }, () => ({})),
    brep_vertices: brepVertices,
    brep_edges: brepEdges,
    brep_loops: brepLoops,
    brep_face_descriptors: brepFaceDescriptors,
  };
};

const normalized = normalizeOcctMeshTopology(buildCubePayload());
assert.equal(normalized.faces.length, 6, "cube namespace has six faces");
assert.equal(normalized.edges.length, 12, "cube namespace has twelve edges");
assert.equal(normalized.kernelGraphAttributes, true, "payload carries kernel graph attributes");
for (const face of normalized.faces) {
  assert.ok(
    face.analytic?.plane?.normal,
    `face ${face.id} has kernel analytic plane`
  );
  assert.equal(face.convexity, "unknown", `face ${face.id} kernel convexity passthrough`);
  assert.ok(face.centroidPoint && face.centroidNormal, `face ${face.id} has kernel centroid normal`);
}
for (const edge of normalized.edges) {
  assert.ok(edge.midpoint, `edge ${edge.id} has kernel midpoint`);
  assert.equal(edge.faceNormals?.length, 2, `edge ${edge.id} has two face normals`);
  assert.equal(edge.contacts?.length, 1, `edge ${edge.id} has one contact`);
  const contact = edge.contacts![0];
  assert.deepEqual(
    [contact.faceAId, contact.faceBId].sort(),
    edge.parentFaceIds.map(String).sort(),
    `edge ${edge.id} contact maps to its owning faces`
  );
  assert.equal(contact.convexity, "convex");
  assert.equal(contact.dihedralDeg, 90);
}
console.log("Payload normalization verified: analytic faces, edge midpoint/normals/contacts map through.");

/* ------------------------------------------------------------------ */
/* 2. Export-level kernel consumption                                   */
/* ------------------------------------------------------------------ */

const fixturePath = path.resolve(
  "node_modules", "occt-import-js", "test", "testfiles", "simple-basic-cube", "cube.stp"
);
const bytes = new Uint8Array(fs.readFileSync(fixturePath));
const text = new TextDecoder("utf-8").decode(bytes);
const baseName = path.basename(fixturePath).replace(/\.stp$/i, "");
const parsedBase = parseStepFile(baseName, text);

const occtResult = await parseStepWithOcct(bytes, {
  occtInstance: await loadLocalOcct(),
});
assert.equal(occtResult?.success, true, "cube must parse (tessellation)");
assert.equal(occtResult.meshes.length, 6, "cube has six faces");
assert.equal(occtResult.edges.length, 12, "cube has twelve edges");

// Recompute the exact analytic plane of each tessellated cube face so the
// synthetic kernel payload is consistent with the fixture geometry.
const meshes = occtResult.meshes as any[];
meshes.forEach((mesh, index) => {
  const normal = computeAreaWeightedNormal(mesh.positions || [], mesh.indices);
  const centroid = vertexCentroid(mesh.positions || []);
  assert.ok(normal, `mesh ${index} normal computable`);
  mesh.surfaceType = "plane";
  mesh.analytic = {
    plane: {
      normal: [normal.x, normal.y, normal.z],
      point: [centroid.x, centroid.y, centroid.z],
    },
  };
  mesh.kernelConvexity = "unknown";
  mesh.kernelCentroidPoint = { x: centroid.x, y: centroid.y, z: centroid.z };
  mesh.kernelCentroidNormal = { x: normal.x, y: normal.y, z: normal.z };
});

const edges = occtResult.edges as any[];
edges.forEach((edge, index) => {
  const positions = edge.positions || [];
  const count = Math.floor(positions.length / 3);
  const sum = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < count; i++) {
    sum.x += positions[i * 3];
    sum.y += positions[i * 3 + 1];
    sum.z += positions[i * 3 + 2];
  }
  const mid = { x: sum.x / count, y: sum.y / count, z: sum.z / count };
  const faceIds = (Array.isArray(edge.parentFaceIds)
    && edge.parentFaceIds.length > 0
    ? edge.parentFaceIds
    : edge.parentFaceIndices.map((f: unknown) => `BRepFace-${f}`)
  ).map(String).sort();
  edge.midpoint = mid;
  edge.contacts = [
    {
      faceAId: faceIds[0],
      faceBId: faceIds[1],
      convexity: "convex",
      dihedralDeg: 90,
    },
  ];
});

const faceMapping = autoGenerateFaceMapping(occtResult.meshes, text);
const parsed = enrichPmiTopologyReferences(parsedBase, occtResult, faceMapping);
const exportInput = { parsed, occtResult, faceMapping, partMetadata: { schema: "AP203" } };

const graph: ExportGraphResult = exportGraph(exportInput);
const graphAgain: ExportGraphResult = exportGraph(exportInput);
assert.equal(
  JSON.stringify(graph),
  JSON.stringify(graphAgain),
  "kernel-driven graph export must be byte-identical across runs"
);
assert.equal(graph.source.kernelGeometry, true, "kernel graph attributes drive the graph");
assert.equal(graph.nodes.filter((n) => n.nodeType === "face").length, 6);
assert.equal(graph.edges.filter((e) => e.nodeType === "adjacency").length, 12);

for (const edge of graph.edges.filter((e) => e.nodeType === "adjacency")) {
  assert.equal(edge.geometrySource, "occt", `adjacency ${edge.id} is kernel-derived`);
  assert.equal(edge.convexity, "convex", `adjacency ${edge.id} convex`);
  assert.ok(
    Math.abs(Number(edge.dihedralDeg) - 90) < 1e-3,
    `adjacency ${edge.id} dihedral ~90 got ${edge.dihedralDeg}`
  );
}
for (const face of graph.nodes.filter((n) => n.nodeType === "face")) {
  assert.equal(face.geometrySource, "occt", `face ${face.id} analytic is kernel-derived`);
  assert.ok(
    (face.analytic as { plane?: unknown } | undefined)?.plane,
    `face ${face.id} exact OCCT plane`
  );
}

// Fallback: drop the kernel attributes → exporter must degrade to TS math.
const fallbackMeshes = (occtResult.meshes as any[]).map((mesh) => {
  const { analytic, kernelConvexity, kernelCentroidPoint, kernelCentroidNormal, surfaceType, ...rest } = mesh;
  void analytic; void kernelConvexity; void kernelCentroidPoint; void kernelCentroidNormal;
  void surfaceType;
  return rest;
});
const fallbackEdges = (occtResult.edges as any[]).map((edge) => {
  const { midpoint, contacts, ...rest } = edge;
  void midpoint; void contacts;
  return rest;
});
const fallbackGraph = exportGraph({
  ...exportInput,
  occtResult: { ...occtResult, meshes: fallbackMeshes, edges: fallbackEdges },
});
assert.equal(fallbackGraph.source.kernelGeometry, false, "without kernel data, geometry is TS-derived");
for (const edge of fallbackGraph.edges.filter((e) => e.nodeType === "adjacency")) {
  assert.equal(edge.geometrySource, "ts", `fallback adjacency ${edge.id} uses TS math`);
  assert.equal(edge.convexity, "convex");
  assert.ok(Math.abs(Number(edge.dihedralDeg) - 90) < 1e-3, "ts fallback dihedral ~90");
}

console.log(
  `Kernel graph attributes verified on ${baseName}: ` +
  `${graph.source.nodeCount} nodes / ${graph.source.edgeCount} edges, ` +
  "12 kernel-only adjacency classifications, deterministic, fallback intact."
);
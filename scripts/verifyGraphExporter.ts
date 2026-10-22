/**
 * End-to-end graph exporter verification on the cube fixture.
 *
 * Usage: npx tsx scripts/verifyGraphExporter.ts [wrapper.js] [fixture.stp]
 *
 * Defaults to `node_modules/occt-import-js/test/testfiles/simple-basic-cube/cube.stp`
 * (the same negative-control-equivalent the other OCCT verify scripts use).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseStepFile } from "../src/utils/stepParser";
import { parseStepWithOcct } from "../src/utils/stepOcctParser";
import { autoGenerateFaceMapping } from "../src/utils/geometryClassifier";
import { enrichPmiTopologyReferences } from "../src/utils/pmiTopologyReferences";
import { exportGraph } from "../src/utils/graphExporter";
import { loadLocalOcct, resolveOcctForNode } from "./occtNode";

const fixturePath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.resolve("node_modules", "occt-import-js", "test", "testfiles", "simple-basic-cube", "cube.stp");
if (!fs.existsSync(fixturePath)) {
  throw new Error(`Missing STEP fixture: ${fixturePath}`);
}

const bytes = new Uint8Array(fs.readFileSync(fixturePath));
const text = new TextDecoder("utf-8").decode(bytes);
const baseName = path.basename(fixturePath).replace(/\.stp$/i, "");
const parsedBase = parseStepFile(baseName, text);

const { nativeWrapperUrl } = resolveOcctForNode(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
let occtResult;
let topologySource: string | undefined;
if (!nativeWrapperUrl) {
  occtResult = await parseStepWithOcct(bytes, { occtInstance: await loadLocalOcct() });
  topologySource = occtResult?.geometryTopologySource;
} else {
  try {
    occtResult = await parseStepWithOcct(bytes, {
      linearDeflection: 0.02,
      angularDeflection: 0.1,
      topologyMode: "native",
      nativeWrapperUrl,
    });
    topologySource = occtResult?.geometryTopologySource;
    if (!occtResult?.success) {
      throw new Error(`OCCT parse failed: ${occtResult?.error || "mesh result falsy"}`);
    }
  } catch (error) {
    console.warn(
      `Native wrapper failed for ${baseName} — falling back to the local occt-import-js instance.`,
      error instanceof Error ? error.message : String(error)
    );
    occtResult = await parseStepWithOcct(bytes, {
      occtInstance: await loadLocalOcct(),
    });
    topologySource = occtResult?.geometryTopologySource;
  }
}
assert.equal(occtResult?.success, true, "cube must parse");
assert.equal(occtResult.meshes.length, 6, "cube has six faces");
assert.equal(occtResult.edges.length, 12, "cube has twelve edges");

const faceMapping = autoGenerateFaceMapping(occtResult.meshes, text);
const parsed = enrichPmiTopologyReferences(parsedBase, occtResult, faceMapping);

const exportInput = { parsed, occtResult, faceMapping, partMetadata: { schema: "AP203" } };
const graph = exportGraph(exportInput);
const graphAgain = exportGraph(exportInput);
assert.equal(
  JSON.stringify(graph),
  JSON.stringify(graphAgain),
  "graph export must be byte-identical across runs"
);

// Base substrate
assert.equal(graph.nodes.filter((n) => n.nodeType === "face").length, 6);
assert.equal(graph.edges.filter((e) => e.nodeType === "adjacency").length, 12);

// Every cube edge is convex with a ~90° dihedral.
for (const edge of graph.edges.filter((e) => e.nodeType === "adjacency")) {
  assert.equal(edge.convexity, "convex", `cube edge ${edge.id} should be convex`);
  assert.ok(Math.abs(Number(edge.dihedralDeg) - 90) < 1e-3, `dihedral ~90 got ${edge.dihedralDeg}`);
}

// Negative control: no PMI on the geometry-only cube.
for (const nodeType of ["datum", "datumReferenceFrame", "toleranceValue", "toleranceZone", "dimension", "feature"]) {
  assert.equal(
    graph.nodes.filter((n) => n.nodeType === nodeType).length,
    0,
    `cube should have no ${nodeType} nodes`
  );
}
assert.equal(graph.source.schema, "AP203");
assert.equal(graph.nodes.filter((n) => n.nodeType === "part").length, 1);

// Kernel path gate: when a native wrapper carries the kernel graph attributes
// (analytic faces, edge contacts), the graph geometry MUST be kernel-derived.
// A wrapper built before the kernel attributes — or the tessellation fallback —
// must report `kernelGeometry: false` instead. The exporter never mixes
// sources silently.
const meshesCarryKernelAnalytic = (occtResult.meshes as any[]).some(
  (mesh) => Boolean(mesh?.analytic) && typeof mesh.analytic === "object"
);
if (topologySource === "occt" && meshesCarryKernelAnalytic) {
  assert.equal(
    graph.source.kernelGeometry,
    true,
    "native wrapper with kernel attributes must produce a kernel-derived graph"
  );
  assert.equal(
    graph.edges
      .filter((edge) => edge.nodeType === "adjacency")
      .every((edge) => edge.geometrySource === "occt"),
    true,
    "native wrapper with kernel attributes must classify every adjacency in-kernel"
  );
} else {
  assert.equal(
    graph.source.kernelGeometry,
    false,
    "legacy native wrapper or tessellation fallback must report kernelGeometry: false"
  );
}

console.log(
  `Graph exporter verified on ${baseName}: ` +
  `${graph.source.nodeCount} nodes / ${graph.source.edgeCount} edges, ` +
  `12 convex cube adjacencies, no PMI, deterministic (` +
  `kernelGeometry: ${graph.source.kernelGeometry}).`
);
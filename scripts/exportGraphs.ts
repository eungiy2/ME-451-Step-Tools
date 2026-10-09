import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { autoGenerateFaceMapping } from "../src/utils/geometryClassifier";
import { parseStepWithOcct } from "../src/utils/stepOcctParser";
import { parseStepFile } from "../src/utils/stepParser";
import {
  buildGraphSummary,
  exportGraph,
  serializeGraph,
  serializeGraphDeterministic,
  stageOcctWrapperForNode,
} from "../src/utils/exportGraph";

/**
 * Exports one deterministic JSON graph per NIST fixture.
 *
 * Usage:
 *   npx tsx scripts/exportGraphs.ts <occt-import-js.js> [outDir] [fixtureFilter]
 */

const modulePath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const outDir = process.argv[3] ? path.resolve(process.argv[3]) : path.resolve("graphs");
const fixtureFilter = process.argv[4] || "";

if (!modulePath || !fs.existsSync(modulePath)) {
  throw new Error(
    "Usage: npx tsx scripts/exportGraphs.ts <occt-import-js.js> [outDir] [fixtureFilter]"
  );
}

const loaderModuleUrl = pathToFileURL(stageOcctWrapperForNode(modulePath)).toString();

const AP242_DIR = path.resolve("STEP samples with PMI", "AP242");
const AP203_DIR = path.resolve("STEP samples with PMI", "AP203");

const listFixtures = (): string[] => {
  const ap242 = fs.readdirSync(AP242_DIR)
    .filter((name) => name.endsWith(".stp") || name.endsWith(".step"))
    .sort()
    .map((name) => path.join(AP242_DIR, name));
  // Negative control: AP203 file with no PMI.
  const negativeControl = path.join(AP203_DIR, "nist_ctc_01_asme1_ap203.stp");
  return [...ap242, ...(fs.existsSync(negativeControl) ? [negativeControl] : [])];
};

const fixtures = listFixtures().filter((file) =>
  !fixtureFilter || path.basename(file).includes(fixtureFilter)
);

if (fixtures.length === 0) {
  throw new Error(`No fixtures matched: ${fixtureFilter}`);
}

fs.mkdirSync(outDir, { recursive: true });

const index: Array<Record<string, unknown>> = [];

for (const fixturePath of fixtures) {
  const fileName = path.basename(fixturePath);
  const bytes = new Uint8Array(fs.readFileSync(fixturePath));
  const text = new TextDecoder("utf-8").decode(bytes);
  const parsed = parseStepFile(fileName, text);

  let occtResult: any;
  try {
    occtResult = await parseStepWithOcct(bytes, {
      linearDeflection: 0.02,
      angularDeflection: 0.1,
      topologyMode: "native",
      nativeWrapperUrl: loaderModuleUrl,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`SKIP ${fileName}: OCCT import failed (${reason})`);
    index.push({ fileName, status: "occt-import-failed", reason });
    continue;
  }

  // Some NIST revisions carry only tessellated presentation geometry and no
  // B-Rep at all, so OCCT yields no renderable mesh. Exporting an empty graph
  // would look like success and hide the gap, so report the skip instead.
  if (!Array.isArray(occtResult?.meshes) || occtResult.meshes.length === 0) {
    const reason = "no-renderable-geometry-in-step-file";
    console.warn(`SKIP ${fileName}: ${reason} (OCCT returned no meshes)`);
    index.push({ fileName, status: "no-geometry", reason });
    continue;
  }

  const faceMapping = autoGenerateFaceMapping(occtResult.meshes, parsed.rawText);
  const result = exportGraph({
    parsed,
    occtResult,
    faceMapping,
    linearDeflection: 0.02,
    angularDeflection: 0.1,
    generatedAt: new Date().toISOString(),
  });

  // Determinism: a second, independent build must be byte-identical once the
  // traceability timestamp is removed.
  const replay = exportGraph({
    parsed: parseStepFile(fileName, text),
    occtResult,
    faceMapping,
    linearDeflection: 0.02,
    angularDeflection: 0.1,
    generatedAt: new Date(Date.now() + 1000).toISOString(),
  });
  assert.equal(
    replay.deterministicJson,
    result.deterministicJson,
    `Graph serialization must be byte-identical across runs for ${fileName}`
  );
  assert.equal(
    serializeGraphDeterministic(result.graph),
    result.deterministicJson,
    `generatedAt must be the only non-deterministic field for ${fileName}`
  );
  assert.ok(
    serializeGraph(result.graph).includes(`"generatedAt": "${result.graph.generatedAt}"`),
    `The traceability timestamp must survive full serialization for ${fileName}`
  );

  const baseName = fileName.replace(/\.(stp|step)$/i, "");
  fs.writeFileSync(path.join(outDir, `${baseName}.graph.json`), result.deterministicJson, "utf8");
  // The summary is written from the timestamp-free graph so both artifacts are
  // byte-identical across runs of the same file.
  fs.writeFileSync(
    path.join(outDir, `${baseName}.graph.md`),
    buildGraphSummary({ ...result.graph, generatedAt: undefined }),
    "utf8"
  );
  assert.equal(
    result.summaryMarkdown,
    buildGraphSummary({ ...result.graph, generatedAt: undefined }),
    "Summary generation must not depend on the timestamp"
  );

  const { statistics } = result.graph;
  index.push({
    fileName,
    status: "ok",
    schema: result.graph.source.schema,
    geometryTopologySource: result.graph.source.geometryTopologySource,
    graphVersion: result.graph.graphVersion,
    graph: `${baseName}.graph.json`,
    summary: `${baseName}.graph.md`,
    nodeCounts: statistics.nodeCounts,
    edgeCounts: statistics.edgeCounts,
    pmiReferenceResolutionCounts: statistics.pmiReferenceResolutionCounts,
    adjacencyConvexityCounts: statistics.adjacencyConvexityCounts,
    nonManifoldEdgeCount: statistics.nonManifoldEdgeCount,
    indifferminateConvexityCount: statistics.indifferminateConvexityCount,
    normalOrientation: statistics.normalOrientation,
  });

  const resolved = statistics.pmiReferenceResolutionCounts.resolved || 0;
  const missing = statistics.pmiReferenceResolutionCounts.missing || 0;
  const ambiguous = statistics.pmiReferenceResolutionCounts.ambiguous || 0;
  console.log(
    `OK ${fileName}: ${result.graph.nodes.length} nodes, ${result.graph.edges.length} edges, ` +
    `PMI refs ${resolved} resolved / ${missing} missing / ${ambiguous} ambiguous`
  );
}

const indexPath = path.join(outDir, "index.json");
fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");

const graphVersion = index
  .filter((row) => row.status === "ok")
  .map((row) => row.graphVersion)
  .find((value): value is number => typeof value === "number");

const markdownIndex = [
  "# STEP fixture graph exports",
  "",
  "Generated by `scripts/exportGraphs.ts` over `src/utils/exportGraph.ts`.",
  `Graph schema version: ${graphVersion ?? 1}.`,
  "",
  "Skipped fixtures are listed with the reason; they are not silently exported",
  "as empty graphs.",
  "",
  "| Fixture | Schema | Topology | Nodes | Edges | Convexity (convex/concave/flat/indet.) | PMI resolved/missing/ambiguous |",
  "| --- | --- | --- | ---: | ---: | --- | --- |",
  ...index.map((row) => {
    if (row.status !== "ok") {
      return `| ${row.fileName} | - | - | - | - | - | SKIPPED: ${row.reason} |`;
    }
    const nodes = row.nodeCounts as Record<string, number>;
    const edges = row.edgeCounts as Record<string, number>;
    const convexity = row.adjacencyConvexityCounts as Record<string, number>;
    const pmi = row.pmiReferenceResolutionCounts as Record<string, number>;
    return [
      "",
      `| ${row.fileName}`,
      ` | ${row.schema ?? "unknown"}`,
      ` | ${row.geometryTopologySource}`,
      ` | ${Object.values(nodes).reduce((a, b) => a + b, 0)}`,
      ` | ${Object.values(edges).reduce((a, b) => a + b, 0)}`,
      ` | ${convexity.convex || 0}/${convexity.concave || 0}/${convexity.flat || 0}/${convexity.indeterminate || 0}`,
      ` | ${pmi.resolved || 0}/${pmi.missing || 0}/${pmi.ambiguous || 0} |`,
      "",
    ].join("");
  }),
  "",
].join("\n");
fs.writeFileSync(path.join(outDir, "README.md"), markdownIndex, "utf8");

console.log(`\nWrote ${index.length} fixture entries to ${outDir}`);
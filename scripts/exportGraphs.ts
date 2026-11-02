/**
 * Bulk graph exporter — emits docs/EXPORT_GRAPH_PLAN.md graphs for every NIST
 * AP242 fixture plus the AP203 negative control.
 *
 * Usage (Node, requires a built OCCT native wrapper — published to
 * `public/occt-native/occt-import-js.js` by `publish-wrapper.ps1`):
 *
 *   npx tsx scripts/exportGraphs.ts [wrapper.js] [outDir]
 *
 * Outputs one `<fixture>.graph.json` and one `<fixture>.summary.txt` per part.
 * Each export runs twice and asserts byte-identical output (determinism).
 */
import fs from "node:fs";
import path from "node:path";
import { parseStepFile } from "../src/utils/stepParser";
import { parseStepWithOcct } from "../src/utils/stepOcctParser";
import { autoGenerateFaceMapping } from "../src/utils/geometryClassifier";
import { enrichPmiTopologyReferences } from "../src/utils/pmiTopologyReferences";
import { exportGraph, type ExportGraphResult } from "../src/utils/graphExporter";
import { loadLocalOcct, resolveOcctForNode } from "./occtNode";

const resolveWrapperPath = (): string | undefined => {
  const explicit = process.argv[2];
  return explicit ? path.resolve(explicit) : undefined;
};
const resolveOutDir = (): string => {
  const explicit = process.argv[3];
  return explicit ? path.resolve(explicit) : path.resolve("graphs");
};

const listFixtures = (): { file: string; schema: string }[] => {
  const ap242Dir = path.resolve("public", "nist-ap242");
  if (!fs.existsSync(ap242Dir)) {
    throw new Error(`Missing fixture directory: ${ap242Dir}`);
  }
  const ap242 = fs.readdirSync(ap242Dir)
    .filter((name) => /\.stp$/i.test(name))
    .map((name) => ({ file: path.join(ap242Dir, name), schema: "AP242" }));
  const ap203 = path.resolve("STEP samples with PMI", "AP203", "nist_ctc_01_asme1_ap203.stp");
  if (fs.existsSync(ap203)) {
    ap242.push({ file: ap203, schema: "AP203" });
  }
  return ap242.sort((a, b) => a.file.localeCompare(b.file));
};

const renderSummary = (graph: ExportGraphResult): string => {
  const nodeCounts = new Map<string, number>();
  const edgeCounts = new Map<string, number>();
  graph.nodes.forEach((node) => nodeCounts.set(node.nodeType, (nodeCounts.get(node.nodeType) || 0) + 1));
  graph.edges.forEach((edge) => edgeCounts.set(edge.nodeType, (edgeCounts.get(edge.nodeType) || 0) + 1));

  const featureLines = graph.nodes
    .filter((node) => node.nodeType === "feature")
    .map((node) =>
      `- ${node.id} ${node.kind} (diameter=${node.diameter ?? node.pilotDiameter ?? "-"}mm, `
      + `memberFaces=${(node.memberFaces as string[] | undefined)?.length ?? 0})`
    )
    .join("\n");

  const facetConcave = graph.nodes.filter((node) => node.nodeType === "face" && node.convexity === "concave").length;
  const facetConvex = graph.nodes.filter((node) => node.nodeType === "face" && node.convexity === "convex").length;
  const partNode = graph.nodes.find((node) => node.nodeType === "part");
  const resolution = partNode?.pmiResolution as { resolved?: number; missing?: number; ambiguous?: number } | undefined;
  const resolutionLine = resolution
    ? `  PMI resolution: resolved=${resolution.resolved} missing=${resolution.missing} ambiguous=${resolution.ambiguous}`
    : "  PMI resolution: (none)";

  return [
    `Graph: ${graph.source.fileName}`,
    `  schema=${graph.source.schema}  stableHash=${graph.source.stableHash}`,
    `  nodes=${graph.source.nodeCount}  edges=${graph.source.edgeCount}  ~${graph.source.estimatedTokens} tokens`,
    `  Nodes: ${[...nodeCounts.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`,
    `  Edges: ${[...edgeCounts.entries()].map(([k, v]) => `${k}=${v}`).join(", ")}`,
    resolutionLine,
    `  Faces: planar/cylindrical/etc via surfaceType; convexity: convex=${facetConvex} concave=${facetConcave}`,
    `  Features:`,
    featureLines || "  (none)",
  ].join("\n");
};

const run = async () => {
  const { nativeWrapperUrl } = resolveOcctForNode(resolveWrapperPath());
  const outDir = resolveOutDir();
  fs.mkdirSync(outDir, { recursive: true });
  let localOcct: any;
  const localOcctInstance = async () => {
    if (!localOcct) localOcct = await loadLocalOcct();
    return localOcct;
  };

  const results: { file: string; ok: boolean; source?: string; error?: string }[] = [];
  for (const { file, schema } of listFixtures()) {
    const baseName = path.basename(file).replace(/\.stp$/i, "");
    try {
      const bytes = new Uint8Array(fs.readFileSync(file));
      const text = new TextDecoder("utf-8").decode(bytes);

      const parsedBase = parseStepFile(baseName, text);
      let occtResult;
      if (nativeWrapperUrl) {
        try {
          occtResult = await parseStepWithOcct(bytes, {
            linearDeflection: 0.1,
            angularDeflection: 0.1,
            topologyMode: "native",
            nativeWrapperUrl,
          });
          if (!occtResult?.success) throw new Error("native wrapper returned no mesh result");
        } catch (error) {
          console.warn(`${baseName}: native wrapper failed, using local occt-import-js — ${error instanceof Error ? error.message : String(error)}`);
          occtResult = await parseStepWithOcct(bytes, { occtInstance: await localOcctInstance() });
        }
      } else {
        occtResult = await parseStepWithOcct(bytes, { occtInstance: await localOcctInstance() });
      }
      const topologySource: string = occtResult.geometryTopologySource || "unknown";
      if (!occtResult?.success || !occtResult.meshes?.length) {
        throw new Error("OCCT returned no meshes");
      }

      const faceMapping = autoGenerateFaceMapping(occtResult.meshes, text);
      const parsed = enrichPmiTopologyReferences(parsedBase, occtResult, faceMapping);

      const exportInput = {
        parsed,
        occtResult,
        faceMapping,
        partMetadata: { schema },
      };
      const graph = exportGraph(exportInput);
      const graphAgain = exportGraph(exportInput);
      const deterministic = JSON.stringify(graph) === JSON.stringify(graphAgain);
      if (!deterministic) {
        throw new Error(`${baseName}: graph export is not byte-identical across runs`);
      }

      fs.writeFileSync(
        path.join(outDir, `${baseName}.graph.json`),
        JSON.stringify(graph, null, 2),
        "utf-8"
      );
      fs.writeFileSync(
        path.join(outDir, `${baseName}.summary.txt`),
        renderSummary(graph),
        "utf-8"
      );
      results.push({ file: baseName, ok: true, source: topologySource });
    } catch (error) {
      results.push({
        file: baseName,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(`Graphs exported to ${outDir}`);
  for (const result of results) {
    console.log(
      `  ${result.ok ? "OK  " : "FAIL"} ${result.file}`
      + `${result.source ? ` [${result.source}]` : ""}`
      + `${result.error ? ` — ${result.error}` : ""}`
    );
  }
  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length}/${results.length} fixtures failed.`);
    process.exitCode = 1;
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
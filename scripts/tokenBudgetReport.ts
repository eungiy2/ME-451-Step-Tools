/**
 * Token-budget report for the exported graphs — the Requirement 8 evidence.
 *
 * Usage: npx tsx scripts/tokenBudgetReport.ts [graphsDir]
 *
 * Reads every `<fixture>.graph.json` in `graphs/` (npm run export:graphs
 * outputs there) and emits:
 *   - graphs/token-budget.csv
 *   - graphs/token-budget.json
 * and prints a table to stdout.
 *
 * Token heuristics (documented, not a tokenizer):
 *   - raw STEP text  ≈ bytes / 3.5
 *   - graph JSON     ≈ chars / 3.5  (computed on the compact serialization)
 * `source.estimatedTokens` is the same / 3.5 estimate computed at export time.
 */
import fs from "node:fs";
import path from "node:path";
import type { ExportGraphResult } from "../src/utils/graphExporter";

const graphsDir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve("graphs");

const CHARS_PER_TOKEN = 3.5;

interface Row {
  fixture: string;
  schema: string;
  topologySource: string;
  rawBytes: number;
  rawTokens: number;
  graphBytesPretty: number;
  graphTokens: number;
  nodes: number;
  edges: number;
  sourceEstimatedTokens: number;
  tokenReduction: number; // rawTokens / graphTokens
}

const files = fs.readdirSync(graphsDir)
  .filter((name) => /\.graph\.json$/i.test(name))
  .sort();

const rows: Row[] = [];
for (const file of files) {
  const graph = JSON.parse(
    fs.readFileSync(path.join(graphsDir, file), "utf-8")
  ) as ExportGraphResult;
  const compact = JSON.stringify(graph);
  const rawTokens = Math.round(graph.source.fileSize / CHARS_PER_TOKEN);
  const graphTokens = Math.max(1, Math.round(compact.length / CHARS_PER_TOKEN));
  rows.push({
    fixture: graph.source.fileName,
    schema: graph.source.schema,
    topologySource: graph.source.topologySource,
    rawBytes: graph.source.fileSize,
    rawTokens,
    graphBytesPretty: fs.statSync(path.join(graphsDir, file)).size,
    graphTokens,
    nodes: graph.source.nodeCount,
    edges: graph.source.edgeCount,
    sourceEstimatedTokens: graph.source.estimatedTokens,
    tokenReduction: rawTokens / graphTokens,
  });
}

fs.writeFileSync(
  path.join(graphsDir, "token-budget.csv"),
  [
    "fixture,schema,topologySource,rawBytes,rawTokens,graphBytesPretty,graphTokens,nodes,edges,sourceEstimatedTokens,tokenReduction",
    ...rows.map((row) =>
      [
        row.fixture, row.schema, row.topologySource,
        row.rawBytes, row.rawTokens, row.graphBytesPretty, row.graphTokens,
        row.nodes, row.edges, row.sourceEstimatedTokens,
        row.tokenReduction.toFixed(2),
      ].join(",")
    ),
  ].join("\n"),
  "utf-8"
);

fs.writeFileSync(
  path.join(graphsDir, "token-budget.json"),
  JSON.stringify({ charsPerToken: CHARS_PER_TOKEN, rows }, null, 2),
  "utf-8"
);

const pad = (value: unknown, width: number) => String(value).padStart(width);

console.log(
  "fixture".padEnd(38)
  + pad("schema", 8)
  + pad("rawBytes", 10)
  + pad("rawTok", 9)
  + pad("graphTok", 10)
  + pad("nodes", 7)
  + pad("edges", 7)
  + pad("reduction", 10)
);
for (const row of rows) {
  console.log(
    row.fixture.padEnd(38)
    + pad(row.schema, 8)
    + pad(row.rawBytes, 10)
    + pad(row.rawTokens, 9)
    + pad(row.graphTokens, 10)
    + pad(row.nodes, 7)
    + pad(row.edges, 7)
    + pad(`${row.tokenReduction.toFixed(1)}x`, 10)
  );
}
const totals = rows.reduce(
  (acc, row) => {
    acc.rawTokens += row.rawTokens;
    acc.graphTokens += row.graphTokens;
    return acc;
  },
  { rawTokens: 0, graphTokens: 0 }
);
console.log(
  "TOTAL".padEnd(38)
  + "".padEnd(8)
  + "".padEnd(10)
  + pad(totals.rawTokens, 9)
  + pad(totals.graphTokens, 10)
  + "".padEnd(14)
  + pad(`${(totals.rawTokens / totals.graphTokens).toFixed(1)}x`, 10)
);
console.log(`\nWrote ${graphsDir}/token-budget.csv and token-budget.json (heuristic: ~${CHARS_PER_TOKEN} chars/token).`);
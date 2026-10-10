import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseStepFile } from "../src/utils/stepParser";

/**
 * Regression check for phantom geometric tolerances.
 *
 * `buildSfaSemanticTolerances` selected entities whose type matched /_TOLERANCE/.
 * That substring also occurs in `GEOMETRIC_TOLERANCE_RELATIONSHIP`, which is a
 * container grouping tolerances that apply together, for example two position
 * tolerances forming one composite frame. A relationship carries no magnitude
 * and no toleranced shape aspect of its own, so each one produced a record with
 * an entity reference read as its value, no target, and the fallback type
 * "Geometric Tolerance", duplicating tolerances already parsed from the children
 * the relationship points at.
 *
 * Across the NIST fixture set this produced 36 such records.
 */

const DIRS = ["STEP samples with PMI/AP242", "STEP samples with PMI/AP203"];

/** Entity types that group or qualify tolerances rather than being one. */
const CONTAINER_TYPES = [
  "GEOMETRIC_TOLERANCE_RELATIONSHIP",
  "DATUM_SYSTEM",
  "APPROVAL_STATUS",
];

let totalRecords = 0;
let totalFromContainers = 0;
let checkedFixtures = 0;

for (const dir of DIRS) {
  if (!fs.existsSync(dir)) continue;

  for (const file of fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".stp") || name.endsWith(".step"))
    .sort()) {
    const text = fs.readFileSync(path.join(dir, file), "latin1");
    const parsed = parseStepFile(file, text);
    checkedFixtures++;

    const containers = new Set<string>();
    for (const match of text.matchAll(/#(\d+)\s*=\s*([A-Z_0-9]+)\s*\(/g)) {
      if (CONTAINER_TYPES.includes(match[2])) containers.add(`#${match[1]}`);
    }

    const fromContainers = parsed.tolerances.filter((t: any) => containers.has(t.entityId));
    assert.deepEqual(
      fromContainers.map((t: any) => t.entityId),
      [],
      `${file}: ${fromContainers.length} tolerance record(s) emitted from a container entity: ` +
        fromContainers.map((t: any) => t.entityId).join(", ")
    );

    // A container-derived record has no target and no real magnitude, so it also
    // shows up as the fallback type with no target. That pattern must not occur.
    const targetless = parsed.tolerances.filter(
      (t: any) => t.type === "Geometric Tolerance" && !t.targetId
    );
    assert.deepEqual(
      targetless.map((t: any) => t.entityId),
      [],
      `${file}: ${targetless.length} targetless fallback-typed tolerance(s): ` +
        targetless.map((t: any) => t.entityId).join(", ")
    );

    totalRecords += parsed.tolerances.length;
    totalFromContainers += fromContainers.length;

    console.log(
      `PASS ${file.padEnd(34)} records=${String(parsed.tolerances.length).padStart(3)} ` +
        `fromContainers=${fromContainers.length}`
    );
  }
}

assert.ok(checkedFixtures > 0, "no fixtures were checked");
assert.equal(totalFromContainers, 0, "container entities must not yield tolerance records");

console.log(
  `\n${totalRecords} tolerance records across ${checkedFixtures} fixtures, ` +
    "none emitted from a container entity."
);
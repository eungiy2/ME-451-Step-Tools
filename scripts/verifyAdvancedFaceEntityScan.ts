import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { collectStepEntityStatements } from "../src/utils/geometryClassifier";

/**
 * Reads the `face_geometry` argument of an ADVANCED_FACE statement.
 *
 * ADVANCED_FACE(name, bounds, face_geometry, same_sense) carries the surface in
 * the third argument. Bounds are a nested list that may itself contain commas,
 * so the arguments are split at parenthesis depth zero only.
 */
function readSurfaceReference(statement: string): string | null {
  const params = statement.match(/#\d+\s*=\s*ADVANCED_FACE\s*\(([\s\S]*)\)\s*;?\s*$/i);
  if (!params) return null;

  const args: string[] = [];
  let depth = 0;
  let current = "";

  for (const character of params[1]) {
    if (character === "(") depth++;
    else if (character === ")") depth--;

    if (character === "," && depth === 0) {
      args.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  args.push(current);

  const surface = (args[2] || "").trim();
  return /^#\d+$/.test(surface) ? surface : null;
}

const AP242_DIR = path.resolve("STEP samples with PMI", "AP242");
const fixtures = fs
  .readdirSync(AP242_DIR)
  .filter((name) => name.endsWith(".stp"))
  .sort();

// A regression case taken verbatim from nist_ctc_02_asme1_ap242-e2.stp.
const NESTED_FACE = "#3148=ADVANCED_FACE('13021|10482904',(#3785),#2463,.T.);";

console.log("collectStepEntityStatements regression check\n");

// 1. Nested parentheses must not truncate the argument list.
{
  const statements = collectStepEntityStatements(NESTED_FACE, "ADVANCED_FACE");
  assert.equal(statements.length, 1, "expected exactly one statement");
  const refs: string[] = statements[0].match(/#\d+/g) || [];
  assert.ok(
    refs.includes("#2463"),
    `surface reference #2463 must survive, got ${JSON.stringify(refs)}`
  );
  assert.ok(refs.includes("#3785"), "FACE_BOUND reference #3785 must survive");
  console.log("PASS nested parens preserved:", refs.join(" "));
}

// 2. Every ADVANCED_FACE in the fixture set must expose its full argument list,
//    which is the property the old non-greedy regex violated.
{
  let total = 0;
  let withSurface = 0;
  const perFile: Record<string, number> = {};

  for (const file of fixtures) {
    const text = fs.readFileSync(path.join(AP242_DIR, file), "latin1");
    const statements = collectStepEntityStatements(text, "ADVANCED_FACE");
    let resolved = 0;

    for (const statement of statements) {
      total++;
      const surface = readSurfaceReference(statement);
      if (surface) {
        withSurface++;
        resolved++;
      }
    }

    perFile[file] = resolved;
  }

  console.log(`\nADVANCED_FACE entities scanned: ${total}`);
  console.log(`with a readable surface argument: ${withSurface}`);
  for (const [file, n] of Object.entries(perFile)) {
    console.log("  " + file.padEnd(34), n);
  }

  assert.equal(total, 3843, "fixture set ADVANCED_FACE count changed");
  assert.equal(withSurface, total, "every ADVANCED_FACE must yield its surface argument");
}

// 3. Type filter must not match a different entity type.
{
  const text = "#10=PLANE('',#20);\n#11=ADVANCED_FACE('a',(#12),#13,.T.);";
  assert.equal(collectStepEntityStatements(text, "ADVANCED_FACE").length, 1);
  assert.equal(collectStepEntityStatements(text, "PLANE").length, 1);
  console.log("\nPASS entity type filter is exact");
}

// 4. Multiple entities of the same type in one file.
{
  const text =
    "#1=ADVANCED_FACE('a',(#2),#3,.T.);\n" +
    "#4=ADVANCED_FACE('b',(#5),#6,.F.);\n" +
    "#7=ADVANCED_FACE('c',(#8),#9,.T.);";
  const statements = collectStepEntityStatements(text, "ADVANCED_FACE");
  assert.equal(statements.length, 3);
  assert.ok(statements[1].startsWith("#4="), "must not merge separate entities");
  console.log("PASS multiple same-type entities separated");
}

// 5. Unbalanced input must not hang or lose the entity.
{
  const statements = collectStepEntityStatements("#1=ADVANCED_FACE('a',(#2),#3,.T.", "ADVANCED_FACE");
  assert.equal(statements.length, 1, "unterminated entity must still be returned");
  console.log("PASS unbalanced entity handled without hanging");
}

console.log("\nAll collectStepEntityStatements checks passed.");
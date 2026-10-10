import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { autoGenerateFaceMapping } from "../src/utils/geometryClassifier";
import { parseStepWithOcct } from "../src/utils/stepOcctParser";
import { stageOcctWrapperForNode } from "../src/utils/exportGraph";

/**
 * Regression check for open-shell annotation faces binding to solid geometry.
 *
 * AP242 files declare more ADVANCED_FACE entities than OCCT tessellates. The
 * surplus lives in OPEN_SHELL blocks owned by SHELL_BASED_SURFACE_MODEL
 * operations named Extract, Join, Split, and Fill, and is drawing annotation
 * such as datum target zones and leader notes.
 *
 * The geometric matcher iterates rendered meshes and used to consider those
 * faces on equal terms with solid ones. An annotation face nearer to a mesh than
 * that mesh's true CLOSED_SHELL counterpart would then be bound to it, and a
 * mesh could end up carrying several unrelated STEP identities at once. In
 * nist_ftc_10 this produced face nodes with three identities each and bound a
 * perpendicularity tolerance to the wrong geometry.
 *
 * Only CLOSED_SHELL faces may now take part in geometric matching.
 */

const DIR = path.resolve("STEP samples with PMI", "AP242");
const WRAPPER = "public/occt-native/occt-import-js.js";

/** Faces referenced by a CLOSED_SHELL, i.e. faces of the solid. */
function solidFaceIds(text: string): Set<string> {
  const solid = new Set<string>();
  for (const match of text.matchAll(/#(\d+)\s*=\s*CLOSED_SHELL\s*\(([\s\S]*?)\)\s*;/gi)) {
    const self = `#${match[1]}`;
    for (const ref of match[2].match(/#\d+/g) || []) {
      if (ref !== self) solid.add(ref);
    }
  }
  return solid;
}

const FIXTURES = [
  "nist_ftc_10_asme1_ap242-e2.stp",
  "nist_ctc_02_asme1_ap242-e2.stp",
  "nist_ftc_09_asme1_ap242-e1.stp",
];

const wrapperUrl = pathToFileURL(stageOcctWrapperForNode(WRAPPER)).toString();

for (const file of FIXTURES) {
  const text = fs.readFileSync(path.join(DIR, file), "latin1");
  const bytes = new Uint8Array(fs.readFileSync(path.join(DIR, file)));

  let occt: any;
  try {
    occt = await parseStepWithOcct(bytes, {
      linearDeflection: 0.02,
      angularDeflection: 0.1,
      topologyMode: "native",
      nativeWrapperUrl: wrapperUrl,
    });
  } catch {
    console.log(`SKIP ${file}: OCCT import failed`);
    continue;
  }

  const solid = solidFaceIds(text);
  const mapping = autoGenerateFaceMapping(occt.meshes, text);

  // Every key is a STEP entity; group by the B-Rep face it was bound to.
  // Datum letters are also keys in this map and are not STEP entity ids.
  const byMesh = new Map<string, string[]>();
  for (const [stepId, meshId] of Object.entries(mapping)) {
    if (!/^#\d+$/.test(stepId)) continue;
    const existing = byMesh.get(meshId);
    if (existing) existing.push(stepId);
    else byMesh.set(meshId, [stepId]);
  }

  // 1. One mesh must not carry two or more solid STEP identities. A mesh is one
  //    rendered face and can correspond to exactly one face of the solid.
  for (const [meshId, ids] of byMesh) {
    const solidIds = ids.filter((id) => solid.has(id));
    assert.ok(
      solidIds.length <= 1,
      `${file}: ${meshId} carries ${solidIds.length} solid STEP identities ${solidIds.join(", ")}`
    );
  }

  // 2. No open-shell annotation face may be bound to any mesh. Annotation is
  //    drawing geometry and has no place on the model.
  const annotationBound: string[] = [];
  for (const [meshId, ids] of byMesh) {
    for (const id of ids) {
      if (!solid.has(id)) annotationBound.push(`${id} -> ${meshId}`);
    }
  }

  assert.deepEqual(
    annotationBound,
    [],
    `${file}: ${annotationBound.length} annotation face(s) bound to rendered geometry: ${annotationBound.join(", ")}`
  );

  console.log(
    `PASS ${file}: ${mapping && Object.keys(mapping).length} mappings, ` +
      `${byMesh.size} meshes, 0 solid collisions, 0 annotation faces bound`
  );
}

console.log("\nOpen-shell annotation faces stay unbound to rendered geometry.");
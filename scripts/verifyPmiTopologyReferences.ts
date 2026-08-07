import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { autoGenerateFaceMapping } from "../src/utils/geometryClassifier";
import {
  createPmiTopologyResolver,
  enrichPmiTopologyReferences,
  type PmiTopologyReference,
} from "../src/utils/pmiTopologyReferences";
import { parseStepWithOcct } from "../src/utils/stepOcctParser";
import { parseStepFile, type StepParseResult } from "../src/utils/stepParser";

const modulePath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const fixturePath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.resolve(
      "STEP samples with PMI",
      "AP242",
      "nist_ftc_06_asme1_ap242-e2.stp"
    );

if (!modulePath || !fs.existsSync(modulePath)) {
  throw new Error(
    "Usage: npx tsx scripts/verifyPmiTopologyReferences.ts <occt-import-js.js> [fixture.stp]"
  );
}
if (!fs.existsSync(fixturePath)) {
  throw new Error(`Missing STEP fixture: ${fixturePath}`);
}

const bytes = new Uint8Array(fs.readFileSync(fixturePath));
const text = new TextDecoder("utf-8").decode(bytes);
const parsed = parseStepFile(path.basename(fixturePath), text);

const loadEnriched = async (linearDeflection: number, angularDeflection: number) => {
  const occtResult = await parseStepWithOcct(bytes, {
    linearDeflection,
    angularDeflection,
    topologyMode: "native",
    nativeWrapperUrl: pathToFileURL(modulePath).toString(),
  });
  assert.equal(occtResult?.geometryTopologySource, "occt");
  const mapping = autoGenerateFaceMapping(occtResult.meshes, parsed.rawText);
  return {
    enriched: enrichPmiTopologyReferences(parsed, occtResult, mapping),
    mapping,
    occtResult,
  };
};

const fineLoad = await loadEnriched(0.02, 0.10);
const coarseLoad = await loadEnriched(0.2, 0.45);
const fine = fineLoad.enriched;
const coarse = coarseLoad.enriched;

type ReferencedRecord = {
  key: string;
  topologyReferences?: PmiTopologyReference[];
};

const collectReferencedRecords = (result: StepParseResult): ReferencedRecord[] => [
  ...result.datums.map((record) => ({
    key: `datum:${record.id}`,
    topologyReferences: record.topologyReferences,
  })),
  ...result.datumTargets.map((record) => ({
    key: `datum-target:${record.id}`,
    topologyReferences: record.topologyReferences,
  })),
  ...result.tolerances.map((record) => ({
    key: `tolerance:${record.id}`,
    topologyReferences: record.topologyReferences,
  })),
  ...result.datumReferenceFrames.map((frame) => ({
    key: `frame:${frame.id}`,
    topologyReferences: frame.topologyReferences,
  })),
  ...result.datumReferenceFrames.flatMap((frame) =>
    frame.references.map((reference) => ({
      key: `frame-reference:${frame.id}:${reference.precedence}:${reference.datumIdentifier}`,
      topologyReferences: reference.topologyReferences,
    }))
  ),
];

const fineRecords = collectReferencedRecords(fine);
const unresolvedTargets = fineRecords.flatMap((record) =>
  (record.topologyReferences || [])
    .filter((reference) => reference.resolution !== "resolved")
    .map((reference) => `${record.key}:${reference.stepEntityId}:${reference.resolutionReason}`)
);
assert.ok(fineRecords.length > 0, "Fixture should contain PMI records");
assert.ok(
  fineRecords.every((record) => Array.isArray(record.topologyReferences)),
  "Every PMI and DRF record must expose the generic topology-reference contract"
);
assert.ok(
  fine.tolerances
    .filter((tolerance) => tolerance.category !== "Dimension")
    .every((tolerance) => Array.isArray(tolerance.topologyReferences)),
  "Unrendered geometric tolerances must receive topology references"
);
assert.ok(
  fine.tolerances.some((tolerance) => tolerance.category !== "Dimension"),
  "Fixture should exercise geometric tolerances beyond dimensional rendering"
);
parsed.tolerances.forEach((originalTolerance) => {
  if (!originalTolerance.datumReferenceFrame) return;
  const enrichedTolerance = fine.tolerances.find(
    (tolerance) => tolerance.id === originalTolerance.id
  );
  assert.deepEqual(
    enrichedTolerance?.datumReferenceFrame?.frameBasis,
    originalTolerance.datumReferenceFrame.frameBasis,
    `Topology enrichment must preserve tolerance-specific DRF orientation for ${originalTolerance.id}`
  );
});
assert.ok(
  fineRecords.some((record) =>
    record.topologyReferences?.some((reference) => reference.resolution === "resolved")
  ),
  "At least one PMI target should resolve to stable native topology"
);
assert.ok(
  fineRecords.every((record) =>
    (record.topologyReferences || []).every((reference) =>
      reference.resolution !== "resolved"
      || (
        !!reference.runtimeId
        && !!reference.topologySignature
        && reference.topologySignature.startsWith("occt:v1:")
      )
    )
  ),
  "Resolved PMI references must contain runtime and stable native identities"
);

const snapshot = (result: StepParseResult) => new Map(
  collectReferencedRecords(result).map((record) => [
    record.key,
    (record.topologyReferences || [])
      .map((reference) => [
        reference.entityKind,
        reference.stepEntityId,
        reference.resolution,
        reference.runtimeId || "",
        reference.topologySignature || "",
      ].join("|"))
      .sort(),
  ])
);
assert.deepEqual(
  snapshot(coarse),
  snapshot(fine),
  "Saved PMI topology references must survive tessellation parameter changes"
);

const serializedReferences = JSON.parse(JSON.stringify(
  fineRecords.flatMap((record) =>
    (record.topologyReferences || [])
      .filter((reference) => reference.resolution === "resolved")
  )
)) as PmiTopologyReference[];
const coarseResolver = createPmiTopologyResolver(
  coarseLoad.occtResult,
  coarseLoad.mapping,
  parsed.faceRecords || []
);
assert.ok(serializedReferences.length > 0);
serializedReferences.forEach((storedReference) => {
  const reloaded = coarseResolver.resolveStoredReference(storedReference);
  assert.equal(reloaded.resolution, "resolved");
  assert.equal(reloaded.entityKind, storedReference.entityKind);
  assert.equal(reloaded.topologySignature, storedReference.topologySignature);
});

const duplicateSignatureResolver = createPmiTopologyResolver(
  {
    geometryTopologySource: "occt",
    faces: [
      { id: "BRepFace-0", topologySignature: "occt:v1:face:duplicate" },
      { id: "BRepFace-1", topologySignature: "occt:v1:face:duplicate" },
    ],
  },
  { "#10": "BRepFace-0" }
);
assert.deepEqual(
  duplicateSignatureResolver.resolveTarget("#10"),
  {
    entityKind: "face",
    stepEntityId: "#10",
    resolution: "ambiguous",
    resolutionReason: "duplicate-stable-signature",
    candidateRuntimeIds: ["BRepFace-0", "BRepFace-1"],
    candidateTopologySignatures: ["occt:v1:face:duplicate"],
  }
);
assert.equal(
  duplicateSignatureResolver.resolveTarget("#404").resolution,
  "missing"
);

const multiCandidateResolver = createPmiTopologyResolver(
  {
    geometryTopologySource: "occt",
    faces: [
      { id: "BRepFace-0", topologySignature: "occt:v1:face:first" },
      { id: "BRepFace-1", topologySignature: "occt:v1:face:second" },
    ],
  },
  {},
  [
    { id: "#20", referencedIds: ["#30"] },
    { id: "#21", referencedIds: ["#30"] },
  ]
);
assert.equal(
  multiCandidateResolver.resolveTarget("#30").resolutionReason,
  "multiple-runtime-candidates"
);

const renumberedResolver = createPmiTopologyResolver(
  {
    geometryTopologySource: "occt",
    faces: [
      { id: "BRepFace-91", topologySignature: "occt:v1:face:persistent" },
    ],
  },
  { "#40": "BRepFace-91" }
);
assert.deepEqual(
  renumberedResolver.resolveStoredReference({
    entityKind: "face",
    stepEntityId: "#40",
    topologySignature: "occt:v1:face:persistent",
  }),
  {
    entityKind: "face",
    stepEntityId: "#40",
    runtimeId: "BRepFace-91",
    topologySignature: "occt:v1:face:persistent",
    stepTopologySignature: undefined,
    resolution: "resolved",
    resolutionReason: "unique-stable-signature",
  }
);

console.log(
  `PMI topology references verified for ${path.basename(fixturePath)}: ` +
  `${fine.topologyReferenceSummary?.resolved || 0} resolved, ` +
  `${fine.topologyReferenceSummary?.missing || 0} missing, ` +
  `${fine.topologyReferenceSummary?.ambiguous || 0} ambiguous; ` +
  "fine/coarse tessellation snapshots match."
);
if (unresolvedTargets.length > 0 && process.env.PMI_TOPOLOGY_VERBOSE === "1") {
  console.log(`Unresolved PMI targets:\n${unresolvedTargets.join("\n")}`);
}

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { autoGenerateFaceMapping } from "../src/utils/geometryClassifier";
import {
  fitCylinder,
  MIN_WINDING_CONSISTENCY,
  serializeGraphDeterministic,
  smallestEigenvector,
  stageOcctWrapperForNode,
} from "../src/utils/exportGraph";
import { parseStepWithOcct } from "../src/utils/stepOcctParser";
import { parseStepFile } from "../src/utils/stepParser";
import { exportGraph } from "../src/utils/exportGraph";

/**
 * Behavioural checks for the graph exporter.
 *
 * Run:
 *   npx tsx scripts/verifyExportGraph.ts <occt-import-js.js>
 */

const modulePath = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!modulePath || !fs.existsSync(modulePath)) {
  throw new Error("Usage: npx tsx scripts/verifyExportGraph.ts <occt-import-js.js>");
}

const moduleUrl = pathToFileURL(stageOcctWrapperForNode(modulePath)).toString();
const fixturePath = path.resolve(
  "STEP samples with PMI",
  "AP242",
  "nist_ctc_01_asme1_ap242-e1.stp"
);
/**
 * Fixture used for the simultaneous-datum check.
 *
 * `nist_ctc_01` carries only single-reference frames, so it cannot exercise
 * combined datum reference frames. `nist_stc_08` carries `D | H-J`, a secondary
 * datum set established simultaneously, which is the behaviour under test.
 */
const simultaneousFixturePath = path.resolve(
  "STEP samples with PMI",
  "AP242",
  "nist_stc_08_asme1_ap242-e3.stp"
);
const cubePath = path.resolve("STEP samples without PMI", "10cm3_cube.step");

const loadGraph = async (filePath: string, deflection = 0.02) => {
  const bytes = new Uint8Array(fs.readFileSync(filePath));
  const text = new TextDecoder("utf-8").decode(bytes);
  const parsed = parseStepFile(path.basename(filePath), text);
  const occtResult = await parseStepWithOcct(bytes, {
    linearDeflection: deflection,
    angularDeflection: 0.1,
    topologyMode: "native",
    nativeWrapperUrl: moduleUrl,
  });
  const faceMapping = autoGenerateFaceMapping(occtResult.meshes, parsed.rawText);
  return exportGraph({
    parsed,
    occtResult,
    faceMapping,
    linearDeflection: deflection,
    angularDeflection: 0.1,
  });
};

/* -------------------------------------------------------------------------- */
/* Linear algebra primitives                                                  */
/* -------------------------------------------------------------------------- */

const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;

{
  // A cylinder axis is the direction of least normal spread.
  const axisZ = smallestEigenvector([
    [10, 0, 0],
    [0, 10, 0],
    [0, 0, 0],
  ]);
  assert.ok(near(Math.abs(axisZ[2]), 1, 1e-9), `axis-z fit failed: ${axisZ}`);

  // Residual-based check on a matrix with no repeated eigenvalues: the returned
  // direction must annihilate (M - lambda*I) for the smallest eigenvalue.
  const matrix = [
    [9, 1, -1],
    [1, 8, 2],
    [-1, 2, 7],
  ];
  const smallest = smallestEigenvector(matrix);
  const characteristic = (lambda: number) =>
    lambda ** 3 -
    24 * lambda ** 2 +
    185 * lambda -
    449;
  let low = 0;
  let high = 10;
  for (let step = 0; step < 200; step++) {
    const middle = (low + high) / 2;
    if (characteristic(middle) < 0) low = middle;
    else high = middle;
  }
  const lambda = (low + high) / 2;
  const residual = Math.hypot(
    ...[0, 1, 2].map(
      (row) =>
        matrix[row][0] * smallest[0] +
        matrix[row][1] * smallest[1] +
        matrix[row][2] * smallest[2] -
        lambda * smallest[row]
    )
  );
  assert.ok(
    residual < 1e-9,
    `Axis fit must annihilate (M - lambda*I): residual ${residual}`
  );

  // A patch subtending a wide arc has two nearly equal in-plane eigenvalues,
  // which is exactly the case a naive Jacobi sweep gets wrong.
  const radius = 12.5;
  const positions: number[] = [];
  const normalMatrix = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let step = 0; step < 64; step++) {
    const theta = (step / 64) * Math.PI * 2;
    positions.push(40 + radius * Math.cos(theta), radius * Math.sin(theta), (step % 8) * 5);
    const n = [Math.cos(theta), Math.sin(theta), 0];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) normalMatrix[i][j] += n[i] * n[j];
    }
  }
  const fullCircleAxis = smallestEigenvector(normalMatrix);
  assert.ok(
    near(Math.abs(fullCircleAxis[2]), 1, 1e-9),
    `full-circle cylinder axis must be recovered: ${fullCircleAxis}`
  );

  // The axis now comes from the viewer's rule, which reads the mean absolute
  // normal. On this Z-axis cylinder the z component of that mean is the only one
  // that vanishes, so the viewer picks Z and the fit must agree.
  const meanAbsNormal: [number, number, number] = [0, 0, 0];
  for (let step = 0; step < 64; step++) {
    const theta = (step / 64) * Math.PI * 2;
    const n = [Math.cos(theta), Math.sin(theta), 0];
    meanAbsNormal[0] += Math.abs(n[0]);
    meanAbsNormal[1] += Math.abs(n[1]);
    meanAbsNormal[2] += Math.abs(n[2]);
  }

  const fit = fitCylinder(positions, positions.length / 3, meanAbsNormal);
  assert.ok(fit !== null, "Exact cylinder must fit");
  assert.ok(
    near(fit!.axis[2], 1, 1e-9),
    `Viewer axis rule must recover the Z axis: ${fit!.axis}`
  );
  assert.ok(
    fit!.axisPerpendicularity <= 1e-9,
    `Normals of a true cylinder are perpendicular to its axis: ${fit!.axisPerpendicularity}`
  );
  assert.ok(
    near(fit!.radius, radius, 1e-9),
    `Fitted radius must be exact for a true cylinder: ${fit!.radius}`
  );
  assert.ok(
    near(fit!.centerInPlane[0], 40, 1e-6) && near(fit!.centerInPlane[1], 0, 1e-6),
    // The cross-section centre must be measured in the fitted plane, not
    // assumed to sit at the model origin.
    `Fitted cross-section centre is wrong: ${fit!.centerInPlane}`
  );
  assert.ok(
    fit!.deviation / fit!.radius < 1e-9,
    `Exact cylinder must have negligible radial residual: ${fit!.deviation}`
  );
  console.log(`[ok] axis fit and cylinder fit primitives`);
}

/* -------------------------------------------------------------------------- */
/* Cube: analytically known convexity                                          */
/* -------------------------------------------------------------------------- */

{
  const cube = await loadGraph(cubePath);
  const adjacency = cube.graph.edges.filter((edge) => edge.kind === "adjacency");
  assert.equal(adjacency.length, 12, "A cube has 12 shared edges");
  adjacency.forEach((edge) => {
    assert.equal(
      (edge as { convexity: string }).convexity,
      "convex",
      `Every cube edge is convex; got ${(edge as { convexity: string }).convexity}`
    );
    assert.equal(
      (edge as { dihedralAngleDeg: number }).dihedralAngleDeg,
      90,
      `Every cube edge is a 90 degree corner: ${(edge as { dihedralAngleDeg: number }).dihedralAngleDeg}`
    );
  });
  console.log(`[ok] cube: 12/12 edges convex at 90 degrees`);
}

/* -------------------------------------------------------------------------- */
/* Real fixture: coherence and determinism                                     */
/* -------------------------------------------------------------------------- */

const primary = await loadGraph(fixturePath);
const coarse = await loadGraph(fixturePath, 0.2);

{
  const { graph } = primary;
  const faceNodes = graph.nodes.filter((node) => node.kind === "Face");
  const adjacency = graph.edges.filter((edge) => edge.kind === "adjacency");

  assert.ok(faceNodes.length > 100, "Fixture must contain substantial B-Rep topology");
  assert.ok(adjacency.length > 200, "Fixture must contain face adjacencies");

  // The AP203/AP242 part is machined, so it must contain both convex and
  // re-entrant junctions. A probe that can only ever answer one way would fail.
  const convexity = graph.statistics.adjacencyConvexityCounts;
  assert.ok((convexity.convex || 0) > 0, "Fixture must contain convex adjacencies");
  assert.ok((convexity.concave || 0) > 0, "Fixture must contain concave adjacencies");

  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  assert.equal(nodeIds.size, graph.nodes.length, "Node IDs must be unique");

  graph.edges.forEach((edge) => {
    assert.ok(nodeIds.has(edge.source), `Dangling edge source: ${edge.id}`);
    if (edge.target !== null) {
      assert.ok(nodeIds.has(edge.target), `Dangling edge target: ${edge.id}`);
    }
  });

  // Convexity and the reported dihedral must agree by definition.
  adjacency.forEach((edge) => {
    const typed = edge as {
      convexity: string;
      dihedralAngleDeg: number;
      convexityNote: string | null;
    };
    if (typed.convexity === "convex") {
      assert.ok(
        typed.dihedralAngleDeg > 0 && typed.dihedralAngleDeg < 180,
        `Convex edge must have a material angle below 180: ${typed.dihedralAngleDeg}`
      );
    } else if (typed.convexity === "concave") {
      assert.ok(
        typed.dihedralAngleDeg > 180 && typed.dihedralAngleDeg < 360,
        `Re-entrant edge must have a material angle above 180: ${typed.dihedralAngleDeg}`
      );
    } else if (typed.convexity === "flat") {
      assert.equal(typed.dihedralAngleDeg, 180);
    } else {
      assert.ok(
        typed.convexityNote !== null,
        `Indeterminate convexity must carry a reason: ${edge.id}`
      );
    }
  });

  // Every adjacency must reference the shared topological edge it came from.
  adjacency.forEach((edge) => {
    const shared = (edge as { sharedEdgeIds: string[] }).sharedEdgeIds;
    assert.ok(shared.length > 0, `Adjacency must name its shared edge: ${edge.id}`);
    shared.forEach((edgeId) => {
      assert.ok(nodeIds.has(`edge:${edgeId}`), `Shared edge node must exist: ${edgeId}`);
    });
  });

  // Surface types must be real analytical surfaces, not placeholders.
  const surfaceTypes = new Set(faceNodes.map((node) => (node as { surfaceType: string }).surfaceType));
  ["plane", "cylinder", "cone"].forEach((expected) => {
    assert.ok(surfaceTypes.has(expected), `Fixture must expose ${expected} faces`);
  });

  // A trusted cylinder fit must be internally consistent.
  faceNodes.forEach((node) => {
    const face = node as {
      normalSource: string;
      windingConsistency: number | null;
      cylinderRadius: number | null;
      cylinderRadiusDeviation: number | null;
      cylinderOrientation: string | null;
    };
    if (face.normalSource !== "cylinder-radial") return;
    assert.ok(
      (face.windingConsistency ?? 0) >= MIN_WINDING_CONSISTENCY,
      `Trusted cylinder must wind consistently: ${node.id}`
    );
    const relative = (face.cylinderRadiusDeviation ?? 0) / (face.cylinderRadius || 1);
    assert.ok(relative <= 0.02, `Trusted cylinder must fit its patch: ${node.id}`);
    assert.ok(
      face.cylinderOrientation !== null,
      `Trusted cylinder must resolve an external/internal sense: ${node.id}`
    );
  });

  console.log(`[ok] fixture coherence, convexity and cylinder trust gates`);
}

/* -------------------------------------------------------------------------- */
/* PMI resolution preservation                                                */
/* -------------------------------------------------------------------------- */

{
  const { graph } = primary;
  const pmiEdges = graph.edges.filter((edge) => edge.kind === "pmi-topology");
  assert.ok(pmiEdges.length > 0, "Fixture must produce PMI-to-topology edges");

  const resolved = pmiEdges.filter((edge) => (edge as { resolution: string }).resolution === "resolved");
  assert.ok(resolved.length > 0, "At least one PMI reference must resolve");
  resolved.forEach((edge) => {
    const typed = edge as { topologySignature: string | null; target: string | null };
    assert.ok(typed.target !== null, "A resolved reference must point at a node");
    assert.ok(
      (typed.topologySignature || "").startsWith("occt:v1:"),
      "A resolved reference must carry a stable native signature"
    );
  });

  // Unresolved references must be retained as attributes, never dropped.
  const unresolvedNodes = graph.nodes.filter(
    (node) =>
      "unresolvedTargetStepEntityIds" in node &&
      (node as { unresolvedTargetStepEntityIds: string[] }).unresolvedTargetStepEntityIds.length > 0
  );
  unresolvedNodes.forEach((node) => {
    const targets = (node as { unresolvedTargetStepEntityIds: string[] }).unresolvedTargetStepEntityIds;
    const linked = pmiEdges.filter(
      (edge) =>
        edge.source === node.id &&
        (edge as { targetStepEntityId: string }).targetStepEntityId !== undefined
    );
    assert.ok(linked.length > 0, `Unresolved PMI targets must still appear in the graph: ${node.id}`);
    assert.ok(targets.length > 0);
  });

  pmiEdges.forEach((edge) => {
    const typed = edge as {
      resolution: string;
      resolutionReason: string;
      candidateRuntimeIds: string[];
    };
    assert.ok(typed.resolutionReason.length > 0, "Every reference must carry a reason");
    if (typed.resolution !== "resolved") {
      // Ambiguous and missing references must explain themselves.
      assert.ok(
        typed.resolutionReason !== "unique-stable-signature",
        `Unresolved reference must not claim a unique match: ${edge.id}`
      );
    }
  });

  // Datum reference frames must not become trees: ordering lives on edges.
  const frameEdges = graph.edges.filter((edge) => edge.kind === "component");
  graph.nodes
    .filter((node) => node.kind === "DatumReferenceFrame")
    .forEach((node) => {
      const ordered = (node as { datumOrder: string[] }).datumOrder;
      const edges = frameEdges.filter((edge) => edge.source === node.id);
      assert.equal(
        edges.length,
        ordered.length,
        `Component edges must match the ordered datum list: ${node.id}`
      );

      const typed = edges.map((edge) => edge as {
        position: number;
        precedence: number;
        precedenceGroup: number;
        isSimultaneous: boolean;
        target: string | null;
      });

      // Positions are 1-based and contiguous, and precedence is non-decreasing,
      // so the datum list has a well-defined order.
      typed
        .slice()
        .sort((left, right) => left.position - right.position)
        .forEach((edge, index) => {
          assert.equal(edge.position, index + 1, `Positions must be contiguous: ${edge.position}`);
        });
      typed.forEach((edge, index) => {
        if (index === 0) return;
        assert.ok(
          edge.precedence >= typed[index - 1].precedence,
          `Precedence must not decrease along the datum list: ${node.id}`
        );
      });

      // References sharing a precedence are a simultaneous datum reference frame
      // such as `H-J`. They must be flagged, and must all sit in one group.
      const byPrecedence = new Map<number, typeof typed>();
      typed.forEach((edge) => {
        byPrecedence.set(edge.precedence, [
          ...(byPrecedence.get(edge.precedence) || []),
          edge,
        ]);
      });
      byPrecedence.forEach((group, precedence) => {
        const simultaneous = group.length > 1;
        group.forEach((edge) => {
          assert.equal(
            edge.isSimultaneous,
            simultaneous,
            `Simultaneous flag must match the number of references at precedence ${precedence}`
          );
        });
        assert.equal(
          new Set(group.map((edge) => edge.precedenceGroup)).size,
          1,
          `References at one precedence must share a group`
        );
      });

      // Distinct precedence levels must land in distinct, increasing groups.
      const distinctPrecedences = [...byPrecedence.keys()].sort((a, b) => a - b);
      distinctPrecedences.forEach((precedence, index) => {
        assert.equal(
          byPrecedence.get(precedence)![0].precedenceGroup,
          index + 1,
          `Precedence groups must be ordered and contiguous`
        );
      });

      // The label and the datum list must agree on the datum sequence.
      if (typeof (node as { label?: string }).label === "string") {
        const identifiers = typed.map((edge) => {
          const datum = graph.nodes.find(
            (candidate) => candidate.id === edge.target
          );
          return (datum as { identifier?: string } | undefined)?.identifier || "";
        });
        const label = (node as { label: string }).label;
        if (label.includes("|")) {
          const [, ...secondaryGroups] = label.split("|");
          secondaryGroups.forEach((group) => {
            const letters = group.split("-").map((part) => part.trim());
            letters.forEach((letter) => {
              assert.ok(
                identifiers.includes(letter),
                `Frame label ${label} names datum ${letter} that is absent from the datum list`
              );
            });
          });
        }
      }
    });

  console.log(`[ok] PMI resolution preserved, DRF ordering and simultaneous groups carried on edges`);
}

/* -------------------------------------------------------------------------- */
/* Simultaneous datum reference frames                                         */
/* -------------------------------------------------------------------------- */

{
  const simultaneous = await loadGraph(simultaneousFixturePath);
  const parsed = parseStepFile(
    path.basename(simultaneousFixturePath),
    new TextDecoder("utf-8").decode(fs.readFileSync(simultaneousFixturePath))
  );
  // Include tolerance-scoped frames: a simultaneous frame is frequently
  // referenced only through the tolerance that owns it.
  const frames: Array<{
    frame: ReturnType<typeof parseStepFile>["datumReferenceFrames"][number];
    entityId: string;
    scope: "model" | "tolerance";
    ownerEntityId?: string;
  }> = [
    ...parsed.datumReferenceFrames.map((frame) => ({
      frame,
      entityId: frame.entityId,
      scope: "model" as const,
    })),
    ...parsed.tolerances
      .filter((tolerance) => tolerance.datumReferenceFrame)
      .map((tolerance) => ({
        // A tolerance-scoped frame node is identified by the owning tolerance,
        // while its `entityId` stays the STEP frame entity it mirrors.
        frame: tolerance.datumReferenceFrame!,
        entityId: tolerance.datumReferenceFrame!.entityId,
        scope: "tolerance" as const,
        ownerEntityId: tolerance.entityId,
      })),
  ];

  const expectedGroups = frames.map(({ frame, entityId, scope, ownerEntityId }) => {
    const counts = new Map<number, number>();
    frame.references.forEach((reference) => {
      counts.set(reference.precedence, (counts.get(reference.precedence) || 0) + 1);
    });
    return {
      frame,
      entityId,
      scope,
      ownerEntityId,
      groupCount: counts.size,
      simultaneousPrecedences: [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([precedence]) => precedence),
    };
  });

  const simultaneousTotal = expectedGroups.reduce(
    (total, entry) => total + entry.simultaneousPrecedences.length,
    0
  );
  assert.ok(
    simultaneousTotal > 0,
    "Reference fixture must exercise simultaneous datum reference frames"
  );

  // Every frame the parser reports with a repeated precedence must be published
  // as simultaneous, with one group per distinct precedence level.
  //
  // Frames are matched on their node identity: a model frame by its STEP entity,
  // and a tolerance-scoped frame by the tolerance that owns it, because a frame
  // node keeps `entityId` pointing at the STEP frame it mirrors while its own
  // identity is the owning tolerance.
  const framesByFrame = new Map<string, string[]>();
  simultaneous.graph.nodes
    .filter((node) => node.kind === "DatumReferenceFrame")
    .forEach((node) => {
      const typed = node as {
        entityId: string;
        scope: string;
        ownerEntityId: string | null;
      };
      const key = typed.scope === "tolerance"
        ? `tolerance:${typed.ownerEntityId}`
        : `model:${typed.entityId}`;
      framesByFrame.set(key, [...(framesByFrame.get(key) || []), node.id]);
    });
  const componentsByFrame = new Map<string, typeof simultaneous.graph.edges>();
  simultaneous.graph.edges
    .filter((edge) => edge.kind === "component")
    .forEach((edge) => {
      componentsByFrame.set(edge.source, [
        ...(componentsByFrame.get(edge.source) || []),
        edge,
      ]);
    });

  expectedGroups
    .filter((entry) => entry.simultaneousPrecedences.length > 0)
    .forEach(({ frame, entityId, scope, ownerEntityId, simultaneousPrecedences, groupCount }) => {
      const key = scope === "tolerance" ? `tolerance:${ownerEntityId}` : `model:${entityId}`;
      const nodeIds = framesByFrame.get(key) || [];
      assert.ok(nodeIds.length > 0, `Frame ${entityId} (${scope}) must be present as a node`);

      nodeIds.forEach((nodeId) => {
        const edges = (componentsByFrame.get(nodeId) || []) as Array<{
          precedence: number;
          isSimultaneous: boolean;
          precedenceGroup: number;
        }>;
        simultaneousPrecedences.forEach((precedence) => {
          const atPrecedence = edges.filter((edge) => edge.precedence === precedence);
          assert.ok(
            atPrecedence.length > 1 && atPrecedence.every((edge) => edge.isSimultaneous),
            `Precedence ${precedence} of frame ${entityId} holds ${atPrecedence.length} datums and must be flagged simultaneous`
          );
          assert.equal(
            new Set(atPrecedence.map((edge) => edge.precedenceGroup)).size,
            1,
            `Simultaneous datums must share a precedence group`
          );
        });
        assert.equal(
          new Set(edges.map((edge) => edge.precedenceGroup)).size,
          groupCount,
          `Frame ${entityId} must expose one group per distinct precedence`
        );
      });
    });

  console.log(
    `[ok] ${simultaneousTotal} simultaneous datum precedence level(s) preserved across frames`
  );
}

/* -------------------------------------------------------------------------- */
/* One node per parsed PMI record                                              */
/* -------------------------------------------------------------------------- */

{
  const parsed = parseStepFile(
    path.basename(fixturePath),
    new TextDecoder("utf-8").decode(fs.readFileSync(fixturePath))
  );
  const graph = primary.graph;

  const countOf = (kind: string) => graph.nodes.filter((node) => node.kind === kind).length;
  const expected: Array<[string, number]> = [
    ["Datum", parsed.datums.length],
    ["DatumTarget", parsed.datumTargets.length],
    ["Dimension", parsed.tolerances.filter((t) => t.category === "Dimension").length],
    [
      "GeometricTolerance",
      parsed.tolerances.filter((t) => t.category !== "Dimension").length,
    ],
    [
      "DatumReferenceFrame",
      parsed.datumReferenceFrames.length +
        parsed.tolerances.filter(
          (t) => t.category !== "Dimension" && t.datumReferenceFrame
        ).length,
    ],
  ];

  expected.forEach(([kind, count]) => {
    // Several STEP records may legitimately share one entity id, so nodes must be
    // keyed per record rather than per entity or records are silently merged.
    assert.equal(
      countOf(kind),
      count,
      `Every parsed ${kind} record must produce exactly one node`
    );
  });

  const nodeIds = graph.nodes.map((node) => node.id);
  assert.equal(new Set(nodeIds).size, nodeIds.length, "Node IDs must be unique");

  console.log(`[ok] one node per parsed PMI record, no ID collisions`);
}

/* -------------------------------------------------------------------------- */
/* FCF-to-dimension attachment is corroborated, not guessed                     */
/* -------------------------------------------------------------------------- */

{
  const graph = primary.graph;
  const dimensions = new Map(
    graph.nodes
      .filter((node) => node.kind === "Dimension")
      .map((node) => [node.id, node as { targetStepEntityIds: string[]; entityId: string }])
  );
  const tolerances = new Map(
    graph.nodes
      .filter((node) => node.kind === "GeometricTolerance")
      .map((node) => [node.id, node as { targetStepEntityIds: string[]; attachedDimensionEntityId: string | null }])
  );

  graph.edges
    .filter((edge) => edge.kind === "dimension-attachment")
    .forEach((edge) => {
      const tolerance = tolerances.get(edge.source);
      const dimension = dimensions.get(edge.target || "");
      assert.ok(tolerance && dimension, `Dangling attachment: ${edge.id}`);
      assert.ok(
        (tolerance!.targetStepEntityIds || []).length > 0 &&
          (dimension!.targetStepEntityIds || []).length > 0,
        `An attachment must rest on named targets: ${edge.id}`
      );
      const shared = (tolerance!.targetStepEntityIds || []).some((target) =>
        (dimension!.targetStepEntityIds || []).includes(target)
      );
      assert.ok(
        shared,
        `An attachment must share a controlled feature: ${edge.id}`
      );
      assert.equal(
        tolerance!.attachedDimensionEntityId,
        dimension!.entityId,
        `The node field must agree with the edge: ${edge.id}`
      );
    });

  console.log(
    `[ok] every FCF-dimension attachment is corroborated by a shared controlled feature`
  );
}

/* -------------------------------------------------------------------------- */
/* Determinism                                                                */
/* -------------------------------------------------------------------------- */

{
  const replay = await loadGraph(fixturePath);
  assert.equal(
    replay.deterministicJson,
    primary.deterministicJson,
    "Same STEP file must serialize to byte-identical JSON"
  );

  // Topology identity must be identical across tessellation settings, because the
  // runtime IDs come from native OCCT and not from the mesh.
  const identity = (result: typeof primary) =>
    result.graph.edges
      .filter((edge) => edge.kind === "adjacency")
      .map((edge) => edge.id);
  assert.deepEqual(identity(coarse), identity(primary));

// The dihedral angle must be stable to within a small tolerance. Exact equality
  // is not achievable for tangent junctions: a cylinder blending smoothly into a
  // plane has a true angle of 180 degrees, and the measured deviation there is
  // dominated by how accurately the cylinder axis can be fitted from the
  // tessellation. The exported graphs use one fixed setting, so byte-for-byte
  // determinism still holds; this check bounds the geometric sensitivity.
  
  // Dihedral stability across tessellation settings, restricted to junctions
// whose measurement does not depend on tessellation resolution.
//
// Two categories are legitimately tessellation-sensitive and are excluded:
//
// - Tangent junctions, where a cylinder blends smoothly into a plane. The true
//   dihedral is 180 degrees and the fine setting resolves it, but a coarse
//   linear deflection on a small radius does not sample enough of the blend and
//   reports a corner instead.
// - Junctions involving a cone, sphere or torus, and cylinders whose fit was
//   rejected as ill-conditioned. Those normals come from the tessellated patch
//   rather than an analytic fit, so they legitimately move when the mesh
//   changes.
//
// Both are resolution limits of the measurement rather than inconsistencies in
// the exporter, and the shipped graphs use one fixed fine setting. Everything
// formed only from planes and fitted cylinders must still agree closely.
  const faceById = new Map(
    primary.graph.nodes
      .filter((node) => node.kind === "Face")
      .map((node) => [node.id, node as { surfaceType: string; normalSource: string }])
  );

  const resolvable = (
    result: typeof primary,
    faces: Map<string, { surfaceType: string; normalSource: string }>
  ) =>
    result.graph.edges.filter((edge) => {
      if (edge.kind !== "adjacency") return false;
      const typed = edge as { convexity: string; normalAngleDeg: number };
      if (typed.convexity === "flat" || typed.normalAngleDeg <= 1) return false;
      const adjacent = [edge.source, edge.target || ""]
        .map((nodeId) => faces.get(nodeId))
        .filter((value): value is { surfaceType: string; normalSource: string } => !!value);
      if (adjacent.length !== 2) return false;
      // Both faces must be measured the same way in this graph: a plane from its
      // patch, a cylinder from a fitted radial. A cylinder that fell back to its
      // patch normal is in the tessellation-limited category above.
      return adjacent.every(
        (face) =>
          (face.surfaceType === "plane" && face.normalSource === "tessellation") ||
          (face.surfaceType === "cylinder" && face.normalSource === "cylinder-radial")
      );
    });

  const coarseFaces = new Map(
    coarse.graph.nodes
      .filter((node) => node.kind === "Face")
      .map((node) => [node.id, node as { surfaceType: string; normalSource: string }])
  );
  const coarseById = new Map(coarse.graph.edges.map((edge) => [edge.id, edge]));

  // Both graphs must measure the junction the same way. A cylinder that was
  // fitted analytically in one and fell back to its patch normal in the other is
  // comparing two different measurements, not two samples of one quantity.
  const stableJunctions = resolvable(primary, faceById).filter((edge) => {
    const coarseEdge = coarseById.get(edge.id);
    if (!coarseEdge) return false;
    return resolvable(coarse, coarseFaces).some((candidate) => candidate.id === edge.id);
  });

  let worstResolvedDeviation = 0;
  stableJunctions.forEach((edge) => {
    const coarseEdge = coarseById.get(edge.id) as { dihedralAngleDeg: number } | undefined;
    assert.ok(coarseEdge !== undefined, `Missing coarse edge for ${edge.id}`);
    worstResolvedDeviation = Math.max(
      worstResolvedDeviation,
      Math.abs(
        (edge as { dihedralAngleDeg: number }).dihedralAngleDeg -
          coarseEdge!.dihedralAngleDeg
      )
    );
  });
  assert.ok(stableJunctions.length > 20, `Expected many resolvable junctions, got ${stableJunctions.length}`);
  assert.ok(
    worstResolvedDeviation < 5,
    `Plane and cylinder dihedral angles must be stable across tessellation settings; worst deviation ${worstResolvedDeviation}`
  );

  const allAdjacency = primary.graph.edges.filter((edge) => edge.kind === "adjacency");
  console.log(
    `[ok] stable topology identity; dihedral deviation <= ${worstResolvedDeviation.toFixed(3)} deg ` +
      `across ${stableJunctions.length} of ${allAdjacency.length} junctions ` +
      `(tangent and unfitted-surface junctions are tessellation-limited by nature)`
  );

  const withStamp = exportGraph({
    parsed: parseStepFile(path.basename(fixturePath), fs.readFileSync(fixturePath, "utf8")),
    occtResult: (await parseStepWithOcct(new Uint8Array(fs.readFileSync(fixturePath)), {
      linearDeflection: 0.02,
      angularDeflection: 0.1,
      topologyMode: "native",
      nativeWrapperUrl: moduleUrl,
    })) as unknown,
    faceMapping: {},
    linearDeflection: 0.02,
    angularDeflection: 0.1,
    generatedAt: "2020-01-01T00:00:00.000Z",
  });
  assert.ok(withStamp.graph.generatedAt === "2020-01-01T00:00:00.000Z");
  assert.equal(
    serializeGraphDeterministic(withStamp.graph),
    withStamp.deterministicJson,
    "The timestamp must be the only excluded field"
  );

  console.log(`[ok] deterministic serialization, stable across tessellation settings`);
}

console.log("\nGraph exporter verification passed.");
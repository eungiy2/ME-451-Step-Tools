import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  enrichPmiTopologyReferences,
  type PmiTopologyReference,
} from "./pmiTopologyReferences";
import type {
  ParsedStepDatum,
  ParsedStepDatumReferenceFrame,
  ParsedStepDatumTarget,
  ParsedStepTolerance,
  StepParseResult,
} from "./stepParser";

/**
 * STEP File JSON Graph Exporter.
 *
 * Emits one loaded part as a graph G = (V, E) so that downstream tooling - in
 * particular an LLM reasoning about manufacturing questions - can traverse
 * topology and PMI together.
 *
 * Design rules enforced here:
 * - Minimum geometric information is explicit: one node per face, edge, and
 *   vertex; one adjacency edge per shared topological edge carrying the
 *   material dihedral angle and its convexity sign.
 * - PMI is attached, never merged: PMI records become their own node kinds and
 *   link to topology through `enrichPmiTopologyReferences` only. No second
 *   target-to-topology mapping route exists in this module.
 * - Unresolved and ambiguous associations survive as explicit attributes.
 * - Output is deterministic: fixed ordering, fixed rounding, no timestamps
 *   unless the caller asks for one.
 */

export const GRAPH_SCHEMA_VERSION = 1;

/** Every floating point value written to JSON is rounded to this many digits. */
export const GRAPH_FLOAT_DIGITS = 6;

/**
 * Faces whose outward normals are this close to parallel or antiparallel are
 * reported as tangent-continuous ("flat") rather than as a corner.
 *
 * Both ends matter. Identical normals mean two coplanar patches of one plane;
 * antiparallel normals mean two patches of the same smooth curved surface
 * meeting at a tessellation seam, for example the two halves of a cylinder.
 * Neither is a manufacturing corner, and a seam would otherwise be reported as a
 * 360 degree re-entrant angle.
 */
export const GRAPH_FLAT_ANGLE_RADIANS = 1e-3;

/**
 * Minimum dominant winding fraction for a face to be treated as having one
 * outward direction.
 *
 * OCCT tessellation winds a well-formed face consistently, so healthy parts sit
 * near 1.0. A face below this threshold has triangles pointing in conflicting
 * directions and its outward normal must not be inferred.
 */
export const MIN_WINDING_CONSISTENCY = 0.9;

/**
 * Maximum radial residual of a fitted cylinder, relative to its radius.
 *
 * A patch that is genuinely cylindrical fits to a tiny fraction of its radius.
 * Beyond this ratio the patch is too coarsely faceted or too small for the fit
 * to be meaningful, so the radial direction must not be used as an outward
 * normal.
 */
export const MAX_CYLINDER_FIT_RESIDUAL_RATIO = 0.02;

/**
 * Maximum mean absolute dot product between a patch's normals and its chosen
 * cylinder axis.
 *
 * The axis direction comes from the viewer's rule, which snaps to a coordinate
 * axis instead of fitting a direction. That rule identifies the axis component on
 * a true cylinder, where the normals are perpendicular to it and this quantity
 * is zero. Where the rule has been snapped away from the patch's true direction
 * the quantity rises, and the axis is withheld rather than published: reporting a
 * confident axis that is 45 degrees out would corrupt the dihedral angle at every
 * junction the face touches.
 */
export const MAX_AXIS_PERPENDICULARITY = 0.1;

/**
 * Maximum cylinder radius, relative to the extent of the patch it was fitted to.
 *
 * Guards against the degenerate least-squares solution produced by a patch with
 * too few facets to constrain the circle.
 */
export const MAX_RADIUS_TO_EXTENT_RATIO = 1e3;

/** Barycentric margin under which a chord/triangle hit is treated as ambiguous. */
const AMBIGUOUS_BARYCENTRIC_EPSILON = 1e-9;

export type Vec3 = [number, number, number];
export type Box3 = { min: Vec3; max: Vec3 };

export type GraphNodeKind =
  | "Face"
  | "Edge"
  | "Vertex"
  | "Datum"
  | "DatumTarget"
  | "Dimension"
  | "GeometricTolerance"
  | "DatumReferenceFrame";

export type GraphEdgeKind =
  | "adjacency"
  | "incidence"
  | "pmi-topology"
  | "datum-reference"
  | "component"
  | "dimension-attachment"
  | "datum-target-parent";

export type GraphConvexity = "convex" | "concave" | "flat" | "indeterminate";

export type GraphSurfaceType =
  | "plane"
  | "cylinder"
  | "cone"
  | "sphere"
  | "torus"
  | "bezier"
  | "bspline"
  | "revolution"
  | "extrusion"
  | "offset"
  | "other"
  | "unknown";

export type GraphCurveType =
  | "line"
  | "circle"
  | "ellipse"
  | "hyperbola"
  | "parabola"
  | "bezier"
  | "bspline"
  | "offset"
  | "other"
  | "unknown";

export interface GraphNodeBase {
  /** Stable graph-local identity, prefixed by kind to keep it self-describing. */
  id: string;
  kind: GraphNodeKind;
  label: string;
}

export interface GraphFaceNode extends GraphNodeBase {
  kind: "Face";
  runtimeId: string;
  nativeIndex: number;
  stepEntityIds: string[];
  surfaceType: GraphSurfaceType;
  area: number | null;
  centroid: Vec3 | null;
  bounds: Box3 | null;
  /** Area-weighted outward unit normal of the tessellated patch. */
  outwardNormal: Vec3 | null;
  normalSource: "tessellation" | "cylinder-radial" | "unavailable";
  /**
   * Cylinder fit quality: worst angle in degrees between any triangle winding
   * normal and the radial predicted by the fitted axis. Small values confirm the
   * axis describes the patch; large values indicate a poor fit.
   */
  normalDeviationDeg: number | null;
  cylinderAxis: Vec3 | null;
  cylinderRadius: number | null;
  /** Max absolute residual (model units) of the fitted cylinder. */
  cylinderRadiusDeviation: number | null;
  /** "external" shaft-like, "internal" bore-like, or null when undetermined. */
  cylinderOrientation: "external" | "internal" | null;
  /**
   * Fraction of the face's triangles that wind in the dominant direction.
   *
   * Below this the face has no single outward direction, so
   * `cylinderOrientation` is reported as null instead of being guessed.
   */
  windingConsistency: number | null;
  /** Triangle count opposing the dominant winding direction. */
  windingMinorityTriangles: number | null;
  edgeCount: number;
  loopCount: number;
  topologySignature: string | null;
  meshVertexCount: number;
  meshTriangleCount: number;
}

export interface GraphEdgeNode extends GraphNodeBase {
  kind: "Edge";
  runtimeId: string;
  /** Edge position within the whole rendered model. */
  nativeIndex: number;
  curveType: GraphCurveType;
  length: number | null;
  closed: boolean;
  stepEntityIds: string[];
  parentFaceIds: string[];
  vertexIds: string[];
  startPoint: Vec3 | null;
  endPoint: Vec3 | null;
  midpoint: Vec3 | null;
  topologySignature: string | null;
  stepTopologySignature: string | null;
}

export interface GraphVertexNode extends GraphNodeBase {
  kind: "Vertex";
  runtimeId: string;
  /** Vertex position within the whole rendered model. */
  nativeIndex: number;
  point: Vec3 | null;
  stepEntityIds: string[];
  topologySignature: string | null;
}

export interface GraphDatumNode extends GraphNodeBase {
  kind: "Datum";
  entityId: string;
  identifier: string;
  datumType: string;
  symbol: string;
  targetName: string;
  targetStepEntityIds: string[];
  semanticTargetStepEntityIds: string[];
  derivedDatum: string | null;
  targetSource: "semantic" | "presentation" | null;
  surfaceGeometry: Array<{
    surfaceType: string;
    targetId: string | null;
    point: Vec3 | null;
    normal: Vec3 | null;
    axis: Vec3 | null;
    xDirection: Vec3 | null;
  }>;
  presentationTargetPoint: Vec3 | null;
  unresolvedTargetStepEntityIds: string[];
  ambiguousTargetStepEntityIds: string[];
}

export interface GraphDatumTargetNode extends GraphNodeBase {
  kind: "DatumTarget";
  entityId: string;
  identifier: string;
  parentDatum: string | null;
  targetType: string | null;
  targetName: string;
  targetStepEntityIds: string[];
  sizeLabels: string[];
  targetPoint: Vec3 | null;
  targetLine: { length: number; direction: Vec3; center: Vec3; normal: Vec3 | null } | null;
  targetCircle: { diameter: number; center: Vec3; normal: Vec3; radius: number } | null;
  targetCurvePointCount: number;
  targetZone: { shape: string; width: number; length: number; center: Vec3; normal: Vec3 } | null;
  unresolvedTargetStepEntityIds: string[];
  ambiguousTargetStepEntityIds: string[];
}

export interface GraphDimensionNode extends GraphNodeBase {
  kind: "Dimension";
  entityId: string;
  dimensionKind: string | null;
  targetName: string;
  /** STEP entities this callout controls; the basis for FCF attachment. */
  targetStepEntityIds: string[];
  nominalDimension: number | null;
  lowerLimit: number | null;
  upperLimit: number | null;
  lowerTolerance: number | null;
  upperTolerance: number | null;
  preModifier: string | null;
  decimalPlaces: number | null;
  isReferenceDimension: boolean;
  isBasicDimension: boolean;
  isStatisticalTolerance: boolean;
  isDatumTargetDimension: boolean;
  isSphericalDimension: boolean;
  isCircularCurveDimension: boolean;
  isControlledRadiusDimension: boolean;
  isThreadCall: boolean;
  threadDesignation: string | null;
  /** Size-only shape of the tolerance zone for this dimensional callout. */
  toleranceZoneShape: string | null;
  modifiers: string[];
  secondary: {
    entityId: string;
    nominalDimension: number | null;
    lowerTolerance: number | null;
    upperTolerance: number | null;
  } | null;
  compound: {
    kind: "counterbore" | "countersink" | "slot" | null;
    holeNominal: number | null;
    holeLowerTolerance: number | null;
    holeUpperTolerance: number | null;
    depthNominal: number | null;
    depthLowerTolerance: number | null;
    depthUpperTolerance: number | null;
    angleNominal: number | null;
    angleLowerTolerance: number | null;
    angleUpperTolerance: number | null;
    slotRadiusNominal: number | null;
    slotRadiusModel: number | null;
  };
  unresolvedTargetStepEntityIds: string[];
  ambiguousTargetStepEntityIds: string[];
}

export interface GraphGeometricToleranceNode extends GraphNodeBase {
  kind: "GeometricTolerance";
  entityId: string;
  category: string;
  /** STEP entities this tolerance controls; the basis for FCF attachment. */
  targetStepEntityIds: string[];
  /** e.g. "Position", "Flatness", "Surface Profile". */
  toleranceType: string;
  symbol: string;
  toleranceValue: number | null;
  /** Explicit zone description: shape family, diameter flag, projected height. */
  toleranceZone: {
    form: string | null;
    isDiameter: boolean;
    projectedHeight: number | null;
    value: number | null;
  };
  modifiers: string[];
  isStatisticalTolerance: boolean;
  hasToleranceModifiers: boolean;
  targetName: string;
  attachedDimensionEntityId: string | null;
  datumReferenceFrameLabel: string | null;
  datumReferenceFrameEntityId: string | null;
  datumReferenceOrder: string[];
  unresolvedTargetStepEntityIds: string[];
  ambiguousTargetStepEntityIds: string[];
}

export interface GraphDatumReferenceFrameNode extends GraphNodeBase {
  kind: "DatumReferenceFrame";
  entityId: string;
  /** "model" for standalone frames, "tolerance" for an FCF-scoped frame. */
  scope: "model" | "tolerance";
  ownerEntityId: string | null;
  name: string;
  label: string;
  /** Ordered datum list, primary first. Precedence lives on the component edges. */
  datumOrder: string[];
  toleranceEntityIds: string[];
  frameBasis: {
    origin: Vec3;
    xAxis: Vec3;
    yAxis: Vec3;
    zAxis: Vec3;
  } | null;
  unresolvedTargetStepEntityIds: string[];
  ambiguousTargetStepEntityIds: string[];
}

export type GraphNode =
  | GraphFaceNode
  | GraphEdgeNode
  | GraphVertexNode
  | GraphDatumNode
  | GraphDatumTargetNode
  | GraphDimensionNode
  | GraphGeometricToleranceNode
  | GraphDatumReferenceFrameNode;

export interface GraphEdgeBase {
  id: string;
  kind: GraphEdgeKind;
  source: string;
  /** null when the association is unresolved; read the attributes instead. */
  target: string | null;
}

export interface GraphAdjacencyEdge extends GraphEdgeBase {
  kind: "adjacency";
  sharedEdgeIds: string[];
  convexity: GraphConvexity;
  /** Material dihedral angle in (0, 2pi); < pi convex, > pi concave. */
  dihedralAngleRad: number;
  dihedralAngleDeg: number;
  /** Angle between the two outward face normals, in (0, pi). */
  normalAngleRad: number;
  normalAngleDeg: number;
  /** Angle between the area-weighted outward normals, in (0, pi). */
  patchNormalAngleDeg: number;
  midpoint: Vec3;
  edgeTangent: Vec3;
  normalSource: GraphFaceNode["normalSource"][];
  /** Extra surfaces meeting at the same edge, for non-manifold junctions. */
  nonManifold: boolean;
  /** Why convexity could not be decided, when `convexity` is "indeterminate". */
  convexityNote: string | null;
}

export interface GraphIncidenceEdge extends GraphEdgeBase {
  kind: "incidence";
  role: "face-boundary" | "edge-endpoint";
}

export interface GraphPmiTopologyEdge extends GraphEdgeBase {
  kind: "pmi-topology";
  entityKind: string;
  targetStepEntityId: string;
  resolution: PmiTopologyReference["resolution"];
  resolutionReason: PmiTopologyReference["resolutionReason"];
  runtimeId: string | null;
  candidateRuntimeIds: string[];
  candidateTopologySignatures: string[];
  topologySignature: string | null;
  stepTopologySignature: string | null;
}

export interface GraphDatumReferenceEdge extends GraphEdgeBase {
  kind: "datum-reference";
  precedence: number;
  compartmentId: string | null;
  datumEntityId: string;
  datumIdentifier: string;
  modifiers: string[];
  isCommonDatum: boolean;
  /** Topology the referenced datum itself controls, for transitive lookup. */
  controlledTopologyNodeIds: string[];
}

export interface GraphComponentEdge extends GraphEdgeBase {
  kind: "component";
  /** 1-based position in the datum list, ordered by precedence. */
  position: number;
  precedence: number;
  /**
   * Group index by distinct precedence, starting at 1.
   *
   * A single precedence level may hold several datums, which is a combined or
   * simultaneous datum reference frame such as `H-J`: those datums are
   * established together, not in sequence. References sharing a
   * `precedenceGroup` are simultaneous; differing groups are sequential.
   */
  precedenceGroup: number;
  /** True when another reference in the frame shares this precedence. */
  isSimultaneous: boolean;
}

export interface GraphDimensionAttachmentEdge extends GraphEdgeBase {
  kind: "dimension-attachment";
  relation: "fcf-attached-to-dimension";
  dimensionEntityId: string;
  target: string;
}

export interface GraphDatumTargetParentEdge extends GraphEdgeBase {
  kind: "datum-target-parent";
  parentDatum: string;
  target: string;
}

export type GraphEdge =
  | GraphAdjacencyEdge
  | GraphIncidenceEdge
  | GraphPmiTopologyEdge
  | GraphDatumReferenceEdge
  | GraphComponentEdge
  | GraphDimensionAttachmentEdge
  | GraphDatumTargetParentEdge;

export interface GraphSource {
  fileName: string;
  schema: string | null;
  fileSize: number;
  byteLength: number;
  geometryTopologySource: string;
  linearDeflection: number;
  angularDeflection: number;
  lengthUnit: "mm";
  angleUnit: "deg";
}

export interface GraphStatistics {
  nodeCounts: Record<string, number>;
  edgeCounts: Record<string, number>;
  faceSurfaceTypeCounts: Record<string, number>;
  edgeCurveTypeCounts: Record<string, number>;
  adjacencyConvexityCounts: Record<string, number>;
  pmiReferenceResolutionCounts: Record<string, number>;
  nonManifoldEdgeCount: number;
  indeterminateConvexityCount: number;
  signedMeshVolume: number;
  normalOrientation: "outward" | "inward" | "indeterminate";
}

export interface GraphDocument {
  graphVersion: number;
  source: GraphSource;
  statistics: GraphStatistics;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Present only when the caller supplies one; excluded from comparisons. */
  generatedAt?: string;
}

export interface ExportGraphInput {
  /**
   * Raw STEP semantics. Left unmodified.
   *
   * `enrichPmiTopologyReferences` derives a separate enriched copy holding the
   * `topologyReferences` arrays; this object is never written back to, and
   * `exportGraph` mutates none of its inputs. Calling it twice on the same
   * input is therefore safe and yields identical output.
   */
  parsed: StepParseResult;
  /** Output of `parseStepWithOcct` (or any structurally compatible payload). */
  occtResult: any;
  /** STEP-face-id to `BRepFace-*` mapping from `autoGenerateFaceMapping`. */
  faceMapping: Record<string, string>;
  linearDeflection: number;
  angularDeflection: number;
  /** ISO timestamp for traceability; omitted from the document when absent. */
  generatedAt?: string;
}

export interface ExportGraphResult {
  graph: GraphDocument;
  /** Graph JSON without `generatedAt`, suitable for byte comparison. */
  deterministicJson: string;
  summaryMarkdown: string;
}

/* -------------------------------------------------------------------------- */
/* Numeric helpers                                                            */
/* -------------------------------------------------------------------------- */

const round = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** GRAPH_FLOAT_DIGITS;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
};

const roundOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? round(value) : null;

type PointLike = Vec3 | { x: number; y: number; z: number };

const pointComponents = (value: PointLike): [number, number, number] =>
  Array.isArray(value)
    ? [value[0], value[1], value[2]]
    : [value.x, value.y, value.z];

const roundVecOrNull = (value: PointLike | undefined | null): Vec3 | null => {
  if (!value) return null;
  const [x, y, z] = pointComponents(value);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
    ? [round(x), round(y), round(z)]
    : null;
};

const vec = (x: number, y: number, z: number): Vec3 => [x, y, z];

const addVec = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subVec = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scaleVec = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dotVec = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crossVec = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const lengthVec = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

const normalizeVec = (a: Vec3, fallback: Vec3 = [0, 0, 0]): Vec3 => {
  const length = lengthVec(a);
  if (!(length > 1e-12) || !Number.isFinite(length)) return fallback;
  return [a[0] / length, a[1] / length, a[2] / length];
};

/** Canonical sign so that repeated fits serialize identically. */
const canonicalizeDirection = (a: Vec3): Vec3 => {
  const length = lengthVec(a);
  if (!(length > 1e-12)) return [0, 0, 0];
  const unit = [a[0] / length, a[1] / length, a[2] / length] as Vec3;
  let pivot = 0;
  for (let index = 1; index < 3; index++) {
    if (Math.abs(unit[index]) > Math.abs(unit[pivot]) + 1e-12) pivot = index;
  }
  const sign = unit[pivot] < 0 ? -1 : 1;
  return [unit[0] * sign, unit[1] * sign, unit[2] * sign];
};

const toDegrees = (radians: number): number => (radians * 180) / Math.PI;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

const angleBetween = (a: Vec3, b: Vec3): number => {
  const denominator = lengthVec(a) * lengthVec(b);
  if (!(denominator > 1e-18)) return 0;
  const ratio = Math.min(1, Math.max(-1, dotVec(a, b) / denominator));
  return Math.acos(ratio);
};

/* -------------------------------------------------------------------------- */
/* 3x3 symmetric eigen decomposition (Jacobi)                                 */
/* -------------------------------------------------------------------------- */

/**
 * Unit eigenvector of the smallest eigenvalue of a symmetric 3x3 matrix.
 *
 * The matrix is the area-weighted sum of outer products of triangle normals, so
 * for a cylindrical patch the axis is the direction of minimal normal spread.
 *
 * Solving this by closed-form characteristic roots and recovering the
 * eigenvector by cross products is the reliable route here. A cyclic Jacobi
 * rotation sweep is not: when two eigenvalues are nearly equal - which is
 * exactly the common case for a patch subtending a wide arc - the rotation angle
 * is ill-conditioned and the sweep silently returns an eigenvector of the wrong
 * eigenvalue.
 */
export const smallestEigenvector = (matrix: number[][]): Vec3 => {
  const trace = matrix[0][0] + matrix[1][1] + matrix[2][2];

  // Smallest eigenvalue by inverse iteration on (trace*I - M), whose largest
  // eigenvalue corresponds to M's smallest. This avoids the closed-form cubic,
  // which loses all precision when the eigenvalues are close or repeated - the
  // normal case for a patch subtending a wide arc, where the two in-plane
  // eigenvalues are nearly identical and any rotation angle is meaningless.
  const shifted: number[][] = [
    [trace - matrix[0][0], -matrix[0][1], -matrix[0][2]],
    [-matrix[1][0], trace - matrix[1][1], -matrix[1][2]],
    [-matrix[2][0], -matrix[2][1], trace - matrix[2][2]],
  ];

  const applyShifted = (vector: Vec3): Vec3 => [
    shifted[0][0] * vector[0] + shifted[0][1] * vector[1] + shifted[0][2] * vector[2],
    shifted[1][0] * vector[0] + shifted[1][1] * vector[1] + shifted[1][2] * vector[2],
    shifted[2][0] * vector[0] + shifted[2][1] * vector[1] + shifted[2][2] * vector[2],
  ];

  // The eigenvector direction comes from inverse iteration, but the eigenvalue
  // comes from the Rayleigh quotient, which is second-order accurate and
  // therefore far sharper than the iterated direction itself.
  //
  // A single starting vector is not enough: when the dominant shifted
  // eigenvalue is repeated, or when a start happens to be exactly orthogonal to
  // it, the iteration collapses to zero and returns an unrelated direction. Run
  // all three deterministic axis starts and keep the one with the largest
  // Rayleigh quotient.
  const starts: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  let bestQuotient = Number.NEGATIVE_INFINITY;
  let bestDirection: Vec3 | null = null;

  for (const start of starts) {
    let current = start;
    let collapsed = false;
    for (let iteration = 0; iteration < 96; iteration++) {
      const next = applyShifted(current);
      const length = lengthVec(next);
      if (!(length > 1e-300)) {
        collapsed = true;
        break;
      }
      current = scaleVec(next, 1 / length);
    }
    if (collapsed) continue;
    const quotient = dotVec(current, applyShifted(current));
    if (quotient > bestQuotient) {
      bestQuotient = quotient;
      bestDirection = current;
    }
  }

  if (!bestDirection) return [0, 0, 1];
  const lambda = trace - bestQuotient;

  // Refine the direction for the accurate lambda by crossing rows of
  // (M - lambda*I), which is exact for a simple eigenvalue and costs nothing.
  const rows: Vec3[] = [
    [matrix[0][0] - lambda, matrix[0][1], matrix[0][2]],
    [matrix[1][0], matrix[1][1] - lambda, matrix[1][2]],
    [matrix[2][0], matrix[2][1], matrix[2][2] - lambda],
  ];
  const candidates = [
    crossVec(rows[0], rows[1]),
    crossVec(rows[0], rows[2]),
    crossVec(rows[1], rows[2]),
    bestDirection,
  ];

  const applyM = (vector: Vec3): Vec3 => [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
  ];

  let refined: Vec3 = bestDirection;
  let refinedResidual = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const length = lengthVec(candidate);
    if (!(length > 1e-12)) continue;
    const unit = scaleVec(candidate, 1 / length);
    const residual = lengthVec(subVec(applyM(unit), scaleVec(unit, lambda)));
    if (residual < refinedResidual) {
      refinedResidual = residual;
      refined = unit;
    }
  }

  return canonicalizeDirection(refined);
};

/**
 * Eigenvalues of a symmetric 3x3 matrix, ascending.
 *
 * Bracketing scan plus bisection. A closed-form cubic root is exact in exact
 * arithmetic but loses most of its digits when the eigenvalues are close, which
 * is the normal case for a cylinder patch, where the axis eigenvalue is near
 * zero by construction. The scan only has to locate the sign changes and the
 * bisection then converges to full double precision regardless of spacing.
 */
export const symmetric3Eigenvalues = (matrix: number[][]): number[] => {
  const trace = matrix[0][0] + matrix[1][1] + matrix[2][2];
  const a = matrix[0][0];
  const b = matrix[0][1];
  const c = matrix[0][2];
  const d = matrix[1][1];
  const e = matrix[1][2];
  const f = matrix[2][2];
  const s2 = a * d + a * f + d * f - b * b - c * c - e * e;
  const det = a * (d * f - e * e) - b * (b * f - c * e) + c * (b * e - c * d);
  const evaluate = (lambda: number) =>
    lambda ** 3 - trace * lambda ** 2 + s2 * lambda - det;

  // Gershgorin discs bracket every eigenvalue of a symmetric matrix. Pad the
  // interval so that a root sitting exactly on a bound is bracketed from both
  // sides, and so the scan never lands only on the interior of the spectrum.
  let lower = Number.POSITIVE_INFINITY;
  let upper = Number.NEGATIVE_INFINITY;
  const centres = [a, d, f];
  const radii = [
    Math.abs(b) + Math.abs(c),
    Math.abs(b) + Math.abs(e),
    Math.abs(c) + Math.abs(e),
  ];
  centres.forEach((centre, index) => {
    lower = Math.min(lower, centre - radii[index]);
    upper = Math.max(upper, centre + radii[index]);
  });
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) return [0, 0, 0];
  const span = upper - lower;
  const margin = Math.max(span, Math.abs(upper), 1) * 1e-6 + 1e-12;
  lower -= margin;
  upper += margin;

  const samples = 4096;
  const step = (upper - lower) / samples;
  const roots: number[] = [];

  const addRoot = (lambda: number): void => {
    // Repeated roots touch zero without changing sign, so deduplicate by value.
    if (roots.some((existing) => Math.abs(existing - lambda) <= Math.abs(step) * 1e-6)) return;
    roots.push(lambda);
  };

  let previousLambda = lower;
  let previousValue = evaluate(previousLambda);

  for (let index = 1; index <= samples; index++) {
    const lambda = lower + index * step;
    const value = evaluate(lambda);
    // Treat an exact zero as a sign change in both directions, otherwise a root
    // that lands on a sample point is recorded at most once and its neighbour's
    // root can be missed.
    if (value === 0) {
      addRoot(lambda);
    } else if (previousValue === 0) {
      // previous sample was the root; nothing to bracket.
    } else if (previousValue * value < 0) {
      let low = previousLambda;
      let high = lambda;
      for (let refinement = 0; refinement < 100; refinement++) {
        const middle = (low + high) / 2;
        if (evaluate(low) * evaluate(middle) <= 0) high = middle;
        else low = middle;
      }
      addRoot((low + high) / 2);
    }
    previousLambda = lambda;
    previousValue = value;
  }

  if (roots.length < 3) {
    // Degenerate or numerically awkward input: fall back to the diagonal spread,
    // which is a valid spectrum whenever the matrix is already diagonal.
    return [Math.min(a, d, f), Math.max(a, d, f), Math.max(a, d, f)];
  }

  return roots.sort((left, right) => left - right).slice(0, 3);
};

export const solveSymmetric3 = (m: number[][], rhs: number[]): number[] | null => {
  const determinant =
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-18) return null;
  const column = (c: number): number[] => {
    const replaced = m.map((row, index) => row.map((value, columnIndex) =>
      columnIndex === c ? rhs[index] : value));
    return [
      replaced[0][0] * (replaced[1][1] * replaced[2][2] - replaced[1][2] * replaced[2][1]) -
        replaced[0][1] * (replaced[1][0] * replaced[2][2] - replaced[1][2] * replaced[2][0]) +
        replaced[0][2] * (replaced[1][0] * replaced[2][1] - replaced[1][1] * replaced[2][0]),
      replaced[1][0] * (replaced[2][1] * replaced[2][2] - replaced[2][2] * replaced[2][1]) -
        replaced[1][1] * (replaced[2][0] * replaced[2][2] - replaced[2][2] * replaced[2][0]) +
        replaced[1][2] * (replaced[2][0] * replaced[2][1] - replaced[2][1] * replaced[2][0]),
      replaced[2][0] * (replaced[1][1] * replaced[2][2] - replaced[1][2] * replaced[2][1]) -
        replaced[2][1] * (replaced[1][0] * replaced[2][2] - replaced[1][2] * replaced[2][0]) +
        replaced[2][2] * (replaced[1][0] * replaced[2][1] - replaced[1][1] * replaced[2][0]),
    ];
  };
  const c0 = column(0);
  const c1 = column(1);
  const c2 = column(2);
  return [
    c0[0] / determinant,
    c1[0] / determinant,
    c2[0] / determinant,
  ];
};

/* -------------------------------------------------------------------------- */
/* Tessellation access                                                        */
/* -------------------------------------------------------------------------- */

interface FaceGeometry {
  runtimeId: string;
  faceIndex: number;
  /** Face position within the whole rendered model. */
  nativeIndex: number;
  surfaceType: GraphSurfaceType;
  nativeArea: number | null;
  nativeCentroid: Vec3 | null;
  topologySignature: string | null;
  vertexCount: number;
  triangleCount: number;
  bounds: Box3 | null;
  areaNormal: Vec3 | null;
  /** Global triangle index range for this face. */
  triangleStart: number;
  cylinder: CylinderFit | null;
  /** Vertex-average of the tessellated patch, used where no OCCT centroid exists. */
  meshCentroid: Vec3 | null;
  /** Worst angle between a triangle winding normal and the fitted cylinder radial. */
  maxRadialDeviationDeg: number | null;
  /** Fraction of triangles winding in the dominant direction. */
  windingConsistency: number | null;
  /** Triangle count opposing the dominant winding direction. */
  windingMinorityTriangles: number | null;
  /**
   * Sign that takes the fitted cylinder radial to the outward side, decided by
   * a triangle vote rather than against the patch mean normal. Null when the
   * patch winds inconsistently and the direction cannot be trusted.
   */
  radialOutwardSign: 1 | -1 | null;
}

interface CylinderFit {
  axis: Vec3;
  /** A point on the fitted axis line. */
  axisPoint: Vec3;
  /** Fitted centre of the cross-section circle, in the plane normal to `axis`. */
  centerInPlane: Vec3;
  radius: number;
  deviation: number;
  /**
   * Mean absolute dot product of the patch's triangle normals with the chosen
   * axis.
   *
   * The axis comes from `viewerCylinderAxis`, which selects a coordinate axis
   * rather than fitting a direction. This is the same mean absolute normal that
   * selected it, so it measures whether the patch's own normals agree with the
   * axis that was chosen for them. Near zero means they do; a large value means
   * the axis was snapped away from the patch's true direction and the derived
   * radius and radial directions should not be published.
   */
  axisPerpendicularity: number;
  /** False when the least-squares radius is not physically plausible. */
  radiusPlausible: boolean;
}

interface TriangleStore {
  /** Nine floats (a, b, c) per triangle. */
  positions: number[];
  faceOfTriangle: number[];
  faceTriangleRange: Array<{ faceIndex: number; start: number; count: number; bounds: Box3 | null }>;
  bounds: Box3 | null;
}

const readArrayLike = (value: ArrayLike<number> | undefined | null): number[] =>
  value ? Array.from(value as ArrayLike<number>) : [];

const emptyBox = (): Box3 => ({ min: vec(0, 0, 0), max: vec(0, 0, 0) });

const growBox = (box: Box3, x: number, y: number, z: number): void => {
  box.min[0] = Math.min(box.min[0], x);
  box.min[1] = Math.min(box.min[1], y);
  box.min[2] = Math.min(box.min[2], z);
  box.max[0] = Math.max(box.max[0], x);
  box.max[1] = Math.max(box.max[1], y);
  box.max[2] = Math.max(box.max[2], z);
};

const SURFACE_TYPES = new Set<string>([
  "plane", "cylinder", "cone", "sphere", "torus",
  "bezier", "bspline", "revolution", "extrusion", "offset",
]);

const CURVE_TYPES = new Set<string>([
  "line", "circle", "ellipse", "hyperbola", "parabola",
  "bezier", "bspline", "offset",
]);

const toSurfaceType = (value: unknown): GraphSurfaceType => {
  const name = String(value ?? "").toLowerCase();
  return SURFACE_TYPES.has(name) ? (name as GraphSurfaceType) : "other";
};

const toCurveType = (value: unknown): GraphCurveType => {
  const name = String(value ?? "").toLowerCase();
  return CURVE_TYPES.has(name) ? (name as GraphCurveType) : name ? "other" : "unknown";
};

/**
 * Collects every rendered triangle once so that adjacency probes can be answered
 * with local segment queries instead of a global search structure.
 */
const collectFaces = (
  occtResult: any,
  nativeFaces: any[]
): { faces: FaceGeometry[]; triangles: TriangleStore; normalOrientation: GraphStatistics["normalOrientation"]; signedVolume: number } => {
  const meshes: any[] = Array.isArray(occtResult?.meshes) ? occtResult.meshes : [];
  // Positional index, not `nativeIndex`. `nativeIndex` is local to the source
  // mesh and therefore repeats across multiple meshes, so keying on it silently
  // binds a face to another mesh's descriptor and produces duplicate runtime
  // IDs. Array position matches the rendered mesh order exactly.
  const nativeByIndex = new Map<number, any>();
  nativeFaces.forEach((face, index) => nativeByIndex.set(index, face));

  const faces: FaceGeometry[] = [];
  const seenRuntimeIds = new Set<string>();
  const positions: number[] = [];
  const faceOfTriangle: number[] = [];
  const faceTriangleRange: TriangleStore["faceTriangleRange"] = [];
  let signedVolume = 0;

  meshes.forEach((mesh: any, meshIndex: number) => {
    if (mesh?.auxiliary === true) return;
    const faceIndex = meshes
      .slice(0, meshIndex)
      .filter((candidate: any) => candidate?.auxiliary !== true).length;
    const native = nativeByIndex.get(faceIndex);
    const vertexPositions = readArrayLike(mesh?.positions);
    const indices = readArrayLike(mesh?.indices);
    const vertexCount = vertexPositions.length / 3;

    const bounds = vertexCount > 0 ? emptyBox() : null;
    if (bounds) {
      for (let index = 0; index < vertexCount; index++) {
        growBox(bounds, vertexPositions[index * 3], vertexPositions[index * 3 + 1], vertexPositions[index * 3 + 2]);
      }
    }

    const triangleStart = positions.length / 9;
    let triangleCount = 0;
    let normalAccumulator = vec(0, 0, 0);
      let absNormalAccumulator = vec(0, 0, 0);
      let absNormalWeight = 0;
    let normalMatrix = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const centroidAccumulator = vec(0, 0, 0);
    for (let index = 0; index < vertexCount; index++) {
      centroidAccumulator[0] += vertexPositions[index * 3];
      centroidAccumulator[1] += vertexPositions[index * 3 + 1];
      centroidAccumulator[2] += vertexPositions[index * 3 + 2];
    }

    const triangleTotal = indices.length > 0
      ? Math.floor(indices.length / 3)
      : Math.floor(vertexCount / 3);

    for (let triangle = 0; triangle < triangleTotal; triangle++) {
      const ia = indices.length > 0 ? indices[triangle * 3] : triangle * 3;
      const ib = indices.length > 0 ? indices[triangle * 3 + 1] : triangle * 3 + 1;
      const ic = indices.length > 0 ? indices[triangle * 3 + 2] : triangle * 3 + 2;
      if (
        !Number.isFinite(ia) || !Number.isFinite(ib) || !Number.isFinite(ic) ||
        ia < 0 || ib < 0 || ic < 0 ||
        ia >= vertexCount || ib >= vertexCount || ic >= vertexCount
      ) continue;

      const a = [vertexPositions[ia * 3], vertexPositions[ia * 3 + 1], vertexPositions[ia * 3 + 2]] as Vec3;
      const b = [vertexPositions[ib * 3], vertexPositions[ib * 3 + 1], vertexPositions[ib * 3 + 2]] as Vec3;
      const c = [vertexPositions[ic * 3], vertexPositions[ic * 3 + 1], vertexPositions[ic * 3 + 2]] as Vec3;

      positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      faceOfTriangle.push(faceIndex);
      triangleCount++;

      const weighted = crossVec(subVec(b, a), subVec(c, a));
      signedVolume += dotVec(a, crossVec(b, c)) / 6;
      const magnitude = lengthVec(weighted);
      if (magnitude > 1e-18) {
        const unit = scaleVec(weighted, 1 / magnitude);
        normalAccumulator = addVec(normalAccumulator, unit);
        // Mean absolute normal, accumulated per component. The cylinder axis
        // heuristic needs |n| rather than n: for a true cylinder every normal is
        // perpendicular to the axis, so the axis component of this mean is the
        // one that vanishes, and its magnitude identifies which axis that is.
        absNormalAccumulator = addVec(absNormalAccumulator, [
          Math.abs(unit[0]),
          Math.abs(unit[1]),
          Math.abs(unit[2]),
        ]);
        absNormalWeight += 1;
        for (let r = 0; r < 3; r++) {
          for (let cIndex = 0; cIndex < 3; cIndex++) {
            normalMatrix[r][cIndex] += unit[r] * unit[cIndex];
          }
        }
      }
    }

    const surfaceType = toSurfaceType(native?.surfaceType ?? "other");
    const faceBounds = bounds ?? nativeBoundsToBox(native?.bounds);
    const runtimeId = typeof native?.id === "string" ? native.id : `BRepFace-${faceIndex}`;

    // A node id must be unique within a graph document. Two faces resolving to the
    // same runtime id would emit two nodes sharing one `id`, after which every
    // edge pointing at that id is ambiguous and any consumer keyed by id silently
    // collapses them. Failing loudly beats silently dropping a face, because a
    // dropped face reads as absent geometry rather than as a bad input.
    if (seenRuntimeIds.has(runtimeId)) {
      throw new Error(
        `Duplicate face runtime id "${runtimeId}": exported face node ids would collide`
      );
    }
    seenRuntimeIds.add(runtimeId);

    faces.push({
      runtimeId,
      faceIndex,
      // `nativeIndex` from the OCCT payload is local to the source mesh, so it
      // repeats for every mesh in the file. The exported value is the face's
      // position in the whole rendered model, which is what `faceIndex` means
      // everywhere else in this module and what the runtime ID encodes.
      nativeIndex: faceIndex,
      surfaceType,
      nativeArea: typeof native?.area === "number" ? native.area : undefined,
      nativeCentroid: readPoint(native?.centroid),
      topologySignature: typeof native?.topologySignature === "string" ? native.topologySignature : null,
      vertexCount,
      triangleCount,
      bounds: faceBounds,
      areaNormal: normalizeVec(normalAccumulator),
      triangleStart,
      meshCentroid: vertexCount > 0
        ? scaleVec(centroidAccumulator, 1 / vertexCount)
        : null,
      cylinder: surfaceType === "cylinder" && vertexPositions.length >= 9
        ? fitCylinder(
            vertexPositions,
            vertexCount,
            absNormalWeight > 0 ? scaleVec(absNormalAccumulator, 1 / absNormalWeight) : null
          )
        : null,
      maxRadialDeviationDeg: null,
      windingConsistency: null,
      windingMinorityTriangles: null,
      radialOutwardSign: null,
    });

    // Fit quality: the largest angular disagreement between a triangle's
    // winding normal and the radial direction the fitted cylinder predicts at
    // that triangle's own centroid.
    //
    // The axis is fitted from the face's own triangles, so it is exact only when
    // the winding normals of this face are mutually consistent. A patch whose
    // triangles wind in mixed directions has no single outward normal and would
    // otherwise yield a large deviation that looks like a fitting failure. Such
    // a patch is reported as internally inconsistent instead of trusted.
    const cylinderFit = faces[faces.length - 1].cylinder;
    if (cylinderFit && triangleCount > 0) {
      let worst = 0;
      let positiveDot = 0;
      let negativeDot = 0;
      for (let triangle = 0; triangle < triangleCount; triangle++) {
        const base = triangleStart * 9 + triangle * 9;
        const a = vec(positions[base], positions[base + 1], positions[base + 2]);
        const b = vec(positions[base + 3], positions[base + 4], positions[base + 5]);
        const c = vec(positions[base + 6], positions[base + 7], positions[base + 8]);
        const triangleNormal = crossVec(subVec(b, a), subVec(c, a));
        if (lengthVec(triangleNormal) <= 1e-15) continue;
        const triangleCentroid = scaleVec(addVec(addVec(a, b), c), 1 / 3);
        const radial = radialDirection(triangleCentroid, cylinderFit);
        const unit = normalizeVec(triangleNormal);
        if (dotVec(unit, radial) >= 0) positiveDot++;
        else negativeDot++;
        const aligned = dotVec(unit, radial) >= 0 ? radial : scaleVec(radial, -1);
        worst = Math.max(worst, toDegrees(angleBetween(unit, aligned)));
      }
      const dominant = Math.max(positiveDot, negativeDot);
      const minority = Math.min(positiveDot, negativeDot);
      const consistency = triangleCount > 0 ? dominant / triangleCount : 0;
      faces[faces.length - 1].maxRadialDeviationDeg = round(worst);
      // A genuinely consistent patch winds one way; if a large minority of
      // triangles opposes it, treat the outward direction as unreliable.
      faces[faces.length - 1].windingConsistency = round(consistency);
      faces[faces.length - 1].windingMinorityTriangles = minority;
      // Sign that takes the fitted radial to the outward side, decided by a
      // triangle vote rather than by comparing against the patch mean normal.
      //
      // The mean normal is the wrong reference here: for a patch subtending
      // more than a hemisphere it points away from the radial, so orienting by
      // it would invert large-arc bores. Each triangle normal is locally
      // outward on a consistently wound patch, so their majority is stable
      // regardless of arc span.
      if (consistency >= MIN_WINDING_CONSISTENCY) {
        faces[faces.length - 1].radialOutwardSign = positiveDot >= negativeDot ? 1 : -1;
      }
    }

    faceTriangleRange.push({
      faceIndex,
      start: triangleStart,
      count: triangleCount,
      bounds: faceBounds,
    });
  });

  const scale = Math.max(1, faces.length);
  let normalOrientation: GraphStatistics["normalOrientation"] = "indeterminate";
  if (Math.abs(signedVolume) > 1e-9 * scale * scale) {
    normalOrientation = signedVolume < 0 ? "inward" : "outward";
  }

  const triangles: TriangleStore = {
    positions,
    faceOfTriangle,
    faceTriangleRange,
    bounds: faces.reduce<Box3 | null>((accumulator, face) => {
      if (!face.bounds) return accumulator;
      if (!accumulator) {
        accumulator = { min: [...face.bounds.min] as Vec3, max: [...face.bounds.max] as Vec3 };
        return accumulator;
      }
      for (let axis = 0; axis < 3; axis++) {
        accumulator.min[axis] = Math.min(accumulator.min[axis], face.bounds.min[axis]);
        accumulator.max[axis] = Math.max(accumulator.max[axis], face.bounds.max[axis]);
      }
      return accumulator;
    }, null),
  };

  return { faces, triangles, normalOrientation, signedVolume };
};

const readPoint = (value: ArrayLike<number> | undefined | null): Vec3 | null => {
  if (!value || value.length < 3) return null;
  const x = Number(value[0]);
  const y = Number(value[1]);
  const z = Number(value[2]);
  return [x, y, z].every(Number.isFinite) ? [x, y, z] : null;
};

const nativeBoundsToBox = (values: ArrayLike<number> | undefined | null): Box3 | null => {
  const point = readPoint(values);
  return point
    ? { min: [point[0], point[1], point[2]], max: [point[0], point[1], point[2]] }
    : null;
};

/**
 * Cylinder axis direction, following the viewer.
 *
 * This is the rule used by `computeFaceInteractionCache` in `CadCanvas3D.tsx`:
 * take the mean absolute normal and pick the coordinate axis whose component is
 * smallest. On a true cylinder every normal is perpendicular to the axis, so that
 * component vanishes and the axis is identified by it. The viewer prefers Y, then
 * Z, then X, and the same tie-breaking is reproduced here.
 *
 * `interactionCache.cylinderAxis` overrides any alternative derivation. It is a
 * heuristic rather than a fit: it snaps to a coordinate axis, so a bore at an
 * arbitrary angle is assigned the nearest coordinate axis instead of its true
 * direction. `fitCylinder` measures how far the patch's own normals disagree with
 * the chosen axis so that such a case can be withheld rather than published.
 */
const viewerCylinderAxis = (meanAbsNormal: Vec3): Vec3 => {
  const { 0: x, 1: y, 2: z } = meanAbsNormal;
  if (y <= x && y <= z) return vec(0, 1, 0);
  if (z <= x && z <= y) return vec(0, 0, 1);
  return vec(1, 0, 0);
};

/**
 * Least-squares cylinder fit for a tessellated cylindrical patch.
 *
 * The axis direction comes from `viewerCylinderAxis`, matching the viewer. The
 * cross-section centre, radius and residual are then fitted against that axis, so
 * the axis is placed through the centre of its own cross-section circle rather
 * than through the model origin.
 */
export const fitCylinder = (
  positions: number[],
  vertexCount: number,
  meanAbsNormal: Vec3 | null
): CylinderFit | null => {
  if (!meanAbsNormal) return null;
  const axis = viewerCylinderAxis(meanAbsNormal);

  const reference = Math.abs(axis[0]) < 0.9 ? vec(1, 0, 0) : vec(0, 1, 0);
  const e1 = normalizeVec(crossVec(axis, reference), vec(1, 0, 0));
  const e2 = normalizeVec(crossVec(axis, e1), vec(0, 1, 0));

  const us: number[] = [];
  const vs: number[] = [];
  let sumU = 0;
  let sumV = 0;
  let sumAlongAxis = 0;
  for (let index = 0; index < vertexCount; index++) {
    const point = vec(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
    const along = dotVec(point, axis);
    sumAlongAxis += along;
    const projected = subVec(point, scaleVec(axis, along));
    const u = dotVec(projected, e1);
    const v = dotVec(projected, e2);
    us.push(u);
    vs.push(v);
    sumU += u;
    sumV += v;
  }
  if (us.length < 3) return null;

  const count = us.length;
  let suu = 0;
  let svv = 0;
  let suv = 0;
  let suvv = 0;
  let svuu = 0;
  let suvv2 = 0;
  for (let index = 0; index < count; index++) {
    const u = us[index];
    const v = vs[index];
    const squared = u * u + v * v;
    suu += u * u;
    svv += v * v;
    suv += u * v;
    suvv += u * squared;
    svuu += v * squared;
    suvv2 += squared;
  }

  const solution = solveSymmetric3(
    [[suu, suv, sumU], [suv, svv, sumV], [sumU, sumV, count]],
    [-suvv, -svuu, -suvv2]
  );
  if (!solution) return null;

  const [d, e, f] = solution;
  const centerU = -d / 2;
  const centerV = -e / 2;
  const radiusSquared = centerU * centerU + centerV * centerV - f;
  if (!(radiusSquared > 1e-18) || !Number.isFinite(radiusSquared)) return null;
  const radius = Math.sqrt(radiusSquared);

  let deviation = 0;
  for (let index = 0; index < count; index++) {
    const delta = Math.hypot(us[index] - centerU, vs[index] - centerV) - radius;
    deviation = Math.max(deviation, Math.abs(delta));
  }

  // The fitted circle centre plus the mean axial station gives a concrete point
  // on the fitted axis line. The axis must pass through the centre of the
  // cross-section circle, not through the model origin, otherwise every radial
  // direction computed from it is measured from the wrong place.
  const centerInPlane = addVec(scaleVec(e1, centerU), scaleVec(e2, centerV));
  const axisPoint = scaleVec(axis, sumAlongAxis / count);

  // Axis consistency.
  //
  // The viewer's rule selects a coordinate axis from the smallest component of
  // the mean absolute normal, without checking that component against the patch.
  // Read as the mean absolute dot product of the patch's normals with the chosen
  // axis, the same number is a direct test: it is zero when the normals really
  // are perpendicular to that axis, and it grows with the angular error.
  //
  // A full-ring bore on a diagonal axis is caught here. Its normals lie in the
  // plane perpendicular to the true axis, so the axial component spans the full
  // range while the two in-plane components stay small; the smallest component is
  // therefore never the true axis, and the component the viewer picks is large.
  // A partial arc of such a bore is not reliably caught, and is recorded as a
  // known limit of the heuristic rather than papered over.
  const axisIndex = axis[1] === 1 ? 1 : axis[2] === 1 ? 2 : 0;
  const axisPerpendicularity = meanAbsNormal[axisIndex];

  // A two-facet patch admits an enormous family of near-degenerate circles, and
  // least squares will happily return one of astronomical radius. Such a fit has
  // a tiny residual yet a meaningless axis, so bound the radius by the patch's
  // own extent: a cylinder's radius cannot be far larger than the patch it is
  // measured on.
  let patchExtent = 0;
  for (let index = 0; index < count; index++) {
    patchExtent = Math.max(patchExtent, Math.hypot(us[index] - centerU, vs[index] - centerV));
  }
  const extentScale = Math.max(patchExtent, Math.abs(sumAlongAxis / count));
  const radiusPlausible =
    Number.isFinite(radius) && radius > 0 && radius <= extentScale * MAX_RADIUS_TO_EXTENT_RATIO;

  return {
    axis,
    axisPoint,
    centerInPlane,
    radius: radiusPlausible ? radius : Number.NaN,
    deviation,
    axisPerpendicularity,
    radiusPlausible,
  };
};

/**
 * Outward radial direction of the fitted cylinder at `point`.
 *
 * The reference is the fitted cross-section centre, and the component along the
 * axis is removed, so this is a true radial even when the fitted axis does not
 * pass through the model origin.
 */
const radialDirection = (point: Vec3, fit: CylinderFit): Vec3 => {
  const relative = subVec(point, fit.axisPoint);
  const axial = scaleVec(fit.axis, dotVec(relative, fit.axis));
  const radial = subVec(subVec(relative, axial), fit.centerInPlane);
  return normalizeVec(radial, fit.axis);
};

/* -------------------------------------------------------------------------- */
/* Local convexity probe                                                      */
/* -------------------------------------------------------------------------- */

interface InsideProbeResult {
  material: boolean;
  ambiguous: boolean;
}

/**
 * Ray/triangle intersection used for the solid-side probe.
 *
 * Returns the number of crossings of an infinite ray and whether any hit was
 * numerically ambiguous, so a caller can treat a knife-edge ray as unresolved
 * instead of silently picking a side.
 */
const countRayCrossings = (store: TriangleStore, origin: Vec3, direction: Vec3): InsideProbeResult => {
  let crossings = 0;
  let ambiguous = false;

  store.faceTriangleRange.forEach((range) => {
    const start = range.start;
    const end = range.start + range.count;
    for (let triangle = start; triangle < end; triangle++) {
      const offset = triangle * 9;
      const a = vec(store.positions[offset], store.positions[offset + 1], store.positions[offset + 2]);
      const b = vec(store.positions[offset + 3], store.positions[offset + 4], store.positions[offset + 5]);
      const c = vec(store.positions[offset + 6], store.positions[offset + 7], store.positions[offset + 8]);

      const edge1 = subVec(b, a);
      const edge2 = subVec(c, a);
      const pvec = crossVec(direction, edge2);
      const determinant = dotVec(edge1, pvec);
      if (Math.abs(determinant) < 1e-14) continue;
      const inverse = 1 / determinant;
      const tvec = subVec(origin, a);
      const u = dotVec(tvec, pvec) * inverse;
      if (u < 0 || u > 1) continue;
      const qvec = crossVec(tvec, edge1);
      const v = dotVec(direction, qvec) * inverse;
      if (v < 0 || u + v > 1) continue;
      const t = dotVec(edge2, qvec) * inverse;
      if (t <= 1e-9) continue;

      crossings++;
      if (
        u < AMBIGUOUS_BARYCENTRIC_EPSILON ||
        v < AMBIGUOUS_BARYCENTRIC_EPSILON ||
        1 - u - v < AMBIGUOUS_BARYCENTRIC_EPSILON
      ) {
        ambiguous = true;
      }
    }
  });

  return { material: crossings % 2 === 1, ambiguous };
};

/**
 * Decides whether a probe point sits inside the material, using ray parity
 * against the triangulated solid.
 *
 * Parity rather than a sign test: the model may be non-convex, and an odd
 * crossing count is well defined for any closed oriented shell. The two faces
 * that own the probe are skipped so their own boundary cannot decide the
 * question the probe is asking.
 */
const isPointInsideSolid = (
  store: TriangleStore,
  point: Vec3,
  direction: Vec3
): InsideProbeResult => {
  if (!store.faceTriangleRange.some((range) => range.count > 0)) {
    return { material: false, ambiguous: true };
  }
  // Every face participates. Ray parity is only meaningful for a closed shell,
  // so omitting the two faces that own the probe would punch a hole in the
  // surface and make the parity count meaningless. The probe point is offset off
  // both of those planes by construction, so neither of them passes through it.
  return countRayCrossings(store, point, direction);
};

interface ConvexityDecision {
  convexity: GraphConvexity;
  note: string | null;
}

const boundsScale = (store: TriangleStore): number => {
  if (!store.bounds) return 1;
  return Math.max(
    store.bounds.max[0] - store.bounds.min[0],
    store.bounds.max[1] - store.bounds.min[1],
    store.bounds.max[2] - store.bounds.min[2],
    1e-9
  );
};

/**
 * In-surface direction from the shared edge into `face`, resolved from the
 * patch's own tessellated vertices.
 *
 * The face boundary orientation of a shared edge is a global convention that
 * this module deliberately does not depend on. Instead the nearest genuinely
 * off-edge tessellation vertex fixes the direction: it is inside the patch by
 * construction and stable under tessellation refinement.
 */
const faceInwardRadial = (
  face: FaceGeometry,
  midpoint: Vec3,
  tangent: Vec3,
  store: TriangleStore
): Vec3 | null => {
  const range = store.faceTriangleRange.find((entry) => entry.faceIndex === face.faceIndex);
  if (!range || range.count === 0) return null;

  const degeneracy = Math.max(1e-12, boundsScale(store) * 1e-9);
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestDirection: Vec3 | null = null;

  for (let triangle = range.start; triangle < range.start + range.count; triangle++) {
    const offset = triangle * 9;
    for (let corner = 0; corner < 3; corner++) {
      const base = offset + corner * 3;
      const vertex = vec(store.positions[base], store.positions[base + 1], store.positions[base + 2]);
      const delta = subVec(vertex, midpoint);
      const distance = lengthVec(delta);
      if (!(distance > degeneracy) || distance >= bestDistance) continue;
      const inSurface = subVec(delta, scaleVec(tangent, dotVec(delta, tangent)));
      if (lengthVec(inSurface) <= degeneracy) continue;
      bestDistance = distance;
      bestDirection = inSurface;
    }
  }

  return bestDirection ? normalizeVec(bestDirection) : null;
};

/**
 * One solid-side probe in the "wing" region H1 INTERSECT not-H2.
 *
 * Why the wing and not the wedge between the two face surfaces: with H_i the
 * material half-space of face i, a convex junction has material equal to
 * H1 INTERSECT H2 while a re-entrant one has material equal to H1 UNION H2.
 * The intersection wedge is solid in both cases, so a probe there always
 * answers "material" and cannot separate them. The wing belongs to the
 * intersection in the convex case and to the union in the concave case, which
 * is exactly the distinction needed. Its bisector direction is (u2 - u1).
 */
const probeWing = (
  midpoint: Vec3,
  tangent: Vec3,
  normalA: Vec3,
  normalB: Vec3,
  offset: number,
  store: TriangleStore
): InsideProbeResult | null => {
  const wing = subVec(normalB, normalA);
  const wingLength = lengthVec(wing);
  if (!(wingLength > 1e-9)) return null;

  const probePoint = addVec(midpoint, scaleVec(wing, offset / wingLength));
  const rayDirection = normalizeVec(crossVec(tangent, wing), vec(1, 0, 0));
  if (lengthVec(rayDirection) < 0.5) return null;

  return isPointInsideSolid(store, probePoint, rayDirection);
};

/**
 * Decides the convexity sign of a shared-edge junction.
 *
 * Convexity is not a two-face quantity. With H_i the material half-space of
 * face i, a convex junction has material = H1 INTERSECT H2 and a re-entrant
 * junction has material = H1 UNION H2. Those two regions share the same
 * intersection wedge, so no probe of the wedge itself, and no sign convention on
 * the edge tangent or on the face ordering, can separate the cases. What
 * differs is the complementary wing H1 INTERSECT not-H2, which is void when the
 * material is the intersection and solid when the material is the union. The
 * probe point is therefore placed in that wing and tested against the whole
 * triangulated solid by ray parity.
 *
 * The probe is run at two offsets and must agree; disagreement is reported as
 * "indeterminate" rather than guessed.
 */
const decideConvexity = (
  midpoint: Vec3,
  tangent: Vec3,
  faceA: FaceGeometry,
  faceB: FaceGeometry,
  normalA: Vec3,
  normalB: Vec3,
  store: TriangleStore
): ConvexityDecision => {
  const scale = boundsScale(store);
  const reachA = faceReach(midpoint, faceA);
  const reachB = faceReach(midpoint, faceB);
  const primaryOffset = Math.max(0.05 * Math.min(reachA, reachB), scale * 1e-6);

  const primary = probeWing(midpoint, tangent, normalA, normalB, primaryOffset, store);
  const secondary = probeWing(midpoint, tangent, normalA, normalB, primaryOffset * 0.55, store);

  if (!primary || !secondary) {
    return { convexity: "indeterminate", note: "wing-probe-unavailable" };
  }

  // Wing is solid only for a re-entrant junction, because concave material is a
  // union of half-spaces and the wing is a subset of that union.
  const primaryConcave = primary.material;
  const secondaryConcave = secondary.material;
  if (primaryConcave !== secondaryConcave) {
    return { convexity: "indeterminate", note: "wing-probe-disagreement" };
  }

  return {
    convexity: primaryConcave ? "concave" : "convex",
    note: primary.ambiguous || secondary.ambiguous ? "wing-probe-ambiguous" : null,
  };
};

const faceReach = (midpoint: Vec3, face: FaceGeometry): number => {
  if (!face.bounds) return 0;
  let reach = 0;
  for (let axis = 0; axis < 3; axis++) {
    reach = Math.max(
      reach,
      Math.abs(face.bounds.max[axis] - midpoint[axis]),
      Math.abs(face.bounds.min[axis] - midpoint[axis])
    );
  }
  return reach;
};

/**
 * Outward unit normal of a face at a point, used for the dihedral computation.
 *
 * A trusted cylinder fit gives the true radial at that point, which matters for
 * large partial-cylindrical patches where a single patch normal is only the
 * chord-averaged direction. An untrusted fit falls back to the patch normal.
 */
const faceNormalAt = (face: FaceGeometry, point: Vec3): Vec3 | null => {
  if (face.cylinder && face.radialOutwardSign !== null) {
    return scaleVec(radialDirection(point, face.cylinder), face.radialOutwardSign);
  }
  return face.areaNormal;
};

/**
 * Whether the fitted cylinder may be published as geometry metadata.
 *
 * Deliberately stricter than "has a usable radial": the axis direction stays
 * accurate on a coarse patch because it is determined by the normals, while the
 * radius does not. Reporting a radius that is several percent off would be
 * worse than reporting none, so the two are gated separately.
 */
const isCylinderFitTrustworthy = (face: FaceGeometry): boolean => {
  if (!face.cylinder || !face.cylinder.radiusPlausible) return false;
  if ((face.windingConsistency ?? 0) < MIN_WINDING_CONSISTENCY) return false;
  if (face.cylinder.axisPerpendicularity > MAX_AXIS_PERPENDICULARITY) return false;
  const radius = face.cylinder.radius;
  if (!(radius > 0)) return false;
  return face.cylinder.deviation / radius <= MAX_CYLINDER_FIT_RESIDUAL_RATIO;
};

const outwardNormalFor = (
  face: FaceGeometry,
  point: Vec3,
  normalOrientation: GraphStatistics["normalOrientation"],
  flip: boolean
): Vec3 | null => {
  const source = faceNormalAt(face, point);
  if (!source) return null;
  const needsFlip = (normalOrientation === "inward") !== flip;
  return needsFlip ? scaleVec(source, -1) : source;
};

/* -------------------------------------------------------------------------- */
/* Ordering helpers                                                           */
/* -------------------------------------------------------------------------- */

const runtimeIndex = (id: string, prefix: string): number => {
  const match = new RegExp(`^${prefix}-(\\d+)$`).exec(id || "");
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
};

const entityIndex = (id: string): number => {
  const match = /^#?(\d+)$/.exec(String(id || "").trim());
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
};

/**
 * Locale-independent string comparison.
 *
 * `localeCompare` is deliberately avoided. Its result depends on the active
 * locale, so the same input could serialize differently on two machines, which
 * would break the byte-identical guarantee.
 */
const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const byFaceOrder = (left: string, right: string): number => {
  const a = runtimeIndex(left, "BRepFace");
  const b = runtimeIndex(right, "BRepFace");
  if (a !== b) return a - b;
  return compareCodeUnits(left, right);
};

const bumpCounter = (counter: Record<string, number>, key: string): void => {
  counter[key] = (counter[key] || 0) + 1;
};

/* -------------------------------------------------------------------------- */
/* Graph construction                                                         */
/* -------------------------------------------------------------------------- */

const buildSurfaceGeometryNodes = (
  records: Array<ParsedStepDatum["surfaceGeometry"][number] | undefined> | undefined
): GraphDatumNode["surfaceGeometry"] =>
  (records || []).map((record) => ({
    surfaceType: String(record?.surfaceType ?? "unknown"),
    targetId: record?.targetId ?? null,
    point: roundVecOrNull(record?.point),
    normal: roundVecOrNull(record?.normal),
    axis: roundVecOrNull(record?.axis),
    xDirection: roundVecOrNull(record?.xDirection),
  }));

/**
 * Assigns a unique graph ID to each PMI record.
 *
 * Several STEP records may legitimately share one `entityId`: a property
 * definition can carry more than one dimension, and the parser resolves them to
 * the same STEP entity. Keying nodes on `entityId` alone therefore collapses
 * distinct PMI records onto one node and silently loses records. The parser's
 * per-record `id` is already unique within a file, so it disambiguates.
 */
const buildPmiNodeId = (
  kind: string,
  record: { id: string; entityId: string },
  entityIdToCount: Map<string, number>
): string => {
  const base = `${kind}:${record.entityId || record.id}`;
  const seen = entityIdToCount.get(base) || 0;
  entityIdToCount.set(base, seen + 1);
  return seen === 0 ? base : `${base}@${record.id}`;
};

const collectReferenceStats = (
  references: PmiTopologyReference[] | undefined
): { unresolved: string[]; ambiguous: string[] } => {
  const unresolved = new Set<string>();
  const ambiguous = new Set<string>();
  (references || []).forEach((reference) => {
    if (reference.resolution === "missing") unresolved.add(reference.stepEntityId || "");
    if (reference.resolution === "ambiguous") ambiguous.add(reference.stepEntityId || "");
  });
  return {
    unresolved: [...unresolved].filter(Boolean).sort(byEntityIndexThenText),
    ambiguous: [...ambiguous].filter(Boolean).sort(byEntityIndexThenText),
  };
};

const byEntityIndexThenText = (left: string, right: string): number => {
  const a = entityIndex(left);
  const b = entityIndex(right);
  if (a !== b) return a - b;
  return compareCodeUnits(left, right);
};

const uniqueSorted = (
  values: Array<string | undefined | null> | undefined | null
): string[] => {
  const set = new Set((values || []).filter((value): value is string => !!value));
  return [...set].sort(byEntityIndexThenText);
};

const buildDatumNode = (
  datum: ParsedStepDatum,
  nodeId: string
): GraphDatumNode => {
  const stats = collectReferenceStats(datum.topologyReferences);
  return {
    id: nodeId,
    kind: "Datum",
    label: datum.name || `Datum ${datum.identifier}`,
    entityId: datum.entityId,
    identifier: datum.identifier,
    datumType: datum.type,
    symbol: datum.symbol,
    targetName: datum.targetName,
    targetStepEntityIds: uniqueSorted([
      ...(datum.targetIds || []),
      datum.targetId,
    ]),
    semanticTargetStepEntityIds: uniqueSorted(datum.semanticTargetIds),
    derivedDatum: datum.derivedDatum ?? null,
    targetSource: datum.targetSource ?? null,
    surfaceGeometry: buildSurfaceGeometryNodes(datum.surfaceGeometry),
    presentationTargetPoint: roundVecOrNull(datum.presentationTargetPoint),
    unresolvedTargetStepEntityIds: stats.unresolved,
    ambiguousTargetStepEntityIds: stats.ambiguous,
  };
};

const buildDatumTargetNode = (
  target: ParsedStepDatumTarget,
  nodeId: string
): GraphDatumTargetNode => {
  const stats = collectReferenceStats(target.topologyReferences);
  return {
    id: nodeId,
    kind: "DatumTarget",
    label: target.name,
    entityId: target.entityId,
    identifier: target.identifier,
    parentDatum: target.parentDatum ?? null,
    targetType: target.type ?? null,
    targetName: target.targetName,
    targetStepEntityIds: uniqueSorted([...(target.targetIds || []), target.targetId]),
    sizeLabels: [...(target.sizeLabels || [])].sort(compareCodeUnits),
    targetPoint: roundVecOrNull(target.targetPoint),
    targetLine: target.targetLine
      ? {
          length: round(target.targetLine.length),
          direction: roundVecOrNull(target.targetLine.direction) || [0, 0, 0],
          center: roundVecOrNull(target.targetLine.center) || [0, 0, 0],
          normal: roundVecOrNull(target.targetLine.normal),
        }
      : null,
    targetCircle: target.targetCircle
      ? {
          diameter: round(target.targetCircle.diameter),
          center: roundVecOrNull(target.targetCircle.center) || [0, 0, 0],
          normal: roundVecOrNull(target.targetCircle.normal) || [0, 0, 0],
          radius: round(target.targetCircle.diameter / 2),
        }
      : null,
    targetCurvePointCount: target.targetCurve?.points?.length || 0,
    targetZone: target.targetZone
      ? {
          shape: target.targetZone.shape,
          width: round(target.targetZone.width),
          length: round(target.targetZone.length),
          center: roundVecOrNull(target.targetZone.center) || [0, 0, 0],
          normal: roundVecOrNull(target.targetZone.normal) || [0, 0, 0],
        }
      : null,
    unresolvedTargetStepEntityIds: stats.unresolved,
    ambiguousTargetStepEntityIds: stats.ambiguous,
  };
};

const compoundInfo = (tolerance: ParsedStepTolerance): GraphDimensionNode["compound"] => {
  const kind = tolerance.isCounterboreDimension
    ? "counterbore"
    : tolerance.isCountersinkDimension
      ? "countersink"
      : tolerance.isSlotOverallDimension || tolerance.slotRadiusNominal !== undefined
        ? "slot"
        : null;
  if (!kind) {
    return {
      kind: null,
      holeNominal: null,
      holeLowerTolerance: null,
      holeUpperTolerance: null,
      depthNominal: null,
      depthLowerTolerance: null,
      depthUpperTolerance: null,
      angleNominal: null,
      angleLowerTolerance: null,
      angleUpperTolerance: null,
      slotRadiusNominal: null,
      slotRadiusModel: null,
    };
  }
  return {
    kind,
    holeNominal: roundOrNull(tolerance.counterboreHoleNominal),
    holeLowerTolerance: roundOrNull(tolerance.counterboreHoleLowerTolerance),
    holeUpperTolerance: roundOrNull(tolerance.counterboreHoleUpperTolerance),
    depthNominal: roundOrNull(tolerance.counterboreDepthNominal),
    depthLowerTolerance: roundOrNull(tolerance.counterboreDepthLowerTolerance),
    depthUpperTolerance: roundOrNull(tolerance.counterboreDepthUpperTolerance),
    angleNominal: roundOrNull(tolerance.countersinkAngleNominal),
    angleLowerTolerance: roundOrNull(tolerance.countersinkAngleLowerTolerance),
    angleUpperTolerance: roundOrNull(tolerance.countersinkAngleUpperTolerance),
    slotRadiusNominal: roundOrNull(tolerance.slotRadiusNominal),
    slotRadiusModel: roundOrNull(tolerance.slotRadiusModel),
  };
};

const buildDimensionNode = (
  tolerance: ParsedStepTolerance,
  nodeId: string
): GraphDimensionNode => {
  const stats = collectReferenceStats(tolerance.topologyReferences);
  return {
    id: nodeId,
    kind: "Dimension",
    label: tolerance.targetName || `${tolerance.dimensionKind || "Dimension"} callout`,
    entityId: tolerance.entityId,
    dimensionKind: tolerance.dimensionKind ?? null,
    targetName: tolerance.targetName,
    targetStepEntityIds: uniqueSorted([...(tolerance.targetIds || []), tolerance.targetId]),
    nominalDimension: roundOrNull(tolerance.nominalDimension),
    lowerLimit: roundOrNull(tolerance.dimensionLowerLimit),
    upperLimit: roundOrNull(tolerance.dimensionUpperLimit),
    lowerTolerance: roundOrNull(tolerance.lowerTolerance),
    upperTolerance: roundOrNull(tolerance.upperTolerance),
    preModifier: tolerance.dimensionPreModifier ?? null,
    decimalPlaces: tolerance.dimensionDecimalPlaces ?? null,
    isReferenceDimension: tolerance.isReferenceDimension === true,
    isBasicDimension: tolerance.isBasicDimension === true,
    isStatisticalTolerance: tolerance.isStatisticalTolerance === true,
    isDatumTargetDimension: tolerance.isDatumTargetDimension === true,
    isSphericalDimension: tolerance.isSphericalDimension === true,
    isCircularCurveDimension: tolerance.isCircularCurveDimension === true,
    isControlledRadiusDimension: tolerance.isControlledRadiusDimension === true,
    isThreadCall: !!tolerance.threadDesignation,
    threadDesignation: tolerance.threadDesignation ?? null,
    toleranceZoneShape: tolerance.toleranceZoneForm ?? null,
    modifiers: [...(tolerance.toleranceModifiers || [])].sort(compareCodeUnits),
    secondary: tolerance.secondaryDimensionEntityId
      ? {
          entityId: tolerance.secondaryDimensionEntityId,
          nominalDimension: roundOrNull(tolerance.secondaryNominalDimension),
          lowerTolerance: roundOrNull(tolerance.secondaryLowerTolerance),
          upperTolerance: roundOrNull(tolerance.secondaryUpperTolerance),
        }
      : null,
    compound: compoundInfo(tolerance),
    unresolvedTargetStepEntityIds: stats.unresolved,
    ambiguousTargetStepEntityIds: stats.ambiguous,
  };
};

const buildGeometricToleranceNode = (
  tolerance: ParsedStepTolerance,
  nodeId: string
): GraphGeometricToleranceNode => {
  const stats = collectReferenceStats(tolerance.topologyReferences);
  return {
    id: nodeId,
    kind: "GeometricTolerance",
    label: `${tolerance.type} ${tolerance.value ?? ""}`.trim(),
    entityId: tolerance.entityId,
    category: tolerance.category,
    targetStepEntityIds: uniqueSorted([...(tolerance.targetIds || []), tolerance.targetId]),
    toleranceType: tolerance.type,
    symbol: tolerance.symbol,
    toleranceValue: roundOrNull(tolerance.value),
    toleranceZone: {
      form: tolerance.toleranceZoneForm ?? null,
      isDiameter: tolerance.toleranceZoneDiameter === true,
      projectedHeight: roundOrNull(tolerance.projectedToleranceZoneHeight),
      value: roundOrNull(tolerance.value),
    },
    modifiers: [...(tolerance.toleranceModifiers || [])].sort(compareCodeUnits),
    isStatisticalTolerance: tolerance.isStatisticalTolerance === true,
    hasToleranceModifiers: tolerance.hasToleranceModifiers === true,
    targetName: tolerance.targetName,
    // Resolved after all nodes exist, from an explicit parser reference when
    // present and otherwise from the shared controlled feature.
    attachedDimensionEntityId: null,
    datumReferenceFrameLabel: tolerance.datumReferenceFrame?.label ?? null,
    datumReferenceFrameEntityId: tolerance.datumReferenceFrame?.entityId ?? null,
    datumReferenceOrder: datumOrder(tolerance.datumReferenceFrame),
    unresolvedTargetStepEntityIds: stats.unresolved,
    ambiguousTargetStepEntityIds: stats.ambiguous,
  };
};

/**
 * Ordered datum identifiers of a frame, ordered by precedence then identifier.
 *
 * Simultaneous datums share a precedence level and so appear adjacently; the
 * grouping itself is carried by `precedenceGroup` on the component edges.
 */
const datumOrder = (frame: ParsedStepDatumReferenceFrame | undefined): string[] => {
  if (!frame?.references) return [];
  return [...frame.references]
    .sort((left, right) =>
      left.precedence !== right.precedence
        ? left.precedence - right.precedence
        : compareCodeUnits(left.datumIdentifier, right.datumIdentifier)
    )
    .map((reference) => reference.datumIdentifier);
};

const buildFrameNode = (
  frame: ParsedStepDatumReferenceFrame,
  scope: "model" | "tolerance",
  ownerEntityId: string | null,
  nodeId: string
): GraphDatumReferenceFrameNode => {
  const stats = collectReferenceStats(frame.topologyReferences);
  return {
    id: nodeId,
    kind: "DatumReferenceFrame",
    entityId: frame.entityId,
    scope,
    ownerEntityId,
    name: frame.name,
    label: frame.label || frame.name,
    datumOrder: datumOrder(frame),
    toleranceEntityIds: uniqueSorted(frame.toleranceEntityIds),
    frameBasis: frame.frameBasis
      ? {
          origin: roundVecOrNull(frame.frameBasis.origin) || [0, 0, 0],
          xAxis: roundVecOrNull(frame.frameBasis.xAxis) || [0, 0, 0],
          yAxis: roundVecOrNull(frame.frameBasis.yAxis) || [0, 0, 0],
          zAxis: roundVecOrNull(frame.frameBasis.zAxis) || [0, 0, 0],
        }
      : null,
    unresolvedTargetStepEntityIds: stats.unresolved,
    ambiguousTargetStepEntityIds: stats.ambiguous,
  };
};

const buildPmiTopologyEdges = (
  ownerNodeId: string,
  references: PmiTopologyReference[] | undefined
): GraphPmiTopologyEdge[] => {
  const edges: GraphPmiTopologyEdge[] = [];
  (references || []).forEach((reference, order) => {
    const candidateIds = reference.candidateRuntimeIds || [];
    const targets = reference.runtimeId
      ? [reference.runtimeId]
      : candidateIds.length > 0
        ? candidateIds
        : [null];
    targets.forEach((runtimeId) => {
      edges.push({
        id: `pmi-topology:${ownerNodeId}|${reference.stepEntityId}|${runtimeId ?? "unresolved"}|${order}`,
        kind: "pmi-topology",
        source: ownerNodeId,
        target: runtimeId ? nodeIdForTopology(runtimeId) : null,
        entityKind: reference.entityKind,
        targetStepEntityId: reference.stepEntityId,
        resolution: reference.resolution,
        resolutionReason: reference.resolutionReason,
        runtimeId: runtimeId ?? null,
        candidateRuntimeIds: [...candidateIds].sort(byFaceOrder),
        candidateTopologySignatures: uniqueSorted(reference.candidateTopologySignatures),
        topologySignature: runtimeId && runtimeId === reference.runtimeId
          ? reference.topologySignature ?? null
          : null,
        stepTopologySignature: reference.stepTopologySignature ?? null,
      });
    });
  });
  return edges;
};

const nodeIdForTopology = (runtimeId: string): string => {
  if (runtimeId.startsWith("BRepFace-")) return `face:${runtimeId}`;
  if (runtimeId.startsWith("BRepEdge-")) return `edge:${runtimeId}`;
  if (runtimeId.startsWith("BRepVertex-")) return `vertex:${runtimeId}`;
  if (runtimeId.startsWith("BRepLoop-")) return `loop:${runtimeId}`;
  return `topology:${runtimeId}`;
};

/**
 * Builds the deterministic JSON graph for one loaded part.
 *
 * `enrichPmiTopologyReferences` is the only PMI-to-topology mapping route used.
 */
export function exportGraph(input: ExportGraphInput): ExportGraphResult {
  const { parsed, occtResult, faceMapping, linearDeflection, angularDeflection } = input;

  // `enrichPmiTopologyReferences` reads `occtResult.faces` unguarded, so a missing
  // payload surfaces as a `TypeError` from inside that module rather than as a
  // statement about what the caller got wrong. Validate here, where the message
  // can name the actual problem.
  if (!occtResult || typeof occtResult !== "object") {
    throw new Error(
      "exportGraph requires the occtResult payload from parseStepWithOcct"
    );
  }

  const enriched = enrichPmiTopologyReferences(parsed, occtResult, faceMapping);

  // Tessellation fallback, used only when the payload carries no native face
  // table. Enumerates meshes exactly as `collectFaces` does, which skips
  // auxiliary meshes and indexes the survivors by their position among the
  // non-auxiliary ones.
  //
  // Output is identical either way today: a synthesized descriptor carries only
  // `id` and `nativeIndex`, `collectFaces` reads only `id` from it (taking the
  // exported `nativeIndex` from `faceIndex`), and the descriptor at index k
  // always has `id = BRepFace-k`, which is what the positional fallback on the
  // `runtimeId` line would produce regardless. Filtering is kept so the two
  // enumerations cannot silently diverge if a synthesized descriptor ever grows
  // a field the consumer reads.
  const nativeFaces: any[] = Array.isArray(occtResult?.faces) && occtResult.faces.length > 0
    ? occtResult.faces
    : (occtResult?.meshes || [])
      .filter((mesh: any) => mesh?.auxiliary !== true)
      .map((mesh: any, index: number) => ({
        id: `BRepFace-${index}`,
        nativeIndex: index,
      }));
  const nativeEdges: any[] = Array.isArray(occtResult?.edges) && occtResult.edges.length > 0
    ? occtResult.edges
    : occtResult?.lines || [];
  const nativeVertices: any[] = Array.isArray(occtResult?.vertices) ? occtResult.vertices : [];
  const nativeLoops: any[] = Array.isArray(occtResult?.loops) ? occtResult.loops : [];

  const { faces, triangles, normalOrientation, signedVolume } = collectFaces(occtResult, nativeFaces);
  const faceByRuntimeId = new Map(faces.map((face) => [face.runtimeId, face]));

  const stepEntityIdsByRuntimeId = new Map<string, string[]>();
  Object.entries(faceMapping).forEach(([stepEntityId, runtimeId]) => {
    if (!runtimeId) return;
    const list = stepEntityIdsByRuntimeId.get(runtimeId) || [];
    list.push(stepEntityId);
    stepEntityIdsByRuntimeId.set(runtimeId, list);
  });

  /* ------------------------------- face nodes ------------------------------ */

  const loopIdsByFace = new Map<string, string[]>();
  nativeLoops.forEach((loop: any) => {
    const faceId = typeof loop?.faceId === "string" ? loop.faceId : undefined;
    if (!faceId) return;
    loopIdsByFace.set(faceId, [...(loopIdsByFace.get(faceId) || []), String(loop.id)]);
  });
  const edgeIdsByFace = new Map<string, string[]>();
  nativeEdges.forEach((edge: any) => {
    const parentIds: string[] = Array.isArray(edge?.parentFaceIds) ? edge.parentFaceIds : [];
    parentIds.forEach((parentId) => {
      edgeIdsByFace.set(parentId, [...(edgeIdsByFace.get(parentId) || []), String(edge.id)]);
    });
  });

  const faceNodes: GraphFaceNode[] = faces
    .slice()
    .sort((left, right) => byFaceOrder(left.runtimeId, right.runtimeId))
    .map((face) => {
      // OCCT area-weighted centroid when present, otherwise the tessellated
      // vertex average so the attribute is never silently absent.
      const nativeCentroid = roundVecOrNull(face.nativeCentroid || face.meshCentroid);
      const cylinder = face.cylinder;
      let normalSource: GraphFaceNode["normalSource"] = "unavailable";
      let outwardNormal = face.areaNormal ? roundVecOrNull(face.areaNormal) : null;
      let normalDeviationDeg: number | null = null;
      let cylinderOrientation: GraphFaceNode["cylinderOrientation"] = null;

      // The radial direction comes from the fitted axis whenever the patch winds
      // consistently. It is used even when the radius is not publishable: a
      // coarse patch still yields an accurate axis, and substituting the patch
      // mean normal there would move the dihedral by tens of degrees on large-arc
      // bores, where the mean normal is not the local normal.
      // The radial direction requires an axis the patch's own normals agree with.
      // Without that check the viewer's rule can snap to a coordinate axis well
      // away from the patch's true direction, and every radial computed from it
      // would swing with the tessellation and corrupt the dihedral of every
      // junction it touches.
      const cylinderUsable =
        !!cylinder &&
        cylinder.radiusPlausible &&
        face.radialOutwardSign !== null &&
        cylinder.axisPerpendicularity <= MAX_AXIS_PERPENDICULARITY;
      const cylinderTrustworthy = cylinderUsable && isCylinderFitTrustworthy(face);

      let cylinderAxis: Vec3 | null = cylinder
        ? roundVecOrNull(canonicalizeDirection(cylinder.axis))
        : null;
      let cylinderRadius: number | null = null;
      let cylinderRadiusDeviation: number | null = null;

      if (cylinderUsable && (face.nativeCentroid || face.meshCentroid)) {
        // The representative point for the node is the patch centroid, and the
        // radial there is oriented by the triangle winding vote.
        const radial = scaleVec(
          radialDirection(face.nativeCentroid || face.meshCentroid!, cylinder!),
          face.radialOutwardSign!
        );
        normalSource = "cylinder-radial";
        outwardNormal = roundVecOrNull(radial);

        if (cylinderTrustworthy) {
          normalDeviationDeg = face.maxRadialDeviationDeg;
          cylinderRadius = round(cylinder!.radius);
          cylinderRadiusDeviation = round(cylinder!.deviation);
          cylinderOrientation = face.radialOutwardSign! > 0 ? "external" : "internal";
        }
        // Otherwise the axis stays published but the radius stays null: a coarse
        // patch still fixes the axis from its normals, yet its radius can be
        // several percent off and must not be reported as measured geometry.
      } else if (face.areaNormal) {
        normalSource = "tessellation";
      }

      const flip = normalOrientation === "inward";
      const storedNormal = outwardNormal ? (flip ? scaleVec(outwardNormal, -1) : outwardNormal) : null;

      return {
        id: `face:${face.runtimeId}`,
        kind: "Face" as const,
        label: `${face.runtimeId} (${face.surfaceType})`,
        runtimeId: face.runtimeId,
        nativeIndex: face.nativeIndex,
        stepEntityIds: uniqueSorted(stepEntityIdsByRuntimeId.get(face.runtimeId)),
        surfaceType: face.surfaceType,
        area: roundOrNull(face.nativeArea),
        centroid: nativeCentroid,
        bounds: face.bounds
          ? { min: face.bounds.min.map(round) as Vec3, max: face.bounds.max.map(round) as Vec3 }
          : null,
        outwardNormal: storedNormal
          ? ([round(storedNormal[0]), round(storedNormal[1]), round(storedNormal[2])] as Vec3)
          : null,
        normalSource,
        normalDeviationDeg,
        cylinderAxis,
        cylinderRadius,
        cylinderRadiusDeviation,
        cylinderOrientation,
        windingConsistency: face.windingConsistency,
        windingMinorityTriangles: face.windingMinorityTriangles,
        edgeCount: (edgeIdsByFace.get(face.runtimeId) || []).length,
        loopCount: (loopIdsByFace.get(face.runtimeId) || []).length,
        topologySignature: face.topologySignature,
        meshVertexCount: face.vertexCount,
        meshTriangleCount: face.triangleCount,
      };
    });

  /* ------------------------------- edge nodes ------------------------------ */

  const edgeNodes: GraphEdgeNode[] = nativeEdges
    .map((edge: any, index: number) => {
      const runtimeId = typeof edge?.id === "string" ? edge.id : `BRepEdge-${index}`;
      const rawPositions = readArrayLike(edge?.positions);
      const pointAt = (component: number): Vec3 | null => {
        const offset = component * 3;
        if (rawPositions.length < offset + 3) return null;
        const value: Vec3 = [rawPositions[offset], rawPositions[offset + 1], rawPositions[offset + 2]];
        return value.every(Number.isFinite) ? value : null;
      };
      const start = pointAt(0);
      const end = rawPositions.length >= 6 ? pointAt(rawPositions.length / 3 - 1) : null;
      let polylineLength = 0;
      for (let offset = 0; offset + 5 < rawPositions.length; offset += 6) {
        polylineLength += Math.hypot(
          rawPositions[offset + 3] - rawPositions[offset],
          rawPositions[offset + 4] - rawPositions[offset + 1],
          rawPositions[offset + 5] - rawPositions[offset + 2]
        );
      }
      return {
        id: `edge:${runtimeId}`,
        kind: "Edge" as const,
        label: `${runtimeId} (${toCurveType(edge?.curveType)})`,
        runtimeId,
        nativeIndex: index,
        curveType: toCurveType(edge?.curveType),
        length: roundOrNull(typeof edge?.curveLength === "number" ? edge.curveLength : polylineLength || undefined),
        closed: edge?.closed === true,
        stepEntityIds: uniqueSorted([edge?.stepEntityId]),
        parentFaceIds: (Array.isArray(edge?.parentFaceIds) ? edge.parentFaceIds : [])
          .map(String)
          .sort(byFaceOrder),
        vertexIds: (Array.isArray(edge?.vertexIds) ? edge.vertexIds : []).map(String).sort(
          (left, right) => runtimeIndex(left, "BRepVertex") - runtimeIndex(right, "BRepVertex")
        ),
        startPoint: roundVecOrNull(start || undefined),
        endPoint: roundVecOrNull(end || undefined),
        midpoint: start && end ? roundVecOrNull(scaleVec(addVec(start, end), 0.5)) : null,
        topologySignature: typeof edge?.topologySignature === "string" ? edge.topologySignature : null,
        stepTopologySignature: typeof edge?.stepTopologySignature === "string"
          ? edge.stepTopologySignature
          : null,
      };
    })
    .sort((left, right) => runtimeIndex(left.runtimeId, "BRepEdge") - runtimeIndex(right.runtimeId, "BRepEdge"));

  const vertexNodes: GraphVertexNode[] = nativeVertices
    .map((vertex: any, index: number) => {
      const runtimeId = typeof vertex?.id === "string" ? vertex.id : `BRepVertex-${index}`;
      return {
        id: `vertex:${runtimeId}`,
        kind: "Vertex" as const,
        label: runtimeId,
        runtimeId,
        nativeIndex: index,
        point: roundVecOrNull(vertex?.point),
        stepEntityIds: uniqueSorted(vertex?.stepEntityIds),
        topologySignature: typeof vertex?.topologySignature === "string" ? vertex.topologySignature : null,
      };
    })
    .sort((left, right) => runtimeIndex(left.runtimeId, "BRepVertex") - runtimeIndex(right.runtimeId, "BRepVertex"));

  /* ----------------------------- geometry edges ---------------------------- */

  const incidenceEdges: GraphIncidenceEdge[] = [];
  const adjacencyEdges: GraphAdjacencyEdge[] = [];
  let nonManifoldEdgeCount = 0;

  const orderedAdjacencyKeys = new Set<string>();
  const adjacencyDrafts: Array<GraphAdjacencyEdge & { sharedEdgeId: string; sharedEdgeOrder: number }> = [];

  nativeEdges.forEach((edge: any, index: number) => {
    const runtimeId = typeof edge?.id === "string" ? edge.id : `BRepEdge-${index}`;
    const parentFaceIds: string[] = (Array.isArray(edge?.parentFaceIds) ? edge.parentFaceIds : [])
      .map(String)
      .filter((faceId) => faceByRuntimeId.has(faceId))
      .sort(byFaceOrder);

    parentFaceIds.forEach((faceId) => {
      incidenceEdges.push({
        id: `incidence:face:${faceId}|edge:${runtimeId}`,
        kind: "incidence",
        source: `face:${faceId}`,
        target: `edge:${runtimeId}`,
        role: "face-boundary",
      });
    });

    const vertexIds: string[] = (Array.isArray(edge?.vertexIds) ? edge.vertexIds : [])
      .map(String)
      .sort((left, right) => runtimeIndex(left, "BRepVertex") - runtimeIndex(right, "BRepVertex"));
    vertexIds.forEach((vertexId) => {
      incidenceEdges.push({
        id: `incidence:edge:${runtimeId}|vertex:${vertexId}`,
        kind: "incidence",
        source: `edge:${runtimeId}`,
        target: `vertex:${vertexId}`,
        role: "edge-endpoint",
      });
    });

    if (parentFaceIds.length < 2) return;
    const nonManifold = parentFaceIds.length > 2;
    if (nonManifold) nonManifoldEdgeCount++;

    const pairs: Array<[string, string]> = [];
    if (parentFaceIds.length <= 3) {
      for (let a = 0; a < parentFaceIds.length; a++) {
        for (let b = a + 1; b < parentFaceIds.length; b++) {
          pairs.push([parentFaceIds[a], parentFaceIds[b]]);
        }
      }
    } else {
      for (let a = 0; a < parentFaceIds.length; a++) {
        pairs.push([parentFaceIds[a], parentFaceIds[(a + 1) % parentFaceIds.length]]);
      }
    }

    pairs.forEach(([faceAId, faceBId]) => {
      const key = `${faceAId}|${faceBId}|${runtimeId}`;
      if (orderedAdjacencyKeys.has(key)) return;
      orderedAdjacencyKeys.add(key);
      adjacencyDrafts.push(
        buildAdjacencyEdge(
          runtimeId,
          runtimeIndex(runtimeId, "BRepEdge"),
          readArrayLike(edge?.positions),
          faceAId,
          faceBId,
          faceByRuntimeId,
          triangles,
          normalOrientation,
          nonManifold
        )
      );
    });
  });

  adjacencyDrafts
    .sort((left, right) => {
      const sourceA = left.source.slice("face:".length);
      const sourceB = right.source.slice("face:".length);
      const faceComparison = byFaceOrder(sourceA, sourceB);
      if (faceComparison !== 0) return faceComparison;
      const targetA = left.target?.slice("face:".length) || "";
      const targetB = right.target?.slice("face:".length) || "";
      const targetComparison = byFaceOrder(targetA, targetB);
      if (targetComparison !== 0) return targetComparison;
      return left.sharedEdgeOrder - right.sharedEdgeOrder;
    })
    .forEach((draft) => {
      const { sharedEdgeId, sharedEdgeOrder, ...edge } = draft;
      adjacencyEdges.push(edge);
    });

  /* -------------------------------- PMI nodes ------------------------------ */

  // Records may share a STEP entity id, so ids are disambiguated per kind.
  const pmiIdCounters = new Map<string, number>();

  const datumRecords = enriched.datums
    .slice()
    .sort((left, right) => byEntityIndexThenText(left.entityId, right.entityId));
  const datumNodes = datumRecords.map((datum) =>
    buildDatumNode(datum, buildPmiNodeId("datum", datum, pmiIdCounters))
  );
  const datumNodeByIdentifier = new Map<string, GraphDatumNode>();
  datumNodes.forEach((node) => datumNodeByIdentifier.set(node.identifier, node));

  const datumTargetRecords = enriched.datumTargets
    .slice()
    .sort((left, right) => byEntityIndexThenText(left.entityId, right.entityId));
  const datumTargetNodes = datumTargetRecords.map((target) =>
    buildDatumTargetNode(target, buildPmiNodeId("datum-target", target, pmiIdCounters))
  );

  const sortedTolerances = enriched.tolerances
    .slice()
    .sort((left, right) => byEntityIndexThenText(left.entityId, right.entityId));
  const dimensionTolerances = sortedTolerances.filter((tolerance) => tolerance.category === "Dimension");
  const geometricTolerances = sortedTolerances.filter((tolerance) => tolerance.category !== "Dimension");

  // Nodes stay paired with their source record so later lookups never re-search
  // by STEP entity id and risk binding the wrong record.
  const dimensionEntries = dimensionTolerances.map((tolerance) => ({
    record: tolerance,
    node: buildDimensionNode(tolerance, buildPmiNodeId("dimension", tolerance, pmiIdCounters)),
  }));
  const dimensionNodes = dimensionEntries.map((entry) => entry.node);
  const geometricToleranceEntries = geometricTolerances.map((tolerance) => ({
    record: tolerance,
    node: buildGeometricToleranceNode(
      tolerance,
      buildPmiNodeId("gdt", tolerance, pmiIdCounters)
    ),
  }));
  const geometricToleranceNodes = geometricToleranceEntries.map((entry) => entry.node);
  const dimensionNodeByEntityId = new Map<string, GraphDimensionNode[]>();
  dimensionEntries.forEach((entry) => {
    const key = entry.node.entityId;
    dimensionNodeByEntityId.set(key, [
      ...(dimensionNodeByEntityId.get(key) || []),
      entry.node,
    ]);
  });

  const modelFrameRecords = enriched.datumReferenceFrames
    .slice()
    .sort((left, right) => byEntityIndexThenText(left.entityId, right.entityId));
  const modelFrameNodes = modelFrameRecords.map((frame) =>
    buildFrameNode(frame, "model", null, buildPmiNodeId("drf", frame, pmiIdCounters))
  );
  const toleranceFrameEntries = geometricTolerances
    .filter((tolerance) => !!tolerance.datumReferenceFrame)
    .map((tolerance) => ({
      record: tolerance,
      node: buildFrameNode(
        tolerance.datumReferenceFrame!,
        "tolerance",
        tolerance.entityId,
        buildPmiNodeId("drf:tolerance", tolerance, pmiIdCounters)
      ),
    }));
  const toleranceFrameNodes = toleranceFrameEntries.map((entry) => entry.node);

  const pmiTopologyEdges: GraphPmiTopologyEdge[] = [];
  datumNodes.forEach((node, index) =>
    pmiTopologyEdges.push(
      ...buildPmiTopologyEdges(node.id, datumRecords[index].topologyReferences)
    )
  );
  datumTargetNodes.forEach((node, index) =>
    pmiTopologyEdges.push(
      ...buildPmiTopologyEdges(node.id, datumTargetRecords[index].topologyReferences)
    )
  );
  dimensionEntries.forEach((entry) =>
    pmiTopologyEdges.push(
      ...buildPmiTopologyEdges(entry.node.id, entry.record.topologyReferences)
    )
  );
  geometricToleranceEntries.forEach((entry) =>
    pmiTopologyEdges.push(
      ...buildPmiTopologyEdges(entry.node.id, entry.record.topologyReferences)
    )
  );
  modelFrameNodes.forEach((node, index) =>
    pmiTopologyEdges.push(
      ...buildPmiTopologyEdges(node.id, modelFrameRecords[index].topologyReferences)
    )
  );
  toleranceFrameEntries.forEach((entry) =>
    pmiTopologyEdges.push(
      ...buildPmiTopologyEdges(entry.node.id, entry.record.datumReferenceFrame?.topologyReferences)
    )
  );

  const datumReferenceEdges: GraphDatumReferenceEdge[] = [];
  const componentEdges: GraphComponentEdge[] = [];

  const attachFrameReferences = (
    frameNode: GraphDatumReferenceFrameNode,
    frame: ParsedStepDatumReferenceFrame
  ): void => {
    // Sort by precedence, then by identifier so that simultaneous datums keep a
    // stable, input-independent order. A plain precedence sort would leave equal
    // precedences in whatever order the parser happened to emit them.
    const ordered = [...frame.references].sort((left, right) =>
      left.precedence !== right.precedence
        ? left.precedence - right.precedence
        : compareCodeUnits(left.datumIdentifier, right.datumIdentifier)
    );

    const precedenceCounts = new Map<number, number>();
    ordered.forEach((reference) => {
      precedenceCounts.set(
        reference.precedence,
        (precedenceCounts.get(reference.precedence) || 0) + 1
      );
    });
    let group = 0;
    let previousPrecedence: number | null = null;

    ordered.forEach((reference, position) => {
      if (reference.precedence !== previousPrecedence) {
        group++;
        previousPrecedence = reference.precedence;
      }
      const datumNode = datumNodeByIdentifier.get(reference.datumIdentifier);
      const targetNodeId = datumNode?.id ?? null;
      datumReferenceEdges.push({
        id: `datum-reference:${frameNode.id}|${reference.datumIdentifier}`,
        kind: "datum-reference",
        source: frameNode.id,
        target: targetNodeId,
        precedence: reference.precedence,
        compartmentId: reference.compartmentId || null,
        datumEntityId: reference.datumEntityId,
        datumIdentifier: reference.datumIdentifier,
        modifiers: [...(reference.modifiers || [])].sort(compareCodeUnits),
        isCommonDatum: reference.isCommonDatum === true,
        controlledTopologyNodeIds: uniqueSorted(
          (reference.topologyReferences || [])
            .filter((candidate) => candidate.resolution === "resolved" && candidate.runtimeId)
            .map((candidate) => nodeIdForTopology(candidate.runtimeId!))
        ).sort(compareCodeUnits),
      });
      componentEdges.push({
        id: `component:${frameNode.id}|${position}|${reference.datumIdentifier}`,
        kind: "component",
        source: frameNode.id,
        target: targetNodeId,
        position: position + 1,
        precedence: reference.precedence,
        precedenceGroup: group,
        isSimultaneous: (precedenceCounts.get(reference.precedence) || 0) > 1,
      });
    });
  };

  modelFrameRecords.forEach((frame, index) => {
    attachFrameReferences(modelFrameNodes[index], frame);
  });
  toleranceFrameEntries.forEach((entry) => {
    attachFrameReferences(entry.node, entry.record.datumReferenceFrame!);
  });

  /**
   * Dimensional callouts grouped by the STEP targets they control.
   *
   * An FCF and the size callout it annotates are separate STEP entities with no
   * direct link in the parse result, but they name the same controlled feature.
   * Indexing the size callouts by target therefore recovers the attachment.
   * Grouping by target rather than by position also keeps the result independent
   * of parse order.
   */
  const dimensionNodesByTarget = new Map<string, GraphDimensionNode[]>();
  dimensionEntries.forEach((entry) => {
    const targets = uniqueSorted([
      ...(entry.record.targetIds || []),
      entry.record.targetId,
    ]);
    // A dimension that names no target cannot corroborate an attachment. Indexing
    // it under a shared empty key would attach every FCF that also has no
    // targets, which is a guess rather than an association.
    if (targets.length === 0) return;
    targets.forEach((target) => {
      dimensionNodesByTarget.set(target, [
        ...(dimensionNodesByTarget.get(target) || []),
        entry.node,
      ]);
    });
  });

  const dimensionAttachmentEdges: GraphDimensionAttachmentEdge[] = [];
  geometricToleranceEntries.forEach((entry) => {
    const { node, record } = entry;

    // An explicit reference from the parser wins.
    if (node.attachedDimensionEntityId) {
      const explicit = dimensionNodeByEntityId.get(node.attachedDimensionEntityId);
      if (explicit && explicit.length === 1) {
        const [dimensionNode] = explicit;
        dimensionAttachmentEdges.push({
          id: `dimension-attachment:${node.id}|${dimensionNode.id}`,
          kind: "dimension-attachment",
          source: node.id,
          target: dimensionNode.id,
          relation: "fcf-attached-to-dimension",
          dimensionEntityId: dimensionNode.entityId,
        });
        return;
      }
    }

    // Otherwise the shared controlled feature identifies the size callout.
    const toleranceTargets = uniqueSorted([
      ...(record.targetIds || []),
      record.targetId,
    ]);
    if (toleranceTargets.length === 0) return;
    const candidates = toleranceTargets
      .flatMap((target) => dimensionNodesByTarget.get(target) || [])
      .filter((candidate) => candidate.entityId !== node.entityId);
    const distinct = new Set(candidates.map((candidate) => candidate.id));
    if (distinct.size !== 1) return;

    const [dimensionNode] = candidates;
    node.attachedDimensionEntityId = dimensionNode.entityId;
    dimensionAttachmentEdges.push({
      id: `dimension-attachment:${node.id}|${dimensionNode.id}`,
      kind: "dimension-attachment",
      source: node.id,
      target: dimensionNode.id,
      relation: "fcf-attached-to-dimension",
      dimensionEntityId: dimensionNode.entityId,
    });
  });

  const datumTargetParentEdges: GraphDatumTargetParentEdge[] = [];
  datumTargetNodes.forEach((node) => {
    if (!node.parentDatum) return;
    const parent = datumNodeByIdentifier.get(node.parentDatum);
    if (!parent) return;
    datumTargetParentEdges.push({
      id: `datum-target-parent:${node.id}|${parent.id}`,
      kind: "datum-target-parent",
      source: node.id,
      target: parent.id,
      parentDatum: node.parentDatum,
    });
  });

  /* ------------------------------- statistics ------------------------------ */

  const nodeCounts: Record<string, number> = {};
  const edgeCounts: Record<string, number> = {};
  const faceSurfaceTypeCounts: Record<string, number> = {};
  const edgeCurveTypeCounts: Record<string, number> = {};
  const adjacencyConvexityCounts: Record<string, number> = {};
  const pmiReferenceResolutionCounts: Record<string, number> = {};

  const allNodes: GraphNode[] = [
    ...faceNodes,
    ...edgeNodes,
    ...vertexNodes,
    ...datumNodes,
    ...datumTargetNodes,
    ...dimensionNodes,
    ...geometricToleranceNodes,
    ...modelFrameNodes,
    ...toleranceFrameNodes,
  ];
  allNodes.forEach((node) => bumpCounter(nodeCounts, node.kind));
  faceNodes.forEach((node) => bumpCounter(faceSurfaceTypeCounts, node.surfaceType));
  edgeNodes.forEach((node) => bumpCounter(edgeCurveTypeCounts, node.curveType));
  adjacencyEdges.forEach((edge) => bumpCounter(adjacencyConvexityCounts, edge.convexity));
  pmiTopologyEdges.forEach((edge) => bumpCounter(pmiReferenceResolutionCounts, edge.resolution));

  const allEdges: GraphEdge[] = [
    ...adjacencyEdges,
    ...incidenceEdges,
    ...pmiTopologyEdges,
    ...datumReferenceEdges,
    ...componentEdges,
    ...dimensionAttachmentEdges,
    ...datumTargetParentEdges,
  ];
  allEdges.forEach((edge) => bumpCounter(edgeCounts, edge.kind));

  const graph: GraphDocument = {
    graphVersion: GRAPH_SCHEMA_VERSION,
    source: {
      fileName: parsed.fileName,
      schema: detectSchema(parsed.rawText),
      fileSize: parsed.fileSize,
      byteLength: parsed.rawText?.length ?? 0,
      geometryTopologySource: String(occtResult?.geometryTopologySource ?? "unknown"),
      linearDeflection: round(linearDeflection),
      angularDeflection: round(angularDeflection),
      lengthUnit: "mm",
      angleUnit: "deg",
    },
    statistics: {
      nodeCounts: sortedRecord(nodeCounts),
      edgeCounts: sortedRecord(edgeCounts),
      faceSurfaceTypeCounts: sortedRecord(faceSurfaceTypeCounts),
      edgeCurveTypeCounts: sortedRecord(edgeCurveTypeCounts),
      adjacencyConvexityCounts: sortedRecord(adjacencyConvexityCounts),
      pmiReferenceResolutionCounts: sortedRecord(pmiReferenceResolutionCounts),
      nonManifoldEdgeCount,
      indeterminateConvexityCount: adjacencyConvexityCounts.indeterminate || 0,
      signedMeshVolume: round(signedVolume),
      normalOrientation,
    },
    nodes: allNodes,
    edges: allEdges,
    ...(input.generatedAt ? { generatedAt: input.generatedAt } : {}),
  };

  return {
    graph,
    deterministicJson: serializeGraphDeterministic(graph),
    summaryMarkdown: buildGraphSummary(graph),
  };
}

const buildAdjacencyEdge = (
  sharedEdgeId: string,
  sharedEdgeOrder: number,
  edgePositions: number[],
  faceAId: string,
  faceBId: string,
  faceByRuntimeId: Map<string, FaceGeometry>,
  triangles: TriangleStore,
  normalOrientation: GraphStatistics["normalOrientation"],
  nonManifold: boolean
): GraphAdjacencyEdge & { sharedEdgeId: string; sharedEdgeOrder: number } => {
  const faceA = faceByRuntimeId.get(faceAId);
  const faceB = faceByRuntimeId.get(faceBId);
  const { midpoint, tangent } = sharedEdgeFrame(edgePositions);

  const base = {
    id: `adjacency:face:${faceAId}|face:${faceBId}|edge:${sharedEdgeId}`,
    kind: "adjacency" as const,
    source: `face:${faceAId}`,
    target: `face:${faceBId}`,
    sharedEdgeIds: [sharedEdgeId],
    midpoint: roundVecOrNull(midpoint) || [0, 0, 0],
    edgeTangent: roundVecOrNull(tangent) || [0, 0, 0],
    normalSource: [
      faceA?.cylinder ? "cylinder-radial" : faceA?.areaNormal ? "tessellation" : "unavailable",
      faceB?.cylinder ? "cylinder-radial" : faceB?.areaNormal ? "tessellation" : "unavailable",
    ] as GraphFaceNode["normalSource"][],
    nonManifold,
  };

  if (!faceA || !faceB) {
    return {
      ...base,
      convexity: "indeterminate",
      dihedralAngleRad: 0,
      dihedralAngleDeg: 0,
      normalAngleRad: 0,
      normalAngleDeg: 0,
      patchNormalAngleDeg: 0,
      convexityNote: "face-geometry-unavailable",
      sharedEdgeId,
      sharedEdgeOrder,
    };
  }

  const normalA = outwardNormalFor(faceA, midpoint, normalOrientation, false);
  const normalB = outwardNormalFor(faceB, midpoint, normalOrientation, false);
  if (!normalA || !normalB) {
    return {
      ...base,
      convexity: "indeterminate",
      dihedralAngleRad: 0,
      dihedralAngleDeg: 0,
      normalAngleRad: 0,
      normalAngleDeg: 0,
      patchNormalAngleDeg: 0,
      convexityNote: "face-normal-unavailable",
      sharedEdgeId,
      sharedEdgeOrder,
    };
  }

  const patchNormalAngle = angleBetween(faceA.areaNormal || normalA, faceB.areaNormal || normalB);
  const unitA = normalizeVec(subVec(normalA, scaleVec(tangent, dotVec(normalA, tangent))));
  const unitB = normalizeVec(subVec(normalB, scaleVec(tangent, dotVec(normalB, tangent))));
  const normalAngle = angleBetween(unitA, unitB);

  const withAngles = {
    ...base,
    normalAngleRad: round(normalAngle),
    normalAngleDeg: round(toDegrees(normalAngle)),
    patchNormalAngleDeg: round(toDegrees(patchNormalAngle)),
  };

  // Flat at both ends: alpha -> 0 is two coplanar patches, alpha -> pi is a
  // smooth-surface seam where two halves of one curved face meet.
  const deviationFromFlat = Math.min(normalAngle, Math.PI - normalAngle);
  if (deviationFromFlat < GRAPH_FLAT_ANGLE_RADIANS) {
    return {
      ...withAngles,
      convexity: "flat",
      dihedralAngleRad: round(Math.PI),
      dihedralAngleDeg: 180,
      convexityNote: null,
      sharedEdgeId,
      sharedEdgeOrder,
    };
  }

  const decision = decideConvexity(midpoint, tangent, faceA, faceB, normalA, normalB, triangles);
  const materialDihedral = decision.convexity === "concave"
    ? Math.PI + normalAngle
    : Math.PI - normalAngle;

  return {
    ...withAngles,
    convexity: decision.convexity,
    dihedralAngleRad: round(materialDihedral),
    dihedralAngleDeg: round(toDegrees(materialDihedral)),
    convexityNote: decision.note,
    sharedEdgeId,
    sharedEdgeOrder,
  };
};

/**
 * Midpoint and tangent of a shared topological edge, taken from the OCCT edge
 * polyline. Both are derived from the stored vertex order, which is stable for
 * a given OCCT run, and only the probe result - not these two values - feeds
 * the convexity decision.
 */
const sharedEdgeFrame = (positions: number[]): { midpoint: Vec3; tangent: Vec3 } => {
  const pointCount = Math.floor(positions.length / 3);
  if (pointCount === 0) return { midpoint: [0, 0, 0], tangent: [1, 0, 0] };

  const start = vec(positions[0], positions[1], positions[2]);
  const last = vec(
    positions[(pointCount - 1) * 3],
    positions[(pointCount - 1) * 3 + 1],
    positions[(pointCount - 1) * 3 + 2]
  );
  const midpoint = scaleVec(addVec(start, last), 0.5);
  const rawTangent = subVec(last, start);
  const tangent = normalizeVec(rawTangent, vec(1, 0, 0));
  return { midpoint, tangent };
};

const sortedRecord = (record: Record<string, number>): Record<string, number> => {
  const sorted: Record<string, number> = {};
  Object.keys(record).sort(compareCodeUnits).forEach((key) => {
    sorted[key] = record[key];
  });
  return sorted;
};

const detectSchema = (rawText: string | undefined): string | null => {
  if (!rawText) return null;
  const header = rawText.slice(0, 4000).toUpperCase();
  if (header.includes("AP242")) return "AP242";
  if (header.includes("AP214")) return "AP214";
  if (header.includes("AP203")) return "AP203";
  if (header.includes("AUTOMOTIVE_DESIGN")) return "AP203";
  return null;
};

/* -------------------------------------------------------------------------- */
/* Serialization and summary                                                  */
/* -------------------------------------------------------------------------- */

/** Serializes the graph with fixed key order. `generatedAt` is included last. */
export function serializeGraph(graph: GraphDocument): string {
  const { generatedAt, ...rest } = graph;
  const payload = generatedAt ? { ...rest, generatedAt } : rest;
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/**
 * Serializes the graph without the traceability timestamp.
 *
 * Two runs over the same STEP file must produce byte-identical output, so this
 * is the only form that may be committed, diffed, or hashed.
 */
export function serializeGraphDeterministic(graph: GraphDocument): string {
  const { generatedAt: _generatedAt, ...rest } = graph;
  void _generatedAt;
  return `${JSON.stringify(rest, null, 2)}\n`;
}

/**
 * Human-readable companion to the JSON graph.
 *
 * Excludes `generatedAt`, so two exports of the same file produce identical
 * Markdown and the timestamp cannot hide a real change.
 */
export function buildGraphSummary(graph: GraphDocument): string {
  const lines: string[] = [];
  lines.push(`# Graph summary - ${graph.source.fileName}`);
  lines.push("");
  lines.push(`- Schema: ${graph.source.schema ?? "unknown"} (${graph.source.geometryTopologySource} topology)`);
  lines.push(`- Graph version: ${graph.graphVersion}`);
  lines.push(`- Tessellation: linear ${graph.source.linearDeflection}, angular ${graph.source.angularDeflection}`);
  lines.push(`- Units: lengths in ${graph.source.lengthUnit}, angles in ${graph.source.angleUnit}`);
  lines.push(`- Mesh winding: ${graph.statistics.normalOrientation} (signed volume ${graph.statistics.signedMeshVolume})`);
  lines.push(`- Nodes: ${graph.nodes.length}, edges: ${graph.edges.length}`);
  lines.push("");

  lines.push("## Node counts");
  lines.push("");
  lines.push("| Kind | Count |");
  lines.push("| --- | ---: |");
  Object.entries(graph.statistics.nodeCounts).forEach(([kind, count]) => {
    lines.push(`| ${kind} | ${count} |`);
  });
  lines.push("");

  lines.push("## Edge counts");
  lines.push("");
  lines.push("| Kind | Count |");
  lines.push("| --- | ---: |");
  Object.entries(graph.statistics.edgeCounts).forEach(([kind, count]) => {
    lines.push(`| ${kind} | ${count} |`);
  });
  lines.push("");

  lines.push("## Faces by surface type");
  lines.push("");
  lines.push("| Surface type | Count |");
  lines.push("| --- | ---: |");
  Object.entries(graph.statistics.faceSurfaceTypeCounts).forEach(([type, count]) => {
    lines.push(`| ${type} | ${count} |`);
  });
  lines.push("");

  lines.push("## Edges by curve type");
  lines.push("");
  lines.push("| Curve type | Count |");
  lines.push("| --- | ---: |");
  Object.entries(graph.statistics.edgeCurveTypeCounts).forEach(([type, count]) => {
    lines.push(`| ${type} | ${count} |`);
  });
  lines.push("");

  lines.push("## Adjacency convexity");
  lines.push("");
  lines.push("| Convexity | Count |");
  lines.push("| --- | ---: |");
  Object.entries(graph.statistics.adjacencyConvexityCounts).forEach(([convexity, count]) => {
    lines.push(`| ${convexity} | ${count} |`);
  });
  lines.push("");
  lines.push(`Non-manifold shared edges: ${graph.statistics.nonManifoldEdgeCount}`);
  lines.push(`Indeterminate convexity decisions: ${graph.statistics.indeterminateConvexityCount}`);
  lines.push("");

  lines.push("## PMI to topology resolution");
  lines.push("");
  lines.push("| Resolution | Count |");
  lines.push("| --- | ---: |");
  Object.entries(graph.statistics.pmiReferenceResolutionCounts).forEach(([resolution, count]) => {
    lines.push(`| ${resolution} | ${count} |`);
  });
  lines.push("");

  const unresolved = graph.nodes
    .filter((node): node is GraphDimensionNode | GraphGeometricToleranceNode | GraphDatumNode
      | GraphDatumTargetNode | GraphDatumReferenceFrameNode =>
      "unresolvedTargetStepEntityIds" in node)
    .filter((node) => node.unresolvedTargetStepEntityIds.length > 0);
  lines.push(`## Unresolved PMI targets (${unresolved.length} nodes)`);
  lines.push("");
  if (unresolved.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| Node | Unresolved STEP targets |");
    lines.push("| --- | --- |");
    unresolved.slice(0, 40).forEach((node) => {
      lines.push(`| ${node.label} | ${node.unresolvedTargetStepEntityIds.join(", ")} |`);
    });
    if (unresolved.length > 40) lines.push(`| ... | ${unresolved.length - 40} more nodes |`);
  }
  lines.push("");

  const ambiguous = graph.nodes
    .filter((node): node is GraphDimensionNode | GraphGeometricToleranceNode | GraphDatumNode
      | GraphDatumTargetNode | GraphDatumReferenceFrameNode =>
      "ambiguousTargetStepEntityIds" in node)
    .filter((node) => node.ambiguousTargetStepEntityIds.length > 0);
  lines.push(`## Ambiguous PMI targets (${ambiguous.length} nodes)`);
  lines.push("");
  if (ambiguous.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| Node | Ambiguous STEP targets |");
    lines.push("| --- | --- |");
    ambiguous.slice(0, 40).forEach((node) => {
      lines.push(`| ${node.label} | ${node.ambiguousTargetStepEntityIds.join(", ")} |`);
    });
    if (ambiguous.length > 40) lines.push(`| ... | ${ambiguous.length - 40} more nodes |`);
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
}

export { toDegrees as graphRadiansToDegrees, toRadians as graphDegreesToRadians };

/**
 * Stages the emscripten OCCT wrapper so that Node can load it.
 *
 * The wrapper is a UMD bundle. Under this package's `"type": "module"` a `.js`
 * sibling is loaded as an ES module, so the CommonJS tail that exposes the
 * factory never runs and the dynamic import in `occtLoader` finds no factory. A
 * `.cjs` copy resolves as CommonJS, and because its `.wasm` sibling is copied
 * alongside it the loader's relative `locateFile` lookup keeps working.
 *
 * Returns a filesystem path suitable for `nativeWrapperUrl`.
 */
export const stageOcctWrapperForNode = (sourcePath: string): string => {
  if (sourcePath.toLowerCase().endsWith(".cjs")) return sourcePath;

  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), "occt-graph-"));
  const stagedModule = path.join(stageDir, "occt-import-js.cjs");
  const stagedWasm = path.join(stageDir, "occt-import-js.wasm");
  fs.copyFileSync(sourcePath, stagedModule);

  const sourceWasm = [
    path.join(path.dirname(sourcePath), "occt-import-js.wasm"),
    sourcePath.replace(/\.js$/i, ".wasm"),
  ].find((candidate) => fs.existsSync(candidate));
  if (!sourceWasm) {
    throw new Error(`No OCCT WebAssembly asset found beside ${sourcePath}`);
  }
  fs.copyFileSync(sourceWasm, stagedWasm);
  return stagedModule;
};

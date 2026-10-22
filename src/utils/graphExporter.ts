/**
 * Graph exporter — serializes a loaded STEP part into the versioned JSON graph
 * defined by docs/EXPORT_GRAPH_PLAN.md (graphVersion 1).
 *
 * Inputs mirror the existing pipeline (App.tsx): parsed STEP semantics + OCCT
 * topology result + the STEP-to-BRep face mapping. The exporter consumes the
 * same modules as the viewer and writes nothing into the render/parse pipeline.
 *
 * Determinism guarantees:
 * - every scalar passes through `canonicalNumber`;
 * - nodes sorted by (nodeType, id), edges by (nodeType, sourceId, targetId,
 *   precedence) before return;
 * - topology-corresponding nodes carry both the runtime id and the stable OCCT
 *   signature, so identity survives retessellation/reload;
 * - no timestamp inside the graph.
 */
import type { CylinderFit, Vec3 } from "./cylinderFit";
import {
  axisFoot,
  fitCylinder,
  vec3Cross,
  vec3Dot,
  vec3Length,
  vec3Normalize,
  vec3Scale,
  vec3Sub,
} from "./cylinderFit";
import {
  computeAdjacencyDihedral,
  computeAreaWeightedNormal,
  computeFaceConvexity,
  edgeMidpoint,
  faceSize,
  outwardNormalAt,
  vertexCentroid,
  type ConvexityLabel,
  type DihedralResult,
  type FaceDescriptor,
} from "./convexity";
import type { StepParseResult } from "./stepParser";
import type { PmiTopologyReference } from "./pmiTopologyReferences";
import { autoGenerateFaceMapping } from "./geometryClassifier";

export interface GraphNode {
  nodeType: string;
  id: string;
  [key: string]: unknown;
}

export interface GraphEdge {
  nodeType: string;
  id: string;
  sourceId: string;
  targetId: string;
  [key: string]: unknown;
}

export interface ExportGraphResult {
  graphVersion: 1;
  source: {
    fileName: string;
    fileSize: number;
    schema: string;
    topologySource: string;
    /** True when this graph's geometric attributes (analytic surface
     *  parameters, convexity, adjacency dihedral) were computed inside the
     *  OCCT kernel rather than by the TypeScript tessellation fallback. */
    kernelGeometry: boolean;
    stableHash: string;
    nodeCount: number;
    edgeCount: number;
    estimatedTokens: number;
  };
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphExporterTopology {
  meshes?: any[];
  faces?: any[];
  edges?: any[];
  lines?: any[];
  vertices?: any[];
  loops?: any[];
}

export interface GraphExporterInput {
  parsed: StepParseResult;
  occtResult: GraphExporterTopology;
  faceMapping?: Record<string, string>;
  partMetadata?: {
    material?: string;
    schema?: string;
  };
}

const canonicalNumber = (value: unknown, digits = 6): number | undefined => {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return undefined;
  const rounded = Number(number.toPrecision(digits));
  if (Object.is(rounded, -0)) return 0;
  return rounded;
};

const uniqueStrings = (values: string[]) =>
  values.filter((value, index, all) => all.indexOf(value) === index).sort();

const toCanonicalPoint = (v: Vec3) => ({
  x: canonicalNumber(v.x),
  y: canonicalNumber(v.y),
  z: canonicalNumber(v.z),
});

/* ------------------------------------------------------------------ */
/* Kernel graph attributes (OCCT-calculated geometry).                 */
/*                                                                    */
/* The OCCT wrapper (`native-topology-export.cpp`) now computes the    */
/* exact analytic surface parameters, the outward normals at edge      */
/* midpoints, the face-level convexity, and the per-contact dihedral   */
/* classification inside the OCCT kernel. These helpers parse that     */
/* payload. The fitted/TS fallbacks below remain for tessellation      */
/* reconstruction mode and for old wrappers without the attributes.    */
/* ------------------------------------------------------------------ */

interface KernelPlane { normal: Vec3; point: Vec3; }
interface KernelCylinder { axis: Vec3; center: Vec3; radius: number; }
interface KernelCone { axis: Vec3; apex: Vec3; semiAngleDeg: number; radius?: number; }
interface KernelSphere { center: Vec3; radius: number; }
interface KernelTorus { center: Vec3; axis: Vec3; majorRadius: number; minorRadius: number; }

interface KernelAnalytic {
  plane?: KernelPlane;
  cylinder?: KernelCylinder;
  cone?: KernelCone;
  sphere?: KernelSphere;
  torus?: KernelTorus;
}

interface KernelContact {
  faceAId: string;
  faceBId: string;
  convexity: "convex" | "concave";
  dihedralDeg: number;
}

/** Reads a 3-component vector from a plain array or a `{x,y,z}` object. */
const readVec3 = (values: unknown): Vec3 | undefined => {
  if (values && typeof values === "object" && !Array.isArray(values)) {
    const candidate = values as Record<string, unknown>;
    if (typeof candidate.x === "number" && typeof candidate.y === "number" && typeof candidate.z === "number") {
      return { x: candidate.x, y: candidate.y, z: candidate.z };
    }
  }
  if (!Array.isArray(values) || values.length < 3) return undefined;
  const x = Number(values[0]);
  const y = Number(values[1]);
  const z = Number(values[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return undefined;
  return { x, y, z };
};

const normalizeUnit = (values: Vec3 | undefined): Vec3 | undefined => {
  if (!values) return undefined;
  const length = vec3Length(values);
  if (!Number.isFinite(length) || length <= 1e-12) return undefined;
  return { x: values.x / length, y: values.y / length, z: values.z / length };
};

const normalizeConvexityLabel = (value: unknown): ConvexityLabel | undefined => {
  const text = String(value || "");
  if (text === "convex" || text === "concave" || text === "unknown") return text;
  return undefined;
};

/**
 * Parses the kernel `mesh.analytic` payload (exact OCCT surface primitive
 * parameters) into typed vectors. Returns undefined when the mesh carries no
 * kernel analytic data (tessellation fallback or old wrapper).
 */
const parseKernelAnalytic = (mesh: any): KernelAnalytic | undefined => {
  const raw = mesh?.analytic;
  if (!raw || typeof raw !== "object") return undefined;
  const analytic: KernelAnalytic = {};
  if (raw.plane) {
    const normal = normalizeUnit(readVec3(raw.plane.normal));
    const point = readVec3(raw.plane.point);
    if (normal && point) analytic.plane = { normal, point };
  } else if (raw.cylinder) {
    const axis = normalizeUnit(readVec3(raw.cylinder.axis));
    const center = readVec3(raw.cylinder.center);
    const radius = Number(raw.cylinder.radius);
    if (axis && center && Number.isFinite(radius) && radius > 0) {
      analytic.cylinder = { axis, center, radius };
    }
  } else if (raw.cone) {
    const axis = normalizeUnit(readVec3(raw.cone.axis));
    const apex = readVec3(raw.cone.apex);
    const semiAngleDeg = Number(raw.cone.semiAngleDeg);
    if (axis && apex && Number.isFinite(semiAngleDeg)) {
      const radius = Number(raw.cone.radius);
      analytic.cone = {
        axis,
        apex,
        semiAngleDeg,
        ...(Number.isFinite(radius) && radius > 0 ? { radius } : {}),
      };
    }
  } else if (raw.sphere) {
    const center = readVec3(raw.sphere.center);
    const radius = Number(raw.sphere.radius);
    if (center && Number.isFinite(radius) && radius > 0) {
      analytic.sphere = { center, radius };
    }
  } else if (raw.torus) {
    const center = readVec3(raw.torus.center);
    const axis = normalizeUnit(readVec3(raw.torus.axis));
    const majorRadius = Number(raw.torus.majorRadius);
    const minorRadius = Number(raw.torus.minorRadius);
    if (center && axis && Number.isFinite(majorRadius) && majorRadius > 0 &&
        Number.isFinite(minorRadius) && minorRadius > 0) {
      analytic.torus = { center, axis, majorRadius, minorRadius };
    }
  }
  return Object.keys(analytic).length > 0 ? analytic : undefined;
};

const normalizeSurfaceType = (surfaceType: unknown): string => {
  const type = String(surfaceType || "").toLowerCase();
  if (/plane/i.test(type)) return "plane";
  if (/cylinder/i.test(type)) return "cylinder";
  if (/cone/i.test(type)) return "cone";
  if (/sphere/i.test(type)) return "sphere";
  if (/torus/i.test(type)) return "torus";
  if (/b.?spline|bezier/i.test(type)) return "bspline";
  if (!type || type === "other") return "curved";
  return "curved";
};

const isCoherentlyPlanar = (
  positions: ArrayLike<number>,
  normals: ArrayLike<number> | undefined,
  reference: Vec3
): boolean => {
  if (!normals) return false;
  const vertexCount = Math.floor(Math.min(positions.length, normals.length) / 3);
  if (vertexCount === 0) return false;
  const step = Math.max(1, Math.floor(vertexCount / 64));
  let weight = 0;
  let alignment = 0;
  for (let i = 0; i < vertexCount; i += step) {
    const length = vec3Length({
      x: normals[i * 3],
      y: normals[i * 3 + 1],
      z: normals[i * 3 + 2],
    });
    if (length <= 1e-9) continue;
    alignment += Math.abs(vec3Dot(reference, {
      x: normals[i * 3] / length,
      y: normals[i * 3 + 1] / length,
      z: normals[i * 3 + 2] / length,
    }));
    weight++;
  }
  return weight > 0 && alignment / weight > 0.92;
};

const triangleAreaTotal = (positions: ArrayLike<number>, indices?: ArrayLike<number>): number => {
  const vertexCount = Math.floor(positions.length / 3);
  if (vertexCount < 3) return 0;
  const triCount = indices && indices.length > 0
    ? Math.floor(indices.length / 3)
    : Math.floor(vertexCount / 3);
  let total = 0;
  for (let t = 0; t < triCount; t++) {
    const ia = indices ? indices[t * 3] : t * 3;
    const ib = indices ? indices[t * 3 + 1] : t * 3 + 1;
    const ic = indices ? indices[t * 3 + 2] : t * 3 + 2;
    const ux = positions[ib * 3] - positions[ia * 3];
    const uy = positions[ib * 3 + 1] - positions[ia * 3 + 1];
    const uz = positions[ib * 3 + 2] - positions[ia * 3 + 2];
    const vx = positions[ic * 3] - positions[ia * 3];
    const vy = positions[ic * 3 + 1] - positions[ia * 3 + 1];
    const vz = positions[ic * 3 + 2] - positions[ia * 3 + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    total += 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
  }
  return total;
};

const axialExtentOf = (positions: ArrayLike<number>, fit: CylinderFit): number | undefined => {
  const vertexCount = Math.floor(positions.length / 3);
  if (vertexCount === 0) return undefined;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < vertexCount; i++) {
    const t = vec3Dot(vec3Sub({ x: positions[i * 3], y: positions[i * 3 + 1], z: positions[i * 3 + 2] }, fit.center), fit.axis);
    min = Math.min(min, t);
    max = Math.max(max, t);
  }
  const length = canonicalNumber(max - min);
  return length !== undefined && length > 0 ? length : undefined;
};

const axisLineDistance = (c1: Vec3, a1: Vec3, c2: Vec3, a2: Vec3): number => {
  const w = vec3Sub(c2, c1);
  const b = vec3Cross(a1, a2);
  const bLength = vec3Length(b);
  if (bLength > 1e-9) {
    return Math.abs(vec3Dot(w, b)) / bLength;
  }
  const projected = vec3Scale(a1, vec3Dot(w, a1));
  return vec3Length(vec3Sub(w, projected));
};

const detectEdgeCurveType = (positions: ArrayLike<number>): string => {
  const vertexCount = Math.floor(positions.length / 3);
  if (vertexCount < 4) return "line";
  const mid = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < vertexCount; i++) {
    mid.x += positions[i * 3];
    mid.y += positions[i * 3 + 1];
    mid.z += positions[i * 3 + 2];
  }
  mid.x /= vertexCount;
  mid.y /= vertexCount;
  mid.z /= vertexCount;

  let sumRadius = 0;
  for (let i = 0; i < vertexCount; i++) {
    sumRadius += vec3Length(vec3Sub(mid, { x: positions[i * 3], y: positions[i * 3 + 1], z: positions[i * 3 + 2] }));
  }
  const meanRadius = sumRadius / vertexCount;
  if (meanRadius <= 1e-9) return "line";
  let maxDeviation = 0;
  for (let i = 0; i < vertexCount; i++) {
    const radius = vec3Length(vec3Sub(mid, { x: positions[i * 3], y: positions[i * 3 + 1], z: positions[i * 3 + 2] }));
    maxDeviation = Math.max(maxDeviation, Math.abs(radius - meanRadius));
  }
  return maxDeviation / meanRadius < 0.05 ? "circle" : "line";
};

const resolveEdgeCurveType = (edge: any): string => {
  const curveType = edge?.curveType;
  if (typeof curveType === "string" && curveType.length > 0 && curveType !== "other") {
    if (/line/i.test(curveType)) return "line";
    if (/circle/i.test(curveType)) return "circle";
    if (/ellipse/i.test(curveType)) return "ellipse";
    return "other";
  }
  return edge?.positions ? detectEdgeCurveType(edge.positions) : "other";
};

export interface FaceBuildOutput {
  nodes: GraphNode[];
  descriptors: Map<string, FaceDescriptor>;
}

export function buildFaceNodes(
  meshes: any[],
  faceMapping: Record<string, string> = {}
): FaceBuildOutput {
  const nodes: GraphNode[] = [];
  const descriptors = new Map<string, FaceDescriptor>();

  const reverseMapping = new Map<string, string[]>();
  Object.entries(faceMapping).forEach(([stepId, faceId]) => {
    const existing = reverseMapping.get(faceId) || [];
    existing.push(stepId);
    reverseMapping.set(faceId, existing);
  });

  meshes.forEach((mesh, index) => {
    const id = `BRepFace-${index}`;
    const positions = mesh.positions || [];
    const indices = mesh.indices;
    const normals = mesh.normals;
    const centroid = vertexCentroid(positions);
    const size = faceSize(positions);
    const kernelAnalytic = parseKernelAnalytic(mesh);
    const kernelConvexity = normalizeConvexityLabel(mesh.kernelConvexity);
    let surfaceType = normalizeSurfaceType(mesh.surfaceType);
    let constantNormal: Vec3 | undefined;
    let cylinderFit: CylinderFit | undefined;
    let convexity: ConvexityLabel | undefined;
    const geometrySource: "occt" | "ts" = kernelAnalytic ? "occt" : "ts";

    if (kernelAnalytic?.plane) {
      // Exact OCCT plane: normal + point from the kernel surface primitive.
      surfaceType = "plane";
      constantNormal = kernelAnalytic.plane.normal;
    } else if (kernelAnalytic?.cylinder) {
      // Exact OCCT cylinder: axis/center/radius from `gp_Cyl`.
      surfaceType = "cylinder";
      cylinderFit = {
        axis: kernelAnalytic.cylinder.axis,
        center: kernelAnalytic.cylinder.center,
        radius: kernelAnalytic.cylinder.radius,
        maxDeviation: 0,
        relativeDeviation: 0,
        valid: true,
      };
      convexity = kernelConvexity ?? computeFaceConvexity({ positions, normals, fit: cylinderFit });
    } else if (kernelAnalytic?.cone || kernelAnalytic?.sphere || kernelAnalytic?.torus) {
      // Exact OCCT analytic surfaces that the tessellation fallback could not
      // classify; the kernel also supplies the face-level convexity.
      surfaceType = kernelAnalytic.cone ? "cone"
        : kernelAnalytic.sphere ? "sphere"
          : "torus";
      convexity = kernelConvexity;
    } else if (surfaceType === "plane") {
      constantNormal = computeAreaWeightedNormal(positions, indices);
    } else if (surfaceType === "cylinder") {
      cylinderFit = fitCylinder({ positions, indices, normals });
      if (cylinderFit) convexity = computeFaceConvexity({ positions, normals, fit: cylinderFit });
    } else {
      // Auto-classify: plane if normals are coherent, cylinder if the fit is valid.
      const areaNormal = computeAreaWeightedNormal(positions, indices);
      const planar = areaNormal ? isCoherentlyPlanar(positions, normals, areaNormal) : false;
      if (planar) {
        surfaceType = "plane";
        constantNormal = areaNormal;
      } else {
        const fit = fitCylinder({ positions, indices, normals });
        if (fit) {
          surfaceType = "cylinder";
          cylinderFit = fit;
          convexity = computeFaceConvexity({ positions, normals, fit });
        } else {
          surfaceType = "curved";
        }
      }
    }

    const analytic: Record<string, unknown> | undefined =
      kernelAnalytic?.plane
        ? { plane: { normal: toCanonicalPoint(constantNormal!), point: toCanonicalPoint(kernelAnalytic.plane.point) } }
        : kernelAnalytic?.cylinder && cylinderFit
          ? { cylinder: {
              axis: toCanonicalPoint(cylinderFit.axis),
              center: toCanonicalPoint(cylinderFit.center),
              radius: canonicalNumber(cylinderFit.radius),
              lengthMm: axialExtentOf(positions, cylinderFit),
            } }
          : kernelAnalytic?.cone
            ? { cone: {
                axis: toCanonicalPoint(kernelAnalytic.cone.axis),
                apex: toCanonicalPoint(kernelAnalytic.cone.apex),
                semiAngleDeg: canonicalNumber(kernelAnalytic.cone.semiAngleDeg),
                ...(kernelAnalytic.cone.radius !== undefined
                  ? { radius: canonicalNumber(kernelAnalytic.cone.radius) }
                  : {}),
              } }
            : kernelAnalytic?.sphere
              ? { sphere: { center: toCanonicalPoint(kernelAnalytic.sphere.center), radius: canonicalNumber(kernelAnalytic.sphere.radius) } }
              : kernelAnalytic?.torus
                ? { torus: {
                    center: toCanonicalPoint(kernelAnalytic.torus.center),
                    axis: toCanonicalPoint(kernelAnalytic.torus.axis),
                    majorRadius: canonicalNumber(kernelAnalytic.torus.majorRadius),
                    minorRadius: canonicalNumber(kernelAnalytic.torus.minorRadius),
                  } }
                : surfaceType === "plane" && constantNormal
                  ? { plane: {
                      normal: toCanonicalPoint(constantNormal),
                      point: toCanonicalPoint(mesh.kernelCentroidPoint ? readVec3(mesh.kernelCentroidPoint)! : centroid),
                    } }
                  : surfaceType === "cylinder" && cylinderFit
                    ? { cylinder: {
                        axis: toCanonicalPoint(cylinderFit.axis),
                        center: toCanonicalPoint(cylinderFit.center),
                        radius: canonicalNumber(cylinderFit.radius),
                        lengthMm: axialExtentOf(positions, cylinderFit),
                      } }
                    : undefined;

    const stepped = reverseMapping.get(id);
    const descriptor: FaceDescriptor = {
      surfaceType,
      positions,
      indices,
      normals,
      centroid,
      size,
      ...(constantNormal ? { constantNormal } : {}),
      ...(cylinderFit ? { cylinder: cylinderFit } : {}),
      ...(convexity ? { convexity } : {}),
    };
    descriptors.set(id, descriptor);

    const stableId = compactStableId(mesh.topologySignature);
    const node: GraphNode = {
      nodeType: "face",
      id,
      surfaceType,
      areaMm2: canonicalNumber(
        typeof mesh.nativeArea === "number" ? mesh.nativeArea : triangleAreaTotal(positions, indices)
      ),
      ...(convexity ? { convexity } : {}),
      ...(analytic ? { analytic } : {}),
      ...(geometrySource === "occt" ? { geometrySource } : {}),
      ...(stableId ? { stableId } : {}),
      ...(stepped ? { stepped: stepped[0] } : {}),
    };
    nodes.push(node);
  });

  return { nodes, descriptors };
}

export function buildAdjacencyEdges(
  edges: any[],
  descriptors: Map<string, FaceDescriptor>
): GraphEdge[] {
  const result: GraphEdge[] = [];
  edges.forEach((edge, index) => {
    if (!edge?.positions) return;
    const rawFaceIds = Array.isArray(edge.parentFaceIds) && edge.parentFaceIds.length > 0
      ? edge.parentFaceIds
      : Array.isArray(edge.parentFaceIndices)
        ? edge.parentFaceIndices.map((faceIndex: unknown) => `BRepFace-${faceIndex}`)
        : [];
    const faceIds = uniqueStrings(rawFaceIds.map(String));
    if (faceIds.length < 2) return;

    const midpoint = readVec3(edge.midpoint) || edgeMidpoint(edge.positions);
    const edgeType = resolveEdgeCurveType(edge);
    const sharedEdgeId = edge.id || edge.name || `BRepEdge-${index}`;
    const sharedEdgeStableId = edge.topologySignature;

    const kernelContacts = Array.isArray(edge.contacts) ? (edge.contacts as KernelContact[]) : [];
    const contactByPair = new Map<string, KernelContact>();
    kernelContacts.forEach((contact) => {
      contactByPair.set(`${contact.faceAId}|${contact.faceBId}`, contact);
      contactByPair.set(`${contact.faceBId}|${contact.faceAId}`, contact);
    });

    for (let i = 0; i < faceIds.length; i++) {
      for (let j = i + 1; j < faceIds.length; j++) {
        const a = faceIds[i];
        const b = faceIds[j];
        const faceA = descriptors.get(a);
        const faceB = descriptors.get(b);
        const kernelContact = contactByPair.get(`${a}|${b}`);
        // The OCCT kernel pre-classified every incident-face pair (exact
        // normals at the exact edge midpoint and an in-kernel interior
        // probe); use that result directly and keep the TS math only as the
        // tessellation-fallback path.
        const dihedral: DihedralResult = kernelContact
          ? {
              convexity: kernelContact.convexity === "convex" ? "convex" : "concave",
              dihedralDeg: kernelContact.dihedralDeg,
            }
          : faceA && faceB
            ? computeDihedralSafe(faceA, faceB, midpoint)
            : { convexity: "unknown" };

        result.push({
          nodeType: "adjacency",
          id: `adj-${a}-${b}${j === i + 1 && faceIds.length === 2 ? "" : `-${index}`}`,
          sourceId: a,
          targetId: b,
          edgeType,
          convexity: dihedral.convexity,
          ...(dihedral.dihedralDeg !== undefined
            ? { dihedralDeg: canonicalNumber(dihedral.dihedralDeg) }
            : {}),
          sharedEdgeId,
          ...(compactStableId(sharedEdgeStableId) ? { sharedEdgeStableId: compactStableId(sharedEdgeStableId) } : {}),
          ...(kernelContact ? { geometrySource: "occt" } : faceA && faceB ? { geometrySource: "ts" } : {}),
        });
      }
    }
  });
  return result;
}

const computeDihedralSafe = (
  faceA: FaceDescriptor,
  faceB: FaceDescriptor,
  m: Vec3
): DihedralResult => {
  const n1 = outwardNormalAt(faceA, m);
  const n2 = outwardNormalAt(faceB, m);
  const face1CentroidOutward = outwardNormalAt(faceA, faceA.centroid);
  if (!n1 || !n2 || !face1CentroidOutward) return { convexity: "unknown" };
  return computeAdjacencyDihedral({
    n1,
    n2,
    m,
    face1Centroid: faceA.centroid,
    face1OutwardNormal: face1CentroidOutward,
    face1Size: faceA.size,
  });
};

export interface HoleFeatureCandidate {
  id: string;
  descriptor: FaceDescriptor;
}

export function buildFeatureNodes(
  descriptors: Map<string, FaceDescriptor>
): { nodes: GraphNode[]; featureCounts: Record<string, number>; memberEdges: GraphEdge[] } {
  const cylinders: HoleFeatureCandidate[] = [];
  descriptors.forEach((descriptor, id) => {
    if (
      descriptor.surfaceType === "cylinder"
      && descriptor.convexity === "concave"
      && descriptor.cylinder
    ) {
      cylinders.push({ id, descriptor });
    }
  });

  const clusters: HoleFeatureCandidate[][] = [];
  const used = new Set<string>();
  for (const candidate of cylinders) {
    if (used.has(candidate.id)) continue;
    const cluster = [candidate];
    used.add(candidate.id);
    const fit = candidate.descriptor.cylinder!;
    for (const other of cylinders) {
      if (used.has(other.id)) continue;
      const otherFit = other.descriptor.cylinder!;
      if (Math.abs(vec3Dot(fit.axis, otherFit.axis)) < 0.98) continue;
      const tolerance = Math.max(fit.radius, otherFit.radius) * 0.2 + 1e-6;
      if (axisLineDistance(fit.center, fit.axis, otherFit.center, otherFit.axis) <= tolerance) {
        cluster.push(other);
        used.add(other.id);
      }
    }
    clusters.push(cluster);
  }

  const nodes: GraphNode[] = [];
  const memberEdges: GraphEdge[] = [];
  const featureCounts: Record<string, number> = {};

  clusters.forEach((cluster, index) => {
    cluster.sort((a, b) => a.descriptor.cylinder!.radius - b.descriptor.cylinder!.radius);
    const memberFaces = cluster.map((c) => c.id).sort();
    const axis = cluster[0].descriptor.cylinder!.axis;
    const center = cluster[0].descriptor.cylinder!.center;

    const radii = cluster.map((c) => c.descriptor.cylinder!.radius);
    const distinctRadiusCount = uniqueStrings(radii.map((r) => canonicalNumber(r)?.toFixed(4) || "")).length;
    const minRadius = Math.min(...radii);
    const maxRadius = Math.max(...radii);

    let depth: number | undefined;
    let maxExtent = -Infinity;
    cluster.forEach((candidate) => {
      const extent = axialExtentOf(candidate.descriptor.positions, candidate.descriptor.cylinder!);
      if (extent !== undefined) maxExtent = Math.max(maxExtent, extent);
    });
    if (Number.isFinite(maxExtent)) depth = canonicalNumber(maxExtent);

    const kind = distinctRadiusCount >= 2 ? "counterbore" : "hole";
    featureCounts[kind] = (featureCounts[kind] || 0) + 1;

    const id = `feat-${index + 1}`;
    nodes.push({
      nodeType: "feature",
      id,
      kind,
      provenance: "geometry",
      axis: {
        x: canonicalNumber(axis.x),
        y: canonicalNumber(axis.y),
        z: canonicalNumber(axis.z),
      },
      center: {
        x: canonicalNumber(center.x),
        y: canonicalNumber(center.y),
        z: canonicalNumber(center.z),
      },
      ...(kind === "counterbore"
        ? {
            pilotDiameter: canonicalNumber(minRadius * 2),
            counterboreDiameter: canonicalNumber(maxRadius * 2),
          }
        : { diameter: canonicalNumber(minRadius * 2) }),
      ...(depth !== undefined ? { depth } : {}),
      memberFaces,
    });
    memberFaces.forEach((faceId) => {
      memberEdges.push({
        nodeType: "memberFace",
        id: `member-${id}-${faceId}`,
        sourceId: id,
        targetId: faceId,
      });
    });
  });

  return { nodes, featureCounts, memberEdges };
}

/* ------------------------------------------------------------------ */
/* PMI serialization                                                   */
/* ------------------------------------------------------------------ */

const normalizeStepEntityId = (entityId: string) => {
  const trimmed = String(entityId || "").trim();
  if (!trimmed) return "";
  return /^\d+$/.test(trimmed) ? `#${trimmed}` : trimmed;
};

const emitReferenceEdges = (
  edges: GraphEdge[],
  edgeType: "appliesTo" | "datumOf",
  sourceId: string,
  references: PmiTopologyReference[] | undefined
) => {
  const seen = new Set<string>();
  (references || []).forEach((reference, index) => {
    const target = reference.resolution === "resolved" && reference.runtimeId
      ? reference.runtimeId
      : normalizeStepEntityId(reference.stepEntityId);
    if (!target) return;
    const key = `${target}|${reference.resolution}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({
      nodeType: edgeType,
      id: `${edgeType}-${sourceId}-${target}-${index}`,
      sourceId,
      targetId: target,
      resolution: reference.resolution,
      ...(reference.resolutionReason ? { resolutionReason: reference.resolutionReason } : {}),
      ...(reference.resolution === "ambiguous" && reference.candidateRuntimeIds
        ? { candidateRuntimeIds: reference.candidateRuntimeIds }
        : {}),
    });
  });
};

const datumFeatureType = (datum: StepParseResult["datums"][number] | undefined): string => {
  if (!datum) return "other";
  if (datum.derivedDatum === "medianPlane") return "median_plane";
  if (datum.derivedDatum === "axis") return "cylinder_axis";
  if (datum.derivedDatum === "multiface") return "multiface";
  if (/cyl/i.test(datum.type)) return "cylinder_axis";
  if (/plane/i.test(datum.type)) return "plane";
  if (/point/i.test(datum.type)) return "point";
  if (/axis/i.test(datum.type)) return "cylinder_axis";
  return "other";
};

const constrainsDOFOf = (featureType: string): number | undefined => {
  switch (featureType) {
    case "plane": return 3;
    case "cylinder_axis": return 2;
    case "axis": return 2;
    case "median_plane": return 2;
    case "point": return 1;
    default: return undefined;
  }
};

const datumReferenceModifier = (modifiers: string[] | undefined): string => {
  const joined = (modifiers || []).join(" ").toUpperCase();
  if (/MAXIMUM MATERIAL/.test(joined)) return "MMB";
  if (/LEAST MATERIAL/.test(joined)) return "LMB";
  if (/REGARDLESS/.test(joined)) return "RMB";
  return "RMB";
};

const materialConditionOf = (modifiers: string[] | undefined): string | undefined => {
  const joined = (modifiers || []).join(" ");
  if (/MAXIMUM MATERIAL/.test(joined)) return "MMC";
  if (/LEAST MATERIAL/.test(joined)) return "LMC";
  if (/REGARDLESS/.test(joined)) return "RFS";
  return undefined;
};

const zoneShapeOf = (tolerance: StepParseResult["tolerances"][number]): string => {
  if (/spherical/i.test(tolerance.toleranceZoneForm || "")) return "spherical";
  if (/profile/i.test(tolerance.toleranceZoneForm || "")) return "profile";
  if (tolerance.toleranceZoneDiameter || /cylindrical|circular/i.test(tolerance.toleranceZoneForm || "")) {
    return "cylindrical";
  }
  return "two_parallel_planes";
};

const isFormCategory = (tolerance: StepParseResult["tolerances"][number]): boolean =>
  tolerance.category === "Form";

export function buildPmiNodes(parsed: StepParseResult): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const usedDatumIds = new Map<string, number>();

  const datumNodeIdFor = (identifier: string): string => {
    const base = `d-${identifier}`;
    const count = usedDatumIds.get(base) || 0;
    usedDatumIds.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };

  const datumNodesByIdentifier = new Map<string, string>();
  parsed.datums.forEach((datum) => {
    const datumType = datumFeatureType(datum);
    const nodeId = datumNodeIdFor(datum.identifier);
    datumNodesByIdentifier.set(datum.identifier, nodeId);
    nodes.push({
      nodeType: "datum",
      id: nodeId,
      identifier: datum.identifier,
      entityId: normalizeStepEntityId(datum.entityId),
      datumType,
    });
    emitReferenceEdges(edges, "datumOf", nodeId, datum.topologyReferences);
  });

  const frameNodeIdByEntityId = new Map<string, string>();
  parsed.datumReferenceFrames.forEach((frame, frameIndex) => {
    const frameNodeId = `drf-${frameIndex + 1}`;
    frameNodeIdByEntityId.set(frame.entityId, frameNodeId);
    const constraints = frame.references.map((reference) => {
      const datum = parsed.datums.find((candidate) => candidate.identifier === reference.datumIdentifier);
      return constrainsDOFOf(datumFeatureType(datum));
    }).filter((value): value is number => value !== undefined);

    nodes.push({
      nodeType: "datumReferenceFrame",
      id: frameNodeId,
      entityId: normalizeStepEntityId(frame.entityId),
      label: frame.label,
      ...(constraints.length > 0 ? { constraints } : {}),
    });

    // Group references by precedence so common datums (A-B) collapse into one node.
    const byPrecedence = new Map<number, typeof frame.references>();
    frame.references.forEach((reference) => {
      const group = byPrecedence.get(reference.precedence) || [];
      group.push(reference);
      byPrecedence.set(reference.precedence, group);
    });

    [...byPrecedence.entries()].sort(([a], [b]) => a - b).forEach(([precedence, references]) => {
      const members = references
        .map((reference) => datumNodesByIdentifier.get(reference.datumIdentifier))
        .filter((id): id is string => !!id);
      if (members.length === 0) return;
      const common = members.length > 1 || references.some((reference) => reference.isCommonDatum);
      const targetId = common ? `cd-${members.join("-")}-${frameNodeId}` : members[0];
      if (common) {
        nodes.push({
          nodeType: "commonDatum",
          id: targetId,
          label: references.map((reference) => reference.datumIdentifier).sort().join("-"),
          members,
        });
      }
      const modifier = datumReferenceModifier(references[0].modifiers);
      const constrainsDOF = references
        .map((reference) => {
          const datum = parsed.datums.find((candidate) => candidate.identifier === reference.datumIdentifier);
          return constrainsDOFOf(datumFeatureType(datum));
        })
        .filter((value): value is number => value !== undefined);
      edges.push({
        nodeType: "drfReferences",
        id: `drfref-${frameNodeId}-${precedence}`,
        sourceId: frameNodeId,
        targetId,
        precedence,
        modifier,
        ...(constrainsDOF.length > 0 ? { constrainsDOF } : {}),
      });
    });
  });

  parsed.tolerances.forEach((tolerance, toleranceIndex) => {
    const seenApplies = new Set<string>();
    const dimensional = !!tolerance.dimensionKind;
    const valueNodeId = dimensional ? `dim-${toleranceIndex + 1}` : `tv-${toleranceIndex + 1}`;
    const zoneNodeId = `tz-${toleranceIndex + 1}`;

    if (dimensional) {
      nodes.push({
        nodeType: "dimension",
        id: valueNodeId,
        entityId: normalizeStepEntityId(tolerance.entityId),
        entityType: tolerance.type,
        kind: tolerance.dimensionKind,
        ...(tolerance.nominalDimension !== undefined ? { nominal: canonicalNumber(tolerance.nominalDimension) } : {}),
        ...(tolerance.upperTolerance !== undefined ? { upper: canonicalNumber(tolerance.upperTolerance) } : {}),
        ...(tolerance.lowerTolerance !== undefined ? { lower: canonicalNumber(tolerance.lowerTolerance) } : {}),
        ...(tolerance.dimensionUpperLimit !== undefined ? { upperLimit: canonicalNumber(tolerance.dimensionUpperLimit) } : {}),
        ...(tolerance.dimensionLowerLimit !== undefined ? { lowerLimit: canonicalNumber(tolerance.dimensionLowerLimit) } : {}),
        basic: !!tolerance.isBasicDimension,
        reference: !!tolerance.isReferenceDimension,
        ...(tolerance.dimensionPreModifier ? { preModifier: tolerance.dimensionPreModifier } : {}),
      });
    } else {
      nodes.push({
        nodeType: "toleranceValue",
        id: valueNodeId,
        entityId: normalizeStepEntityId(tolerance.entityId),
        type: tolerance.type,
        symbol: tolerance.symbol,
        value: canonicalNumber(tolerance.value),
        unit: "mm",
        category: tolerance.category,
        ...(materialConditionOf(tolerance.toleranceModifiers) ? { materialCondition: materialConditionOf(tolerance.toleranceModifiers) } : {}),
        statistical: !!tolerance.isStatisticalTolerance,
      });
    }

    const zoneSize = canonicalNumber(
      dimensional
        ? (tolerance.dimensionUpperLimit !== undefined && tolerance.dimensionLowerLimit !== undefined
            ? tolerance.dimensionUpperLimit - tolerance.dimensionLowerLimit
            : tolerance.upperTolerance !== undefined && tolerance.lowerTolerance !== undefined
              ? tolerance.upperTolerance - tolerance.lowerTolerance
              : tolerance.value)
        : tolerance.value
    );
    nodes.push({
      nodeType: "toleranceZone",
      id: zoneNodeId,
      shape: dimensional ? "size_limits" : zoneShapeOf(tolerance),
      ...(zoneSize !== undefined ? { size: zoneSize } : {}),
      ...(tolerance.projectedToleranceZoneHeight !== undefined
        ? { projectedHeight: canonicalNumber(tolerance.projectedToleranceZoneHeight) }
        : {}),
      relatedToDRF: !isFormCategory(tolerance),
      ...(tolerance.toleranceModifiers && tolerance.toleranceModifiers.length > 0
        ? { modifiers: tolerance.toleranceModifiers }
        : {}),
    });

    edges.push({
      nodeType: "defines",
      id: `defines-${valueNodeId}-${zoneNodeId}`,
      sourceId: valueNodeId,
      targetId: zoneNodeId,
    });

    const frameEntityId = tolerance.datumReferenceFrame?.entityId;
    const frameNodeId = frameEntityId ? frameNodeIdByEntityId.get(frameEntityId) : undefined;
    if (frameNodeId) {
      edges.push({
        nodeType: "usesDRF",
        id: `usesdrf-${valueNodeId}-${frameNodeId}`,
        sourceId: valueNodeId,
        targetId: frameNodeId,
      });
    }

    (tolerance.topologyReferences || []).forEach((reference, index) => {
      const target = reference.resolution === "resolved" && reference.runtimeId
        ? reference.runtimeId
        : normalizeStepEntityId(reference.stepEntityId);
      if (!target) return;
      const key = `${target}|${reference.resolution}`;
      if (seenApplies.has(key)) return;
      seenApplies.add(key);
      edges.push({
        nodeType: "appliesTo",
        id: `applies-${valueNodeId}-${target}-${index}`,
        sourceId: valueNodeId,
        targetId: target,
        resolution: reference.resolution,
        ...(reference.resolutionReason ? { resolutionReason: reference.resolutionReason } : {}),
        ...(reference.resolution === "ambiguous" && reference.candidateRuntimeIds
          ? { candidateRuntimeIds: reference.candidateRuntimeIds }
          : {}),
      });
    });
  });

  return { nodes, edges };
}

/* ------------------------------------------------------------------ */
/* Determinism / serialization                                         */
/* ------------------------------------------------------------------ */

const fnv1a = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `0x${hash.toString(16).padStart(8, "0")}`;
};

/**
 * Stable identity for reload-persistence. OCCT signatures are already short
 * hashes; verbose STEP topology signatures (tessellation fallback) are ~100+
 * characters per adjacency edge and are pure context tax for an LLM, so they
 * are reduced to a compact deterministic hash here.
 */
const compactStableId = (signature: string | undefined): string | undefined => {
  if (!signature) return undefined;
  return signature.length <= 48 ? signature : `step:v1:${fnv1a(signature)}`;
};

const estimateTokens = (nodes: GraphNode[], edges: GraphEdge[]): number => {
  let characters = 0;
  for (const node of nodes) characters += JSON.stringify(node).length + 1;
  for (const edge of edges) characters += JSON.stringify(edge).length + 1;
  // ~3.5 characters per token is a common heuristic for structured JSON.
  return Math.max(1, Math.round(characters / 3.5));
};

const sortNodes = (nodes: GraphNode[]): GraphNode[] =>
  [...nodes].sort((a, b) => (a.nodeType === b.nodeType ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.nodeType < b.nodeType ? -1 : 1));

const sortEdges = (edges: GraphEdge[]): GraphEdge[] =>
  [...edges].sort((a, b) => {
    const aKey = `${a.nodeType}|${a.sourceId}|${a.targetId}|${a.precedence ?? 0}`;
    const bKey = `${b.nodeType}|${b.sourceId}|${b.targetId}|${b.precedence ?? 0}`;
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });

const meshEnvelopeMm = (meshes: any[]): { x?: number; y?: number; z?: number } | null => {
  let min: [number, number, number] | null = null;
  let max: [number, number, number] | null = null;
  meshes.forEach((mesh) => {
    const positions = mesh?.positions;
    if (!positions) return;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (!min) { min = [x, y, z]; max = [x, y, z]; continue; }
      min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y); min[2] = Math.min(min[2], z);
      max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y); max[2] = Math.max(max[2], z);
    }
  });
  if (!min || !max) return null;
  return {
    x: canonicalNumber(max[0] - min[0]),
    y: canonicalNumber(max[1] - min[1]),
    z: canonicalNumber(max[2] - min[2]),
  };
};

export function exportGraph(input: GraphExporterInput): ExportGraphResult {
  const { parsed, occtResult } = input;
  const faceMapping = input.faceMapping
    || (parsed.rawText && occtResult.meshes ? autoGenerateFaceMapping(occtResult.meshes, parsed.rawText) : {});

  const meshList = (occtResult.meshes || []) as any[];
  const edgeList = (occtResult.edges && occtResult.edges.length ? occtResult.edges : occtResult.lines || []) as any[];

  const { nodes: faceNodes, descriptors } = buildFaceNodes(meshList, faceMapping);
  const adjacencyEdges = buildAdjacencyEdges(edgeList, descriptors);
  const { nodes: featureNodes, featureCounts, memberEdges } = buildFeatureNodes(descriptors);
  const { nodes: pmiNodes, edges: pmiEdges } = buildPmiNodes(parsed);

  // True when all adjacency classifications on this run came from the OCCT
  // kernel (exact normals + in-kernel dihedral/probe) rather than the
  // TypeScript tessellation fallback.
  const kernelGeometry =
    adjacencyEdges.length > 0
    && adjacencyEdges.every((edge) => edge.geometrySource === "occt");

  const dimensions = parsed.dimensions || { width: 0, length: 0, estimatedThickness: 0 };
  const envelopeMm = meshEnvelopeMm(meshList) || {
    x: canonicalNumber(dimensions.width),
    y: canonicalNumber(dimensions.length),
    z: canonicalNumber(dimensions.estimatedThickness),
  };

  const schema = input.partMetadata?.schema
    || (parsed.datums.length > 0 || parsed.tolerances.length > 0 ? "AP242-PMI" : "AP203");

  const partNode: GraphNode = {
    nodeType: "part",
    id: "part-1",
    name: parsed.fileName,
    material: input.partMetadata?.material ?? null,
    schema,
    envelopeMm,
    featureCounts,
    ...(parsed.topologyReferenceSummary
      ? { pmiResolution: parsed.topologyReferenceSummary }
      : {}),
    ...(parsed.entitiesSummary ? { entityCounts: parsed.entitiesSummary } : {}),
  };

  const nodes = sortNodes([partNode, ...faceNodes, ...featureNodes, ...pmiNodes]);
  const edges = sortEdges([...adjacencyEdges, ...memberEdges, ...pmiEdges]);

  const stableHash = fnv1a(
    nodes.map((node) => `${node.nodeType}:${node.id}`).join("|")
    + "|"
    + edges.map((edge) => `${edge.nodeType}:${edge.sourceId}->${edge.targetId}`).join("|")
  );

  return {
    graphVersion: 1,
    source: {
      fileName: parsed.fileName,
      fileSize: parsed.fileSize,
      schema,
      topologySource: (occtResult as any)?.geometryTopologySource || "unknown",
      kernelGeometry,
      stableHash,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      estimatedTokens: estimateTokens(nodes, edges),
    },
    nodes,
    edges,
  };
}
/**
 * Convexity/concavity computation for B-Rep face adjacency (Requirement 5 of
 * docs/EXPORT_GRAPH_PLAN.md).
 *
 * Terminology:
 * - Face-level convexity applies to curved faces. A cylindrical face is
 *   `convex` when it is an outer boss (material inside the fitted radius) and
 *   `concave` when it is a bore/hole (material outside the fitted radius). The
 *   sign is read from the mean `(p - axisFoot(p)) . nHat` over surface samples,
 *   with the mesh normals taken outward per the tessellation convention (this
 *   mirrors the existing radial-dot test in geometryClassifier.ts but anchors
 *   on the fitted axis rather than a mesh centroid).
 * - Adjacency convexity is the dihedral sign at a shared edge. Outward unit
 *   normals of both faces are evaluated at the edge midpoint; for a cylindrical
 *   face the mid-edge outward normal is `+/-` radial from the fitted axis. The
 *   material side of face 2 is probed with a point pulled slightly inward from
 *   face 1's centroid, which classifies convex vs concave without depending on
 *   edge-tangent orientation or loop direction.
 */
import type { CylinderFit, Vec3 } from "./cylinderFit";
import {
  axisFoot,
  vec3AddScaled,
  vec3Dot,
  vec3Length,
  vec3Normalize,
  vec3Scale,
  vec3Sub,
} from "./cylinderFit";

export type ConvexityLabel = "convex" | "concave" | "unknown";

export interface FaceDescriptor {
  surfaceType: string;
  positions: ArrayLike<number>;
  indices?: ArrayLike<number>;
  normals?: ArrayLike<number>;
  /** Vertex-average centroid (on the surface). */
  centroid: Vec3;
  /** Characteristic size (max axis-aligned extent, used for probe scaling). */
  size: number;
  /** Constant outward normal, set for planar faces. */
  constantNormal?: Vec3;
  /** Fitted cylinder, set for cylindrical faces. */
  cylinder?: CylinderFit;
  /** Face-level convexity, set for curved faces. */
  convexity?: ConvexityLabel;
}

export interface DihedralResult {
  convexity: ConvexityLabel;
  /** Interior dihedral angle measured through the solid, in degrees,
   *  or undefined when either face normal is unknown. */
  dihedralDeg?: number;
}

const vertexCountOf = (positions: ArrayLike<number>) => Math.floor(positions.length / 3);

/** Area-weighted average triangle normal (outward per tessellation convention). */
export function computeAreaWeightedNormal(
  positions: ArrayLike<number>,
  indices?: ArrayLike<number>
): Vec3 | null {
  const vertexCount = vertexCountOf(positions);
  if (vertexCount === 0) return null;
  const triCount = indices && indices.length > 0
    ? Math.floor(indices.length / 3)
    : Math.floor(vertexCount / 3);
  const sum = { x: 0, y: 0, z: 0 };
  let weight = 0;

  for (let t = 0; t < triCount; t++) {
    const ia = indices ? indices[t * 3] : t * 3;
    const ib = indices ? indices[t * 3 + 1] : t * 3 + 1;
    const ic = indices ? indices[t * 3 + 2] : t * 3 + 2;
    const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
    const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
    const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const area2 = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (area2 <= 1e-12) continue;
    sum.x += (nx / area2) * area2;
    sum.y += (ny / area2) * area2;
    sum.z += (nz / area2) * area2;
    weight += area2;
  }
  if (weight <= 1e-12) return null;
  return vec3Normalize({ x: sum.x, y: sum.y, z: sum.z });
}

export const vertexCentroid = (positions: ArrayLike<number>): Vec3 => {
  const count = vertexCountOf(positions);
  const sum = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < count; i++) {
    sum.x += positions[i * 3];
    sum.y += positions[i * 3 + 1];
    sum.z += positions[i * 3 + 2];
  }
  if (count === 0) return sum;
  return { x: sum.x / count, y: sum.y / count, z: sum.z / count };
};

export const faceSize = (positions: ArrayLike<number>): number => {
  const count = vertexCountOf(positions);
  if (count === 0) return 1;
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i < count; i++) {
    min.x = Math.min(min.x, positions[i * 3]);
    min.y = Math.min(min.y, positions[i * 3 + 1]);
    min.z = Math.min(min.z, positions[i * 3 + 2]);
    max.x = Math.max(max.x, positions[i * 3]);
    max.y = Math.max(max.y, positions[i * 3 + 1]);
    max.z = Math.max(max.z, positions[i * 3 + 2]);
  }
  return Math.max(Number.EPSILON, Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z));
};

/**
 * Face-level convexity for a cylindrical face. Uses the fitted axis as the
 * reference line and the per-vertex normals as outward directions.
 */
export function computeFaceConvexity(input: {
  positions: ArrayLike<number>;
  normals?: ArrayLike<number>;
  fit: CylinderFit;
}): ConvexityLabel {
  const vertexCount = vertexCountOf(input.positions);
  const normalCount = input.normals ? Math.floor(input.normals.length / 3) : 0;
  if (vertexCount === 0 || normalCount === 0) return "unknown";
  const normalStep = Math.max(1, Math.floor(Math.min(vertexCount, normalCount) / 64));

  let radialDotSum = 0;
  let samples = 0;
  for (let i = 0; i < Math.min(vertexCount, normalCount); i += normalStep) {
    const point = { x: input.positions[i * 3], y: input.positions[i * 3 + 1], z: input.positions[i * 3 + 2] };
    const foot = axisFoot(input.fit.center, input.fit.axis, point);
    const radial = vec3Sub(point, foot);
    const radialLen = vec3Length(radial);
    if (radialLen <= 1e-9) continue;
    const normal = vec3Normalize({
      x: input.normals![i * 3],
      y: input.normals![i * 3 + 1],
      z: input.normals![i * 3 + 2],
    });
    radialDotSum += vec3Dot(normal, { x: radial.x / radialLen, y: radial.y / radialLen, z: radial.z / radialLen });
    samples++;
  }
  if (samples === 0) return "unknown";
  const mean = radialDotSum / samples;
  if (mean > 0.05) return "convex";
  if (mean < -0.05) return "concave";
  return "unknown";
}

/**
 * Outward unit normal of a face at an arbitrary surface point. Planar faces
 * return their constant outward normal; cylindrical faces return the fitted
 * radial direction oriented by the face-level convexity (boss: away from axis,
 * hole: toward axis). Returns null for unsupported surfaces.
 */
export function outwardNormalAt(face: FaceDescriptor, point: Vec3): Vec3 | null {
  if (face.surfaceType === "plane" && face.constantNormal) {
    return vec3Normalize(face.constantNormal);
  }
  if (face.surfaceType === "cylinder" && face.cylinder) {
    const radial = vec3Normalize(vec3Sub(point, axisFoot(face.cylinder.center, face.cylinder.axis, point)));
    const sign = face.convexity === "concave" ? -1 : 1;
    return vec3Scale(radial, sign);
  }
  return null;
}

export const edgeMidpoint = (positions: ArrayLike<number>): Vec3 => {
  const count = vertexCountOf(positions);
  if (count === 0) return { x: 0, y: 0, z: 0 };
  // The payload stores edge segments; average all recorded vertices. For a
  // straight tessellated edge this is the geometric midpoint.
  const sum = { x: 0, y: 0, z: 0 };
  let n = 0;
  for (let i = 0; i < count; i++) {
    sum.x += positions[i * 3];
    sum.y += positions[i * 3 + 1];
    sum.z += positions[i * 3 + 2];
    n++;
  }
  return { x: sum.x / n, y: sum.y / n, z: sum.z / n };
};

/**
 * Dihedral classification at a shared edge. `face1`/`face2` say which face is
 * face 1 for the interior probe; `face1CentroidNormal` is face 1's outward
 * normal near its centroid (same direction used for the probe). The probe is
 * pulled a fraction of the face size inside the solid from the centroid, so it
 * never degenerates onto face 2's plane the way an edge-local probe would for
 * perpendicular faces.
 */
export function computeAdjacencyDihedral(args: {
  n1: Vec3;
  n2: Vec3;
  m: Vec3;
  face1Centroid: Vec3;
  face1OutwardNormal: Vec3;
  face1Size: number;
}): DihedralResult {
  const { n1, n2, m } = args;
  const tau = Math.max(1e-7, args.face1Size * 1e-3);
  const probe = vec3AddScaled(args.face1Centroid, args.face1OutwardNormal, -tau);
  const side = vec3Dot(vec3Sub(probe, m), n2);

  const gamma = Math.acos(Math.max(-1, Math.min(1, vec3Dot(n1, n2))));
  const convex = side < 0;
  const dihedralRad = convex ? Math.PI - gamma : Math.PI + gamma;
  return {
    convexity: convex ? "convex" : "concave",
    dihedralDeg: (dihedralRad * 180) / Math.PI,
  };
}

/** Convenience wrapper that resolves both face normals at the edge midpoint. */
export function computeFacePairDihedral(args: {
  faceA: FaceDescriptor;
  faceB: FaceDescriptor;
  m: Vec3;
}): DihedralResult {
  const n1 = outwardNormalAt(args.faceA, args.m);
  const n2 = outwardNormalAt(args.faceB, args.m);
  if (!n1 || !n2) return { convexity: "unknown" };

  const face1CentroidOutward = outwardNormalAt(args.faceA, args.faceA.centroid);
  if (!face1CentroidOutward) return { convexity: "unknown" };

  return computeAdjacencyDihedral({
    n1,
    n2,
    m: args.m,
    face1Centroid: args.faceA.centroid,
    face1OutwardNormal: face1CentroidOutward,
    face1Size: args.faceA.size,
  });
}
/**
 * Pure least-squares cylinder fitting over triangle-mesh face geometry.
 *
 * Ported from `CadCanvas3D.getCylinderFaceCircleSnap` so the graph exporter
 * reuses the same math the viewer already validates in production (axis from
 * sampled vertex-normal cross products, then an algebraic least-squares circle
 * fit in the plane perpendicular to that axis). No three.js dependency.
 *
 * Fit validation mirrors the viewer: relative radial deviation <= 0.12 and
 * normal-raadial alignment >= 0.55.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CylinderFit {
  /** Unit axis direction. */
  axis: Vec3;
  /** A point guaranteed to lie on the axis (the fitted circle center at the
   *  plane crossing the axis reference). */
  center: Vec3;
  radius: number;
  /** Maximum absolute |distance-to-surface| over sampled vertices. */
  maxDeviation: number;
  /** maxDeviation / radius. */
  relativeDeviation: number;
  valid: boolean;
}

export const vec3Length = (v: Vec3): number => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
export const vec3LengthSq = (v: Vec3): number => v.x * v.x + v.y * v.y + v.z * v.z;
export const vec3Sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vec3Scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const vec3Dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const vec3Cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export const vec3Normalize = (v: Vec3): Vec3 => {
  const length = vec3Length(v);
  if (!Number.isFinite(length) || length <= 1e-12) return { x: 0, y: 0, z: 1 };
  return { x: v.x / length, y: v.y / length, z: v.z / length };
};

export const vec3AddScaled = (a: Vec3, b: Vec3, s: number): Vec3 => ({
  x: a.x + b.x * s,
  y: a.y + b.y * s,
  z: a.z + b.z * s,
});

/** Projection of `p` onto the axis line through `center` with unit `axis`. */
export const axisFoot = (center: Vec3, axis: Vec3, p: Vec3): Vec3 =>
  vec3AddScaled(center, axis, vec3Dot(vec3Sub(p, center), axis));

/** Signed magnitude of the cross product of two unit vectors (needed for the
 *  axis family threshold that roughly mirrors the viewer's `<= 0.03` gate). */
const crossPairsAligned = (a: Vec3, b: Vec3): boolean => {
  const cross = vec3Cross(a, b);
  return vec3LengthSq(cross) <= 0.03;
};

/**
 * Aggregate per-vertex normals from triangle soup (fallback when a mesh has
 * positions and indices but no normal attribute). Output length ~ count * 3.
 */
export function computeVertexNormals(
  positions: ArrayLike<number>,
  indices?: ArrayLike<number>
): Float32Array | null {
  const vertexCount = Math.floor(positions.length / 3);
  if (vertexCount === 0) return null;
  const accumulated = new Float32Array(vertexCount * 3);
  const triCount = indices && indices.length > 0
    ? Math.floor(indices.length / 3)
    : Math.floor(vertexCount / 3);

  for (let t = 0; t < triCount; t++) {
    const ia = indices ? indices[t * 3] : t * 3;
    const ib = indices ? indices[t * 3 + 1] : t * 3 + 1;
    const ic = indices ? indices[t * 3 + 2] : t * 3 + 2;

    const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
    const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
    const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];

    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nlen <= 1e-12) continue;
    const inv = 1 / nlen;
    for (const vi of [ia, ib, ic]) {
      accumulated[vi * 3] += nx * inv;
      accumulated[vi * 3 + 1] += ny * inv;
      accumulated[vi * 3 + 2] += nz * inv;
    }
  }

  const normals = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    const nx = accumulated[i * 3], ny = accumulated[i * 3 + 1], nz = accumulated[i * 3 + 2];
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (length <= 1e-12) continue;
    normals[i * 3] = nx / length;
    normals[i * 3 + 1] = ny / length;
    normals[i * 3 + 2] = nz / length;
  }
  return normals;
}

const estimateAxisFromNormals = (normals: ArrayLike<number>): Vec3 | null => {
  const normalCount = Math.floor(normals.length / 3);
  if (normalCount < 3) return null;

  const step = Math.max(1, Math.floor(normalCount / 48));
  const sampled: Vec3[] = [];
  for (let i = 0; i < normalCount; i += step) {
    const normal = vec3Normalize({
      x: normals[i * 3],
      y: normals[i * 3 + 1],
      z: normals[i * 3 + 2],
    });
    if (Number.isFinite(normal.x) && Number.isFinite(normal.y) && Number.isFinite(normal.z)) {
      sampled.push(normal);
    }
  }
  if (sampled.length < 3) return null;

  const axis = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < sampled.length; i++) {
    for (let j = i + 1; j < sampled.length; j += 3) {
      if (crossPairsAligned(sampled[i], sampled[j])) continue;
      let cross = vec3Cross(sampled[i], sampled[j]);
      cross = vec3Normalize(cross);
      if (vec3LengthSq(axis) > 1e-8 && vec3Dot(cross, axis) < 0) {
        cross = vec3Scale(cross, -1);
      }
      axis.x += cross.x;
      axis.y += cross.y;
      axis.z += cross.z;
    }
  }
  const result = vec3Normalize(axis);
  return vec3LengthSq(axis) > 1e-6 ? result : null;
};

/**
 * Fit a cylinder to a face mesh. Returns null when the geometry is not
 * cylinder-like within the viewer's validation tolerances.
 */
export function fitCylinder(input: {
  positions: ArrayLike<number>;
  indices?: ArrayLike<number>;
  normals?: ArrayLike<number>;
}): CylinderFit | null {
  const positions = input.positions;
  const vertexCount = Math.floor(positions.length / 3);
  if (vertexCount < 8) return null;

  let normals = input.normals;
  if (!normals || Math.floor(normals.length / 3) < 3) {
    if (input.indices && input.indices.length > 0) {
      normals = computeVertexNormals(input.positions, input.indices);
    }
  }
  if (!normals) return null;

  const axis0 = estimateAxisFromNormals(normals);
  if (!axis0) return null;
  const axis = axis0;

  let u = vec3Normalize(vec3Cross(axis, { x: 1, y: 0, z: 0 }));
  if (vec3LengthSq(u) <= 1e-8) {
    u = vec3Normalize(vec3Cross(axis, { x: 0, y: 1, z: 0 }));
  }
  if (vec3LengthSq(u) <= 1e-8) return null;
  const v = vec3Normalize(vec3Cross(axis, u));
  if (vec3LengthSq(v) <= 1e-8) return null;

  let sx = 0, sy = 0, s1 = 0;
  let sxx = 0, syy = 0, sxy = 0;
  let sxz = 0, syz = 0, sz = 0;

  for (let i = 0; i < vertexCount; i++) {
    const point = { x: positions[i * 3], y: positions[i * 3 + 1], z: positions[i * 3 + 2] };
    const x = vec3Dot(point, u);
    const y = vec3Dot(point, v);
    const z = -(x * x + y * y);
    sx += x;
    sy += y;
    s1 += 1;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
    sxz += x * z;
    syz += y * z;
    sz += z;
  }

  const det =
    sxx * (syy * s1 - sy * sy) -
    sxy * (sxy * s1 - sy * sx) +
    sx * (sxy * sy - syy * sx);
  if (Math.abs(det) <= 1e-8) return null;

  const detA =
    sxz * (syy * s1 - sy * sy) -
    sxy * (syz * s1 - sy * sz) +
    sx * (syz * sy - syy * sz);
  const detB =
    sxx * (syz * s1 - sy * sz) -
    sxz * (sxy * s1 - sy * sx) +
    sx * (sxy * sz - syz * sx);
  const detC =
    sxx * (syy * sz - syz * sy) -
    sxy * (sxy * sz - syz * sx) +
    sxz * (sxy * sy - syy * sx);

  const circleA = detA / det;
  const circleB = detB / det;
  const circleC = detC / det;
  const centerX = -circleA * 0.5;
  const centerY = -circleB * 0.5;
  const radiusSq = centerX * centerX + centerY * centerY - circleC;
  if (!Number.isFinite(radiusSq) || radiusSq <= 1e-8) return null;
  const radius = Math.sqrt(radiusSq);
  if (radius <= 1e-7) return null;

  let maxDeviation = 0;
  for (let i = 0; i < vertexCount; i++) {
    const point = { x: positions[i * 3], y: positions[i * 3 + 1], z: positions[i * 3 + 2] };
    const x = vec3Dot(point, u) - centerX;
    const y = vec3Dot(point, v) - centerY;
    const distance = Math.sqrt(x * x + y * y);
    maxDeviation = Math.max(maxDeviation, Math.abs(distance - radius));
  }
  const relativeDeviation = maxDeviation / radius;
  if (relativeDeviation > 0.12) return null;

  // Validate that surface normals align with the radial direction (limit how
  // many normals we touch when the vertex/normal counts do not match).
  const normalCount = Math.floor(normals.length / 3);
  const normalStep = Math.max(1, Math.floor(Math.min(vertexCount, normalCount) / 64));
  let radialAlignment = 0;
  let radialSamples = 0;
  for (let i = 0; i < Math.min(vertexCount, normalCount); i += normalStep) {
    const point = { x: positions[i * 3], y: positions[i * 3 + 1], z: positions[i * 3 + 2] };
    const radial = vec3Normalize({
      x: u.x * (vec3Dot(point, u) - centerX) + v.x * (vec3Dot(point, v) - centerY),
      y: u.y * (vec3Dot(point, u) - centerX) + v.y * (vec3Dot(point, v) - centerY),
      z: u.z * (vec3Dot(point, u) - centerX) + v.z * (vec3Dot(point, v) - centerY),
    });
    if (vec3LengthSq(radial) <= 1e-8) continue;
    const normal = vec3Normalize({ x: normals[i * 3], y: normals[i * 3 + 1], z: normals[i * 3 + 2] });
    if (vec3LengthSq(normal) <= 1e-8) continue;
    radialAlignment += Math.abs(vec3Dot(normal, radial));
    radialSamples++;
  }
  if (radialSamples < 4 || radialAlignment / radialSamples < 0.55) return null;

  return {
    axis,
    center: {
      x: u.x * centerX + v.x * centerY,
      y: u.y * centerX + v.y * centerY,
      z: u.z * centerX + v.z * centerY,
    },
    radius,
    maxDeviation,
    relativeDeviation,
    valid: true,
  };
}
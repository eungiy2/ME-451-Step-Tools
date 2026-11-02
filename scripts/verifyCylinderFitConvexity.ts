/**
 * Pure-geometry verification of cylinder fitting and convexity math — no OCCT
 * required. Builds synthetic open cylinders (boss outward / bore inward) and a
 * cube-like pair of two perpendicular planar faces.
 *
 * Usage: npx tsx scripts/verifyCylinderFitConvexity.ts
 */
import assert from "node:assert/strict";
import { fitCylinder, vec3Dot, type Vec3 } from "../src/utils/cylinderFit";
import {
  computeAdjacencyDihedral,
  computeAreaWeightedNormal,
  computeFaceConvexity,
  outwardNormalAt,
  vertexCentroid,
  type FaceDescriptor,
} from "../src/utils/convexity";

const makeSegmentFar = (radius: number, height: number, segments: number, inward: boolean) => {
  const positions: number[] = [];
  const normals: number[] = [];
  for (let ring = 0; ring < 2; ring++) {
    const z = ring * height;
    for (let s = 0; s < segments; s++) {
      const angle = (s / segments) * Math.PI * 2;
      positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
      const sign = inward ? -1 : 1;
      normals.push(Math.cos(angle) * sign, Math.sin(angle) * sign, 0);
    }
  }
  const indices: number[] = [];
  for (let s = 0; s < segments; s++) {
    const next = (s + 1) % segments;
    const a = s;
    const b = next;
    const c = segments + s;
    const d = segments + next;
    indices.push(a, b, c, a, c, d);
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices) };
};

const verifyCylinder = (radius: number, height: number, inward: boolean, expected: "convex" | "concave") => {
  const mesh = makeSegmentFar(radius, height, 24, inward);
  const fit = fitCylinder(mesh);
  assert.ok(fit, `fit should succeed for ${expected} cylinder`);
  assert.ok(Math.abs(fit.radius - radius) < radius * 0.02, `radius within 2%: ${fit.radius}`);
  assert.ok(Math.abs(Math.abs(vec3Dot(fit.axis, { x: 0, y: 0, z: 1 })) - 1) < 0.05, "axis ≈ Z");
  const convexity = computeFaceConvexity({ positions: mesh.positions, normals: mesh.normals, fit });
  assert.equal(convexity, expected, `${expected} face convexity expected`);
};

const verifyPlaneDihedral = () => {
  const top: { x: number; y: number; z: number }[] = [
    { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }, { x: 1, y: 1, z: 1 }, { x: 0, y: 1, z: 1 },
  ];
  const right: { x: number; y: number; z: number }[] = [
    { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 1, y: 1, z: 1 }, { x: 1, y: 0, z: 1 },
  ];
  const topPositions = top.flatMap((p) => [p.x, p.y, p.z]);
  const rightPositions = right.flatMap((p) => [p.x, p.y, p.z]);
  const topIndices = [0, 1, 2, 0, 2, 3];
  const rightIndices = [0, 1, 2, 0, 2, 3];

  const topNormal = computeAreaWeightedNormal(topPositions as unknown as number[], topIndices)!;
  const rightNormal = computeAreaWeightedNormal(rightPositions as unknown as number[], rightIndices)!;
  assert.ok(vec3Dot(topNormal, { x: 0, y: 0, z: 1 }) > 0.99, "top normal ≈ +z");
  assert.ok(vec3Dot(rightNormal, { x: 1, y: 0, z: 0 }) > 0.99, "right normal ≈ +x");

  const faceA: FaceDescriptor = {
    surfaceType: "plane",
    positions: topPositions as unknown as number[],
    indices: topIndices as unknown as number[],
    centroid: vertexCentroid(topPositions as unknown as number[]),
    size: 2,
    constantNormal: topNormal,
  };
  const faceB: FaceDescriptor = {
    surfaceType: "plane",
    positions: rightPositions as unknown as number[],
    indices: rightIndices as unknown as number[],
    centroid: vertexCentroid(rightPositions as unknown as number[]),
    size: 2,
    constantNormal: rightNormal,
  };

  const n1 = outwardNormalAt(faceA, { x: 1, y: 0.5, z: 1 });
  const n2 = outwardNormalAt(faceB, { x: 1, y: 0.5, z: 1 });
  assert.ok(n1 && n2, "normals resolvable at edge midpoint");
  const result = computeAdjacencyDihedral({
    n1: n1 as Vec3,
    n2: n2 as Vec3,
    m: { x: 1, y: 0.5, z: 1 },
    face1Centroid: faceA.centroid,
    face1OutwardNormal: n1 as Vec3,
    face1Size: faceA.size,
  });
  assert.equal(result.convexity, "convex");
  assert.ok(Math.abs((result.dihedralDeg ?? 0) - 90) < 1e-6, `dihedral ≈ 90°, got ${result.dihedralDeg}`);
};

verifyCylinder(5, 10, false, "convex");
verifyCylinder(5, 10, true, "concave");
verifyPlaneDihedral();

console.log("Cylinder fit + convexity verification passed (boss convex, bore concave, planar dihedral 90°).");
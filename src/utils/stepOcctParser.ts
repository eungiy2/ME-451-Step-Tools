import { loadOcct } from "./occtLoader";

export interface OcctTessellationParams {
  linearDeflection?: number;
  angularDeflection?: number;
}

/**
 * Parses raw STEP bytes utilizing the Open Cascade (occt-import-js) WebAssembly engine.
 * @param fileBuffer - Standard Uint8Array containing raw .stp/.step file bytes.
 * @param params - Settings to control triangulation resolution.
 */
export async function parseStepWithOcct(
  fileBuffer: Uint8Array,
  params: OcctTessellationParams = {}
): Promise<any> {
  const occt = await loadOcct();
  
  // Gather linear and angular deflection bounds
  const linearDeflection = params.linearDeflection ?? 0.1;
  const angularDeflection = params.angularDeflection ?? 0.5;
  
  const parseConfig = {
    linearDeflection: Number(linearDeflection),
    angularDeflection: Number(angularDeflection),
  };

  try {
    // Run WebAssembly Open Cascade Tessellator
    const result = occt.ReadStepFile(fileBuffer, parseConfig);
    
    if (result && result.success && result.meshes) {
      const normalizedMeshes: any[] = [];
      const auxiliaryMeshes: any[] = [];
      const globalFaceIndex = { value: 0 };
      const hasSolidMesh = result.meshes.some((mesh: any) => /^SOLID\b/i.test(mesh.name || ""));
      const isAuxiliarySourceMesh = (mesh: any) => hasSolidMesh && !/^SOLID\b/i.test(mesh.name || "");

      // Helper to calculate a precise triangle normal
      const computeTriangleNormal = (v0: number[], v1: number[], v2: number[]): number[] => {
        const ax = v1[0] - v0[0], ay = v1[1] - v0[1], az = v1[2] - v0[2];
        const bx = v2[0] - v0[0], by = v2[1] - v0[1], bz = v2[2] - v0[2];
        const nx = ay * bz - az * by;
        const ny = az * bx - ax * bz;
        const nz = ax * by - ay * bx;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len < 1e-7) return [0, 0, 1];
        return [nx / len, ny / len, nz / len];
      };

      // 1. Convert each body/mesh into its individual constituent analytical B-Rep faces
      result.meshes.forEach((mesh: any, meshIdx: number) => {
        const rawPositions = mesh.attributes?.position?.array || [];
        const rawNormals = mesh.attributes?.normal?.array || [];
        const rawIndices = mesh.index?.array || [];
        const targetMeshes = isAuxiliarySourceMesh(mesh) ? auxiliaryMeshes : normalizedMeshes;

        if (!mesh.brep_faces || mesh.brep_faces.length === 0) {
          globalFaceIndex.value++;
          const pos = rawPositions instanceof Float32Array ? rawPositions : new Float32Array(rawPositions);
          const norm = rawNormals instanceof Float32Array ? rawNormals : (rawNormals.length > 0 ? new Float32Array(rawNormals) : undefined);
          const ind = rawIndices instanceof Uint32Array ? rawIndices : (rawIndices.length > 0 ? new Uint32Array(rawIndices) : undefined);

          targetMeshes.push({
            ...mesh,
            positions: pos,
            normals: norm,
            indices: ind,
            color: mesh.color || [0.73, 0.77, 0.82],
            name: mesh.name || `B-Rep Face #${globalFaceIndex.value}`,
            auxiliary: isAuxiliarySourceMesh(mesh),
            parentMeshName: mesh.name || `Part ${meshIdx + 1}`
          });
          return;
        }

        mesh.brep_faces.forEach((faceGroup: any, faceIdx: number) => {
          const firstTri = faceGroup.first;
          const lastTri = faceGroup.last;

          globalFaceIndex.value++;
          const cleanParentName = mesh.name ? mesh.name.replace(/_1$/g, "") : `Part #${meshIdx + 1}`;
          const faceName = `${cleanParentName} - Face #${globalFaceIndex.value}`;

          if (firstTri === undefined || lastTri === undefined || firstTri > lastTri) {
            targetMeshes.push({
              positions: new Float32Array([]),
              normals: undefined,
              indices: new Uint32Array([]),
              color: [0.73, 0.77, 0.82],
              name: `${faceName} (Empty Placeholder)`,
              parentMeshName: mesh.name || `Part ${meshIdx + 1}`,
              faceGroupIndex: faceIdx,
              auxiliary: isAuxiliarySourceMesh(mesh)
            });
            return;
          }

          const facePositions: number[] = [];
          const faceNormals: number[] = [];
          const faceIndices: number[] = [];
          const oldToNewIndexMap = new Map<number, number>();

          for (let t = firstTri; t <= lastTri; t++) {
            for (let offset = 0; offset < 3; offset++) {
              const oldVertIdx = rawIndices[t * 3 + offset];
              if (oldVertIdx === undefined) continue;

              let newVertIdx = oldToNewIndexMap.get(oldVertIdx);
              if (newVertIdx === undefined) {
                newVertIdx = oldToNewIndexMap.size;
                oldToNewIndexMap.set(oldVertIdx, newVertIdx);

                facePositions.push(
                  rawPositions[oldVertIdx * 3],
                  rawPositions[oldVertIdx * 3 + 1],
                  rawPositions[oldVertIdx * 3 + 2]
                );

                if (rawNormals.length > oldVertIdx * 3 + 2) {
                  faceNormals.push(
                    rawNormals[oldVertIdx * 3],
                    rawNormals[oldVertIdx * 3 + 1],
                    rawNormals[oldVertIdx * 3 + 2]
                  );
                }
              }
              faceIndices.push(newVertIdx);
            }
          }

          if (faceIndices.length === 0) {
            targetMeshes.push({
              positions: new Float32Array([]),
              normals: undefined,
              indices: new Uint32Array([]),
              color: [0.73, 0.77, 0.82],
              name: `${faceName} (Empty Placeholder)`,
              parentMeshName: mesh.name || `Part ${meshIdx + 1}`,
              faceGroupIndex: faceIdx,
              auxiliary: isAuxiliarySourceMesh(mesh)
            });
            return;
          }

          targetMeshes.push({
            positions: new Float32Array(facePositions),
            normals: faceNormals.length > 0 ? new Float32Array(faceNormals) : undefined,
            indices: new Uint32Array(faceIndices),
            color: faceGroup.color || mesh.color || [0.73, 0.77, 0.82],
            name: faceName,
            parentMeshName: mesh.name || `Part ${meshIdx + 1}`,
            faceGroupIndex: faceIdx,
            auxiliary: isAuxiliarySourceMesh(mesh)
          });
        });
      });

      // 2. Extract shared B-Rep-like edge segments globally. A real B-Rep edge is
      // owned by the shell and referenced by adjacent faces, not duplicated per face.
      const edgeSegmentMap = new Map<string, {
        positions: number[];
        faceIndices: Set<number>;
        faceIds: Set<string>;
      }>();
      const faceLoopDrafts: {
        faceIndex: number;
        edgeKeys: string[];
      }[] = [];

      const coordinateKey = (x: number, y: number, z: number) => {
        const scale = 100000;
        return `${Math.round(x * scale)}_${Math.round(y * scale)}_${Math.round(z * scale)}`;
      };

      const edgeKeyForVertices = (positions: any, a: number, b: number) => {
        const aKey = coordinateKey(positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2]);
        const bKey = coordinateKey(positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2]);
        return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
      };

      const addSharedEdgeSegment = (positions: any, a: number, b: number, faceIdx: number) => {
        const key = edgeKeyForVertices(positions, a, b);
        const existing = edgeSegmentMap.get(key);
        if (existing) {
          existing.faceIndices.add(faceIdx);
          existing.faceIds.add(`BRepFace-${faceIdx}`);
          return;
        }

        edgeSegmentMap.set(key, {
          positions: [
            positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2],
            positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2]
          ],
          faceIndices: new Set([faceIdx]),
          faceIds: new Set([`BRepFace-${faceIdx}`])
        });
      };

      normalizedMeshes.forEach((nMesh: any, faceIdx: number) => {
        const positions = nMesh.positions;
        const indices = nMesh.indices;
        if (!positions || positions.length === 0 || !indices || indices.length === 0) return;

        // Map containing undirected edge key -> count of occurrence, list of triangle indices
        const edgeCounts = new Map<string, { count: number; triangles: number[] }>();
        const edgePairs: [number, number][] = [];

        for (let i = 0; i < indices.length; i += 3) {
          const a = indices[i];
          const b = indices[i + 1];
          const c = indices[i + 2];

          const triple = [
            [a, b],
            [b, c],
            [c, a]
          ];

          triple.forEach(([v0, v1]) => {
            const k = v0 < v1 ? `${v0}_${v1}` : `${v1}_${v0}`;
            const existing = edgeCounts.get(k);
            if (existing) {
              existing.count++;
              existing.triangles.push(i / 3);
            } else {
              edgeCounts.set(k, { count: 1, triangles: [i / 3] });
            }
          });
        }

        // Boundary contour segments are those with count === 1 in triangulation
        edgeCounts.forEach((info, k) => {
          if (info.count === 1) {
            const [aStr, bStr] = k.split("_");
            const a = parseInt(aStr, 10);
            const b = parseInt(bStr, 10);
            edgePairs.push([a, b]);
          } else if (info.count === 2) {
            // Internal crease within the face. Draw only if it forms a sharp crease (angle > 30 degrees)
            const t0 = info.triangles[0];
            const t1 = info.triangles[1];

            const a0 = indices[t0 * 3], b0 = indices[t0 * 3 + 1], c0 = indices[t0 * 3 + 2];
            const v0 = [positions[a0 * 3], positions[a0 * 3 + 1], positions[a0 * 3 + 2]];
            const v1 = [positions[b0 * 3], positions[b0 * 3 + 1], positions[b0 * 3 + 2]];
            const v2 = [positions[c0 * 3], positions[c0 * 3 + 1], positions[c0 * 3 + 2]];

            const a1 = indices[t1 * 3], b1 = indices[t1 * 3 + 1], c1 = indices[t1 * 3 + 2];
            const w0 = [positions[a1 * 3], positions[a1 * 3 + 1], positions[a1 * 3 + 2]];
            const w1 = [positions[b1 * 3], positions[b1 * 3 + 1], positions[b1 * 3 + 2]];
            const w2 = [positions[c1 * 3], positions[c1 * 3 + 1], positions[c1 * 3 + 2]];

            const normal0 = computeTriangleNormal(v0, v1, v2);
            const normal1 = computeTriangleNormal(w0, w1, w2);

            const dot = normal0[0] * normal1[0] + normal0[1] * normal1[1] + normal0[2] * normal1[2];
            // dot < 0.866 is ~30 degrees. Creases sharper than this are drawn
            if (dot < 0.866) {
              const [aStr, bStr] = k.split("_");
              const a = parseInt(aStr, 10);
              const b = parseInt(bStr, 10);
              edgePairs.push([a, b]);
            }
          }
        });

        if (edgePairs.length > 0) {
          const adjacency = new Map<number, [number, string][]>();
          edgePairs.forEach(([a, b]) => {
            addSharedEdgeSegment(positions, a, b, faceIdx);
            const globalKey = edgeKeyForVertices(positions, a, b);
            const aEdges = adjacency.get(a) || [];
            const bEdges = adjacency.get(b) || [];
            aEdges.push([b, globalKey]);
            bEdges.push([a, globalKey]);
            adjacency.set(a, aEdges);
            adjacency.set(b, bEdges);
          });

          const unvisited = new Set(edgePairs.map(([a, b]) => {
            const localKey = a < b ? `${a}_${b}` : `${b}_${a}`;
            return localKey;
          }));

          const localToGlobalKey = new Map<string, string>();
          edgePairs.forEach(([a, b]) => {
            const localKey = a < b ? `${a}_${b}` : `${b}_${a}`;
            localToGlobalKey.set(localKey, edgeKeyForVertices(positions, a, b));
          });

          while (unvisited.size > 0) {
            const [startKey] = unvisited;
            const pending = [startKey];
            const loopEdgeKeys: string[] = [];
            unvisited.delete(startKey);

            while (pending.length > 0) {
              const currentKey = pending.pop()!;
              const globalKey = localToGlobalKey.get(currentKey);
              if (globalKey && !loopEdgeKeys.includes(globalKey)) {
                loopEdgeKeys.push(globalKey);
              }

              const [aStr, bStr] = currentKey.split("_");
              const vertices = [parseInt(aStr, 10), parseInt(bStr, 10)];
              vertices.forEach((vertex) => {
                (adjacency.get(vertex) || []).forEach(([nextVertex]) => {
                  const neighborKey = vertex < nextVertex ? `${vertex}_${nextVertex}` : `${nextVertex}_${vertex}`;
                  if (unvisited.has(neighborKey)) {
                    unvisited.delete(neighborKey);
                    pending.push(neighborKey);
                  }
                });
              });
            }

            if (loopEdgeKeys.length > 0) {
              faceLoopDrafts.push({
                faceIndex: faceIdx,
                edgeKeys: loopEdgeKeys,
              });
            }
          }
        }
      });

      const edgeIndexByKey = new Map<string, number>();
      const lines = Array.from(edgeSegmentMap.entries()).map(([edgeKey, edge], idx) => {
        edgeIndexByKey.set(edgeKey, idx);
        const faceIndices = Array.from(edge.faceIndices).sort((a, b) => a - b);
        const parentFaceIndex = faceIndices[0] ?? -1;

        return {
          positions: new Float32Array(edge.positions),
          indices: new Uint32Array([0, 1]),
          name: `B-Rep Edge #${idx + 1}`,
          parentFaceId: parentFaceIndex >= 0 ? `BRepFace-${parentFaceIndex}` : undefined,
          parentFaceIndex,
          parentFaceIds: Array.from(edge.faceIds).sort(),
          parentFaceIndices: faceIndices,
        };
      });

      const loops = faceLoopDrafts.map((loop, idx) => {
        const edgeIndices = loop.edgeKeys
          .map((edgeKey) => edgeIndexByKey.get(edgeKey))
          .filter((edgeIdx): edgeIdx is number => edgeIdx !== undefined);

        return {
          id: `BRepLoop-${idx}`,
          name: `B-Rep Loop #${idx + 1}`,
          faceId: `BRepFace-${loop.faceIndex}`,
          faceIndex: loop.faceIndex,
          edgeIds: edgeIndices.map((edgeIdx) => `BRepEdge-${edgeIdx}`),
          edgeIndices,
        };
      });

      return {
        success: true,
        meshes: normalizedMeshes,
        lines,
        edges: lines,
        loops,
        auxiliaryMeshes,
        auxiliaryMeshCount: auxiliaryMeshes.length,
      };
    }

    return result;
  } catch (err) {
    console.error("Open Cascade parsing exception:", err);
    throw err;
  }
}

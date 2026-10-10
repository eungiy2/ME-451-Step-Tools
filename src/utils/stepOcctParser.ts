import {
  loadOcct,
  resolveOcctLoadOptions,
  type OcctTopologyMode,
} from "./occtLoader";
import {
  EMPTY_OCCT_TOPOLOGY_OFFSETS,
  hasNativeOcctTopology,
  normalizeOcctMeshTopology,
} from "./occtTopologyPayload";
import { attachStepTopologyToLines, extractStepTopology } from "./stepTopology";

export interface OcctTessellationParams {
  linearDeflection?: number;
  angularDeflection?: number;
  topologyMode?: OcctTopologyMode;
  nativeWrapperUrl?: string;
  /**
   * Pre-constructed OCCT instance (e.g. a Node script that loads the local
   * `occt-import-js` wasm with a filesystem locateFile because the CDN/global
   * wrapper is unavailable). When provided, the loader is not invoked.
   */
  occtInstance?: any;
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
  const loadOptions = resolveOcctLoadOptions({
    topologyMode: params.occtInstance ? "tessellation" : params.topologyMode,
    nativeWrapperUrl: params.nativeWrapperUrl,
  });
  const occt = params.occtInstance || await loadOcct(loadOptions);
  
  // Gather linear and angular deflection bounds
  const linearDeflection = params.linearDeflection ?? 0.1;
  const angularDeflection = params.angularDeflection ?? 0.10;
  
  const parseConfig = {
    linearDeflection: Number(linearDeflection),
    angularDeflection: Number(angularDeflection),
  };

  try {
    // Run WebAssembly Open Cascade Tessellator
    let result;
    try {
      result = occt.ReadStepFile(fileBuffer, parseConfig);
    } catch (nativeError) {
      if (loadOptions.topologyMode !== "native") throw nativeError;
      console.warn(
        "Native OCCT wrapper failed while reading STEP; retrying with the standard wrapper.",
        nativeError
      );
      const fallbackOcct = await loadOcct({ topologyMode: "tessellation" });
      result = fallbackOcct.ReadStepFile(fileBuffer, parseConfig);
    }
    
    if (result && result.success && result.meshes) {
      const stepTopology = extractStepTopology(new TextDecoder("utf-8").decode(fileBuffer));
      const normalizedMeshes: any[] = [];
      const auxiliaryMeshes: any[] = [];
      const globalFaceIndex = { value: 0 };
      const hasSolidMesh = result.meshes.some((mesh: any) => /^SOLID\b/i.test(mesh.name || ""));
      const isAuxiliarySourceMesh = (mesh: any) => hasSolidMesh && !/^SOLID\b/i.test(mesh.name || "");

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

      const topologySourceMeshes = result.meshes.filter(
        (mesh: any) => !isAuxiliarySourceMesh(mesh)
      );
      const hasCompleteNativeTopology =
        topologySourceMeshes.length > 0 &&
        topologySourceMeshes.every(hasNativeOcctTopology);

      if (hasCompleteNativeTopology) {
        try {
          let offsets = { ...EMPTY_OCCT_TOPOLOGY_OFFSETS };
          const nativeTopologyParts = topologySourceMeshes.map((mesh: any) => {
            const topology = normalizeOcctMeshTopology(mesh, offsets);
            offsets = topology.nextOffsets;
            return topology;
          });

          if (offsets.face !== normalizedMeshes.length) {
            throw new Error(
              `Native OCCT face count ${offsets.face} does not match rendered face count ${normalizedMeshes.length}`
            );
          }

          const nativeFaces = nativeTopologyParts.flatMap((topology) => topology.faces);
          nativeFaces.forEach((face, faceIndex) => {
            Object.assign(normalizedMeshes[faceIndex], {
              topologySource: "occt",
              topologySignature: face.topologySignature,
              nativeIndex: face.nativeIndex,
              surfaceType: face.surfaceType,
              nativeArea: face.area,
              nativeCentroid: face.centroid,
              nativeBounds: face.bounds,
              nativeLoopIds: face.loopIds,
              nativeEdgeIds: face.edgeIds,
            });
          });

          const nativeLines = nativeTopologyParts.flatMap((topology) =>
            topology.edges.map((edge) => ({
              ...edge,
              parentFaceIndex: edge.parentFaceIndices[0],
              parentFaceId: edge.parentFaceIds[0],
            }))
          );
          const topologyLines = attachStepTopologyToLines(nativeLines, stepTopology);

          return {
            success: true,
            meshes: normalizedMeshes,
            lines: topologyLines,
            edges: topologyLines,
            faces: nativeFaces,
            vertices: nativeTopologyParts.flatMap((topology) => topology.vertices),
            loops: nativeTopologyParts.flatMap((topology) => topology.loops),
            nativeTopology: stepTopology,
            geometryTopologySource: "occt",
            auxiliaryMeshes,
            auxiliaryMeshCount: auxiliaryMeshes.length,
          };
        } catch (error) {
          console.warn(
            "Native OCCT topology payload failed validation; reconstructing topology from tessellation.",
            error
          );
        }
      }

      // 2. Extract face-to-face intersection edge segments globally. A viewer
      // B-Rep edge is selectable only when the same boundary segment is shared
      // by at least two B-Rep faces; single-face loop contours are not edges.
      const edgeSegmentMap = new Map<string, {
        positions: number[];
        faceIndices: Set<number>;
        faceIds: Set<string>;
      }>();
      const edgeEndpointKeys = new Map<string, [string, string]>();
      const pointByCoordinateKey = new Map<string, [number, number, number]>();
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
        const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
        const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
        const aKey = coordinateKey(ax, ay, az);
        const bKey = coordinateKey(bx, by, bz);
        pointByCoordinateKey.set(aKey, [ax, ay, az]);
        pointByCoordinateKey.set(bKey, [bx, by, bz]);
        const key = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
        edgeEndpointKeys.set(key, [aKey, bKey]);
        const existing = edgeSegmentMap.get(key);
        if (existing) {
          existing.faceIndices.add(faceIdx);
          existing.faceIds.add(`BRepFace-${faceIdx}`);
          return;
        }

        edgeSegmentMap.set(key, {
          positions: [
            ax, ay, az,
            bx, by, bz
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

      const sharedEdgeEntries = Array.from(edgeSegmentMap.entries())
        .filter(([, edge]) => edge.faceIndices.size >= 2);
      const sharedSegmentsByFacePair = new Map<string, Array<{
        edgeKey: string;
        edge: {
          positions: number[];
          faceIndices: Set<number>;
          faceIds: Set<string>;
        };
        endpointKeys: [string, string];
      }>>();
      sharedEdgeEntries.forEach(([edgeKey, edge]) => {
        const faceIndices = Array.from(edge.faceIndices).sort((a, b) => a - b).slice(0, 2);
        if (faceIndices.length < 2) return;
        const endpointKeys = edgeEndpointKeys.get(edgeKey);
        if (!endpointKeys) return;
        const facePairKey = faceIndices.join("|");
        const segments = sharedSegmentsByFacePair.get(facePairKey) || [];
        segments.push({ edgeKey, edge, endpointKeys });
        sharedSegmentsByFacePair.set(facePairKey, segments);
      });

      const edgeIndexByKey = new Map<string, number>();
      const lines: any[] = [];

      sharedSegmentsByFacePair.forEach((segments) => {
        const adjacency = new Map<string, string[]>();
        const segmentByKey = new Map(segments.map((segment) => [segment.edgeKey, segment]));
        segments.forEach((segment) => {
          const [aKey, bKey] = segment.endpointKeys;
          const aEdges = adjacency.get(aKey) || [];
          const bEdges = adjacency.get(bKey) || [];
          aEdges.push(segment.edgeKey);
          bEdges.push(segment.edgeKey);
          adjacency.set(aKey, aEdges);
          adjacency.set(bKey, bEdges);
        });

        const unvisited = new Set(segments.map((segment) => segment.edgeKey));
        while (unvisited.size > 0) {
          const [startKey] = unvisited;
          const pending = [startKey];
          const componentKeys: string[] = [];
          unvisited.delete(startKey);

          while (pending.length > 0) {
            const currentKey = pending.pop()!;
            componentKeys.push(currentKey);
            const segment = segmentByKey.get(currentKey);
            if (!segment) continue;
            segment.endpointKeys.forEach((pointKey) => {
              (adjacency.get(pointKey) || []).forEach((neighborKey) => {
                if (unvisited.has(neighborKey)) {
                  unvisited.delete(neighborKey);
                  pending.push(neighborKey);
                }
              });
            });
          }

          const componentSegments = componentKeys
            .map((edgeKey) => segmentByKey.get(edgeKey))
            .filter((segment): segment is NonNullable<typeof segment> => !!segment);
          if (componentSegments.length === 0) continue;
          const firstEdge = componentSegments[0].edge;
          const faceIndices = Array.from(firstEdge.faceIndices).sort((a, b) => a - b);
          const faceIds = Array.from(firstEdge.faceIds).sort();
          const positions = componentSegments.flatMap((segment) => segment.edge.positions);
          const componentPointDegree = new Map<string, number>();
          componentSegments.forEach((segment) => {
            segment.endpointKeys.forEach((pointKey) => {
              componentPointDegree.set(pointKey, (componentPointDegree.get(pointKey) || 0) + 1);
            });
          });
          const openVertexKeys = Array.from(componentPointDegree.entries())
            .filter(([, degree]) => degree !== 2)
            .map(([pointKey]) => pointKey);
          const vertexKeys = openVertexKeys.length > 0
            ? openVertexKeys
            : [componentSegments[0].endpointKeys[0]];
          const vertexPoints = vertexKeys
            .map((pointKey) => pointByCoordinateKey.get(pointKey))
            .filter((point): point is [number, number, number] => !!point)
            .map(([x, y, z]) => ({ x, y, z }));
          const idx = lines.length;
          componentKeys.forEach((edgeKey) => edgeIndexByKey.set(edgeKey, idx));
          const parentFaceIndex = faceIndices[0] ?? -1;

          lines.push({
            positions: new Float32Array(positions),
            name: `B-Rep Edge #${idx + 1}`,
            parentFaceId: parentFaceIndex >= 0 ? `BRepFace-${parentFaceIndex}` : undefined,
            parentFaceIndex,
            parentFaceIds: faceIds,
            parentFaceIndices: faceIndices,
            vertexPoints,
          });
        }
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
      const topologyLines = attachStepTopologyToLines(lines, stepTopology);

      return {
        success: true,
        meshes: normalizedMeshes,
        lines: topologyLines,
        edges: topologyLines,
        loops,
        nativeTopology: stepTopology,
        geometryTopologySource: "tessellation",
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

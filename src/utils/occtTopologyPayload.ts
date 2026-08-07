export interface OcctTopologyPoint {
  x: number;
  y: number;
  z: number;
}

export interface OcctNativeVertexPayload {
  index: number;
  position: ArrayLike<number>;
}

export interface OcctNativeEdgePayload {
  index: number;
  positions: ArrayLike<number>;
  face_indices: ArrayLike<number>;
  vertex_indices: ArrayLike<number>;
  curve_type?: string;
  curve_length?: number;
  signature_points?: ArrayLike<ArrayLike<number>>;
  closed?: boolean;
}

export interface OcctNativeFaceDescriptorPayload {
  index: number;
  surface_type?: string;
  area?: number;
  centroid?: ArrayLike<number>;
  bounds?: ArrayLike<number>;
}

export interface OcctNativeLoopPayload {
  index: number;
  face_index: number;
  edge_indices: ArrayLike<number>;
}

/**
 * Mesh-level payload exported by the custom OCCT WebAssembly wrapper.
 * Indices are local to the source mesh and follow OCCT's indexed topology maps.
 */
export interface OcctNativeMeshPayload {
  topology_source: "occt";
  brep_faces: ArrayLike<unknown>;
  brep_vertices: ArrayLike<OcctNativeVertexPayload>;
  brep_edges: ArrayLike<OcctNativeEdgePayload>;
  brep_loops: ArrayLike<OcctNativeLoopPayload>;
  brep_face_descriptors?: ArrayLike<OcctNativeFaceDescriptorPayload>;
}

export interface OcctTopologyOffsets {
  face: number;
  edge: number;
  vertex: number;
  loop: number;
}

export interface NormalizedOcctVertex {
  id: string;
  nativeIndex: number;
  point: OcctTopologyPoint;
  topologySignature: string;
}

export interface NormalizedOcctEdge {
  id: string;
  name: string;
  nativeIndex: number;
  positions: Float32Array;
  parentFaceIndices: number[];
  parentFaceIds: string[];
  vertexIds: string[];
  vertexPoints: OcctTopologyPoint[];
  curveType: string;
  curveLength?: number;
  closed: boolean;
  topologySource: "occt";
  topologySignature: string;
}

export interface NormalizedOcctLoop {
  id: string;
  nativeIndex: number;
  faceIndex: number;
  faceId: string;
  edgeIds: string[];
  topologySignature: string;
}

export interface NormalizedOcctFaceTopology {
  id: string;
  nativeIndex: number;
  surfaceType: string;
  area?: number;
  centroid?: OcctTopologyPoint;
  bounds?: [number, number, number, number, number, number];
  loopIds: string[];
  edgeIds: string[];
  topologySignature: string;
}

export interface NormalizedOcctMeshTopology {
  faces: NormalizedOcctFaceTopology[];
  vertices: NormalizedOcctVertex[];
  edges: NormalizedOcctEdge[];
  loops: NormalizedOcctLoop[];
  nextOffsets: OcctTopologyOffsets;
}

export const EMPTY_OCCT_TOPOLOGY_OFFSETS: OcctTopologyOffsets = {
  face: 0,
  edge: 0,
  vertex: 0,
  loop: 0,
};

const toArray = <T>(values: ArrayLike<T>): T[] => Array.from(values);

const canonicalNumber = (value: number) => {
  if (!Number.isFinite(value)) return "invalid";
  const normalized = Object.is(value, -0) ? 0 : value;
  return normalized.toPrecision(12);
};

const pointKey = (point: OcctTopologyPoint) =>
  `${canonicalNumber(point.x)},${canonicalNumber(point.y)},${canonicalNumber(point.z)}`;

const hashSignature = (kind: string, value: string) => {
  let hash = 14695981039346656037n;
  const prime = 1099511628211n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return `occt:v1:${kind}:${hash.toString(16).padStart(16, "0")}`;
};

const canonicalSequence = (values: string[]) => {
  if (values.length <= 1) return values.join("|");
  const forward = values.join("|");
  const reverse = [...values].reverse().join("|");
  return forward < reverse ? forward : reverse;
};

const canonicalCycle = (values: string[]) => {
  if (values.length <= 1) return values.join("|");
  const candidates: string[] = [];
  const addRotations = (sequence: string[]) => {
    for (let offset = 0; offset < sequence.length; offset++) {
      candidates.push([...sequence.slice(offset), ...sequence.slice(0, offset)].join("|"));
    }
  };
  addRotations(values);
  addRotations([...values].reverse());
  return candidates.sort()[0];
};

const requireNonNegativeInteger = (value: number, label: string) => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid OCCT topology ${label}: ${value}`);
  }
  return value;
};

const requireUniqueIndices = <T extends { index: number }>(records: T[], label: string) => {
  const indices = new Set<number>();
  records.forEach((record) => {
    requireNonNegativeInteger(record.index, `${label} index`);
    if (indices.has(record.index)) {
      throw new Error(`Duplicate OCCT topology ${label} index: ${record.index}`);
    }
    indices.add(record.index);
  });
};

const requirePoint = (position: ArrayLike<number>, label: string): OcctTopologyPoint => {
  if (position.length !== 3) {
    throw new Error(`Invalid OCCT topology ${label}: expected three coordinates`);
  }
  const point = {
    x: Number(position[0]),
    y: Number(position[1]),
    z: Number(position[2]),
  };
  if (!Object.values(point).every(Number.isFinite)) {
    throw new Error(`Invalid OCCT topology ${label}: coordinates must be finite`);
  }
  return point;
};

const requireSegmentPositions = (positions: ArrayLike<number>, edgeIndex: number) => {
  const values = toArray(positions).map(Number);
  if (values.length < 6 || values.length % 6 !== 0 || !values.every(Number.isFinite)) {
    throw new Error(
      `Invalid OCCT topology edge ${edgeIndex}: positions must contain finite line-segment endpoint pairs`
    );
  }
  return new Float32Array(values);
};

const requireReferencedIndices = (
  values: ArrayLike<number>,
  validIndices: Set<number>,
  label: string
) => toArray(values).map((value) => {
  const index = requireNonNegativeInteger(Number(value), label);
  if (!validIndices.has(index)) {
    throw new Error(`Invalid OCCT topology ${label}: missing index ${index}`);
  }
  return index;
});

export const hasNativeOcctTopology = (mesh: unknown): mesh is OcctNativeMeshPayload => {
  if (!mesh || typeof mesh !== "object") return false;
  const candidate = mesh as Partial<OcctNativeMeshPayload>;
  return candidate.topology_source === "occt"
    && candidate.brep_faces !== undefined
    && candidate.brep_vertices !== undefined
    && candidate.brep_edges !== undefined
    && candidate.brep_loops !== undefined;
};

/**
 * Validates one wrapper mesh payload and converts its local OCCT indices into
 * the global BRepFace/BRepEdge/BRepVertex/BRepLoop namespace used by the viewer.
 */
export function normalizeOcctMeshTopology(
  mesh: OcctNativeMeshPayload,
  offsets: OcctTopologyOffsets = EMPTY_OCCT_TOPOLOGY_OFFSETS
): NormalizedOcctMeshTopology {
  if (!hasNativeOcctTopology(mesh)) {
    throw new Error("OCCT mesh does not contain native topology");
  }

  const faceCount = mesh.brep_faces.length;
  const rawVertices = toArray(mesh.brep_vertices).sort((a, b) => a.index - b.index);
  const rawEdges = toArray(mesh.brep_edges).sort((a, b) => a.index - b.index);
  const rawLoops = toArray(mesh.brep_loops).sort((a, b) => a.index - b.index);
  const rawFaceDescriptors = mesh.brep_face_descriptors
    ? toArray(mesh.brep_face_descriptors).sort((a, b) => a.index - b.index)
    : [];
  requireUniqueIndices(rawVertices, "vertex");
  requireUniqueIndices(rawEdges, "edge");
  requireUniqueIndices(rawLoops, "loop");
  requireUniqueIndices(rawFaceDescriptors, "face descriptor");

  const localFaceIndices = new Set(Array.from({ length: faceCount }, (_, index) => index));
  const localVertexIndices = new Set(rawVertices.map((vertex) => vertex.index));
  const localEdgeIndices = new Set(rawEdges.map((edge) => edge.index));
  if (rawFaceDescriptors.length > 0) {
    if (rawFaceDescriptors.length !== faceCount) {
      throw new Error(
        `Invalid OCCT topology face descriptors: expected ${faceCount}, received ${rawFaceDescriptors.length}`
      );
    }
    requireReferencedIndices(
      rawFaceDescriptors.map((descriptor) => descriptor.index),
      localFaceIndices,
      "face descriptor"
    );
  }

  const rawVertexPointByIndex = new Map(
    rawVertices.map((vertex) => [
      vertex.index,
      requirePoint(vertex.position, `vertex ${vertex.index}`)
    ])
  );
  const getFallbackSignaturePoints = (
    positions: Float32Array,
    nativeVertexIndices: number[]
  ): OcctTopologyPoint[] => {
    const endpointPoints = nativeVertexIndices
      .map((index) => rawVertexPointByIndex.get(index))
      .filter((point): point is OcctTopologyPoint => !!point);
    if (endpointPoints.length >= 2) return endpointPoints;

    const points: OcctTopologyPoint[] = [];
    const pointCount = positions.length / 3;
    const sampleCount = Math.min(5, pointCount);
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
      const pointIndex = Math.round((pointCount - 1) * sampleIndex / Math.max(sampleCount - 1, 1));
      points.push({
        x: positions[pointIndex * 3],
        y: positions[pointIndex * 3 + 1],
        z: positions[pointIndex * 3 + 2]
      });
    }
    return points;
  };
  const getPolylineLength = (positions: Float32Array) => {
    let length = 0;
    for (let offset = 0; offset + 5 < positions.length; offset += 6) {
      length += Math.hypot(
        positions[offset + 3] - positions[offset],
        positions[offset + 4] - positions[offset + 1],
        positions[offset + 5] - positions[offset + 2]
      );
    }
    return length;
  };

  const edgeDrafts = rawEdges.map((edge, order) => {
    const id = `BRepEdge-${offsets.edge + order}`;
    const positions = requireSegmentPositions(edge.positions, edge.index);
    const faceIndices = requireReferencedIndices(
      edge.face_indices,
      localFaceIndices,
      `edge ${edge.index} face`
    );
    const nativeVertexIndices = requireReferencedIndices(
      edge.vertex_indices,
      localVertexIndices,
      `edge ${edge.index} vertex`
    );
    const analyticalSignaturePoints = edge.signature_points
      ? toArray(edge.signature_points)
        .map((position, index) => requirePoint(position, `edge ${edge.index} signature point ${index}`))
      : [];
    const signaturePoints = analyticalSignaturePoints.length >= 2
      ? analyticalSignaturePoints
      : getFallbackSignaturePoints(positions, nativeVertexIndices);
    const signaturePointKeys = signaturePoints.map(pointKey);
    const curveLength = Number.isFinite(edge.curve_length) && Number(edge.curve_length) > 0
      ? Number(edge.curve_length)
      : getPolylineLength(positions);
    const geometryKey = [
      edge.curve_type || "other",
      edge.closed === true ? "closed" : "open",
      canonicalNumber(curveLength),
      canonicalSequence(signaturePointKeys)
    ].join("|");
    return {
      id,
      order,
      raw: edge,
      positions,
      faceIndices,
      nativeVertexIndices,
      curveLength,
      geometrySignature: hashSignature("edge-geometry", geometryKey)
    };
  });

  const incidentEdgeGeometryByVertex = new Map<number, string[]>();
  edgeDrafts.forEach((edge) => {
    edge.nativeVertexIndices.forEach((vertexIndex) => {
      const incident = incidentEdgeGeometryByVertex.get(vertexIndex) || [];
      incident.push(edge.geometrySignature);
      incidentEdgeGeometryByVertex.set(vertexIndex, incident);
    });
  });

  const vertexByNativeIndex = new Map<number, NormalizedOcctVertex>();
  const vertices = rawVertices.map((vertex, order) => {
    const point = rawVertexPointByIndex.get(vertex.index)!;
    const incidentGeometry = (incidentEdgeGeometryByVertex.get(vertex.index) || []).sort();
    const normalized = {
      id: `BRepVertex-${offsets.vertex + order}`,
      nativeIndex: vertex.index,
      point,
      topologySignature: hashSignature(
        "vertex",
        `${pointKey(point)}|${incidentGeometry.join("|")}`
      )
    };
    vertexByNativeIndex.set(vertex.index, normalized);
    return normalized;
  });

  const edgeByNativeIndex = new Map<number, NormalizedOcctEdge>();
  const edges = edgeDrafts.map((draft) => {
    const edge = draft.raw;
    const edgeVertices = draft.nativeVertexIndices.map((index) => vertexByNativeIndex.get(index)!);
    const topologySignature = hashSignature(
      "edge",
      `${draft.geometrySignature}|${edgeVertices.map((vertex) => vertex.topologySignature).sort().join("|")}`
    );
    const normalized = {
      id: draft.id,
      name: `B-Rep Edge #${offsets.edge + draft.order + 1}`,
      nativeIndex: edge.index,
      positions: draft.positions,
      parentFaceIndices: draft.faceIndices.map((index) => offsets.face + index),
      parentFaceIds: draft.faceIndices.map((index) => `BRepFace-${offsets.face + index}`),
      vertexIds: edgeVertices.map((vertex) => vertex.id),
      vertexPoints: edgeVertices.map((vertex) => vertex.point),
      curveType: edge.curve_type || "other",
      curveLength: draft.curveLength,
      closed: edge.closed === true,
      topologySource: "occt" as const,
      topologySignature
    };
    edgeByNativeIndex.set(edge.index, normalized);
    return normalized;
  });

  const faceDescriptorByIndex = new Map(
    rawFaceDescriptors.map((descriptor) => [descriptor.index, descriptor])
  );
  const getOptionalPoint = (
    position: ArrayLike<number> | undefined,
    label: string
  ) => position && position.length > 0 ? requirePoint(position, label) : undefined;
  const getOptionalBounds = (
    values: ArrayLike<number> | undefined,
    label: string
  ): [number, number, number, number, number, number] | undefined => {
    if (!values || values.length === 0) return undefined;
    const bounds = toArray(values).map(Number);
    if (bounds.length !== 6 || !bounds.every(Number.isFinite)) {
      throw new Error(`Invalid OCCT topology ${label}: expected six finite coordinates`);
    }
    return bounds as [number, number, number, number, number, number];
  };
  const faceDescriptorKeyByIndex = new Map<number, string>();
  for (let faceIndex = 0; faceIndex < faceCount; faceIndex++) {
    const descriptor = faceDescriptorByIndex.get(faceIndex);
    const centroid = getOptionalPoint(descriptor?.centroid, `face ${faceIndex} centroid`);
    const bounds = getOptionalBounds(descriptor?.bounds, `face ${faceIndex} bounds`);
    faceDescriptorKeyByIndex.set(faceIndex, [
      descriptor?.surface_type || "other",
      Number.isFinite(descriptor?.area) ? canonicalNumber(Number(descriptor?.area)) : "unknown-area",
      centroid ? pointKey(centroid) : "unknown-centroid",
      bounds ? bounds.map(canonicalNumber).join(",") : "unknown-bounds"
    ].join("|"));
  }

  const loops = rawLoops.map((loop, order) => {
    const localFaceIndex = requireNonNegativeInteger(loop.face_index, `loop ${loop.index} face`);
    if (!localFaceIndices.has(localFaceIndex)) {
      throw new Error(`Invalid OCCT topology loop ${loop.index} face: missing index ${localFaceIndex}`);
    }
    const nativeEdgeIndices = requireReferencedIndices(
      loop.edge_indices,
      localEdgeIndices,
      `loop ${loop.index} edge`
    );
    const faceIndex = offsets.face + localFaceIndex;
    const loopEdges = nativeEdgeIndices.map((index) => edgeByNativeIndex.get(index)!);
    return {
      id: `BRepLoop-${offsets.loop + order}`,
      nativeIndex: loop.index,
      faceIndex,
      faceId: `BRepFace-${faceIndex}`,
      edgeIds: loopEdges.map((edge) => edge.id),
      topologySignature: hashSignature(
        "loop",
        `${faceDescriptorKeyByIndex.get(localFaceIndex)}|${canonicalCycle(
          loopEdges.map((edge) => edge.topologySignature)
        )}`
      )
    };
  });

  const faces = Array.from({ length: faceCount }, (_, localFaceIndex) => {
    const descriptor = faceDescriptorByIndex.get(localFaceIndex);
    const faceLoops = loops.filter((loop) => loop.faceIndex === offsets.face + localFaceIndex);
    const edgeIds = faceLoops
      .flatMap((loop) => loop.edgeIds)
      .filter((edgeId, index, all) => all.indexOf(edgeId) === index);
    const centroid = getOptionalPoint(descriptor?.centroid, `face ${localFaceIndex} centroid`);
    const bounds = getOptionalBounds(descriptor?.bounds, `face ${localFaceIndex} bounds`);
    return {
      id: `BRepFace-${offsets.face + localFaceIndex}`,
      nativeIndex: localFaceIndex,
      surfaceType: descriptor?.surface_type || "other",
      area: Number.isFinite(descriptor?.area) ? Number(descriptor?.area) : undefined,
      centroid,
      bounds,
      loopIds: faceLoops.map((loop) => loop.id),
      edgeIds,
      topologySignature: hashSignature(
        "face",
        `${faceDescriptorKeyByIndex.get(localFaceIndex)}|${faceLoops
          .map((loop) => loop.topologySignature)
          .sort()
          .join("|")}`
      )
    };
  });

  return {
    faces,
    vertices,
    edges,
    loops,
    nextOffsets: {
      face: offsets.face + faceCount,
      edge: offsets.edge + edges.length,
      vertex: offsets.vertex + vertices.length,
      loop: offsets.loop + loops.length,
    },
  };
}

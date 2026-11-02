export interface OcctTopologyPoint {
  x: number;
  y: number;
  z: number;
}

export interface OcctNativeVertexPayload {
  index: number;
  position: ArrayLike<number>;
}

/**
 * Exact analytic parameters of an OCCT surface primitive, computed in the
 * kernel via `BRepAdaptor_Surface::Plane()/Cylinder()/Cone()/Sphere()/Torus()`.
 * Exactly one key is present; synthetic surfaces (B-splines, offsets, ...)
 * provide no `analytic` entry.
 */
export interface OcctAnalyticSurfacePayload {
  plane?: { normal: ArrayLike<number>; point: ArrayLike<number> };
  cylinder?: { axis: ArrayLike<number>; center: ArrayLike<number>; radius: number };
  cone?: { axis: ArrayLike<number>; apex: ArrayLike<number>; semiAngleDeg: number; radius?: number };
  sphere?: { center: ArrayLike<number>; radius: number };
  torus?: { center: ArrayLike<number>; axis: ArrayLike<number>; majorRadius: number; minorRadius: number };
}

/**
 * Normalized, validated analytic surface parameters with typed vector math
 * values (instead of raw `ArrayLike<number>` payload arrays).
 */
export interface NormalizedOcctFaceAnalytic {
  plane?: { normal: OcctTopologyPoint; point: OcctTopologyPoint };
  cylinder?: { axis: OcctTopologyPoint; center: OcctTopologyPoint; radius: number };
  cone?: { axis: OcctTopologyPoint; apex: OcctTopologyPoint; semiAngleDeg: number; radius?: number };
  sphere?: { center: OcctTopologyPoint; radius: number };
  torus?: { center: OcctTopologyPoint; axis: OcctTopologyPoint; majorRadius: number; minorRadius: number };
}

/**
 * Kernel-computed adjacency classification for one incident-face pair of an
 * edge. `face_i`/`face_j` are local face indices (the lexicographically-smaller
 * `BRepFace-*` id is always `face_i`, matching the exporter's sorted pair
 * order). `dihedral_deg` is the interior dihedral angle measured through the
 * solid.
 */
export interface OcctNativeContactPayload {
  face_i: number;
  face_j: number;
  convexity: "convex" | "concave";
  dihedral_deg: number;
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
  /** Kernel edge-curve midpoint (3 coordinates). */
  midpoint?: ArrayLike<number>;
  /** Per-incident-face outward unit normal at the edge midpoint, aligned with
   *  `face_indices`; a null entry means the normal could not be evaluated. */
  normals?: ArrayLike<ArrayLike<number> | null>;
  contacts?: ArrayLike<OcctNativeContactPayload>;
}

export interface OcctNativeFaceDescriptorPayload {
  index: number;
  surface_type?: string;
  area?: number;
  centroid?: ArrayLike<number>;
  bounds?: ArrayLike<number>;
  /** Exact analytic surface parameters (see `OcctAnalyticSurfacePayload`). */
  analytic?: OcctAnalyticSurfacePayload;
  /** Kernel face-level convexity ("convex" | "concave" | "unknown"). */
  convexity?: string;
  /** Surface point nearest the face center of gravity (3 coordinates). */
  centroid_point?: ArrayLike<number>;
  /** Outward unit normal at `centroid_point` (3 coordinates). */
  centroid_normal?: ArrayLike<number>;
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
  /** Kernel edge-curve midpoint. */
  midpoint?: OcctTopologyPoint;
  /** Kernel outward unit normals at the edge midpoint, aligned with
   *  `parentFaceIndices`; null entries mean the kernel could not evaluate the
   *  normal for that face. */
  faceNormals?: Array<OcctTopologyPoint | null>;
  /** Kernel adjacency classification per incident-face pair. */
  contacts?: NormalizedOcctContact[];
}

export interface NormalizedOcctContact {
  faceAId: string;
  faceBId: string;
  convexity: "convex" | "concave";
  dihedralDeg: number;
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
  /** Exact analytic surface parameters from the kernel. */
  analytic?: NormalizedOcctFaceAnalytic;
  /** Kernel face-level convexity ("convex" | "concave" | "unknown"). */
  convexity?: string;
  /** Surface point nearest the face center of gravity. */
  centroidPoint?: OcctTopologyPoint;
  /** Outward unit normal at `centroidPoint`. */
  centroidNormal?: OcctTopologyPoint;
}

export interface NormalizedOcctMeshTopology {
  faces: NormalizedOcctFaceTopology[];
  vertices: NormalizedOcctVertex[];
  edges: NormalizedOcctEdge[];
  loops: NormalizedOcctLoop[];
  nextOffsets: OcctTopologyOffsets;
  /** True when this mesh's payload carried the kernel graph attributes
   *  (analytic surface parameters, edge midpoint/normals/contacts). */
  kernelGraphAttributes: boolean;
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

const requireOptionalFinitePoint = (
  values: ArrayLike<number> | undefined,
  label: string
): OcctTopologyPoint | undefined => {
  if (values === undefined || values === null || values.length === 0) return undefined;
  return requirePoint(values, label);
};

const requireOptionalDirection = (
  values: ArrayLike<number> | undefined,
  label: string
): OcctTopologyPoint | undefined => {
  const point = requireOptionalFinitePoint(values, label);
  if (!point) return undefined;
  const length = Math.hypot(point.x, point.y, point.z);
  if (length <= 1e-12) {
    throw new Error(`Invalid OCCT topology ${label}: zero-length direction`);
  }
  return { x: point.x / length, y: point.y / length, z: point.z / length };
};

const requireConvexityLabel = (value: unknown, label: string): string | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const text = String(value);
  if (text === "convex" || text === "concave" || text === "unknown") return text;
  throw new Error(`Invalid OCCT topology ${label}: unrecognized convexity "${text}"`);
};

const requireAnalytic = (
  raw: unknown,
  label: string
): NormalizedOcctFaceAnalytic | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const analytic = raw as Record<string, unknown>;
  const result: NormalizedOcctFaceAnalytic = {};

  if (analytic.plane) {
    const plane = analytic.plane as { normal?: ArrayLike<number>; point?: ArrayLike<number> };
    result.plane = {
      normal: requireOptionalDirection(plane.normal, `${label} analytic plane normal`),
      point: requireOptionalFinitePoint(plane.point, `${label} analytic plane point`),
    };
  } else if (analytic.cylinder) {
    const cylinder = analytic.cylinder as {
      axis?: ArrayLike<number>;
      center?: ArrayLike<number>;
      radius?: unknown;
    };
    const radius = Number(cylinder.radius);
    if (!Number.isFinite(radius) || radius <= 0) {
      throw new Error(`Invalid OCCT topology ${label} analytic cylinder radius: ${cylinder.radius}`);
    }
    result.cylinder = {
      axis: requireOptionalDirection(cylinder.axis, `${label} analytic cylinder axis`),
      center: requireOptionalFinitePoint(cylinder.center, `${label} analytic cylinder center`),
      radius,
    };
  } else if (analytic.cone) {
    const cone = analytic.cone as {
      axis?: ArrayLike<number>;
      apex?: ArrayLike<number>;
      semiAngleDeg?: unknown;
      radius?: unknown;
    };
    const semiAngleDeg = Number(cone.semiAngleDeg);
    if (!Number.isFinite(semiAngleDeg)) {
      throw new Error(`Invalid OCCT topology ${label} analytic cone semi-angle`);
    }
    const radius = Number(cone.radius);
    result.cone = {
      axis: requireOptionalDirection(cone.axis, `${label} analytic cone axis`),
      apex: requireOptionalFinitePoint(cone.apex, `${label} analytic cone apex`),
      semiAngleDeg,
      ...(Number.isFinite(radius) && radius > 0 ? { radius } : {}),
    };
  } else if (analytic.sphere) {
    const sphere = analytic.sphere as { center?: ArrayLike<number>; radius?: unknown };
    const radius = Number(sphere.radius);
    if (!Number.isFinite(radius) || radius <= 0) {
      throw new Error(`Invalid OCCT topology ${label} analytic sphere radius: ${sphere.radius}`);
    }
    result.sphere = {
      center: requireOptionalFinitePoint(sphere.center, `${label} analytic sphere center`),
      radius,
    };
  } else if (analytic.torus) {
    const torus = analytic.torus as {
      center?: ArrayLike<number>;
      axis?: ArrayLike<number>;
      majorRadius?: unknown;
      minorRadius?: unknown;
    };
    const majorRadius = Number(torus.majorRadius);
    const minorRadius = Number(torus.minorRadius);
    if (!Number.isFinite(majorRadius) || majorRadius <= 0 ||
        !Number.isFinite(minorRadius) || minorRadius <= 0) {
      throw new Error(`Invalid OCCT topology ${label} analytic torus radii`);
    }
    result.torus = {
      center: requireOptionalFinitePoint(torus.center, `${label} analytic torus center`),
      axis: requireOptionalDirection(torus.axis, `${label} analytic torus axis`),
      majorRadius,
      minorRadius,
    };
  }

  return Object.keys(result).length > 0 ? result : undefined;
};

const requireContact = (
  contact: unknown,
  validFaceIndices: Set<number>,
  label: string
): { faceI: number; faceJ: number; convexity: "convex" | "concave"; dihedralDeg: number } => {
  if (!contact || typeof contact !== "object") {
    throw new Error(`Invalid OCCT topology ${label}: contact is not an object`);
  }
  const raw = contact as Record<string, unknown>;
  const faceI = requireNonNegativeInteger(Number(raw.face_i), `${label} face_i`);
  const faceJ = requireNonNegativeInteger(Number(raw.face_j), `${label} face_j`);
  if (!validFaceIndices.has(faceI) || !validFaceIndices.has(faceJ)) {
    throw new Error(`Invalid OCCT topology ${label}: contact references missing face index`);
  }
  if (faceI >= faceJ) {
    throw new Error(`Invalid OCCT topology ${label}: contact faces must be ordered (i < j)`);
  }
  const convexity = String(raw.convexity);
  if (convexity !== "convex" && convexity !== "concave") {
    throw new Error(`Invalid OCCT topology ${label}: unrecognized contact convexity "${convexity}"`);
  }
  const dihedralDeg = Number(raw.dihedral_deg);
  if (!Number.isFinite(dihedralDeg)) {
    throw new Error(`Invalid OCCT topology ${label}: contact dihedral must be finite`);
  }
  return {
    faceI,
    faceJ,
    convexity: convexity,
    dihedralDeg,
  };
};

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
    const midpoint = requireOptionalFinitePoint(
      edge.midpoint,
      `edge ${edge.index} midpoint`
    );
    const faceNormals = edge.normals
      ? toArray(edge.normals).map((normal, index) =>
          normal
            ? requireOptionalDirection(normal, `edge ${edge.index} normal ${index}`)
            : null
        )
      : undefined;
    const contacts = edge.contacts
      ? toArray(edge.contacts).map((contact, index) => {
          const required = requireContact(
            contact,
            localFaceIndices,
            `edge ${edge.index} contact ${index}`
          );
          return {
            faceAId: `BRepFace-${offsets.face + required.faceI}`,
            faceBId: `BRepFace-${offsets.face + required.faceJ}`,
            convexity: required.convexity,
            dihedralDeg: required.dihedralDeg,
          };
        })
      : undefined;
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
      topologySignature,
      ...(midpoint ? { midpoint } : {}),
      ...(faceNormals ? { faceNormals } : {}),
      ...(contacts && contacts.length > 0 ? { contacts } : {}),
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
  const analyticKeyFromPayload = (analytic: OcctAnalyticSurfacePayload | undefined): string => {
    if (!analytic) return "unknown-analytic";
    const keyPart = (values: ArrayLike<number> | undefined) =>
      values ? toArray(values).map(canonicalNumber).join(",") : "-";
    const parts: string[] = [];
    if (analytic.plane) {
      parts.push(`plane:n=${keyPart(analytic.plane.normal)};p=${keyPart(analytic.plane.point)}`);
    }
    if (analytic.cylinder) {
      parts.push(
        `cylinder:a=${keyPart(analytic.cylinder.axis)};c=${keyPart(analytic.cylinder.center)};r=${canonicalNumber(analytic.cylinder.radius)}`
      );
    }
    if (analytic.cone) {
      parts.push(
        `cone:a=${keyPart(analytic.cone.axis)};x=${keyPart(analytic.cone.apex)};ang=${canonicalNumber(analytic.cone.semiAngleDeg)}${analytic.cone.radius !== undefined ? `;r=${canonicalNumber(analytic.cone.radius)}` : ""}`
      );
    }
    if (analytic.sphere) {
      parts.push(`sphere:c=${keyPart(analytic.sphere.center)};r=${canonicalNumber(analytic.sphere.radius)}`);
    }
    if (analytic.torus) {
      parts.push(
        `torus:c=${keyPart(analytic.torus.center)};a=${keyPart(analytic.torus.axis)};R=${canonicalNumber(analytic.torus.majorRadius)};r=${canonicalNumber(analytic.torus.minorRadius)}`
      );
    }
    return parts.length > 0 ? parts.join("|") : "no-analytic";
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
      bounds ? bounds.map(canonicalNumber).join(",") : "unknown-bounds",
      requireConvexityLabel(descriptor?.convexity, `face ${faceIndex} convexity`) ?? "unknown-convexity",
      analyticKeyFromPayload(descriptor?.analytic),
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
    const convexity = requireConvexityLabel(descriptor?.convexity, `face ${localFaceIndex} convexity`);
    return {
      id: `BRepFace-${offsets.face + localFaceIndex}`,
      nativeIndex: localFaceIndex,
      surfaceType: descriptor?.surface_type || "other",
      area: Number.isFinite(descriptor?.area) ? Number(descriptor?.area) : undefined,
      centroid,
      bounds,
      analytic: requireAnalytic(descriptor?.analytic, `face ${localFaceIndex} analytic`),
      ...(convexity ? { convexity } : {}),
      centroidPoint: getOptionalPoint(
        descriptor?.centroid_point,
        `face ${localFaceIndex} centroid point`
      ),
      centroidNormal: requireOptionalDirection(
        descriptor?.centroid_normal,
        `face ${localFaceIndex} centroid normal`
      ),
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
    kernelGraphAttributes:
      rawEdges.length > 0
      && rawEdges.every(
        (edge) => Array.isArray(edge.midpoint) && edge.midpoint.length === 3
      )
      && rawFaceDescriptors.length === faceCount,
    nextOffsets: {
      face: offsets.face + faceCount,
      edge: offsets.edge + edges.length,
      vertex: offsets.vertex + vertices.length,
      loop: offsets.loop + loops.length,
    },
  };
}

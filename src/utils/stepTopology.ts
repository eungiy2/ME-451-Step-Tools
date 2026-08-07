export interface StepTopologyPoint {
  x: number;
  y: number;
  z: number;
}

export interface StepTopologyVertex {
  id: string;
  point?: StepTopologyPoint;
  signature: string;
}

export interface StepTopologyEdge {
  id: string;
  curveId?: string;
  curveType?: string;
  startVertexId?: string;
  endVertexId?: string;
  vertices: StepTopologyVertex[];
  faceIds: string[];
  faceIndices: number[];
  loopIds: string[];
  signature: string;
}

export interface StepTopologyLoop {
  id: string;
  faceId: string;
  faceIndex?: number;
  edgeIds: string[];
}

export interface StepTopology {
  faceIdsByIndex: string[];
  edges: StepTopologyEdge[];
  vertices: StepTopologyVertex[];
  loops: StepTopologyLoop[];
}

export interface TessellatedEdgeLine {
  positions?: ArrayLike<number>;
  parentFaceIndices?: number[];
  parentFaceIndex?: number;
  vertexPoints?: StepTopologyPoint[];
  topologySource?: "occt" | "step" | "tessellation";
  topologySignature?: string;
  [key: string]: unknown;
}

type StepEntity = {
  id: string;
  type: string;
  statement: string;
  refs: string[];
};

const getEntityType = (statement: string) =>
  statement.match(/^\s*([A-Z][A-Z0-9_]*)\s*\(/i)?.[1]?.toUpperCase() || "";

const parseCartesianPoint = (
  statement: string,
  scaleToMillimeters: number
): StepTopologyPoint | undefined => {
  const match = statement.match(
    /CARTESIAN_POINT\s*\(\s*[^,]*,\s*\(\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:E[-+]?\d+)?)\s*,\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:E[-+]?\d+)?)\s*,\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:E[-+]?\d+)?)\s*\)\s*\)/i
  );
  if (!match) return undefined;

  const point = {
    x: Number(match[1]) * scaleToMillimeters,
    y: Number(match[2]) * scaleToMillimeters,
    z: Number(match[3]) * scaleToMillimeters,
  };
  return Object.values(point).every(Number.isFinite) ? point : undefined;
};

const pointSignature = (point?: StepTopologyPoint) =>
  point
    ? `${point.x.toPrecision(12)},${point.y.toPrecision(12)},${point.z.toPrecision(12)}`
    : "unresolved";

const canonicalPair = (values: string[]) => [...values].sort().join("|");

const getStepLengthScaleToMillimeters = (entities: Map<string, StepEntity>) => {
  const siPrefixToMillimeters = (prefix: string) => {
    const powers: Record<string, number> = {
      EXA: 1e18,
      PETA: 1e15,
      TERA: 1e12,
      GIGA: 1e9,
      MEGA: 1e6,
      KILO: 1e3,
      HECTO: 1e2,
      DECA: 1e1,
      "$": 1,
      DECI: 1e-1,
      CENTI: 1e-2,
      MILLI: 1e-3,
      MICRO: 1e-6,
      NANO: 1e-9,
      PICO: 1e-12,
      FEMTO: 1e-15,
      ATTO: 1e-18,
    };
    const normalized = prefix.replace(/\./g, "").toUpperCase();
    const scaleToMeters = powers[normalized];
    return scaleToMeters === undefined ? undefined : scaleToMeters * 1000;
  };

  const getUnitScale = (unitId: string, visited = new Set<string>()): number | undefined => {
    if (visited.has(unitId)) return undefined;
    visited.add(unitId);
    const entity = entities.get(unitId);
    if (!entity || !/LENGTH_UNIT\s*\(/i.test(entity.statement)) return undefined;

    const siUnit = entity.statement.match(/SI_UNIT\s*\(\s*(\$|\.[A-Z_]+\.)\s*,\s*\.METRE\.\s*\)/i);
    if (siUnit) return siPrefixToMillimeters(siUnit[1]);

    if (/CONVERSION_BASED_UNIT\s*\(/i.test(entity.statement)) {
      for (const measureId of entity.refs) {
        const measure = entities.get(measureId);
        if (!measure || !/MEASURE_WITH_UNIT|LENGTH_MEASURE_WITH_UNIT/i.test(measure.statement)) continue;
        const valueMatch = measure.statement.match(
          /(?:LENGTH_MEASURE|POSITIVE_LENGTH_MEASURE)\s*\(\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:E[-+]?\d+)?)\s*\)/i
        );
        if (!valueMatch) continue;

        const nestedUnitId = measure.refs.find((ref) => ref !== unitId);
        const nestedScale = nestedUnitId ? getUnitScale(nestedUnitId, new Set(visited)) : 1;
        if (nestedScale !== undefined) return Number(valueMatch[1]) * nestedScale;
      }
    }

    return undefined;
  };

  for (const entity of entities.values()) {
    if (!/GEOMETRIC_REPRESENTATION_CONTEXT/i.test(entity.statement) ||
        !/GLOBAL_UNIT_ASSIGNED_CONTEXT/i.test(entity.statement)) {
      continue;
    }
    for (const unitId of entity.refs) {
      const scale = getUnitScale(unitId);
      if (scale !== undefined && Number.isFinite(scale)) return scale;
    }
  }

  for (const entityId of entities.keys()) {
    const scale = getUnitScale(entityId);
    if (scale !== undefined && Number.isFinite(scale)) return scale;
  }
  return 1;
};

/**
 * Extracts the native STEP topological graph without changing tessellation.
 * Entity IDs remain stable when the same STEP document is reopened.
 */
export function extractStepTopology(stepText: string): StepTopology {
  const entities = new Map<string, StepEntity>();
  const entityOrder: string[] = [];

  for (const match of stepText.matchAll(/(#\d+)\s*=\s*([\s\S]*?);/g)) {
    const id = match[1];
    const statement = match[2].replace(/\s+/g, " ").trim();
    entities.set(id, {
      id,
      type: getEntityType(statement),
      statement,
      refs: statement.match(/#\d+/g) || [],
    });
    entityOrder.push(id);
  }

  const faceIdsByIndex: string[] = [];
  const addFace = (faceId: string) => {
    if (!faceIdsByIndex.includes(faceId)) faceIdsByIndex.push(faceId);
  };

  entityOrder.forEach((entityId) => {
    const entity = entities.get(entityId);
    if (!entity || !/^(CLOSED_SHELL|OPEN_SHELL)$/.test(entity.type)) return;
    entity.refs.forEach((ref) => {
      if (/^(ADVANCED_FACE|FACE_SURFACE)$/.test(entities.get(ref)?.type || "")) {
        addFace(ref);
      }
    });
  });

  if (faceIdsByIndex.length === 0) {
    entityOrder.forEach((entityId) => {
      if (/^(ADVANCED_FACE|FACE_SURFACE)$/.test(entities.get(entityId)?.type || "")) {
        addFace(entityId);
      }
    });
  }

  const lengthScaleToMillimeters = getStepLengthScaleToMillimeters(entities);
  const faceIndexById = new Map(faceIdsByIndex.map((faceId, index) => [faceId, index]));
  const verticesById = new Map<string, StepTopologyVertex>();
  const edgeDrafts = new Map<string, {
    id: string;
    curveId?: string;
    curveType?: string;
    vertexIds: string[];
    faceIds: Set<string>;
    loopIds: Set<string>;
  }>();
  const loops: StepTopologyLoop[] = [];

  const getVertex = (vertexId: string): StepTopologyVertex => {
    const cached = verticesById.get(vertexId);
    if (cached) return cached;

    const vertexEntity = entities.get(vertexId);
    const pointRef = vertexEntity?.refs.find((ref) => entities.get(ref)?.type === "CARTESIAN_POINT");
    const point = pointRef
      ? parseCartesianPoint(entities.get(pointRef)?.statement || "", lengthScaleToMillimeters)
      : undefined;
    const vertex = {
      id: vertexId,
      point,
      signature: `VERTEX_POINT:${pointSignature(point)}`,
    };
    verticesById.set(vertexId, vertex);
    return vertex;
  };

  faceIdsByIndex.forEach((faceId, faceIndex) => {
    const face = entities.get(faceId);
    if (!face) return;

    const boundIds = face.refs.filter((ref) =>
      /^(FACE_BOUND|FACE_OUTER_BOUND)$/.test(entities.get(ref)?.type || "")
    );
    boundIds.forEach((boundId) => {
      const bound = entities.get(boundId);
      const loopId = bound?.refs.find((ref) =>
        /^(EDGE_LOOP|VERTEX_LOOP)$/.test(entities.get(ref)?.type || "")
      );
      if (!loopId) return;

      const loop = entities.get(loopId);
      const edgeIds: string[] = [];
      (loop?.refs || []).forEach((orientedEdgeId) => {
        const orientedEdge = entities.get(orientedEdgeId);
        if (orientedEdge?.type !== "ORIENTED_EDGE") return;

        const edgeId = orientedEdge.refs.find((ref) => entities.get(ref)?.type === "EDGE_CURVE");
        if (!edgeId) return;
        edgeIds.push(edgeId);

        const edgeEntity = entities.get(edgeId);
        let draft = edgeDrafts.get(edgeId);
        if (!draft) {
          const vertexIds = (edgeEntity?.refs || []).filter((ref) => entities.get(ref)?.type === "VERTEX_POINT");
          const curveId = (edgeEntity?.refs || []).find((ref) => {
            const type = entities.get(ref)?.type || "";
            return type !== "VERTEX_POINT";
          });
          draft = {
            id: edgeId,
            curveId,
            curveType: curveId ? entities.get(curveId)?.type : undefined,
            vertexIds,
            faceIds: new Set(),
            loopIds: new Set(),
          };
          edgeDrafts.set(edgeId, draft);
        }
        draft.faceIds.add(faceId);
        draft.loopIds.add(loopId);
      });

      loops.push({
        id: loopId,
        faceId,
        faceIndex,
        edgeIds,
      });
    });
  });

  const edges = Array.from(edgeDrafts.values()).map((draft): StepTopologyEdge => {
    const vertices = draft.vertexIds.map(getVertex);
    const faceIds = Array.from(draft.faceIds);
    const faceIndices = faceIds
      .map((faceId) => faceIndexById.get(faceId))
      .filter((faceIndex): faceIndex is number => faceIndex !== undefined)
      .sort((a, b) => a - b);
    const endpointSignature = canonicalPair(vertices.map((vertex) => vertex.signature));
    const signature = [
      draft.curveType || "CURVE",
      endpointSignature,
      canonicalPair(faceIds),
    ].join(":");

    return {
      id: draft.id,
      curveId: draft.curveId,
      curveType: draft.curveType,
      startVertexId: draft.vertexIds[0],
      endVertexId: draft.vertexIds[1],
      vertices,
      faceIds,
      faceIndices,
      loopIds: Array.from(draft.loopIds),
      signature,
    };
  });

  return {
    faceIdsByIndex,
    edges,
    vertices: Array.from(verticesById.values()),
    loops,
  };
}

const distanceSquared = (a: StepTopologyPoint, b: StepTopologyPoint) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
};

const getEndpointScore = (line: TessellatedEdgeLine, edge: StepTopologyEdge) => {
  const linePoints = (line.vertexPoints || []).filter((point) =>
    Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
  );
  const edgePoints = edge.vertices
    .map((vertex) => vertex.point)
    .filter((point): point is StepTopologyPoint => !!point);
  if (linePoints.length === 0 || edgePoints.length === 0) return Number.POSITIVE_INFINITY;

  if (linePoints.length === 1 || edgePoints.length === 1) {
    return Math.min(...linePoints.flatMap((linePoint) =>
      edgePoints.map((edgePoint) => distanceSquared(linePoint, edgePoint))
    ));
  }

  const direct =
    distanceSquared(linePoints[0], edgePoints[0]) +
    distanceSquared(linePoints[linePoints.length - 1], edgePoints[edgePoints.length - 1]);
  const reversed =
    distanceSquared(linePoints[0], edgePoints[edgePoints.length - 1]) +
    distanceSquared(linePoints[linePoints.length - 1], edgePoints[0]);
  return Math.min(direct, reversed);
};

const getLineFaceIndices = (line: TessellatedEdgeLine) => {
  const indices = line.parentFaceIndices
    || (line.parentFaceIndex !== undefined ? [line.parentFaceIndex] : []);
  return [...indices].sort((a, b) => a - b);
};

const getModelExtent = (lines: TessellatedEdgeLine[]) => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  lines.forEach((line) => {
    const positions = line.positions;
    if (!positions) return;
    for (let i = 0; i + 2 < positions.length; i += 3) {
      const x = Number(positions[i]);
      const y = Number(positions[i + 1]);
      const z = Number(positions[i + 2]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  });

  if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) return 1;
  return Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1);
};

/**
 * Adds native STEP identity to display edges only when the topology match is
 * unique or its endpoints agree within model tolerance. Native OCCT geometry
 * retains its source while receiving the matching STEP entity metadata.
 */
export function attachStepTopologyToLines<T extends TessellatedEdgeLine>(
  lines: T[],
  topology: StepTopology
): Array<T & {
  topologySource: "occt" | "step" | "tessellation";
  stepEntityId?: string;
  topologySignature?: string;
  stepTopologySignature?: string;
  nativeVertices?: StepTopologyVertex[];
  nativeLoopIds?: string[];
}> {
  const edgesByFacePair = new Map<string, StepTopologyEdge[]>();
  topology.edges.forEach((edge) => {
    if (edge.faceIndices.length < 2) return;
    const key = canonicalPair(edge.faceIndices.map(String));
    const pairEdges = edgesByFacePair.get(key) || [];
    pairEdges.push(edge);
    edgesByFacePair.set(key, pairEdges);
  });

  const matchedEdgeByLine = new Map<T, StepTopologyEdge>();
  const linesByFacePair = new Map<string, T[]>();
  lines.forEach((line) => {
    const faceIndices = getLineFaceIndices(line);
    if (faceIndices.length < 2) return;
    const key = canonicalPair(faceIndices.map(String));
    const pairLines = linesByFacePair.get(key) || [];
    pairLines.push(line);
    linesByFacePair.set(key, pairLines);
  });

  const endpointToleranceSq = Math.pow(Math.max(getModelExtent(lines) * 1e-5, 1e-5), 2);
  linesByFacePair.forEach((pairLines, pairKey) => {
    const pairEdges = edgesByFacePair.get(pairKey) || [];
    if (pairLines.length === 1 && pairEdges.length === 1) {
      const line = pairLines[0];
      const edge = pairEdges[0];
      const isClosedDisplayEdge = line.vertexPoints?.length === 1;
      const isClosedNativeEdge = !!edge.startVertexId && edge.startVertexId === edge.endVertexId;
      if (
        getEndpointScore(line, edge) <= endpointToleranceSq ||
        (isClosedDisplayEdge && isClosedNativeEdge)
      ) {
        matchedEdgeByLine.set(pairLines[0], pairEdges[0]);
      }
      return;
    }

    const candidates = pairLines.flatMap((line) =>
      pairEdges.map((edge) => ({
        line,
        edge,
        score: getEndpointScore(line, edge),
      }))
    )
      .filter((candidate) => candidate.score <= endpointToleranceSq)
      .sort((a, b) => a.score - b.score);
    const usedLines = new Set<T>();
    const usedEdges = new Set<string>();
    candidates.forEach((candidate) => {
      if (usedLines.has(candidate.line) || usedEdges.has(candidate.edge.id)) return;
      usedLines.add(candidate.line);
      usedEdges.add(candidate.edge.id);
      matchedEdgeByLine.set(candidate.line, candidate.edge);
    });
  });

  return lines.map((line) => {
    const edge = matchedEdgeByLine.get(line);
    if (!edge) {
      return {
        ...line,
        topologySource: line.topologySource === "occt"
          ? "occt" as const
          : "tessellation" as const,
      };
    }

    return {
      ...line,
      topologySource: line.topologySource === "occt"
        ? "occt" as const
        : "step" as const,
      stepEntityId: edge.id,
      topologySignature: line.topologySignature || edge.signature,
      stepTopologySignature: edge.signature,
      nativeVertices: edge.vertices,
      nativeLoopIds: edge.loopIds,
    };
  });
}

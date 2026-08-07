import type {
  ParsedStepDatumReferenceFrame,
  StepParseResult,
} from "./stepParser";

export type PmiTopologyEntityKind = "face" | "edge" | "vertex" | "loop";
export type PmiTopologyResolution = "resolved" | "missing" | "ambiguous";

export interface PmiTopologyReference {
  entityKind: PmiTopologyEntityKind;
  stepEntityId: string;
  runtimeId?: string;
  topologySignature?: string;
  stepTopologySignature?: string;
  resolution: PmiTopologyResolution;
  resolutionReason:
    | "unique-stable-signature"
    | "target-not-mapped"
    | "stable-signature-unavailable"
    | "stable-signature-not-found"
    | "multiple-runtime-candidates"
    | "duplicate-stable-signature"
    | "step-identity-conflict";
  candidateRuntimeIds?: string[];
  candidateTopologySignatures?: string[];
}

export interface PmiTopologyReferenceSummary {
  resolved: number;
  missing: number;
  ambiguous: number;
}

type TopologyPoint = { x: number; y: number; z: number };

type RuntimeTopologyEntity = {
  entityKind: PmiTopologyEntityKind;
  runtimeId: string;
  topologySignature?: string;
  stepTopologySignature?: string;
  stepEntityIds: string[];
  point?: TopologyPoint;
};

type OcctTopologyResult = {
  geometryTopologySource?: string;
  faces?: any[];
  meshes?: any[];
  edges?: any[];
  lines?: any[];
  vertices?: any[];
  loops?: any[];
};

export interface PmiTopologyResolver {
  resolveTarget: (stepEntityId: string) => PmiTopologyReference;
  resolveTargets: (stepEntityIds: string[]) => PmiTopologyReference[];
  resolveStoredReference: (
    reference: Pick<
      PmiTopologyReference,
      "entityKind" | "stepEntityId" | "topologySignature" | "stepTopologySignature"
    >
  ) => PmiTopologyReference;
}

const normalizeStepEntityId = (entityId: string) => {
  const trimmed = String(entityId || "").trim();
  if (!trimmed) return "";
  return /^\d+$/.test(trimmed) ? `#${trimmed}` : trimmed;
};

const uniqueStrings = (values: Array<string | undefined>) =>
  values.filter((value): value is string => !!value)
    .filter((value, index, all) => all.indexOf(value) === index);

const getPointDistanceSquared = (left?: TopologyPoint, right?: TopologyPoint) => {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return dx * dx + dy * dy + dz * dz;
};

const entityKindFromRuntimeId = (runtimeId: string): PmiTopologyEntityKind | undefined => {
  if (runtimeId.startsWith("BRepFace-")) return "face";
  if (runtimeId.startsWith("BRepEdge-")) return "edge";
  if (runtimeId.startsWith("BRepVertex-")) return "vertex";
  if (runtimeId.startsWith("BRepLoop-")) return "loop";
  return undefined;
};

const createRuntimeTopologyEntities = (
  occtResult: OcctTopologyResult
): RuntimeTopologyEntity[] => {
  const entities: RuntimeTopologyEntity[] = [];
  const faceSources = Array.isArray(occtResult.faces) && occtResult.faces.length > 0
    ? occtResult.faces
    : occtResult.meshes || [];

  faceSources.forEach((face, index) => {
    const runtimeId = typeof face?.id === "string" ? face.id : `BRepFace-${index}`;
    entities.push({
      entityKind: "face",
      runtimeId,
      topologySignature: face?.topologySignature,
      stepEntityIds: [],
    });
  });

  const edgeSources = Array.isArray(occtResult.edges) && occtResult.edges.length > 0
    ? occtResult.edges
    : occtResult.lines || [];
  edgeSources.forEach((edge, index) => {
    const runtimeId = typeof edge?.id === "string" ? edge.id : `BRepEdge-${index}`;
    entities.push({
      entityKind: "edge",
      runtimeId,
      topologySignature: edge?.topologySignature,
      stepTopologySignature: edge?.stepTopologySignature,
      stepEntityIds: uniqueStrings([edge?.stepEntityId]),
    });
  });

  const nativeVertices = (occtResult.vertices || []).map((vertex, index) => ({
    source: vertex,
    entity: {
      entityKind: "vertex" as const,
      runtimeId: typeof vertex?.id === "string" ? vertex.id : `BRepVertex-${index}`,
      topologySignature: vertex?.topologySignature,
      stepEntityIds: [] as string[],
      point: vertex?.point,
    },
  }));
  const nativeVertexByRuntimeId = new Map(
    nativeVertices.map((vertex) => [vertex.entity.runtimeId, vertex])
  );

  edgeSources.forEach((edge) => {
    const vertexIds = Array.isArray(edge?.vertexIds) ? edge.vertexIds : [];
    const stepVertices = Array.isArray(edge?.nativeVertices) ? edge.nativeVertices : [];
    vertexIds.forEach((vertexId: string) => {
      const vertex = nativeVertexByRuntimeId.get(vertexId);
      if (!vertex) return;
      const matchingStepIds = stepVertices
        .filter((stepVertex: any) =>
          getPointDistanceSquared(vertex.entity.point, stepVertex?.point) <= 1e-8
        )
        .map((stepVertex: any) => stepVertex?.id)
        .filter((entityId: unknown): entityId is string => typeof entityId === "string");
      vertex.entity.stepEntityIds = uniqueStrings([
        ...vertex.entity.stepEntityIds,
        ...matchingStepIds,
      ]);
    });
  });
  entities.push(...nativeVertices.map(({ entity }) => entity));

  (occtResult.loops || []).forEach((loop, index) => {
    entities.push({
      entityKind: "loop",
      runtimeId: typeof loop?.id === "string" ? loop.id : `BRepLoop-${index}`,
      topologySignature: loop?.topologySignature,
      stepEntityIds: [],
    });
  });

  return entities;
};

export function createPmiTopologyResolver(
  occtResult: OcctTopologyResult,
  faceMapping: Record<string, string>,
  faceRecords: Array<{ id: string; referencedIds: string[] }> = []
): PmiTopologyResolver {
  const entities = createRuntimeTopologyEntities(occtResult);
  const entityByRuntimeId = new Map(entities.map((entity) => [entity.runtimeId, entity]));
  const entitiesByStepId = new Map<string, RuntimeTopologyEntity[]>();
  const entitiesBySignature = new Map<string, RuntimeTopologyEntity[]>();

  entities.forEach((entity) => {
    entity.stepEntityIds.forEach((stepEntityId) => {
      const normalizedId = normalizeStepEntityId(stepEntityId);
      const matches = entitiesByStepId.get(normalizedId) || [];
      matches.push(entity);
      entitiesByStepId.set(normalizedId, matches);
    });
    if (entity.topologySignature) {
      const matches = entitiesBySignature.get(entity.topologySignature) || [];
      matches.push(entity);
      entitiesBySignature.set(entity.topologySignature, matches);
    }
  });

  const getMappedFaceCandidates = (stepEntityId: string) => {
    const candidateIds = new Set<string>();
    const mappedId = faceMapping[stepEntityId]
      || faceMapping[stepEntityId.replace(/^#/, "")];
    if (mappedId) candidateIds.add(mappedId);

    const directFaceRecordIndex = faceRecords.findIndex((record) => record.id === stepEntityId);
    if (directFaceRecordIndex >= 0) {
      candidateIds.add(
        faceMapping[faceRecords[directFaceRecordIndex].id]
        || `BRepFace-${directFaceRecordIndex}`
      );
    }

    if (candidateIds.size === 0) {
      faceRecords.forEach((record, index) => {
        if (!record.referencedIds.includes(stepEntityId)) return;
        candidateIds.add(faceMapping[record.id] || `BRepFace-${index}`);
      });
    }

    return [...candidateIds]
      .map((runtimeId) => entityByRuntimeId.get(runtimeId))
      .filter((entity): entity is RuntimeTopologyEntity => entity?.entityKind === "face");
  };

  const createReference = (
    stepEntityId: string,
    candidates: RuntimeTopologyEntity[]
  ): PmiTopologyReference => {
    const uniqueCandidates = candidates.filter((candidate, index, all) =>
      all.findIndex((other) => other.runtimeId === candidate.runtimeId) === index
    );
    const candidateRuntimeIds = uniqueCandidates.map((candidate) => candidate.runtimeId);
    const candidateTopologySignatures = uniqueStrings(
      uniqueCandidates.map((candidate) => candidate.topologySignature)
    );
    const entityKind = uniqueCandidates.length > 0
      ? uniqueCandidates[0].entityKind
      : "face";

    if (uniqueCandidates.length === 0) {
      return {
        entityKind,
        stepEntityId,
        resolution: "missing",
        resolutionReason: "target-not-mapped",
      };
    }
    if (uniqueCandidates.length > 1) {
      return {
        entityKind,
        stepEntityId,
        resolution: "ambiguous",
        resolutionReason: "multiple-runtime-candidates",
        candidateRuntimeIds,
        candidateTopologySignatures,
      };
    }

    const candidate = uniqueCandidates[0];
    if (!candidate.topologySignature) {
      return {
        entityKind: candidate.entityKind,
        stepEntityId,
        runtimeId: candidate.runtimeId,
        stepTopologySignature: candidate.stepTopologySignature,
        resolution: "missing",
        resolutionReason: "stable-signature-unavailable",
      };
    }

    const signatureMatches = entitiesBySignature.get(candidate.topologySignature) || [];
    if (signatureMatches.length > 1) {
      return {
        entityKind: candidate.entityKind,
        stepEntityId,
        resolution: "ambiguous",
        resolutionReason: "duplicate-stable-signature",
        candidateRuntimeIds: signatureMatches.map((entity) => entity.runtimeId),
        candidateTopologySignatures: [candidate.topologySignature],
      };
    }

    return {
      entityKind: candidate.entityKind,
      stepEntityId,
      runtimeId: candidate.runtimeId,
      topologySignature: candidate.topologySignature,
      stepTopologySignature: candidate.stepTopologySignature,
      resolution: "resolved",
      resolutionReason: "unique-stable-signature",
    };
  };

  const resolveTarget = (rawStepEntityId: string): PmiTopologyReference => {
    const stepEntityId = normalizeStepEntityId(rawStepEntityId);
    if (!stepEntityId) return createReference("", []);

    const runtimeKind = entityKindFromRuntimeId(stepEntityId);
    if (runtimeKind) {
      const runtimeEntity = entityByRuntimeId.get(stepEntityId);
      return createReference(stepEntityId, runtimeEntity ? [runtimeEntity] : []);
    }

    const exactTopologyCandidates = entitiesByStepId.get(stepEntityId) || [];
    if (exactTopologyCandidates.length > 0) {
      return createReference(stepEntityId, exactTopologyCandidates);
    }

    return createReference(stepEntityId, getMappedFaceCandidates(stepEntityId));
  };

  return {
    resolveTarget,
    resolveTargets: (stepEntityIds) => uniqueStrings(
      stepEntityIds.map(normalizeStepEntityId)
    ).map(resolveTarget),
    resolveStoredReference: (reference) => {
      const stepEntityId = normalizeStepEntityId(reference.stepEntityId);
      if (!reference.topologySignature) return resolveTarget(stepEntityId);

      const signatureMatches = (entitiesBySignature.get(reference.topologySignature) || [])
        .filter((entity) => entity.entityKind === reference.entityKind);
      if (signatureMatches.length === 0) {
        return {
          entityKind: reference.entityKind,
          stepEntityId,
          topologySignature: reference.topologySignature,
          stepTopologySignature: reference.stepTopologySignature,
          resolution: "missing",
          resolutionReason: "stable-signature-not-found",
        };
      }
      if (signatureMatches.length > 1) {
        return {
          entityKind: reference.entityKind,
          stepEntityId,
          resolution: "ambiguous",
          resolutionReason: "duplicate-stable-signature",
          candidateRuntimeIds: signatureMatches.map((entity) => entity.runtimeId),
          candidateTopologySignatures: [reference.topologySignature],
        };
      }

      const candidate = signatureMatches[0];
      const currentStepReference = stepEntityId ? resolveTarget(stepEntityId) : undefined;
      if (
        currentStepReference?.resolution === "resolved"
        && currentStepReference.runtimeId !== candidate.runtimeId
      ) {
        return {
          entityKind: reference.entityKind,
          stepEntityId,
          resolution: "ambiguous",
          resolutionReason: "step-identity-conflict",
          candidateRuntimeIds: uniqueStrings([
            candidate.runtimeId,
            currentStepReference.runtimeId,
          ]),
          candidateTopologySignatures: uniqueStrings([
            candidate.topologySignature,
            currentStepReference.topologySignature,
          ]),
        };
      }

      return {
        entityKind: candidate.entityKind,
        stepEntityId,
        runtimeId: candidate.runtimeId,
        topologySignature: candidate.topologySignature,
        stepTopologySignature: candidate.stepTopologySignature
          || reference.stepTopologySignature,
        resolution: "resolved",
        resolutionReason: "unique-stable-signature",
      };
    },
  };
}

const getRecordTargetIds = (record: { targetId?: string; targetIds?: string[] }) =>
  Array.isArray(record.targetIds) && record.targetIds.length > 0
    ? record.targetIds
    : record.targetId
      ? [record.targetId]
      : [];

const uniqueTopologyReferences = (references: PmiTopologyReference[]) =>
  references.filter((reference, index, all) =>
    all.findIndex((candidate) =>
      candidate.stepEntityId === reference.stepEntityId
      && candidate.runtimeId === reference.runtimeId
      && candidate.resolution === reference.resolution
    ) === index
  );

export function enrichPmiTopologyReferences(
  parsed: StepParseResult,
  occtResult: OcctTopologyResult,
  faceMapping: Record<string, string>
): StepParseResult {
  const resolver = createPmiTopologyResolver(
    occtResult,
    faceMapping,
    parsed.faceRecords || []
  );
  const datumByIdentifier = new Map(parsed.datums.map((datum) => [datum.identifier, datum]));

  const enrichFrame = (
    frame: ParsedStepDatumReferenceFrame
  ): ParsedStepDatumReferenceFrame => {
    const references = frame.references.map((reference) => {
      const datum = datumByIdentifier.get(reference.datumIdentifier);
      const targetIds = Array.isArray(reference.targetIds) && reference.targetIds.length > 0
        ? reference.targetIds
        : datum
          ? getRecordTargetIds(datum)
          : [];
      return {
        ...reference,
        topologyReferences: resolver.resolveTargets(targetIds),
      };
    });
    return {
      ...frame,
      references,
      topologyReferences: uniqueTopologyReferences(
        references.flatMap((reference) => reference.topologyReferences)
      ),
    };
  };

  const datumReferenceFrames = parsed.datumReferenceFrames.map(enrichFrame);

  const datums = parsed.datums.map((datum) => ({
    ...datum,
    topologyReferences: resolver.resolveTargets(getRecordTargetIds(datum)),
  }));
  const datumTargets = parsed.datumTargets.map((target) => ({
    ...target,
    topologyReferences: resolver.resolveTargets(getRecordTargetIds(target)),
  }));
  const tolerances = parsed.tolerances.map((tolerance) => {
    const datumReferenceFrame = tolerance.datumReferenceFrame
      ? enrichFrame(tolerance.datumReferenceFrame)
      : undefined;
    return {
      ...tolerance,
      topologyReferences: resolver.resolveTargets(getRecordTargetIds(tolerance)),
      ...(datumReferenceFrame ? { datumReferenceFrame } : {}),
    };
  });

  const allReferences = [
    ...datums.flatMap((datum) => datum.topologyReferences),
    ...datumTargets.flatMap((target) => target.topologyReferences),
    ...tolerances.flatMap((tolerance) => tolerance.topologyReferences),
    ...datumReferenceFrames.flatMap((frame) => frame.topologyReferences),
  ];
  const topologyReferenceSummary = allReferences.reduce<PmiTopologyReferenceSummary>(
    (summary, reference) => {
      summary[reference.resolution]++;
      return summary;
    },
    { resolved: 0, missing: 0, ambiguous: 0 }
  );

  return {
    ...parsed,
    datums,
    datumTargets,
    tolerances,
    datumReferenceFrames,
    topologyReferenceSummary,
  };
}

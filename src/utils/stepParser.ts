import type {
  PmiTopologyReference,
  PmiTopologyReferenceSummary,
} from "./pmiTopologyReferences";

export interface ParsedStepPoint {
  id: number;
  x: number;
  y: number;
  z: number;
}

export interface ParsedStepCylinder {
  id: number;
  radius: number;
  diameter: number;
  centerId?: number;
  axisDirectionId?: number;
  center?: { x: number; y: number; z: number };
}

export interface StepEntitySummary {
  pointsCount: number;
  cylindersCount: number;
  facesCount: number;
  linesCount: number;
  rawEntitiesCount: number;
}

export interface ParsedStepTolerance {
  id: string;
  entityId: string;    // e.g. "#460"
  type: string;        // e.g. "Flatness", "Cylindricity", "Position", "Surface Profile"
  symbol: string;      // Unicode GD&T standard symbol
  value: number;       // e.g. 0.05
  targetId: string;    // resolved STEP entity id, e.g. "#123"
  targetIds?: string[]; // all resolved STEP entities for composite toleranced geometry
  targetSurfaceTypes?: string[];
  targetPoints?: { x: number; y: number; z: number }[];
  targetName: string;  // e.g. "Main Base Face"
  hasToleranceModifiers?: boolean;
  toleranceModifiers?: string[];
  toleranceZoneForm?: string;
  toleranceZoneDiameter?: boolean;
  projectedToleranceZoneHeight?: number;
  dimensionEntityId?: string;
  dimensionKind?: "linear" | "angular" | "diameter" | "radius" | "size" | "threadDepth" | "chamfer" | "slot";
  nominalDimension?: number;
  upperTolerance?: number;
  lowerTolerance?: number;
  secondaryDimensionEntityId?: string;
  secondaryNominalDimension?: number;
  secondaryUpperTolerance?: number;
  secondaryLowerTolerance?: number;
  dimensionLowerLimit?: number;
  dimensionUpperLimit?: number;
  dimensionLimitPreModifier?: string;
  dimensionLimitNote?: string;
  isReferenceDimension?: boolean;
  isBasicDimension?: boolean;
  isStatisticalTolerance?: boolean;
  isDatumTargetDimension?: boolean;
  associatedDatumIdentifier?: string;
  isSphericalDimension?: boolean;
  isCircularCurveDimension?: boolean;
  isControlledRadiusDimension?: boolean;
  isCounterboreDimension?: boolean;
  counterboreHoleTargetIds?: string[];
  counterboreHoleFeatureControlFrameIds?: string[];
  counterboreHoleNominal?: number;
  counterboreHoleUpperTolerance?: number;
  counterboreHoleLowerTolerance?: number;
  counterboreDepthNominal?: number;
  counterboreDepthUpperTolerance?: number;
  counterboreDepthLowerTolerance?: number;
  holeDepthFromBoundaryTopology?: boolean;
  counterboreEvaluationNote?: string;
  isCountersinkDimension?: boolean;
  countersinkAngleNominal?: number;
  countersinkAngleUpperTolerance?: number;
  countersinkAngleLowerTolerance?: number;
  dimensionPreModifier?: string;
  dimensionDecimalPlaces?: number;
  isSlotOverallDimension?: boolean;
  slotRadiusModel?: number;
  dimensionScaleToModel?: number;
  suppressStandaloneDimension?: boolean;
  isRadiusCountNote?: boolean;
  slotRadiusPreModifier?: string;
  slotRadiusNominal?: number;
  threadDesignation?: string;
  threadCylinderTargetIds?: string[];
  datumReferenceFrame?: ParsedStepDatumReferenceFrame;
  category: "Form" | "Orientation" | "Location" | "Profile" | "Dimension";
  clinicalContext: string; // clinical/medical justification
  topologyReferences?: PmiTopologyReference[];
}

export interface ParsedStepSurfaceGeometry {
  surfaceType: "plane" | "cylinder" | "curved" | "unknown";
  targetId: string;
  placementId?: string;
  point?: { x: number; y: number; z: number };
  normal?: { x: number; y: number; z: number };
  axis?: { x: number; y: number; z: number };
  xDirection?: { x: number; y: number; z: number };
}

export interface ParsedStepDatum {
  id: string;
  entityId: string;    // e.g. "#601"
  name: string;        // e.g. "Datum A"
  identifier: string;  // e.g. "A"
  type: string;        // e.g. "Primary Flat Datum Plane", "Secondary Cylindrical Axis"
  symbol: string;      // Symbol like [ A ]
  targetId: string;    // resolved STEP entity id, e.g. "#123"
  targetIds?: string[]; // all resolved STEP entities when one datum feature is built from multiple faces
  surfaceGeometry?: ParsedStepSurfaceGeometry[];
  semanticTargetIds?: string[];
  presentationTargetPoint?: { x: number; y: number; z: number };
  targetSource?: "semantic" | "presentation";
  derivedDatum?: "medianPlane" | "twoFaceDimension" | "axis" | "multiface";
  targetName: string;  // e.g. "Main Base Face"
  clinicalContext: string; // Dynamic clinical significance
  topologyReferences?: PmiTopologyReference[];
}

export interface ParsedStepDatumTarget {
  id: string;
  entityId: string;    // e.g. "#8672" annotation occurrence
  name: string;        // e.g. "Datum Target A1"
  identifier: string;  // e.g. "A1" when decoded, or "DT-1"
  parentDatum?: string;
  type?: string;
  targetId: string;    // resolved B-Rep target entity
  targetIds?: string[];
  targetName: string;
  targetPoint?: { x: number; y: number; z: number };
  targetLine?: {
    start: { x: number; y: number; z: number };
    end: { x: number; y: number; z: number };
    center: { x: number; y: number; z: number };
    direction: { x: number; y: number; z: number };
    normal?: { x: number; y: number; z: number };
    length: number;
  };
  targetCircle?: {
    center: { x: number; y: number; z: number };
    diameter: number;
    normal: { x: number; y: number; z: number };
    xDirection: { x: number; y: number; z: number };
    yDirection: { x: number; y: number; z: number };
  };
  targetCurve?: {
    points: { x: number; y: number; z: number }[];
    center: { x: number; y: number; z: number };
    normal?: { x: number; y: number; z: number };
  };
  targetZone?: {
    shape: "rectangle";
    width: number;
    length: number;
    center: { x: number; y: number; z: number };
    normal: { x: number; y: number; z: number };
    xDirection: { x: number; y: number; z: number };
    yDirection: { x: number; y: number; z: number };
  };
  sizeLabels?: string[];
  clinicalContext: string;
  topologyReferences?: PmiTopologyReference[];
}

export interface ParsedStepDatumReference {
  precedence: number;
  datumIdentifier: string;
  datumEntityId: string;
  compartmentId: string;
  modifiers: string[];
  isCommonDatum?: boolean;
  targetIds?: string[];
  surfaceGeometry?: ParsedStepSurfaceGeometry[];
  topologyReferences?: PmiTopologyReference[];
}

export interface ParsedStepFrameBasis {
  origin: { x: number; y: number; z: number };
  xAxis: { x: number; y: number; z: number };
  yAxis: { x: number; y: number; z: number };
  zAxis: { x: number; y: number; z: number };
}

export interface ParsedStepDatumReferenceFrame {
  id: string;
  entityId: string;
  name: string;
  label: string;
  references: ParsedStepDatumReference[];
  toleranceEntityIds: string[];
  frameBasis?: ParsedStepFrameBasis;
  topologyReferences?: PmiTopologyReference[];
}

export interface StepParseResult {
  fileName: string;
  fileSize: number;
  entitiesSummary: StepEntitySummary;
  points: ParsedStepPoint[];
  holes: {
    id: string;
    center: { x: number; y: number; z: number };
    diameter: number;
    edgeDistance: number;
  }[];
  dimensions: {
    width: number;
    length: number;
    estimatedThickness: number;
  };
  tolerances: ParsedStepTolerance[];
  datums: ParsedStepDatum[];
  datumTargets: ParsedStepDatumTarget[];
  datumReferenceFrames: ParsedStepDatumReferenceFrame[];
  rawText: string;
  faceRecords?: { id: string; referencedIds: string[] }[];
  cylinderIds?: string[];
  topologyReferenceSummary?: PmiTopologyReferenceSummary;
}

/**
 * Highly robust STEP / STEP AP242 / AP214 File Parser
 * Scans geometric entities and maps key features (Holes, Thickness, Boundaries)
 */
export function parseStepFile(fileName: string, text: string): StepParseResult {
  const points: ParsedStepPoint[] = [];
  const cylinders: ParsedStepCylinder[] = [];
  const parsedTolerances: ParsedStepTolerance[] = [];
  const parsedDatums: ParsedStepDatum[] = [];
  const parsedDatumTargets: ParsedStepDatumTarget[] = [];
  const faceRecords: { id: string; referencedIds: string[] }[] = [];
  const cylinderIds: string[] = [];
  const axisPlacementPointIds = new Map<number, number>();
  const draughtingAssociations: { shapeAspectId: string; annotationId: string }[] = [];
  const geometricUsages: { shapeAspectId: string; targetId: string }[] = [];
  const datumTargetFeatureRelations: { datumTargetId: string; targetFeatureId: string }[] = [];
  const datumAnnotations: string[] = [];
  const fcfAnnotations: string[] = [];
  const datumTargetAnnotations: string[] = [];
  let facesCount = 0;
  let linesCount = 0;
  let rawEntitiesCount = 0;

  const entityStatements = new Map<string, string>();
  for (const match of text.matchAll(/#(\d+)\s*=\s*([\s\S]*?);/g)) {
    entityStatements.set(`#${match[1]}`, match[2].replace(/\s+/g, " ").trim());
  }

  const entityRefsCache = new Map<string, string[]>();
  const entityTypeNamesCache = new Map<string, string[]>();
  const entityParamsCache = new Map<string, string[]>();
  let usedInIndex: Map<string, string[]> | null = null;

  const getEntityRefs = (entityId: string): string[] => {
    const cached = entityRefsCache.get(entityId);
    if (cached) return cached;
    const refs = entityStatements.get(entityId)?.match(/#\d+/g) || [];
    entityRefsCache.set(entityId, refs);
    return refs;
  };

  const splitTopLevel = (value: string): string[] => {
    const parts: string[] = [];
    let current = "";
    let depth = 0;
    let inString = false;

    for (let i = 0; i < value.length; i++) {
      const char = value[i];
      const next = value[i + 1];

      if (char === "'") {
        current += char;
        if (inString && next === "'") {
          current += next;
          i++;
        } else {
          inString = !inString;
        }
        continue;
      }

      if (!inString) {
        if (char === "(") depth++;
        if (char === ")") depth--;
        if (char === "," && depth === 0) {
          parts.push(current.trim());
          current = "";
          continue;
        }
      }

      current += char;
    }

    if (current.trim()) parts.push(current.trim());
    return parts;
  };

  const getEntityTypeNames = (entityId: string): string[] => {
    const cached = entityTypeNamesCache.get(entityId);
    if (cached) return cached;
    const statement = entityStatements.get(entityId) || "";
    const names: string[] = [];
    for (const match of statement.matchAll(/(?:^|\s|\()\s*([A-Z0-9_]+)\s*\(/gi)) {
      const name = match[1].toUpperCase();
      if (!names.includes(name)) names.push(name);
    }
    entityTypeNamesCache.set(entityId, names);
    return names;
  };

  const getEntityType = (entityId: string): string => {
    const names = getEntityTypeNames(entityId);
    return names[0] || "";
  };

  const isGeometryTargetEntity = (entityId: string): boolean => {
    return getEntityTypeNames(entityId).some((type) =>
      /^(ADVANCED_FACE|FACE_SURFACE|FACE_BOUND|EDGE_CURVE|TRIMMED_CURVE|LINE|CIRCLE|VERTEX_POINT|CARTESIAN_POINT|AXIS2_PLACEMENT_3D|PLANE|CYLINDRICAL_SURFACE|CONICAL_SURFACE|SPHERICAL_SURFACE|TOROIDAL_SURFACE|B_SPLINE_SURFACE|GEOMETRIC_CURVE_SET|SHAPE_ASPECT|COMPOSITE_SHAPE_ASPECT|DATUM_FEATURE|DATUM_TARGET|PLACED_DATUM_TARGET_FEATURE|CENTRE_OF_SYMMETRY)$/i.test(type)
    );
  };

  const getEntityParams = (entityId: string): string[] => {
    const cached = entityParamsCache.get(entityId);
    if (cached) return cached;
    const statement = entityStatements.get(entityId) || "";
    const start = statement.indexOf("(");
    const end = statement.lastIndexOf(")");
    if (start === -1 || end === -1 || end <= start) {
      entityParamsCache.set(entityId, []);
      return [];
    }
    const params = splitTopLevel(statement.slice(start + 1, end));
    entityParamsCache.set(entityId, params);
    return params;
  };

  const getQuotedValues = (value: string): string[] => {
    const matches = value.match(/'([^']|'')*'/g) || [];
    return matches.map((match) => match.slice(1, -1).replace(/''/g, "'").trim());
  };

  const getUsedIn = (targetId: string, typePattern?: RegExp): string[] => {
    if (!usedInIndex) {
      usedInIndex = new Map<string, string[]>();
      for (const entityId of entityStatements.keys()) {
        for (const ref of getEntityRefs(entityId)) {
          const users = usedInIndex.get(ref) || [];
          users.push(entityId);
          usedInIndex.set(ref, users);
        }
      }
    }
    const usedIn = usedInIndex.get(targetId) || [];
    return typePattern
      ? usedIn.filter((entityId) => getEntityTypeNames(entityId).some((type) => typePattern.test(type)))
      : usedIn;
  };

  for (const [entityId, statement] of entityStatements.entries()) {
    if (!/^DRAUGHTING_MODEL_ITEM_ASSOCIATION(?:_WITH_PLACEHOLDER)?\s*\(/i.test(statement)) continue;
    const refs = getEntityRefs(entityId);
    const shapeAspectId = refs[0];
    const annotationId = refs[2];
    if (!shapeAspectId || !annotationId) continue;
    if (!draughtingAssociations.some((assoc) => assoc.shapeAspectId === shapeAspectId && assoc.annotationId === annotationId)) {
      draughtingAssociations.push({ shapeAspectId, annotationId });
    }
  }

  const getMeasureValue = (entityId: string): number | null => {
    const statement = entityStatements.get(entityId);
    if (!statement) return null;

    const params = getEntityParams(entityId);
    const firstNumeric = params.join(",").replace(/'[^']*'/g, "").match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[Ee][-+]?\d+)?/);
    if (firstNumeric) return parseFloat(firstNumeric[0]);

    const nestedMeasure = (statement.match(/LENGTH_MEASURE\s*\(\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[Ee][-+]?\d+)?)\s*\)/i) ||
      statement.match(/PLANE_ANGLE_MEASURE\s*\(\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[Ee][-+]?\d+)?)\s*\)/i));
    return nestedMeasure ? parseFloat(nestedMeasure[1]) : null;
  };

  const siLengthPrefixToMillimeters = (prefix: string | undefined): number | null => {
    const normalized = (prefix || "$").replace(/\./g, "").toUpperCase();
    const metersScale: Record<string, number> = {
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
      ATTO: 1e-18
    };
    const scaleToMeters = metersScale[normalized];
    return scaleToMeters === undefined ? null : scaleToMeters * 1000;
  };

  const getLengthUnitScaleToMillimeters = (unitId: string, visited = new Set<string>()): number | null => {
    if (visited.has(unitId)) return null;
    visited.add(unitId);

    const statement = entityStatements.get(unitId);
    if (!statement) return null;

    const typeNames = getEntityTypeNames(unitId);
    const isLengthUnit = typeNames.includes("LENGTH_UNIT") || /LENGTH_UNIT\s*\(/i.test(statement);
    if (!isLengthUnit) return null;

    const siUnitMatch = statement.match(/SI_UNIT\s*\(\s*(\$|\.[A-Z_]+\.)\s*,\s*\.METRE\.\s*\)/i);
    if (siUnitMatch) {
      return siLengthPrefixToMillimeters(siUnitMatch[1]);
    }

    if (/CONVERSION_BASED_UNIT\s*\(/i.test(statement)) {
      for (const ref of getEntityRefs(unitId)) {
        const refStatement = entityStatements.get(ref) || "";
        if (!/MEASURE_WITH_UNIT|LENGTH_MEASURE_WITH_UNIT/i.test(refStatement)) continue;

        const measure = getMeasureValue(ref);
        if (measure === null) continue;

        const nestedUnit = getEntityRefs(ref).find((nestedRef) => nestedRef !== unitId);
        const nestedScale = nestedUnit ? getLengthUnitScaleToMillimeters(nestedUnit, visited) : 1;
        if (nestedScale !== null) return measure * nestedScale;
      }
    }

    return null;
  };

  const getRepresentationLengthScaleToMillimeters = (representationId: string): number => {
    const representationRefs = getEntityRefs(representationId);
    for (const ref of representationRefs) {
      const directScale = getLengthUnitScaleToMillimeters(ref);
      if (directScale !== null) return directScale;

      for (const nestedRef of getEntityRefs(ref)) {
        const nestedScale = getLengthUnitScaleToMillimeters(nestedRef);
        if (nestedScale !== null) return nestedScale;
      }
    }

    return 1;
  };

  let defaultLengthScaleToMillimeters: number | null = null;
  const getDefaultLengthScaleToMillimeters = (): number => {
    if (defaultLengthScaleToMillimeters !== null) return defaultLengthScaleToMillimeters;

    for (const [entityId, statement] of entityStatements.entries()) {
      if (!/GEOMETRIC_REPRESENTATION_CONTEXT/i.test(statement) || !/GLOBAL_UNIT_ASSIGNED_CONTEXT/i.test(statement)) {
        continue;
      }

      const refs = getEntityRefs(entityId);
      for (const ref of refs) {
        const scale = getLengthUnitScaleToMillimeters(ref);
        if (scale !== null && Number.isFinite(scale)) {
          defaultLengthScaleToMillimeters = scale;
          return scale;
        }
      }
    }

    for (const entityId of entityStatements.keys()) {
      const scale = getLengthUnitScaleToMillimeters(entityId);
      if (scale !== null && Number.isFinite(scale)) {
        defaultLengthScaleToMillimeters = scale;
        return scale;
      }
    }

    defaultLengthScaleToMillimeters = 1;
    return 1;
  };

  const scalePoint = (point: { x: number; y: number; z: number }, scale: number) => ({
    x: point.x * scale,
    y: point.y * scale,
    z: point.z * scale
  });

  const getCartesianPoint = (entityId: string): { x: number; y: number; z: number } | null => {
    const statement = entityStatements.get(entityId);
    if (!statement) return null;

    const match = statement.match(/(?:CARTESIAN_POINT|APLL_POINT)\s*\(\s*[^,]*\s*,\s*\(\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[Ee][-+]?\d+)?)\s*,\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[Ee][-+]?\d+)?)\s*,\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[Ee][-+]?\d+)?)\s*\)\s*\)/i);
    if (!match) return null;

    return {
      x: parseFloat(match[1]),
      y: parseFloat(match[2]),
      z: parseFloat(match[3])
    };
  };

  const normalizeVector = (vector?: { x: number; y: number; z: number } | null) => {
    if (!vector || typeof vector.x !== "number" || typeof vector.y !== "number" || typeof vector.z !== "number") return null;
    const length = Math.hypot(vector.x, vector.y, vector.z);
    return length > 1e-12
      ? { x: vector.x / length, y: vector.y / length, z: vector.z / length }
      : null;
  };

  const crossVector = (
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number }
  ) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  });

  const dotVector = (
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number }
  ) => a.x * b.x + a.y * b.y + a.z * b.z;

  const projectVectorOntoPlane = (
    vector: { x: number; y: number; z: number },
    normal: { x: number; y: number; z: number }
  ) => {
    const normalizedNormal = normalizeVector(normal) || { x: 0, y: 0, z: 1 };
    const component = dotVector(vector, normalizedNormal);
    return {
      x: vector.x - normalizedNormal.x * component,
      y: vector.y - normalizedNormal.y * component,
      z: vector.z - normalizedNormal.z * component,
    };
  };

  const getDirection = (entityId: string): { x: number; y: number; z: number } | null => {
    const statement = entityStatements.get(entityId);
    if (!statement) return null;

    const match = statement.match(/DIRECTION\s*\(\s*[^,]*\s*,\s*\(\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[Ee][-+]?\d+)?)\s*,\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[Ee][-+]?\d+)?)\s*,\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[Ee][-+]?\d+)?)\s*\)\s*\)/i);
    if (!match) return null;

    return normalizeVector({
      x: parseFloat(match[1]),
      y: parseFloat(match[2]),
      z: parseFloat(match[3])
    });
  };

  const pointCentroid = (points: { x: number; y: number; z: number }[]) => {
    if (points.length === 0) return null;
    const sum = points.reduce((acc, point) => ({
      x: acc.x + point.x,
      y: acc.y + point.y,
      z: acc.z + point.z
    }), { x: 0, y: 0, z: 0 });

    return {
      x: sum.x / points.length,
      y: sum.y / points.length,
      z: sum.z / points.length
    };
  };

  const entityPointCache = new Map<string, { x: number; y: number; z: number }[]>();
  const getCoordinateListPoints = (statement: string): { x: number; y: number; z: number }[] => {
    if (!/^COORDINATES_LIST\s*\(/i.test(statement)) return [];

    const tupleStart = statement.indexOf("((");
    if (tupleStart === -1) return [];

    const values = Array.from(statement.slice(tupleStart).matchAll(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[Ee][-+]?\d+)?/g))
      .map((match) => parseFloat(match[0]));
    const points: { x: number; y: number; z: number }[] = [];
    for (let index = 0; index + 2 < values.length; index += 3) {
      points.push({ x: values[index], y: values[index + 1], z: values[index + 2] });
    }
    return points;
  };

  const getEntityCartesianPoints = (
    entityId: string,
    depth = 8,
    visited = new Set<string>()
  ): { x: number; y: number; z: number }[] => {
    if (depth < 0 || visited.has(entityId)) return [];
    if (entityPointCache.has(entityId)) return entityPointCache.get(entityId)!;

    visited.add(entityId);
    const directPoint = getCartesianPoint(entityId);
    if (directPoint) {
      visited.delete(entityId);
      entityPointCache.set(entityId, [directPoint]);
      return [directPoint];
    }

    const statement = entityStatements.get(entityId) || "";
    const coordinateListPoints = getCoordinateListPoints(statement);
    if (coordinateListPoints.length > 0) {
      visited.delete(entityId);
      entityPointCache.set(entityId, coordinateListPoints);
      return coordinateListPoints;
    }

    const points: { x: number; y: number; z: number }[] = [];
    for (const ref of getEntityRefs(entityId)) {
      points.push(...getEntityCartesianPoints(ref, depth - 1, visited));
    }
    visited.delete(entityId);

    entityPointCache.set(entityId, points);
    return points;
  };

  const squaredDistance = (
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number }
  ) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
  };

  const getDatumPresentationIdentifier = (annotationId: string): string | null => {
    const annotationRefs = getEntityRefs(annotationId);
    const curveSetId = annotationRefs[annotationRefs.length - 1];
    if (!curveSetId) return null;

    const curveRefs = getEntityRefs(curveSetId);
    if (curveRefs.length < 7) return null;

    // NIST AP203 datum symbols are rendered as: leader, triangle, bottom frame,
    // one or more letter strokes, top frame, left frame, right frame.
    const letterStrokeRefs = curveRefs.slice(3, -3);
    const strokePointCounts = letterStrokeRefs
      .map((ref) => getEntityRefs(ref).length)
      .filter((count) => count > 0);

    const signature = strokePointCounts.join(",");
    const glyphSignatures: Record<string, string> = {
      "9,4": "A",
      "64,35,40": "B",
      "149": "C",
      "49": "J",
      "4,4,2,49,34,24": "B",
      "4,4,2,83": "C",
      "2,4,13,2,9,15": "A",
      "11": "F",
      "87": "G",
      "44,44": "D"
    };

    if (glyphSignatures[signature]) {
      return glyphSignatures[signature];
    }

    // Some files include short positioning strokes before the real glyph curves.
    const reducedSignature = strokePointCounts.filter((count) => count > 20).join(",");
    if (glyphSignatures[reducedSignature]) {
      return glyphSignatures[reducedSignature];
    }

    if (signature === "39,48" || reducedSignature === "39,48") {
      return "D";
    }

    if (signature === "13") {
      const letterCurve = letterStrokeRefs.find((ref) => getEntityRefs(ref).filter((pointRef) => !!getCartesianPoint(pointRef)).length === 13);
      const points = letterCurve
        ? getEntityRefs(letterCurve).map(getCartesianPoint).filter((point): point is { x: number; y: number; z: number } => !!point)
        : [];

      if (points.length >= 2) {
        const axes: Array<"x" | "y" | "z"> = ["x", "y", "z"];
        const spans = axes.map((axis) => ({
          axis,
          min: Math.min(...points.map((point) => point[axis])),
          max: Math.max(...points.map((point) => point[axis]))
        })).sort((a, b) => (b.max - b.min) - (a.max - a.min));
        const firstSegmentFraction = spans.slice(0, 2).reduce((largest, spanInfo) => {
          const span = Math.max(1e-9, spanInfo.max - spanInfo.min);
          const fraction = Math.abs(points[1][spanInfo.axis] - points[0][spanInfo.axis]) / span;
          return Math.max(largest, fraction);
        }, 0);
        return firstSegmentFraction > 0.7 ? "E" : "H";
      }

      return "E";
    }

    return null;
  };

  const getDatumTargetPresentationIdentifier = (annotationId: string): string | null => {
    const annotationRefs = getEntityRefs(annotationId);
    const curveSetId = annotationRefs[annotationRefs.length - 1];
    if (!curveSetId) return null;

    const curveRefs = getEntityRefs(curveSetId);
    const strokePointCounts = curveRefs
      .map((ref) => getEntityRefs(ref).length)
      .filter((count) => count > 0);

    while (strokePointCounts.length > 0 && strokePointCounts[0] <= 2) {
      strokePointCounts.shift();
    }
    while (strokePointCounts.length > 0 && strokePointCounts[strokePointCounts.length - 1] <= 2) {
      strokePointCounts.pop();
    }

    const letterGlyphSignatures: Record<string, string> = {
      "13,9,15": "A",
      "13,49,34,24": "B",
      "13,83": "C",
      "13,149": "C",
      "13,44,44": "D"
    };
    const digitGlyphSignatures: Record<string, string> = {
      "16": "1",
      "21": "1",
      "131": "2",
      "78": "3",
      "12,5": "4"
    };

    for (let splitIndex = 1; splitIndex < strokePointCounts.length; splitIndex++) {
      const letter = letterGlyphSignatures[strokePointCounts.slice(0, splitIndex).join(",")];
      const digit = digitGlyphSignatures[strokePointCounts.slice(splitIndex).join(",")];
      if (letter && digit) return `${letter}${digit}`;
    }

    return null;
  };

  const getDatumTargetPresentationType = (annotationId: string): string => {
    const annotationRefs = getEntityRefs(annotationId);
    const curveSetId = annotationRefs[annotationRefs.length - 1];
    if (!curveSetId) return "Datum Target";

    const curveRefs = getEntityRefs(curveSetId);
    const signature = curveRefs
      .map((ref) => getEntityRefs(ref).length)
      .filter((count) => count > 0)
      .join(",");

    if (signature === "2,2,2,13,149,21" || signature === "2,2,2,13,44,44,21") {
      return "Rectangle Datum Target Zone";
    }

    return "Point Datum Target";
  };

  const getDatumTargetPresentationPoint = (annotationId: string): { x: number; y: number; z: number } | null => {
    const annotationRefs = getEntityRefs(annotationId);
    const curveSetId = annotationRefs[annotationRefs.length - 1];
    if (!curveSetId) return null;

    const curveRefs = getEntityRefs(curveSetId);
    const markerCurve = [...curveRefs].reverse().find((curveRef) => {
      const pointRefs = getEntityRefs(curveRef).filter((ref) => !!getCartesianPoint(ref));
      return pointRefs.length >= 2;
    });
    if (!markerCurve) return null;

    const points = getEntityRefs(markerCurve)
      .map(getCartesianPoint)
      .filter((point): point is { x: number; y: number; z: number } => !!point);
    if (points.length === 0) return null;

    const min = points.reduce(
      (acc, point) => ({
        x: Math.min(acc.x, point.x),
        y: Math.min(acc.y, point.y),
        z: Math.min(acc.z, point.z)
      }),
      { x: Infinity, y: Infinity, z: Infinity }
    );
    const max = points.reduce(
      (acc, point) => ({
        x: Math.max(acc.x, point.x),
        y: Math.max(acc.y, point.y),
        z: Math.max(acc.z, point.z)
      }),
      { x: -Infinity, y: -Infinity, z: -Infinity }
    );

    return {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2
    };
  };

  const getDatumPresentationLandingPoint = (annotationId: string): { x: number; y: number; z: number } | null => {
    const annotationRefs = getEntityRefs(annotationId);
    const curveSetId = annotationRefs[annotationRefs.length - 1];
    if (!curveSetId) return null;

    const curveRefs = getEntityRefs(curveSetId);
    const twoPointCurves = curveRefs
      .map((curveRef) => ({
        curveRef,
        points: getEntityRefs(curveRef)
          .map(getCartesianPoint)
          .filter((point): point is { x: number; y: number; z: number } => !!point)
      }))
      .filter((curve) => curve.points.length === 2)
      .map((curve) => ({
        ...curve,
        lengthSq: squaredDistance(curve.points[0], curve.points[1])
      }))
      .sort((a, b) => b.lengthSq - a.lengthSq);

    const leaderCurve = twoPointCurves[0];
    if (!leaderCurve) return null;

    const otherPoints = curveRefs
      .filter((curveRef) => curveRef !== leaderCurve.curveRef)
      .flatMap((curveRef) => getEntityRefs(curveRef).map(getCartesianPoint))
      .filter((point): point is { x: number; y: number; z: number } => !!point);
    const otherCenter = pointCentroid(otherPoints);
    if (!otherCenter) return leaderCurve.points[1];

    return squaredDistance(leaderCurve.points[0], otherCenter) > squaredDistance(leaderCurve.points[1], otherCenter)
      ? leaderCurve.points[0]
      : leaderCurve.points[1];
  };

  const getDatumTargetPresentationLandingPoint = getDatumPresentationLandingPoint;

  const getAp242LeaderLandingPoint = (annotationId: string): { x: number; y: number; z: number } | null => {
    const walk = (id: string, depth = 4, visited = new Set<string>()): string[] => {
      if (!id || depth < 0 || visited.has(id)) return [];
      visited.add(id);

      const statement = entityStatements.get(id) || "";
      const refs = getEntityRefs(id);
      const pointRefs = /^APLL_POINT\s*\(/i.test(statement) ? [id] : [];
      const childPointRefs = refs.flatMap((ref) => walk(ref, depth - 1, visited));
      visited.delete(id);
      return [...pointRefs, ...childPointRefs];
    };

    const pointRefs = walk(annotationId)
      .filter((ref, index, all) => all.indexOf(ref) === index);
    if (pointRefs.length === 0) return null;

    const arrowPoint =
      pointRefs
        .map((ref) => ({ ref, statement: entityStatements.get(ref) || "" }))
        .find((item) => /ARROWHEAD/i.test(item.statement))?.ref ||
      pointRefs[pointRefs.length - 1];

    return getCartesianPoint(arrowPoint);
  };

  const getPresentationLandingPointForShapeAspect = (shapeAspectId: string): { x: number; y: number; z: number } | null => {
    const relatedShapeAspectIds = getUsedIn(shapeAspectId, /SHAPE_ASPECT_RELATIONSHIP/i)
      .flatMap(getEntityRefs)
      .filter((ref, index, all) =>
        ref !== shapeAspectId && all.indexOf(ref) === index
      );
    const lookupIds = [shapeAspectId, ...relatedShapeAspectIds];
    const annotationIds = Array.from(entityStatements.entries())
      .filter(([, statement]) => /^DRAUGHTING_MODEL_ITEM_ASSOCIATION/i.test(statement))
      .flatMap(([associationId]) => {
        const refs = getEntityRefs(associationId);
        const associatedShapeAspectId = refs[0];
        const annotationId = refs[2];
        return associatedShapeAspectId && annotationId && lookupIds.includes(associatedShapeAspectId)
          ? [annotationId]
          : [];
      });

    for (const annotationId of annotationIds) {
      const ap242Landing = getAp242LeaderLandingPoint(annotationId);
      if (ap242Landing) return ap242Landing;

      const ap203Landing = getDatumPresentationLandingPoint(annotationId);
      if (ap203Landing) return ap203Landing;

      const presentationCentroid = pointCentroid(getEntityCartesianPoints(annotationId, 8));
      if (presentationCentroid) return presentationCentroid;
    }

    return null;
  };

  const getDatumPresentationLandingPointByIdentifier = (identifier: string): { x: number; y: number; z: number } | null => {
    const pattern = new RegExp(`Datum\\s+Feature\\s+Symbol\\s+${identifier}`, "i");
    for (const [entityId, statement] of entityStatements.entries()) {
      if (!pattern.test(statement)) continue;
      if (/^ANNOTATION_TO_MODEL_LEADER_LINE\s*\(/i.test(statement)) {
        const pointRefs = getEntityRefs(entityId).filter((ref) => /^APLL_POINT\s*\(/i.test(entityStatements.get(ref) || ""));
        const arrowPoint =
          pointRefs.find((ref) => /ARROWHEAD/i.test(entityStatements.get(ref) || "")) ||
          pointRefs[pointRefs.length - 1];
        const landing = arrowPoint ? getCartesianPoint(arrowPoint) : null;
        if (landing) return landing;
      }
      const landing = getAp242LeaderLandingPoint(entityId);
      if (landing) return landing;
    }
    return null;
  };

  const getVectorData = (vectorId: string): { direction: { x: number; y: number; z: number }; length: number } | null => {
    const statement = entityStatements.get(vectorId);
    if (!statement || getEntityType(vectorId) !== "VECTOR") return null;

    const refs = getEntityRefs(vectorId);
    const direction = refs[0] ? getDirection(refs[0]) : null;
    const magnitude = getEntityParams(vectorId)[2]
      ?.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[Ee][-+]?\d+)?/);
    if (!direction || !magnitude) return null;

    return {
      direction,
      length: parseFloat(magnitude[0])
    };
  };

  const getLineSegment = (entityId: string): {
    id: string;
    start: { x: number; y: number; z: number };
    end: { x: number; y: number; z: number };
    direction: { x: number; y: number; z: number };
    length: number;
  } | null => {
    const type = getEntityType(entityId);
    const coordinateScale = getDefaultLengthScaleToMillimeters();
    if (type === "TRIMMED_CURVE") {
      const trimPoints = getEntityRefs(entityId)
        .map((ref) => getCartesianPoint(ref))
        .filter((point): point is { x: number; y: number; z: number } => !!point)
        .map((point) => scalePoint(point, coordinateScale));
      const trimStart = trimPoints[0];
      const trimEnd = trimPoints[1];
      if (trimStart && trimEnd) {
        const direction = normalizeVector(vectorBetween(trimStart, trimEnd));
        const length = Math.sqrt(squaredDistance(trimStart, trimEnd));
        if (direction && Number.isFinite(length) && length > 1e-9) {
          return {
            id: entityId,
            start: trimStart,
            end: trimEnd,
            direction,
            length
          };
        }
      }
    }

    const lineId = type === "TRIMMED_CURVE"
      ? getEntityRefs(entityId).find((ref) => getEntityType(ref) === "LINE")
      : entityId;
    if (!lineId || getEntityType(lineId) !== "LINE") return null;

    const refs = getEntityRefs(lineId);
    const start = refs[0] ? getCartesianPoint(refs[0]) : null;
    const vector = refs[1] ? getVectorData(refs[1]) : null;
    if (!start || !vector || !Number.isFinite(vector.length) || vector.length <= 1e-9) return null;

    return {
      id: entityId,
      start: scalePoint(start, coordinateScale),
      end: {
        x: (start.x + vector.direction.x * vector.length) * coordinateScale,
        y: (start.y + vector.direction.y * vector.length) * coordinateScale,
        z: (start.z + vector.direction.z * vector.length) * coordinateScale
      },
      direction: vector.direction,
      length: vector.length * coordinateScale
    };
  };

  const addScaledVector = (
    point: { x: number; y: number; z: number },
    direction: { x: number; y: number; z: number },
    scale: number
  ) => ({
    x: point.x + direction.x * scale,
    y: point.y + direction.y * scale,
    z: point.z + direction.z * scale
  });

  const getCircularCurveSegment = (entityId: string): {
    points: { x: number; y: number; z: number }[];
    center: { x: number; y: number; z: number };
    normal?: { x: number; y: number; z: number };
  } | null => {
    if (getEntityType(entityId) !== "TRIMMED_CURVE") return null;

    const refs = getEntityRefs(entityId);
    const circleId = refs.find((ref) => getEntityType(ref) === "CIRCLE");
    if (!circleId) return null;

    const circleRefs = getEntityRefs(circleId);
    const placementId = circleRefs.find((ref) => getEntityType(ref) === "AXIS2_PLACEMENT_3D");
    if (!placementId) return null;

    const circleParams = getEntityParams(circleId);
    const radiusMatch = circleParams[circleParams.length - 1]?.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[Ee][-+]?\d+)?/);
    const radius = radiusMatch ? parseFloat(radiusMatch[0]) * getDefaultLengthScaleToMillimeters() : NaN;
    const placementRefs = getEntityRefs(placementId);
    const centerPointId = placementRefs.find((ref) => getEntityType(ref) === "CARTESIAN_POINT");
    const rawCenter = centerPointId ? getCartesianPoint(centerPointId) : null;
    const normal = placementRefs[1] ? getDirection(placementRefs[1]) : null;
    const xDirection = placementRefs[2] ? getDirection(placementRefs[2]) : null;
    const yDirection = normal && xDirection ? normalizeVector(crossVector(normal, xDirection)) : null;
    if (!rawCenter || !normal || !xDirection || !yDirection || !Number.isFinite(radius) || radius <= 0) {
      return null;
    }

    const coordinateScale = getDefaultLengthScaleToMillimeters();
    const center = scalePoint(rawCenter, coordinateScale);
    const trimPoints = refs
      .map((ref) => getCartesianPoint(ref))
      .filter((point): point is { x: number; y: number; z: number } => !!point)
      .map((point) => scalePoint(point, coordinateScale));
    const start = trimPoints[0];
    const end = trimPoints[1];
    if (!start || !end) return null;

    const angleForPoint = (point: { x: number; y: number; z: number }) => {
      const relative = vectorBetween(center, point);
      return Math.atan2(dotVector(relative, yDirection), dotVector(relative, xDirection));
    };
    const startAngle = angleForPoint(start);
    let endAngle = angleForPoint(end);
    while (endAngle < startAngle) endAngle += Math.PI * 2;
    const segmentCount = Math.max(16, Math.ceil(((endAngle - startAngle) / (Math.PI * 2)) * 64));
    const points: { x: number; y: number; z: number }[] = [];
    for (let index = 0; index <= segmentCount; index++) {
      const theta = startAngle + (endAngle - startAngle) * (index / segmentCount);
      points.push(
        addScaledVector(
          addScaledVector(center, xDirection, Math.cos(theta) * radius),
          yDirection,
          Math.sin(theta) * radius
        )
      );
    }

    return { points, center, normal };
  };

  const vectorBetween = (
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number }
  ) => ({ x: b.x - a.x, y: b.y - a.y, z: b.z - a.z });

  const getDatumTargetPresentationRectangleZone = (
    landingPoint: { x: number; y: number; z: number } | null
  ): ParsedStepDatumTarget["targetZone"] | null => {
    if (!landingPoint) return null;

    const segments = Array.from(entityStatements.keys())
      .filter((entityId) => getEntityType(entityId) === "TRIMMED_CURVE")
      .map(getLineSegment)
      .filter((segment): segment is NonNullable<ReturnType<typeof getLineSegment>> => !!segment);
    const pointTolerance = 1e-4;
    const midpointTolerance = 1e-3;
    const pointsCoincident = (
      a: { x: number; y: number; z: number },
      b: { x: number; y: number; z: number }
    ) => squaredDistance(a, b) <= pointTolerance * pointTolerance;
    const segmentMidpoint = (segment: (typeof segments)[number]) => ({
      x: (segment.start.x + segment.end.x) / 2,
      y: (segment.start.y + segment.end.y) / 2,
      z: (segment.start.z + segment.end.z) / 2
    });

    const getOutwardVector = (
      segment: (typeof segments)[number],
      fromPoint: { x: number; y: number; z: number }
    ) => {
      if (pointsCoincident(segment.start, fromPoint)) return vectorBetween(segment.start, segment.end);
      if (pointsCoincident(segment.end, fromPoint)) return vectorBetween(segment.end, segment.start);
      return null;
    };

    const candidateEdges = segments
      .filter((segment) => squaredDistance(segmentMidpoint(segment), landingPoint) <= midpointTolerance * midpointTolerance)
      .sort((a, b) => a.length - b.length);

    for (const edge of candidateEdges) {
      const edgeDirection = normalizeVector(vectorBetween(edge.start, edge.end));
      if (!edgeDirection) continue;

      const startAdjacents = segments
        .filter((segment) => segment.id !== edge.id)
        .map((segment) => ({ segment, vector: getOutwardVector(segment, edge.start) }))
        .filter((item): item is { segment: (typeof segments)[number]; vector: { x: number; y: number; z: number } } => !!item.vector);
      const endAdjacents = segments
        .filter((segment) => segment.id !== edge.id)
        .map((segment) => ({ segment, vector: getOutwardVector(segment, edge.end) }))
        .filter((item): item is { segment: (typeof segments)[number]; vector: { x: number; y: number; z: number } } => !!item.vector);

      for (const startAdjacent of startAdjacents) {
        const sideDirection = normalizeVector(startAdjacent.vector);
        if (!sideDirection || Math.abs(dotVector(edgeDirection, sideDirection)) > 0.05) continue;

        const sideLength = Math.hypot(startAdjacent.vector.x, startAdjacent.vector.y, startAdjacent.vector.z);
        if (sideLength <= 1e-9) continue;

        for (const endAdjacent of endAdjacents) {
          const endSideDirection = normalizeVector(endAdjacent.vector);
          if (!endSideDirection) continue;
          const endSideLength = Math.hypot(endAdjacent.vector.x, endAdjacent.vector.y, endAdjacent.vector.z);
          if (Math.abs(sideLength - endSideLength) > Math.max(sideLength, endSideLength) * 0.02) continue;
          if (dotVector(sideDirection, endSideDirection) < 0.95) continue;

          const normal = normalizeVector(crossVector(edgeDirection, sideDirection));
          if (!normal) continue;

          const center = {
            x: (edge.start.x + edge.end.x + edge.start.x + startAdjacent.vector.x + edge.end.x + endAdjacent.vector.x) / 4,
            y: (edge.start.y + edge.end.y + edge.start.y + startAdjacent.vector.y + edge.end.y + endAdjacent.vector.y) / 4,
            z: (edge.start.z + edge.end.z + edge.start.z + startAdjacent.vector.z + edge.end.z + endAdjacent.vector.z) / 4
          };

          return {
            shape: "rectangle",
            width: edge.length,
            length: sideLength,
            center,
            normal,
            xDirection: edgeDirection,
            yDirection: sideDirection
          };
        }
      }
    }

    return null;
  };

  const getFacePlane = (targetId: string): {
    point: { x: number; y: number; z: number };
    normal: { x: number; y: number; z: number };
  } | null => {
    const planeId = [targetId, ...getEntityRefs(targetId)]
      .find((ref) => getEntityType(ref) === "PLANE");
    const placementId = planeId
      ? getEntityRefs(planeId).find((ref) => getEntityType(ref) === "AXIS2_PLACEMENT_3D")
      : null;
    if (!placementId) return null;

    const placementRefs = getEntityRefs(placementId);
    const pointId = placementRefs.find((ref) => getEntityType(ref) === "CARTESIAN_POINT");
    const rawPoint = pointId ? getCartesianPoint(pointId) : null;
    const normal = placementRefs[1] ? getDirection(placementRefs[1]) : null;
    if (!rawPoint || !normal) return null;

    return {
      point: scalePoint(rawPoint, getDefaultLengthScaleToMillimeters()),
      normal
    };
  };

  const getDatumTargetModelRectangleZone = (
    targetId: string,
    landingPoint: { x: number; y: number; z: number } | null
  ): ParsedStepDatumTarget["targetZone"] | null => {
    const facePlane = getFacePlane(targetId);
    if (!facePlane) return null;

    const segments = Array.from(entityStatements.keys())
      .filter((entityId) => getEntityType(entityId) === "TRIMMED_CURVE")
      .map(getLineSegment)
      .filter((segment): segment is NonNullable<ReturnType<typeof getLineSegment>> => !!segment)
      .filter((segment) => segment.length > 1e-6);

    const distanceToPlane = (point: { x: number; y: number; z: number }) =>
      Math.abs(dotVector(vectorBetween(facePlane.point, point), facePlane.normal));
    const pointTolerance = Math.max(getDefaultLengthScaleToMillimeters() * 1e-4, 1e-4);
    const pointsCoincident = (
      a: { x: number; y: number; z: number },
      b: { x: number; y: number; z: number }
    ) => squaredDistance(a, b) <= pointTolerance * pointTolerance;
    const otherEndpoint = (
      segment: (typeof segments)[number],
      shared: { x: number; y: number; z: number }
    ) => pointsCoincident(segment.start, shared)
      ? segment.end
      : pointsCoincident(segment.end, shared)
        ? segment.start
        : null;
    const findSegmentBetween = (
      a: { x: number; y: number; z: number },
      b: { x: number; y: number; z: number },
      excludeIds: string[]
    ) => segments.find((segment) =>
      !excludeIds.includes(segment.id) &&
      (
        (pointsCoincident(segment.start, a) && pointsCoincident(segment.end, b)) ||
        (pointsCoincident(segment.start, b) && pointsCoincident(segment.end, a))
      )
    );

    const candidates: ParsedStepDatumTarget["targetZone"][] = [];
    const sharedPoints = segments.flatMap((segment) => [segment.start, segment.end]);
    for (const shared of sharedPoints) {
      const connected = segments.filter((segment) => otherEndpoint(segment, shared));
      for (let i = 0; i < connected.length; i++) {
        for (let j = i + 1; j < connected.length; j++) {
          const first = connected[i];
          const second = connected[j];
          const firstEnd = otherEndpoint(first, shared);
          const secondEnd = otherEndpoint(second, shared);
          if (!firstEnd || !secondEnd) continue;
          if (Math.abs(dotVector(first.direction, second.direction)) > 0.05) continue;

          const fourth = {
            x: firstEnd.x + secondEnd.x - shared.x,
            y: firstEnd.y + secondEnd.y - shared.y,
            z: firstEnd.z + secondEnd.z - shared.z
          };
          const thirdA = findSegmentBetween(firstEnd, fourth, [first.id, second.id]);
          const thirdB = findSegmentBetween(secondEnd, fourth, [first.id, second.id, thirdA?.id || ""]);
          if (!thirdA || !thirdB) continue;

          const corners = [shared, firstEnd, fourth, secondEnd];
          if (corners.some((corner) => distanceToPlane(corner) > Math.max(pointTolerance * 20, 1e-3))) continue;

          const shortSegment = first.length <= second.length ? first : second;
          const longSegment = first.length > second.length ? first : second;
          const normal = facePlane.normal;
          const center = {
            x: (shared.x + fourth.x) / 2,
            y: (shared.y + fourth.y) / 2,
            z: (shared.z + fourth.z) / 2
          };
          candidates.push({
            shape: "rectangle",
            width: shortSegment.length,
            length: longSegment.length,
            center,
            normal,
            xDirection: shortSegment.direction,
            yDirection: longSegment.direction
          });
        }
      }
    }

    if (candidates.length === 0) return null;
    const unique = candidates.filter((candidate, index, all) =>
      all.findIndex((other) => squaredDistance(other.center, candidate.center) <= pointTolerance * pointTolerance) === index
    );
    const score = (candidate: ParsedStepDatumTarget["targetZone"]) => {
      const area = candidate.width * candidate.length;
      const landingDistance = landingPoint
        ? Math.sqrt(squaredDistance(candidate.center, landingPoint))
        : 0;
      return landingDistance + Math.max(area, 1e-6) * 1e-6;
    };
    return unique.sort((a, b) => score(a) - score(b))[0];
  };

  // Split lines and parse standard ISO 10303-21 data section
  const lines = text.split(/;|\n/);

  // Phase 1: Map raw Cartesian Points
  // Example: #242 = CARTESIAN_POINT('', (12.5, -4.2, 0.0));
  const pointRegex = /#(\d+)\s*=\s*CARTESIAN_POINT\s*\(\s*[^,]*\s*,\s*\(\s*(-?\d+\.?\d*e?-?\d*)\s*,\s*(-?\d+\.?\d*e?-?\d*)\s*,\s*(-?\d+\.?\d*e?-?\d*)\s*\)\s*\)/i;
  
  // Phase 2: Map Cylindrical Surfaces (representing holes in plates)
  // Example: #153 = CYLINDRICAL_SURFACE('', #140, 2.0);
  const cylinderRegex = /#(\d+)\s*=\s*CYLINDRICAL_SURFACE\s*\(\s*[^,]*\s*,\s*#(\d+)\s*,\s*(-?\d+\.?\d*e?-?\d*)\s*\)/i;
  const axisPlacementRegex = /#(\d+)\s*=\s*AXIS2_PLACEMENT_3D\s*\(\s*[^,]*\s*,\s*#(\d+)/i;

  // Phase 2.5: Map 3D GD&T / PMI Tolerancing
  const toleranceRegex = /#(\d+)\s*=\s*(GEOMETRIC_TOLERANCE|FLATNESS_TOLERANCE|CYLINDRICITY_TOLERANCE|POSITION_TOLERANCE|SURFACE_PROFILE_TOLERANCE|PARALLELISM_TOLERANCE|PERPENDICULARITY_TOLERANCE|LINE_PROFILE_TOLERANCE)\s*\((.*?)\)/i;

  // Phase 2.6: Map Datums. DATUM_SYSTEM is intentionally excluded: it
  // references datum letters, but it is not itself a displayed datum feature.
  const datumRegex = /#(\d+)\s*=\s*(DATUM|DATUM_FEATURE)\s*\((.*?)\)/i;

  // Phase 3: Secondary structural items 
  const faceRegex = /ADVANCED_FACE|FACE_SURFACE|FACE_BOUND/i;
  const lineRegex = /LINE|EDGE_CURVE|POLYLINE/i;
  // Match any #123 = ENTITY_NAME(...) pattern
  const entityPattern = /#(\d+)\s*=/;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (entityPattern.test(line)) {
      rawEntitiesCount++;
    }

    // Parse Cartesian Points
    const ptMatch = line.match(pointRegex);
    if (ptMatch) {
      const id = parseInt(ptMatch[1], 10);
      const x = parseFloat(ptMatch[2]);
      const y = parseFloat(ptMatch[3]);
      const z = parseFloat(ptMatch[4]);
      if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
        points.push({ id, x, y, z });
      }
      continue;
    }

    // Parse DRAUGHTING_MODEL_ITEM_ASSOCIATION to link shape aspects to draughting annotations
    const assocMatch = line.match(/#(\d+)\s*=\s*DRAUGHTING_MODEL_ITEM_ASSOCIATION\s*\(\s*[^,]*\s*,\s*[^,]*\s*,\s*#(\d+)\s*,\s*#(\d+)\s*,\s*#(\d+)\s*\)/i);
    if (assocMatch) {
      draughtingAssociations.push({
        shapeAspectId: `#${assocMatch[2]}`,
        annotationId: `#${assocMatch[4]}`
      });
    }

    // Parse GEOMETRIC_ITEM_SPECIFIC_USAGE to link shape aspects to target B-Rep entities (faces)
    const usageMatch = line.match(/#(\d+)\s*=\s*GEOMETRIC_ITEM_SPECIFIC_USAGE\s*\(\s*[^,]*\s*,\s*[^,]*\s*,\s*#(\d+)\s*,\s*#(\d+)\s*,\s*#(\d+)\s*\)/i);
    if (usageMatch) {
      geometricUsages.push({
        shapeAspectId: `#${usageMatch[2]}`,
        targetId: `#${usageMatch[4]}`
      });
    }

    // AP242 can bind a semantic shape aspect to one or more B-Rep items via
    // ITEM_IDENTIFIED_REPRESENTATION_USAGE and SET_REPRESENTATION_ITEM.
    if (/ITEM_IDENTIFIED_REPRESENTATION_USAGE\s*\(/i.test(line)) {
      const refs = line.match(/#\d+/g) || [];
      if (refs.length >= 4) {
        const shapeAspectId = refs[1];
        for (const targetId of refs.slice(3).filter(isGeometryTargetEntity)) {
          geometricUsages.push({ shapeAspectId, targetId });
        }
      }
    }

    // AP242 placed datum targets point at their measured target feature through
    // FEATURE_FOR_DATUM_TARGET_RELATIONSHIP before GISU/IIRU binds geometry.
    const targetFeatureMatch = line.match(/#(\d+)\s*=\s*FEATURE_FOR_DATUM_TARGET_RELATIONSHIP\s*\(\s*[^,]*\s*,\s*[^,]*\s*,\s*#(\d+)\s*,\s*#(\d+)\s*\)/i);
    if (targetFeatureMatch) {
      datumTargetFeatureRelations.push({
        targetFeatureId: `#${targetFeatureMatch[2]}`,
        datumTargetId: `#${targetFeatureMatch[3]}`
      });
    }

    // Parse AP203 annotation occurrences (e.g. #3414=ANNOTATION_OCCURRENCE('datum',...))
    const annMatch = line.match(/#(\d+)\s*=\s*(\w+)\s*\(\s*'(datum|datum target|fcf)'/i);
    if (annMatch) {
      const annotationId = `#${annMatch[1]}`;
      const annotationType = annMatch[3].toLowerCase();
      if (annotationType === "datum") {
        datumAnnotations.push(annotationId);
      } else if (annotationType === "datum target") {
        datumTargetAnnotations.push(annotationId);
      } else if (annotationType === "fcf") {
        fcfAnnotations.push(annotationId);
      }
    }

    // Parse Cylindrical surfs for holes
    const cylMatch = line.match(cylinderRegex);
    if (cylMatch) {
      const id = parseInt(cylMatch[1], 10);
      const placementId = parseInt(cylMatch[2], 10);
      const radius = parseFloat(cylMatch[3]);
      if (!isNaN(radius)) {
        cylinders.push({
          id,
          radius,
          diameter: radius * 2,
          centerId: placementId
        });
        cylinderIds.push(`#${id}`);
      }
      continue;
    }

    const placementMatch = line.match(axisPlacementRegex);
    if (placementMatch) {
      axisPlacementPointIds.set(parseInt(placementMatch[1], 10), parseInt(placementMatch[2], 10));
      continue;
    }

    // Parse geometric tolerances from NIST files
    const tolMatch = line.match(toleranceRegex);
    if (tolMatch) {
      const parentId = `#${tolMatch[1]}`;
      const className = tolMatch[2].toUpperCase();
      const rawParams = tolMatch[3];
      
      const quoteMatches = rawParams.match(/'([^']*)'/g) || [];
      const title = quoteMatches.length > 0 ? quoteMatches[0].replace(/'/g, "") : className.replace("_TOLERANCE", "");
      
      const numericMatches = rawParams.replace(/'[^']*'/g, "").match(/-?\d+\.?\d*/g) || [];
      const val = numericMatches.length > 0 ? parseFloat(numericMatches[0]) : 0.05;
      
      const hashMatches = rawParams.match(/#(\d+)/g) || [];
      const targetId = hashMatches.length > 0 ? hashMatches[0] : "";
      
      let typeStr = "Geometric Tolerance";
      let symbol = "⌖";
      let category: "Form" | "Orientation" | "Location" | "Profile" | "Dimension" = "Location";
      let clinicalContext = "Surgical lock compliance metric.";
      
      if (className.includes("FLATNESS") || title.toUpperCase().includes("FLATNESS")) {
        typeStr = "Flatness";
        symbol = "▱";
        category = "Form";
        clinicalContext = "Assures uniform physical bone contact. Prevents pressure hot-spots and mechanical stress concentrations during mastication.";
      } else if (className.includes("CYLINDRICITY") || title.toUpperCase().includes("CYLINDRICITY")) {
        typeStr = "Cylindricity";
        symbol = "⌭";
        category = "Form";
        clinicalContext = "Guarantees perfect roundness of titanium screw locks. Eliminates threading resistance and prevents lateral post-operative wobble.";
      } else if (className.includes("POSITION") || title.toUpperCase().includes("POSITION")) {
        typeStr = "Position";
        symbol = "⌖";
        category = "Location";
        clinicalContext = "Preserves spacing of medical screwholes. Ensures physical alignment with bone-contouring guides and virtual drill pathways.";
      } else if (className.includes("SURFACE_PROFILE") || className.includes("SURFACE PROFILE") || title.toUpperCase().includes("SURFACE") || title.toUpperCase().includes("PROFILE")) {
        typeStr = "Surface Profile";
        symbol = "⌒";
        category = "Profile";
        clinicalContext = "Establishes clinical soft-tissue safety. Prevents sharp titanium edge impaction, reducing risks of periosteal tearing or inflammation.";
      } else if (className.includes("PARALLELISM") || title.toUpperCase().includes("PARALLELISM")) {
        typeStr = "Parallelism";
        symbol = "∥";
        category = "Orientation";
        clinicalContext = "Coordinates upper and lower reconstruction plate load margins. Ensures uniform stress distribution during facial flexion.";
      } else if (className.includes("PERPENDICULARITY") || title.toUpperCase().includes("PERPENDICULARITY")) {
        typeStr = "Perpendicularity";
        symbol = "⟂";
        category = "Orientation";
        clinicalContext = "Aligns the locking screw head engagement perpendicular to the plating plane, preventing eccentric shear loading.";
      } else if (className.includes("LINE_PROFILE") || title.toUpperCase().includes("LINE PROFILE")) {
        typeStr = "Line Profile";
        symbol = "⏤";
        category = "Profile";
        clinicalContext = "Guarantees high-precision edge boundaries along anatomical curved borders for custom titanium mesh fits.";
      }

      const targetEntityType = targetId ? getEntityType(targetId) : "";
      const targetName = targetId
        ? `${targetEntityType ? targetEntityType.replace(/_/g, " ") : "B-Rep entity"} (${targetId})`
        : "Unresolved tolerance target";

      parsedTolerances.push({
        id: `PMI-STP-${parsedTolerances.length + 1}`,
        entityId: parentId,
        type: typeStr,
        symbol,
        value: val,
        targetId,
        targetName,
        category,
        clinicalContext
      });
      continue;
    }

    // Parse Datums from STEP files
    const datumMatch = line.match(datumRegex);
    if (datumMatch) {
      const parentId = `#${datumMatch[1]}`;
      const datumKind = datumMatch[2].toUpperCase();
      const rawParams = datumMatch[3];

      if (datumKind !== "DATUM") {
        continue;
      }

      const quoteMatches = rawParams.match(/'([^']*)'/g) || [];
      const identifier = quoteMatches
        .map((value) => value.replace(/'/g, "").trim().toUpperCase())
        .reverse()
        .find((value) => /^[A-Z]$/.test(value)) || "A";

      const hashMatches = rawParams.match(/#(\d+)/g) || [];
      const targetId = hashMatches.length > 0 ? hashMatches[0] : "";

      let typeStr = "Reference Surface Plane";
      let clinicalContext = "Establishes a critical surgical 3D reference datum.";

      if (identifier === "A") {
        typeStr = "Primary Flat Datum Plane";
        clinicalContext = "Primary osteotomy reference landing plane ensuring completely flush contact. Restricts 3 degrees of freedom.";
      } else if (identifier === "B") {
        typeStr = "Secondary Cylindrical Axis / Hole Center";
        clinicalContext = "Secondary alignment datum features; locks double lateral translations to prevent side-to-side skeletal translation.";
      } else if (identifier === "C") {
        typeStr = "Tertiary Parallel Edge / Slot Centerplane";
        clinicalContext = "Tertiary clocking datum securing rotational stability, fully restraining the implant assembly from twisting under muscle load.";
      } else {
        const isCylinder = rawParams.toUpperCase().includes("CYL") || rawParams.toUpperCase().includes("HOLE") || rawParams.toUpperCase().includes("BORE") || rawParams.toUpperCase().includes("CONIC");
        typeStr = `Auxiliary Reference ${isCylinder ? "Cylindrical Axis" : "Surface Plane"}`;
        clinicalContext = `Auxiliary reference datum [ ${identifier} ] constraining additional degrees of freedom to maximize absolute mechanical stability under mastication or flexion loads.`;
      }

      const targetEntityType = targetId ? getEntityType(targetId) : "";
      const targetName = targetId
        ? `${targetEntityType ? targetEntityType.replace(/_/g, " ") : "B-Rep feature"} (${targetId})`
        : "Unresolved datum target";

      parsedDatums.push({
        id: `PMI-DTM-${parsedDatums.length + 1}`,
        entityId: parentId,
        name: `Datum ${identifier}`,
        identifier,
        type: typeStr,
        symbol: `[ ${identifier} ]`,
        targetId,
        targetIds: targetId ? [targetId] : [],
        targetName,
        clinicalContext
      });
      continue;
    }

    // Parse face records to link surface / geometric elements to Three.js meshes
    const faceMatch = line.match(/#(\d+)\s*=\s*(ADVANCED_FACE|FACE_SURFACE)\s*\((.*?)\)/i);
    if (faceMatch) {
      const faceId = `#${faceMatch[1]}`;
      const params = faceMatch[3];
      const referenced = (params.match(/#(\d+)/g) || []);
      faceRecords.push({ id: faceId, referencedIds: referenced });
    }

    if (faceRegex.test(line)) facesCount++;
    if (lineRegex.test(line)) linesCount++;
  }

  const collectTopologicalFaceRefs = (
    entityId: string,
    depth = 0,
    visited = new Set<string>()
  ): string[] => {
    if (depth > 8 || visited.has(entityId)) return [];
    visited.add(entityId);

    const refs = getEntityRefs(entityId).filter((ref) =>
      getEntityTypeNames(ref).some((type) =>
        /ADVANCED_FACE|FACE_SURFACE|FACE_BOUND|FACE_OUTER_BOUND|EDGE_LOOP|ORIENTED_EDGE|EDGE_CURVE|VERTEX_POINT|TRIMMED_CURVE|CIRCLE|LINE|CONIC|PLANE|CYLINDRICAL_SURFACE|CONICAL_SURFACE|SPHERICAL_SURFACE|TOROIDAL_SURFACE|B_SPLINE_SURFACE|AXIS2_PLACEMENT_3D|CARTESIAN_POINT|DIRECTION/i.test(type)
      )
    );

    return [
      ...refs,
      ...refs.flatMap((ref) => collectTopologicalFaceRefs(ref, depth + 1, new Set(visited)))
    ].filter((ref, index, all) => all.indexOf(ref) === index);
  };

  faceRecords.forEach((faceRecord) => {
    faceRecord.referencedIds = [
      ...faceRecord.referencedIds,
      ...collectTopologicalFaceRefs(faceRecord.id)
    ].filter((ref, index, all) => all.indexOf(ref) === index);
  });

  const holes = cylinders.flatMap((cyl, index) => {
    const centerPointId = cyl.centerId ? axisPlacementPointIds.get(cyl.centerId) || cyl.centerId : undefined;
    const pointRef = points.find(p => p.id === centerPointId);
    if (!pointRef) return [];

    return [{
      id: `Hole-${index + 1} (Entity #${cyl.id})`,
      center: { x: pointRef.x, y: pointRef.y, z: pointRef.z },
      diameter: parseFloat(cyl.diameter.toFixed(2)),
      edgeDistance: 0
    }];
  });

  // Calculate overall bounding box dimensions based on points
  let minX = 0, maxX = 0, minY = 0, maxY = 0, minZ = 0, maxZ = 0;
  if (points.length > 0) {
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const zs = points.map(p => p.z).filter(z => Math.abs(z) < 25); // Filter extreme layout markers

    minX = Math.min(...xs);
    maxX = Math.max(...xs);
    minY = Math.min(...ys);
    maxY = Math.max(...ys);
    if (zs.length > 0) {
      minZ = Math.min(...zs);
      maxZ = Math.max(...zs);
    }
  }

  const width = parseFloat((maxX - minX).toFixed(2));
  const length = parseFloat((maxY - minY).toFixed(2));
  const estimatedThickness = parseFloat((maxZ - minZ).toFixed(2));

  // Phase 4: Correlate and resolve datum target faces / shapes dynamically
  const shapeAspectToTarget = new Map<string, string[]>();
  for (const usage of geometricUsages) {
    const targets = shapeAspectToTarget.get(usage.shapeAspectId) || [];
    if (!targets.includes(usage.targetId)) {
      targets.push(usage.targetId);
    }
    shapeAspectToTarget.set(usage.shapeAspectId, targets);
  }

  const placedDatumTargetToFeature = new Map<string, string[]>();
  for (const relation of datumTargetFeatureRelations) {
    const features = placedDatumTargetToFeature.get(relation.datumTargetId) || [];
    if (!features.includes(relation.targetFeatureId)) {
      features.push(relation.targetFeatureId);
    }
    placedDatumTargetToFeature.set(relation.datumTargetId, features);
  }

  const annotationToShapeAspect = new Map<string, string[]>();
  for (const assoc of draughtingAssociations) {
    const aspects = annotationToShapeAspect.get(assoc.annotationId) || [];
    if (!aspects.includes(assoc.shapeAspectId)) {
      aspects.push(assoc.shapeAspectId);
    }
    annotationToShapeAspect.set(assoc.annotationId, aspects);
  }

  const collectShapeAspectTargets = (id: string, visited = new Set<string>()): string[] => {
    if (!id) return [];
    if (visited.has(id)) return [];
    visited.add(id);

    const directTargets = shapeAspectToTarget.get(id);
    const resolved = [...(directTargets || [])];

    for (const relationshipId of getUsedIn(id, /SHAPE_ASPECT_RELATIONSHIP/i)) {
      for (const ref of getEntityRefs(relationshipId)) {
        if (ref === id) continue;
        for (const target of collectShapeAspectTargets(ref, visited)) {
          if (!resolved.includes(target)) {
            resolved.push(target);
          }
        }
      }
    }

    return resolved;
  };

  const resolveTargetsForId = (id: string): string[] => {
    if (!id) return [];

    const directTargets = shapeAspectToTarget.get(id);
    if (directTargets && directTargets.length > 0) {
      return directTargets;
    }

    const datumTargetFeatures = placedDatumTargetToFeature.get(id) || [];
    const resolvedFromDatumTargetFeatures: string[] = [];
    for (const featureId of datumTargetFeatures) {
      for (const target of collectShapeAspectTargets(featureId)) {
        if (!resolvedFromDatumTargetFeatures.includes(target)) {
          resolvedFromDatumTargetFeatures.push(target);
        }
      }
    }
    if (resolvedFromDatumTargetFeatures.length > 0) {
      return resolvedFromDatumTargetFeatures;
    }

    const aspects = annotationToShapeAspect.get(id) || [];
    const resolved: string[] = [];
    for (const aspect of aspects) {
      const targets = collectShapeAspectTargets(aspect);
      for (const target of targets) {
        if (!resolved.includes(target)) {
          resolved.push(target);
        }
      }
    }
    return resolved;
  };

  const nextDatumIdentifier = (usedIdentifiers: Set<string>): string => {
    let code = 65; // 'A'
    while (usedIdentifiers.has(String.fromCharCode(code))) {
      code++;
    }
    return String.fromCharCode(code);
  };

  const getTargetSurfaceType = (targetId: string): "plane" | "cylinder" | "curved" | "unknown" => {
    const statement = entityStatements.get(targetId);
    if (!statement) return "unknown";

    const refs = statement.match(/#\d+/g) || [];
    const surfaceStatements = [statement, ...refs.map((ref) => entityStatements.get(ref) || "")];
    if (surfaceStatements.some((value) => /^PLANE\s*\(/i.test(value))) return "plane";
    if (surfaceStatements.some((value) => /^CYLINDRICAL_SURFACE\s*\(/i.test(value))) return "cylinder";
    if (surfaceStatements.some((value) => /^(CONICAL_SURFACE|SPHERICAL_SURFACE|TOROIDAL_SURFACE|B_SPLINE_SURFACE)\s*\(/i.test(value))) return "curved";
    return "unknown";
  };

  const getOwningFaceIdsForTarget = (targetId: string): string[] => {
    const owners = faceRecords
      .filter((faceRecord) => faceRecord.id === targetId || faceRecord.referencedIds.includes(targetId))
      .map((faceRecord) => faceRecord.id);
    return owners.filter((owner, index, all) => all.indexOf(owner) === index);
  };

  const isLinearDimensionSubEntityOfSingleCurvedFace = (
    dimensionKind: ParsedStepTolerance["dimensionKind"],
    targetIds: string[],
    isDatumTargetDimension = false
  ): boolean => {
    if (dimensionKind !== "linear" || isDatumTargetDimension || targetIds.length < 2) return false;

    const ownerGroups = targetIds
      .map(getOwningFaceIdsForTarget)
      .filter((owners) => owners.length > 0);
    if (ownerGroups.length < 2) return false;

    const commonOwners = ownerGroups
      .slice(1)
      .reduce(
        (common, owners) => common.filter((owner) => owners.includes(owner)),
        ownerGroups[0]
      );
    if (commonOwners.length !== 1) return false;

    const ownerSurfaceType = getTargetSurfaceType(commonOwners[0]);
    return /cylinder|curved/i.test(ownerSurfaceType);
  };

  const getTargetSurfaceGeometry = (targetId: string): ParsedStepSurfaceGeometry => {
    const surfaceType = getTargetSurfaceType(targetId);
    const statement = entityStatements.get(targetId) || "";
    const refs = statement.match(/#\d+/g) || [];
    const surfaceId = refs.find((ref) => {
      const type = getEntityType(ref);
      return /^(PLANE|CYLINDRICAL_SURFACE|CONICAL_SURFACE|SPHERICAL_SURFACE|TOROIDAL_SURFACE|B_SPLINE_SURFACE)$/i.test(type);
    }) || (getEntityType(targetId).match(/^(PLANE|CYLINDRICAL_SURFACE|CONICAL_SURFACE|SPHERICAL_SURFACE|TOROIDAL_SURFACE|B_SPLINE_SURFACE)$/i) ? targetId : undefined);
    const surfaceRefs = surfaceId ? getEntityRefs(surfaceId) : [];
    const placementId = surfaceRefs.find((ref) => getEntityType(ref) === "AXIS2_PLACEMENT_3D");
    const placementRefs = placementId ? getEntityRefs(placementId) : [];
    const rawPoint = placementRefs[0] ? getCartesianPoint(placementRefs[0]) || undefined : undefined;
    const point = rawPoint ? scalePoint(rawPoint, getDefaultLengthScaleToMillimeters()) : undefined;
    const axis = placementRefs[1] ? getDirection(placementRefs[1]) || undefined : undefined;
    const xDirection = placementRefs[2] ? getDirection(placementRefs[2]) || undefined : undefined;

    return {
      surfaceType,
      targetId,
      placementId,
      point,
      normal: surfaceType === "plane" ? axis : undefined,
      axis: surfaceType === "cylinder" ? axis : undefined,
      xDirection
    };
  };

  const getDatumTargetSetSurfaceGeometry = (targets: ParsedStepDatumTarget[]): ParsedStepSurfaceGeometry[] => {
    const pointEntries: ParsedStepSurfaceGeometry[] = [];
    for (const target of targets) {
      const targetArea = target.targetCircle || target.targetZone;
      if (targetArea && target.targetId) {
        pointEntries.push({
          surfaceType: "plane",
          targetId: target.targetId,
          point: targetArea.center,
          normal: targetArea.normal,
          xDirection: targetArea.xDirection
        });
        continue;
      }

      const rawPoint = target.targetId ? getCartesianPoint(target.targetId) : null;
      const point = target.targetPoint || (rawPoint ? scalePoint(rawPoint, getDefaultLengthScaleToMillimeters()) : undefined);
      if (point && target.targetId) {
        pointEntries.push({
          surfaceType: "unknown",
          targetId: target.targetId,
          point
        });
      }
    }

    if (pointEntries.length < 3) return pointEntries;

    const first = pointEntries[0].point;
    if (!first) return pointEntries;
    for (let i = 1; i < pointEntries.length - 1; i++) {
      for (let j = i + 1; j < pointEntries.length; j++) {
        const second = pointEntries[i].point;
        const third = pointEntries[j].point;
        if (!second || !third) continue;
        const normal = normalizeVector(crossVector(
          { x: second.x - first.x, y: second.y - first.y, z: second.z - first.z },
          { x: third.x - first.x, y: third.y - first.y, z: third.z - first.z }
        ));
        if (!normal) continue;
        return [{
          surfaceType: "plane",
          targetId: pointEntries.map((entry) => entry.targetId).join(","),
          point: pointCentroid(pointEntries.map((entry) => entry.point!).filter(Boolean)) || first,
          normal
        }, ...pointEntries];
      }
    }

    return pointEntries;
  };

  const describeDatumTarget = (targetId: string, identifier: string) => {
    const surfaceType = getTargetSurfaceType(targetId);
    let typeStr = "Reference Surface Plane";
    let targetName = `B-Rep Feature (${targetId})`;
    let clinicalContext = "Establishes a critical surgical 3D reference datum.";

    if (surfaceType === "plane") {
      typeStr = identifier === "A" ? "Primary Flat Datum Plane" : "Planar Datum Feature";
      clinicalContext = identifier === "A"
        ? "Primary osteotomy reference landing plane ensuring completely flush contact. Restricts 3 degrees of freedom."
        : "Planar datum feature establishing a flat inspection reference surface.";
    } else if (surfaceType === "cylinder") {
      typeStr = "Cylindrical Datum Feature / Hole Wall";
      clinicalContext = "Secondary alignment datum features; locks double lateral translations to prevent side-to-side skeletal translation.";
    } else if (surfaceType === "curved") {
      typeStr = "Curved Datum Feature";
      clinicalContext = "Curved reference feature constraining fit and orientation against a non-planar controlled surface.";
    } else if (identifier === "A") {
      typeStr = "Primary Datum Feature";
      clinicalContext = "Primary datum feature establishing the first inspection reference.";
    } else if (identifier === "B") {
      typeStr = "Secondary Datum Feature";
      clinicalContext = "Secondary datum feature constraining additional translation or rotation degrees of freedom.";
    } else if (identifier === "C") {
      typeStr = "Tertiary Parallel Edge / Slot Centerplane";
      clinicalContext = "Tertiary clocking datum securing rotational stability, fully restraining the implant assembly from twisting under muscle load.";
    } else {
      typeStr = "Auxiliary Reference Datum";
      clinicalContext = `Auxiliary reference datum [ ${identifier} ] constraining additional degrees of freedom to maximize absolute mechanical stability under mastication or loads.`;
    }

    if (surfaceType === "plane") {
      targetName = `Datum ${identifier} Planar Face (${targetId})`;
    } else if (surfaceType === "cylinder") {
      targetName = `Datum ${identifier} Cylindrical Face (${targetId})`;
    } else if (surfaceType === "curved") {
      targetName = `Datum ${identifier} Curved Face (${targetId})`;
    } else {
      targetName = `Datum ${identifier} B-Rep Feature (${targetId})`;
    }

    return { typeStr, targetName, clinicalContext };
  };

  const selectDatumAnnotationTargets = (annotationId: string, targetIds: string[]): string[] => {
    if (targetIds.length <= 1) return targetIds;

    const faceTargets = targetIds.filter((targetId) => /^(ADVANCED_FACE|FACE_SURFACE)$/i.test(getEntityType(targetId)));
    if (faceTargets.length === 1) return faceTargets;
    if (faceTargets.length === 0) return targetIds;

    const annotationCenter = pointCentroid(getEntityCartesianPoints(annotationId, 4));
    if (!annotationCenter) return faceTargets;

    const scoredTargets = faceTargets
      .map((targetId, index) => {
        const targetCenter = pointCentroid(getEntityCartesianPoints(targetId, 10));
        return targetCenter
          ? { targetId, index, distance: squaredDistance(annotationCenter, targetCenter) }
          : null;
      })
      .filter((item): item is { targetId: string; index: number; distance: number } => !!item)
      .sort((a, b) => a.distance - b.distance || a.index - b.index);

    return scoredTargets.length > 0 ? [scoredTargets[0].targetId] : faceTargets;
  };

  const toleranceTypes: Record<string, {
    type: string;
    symbol: string;
    category: ParsedStepTolerance["category"];
    clinicalContext: string;
  }> = {
    ANGULARITY_TOLERANCE: {
      type: "Angularity",
      symbol: "ANG",
      category: "Orientation",
      clinicalContext: "Controls angular orientation between controlled and reference features."
    },
    CIRCULAR_RUNOUT_TOLERANCE: {
      type: "Circular Runout",
      symbol: "RUNOUT",
      category: "Form",
      clinicalContext: "Controls circular variation around an established datum axis."
    },
    COAXIALITY_TOLERANCE: {
      type: "Coaxiality",
      symbol: "COAX",
      category: "Location",
      clinicalContext: "Controls shared axis alignment between cylindrical features."
    },
    CONCENTRICITY_TOLERANCE: {
      type: "Concentricity",
      symbol: "CONC",
      category: "Location",
      clinicalContext: "Controls median point alignment around a common axis."
    },
    CYLINDRICITY_TOLERANCE: {
      type: "Cylindricity",
      symbol: "CYL",
      category: "Form",
      clinicalContext: "Guarantees controlled roundness and straightness of cylindrical features."
    },
    FLATNESS_TOLERANCE: {
      type: "Flatness",
      symbol: "FLAT",
      category: "Form",
      clinicalContext: "Assures a controlled flat contact surface and prevents local high spots."
    },
    LINE_PROFILE_TOLERANCE: {
      type: "Line Profile",
      symbol: "LINE_PROFILE",
      category: "Profile",
      clinicalContext: "Controls a two-dimensional profile boundary along a measured section."
    },
    PARALLELISM_TOLERANCE: {
      type: "Parallelism",
      symbol: "PARALLEL",
      category: "Orientation",
      clinicalContext: "Controls parallel orientation to the referenced datum frame."
    },
    PERPENDICULARITY_TOLERANCE: {
      type: "Perpendicularity",
      symbol: "PERP",
      category: "Orientation",
      clinicalContext: "Controls right-angle orientation to the referenced datum frame."
    },
    POSITION_TOLERANCE: {
      type: "Position",
      symbol: "POS",
      category: "Location",
      clinicalContext: "Controls the location of a feature relative to the datum reference frame."
    },
    ROUNDNESS_TOLERANCE: {
      type: "Roundness",
      symbol: "ROUND",
      category: "Form",
      clinicalContext: "Controls circular form independently of feature location."
    },
    STRAIGHTNESS_TOLERANCE: {
      type: "Straightness",
      symbol: "STRAIGHT",
      category: "Form",
      clinicalContext: "Controls straight-line form of a surface element or axis."
    },
    SURFACE_PROFILE_TOLERANCE: {
      type: "Surface Profile",
      symbol: "SURF_PROF",
      category: "Profile",
      clinicalContext: "Controls a three-dimensional surface boundary for fit and clearance."
    },
    SYMMETRY_TOLERANCE: {
      type: "Symmetry",
      symbol: "SYM",
      category: "Location",
      clinicalContext: "Controls symmetric median feature relationship to a datum plane or axis."
    },
    TOTAL_RUNOUT_TOLERANCE: {
      type: "Total Runout",
      symbol: "TOTAL_RUNOUT",
      category: "Form",
      clinicalContext: "Controls cumulative surface variation during full rotation about a datum axis."
    }
  };

  const getToleranceDefinition = (entityType: string) => {
    const normalized = entityType.toUpperCase();
    const key = Object.keys(toleranceTypes).find((item) => normalized.includes(item));
    if (key) return toleranceTypes[key];
    return {
      type: "Geometric Tolerance",
      symbol: "GTOL",
      category: "Location" as const,
      clinicalContext: "Controls a geometric feature according to the semantic PMI definition."
    };
  };

  const directShapeAspectGeometryTargetsCache = new Map<string, string[]>();
  const shapeAspectGeometryTargetsCache = new Map<string, string[]>();
  const expandedShapeAspectFeatureIdsCache = new Map<string, string[]>();
  const immediateShapeAspectChildrenCache = new Map<string, string[]>();
  const descendantShapeAspectGeometryTargetsCache = new Map<string, string[]>();

  const getDirectShapeAspectGeometryTargets = (shapeAspectId: string): string[] => {
    const cached = directShapeAspectGeometryTargetsCache.get(shapeAspectId);
    if (cached) return cached;
    const targets = (shapeAspectToTarget.get(shapeAspectId) || []).filter(isGeometryTargetEntity);
    directShapeAspectGeometryTargetsCache.set(shapeAspectId, targets);
    return targets;
  };

  const getShapeAspectGeometryTargets = (shapeAspectId: string): string[] => {
    const cached = shapeAspectGeometryTargetsCache.get(shapeAspectId);
    if (cached) return cached;

    const directTargets = getDirectShapeAspectGeometryTargets(shapeAspectId);
    if (directTargets.length > 0) {
      shapeAspectGeometryTargetsCache.set(shapeAspectId, directTargets);
      return directTargets;
    }

    const resolved: string[] = [];
    for (const relationshipId of getUsedIn(shapeAspectId, /SHAPE_ASPECT_RELATIONSHIP/i)) {
      for (const ref of getEntityRefs(relationshipId)) {
        if (ref === shapeAspectId) continue;
        if (getEntityType(ref) === "DATUM") continue;
        const directRefTargets = getDirectShapeAspectGeometryTargets(ref);
        const targets = (directRefTargets.length > 0
          ? directRefTargets
          : collectShapeAspectTargets(ref)
        ).filter(isGeometryTargetEntity);
        for (const target of targets) {
          if (!resolved.includes(target)) resolved.push(target);
        }
      }
    }
    shapeAspectGeometryTargetsCache.set(shapeAspectId, resolved);
    return resolved;
  };

  const getDirectionalDatumFeatureGeometryTargets = (featureId: string): string[] => {
    const directTargets = getDirectShapeAspectGeometryTargets(featureId);
    if (directTargets.length > 0) return directTargets;

    const targets: string[] = [];
    for (const relationshipId of getUsedIn(featureId, /SHAPE_ASPECT_RELATIONSHIP/i)) {
      const refs = getEntityRefs(relationshipId);
      if (refs[0] !== featureId) continue;

      for (const childId of refs.slice(1)) {
        if (getEntityType(childId) === "DATUM") continue;
        const childTypeNames = getEntityTypeNames(childId);
        if (!childTypeNames.some((type) =>
          /SHAPE_ASPECT|DATUM_FEATURE|CENTRE_OF_SYMMETRY/i.test(type)
        )) {
          continue;
        }

        const childTargets = getDirectShapeAspectGeometryTargets(childId);
        const resolvedTargets = childTargets.length > 0
          ? childTargets
          : getDescendantShapeAspectGeometryTargets(childId);
        for (const target of resolvedTargets) {
          if (isGeometryTargetEntity(target) && !targets.includes(target)) {
            targets.push(target);
          }
        }
      }
    }
    return targets;
  };

  const uniqueGeometryTargets = (targets: string[]): string[] =>
    targets.filter((target, index, all) => isGeometryTargetEntity(target) && all.indexOf(target) === index);

  const preferDatumSurfaceTargets = (targets: string[]): string[] => {
    const surfaceTargets = targets.filter((targetId) => getTargetSurfaceType(targetId) !== "unknown");
    return surfaceTargets.length > 0 ? surfaceTargets : targets;
  };

  const expandShapeAspectFeatureIds = (featureIds: string[]): string[] => {
    const cacheKey = featureIds.join("|");
    const cached = expandedShapeAspectFeatureIdsCache.get(cacheKey);
    if (cached) return cached;

    const visited = new Set<string>();
    const queue = [...featureIds];

    while (queue.length > 0) {
      const featureId = queue.shift()!;
      if (!featureId || visited.has(featureId)) continue;
      visited.add(featureId);

      for (const relationshipId of getUsedIn(featureId, /SHAPE_ASPECT_RELATIONSHIP/i)) {
        for (const ref of getEntityRefs(relationshipId)) {
          if (ref === featureId || visited.has(ref)) continue;
          const typeNames = getEntityTypeNames(ref);
          if (typeNames.some((type) => /SHAPE_ASPECT|DATUM_FEATURE|CENTRE_OF_SYMMETRY/i.test(type))) {
            queue.push(ref);
          }
        }
      }
    }

    const expanded = Array.from(visited);
    expandedShapeAspectFeatureIdsCache.set(cacheKey, expanded);
    return expanded;
  };

  const getPlanarDatumFeatureKind = (featureIds: string[], targetIds: string[]): "medianPlane" | "twoFaceDimension" | undefined => {
    const planarTargets = targetIds.filter((targetId) => getTargetSurfaceType(targetId) === "plane");
    if (planarTargets.length < 2) return undefined;

    const expandedFeatureIds = expandShapeAspectFeatureIds(featureIds);
    const featureText = expandedFeatureIds
      .map((featureId) => `${getEntityTypeNames(featureId).join(" ")} ${entityStatements.get(featureId) || ""}`)
      .join(" ");
    if (/CENTRE_OF_SYMMETRY|CENTER_OF_SYMMETRY|DERIVED_SHAPE_ASPECT|MEDIAN\s+PLANE/i.test(featureText)) {
      return "medianPlane";
    }

    const relationshipText = expandedFeatureIds
      .flatMap((featureId) => getUsedIn(featureId, /SHAPE_ASPECT_RELATIONSHIP/i))
      .filter((relationshipId, index, all) => all.indexOf(relationshipId) === index)
      .map((relationshipId) => entityStatements.get(relationshipId) || "")
      .join(" ");
    if (planarTargets.length === 2 && /linear\s+dimension|dimensional\s+location/i.test(`${featureText} ${relationshipText}`)) {
      return "twoFaceDimension";
    }

    const componentAspectIds = new Set<string>();
    const planarTargetSet = new Set(planarTargets);

    for (const featureId of expandedFeatureIds) {
      const featureTargets = getShapeAspectGeometryTargets(featureId);
      if (featureTargets.some((targetId) => planarTargetSet.has(targetId))) {
        componentAspectIds.add(featureId);
      }

      for (const relationshipId of getUsedIn(featureId, /SHAPE_ASPECT_RELATIONSHIP/i)) {
        const refs = getEntityRefs(relationshipId);
        if (!refs.includes(featureId)) continue;

        for (const ref of refs) {
          if (ref === featureId) continue;
          if (/DATUM/i.test(getEntityTypeNames(ref).join(" "))) continue;

          const refTargets = getShapeAspectGeometryTargets(ref);
          if (refTargets.some((targetId) => planarTargetSet.has(targetId))) {
            componentAspectIds.add(ref);
          }
        }
      }
    }

    if (componentAspectIds.size < 2) return undefined;

    for (const [entityId] of entityStatements.entries()) {
      const typeNames = getEntityTypeNames(entityId);
      if (!typeNames.some((type) => /DIMENSIONAL_LOCATION/i.test(type))) continue;

      const relatedComponents = getEntityRefs(entityId).filter((ref, index, refs) =>
        componentAspectIds.has(ref) && refs.indexOf(ref) === index
      );
      if (relatedComponents.length >= 2) return "twoFaceDimension";
    }

    return undefined;
  };

  const getExplicitMultiFaceDatumFeatureKind = (featureIds: string[], targetIds: string[]): "multiface" | undefined => {
    if (targetIds.length <= 1) return undefined;
    const featureText = featureIds
      .map((featureId) => `${getEntityTypeNames(featureId).join(" ")} ${entityStatements.get(featureId) || ""}`)
      .join(" ");
    return /DATUM_FEATURE/i.test(featureText) &&
      /multiple\s+elements|COMPOSITE_GROUP_SHAPE_ASPECT/i.test(featureText)
      ? "multiface"
      : undefined;
  };

  const getDirectDatumFeatureDimensionKind = (featureIds: string[], targetIds: string[]): "twoFaceDimension" | undefined => {
    if (targetIds.length !== 2) return undefined;
    const childIds = featureIds
      .flatMap((featureId) => getImmediateShapeAspectChildren(featureId))
      .filter((childId, index, all) => all.indexOf(childId) === index);
    if (childIds.length < 2) return undefined;

    const childSet = new Set(childIds);
    for (const [entityId] of entityStatements.entries()) {
      const typeNames = getEntityTypeNames(entityId);
      if (!typeNames.some((type) => /DIMENSIONAL_LOCATION/i.test(type))) continue;
      const relatedChildren = getEntityRefs(entityId).filter((ref, index, refs) =>
        childSet.has(ref) && refs.indexOf(ref) === index
      );
      if (relatedChildren.length >= 2) return "twoFaceDimension";
    }

    return undefined;
  };

  const getDerivedDatumKind = (
    featureIds: string[],
    targetIds: string[]
  ): ParsedStepDatum["derivedDatum"] => (
    getDirectDatumFeatureDimensionKind(featureIds, targetIds) ||
    getExplicitMultiFaceDatumFeatureKind(featureIds, targetIds) ||
    getPlanarDatumFeatureKind(featureIds, targetIds)
  );

  const sameTargetSet = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false;
    const bSet = new Set(b);
    return a.every((target) => bSet.has(target));
  };

  const getImmediateShapeAspectChildren = (shapeAspectId: string): string[] => {
    const cached = immediateShapeAspectChildrenCache.get(shapeAspectId);
    if (cached) return cached;

    const children: string[] = [];
    for (const relationshipId of getUsedIn(shapeAspectId, /SHAPE_ASPECT_RELATIONSHIP/i)) {
      const refs = getEntityRefs(relationshipId);
      if (refs[0] !== shapeAspectId) continue;

      for (const ref of refs.slice(1)) {
        const typeNames = getEntityTypeNames(ref);
        if (!typeNames.some((type) => /SHAPE_ASPECT|DATUM_FEATURE|CENTRE_OF_SYMMETRY/i.test(type))) continue;
        if (!children.includes(ref)) children.push(ref);
      }
    }
    immediateShapeAspectChildrenCache.set(shapeAspectId, children);
    return children;
  };

  const getDescendantShapeAspectGeometryTargets = (
    shapeAspectId: string,
    visited = new Set<string>()
  ): string[] => {
    if (!shapeAspectId || visited.has(shapeAspectId)) return [];
    const isRoot = visited.size === 0;
    if (isRoot) {
      const cached = descendantShapeAspectGeometryTargetsCache.get(shapeAspectId);
      if (cached) return cached;
    }
    visited.add(shapeAspectId);

    const targets = [...getDirectShapeAspectGeometryTargets(shapeAspectId)];
    for (const childId of getImmediateShapeAspectChildren(shapeAspectId)) {
      for (const target of getDescendantShapeAspectGeometryTargets(childId, visited)) {
        if (!targets.includes(target)) targets.push(target);
      }
    }

    if (isRoot) {
      descendantShapeAspectGeometryTargetsCache.set(shapeAspectId, targets);
    }
    return targets;
  };

  const getTargetComparisonPoint = (targetId: string): { x: number; y: number; z: number } | null => {
    const surfaceId = [targetId, ...getEntityRefs(targetId)]
      .find((ref) => /^(PLANE|CYLINDRICAL_SURFACE|CONICAL_SURFACE|SPHERICAL_SURFACE|TOROIDAL_SURFACE|B_SPLINE_SURFACE)$/i.test(getEntityType(ref)));
    const placementId = surfaceId
      ? getEntityRefs(surfaceId).find((ref) => getEntityType(ref) === "AXIS2_PLACEMENT_3D")
      : undefined;
    const pointId = placementId
      ? getEntityRefs(placementId).find((ref) => getEntityType(ref) === "CARTESIAN_POINT")
      : undefined;
    return pointId
      ? getCartesianPoint(pointId)
      : pointCentroid(getEntityCartesianPoints(targetId, 10));
  };

  const selectDatumTargetsFromPresentationComposite = (
    featureIds: string[],
    targetIds: string[],
    presentationPoint?: { x: number; y: number; z: number } | null
  ): string[] => {
    if (!presentationPoint || targetIds.length < 3) return targetIds;
    const featureText = featureIds
      .map((featureId) => `${getEntityTypeNames(featureId).join(" ")} ${entityStatements.get(featureId) || ""}`)
      .join(" ");
    if (/PATTERN\s+OF\s+FEATURES/i.test(featureText)) return targetIds;

    const candidateGroups = Array.from(entityStatements.keys())
      .filter((entityId) => getEntityTypeNames(entityId).some((type) => /COMPOSITE_GROUP_SHAPE_ASPECT/i.test(type)))
      .flatMap((entityId) => {
        const children = getImmediateShapeAspectChildren(entityId)
          .map((childId) => {
            const targets = uniqueGeometryTargets(getDescendantShapeAspectGeometryTargets(childId));
            return { childId, targets };
          })
          .filter((child) => child.targets.length > 0 && child.targets.length < targetIds.length);
        const childTargetUnion = uniqueGeometryTargets(children.flatMap((child) => child.targets));
        return sameTargetSet(childTargetUnion, targetIds) ? children : [];
      });

    const childGroups = candidateGroups;

    if (childGroups.length === 0) return targetIds;

    const scoredGroups = childGroups
      .map((child, index) => {
        const center = pointCentroid(
          child.targets
            .map(getTargetComparisonPoint)
            .filter((point): point is { x: number; y: number; z: number } => !!point)
        );
        return center
          ? { ...child, index, distance: squaredDistance(presentationPoint, center) }
          : null;
      })
      .filter((child): child is { childId: string; targets: string[]; index: number; distance: number } => !!child)
      .sort((a, b) => a.distance - b.distance || a.index - b.index);

    const primaryGroupTargets = scoredGroups[0]?.targets || [];
    if (primaryGroupTargets.length === 0) return targetIds;

    const primaryTargetSet = new Set(primaryGroupTargets);
    return [
      ...primaryGroupTargets,
      ...targetIds.filter((targetId) => !primaryTargetSet.has(targetId))
    ];
  };

  const describeDerivedDatum = (
    identifier: string,
    primaryTarget: string,
    targetIds: string[],
    featureIds: string[]
  ) => {
    const baseDescription = describeDatumTarget(primaryTarget, identifier);
    const featureText = featureIds
      .map((featureId) => `${getEntityTypeNames(featureId).join(" ")} ${entityStatements.get(featureId) || ""}`)
      .join(" ");
    if (/PATTERN\s+OF\s+FEATURES/i.test(featureText) && targetIds.length > 1) {
      return {
        ...baseDescription,
        typeStr: "Pattern Datum Feature",
        targetName: `Datum ${identifier} pattern of ${targetIds.length} faces (${targetIds.join(", ")})`,
        clinicalContext: "Datum is established by a pattern of multiple physical features that act together as one datum feature."
      };
    }
    const derivedDatumKind = getDerivedDatumKind(featureIds, targetIds);
    if (derivedDatumKind === "multiface") {
      return {
        ...baseDescription,
        typeStr: "Multi-face Datum Feature",
        targetName: `Datum ${identifier} multi-face datum feature (${targetIds.length} faces: ${targetIds.join(", ")})`,
        clinicalContext: "Datum is established by multiple physical faces declared as one STEP datum feature."
      };
    }
    const planarDatumKind = derivedDatumKind === "twoFaceDimension" || derivedDatumKind === "medianPlane"
      ? derivedDatumKind
      : getPlanarDatumFeatureKind(featureIds, targetIds);
    if (planarDatumKind === "medianPlane") {
      return {
        ...baseDescription,
        typeStr: "Feature-of-size Datum / Median Plane",
        targetName: `Datum ${identifier} median plane from ${targetIds.length} opposed planar faces (${targetIds.join(", ")})`,
        clinicalContext: "Datum is derived from the median plane of a size feature bounded by multiple physical faces."
      };
    }
    if (planarDatumKind === "twoFaceDimension") {
      return {
        ...baseDescription,
        typeStr: "Mid-dimension Datum Feature",
        targetName: `Datum ${identifier} mid-dimension between ${targetIds.length} planar faces (${targetIds.join(", ")})`,
        clinicalContext: "Datum is established midway between two physical planar faces connected by a STEP dimensional location."
      };
    }
    return baseDescription;
  };

  const getSemanticDatumFeatureIds = (datumId: string): string[] => {
    const featureIds: string[] = [];
    for (const relationshipId of getUsedIn(datumId, /SHAPE_ASPECT_RELATIONSHIP/i)) {
      for (const ref of getEntityRefs(relationshipId)) {
        if (ref === datumId) continue;
        const type = getEntityTypeNames(ref).join(" ");
        if (/DATUM_FEATURE|DATUM_TARGET|SHAPE_ASPECT|CENTRE_OF_SYMMETRY/i.test(type) && !featureIds.includes(ref)) {
          featureIds.push(ref);
        }
      }
    }
    return featureIds;
  };

  const getDatumIdentifier = (datumId: string): string | undefined => {
    if (getEntityType(datumId) !== "DATUM") return undefined;
    return getEntityParams(datumId)
      .flatMap(getQuotedValues)
      .map((value) => value.toUpperCase())
      .reverse()
      .find((value) => /^[A-Z]$/.test(value));
  };

  const getDatumReferenceBaseIds = (referenceId: string): string[] => {
    const type = getEntityType(referenceId);
    if (type === "DATUM") return [referenceId];

    const params = getEntityParams(referenceId);
    const refIds = getEntityRefs(referenceId);
    if (type === "DATUM_REFERENCE_COMPARTMENT" || type === "DATUM_REFERENCE_ELEMENT") {
      const baseParam = params[4] || "";
      const baseRefs = baseParam.match(/#\d+/g) || [];
      return baseRefs.flatMap(getDatumReferenceBaseIds);
    }

    if (/COMMON_DATUM_LIST/i.test(entityStatements.get(referenceId) || "")) {
      return refIds.flatMap(getDatumReferenceBaseIds);
    }

    return refIds
      .filter((ref) => getEntityType(ref) === "DATUM" || /DATUM_REFERENCE_ELEMENT/i.test(getEntityType(ref)))
      .flatMap(getDatumReferenceBaseIds);
  };

  const getDatumReferenceModifiers = (referenceId: string): string[] => {
    const statement = entityStatements.get(referenceId) || "";
    const modifiers = Array.from(statement.matchAll(/\.([A-Z_]+)\./gi))
      .map((match) => match[1].replace(/_/g, " ").toUpperCase())
      .filter((value) => !["T", "F"].includes(value));
    return modifiers.filter((modifier, index, all) => all.indexOf(modifier) === index);
  };

  const getParentDatumIdentifier = (shapeAspectId: string): string | undefined => {
    for (const relationshipId of getUsedIn(shapeAspectId, /SHAPE_ASPECT_RELATIONSHIP/i)) {
      for (const ref of getEntityRefs(relationshipId)) {
        if (ref === shapeAspectId) continue;
        const identifier = getDatumIdentifier(ref);
        if (identifier) return identifier;
      }
    }
    return undefined;
  };

  const getPlacedDatumTargetRepresentation = (datumTargetId: string, targetKind?: string): {
    targetId: string;
    targetPoint?: { x: number; y: number; z: number };
    targetLine?: ParsedStepDatumTarget["targetLine"];
    targetCircle?: ParsedStepDatumTarget["targetCircle"];
    targetZone?: ParsedStepDatumTarget["targetZone"];
    sizeLabels?: string[];
  } | null => {
    for (const propertyId of getUsedIn(datumTargetId, /PROPERTY_DEFINITION/i)) {
      for (const representationLinkId of getUsedIn(propertyId, /SHAPE_DEFINITION_REPRESENTATION/i)) {
        const representationId = getEntityRefs(representationLinkId)
          .find((ref) => getEntityType(ref) === "SHAPE_REPRESENTATION_WITH_PARAMETERS");
        if (!representationId) continue;

        const placementId = getEntityRefs(representationId)
          .find((ref) => getEntityType(ref) === "AXIS2_PLACEMENT_3D");
        if (!placementId) continue;

        const pointId = getEntityRefs(placementId)
          .find((ref) => getEntityType(ref) === "CARTESIAN_POINT");
        const rawTargetPoint = pointId ? getCartesianPoint(pointId) || undefined : undefined;
        const lengthScale = getRepresentationLengthScaleToMillimeters(representationId);
        const coordinateScale = getDefaultLengthScaleToMillimeters();
        const targetPoint = rawTargetPoint
          ? {
              x: rawTargetPoint.x * coordinateScale,
              y: rawTargetPoint.y * coordinateScale,
              z: rawTargetPoint.z * coordinateScale
            }
          : undefined;

        const rawMeasureForLabel = (labelPattern: RegExp): number | null => {
          for (const ref of getEntityRefs(representationId)) {
            const statement = entityStatements.get(ref) || "";
            if (!labelPattern.test(statement)) continue;
            return getMeasureValue(ref);
          }
          return null;
        };
        const measureForLabel = (labelPattern: RegExp): number | null => {
          for (const ref of getEntityRefs(representationId)) {
            const statement = entityStatements.get(ref) || "";
            if (!labelPattern.test(statement)) continue;
            const measure = getMeasureValue(ref);
            if (measure === null) continue;
            const unitScale = getEntityRefs(ref)
              .map((unitRef) => getLengthUnitScaleToMillimeters(unitRef))
              .find((scale): scale is number => scale !== null);
            return measure * (unitScale ?? lengthScale);
          }
          return null;
        };

        const placementRefs = getEntityRefs(placementId);
        const placementNormal = placementRefs[1] ? getDirection(placementRefs[1]) : null;
        const placementXDirection = placementRefs[2] ? getDirection(placementRefs[2]) : null;
        const placementYDirection = placementNormal && placementXDirection
          ? normalizeVector(crossVector(placementNormal, placementXDirection))
          : null;
        const scaledPointAlong = (
          center: { x: number; y: number; z: number },
          direction: { x: number; y: number; z: number },
          distance: number
        ) => ({
          x: center.x + direction.x * distance,
          y: center.y + direction.y * distance,
          z: center.z + direction.z * distance
        });
        const width = measureForLabel(/target\s+width/i);
        const targetLength = measureForLabel(/target\s+length/i);
        const targetDiameter = measureForLabel(/target\s+diameter/i);
        const rawWidth = rawMeasureForLabel(/target\s+width/i);
        const rawLength = rawMeasureForLabel(/target\s+length/i);
        const sizeLabels = [rawWidth, rawLength]
          .filter((value): value is number => Number.isFinite(value))
          .map((value) => `[${value.toFixed(3)}]`);
        const normalizedTargetKind = (targetKind || "").toLowerCase();
        const isLineTarget = normalizedTargetKind === "line";
        const targetLineDirection = isLineTarget ? placementNormal : placementXDirection;
        const targetLinePlaneNormal = isLineTarget && placementNormal && placementXDirection
          ? normalizeVector(crossVector(placementNormal, placementXDirection))
          : placementNormal;
        const targetLine = targetPoint && targetLineDirection && targetLength && /^(line|curve)$/.test(normalizedTargetKind)
          ? {
              start: scaledPointAlong(targetPoint, targetLineDirection, -targetLength / 2),
              end: scaledPointAlong(targetPoint, targetLineDirection, targetLength / 2),
              center: targetPoint,
              direction: targetLineDirection,
              normal: targetLinePlaneNormal || undefined,
              length: targetLength
            }
          : undefined;
        const targetCircle = targetPoint && placementNormal && placementXDirection && placementYDirection && targetDiameter && /circle|circular/i.test(normalizedTargetKind)
          ? {
              center: targetPoint,
              diameter: targetDiameter,
              normal: placementNormal,
              xDirection: placementXDirection,
              yDirection: placementYDirection
            }
          : undefined;
        const targetZone = targetPoint && placementNormal && placementXDirection && placementYDirection && width && targetLength
          ? {
              shape: "rectangle" as const,
              width,
              length: targetLength,
              center: targetPoint,
              normal: placementNormal,
              xDirection: placementYDirection,
              yDirection: placementXDirection
            }
          : undefined;

        return {
          targetId: placementId,
          targetPoint,
          targetLine,
          targetCircle,
          targetZone,
          sizeLabels
        };
      }
    }

    return null;
  };

  const buildSfaSemanticDatums = (): ParsedStepDatum[] => {
    const datums: ParsedStepDatum[] = [];

    for (const [entityId] of entityStatements.entries()) {
      if (getEntityType(entityId) !== "DATUM") continue;

      const identifier = getDatumIdentifier(entityId) || `D${datums.length + 1}`;

      const featureIds = getSemanticDatumFeatureIds(entityId);
      const directionalFeatureTargets = uniqueGeometryTargets(
        featureIds.flatMap(getDirectionalDatumFeatureGeometryTargets)
      );
      let targetIds = preferDatumSurfaceTargets(
        directionalFeatureTargets.length > 0
          ? directionalFeatureTargets
          : uniqueGeometryTargets([
              ...resolveTargetsForId(entityId),
              ...getShapeAspectGeometryTargets(entityId),
              ...featureIds.flatMap(getShapeAspectGeometryTargets),
            ])
      );
      if (targetIds.length === 0) {
        for (const ref of getEntityRefs(entityId).filter(isGeometryTargetEntity)) {
          if (!targetIds.includes(ref)) targetIds.push(ref);
        }
      }

      const presentationTargetPoint = [entityId, ...featureIds]
        .map(getPresentationLandingPointForShapeAspect)
        .find((point): point is { x: number; y: number; z: number } => !!point) ||
        getDatumPresentationLandingPointByIdentifier(identifier);
      targetIds = preferDatumSurfaceTargets(selectDatumTargetsFromPresentationComposite(featureIds, targetIds, presentationTargetPoint));
      const primaryTarget = targetIds[0] || "";
      const description = primaryTarget
        ? describeDerivedDatum(identifier, primaryTarget, targetIds, featureIds)
        : {
            typeStr: "Semantic Datum Feature",
            targetName: "Unresolved semantic datum target",
            clinicalContext: "Semantic datum was found, but no associated B-Rep geometry target was resolved."
          };

      datums.push({
        id: `PMI-DTM-${datums.length + 1}`,
        entityId,
        name: `Datum ${identifier}`,
        identifier,
        type: description.typeStr,
        symbol: `[ ${identifier} ]`,
        targetId: primaryTarget,
        targetIds,
        surfaceGeometry: targetIds.map(getTargetSurfaceGeometry),
        semanticTargetIds: targetIds,
        presentationTargetPoint,
        targetSource: "semantic",
        derivedDatum: getDerivedDatumKind(featureIds, targetIds),
        targetName: targetIds.length > 1
          ? description.targetName
          : description.targetName,
        clinicalContext: description.clinicalContext
      });
    }

    return datums;
  };

  const buildSfaSemanticDatumTargets = (): ParsedStepDatumTarget[] => {
    const semanticTargets: ParsedStepDatumTarget[] = [];

    const getDatumTargetCurve = (targetIds: string[]): ParsedStepDatumTarget["targetCurve"] | undefined => {
      const curveSegments = targetIds
        .map(getCircularCurveSegment)
        .filter((segment): segment is NonNullable<ReturnType<typeof getCircularCurveSegment>> => !!segment);
      if (curveSegments.length === 0) return undefined;

      const points = curveSegments.flatMap((segment, index) =>
        index === 0 ? segment.points : segment.points.slice(1)
      );
      const center = pointCentroid(curveSegments.map((segment) => segment.center));
      return center && points.length >= 2
        ? {
            points,
            center,
            normal: curveSegments.find((segment) => !!segment.normal)?.normal
          }
        : undefined;
    };

    const getDatumTargetLine = (targetIds: string[]): ParsedStepDatumTarget["targetLine"] | undefined => {
      const lineSegment = targetIds
        .map(getLineSegment)
        .find((segment): segment is NonNullable<ReturnType<typeof getLineSegment>> => !!segment);
      if (!lineSegment) return undefined;

      return {
        start: lineSegment.start,
        end: lineSegment.end,
        center: {
          x: (lineSegment.start.x + lineSegment.end.x) / 2,
          y: (lineSegment.start.y + lineSegment.end.y) / 2,
          z: (lineSegment.start.z + lineSegment.end.z) / 2
        },
        direction: lineSegment.direction,
        length: lineSegment.length
      };
    };

    for (const [entityId] of entityStatements.entries()) {
      const entityType = getEntityType(entityId);
      if (entityType !== "DATUM_TARGET" && entityType !== "PLACED_DATUM_TARGET_FEATURE") continue;

      const params = getEntityParams(entityId);
      const quotedValues = params.flatMap(getQuotedValues).filter(Boolean);
      const targetKind = quotedValues.find((value) => /^(point|line|circle|rectangle|circular curve|area|curve)$/i.test(value))?.toLowerCase();
      const parentDatum = getParentDatumIdentifier(entityId);
      const targetIdValue = quotedValues
        .slice()
        .reverse()
        .find((value) => /^\d+$/.test(value));
      const rawIdentifier = quotedValues.find((value) => /^[A-Z]+\d*$/i.test(value) && !/^(POINT|LINE|CIRCLE|RECTANGLE|AREA|CURVE)$/i.test(value)) ||
        (parentDatum && targetIdValue ? `${parentDatum}${targetIdValue}` : undefined) ||
        quotedValues[quotedValues.length - 1];
      const identifier = (rawIdentifier || `DT-${semanticTargets.length + 1}`).toUpperCase();
      const targetIds = [
        ...resolveTargetsForId(entityId),
        ...getShapeAspectGeometryTargets(entityId),
        ...getSemanticDatumFeatureIds(entityId).flatMap(getShapeAspectGeometryTargets)
      ].filter((target, index, all) => isGeometryTargetEntity(target) && all.indexOf(target) === index);

      const representationTarget = getEntityType(entityId) === "PLACED_DATUM_TARGET_FEATURE"
        ? getPlacedDatumTargetRepresentation(entityId, targetKind)
        : null;
      const targetCurve = getDatumTargetCurve(targetIds);
      const targetLine = /^line$/i.test(targetKind || "") ? getDatumTargetLine(targetIds) : undefined;
      const resolvedTargetLine = targetLine
        ? {
            ...targetLine,
            normal: representationTarget?.targetLine?.normal
          }
        : representationTarget?.targetLine;
      const primaryTarget = targetIds[0] || representationTarget?.targetId || "";
      const surfaceType = getTargetSurfaceType(primaryTarget);
      const surfaceLabel =
        surfaceType === "plane" ? "planar face" :
        surfaceType === "cylinder" ? "cylindrical face" :
        surfaceType === "curved" ? "curved face" :
        getEntityType(primaryTarget) === "CARTESIAN_POINT" ? "target point" :
        getEntityType(primaryTarget) === "AXIS2_PLACEMENT_3D" ? "target zone placement" :
        "B-Rep feature";
      const targetPoint = targetCurve?.center ||
        targetLine?.center ||
        representationTarget?.targetPoint ||
        getCartesianPoint(primaryTarget) ||
        pointCentroid(getEntityCartesianPoints(primaryTarget, 2)) ||
        undefined;

      semanticTargets.push({
        id: `PMI-DTGT-${semanticTargets.length + 1}`,
        entityId,
        name: `Datum Target ${identifier}`,
        identifier,
        parentDatum: parentDatum || identifier.match(/^[A-Z]+/)?.[0],
        type: targetKind,
        targetId: primaryTarget,
        targetIds,
        targetName: primaryTarget ? `Datum target on ${surfaceLabel} (${primaryTarget})` : "Unresolved semantic datum target geometry",
        targetPoint,
        targetLine: resolvedTargetLine,
        targetCircle: targetCurve ? undefined : representationTarget?.targetCircle,
        targetCurve,
        targetZone: representationTarget?.targetZone,
        sizeLabels: representationTarget?.sizeLabels,
        clinicalContext: "Datum target resolved from semantic PMI datum_target or placed_datum_target_feature relationships."
      });
    }

    return semanticTargets;
  };

  // Links semantic thread-curve targets to the B-Rep cylinders they describe.
  // AP242 uses either representation for the same threaded feature.
  const threadCylinderFaceTargetsBySemanticTarget = new Map<string, string[]>();

  const buildSfaSemanticTolerances = (): ParsedStepTolerance[] => {
    const tolerances: ParsedStepTolerance[] = [];

    for (const [entityId] of entityStatements.entries()) {
      const entityTypes = getEntityTypeNames(entityId);
      const entityTypeLabel = entityTypes.join(" ");
      if (!entityTypes.some((type) => /_TOLERANCE/.test(type))) continue;
      if (entityTypes.some((type) => /TOLERANCE_ZONE|PLUS_MINUS_TOLERANCE|TOLERANCE_VALUE/.test(type))) continue;
      // GEOMETRIC_TOLERANCE_RELATIONSHIP groups tolerances that apply together,
      // for example two position tolerances forming one composite frame. It
      // carries no magnitude and no toleranced shape aspect of its own, so it is
      // a container rather than a tolerance. It matches /_TOLERANCE/ only because
      // that substring appears in its name, and treating it as a tolerance
      // produced a record per relationship: a node with an entity reference read
      // as its value, no target, and type "Geometric Tolerance", duplicating
      // tolerances that were already parsed from the children it points at.
      if (entityTypes.some((type) => /_TOLERANCE_RELATIONSHIP/.test(type))) continue;

      const refs = getEntityRefs(entityId);
      const magnitudeRef = refs.find((ref) => /LENGTH_MEASURE_WITH_UNIT|PLANE_ANGLE_MEASURE_WITH_UNIT/i.test(getEntityType(ref)));
      const directMagnitude = getEntityParams(entityId)
        .join(",")
        .replace(/'[^']*'/g, "")
        .match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[Ee][-+]?\d+)?/);
      const magnitude = magnitudeRef ? getMeasureValue(magnitudeRef) : (directMagnitude ? parseFloat(directMagnitude[0]) : null);

      const shapeAspectRef = refs.find((ref) => {
        if (ref === magnitudeRef) return false;
        const type = getEntityType(ref);
        return /SHAPE_ASPECT|DATUM_FEATURE|PRODUCT_DEFINITION_SHAPE|CENTRE_OF_SYMMETRY/i.test(type) ||
          (shapeAspectToTarget.get(ref)?.length || 0) > 0;
      }) || refs.find((ref) => ref !== magnitudeRef && isGeometryTargetEntity(ref));

      const targetCandidates = shapeAspectRef ? getShapeAspectGeometryTargets(shapeAspectRef) : [];
      const targetId = targetCandidates[0] || shapeAspectRef || "";
      const definition = getToleranceDefinition(entityTypeLabel);
      const toleranceStatement = entityStatements.get(entityId) || "";
      const toleranceModifiers = Array.from(
        toleranceStatement.matchAll(
          /\.(MAXIMUM_MATERIAL_REQUIREMENT|LEAST_MATERIAL_REQUIREMENT|REGARDLESS_OF_FEATURE_SIZE|PROJECTED_TOLERANCE_ZONE|FREE_STATE)\./gi
        )
      )
        .map((match) => match[1].replace(/_/g, " ").toUpperCase())
        .filter((modifier, index, all) => all.indexOf(modifier) === index);
      const hasToleranceModifiers =
        toleranceModifiers.length > 0 ||
        /GEOMETRIC_TOLERANCE_WITH_MODIFIERS|MODIFIED_GEOMETRIC_TOLERANCE/i.test(toleranceStatement);
      const toleranceZoneId = getUsedIn(entityId)
        .find((referrerId) => getEntityType(referrerId) === "TOLERANCE_ZONE");
      const toleranceZoneFormId = toleranceZoneId
        ? getEntityRefs(toleranceZoneId).find((ref) => getEntityType(ref) === "TOLERANCE_ZONE_FORM")
        : undefined;
      const toleranceZoneForm = toleranceZoneFormId
        ? getQuotedValues(getEntityParams(toleranceZoneFormId).join(","))[0]
        : undefined;
      const projectedZoneDefinitionId = toleranceZoneId
        ? getUsedIn(toleranceZoneId)
          .find((referrerId) => getEntityType(referrerId) === "PROJECTED_ZONE_DEFINITION")
        : undefined;
      const projectedToleranceZoneHeight = projectedZoneDefinitionId
        ? getEntityRefs(projectedZoneDefinitionId)
          .filter((ref) => /(?:LENGTH|PLANE_ANGLE)_MEASURE_WITH_UNIT/i.test(getEntityType(ref)))
          .map(getMeasureValue)
          .find((value): value is number => value !== null && Number.isFinite(value))
        : undefined;

      tolerances.push({
        id: `PMI-STP-${tolerances.length + 1}`,
        entityId,
        type: definition.type,
        symbol: definition.symbol,
        value: magnitude ?? 0,
        targetId,
        targetIds: uniqueGeometryTargets(targetCandidates),
        targetSurfaceTypes: uniqueGeometryTargets(targetCandidates)
          .map(getTargetSurfaceType)
          .filter((type, index, all) => !!type && all.indexOf(type) === index),
        targetName: targetId ? `PMI target B-Rep Feature (${targetId})` : "Unresolved semantic tolerance target",
        hasToleranceModifiers,
        toleranceModifiers,
        toleranceZoneForm,
        toleranceZoneDiameter: /cylindrical|circular/i.test(toleranceZoneForm || ""),
        projectedToleranceZoneHeight,
        category: definition.category,
        clinicalContext: definition.clinicalContext
      });
    }

    return tolerances;
  };

  const buildAp242DimensionalTolerances = (): ParsedStepTolerance[] => {
    const tolerances: ParsedStepTolerance[] = [];

    const getDimensionKind = (dimensionEntityId: string): ParsedStepTolerance["dimensionKind"] => {
      const typeNames = getEntityTypeNames(dimensionEntityId).join(" ");
      const textValue = `${typeNames} ${entityStatements.get(dimensionEntityId) || ""}`;
      if (/ANGULAR_LOCATION|ANGULAR_SIZE/i.test(textValue)) return "angular";
      if (/DIMENSIONAL_LOCATION/i.test(textValue)) return "linear";
      if (/diameter/i.test(textValue)) return "diameter";
      if (/radius/i.test(textValue)) return "radius";
      if (/DIMENSIONAL_SIZE/i.test(textValue)) return "size";
      return "linear";
    };

    const isSphericalDimension = (dimensionEntityId: string): boolean =>
      /spherical\s+(diameter|radius)/i.test(entityStatements.get(dimensionEntityId) || "");

    const getDimensionShapeAspectRefs = (dimensionEntityId: string): string[] =>
      getEntityRefs(dimensionEntityId)
        .filter((ref) => getEntityTypeNames(ref).some((type) => /SHAPE_ASPECT|COMPOSITE_SHAPE_ASPECT|DATUM_FEATURE|CENTRE_OF_SYMMETRY/i.test(type)));

    const getDimensionChildTargetGroups = (dimensionEntityId: string): string[][] => {
      return getDimensionShapeAspectRefs(dimensionEntityId)
        .filter((ref) =>
          getEntityTypeNames(ref).some((type) =>
            type === "COMPOSITE_GROUP_SHAPE_ASPECT" ||
            type === "COMPOSITE_SHAPE_ASPECT"
          ) ||
          /multiple\s+elements|pattern|repeated/i.test(getQuotedValues(entityStatements.get(ref) || "").join(" "))
        )
        .flatMap((ref) => getImmediateShapeAspectChildren(ref))
        .map((childId) => uniqueGeometryTargets(getDescendantShapeAspectGeometryTargets(childId)))
        .filter((targets) => targets.length > 0);
    };

    const getRepeatedLocationPairCount = (dimensionEntityId: string): number => {
      if (!getEntityTypeNames(dimensionEntityId).some((type) => /DIMENSIONAL_LOCATION/i.test(type))) return 0;
      const endpointIds = getDimensionShapeAspectRefs(dimensionEntityId);
      if (endpointIds.length !== 2) return 0;

      const getImmediateParents = (childId: string) =>
        getUsedIn(childId, /SHAPE_ASPECT_RELATIONSHIP/i)
          .flatMap((relationshipId) => {
            const refs = getEntityRefs(relationshipId);
            return refs[1] === childId ? refs.slice(0, 1) : [];
          });
      const commonParents = getImmediateParents(endpointIds[0])
        .filter((parentId) => getImmediateParents(endpointIds[1]).includes(parentId));

      return commonParents.reduce((bestCount, parentId) => {
        if (!getEntityTypeNames(parentId).some((type) => type === "COMPOSITE_SHAPE_ASPECT")) {
          return bestCount;
        }
        const childIds = getImmediateShapeAspectChildren(parentId);
        if (
          childIds.length < 4 ||
          childIds.length % 2 !== 0 ||
          !endpointIds.every((endpointId) => childIds.includes(endpointId)) ||
          childIds.some((childId) =>
            getEntityTypeNames(childId).some((type) => /COMPOSITE.*SHAPE_ASPECT/i.test(type))
          )
        ) {
          return bestCount;
        }
        return Math.max(bestCount, childIds.length / 2);
      }, 0);
    };

    const buildSemanticRadiusCountDimensions = (
      existingTolerances: ParsedStepTolerance[]
    ): ParsedStepTolerance[] => {
      const radiusDimensions: ParsedStepTolerance[] = [];
      const getDimensionLengthScaleToMillimeters = (dimensionEntityId: string): number => {
        for (const relationshipId of getUsedIn(dimensionEntityId, /DIMENSIONAL_CHARACTERISTIC_REPRESENTATION/i)) {
          const representationIds = getEntityRefs(relationshipId)
            .filter((ref) => getEntityTypeNames(ref).some((type) => /SHAPE_DIMENSION_REPRESENTATION|REPRESENTATION/i.test(type)));
          for (const representationId of representationIds) {
            const measureIds = getEntityRefs(representationId)
              .filter((ref) => getEntityTypeNames(ref).some((type) => /LENGTH_MEASURE_WITH_UNIT|MEASURE_WITH_UNIT/i.test(type)));
            for (const measureId of measureIds) {
              for (const unitId of getEntityRefs(measureId)) {
                const scale = getLengthUnitScaleToMillimeters(unitId);
                if (scale !== null && Number.isFinite(scale)) return scale;
              }
            }
          }
        }
        return getDefaultLengthScaleToMillimeters();
      };

      for (const [textEntityId, statement] of entityStatements.entries()) {
        if (!getEntityTypeNames(textEntityId).some((type) => type === "DESCRIPTIVE_REPRESENTATION_ITEM")) {
          continue;
        }
        const semanticText = getQuotedValues(statement).join(" ").trim();
        const modifierMatch = semanticText.match(/^(\d+)\s*X\s+R$/i);
        if (!modifierMatch) continue;

        const representationIds = getUsedIn(textEntityId, /^REPRESENTATION$/i);
        const propertyDefinitionIds = representationIds
          .flatMap((representationId) => getUsedIn(representationId, /PROPERTY_DEFINITION_REPRESENTATION/i))
          .flatMap(getEntityRefs)
          .filter((ref) => /semantic\s+text/i.test(entityStatements.get(ref) || ""))
          .filter((ref, index, all) => all.indexOf(ref) === index);
        const carrierShapeAspectIds = propertyDefinitionIds
          .flatMap(getEntityRefs)
          .filter((ref) => getEntityTypeNames(ref).some((type) => /SHAPE_ASPECT/i.test(type)))
          .filter((ref, index, all) => all.indexOf(ref) === index);

        for (const carrierShapeAspectId of carrierShapeAspectIds) {
          const compositeParentIds = getUsedIn(carrierShapeAspectId, /SHAPE_ASPECT_RELATIONSHIP/i)
            .flatMap((relationshipId) => {
              const refs = getEntityRefs(relationshipId);
              return refs[1] === carrierShapeAspectId ? refs.slice(0, 1) : [];
            })
            .filter((parentId) =>
              getEntityTypeNames(parentId).some((type) => type === "COMPOSITE_SHAPE_ASPECT")
            );
          const candidateTargetGroups = compositeParentIds
            .map((parentId) => ({
              parentId,
              targetIds: uniqueGeometryTargets(
                getImmediateShapeAspectChildren(parentId)
                  .flatMap((childId) => getDescendantShapeAspectGeometryTargets(childId))
              ).filter((targetId) => getTargetSurfaceType(targetId) === "cylinder")
            }))
            .filter(({ targetIds }) => targetIds.length > 0)
            .sort((a, b) => a.targetIds.length - b.targetIds.length);
          const selectedGroup = candidateTargetGroups[0];
          if (!selectedGroup) continue;

          const expectedCount = Number(modifierMatch[1]);
          const targetIds = selectedGroup.targetIds;
          if (targetIds.length !== expectedCount) continue;

          const radii = targetIds
            .map(getPrimarySurfaceIdForTarget)
            .filter((surfaceId): surfaceId is string => !!surfaceId)
            .map(getCylindricalSurfaceRadius)
            .filter((radius): radius is number => radius !== null);
          if (radii.length !== targetIds.length) continue;
          const nominalRadius = radii[0];
          if (!radii.every((radius) => Math.abs(radius - nominalRadius) <= Math.max(1e-8, nominalRadius * 1e-6))) {
            continue;
          }
          const associatedDimensionId = [carrierShapeAspectId, ...compositeParentIds]
            .flatMap((shapeAspectId) =>
              getUsedIn(shapeAspectId, /DIMENSIONAL_SIZE|DIMENSIONAL_LOCATION/i)
            )
            .find((dimensionId) =>
              getEntityTypeNames(dimensionId).some((type) => /DIMENSIONAL_SIZE|DIMENSIONAL_LOCATION/i.test(type))
            );
          const dimensionLengthScale = associatedDimensionId
            ? getDimensionLengthScaleToMillimeters(associatedDimensionId)
            : getDefaultLengthScaleToMillimeters();
          const normalizedNominalRadius =
            nominalRadius * getDefaultLengthScaleToMillimeters() / dimensionLengthScale;
          if (existingTolerances.some((tolerance) =>
            tolerance.dimensionKind === "radius" &&
            tolerance.nominalDimension !== undefined &&
            Math.abs(tolerance.nominalDimension - normalizedNominalRadius) <= 1e-8 &&
            (tolerance.targetIds || []).some((targetId) => targetIds.includes(targetId))
          )) {
            continue;
          }

          const targetPoints = targetIds
            .flatMap((targetId) => getEntityCartesianPoints(targetId, 10))
            .filter((point, index, all) =>
              all.findIndex((candidate) =>
                Math.abs(candidate.x - point.x) < 1e-6 &&
                Math.abs(candidate.y - point.y) < 1e-6 &&
                Math.abs(candidate.z - point.z) < 1e-6
              ) === index
            )
            .slice(0, 24);
          const decimalPlaces = Math.abs(normalizedNominalRadius * 1000 - Math.round(normalizedNominalRadius * 1000)) > 1e-6
            ? 4
            : 3;
          const slotLengthTolerance = associatedDimensionId
            ? existingTolerances.find((tolerance) => tolerance.dimensionEntityId === associatedDimensionId)
            : undefined;
          const slotWidthTolerance = existingTolerances.find((tolerance) =>
            tolerance !== slotLengthTolerance &&
            (tolerance.dimensionKind === "linear" || tolerance.dimensionKind === "size") &&
            !tolerance.associatedDatumIdentifier &&
            tolerance.nominalDimension !== undefined &&
            Math.abs(tolerance.nominalDimension - normalizedNominalRadius * 2) <=
              Math.max(1e-8, normalizedNominalRadius * 2e-6) &&
            (tolerance.targetSurfaceTypes || []).every((surfaceType) => surfaceType === "plane")
          );
          const repeatedSlotCount = expectedCount / 2;
          let mergeRadiusIntoSlot = false;
          if (
            Number.isInteger(repeatedSlotCount) &&
            repeatedSlotCount > 0 &&
            slotLengthTolerance &&
            slotWidthTolerance
          ) {
            const slotModifier = repeatedSlotCount > 1 ? `${repeatedSlotCount}X` : undefined;
            slotWidthTolerance.dimensionPreModifier = slotModifier;
            slotLengthTolerance.dimensionPreModifier = slotModifier;
            slotWidthTolerance.dimensionKind = repeatedSlotCount === 1 ? "slot" : "linear";
            slotLengthTolerance.dimensionKind = "linear";
            slotLengthTolerance.isSlotOverallDimension = true;
            slotLengthTolerance.slotRadiusModel =
              nominalRadius * getDefaultLengthScaleToMillimeters();
            slotLengthTolerance.dimensionScaleToModel = dimensionLengthScale;

            if (repeatedSlotCount === 1) {
              slotWidthTolerance.type = "Slot Dimensional";
              slotWidthTolerance.symbol = "SLOT_DIM";
              slotWidthTolerance.secondaryDimensionEntityId = slotLengthTolerance.dimensionEntityId;
              slotWidthTolerance.secondaryNominalDimension = slotLengthTolerance.nominalDimension;
              slotWidthTolerance.secondaryLowerTolerance = slotLengthTolerance.lowerTolerance;
              slotWidthTolerance.secondaryUpperTolerance = slotLengthTolerance.upperTolerance;
              slotWidthTolerance.clinicalContext =
                "Single-slot width and overall length combined from related AP242 dimensions and rounded-end radius semantics.";
              slotWidthTolerance.slotRadiusPreModifier = `${expectedCount}X`;
              slotWidthTolerance.slotRadiusNominal = normalizedNominalRadius;
              slotWidthTolerance.targetIds = uniqueGeometryTargets([
                ...(slotWidthTolerance.targetIds || []),
                ...targetIds
              ]);
              slotWidthTolerance.targetId = targetIds[0] || slotWidthTolerance.targetId;
              slotWidthTolerance.targetSurfaceTypes = ["plane", "cylinder"];
              slotLengthTolerance.suppressStandaloneDimension = true;
              mergeRadiusIntoSlot = true;
            }
          }

          if (!mergeRadiusIntoSlot) radiusDimensions.push({
            id: `PMI-DIMTOL-RADIUS-NOTE-${textEntityId.replace("#", "")}`,
            entityId: propertyDefinitionIds[0] || textEntityId,
            dimensionEntityId: textEntityId,
            dimensionKind: "radius",
            type: "Radius Dimensional",
            symbol: "DIM",
            value: 0,
            nominalDimension: normalizedNominalRadius,
            dimensionPreModifier: `${expectedCount}X`,
            dimensionDecimalPlaces: decimalPlaces,
            isRadiusCountNote: true,
            isReferenceDimension: false,
            targetId: targetIds[0],
            targetIds,
            targetSurfaceTypes: ["cylinder"],
            targetPoints,
            targetName: `Slot rounded-end radius targets (${targetIds.join(", ")})`,
            hasToleranceModifiers: false,
            category: "Dimension",
            clinicalContext:
              `Repeated slot-end radius call resolved from AP242 semantic text "${semanticText}" ` +
              "and the analytical radii of its associated cylindrical faces."
          });
        }
      }

      return radiusDimensions;
    };

    const isDatumDimensionTarget = (targetId: string) =>
      parsedDatums.some((datum) =>
        datum.targetId === targetId ||
        (Array.isArray(datum.targetIds) && datum.targetIds.includes(targetId))
      ) ||
      getUsedIn(targetId, /GEOMETRIC_ITEM_SPECIFIC_USAGE/i)
        .some((usageId) => /'DATUM'/i.test(entityStatements.get(usageId) || ""));

    const roundedKeyValue = (value: number): string =>
      Number.isFinite(value) ? value.toFixed(6) : "nan";

    const vectorKey = (vector: { x: number; y: number; z: number } | null | undefined): string =>
      vector
        ? `${roundedKeyValue(vector.x)},${roundedKeyValue(vector.y)},${roundedKeyValue(vector.z)}`
        : "unknown";

    const getAxisLineKey = (
      point: { x: number; y: number; z: number } | null,
      direction: { x: number; y: number; z: number } | null
    ): string => {
      const axis = normalizeVector(direction);
      if (!point || !axis) return "unknown";
      const sign =
        Math.abs(axis.x) > 1e-9 ? Math.sign(axis.x) :
        Math.abs(axis.y) > 1e-9 ? Math.sign(axis.y) :
        Math.sign(axis.z) || 1;
      const canonicalAxis = {
        x: axis.x * sign,
        y: axis.y * sign,
        z: axis.z * sign
      };
      const axialOffset = dotVector(point, canonicalAxis);
      const closestPoint = {
        x: point.x - canonicalAxis.x * axialOffset,
        y: point.y - canonicalAxis.y * axialOffset,
        z: point.z - canonicalAxis.z * axialOffset
      };
      return `${vectorKey(closestPoint)}|${vectorKey(canonicalAxis)}`;
    };

    const getSurfaceNumericParameters = (surfaceId: string): number[] =>
      getEntityParams(surfaceId)
        .slice()
        .reverse()
        .join(",")
        .replace(/#\d+/g, "")
        .match(/[-+]?(?:\d+\.\d+|\d+|\.\d+)(?:[Ee][-+]?\d+)?/g)
        ?.map(Number)
        .filter(Number.isFinite) || [];

    const getCylindricalSurfaceRadius = (surfaceId: string): number | null => {
      const radiusMatch = getEntityParams(surfaceId)
        .slice()
        .reverse()
        .join(",")
        .replace(/#\d+/g, "")
        .match(/[-+]?(?:\d+\.\d+|\d+|\.\d+)(?:[Ee][-+]?\d+)?/);
      const radius = radiusMatch ? Number(radiusMatch[0]) : null;
      return Number.isFinite(radius) ? radius : null;
    };

    const getPrimarySurfaceIdForTarget = (targetId: string): string | undefined =>
      [targetId, ...getEntityRefs(targetId)]
        .find((ref) => /^(PLANE|CYLINDRICAL_SURFACE|CONICAL_SURFACE|SPHERICAL_SURFACE|TOROIDAL_SURFACE|B_SPLINE_SURFACE)$/i.test(getEntityType(ref)));

    const getCircularCurveFeatureKey = (targetId: string): string | null => {
      const circleId = [targetId, ...getEntityRefs(targetId)]
        .find((ref) => getEntityType(ref) === "CIRCLE");
      if (!circleId) return null;
      const placementId = getEntityRefs(circleId)
        .find((ref) => getEntityType(ref) === "AXIS2_PLACEMENT_3D");
      const placementRefs = placementId ? getEntityRefs(placementId) : [];
      const point = placementRefs[0] ? getCartesianPoint(placementRefs[0]) : null;
      const radius = getSurfaceNumericParameters(circleId).slice(-1)[0];
      return [
        "circular-curve",
        vectorKey(point),
        Number.isFinite(radius) ? roundedKeyValue(radius) : "unknown"
      ].join("|");
    };

    const getRepeatedElementFeatureKey = (
      targetIds: string[],
      coalesceAxialSurfaces: boolean
    ): string => {
      const targetKeys = targetIds.map((targetId) => {
        const axialSurfaceId = [targetId, ...getEntityRefs(targetId)]
          .find((ref) => /^(CYLINDRICAL_SURFACE|CONICAL_SURFACE)$/i.test(getEntityType(ref)));
        if (axialSurfaceId && coalesceAxialSurfaces) {
          const placementId = getEntityRefs(axialSurfaceId)
            .find((ref) => getEntityType(ref) === "AXIS2_PLACEMENT_3D");
          const placementRefs = placementId ? getEntityRefs(placementId) : [];
          const point = placementRefs[0] ? getCartesianPoint(placementRefs[0]) : null;
          const axis = placementRefs[1] ? getDirection(placementRefs[1]) : null;
          return `axis-site|${getAxisLineKey(point, axis)}`;
        }

        const cylindricalSurfaceId = [targetId, ...getEntityRefs(targetId)]
          .find((ref) => getEntityType(ref) === "CYLINDRICAL_SURFACE");
        if (cylindricalSurfaceId) {
          const placementId = getEntityRefs(cylindricalSurfaceId)
            .find((ref) => getEntityType(ref) === "AXIS2_PLACEMENT_3D");
          const placementRefs = placementId ? getEntityRefs(placementId) : [];
          const point = placementRefs[0] ? getCartesianPoint(placementRefs[0]) : null;
          const axis = placementRefs[1] ? getDirection(placementRefs[1]) : null;
          const radius = getCylindricalSurfaceRadius(cylindricalSurfaceId);
          return [
            "cylinder",
            vectorKey(point),
            vectorKey(axis),
            radius !== null ? roundedKeyValue(radius) : "unknown"
          ].join("|");
        }

        const surfaceId = getPrimarySurfaceIdForTarget(targetId);
        const surfaceType = surfaceId ? getEntityType(surfaceId) : getTargetSurfaceType(targetId);
        if (/TOROIDAL_SURFACE/i.test(surfaceType)) {
          const point = getTargetComparisonPoint(targetId);
          return [
            "toroidal-radius-site",
            vectorKey(point),
            ...getSurfaceNumericParameters(surfaceId || targetId).map(roundedKeyValue)
          ].join("|");
        }

        const circularCurveKey = getCircularCurveFeatureKey(targetId);
        if (circularCurveKey) return circularCurveKey;

        const point = getTargetComparisonPoint(targetId);
        return [
          getTargetSurfaceType(targetId),
          vectorKey(point),
          targetId
        ].join("|");
      });

      return targetKeys
        .filter((key, index, all) => all.indexOf(key) === index)
        .sort()
        .join(";");
    };

    const getCompositeRepeatedElementCount = (
      childTargetGroups: string[][],
      coalesceAxialSurfaces: boolean
    ): number => {
      const elementKeys = childTargetGroups
        .map((targets) => getRepeatedElementFeatureKey(targets, coalesceAxialSurfaces))
        .filter(Boolean)
        .filter((key, index, all) => all.indexOf(key) === index);
      return elementKeys.length;
    };

    const getSphericalRepeatedElementCount = (targetIds: string[]): number => {
      const centerKeys = targetIds
        .map((targetId) => getTargetSurfaceGeometry(targetId))
        .filter((geometry) => geometry.surfaceType === "curved" && geometry.point)
        .map((geometry) => `${roundedKeyValue(geometry.point!.x)},${roundedKeyValue(geometry.point!.y)},${roundedKeyValue(geometry.point!.z)}`)
        .filter((key, index, all) => all.indexOf(key) === index);
      return centerKeys.length;
    };

    const reduceCompositeSizeDimensionTargets = (dimensionEntityId: string, targetIds: string[]): string[] => {
      if (!getEntityTypeNames(dimensionEntityId).some((type) => /DIMENSIONAL_SIZE/i.test(type))) return targetIds;
      const childTargetGroups = getDimensionChildTargetGroups(dimensionEntityId);
      if (childTargetGroups.length < 3) return targetIds;

      const datumGroupIndex = childTargetGroups.findIndex((targets) => targets.some(isDatumDimensionTarget));
      if (datumGroupIndex < 0) return targetIds;

      const datumTarget = childTargetGroups[datumGroupIndex].find(isDatumDimensionTarget) || childTargetGroups[datumGroupIndex][0];
      const pairedCandidates = childTargetGroups
        .flat()
        .filter((targetId) => targetId !== datumTarget && !isDatumDimensionTarget(targetId))
        .filter((targetId, index, all) => all.indexOf(targetId) === index)
        .sort((a, b) => {
          const aNumber = Number(a.replace(/^#/, ""));
          const bNumber = Number(b.replace(/^#/, ""));
          return (Number.isFinite(aNumber) ? aNumber : 0) - (Number.isFinite(bNumber) ? bNumber : 0);
        });
      const pairedTarget = pairedCandidates[Math.floor(pairedCandidates.length / 2)];
      return pairedTarget ? uniqueGeometryTargets([datumTarget, pairedTarget]) : targetIds;
    };

    const preferDistinctOwningFacesForDimensionTargets = (targetIds: string[]): string[] => {
      const ownerGroups = targetIds
        .map((targetId) => faceRecords.filter((faceRecord) => faceRecord.referencedIds.includes(targetId)).map((faceRecord) => faceRecord.id))
        .filter((owners) => owners.length > 0);
      if (ownerGroups.length < 2) return targetIds;

      const commonOwners = ownerGroups
        .slice(1)
        .reduce(
          (common, owners) => common.filter((owner) => owners.includes(owner)),
          ownerGroups[0]
        );
      const selectedOwners = ownerGroups
        .map((owners) => owners.find((owner) => !commonOwners.includes(owner)) || owners[0])
        .filter((owner, index, all) => all.indexOf(owner) === index);

      return selectedOwners.length >= 2 ? selectedOwners : targetIds;
    };

    const resolveDimensionRawTargets = (dimensionEntityId: string): string[] => {
      const refs = getEntityRefs(dimensionEntityId);
      const shapeAspectRefs = getDimensionShapeAspectRefs(dimensionEntityId);
      const directTargets = refs.filter(isGeometryTargetEntity);
      return uniqueGeometryTargets([
        ...directTargets,
        ...shapeAspectRefs.flatMap((ref) => [
          ...getShapeAspectGeometryTargets(ref),
          ...getDescendantShapeAspectGeometryTargets(ref)
        ])
      ]);
    };

    const resolveDimensionTargets = (dimensionEntityId: string): string[] => {
      const targetIds = resolveDimensionRawTargets(dimensionEntityId);
      const reducedTargets = reduceCompositeSizeDimensionTargets(dimensionEntityId, preferDatumSurfaceTargets(targetIds));
      return preferDistinctOwningFacesForDimensionTargets(reducedTargets);
    };

    const getToleranceValueBounds = (toleranceValueId: string): { lower: number | null; upper: number | null } => {
      const values = getEntityRefs(toleranceValueId)
        .map(getMeasureValue)
        .filter((value): value is number => value !== null && Number.isFinite(value));
      if (values.length === 0) return { lower: null, upper: null };
      return {
        lower: Math.min(...values),
        upper: Math.max(...values)
      };
    };

    const getDimensionRepresentationValues = (dimensionEntityId: string): {
      nominal: number | null;
      lowerLimit: number | null;
      upperLimit: number | null;
      notes: string[];
    } => {
      let nominal: number | null = null;
      let lowerLimit: number | null = null;
      let upperLimit: number | null = null;
      const notes: string[] = [];
      const getRepresentationNotes = (entityId: string, depth = 0, visited = new Set<string>()): string[] => {
        if (depth > 4 || visited.has(entityId)) return [];
        visited.add(entityId);
        const directNotes = getEntityTypeNames(entityId).some((type) => /DESCRIPTIVE_REPRESENTATION_ITEM/i.test(type))
          ? getQuotedValues(entityStatements.get(entityId) || "")
              .filter((value) => /theoretical|auxiliary|reference|basic|statistical|controlled\s+radius/i.test(value))
          : [];
        return [
          ...directNotes,
          ...getEntityRefs(entityId).flatMap((ref) => getRepresentationNotes(ref, depth + 1, new Set(visited)))
        ].filter((value, index, all) => all.indexOf(value) === index);
      };
      for (const relationshipId of getUsedIn(dimensionEntityId, /DIMENSIONAL_CHARACTERISTIC_REPRESENTATION/i)) {
        const representationIds = getEntityRefs(relationshipId)
          .filter((ref) => getEntityTypeNames(ref).some((type) => /SHAPE_DIMENSION_REPRESENTATION|REPRESENTATION/i.test(type)));
        for (const representationId of representationIds) {
          const representationNotes = getRepresentationNotes(representationId);
          representationNotes.forEach((note) => {
            if (!notes.includes(note)) notes.push(note);
          });
          const measureRefs = getEntityRefs(representationId)
            .filter((ref) => getEntityTypeNames(ref).some((type) => /MEASURE_WITH_UNIT|LENGTH_MEASURE_WITH_UNIT|PLANE_ANGLE_MEASURE_WITH_UNIT/i.test(type)));
          for (const measureRef of measureRefs) {
            const labels = getQuotedValues(entityStatements.get(measureRef) || "");
            const value = getMeasureValue(measureRef);
            if (value === null) continue;
            if (labels.some((label) => /nominal\s+value/i.test(label))) nominal = value;
            else if (labels.some((label) => /lower\s+limit|lsl/i.test(label))) lowerLimit = value;
            else if (labels.some((label) => /upper\s+limit|usl/i.test(label))) upperLimit = value;
            else if (nominal === null) nominal = value;
          }
        }
      }
      return { nominal, lowerLimit, upperLimit, notes };
    };

    const getNominalDimensionValue = (dimensionEntityId: string): number | null => {
      return getDimensionRepresentationValues(dimensionEntityId).nominal;
    };

    const normalizePresentationText = (value: string): string =>
      value
        .replace(/\\X2\\[0-9A-F]+\\X0\\/gi, " ")
        .replace(/\\X\\[0-9A-F]+/gi, " ")
        .replace(/<!SYM=[^>]*>/gi, " ")
        .replace(/\\[wnxu]/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

    const parseDimensionLimitRangeText = (value: string): {
      lowerLimit: number;
      upperLimit: number;
      preModifier?: string;
    } | undefined => {
      const normalized = normalizePresentationText(value);
      const match = normalized.match(/(?:^|[^A-Z0-9])((?:\d{1,3}\s*X|X\s*\d{1,3})\s+)?R\s*([+-]?(?:\d+\.\d+|\d+|\.\d+))\s*-\s*([+-]?(?:\d+\.\d+|\d+|\.\d+))/i);
      if (!match) return undefined;
      const lowerLimit = Number(match[2]);
      const upperLimit = Number(match[3]);
      if (!Number.isFinite(lowerLimit) || !Number.isFinite(upperLimit)) return undefined;
      const preModifier = getLiteralDimensionMultiplier(match[1] || "");
      return {
        lowerLimit: Math.min(lowerLimit, upperLimit),
        upperLimit: Math.max(lowerLimit, upperLimit),
        preModifier
      };
    };

    const getDimensionLimitRangeCallout = (
      texts: string[],
      dimensionKind: string | undefined
    ): ReturnType<typeof parseDimensionLimitRangeText> => {
      if (dimensionKind !== "radius") return undefined;
      return texts.map(parseDimensionLimitRangeText).find((item): item is NonNullable<typeof item> => !!item);
    };

    const getDimensionLimitNote = (texts: string[]): string | undefined => {
      const candidates = texts
        .map(normalizePresentationText)
        .map((textValue) => textValue.replace(/\\/g, " ").replace(/\s+/g, " ").trim())
        .map((textValue) => textValue.replace(/^TXT\s+/i, "").trim())
        .filter(Boolean)
        .filter((textValue) => !/^Text(?:\.\d+)?$/i.test(textValue))
        .filter((textValue) => !/\bDIM\b/i.test(textValue))
        .filter((textValue) => /\b(?:INNER|OUTER|RADIUS|RADII|GROOVE)\b/i.test(textValue))
        .filter((textValue, index, all) => all.indexOf(textValue) === index)
        .sort((a, b) => b.length - a.length);
      return candidates[0];
    };

    const getLiteralDimensionMultiplier = (value: string): string | undefined => {
      const rawMatch = value.match(/DIM\s*\\+w\s*(\d{1,3})\s*X/i);
      if (rawMatch) {
        const rawCount = Number(rawMatch[1]);
        if (Number.isFinite(rawCount) && rawCount > 1) return `${rawCount}X`;
      }
      const normalized = normalizePresentationText(value);
      const match = normalized.match(/(?:^|[^A-Z0-9\\])(?:X\s*(\d{1,3})|(\d{1,3})\s*X)(?=[^A-Z0-9]|$)/i);
      if (!match) return undefined;
      const count = Number(match[1] || match[2]);
      return Number.isFinite(count) && count > 1 ? `${count}X` : undefined;
    };

    const normalizeThreadDesignation = (value: string): string | undefined => {
      const normalized = normalizePresentationText(value)
        .replace(/\s*-\s*/g, "-")
        .trim();
      const match = normalized.match(/\bM\s*(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)\s*-\s*([0-9]+[A-Z])\b/i);
      if (!match) return undefined;
      return `M${match[1]}x${match[2]}-${match[3].toUpperCase()}`;
    };

    const getAnnotationPlaneFrame = (annotationId: string): {
      point: { x: number; y: number; z: number } | null;
      normal: { x: number; y: number; z: number } | null;
    } | null => {
      const annotationPlaneId = getUsedIn(annotationId, /ANNOTATION_PLANE/i)[0];
      const planeId = annotationPlaneId
        ? getEntityRefs(annotationPlaneId).find((ref) => getEntityType(ref) === "PLANE")
        : undefined;
      const placementId = planeId
        ? getEntityRefs(planeId).find((ref) => getEntityType(ref) === "AXIS2_PLACEMENT_3D")
        : undefined;
      if (!placementId) return null;
      const refs = getEntityRefs(placementId);
      return {
        point: refs[0] ? getCartesianPoint(refs[0]) : null,
        normal: refs[1] ? getDirection(refs[1]) : null
      };
    };

    const squaredFrameDistance = (
      a: ReturnType<typeof getAnnotationPlaneFrame>,
      b: ReturnType<typeof getAnnotationPlaneFrame>
    ): number => {
      if (!a?.point || !b?.point) return Number.POSITIVE_INFINITY;
      const dx = a.point.x - b.point.x;
      const dy = a.point.y - b.point.y;
      const dz = a.point.z - b.point.z;
      const normalPenalty = a.normal && b.normal
        ? Math.max(0, 1 - Math.abs(a.normal.x * b.normal.x + a.normal.y * b.normal.y + a.normal.z * b.normal.z)) * 1e6
        : 0;
      return dx * dx + dy * dy + dz * dz + normalPenalty;
    };

    const getThreadDesignationForDepthCallout = (
      linkedAnnotationIds: string[],
      dimensionPreModifier?: string
    ): { designation: string; targetIds: string[] } | undefined => {
      const depthFrames = linkedAnnotationIds
        .map(getAnnotationPlaneFrame)
        .filter((frame): frame is NonNullable<typeof frame> => !!frame?.point);
      if (depthFrames.length === 0) return undefined;

      const candidates = [...entityStatements.entries()]
        .filter(([, statement]) => /^DRAUGHTING_CALLOUT\s*\(/i.test(statement))
        .flatMap(([annotationId]) => {
          const texts = getCalloutValidationPresentationTexts([annotationId]);
          const designation = texts.map(normalizeThreadDesignation).find((item): item is string => !!item);
          if (!designation) return [];
          const modifier = texts.map(getLiteralDimensionMultiplier).find((item): item is string => !!item);
          if (dimensionPreModifier && modifier && modifier !== dimensionPreModifier) return [];
          const frame = getAnnotationPlaneFrame(annotationId);
          if (!frame?.point) return [];
          const distance = Math.min(...depthFrames.map((depthFrame) => squaredFrameDistance(depthFrame, frame)));
          const dimensionIds = getUsedIn(annotationId, /DRAUGHTING_MODEL_ITEM_ASSOCIATION/i)
            .map((associationId) => getEntityRefs(associationId)[0])
            .filter((ref): ref is string => !!ref)
            .filter((ref, index, all) => all.indexOf(ref) === index)
            .filter((ref) => getEntityTypeNames(ref).some((type) => /DIMENSIONAL_SIZE|DIMENSIONAL_LOCATION|ANGULAR_LOCATION/i.test(type)));
          const targetIds = resolveThreadCylinderFaceTargets(uniqueGeometryTargets(dimensionIds.flatMap(resolveDimensionTargets)));
          return [{ designation, modifier, distance, targetIds }];
        })
        .sort((a, b) => a.distance - b.distance);

      return candidates[0]
        ? { designation: candidates[0].designation, targetIds: candidates[0].targetIds }
        : undefined;
    };

    const getCylinderSurfaceFrame = (targetId: string): { point: { x: number; y: number; z: number }; axis: { x: number; y: number; z: number }; radius: number } | null => {
      const surfaceId = [targetId, ...getEntityRefs(targetId)]
        .find((ref) => getEntityType(ref) === "CYLINDRICAL_SURFACE");
      if (!surfaceId) return null;
      const surfaceStatement = entityStatements.get(surfaceId) || "";
      const radiusMatch = getEntityParams(surfaceId)
        .slice()
        .reverse()
        .join(",")
        .replace(/#\d+/g, "")
        .match(/[-+]?(?:\d+\.\d+|\d+|\.\d+)(?:[Ee][-+]?\d+)?/);
      const radius = radiusMatch ? Number(radiusMatch[0]) : null;
      const placementId = getEntityRefs(surfaceId).find((ref) => getEntityType(ref) === "AXIS2_PLACEMENT_3D");
      const placementRefs = placementId ? getEntityRefs(placementId) : [];
      const point = placementRefs[0] ? getCartesianPoint(placementRefs[0]) : null;
      const axis = placementRefs[1] ? getDirection(placementRefs[1]) : null;
      if (!point || !axis || radius === null || !Number.isFinite(radius)) return null;
      if (!/CYLINDRICAL_SURFACE/i.test(surfaceStatement)) return null;
      return { point, axis, radius };
    };

    const distancePointToCylinderSurface = (
      point: { x: number; y: number; z: number },
      cylinder: { point: { x: number; y: number; z: number }; axis: { x: number; y: number; z: number }; radius: number }
    ) => {
      const dx = point.x - cylinder.point.x;
      const dy = point.y - cylinder.point.y;
      const dz = point.z - cylinder.point.z;
      const axisLength = Math.hypot(cylinder.axis.x, cylinder.axis.y, cylinder.axis.z) || 1;
      const ax = cylinder.axis.x / axisLength;
      const ay = cylinder.axis.y / axisLength;
      const az = cylinder.axis.z / axisLength;
      const axial = dx * ax + dy * ay + dz * az;
      const radialX = dx - axial * ax;
      const radialY = dy - axial * ay;
      const radialZ = dz - axial * az;
      return Math.abs(Math.hypot(radialX, radialY, radialZ) - cylinder.radius);
    };

    const resolveThreadCylinderFaceTargets = (targetIds: string[]): string[] => {
      const threadTargets = targetIds.filter((targetId) => /thread\s+cylinder/i.test(entityStatements.get(targetId) || ""));
      if (threadTargets.length === 0) return [];

      const cylinderFaces = faceRecords
        .map((face) => ({ id: face.id, frame: getCylinderSurfaceFrame(face.id) }))
        .filter((face): face is { id: string; frame: NonNullable<ReturnType<typeof getCylinderSurfaceFrame>> } => !!face.frame);

      const resolvedPairs = threadTargets
        .map((targetId) => {
          const points = getEntityCartesianPoints(targetId, 6);
          if (points.length === 0 || cylinderFaces.length === 0) return null;
          const faceTargetId = cylinderFaces
            .map((face) => ({
              id: face.id,
              score: points.reduce((sum, point) => sum + distancePointToCylinderSurface(point, face.frame), 0) / points.length
            }))
            .sort((a, b) => a.score - b.score)[0]?.id || null;
          return faceTargetId ? { targetId, faceTargetId } : null;
        })
        .filter((pair): pair is { targetId: string; faceTargetId: string } => !!pair);
      resolvedPairs.forEach(({ targetId, faceTargetId }) => {
        threadCylinderFaceTargetsBySemanticTarget.set(targetId, [faceTargetId]);
      });
      return resolvedPairs
        .map(({ faceTargetId }) => faceTargetId)
        .filter((targetId, index, all) => all.indexOf(targetId) === index);
    };

    const hasThreadPlaneShapeAspect = (shapeAspectIds: string[]): boolean => {
      const queue = shapeAspectIds.map((entityId) => ({ entityId, depth: 0 }));
      const visited = new Set<string>();
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current.depth > 5 || visited.has(current.entityId)) continue;
        visited.add(current.entityId);
        const statement = entityStatements.get(current.entityId) || "";
        if (/thread/i.test(statement)) return true;
        const neighbors = [
          ...getEntityRefs(current.entityId),
          ...getUsedIn(current.entityId)
        ].filter((ref) =>
          getEntityTypeNames(ref).some((type) =>
            /SHAPE_ASPECT|GEOMETRIC_ITEM_SPECIFIC_USAGE|GEOMETRIC_CURVE_SET|REPRESENTATION|PROPERTY_DEFINITION/i.test(type)
          )
        );
        neighbors.forEach((ref) => {
          if (!visited.has(ref)) queue.push({ entityId: ref, depth: current.depth + 1 });
        });
      }
      return false;
    };

    const presentationTextMatchesNominal = (textValue: string, nominal: number) => {
      const withoutMultiplier = normalizePresentationText(textValue)
        .replace(/(?:^|[^A-Z0-9\\])(?:X\s*\d{1,3}|\d{1,3}\s*X)(?=[^A-Z0-9]|$)/gi, " ");
      const values = withoutMultiplier
        .match(/[-+]?(?:\d+\.\d+|\d+|\.\d+)/g)
        ?.map(Number)
        .filter(Number.isFinite) || [];
      return values.some((value) => Math.abs(value - nominal) <= Math.max(Math.abs(nominal) * 0.002, 0.01));
    };

    const dimensionPresentationTextCache = new Map<string, string[]>();
    const getPresentationTextsForEntity = (
      entityId: string,
      depth = 8,
      visited = new Set<string>()
    ): string[] => {
      const cacheKey = `${entityId}:${depth}`;
      const cached = dimensionPresentationTextCache.get(cacheKey);
      if (cached) return cached;
      if (depth < 0 || visited.has(entityId)) return [];
      visited.add(entityId);
      const statement = entityStatements.get(entityId) || "";
      const nearbyUsedIn = getUsedIn(entityId).filter((ref) =>
        getEntityTypeNames(ref).some((type) =>
          /ANNOTATION_PLANE|CHARACTERIZED_ITEM_WITHIN_REPRESENTATION|PROPERTY_DEFINITION|PROPERTY_DEFINITION_REPRESENTATION|REPRESENTATION|DRAUGHTING_CALLOUT/i.test(type)
        )
      );
      const nearbyRefs = getEntityRefs(entityId).filter((ref) =>
        !getEntityTypeNames(ref).some((type) =>
          /DRAUGHTING_MODEL|GEOMETRIC_REPRESENTATION_CONTEXT|GLOBAL_UNIT_ASSIGNED_CONTEXT|PRODUCT_DEFINITION/i.test(type)
        )
      );
      const texts = [
        ...getQuotedValues(statement),
        ...nearbyRefs.flatMap((ref) => getPresentationTextsForEntity(ref, depth - 1, new Set(visited))),
        ...nearbyUsedIn.flatMap((ref) => getPresentationTextsForEntity(ref, depth - 1, new Set(visited)))
      ];
      const uniqueTexts = texts
        .map(normalizePresentationText)
        .filter(Boolean)
        .filter((item, index, all) => all.indexOf(item) === index);
      dimensionPresentationTextCache.set(cacheKey, uniqueTexts);
      return uniqueTexts;
    };

    const getBoundedPresentationTexts = (seedIds: string[], maxDepth = 6): string[] => {
      const queue = seedIds.map((entityId) => ({ entityId, depth: 0 }));
      const visited = new Set<string>();
      const texts: string[] = [];
      const isPresentationNeighborhoodEntity = (entityId: string) => {
        const statement = entityStatements.get(entityId) || "";
        return /DESCRIPTIVE_REPRESENTATION_ITEM|REPRESENTATION|PROPERTY_DEFINITION|CHARACTERIZED_ITEM_WITHIN_REPRESENTATION|DRAUGHTING_CALLOUT|ANNOTATION_PLANE|ANNOTATION_PLACEHOLDER_OCCURRENCE|DRAUGHTING_MODEL_ITEM_ASSOCIATION/i.test(statement);
      };

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current.depth > maxDepth || visited.has(current.entityId)) continue;
        visited.add(current.entityId);
        const statement = entityStatements.get(current.entityId) || "";
        texts.push(...getQuotedValues(statement));

        const neighbors = [
          ...getEntityRefs(current.entityId),
          ...getUsedIn(current.entityId)
        ].filter((ref) => seedIds.includes(ref) || isPresentationNeighborhoodEntity(ref));
        neighbors.forEach((ref) => {
          if (!visited.has(ref)) queue.push({ entityId: ref, depth: current.depth + 1 });
        });
      }

      return texts
        .map(normalizePresentationText)
        .filter(Boolean)
        .filter((item, index, all) => all.indexOf(item) === index);
    };

    const getBoundedRawPresentationTexts = (seedIds: string[], maxDepth = 6): string[] => {
      const queue = seedIds.map((entityId) => ({ entityId, depth: 0 }));
      const visited = new Set<string>();
      const texts: string[] = [];
      const isPresentationNeighborhoodEntity = (entityId: string) => {
        const statement = entityStatements.get(entityId) || "";
        return /DESCRIPTIVE_REPRESENTATION_ITEM|REPRESENTATION|PROPERTY_DEFINITION|PROPERTY_DEFINITION_REPRESENTATION|GENERAL_PROPERTY_ASSOCIATION|CHARACTERIZED_ITEM_WITHIN_REPRESENTATION|DRAUGHTING_CALLOUT|ANNOTATION_PLANE|ANNOTATION_PLACEHOLDER_OCCURRENCE|DRAUGHTING_MODEL_ITEM_ASSOCIATION/i.test(statement);
      };

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current.depth > maxDepth || visited.has(current.entityId)) continue;
        visited.add(current.entityId);
        const statement = entityStatements.get(current.entityId) || "";
        texts.push(...getQuotedValues(statement));

        const neighbors = [
          ...getEntityRefs(current.entityId),
          ...getUsedIn(current.entityId)
        ].filter((ref) => seedIds.includes(ref) || isPresentationNeighborhoodEntity(ref));
        neighbors.forEach((ref) => {
          if (!visited.has(ref)) queue.push({ entityId: ref, depth: current.depth + 1 });
        });
      }

      return texts
        .filter(Boolean)
        .filter((item, index, all) => all.indexOf(item) === index);
    };

    const hasCounterboreSymbolText = (value: string): boolean =>
      /\\X2\\2334\\X0\\|⌴|counter\s*bore/i.test(value);

    const hasCountersinkSymbolText = (value: string): boolean =>
      /\\X2\\2335\\X0\\|⌵|counter\s*sink/i.test(value);

    const getCalloutValidationPresentationTexts = (annotationIds: string[]): string[] => {
      const texts: string[] = [];
      for (const annotationId of annotationIds) {
        const characterizedItems = getUsedIn(annotationId, /CHARACTERIZED_ITEM_WITHIN_REPRESENTATION/i);
        for (const characterizedItem of characterizedItems) {
          const propertyDefinitions = getUsedIn(characterizedItem, /PROPERTY_DEFINITION/i);
          for (const propertyDefinition of propertyDefinitions) {
            const propertyRepresentations = getUsedIn(propertyDefinition, /PROPERTY_DEFINITION_REPRESENTATION/i);
            for (const propertyRepresentation of propertyRepresentations) {
              getEntityRefs(propertyRepresentation)
                .filter((ref) => getEntityTypeNames(ref).some((type) => /REPRESENTATION/i.test(type)))
                .forEach((representationId) => {
                  texts.push(...getQuotedValues(entityStatements.get(representationId) || ""));
                  getEntityRefs(representationId).forEach((ref) => {
                    texts.push(...getQuotedValues(entityStatements.get(ref) || ""));
                  });
                });
            }
          }
        }
      }
      return texts
        .filter(Boolean)
        .filter((item, index, all) => all.indexOf(item) === index);
    };

    const getLinkedAnnotationIdsForDimension = (dimensionEntityId: string, shapeAspectIds: string[]) => {
      const directAnnotationIds = [...entityStatements.entries()]
        .filter(([, statement]) => /^DRAUGHTING_MODEL_ITEM_ASSOCIATION(?:_WITH_PLACEHOLDER)?\s*\(/i.test(statement))
        .flatMap(([entityId, statement]) => {
          const refs = getEntityRefs(entityId);
          if (!(refs[0] === dimensionEntityId || shapeAspectIds.includes(refs[0]))) return [];
          if (/DRAUGHTING_MODEL_ITEM_ASSOCIATION_WITH_PLACEHOLDER/i.test(statement)) {
            return refs.slice(2).filter((ref) =>
              getEntityTypeNames(ref).some((type) =>
                /DRAUGHTING_CALLOUT|ANNOTATION_PLACEHOLDER_OCCURRENCE|ANNOTATION_OCCURRENCE|TESSELLATED_ANNOTATION_OCCURRENCE/i.test(type)
              )
            );
          }
          return [refs[refs.length - 1]];
        })
        .filter((ref): ref is string => !!ref);
      return [
        ...draughtingAssociations
          .filter((assoc) => [dimensionEntityId, ...shapeAspectIds].includes(assoc.shapeAspectId))
          .map((assoc) => assoc.annotationId),
        ...directAnnotationIds
      ].filter((ref, index, all) => all.indexOf(ref) === index);
    };

    const isAnnotationPresentationInvisible = (annotationId: string): boolean => {
      if (getUsedIn(annotationId, /^INVISIBILITY$/i).length > 0) return true;

      const presentationItems = getEntityRefs(annotationId).filter((ref) =>
        getEntityTypeNames(ref).some((type) =>
          /ANNOTATION_OCCURRENCE|ANNOTATION_PLACEHOLDER_OCCURRENCE|TESSELLATED_ANNOTATION_OCCURRENCE/i.test(type)
        )
      );
      return presentationItems.length > 0 && presentationItems.every((itemId) =>
        getUsedIn(itemId, /^INVISIBILITY$/i).length > 0
      );
    };

    const hasOnlyInvisibleDimensionPresentations = (annotationIds: string[]): boolean =>
      annotationIds.length > 0 && annotationIds.every(isAnnotationPresentationInvisible);

    const getDimensionPreModifier = (dimensionEntityId: string): string | undefined => {
      const dimensionTypeNames = getEntityTypeNames(dimensionEntityId);
      if (!dimensionTypeNames.some((type) => /DIMENSIONAL_SIZE|DIMENSIONAL_LOCATION|ANGULAR_LOCATION/i.test(type))) return undefined;
      const sphericalTargetCount = isSphericalDimension(dimensionEntityId)
        ? getSphericalRepeatedElementCount(resolveDimensionTargets(dimensionEntityId))
        : 0;
      const shapeAspectIds = getEntityRefs(dimensionEntityId)
        .filter((ref) => getEntityTypeNames(ref).some((type) => /SHAPE_ASPECT|COMPOSITE_SHAPE_ASPECT/i.test(type)));
      const linkedAnnotationIds = getLinkedAnnotationIdsForDimension(dimensionEntityId, shapeAspectIds);
      const nominal = getNominalDimensionValue(dimensionEntityId);
      const calloutValidationTexts = getCalloutValidationPresentationTexts(linkedAnnotationIds);
      const calloutCandidateTexts = nominal !== null && calloutValidationTexts.length > 0
        ? calloutValidationTexts.filter((textValue) => presentationTextMatchesNominal(textValue, nominal))
        : calloutValidationTexts;
      const calloutMultipliers = calloutCandidateTexts
        .map(getLiteralDimensionMultiplier)
        .filter((modifier): modifier is string => !!modifier)
        .filter((modifier, index, all) => all.indexOf(modifier) === index);
      if (calloutMultipliers.length === 1) return sphericalTargetCount === 1 ? undefined : calloutMultipliers[0];

      const directlyLinkedTexts = [dimensionEntityId, ...shapeAspectIds]
        .flatMap((ref) => [
          ...getPresentationTextsForEntity(ref),
          ...draughtingAssociations
            .filter((assoc) => assoc.shapeAspectId === ref)
            .flatMap((assoc) => getPresentationTextsForEntity(assoc.annotationId))
        ])
        .concat(getBoundedPresentationTexts([dimensionEntityId, ...shapeAspectIds, ...linkedAnnotationIds]));
      const linkedDimensionTexts = directlyLinkedTexts.filter((textValue) => /\bDIM\b/i.test(textValue));
      const candidateTexts = nominal !== null && linkedDimensionTexts.length > 0
        ? linkedDimensionTexts.filter((textValue) => presentationTextMatchesNominal(textValue, nominal))
        : linkedDimensionTexts;
      const linkedMultipliers = candidateTexts
        .map(getLiteralDimensionMultiplier)
        .filter((modifier): modifier is string => !!modifier)
        .filter((modifier, index, all) => all.indexOf(modifier) === index);
      if (linkedMultipliers.length === 1) return sphericalTargetCount === 1 ? undefined : linkedMultipliers[0];

      const repeatedLocationCount = getRepeatedLocationPairCount(dimensionEntityId);
      if (repeatedLocationCount > 1) return `${repeatedLocationCount}X`;

      if (dimensionTypeNames.some((type) => /DIMENSIONAL_SIZE/i.test(type))) {
        if (isSphericalDimension(dimensionEntityId)) {
          const sphericalCount = sphericalTargetCount;
          if (sphericalCount > 1) return `${sphericalCount}X`;
          return undefined;
        }

        const childTargetGroups = getDimensionChildTargetGroups(dimensionEntityId);
        const datumGroupCount = childTargetGroups.filter((targets) => targets.some(isDatumDimensionTarget)).length;
        const repeatedElementCount = childTargetGroups.length - datumGroupCount;
        if (datumGroupCount > 0 && repeatedElementCount > 1) return `${repeatedElementCount}X`;

        const nonDatumChildGroups = childTargetGroups.filter((targets) => !targets.some(isDatumDimensionTarget));
        const explicitCompositeCount = getCompositeRepeatedElementCount(
          nonDatumChildGroups,
          getDimensionKind(dimensionEntityId) !== "radius"
        );
        if (datumGroupCount === 0 && explicitCompositeCount > 1) return `${explicitCompositeCount}X`;
      }

      return undefined;
    };

    const getAssociatedDatumIdentifierForTargets = (targetIds: string[]): string | undefined => {
      if (targetIds.length < 2) return undefined;
      return Array.from(entityStatements.keys())
        .filter((entityId) => getEntityType(entityId) === "DATUM")
        .map((datumId) => {
          const identifier = getDatumIdentifier(datumId);
          if (!identifier) return null;
          const datumTargets = uniqueGeometryTargets(
            getSemanticDatumFeatureIds(datumId).flatMap((featureId) => [
              ...getShapeAspectGeometryTargets(featureId),
              ...getDescendantShapeAspectGeometryTargets(featureId)
            ])
          );
          return identifier && datumTargets.length > 1
            ? { identifier, datumTargets }
            : null;
        })
        .filter((datum): datum is { identifier: string; datumTargets: string[] } => !!datum)
        .find((datum) => targetIds.every((targetId) => datum.datumTargets.includes(targetId)))
        ?.identifier;
    };

    const getDimensionSemanticPresentationTexts = (dimensionEntityId: string): string[] => {
      const shapeAspectIds = getDimensionShapeAspectRefs(dimensionEntityId);
      const linkedAnnotationIds = getLinkedAnnotationIdsForDimension(dimensionEntityId, shapeAspectIds);
      const relatedAnnotationIds = linkedAnnotationIds.flatMap((annotationId) =>
        getUsedIn(annotationId, /DRAUGHTING_CALLOUT_RELATIONSHIP/i)
          .flatMap(getEntityRefs)
          .filter((ref) => ref !== annotationId)
      );
      const relatedShapeAspectIds = [...linkedAnnotationIds, ...relatedAnnotationIds]
        .flatMap((annotationId) =>
          draughtingAssociations
            .filter((assoc) => assoc.annotationId === annotationId)
            .map((assoc) => assoc.shapeAspectId)
        );
      const semanticCarrierShapeAspectIds = [...shapeAspectIds, ...relatedShapeAspectIds]
        .filter((shapeAspectId, index, all) => all.indexOf(shapeAspectId) === index);
      const semanticTextIds = semanticCarrierShapeAspectIds.flatMap((shapeAspectId) =>
        getUsedIn(shapeAspectId, /PROPERTY_DEFINITION/i)
          .filter((propertyDefinitionId) => /semantic\s+text/i.test(entityStatements.get(propertyDefinitionId) || ""))
          .flatMap((propertyDefinitionId) =>
            getUsedIn(propertyDefinitionId, /PROPERTY_DEFINITION_REPRESENTATION/i)
              .flatMap(getEntityRefs)
          )
      );
      const semanticTexts = semanticTextIds.flatMap((semanticTextId) => [
        ...getQuotedValues(entityStatements.get(semanticTextId) || ""),
        ...getEntityRefs(semanticTextId).flatMap((ref) => getQuotedValues(entityStatements.get(ref) || ""))
      ]);
      return [
        ...getCalloutValidationPresentationTexts([...linkedAnnotationIds, ...relatedAnnotationIds]),
        ...semanticTexts,
        ...getBoundedRawPresentationTexts([
          dimensionEntityId,
          ...shapeAspectIds,
          ...linkedAnnotationIds,
          ...relatedAnnotationIds
        ], 2)
      ];
    };

    const hasCounterboreSymbolForDimension = (dimensionEntityId: string): boolean =>
      getDimensionSemanticPresentationTexts(dimensionEntityId).some(hasCounterboreSymbolText);

    const getCounterboreEvaluationNoteForDimension = (dimensionEntityId: string): string | undefined => {
      const noteText = getDimensionSemanticPresentationTexts(dimensionEntityId)
        .map(normalizePresentationText)
        .find((textValue) => /\b\d+\s*X\s+INDIVIDUALLY\b/i.test(textValue));
      const match = noteText?.match(/\b(\d+)\s*X\s+INDIVIDUALLY\b/i);
      return match ? `${match[1]}X INDIVIDUALLY` : undefined;
    };

    type PendingCountersinkAngle = {
      dimensionEntityId: string;
      dimensionPreModifier?: string;
      nominalDimension: number;
      lowerTolerance?: number;
      upperTolerance?: number;
      targetIds: string[];
      annotationFrames: NonNullable<ReturnType<typeof getAnnotationPlaneFrame>>[];
    };

    const pendingCountersinkAngles: PendingCountersinkAngle[] = [];

    type PendingHoleDepthDimension = {
      dimensionEntityId: string;
      nominalDimension: number;
      lowerTolerance?: number;
      upperTolerance?: number;
      dimensionPreModifier?: string;
      targetIds: string[];
      targetPoints: { x: number; y: number; z: number }[];
      annotationPoints: { x: number; y: number; z: number }[];
      linkedAnnotationIds: string[];
      hasCounterboreSymbol: boolean;
      allowCounterboreInference?: boolean;
    };

    const pendingHoleDepthDimensions: PendingHoleDepthDimension[] = [];

    const shareAny = (a: string[], b: string[]) => a.some((item) => b.includes(item));

    const getOwnerFaceIdsForTargets = (targetIds: string[]): string[] =>
      targetIds
        .flatMap((targetId) => [
          targetId,
          ...getOwningFaceIdsForTarget(targetId)
        ])
        .filter((faceId, index, all) =>
          /^(ADVANCED_FACE|FACE_SURFACE)$/i.test(getEntityType(faceId)) &&
          all.indexOf(faceId) === index
        );

    const getCylindricalOwnerFaceIdsForTargets = (targetIds: string[]): string[] =>
      getOwnerFaceIdsForTargets(targetIds)
        .filter((faceId) => getTargetSurfaceType(faceId) === "cylinder");

    const hasPlanarOwnerForTargets = (targetIds: string[]): boolean =>
      getOwnerFaceIdsForTargets(targetIds)
        .some((faceId) => getTargetSurfaceType(faceId) === "plane");

    const depthMatchesDiameterByTopology = (
      depth: PendingHoleDepthDimension,
      diameterTolerance: ParsedStepTolerance
    ): boolean => {
      const depthCylinderOwners = getCylindricalOwnerFaceIdsForTargets(depth.targetIds);
      if (depthCylinderOwners.length === 0 || !hasPlanarOwnerForTargets(depth.targetIds)) return false;

      const diameterCylinderOwners = getCylindricalOwnerFaceIdsForTargets(diameterTolerance.targetIds || []);
      return shareAny(depthCylinderOwners, diameterCylinderOwners);
    };

    // Some AP242 exporters describe a hole depth using the planar faces and
    // circular boundary geometry at the hole, without also repeating the
    // cylindrical face in the dimensional-location target. Match that form
    // in model space, independent of entity numbering or a particular file.
    const getDepthDiameterGeometryScore = (
      depth: PendingHoleDepthDimension,
      diameterTolerance: ParsedStepTolerance
    ): number | undefined => {
      if (depth.targetPoints.length === 0 && depth.annotationPoints.length === 0) return undefined;

      const rawDepthPoints = depth.targetPoints;
      const annotationPoints = depth.annotationPoints;
      const scale = getDefaultLengthScaleToMillimeters();
      const cylinderGeometry = (diameterTolerance.targetIds || [])
        .map((targetId) => getTargetSurfaceGeometry(targetId))
        .filter((geometry) => geometry.surfaceType === "cylinder" && geometry.point);

      let bestScore = Number.POSITIVE_INFINITY;
      cylinderGeometry.forEach((geometry) => {
        const center = geometry.point!;
        const axis = geometry.axis || { x: 0, y: 1, z: 0 };
        const axisLength = Math.hypot(axis.x, axis.y, axis.z) || 1;
        const normalizedAxis = {
          x: axis.x / axisLength,
          y: axis.y / axisLength,
          z: axis.z / axisLength
        };

        const hasAxisPoint = rawDepthPoints.some((point) => {
          const delta = {
            x: point.x - center.x / scale,
            y: point.y - center.y / scale,
            z: point.z - center.z / scale
          };
          const axialDistance =
            delta.x * normalizedAxis.x +
            delta.y * normalizedAxis.y +
            delta.z * normalizedAxis.z;
          const radialDistance = {
            x: delta.x - axialDistance * normalizedAxis.x,
            y: delta.y - axialDistance * normalizedAxis.y,
            z: delta.z - axialDistance * normalizedAxis.z
          };
          return Math.hypot(radialDistance.x, radialDistance.y, radialDistance.z) <= 0.02;
        });
        if (hasAxisPoint) {
          bestScore = Math.min(bestScore, 0);
          return;
        }

        annotationPoints.forEach((point) => {
          const delta = {
            x: point.x - center.x / scale,
            y: point.y - center.y / scale,
            z: point.z - center.z / scale
          };
          const axialDistance =
            delta.x * normalizedAxis.x +
            delta.y * normalizedAxis.y +
            delta.z * normalizedAxis.z;
          const radialDistance = {
            x: delta.x - axialDistance * normalizedAxis.x,
            y: delta.y - axialDistance * normalizedAxis.y,
            z: delta.z - axialDistance * normalizedAxis.z
          };
          const distanceToAxis = Math.hypot(radialDistance.x, radialDistance.y, radialDistance.z);
          if (distanceToAxis <= 1) bestScore = Math.min(bestScore, 0.25 + distanceToAxis);
        });
      });
      return Number.isFinite(bestScore) ? bestScore : undefined;
    };

    const mergeDepthIntoHoleDiameter = (
      diameterTolerance: ParsedStepTolerance,
      depth: PendingHoleDepthDimension
    ) => {
      if (depth.hasCounterboreSymbol || (depth.allowCounterboreInference && hasCounterboreSymbolForDimension(diameterTolerance.dimensionEntityId || ""))) {
        diameterTolerance.isCounterboreDimension = true;
        diameterTolerance.type = "Counterbore Dimensional";
        diameterTolerance.symbol = "CBORE_DIM";
      }
      diameterTolerance.counterboreDepthNominal = depth.nominalDimension;
      diameterTolerance.counterboreDepthLowerTolerance = depth.lowerTolerance;
      diameterTolerance.counterboreDepthUpperTolerance = depth.upperTolerance;
      if (!depth.allowCounterboreInference) {
        diameterTolerance.holeDepthFromBoundaryTopology = true;
      }
      diameterTolerance.clinicalContext =
        `Hole callout ${diameterTolerance.dimensionPreModifier ? `${diameterTolerance.dimensionPreModifier} ` : ""}` +
        `with diameter ${diameterTolerance.nominalDimension ?? "unknown"} mm and depth ${depth.nominalDimension} mm resolved from shared AP242 hole, diameter, depth, and plus-minus tolerance relationships.`;
    };

    const findMatchingHoleDiameterForDepth = (depth: PendingHoleDepthDimension): ParsedStepTolerance | undefined => {
      const candidates = tolerances
        .filter((existing) =>
          existing.category === "Dimension" &&
          existing.dimensionKind === "diameter" &&
          (!existing.dimensionPreModifier || !depth.dimensionPreModifier || existing.dimensionPreModifier === depth.dimensionPreModifier)
        )
        .map((existing) => {
          const dimensionShapeAspectIds = getDimensionShapeAspectRefs(existing.dimensionEntityId || "");
          const linkedAnnotationMatch = shareAny(
            depth.linkedAnnotationIds,
            getLinkedAnnotationIdsForDimension(existing.dimensionEntityId || "", dimensionShapeAspectIds)
          );
          const directTargetMatch = shareAny(depth.targetIds, existing.targetIds || []);
          const topologyMatch = depthMatchesDiameterByTopology(depth, existing);
          const geometryScore = getDepthDiameterGeometryScore(depth, existing);
          const score =
            linkedAnnotationMatch ? 0 :
            directTargetMatch ? 1 :
            geometryScore !== undefined ? 2 + geometryScore :
            topologyMatch ? 10 :
            Number.POSITIVE_INFINITY;
          return { existing, score };
        })
        .filter((candidate) => Number.isFinite(candidate.score))
        .sort((a, b) => a.score - b.score);
      return candidates[0]?.existing;
    };

    const findMatchingCountersinkAngle = (
      dimensionPreModifier: string | undefined,
      linkedAnnotationIds: string[]
    ): PendingCountersinkAngle | undefined => {
      if (pendingCountersinkAngles.length === 0) return undefined;
      const diameterFrames = linkedAnnotationIds
        .map(getAnnotationPlaneFrame)
        .filter((frame): frame is NonNullable<typeof frame> => !!frame?.point);
      const candidates = pendingCountersinkAngles
        .filter((candidate) =>
          !candidate.dimensionPreModifier ||
          !dimensionPreModifier ||
          candidate.dimensionPreModifier === dimensionPreModifier
        )
        .map((candidate) => ({
          candidate,
          score: diameterFrames.length > 0 && candidate.annotationFrames.length > 0
            ? Math.min(...diameterFrames.flatMap((diameterFrame) =>
                candidate.annotationFrames.map((angleFrame) => squaredFrameDistance(diameterFrame, angleFrame))
              ))
            : candidate.dimensionPreModifier === dimensionPreModifier ? 0 : 1
        }))
        .sort((a, b) => a.score - b.score);
      const match = candidates[0]?.candidate;
      if (!match) return undefined;
      const index = pendingCountersinkAngles.indexOf(match);
      if (index >= 0) pendingCountersinkAngles.splice(index, 1);
      return match;
    };

    type CounterboredFeatureSpec = {
      count?: number;
      boreDiameter?: number;
      counterboreDiameter?: number;
      evaluationNote?: string;
    };

    const getPropertyDefinitionNumericValue = (propertyDefinitionId: string): number | undefined => {
      const propertyRepresentations = getUsedIn(propertyDefinitionId, /PROPERTY_DEFINITION_REPRESENTATION/i);
      for (const propertyRepresentationId of propertyRepresentations) {
        const representationIds = getEntityRefs(propertyRepresentationId)
          .filter((ref) => getEntityTypeNames(ref).some((type) => /REPRESENTATION/i.test(type)));
        for (const representationId of representationIds) {
          const valueId = getEntityRefs(representationId)
            .find((ref) => /REAL_REPRESENTATION_ITEM|MEASURE_REPRESENTATION_ITEM/i.test(getEntityType(ref)));
          const statement = valueId ? entityStatements.get(valueId) || "" : "";
          const match = statement.match(/(?:REAL_REPRESENTATION_ITEM|LENGTH_MEASURE|MEASURE_REPRESENTATION_ITEM)\s*\([^,]*,\s*([-+]?(?:\d+\.\d+|\d+|\.\d+)(?:[Ee][-+]?\d+)?)/i);
          const value = match ? Number(match[1]) : undefined;
          if (Number.isFinite(value)) return value;
        }
      }
      return undefined;
    };

    const getPropertyDefinitionTextValues = (propertyDefinitionId: string): string[] => {
      const propertyRepresentations = getUsedIn(propertyDefinitionId, /PROPERTY_DEFINITION_REPRESENTATION/i);
      return propertyRepresentations.flatMap((propertyRepresentationId) =>
        getEntityRefs(propertyRepresentationId)
          .filter((ref) => getEntityTypeNames(ref).some((type) => /REPRESENTATION/i.test(type)))
          .flatMap((representationId) =>
            getEntityRefs(representationId).flatMap((ref) =>
              getQuotedValues(entityStatements.get(ref) || "")
            )
          )
      );
    };

    const counterboreEvaluationNotes = [...entityStatements.entries()]
      .filter(([, statement]) => /^PROPERTY_DEFINITION\s*\(/i.test(statement) && /semantic\s+text/i.test(statement))
      .flatMap(([propertyDefinitionId]) => getPropertyDefinitionTextValues(propertyDefinitionId))
      .map(normalizePresentationText)
      .map((textValue) => textValue.match(/\b(\d+)\s*X\s+INDIVIDUALLY\b/i))
      .filter((match): match is RegExpMatchArray => !!match)
      .map((match) => ({
        count: Number(match[1]),
        text: `${match[1]}X INDIVIDUALLY`
      }));

    const getCounterboredFeatureSpecs = (): CounterboredFeatureSpec[] =>
      [...entityStatements.entries()]
        .filter(([, statement]) => /^SHAPE_ASPECT\s*\(/i.test(statement) && /counter\s*bored\s+hole/i.test(statement))
        .map(([shapeAspectId, statement]) => {
          const quotedValues = getQuotedValues(statement);
          const count = quotedValues
            .map((value) => value.match(/counter\s*bored\s+hole\.(\d+)/i)?.[1])
            .map((value) => value ? Number(value) : undefined)
            .find((value): value is number => Number.isFinite(value) && value > 1);
          const properties = getUsedIn(shapeAspectId, /PROPERTY_DEFINITION/i)
            .map((propertyDefinitionId) => ({
              name: getQuotedValues(entityStatements.get(propertyDefinitionId) || "")[0] || "",
              value: getPropertyDefinitionNumericValue(propertyDefinitionId)
            }));
          return {
            count,
            boreDiameter: properties.find((property) => /^DB$/i.test(property.name))?.value,
            counterboreDiameter: properties.find((property) => /^DFS$/i.test(property.name))?.value,
            evaluationNote: count
              ? counterboreEvaluationNotes.find((note) => note.count === count)?.text
              : undefined
          };
        });

    const sameNominal = (a: number | undefined, b: number | undefined, tolerance = 0.001): boolean =>
      typeof a === "number" &&
      typeof b === "number" &&
      Number.isFinite(a) &&
      Number.isFinite(b) &&
      Math.abs(a - b) <= tolerance;

    const roundedCoordinate = (value: number): string =>
      Number.isFinite(value) ? value.toFixed(3) : "nan";

    const getCylindricalCenterPoints = (tolerance: ParsedStepTolerance): Array<{ x: number; y: number; z: number }> => {
      const points = (tolerance.targetIds || [])
        .map((targetId) => getTargetSurfaceGeometry(targetId))
        .filter((geometry) => geometry.surfaceType === "cylinder" && geometry.point)
        .map((geometry) => geometry.point!);
      return points.filter((point, index, all) =>
        all.findIndex((candidate) =>
          Math.abs(candidate.x - point.x) < 1e-3 &&
          Math.abs(candidate.y - point.y) < 1e-3 &&
          Math.abs(candidate.z - point.z) < 1e-3
        ) === index
      );
    };

    const getCylindricalCenterPatternForAxis = (
      tolerance: ParsedStepTolerance,
      depthAxis: "x" | "y" | "z"
    ): string[] => {
      const uniquePoints = getCylindricalCenterPoints(tolerance);
      if (uniquePoints.length === 0) return [];
      return uniquePoints
        .map((point) => {
          const values = depthAxis === "x"
            ? [point.y, point.z]
            : depthAxis === "y"
              ? [point.x, point.z]
              : [point.x, point.y];
          return `${roundedCoordinate(values[0])},${roundedCoordinate(values[1])}`;
        })
        .filter((key, index, all) => all.indexOf(key) === index)
        .sort();
    };

    const sameCylindricalCenterPattern = (a: ParsedStepTolerance, b: ParsedStepTolerance): boolean => {
      return (["x", "y", "z"] as const).some((depthAxis) => {
        const aPattern = getCylindricalCenterPatternForAxis(a, depthAxis);
        const bPattern = getCylindricalCenterPatternForAxis(b, depthAxis);
        return aPattern.length > 0 &&
          aPattern.length === bPattern.length &&
          aPattern.every((key, index) => key === bPattern[index]);
      });
    };

    const hasCompatiblePositionAssociation = (
      first: ParsedStepTolerance,
      second: ParsedStepTolerance
    ): boolean => {
      const positionIdsFor = (tolerance: ParsedStepTolerance) => {
        const targetIds = new Set(tolerance.targetIds || []);
        if (targetIds.size === 0) return new Set<string>();
        return new Set(
          parsedTolerances
            .filter((candidate) =>
              (candidate.type === "Position" || candidate.symbol === "POS") &&
              (candidate.targetIds || []).some((targetId) => targetIds.has(targetId))
            )
            .map((candidate) => candidate.id)
        );
      };

      const firstPositionIds = positionIdsFor(first);
      const secondPositionIds = positionIdsFor(second);
      return firstPositionIds.size === 0 ||
        secondPositionIds.size === 0 ||
        [...firstPositionIds].some((id) => secondPositionIds.has(id));
    };

    const canMergeCounterborePilotHole = (
      counterboreTolerance: ParsedStepTolerance,
      pilotTolerance: ParsedStepTolerance
    ) => {
      const compatibleModifiers =
        !counterboreTolerance.dimensionPreModifier ||
        !pilotTolerance.dimensionPreModifier ||
        counterboreTolerance.dimensionPreModifier === pilotTolerance.dimensionPreModifier;
      // A counterbored feature owns distinct pilot and counterbore cylinder
      // targets. Their matching center pattern, plus the explicit AP242
      // counterbored-hole feature, is the reliable association.
      return compatibleModifiers &&
        sameCylindricalCenterPattern(counterboreTolerance, pilotTolerance);
    };

    const markAsCounterboreDimension = (diameterTolerance: ParsedStepTolerance) => {
      diameterTolerance.isCounterboreDimension = true;
      diameterTolerance.type = "Counterbore Dimensional";
      diameterTolerance.symbol = "CBORE_DIM";
    };

    const mergeCounterboreDepthCandidate = (
      diameterTolerance: ParsedStepTolerance,
      depthTolerance: ParsedStepTolerance
    ) => {
      markAsCounterboreDimension(diameterTolerance);
      diameterTolerance.counterboreDepthNominal = depthTolerance.nominalDimension;
      diameterTolerance.counterboreDepthLowerTolerance = depthTolerance.lowerTolerance;
      diameterTolerance.counterboreDepthUpperTolerance = depthTolerance.upperTolerance;
      diameterTolerance.clinicalContext =
        `Counterbore callout ${diameterTolerance.dimensionPreModifier ? `${diameterTolerance.dimensionPreModifier} ` : ""}` +
        `with diameter ${diameterTolerance.nominalDimension ?? "unknown"} mm and depth ${depthTolerance.nominalDimension ?? "unknown"} mm resolved from AP242 counterbore, diameter, depth, and plus-minus tolerance relationships.`;
    };

    const mergeCounterborePilotHole = (
      counterboreTolerance: ParsedStepTolerance,
      holeTolerance: ParsedStepTolerance
    ) => {
      counterboreTolerance.counterboreHoleTargetIds = uniqueGeometryTargets(holeTolerance.targetIds || []);
      counterboreTolerance.targetIds = uniqueGeometryTargets([
        ...(holeTolerance.targetIds || []),
        ...(counterboreTolerance.targetIds || [])
      ]);
      counterboreTolerance.targetId = counterboreTolerance.targetIds[0] || counterboreTolerance.targetId;
      counterboreTolerance.counterboreHoleNominal = holeTolerance.nominalDimension;
      counterboreTolerance.counterboreHoleLowerTolerance = holeTolerance.lowerTolerance;
      counterboreTolerance.counterboreHoleUpperTolerance = holeTolerance.upperTolerance;
      if (!counterboreTolerance.dimensionPreModifier && holeTolerance.dimensionPreModifier) {
        counterboreTolerance.dimensionPreModifier = holeTolerance.dimensionPreModifier;
      }
      counterboreTolerance.clinicalContext =
        `Counterbore callout ${counterboreTolerance.dimensionPreModifier ? `${counterboreTolerance.dimensionPreModifier} ` : ""}` +
        `with pilot hole diameter ${holeTolerance.nominalDimension ?? "unknown"} mm, counterbore diameter ${counterboreTolerance.nominalDimension ?? "unknown"} mm` +
        `${counterboreTolerance.counterboreDepthNominal !== undefined ? `, and depth ${counterboreTolerance.counterboreDepthNominal} mm` : ""} resolved from AP242 counterbored-hole feature, diameter, depth, and plus-minus tolerance relationships.`;
    };

    const applyCounterboreFeatureSemantics = (dimensionTolerances: ParsedStepTolerance[]): ParsedStepTolerance[] => {
      const consumedDepthIds = new Set<string>();
      const consumedPilotHoleIds = new Set<string>();
      const counterboredFeatureSpecs = getCounterboredFeatureSpecs();

      dimensionTolerances.forEach((tolerance) => {
        if (tolerance.category !== "Dimension" || !tolerance.dimensionEntityId) return;
        const evaluationNote = getCounterboreEvaluationNoteForDimension(tolerance.dimensionEntityId);
        if (evaluationNote) {
          tolerance.counterboreEvaluationNote = evaluationNote;
        }
      });

      counterboredFeatureSpecs.forEach((spec) => {
        const modifier = spec.count && spec.count > 1 ? `${spec.count}X` : undefined;
        const diameterTolerances = dimensionTolerances
          .filter((tolerance) => tolerance.category === "Dimension" && tolerance.dimensionKind === "diameter");
        const counterboreTolerance = diameterTolerances.find((tolerance) =>
          sameNominal(tolerance.nominalDimension, spec.counterboreDiameter)
        );
        const pilotHoleTolerance = counterboreTolerance
          ? diameterTolerances.find((tolerance) =>
            sameNominal(tolerance.nominalDimension, spec.boreDiameter) &&
            canMergeCounterborePilotHole(counterboreTolerance, tolerance)
          )
          : undefined;

        if (pilotHoleTolerance && modifier && !pilotHoleTolerance.dimensionPreModifier && !pilotHoleTolerance.isReferenceDimension) {
          pilotHoleTolerance.dimensionPreModifier = modifier;
        }
        if (counterboreTolerance && !counterboreTolerance.holeDepthFromBoundaryTopology) {
          markAsCounterboreDimension(counterboreTolerance);
          if (spec.evaluationNote) counterboreTolerance.counterboreEvaluationNote = spec.evaluationNote;
          if (modifier && !counterboreTolerance.dimensionPreModifier) counterboreTolerance.dimensionPreModifier = modifier;
          if (pilotHoleTolerance && !counterboreTolerance.counterboreEvaluationNote) {
            mergeCounterborePilotHole(counterboreTolerance, pilotHoleTolerance);
            consumedPilotHoleIds.add(pilotHoleTolerance.id);
          }
        }
      });

      dimensionTolerances
        .filter((tolerance) =>
            tolerance.category === "Dimension" &&
            tolerance.dimensionKind === "diameter" &&
            !tolerance.holeDepthFromBoundaryTopology &&
            (
              tolerance.isCounterboreDimension ||
              hasCounterboreSymbolForDimension(tolerance.dimensionEntityId || "")
          )
        )
        .sort((a, b) => (a.nominalDimension || 0) - (b.nominalDimension || 0))
        .forEach((diameterTolerance) => {
          markAsCounterboreDimension(diameterTolerance);
          if (diameterTolerance.counterboreDepthNominal !== undefined) return;

          const depthCandidate = dimensionTolerances
            .filter((candidate) =>
              candidate.id !== diameterTolerance.id &&
              !consumedDepthIds.has(candidate.id) &&
              candidate.category === "Dimension" &&
              (candidate.dimensionKind === "linear" || candidate.dimensionKind === "size") &&
              typeof candidate.nominalDimension === "number" &&
              typeof diameterTolerance.nominalDimension === "number" &&
              candidate.nominalDimension > 0 &&
              candidate.nominalDimension < diameterTolerance.nominalDimension &&
              (candidate.upperTolerance !== undefined || candidate.lowerTolerance !== undefined)
            )
            .sort((a, b) => (b.nominalDimension || 0) - (a.nominalDimension || 0))[0];

          if (!depthCandidate) return;
          mergeCounterboreDepthCandidate(diameterTolerance, depthCandidate);
          consumedDepthIds.add(depthCandidate.id);
        });

      dimensionTolerances
        .filter((tolerance) =>
          tolerance.category === "Dimension" &&
          tolerance.dimensionKind === "diameter" &&
          tolerance.isCounterboreDimension &&
          !tolerance.counterboreEvaluationNote &&
          tolerance.counterboreHoleNominal === undefined &&
          typeof tolerance.nominalDimension === "number"
        )
        .forEach((counterboreTolerance) => {
          const pilotCandidate = dimensionTolerances
            .filter((candidate) =>
              candidate.id !== counterboreTolerance.id &&
              !consumedPilotHoleIds.has(candidate.id) &&
              candidate.category === "Dimension" &&
              candidate.dimensionKind === "diameter" &&
              !candidate.isCounterboreDimension &&
              typeof candidate.nominalDimension === "number" &&
              candidate.nominalDimension < (counterboreTolerance.nominalDimension || 0) &&
              (!candidate.dimensionPreModifier || !counterboreTolerance.dimensionPreModifier || candidate.dimensionPreModifier === counterboreTolerance.dimensionPreModifier) &&
              canMergeCounterborePilotHole(counterboreTolerance, candidate)
            )
            .sort((a, b) => (b.nominalDimension || 0) - (a.nominalDimension || 0))[0];

          if (!pilotCandidate) return;
          mergeCounterborePilotHole(counterboreTolerance, pilotCandidate);
          consumedPilotHoleIds.add(pilotCandidate.id);
        });

      dimensionTolerances
        .filter((tolerance) =>
          tolerance.category === "Dimension" &&
          (tolerance.dimensionKind === "linear" || tolerance.dimensionKind === "radius" || tolerance.dimensionKind === "size") &&
          !tolerance.isSphericalDimension &&
          tolerance.upperTolerance === undefined &&
          tolerance.lowerTolerance === undefined &&
          dimensionTolerances.some((counterboreTolerance) =>
            counterboreTolerance.isCounterboreDimension &&
            sameNominal(counterboreTolerance.counterboreDepthNominal, tolerance.nominalDimension)
          )
        )
        .forEach((tolerance) => consumedDepthIds.add(tolerance.id));

      dimensionTolerances
        .filter((tolerance) =>
          tolerance.category === "Dimension" &&
          tolerance.isReferenceDimension &&
          (tolerance.dimensionKind === "diameter" || tolerance.dimensionKind === "radius") &&
          (tolerance.targetIds || []).some((targetId) => !!getCircularCurveFeatureKey(targetId))
        )
        .forEach((tolerance) => {
          tolerance.dimensionPreModifier = undefined;
        });

      return dimensionTolerances.filter((tolerance) =>
        !consumedDepthIds.has(tolerance.id) &&
        !consumedPilotHoleIds.has(tolerance.id)
      );
    };

    const plusMinusDimensionIds = new Set<string>();

    for (const [entityId] of entityStatements.entries()) {
      if (!getEntityTypeNames(entityId).some((type) => type === "PLUS_MINUS_TOLERANCE")) continue;

      const refs = getEntityRefs(entityId);
      const toleranceValueId = refs.find((ref) => getEntityTypeNames(ref).some((type) => type === "TOLERANCE_VALUE"));
      const dimensionEntityId = refs.find((ref) =>
        ref !== toleranceValueId &&
        getEntityTypeNames(ref).some((type) => /DIMENSIONAL_LOCATION|ANGULAR_LOCATION|ANGULAR_SIZE|DIMENSIONAL_SIZE/i.test(type))
      );
      if (!toleranceValueId || !dimensionEntityId) continue;
      plusMinusDimensionIds.add(dimensionEntityId);

      const bounds = getToleranceValueBounds(toleranceValueId);
      const absoluteLimit = Math.max(Math.abs(bounds.lower ?? 0), Math.abs(bounds.upper ?? 0));
      const targetIds = resolveDimensionTargets(dimensionEntityId);
      const rawTargetIds = resolveDimensionRawTargets(dimensionEntityId);
      const topologyTargetIds = uniqueGeometryTargets([...targetIds, ...rawTargetIds]);
      const targetId = targetIds[0] || "";
      const dimensionKind = getDimensionKind(dimensionEntityId);
      const sphericalDimension = isSphericalDimension(dimensionEntityId);
      const nominalDimension = getNominalDimensionValue(dimensionEntityId);
      const dimensionValues = getDimensionRepresentationValues(dimensionEntityId);
      const isStatisticalTolerance = /statistical/i.test(dimensionValues.notes.join(" "));
      const isControlledRadiusDimension = dimensionKind === "radius" && /controlled\s+radius/i.test(dimensionValues.notes.join(" "));
      const dimensionPreModifier = getDimensionPreModifier(dimensionEntityId);
      const dimensionShapeAspectIds = getDimensionShapeAspectRefs(dimensionEntityId);
      const validationTexts = getCalloutValidationPresentationTexts(
        getLinkedAnnotationIdsForDimension(dimensionEntityId, dimensionShapeAspectIds)
      );
      const linkedAnnotationIds = getLinkedAnnotationIdsForDimension(dimensionEntityId, dimensionShapeAspectIds);
      const rawPresentationTexts = getBoundedRawPresentationTexts([dimensionEntityId, ...dimensionShapeAspectIds, ...linkedAnnotationIds], 6);
      const semanticPresentationTexts = getDimensionSemanticPresentationTexts(dimensionEntityId);
      const dimensionLimitRange = getDimensionLimitRangeCallout(
        [...validationTexts, ...rawPresentationTexts, ...semanticPresentationTexts],
        dimensionKind
      );
      const dimensionLimitNote = dimensionLimitRange ? getDimensionLimitNote(semanticPresentationTexts) : undefined;
      const hasCountersinkSymbol = [...validationTexts, ...rawPresentationTexts].some(hasCountersinkSymbolText);
      if (
        dimensionKind === "angular" &&
        hasCountersinkSymbol &&
        nominalDimension !== null
      ) {
        pendingCountersinkAngles.push({
          dimensionEntityId,
          dimensionPreModifier,
          nominalDimension,
          lowerTolerance: bounds.lower ?? undefined,
          upperTolerance: bounds.upper ?? undefined,
          targetIds,
          annotationFrames: linkedAnnotationIds
            .map(getAnnotationPlaneFrame)
            .filter((frame): frame is NonNullable<typeof frame> => !!frame?.point)
        });
        continue;
      }
      const depthStyleTexts = validationTexts
        .filter((textValue) => /\\X2\\21A7\\X0\\|depth/i.test(textValue));
      const isDepthStyleLinearDimension =
        (dimensionKind === "linear" || dimensionKind === "size") &&
        nominalDimension !== null &&
        depthStyleTexts.some((textValue) => presentationTextMatchesNominal(textValue, nominalDimension));
      const hasTopologicalHoleDepthTargets =
        dimensionKind === "linear" &&
        nominalDimension !== null &&
        (bounds.upper !== undefined || bounds.lower !== undefined) &&
        getCylindricalOwnerFaceIdsForTargets(topologyTargetIds).length > 0 &&
        hasPlanarOwnerForTargets(topologyTargetIds);
      const threadCallout = isDepthStyleLinearDimension
        && hasThreadPlaneShapeAspect(dimensionShapeAspectIds)
        ? getThreadDesignationForDepthCallout(
            getLinkedAnnotationIdsForDimension(dimensionEntityId, dimensionShapeAspectIds),
            dimensionPreModifier
          )
        : undefined;
      const threadDesignation = threadCallout?.designation;
      const emittedDimensionKind = threadDesignation ? "threadDepth" : dimensionKind;
      const holeDepthDimension =
        (isDepthStyleLinearDimension || hasTopologicalHoleDepthTargets) && !threadDesignation && nominalDimension !== null
          ? {
              dimensionEntityId,
              nominalDimension,
              lowerTolerance: bounds.lower ?? undefined,
              upperTolerance: bounds.upper ?? undefined,
              dimensionPreModifier,
              targetIds: topologyTargetIds,
              targetPoints: topologyTargetIds
                .flatMap((targetId) => getEntityCartesianPoints(targetId, 10))
                .filter((point, index, all) =>
                  all.findIndex((candidate) =>
                    Math.abs(candidate.x - point.x) < 1e-6 &&
                    Math.abs(candidate.y - point.y) < 1e-6 &&
                    Math.abs(candidate.z - point.z) < 1e-6
                  ) === index
                )
                .slice(0, 64),
              annotationPoints: linkedAnnotationIds
                .flatMap((annotationId) => getEntityCartesianPoints(annotationId, 10))
                .filter((point, index, all) =>
                  all.findIndex((candidate) =>
                    Math.abs(candidate.x - point.x) < 1e-6 &&
                    Math.abs(candidate.y - point.y) < 1e-6 &&
                    Math.abs(candidate.z - point.z) < 1e-6
                  ) === index
                )
                .slice(0, 64),
              linkedAnnotationIds,
              hasCounterboreSymbol: isDepthStyleLinearDimension && [...validationTexts, ...rawPresentationTexts].some(hasCounterboreSymbolText),
              allowCounterboreInference: isDepthStyleLinearDimension
            }
          : undefined;
      const duplicateHoleDiameter = holeDepthDimension
        ? findMatchingHoleDiameterForDepth(holeDepthDimension)
        : undefined;
      if (duplicateHoleDiameter) {
        mergeDepthIntoHoleDiameter(duplicateHoleDiameter, holeDepthDimension!);
        continue;
      }
      if (holeDepthDimension && isDepthStyleLinearDimension) {
        pendingHoleDepthDimensions.push(holeDepthDimension);
        continue;
      }
      if (isLinearDimensionSubEntityOfSingleCurvedFace(dimensionKind, targetIds)) {
        continue;
      }
      const unitLabel = dimensionKind === "angular" ? "deg" : "mm";
      const countersinkAngle = dimensionKind === "diameter"
        ? findMatchingCountersinkAngle(dimensionPreModifier, linkedAnnotationIds)
        : undefined;
      const associatedDatumIdentifier = dimensionKind === "angular"
        ? undefined
        : getAssociatedDatumIdentifierForTargets(targetIds);
      const isCircularCurveDimension =
        (dimensionKind === "diameter" || dimensionKind === "radius") &&
        targetIds.some((targetId) => !!getCircularCurveFeatureKey(targetId));
      const targetPoints = targetIds
        .flatMap((targetId) => getEntityCartesianPoints(targetId, 10))
        .filter((point, index, all) =>
          all.findIndex((candidate) =>
            Math.abs(candidate.x - point.x) < 1e-6 &&
            Math.abs(candidate.y - point.y) < 1e-6 &&
            Math.abs(candidate.z - point.z) < 1e-6
          ) === index
        )
        .slice(0, 24);
      const type =
        countersinkAngle ? "Countersink Dimensional" :
        emittedDimensionKind === "threadDepth" ? "Thread Depth" :
        dimensionKind === "angular" ? "Angular Dimensional" :
        dimensionKind === "diameter" && sphericalDimension ? "Spherical Diameter Dimensional" :
        dimensionKind === "diameter" ? "Diameter Dimensional" :
        dimensionKind === "radius" ? "Radius Dimensional" :
        "Linear Dimensional";

      const nextTolerance: ParsedStepTolerance = {
        id: `PMI-DIMTOL-${tolerances.length + 1}`,
        entityId,
        dimensionEntityId,
        dimensionKind: emittedDimensionKind,
        type,
        symbol: countersinkAngle ? "CSINK_DIM" : emittedDimensionKind === "threadDepth" ? "THREAD_DEPTH" : dimensionKind === "angular" ? "ANG_DIM" : dimensionKind === "diameter" ? "DIA_DIM" : "DIM",
        value: absoluteLimit,
        nominalDimension: nominalDimension ?? undefined,
        upperTolerance: bounds.upper ?? undefined,
        lowerTolerance: bounds.lower ?? undefined,
        dimensionLowerLimit: dimensionLimitRange?.lowerLimit,
        dimensionUpperLimit: dimensionLimitRange?.upperLimit,
        dimensionLimitPreModifier: dimensionLimitRange?.preModifier,
        dimensionLimitNote,
        isReferenceDimension: false,
        isStatisticalTolerance,
        isSphericalDimension: sphericalDimension,
        isCircularCurveDimension,
        isControlledRadiusDimension,
        isCountersinkDimension: !!countersinkAngle,
        countersinkAngleNominal: countersinkAngle?.nominalDimension,
        countersinkAngleLowerTolerance: countersinkAngle?.lowerTolerance,
        countersinkAngleUpperTolerance: countersinkAngle?.upperTolerance,
        dimensionPreModifier,
        associatedDatumIdentifier,
        threadDesignation,
        threadCylinderTargetIds: threadCallout?.targetIds,
        targetId,
        targetIds,
        targetSurfaceTypes: targetIds
          .map(getTargetSurfaceType)
          .filter((surfaceType, index, all) => !!surfaceType && all.indexOf(surfaceType) === index),
        targetPoints:
          dimensionKind === "linear" ||
          dimensionKind === "angular" ||
          isCircularCurveDimension
            ? targetPoints
            : undefined,
        targetName: targetId
          ? `Critical ${dimensionKind || "dimension"} target (${targetIds.join(", ")})`
          : `Unresolved critical ${dimensionKind || "dimension"} target`,
        hasToleranceModifiers: false,
        category: "Dimension",
        clinicalContext: dimensionLimitRange
          ? `Critical PMI ${dimensionKind || "dimension"} limit range resolved from AP242 presentation and dimensional characteristic relationships${dimensionLimitNote ? `: ${dimensionLimitNote}.` : "."}`
          : countersinkAngle
          ? `Countersink callout ${dimensionPreModifier ? `${dimensionPreModifier} ` : ""}with diameter ${nominalDimension ?? "unknown"} mm and angle ${countersinkAngle.nominalDimension} deg resolved from AP242 countersink, diameter, angular size, and plus-minus tolerance relationships.`
          : threadDesignation
          ? `Threaded-hole depth callout ${dimensionPreModifier ? `${dimensionPreModifier} ` : ""}${threadDesignation}, usable thread depth ${nominalDimension ?? "unknown"} ${unitLabel} with AP242 plus-minus limits.`
          : `Critical PMI ${dimensionKind || "dimension"} tolerance with ${unitLabel} limits resolved from AP242 PLUS_MINUS_TOLERANCE and TOLERANCE_VALUE relationships.`
      };
      if (nextTolerance.dimensionKind === "diameter") {
        const pendingIndex = pendingHoleDepthDimensions.findIndex((pendingDepth) =>
          (!nextTolerance.dimensionPreModifier || !pendingDepth.dimensionPreModifier || nextTolerance.dimensionPreModifier === pendingDepth.dimensionPreModifier) &&
          (
            shareAny(pendingDepth.linkedAnnotationIds, linkedAnnotationIds) ||
            shareAny(pendingDepth.targetIds, targetIds)
          )
        );
        if (pendingIndex >= 0) {
          mergeDepthIntoHoleDiameter(nextTolerance, pendingHoleDepthDimensions[pendingIndex]);
          pendingHoleDepthDimensions.splice(pendingIndex, 1);
        }
      }
      tolerances.push(nextTolerance);
    }

    for (const [entityId] of entityStatements.entries()) {
      const typeNames = getEntityTypeNames(entityId);
      if (!typeNames.some((type) => /DIMENSIONAL_LOCATION|ANGULAR_LOCATION|ANGULAR_SIZE|DIMENSIONAL_SIZE/i.test(type))) continue;
      if (plusMinusDimensionIds.has(entityId)) continue;

      const dimensionShapeAspectIds = getDimensionShapeAspectRefs(entityId);
      const linkedAnnotationIds = getLinkedAnnotationIdsForDimension(entityId, dimensionShapeAspectIds);
      if (hasOnlyInvisibleDimensionPresentations(linkedAnnotationIds)) continue;

      const targetIds = resolveDimensionTargets(entityId);
      if (targetIds.length === 0) continue;
      const dimensionKind = getDimensionKind(entityId);
      const sphericalDimension = isSphericalDimension(entityId);
      const dimensionValues = getDimensionRepresentationValues(entityId);
      const nominalDimension = dimensionValues.nominal;
      if (nominalDimension === null) continue;
      const lowerTolerance =
        dimensionValues.lowerLimit !== null
          ? dimensionValues.lowerLimit - nominalDimension
          : undefined;
      const upperTolerance =
        dimensionValues.upperLimit !== null
          ? dimensionValues.upperLimit - nominalDimension
          : undefined;

      const targetSurfaceTypes = targetIds
        .map(getTargetSurfaceType)
        .filter((surfaceType, index, all) => !!surfaceType && all.indexOf(surfaceType) === index);
      const targetPoints = targetIds
        .flatMap((targetId) => getEntityCartesianPoints(targetId, 10))
        .filter((point, index, all) =>
          all.findIndex((candidate) =>
            Math.abs(candidate.x - point.x) < 1e-6 &&
            Math.abs(candidate.y - point.y) < 1e-6 &&
            Math.abs(candidate.z - point.z) < 1e-6
          ) === index
        )
        .slice(0, 24);
      const dimensionNoteText = dimensionValues.notes.join(" ");
      const isBasicDimension = /theoretical|basic/i.test(dimensionNoteText);
      const isStatisticalTolerance = /statistical/i.test(dimensionNoteText);
      const isControlledRadiusDimension = dimensionKind === "radius" && /controlled\s+radius/i.test(dimensionNoteText);
      const semanticPresentationTexts = getDimensionSemanticPresentationTexts(entityId);
      const dimensionLimitRange = getDimensionLimitRangeCallout(semanticPresentationTexts, dimensionKind);
      const dimensionLimitNote = dimensionLimitRange ? getDimensionLimitNote(semanticPresentationTexts) : undefined;
      const datumTargetLengthScale = getDefaultLengthScaleToMillimeters();
      let datumTargetDimensionPoints: { x: number; y: number; z: number }[] = [];
      const isDatumTargetDimension = isBasicDimension && [sfaSemanticDatumTargets, parsedDatumTargets]
        .flat()
        .some((datumTarget) => {
          const zone = datumTarget.targetZone;
          if (!zone || nominalDimension === null) return false;
          const scaledNominal = nominalDimension * datumTargetLengthScale;
          const matchesWidth = Number.isFinite(zone.width) &&
            Math.abs(zone.width - scaledNominal) <= Math.max(Math.abs(zone.width) * 1e-6, 1e-6);
          const matchesLength = Number.isFinite(zone.length) &&
            Math.abs(zone.length - scaledNominal) <= Math.max(Math.abs(zone.length) * 1e-6, 1e-6);
          if (!matchesWidth && !matchesLength) return false;

          const axis = matchesWidth ? zone.xDirection : zone.yDirection;
          const distance = matchesWidth ? zone.width : zone.length;
          datumTargetDimensionPoints = [
            {
              x: zone.center.x - axis.x * distance / 2,
              y: zone.center.y - axis.y * distance / 2,
              z: zone.center.z - axis.z * distance / 2
            },
            {
              x: zone.center.x + axis.x * distance / 2,
              y: zone.center.y + axis.y * distance / 2,
              z: zone.center.z + axis.z * distance / 2
            }
          ];
          return true;
        });
      const shouldEmitBareDimension =
        isDatumTargetDimension ||
        isBasicDimension ||
        dimensionKind === "angular" ||
        (dimensionKind === "linear" && targetPoints.length >= 2) ||
        ((dimensionKind === "diameter" || dimensionKind === "radius") && targetPoints.length >= 2) ||
        targetSurfaceTypes.some((surfaceType) => /plane|cylinder|curved/i.test(surfaceType));
      if (!shouldEmitBareDimension) continue;
      if (isLinearDimensionSubEntityOfSingleCurvedFace(dimensionKind, targetIds, isDatumTargetDimension)) continue;
      const isReferenceDimension =
        !isBasicDimension &&
        (lowerTolerance === undefined && upperTolerance === undefined || /auxiliary|reference/i.test(dimensionNoteText));
      const dimensionPreModifier = getDimensionPreModifier(entityId);
      const associatedDatumIdentifier = dimensionKind === "angular"
        ? undefined
        : getAssociatedDatumIdentifierForTargets(targetIds);
      const isCircularCurveDimension =
        (dimensionKind === "diameter" || dimensionKind === "radius") &&
        targetIds.some((targetId) => !!getCircularCurveFeatureKey(targetId));

      const targetId = targetIds[0] || "";
      const unitLabel = dimensionKind === "angular" ? "deg" : "mm";
      const type =
        dimensionKind === "angular" ? "Angular Dimensional" :
        dimensionKind === "diameter" && sphericalDimension ? "Spherical Diameter Dimensional" :
        dimensionKind === "diameter" ? "Diameter Dimensional" :
        dimensionKind === "radius" ? "Radius Dimensional" :
        "Linear Dimensional";

      tolerances.push({
        id: `PMI-DIMTOL-${tolerances.length + 1}`,
        entityId,
        dimensionEntityId: entityId,
        dimensionKind,
        type,
        symbol: dimensionKind === "angular" ? "ANG_DIM" : dimensionKind === "diameter" ? "DIA_DIM" : "DIM",
        value: Math.max(Math.abs(lowerTolerance ?? 0), Math.abs(upperTolerance ?? 0)),
        nominalDimension,
        lowerTolerance,
        upperTolerance,
        dimensionLowerLimit: dimensionLimitRange?.lowerLimit,
        dimensionUpperLimit: dimensionLimitRange?.upperLimit,
        dimensionLimitPreModifier: dimensionLimitRange?.preModifier,
        dimensionLimitNote,
        isReferenceDimension,
        isBasicDimension,
        isStatisticalTolerance,
        isDatumTargetDimension,
        isSphericalDimension: sphericalDimension,
        isCircularCurveDimension,
        isControlledRadiusDimension,
        associatedDatumIdentifier,
        dimensionPreModifier,
        targetId,
        targetIds,
        targetSurfaceTypes,
        targetPoints: isDatumTargetDimension && datumTargetDimensionPoints.length >= 2 ? datumTargetDimensionPoints : targetPoints,
        targetName: targetId
          ? `Critical ${dimensionKind || "dimension"} target (${targetIds.join(", ")})`
          : `Unresolved critical ${dimensionKind || "dimension"} target`,
        hasToleranceModifiers: false,
        category: "Dimension",
        clinicalContext: dimensionLimitRange
          ? `Critical PMI ${dimensionKind || "dimension"} limit range resolved from AP242 presentation and dimensional characteristic relationships${dimensionLimitNote ? `: ${dimensionLimitNote}.` : "."}`
          : isBasicDimension
          ? `Basic PMI ${dimensionKind || "dimension"} annotation with nominal ${unitLabel} value resolved from AP242 theoretical dimensional note.`
          : lowerTolerance !== undefined || upperTolerance !== undefined
          ? `Critical PMI ${dimensionKind || "dimension"} tolerance with ${unitLabel} LSL/USL limits resolved from AP242 dimensional characteristic representation.`
          : `Reference PMI ${dimensionKind || "dimension"} annotation with nominal ${unitLabel} value resolved from AP242 dimensional characteristic representation.`
      });
    }

    const getDimensionAxialSurfaceSites = (
      tolerance: ParsedStepTolerance,
      surfaceTypePattern: RegExp
    ): string[] => uniqueGeometryTargets(tolerance.targetIds || [])
      .flatMap((targetId) => {
        const surfaceId = getPrimarySurfaceIdForTarget(targetId);
        if (!surfaceId || !surfaceTypePattern.test(getEntityType(surfaceId))) return [];
        const placementId = getEntityRefs(surfaceId)
          .find((ref) => getEntityType(ref) === "AXIS2_PLACEMENT_3D");
        const placementRefs = placementId ? getEntityRefs(placementId) : [];
        const point = placementRefs[0] ? getCartesianPoint(placementRefs[0]) : null;
        const axis = placementRefs[1] ? getDirection(placementRefs[1]) : null;
        const key = getAxisLineKey(point, axis);
        return key === "unknown" ? [] : [key];
      })
      .filter((key, index, all) => all.indexOf(key) === index)
      .sort();

    const sameStringSet = (a: string[], b: string[]) =>
      a.length === b.length && a.every((value, index) => value === b[index]);

    const areAxiallyPairedChamferDimensions = (
      first: ParsedStepTolerance,
      second: ParsedStepTolerance
    ) => {
      // Only merge if one is on conical surface and other is on cylindrical surface (chamfer case)
      // Do NOT merge radial (diameter/radius) with linear measurements on the same face
      const firstConeSites = getDimensionAxialSurfaceSites(first, /^CONICAL_SURFACE$/i);
      const secondConeSites = getDimensionAxialSurfaceSites(second, /^CONICAL_SURFACE$/i);
      const firstCylinderSites = getDimensionAxialSurfaceSites(first, /^CYLINDRICAL_SURFACE$/i);
      const secondCylinderSites = getDimensionAxialSurfaceSites(second, /^CYLINDRICAL_SURFACE$/i);
      return (
        firstConeSites.length > 0 &&
        secondCylinderSites.length > 0 &&
        sameStringSet(firstConeSites, secondCylinderSites)
      ) || (
        secondConeSites.length > 0 &&
        firstCylinderSites.length > 0 &&
        sameStringSet(secondConeSites, firstCylinderSites)
      );
    };

    const consumedCompoundDimensionIds = new Set<string>();
    tolerances.forEach((tolerance, index) => {
      // Skip merging for radial dimensions (diameter/radius) vs linear dimensions
      // These represent different measurements even if they share the same face
      const isRadialDimension = /diameter|radius/i.test(tolerance.dimensionKind || "");
      if (
        !["linear", "size"].includes(tolerance.dimensionKind || "") ||
        tolerance.isReferenceDimension ||
        tolerance.isBasicDimension ||
        tolerance.isDatumTargetDimension ||
        tolerance.associatedDatumIdentifier ||
        tolerance.nominalDimension === undefined ||
        tolerance.lowerTolerance === undefined ||
        tolerance.upperTolerance === undefined
      ) {
        return;
      }

      const targetKey = [...(tolerance.targetIds || [])].sort().join("|");
      if (!targetKey) return;
      const matches = tolerances.slice(index + 1).filter((candidate) => {
        // Skip merging if one is radial (diameter/radius) and the other is linear
        const candidateIsRadial = /diameter|radius/i.test(candidate.dimensionKind || "");
        if (isRadialDimension && candidate.dimensionKind === "linear") return false;
        if (candidateIsRadial && tolerance.dimensionKind === "linear") return false;
        
        // Additional check: don't merge if both are radial/diameter but have different surface types
        // This handles the case where one is radial (cylinder/conical) and another is linear (plane)
        const toleranceSurfaceTypes = tolerance.targetSurfaceTypes || [];
        const candidateSurfaceTypes = candidate.targetSurfaceTypes || [];
        const toleranceHasPlane = toleranceSurfaceTypes.some(t => /plane/i.test(t));
        const candidateHasPlane = candidateSurfaceTypes.some(t => /plane/i.test(t));
        const toleranceHasCurved = toleranceSurfaceTypes.some(t => /cylinder|conical|curved/i.test(t));
        const candidateHasCurved = candidateSurfaceTypes.some(t => /cylinder|conical|curved/i.test(t));
        // Don't merge radial (curved) with linear (plane) on the same face - they represent different measurements
        if ((isRadialDimension && candidateHasPlane) || (candidateIsRadial && toleranceHasPlane)) return false;
        // Don't merge two radial dimensions on the same face with different surface types
        if (isRadialDimension && candidateIsRadial && toleranceHasPlane !== candidateHasPlane) return false;
        
        // Don't merge radial and linear dimensions on the SAME face (same targetIds)
        // This handles the case where one tolerance is radial (diameter/radius on cylinder) 
        // and another is linear (point-to-point diametral line) on the same face
        if (isRadialDimension !== candidateIsRadial) {
          const toleranceTargetIds = new Set((tolerance.targetIds || []).sort());
          const candidateTargetIds = new Set((candidate.targetIds || []).sort());
          if (toleranceTargetIds.size === candidateTargetIds.size && 
              toleranceTargetIds.size > 0 &&
              [...toleranceTargetIds].every(id => candidateTargetIds.has(id))) {
            // Same target face, but one is radial and one is linear - keep them separate
            return false;
          }
        }
        
        return (
          ["linear", "size"].includes(candidate.dimensionKind || "") &&
          !candidate.isReferenceDimension &&
          !candidate.isBasicDimension &&
          !candidate.isDatumTargetDimension &&
          !candidate.associatedDatumIdentifier &&
          sameNominal(candidate.nominalDimension, tolerance.nominalDimension) &&
          sameNominal(candidate.lowerTolerance, tolerance.lowerTolerance) &&
          sameNominal(candidate.upperTolerance, tolerance.upperTolerance) &&
          (
            (
              tolerance.dimensionKind === "linear" &&
              candidate.dimensionKind === "linear" &&
              [...(candidate.targetIds || [])].sort().join("|") === targetKey
            ) ||
            areAxiallyPairedChamferDimensions(tolerance, candidate)
          )
        );
      });
      if (matches.length !== 1) return;

      const secondary = matches[0];
      const conicalTargets = [tolerance, secondary]
        .flatMap((dimension) => uniqueGeometryTargets(dimension.targetIds || []))
        .filter((targetId) => {
          const surfaceId = getPrimarySurfaceIdForTarget(targetId);
          return !!surfaceId && getEntityType(surfaceId) === "CONICAL_SURFACE";
        })
        .filter((targetId, targetIndex, all) => all.indexOf(targetId) === targetIndex);
      const conicalDimension = [tolerance, secondary].find((dimension) =>
        getDimensionAxialSurfaceSites(dimension, /^CONICAL_SURFACE$/i).length > 0
      );
      tolerance.dimensionKind = "chamfer";
      tolerance.type = "Chamfer Dimensional";
      tolerance.symbol = "CHAMFER_DIM";
      tolerance.secondaryDimensionEntityId = secondary.dimensionEntityId;
      tolerance.secondaryNominalDimension = secondary.nominalDimension;
      tolerance.secondaryLowerTolerance = secondary.lowerTolerance;
      tolerance.secondaryUpperTolerance = secondary.upperTolerance;
      tolerance.dimensionPreModifier = conicalTargets.length > 0
        ? conicalDimension?.dimensionPreModifier ||
          tolerance.dimensionPreModifier ||
          secondary.dimensionPreModifier
        : tolerance.dimensionPreModifier || secondary.dimensionPreModifier;
      if (conicalTargets.length > 0) {
        tolerance.targetId = conicalTargets[0];
        tolerance.targetIds = conicalTargets;
        tolerance.targetSurfaceTypes = ["curved"];
        tolerance.targetPoints = conicalTargets
          .flatMap((targetId) => getEntityCartesianPoints(targetId, 10))
          .filter((point, pointIndex, all) =>
            all.findIndex((candidate) =>
              Math.abs(candidate.x - point.x) < 1e-6 &&
              Math.abs(candidate.y - point.y) < 1e-6 &&
              Math.abs(candidate.z - point.z) < 1e-6
            ) === pointIndex
          )
          .slice(0, 24);
        tolerance.targetName = `Critical chamfer target (${conicalTargets.join(", ")})`;
      }
      tolerance.clinicalContext =
        conicalTargets.length > 0
          ? "Compound chamfer PMI resolved from paired AP242 size dimensions on coaxial cylindrical and conical feature targets."
          : "Compound chamfer PMI resolved from paired AP242 linear dimensions with identical targets and limits.";
      consumedCompoundDimensionIds.add(secondary.id);
    });

    const compoundTolerances = tolerances.filter((tolerance) => !consumedCompoundDimensionIds.has(tolerance.id));
    compoundTolerances.push(...buildSemanticRadiusCountDimensions(compoundTolerances));
    const visibleCompoundTolerances = compoundTolerances.filter((tolerance) => !tolerance.suppressStandaloneDimension);
    const circularSizeTolerances = visibleCompoundTolerances.filter((tolerance) =>
      /diameter|radius/i.test(`${tolerance.dimensionKind || ""}`) &&
      typeof tolerance.nominalDimension === "number" &&
      Number.isFinite(tolerance.nominalDimension)
    );

    const resolvedSimpleHoleDepths = visibleCompoundTolerances.filter((tolerance) =>
      tolerance.dimensionKind === "diameter" &&
      tolerance.counterboreDepthNominal !== undefined &&
      tolerance.holeDepthFromBoundaryTopology &&
      !tolerance.isCounterboreDimension &&
      !tolerance.isCountersinkDimension &&
      !tolerance.threadDesignation &&
      (tolerance.targetSurfaceTypes || []).includes("cylinder")
    );
    if (resolvedSimpleHoleDepths.length > 0) {
      visibleCompoundTolerances.forEach((tolerance) => {
        if (
          tolerance.dimensionKind !== "diameter" ||
          tolerance.counterboreDepthNominal !== undefined ||
          tolerance.isCounterboreDimension ||
          tolerance.isCountersinkDimension ||
          tolerance.threadDesignation ||
          !(tolerance.targetSurfaceTypes || []).includes("cylinder")
        ) {
          return;
        }

        const sourceDepth = resolvedSimpleHoleDepths.find((source) =>
          sameNominal(source.nominalDimension, tolerance.nominalDimension) &&
          sameNominal(source.upperTolerance, tolerance.upperTolerance, 0.0005)
        );
        if (!sourceDepth) return;
        tolerance.counterboreDepthNominal = sourceDepth.counterboreDepthNominal;
        tolerance.counterboreDepthLowerTolerance = sourceDepth.counterboreDepthLowerTolerance;
        tolerance.counterboreDepthUpperTolerance = sourceDepth.counterboreDepthUpperTolerance;
        tolerance.holeDepthFromBoundaryTopology = true;
        tolerance.clinicalContext =
          `Hole callout ${tolerance.dimensionPreModifier ? `${tolerance.dimensionPreModifier} ` : ""}` +
          `with diameter ${tolerance.nominalDimension ?? "unknown"} mm and depth ${sourceDepth.counterboreDepthNominal} mm resolved from matching AP242 simple-hole diameter and depth tolerance families.`;
      });
    }

    const filteredTolerances = visibleCompoundTolerances.filter((tolerance) => {
      if (
        tolerance.dimensionKind !== "linear" ||
        tolerance.isBasicDimension ||
        tolerance.isDatumTargetDimension ||
        tolerance.associatedDatumIdentifier ||
        typeof tolerance.nominalDimension !== "number" ||
        !Number.isFinite(tolerance.nominalDimension)
      ) {
        return true;
      }

      return !circularSizeTolerances.some((circularTolerance) => {
        if (Math.abs((circularTolerance.nominalDimension || 0) - tolerance.nominalDimension!) >= 0.001) return false;
        const linearTargets = tolerance.targetIds || [];
        const circularTargets = circularTolerance.targetIds || [];
        if (shareAny(linearTargets, circularTargets)) return true;

        const linearOwners = linearTargets.flatMap(getOwningFaceIdsForTarget);
        const circularOwners = circularTargets.flatMap(getOwningFaceIdsForTarget);
        return linearOwners.length > 0 && circularOwners.length > 0 && shareAny(linearOwners, circularOwners);
      });
    });

    const presentationDimensionKeys = new Set<string>();
    const deduplicatedTolerances = filteredTolerances.filter((tolerance) => {
      if (!tolerance.isBasicDimension && !tolerance.isReferenceDimension) return true;
      const points = tolerance.targetPoints || [];
      if (points.length < 2) return true;
      const pointKey = points
        .map((point) => `${point.x.toFixed(5)},${point.y.toFixed(5)},${point.z.toFixed(5)}`)
        .sort()
        .join("|");
      const key = [
        tolerance.dimensionKind,
        tolerance.nominalDimension?.toFixed(5),
        tolerance.lowerTolerance?.toFixed(5),
        tolerance.upperTolerance?.toFixed(5),
        tolerance.dimensionPreModifier || "",
        tolerance.isBasicDimension ? "basic" : "reference",
        pointKey
      ].join(";");
      if (presentationDimensionKeys.has(key)) return false;
      presentationDimensionKeys.add(key);
      return true;
    });

    return applyCounterboreFeatureSemantics(deduplicatedTolerances);
  };

  const buildDatumReferenceFrames = (datums: ParsedStepDatum[]): ParsedStepDatumReferenceFrame[] => {
    const datumByEntityId = new Map(datums.map((datum) => [datum.entityId, datum]));
    const datumByIdentifier = new Map(datums.map((datum) => [datum.identifier, datum]));
    const frames: ParsedStepDatumReferenceFrame[] = [];

    const buildFrameBasis = (references: ParsedStepDatumReference[]): ParsedStepFrameBasis | undefined => {
      const sortedReferences = [...references].sort((a, b) => a.precedence - b.precedence);
      const points = sortedReferences
        .flatMap((reference) => (reference.surfaceGeometry || [])
          .map((geometry) => geometry.point)
          .filter((point): point is { x: number; y: number; z: number } => !!point));

      const datumTargetPointsByIdentifier = new Map<string, Array<{ x: number; y: number; z: number }>>();
      const datumTargetsByIdentifier = new Map<string, ParsedStepDatumTarget[]>();
      for (const target of parsedDatumTargets) {
        const parentDatum = target.parentDatum;
        if (!parentDatum) continue;
        const existing = datumTargetPointsByIdentifier.get(parentDatum) || [];
        if (target.targetPoint) existing.push(target.targetPoint);
        datumTargetPointsByIdentifier.set(parentDatum, existing);

        const existingTargets = datumTargetsByIdentifier.get(parentDatum) || [];
        existingTargets.push(target);
        datumTargetsByIdentifier.set(parentDatum, existingTargets);
      }

      const chooseAxis = (candidates: Array<{ x: number; y: number; z: number } | null | undefined>) => {
        for (const candidate of candidates) {
          const normalized = normalizeVector(candidate);
          if (normalized) return normalized;
        }
        return null;
      };

      const pickPoint = (reference?: ParsedStepDatumReference) => {
        const geometry = reference?.surfaceGeometry?.find((candidate) => !!candidate.point);
        return geometry?.point || null;
      };

      const buildPlaneFromReference = (reference?: ParsedStepDatumReference) => {
        const planarGeometries = (reference?.surfaceGeometry || [])
          .filter((candidate) => candidate.surfaceType === "plane" && !!candidate.point && !!candidate.normal);
        if (planarGeometries.length >= 2) {
          const firstNormal = normalizeVector(planarGeometries[0].normal);
          const parallelPlanes = !!firstNormal && planarGeometries.every((geometry) => {
            const normal = normalizeVector(geometry.normal);
            return !!normal && Math.abs(dotVector(normal, firstNormal)) > 0.985;
          });
          if (firstNormal && parallelPlanes) {
            const signedOffsets = planarGeometries
              .map((geometry) => geometry.point ? dotVector(geometry.point, firstNormal) : null)
              .filter((offset): offset is number => Number.isFinite(offset as number));
            if (signedOffsets.length >= 2) {
              const minOffset = Math.min(...signedOffsets);
              const maxOffset = Math.max(...signedOffsets);
              if (Math.abs(maxOffset - minOffset) > 1e-6) {
                const centerOffset = (minOffset + maxOffset) / 2;
                const seedPoint = planarGeometries[0].point!;
                const seedOffset = dotVector(seedPoint, firstNormal);
                return {
                  point: {
                    x: seedPoint.x + firstNormal.x * (centerOffset - seedOffset),
                    y: seedPoint.y + firstNormal.y * (centerOffset - seedOffset),
                    z: seedPoint.z + firstNormal.z * (centerOffset - seedOffset),
                  },
                  normal: firstNormal
                };
              }
            }
          }
        }

        const geometry = reference?.surfaceGeometry?.find((candidate) => !!candidate.point && !!candidate.normal);
        if (geometry?.point && geometry.normal) {
          const point = geometry.point;
          const normal = normalizeVector(geometry.normal);
          if (normal) return { point, normal };
        }

        const targetGeometryPoints = (reference?.surfaceGeometry || [])
          .map((candidate) => candidate.point)
          .filter((point): point is { x: number; y: number; z: number } => !!point)
          .filter((point, index, all) => all.findIndex((candidate) =>
            Math.abs(candidate.x - point.x) < 1e-8 &&
            Math.abs(candidate.y - point.y) < 1e-8 &&
            Math.abs(candidate.z - point.z) < 1e-8
          ) === index);
        if (targetGeometryPoints.length === 2) {
          const first = targetGeometryPoints[0];
          const second = targetGeometryPoints[1];
          const normal = normalizeVector({
            x: second.x - first.x,
            y: second.y - first.y,
            z: second.z - first.z,
          });
          if (normal) {
            return {
              point: {
                x: (first.x + second.x) / 2,
                y: (first.y + second.y) / 2,
                z: (first.z + second.z) / 2,
              },
              normal
            };
          }
        }

        const targetPoints = (reference?.datumIdentifier ? datumTargetPointsByIdentifier.get(reference.datumIdentifier) : []) || [];
        if (targetPoints.length >= 3) {
          const centroid = pointCentroid(targetPoints);
          if (!centroid) return null;
          const first = targetPoints[0];
          const second = targetPoints[1];
          const third = targetPoints[2];
          const a = { x: first.x - centroid.x, y: first.y - centroid.y, z: first.z - centroid.z };
          const b = { x: second.x - centroid.x, y: second.y - centroid.y, z: second.z - centroid.z };
          const c = { x: third.x - centroid.x, y: third.y - centroid.y, z: third.z - centroid.z };
          const normal = normalizeVector(crossVector(crossVector(a, b), c));
          if (normal) {
            if (targetPoints.length >= 4) {
              const distances = targetPoints.map((point) => dotVector({ x: point.x - centroid.x, y: point.y - centroid.y, z: point.z - centroid.z }, normal));
              const sortedDistances = [...distances].sort((a, b) => a - b);
              const gap = sortedDistances[sortedDistances.length - 1] - sortedDistances[0];
              if (gap > 1e-4) {
                const midpoint = (sortedDistances[0] + sortedDistances[sortedDistances.length - 1]) / 2;
                const positivePoints = targetPoints.filter((point) => dotVector({ x: point.x - centroid.x, y: point.y - centroid.y, z: point.z - centroid.z }, normal) >= midpoint);
                const negativePoints = targetPoints.filter((point) => dotVector({ x: point.x - centroid.x, y: point.y - centroid.y, z: point.z - centroid.z }, normal) < midpoint);
                if (positivePoints.length > 0 && negativePoints.length > 0) {
                  const positiveCentroid = pointCentroid(positivePoints);
                  const negativeCentroid = pointCentroid(negativePoints);
                  if (positiveCentroid && negativeCentroid) {
                    const planePoint = {
                      x: (positiveCentroid.x + negativeCentroid.x) / 2,
                      y: (positiveCentroid.y + negativeCentroid.y) / 2,
                      z: (positiveCentroid.z + negativeCentroid.z) / 2,
                    };
                    return { point: planePoint, normal };
                  }
                }
              }
            }
            return { point: centroid, normal };
          }
        }

        return null;
      };

      const projectPointOntoLine = (point: { x: number; y: number; z: number }, linePoint: { x: number; y: number; z: number }, lineDirection: { x: number; y: number; z: number }) => {
        const direction = normalizeVector(lineDirection);
        if (!direction) return point;
        const delta = { x: point.x - linePoint.x, y: point.y - linePoint.y, z: point.z - linePoint.z };
        const t = dotVector(delta, direction);
        return {
          x: linePoint.x + direction.x * t,
          y: linePoint.y + direction.y * t,
          z: linePoint.z + direction.z * t,
        };
      };

      const intersectAxisWithPlane = (
        axisPoint: { x: number; y: number; z: number },
        axisDirection: { x: number; y: number; z: number },
        planePoint: { x: number; y: number; z: number },
        planeNormal: { x: number; y: number; z: number }
      ) => {
        const direction = normalizeVector(axisDirection);
        const normal = normalizeVector(planeNormal);
        if (!direction || !normal) return null;
        const denominator = dotVector(direction, normal);
        const delta = { x: planePoint.x - axisPoint.x, y: planePoint.y - axisPoint.y, z: planePoint.z - axisPoint.z };
        if (Math.abs(denominator) > 1e-10) {
          const t = dotVector(delta, normal) / denominator;
          return {
            x: axisPoint.x + direction.x * t,
            y: axisPoint.y + direction.y * t,
            z: axisPoint.z + direction.z * t
          };
        }
        const offset = dotVector(delta, normal);
        return {
          x: axisPoint.x + normal.x * offset,
          y: axisPoint.y + normal.y * offset,
          z: axisPoint.z + normal.z * offset
        };
      };

      const intersectThreePlanes = (
        first: { point: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number } },
        second: { point: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number } },
        third: { point: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number } }
      ) => {
        const n1 = normalizeVector(first.normal);
        const n2 = normalizeVector(second.normal);
        const n3 = normalizeVector(third.normal);
        if (!n1 || !n2 || !n3) return null;
        const n2xn3 = crossVector(n2, n3);
        const n3xn1 = crossVector(n3, n1);
        const n1xn2 = crossVector(n1, n2);
        const denominator = dotVector(n1, n2xn3);
        if (Math.abs(denominator) <= 1e-10) return null;
        const d1 = dotVector(n1, first.point);
        const d2 = dotVector(n2, second.point);
        const d3 = dotVector(n3, third.point);
        return {
          x: (n2xn3.x * d1 + n3xn1.x * d2 + n1xn2.x * d3) / denominator,
          y: (n2xn3.y * d1 + n3xn1.y * d2 + n1xn2.y * d3) / denominator,
          z: (n2xn3.z * d1 + n3xn1.z * d2 + n1xn2.z * d3) / denominator
        };
      };

      const buildAxisFromReference = (reference?: ParsedStepDatumReference) => {
        const geometry = reference?.surfaceGeometry?.find((candidate) => !!candidate.point && !!candidate.axis);
        if (!geometry?.point || !geometry.axis) return null;
        const axis = normalizeVector(geometry.axis);
        return axis ? { point: geometry.point, axis } : null;
      };

      const getDatumTargetPoints = (reference?: ParsedStepDatumReference) => {
        const surfacePoints = (reference?.surfaceGeometry || [])
          .filter((geometry) => geometry.surfaceType === "unknown" && !!geometry.point)
          .map((geometry) => geometry.point!)
          .filter((point, index, all) => all.findIndex((candidate) =>
            Math.abs(candidate.x - point.x) < 1e-8 &&
            Math.abs(candidate.y - point.y) < 1e-8 &&
            Math.abs(candidate.z - point.z) < 1e-8
          ) === index);
        if (surfacePoints.length > 0) return surfacePoints;
        if (!reference?.datumIdentifier) return [];
        const targets = datumTargetsByIdentifier.get(reference.datumIdentifier) || [];
        return targets
          .filter((target) => !!target.targetPoint)
          .sort((a, b) => a.identifier.localeCompare(b.identifier, undefined, { numeric: true }))
          .map((target) => target.targetPoint!)
          .filter((point, index, all) => all.findIndex((candidate) =>
            Math.abs(candidate.x - point.x) < 1e-8 &&
            Math.abs(candidate.y - point.y) < 1e-8 &&
            Math.abs(candidate.z - point.z) < 1e-8
          ) === index);
      };

      const chooseTargetPairDirection = (
        targetPoints: Array<{ x: number; y: number; z: number }>,
        planeNormal: { x: number; y: number; z: number }
      ) => {
        const pairs: Array<{ direction: { x: number; y: number; z: number }; length: number }> = [];
        for (let i = 0; i < targetPoints.length - 1; i++) {
          for (let j = i + 1; j < targetPoints.length; j++) {
            const projected = projectVectorOntoPlane({
              x: targetPoints[j].x - targetPoints[i].x,
              y: targetPoints[j].y - targetPoints[i].y,
              z: targetPoints[j].z - targetPoints[i].z
            }, planeNormal);
            const length = Math.sqrt(projected.x * projected.x + projected.y * projected.y + projected.z * projected.z);
            const direction = normalizeVector(projected);
            if (direction) {
              pairs.push({ direction, length });
            }
          }
        }

        let bestPair: { direction: { x: number; y: number; z: number }; length: number } | null = null;
        let bestSupport = 0;
        for (const pair of pairs) {
          const support = pairs.filter((candidate) => Math.abs(dotVector(pair.direction, candidate.direction)) > 0.985).length;
          if (support > bestSupport || (support === bestSupport && pair.length > (bestPair?.length || 0))) {
            bestPair = pair;
            bestSupport = support;
          }
        }
        return bestPair?.direction || null;
      };

      const primaryReference = sortedReferences[0];
      const secondaryReference = sortedReferences[1];
      const tertiaryReference = sortedReferences[2];
      const primaryGeometry = primaryReference?.surfaceGeometry?.[0];
      const secondaryGeometry = secondaryReference?.surfaceGeometry?.[0];
      const tertiaryGeometry = tertiaryReference?.surfaceGeometry?.find((candidate) => !!candidate.point);

      const primaryPlane = buildPlaneFromReference(primaryReference);
      const secondaryPlane = buildPlaneFromReference(secondaryReference);
      const tertiaryPoint = pickPoint(tertiaryReference) || tertiaryGeometry?.point || null;
      const primaryNormal = normalizeVector(primaryGeometry?.normal || primaryGeometry?.axis || null);
      const primaryAxis = normalizeVector(primaryGeometry?.axis || primaryGeometry?.normal || null);
      const zAxis = chooseAxis([
        primaryPlane?.normal,
        primaryNormal,
        primaryAxis,
        ...sortedReferences.flatMap((reference) => {
          const geometry = reference.surfaceGeometry?.[0];
          return [geometry?.normal, geometry?.axis];
        }),
      ]) || { x: 0, y: 0, z: 1 };

      let origin: { x: number; y: number; z: number } | null = null;
      let xAxis: { x: number; y: number; z: number } | null = null;
      let yAxis: { x: number; y: number; z: number } | null = null;

      const secondaryAxis = buildAxisFromReference(secondaryReference);
      const tertiaryAxis = buildAxisFromReference(tertiaryReference);
      const tertiaryPlane = buildPlaneFromReference(tertiaryReference);

      const primaryTargetPoints = getDatumTargetPoints(primaryReference);
      const secondaryTargetPoints = getDatumTargetPoints(secondaryReference);

      // Case 0: datum reference frame established by datum target sets.
      // Primary targets establish the plane, secondary targets establish the middle plane and X direction,
      // and the tertiary target establishes the third orthogonal locating plane.
      if (primaryPlane && primaryTargetPoints.length >= 3 && secondaryTargetPoints.length >= 2 && tertiaryPoint) {
        const targetXAxis = chooseTargetPairDirection(secondaryTargetPoints, primaryPlane.normal);
        const secondaryCenter = pointCentroid(secondaryTargetPoints);
        if (targetXAxis && secondaryCenter) {
          const targetYAxis = normalizeVector(crossVector(primaryPlane.normal, targetXAxis));
          if (targetYAxis) {
            xAxis = targetXAxis;
            origin = intersectThreePlanes(
              primaryPlane,
              { point: secondaryCenter, normal: targetXAxis },
              { point: tertiaryPoint, normal: targetYAxis }
            );
          }
        }
      }

      // Case 1a: primary plane and secondary cylindrical axis.
      // With no tertiary reference, the secondary axis locates the origin while the
      // primary datum placement retains the otherwise unconstrained in-plane orientation.
      if (!origin && primaryPlane && secondaryAxis && sortedReferences.length === 2) {
        origin = intersectAxisWithPlane(secondaryAxis.point, secondaryAxis.axis, primaryPlane.point, primaryPlane.normal);
        xAxis = primaryGeometry?.xDirection
          ? normalizeVector(projectVectorOntoPlane(primaryGeometry.xDirection, primaryPlane.normal))
          : null;
      }

      // Case 1: primary plane, secondary cylindrical axis, tertiary cylindrical axis.
      if (!origin && primaryPlane && secondaryAxis && tertiaryAxis) {
        origin = intersectAxisWithPlane(secondaryAxis.point, secondaryAxis.axis, primaryPlane.point, primaryPlane.normal);
        const tertiaryIntersection = intersectAxisWithPlane(tertiaryAxis.point, tertiaryAxis.axis, primaryPlane.point, primaryPlane.normal);
        if (origin && tertiaryIntersection) {
          const primaryPlacementXAxis = primaryGeometry?.xDirection
            ? normalizeVector(projectVectorOntoPlane(primaryGeometry.xDirection, primaryPlane.normal))
            : null;
          const placementXDirections = [primaryGeometry, secondaryGeometry, tertiaryGeometry]
            .map((geometry) => geometry?.xDirection
              ? normalizeVector(projectVectorOntoPlane(geometry.xDirection, primaryPlane.normal))
              : null)
            .filter((direction): direction is { x: number; y: number; z: number } => !!direction);
          const hasCoherentPlacementXAxis = !!primaryPlacementXAxis &&
            placementXDirections.length >= 3 &&
            placementXDirections.every((direction) => Math.abs(dotVector(direction, primaryPlacementXAxis)) > 0.985);
          xAxis = (hasCoherentPlacementXAxis ? primaryPlacementXAxis : null) || normalizeVector(projectVectorOntoPlane({
            x: tertiaryIntersection.x - origin.x,
            y: tertiaryIntersection.y - origin.y,
            z: tertiaryIntersection.z - origin.z
          }, primaryPlane.normal));
        }
      }

      // Case 2: three datum planes. X follows the secondary plane normal projected into the primary plane.
      if (!origin && primaryPlane && secondaryPlane && tertiaryPlane) {
        origin = intersectThreePlanes(primaryPlane, secondaryPlane, tertiaryPlane);
        xAxis = normalizeVector(projectVectorOntoPlane(secondaryPlane.normal, primaryPlane.normal));
      }

      // Case 2 fallback: two planes plus a target/middle point, project the point to the plane intersection.
      if (!origin && primaryPlane && secondaryPlane && tertiaryPoint) {
        const lineDirection = normalizeVector(crossVector(primaryPlane.normal, secondaryPlane.normal));
        if (lineDirection) {
          const w = normalizeVector(crossVector(primaryPlane.normal, lineDirection));
          if (w) {
            const scalar = dotVector({ x: secondaryPlane.point.x - primaryPlane.point.x, y: secondaryPlane.point.y - primaryPlane.point.y, z: secondaryPlane.point.z - primaryPlane.point.z }, secondaryPlane.normal) / dotVector(w, secondaryPlane.normal);
            const linePoint = {
              x: primaryPlane.point.x + w.x * scalar,
              y: primaryPlane.point.y + w.y * scalar,
              z: primaryPlane.point.z + w.z * scalar,
            };
            origin = projectPointOntoLine(tertiaryPoint, linePoint, lineDirection);
            const vectorToTertiary = {
              x: tertiaryPoint.x - origin.x,
              y: tertiaryPoint.y - origin.y,
              z: tertiaryPoint.z - origin.z,
            };
            xAxis = normalizeVector(projectVectorOntoPlane(vectorToTertiary, primaryPlane.normal)) || lineDirection;
          }
        }
      }

      // Case 3: primary datum plane plus a datum target point. The frame origin lies
      // on the primary plane at the target center projected along the primary normal.
      if (!origin && primaryPlane && sortedReferences.length === 2 && secondaryTargetPoints.length === 1) {
        const targetPoint = secondaryTargetPoints[0];
        const normal = normalizeVector(primaryPlane.normal);
        if (normal) {
          const offset = dotVector({
            x: targetPoint.x - primaryPlane.point.x,
            y: targetPoint.y - primaryPlane.point.y,
            z: targetPoint.z - primaryPlane.point.z,
          }, normal);
          origin = {
            x: targetPoint.x - normal.x * offset,
            y: targetPoint.y - normal.y * offset,
            z: targetPoint.z - normal.z * offset,
          };
          xAxis = normalizeVector(projectVectorOntoPlane(primaryGeometry?.xDirection || { x: 1, y: 0, z: 0 }, normal));
        }
      }

      if (!origin && points.length > 0) {
        origin = pointCentroid(points);
      }
      if (!origin) return undefined;

      const projectedXAxis = (vector: { x: number; y: number; z: number }) => {
        const normalizedZ = normalizeVector(zAxis) || { x: 0, y: 0, z: 1 };
        return projectVectorOntoPlane(vector, normalizedZ);
      };

      const fallbackXAxis = chooseAxis([
        tertiaryGeometry?.xDirection,
        sortedReferences[0]?.surfaceGeometry?.[0]?.xDirection,
        sortedReferences[1]?.surfaceGeometry?.[0]?.xDirection,
        sortedReferences[2]?.surfaceGeometry?.[0]?.xDirection,
      ]);
      const directionToTertiary = tertiaryPoint && origin
        ? {
            x: tertiaryPoint.x - origin.x,
            y: tertiaryPoint.y - origin.y,
            z: tertiaryPoint.z - origin.z,
          }
        : null;
      const normalizedXAxis = normalizeVector(xAxis || projectedXAxis(directionToTertiary || fallbackXAxis || { x: 1, y: 0, z: 0 }))
        || fallbackXAxis
        || { x: 1, y: 0, z: 0 };

      const normalizedZAxis = normalizeVector(zAxis) || { x: 0, y: 0, z: 1 };
      const normalizedYAxis = crossVector(normalizedZAxis, normalizedXAxis);
      return {
        origin,
        xAxis: normalizeVector(normalizedXAxis) || { x: 1, y: 0, z: 0 },
        yAxis: normalizeVector(normalizedYAxis) || { x: 0, y: 1, z: 0 },
        zAxis: normalizeVector(normalizedZAxis) || { x: 0, y: 0, z: 1 },
      };
    };

    for (const [entityId] of entityStatements.entries()) {
      const entityType = getEntityType(entityId);
      if (entityType !== "DATUM_SYSTEM" && entityType !== "DATUM_SYSTEM_FOR_COMPOSITE_GROUP_ELEMENT") continue;

      const params = getEntityParams(entityId);
      const compartmentRefs = (params[4]?.match(/#\d+/g) || [])
        .filter((ref) => /DATUM_REFERENCE_COMPARTMENT|DATUM_REFERENCE_ELEMENT|DATUM/i.test(getEntityType(ref)));
      const references: ParsedStepDatumReference[] = [];

      compartmentRefs.forEach((compartmentId, compartmentIndex) => {
        const baseDatumIds = getDatumReferenceBaseIds(compartmentId);
        baseDatumIds.forEach((datumEntityId, baseIndex) => {
          const identifier = getDatumIdentifier(datumEntityId);
          if (!identifier) return;
          const datum = datumByEntityId.get(datumEntityId) || datumByIdentifier.get(identifier);
          const targetIds = datum?.targetIds || (datum?.targetId ? [datum.targetId] : undefined);
          references.push({
            precedence: compartmentIndex + 1,
            datumIdentifier: identifier,
            datumEntityId,
            compartmentId,
            modifiers: getDatumReferenceModifiers(compartmentId),
            isCommonDatum: baseDatumIds.length > 1,
            targetIds,
            surfaceGeometry: datum?.surfaceGeometry || targetIds?.map(getTargetSurfaceGeometry)
          });
        });
      });

      const label = Array.from(
        references.reduce<Map<number, string[]>>((groups, reference) => {
          const modifierLabel = reference.modifiers.length > 0
            ? `(${reference.modifiers.map((modifier) => modifier.split(" ").map((word) => word[0]).join("")).join(",")})`
            : "";
          const group = groups.get(reference.precedence) || [];
          group.push(`${reference.datumIdentifier}${modifierLabel}`);
          groups.set(reference.precedence, group);
          return groups;
        }, new Map<number, string[]>()).entries()
      )
        .sort(([a], [b]) => a - b)
        .map(([, labels]) => labels.join("-"))
        .join(" | ");

      const toleranceEntityIds = getUsedIn(entityId)
        .filter((referrerId) => getEntityTypeNames(referrerId).some((type) => /_TOLERANCE|GEOMETRIC_TOLERANCE/i.test(type)));

      if (references.length > 0) {
        frames.push({
          id: `PMI-DRF-${frames.length + 1}`,
          entityId,
          name: getQuotedValues(params[0] || "")[0] || `Datum Reference Frame ${frames.length + 1}`,
          label,
          references,
          toleranceEntityIds,
          frameBasis: buildFrameBasis(references)
        });
      }
    }

    return frames;
  };

  const buildAp242SemanticDatums = (): ParsedStepDatum[] => {
    const datumEntityByLetter = new Map<string, string>();
    const datumFeatureByOrdinal = new Map<number, string>();
    const representationTargetsByFeature = new Map<string, string[]>();

    for (const [entityId, statement] of entityStatements.entries()) {
      const datumMatch = statement.match(/^DATUM\s*\(([\s\S]*)\)$/i);
      if (datumMatch) {
        const letter = (datumMatch[1].match(/'([^']*)'/g) || [])
          .map((value) => value.replace(/'/g, "").trim().toUpperCase())
          .reverse()
          .find((value) => /^[A-Z]$/.test(value));
        if (letter) {
          datumEntityByLetter.set(letter, entityId);
        }
      }

      const datumFeatureMatch = statement.match(/^DATUM_FEATURE\s*\(\s*'[^']*?(\d+)'\s*,/i);
      if (datumFeatureMatch) {
        datumFeatureByOrdinal.set(parseInt(datumFeatureMatch[1], 10), entityId);
      }

      if (/^ITEM_IDENTIFIED_REPRESENTATION_USAGE\s*\(/i.test(statement)) {
        const refs = statement.match(/#\d+/g) || [];
        if (refs.length >= 3) {
          const featureId = refs[0];
          const targets = refs.slice(2).filter(isGeometryTargetEntity);
          if (targets.length > 0) {
            representationTargetsByFeature.set(featureId, targets);
          }
        }
      }
    }

    const datumLetters = Array.from(datumEntityByLetter.keys()).sort((a, b) => a.localeCompare(b));
    if (datumLetters.length === 0) {
      return [];
    }

    return datumLetters.flatMap((identifier, index) => {
      const datumEntityId = datumEntityByLetter.get(identifier)!;
      const ordinal = index + 1;
      const featureId = datumFeatureByOrdinal.get(ordinal);
      const directTargets = resolveTargetsForId(datumEntityId).filter(isGeometryTargetEntity);
      const featureTargets = featureId ? (representationTargetsByFeature.get(featureId) || resolveTargetsForId(featureId)) : [];
      const activeFeatureIds = featureId ? [featureId] : getSemanticDatumFeatureIds(datumEntityId);
      let targetIds = preferDatumSurfaceTargets(uniqueGeometryTargets(directTargets.length > 0 ? directTargets : featureTargets));
      const presentationTargetPoint = [datumEntityId, ...activeFeatureIds]
        .map(getPresentationLandingPointForShapeAspect)
        .find((point): point is { x: number; y: number; z: number } => !!point) ||
        getDatumPresentationLandingPointByIdentifier(identifier);
      targetIds = preferDatumSurfaceTargets(selectDatumTargetsFromPresentationComposite(activeFeatureIds, targetIds, presentationTargetPoint));

      if (targetIds.length === 0) {
        return [];
      }

      const primaryTarget = targetIds[0];
      const description = describeDerivedDatum(identifier, primaryTarget, targetIds, activeFeatureIds);
      const additionalCount = targetIds.length - 1;
      const derivedDatumKind = getDerivedDatumKind(activeFeatureIds, targetIds);

      return [{
        id: `PMI-DTM-${index + 1}`,
        entityId: datumEntityId,
        name: `Datum ${identifier}`,
        identifier,
        type: description.typeStr,
        symbol: `[ ${identifier} ]`,
        targetId: primaryTarget,
        targetIds,
        surfaceGeometry: targetIds.map(getTargetSurfaceGeometry),
        semanticTargetIds: targetIds,
        presentationTargetPoint,
        targetSource: "semantic",
        derivedDatum: derivedDatumKind,
        targetName: additionalCount > 0
          ? description.targetName
          : description.targetName,
        clinicalContext: description.clinicalContext
      }];
    });
  };

  // 1. Resolve explicitly parsed DATUM / DATUM_FEATURE
  for (const d of parsedDatums) {
    let resolvedTargets = preferDatumSurfaceTargets(uniqueGeometryTargets(resolveTargetsForId(d.targetId)));
    if (resolvedTargets.length > 0) {
      const semanticFeatureIds = getSemanticDatumFeatureIds(d.entityId);
      const presentationTargetPoint = [d.entityId, ...semanticFeatureIds]
        .map(getPresentationLandingPointForShapeAspect)
        .find((point): point is { x: number; y: number; z: number } => !!point) ||
        getDatumPresentationLandingPointByIdentifier(d.identifier);
      resolvedTargets = preferDatumSurfaceTargets(selectDatumTargetsFromPresentationComposite(semanticFeatureIds, resolvedTargets, presentationTargetPoint));
      const resolved = resolvedTargets[0];
      if (!resolved) continue;
      d.targetId = resolved;
      d.targetIds = resolvedTargets;
      d.semanticTargetIds = resolvedTargets;
      d.presentationTargetPoint = presentationTargetPoint;
      d.targetSource = "semantic";
      const description = describeDerivedDatum(d.identifier, resolved, resolvedTargets, []);
      d.type = description.typeStr;
      d.targetName = description.targetName;
      d.derivedDatum = getPlanarDatumFeatureKind([], resolvedTargets);
      d.surfaceGeometry = resolvedTargets.map(getTargetSurfaceGeometry);
      d.clinicalContext = description.clinicalContext;
    }
  }

  // 2. Resolve explicitly parsed tolerances
  for (const t of parsedTolerances) {
    let resolved = resolveTargetsForId(t.targetId)[0];
    if (resolved) {
      t.targetId = resolved;
    }
  }

  // 3. Reconstruct AP203 datums dynamically if none parsed via DATUM
  if (parsedDatums.length === 0 && datumAnnotations.length > 0) {
    const usedIdentifiers = new Set<string>();
    for (const annId of datumAnnotations) {
      const targetIds = resolveTargetsForId(annId);
      const presentationIdentifier = getDatumPresentationIdentifier(annId);
      if (!presentationIdentifier) continue;
      const identifier = presentationIdentifier;
      usedIdentifiers.add(identifier);

      const selectedTargets = selectDatumAnnotationTargets(annId, targetIds);
      for (const targetId of selectedTargets) {
        const description = describeDerivedDatum(identifier, targetId, selectedTargets, [annId]);

        parsedDatums.push({
          id: `PMI-DTM-${parsedDatums.length + 1}`,
          entityId: annId,
          name: `Datum ${identifier}`,
          identifier,
          type: description.typeStr,
          symbol: `[ ${identifier} ]`,
          targetId,
          targetIds: selectedTargets,
          surfaceGeometry: selectedTargets.map(getTargetSurfaceGeometry),
          derivedDatum: getPlanarDatumFeatureKind([annId], selectedTargets),
          targetName: description.targetName,
          clinicalContext: description.clinicalContext
        });
      }
    }
  }

  // 4. Reconstruct AP203 feature control frame targets when tolerances are presentation-only.
  if (parsedTolerances.length === 0 && fcfAnnotations.length > 0) {
    for (const annId of fcfAnnotations) {
      const targetIds = resolveTargetsForId(annId);
      for (const targetId of targetIds) {
        parsedTolerances.push({
          id: `PMI-STP-${parsedTolerances.length + 1}`,
          entityId: annId,
          type: "Feature Control Frame",
          symbol: "FCF",
          value: 0,
          targetId,
          targetName: `PMI target B-Rep Feature (${targetId})`,
          category: "Dimension" as const,
          clinicalContext: "Feature control frame target resolved from AP203 PMI presentation associations."
        });
      }
    }
  }

  // 5. Reconstruct AP203 datum targets as their own PMI objects. These are
  // separate from datum features: a datum target marks a limited point/line/area
  // used to establish the datum, while the datum feature is the physical feature.
  const decodedDatumTargetLabels = new Map<string, string>();
  for (const annId of datumTargetAnnotations) {
    const decodedIdentifier = getDatumTargetPresentationIdentifier(annId);
    if (decodedIdentifier) decodedDatumTargetLabels.set(annId, decodedIdentifier);
  }
  const hasDecodedDatumTargetLabels = decodedDatumTargetLabels.size > 0;
  let fallbackDatumTargetIndex = 1;

  for (const annId of datumTargetAnnotations) {
    const decodedIdentifier = decodedDatumTargetLabels.get(annId);
    if (hasDecodedDatumTargetLabels && !decodedIdentifier) {
      continue;
    }

    const targetType = getDatumTargetPresentationType(annId);
    const targetIds = resolveTargetsForId(annId);
    const rawTargetPoint = /rectangle|area|zone/i.test(targetType)
      ? getDatumTargetPresentationLandingPoint(annId) || getDatumTargetPresentationPoint(annId)
      : getDatumTargetPresentationPoint(annId);
    const lengthScale = getDefaultLengthScaleToMillimeters();
    const scaledTargetPoint = rawTargetPoint
      ? scalePoint(rawTargetPoint, lengthScale)
      : null;
    for (const targetId of targetIds) {
      const targetZone = /rectangle|area|zone/i.test(targetType)
        ? getDatumTargetModelRectangleZone(targetId, scaledTargetPoint) ||
          getDatumTargetPresentationRectangleZone(scaledTargetPoint)
        : undefined;
      const targetPoint = targetZone?.center || scaledTargetPoint;
      const surfaceType = getTargetSurfaceType(targetId);
      const identifier = decodedIdentifier || `A${fallbackDatumTargetIndex++}`;
      const surfaceLabel =
        surfaceType === "plane" ? "planar face" :
        surfaceType === "cylinder" ? "cylindrical face" :
        surfaceType === "curved" ? "curved face" :
        "B-Rep feature";

      parsedDatumTargets.push({
        id: `PMI-DTGT-${parsedDatumTargets.length + 1}`,
        entityId: annId,
        name: `Datum Target ${identifier}`,
        identifier,
        parentDatum: identifier.match(/^[A-Z]+/)?.[0],
        type: targetType,
        targetId,
        targetName: `${targetType} on ${surfaceLabel} (${targetId})`,
        targetPoint,
        targetZone,
        clinicalContext: "Datum target resolved from AP203 PMI presentation association; it locates a limited contact target used for datum establishment."
      });
    }
  }

  const sfaSemanticDatums = buildSfaSemanticDatums();
  const sfaSemanticDatumTargets = buildSfaSemanticDatumTargets();
  const sfaSemanticTolerances = buildSfaSemanticTolerances();
  const ap242DimensionalTolerances = buildAp242DimensionalTolerances();
  sfaSemanticTolerances.forEach((tolerance) => {
    const resolvedThreadCylinderTargets = (tolerance.targetIds || [])
      .flatMap((targetId) => threadCylinderFaceTargetsBySemanticTarget.get(targetId) || [])
      .filter((targetId, index, all) => all.indexOf(targetId) === index);
    if (resolvedThreadCylinderTargets.length > 0) {
      tolerance.threadCylinderTargetIds = resolvedThreadCylinderTargets;
    }
  });
  const ap242SemanticDatums = buildAp242SemanticDatums();

  // Fallback to rich inferred tolerances if the STEP file did not contain explicit geometric annotations
  let finalTolerances = sfaSemanticTolerances.length > 0 ? sfaSemanticTolerances : (parsedTolerances.length > 0 ? parsedTolerances : []);
  finalTolerances = [
    ...finalTolerances,
    ...ap242DimensionalTolerances.filter((dimensionTolerance) =>
      !finalTolerances.some((tolerance) => tolerance.entityId === dimensionTolerance.entityId)
    )
  ].filter((tolerance) => {
    const targetIds = Array.isArray(tolerance.targetIds) && tolerance.targetIds.length > 0
      ? tolerance.targetIds
      : (tolerance.targetId ? [tolerance.targetId] : []);
    return !isLinearDimensionSubEntityOfSingleCurvedFace(
      tolerance.dimensionKind,
      targetIds,
      tolerance.isDatumTargetDimension
    );
  });
  finalTolerances = finalTolerances.map((tolerance) => {
    const resolvedThreadCylinderTargets = (tolerance.targetIds || [])
      .flatMap((targetId) => threadCylinderFaceTargetsBySemanticTarget.get(targetId) || [])
      .filter((targetId, index, all) => all.indexOf(targetId) === index);
    return resolvedThreadCylinderTargets.length > 0
      ? { ...tolerance, threadCylinderTargetIds: resolvedThreadCylinderTargets }
      : tolerance;
  });
  finalTolerances.forEach((tolerance) => {
    if (!tolerance.isCounterboreDimension || !(tolerance.counterboreHoleTargetIds || []).length) return;
    const pilotHoleTargets = new Set(tolerance.counterboreHoleTargetIds);
    tolerance.counterboreHoleFeatureControlFrameIds = finalTolerances
      .filter((candidate) =>
        (candidate.type === "Position" || candidate.symbol === "POS") &&
        (candidate.targetIds || []).some((targetId) => pilotHoleTargets.has(targetId))
      )
      .map((candidate) => candidate.id);
  });
  const threadDepthTolerances = finalTolerances.filter((tolerance) =>
    tolerance.dimensionKind === "threadDepth" &&
    !!tolerance.threadDesignation &&
    (tolerance.threadCylinderTargetIds || []).length > 0
  );
  finalTolerances = finalTolerances.filter((tolerance) => {
    if (tolerance.dimensionKind !== "diameter" || tolerance.threadDesignation) return true;
    const candidateThreadNominal = `${tolerance.nominalDimension ?? ""}`;
    const candidateTargets = new Set(tolerance.threadCylinderTargetIds || []);
    if (candidateTargets.size === 0) return true;
    return !threadDepthTolerances.some((threadTolerance) => {
      const threadNominal = `${threadTolerance.threadDesignation}`.match(/\bM\s*(\d+(?:\.\d+)?)/i)?.[1];
      const sharesThreadCylinder = (threadTolerance.threadCylinderTargetIds || [])
        .some((targetId) => candidateTargets.has(targetId));
      return sharesThreadCylinder &&
        threadNominal === candidateThreadNominal &&
        threadTolerance.dimensionPreModifier === tolerance.dimensionPreModifier;
    });
  });

  // Fallback to rich inferred datums if the STEP file did not contain explicit geometric annotations
  let finalDatums = sfaSemanticDatums.length > 0 ? sfaSemanticDatums : (ap242SemanticDatums.length > 0 ? ap242SemanticDatums : (parsedDatums.length > 0 ? parsedDatums : []));

  const rawDatumTargets = [...sfaSemanticDatumTargets, ...parsedDatumTargets];
  const datumTargetsByParent = new Map<string, ParsedStepDatumTarget[]>();
  for (const datumTarget of rawDatumTargets) {
    if (!datumTarget.parentDatum) continue;
    const group = datumTargetsByParent.get(datumTarget.parentDatum) || [];
    group.push(datumTarget);
    datumTargetsByParent.set(datumTarget.parentDatum, group);
  }

  const targetDerivedDatums = Array.from(datumTargetsByParent.entries())
    .filter(([, targets]) => targets.length > 0)
    .map(([identifier, targets], index): ParsedStepDatum => {
      const sortedTargets = [...targets].sort((a, b) => a.identifier.localeCompare(b.identifier, undefined, { numeric: true }));
      const primaryTarget = sortedTargets[0];
      const targetLabels = sortedTargets.map((target) => target.identifier).join(", ");
      const targetIds = sortedTargets
        .map((target) => target.targetId)
        .filter((targetId, targetIndex, all): targetId is string => !!targetId && all.indexOf(targetId) === targetIndex);
      return {
        id: `PMI-DTM-${index + 1}`,
        entityId: sortedTargets.map((target) => target.entityId).join(","),
        name: `Datum ${identifier}`,
        identifier,
        type: "Datum Target Set",
        symbol: `[ ${identifier} ]`,
        targetId: primaryTarget.targetId,
        targetIds,
        surfaceGeometry: getDatumTargetSetSurfaceGeometry(sortedTargets),
        targetName: `Datum ${identifier} established by ${sortedTargets.length} datum target${sortedTargets.length === 1 ? "" : "s"} (${targetLabels})`,
        clinicalContext: "Datum is established by datum targets rather than an explicit datum feature surface in the STEP presentation PMI."
      };
    });

  if (targetDerivedDatums.length > 0) {
    const targetSetIdentifiers = new Set(targetDerivedDatums.map((datum) => datum.identifier));
    const nonTargetSetDatums = finalDatums.filter((datum) => !targetSetIdentifiers.has(datum.identifier));
    finalDatums = [...targetDerivedDatums, ...nonTargetSetDatums];
  }

  const uniqueDatumsByIdentifier = new Map<string, ParsedStepDatum>();
  for (const datum of finalDatums) {
    const existing = uniqueDatumsByIdentifier.get(datum.identifier);
    if (
      !existing ||
      (!existing.presentationTargetPoint && datum.presentationTargetPoint) ||
      (!existing.targetId && datum.targetId)
    ) {
      uniqueDatumsByIdentifier.set(datum.identifier, datum);
    }
  }

  finalDatums = Array.from(uniqueDatumsByIdentifier.values())
    .sort((a, b) => a.identifier.localeCompare(b.identifier))
    .map((datum, index) => ({
      ...datum,
      semanticTargetIds: datum.semanticTargetIds || datum.targetIds,
      surfaceGeometry: datum.surfaceGeometry || (datum.targetIds || (datum.targetId ? [datum.targetId] : [])).map(getTargetSurfaceGeometry),
      presentationTargetPoint: datum.presentationTargetPoint || getDatumPresentationLandingPointByIdentifier(datum.identifier) || (() => {
        const escapedIdentifier = datum.identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const leaderMatch = text.match(new RegExp(`ANNOTATION_TO_MODEL_LEADER_LINE\\s*\\(\\s*'Datum\\s+Feature\\s+Symbol\\s+${escapedIdentifier}[^']*'\\s*,\\s*\\((#[\\d\\s,#]+)\\)\\s*\\)\\s*;`, "i"));
        const pointRefs = leaderMatch?.[1]?.match(/#\d+/g) || [];
        const arrowPointRef = pointRefs.find((ref) => /ARROWHEAD/i.test(entityStatements.get(ref) || "")) || pointRefs[pointRefs.length - 1];
        return arrowPointRef ? getCartesianPoint(arrowPointRef) || undefined : undefined;
      })(),
      targetSource: datum.targetSource || "semantic",
      id: `PMI-DTM-${index + 1}`
  }));

  const uniqueDatumTargetsByEntity = new Map<string, ParsedStepDatumTarget>();
  for (const datumTarget of rawDatumTargets) {
    const key = `${datumTarget.entityId}:${datumTarget.targetId || datumTarget.identifier}`;
    if (!uniqueDatumTargetsByEntity.has(key)) {
      uniqueDatumTargetsByEntity.set(key, datumTarget);
    }
  }
  const finalDatumTargets = Array.from(uniqueDatumTargetsByEntity.values())
    .sort((a, b) => a.identifier.localeCompare(b.identifier, undefined, { numeric: true }))
    .map((datumTarget, index) => ({
      ...datumTarget,
      id: `PMI-DTGT-${index + 1}`
    }));

  const datumReferenceFrames = buildDatumReferenceFrames(finalDatums);
  const datumReferenceFrameByEntityId = new Map(datumReferenceFrames.map((frame) => [frame.entityId, frame]));

  const getAxisPlacementDirections = (placementId: string) => {
    if (getEntityType(placementId) !== "AXIS2_PLACEMENT_3D") return null;
    const placementRefs = getEntityRefs(placementId);
    const axis = placementRefs[1] ? normalizeVector(getDirection(placementRefs[1])) : null;
    const xDirection = placementRefs[2] ? normalizeVector(getDirection(placementRefs[2])) : null;
    if (!axis || !xDirection) return null;
    const yDirection = normalizeVector(crossVector(axis, xDirection));
    return yDirection ? { axis, xDirection, yDirection } : null;
  };

  const getTolerancePresentationXAxisHint = (
    toleranceEntityId: string,
    frame: ParsedStepDatumReferenceFrame
  ): { x: number; y: number; z: number } | null => {
    const uniqueReferences = frame.references
      .filter((reference, index, all) => all.findIndex((candidate) => candidate.datumIdentifier === reference.datumIdentifier) === index)
      .sort((a, b) => a.precedence - b.precedence);
    const primaryPlaneCount = (uniqueReferences[0]?.surfaceGeometry || [])
      .filter((geometry) => geometry.surfaceType === "plane" && geometry.normal).length;
    const hasSecondaryAxes = uniqueReferences.slice(1, 3).every((reference) =>
      (reference.surfaceGeometry || []).some((geometry) => geometry.surfaceType === "cylinder" && geometry.axis)
    );
    if (!hasSecondaryAxes) return null;

    const toleranceRefs = getEntityRefs(toleranceEntityId);
    const shapeAspectId = toleranceRefs.find((ref) => /SHAPE_ASPECT/i.test(getEntityType(ref)));
    if (!shapeAspectId) return null;

    const calloutIds = getUsedIn(shapeAspectId, /DRAUGHTING_MODEL_ITEM_ASSOCIATION/i)
      .flatMap((associationId) => getEntityRefs(associationId))
      .filter((ref) => getEntityType(ref) === "DRAUGHTING_CALLOUT");

    for (const calloutId of calloutIds) {
      const occurrenceIds = getEntityRefs(calloutId)
        .filter((ref) => /TESSELLATED_ANNOTATION_OCCURRENCE|ANNOTATION_PLACEHOLDER_OCCURRENCE/i.test(getEntityType(ref)));
      for (const occurrenceId of occurrenceIds) {
        const placementIds = getEntityRefs(occurrenceId)
          .flatMap((ref) => [ref, ...getEntityRefs(ref)])
          .filter((ref) => getEntityType(ref) === "AXIS2_PLACEMENT_3D");
        for (const placementId of placementIds) {
          const placement = getAxisPlacementDirections(placementId);
          if (!placement) continue;
          const projected = frame.frameBasis
            ? projectVectorOntoPlane(placement.yDirection, frame.frameBasis.zAxis)
            : placement.yDirection;
          const xAxisHint = normalizeVector(projected);
          if (xAxisHint) return xAxisHint;
        }
      }
    }

    return null;
  };

  const withFrameXAxisHint = (
    frame: ParsedStepDatumReferenceFrame,
    xAxisHint: { x: number; y: number; z: number }
  ): ParsedStepDatumReferenceFrame => {
    if (!frame.frameBasis) return frame;
    const zAxis = normalizeVector(frame.frameBasis.zAxis);
    if (!zAxis) return frame;
    const xAxis = normalizeVector(projectVectorOntoPlane(xAxisHint, zAxis));
    if (!xAxis) return frame;
    const yAxis = normalizeVector(crossVector(zAxis, xAxis));
    if (!yAxis) return frame;
    return {
      ...frame,
      frameBasis: {
        ...frame.frameBasis,
        xAxis,
        yAxis,
        zAxis
      }
    };
  };

  finalTolerances = finalTolerances.map((tolerance) => {
    const datumSystemId = getEntityRefs(tolerance.entityId)
      .find((ref) => /DATUM_SYSTEM/i.test(getEntityType(ref)));
    const datumReferenceFrame = datumSystemId ? datumReferenceFrameByEntityId.get(datumSystemId) : undefined;
    let orientedDatumReferenceFrame = datumReferenceFrame;
    if (datumReferenceFrame && /profile/i.test(tolerance.type || "")) {
      const xAxisHint = getTolerancePresentationXAxisHint(tolerance.entityId, datumReferenceFrame);
      if (xAxisHint) orientedDatumReferenceFrame = withFrameXAxisHint(datumReferenceFrame, xAxisHint);
    }
    return orientedDatumReferenceFrame
      ? {
          ...tolerance,
          datumReferenceFrame: orientedDatumReferenceFrame
        }
      : tolerance;
  });

  return {
    fileName,
    fileSize: text.length,
    entitiesSummary: {
      pointsCount: points.length,
      cylindersCount: cylinders.length,
      facesCount,
      linesCount,
      rawEntitiesCount
    },
    // Limit points to avoid browser memory crash on listing
    points: points.slice(0, 50), 
    holes,
    dimensions: {
      width,
      length,
      estimatedThickness
    },
    tolerances: finalTolerances,
    datums: finalDatums,
    datumTargets: finalDatumTargets,
    datumReferenceFrames,
    faceRecords,
    cylinderIds,
    rawText: text
  };
}

/**
 * Generate a beautifully formatted clinical-grade STEP CAD file
 * representing a maxillofacial mandibular reconstruction plate.
 */
export function generateSampleStepText(partNumber: string = "RECON-PLATE-M81"): string {
  return `ISO-10303-21;
HEADER;
/* Generated by MAXILLO-CAD AI Orthopedic OCCT.js compiler */
FILE_DESCRIPTION(('Maxillofacial mandibular reconstruction plate', 'Biocompatible titanium custom prosthesis'), '2;1');
FILE_NAME('${partNumber}.stp', '2026-06-08', ('Clinician J.S.', 'Surgical Engineering lab'), ('Department of Maxillofacial Surgery'), 'OCCT.js-v0.17', 'Fusion360-B-Rep-Exporter', 'Sub-orbital surgical placement');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 242 1 1 1 }'));
ENDSEC;
DATA;
#10 = ORGANISATION('HOSP-CLINIC', 'Maxillofacial Division', 'Surgical Implant Core');
#20 = APPLIED_ORGANIZATION_ASSIGNMENT(#10, #30);
#40 = PRODUCT('${partNumber}', '${partNumber}', 'Maxillofacial Mandible Part', (#20));

/* B-Rep Geometric Points specifying bone contour offsets */
#101 = CARTESIAN_POINT('Contour_P1', (-6.0, -0.6, 0.0));
#102 = CARTESIAN_POINT('Contour_P2', (-4.0, -0.8, 0.1));
#103 = CARTESIAN_POINT('Contour_P3', (-2.0, -0.4, 0.2));
#104 = CARTESIAN_POINT('Contour_P4', (0.0, -0.2, 0.2));
#105 = CARTESIAN_POINT('Contour_P5', (2.0, -0.4, 0.2));
#106 = CARTESIAN_POINT('Contour_P6', (4.0, -0.8, 0.1));
#107 = CARTESIAN_POINT('Contour_P7', (6.0, -0.6, 0.0));

/* Plate profile vertices representing 2.0mm medical thickness bounds */
#201 = CARTESIAN_POINT('Thickness_Upper', (0.0, 0.0, 1.0));
#202 = CARTESIAN_POINT('Thickness_Lower', (0.0, 0.0, -1.0));

/* Cylinder representations of orthopedic screw locks */
#301 = AXIS2_PLACEMENT_3D('Hole_Center_1', #102, $, $);
#302 = CYLINDRICAL_SURFACE('Hole_Cyl_1', #301, 1.0);  /* Radius 1.0 = 2.0mm Screw Hole */

#303 = AXIS2_PLACEMENT_3D('Hole_Center_2', #103, $, $);
#304 = CYLINDRICAL_SURFACE('Hole_Cyl_2', #303, 1.0);  /* Radius 1.0 = 2.0mm Screw Hole */

#305 = AXIS2_PLACEMENT_3D('Hole_Center_3', #104, $, $);
#306 = CYLINDRICAL_SURFACE('Hole_Cyl_3', #305, 1.0);  /* Radius 1.0 = 2.0mm Screw Hole */

#307 = AXIS2_PLACEMENT_3D('Hole_Center_4', #105, $, $);
#308 = CYLINDRICAL_SURFACE('Hole_Cyl_4', #307, 1.0);  /* Radius 1.0 = 2.0mm Screw Hole */

#309 = AXIS2_PLACEMENT_3D('Hole_Center_5', #106, $, $);
#310 = CYLINDRICAL_SURFACE('Hole_Cyl_5', #309, 1.0);  /* Radius 1.0 = 2.0mm Screw Hole */

/* Structural face clusters */
#401 = PLANE('Perimeter_Plane_Normal_Z', #104);
#402 = ADVANCED_FACE('Main_Base_Face', (#401), .T.);
#403 = CLOSED_SHELL('Plate_Solid_Shell', (#402));

/* Product Manufacturing Information (PMIs) / 3D Geometric Dimensioning and Tolerances */
#501 = FLATNESS_TOLERANCE('FLATNESS', 0.02, #402);
#502 = CYLINDRICITY_TOLERANCE('CYLINDRICITY', 0.04, #302);
#503 = POSITION_TOLERANCE('POSITION', 0.06, #301);
#504 = SURFACE_PROFILE_TOLERANCE('SURFACE_PROFILE', 0.12, #402);
#505 = PERPENDICULARITY_TOLERANCE('PERPENDICULARITY', 0.03, #402);

/* Reference Datum Systems */
#601 = DATUM('A', #402);
#602 = DATUM('B', #302);
#603 = DATUM('C', #304);

ENDSEC;
END-ISO-10303-21;
`;
}

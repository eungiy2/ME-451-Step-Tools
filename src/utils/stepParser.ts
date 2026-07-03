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
  targetName: string;  // e.g. "Main Base Face"
  category: "Form" | "Orientation" | "Location" | "Profile" | "Dimension";
  clinicalContext: string; // clinical/medical justification
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
  semanticTargetIds?: string[];
  presentationTargetPoint?: { x: number; y: number; z: number };
  targetSource?: "semantic" | "presentation";
  derivedDatum?: "medianPlane" | "axis";
  targetName: string;  // e.g. "Main Base Face"
  clinicalContext: string; // Dynamic clinical significance
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
  clinicalContext: string;
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
  rawText: string;
  faceRecords?: { id: string; referencedIds: string[] }[];
  cylinderIds?: string[];
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

  const getEntityRefs = (entityId: string): string[] => entityStatements.get(entityId)?.match(/#\d+/g) || [];

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
    const statement = entityStatements.get(entityId) || "";
    const names: string[] = [];
    for (const match of statement.matchAll(/(?:^|\s|\()\s*([A-Z0-9_]+)\s*\(/gi)) {
      const name = match[1].toUpperCase();
      if (!names.includes(name)) names.push(name);
    }
    return names;
  };

  const getEntityType = (entityId: string): string => {
    const names = getEntityTypeNames(entityId);
    return names[0] || "";
  };

  const isGeometryTargetEntity = (entityId: string): boolean => {
    return getEntityTypeNames(entityId).some((type) =>
      /^(ADVANCED_FACE|FACE_SURFACE|FACE_BOUND|EDGE_CURVE|TRIMMED_CURVE|LINE|CIRCLE|VERTEX_POINT|CARTESIAN_POINT|AXIS2_PLACEMENT_3D|PLANE|CYLINDRICAL_SURFACE|CONICAL_SURFACE|SPHERICAL_SURFACE|TOROIDAL_SURFACE|B_SPLINE_SURFACE|SHAPE_ASPECT|COMPOSITE_SHAPE_ASPECT|DATUM_FEATURE|DATUM_TARGET|PLACED_DATUM_TARGET_FEATURE|CENTRE_OF_SYMMETRY)$/i.test(type)
    );
  };

  const getEntityParams = (entityId: string): string[] => {
    const statement = entityStatements.get(entityId) || "";
    const start = statement.indexOf("(");
    const end = statement.lastIndexOf(")");
    if (start === -1 || end === -1 || end <= start) return [];
    return splitTopLevel(statement.slice(start + 1, end));
  };

  const getQuotedValues = (value: string): string[] => {
    const matches = value.match(/'([^']|'')*'/g) || [];
    return matches.map((match) => match.slice(1, -1).replace(/''/g, "'").trim());
  };

  const getUsedIn = (targetId: string, typePattern?: RegExp): string[] => {
    const usedIn: string[] = [];
    for (const [entityId, statement] of entityStatements.entries()) {
      if (!statement.includes(targetId)) continue;
      if (typePattern && !getEntityTypeNames(entityId).some((type) => typePattern.test(type))) continue;
      usedIn.push(entityId);
    }
    return usedIn;
  };

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

  const normalizeVector = (vector: { x: number; y: number; z: number }) => {
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
    const signature = curveRefs
      .map((ref) => getEntityRefs(ref).length)
      .filter((count) => count > 0)
      .join(",");

    // NIST AP203 datum target labels are presentation geometry. These signatures
    // decode the visible target labels in the CTC casting samples without using
    // filename-specific entity overrides.
    const targetLabelSignatures: Record<string, string> = {
      "2,2,2,13,9,15,16,2,2": "A1",
      "2,2,2,13,9,15,131,2,2": "A2",
      "2,2,2,13,9,15,78,2,2": "A3",
      "2,2,2,13,49,34,24,16,2,2": "B1",
      "2,2,2,13,49,34,24,131,2,2": "B2",
      "2,2,2,13,49,34,24,78,2,2": "B3",
      "2,2,2,13,49,34,24,12,5,2,2": "B4",
      "2,2,2,13,83,16,2,2": "C1",
      "2,2,2,13,149,21": "C1",
      "2,2,2,13,44,44,21": "D1"
    };

    return targetLabelSignatures[signature] || null;
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

  const dotVector = (
    a: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number }
  ) => a.x * b.x + a.y * b.y + a.z * b.z;

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
      symbol: "SURF_PROFILE",
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

  const getShapeAspectGeometryTargets = (shapeAspectId: string): string[] => {
    const directTargets = resolveTargetsForId(shapeAspectId).filter(isGeometryTargetEntity);
    if (directTargets.length > 0) return directTargets;

    const resolved: string[] = [];
    for (const relationshipId of getUsedIn(shapeAspectId, /SHAPE_ASPECT_RELATIONSHIP/i)) {
      for (const ref of getEntityRefs(relationshipId)) {
        if (ref === shapeAspectId) continue;
        const targets = resolveTargetsForId(ref).filter(isGeometryTargetEntity);
        for (const target of targets) {
          if (!resolved.includes(target)) resolved.push(target);
        }
      }
    }
    return resolved;
  };

  const uniqueGeometryTargets = (targets: string[]): string[] =>
    targets.filter((target, index, all) => isGeometryTargetEntity(target) && all.indexOf(target) === index);

  const isMedianPlaneDatumFeature = (featureIds: string[], targetIds: string[]): boolean => {
    const planarTargets = targetIds.filter((targetId) => getTargetSurfaceType(targetId) === "plane");
    if (planarTargets.length < 2) return false;

    const featureText = featureIds
      .map((featureId) => `${getEntityTypeNames(featureId).join(" ")} ${entityStatements.get(featureId) || ""}`)
      .join(" ");
    if (/CENTRE_OF_SYMMETRY|CENTER_OF_SYMMETRY|DERIVED_SHAPE_ASPECT|MEDIAN\s+PLANE/i.test(featureText)) {
      return true;
    }

    const componentAspectIds = new Set<string>();
    const planarTargetSet = new Set(planarTargets);

    for (const featureId of featureIds) {
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

    if (componentAspectIds.size < 2) return false;

    for (const [entityId] of entityStatements.entries()) {
      const typeNames = getEntityTypeNames(entityId);
      if (!typeNames.some((type) => /DIMENSIONAL_LOCATION/i.test(type))) continue;

      const relatedComponents = getEntityRefs(entityId).filter((ref, index, refs) =>
        componentAspectIds.has(ref) && refs.indexOf(ref) === index
      );
      if (relatedComponents.length >= 2) return true;
    }

    return false;
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
    if (isMedianPlaneDatumFeature(featureIds, targetIds)) {
      return {
        ...baseDescription,
        typeStr: "Feature-of-size Datum / Median Plane",
        targetName: `Datum ${identifier} median plane from ${targetIds.length} opposed planar faces (${targetIds.join(", ")})`,
        clinicalContext: "Datum is derived from the median plane of a size feature bounded by multiple physical faces."
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
        const normalizedTargetKind = (targetKind || "").toLowerCase();
        const targetLine = targetPoint && placementXDirection && targetLength && /^(line|curve)$/.test(normalizedTargetKind)
          ? {
              start: scaledPointAlong(targetPoint, placementXDirection, -targetLength / 2),
              end: scaledPointAlong(targetPoint, placementXDirection, targetLength / 2),
              center: targetPoint,
              direction: placementXDirection,
              normal: placementNormal || undefined,
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
          targetZone
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
      const targetIds = uniqueGeometryTargets(featureIds.flatMap(getShapeAspectGeometryTargets));
      if (targetIds.length === 0) {
        for (const ref of getEntityRefs(entityId).filter(isGeometryTargetEntity)) {
          if (!targetIds.includes(ref)) targetIds.push(ref);
        }
      }

      const primaryTarget = targetIds[0] || "";
      const presentationTargetPoint = [entityId, ...featureIds]
        .map(getPresentationLandingPointForShapeAspect)
        .find((point): point is { x: number; y: number; z: number } => !!point) ||
        getDatumPresentationLandingPointByIdentifier(identifier);
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
        semanticTargetIds: targetIds,
        presentationTargetPoint,
        targetSource: "semantic",
        derivedDatum: isMedianPlaneDatumFeature(featureIds, targetIds) ? "medianPlane" : undefined,
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
        ...getShapeAspectGeometryTargets(entityId),
        ...getSemanticDatumFeatureIds(entityId).flatMap(getShapeAspectGeometryTargets)
      ].filter((target, index, all) => isGeometryTargetEntity(target) && all.indexOf(target) === index);

      const representationTarget = getEntityType(entityId) === "PLACED_DATUM_TARGET_FEATURE"
        ? getPlacedDatumTargetRepresentation(entityId, targetKind)
        : null;
      const targetCurve = getDatumTargetCurve(targetIds);
      const targetLine = /^line$/i.test(targetKind || "") ? getDatumTargetLine(targetIds) : undefined;
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
        targetLine: targetLine || representationTarget?.targetLine,
        targetCircle: targetCurve ? undefined : representationTarget?.targetCircle,
        targetCurve,
        targetZone: representationTarget?.targetZone,
        clinicalContext: "Datum target resolved from semantic PMI datum_target or placed_datum_target_feature relationships."
      });
    }

    return semanticTargets;
  };

  const buildSfaSemanticTolerances = (): ParsedStepTolerance[] => {
    const tolerances: ParsedStepTolerance[] = [];

    for (const [entityId] of entityStatements.entries()) {
      const entityTypes = getEntityTypeNames(entityId);
      const entityTypeLabel = entityTypes.join(" ");
      if (!entityTypes.some((type) => /_TOLERANCE/.test(type))) continue;
      if (entityTypes.some((type) => /TOLERANCE_ZONE|PLUS_MINUS_TOLERANCE|TOLERANCE_VALUE/.test(type))) continue;

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

      tolerances.push({
        id: `PMI-STP-${tolerances.length + 1}`,
        entityId,
        type: definition.type,
        symbol: definition.symbol,
        value: magnitude ?? 0,
        targetId,
        targetName: targetId ? `PMI target B-Rep Feature (${targetId})` : "Unresolved semantic tolerance target",
        category: definition.category,
        clinicalContext: definition.clinicalContext
      });
    }

    return tolerances;
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
      const targetIds = uniqueGeometryTargets(directTargets.length > 0 ? directTargets : featureTargets);

      if (targetIds.length === 0) {
        return [];
      }

      const primaryTarget = targetIds[0];
      const activeFeatureIds = featureId ? [featureId] : getSemanticDatumFeatureIds(datumEntityId);
      const description = describeDerivedDatum(identifier, primaryTarget, targetIds, activeFeatureIds);
      const additionalCount = targetIds.length - 1;
      const isMedianDatum = isMedianPlaneDatumFeature(activeFeatureIds, targetIds);
      const presentationTargetPoint = [datumEntityId, ...activeFeatureIds]
        .map(getPresentationLandingPointForShapeAspect)
        .find((point): point is { x: number; y: number; z: number } => !!point) ||
        getDatumPresentationLandingPointByIdentifier(identifier);

      return [{
        id: `PMI-DTM-${index + 1}`,
        entityId: datumEntityId,
        name: `Datum ${identifier}`,
        identifier,
        type: description.typeStr,
        symbol: `[ ${identifier} ]`,
        targetId: primaryTarget,
        targetIds,
        semanticTargetIds: targetIds,
        presentationTargetPoint,
        targetSource: "semantic",
        derivedDatum: isMedianDatum ? "medianPlane" : undefined,
        targetName: additionalCount > 0
          ? description.targetName
          : description.targetName,
        clinicalContext: description.clinicalContext
      }];
    });
  };

  // 1. Resolve explicitly parsed DATUM / DATUM_FEATURE
  for (const d of parsedDatums) {
    const resolvedTargets = uniqueGeometryTargets(resolveTargetsForId(d.targetId));
    const resolved = resolvedTargets[0];
    if (resolved) {
      const semanticFeatureIds = getSemanticDatumFeatureIds(d.entityId);
      const presentationTargetPoint = [d.entityId, ...semanticFeatureIds]
        .map(getPresentationLandingPointForShapeAspect)
        .find((point): point is { x: number; y: number; z: number } => !!point) ||
        getDatumPresentationLandingPointByIdentifier(d.identifier);
      d.targetId = resolved;
      d.targetIds = resolvedTargets;
      d.semanticTargetIds = resolvedTargets;
      d.presentationTargetPoint = presentationTargetPoint;
      d.targetSource = "semantic";
      const description = describeDerivedDatum(d.identifier, resolved, resolvedTargets, []);
      d.type = description.typeStr;
      d.targetName = description.targetName;
      d.derivedDatum = isMedianPlaneDatumFeature([], resolvedTargets) ? "medianPlane" : undefined;
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
          derivedDatum: isMedianPlaneDatumFeature([annId], selectedTargets) ? "medianPlane" : undefined,
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
  const ap242SemanticDatums = buildAp242SemanticDatums();

  // Fallback to rich inferred tolerances if the STEP file did not contain explicit geometric annotations
  let finalTolerances = sfaSemanticTolerances.length > 0 ? sfaSemanticTolerances : (parsedTolerances.length > 0 ? parsedTolerances : []);

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
      return {
        id: `PMI-DTM-${index + 1}`,
        entityId: sortedTargets.map((target) => target.entityId).join(","),
        name: `Datum ${identifier}`,
        identifier,
        type: "Datum Target Set",
        symbol: `[ ${identifier} ]`,
        targetId: primaryTarget.targetId,
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

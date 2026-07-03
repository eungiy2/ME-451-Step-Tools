export enum RuleCategory {
  GEOMETRY = "geometry",
  ASSEMBLY = "assembly",
  DOCUMENTATION = "documentation",
  BOM = "bom"
}

export enum TargetFeature {
  PLATE_THICKNESS = "plate_thickness",
  HOLE_DIAMETER = "hole_diameter",
  HOLE_COUNT = "hole_count",
  EDGE_DISTANCE = "edge_distance",
  MATERIAL = "material",
  PART_NUMBER = "part_number",
  COMPONENTS = "components",
  SCREW_COMPATIBILITY = "screw_compatibility",
  MANUFACTURING_NOTES = "manufacturing_notes"
}

export interface Rule {
  id: string;
  name: string;
  category: RuleCategory;
  description: string;
  targetFeature: TargetFeature;
  operator: "min" | "max" | "exact" | "contains" | "match";
  thresholdValue: string | number;
  metric: string;
  severity: "minor" | "major" | "critical";
  enabled: boolean;
}

// 3D Geometry vertices and elements to render the implant
export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface Hole3D {
  id: string;
  center: Point3D;
  diameter: number;
  edgeDistance: number; // minimum distance to perimeter edge
}

export interface GeometryPRT {
  partNumber: string;
  thicknessProfile: {
    points: Point3D[];
    thicknessValues: number[]; // thickness calculated at each vertex
  };
  holes: Hole3D[];
  perimeter: Point3D[]; // outer shape control vertices
}

export interface AssemblyASM {
  assemblyNumber: string;
  platePartNumber: string;
  screws: {
    id: string;
    type: string; // e.g., "M2.0 locking screw", "M1.5 trauma screw"
    diameter: number;
    length: number;
    insertedInHoleId: string;
    screwFamily: string; // e.g. "M2.0"
  }[];
}

export interface DrawingDRW {
  docNumber: string;
  revision: string;
  title: string;
  partNumber: string;
  material: string;
  thickness: number; // specified thickness in drawing
  notes: string[];
  drawingInSync: boolean;
}

export interface BomItem {
  itemNumber: number;
  partNumber: string;
  description: string;
  quantity: number;
  material: string;
}

export interface CadPackage {
  id: string;
  name: string;
  family: string;
  description: string;
  prt: GeometryPRT;
  asm: AssemblyASM;
  drw: DrawingDRW;
  bom: BomItem[];
}

export interface InspectionCheckResult {
  ruleId: string;
  ruleName: string;
  category: RuleCategory;
  targetFeature: TargetFeature;
  passed: boolean;
  actualValue: string | number;
  expectedValue: string | number;
  severity: "minor" | "major" | "critical" | "ok";
  message: string;
  detailCoordinates?: Point3D[]; // 3D point(s) where violation was detected to highlight
}


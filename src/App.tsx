import { useState, useEffect, useRef } from "react";
import { 
  Upload, 
  RefreshCw, 
  XCircle,
  Layers,
  HelpCircle,
  Copy,
  Cpu,
  Compass,
  Sparkles,
  Sliders,
  Ruler
} from "lucide-react";
import { parseStepFile, generateSampleStepText, StepParseResult } from "./utils/stepParser";
import { parseStepWithOcct } from "./utils/stepOcctParser";
import { loadOcct } from "./utils/occtLoader";
import { autoGenerateFaceMapping, classifyBRepFaces } from "./utils/geometryClassifier";
import CadCanvas3D from "./components/CadCanvas3D";
import * as THREE from "three";

// High-fidelity procedural generator that builds multiple discrete, selectable B-Rep Faces and Edges
// This models a real OpenCascades CAD output with perfect monolithic extrusion topology.
function generateProceduralReconPlate(
  precision: number,
  segmentsCount: number = 5,
  plateThickness: number = 1.3,
  plateWidth: number = 3.6,
  screwHoleRadius: number = 0.95,
  radialDivisions?: number
): any {
  const meshes: any[] = [];
  const lines: any[] = [];

  const segmentLength = 5.0; // Spacing of holes
  const divs = radialDivisions ?? Math.max(24, Math.min(64, Math.round(28 / precision)));

  // X positions of segment centers
  const getXOfSegment = (s: number) => (s - (segmentsCount - 1) / 2) * segmentLength;
  const X_min = getXOfSegment(0);
  const X_max = getXOfSegment(segmentsCount - 1);
  const W_half = plateWidth / 2;

  // Let's define the outer width of the plate at any coordinate x
  // We want the width to be thinnest midway between holes, and widest at the holes.
  const W_outer = (x: number) => {
    if (x <= X_min) return W_half;
    if (x >= X_max) return W_half;

    // We want a sweet wavy outline
    // widest (W_half) at hole centers: x_s = X_min + s * segmentLength
    const phase = ((x - X_min) / segmentLength) * Math.PI * 2;
    const notchDepth = W_half * 0.35; // 35% reduction in width between holes
    const amplitude = notchDepth / 2;
    const mean = W_half - amplitude;
    return mean + amplitude * Math.cos(phase);
  };

  // 1. Generate 2D outer loop of points
  const perimeter2DPoints: { x: number; y: number }[] = [];
  const stepsOnStraight = 100;
  const stepsOnCap = 30;

  // (a) Bottom straight notched edge (left to right)
  for (let i = 0; i < stepsOnStraight; i++) {
    const t = i / stepsOnStraight;
    const x = X_min + t * (X_max - X_min);
    perimeter2DPoints.push({ x: x, y: -W_outer(x) });
  }

  // (b) Right Cap
  for (let i = 0; i < stepsOnCap; i++) {
    const t = i / stepsOnCap;
    const theta = -Math.PI / 2 + t * Math.PI;
    const x = X_max + W_half * Math.cos(theta);
    const y = W_half * Math.sin(theta);
    perimeter2DPoints.push({ x: x, y: y });
  }

  // (c) Top straight notched edge (right to left)
  for (let i = 0; i < stepsOnStraight; i++) {
    const t = i / stepsOnStraight;
    const x = X_max - t * (X_max - X_min);
    perimeter2DPoints.push({ x: x, y: W_outer(x) });
  }

  // (d) Left Cap
  for (let i = 0; i < stepsOnCap; i++) {
    const t = i / stepsOnCap;
    const theta = Math.PI / 2 + t * Math.PI;
    const x = X_min + W_half * Math.cos(theta);
    const y = W_half * Math.sin(theta);
    perimeter2DPoints.push({ x: x, y: y });
  }

  // 2. Build THREE.Shape for the 2D triangulation
  const shape = new THREE.Shape();
  shape.moveTo(perimeter2DPoints[0].x, perimeter2DPoints[0].y);
  for (let i = 1; i < perimeter2DPoints.length; i++) {
    shape.lineTo(perimeter2DPoints[i].x, perimeter2DPoints[i].y);
  }
  shape.closePath();

  // Add circular hole cutouts
  for (let s = 0; s < segmentsCount; s++) {
    const holePath = new THREE.Path();
    const sX = getXOfSegment(s);
    // Walk circular arc CCW (order is crucial for Three's ear-clipping logic)
    holePath.moveTo(sX + screwHoleRadius, 0);
    for (let r = 1; r <= divs; r++) {
      const theta = (r / divs) * Math.PI * 2;
      holePath.lineTo(sX + screwHoleRadius * Math.cos(theta), screwHoleRadius * Math.sin(theta));
    }
    shape.holes.push(holePath);
  }

  // Use THREE.ShapeGeometry to perform standard ear clipping triangulation
  const shapeGeometry = new THREE.ShapeGeometry(shape);
  const posAttr = shapeGeometry.getAttribute("position");
  const indexAttr = shapeGeometry.getIndex();

  const count = posAttr.count;

  // -- Top Face (Planar Z = thickness/2)
  const topPositions = new Float32Array(count * 3);
  const topNormals = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    topPositions[3 * i] = posAttr.getX(i);
    topPositions[3 * i + 1] = posAttr.getY(i);
    topPositions[3 * i + 2] = plateThickness / 2;

    topNormals[3 * i] = 0;
    topNormals[3 * i + 1] = 0;
    topNormals[3 * i + 2] = 1;
  }
  const topIndicesList: number[] = [];
  if (indexAttr) {
    for (let i = 0; i < indexAttr.count; i++) {
      topIndicesList.push(indexAttr.getX(i));
    }
  }
  meshes.push({
    positions: topPositions,
    normals: topNormals,
    indices: new Uint32Array(topIndicesList),
    color: [0.65, 0.70, 0.76],
    name: "Plate Continuous Solid Top Face"
  });

  // -- Bottom Face (Planar Z = -thickness/2)
  const botPositions = new Float32Array(count * 3);
  const botNormals = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    botPositions[3 * i] = posAttr.getX(i);
    botPositions[3 * i + 1] = posAttr.getY(i);
    botPositions[3 * i + 2] = -plateThickness / 2;

    botNormals[3 * i] = 0;
    botNormals[3 * i + 1] = 0;
    botNormals[3 * i + 2] = -1;
  }
  const botIndicesList: number[] = [];
  if (indexAttr) {
    for (let i = 0; i < indexAttr.count; i += 3) {
      // Keep triangle winding facing downward
      botIndicesList.push(indexAttr.getX(i));
      botIndicesList.push(indexAttr.getZ(i));
      botIndicesList.push(indexAttr.getY(i));
    }
  }
  meshes.push({
    positions: botPositions,
    normals: botNormals,
    indices: new Uint32Array(botIndicesList),
    color: [0.60, 0.65, 0.70],
    name: "Plate Continuous Solid Bottom Face"
  });

  // Release Shape Geometry
  shapeGeometry.dispose();

  // -- Cylindrical walls for each screw hole
  for (let s = 0; s < segmentsCount; s++) {
    const sX = getXOfSegment(s);
    const cylPositions: number[] = [];
    const cylNormals: number[] = [];
    const cylIndices: number[] = [];

    for (let r = 0; r <= divs; r++) {
      const theta = (r / divs) * Math.PI * 2;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);

      const innerX = sX + screwHoleRadius * cos;
      const innerY = screwHoleRadius * sin;

      cylPositions.push(innerX, innerY, plateThickness / 2);
      cylPositions.push(innerX, innerY, -plateThickness / 2);

      cylNormals.push(-cos, -sin, 0); // Pointing inside the hole
      cylNormals.push(-cos, -sin, 0);
    }

    for (let r = 0; r < divs; r++) {
      const p1 = 2 * r;
      const p2 = 2 * r + 1;
      const p3 = 2 * (r + 1);
      const p4 = 2 * (r + 1) + 1;

      cylIndices.push(p1, p3, p2);
      cylIndices.push(p2, p3, p4);
    }

    meshes.push({
      positions: new Float32Array(cylPositions),
      normals: new Float32Array(cylNormals),
      indices: new Uint32Array(cylIndices),
      color: [0.85, 0.60, 0.20], // Anodized gold
      name: `Locking Bore Cylindrical Face ${s + 1}`
    });
  }

  // -- Wavy outer vertical side walls
  const sidePositions: number[] = [];
  const sideNormals: number[] = [];
  const sideIndices: number[] = [];

  const M = perimeter2DPoints.length;
  for (let i = 0; i < M; i++) {
    const pt = perimeter2DPoints[i];
    sidePositions.push(pt.x, pt.y, plateThickness / 2);
    sidePositions.push(pt.x, pt.y, -plateThickness / 2);

    // Dynamic normal computation
    const ptPrev = perimeter2DPoints[(i - 1 + M) % M];
    const ptNext = perimeter2DPoints[(i + 1) % M];

    const dx = ptNext.x - ptPrev.x;
    const dy = ptNext.y - ptPrev.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1.0;

    const nx = dy / len;
    const ny = -dx / len;

    sideNormals.push(nx, ny, 0);
    sideNormals.push(nx, ny, 0);
  }

  for (let i = 0; i < M; i++) {
    const p1 = 2 * i;
    const p2 = 2 * i + 1;
    const p3 = 2 * ((i + 1) % M);
    const p4 = 2 * ((i + 1) % M) + 1;

    sideIndices.push(p1, p2, p3);
    sideIndices.push(p2, p4, p3);
  }

  meshes.push({
    positions: new Float32Array(sidePositions),
    normals: new Float32Array(sideNormals),
    indices: new Uint32Array(sideIndices),
    color: [0.55, 0.60, 0.66],
    name: "Plate Solid Outer Side Face"
  });

  // -- Outer perimeter outline edges
  const outerTopLinesPos: number[] = [];
  const outerTopLinesInds: number[] = [];
  const outerBotLinesPos: number[] = [];
  const outerBotLinesInds: number[] = [];

  for (let i = 0; i < M; i++) {
    const pt = perimeter2DPoints[i];
    outerTopLinesPos.push(pt.x, pt.y, plateThickness / 2);
    outerBotLinesPos.push(pt.x, pt.y, -plateThickness / 2);

    outerTopLinesInds.push(i, (i + 1) % M);
    outerBotLinesInds.push(i, (i + 1) % M);
  }

  lines.push({
    positions: new Float32Array(outerTopLinesPos),
    indices: new Uint32Array(outerTopLinesInds),
    name: "Plate Outer Perimeter Top Edge"
  });

  lines.push({
    positions: new Float32Array(outerBotLinesPos),
    indices: new Uint32Array(outerBotLinesInds),
    name: "Plate Outer Perimeter Bottom Edge"
  });

  // -- Circular hole rim outlines
  for (let s = 0; s < segmentsCount; s++) {
    const sX = getXOfSegment(s);
    const rimTopPos: number[] = [];
    const rimTopInds: number[] = [];
    const rimBotPos: number[] = [];
    const rimBotInds: number[] = [];

    for (let r = 0; r <= divs; r++) {
      const theta = (r / divs) * Math.PI * 2;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);

      const innerX = sX + screwHoleRadius * cos;
      const innerY = screwHoleRadius * sin;

      rimTopPos.push(innerX, innerY, plateThickness / 2);
      rimBotPos.push(innerX, innerY, -plateThickness / 2);

      if (r < divs) {
        rimTopInds.push(r, r + 1);
        rimBotInds.push(r, r + 1);
      }
    }

    lines.push({
      positions: new Float32Array(rimTopPos),
      indices: new Uint32Array(rimTopInds),
      name: `Locking Bore Top Circular Edge ${s + 1}`
    });

    lines.push({
      positions: new Float32Array(rimBotPos),
      indices: new Uint32Array(rimBotInds),
      name: `Locking Bore Bottom Circular Edge ${s + 1}`
    });
  }

  return { success: true, meshes, lines };
}

export default function App() {
  // Client Loader States
  const [occtInstalled, setOcctInstalled] = useState<boolean>(false);
  const [isWasmLoading, setIsWasmLoading] = useState<boolean>(true);
  const [stepText, setStepText] = useState<string>("");
  const [parsedMetadata, setParsedMetadata] = useState<StepParseResult | null>(null);
  
  // CAD graphics sources
  const [occtParsedResult, setOcctParsedResult] = useState<any>(null);
  const [isTessellating, setIsTessellating] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [fileName, setFileName] = useState<string>("surgical_mandible_plate_5x.stp");
  const [rawFileSize, setRawFileSize] = useState<number>(14532);
  
  // Sticky click selection & Hover tracking
  const [hoveredEntity, setHoveredEntity] = useState<any | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<any | null>(null);
  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null);
  const [focusEntityRequest, setFocusEntityRequest] = useState<{ id: string; nonce: number; preferAxisView?: boolean } | null>(null);
  const [mobileView, setMobileView] = useState<"viewport" | "inspector">("viewport");
  
  // Dynamic B-Rep STEP face pairing & alignment override state
  const [customFaceMapping, setCustomFaceMapping] = useState<Record<string, string>>({});
  const [bindingMode, setBindingMode] = useState<{ type: "datum" | "tolerance"; id: string; targetId: string; label?: string } | null>(null);
  const [activeTab, setActiveTab] = useState<"params" | "brep" | "steptree" | "tolerances">("brep");
  const [stepSearch, setStepSearch] = useState<string>("");
  const [toleranceSearch, setToleranceSearch] = useState<string>("");
  const [toleranceCategory, setToleranceCategory] = useState<string>("All");

  // Discretization & Geometry Parameter States for medical planning config
  const [linearDeflection, setLinearDeflection] = useState<number>(0.12);
  const [angularDeflection, setAngularDeflection] = useState<number>(0.45);
  const [radialDivisions, setRadialDivisions] = useState<number>(28);
  const [segmentsCount, setSegmentsCount] = useState<number>(5);
  const [plateWidth, setPlateWidth] = useState<number>(3.6);
  const [plateThickness, setPlateThickness] = useState<number>(1.3);
  const [screwHoleRadius, setScrewHoleRadius] = useState<number>(0.95);
  const [uploadedBytes, setUploadedBytes] = useState<Uint8Array | null>(null);

  // Graphical viewport preferences
  const [viewMode, setViewMode] = useState<"solid" | "wireframe" | "points" | "xray">("solid");
  const [wireframeOverlay, setWireframeOverlay] = useState<boolean>(false);
  const [materialType, setMaterialType] = useState<"titanium" | "gold" | "chrome" | "carbon">("titanium");
  const [autoRotate, setAutoRotate] = useState<boolean>(false);
  const [measurementMode, setMeasurementMode] = useState<boolean>(false);
  const [presetResetNonce, setPresetResetNonce] = useState<number>(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Dynamic Open Cascade kernel initialization
  useEffect(() => {
    async function initOpenCascade() {
      try {
        setIsWasmLoading(true);
        await loadOcct();
        setOcctInstalled(true);
      } catch (err) {
        console.warn("Cascade kernel WASM offline fallback triggered:", err);
      } finally {
        setIsWasmLoading(false);
        loadDefaultPreset();
      }
    }
    initOpenCascade();
  }, []);

  // Reactive rebuilding CAD solver
  useEffect(() => {
    const handleRebuild = async () => {
      setIsTessellating(true);
      setErrorMsg("");
      
      try {
        if (uploadedBytes) {
          // If we have an uploaded custom STEP file, retessellate it using Cascade core in WASM!
          const result = await parseStepWithOcct(uploadedBytes, {
            linearDeflection: Number(linearDeflection),
            angularDeflection: Number(angularDeflection)
          });
          
          if (result && result.success && result.meshes && result.meshes.length > 0) {
            setOcctParsedResult(result);
          } else {
            // Procedural fallback with exact custom geometry dimensions
            const fallback = generateProceduralReconPlate(
              linearDeflection,
              segmentsCount,
              plateThickness,
              plateWidth,
              screwHoleRadius,
              radialDivisions
            );
            setOcctParsedResult(fallback);
          }
        } else {
          // Normal interactive procedural generation
          const result = generateProceduralReconPlate(
            linearDeflection,
            segmentsCount,
            plateThickness,
            plateWidth,
            screwHoleRadius,
            radialDivisions
          );
          setOcctParsedResult(result);

          // Build dynamic metadata and mock STEP text
          const text = generateSampleStepText(`SURGICAL-MANDIBLE-PLATE-${segmentsCount}X`);
          setStepText(text);
          setRawFileSize(text.length);

          const meta = parseStepFile(`surgical_mandible_plate_${segmentsCount}x.stp`, text);
          setParsedMetadata(meta);
        }
      } catch (err: any) {
        console.error("Reconstruction rebuild exception:", err);
        setErrorMsg("Deflection boundaries caused tessellation solver mismatch.");
      } finally {
        setIsTessellating(false);
      }
    };

    const handler = setTimeout(handleRebuild, 80);
    return () => clearTimeout(handler);
  }, [
    linearDeflection, 
    angularDeflection, 
    radialDivisions, 
    segmentsCount, 
    plateWidth, 
    plateThickness, 
    screwHoleRadius, 
    uploadedBytes,
    presetResetNonce
  ]);

  // Reactively auto-align STEP topological anchors to 3D B-Rep faces using advanced geometric classification!
  useEffect(() => {
    if (occtParsedResult && occtParsedResult.meshes && parsedMetadata) {
      const mapped = autoGenerateFaceMapping(
        occtParsedResult.meshes,
        parsedMetadata.rawText
      );
      setCustomFaceMapping(mapped);
    } else {
      setCustomFaceMapping({});
    }
  }, [occtParsedResult, parsedMetadata]);

  // Standard preset models
  const loadDefaultPreset = () => {
    setIsTessellating(true);
    setErrorMsg("");
    setSelectedEntity(null);
    setHoveredEntity(null);
    setUploadedBytes(null);
    setFileName("surgical_mandible_plate_5x.stp");
    
    // Restore default geometry parameters
    setLinearDeflection(0.12);
    setAngularDeflection(0.45);
    setRadialDivisions(28);
    setSegmentsCount(5);
    setPlateWidth(3.6);
    setPlateThickness(1.3);
    setScrewHoleRadius(0.95);

    // Reset view controls to seamless solid presets
    setViewMode("solid");
    setWireframeOverlay(false);
    setMaterialType("titanium");
    setAutoRotate(false);
    setPresetResetNonce((nonce) => nonce + 1);
  };

  // Upload custom .STP/.STEP CAD file
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsTessellating(true);
    setErrorMsg("");
    setSelectedEntity(null);
    setHoveredEntity(null);
    setFileName(file.name);
    setRawFileSize(file.size);

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const buffer = event.target?.result as ArrayBuffer;
          const u8Array = new Uint8Array(buffer);

          // Decode text block for summary stats
          const decoder = new TextDecoder("utf-8");
          const decodedText = decoder.decode(u8Array);
          setStepText(decodedText);

          // Store bytes in state to trigger reactive parsing
          setUploadedBytes(u8Array);

          const meta = parseStepFile(file.name, decodedText);
          setParsedMetadata(meta);

        } catch (err: any) {
          console.error("Open Cascade read failure:", err);
          setErrorMsg(err.message || "Failed to load STEP byte structure.");
        } finally {
          setIsTessellating(false);
        }
      };
      reader.readAsArrayBuffer(file);
    } catch (err: any) {
      setErrorMsg("File array buffer reading aborted.");
      setIsTessellating(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="h-screen w-screen bg-slate-50 text-slate-800 flex flex-col font-sans selection:bg-blue-100 selection:text-blue-900 overflow-hidden" id="app_root_viewport">
      
      {/* 1. Medical App Header Navigation */}
      <header className="bg-white border-b border-slate-200/80 px-4 py-3 sm:px-6 sm:py-3.5 shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0 shadow-xs z-40">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-md shadow-blue-500/10">
            <Layers className="w-4.5 h-4.5" />
          </div>
          <div>
            <h1 className="text-xs sm:text-sm font-black uppercase tracking-wider text-slate-900 flex flex-wrap items-center gap-1.5 sm:gap-2">
              STEP CAD/CAM Tools
            </h1>
            <p className="text-[9px] sm:text-[10px] text-slate-500 font-mono mt-0.5">B-Rep tolerance and manufacturing analysis of mechanical parts</p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 sm:gap-3 font-mono text-[11px] w-full sm:w-auto">
          {isWasmLoading ? (
            <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200 text-amber-600 font-bold w-full sm:w-auto justify-center">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              Initializing OCCT kernel...
            </div>
          ) : (
            <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto justify-between sm:justify-start">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="bg-blue-600 hover:bg-blue-700 text-white px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 sm:gap-2 cursor-pointer shadow-sm shadow-blue-600/10 font-sans"
                id="header_file_import_button"
              >
                <Upload className="w-3.5 h-3.5" />
                Import STEP
              </button>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                accept=".stp,.step" 
                className="hidden" 
              />
              <div className="flex items-center gap-1.5 sm:gap-2 bg-emerald-50 px-2.5 py-1.5 rounded-lg border border-emerald-100 text-emerald-700">
                <Cpu className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
                <span className="font-bold text-[10px] sm:text-[11px]">CAD Online</span>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Mobile Workspace Mode Switcher (Only visible below lg breakpoint) */}
      <div className="lg:hidden shrink-0 bg-slate-50 border-b border-slate-200/80 p-2 flex gap-1.5 z-30">
        <button
          onClick={() => setMobileView("viewport")}
          className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
            mobileView === "viewport"
              ? "bg-blue-600 text-white shadow-sm shadow-blue-500/15 font-black font-sans"
              : "bg-white text-slate-600 hover:text-slate-800 border border-slate-200 hover:bg-slate-150/50"
          }`}
          id="mobile_mode_viewport_btn"
        >
          <Sparkles className="w-3.5 h-3.5" />
          3D CAD Viewport
        </button>
        <button
          onClick={() => setMobileView("inspector")}
          className={`flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
            mobileView === "inspector"
              ? "bg-blue-600 text-white shadow-sm shadow-blue-500/15 font-black font-sans"
              : "bg-white text-slate-600 hover:text-slate-800 border border-slate-200 hover:bg-slate-150/50"
          }`}
          id="mobile_mode_inspector_btn"
        >
          <Compass className="w-3.5 h-3.5" />
          B-Rep & PMI ({parsedMetadata?.tolerances?.length ?? 12})
        </button>
      </div>

      {/* 2. Workspace Viewport Grid */}
      <main className="flex-1 min-h-0 flex flex-col lg:flex-row relative">
        
        {/* Main 3D Stage bounds: occupies all flex remaining space */}
        <div className={`relative min-h-0 min-w-0 w-full ${
          mobileView === "viewport" 
            ? "flex-1 h-full flex flex-col" 
            : "hidden lg:flex lg:flex-col lg:flex-1 lg:h-full"
        }`}>
          {bindingMode && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-blue-600 text-white backdrop-blur-md px-4 py-2.5 rounded-full shadow-lg border border-blue-500/30 z-30 flex items-center gap-3 animate-bounce">
              <span className="w-2 h-2 rounded-full bg-white animate-ping" />
              <div className="text-xs font-semibold font-sans tracking-wide">
                <span>Click any 3D Face on the model to bind to {bindingMode.type === "datum" ? `Datum [${bindingMode.label}]` : "Tolerance Feature"} ({bindingMode.targetId})</span>
              </div>
              <button 
                onClick={() => setBindingMode(null)}
                className="bg-blue-800 hover:bg-blue-900 border border-blue-400/20 text-blue-100 text-[10px] font-bold px-2 py-0.5 rounded-full transition cursor-pointer"
              >
                CANCEL
              </button>
            </div>
          )}
          <CadCanvas3D
            occtResult={occtParsedResult}
            isLoading={isTessellating}
            viewMode={viewMode}
            wireframeOverlay={wireframeOverlay}
            materialType={materialType}
            autoRotate={autoRotate}
            selectedEntityId={selectedEntity ? selectedEntity.id : null}
            selectedRelatedEntityIds={selectedEntity?.relatedFaces || []}
            hoveredEntityId={hoveredEntityId}
            focusEntityRequest={focusEntityRequest}
            measurementMode={measurementMode && !bindingMode}
            selectionClickEnabled={!measurementMode || !!bindingMode}
            onSelectEntity={(entity) => {
              if (bindingMode && entity && entity.id.startsWith("BRepFace-")) {
                const targetKey = bindingMode.targetId;
                setCustomFaceMapping(prev => {
                  const updated = { ...prev, [targetKey]: entity.id };
                  if (bindingMode.type === "datum" && bindingMode.label) {
                    updated[bindingMode.label] = entity.id;
                  }
                  return updated;
                });
                setBindingMode(null);
                return;
              }
              setSelectedEntity(entity);
              if (entity) {
                setMobileView("inspector");
                if (entity.id.startsWith("BRepFace-") || entity.id.startsWith("BRepEdge-")) {
                  setActiveTab("brep");
                }
              }
            }}
            onHoverEntity={(entity) => {
              if (!selectedEntity) {
                setHoveredEntity(entity);
              }
              if (!entity || entity.source !== "viewport") {
                setHoveredEntityId(entity ? entity.id : null);
              }
            }}
            datums={parsedMetadata?.datums}
            datumTargets={parsedMetadata?.datumTargets}
            faceRecords={parsedMetadata?.faceRecords}
            cylinderIds={parsedMetadata?.cylinderIds}
            customFaceMapping={customFaceMapping}
          />

          {/* FLOATING VIEWPORT UTILITY DECK */}
          <div className="absolute bottom-3 sm:bottom-4 left-3 right-3 lg:left-1/2 lg:right-auto lg:-translate-x-1/2 lg:w-[min(56rem,calc(100%-2rem))] bg-white/95 backdrop-blur-md px-2 py-2 rounded-xl border border-slate-200/80 shadow-lg z-30 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 select-none overflow-hidden">
            {/* Wireframe overlay toggle */}
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/80 px-1.5 py-1 shrink-0">
              <span className="hidden md:inline text-[9px] font-black text-slate-400 font-mono tracking-wider uppercase">Wire</span>
              <button
                onClick={() => setWireframeOverlay(!wireframeOverlay)}
                className={`px-1.5 sm:px-2 py-0.5 rounded-md text-[9.5px] font-bold font-mono transition flex items-center gap-1.5 cursor-pointer ${
                  wireframeOverlay
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {wireframeOverlay ? "ON" : "OFF"}
              </button>
            </div>

            {/* View Mode selector */}
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/80 px-1.5 py-1 min-w-0">
              <span className="hidden md:inline text-[9px] font-black text-slate-400 font-mono tracking-wider uppercase">Render</span>
              <div className="flex flex-wrap bg-slate-100 p-0.5 rounded-lg border border-slate-200 gap-0.5">
                {(["solid", "wireframe", "points", "xray"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={`px-1.5 sm:px-2 py-0.5 rounded-md text-[9.5px] font-bold font-mono transition cursor-pointer ${
                      viewMode === mode
                        ? "bg-white text-blue-600 shadow-xs"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {mode.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Material selector */}
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/80 px-1.5 py-1 min-w-0">
              <span className="hidden md:inline text-[9px] font-black text-slate-400 font-mono tracking-wider uppercase">Mat</span>
              <div className="flex flex-wrap bg-slate-100 p-0.5 rounded-lg border border-slate-200 gap-0.5">
                {(["titanium", "gold", "chrome", "carbon"] as const).map((mat) => (
                  <button
                    key={mat}
                    onClick={() => setMaterialType(mat)}
                    className={`px-1.5 sm:px-2 py-0.5 rounded-md text-[9.5px] font-bold font-mono transition cursor-pointer ${
                      materialType === mat
                        ? "bg-white text-blue-600 shadow-xs"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {mat.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Auto Spin Toggle */}
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/80 px-1.5 py-1 shrink-0">
              <span className="hidden md:inline text-[9px] font-black text-slate-400 font-mono tracking-wider uppercase">Measure</span>
              <button
                onClick={() => setMeasurementMode(!measurementMode)}
                title="Measure distance between two picked model points"
                className={`px-2 py-0.5 rounded-md text-[9.5px] font-bold font-mono transition cursor-pointer flex items-center gap-1.5 ${
                  measurementMode
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                <Ruler className="w-3 h-3" />
                {measurementMode ? "ON" : "OFF"}
              </button>
            </div>

            {/* Auto Spin Toggle */}
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/80 px-1.5 py-1 shrink-0">
              <span className="hidden md:inline text-[9px] font-black text-slate-400 font-mono tracking-wider uppercase">Spin</span>
              <button
                onClick={() => setAutoRotate(!autoRotate)}
                className={`px-2 py-0.5 rounded-md text-[9.5px] font-bold font-mono transition cursor-pointer ${
                  autoRotate
                    ? "bg-blue-600 text-white shadow-sm animate-pulse"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {autoRotate ? "ON" : "OFF"}
              </button>
            </div>
          </div>
        </div>

        {/* Right Column sidebar: dedicated to interactive B-Rep hierarchy, Parametric CAD sliders, and STEP file diagnostics */}
        <div className={`h-full w-full max-w-full min-w-0 lg:w-96 lg:basis-[24rem] lg:min-w-[24rem] lg:max-w-[24rem] shrink-0 border-t lg:border-t-0 lg:border-l border-slate-200 bg-white p-4 sm:p-5 flex flex-col gap-4 sm:gap-5 overflow-hidden shadow-sm z-10 ${
          mobileView === "inspector" 
            ? "flex-1 flex" 
            : "hidden lg:flex"
        }`}>
          
          {/* Active File descriptor card with Reset control */}
          <div className="border-b border-slate-100 pb-3 flex flex-row items-center justify-between shrink-0">
            <div className="flex flex-col gap-0.5 max-w-[70%]">
              <span className="text-[9px] text-blue-600 font-bold uppercase tracking-widest font-mono">ACTIVE SOURCE</span>
              <h2 className="text-xs font-bold text-slate-800 truncate" title={fileName}>
                {fileName}
              </h2>
              <span className="text-[10px] text-slate-500 font-mono">
                {(rawFileSize / 1024).toFixed(1)} KB FILE SIZE
              </span>
            </div>
            <button
              onClick={loadDefaultPreset}
              className="px-2.5 py-1 text-[11px] font-bold text-blue-600 hover:text-blue-700 bg-blue-50 border border-blue-100 rounded hover:bg-blue-100/70 transition cursor-pointer"
            >
              Reset Setup
            </button>
          </div>

          {/* TAB DECK HEADERS */}
          <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 shrink-0 gap-0.5">
            <button
              onClick={() => setActiveTab("brep")}
              className={`flex-1 py-1.5 px-1 rounded-md text-[9.5px] font-bold font-sans transition cursor-pointer text-center ${
                activeTab === "brep" ? "bg-white text-blue-600 shadow-xs" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              B-Rep
            </button>
            <button
              onClick={() => setActiveTab("params")}
              className={`flex-1 py-1.5 px-1 rounded-md text-[9.5px] font-bold font-sans transition cursor-pointer text-center ${
                activeTab === "params" ? "bg-white text-blue-600 shadow-xs" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Param
            </button>
            <button
              onClick={() => setActiveTab("steptree")}
              className={`flex-1 py-1.5 px-1 rounded-md text-[9.5px] font-bold font-sans transition cursor-pointer text-center ${
                activeTab === "steptree" ? "bg-white text-blue-600 shadow-xs" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              STEP Code
            </button>
            <button
              onClick={() => setActiveTab("tolerances")}
              className={`flex-1 py-1.5 px-1 rounded-md text-[9.5px] font-bold font-sans transition cursor-pointer text-center ${
                activeTab === "tolerances" ? "bg-white text-blue-600 shadow-xs" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Tolerances
            </button>
          </div>

          {/* TAB CONTENTS CONTAINER (SCROLLABLE CLUSTERS) */}
          <div className="flex-1 overflow-y-auto pr-1 min-h-0 min-w-0">
            {activeTab === "brep" && (
              <div className="space-y-4 flex flex-col h-full min-h-0">
                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest font-mono block">
                  B-Rep Pick Inspector
                </span>
                
                <div className="space-y-4 flex-1 overflow-y-auto pr-1">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-md border border-blue-100 bg-blue-50 px-2 py-2">
                      <div className="text-[8px] font-black uppercase tracking-wider text-blue-500 font-mono">Faces</div>
                      <div className="text-sm font-black text-blue-700 font-mono">{occtParsedResult?.meshes?.length ?? 0}</div>
                    </div>
                    <div className="rounded-md border border-cyan-100 bg-cyan-50 px-2 py-2">
                      <div className="text-[8px] font-black uppercase tracking-wider text-cyan-600 font-mono">Edges</div>
                      <div className="text-sm font-black text-cyan-700 font-mono">{occtParsedResult?.lines?.length ?? 0}</div>
                    </div>
                    <div className="rounded-md border border-violet-100 bg-violet-50 px-2 py-2">
                      <div className="text-[8px] font-black uppercase tracking-wider text-violet-500 font-mono">Loops</div>
                      <div className="text-sm font-black text-violet-700 font-mono">{occtParsedResult?.loops?.length ?? 0}</div>
                    </div>
                  </div>

                  {selectedEntity ? (
                    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 font-mono">Selected B-Rep Entity</span>
                        <span className={`rounded px-1.5 py-0.5 text-[8px] font-black uppercase font-mono ${
                          selectedEntity.type === "face" ? "bg-blue-50 text-blue-700" : "bg-cyan-50 text-cyan-700"
                        }`}>
                          {selectedEntity.type}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-black text-slate-800 font-mono" title={selectedEntity.name}>
                          {selectedEntity.name}
                        </div>
                        <div className="mt-0.5 truncate text-[10px] font-bold text-slate-500 font-mono" title={selectedEntity.id}>
                          {selectedEntity.id}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                        {selectedEntity.type === "face" ? (
                          <>
                            <div className="rounded border border-slate-100 bg-slate-50 p-1.5">
                              <span className="block text-[8px] font-black uppercase text-slate-400">Triangles</span>
                              <span className="font-black text-slate-800">{selectedEntity.triangles ?? "n/a"}</span>
                            </div>
                            <div className="rounded border border-slate-100 bg-slate-50 p-1.5">
                              <span className="block text-[8px] font-black uppercase text-slate-400">Area</span>
                              <span className="font-black text-slate-800">{selectedEntity.area ?? "n/a"} mm²</span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="rounded border border-slate-100 bg-slate-50 p-1.5">
                              <span className="block text-[8px] font-black uppercase text-slate-400">Length</span>
                              <span className="font-black text-slate-800">{selectedEntity.length ?? "n/a"} mm</span>
                            </div>
                            <div className="rounded border border-slate-100 bg-slate-50 p-1.5">
                              <span className="block text-[8px] font-black uppercase text-slate-400">Parent Faces</span>
                              <span className="font-black text-slate-800">
                                {selectedEntity.parentFaceIndices?.length
                                  ? selectedEntity.parentFaceIndices.map((faceIdx: number) => `F${faceIdx + 1}`).join(", ")
                                  : "n/a"}
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                      {selectedEntity.point && (
                        <div className="grid grid-cols-3 gap-2 text-[10px] font-mono">
                          {(["x", "y", "z"] as const).map((axis) => (
                            <div key={axis} className="rounded border border-slate-100 bg-slate-50 p-1.5">
                              <span className="block text-[8px] font-black uppercase text-slate-400">{axis}</span>
                              <span className="font-black text-slate-800">{selectedEntity.point[axis]} mm</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-[11px] font-bold text-slate-400">
                      Click a face in the viewport to inspect its B-Rep identity.
                    </div>
                  )}

                </div>
              </div>
            )}

            {activeTab === "params" && (
              <div className="space-y-4">
                <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest font-mono block">
                  Discretization & Geometry parameters
                </span>

                <div className="space-y-3.5 pl-0.5 pr-0.5">
                  {/* Dynamic Segments / Holes Count Slider */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-600 font-semibold">Total Locking Bores:</span>
                      <span className="font-mono font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{segmentsCount} holes</span>
                    </div>
                    <input
                      type="range"
                      min="3"
                      max="12"
                      step="1"
                      value={segmentsCount}
                      onChange={(e) => {
                        setSegmentsCount(Number(e.target.value));
                        setUploadedBytes(null); 
                      }}
                      className="w-full accent-blue-600 h-1 bg-slate-100 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Linear Deflection Slider */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-600 font-semibold font-mono">Linear Deflection (mm):</span>
                      <span className="font-mono font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{linearDeflection.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0.02"
                      max="0.45"
                      step="0.01"
                      value={linearDeflection}
                      onChange={(e) => setLinearDeflection(Number(e.target.value))}
                      className="w-full accent-blue-600 h-1 bg-slate-100 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Angular Deflection Slider */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-600 font-semibold font-mono">Angular Deflection (rad):</span>
                      <span className="font-mono font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{angularDeflection.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0.10"
                      max="0.90"
                      step="0.05"
                      value={angularDeflection}
                      onChange={(e) => setAngularDeflection(Number(e.target.value))}
                      className="w-full accent-blue-600 h-1 bg-slate-100 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Hole Radial Divisions Slider */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-600 font-semibold font-mono">Bore Subdivisions:</span>
                      <span className="font-mono font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{radialDivisions} facets</span>
                    </div>
                    <input
                      type="range"
                      min="12"
                      max="64"
                      step="2"
                      value={radialDivisions}
                      onChange={(e) => setRadialDivisions(Number(e.target.value))}
                      className="w-full accent-blue-600 h-1 bg-slate-100 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Plate Nominal Width */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-600 font-semibold">Plate Nominal Width:</span>
                      <span className="font-mono font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{plateWidth.toFixed(1)} mm</span>
                    </div>
                    <input
                      type="range"
                      min="2.5"
                      max="5.0"
                      step="0.1"
                      value={plateWidth}
                      onChange={(e) => {
                        const newW = Number(e.target.value);
                        setPlateWidth(newW);
                        if (screwHoleRadius >= newW / 2 - 0.2) {
                          setScrewHoleRadius(Number((newW / 2 - 0.4).toFixed(2)));
                        }
                      }}
                      className="w-full accent-blue-600 h-1 bg-slate-100 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Plate Thickness */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-600 font-semibold">Plate Thickness:</span>
                      <span className="font-mono font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{plateThickness.toFixed(1)} mm</span>
                    </div>
                    <input
                      type="range"
                      min="0.8"
                      max="2.5"
                      step="0.1"
                      value={plateThickness}
                      onChange={(e) => setPlateThickness(Number(e.target.value))}
                      className="w-full accent-blue-600 h-1 bg-slate-100 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Screw Hole Radius */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-600 font-semibold">Lock Hole Radius:</span>
                      <span className="font-mono font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{screwHoleRadius.toFixed(2)} mm</span>
                    </div>
                    <input
                      type="range"
                      min="0.60"
                      max={Math.min(1.60, plateWidth / 2 - 0.25)}
                      step="0.05"
                      value={screwHoleRadius}
                      onChange={(e) => setScrewHoleRadius(Number(e.target.value))}
                      className="w-full accent-blue-600 h-1 bg-slate-100 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === "steptree" && (
              <div className="space-y-3 flex flex-col h-full min-h-0">
                <div className="flex flex-col gap-1.5 shrink-0">
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest font-mono">
                    ISO 10303-21 STEP Code Inspector
                  </span>
                  <input
                    type="text"
                    placeholder="Search entities (e.g., PLANE, #102)..."
                    value={stepSearch}
                    onChange={(e) => setStepSearch(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                  />
                </div>

                <div className="flex-1 overflow-y-auto pr-1 space-y-1.5 font-mono text-[10.5px]">
                  {(() => {
                    const rawStepLines = stepText
                      ? stepText.split(";").map((l) => l.trim() + ";").filter((l) => l && l.length > 3 && !l.startsWith("ISO-") && !l.startsWith("DATA;") && !l.startsWith("HEADER;") && !l.startsWith("ENDSEC;"))
                      : [];
                    const filteredStepLines = rawStepLines.filter((line) => line.toLowerCase().includes(stepSearch.toLowerCase())).slice(0, 80);

                    if (filteredStepLines.length === 0) {
                      return <div className="text-center py-6 text-slate-400 text-xs">No matching STEP entities.</div>;
                    }

                    return filteredStepLines.map((line, idx) => {
                      const matchEntity = line.match(/=\s*([A-Z0-9_]+)/);
                      const entityName = matchEntity ? matchEntity[1] : "ENTITY";
                      return (
                        <div
                          key={idx}
                          className="p-1.5 hover:bg-slate-100 border border-slate-150 rounded bg-slate-50/50 flex flex-col gap-1 group relative transition text-slate-700"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[8.5px] bg-slate-200 px-1.5 py-0.2 rounded font-black text-slate-650 tracking-wider">
                              {entityName}
                            </span>
                            <button
                              onClick={() => copyToClipboard(line)}
                              className="text-[9px] text-blue-600 hidden group-hover:block hover:underline font-sans font-bold cursor-pointer"
                            >
                              Copy
                            </button>
                          </div>
                          <span className="break-all whitespace-pre-wrap leading-relaxed">{line}</span>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}

            {activeTab === "tolerances" && (
              <div className="space-y-3 flex flex-col h-full min-h-0">
                <div className="flex flex-col gap-1.5 shrink-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest font-mono">
                      Product Manufacturing Info (PMI)
                    </span>
                    <span className="text-[9px] text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.2 rounded font-black font-mono">
                      ISO 1101 / ASME Y14.5
                    </span>
                  </div>
                  <input
                    type="text"
                    placeholder="Search tolerances or justifications..."
                    value={toleranceSearch}
                    onChange={(e) => setToleranceSearch(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 font-sans"
                  />
                  
                  {/* Category Pill Filters */}
                  <div className="flex flex-wrap gap-1 mt-1">
                    {["All", "Form", "Location", "Profile", "Orientation"].map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setToleranceCategory(cat)}
                        className={`text-[9.5px] font-bold px-2 py-0.5 rounded-full transition cursor-pointer ${
                          toleranceCategory === cat
                            ? "bg-blue-600 text-white shadow-xs"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tolerances Scroll Area */}
                <div className="flex-1 overflow-y-auto pr-1 space-y-3">
                  {/* Extracted Reference Datums (ASME Y14.5 / ISO 5459) */}
                  {parsedMetadata?.datums && parsedMetadata.datums.length > 0 && (
                    <div className="bg-slate-50/55 p-2.5 rounded-xl border border-slate-200/85 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[9.5px] uppercase font-black tracking-wider text-slate-500/90 font-mono flex items-center gap-1.5">
                          <span className="inline-block w-1.5 h-1.5 bg-blue-600 rounded-full animate-pulse"></span>
                          Extracted Reference Datums (ASME Y14.5)
                        </span>
                        <span className="text-[8.5px] bg-blue-100 text-blue-700 font-bold px-1.5 py-0.2 rounded-md font-mono">
                          {parsedMetadata.datums.length} Features
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {parsedMetadata.datums.map((d) => (
                          <div
                            key={d.id}
                            className="bg-white border border-slate-200 p-2 rounded-lg relative hover:border-blue-400 hover:shadow-2xs transition group cursor-pointer"
                            onClick={() => {
                              // Trace datum targets to B-Rep mesh elements dynamically
                              const currentFaceRecords = parsedMetadata?.faceRecords || [];
                              const currentCylinderIds = parsedMetadata?.cylinderIds || [];
                              const datumTargetIds = Array.isArray(d.targetIds) && d.targetIds.length > 0
                                ? d.targetIds
                                : (d.targetId ? [d.targetId] : []);

                              const resolveDatumTargetToFace = (targetId: string, allowIdentifierFallback = false) => {
                                const tId = targetId ? (targetId.startsWith("#") ? targetId : `#${targetId}`) : "";
                                if (!tId) return "";

                                const directIdx = currentFaceRecords.findIndex(f => f.id === tId);
                                if (directIdx !== -1) {
                                  return `BRepFace-${directIdx}`;
                                }

                                const indirectIdx = currentFaceRecords.findIndex(f => f.referencedIds.includes(tId));
                                if (indirectIdx !== -1) {
                                  return `BRepFace-${indirectIdx}`;
                                }

                                if (customFaceMapping[tId]) {
                                  return customFaceMapping[tId];
                                }
                                if (customFaceMapping[targetId]) {
                                  return customFaceMapping[targetId];
                                }
                                if (allowIdentifierFallback && customFaceMapping[d.identifier]) {
                                  return customFaceMapping[d.identifier];
                                }

                                const cylIdx = currentCylinderIds.indexOf(tId);
                                if (cylIdx !== -1) {
                                  return `BRepFace-${2 + cylIdx}`;
                                }

                                return "";
                              };

                              const relatedFaces = datumTargetIds
                                .map((targetId) => resolveDatumTargetToFace(targetId))
                                .filter((faceId, index, all) => !!faceId && all.indexOf(faceId) === index);

                              let resolvedId = relatedFaces[0] || d.targetId || "";
                              let resolvedName = datumTargetIds.length > 1
                                ? `${d.name} pattern (${datumTargetIds.length} faces)`
                                : d.targetName || d.name;

                              if (customFaceMapping[d.identifier]) {
                                resolvedId = customFaceMapping[d.identifier];
                              } else if (customFaceMapping[d.targetId || d.identifier]) {
                                resolvedId = customFaceMapping[d.targetId || d.identifier];
                              } else if (!resolvedId) {
                                resolvedId = resolveDatumTargetToFace(d.targetId || "", true) || d.targetId || "";
                              }

                              setSelectedEntity({ id: resolvedId, name: resolvedName, type: "face", relatedFaces });
                              setMobileView("viewport");
                            }}
                          >
                            <div className="flex items-center gap-1.5">
                              {/* Standard ASME Drafting Box Style for Datums */}
                              <div className="w-5 h-5 flex items-center justify-center font-black border-2 border-slate-800 bg-slate-50 text-slate-800 text-[10px] font-mono rounded-md shadow-[1px_1px_0px_rgba(30,41,59,0.1)] shrink-0 select-none">
                                {d.identifier}
                              </div>
                              <div className="min-w-0">
                                <h5 className="text-[10px] font-bold text-slate-800 truncate">
                                  {d.name}
                                </h5>
                                <p className="text-[8px] text-slate-400 font-mono">
                                  {d.entityId}
                                </p>
                              </div>
                            </div>
                            
                            <div className="mt-1 text-[8.5px] text-slate-500 font-medium font-sans truncate">
                              {d.type}
                            </div>

                            <div className="mt-1 bg-slate-50/70 py-0.5 px-1 rounded text-[7.5px] text-slate-400 font-mono flex justify-between gap-1 items-center">
                              <span className="truncate max-w-[70%]" title={d.targetName}>{d.targetName}</span>
                              <span
                                className="font-bold text-blue-600 truncate"
                                title={(d.targetIds && d.targetIds.length > 0) ? d.targetIds.join(", ") : d.targetId}
                              >
                                {(d.targetIds && d.targetIds.length > 1) ? `${d.targetIds.length} faces` : (d.targetId || "Global")}
                              </span>
                            </div>

                            <div className="mt-1.5 flex justify-between items-center bg-slate-50/50 p-1 rounded-md border border-slate-100">
                              <span className="text-[8px] font-bold text-slate-500 font-mono">
                                Bound: {customFaceMapping[d.targetId || d.identifier] || "Auto"}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setBindingMode({
                                    type: "datum",
                                    id: d.id,
                                    targetId: d.targetId || d.identifier,
                                    label: d.identifier
                                  });
                                }}
                                className="text-[8px] font-bold text-blue-600 hover:text-white hover:bg-blue-600 bg-blue-50/60 border border-blue-200/50 px-1.5 py-0.5 rounded transition cursor-pointer"
                                title="Click to bind to any 3D face on the model"
                              >
                                Remap
                              </button>
                            </div>

                            {/* Hover clinical context justification */}
                            <div className="absolute bottom-full left-0 right-0 mb-1.5 hidden group-hover:block bg-slate-900 border border-slate-800 text-white rounded-lg text-[9px] p-2.5 z-50 shadow-lg leading-relaxed pointer-events-none">
                              <div className="font-bold text-[8px] text-blue-400 tracking-wider uppercase mb-0.5 font-mono">
                                Orthopedic Clinical Significance:
                              </div>
                              {d.clinicalContext}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Extracted Datum Targets */}
                  {parsedMetadata?.datumTargets && parsedMetadata.datumTargets.length > 0 && (
                    <div className="bg-emerald-50/45 p-2.5 rounded-xl border border-emerald-200/80 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[9.5px] uppercase font-black tracking-wider text-emerald-700 font-mono flex items-center gap-1.5">
                          <span className="inline-block w-1.5 h-1.5 bg-emerald-600 rounded-full"></span>
                          Extracted Datum Targets
                        </span>
                        <span className="text-[8.5px] bg-emerald-100 text-emerald-700 font-bold px-1.5 py-0.2 rounded-md font-mono">
                          {parsedMetadata.datumTargets.length} Targets
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {parsedMetadata.datumTargets.map((target) => (
                          <div
                            key={target.id}
                            className="bg-white border border-emerald-200 p-2 rounded-lg hover:border-emerald-400 hover:shadow-2xs transition cursor-pointer"
                            onClick={() => {
                              const resolvedId = customFaceMapping[target.targetId] || target.targetId;
                              setSelectedEntity({
                                id: resolvedId,
                                name: target.targetName,
                                type: "face",
                              });
                              setMobileView("viewport");
                            }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-[11px] font-black text-emerald-800 font-mono truncate" title={target.name}>
                                  {target.name}
                                </div>
                                <div className="text-[8.5px] text-slate-400 font-bold font-mono">
                                  {target.entityId}
                                </div>
                              </div>
                              <span className="text-[9px] font-black bg-emerald-700 text-white px-1.5 py-0.5 rounded font-mono shrink-0">
                                {target.identifier}
                              </span>
                            </div>

                            <div className="mt-1.5 bg-emerald-50/70 border border-dashed border-emerald-200 rounded p-1.5 text-[9.5px] font-mono">
                              <div className="flex justify-between gap-2">
                                <span className="text-slate-500 font-bold uppercase">Target Entity</span>
                                <span className="text-emerald-700 font-black shrink-0">{target.targetId}</span>
                              </div>
                              <div className="text-slate-700 truncate mt-0.5" title={target.targetName}>
                                {target.targetName}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Section Divider/Header for Tolerances */}
                  <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider font-mono pt-1">
                    Geometric Checkpoints & Feature Control Frames
                  </div>

                  {(() => {
                    const tList = parsedMetadata?.tolerances || [];
                    const filteredTList = tList.filter((t) => {
                      const matchesCat = toleranceCategory === "All" || t.category === toleranceCategory;
                      const matchesSearch =
                        t.type.toLowerCase().includes(toleranceSearch.toLowerCase()) ||
                        t.targetName.toLowerCase().includes(toleranceSearch.toLowerCase()) ||
                        t.targetId.toLowerCase().includes(toleranceSearch.toLowerCase()) ||
                        t.clinicalContext.toLowerCase().includes(toleranceSearch.toLowerCase());
                      return matchesCat && matchesSearch;
                    });

                    if (filteredTList.length === 0) {
                      return (
                        <div className="text-center py-8 text-slate-400 text-xs">
                          No matching PMI geometric tolerances found.
                        </div>
                      );
                    }

                    return filteredTList.map((t) => {
                      const hasSemanticToleranceValue = Number.isFinite(t.value) && !(t.type === "Feature Control Frame" && t.value === 0);
                      // Color mapping depending on category
                      let badgeBg = "bg-rose-50 text-rose-700 border-rose-100";
                      let symColor = "text-rose-600";
                      if (t.category === "Form") {
                        badgeBg = "bg-amber-50 text-amber-700 border-amber-100";
                        symColor = "text-amber-600";
                      } else if (t.category === "Location") {
                        badgeBg = "bg-indigo-50 text-indigo-700 border-indigo-100";
                        symColor = "text-indigo-600";
                      } else if (t.category === "Orientation") {
                        badgeBg = "bg-emerald-50 text-emerald-700 border-emerald-100";
                        symColor = "text-emerald-600";
                      } else if (t.category === "Profile") {
                        badgeBg = "bg-pink-50 text-pink-700 border-pink-100";
                        symColor = "text-pink-600";
                      }

                      return (
                        <div
                          key={t.id}
                          className="p-2.5 hover:bg-slate-50/85 border border-slate-150 rounded-lg bg-white shadow-3xs flex flex-col gap-2 transition group relative"
                        >
                          {/* Header Line */}
                          <div className="flex items-start justify-between gap-1">
                            <div className="flex items-center gap-1.5">
                              {/* GD&T Badge Icon */}
                              <span className={`w-6 h-6 flex items-center justify-center text-sm font-black rounded-md border font-sans ${badgeBg}`}>
                                {t.symbol}
                              </span>
                              <div>
                                <h4 className="text-xs font-bold text-slate-800 leading-tight">
                                  {t.type} Tolerancing
                                </h4>
                                <span className="text-[9px] text-slate-400 font-mono font-medium">
                                  {t.entityId}
                                </span>
                              </div>
                            </div>
                            
                            {/* Numerical Tolerance Value Badge */}
                            <div className="text-right shrink-0">
                              <span className="font-mono text-[10px] font-black bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded border border-slate-200">
                                {hasSemanticToleranceValue ? `⌀ ${t.value.toFixed(2)} mm` : "Graphic PMI"}
                              </span>
                              <div className="text-[8px] text-slate-400 font-bold tracking-wider font-mono mt-0.5">
                                {hasSemanticToleranceValue ? "ZONE LIMIT" : "PRESENTATION"}
                              </div>
                            </div>
                          </div>                          {/* Target B-Rep Detail Mapping */}
                          <div className="bg-slate-50/50 p-1.5 rounded border border-dashed border-slate-200 text-[10px] font-mono hover:bg-blue-50/50 hover:border-blue-200 transition cursor-pointer"
                               onClick={() => {
                                 // Smart interaction: highlight related B-Rep entities dynamically
                                 const currentFaceRecords = parsedMetadata?.faceRecords || [];
                                 const currentCylinderIds = parsedMetadata?.cylinderIds || [];
                                 const tId = t.targetId ? (t.targetId.startsWith("#") ? t.targetId : `#${t.targetId}`) : "";

                                 let resolvedId = t.targetId || "";
                                 let resolvedName = t.targetName || t.type;

                                 if (customFaceMapping[t.targetId]) {
                                   resolvedId = customFaceMapping[t.targetId];
                                 } else {
                                   // 1. Direct match in faceRecords
                                   const directIdx = currentFaceRecords.findIndex(f => f.id === tId);
                                   if (directIdx !== -1) {
                                     resolvedId = `BRepFace-${directIdx}`;
                                   } else {
                                     // 2. Indirect match
                                     const indirectIdx = currentFaceRecords.findIndex(f => f.referencedIds.includes(tId));
                                     if (indirectIdx !== -1) {
                                       resolvedId = `BRepFace-${indirectIdx}`;
                                     } else {
                                       // 3. Cylinder index fallback
                                       const cylIdx = currentCylinderIds.indexOf(tId);
                                       if (cylIdx !== -1) {
                                         resolvedId = `BRepFace-${2 + cylIdx}`;
                                       }
                                     }
                                   }
                                 }

                                 setSelectedEntity({ id: resolvedId, name: resolvedName, type: "face" });
                                 if (resolvedId.startsWith("BRepFace-")) {
                                   setFocusEntityRequest((prev) => ({
                                     id: resolvedId,
                                     nonce: (prev?.nonce ?? 0) + 1,
                                     preferAxisView: /cylind|hole|bore|axis/i.test(`${t.type} ${t.targetName}`)
                                   }));
                                 }
                                 setMobileView("viewport");
                               }}
                          >
                            <div className="flex justify-between items-center">
                              <span className="text-slate-400 font-sans font-bold text-[8.5px] uppercase tracking-wider">
                                TARGET ENTITY {customFaceMapping[t.targetId] ? `(Bound: ${customFaceMapping[t.targetId]})` : ""}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setBindingMode({
                                    type: "tolerance",
                                    id: t.id,
                                    targetId: t.targetId
                                  });
                                }}
                                className="text-[8px] font-bold text-blue-650 hover:text-white hover:bg-blue-600 bg-blue-50/60 border border-blue-200/50 px-1.5 py-0.5 rounded transition cursor-pointer"
                                title="Click to bind to any 3D face on the model"
                              >
                                Remap
                              </button>
                            </div>
                            <div className="flex justify-between mt-0.5 text-slate-700">
                              <span className="font-semibold truncate max-w-[70%]" title={t.targetName}>
                                {t.targetName}
                              </span>
                              <span className="font-bold text-blue-600 shrink-0">
                                {t.targetId || "Global"}
                              </span>
                            </div>
                          </div>

                          {/* Orthopedic Justification Clinical Context Section */}
                          <div className="text-[10px] text-slate-600 leading-relaxed pl-1.5 border-l-2 border-slate-300 italic font-medium bg-slate-50/30 py-0.5">
                            {t.clinicalContext}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}
          </div>

          {/* ACTIVE SELECTION INFO PANEL (MOUNTED STATICALLY AT BOTTOM OF SIDEBAR) */}
          <div className="border-t border-slate-100 pt-3 shrink-0 min-w-0">
            {selectedEntity ? (
              <div className="space-y-3 flex flex-col min-w-0">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-emerald-600 font-bold tracking-widest uppercase block font-mono">Bound Geometry Entity</span>
                    <button
                      onClick={() => setSelectedEntity(null)}
                      className="text-[10px] text-slate-400 hover:text-slate-650 font-bold hover:underline"
                    >
                      CLEAR
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-1 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse animate-duration-1000" />
                    <h3 className="text-xs font-bold text-slate-800 uppercase font-mono truncate min-w-0 max-w-[80%]" title={selectedEntity.name}>
                      {selectedEntity.name}
                    </h3>
                  </div>
                </div>

                <div className="space-y-2 min-w-0">
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-150 space-y-1.5 text-[10.5px] font-mono min-w-0 overflow-hidden">
                    <div className="flex justify-between gap-2 pb-1 border-b border-slate-200/50 min-w-0">
                      <span className="text-slate-500 shrink-0">Surface ID:</span>
                      <span className="text-slate-900 font-black min-w-0 max-w-[65%] truncate text-right" title={selectedEntity.id}>{selectedEntity.id}</span>
                    </div>
                    
                    {selectedEntity.type === 'face' ? (
                      <>
                        <div className="flex justify-between gap-2 pb-1 border-b border-slate-200/50 min-w-0">
                          <span className="text-slate-500 shrink-0">Triangles:</span>
                          <span className="text-slate-900 font-bold min-w-0 max-w-[65%] truncate text-right">{selectedEntity.triangles}</span>
                        </div>
                        <div className="flex justify-between gap-2 min-w-0">
                          <span className="text-slate-500 shrink-0">Surface Area:</span>
                          <span className="text-blue-600 font-black min-w-0 max-w-[65%] truncate text-right">{selectedEntity.area} mm²</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex justify-between gap-2 pb-1 border-b border-slate-200/50 min-w-0">
                          <span className="text-slate-550 shrink-0">Type:</span>
                          <span className="text-slate-900 font-bold min-w-0 max-w-[65%] truncate text-right">EDGE_CURVE</span>
                        </div>
                        <div className="flex justify-between gap-2 pb-1 border-b border-slate-200/50 min-w-0">
                          <span className="text-slate-550 shrink-0">Adjacent Faces:</span>
                          <span className="text-slate-900 font-bold min-w-0 max-w-[65%] text-right break-words">
                            {selectedEntity.parentFaceIndices?.length
                              ? selectedEntity.parentFaceIndices.map((faceIdx: number) => `F${faceIdx + 1}`).join(", ")
                              : "Boundary"}
                          </span>
                        </div>
                        <div className="flex justify-between gap-2 min-w-0">
                          <span className="text-slate-550 shrink-0">Tessellated Length:</span>
                          <span className="text-blue-600 font-bold min-w-0 max-w-[65%] truncate text-right">{selectedEntity.length} mm</span>
                        </div>
                      </>
                    )}
                  </div>

                  {selectedEntity.point ? (
                    <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-150 space-y-1.5 text-[10px] font-mono min-w-0 overflow-hidden">
                      <span className="text-[9.5px] text-slate-500 uppercase font-black block mb-1">Probe Cartesian Coordinate</span>
                      <div className="flex justify-between gap-2 min-w-0">
                        <span className="text-slate-500 shrink-0">X-Coord:</span>
                        <span className="text-slate-800 font-black min-w-0 max-w-[65%] truncate text-right">{selectedEntity.point.x} mm</span>
                      </div>
                      <div className="flex justify-between gap-2 min-w-0">
                        <span className="text-slate-550 shrink-0">Y-Coord:</span>
                        <span className="text-slate-800 font-black min-w-0 max-w-[65%] truncate text-right">{selectedEntity.point.y} mm</span>
                      </div>
                      <div className="flex justify-between gap-2 min-w-0">
                        <span className="text-slate-550 shrink-0">Z-Coord:</span>
                        <span className="text-slate-800 font-black min-w-0 max-w-[65%] truncate text-right">{selectedEntity.point.z} mm</span>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-50/80 p-3 rounded-lg border border-slate-150 text-[10px] text-slate-400 font-mono text-center italic">
                      No specific 3D coordinate point clicked. Use the visualizer raycaster to probe a tactile spot.
                    </div>
                  )}
                </div>

                <button
                  onClick={() => {
                    const px = selectedEntity.point?.x ?? 0;
                    const py = selectedEntity.point?.y ?? 0;
                    const pz = selectedEntity.point?.z ?? 0;
                    copyToClipboard(`ID: ${selectedEntity.id}, Point: X=${px} Y=${py} Z=${pz}`);
                  }}
                  className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold font-sans flex items-center justify-center gap-1.5 cursor-pointer transition shadow-xs"
                >
                  <Copy className="w-3 h-3" />
                  Copy Coordinates
                </button>
              </div>
            ) : hoveredEntity ? (
              <div className="p-3 border border-dashed border-slate-200 bg-slate-50 rounded-xl">
                <div className="space-y-1 text-center">
                  <div className="text-[9px] text-slate-400 font-mono uppercase tracking-wider">Hovering Entity_</div>
                  <div className="text-xs font-bold font-mono text-blue-600 uppercase truncate max-w-full" title={hoveredEntity.name}>
                    {hoveredEntity.name}
                  </div>
                  <div className="text-[10px] text-slate-500 font-sans leading-relaxed">
                    Click to lock coordinates & inspect.
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-3 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                <div className="flex flex-col items-center justify-center text-center">
                  <HelpCircle className="w-6 h-6 text-slate-350 mb-1.5" />
                  <p className="text-[9px] text-slate-500 font-mono uppercase tracking-wider font-bold">Tactile Selection</p>
                  <p className="text-[10px] text-slate-450 mt-1 font-sans leading-relaxed">
                    Hover and click any B-Rep face or edge boundary in the viewport to inspect CAD specifications.
                  </p>
                </div>
              </div>
            )}
          </div>

          {errorMsg && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-[10.5px] font-mono flex gap-2 shrink-0">
              <XCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <div>
                <span className="font-semibold uppercase text-[9px] block text-red-500">Numerical Warning</span>
                <span className="leading-snug block">{errorMsg}</span>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* 3. Bottom Status Bar */}
      <footer className="bg-slate-900 border-t border-slate-950 flex flex-col sm:flex-row items-center px-4 py-2 sm:py-2.5 sm:px-6 justify-between gap-1.5 sm:gap-0 text-[10px] text-slate-400 font-mono shrink-0 select-none z-10">
        <div className="flex items-center gap-3 sm:gap-5">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
            GL Micro-Tessellation
          </div>
          <div className="hidden md:block">Unit: MILLIMETER (mm)</div>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-slate-500">OpenCascade WASM v0.0.23</span>
          <span className="font-bold text-blue-400 uppercase font-mono">B-Rep Solver</span>
        </div>
      </footer>

    </div>
  );
}

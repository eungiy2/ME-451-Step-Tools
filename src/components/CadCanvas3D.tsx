import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree, SAH } from "three-mesh-bvh";
import { Orbit, Sparkles } from "lucide-react";

(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
(THREE.Mesh.prototype as any).raycast = acceleratedRaycast;

interface CadCanvas3DProps {
  occtResult: any;
  isLoading: boolean;
  viewMode: "solid" | "wireframe" | "points" | "xray";
  wireframeOverlay: boolean;
  materialType: "titanium" | "gold" | "chrome" | "carbon";
  autoRotate: boolean;
  selectedEntityId: string | null;
  selectedRelatedEntityIds?: string[];
  hoveredEntityId: string | null;
  focusEntityRequest?: { id: string; nonce: number; preferAxisView?: boolean } | null;
  measurementMode?: boolean;
  selectionClickEnabled?: boolean;
  onSelectEntity: (entity: any | null) => void;
  onHoverEntity: (entity: any | null) => void;
  datums?: any[];
  datumTargets?: any[];
  datumReferenceFrames?: any[];
  tolerances?: any[];
  faceRecords?: { id: string; referencedIds: string[] }[];
  cylinderIds?: string[];
  customFaceMapping?: Record<string, string>;
  showBrepOverlays?: boolean;
}

type MeasurementLabelState = {
  x: number;
  y: number;
  text: string;
  visible: boolean;
};

type MeasurementCircleSnap = {
  center: THREE.Vector3;
  radius: number;
  radial: THREE.Vector3;
};

type MeasurementSample = {
  point: THREE.Vector3;
  kind: "face" | "edge" | "cylinder";
  objectName: string;
  normal?: THREE.Vector3;
  planeConstant?: number;
  circle?: MeasurementCircleSnap;
};

type LinearMeasurementResult = {
  mode: "linear";
  start: THREE.Vector3;
  end: THREE.Vector3;
  text: string;
  diameterReference?: boolean;
  normalReference?: THREE.Vector3;
  surfaceReference?: THREE.Vector3;
};

type AngularMeasurementResult = {
  mode: "angle";
  center: THREE.Vector3;
  directionA: THREE.Vector3;
  directionB: THREE.Vector3;
  axis: THREE.Vector3;
  radius: number;
  sourceA: THREE.Vector3;
  sourceB: THREE.Vector3;
  text: string;
};

type MeasurementResult = LinearMeasurementResult | AngularMeasurementResult;

export default function CadCanvas3D({
  occtResult,
  isLoading,
  viewMode,
  wireframeOverlay,
  materialType,
  autoRotate,
  selectedEntityId,
  selectedRelatedEntityIds = [],
  hoveredEntityId,
  focusEntityRequest,
  measurementMode = false,
  selectionClickEnabled = false,
  onSelectEntity,
  onHoverEntity,
  datums = [],
  datumTargets = [],
  datumReferenceFrames = [],
  tolerances = [],
  faceRecords = [],
  cylinderIds = [],
  customFaceMapping = {},
  showBrepOverlays = true,
}: CadCanvas3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const measurementLabelRef = useRef<HTMLDivElement>(null);
  const datumClickHandlerRef = useRef<((datum: any) => void) | null>(null);
  const orientationCubeRef = useRef<HTMLDivElement>(null);
  const orientationViewHandlerRef = useRef<((direction: THREE.Vector3, up?: THREE.Vector3) => void) | null>(null);
  const partRollHandlerRef = useRef<((angle: number) => void) | null>(null);
  const requestRenderRef = useRef<((frames?: number) => void) | null>(null);

  // Tracker for dynamic coordinates info
  const [hoveredCoordinate, setHoveredCoordinate] = useState<{ x: number; y: number; z: number } | null>(null);
  const [modelStats, setModelStats] = useState<{ width: number; height: number; depth: number; triangles: number; meshes: number; edges: number } | null>(null);
  const [measurementLabel, setMeasurementLabel] = useState<MeasurementLabelState | null>(null);

  // Capture fast-updating props in a ref for animation loops
  const propsRef = useRef({ viewMode, wireframeOverlay, materialType, autoRotate, selectedEntityId, selectedRelatedEntityIds, hoveredEntityId, focusEntityRequest, measurementMode, selectionClickEnabled, datums, datumTargets, datumReferenceFrames, tolerances, faceRecords, cylinderIds, customFaceMapping });
  useEffect(() => {
    propsRef.current = { viewMode, wireframeOverlay, materialType, autoRotate, selectedEntityId, selectedRelatedEntityIds, hoveredEntityId, focusEntityRequest, measurementMode, selectionClickEnabled, datums, datumTargets, datumReferenceFrames, tolerances, faceRecords, cylinderIds, customFaceMapping };
    requestRenderRef.current?.(4);
  }, [viewMode, wireframeOverlay, materialType, autoRotate, selectedEntityId, selectedRelatedEntityIds, hoveredEntityId, focusEntityRequest, measurementMode, selectionClickEnabled, datums, datumTargets, datumReferenceFrames, tolerances, faceRecords, cylinderIds, customFaceMapping]);

  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#f8fafc"); // Pristine clinical light background

    // Lighting setup for detailed material evaluation in light mode
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    scene.add(ambientLight);

    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0xe2e8f0, 0.4);
    scene.add(hemisphereLight);

    const mainDirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    mainDirLight.position.set(25, 45, 20);
    scene.add(mainDirLight);

    const sideCyanLight = new THREE.DirectionalLight(0x06b6d4, 0.25); // Subtle clinical teal highlights
    sideCyanLight.position.set(-20, -15, -20);
    scene.add(sideCyanLight);

    const ambientPurpleLight = new THREE.DirectionalLight(0xa855f7, 0.1); // Subdued mood light
    ambientPurpleLight.position.set(0, 0, -35);
    scene.add(ambientPurpleLight);

    const assemblyGroup = new THREE.Group();
    scene.add(assemblyGroup);

    // Setup Camera
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
    camera.position.set(15, 12, 22);

    // Logs-depth buffer solves CAD intersection flickering/aliasing
    const renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      alpha: false,
      logarithmicDepthBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Responsive Canvas Resizer
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
        requestRenderRef.current?.(2);
      }
    });
    resizeObserver.observe(containerRef.current);

    // Orbit Navigator Controls
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxDistance = 450;
    controls.minDistance = 2;

    let gridHelper: THREE.GridHelper | null = null;
    let cameraFocusTarget: {
      position: THREE.Vector3;
      target: THREE.Vector3;
      up?: THREE.Vector3;
      fromPosition: THREE.Vector3;
      fromTarget: THREE.Vector3;
      fromUp: THREE.Vector3;
      startedAt: number;
      durationMs: number;
    } | null = null;
    let focusedDatumOrbit = false;
    const modelOrbitTarget = new THREE.Vector3(0, 0, 0);
    let modelSizeMax = 10;
    let datumAnchorCache: {
      id: string;
      element: HTMLElement;
      leaderElement: HTMLElement | null;
      triangleElement: HTMLElement | null;
      triangleObject: THREE.LineLoop | null;
      leaderObject: THREE.Line | null;
      arrowShaftObject: THREE.Line | THREE.LineSegments | null;
      arrowHeadObject: THREE.Mesh | THREE.LineSegments | null;
      targetMarkObject: THREE.Line | THREE.LineSegments | null;
      dimensionObject: THREE.LineSegments | null;
      object: THREE.Object3D;
      localPoint: THREE.Vector3;
      offset: THREE.Vector3;
      dimensionStartLocal: THREE.Vector3 | null;
      dimensionEndLocal: THREE.Vector3 | null;
      dimensionTouchStartLocal: THREE.Vector3 | null;
      dimensionTouchEndLocal: THREE.Vector3 | null;
      dimensionExtensionLocal: THREE.Vector3 | null;
      triangleApexLocal: THREE.Vector3 | null;
      leaderTangent: THREE.Vector3;
      leaderAxisLocal: THREE.Vector3;
      calloutKind: "planar" | "cylindrical" | "median" | "targetPoint" | "targetZone" | "targetLine" | "targetCircle" | "targetCurve" | null;
      triangleHeight: number;
      triangleHalfBase: number;
      arrowLength: number;
      arrowHalfWidth: number;
      leaderRadialLength: number;
      leaderDoglegLength: number;
      leaderStemLength: number;
      dimensionHalfLength: number;
      dimensionTickLength: number;
      targetMarkHalfSize: number;
      annotationKind: "datum" | "datumTarget";
      hasLeader: boolean;
    }[] = [];
    let cadFacePickObjects: THREE.Object3D[] = [];
    let cadFallbackFacePickObjects: THREE.Object3D[] = [];
    let renderedObjectByName = new Map<string, THREE.Object3D>();
    let edgeNamesByFaceIndex = new Map<number, string[]>();
    let datumCacheMissingElements = 0;
    let datumCacheRetryFrame = 0;
    const floorBounds = new THREE.Box3();
    const partBounds = new THREE.Box3();
    const partCenter = new THREE.Vector3();
    let measurementPoints: MeasurementSample[] = [];
    let measurementGroup: THREE.Group | null = null;
    let previousMeasurementGroup: THREE.Group | null = null;
    let measurementLabelPoint: THREE.Vector3 | null = null;
    let prevMeasurementMode = measurementMode;

    const getPartWorldBounds = () => {
      assemblyGroup.updateMatrixWorld(true);
      partBounds.makeEmpty();
      const faceObjects = assemblyGroup.children.filter((child) => child.name.startsWith("BRepFace-"));
      faceObjects.forEach((child) => partBounds.expandByObject(child));
      if (partBounds.isEmpty()) {
        partBounds.setFromObject(assemblyGroup);
      }
      return partBounds;
    };

    const updateFloorGridPosition = () => {
      if (!gridHelper || assemblyGroup.children.length === 0) return;
      floorBounds.copy(getPartWorldBounds());
      if (!Number.isFinite(floorBounds.min.y)) return;
      floorBounds.getCenter(partCenter);
      gridHelper.position.set(partCenter.x, floorBounds.min.y - 0.2, partCenter.z);
    };

    // Helper: Obtain base face standard material
    const getFaceMaterial = (type: string, baseColor: THREE.Color, mode: "solid" | "wireframe" | "points" | "xray", isSelected: boolean, isHovered: boolean) => {
      if (mode === "xray") {
        return new THREE.MeshStandardMaterial({
          color: isSelected ? new THREE.Color("#10b981") : (isHovered ? new THREE.Color("#38bdf8") : baseColor.clone().addScalar(0.1)),
          transparent: true,
          opacity: 0.35,
          wireframe: false,
          roughness: 0.3,
          metalness: 0.2,
          side: THREE.DoubleSide,
          emissive: isSelected ? new THREE.Color("#047857") : (isHovered ? new THREE.Color("#0284c7") : new THREE.Color("#000000")),
          emissiveIntensity: isSelected ? 0.6 : (isHovered ? 0.8 : 0),
        });
      }

      if (mode === "wireframe") {
        return new THREE.MeshBasicMaterial({
          color: isSelected ? new THREE.Color("#10b981") : (isHovered ? new THREE.Color("#0ea5e9") : baseColor),
          wireframe: true,
          side: THREE.DoubleSide,
        });
      }

      // Shaded Solid materials representation
      let mat: THREE.MeshStandardMaterial;
      switch (type) {
        case "gold":
          mat = new THREE.MeshStandardMaterial({
            color: new THREE.Color("#eab308"), // Gold yellow
            metalness: 0.92,
            roughness: 0.18,
            side: THREE.DoubleSide,
          });
          break;
        case "chrome":
          mat = new THREE.MeshStandardMaterial({
            color: new THREE.Color("#cbd5e1"), // Polished Chrome
            metalness: 0.98,
            roughness: 0.05,
            side: THREE.DoubleSide,
          });
          break;
        case "carbon":
          mat = new THREE.MeshStandardMaterial({
            color: new THREE.Color("#27272a"), // Matte industrial carbon fiber dark grey
            metalness: 0.15,
            roughness: 0.85,
            side: THREE.DoubleSide,
          });
          break;
        case "titanium":
        default:
          mat = new THREE.MeshStandardMaterial({
            color: baseColor.r === 0 && baseColor.g === 0 && baseColor.b === 0 ? new THREE.Color("#cbd5e1") : baseColor,
            metalness: 0.85,
            roughness: 0.28,
            side: THREE.DoubleSide,
          });
          break;
      }

      // Apply dynamic highlighting emission for selection sticking
      if (isSelected) {
        mat.emissive.setHex(0x064e3b); // Deep emerald glow
        mat.emissiveIntensity = 1.0;
        // Make the selected face stand out with a slightly tinted highlight color
        mat.color.addScalar(0.1);
      } else if (isHovered) {
        mat.emissive.setHex(0x0284c7); // High-luminance sky blue glow for list hover
        mat.emissiveIntensity = 0.9;
        mat.color.addScalar(0.05);
      }

      return mat;
    };

    const computeIndexedTriangleArea = (positions: ArrayLike<number>, indices?: ArrayLike<number>) => {
      let totalArea = 0;
      const accumulate = (aIdx: number, bIdx: number, cIdx: number) => {
        const ax = positions[aIdx * 3];
        const ay = positions[aIdx * 3 + 1];
        const az = positions[aIdx * 3 + 2];
        const bx = positions[bIdx * 3];
        const by = positions[bIdx * 3 + 1];
        const bz = positions[bIdx * 3 + 2];
        const cx = positions[cIdx * 3];
        const cy = positions[cIdx * 3 + 1];
        const cz = positions[cIdx * 3 + 2];
        const abx = bx - ax;
        const aby = by - ay;
        const abz = bz - az;
        const acx = cx - ax;
        const acy = cy - ay;
        const acz = cz - az;
        const crossX = aby * acz - abz * acy;
        const crossY = abz * acx - abx * acz;
        const crossZ = abx * acy - aby * acx;
        totalArea += 0.5 * Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ);
      };

      if (indices && indices.length > 0) {
        for (let i = 0; i < indices.length; i += 3) {
          accumulate(indices[i], indices[i + 1], indices[i + 2]);
        }
      } else {
        for (let i = 0; i < positions.length / 3; i += 3) {
          accumulate(i, i + 1, i + 2);
        }
      }

      return parseFloat(totalArea.toFixed(2));
    };

    const computeFaceInteractionCache = (positions: ArrayLike<number>, indices?: ArrayLike<number>, normals?: ArrayLike<number>) => {
      const vertexCount = Math.floor(positions.length / 3);
      const min = new THREE.Vector3(Infinity, Infinity, Infinity);
      const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
      const localVertex = new THREE.Vector3();

      for (let i = 0; i < vertexCount; i++) {
        localVertex.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        min.min(localVertex);
        max.max(localVertex);
      }

      const localCenter = min.clone().add(max).multiplyScalar(0.5);
      const size = max.clone().sub(min);
      const stablePoint = localCenter.clone();
      let bestDistance = Infinity;

      for (let i = 0; i < vertexCount; i++) {
        localVertex.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        const distance = localVertex.distanceToSquared(localCenter);
        if (distance < bestDistance) {
          bestDistance = distance;
          stablePoint.copy(localVertex);
        }
      }

      const normal = new THREE.Vector3();
      const triangleNormal = new THREE.Vector3();
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      const faceTriangle = new THREE.Triangle();
      const closestPoint = new THREE.Vector3();
      const triangleCentroid = new THREE.Vector3();
      const surfaceAnchor = new THREE.Vector3();
      let normalWeight = 0;
      let coherentWeight = 0;

      const readVertex = (vertexIndex: number, target: THREE.Vector3) => {
        target.set(positions[vertexIndex * 3], positions[vertexIndex * 3 + 1], positions[vertexIndex * 3 + 2]);
      };

      const triCount = indices && indices.length > 0 ? Math.floor(indices.length / 3) : Math.floor(vertexCount / 3);
      for (let i = 0; i < triCount; i++) {
        if (indices && indices.length > 0) {
          readVertex(indices[i * 3], a);
          readVertex(indices[i * 3 + 1], b);
          readVertex(indices[i * 3 + 2], c);
        } else {
          readVertex(i * 3, a);
          readVertex(i * 3 + 1, b);
          readVertex(i * 3 + 2, c);
        }

        faceTriangle.set(a, b, c).closestPointToPoint(localCenter, closestPoint);
        const surfaceDistance = closestPoint.distanceToSquared(localCenter);
        if (surfaceDistance < bestDistance) {
          bestDistance = surfaceDistance;
          triangleCentroid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
          surfaceAnchor.copy(closestPoint).lerp(triangleCentroid, 0.12);
          stablePoint.copy(surfaceAnchor);
        }

        triangleNormal.subVectors(b, a).cross(c.sub(a));
        const area2 = triangleNormal.length();
        if (area2 > 1e-7) {
          normal.addScaledVector(triangleNormal.normalize(), area2);
          normalWeight += area2;
        }
      }

      let coherentNormal: THREE.Vector3 | null = null;
      if (normalWeight > 1e-7) {
        normal.normalize();

        for (let i = 0; i < triCount; i++) {
          if (indices && indices.length > 0) {
            readVertex(indices[i * 3], a);
            readVertex(indices[i * 3 + 1], b);
            readVertex(indices[i * 3 + 2], c);
          } else {
            readVertex(i * 3, a);
            readVertex(i * 3 + 1, b);
            readVertex(i * 3 + 2, c);
          }

          triangleNormal.subVectors(b, a).cross(c.sub(a));
          const area2 = triangleNormal.length();
          if (area2 > 1e-7) {
            coherentWeight += Math.abs(triangleNormal.normalize().dot(normal)) * area2;
          }
        }

        if (coherentWeight / normalWeight > 0.92) {
          coherentNormal = normal.clone();
        }
      }

      const normalAbs = new THREE.Vector3();
      if (normals && normals.length >= 9) {
        const normalCount = Math.floor(normals.length / 3);
        for (let i = 0; i < normalCount; i++) {
          normalAbs.x += Math.abs(normals[i * 3]);
          normalAbs.y += Math.abs(normals[i * 3 + 1]);
          normalAbs.z += Math.abs(normals[i * 3 + 2]);
        }
        normalAbs.divideScalar(normalCount);
      }

      const cylinderAxis = new THREE.Vector3(1, 0, 0);
      if (normalAbs.lengthSq() > 0) {
        if (normalAbs.y <= normalAbs.x && normalAbs.y <= normalAbs.z) {
          cylinderAxis.set(0, 1, 0);
        } else if (normalAbs.z <= normalAbs.x && normalAbs.z <= normalAbs.y) {
          cylinderAxis.set(0, 0, 1);
        }
      } else if (size.y >= size.x && size.y >= size.z) {
        cylinderAxis.set(0, 1, 0);
      } else if (size.z >= size.x && size.z >= size.y) {
        cylinderAxis.set(0, 0, 1);
      }

      return {
        localCenter,
        stablePoint,
        coherentNormal,
        cylinderAxis,
        size,
      };
    };

    // Rebuild B-Rep objects inside the canvas
    const rebuildSceneTopology = (resetCamera = false) => {
      // Clean previously rendered nodes
      while (assemblyGroup.children.length > 0) {
        const item = assemblyGroup.children[0];
        assemblyGroup.remove(item);
        if (item instanceof THREE.Mesh || item instanceof THREE.LineSegments || item instanceof THREE.Line) {
          item.geometry.dispose();
          if (Array.isArray(item.material)) {
            item.material.forEach((m) => m.dispose());
          } else {
            item.material.dispose();
          }
        }
      }

      if (gridHelper) {
        scene.remove(gridHelper);
        gridHelper = null;
      }
      cadFacePickObjects = [];
      cadFallbackFacePickObjects = [];
      renderedObjectByName = new Map();
      edgeNamesByFaceIndex = new Map();

      if (!occtResult || !occtResult.success) return;

      const { materialType: activeMat, viewMode: activeMode, wireframeOverlay: overlayOn, selectedEntityId: selectId, hoveredEntityId: hoverId } = propsRef.current;
      let totalTriangles = 0;
      let meshCounter = 0;
      let edgeCounter = 0;
      const pickPositions: number[] = [];
      const pickIndices: number[] = [];
      const pickFaceNamesByTriangle: string[] = [];
      const pickFaceNamesByVertex: string[] = [];

      // Check if the currently hovered or selected entity is actually an edge, and locate its parent face index
      let selectedParentFaceIndices: number[] = [];
      let hoveredParentFaceIndices: number[] = [];

      if (selectId && selectId.startsWith("BRepEdge-") && occtResult.lines) {
        const edgeIdx = parseInt(selectId.replace("BRepEdge-", ""), 10);
        const edgeObj = occtResult.lines[edgeIdx];
        if (edgeObj) {
          selectedParentFaceIndices = edgeObj.parentFaceIndices || (edgeObj.parentFaceIndex !== undefined ? [edgeObj.parentFaceIndex] : []);
        }
      }

      if (hoverId && hoverId.startsWith("BRepEdge-") && occtResult.lines) {
        const edgeIdx = parseInt(hoverId.replace("BRepEdge-", ""), 10);
        const edgeObj = occtResult.lines[edgeIdx];
        if (edgeObj) {
          hoveredParentFaceIndices = edgeObj.parentFaceIndices || (edgeObj.parentFaceIndex !== undefined ? [edgeObj.parentFaceIndex] : []);
        }
      }

      // Translate 3D SOLID meshes into selectable B-Rep Faces
      if (occtResult.meshes && occtResult.meshes.length > 0) {
        occtResult.meshes.forEach((mesh: any, idx: number) => {
          if (!mesh.positions || mesh.positions.length === 0) return;
          meshCounter++;

          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3));

          if (mesh.normals && mesh.normals.length > 0) {
            geometry.setAttribute("normal", new THREE.Float32BufferAttribute(mesh.normals, 3));
          } else {
            geometry.computeVertexNormals();
          }

          if (mesh.indices && mesh.indices.length > 0) {
            geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.indices), 1));
            totalTriangles += mesh.indices.length / 3;
          }

          const pickVertexOffset = pickPositions.length / 3;
          const pickVertexCount = Math.floor(mesh.positions.length / 3);
          for (let i = 0; i < mesh.positions.length; i++) {
            pickPositions.push(mesh.positions[i]);
          }
          for (let i = 0; i < pickVertexCount; i++) {
            pickFaceNamesByVertex[pickVertexOffset + i] = `BRepFace-${idx}`;
          }
          if (mesh.indices && mesh.indices.length > 0) {
            for (let i = 0; i < mesh.indices.length; i++) {
              pickIndices.push(pickVertexOffset + mesh.indices[i]);
              if (i % 3 === 2) pickFaceNamesByTriangle.push(`BRepFace-${idx}`);
            }
          } else {
            const positionVertexCount = Math.floor(mesh.positions.length / 3);
            for (let i = 0; i < positionVertexCount; i++) {
              pickIndices.push(pickVertexOffset + i);
              if (i % 3 === 2) pickFaceNamesByTriangle.push(`BRepFace-${idx}`);
            }
          }

          const baseColor = mesh.color && mesh.color.length === 3 ?
            new THREE.Color(mesh.color[0], mesh.color[1], mesh.color[2]) :
            new THREE.Color("#71717a"); // silver fallback

          // Face styling is direct only. Selecting an edge should not make an
          // adjacent face look selected; the edge itself carries that state.
          const isSelected = selectId === `BRepFace-${idx}`;
          const isHovered = hoverId === `BRepFace-${idx}`;
          const faceArea = computeIndexedTriangleArea(mesh.positions, mesh.indices);
          const interactionCache = computeFaceInteractionCache(mesh.positions, mesh.indices, mesh.normals);
          const faceUserData = {
            index: idx,
            type: "face",
            triangles: mesh.indices ? mesh.indices.length / 3 : 0,
            positions: mesh.positions,
            color: baseColor.getHexString(),
            area: faceArea,
            interactionCache,
          };

          if (activeMode === "points") {
            const pointMat = new THREE.PointsMaterial({
              color: isSelected ? 0x10b981 : (isHovered ? 0x38bdf8 : baseColor),
              size: 0.15,
              sizeAttenuation: true,
            });
            const ptsObj = new THREE.Points(geometry, pointMat);
            ptsObj.name = `BRepFace-${idx}`;
            ptsObj.userData = { ...faceUserData, triangles: 0 };
            assemblyGroup.add(ptsObj);
            renderedObjectByName.set(ptsObj.name, ptsObj);
            cadFallbackFacePickObjects.push(ptsObj);
          } else {
            const mat = getFaceMaterial(activeMat, baseColor, activeMode, isSelected, isHovered);
            const meshObj = new THREE.Mesh(geometry, mat);
            meshObj.name = `BRepFace-${idx}`;
            meshObj.userData = faceUserData;
            assemblyGroup.add(meshObj);
            renderedObjectByName.set(meshObj.name, meshObj);
            cadFallbackFacePickObjects.push(meshObj);

            // Solid overlaid grid lines
            if (overlayOn && activeMode !== "wireframe") {
              const wireMat = new THREE.MeshBasicMaterial({
                color: isSelected ? 0x059669 : 0x1e293b,
                wireframe: true,
                transparent: true,
                opacity: isSelected ? 0.45 : 0.15,
                depthWrite: false,
              });
              const wireOverlay = new THREE.Mesh(geometry, wireMat);
              assemblyGroup.add(wireOverlay);
            }
          }
        });
      }

      if (pickPositions.length > 0 && pickIndices.length > 0) {
        const pickGeometry = new THREE.BufferGeometry();
        pickGeometry.setAttribute("position", new THREE.Float32BufferAttribute(pickPositions, 3));
        pickGeometry.setIndex(new THREE.BufferAttribute(new Uint32Array(pickIndices), 1));
        pickGeometry.computeBoundingBox();
        pickGeometry.computeBoundingSphere();
        (pickGeometry as any).computeBoundsTree({ strategy: SAH, maxLeafSize: 8, indirect: true });

        const pickMaterial = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        pickMaterial.colorWrite = false;

        const pickMesh = new THREE.Mesh(pickGeometry, pickMaterial);
        pickMesh.name = "CADFacePickSurface";
        pickMesh.userData.pickFaceNamesByTriangle = pickFaceNamesByTriangle;
        pickMesh.userData.pickFaceNamesByVertex = pickFaceNamesByVertex;
        pickMesh.visible = false;
        assemblyGroup.add(pickMesh);
        cadFacePickObjects = [pickMesh];
      }

      // Translate 3D line outlines into B-Rep Wireframe Edges
      if (occtResult.lines && occtResult.lines.length > 0) {
        occtResult.lines.forEach((line: any, idx: number) => {
          if (!line.positions || line.positions.length === 0) return;
          edgeCounter++;

          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.Float32BufferAttribute(line.positions, 3));

          if (line.indices && line.indices.length > 0) {
            geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(line.indices), 1));
          }

          const isEdgeSelected = selectId === `BRepEdge-${idx}`;
          const isEdgeHovered = hoverId === `BRepEdge-${idx}`;

          // Detect if parent face is selected/hovered to activate synchronization
          const parentFaceIndices = line.parentFaceIndices || (line.parentFaceIndex !== undefined ? [line.parentFaceIndex] : []);
          const isParentSelected = parentFaceIndices.some((parentFaceIdx: number) => selectId === `BRepFace-${parentFaceIdx}` || selectedParentFaceIndices.includes(parentFaceIdx));
          const isParentHovered = parentFaceIndices.some((parentFaceIdx: number) => hoverId === `BRepFace-${parentFaceIdx}` || hoveredParentFaceIndices.includes(parentFaceIdx));

          const isDirectlyActive = isEdgeSelected || isEdgeHovered;
          const isParentActive = isParentSelected || isParentHovered;
          const isHighlighted = isDirectlyActive || isParentActive;

          // Wireframe Overlay button state (overlayOn) determines if unhovered/unselected edges are visible
          // If wireframeOverlay is False, we hide edges EXCEPT those highlighted!
          // Hidden edges stay in the scene for visual face-boundary highlighting; pointer picking uses the merged face surface.
          const shouldBeVisible = overlayOn || isHighlighted;

          let edgeColor = 0x64748b; // neutral slate grey
          let edgeWidth = 1.5;
          let edgeOpacity = 0.35;

          if (isEdgeSelected || isParentSelected) {
            edgeColor = 0x10b981; // Emerald green
            edgeWidth = 4.0;
            edgeOpacity = 1.0;
          } else if (isEdgeHovered || isParentHovered) {
            edgeColor = 0xf43f5e; // Pink/rose high-luminance hover glow
            edgeWidth = 4.5;
            edgeOpacity = 1.0;
          } else if (!shouldBeVisible) {
            edgeOpacity = 0.0;
          }

          const edgeMaterial = new THREE.LineBasicMaterial({
            color: edgeColor,
            linewidth: edgeWidth,
            transparent: true,
            opacity: edgeOpacity,
            depthWrite: !shouldBeVisible ? false : true,
          });

          // Draw using THREE.LineSegments to prevent crossing lines across disjoint segments!
          const lineObj = new THREE.LineSegments(geometry, edgeMaterial);
          lineObj.name = `BRepEdge-${idx}`;
          lineObj.visible = shouldBeVisible;
          lineObj.userData = { 
            index: idx, 
            type: "edge", 
            positions: line.positions,
            parentFaceId: line.parentFaceId,
            parentFaceIndex: line.parentFaceIndex,
            parentFaceIds: line.parentFaceIds,
            parentFaceIndices: line.parentFaceIndices
          };
          assemblyGroup.add(lineObj);
          renderedObjectByName.set(lineObj.name, lineObj);

          parentFaceIndices.forEach((parentFaceIdx: number) => {
            const edgeNames = edgeNamesByFaceIndex.get(parentFaceIdx) || [];
            edgeNames.push(lineObj.name);
            edgeNamesByFaceIndex.set(parentFaceIdx, edgeNames);
          });
        });
      }

      // Fit Viewport camera bounds gracefully
      assemblyGroup.position.set(0, 0, 0);
      assemblyGroup.rotation.set(0, 0, 0);

      const bbox = new THREE.Box3().setFromObject(assemblyGroup);
      const sizeVec = new THREE.Vector3();
      const centerVec = new THREE.Vector3();
      bbox.getSize(sizeVec);
      bbox.getCenter(centerVec);

      // Shift offset block to clear space around origin
      assemblyGroup.position.x = -centerVec.x;
      assemblyGroup.position.y = -centerVec.y;
      assemblyGroup.position.z = -centerVec.z;
      modelOrbitTarget.set(0, 0, 0);

      // Setup clean workspace floor grid helper
      const sizeMax = Math.max(sizeVec.x, sizeVec.y, sizeVec.z) || 10;
      modelSizeMax = sizeMax;
      gridHelper = new THREE.GridHelper(sizeMax * 3.5, 24, 0x94a3b8, 0xe2e8f0);
      gridHelper.position.set(0, -4, 0);
      scene.add(gridHelper);

      // Dynamically adjust camera clipping and orbit controller limits based on model size
      camera.near = Math.max(0.01, sizeMax * 0.001);
      camera.far = Math.max(5000, sizeMax * 150);
      camera.updateProjectionMatrix();

      controls.minDistance = Math.max(0.1, sizeMax * 0.02);
      controls.maxDistance = Math.max(1000, sizeMax * 50);

      // Dynamically orient Lights based on model size for perfect highlights
      mainDirLight.position.set(sizeMax * 1.5, sizeMax * 2.5, sizeMax * 1.2);
      sideCyanLight.position.set(-sizeMax * 1.2, -sizeMax * 0.9, -sizeMax * 1.2);
      ambientPurpleLight.position.set(0, 0, -sizeMax * 2);

      // Re-center Orbit controls focus
      if (resetCamera) {
        const cameraFov = camera.fov * (Math.PI / 180);
        let fitDist = Math.abs(sizeMax / 2 / Math.tan(cameraFov / 2)) * 1.55;
        fitDist = Math.max(10, fitDist); // No upper cap of 180 so large models fit perfectly!

        camera.position.set(fitDist * 0.7, fitDist * 0.6, fitDist);
        controls.target.copy(modelOrbitTarget);
        controls.update();
      }

      assemblyGroup.updateMatrixWorld(true);
      updateFloorGridPosition();

      setModelStats({
        width: parseFloat(sizeVec.x.toFixed(2)),
        height: parseFloat(sizeVec.y.toFixed(2)),
        depth: parseFloat(sizeVec.z.toFixed(2)),
        triangles: Math.round(totalTriangles),
        meshes: meshCounter,
        edges: edgeCounter,
      });
      if (cadFacePickObjects.length === 0) {
        cadFacePickObjects = assemblyGroup.children.filter((child) => child.name.startsWith("BRepFace-"));
      }
    };

    rebuildSceneTopology(true);

    // Setup interactive Raycasting variables
    let currentHoverObj: any | null = null;
    let oldEmissiveColor = new THREE.Color(0, 0, 0);
    let lastHoveredCoordinateKey = "";
    let isNavigatingView = false;
    const pointerRaycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    const pointerMovePoint = new THREE.Vector2();
    (pointerRaycaster as any).firstHitOnly = true;
    pointerRaycaster.params.Points = { threshold: 0.15 };
    let pendingMouseEvent: MouseEvent | null = null;
    let mouseMoveFrameId: number | null = null;
    let hoverRaycastTimeoutId: number | null = null;
    let lastHoverRaycastAt = 0;
    let lastHoverPickClientX = -Infinity;
    let lastHoverPickClientY = -Infinity;
    let pointerDownPoint: THREE.Vector2 | null = null;
    let pointerMovedSinceDown = false;
    let suppressMeasurementUntil = 0;
    let prevHighlightToken = "";
    let previousHighlightNames = new Set<string>();
    let lastHoveredCoordinateUpdateAt = 0;
    let lastHoverNotifyAt = 0;
    let pendingHoverEntity: any | null = null;
    let hoverNotifyTimeoutId: number | null = null;

    const getHighlightToken = () =>
      `${propsRef.current.selectedEntityId || ""}|${(propsRef.current.selectedRelatedEntityIds || []).join(",")}|${propsRef.current.hoveredEntityId || ""}|${propsRef.current.wireframeOverlay ? "1" : "0"}`;

    const notifyParentHover = (entity: any | null, immediate = false) => {
      pendingHoverEntity = entity;
      const now = performance.now();
      const delay = Math.max(0, 240 - (now - lastHoverNotifyAt));

      const flush = () => {
        hoverNotifyTimeoutId = null;
        lastHoverNotifyAt = performance.now();
        onHoverEntity(pendingHoverEntity);
      };

      if (immediate || delay === 0) {
        if (hoverNotifyTimeoutId !== null) {
          window.clearTimeout(hoverNotifyTimeoutId);
          hoverNotifyTimeoutId = null;
        }
        flush();
        return;
      }

      if (hoverNotifyTimeoutId === null) {
        hoverNotifyTimeoutId = window.setTimeout(flush, delay);
      }
    };

    const setViewportHoverEntity = (entity: any | null, immediateParentNotify = false) => {
      propsRef.current.hoveredEntityId = entity ? entity.id : null;
      updateHighlightStyles();
      prevHighlightToken = getHighlightToken();
      requestRenderRef.current?.(2);
      notifyParentHover(entity, immediateParentNotify);
    };

    const checkRaycastIntersections = (clientX: number, clientY: number, allowFallback = false) => {
      const rect = canvas.getBoundingClientRect();
      const ptX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ptY = -((clientY - rect.top) / rect.height) * 2 + 1;

      pointerNdc.set(ptX, ptY);
      pointerRaycaster.setFromCamera(pointerNdc, camera);

      const acceleratedHits = pointerRaycaster.intersectObjects(cadFacePickObjects, false);
      if (acceleratedHits.length > 0 || !allowFallback) return acceleratedHits;
      return pointerRaycaster.intersectObjects(cadFallbackFacePickObjects, false);
    };

    const pickCadIntersection = (intersections: THREE.Intersection[], allowFallback = false) => {
      for (const item of intersections) {
        if (item.object.name.startsWith("BRepFace-")) return item;

        if (item.object.name === "CADFacePickSurface") {
          const faceIndex = item.faceIndex ?? -1;
          const faceName =
            item.object.userData.pickFaceNamesByTriangle?.[faceIndex] ||
            item.object.userData.pickFaceNamesByVertex?.[item.face?.a ?? -1] ||
            item.object.userData.pickFaceNamesByVertex?.[item.face?.b ?? -1] ||
            item.object.userData.pickFaceNamesByVertex?.[item.face?.c ?? -1];
          const faceObject = faceName ? renderedObjectByName.get(faceName) : null;
          if (faceObject) {
            return { ...item, object: faceObject };
          }
        }
      }

      if (!allowFallback) return null;

      const fallbackHit = pointerRaycaster
        .intersectObjects(cadFallbackFacePickObjects, false)
        .find(item => item.object.name.startsWith("BRepFace-"));
      if (fallbackHit) return fallbackHit;

      return null;
    };

    const getEdgeSnapNearLocalPoint = (
      edgeObject: THREE.Object3D,
      localTarget: THREE.Vector3,
      maxDistance: number
    ): { point: THREE.Vector3; distanceSq: number } | null => {
      const geometry = (edgeObject as THREE.LineSegments).geometry as THREE.BufferGeometry | undefined;
      const position = geometry?.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (!position || position.count < 2) return null;

      const index = geometry?.getIndex();
      const localA = new THREE.Vector3();
      const localB = new THREE.Vector3();
      const assemblyA = new THREE.Vector3();
      const assemblyB = new THREE.Vector3();
      const closest = new THREE.Vector3();
      const bestPoint = new THREE.Vector3();
      let bestDistanceSq = Infinity;

      const testSegment = (aIndex: number, bIndex: number) => {
        if (aIndex < 0 || bIndex < 0 || aIndex >= position.count || bIndex >= position.count) return;
        localA.set(position.getX(aIndex), position.getY(aIndex), position.getZ(aIndex));
        localB.set(position.getX(bIndex), position.getY(bIndex), position.getZ(bIndex));
        assemblyA.copy(localA);
        assemblyB.copy(localB);
        edgeObject.localToWorld(assemblyA);
        edgeObject.localToWorld(assemblyB);
        assemblyGroup.worldToLocal(assemblyA);
        assemblyGroup.worldToLocal(assemblyB);

        const segment = assemblyB.clone().sub(assemblyA);
        const segmentLengthSq = segment.lengthSq();
        if (segmentLengthSq <= 1e-12) return;
        const t = THREE.MathUtils.clamp(localTarget.clone().sub(assemblyA).dot(segment) / segmentLengthSq, 0, 1);
        closest.copy(assemblyA).addScaledVector(segment, t);
        const distanceSq = closest.distanceToSquared(localTarget);
        if (distanceSq < bestDistanceSq) {
          bestDistanceSq = distanceSq;
          bestPoint.copy(closest);
        }
      };

      if (index && index.count >= 2) {
        for (let i = 0; i < index.count - 1; i += 2) {
          testSegment(index.getX(i), index.getX(i + 1));
        }
      } else {
        for (let i = 0; i < position.count - 1; i += 2) {
          testSegment(i, i + 1);
        }
      }

      return bestDistanceSq <= maxDistance * maxDistance
        ? { point: bestPoint.clone(), distanceSq: bestDistanceSq }
        : null;
    };

    const getEdgeCircleSnap = (edgeObject: THREE.Object3D, localPoint: THREE.Vector3): MeasurementCircleSnap | undefined => {
      const geometry = (edgeObject as THREE.LineSegments).geometry as THREE.BufferGeometry | undefined;
      const position = geometry?.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (!position || position.count < 8) return undefined;

      const index = geometry?.getIndex();
      const points: THREE.Vector3[] = [];
      const seen = new Set<string>();
      const readVertex = (vertexIndex: number) => {
        if (vertexIndex < 0 || vertexIndex >= position.count) return;
        const point = new THREE.Vector3(position.getX(vertexIndex), position.getY(vertexIndex), position.getZ(vertexIndex));
        edgeObject.localToWorld(point);
        assemblyGroup.worldToLocal(point);
        const key = `${point.x.toFixed(5)}|${point.y.toFixed(5)}|${point.z.toFixed(5)}`;
        if (!seen.has(key)) {
          seen.add(key);
          points.push(point);
        }
      };

      if (index && index.count > 0) {
        for (let i = 0; i < index.count; i++) readVertex(index.getX(i));
      } else {
        for (let i = 0; i < position.count; i++) readVertex(i);
      }

      if (points.length < 8) return undefined;

      const center = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(points.length);
      const radii = points.map((point) => point.distanceTo(center)).filter((radius) => Number.isFinite(radius) && radius > 1e-7);
      if (radii.length < 8) return undefined;

      const radius = radii.reduce((sum, value) => sum + value, 0) / radii.length;
      const maxDeviation = radii.reduce((max, value) => Math.max(max, Math.abs(value - radius)), 0);
      if (radius <= 1e-7 || maxDeviation / radius > 0.08) return undefined;

      const radial = localPoint.clone().sub(center);
      if (radial.lengthSq() <= 1e-8) {
        radial.copy(points[0]).sub(center);
      }
      if (radial.lengthSq() <= 1e-8) return undefined;
      radial.normalize();

      return { center, radius, radial };
    };

    const getCylinderFaceCircleSnap = (
      faceObject: THREE.Object3D,
      localPoint: THREE.Vector3
    ): MeasurementCircleSnap | undefined => {
      const cache = faceObject.userData.interactionCache;
      const geometry = (faceObject as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      const position = geometry?.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (!position || position.count < 8) return undefined;

      const estimateAxisFromNormals = () => {
        const normalAttr = geometry?.getAttribute("normal") as THREE.BufferAttribute | undefined;
        if (!normalAttr || normalAttr.count < 3) return null;

        const normalMatrix = new THREE.Matrix3().getNormalMatrix(faceObject.matrixWorld);
        const assemblyNormalMatrix = new THREE.Matrix3().getNormalMatrix(assemblyGroup.matrixWorld.clone().invert());
        const normals: THREE.Vector3[] = [];
        const step = Math.max(1, Math.floor(normalAttr.count / 48));
        for (let i = 0; i < normalAttr.count; i += step) {
          const normal = new THREE.Vector3(normalAttr.getX(i), normalAttr.getY(i), normalAttr.getZ(i))
            .applyMatrix3(normalMatrix)
            .applyMatrix3(assemblyNormalMatrix);
          if (normal.lengthSq() > 1e-8) normals.push(normal.normalize());
        }

        const axis = new THREE.Vector3();
        for (let i = 0; i < normals.length; i++) {
          for (let j = i + 1; j < normals.length; j += 3) {
            const cross = new THREE.Vector3().crossVectors(normals[i], normals[j]);
            if (cross.lengthSq() <= 0.03) continue;
            cross.normalize();
            if (axis.lengthSq() > 1e-8 && cross.dot(axis) < 0) cross.negate();
            axis.add(cross);
          }
        }

        return axis.lengthSq() > 1e-6 ? axis.normalize() : null;
      };

      const axis = estimateAxisFromNormals()
        || (cache?.cylinderAxis instanceof THREE.Vector3 ? cache.cylinderAxis.clone() : new THREE.Vector3(1, 0, 0));
      if (axis.lengthSq() <= 1e-8) return undefined;
      axis.normalize();

      const points: THREE.Vector3[] = [];
      for (let i = 0; i < position.count; i++) {
        const point = new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i));
        faceObject.localToWorld(point);
        assemblyGroup.worldToLocal(point);
        points.push(point);
      }

      const uAxis = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(1, 0, 0));
      if (uAxis.lengthSq() <= 1e-8) {
        uAxis.crossVectors(axis, new THREE.Vector3(0, 1, 0));
      }
      if (uAxis.lengthSq() <= 1e-8) return undefined;
      uAxis.normalize();
      const vAxis = new THREE.Vector3().crossVectors(axis, uAxis).normalize();

      let sx = 0;
      let sy = 0;
      let s1 = 0;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      let sxz = 0;
      let syz = 0;
      let sz = 0;

      points.forEach((point) => {
        const x = point.dot(uAxis);
        const y = point.dot(vAxis);
        const z = -(x * x + y * y);
        sx += x;
        sy += y;
        s1 += 1;
        sxx += x * x;
        syy += y * y;
        sxy += x * y;
        sxz += x * z;
        syz += y * z;
        sz += z;
      });

      const det =
        sxx * (syy * s1 - sy * sy) -
        sxy * (sxy * s1 - sy * sx) +
        sx * (sxy * sy - syy * sx);
      if (Math.abs(det) <= 1e-8) return undefined;

      const detA =
        sxz * (syy * s1 - sy * sy) -
        sxy * (syz * s1 - sy * sz) +
        sx * (syz * sy - syy * sz);
      const detB =
        sxx * (syz * s1 - sy * sz) -
        sxz * (sxy * s1 - sy * sx) +
        sx * (sxy * sz - syz * sx);
      const detC =
        sxx * (syy * sz - syz * sy) -
        sxy * (sxy * sz - syz * sx) +
        sxz * (sxy * sy - syy * sx);

      const circleA = detA / det;
      const circleB = detB / det;
      const circleC = detC / det;
      const centerX = -circleA * 0.5;
      const centerY = -circleB * 0.5;
      const radiusSq = centerX * centerX + centerY * centerY - circleC;
      if (!Number.isFinite(radiusSq) || radiusSq <= 1e-8) return undefined;

      const radius = Math.sqrt(radiusSq);
      const maxDeviation = points.reduce((max, point) => {
        const x = point.dot(uAxis) - centerX;
        const y = point.dot(vAxis) - centerY;
        return Math.max(max, Math.abs(Math.sqrt(x * x + y * y) - radius));
      }, 0);
      if (radius <= 1e-7 || maxDeviation / radius > 0.12) return undefined;

      const normalAttr = geometry.getAttribute("normal") as THREE.BufferAttribute | undefined;
      if (normalAttr && normalAttr.count > 0) {
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(faceObject.matrixWorld);
        const assemblyNormalMatrix = new THREE.Matrix3().getNormalMatrix(assemblyGroup.matrixWorld.clone().invert());
        const normalStep = Math.max(1, Math.floor(Math.min(position.count, normalAttr.count) / 64));
        let radialAlignment = 0;
        let radialSamples = 0;

        for (let i = 0; i < Math.min(position.count, normalAttr.count); i += normalStep) {
          const point = points[i];
          if (!point) continue;
          const radial = uAxis.clone().multiplyScalar(point.dot(uAxis) - centerX)
            .addScaledVector(vAxis, point.dot(vAxis) - centerY);
          if (radial.lengthSq() <= 1e-8) continue;

          const normal = new THREE.Vector3(normalAttr.getX(i), normalAttr.getY(i), normalAttr.getZ(i))
            .applyMatrix3(normalMatrix)
            .applyMatrix3(assemblyNormalMatrix);
          if (normal.lengthSq() <= 1e-8) continue;

          radialAlignment += Math.abs(normal.normalize().dot(radial.normalize()));
          radialSamples++;
        }

        if (radialSamples < 4 || radialAlignment / radialSamples < 0.55) return undefined;
      }

      const clickedAxial = localPoint.dot(axis);
      const center = uAxis.clone().multiplyScalar(centerX)
        .addScaledVector(vAxis, centerY)
        .addScaledVector(axis, clickedAxial);
      const radial = localPoint.clone().sub(center);
      if (radial.lengthSq() <= 1e-8) return undefined;
      radial.normalize();

      return { center, radius, radial };
    };

    const getPlanarCircularFaceCircleSnap = (
      faceObject: THREE.Object3D,
      localPoint: THREE.Vector3,
      normal: THREE.Vector3
    ): MeasurementCircleSnap | undefined => {
      const faceIndex = faceObject.userData.index;
      const faceArea = Number(faceObject.userData.area);
      if (!Number.isFinite(faceIndex) || !Number.isFinite(faceArea) || faceArea <= 1e-8) return undefined;

      const edgeNames = edgeNamesByFaceIndex.get(faceIndex) || [];
      let bestCircle: MeasurementCircleSnap | undefined;
      let bestScore = Infinity;

      edgeNames.forEach((edgeName) => {
        const edgeObject = renderedObjectByName.get(edgeName);
        if (!edgeObject) return;
        const circle = getEdgeCircleSnap(edgeObject, localPoint);
        if (!circle) return;

        const circleArea = Math.PI * circle.radius * circle.radius;
        if (circleArea <= 1e-8) return;
        const areaRatio = faceArea / circleArea;
        const planeOffset = Math.abs(circle.center.clone().sub(localPoint).dot(normal));
        if (areaRatio < 0.88 || areaRatio > 1.12 || planeOffset > Math.max(modelSizeMax * 0.006, 0.05)) return;

        const score = Math.abs(1 - areaRatio) + planeOffset / Math.max(circle.radius, 1e-7);
        if (score < bestScore) {
          bestScore = score;
          bestCircle = circle;
        }
      });

      return bestCircle;
    };

    const getFaceMeasurementSample = (match: THREE.Intersection): MeasurementSample | null => {
      const localPoint = assemblyGroup.worldToLocal(match.point.clone());
      const normal = new THREE.Vector3();
      const cache = match.object.userData.interactionCache;
      const isPlanarFace = cache?.coherentNormal instanceof THREE.Vector3;

      if (match.face?.normal) {
        normal.copy(match.face.normal).transformDirection(match.object.matrixWorld);
      } else if (isPlanarFace) {
        normal.copy(cache.coherentNormal).transformDirection(match.object.matrixWorld);
      }

      if (isPlanarFace && normal.lengthSq() > 1e-8) {
        normal.transformDirection(assemblyGroup.matrixWorld.clone().invert()).normalize();
        return {
          point: localPoint,
          kind: "face",
          objectName: match.object.name,
          normal,
          planeConstant: normal.dot(localPoint),
        };
      }

      const cylinderCircle = getCylinderFaceCircleSnap(match.object, localPoint);
      if (cylinderCircle) {
        return {
          point: localPoint,
          kind: "cylinder",
          objectName: match.object.name,
          circle: cylinderCircle,
        };
      }

      if (normal.lengthSq() <= 1e-8) return null;
      normal.transformDirection(assemblyGroup.matrixWorld.clone().invert()).normalize();
      const circularFaceCircle = getPlanarCircularFaceCircleSnap(match.object, localPoint, normal);
      if (circularFaceCircle) {
        return {
          point: localPoint,
          kind: "face",
          objectName: match.object.name,
          normal,
          planeConstant: normal.dot(localPoint),
          circle: circularFaceCircle,
        };
      }

      return {
        point: localPoint,
        kind: "face",
        objectName: match.object.name,
        normal,
        planeConstant: normal.dot(localPoint),
      };
    };

    const getMeasurementSnapSample = (intersections: THREE.Intersection[], allowFallback = false): MeasurementSample | null => {
      const snapRadius = Math.max(modelSizeMax * 0.008, 0.15);
      const faceMatch = pickCadIntersection(intersections, allowFallback);
      const faceHits = faceMatch ? [faceMatch] : [];
      const faceSample = faceHits[0] ? getFaceMeasurementSample(faceHits[0]) : null;
      const activeMeasurementStartedOnFace = measurementPoints.length === 1 && measurementPoints[0].kind === "face" && !measurementPoints[0].circle;
      const hitFaceIsPlanar = faceHits[0]?.object.userData.interactionCache?.coherentNormal instanceof THREE.Vector3;
      if (activeMeasurementStartedOnFace && faceSample) {
        return faceSample.circle
          ? { ...faceSample, circle: undefined }
          : faceSample;
      }
      if (faceSample?.kind === "cylinder" || faceSample?.circle) return faceSample;

      const makeBoundaryEdgeSample = (snap: { point: THREE.Vector3; object: THREE.Object3D }): MeasurementSample => {
        const localPoint = snap.point.clone();
        return {
          point: localPoint,
          kind: "edge",
          objectName: snap.object.name,
          circle: getEdgeCircleSnap(snap.object, localPoint),
        };
      };

      const findCircularBoundarySample = (edgeObjects: THREE.Object3D[], maxDistance: number, localAnchor?: THREE.Vector3) => {
        if (!localAnchor) return null;
        let bestCircularSnap: { point: THREE.Vector3; distanceSq: number; object: THREE.Object3D } | null = null;
        edgeObjects.forEach((edgeObject) => {
          if (!edgeObject.name.startsWith("BRepEdge-")) return;
          const snap = getEdgeSnapNearLocalPoint(edgeObject, localAnchor, Math.max(maxDistance * 2.5, modelSizeMax * 0.035, 0.35));
          if (!snap) return;
          const edgeSample = makeBoundaryEdgeSample({ point: snap.point, object: edgeObject });
          if (!edgeSample.circle) return;
          if (!bestCircularSnap || snap.distanceSq < bestCircularSnap.distanceSq) {
            bestCircularSnap = { ...snap, object: edgeObject };
          }
        });
        return bestCircularSnap ? makeBoundaryEdgeSample(bestCircularSnap) : null;
      };

      if (hitFaceIsPlanar && faceSample) return faceSample;

      const faceHit = faceHits[0];
      const faceIndex = faceHit?.object.userData.index;
      const faceLocalPoint = faceHit ? assemblyGroup.worldToLocal(faceHit.point.clone()) : undefined;
      const boundaryEdgeObjects = Number.isFinite(faceIndex)
        ? (edgeNamesByFaceIndex.get(faceIndex) || [])
          .map((edgeName) => renderedObjectByName.get(edgeName))
          .filter((edgeObject): edgeObject is THREE.Object3D => !!edgeObject)
        : [];
      const circularBoundarySample = findCircularBoundarySample(
        boundaryEdgeObjects,
        Math.max(snapRadius * 2.25, modelSizeMax * 0.014, 0.25),
        faceLocalPoint
      );
      if (circularBoundarySample) return circularBoundarySample;

      if (faceSample) return faceSample;

      const match = pickCadIntersection(intersections, allowFallback);
      if (!match) return null;
      return getFaceMeasurementSample(match);
    };

    const clearHoverState = () => {
      if (currentHoverObj) {
        if (currentHoverObj.material instanceof THREE.MeshStandardMaterial) {
          currentHoverObj.material.emissive.set(oldEmissiveColor);
          requestRenderRef.current?.(2);
        }
        currentHoverObj = null;
        setViewportHoverEntity(null, true);
      }
      if (lastHoveredCoordinateKey !== "") {
        lastHoveredCoordinateKey = "";
        lastHoveredCoordinateUpdateAt = 0;
        setHoveredCoordinate(null);
      }
      lastHoverPickClientX = -Infinity;
      lastHoverPickClientY = -Infinity;
    };

    const handleMouseMoveNow = (e: MouseEvent) => {
      if (pointerDownPoint && pointerDownPoint.distanceTo(pointerMovePoint.set(e.clientX, e.clientY)) > 3) {
        pointerMovedSinceDown = true;
      }

      if (isNavigatingView) {
        clearHoverState();
        return;
      }

      const intersections = checkRaycastIntersections(e.clientX, e.clientY);

      if (intersections.length > 0) {
        // Filter elements starting with CAD prefixes
        const match = pickCadIntersection(intersections);
        if (match) {
          const pt = match.point;
          // Compensate group offset coordinate
          const x = parseFloat((pt.x + assemblyGroup.position.x).toFixed(2));
          const y = parseFloat((pt.y + assemblyGroup.position.y).toFixed(2));
          const z = parseFloat((pt.z + assemblyGroup.position.z).toFixed(2));
          const coordinateKey = `${x}|${y}|${z}`;
          if (coordinateKey !== lastHoveredCoordinateKey) {
            lastHoveredCoordinateKey = coordinateKey;
            const now = performance.now();
            if (now - lastHoveredCoordinateUpdateAt > 90) {
              lastHoveredCoordinateUpdateAt = now;
              setHoveredCoordinate({ x, y, z });
            }
          }

          const hoveredObj = match.object;
          if (currentHoverObj !== hoveredObj) {
            // Revert last hover shading
            if (currentHoverObj && currentHoverObj.material instanceof THREE.MeshStandardMaterial) {
              currentHoverObj.material.emissive.set(oldEmissiveColor);
            }

            currentHoverObj = hoveredObj;
            const type = currentHoverObj.name.startsWith("BRepFace-") ? "face" : "edge";
            const index = currentHoverObj.userData.index;

            const hoverEntity = {
              id: currentHoverObj.name,
              type,
              index,
              name: type === "face" ? `B-Rep Face #${index + 1}` : `B-Rep Edge #${index + 1}`,
              triangles: currentHoverObj.userData.triangles || 0,
              source: "viewport",
            };
            setViewportHoverEntity(hoverEntity);

            // Dynamic emissive glow highlighting for tactile feedback
            if (currentHoverObj.material instanceof THREE.MeshStandardMaterial) {
              oldEmissiveColor.copy(currentHoverObj.material.emissive);
              // Give hover face a gentle blueish-white emission highlight
              currentHoverObj.material.emissive.setHex(0x1e1b4b);
              requestRenderRef.current?.(2);
            }
          }
          return;
        }
      }

      // Revert if clear
      clearHoverState();
    };

    const handleMouseMove = (e: MouseEvent) => {
      pendingMouseEvent = e;
      if (mouseMoveFrameId !== null || hoverRaycastTimeoutId !== null) return;

      const scheduleRaycastFrame = () => {
        hoverRaycastTimeoutId = null;
        mouseMoveFrameId = requestAnimationFrame(() => {
          mouseMoveFrameId = null;
          if (!pendingMouseEvent) return;

          const now = performance.now();
          const dx = pendingMouseEvent.clientX - lastHoverPickClientX;
          const dy = pendingMouseEvent.clientY - lastHoverPickClientY;
          const canReuseHover =
            !!currentHoverObj &&
            !propsRef.current.measurementMode &&
            !pointerDownPoint &&
            now - lastHoverRaycastAt < 180 &&
            dx * dx + dy * dy < 25;

          if (!canReuseHover) {
            lastHoverRaycastAt = now;
            lastHoverPickClientX = pendingMouseEvent.clientX;
            lastHoverPickClientY = pendingMouseEvent.clientY;
            handleMouseMoveNow(pendingMouseEvent);
          }
          pendingMouseEvent = null;
        });
      };

      const elapsed = performance.now() - lastHoverRaycastAt;
      const hoverInterval = propsRef.current.measurementMode ? 33 : 42;
      const delay = Math.max(0, hoverInterval - elapsed);
      if (delay === 0) {
        scheduleRaycastFrame();
      } else {
        hoverRaycastTimeoutId = window.setTimeout(scheduleRaycastFrame, delay);
      }
    };

    const handleMouseLeave = () => {
      pendingMouseEvent = null;
      if (hoverRaycastTimeoutId !== null) {
        window.clearTimeout(hoverRaycastTimeoutId);
        hoverRaycastTimeoutId = null;
      }
      pointerDownPoint = null;
      pointerMovedSinceDown = false;
      clearHoverState();
    };

    const handlePointerDown = (e: PointerEvent) => {
      pointerDownPoint = new THREE.Vector2(e.clientX, e.clientY);
      pointerMovedSinceDown = false;
    };

    const disposeOverlayGroup = (group: THREE.Group | null) => {
      if (!group) return;
      group.traverse((item) => {
        if (item instanceof THREE.Line || item instanceof THREE.LineSegments || item instanceof THREE.Mesh) {
          item.geometry.dispose();
          if (Array.isArray(item.material)) {
            item.material.forEach((material) => material.dispose());
          } else {
            item.material.dispose();
          }
        }
      });
      assemblyGroup.remove(group);
    };

    const disposePreviousMeasurementGroup = () => {
      disposeOverlayGroup(previousMeasurementGroup);
      previousMeasurementGroup = null;
    };

    const disposeMeasurementGroup = () => {
      disposeOverlayGroup(measurementGroup);
      measurementGroup = null;
      measurementLabelPoint = null;
      setMeasurementLabel(null);
    };

    const preserveMeasurementAsPrevious = () => {
      disposePreviousMeasurementGroup();
      if (!measurementGroup) return;
      previousMeasurementGroup = measurementGroup;
      previousMeasurementGroup.name = "PreviousDistanceMeasurementOverlay";
      previousMeasurementGroup.traverse((item) => {
        if (item instanceof THREE.Line || item instanceof THREE.LineSegments || item instanceof THREE.Mesh) {
          item.renderOrder = Math.max(1, item.renderOrder - 8);
          const materials = Array.isArray(item.material) ? item.material : [item.material];
          materials.forEach((material) => {
            material.transparent = true;
            material.opacity = Math.min(material.opacity ?? 1, 0.24);
            material.depthWrite = false;
          });
        }
      });
      measurementGroup = null;
      measurementLabelPoint = null;
      setMeasurementLabel(null);
    };

    const addPointMarker = (group: THREE.Group, point: THREE.Vector3) => {
      const radius = Math.max(modelSizeMax * 0.006, 0.035);
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 12, 8),
        new THREE.MeshBasicMaterial({
          color: 0x059669,
          depthTest: false,
          depthWrite: false,
          transparent: true,
          opacity: 0.95,
        })
      );
      marker.position.copy(point);
      marker.renderOrder = 42;
      marker.raycast = () => undefined;
      group.add(marker);
    };

    const formatMm = (value: number) => `${value.toFixed(3)} mm`;
    const formatDegrees = (value: number) => `${value.toFixed(2)} deg`;

    const areSameMeasuredCircle = (a: MeasurementCircleSnap, b: MeasurementCircleSnap) => {
      const radius = Math.max(a.radius, b.radius, 1e-7);
      return a.center.distanceTo(b.center) <= radius * 0.06 && Math.abs(a.radius - b.radius) <= radius * 0.06;
    };

    const resolveCircleMeasurement = (circle: MeasurementCircleSnap): LinearMeasurementResult => ({
      mode: "linear",
      start: circle.center.clone().addScaledVector(circle.radial, -circle.radius),
      end: circle.center.clone().addScaledVector(circle.radial, circle.radius),
      text: `DIA ${formatMm(circle.radius * 2)}`,
      diameterReference: true,
    });

    const resolveMeasurement = (a: MeasurementSample, b: MeasurementSample): MeasurementResult => {
      if (a.circle && b.circle && areSameMeasuredCircle(a.circle, b.circle)) {
        const radial = a.circle.radial.clone().add(b.circle.radial);
        if (radial.lengthSq() <= 1e-8) {
          radial.copy(a.circle.radial);
        }
        radial.normalize();
        const radius = (a.circle.radius + b.circle.radius) * 0.5;
        const center = a.circle.center.clone().add(b.circle.center).multiplyScalar(0.5);
        return {
          mode: "linear",
          start: center.clone().addScaledVector(radial, -radius),
          end: center.clone().addScaledVector(radial, radius),
          text: `DIA ${formatMm(radius * 2)}`,
          diameterReference: true,
        };
      }

      if (a.kind === "face" && b.kind === "face" && a.normal && b.normal && a.planeConstant !== undefined && b.planeConstant !== undefined) {
        if (a.objectName === b.objectName) {
          return {
            mode: "linear",
            start: a.point.clone(),
            end: b.point.clone(),
            text: formatMm(a.point.distanceTo(b.point)),
            surfaceReference: a.normal.clone(),
          };
        }

        const n1 = a.normal.clone().normalize();
        const n2 = b.normal.clone().normalize();
        let dot = THREE.MathUtils.clamp(n1.dot(n2), -1, 1);
        if (Math.abs(dot) > 0.985) {
          let c2 = b.planeConstant;
          if (dot < 0) {
            n2.negate();
            c2 = -c2;
            dot = -dot;
          }
          const signedDistance = c2 - a.planeConstant;
          const coplanarTolerance = Math.max(modelSizeMax * 0.00005, 1e-5);
          if (Math.abs(signedDistance) <= coplanarTolerance) {
            return {
              mode: "linear",
              start: a.point.clone(),
              end: b.point.clone(),
              text: formatMm(a.point.distanceTo(b.point)),
              surfaceReference: n1.clone(),
            };
          }
          return {
            mode: "linear",
            start: a.point.clone(),
            end: a.point.clone().addScaledVector(n1, signedDistance),
            text: formatMm(Math.abs(signedDistance)),
            normalReference: n1.clone(),
          };
        }

        const rawIntersectionAxis = new THREE.Vector3().crossVectors(n1, n2);
        if (rawIntersectionAxis.lengthSq() > 1e-8) {
          const intersectionAxis = rawIntersectionAxis.clone().normalize();
          const denominator = rawIntersectionAxis.lengthSq();
          const linePoint = new THREE.Vector3()
            .addScaledVector(new THREE.Vector3().crossVectors(n2, rawIntersectionAxis), a.planeConstant)
            .addScaledVector(new THREE.Vector3().crossVectors(rawIntersectionAxis, n1), b.planeConstant)
            .divideScalar(Math.max(denominator, 1e-8));
          const pickedMidpoint = a.point.clone().add(b.point).multiplyScalar(0.5);
          const center = linePoint.clone().addScaledVector(
            intersectionAxis,
            pickedMidpoint.clone().sub(linePoint).dot(intersectionAxis)
          );
          const directionA = new THREE.Vector3().crossVectors(intersectionAxis, n1);
          const directionB = new THREE.Vector3().crossVectors(intersectionAxis, n2);
          if (directionA.lengthSq() > 1e-8 && directionB.lengthSq() > 1e-8) {
            directionA.normalize();
            directionB.normalize();
            if (a.point.clone().sub(center).dot(directionA) < 0) directionA.negate();
            if (b.point.clone().sub(center).dot(directionB) < 0) directionB.negate();
            if (directionA.dot(directionB) < 0) directionB.negate();

            const angularDot = THREE.MathUtils.clamp(directionA.dot(directionB), -1, 1);
            const angle = THREE.MathUtils.radToDeg(Math.acos(angularDot));
            const pickedRadius = Math.min(
              Math.max(a.point.distanceTo(center), modelSizeMax * 0.05),
              Math.max(b.point.distanceTo(center), modelSizeMax * 0.05)
            );
            const arcRadius = THREE.MathUtils.clamp(
              pickedRadius * 0.6,
              Math.max(modelSizeMax * 0.045, 0.15),
              Math.max(modelSizeMax * 0.18, 0.3)
            );

            return {
              mode: "angle",
              center,
              directionA,
              directionB,
              axis: intersectionAxis,
              radius: arcRadius,
              sourceA: a.point.clone(),
              sourceB: b.point.clone(),
              text: formatDegrees(angle),
            };
          }
        }
      }

      return {
        mode: "linear",
        start: a.point.clone(),
        end: b.point.clone(),
        text: formatMm(a.point.distanceTo(b.point)),
      };
    };

    const addMeasurementArrowHead = (
      group: THREE.Group,
      apex: THREE.Vector3,
      backDirection: THREE.Vector3,
      sideDirection: THREE.Vector3,
      arrowLength: number,
      arrowHalfWidth: number
    ) => {
      if (backDirection.lengthSq() <= 1e-8 || sideDirection.lengthSq() <= 1e-8 || arrowLength <= 1e-8) return;
      const back = backDirection.clone().normalize().multiplyScalar(arrowLength);
      const side = sideDirection.clone().normalize().multiplyScalar(arrowHalfWidth);
      const arrowGeometry = new THREE.BufferGeometry().setFromPoints([
        apex.clone(),
        apex.clone().add(back).add(side),
        apex.clone().add(back).sub(side),
      ]);
      const arrowMaterial = new THREE.MeshBasicMaterial({
        color: 0x047857,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.98,
      });
      const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
      arrow.name = "DistanceMeasurementArrowHead";
      arrow.renderOrder = 42;
      arrow.raycast = () => undefined;
      group.add(arrow);
    };

    const addMeasurementLineSegments = (group: THREE.Group, points: THREE.Vector3[], name: string) => {
      const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
      const lineMaterial = new THREE.LineBasicMaterial({
        color: 0x047857,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.98,
      });
      const lineObject = new THREE.LineSegments(lineGeometry, lineMaterial);
      lineObject.name = name;
      lineObject.renderOrder = 41;
      lineObject.raycast = () => undefined;
      group.add(lineObject);
      return lineObject;
    };

    const renderLinearMeasurement = (group: THREE.Group, result: LinearMeasurementResult) => {
      const start = result.start;
      const end = result.end;
      const axis = end.clone().sub(start);
      const distance = axis.length();
      if (distance <= 1e-8) return;

      axis.normalize();
      const midpoint = start.clone().add(end).multiplyScalar(0.5);
      const cameraLocal = assemblyGroup.worldToLocal(camera.position.clone());
      const viewDirection = cameraLocal.sub(midpoint).normalize();
      const targetLeaderOffset = Math.max(modelSizeMax * 0.065, 1e-4);
      const arrowLength = Math.min(targetLeaderOffset * 0.18, distance * 0.35);
      const arrowHalfWidth = arrowLength * 0.36;

      if (result.diameterReference) {
        let arrowSide = new THREE.Vector3().crossVectors(axis, viewDirection);
        if (arrowSide.lengthSq() <= 1e-8) {
          arrowSide.crossVectors(axis, new THREE.Vector3(0, 1, 0));
        }
        if (arrowSide.lengthSq() <= 1e-8) {
          arrowSide.crossVectors(axis, new THREE.Vector3(1, 0, 0));
        }
        arrowSide.normalize();

        addMeasurementLineSegments(group, [start, end], "DistanceMeasurementDiameter");
        addMeasurementArrowHead(group, start, axis, arrowSide, arrowLength, arrowHalfWidth);
        addMeasurementArrowHead(group, end, axis.clone().negate(), arrowSide, arrowLength, arrowHalfWidth);

        const labelSide = new THREE.Vector3().crossVectors(axis, arrowSide);
        if (labelSide.dot(viewDirection) < 0) labelSide.negate();
        measurementLabelPoint = midpoint.clone().addScaledVector(labelSide.normalize(), Math.max(modelSizeMax * 0.018, 0.08));
        setMeasurementLabel({ x: 0, y: 0, text: result.text, visible: false });
        return;
      }

      if (result.normalReference && Math.abs(result.normalReference.clone().normalize().dot(axis)) > 0.985) {
        let projectionDirection = new THREE.Vector3().crossVectors(axis, viewDirection);
        if (projectionDirection.lengthSq() <= 1e-8) {
          projectionDirection.crossVectors(axis, new THREE.Vector3(0, 1, 0));
        }
        if (projectionDirection.lengthSq() <= 1e-8) {
          projectionDirection.crossVectors(axis, new THREE.Vector3(1, 0, 0));
        }
        projectionDirection.normalize();
        if (projectionDirection.dot(viewDirection) < 0) projectionDirection.negate();

        const offsetDistance = Math.max(modelSizeMax * 0.045, distance * 0.08, 0.15);
        const dimStart = start.clone().addScaledVector(projectionDirection, offsetDistance);
        const dimEnd = end.clone().addScaledVector(projectionDirection, offsetDistance);

        addMeasurementLineSegments(group, [
          start, dimStart,
          end, dimEnd,
          dimStart, dimEnd,
        ], "DistanceMeasurementFaceToFace");
        addMeasurementArrowHead(group, dimStart, axis, projectionDirection, arrowLength, arrowHalfWidth);
        addMeasurementArrowHead(group, dimEnd, axis.clone().negate(), projectionDirection, arrowLength, arrowHalfWidth);

        const labelSide = new THREE.Vector3().crossVectors(axis, projectionDirection);
        if (labelSide.dot(viewDirection) < 0) labelSide.negate();
        measurementLabelPoint = dimStart.clone().add(dimEnd).multiplyScalar(0.5).addScaledVector(labelSide.normalize(), Math.max(modelSizeMax * 0.018, 0.08));
        setMeasurementLabel({ x: 0, y: 0, text: result.text, visible: false });
        return;
      }

      let offsetDirection = new THREE.Vector3().crossVectors(axis, viewDirection);
      let surfaceProjection = false;
      if (result.surfaceReference && result.surfaceReference.lengthSq() > 1e-8) {
        offsetDirection.copy(result.surfaceReference).normalize();
        if (offsetDirection.dot(viewDirection) < 0) offsetDirection.negate();
        surfaceProjection = offsetDirection.lengthSq() > 1e-8;
      }
      if (offsetDirection.lengthSq() <= 1e-8) {
        offsetDirection.crossVectors(axis, new THREE.Vector3(0, 1, 0));
      }
      if (offsetDirection.lengthSq() <= 1e-8) {
        offsetDirection.crossVectors(axis, new THREE.Vector3(1, 0, 0));
      }
      offsetDirection.normalize();
      if (!surfaceProjection) {
        offsetDirection.cross(axis).normalize();
      }
      if (offsetDirection.dot(viewDirection) < 0) offsetDirection.negate();

      const offsetDistance = Math.max(modelSizeMax * 0.045, distance * 0.08, 0.15);
      const dimStart = start.clone().addScaledVector(offsetDirection, offsetDistance);
      const dimEnd = end.clone().addScaledVector(offsetDirection, offsetDistance);

      addMeasurementLineSegments(group, [
        start, dimStart,
        end, dimEnd,
        dimStart, dimEnd,
      ], "DistanceMeasurementDimension");
      addMeasurementArrowHead(group, dimStart, axis, offsetDirection, arrowLength, arrowHalfWidth);
      addMeasurementArrowHead(group, dimEnd, axis.clone().negate(), offsetDirection, arrowLength, arrowHalfWidth);

      measurementLabelPoint = dimStart.clone().add(dimEnd).multiplyScalar(0.5).addScaledVector(offsetDirection, Math.max(modelSizeMax * 0.018, 0.08));
      setMeasurementLabel({ x: 0, y: 0, text: result.text, visible: false });
    };

    const renderAngularMeasurement = (group: THREE.Group, result: AngularMeasurementResult) => {
      const cross = new THREE.Vector3().crossVectors(result.directionA, result.directionB);
      const signedAngle = Math.atan2(result.axis.dot(cross), result.directionA.dot(result.directionB));
      if (Math.abs(signedAngle) <= 1e-5) return;

      const steps = Math.max(10, Math.ceil(Math.abs(signedAngle) / (Math.PI / 36)));
      const arcPoints: THREE.Vector3[] = [];
      for (let i = 0; i <= steps; i++) {
        const rotation = new THREE.Quaternion().setFromAxisAngle(result.axis, signedAngle * (i / steps));
        const direction = result.directionA.clone().applyQuaternion(rotation).normalize();
        arcPoints.push(result.center.clone().addScaledVector(direction, result.radius));
      }

      addMeasurementLineSegments(group, [
        result.sourceA, arcPoints[0],
        result.sourceB, arcPoints[arcPoints.length - 1],
      ], "DistanceMeasurementAngleExtensions");

      const arcGeometry = new THREE.BufferGeometry().setFromPoints(arcPoints);
      const arcMaterial = new THREE.LineBasicMaterial({
        color: 0x047857,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.98,
      });
      const arcObject = new THREE.Line(arcGeometry, arcMaterial);
      arcObject.name = "DistanceMeasurementAngleArc";
      arcObject.renderOrder = 41;
      arcObject.raycast = () => undefined;
      group.add(arcObject);

      const targetLeaderOffset = Math.max(modelSizeMax * 0.065, 1e-4);
      const arrowLength = Math.min(targetLeaderOffset * 0.18, result.radius * 0.35);
      const arrowHalfWidth = arrowLength * 0.36;
      const sign = signedAngle >= 0 ? 1 : -1;
      const tangentStart = new THREE.Vector3().crossVectors(result.axis, result.directionA).multiplyScalar(sign).normalize();
      const tangentEnd = new THREE.Vector3().crossVectors(result.axis, result.directionB).multiplyScalar(sign).normalize();
      addMeasurementArrowHead(group, arcPoints[0], tangentStart, result.axis, arrowLength, arrowHalfWidth);
      addMeasurementArrowHead(group, arcPoints[arcPoints.length - 1], tangentEnd.negate(), result.axis, arrowLength, arrowHalfWidth);

      const midRotation = new THREE.Quaternion().setFromAxisAngle(result.axis, signedAngle * 0.5);
      const midDirection = result.directionA.clone().applyQuaternion(midRotation).normalize();
      measurementLabelPoint = result.center.clone().addScaledVector(midDirection, result.radius + Math.max(modelSizeMax * 0.018, 0.08));
      setMeasurementLabel({ x: 0, y: 0, text: result.text, visible: false });
    };

    const buildMeasurementOverlay = () => {
      disposeMeasurementGroup();
      if (measurementPoints.length === 0) return;

      const group = new THREE.Group();
      group.name = "DistanceMeasurementOverlay";

      const result = measurementPoints.length === 1 && measurementPoints[0].circle
        ? resolveCircleMeasurement(measurementPoints[0].circle)
        : measurementPoints.length >= 2
          ? resolveMeasurement(measurementPoints[0], measurementPoints[1])
          : null;

      const showEndpointMarkers = result
        ? result.mode === "linear" && !result.diameterReference && !result.normalReference
        : measurementPoints.length === 1 && !measurementPoints[0].circle;
      if (showEndpointMarkers) {
        measurementPoints.forEach((sample) => addPointMarker(group, sample.point));
      }

      if (result) {
        if (result.mode === "angle") {
          renderAngularMeasurement(group, result);
        } else {
          renderLinearMeasurement(group, result);
        }
      }

      assemblyGroup.add(group);
      measurementGroup = group;
    };

    const addMeasurementPoint = (sample: MeasurementSample) => {
      const existingSingleComplete = measurementPoints.length === 1 && !!measurementPoints[0].circle;
      const existingTwoPointComplete = measurementPoints.length >= 2;
      const startsNewMeasurement = existingTwoPointComplete || existingSingleComplete || !!sample.circle;
      const startsNewPartialMeasurement = (existingTwoPointComplete || existingSingleComplete) && !sample.circle;
      const completesPartialMeasurement = measurementPoints.length === 1 && !measurementPoints[0].circle && !sample.circle;

      if (startsNewPartialMeasurement) {
        preserveMeasurementAsPrevious();
      } else if (startsNewMeasurement || completesPartialMeasurement) {
        disposePreviousMeasurementGroup();
      }

      measurementPoints = startsNewMeasurement
        ? [sample]
        : [...measurementPoints, sample];
      buildMeasurementOverlay();
    };

    const makeSelectionBlock = (match: THREE.Intersection): any | null => {
      const obj = match.object;
      if (!obj.name.startsWith("BRepFace-") && !obj.name.startsWith("BRepEdge-")) return null;
      const type = obj.name.startsWith("BRepFace-") ? "face" : "edge";
      const idx = obj.userData.index;
      const pt = match.point;

      const blockDetails: any = {
        id: obj.name,
        type,
        index: idx,
        name: type === "face" ? `B-Rep Face #${idx + 1}` : `B-Rep Edge #${idx + 1}`,
        point: {
          x: parseFloat((pt.x + assemblyGroup.position.x).toFixed(2)),
          y: parseFloat((pt.y + assemblyGroup.position.y).toFixed(2)),
          z: parseFloat((pt.z + assemblyGroup.position.z).toFixed(2)),
        }
      };

      if (type === "edge") {
        blockDetails.parentFaceIndices = obj.userData.parentFaceIndices || [];
        blockDetails.parentFaceIds = obj.userData.parentFaceIds || [];
        let pathLen = 0;
        const pointsPos = obj.userData.positions;
        if (pointsPos && pointsPos.length >= 6) {
          for (let i = 0; i < pointsPos.length - 3; i += 3) {
            const dx = pointsPos[i + 3] - pointsPos[i];
            const dy = pointsPos[i + 4] - pointsPos[i + 1];
            const dz = pointsPos[i + 5] - pointsPos[i + 2];
            pathLen += Math.sqrt(dx * dx + dy * dy + dz * dz);
          }
        }
        blockDetails.length = parseFloat(pathLen.toFixed(2)) || 4.5;
      } else {
        blockDetails.triangles = obj.userData.triangles;
        blockDetails.colorString = obj.userData.color;
        blockDetails.area = obj.userData.area;

        if (match.face && match.face.normal) {
          const normal = match.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(obj.matrixWorld));
          blockDetails.normal = {
            x: parseFloat(normal.x.toFixed(4)),
            y: parseFloat(normal.y.toFixed(4)),
            z: parseFloat(normal.z.toFixed(4)),
          };
        }
      }

      return blockDetails;
    };

    // Viewport clicks are reserved for measurements, except explicit binding mode.
    const handleMouseClick = (e: MouseEvent) => {
      const navigationClick = isNavigatingView || pointerMovedSinceDown || performance.now() < suppressMeasurementUntil;
      pointerDownPoint = null;
      pointerMovedSinceDown = false;
      if (propsRef.current.measurementMode && navigationClick) return;

      const intersections = checkRaycastIntersections(e.clientX, e.clientY, true);
      if (intersections.length > 0) {
        const match = pickCadIntersection(intersections, true);
        if (match) {
          if (propsRef.current.measurementMode) {
            const snapSample = getMeasurementSnapSample(intersections, true);
            if (snapSample) addMeasurementPoint(snapSample);
            requestRenderRef.current?.(3);
            return;
          }

          if (propsRef.current.selectionClickEnabled) {
            const blockDetails = makeSelectionBlock(match);
            if (blockDetails) onSelectEntity(blockDetails);
            requestRenderRef.current?.(3);
          }
        }
      }
    };

    const mapTargetToWebGLName = (targetId: string, identifier: string, allowIdentifierFallback = true): string | null => {
      if (!targetId) return null;
      
      const currentFaceRecords = propsRef.current.faceRecords || [];
      const currentCylinderIds = propsRef.current.cylinderIds || [];
      const currMapping = propsRef.current.customFaceMapping || {};

      // Normalize targetId format
      const tId = targetId.startsWith("#") ? targetId : `#${targetId}`;
      const visibleFace = (name?: string | null) => {
        if (!name) return null;
        return assemblyGroup.getObjectByName(name) ? name : null;
      };

      // 0. Use the explicit STEP target id first. Datum letters are semantic
      // labels, but targetId carries the actual resolved PMI geometry.
      const mappedTarget = visibleFace(currMapping[tId]);
      if (mappedTarget) {
        return mappedTarget;
      }
      const mappedIdentifier = allowIdentifierFallback && identifier ? visibleFace(currMapping[identifier]) : null;
      if (mappedIdentifier) {
        return mappedIdentifier;
      }

      // 1. Check direct match in faceRecords
      const directIdx = currentFaceRecords.findIndex(f => f.id === tId);
      if (directIdx !== -1) {
        const directFace = visibleFace(`BRepFace-${directIdx}`);
        if (directFace) return directFace;
      }

      // 2. Check indirect match (where a face references this target as geometric surface / bounding edge)
      const indirectIdx = currentFaceRecords.findIndex(f => f.referencedIds.includes(tId));
      if (indirectIdx !== -1) {
        const indirectFace = visibleFace(`BRepFace-${indirectIdx}`);
        if (indirectFace) return indirectFace;
      }

      // 3. Cylinder index fallback for procedural plate or intermediate cylindrical surfaces
      const cylIdx = currentCylinderIds.indexOf(tId);
      if (cylIdx !== -1) {
        // Cylindrical inner bore faces in standard representation start at index 2 (top=0, bottom=1)
        const cylinderFace = visibleFace(`BRepFace-${2 + cylIdx}`);
        if (cylinderFace) return cylinderFace;
      }

      if (targetId.startsWith("BRepFace-")) return visibleFace(targetId);
      return null;
    };

    const mapTargetToTopologicalWebGLName = (targetId: string): string | null => {
      if (!targetId) return null;

      const currentFaceRecords = propsRef.current.faceRecords || [];
      const currentCylinderIds = propsRef.current.cylinderIds || [];
      const tId = targetId.startsWith("#") ? targetId : `#${targetId}`;
      const visibleFace = (name?: string | null) => {
        if (!name) return null;
        return assemblyGroup.getObjectByName(name) ? name : null;
      };

      const directIdx = currentFaceRecords.findIndex(f => f.id === tId);
      if (directIdx !== -1) {
        const directFace = visibleFace(`BRepFace-${directIdx}`);
        if (directFace) return directFace;
      }

      const indirectIdx = currentFaceRecords.findIndex(f => f.referencedIds.includes(tId));
      if (indirectIdx !== -1) {
        const indirectFace = visibleFace(`BRepFace-${indirectIdx}`);
        if (indirectFace) return indirectFace;
      }

      const cylIdx = currentCylinderIds.indexOf(tId);
      if (cylIdx !== -1) {
        const cylinderFace = visibleFace(`BRepFace-${2 + cylIdx}`);
        if (cylinderFace) return cylinderFace;
      }

      if (targetId.startsWith("BRepFace-")) return visibleFace(targetId);
      return null;
    };

    const getCustomMappedVisibleFaceName = (key?: string | null): string | null => {
      if (!key) return null;
      const currMapping = propsRef.current.customFaceMapping || {};
      const mapped = currMapping[key] || (key.startsWith("#") ? undefined : currMapping[`#${key}`]);
      return mapped && assemblyGroup.getObjectByName(mapped) ? mapped : null;
    };

    const getFaceFrameInAssembly = (faceName: string): {
      object: THREE.Object3D;
      center: THREE.Vector3;
      normal: THREE.Vector3 | null;
      area: number;
    } | null => {
      const object = assemblyGroup.getObjectByName(faceName);
      if (!object?.name.startsWith("BRepFace-")) return null;

      const cache = object.userData.interactionCache;
      const localCenter = cache?.localCenter instanceof THREE.Vector3
        ? cache.localCenter.clone()
        : new THREE.Vector3();
      const geometry = (object as THREE.Mesh | THREE.LineSegments | THREE.Points).geometry;
      if (!(cache?.localCenter instanceof THREE.Vector3) && geometry) {
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        geometry.boundingBox?.getCenter(localCenter);
      }

      const center = assemblyGroup.worldToLocal(object.localToWorld(localCenter));
      let normal: THREE.Vector3 | null = null;
      if (cache?.coherentNormal instanceof THREE.Vector3) {
        const worldNormal = cache.coherentNormal.clone().transformDirection(object.matrixWorld).normalize();
        const assemblyRotation = new THREE.Quaternion();
        assemblyGroup.getWorldQuaternion(assemblyRotation);
        normal = worldNormal.applyQuaternion(assemblyRotation.invert()).normalize();
      }

      return {
        object,
        center,
        normal,
        area: typeof object.userData.area === "number" ? object.userData.area : 0,
      };
    };

    const findOpposedDimensionFaceName = (seedFaceName: string, excludedNames: string[] = []): string | null => {
      const seed = getFaceFrameInAssembly(seedFaceName);
      if (!seed?.normal) return null;

      const excluded = new Set([seedFaceName, ...excludedNames]);
      const candidates = assemblyGroup.children
        .filter((child) => child.name.startsWith("BRepFace-") && !excluded.has(child.name))
        .map((child) => {
          const frame = getFaceFrameInAssembly(child.name);
          if (!frame?.normal) return null;

          const normalAlignment = Math.abs(frame.normal.dot(seed.normal));
          if (normalAlignment < 0.94) return null;

          const separation = frame.center.clone().sub(seed.center);
          const normalDistance = Math.abs(separation.dot(seed.normal));
          if (normalDistance < Math.max(modelSizeMax * 0.005, 1e-5)) return null;

          const seedArea = Math.max(seed.area, 1e-6);
          const faceArea = Math.max(frame.area, 1e-6);
          const areaRatio = Math.min(seedArea, faceArea) / Math.max(seedArea, faceArea);
          const score = normalAlignment * 8 + areaRatio * 4 + Math.min(normalDistance / Math.max(modelSizeMax, 1e-6), 1);
          return { name: child.name, score };
        })
        .filter((candidate): candidate is { name: string; score: number } => !!candidate)
        .sort((a, b) => b.score - a.score);

      return candidates[0]?.name || null;
    };

    const mapDatumTargetsToWebGLNames = (datum: any): string[] => {
      const targetIds = Array.isArray(datum.targetIds) && datum.targetIds.length > 0
        ? datum.targetIds
        : (datum.targetId ? [datum.targetId] : []);
      return targetIds
        .map((targetId: string) => mapTargetToWebGLName(targetId, datum.identifier, false))
        .filter((name: string | null): name is string => !!name)
        .filter((name: string, index: number, all: string[]) => all.indexOf(name) === index);
    };

    const mapMedianDatumTargetsToWebGLNames = (datum: any): string[] => {
      const targetIds = Array.isArray(datum.targetIds) && datum.targetIds.length > 0
        ? datum.targetIds
        : (datum.targetId ? [datum.targetId] : []);
      if (getDatumRenderKind(datum) === "twoFaceDimension") {
        const renderedMappedNames = [
          ...targetIds.map((targetId: string) => getCustomMappedVisibleFaceName(targetId)),
          getCustomMappedVisibleFaceName(datum.identifier),
        ]
          .filter((name: string | null): name is string => !!name)
          .filter((name: string, index: number, all: string[]) => all.indexOf(name) === index);

        if (renderedMappedNames.length >= 2) {
          return renderedMappedNames;
        }

        const seedFaceName = renderedMappedNames[0];
        if (seedFaceName) {
          const opposedFaceName = findOpposedDimensionFaceName(seedFaceName, renderedMappedNames);
          const opposedPair = [opposedFaceName, seedFaceName]
            .filter((name: string | null): name is string => !!name)
            .filter((name: string, index: number, all: string[]) => all.indexOf(name) === index);
          if (opposedPair.length >= 2) return opposedPair;
        }
      }

      const mappedNames = targetIds
        .map((targetId: string) =>
          mapTargetToWebGLName(targetId, datum.identifier, false) ||
          mapTargetToTopologicalWebGLName(targetId)
        )
        .filter((name: string | null): name is string => !!name)
        .filter((name: string, index: number, all: string[]) => all.indexOf(name) === index);
      return mappedNames;
    };

    const getDatumRenderKind = (datum: any): "twoFaceDimension" | "medianPlane" | "multiface" => {
      if (datum?.derivedDatum === "twoFaceDimension") return "twoFaceDimension";
      if (datum?.derivedDatum === "medianPlane") return "medianPlane";
      if (
        datum?.identifier &&
        propsRef.current.selectedEntityId === `Datum-${datum.identifier}-Dimension`
      ) {
        return "twoFaceDimension";
      }

      const semanticText = `${datum?.type || ""} ${datum?.targetName || ""} ${datum?.clinicalContext || ""}`;
      if (/two[-\s]?face|linear dimension|dimensional location|dimensioned planar faces|dimension datum/i.test(semanticText)) {
        return "twoFaceDimension";
      }
      if (/median plane|centre of symmetry|center of symmetry/i.test(semanticText)) {
        return "medianPlane";
      }
      return "multiface";
    };

    const getDatumRenderKindForFaces = (
      datum: any,
      mappedFaceNames: string[]
    ): "twoFaceDimension" | "medianPlane" | "multiface" => {
      const baseKind = getDatumRenderKind(datum);
      if (baseKind !== "multiface") return baseKind;

      const semanticText = `${datum?.type || ""} ${datum?.targetName || ""} ${datum?.clinicalContext || ""}`;
      const typeText = `${datum?.type || ""}`;
      const isTwoPlanarDatumFeature =
        mappedFaceNames.length === 2 &&
        /^Planar Datum Feature$/i.test(typeText.trim());
      const isExplicitMultiFeature = /primary flat|pattern|cylind|hole|bore|target set/i.test(semanticText);
      return isTwoPlanarDatumFeature && !isExplicitMultiFeature ? "twoFaceDimension" : "multiface";
    };

    const updateHighlightStyles = () => {
      const { selectedEntityId: selectId, selectedRelatedEntityIds, hoveredEntityId: hoverId, wireframeOverlay: overlayOn } = propsRef.current;
      const selectedNames = new Set<string>([
        ...(selectId ? [selectId] : []),
        ...(selectedRelatedEntityIds || []),
      ]);

      const faceParentIndicesForEdge = (id?: string | null) => {
        if (!id?.startsWith("BRepEdge-") || !occtResult?.lines) return [];
        const edgeIdx = parseInt(id.replace("BRepEdge-", ""), 10);
        const edge = occtResult.lines[edgeIdx];
        return edge?.parentFaceIndices || (edge?.parentFaceIndex !== undefined ? [edge.parentFaceIndex] : []);
      };

      const edgeNamesForActiveEntity = (id?: string | null) => {
        const edgeNames = new Set<string>();
        if (!id) return edgeNames;

        if (id.startsWith("BRepEdge-")) {
          edgeNames.add(id);
          faceParentIndicesForEdge(id).forEach((faceIdx: number) => {
            (edgeNamesByFaceIndex.get(faceIdx) || []).forEach((edgeName) => edgeNames.add(edgeName));
          });
          return edgeNames;
        }

        if (id.startsWith("BRepFace-")) {
          const faceIdx = parseInt(id.replace("BRepFace-", ""), 10);
          (edgeNamesByFaceIndex.get(faceIdx) || []).forEach((edgeName) => edgeNames.add(edgeName));
        }

        return edgeNames;
      };

      const selectedEdgeNames = new Set<string>();
      selectedNames.forEach((name) => {
        edgeNamesForActiveEntity(name).forEach((edgeName) => selectedEdgeNames.add(edgeName));
      });
      const hoveredEdgeNames = edgeNamesForActiveEntity(hoverId);
      const activeNames = new Set<string>([
        ...selectedNames,
        ...(hoverId ? [hoverId] : []),
        ...selectedEdgeNames,
        ...hoveredEdgeNames,
        ...previousHighlightNames,
      ]);
      const nextHighlightNames = new Set<string>([
        ...selectedNames,
        ...(hoverId ? [hoverId] : []),
        ...selectedEdgeNames,
        ...hoveredEdgeNames,
      ]);

      activeNames.forEach((name) => {
        const child = renderedObjectByName.get(name);
        if (!child) return;

        if (child.name.startsWith("BRepFace-")) {
          const isSelected = selectedNames.has(child.name);
          const isHovered = hoverId === child.name;
          const baseColor = new THREE.Color(`#${child.userData.color || "cbd5e1"}`);

          const material = (child as THREE.Mesh | THREE.Points).material;
          if (material instanceof THREE.MeshStandardMaterial) {
            if (isSelected) {
              material.color.set("#10b981");
              material.emissive.set("#064e3b");
              material.emissiveIntensity = 1.0;
            } else if (isHovered) {
              material.color.set("#38bdf8");
              material.emissive.set("#0284c7");
              material.emissiveIntensity = 0.9;
            } else {
              material.color.copy(baseColor);
              material.emissive.set("#000000");
              material.emissiveIntensity = 0;
            }
          } else if (material instanceof THREE.MeshBasicMaterial || material instanceof THREE.PointsMaterial) {
            material.color.set(isSelected ? "#10b981" : (isHovered ? "#38bdf8" : baseColor));
          }
          return;
        }

        if (child.name.startsWith("BRepEdge-")) {
          const isHighlighted = selectedEdgeNames.has(child.name) || hoveredEdgeNames.has(child.name);
          const shouldBeVisible = overlayOn || isHighlighted;
          child.visible = shouldBeVisible;

          const material = (child as THREE.LineSegments).material;
          if (material instanceof THREE.LineBasicMaterial) {
            if (selectedEdgeNames.has(child.name)) {
              material.color.setHex(0x10b981);
              material.opacity = 1.0;
            } else if (hoveredEdgeNames.has(child.name)) {
              material.color.setHex(0xf43f5e);
              material.opacity = 1.0;
            } else {
              material.color.setHex(0x64748b);
              material.opacity = shouldBeVisible ? 0.35 : 0.0;
            }
            material.depthWrite = shouldBeVisible;
          }
        }
      });

      previousHighlightNames = nextHighlightNames;
    };

    const getFeatureViewDirection = (obj: THREE.Object3D, center: THREE.Vector3, preferAxisView = false): THREE.Vector3 => {
      const currentViewDirection = camera.position.clone().sub(center).normalize();
      const cache = obj.userData.interactionCache;

      if (cache?.coherentNormal) {
        const normal = cache.coherentNormal.clone().transformDirection(obj.matrixWorld).normalize();
        const modelCenter = modelOrbitTarget.clone();
        assemblyGroup.localToWorld(modelCenter);
        const outwardReference = center.clone().sub(modelCenter);
        if (outwardReference.lengthSq() > 1e-6 && normal.dot(outwardReference) < 0) {
          normal.negate();
        }
        return normal;
      }

      const axis = (cache?.cylinderAxis ? cache.cylinderAxis.clone() : new THREE.Vector3(1, 0, 0))
        .transformDirection(obj.matrixWorld)
        .normalize();

      if (preferAxisView && cache?.cylinderAxis) {
        return axis.dot(currentViewDirection) >= 0 ? axis : axis.clone().negate();
      }

      // For cylinders, focus from the current side of the axis, not down the axis.
      const radialDirection = currentViewDirection.clone().addScaledVector(axis, -currentViewDirection.dot(axis));
      if (radialDirection.lengthSq() > 1e-6) {
        return radialDirection.normalize();
      }

      const fallback = new THREE.Vector3(0, 0, 1).addScaledVector(axis, -axis.z);
      if (fallback.lengthSq() > 1e-6) {
        return fallback.normalize();
      }

      return new THREE.Vector3(1, 0, 0);
    };

    const getStableSurfacePoint = (obj: THREE.Object3D): THREE.Vector3 => {
      const cache = obj.userData.interactionCache;
      if (cache?.stablePoint) {
        return cache.stablePoint.clone();
      }

      const geometry = (obj as THREE.Mesh | THREE.LineSegments | THREE.Points).geometry;
      const posAttr = geometry.getAttribute("position");
      if (!geometry.boundingBox) {
        geometry.computeBoundingBox();
      }

      const localCenter = new THREE.Vector3();
      geometry.boundingBox?.getCenter(localCenter);

      if (!posAttr || posAttr.count === 0) {
        return localCenter;
      }

      const localVertex = new THREE.Vector3();
      const bestLocal = new THREE.Vector3();
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      const triangle = new THREE.Triangle();
      const closest = new THREE.Vector3();
      const centroid = new THREE.Vector3();
      const anchorPoint = new THREE.Vector3();
      let bestDistance = Infinity;

      for (let i = 0; i < posAttr.count; i++) {
        localVertex.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
        const distance = localVertex.distanceToSquared(localCenter);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestLocal.copy(localVertex);
        }
      }

      const indexAttr = geometry.index;
      const triCount = indexAttr ? Math.floor(indexAttr.count / 3) : Math.floor(posAttr.count / 3);
      for (let i = 0; i < triCount; i++) {
        const ia = indexAttr ? indexAttr.getX(i * 3) : i * 3;
        const ib = indexAttr ? indexAttr.getX(i * 3 + 1) : i * 3 + 1;
        const ic = indexAttr ? indexAttr.getX(i * 3 + 2) : i * 3 + 2;
        a.set(posAttr.getX(ia), posAttr.getY(ia), posAttr.getZ(ia));
        b.set(posAttr.getX(ib), posAttr.getY(ib), posAttr.getZ(ib));
        c.set(posAttr.getX(ic), posAttr.getY(ic), posAttr.getZ(ic));
        triangle.set(a, b, c).closestPointToPoint(localCenter, closest);
        const distance = closest.distanceToSquared(localCenter);
        if (distance < bestDistance) {
          bestDistance = distance;
          centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
          anchorPoint.copy(closest).lerp(centroid, 0.12);
          bestLocal.copy(anchorPoint);
        }
      }

      return bestLocal;
    };

    const startCameraFocus = (position: THREE.Vector3, target: THREE.Vector3, up?: THREE.Vector3) => {
      cameraFocusTarget = {
        position,
        target,
        up,
        fromPosition: camera.position.clone(),
        fromTarget: controls.target.clone(),
        fromUp: camera.up.clone(),
        startedAt: performance.now(),
        durationMs: 180,
      };
      requestRenderRef.current?.(16);
    };

    const focusCameraOnFeature = (obj: THREE.Object3D, preferAxisView = false) => {
      const geometry = (obj as THREE.Mesh | THREE.LineSegments | THREE.Points).geometry;
      if (!geometry.boundingBox) {
        geometry.computeBoundingBox();
      }

      const localCenter = obj.userData.interactionCache?.localCenter?.clone() || new THREE.Vector3();
      if (!obj.userData.interactionCache?.localCenter) {
        geometry.boundingBox?.getCenter(localCenter);
      }

      const center = localCenter.clone();
      obj.localToWorld(center);

      const viewDirection = getFeatureViewDirection(obj, center, preferAxisView).normalize();
      const currentDistance = Math.max(camera.position.distanceTo(controls.target), controls.minDistance);
      const fixedTarget = controls.target.clone();
      startCameraFocus(fixedTarget.clone().addScaledVector(viewDirection, currentDistance), fixedTarget);
      focusedDatumOrbit = true;
    };

    const rotatePartAroundWorldAxis = (axis: THREE.Vector3, angle: number) => {
      const rotation = new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), angle);
      assemblyGroup.quaternion.premultiply(rotation);
      assemblyGroup.updateMatrixWorld(true);
      updateFloorGridPosition();
    };

    orientationViewHandlerRef.current = (direction: THREE.Vector3, up = new THREE.Vector3(0, 1, 0)) => {
      const target = getPartWorldBounds().getCenter(partCenter).clone();
      const currentDistance = Math.max(camera.position.distanceTo(controls.target), controls.minDistance);
      const viewDirection = direction.clone().normalize();

      startCameraFocus(
        target.clone().addScaledVector(viewDirection, currentDistance),
        target,
        up.clone().normalize()
      );
      focusedDatumOrbit = true;
    };

    partRollHandlerRef.current = (angle: number) => {
      const fixedCameraPosition = camera.position.clone();
      const fixedCameraTarget = controls.target.clone();
      const fixedCameraUp = camera.up.clone();
      const viewDirection = controls.target.clone().sub(camera.position).normalize();

      cameraFocusTarget = null;
      focusedDatumOrbit = false;
      rotatePartAroundWorldAxis(viewDirection, angle);

      camera.position.copy(fixedCameraPosition);
      controls.target.copy(fixedCameraTarget);
      camera.up.copy(fixedCameraUp);
      controls.update();
      requestRenderRef.current?.(2);
    };

    const isRegionDatumTarget = (datum: any) =>
      datum.annotationKind === "datumTarget" && /rectangle|area|zone/i.test(`${datum.type || ""} ${datum.targetName || ""}`);

    const isLineDatumTarget = (datum: any) =>
      datum.annotationKind === "datumTarget" && !!datum.targetLine;

    const isCircleDatumTarget = (datum: any) =>
      datum.annotationKind === "datumTarget" && !!datum.targetCircle;

    const isCurveDatumTarget = (datum: any) =>
      datum.annotationKind === "datumTarget" && !!datum.targetCurve;

    const clearDatumTargetRegionOverlays = () => {
      const overlays: THREE.Object3D[] = [];
      assemblyGroup.traverse((child) => {
        if (
          child.name.startsWith("DatumTargetRegion-") ||
          child.name.startsWith("DatumTargetRegionOutline-") ||
          child.name.startsWith("DatumTargetRegionHatch-")
        ) {
          overlays.push(child);
        }
      });

      overlays.forEach((child) => {
        child.parent?.remove(child);
        if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.LineSegments || child instanceof THREE.LineLoop) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((material) => material.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    };

    const clearDatumLeaderGeometry = () => {
      assemblyGroup.traverse((child) => {
        const staleLeaderGeometry = [...child.children].filter((item) =>
          item.name.startsWith("DatumLeaderTriangle-") ||
          item.name.startsWith("DatumLeaderLine-") ||
          item.name.startsWith("DatumLeaderArrow-") ||
          item.name.startsWith("DatumMedianDimension-") ||
          item.name.startsWith("DatumTargetPointMark-") ||
          item.name.startsWith("DatumTargetLineMark-") ||
          item.name.startsWith("DatumTargetCircleMark-") ||
          item.name.startsWith("DatumTargetCurveMark-") ||
          item.name.startsWith("DatumReferenceFrameOverlay-")
        );
        staleLeaderGeometry.forEach((item) => {
          child.remove(item);
          item.traverse((nested) => {
            if (nested instanceof THREE.Line || nested instanceof THREE.LineSegments || nested instanceof THREE.Mesh) {
              nested.geometry.dispose();
              if (Array.isArray(nested.material)) {
                nested.material.forEach((material) => material.dispose());
              } else {
                nested.material.dispose();
              }
            }
          });
        });
      });
    };

    const drawDatumReferenceFrameOverlay = () => {
      const frames = propsRef.current.datumReferenceFrames || [];
      const allDatums = propsRef.current.datums || [];
      const allTolerances = propsRef.current.tolerances || [];
      if (frames.length === 0 || allDatums.length === 0) return;

      const datumByIdentifier = new Map<string, any>(
        allDatums.map((datum: any) => [datum.identifier, datum])
      );

      const getDatumFaceNames = (reference: any): string[] => {
        const datum = datumByIdentifier.get(reference.datumIdentifier);
        const targetIds = Array.isArray(reference.targetIds) && reference.targetIds.length > 0
          ? reference.targetIds
          : Array.isArray(datum?.targetIds) && datum.targetIds.length > 0
            ? datum.targetIds
            : (datum?.targetId ? [datum.targetId] : []);
        return targetIds
          .map((targetId: string) =>
            mapTargetToWebGLName(targetId, reference.datumIdentifier, false) ||
            mapTargetToTopologicalWebGLName(targetId)
          )
          .filter((name: string | null): name is string => !!name)
          .filter((name: string, index: number, all: string[]) => all.indexOf(name) === index);
      };

      const getAssemblyDirection = (object: THREE.Object3D, localDirection: THREE.Vector3): THREE.Vector3 | null => {
        if (localDirection.lengthSq() <= 1e-8) return null;
        const worldStart = object.localToWorld(new THREE.Vector3());
        const worldEnd = object.localToWorld(localDirection.clone());
        const assemblyStart = assemblyGroup.worldToLocal(worldStart);
        const assemblyEnd = assemblyGroup.worldToLocal(worldEnd);
        const direction = assemblyEnd.sub(assemblyStart);
        return direction.lengthSq() > 1e-8 ? direction.normalize() : null;
      };

      const getUniqueFrameReferences = (frame: any) => (frame.references || [])
        .filter((reference: any, index: number, all: any[]) =>
          all.findIndex((candidate) => candidate.datumIdentifier === reference.datumIdentifier) === index
        )
        .sort((a: any, b: any) => (a.precedence || 0) - (b.precedence || 0));

      const getFrameKey = (frame: any) =>
        getUniqueFrameReferences(frame)
          .slice(0, 3)
          .map((reference: any) => reference.datumIdentifier)
          .join("|");
      const getFrameDisplayLabel = (frame: any) =>
        getUniqueFrameReferences(frame)
          .slice(0, 3)
          .map((reference: any) => reference.datumIdentifier)
          .join(" | ") || frame.label || frame.name || "DRF";
      const getFramePlotScore = (tolerance: any) => {
        const frame = tolerance?.datumReferenceFrame;
        if (!frame) return -Infinity;
        const uniqueReferences = getUniqueFrameReferences(frame);
        const modifierCount = uniqueReferences
          .reduce((count: number, reference: any) => count + ((reference.modifiers || []).length || 0), 0);
        let score = uniqueReferences.length * 10;
        if (/position/i.test(tolerance.type || "")) score += 40;
        if (!/profile/i.test(tolerance.type || "")) score += 15;
        if (modifierCount === 0) score += 8;
        return score - modifierCount;
      };
      const makePlottedFrame = (frame: any) => ({
        ...frame,
        label: getFrameDisplayLabel(frame)
      });
      const getUniqueCylinderDatumPoints = (frame: any) => {
        const uniqueReferences = getUniqueFrameReferences(frame);
        if (uniqueReferences.length !== 1) return [];
        const cylinderGeometries = (uniqueReferences[0]?.surfaceGeometry || [])
          .filter((geometry: any) => geometry.surfaceType === "cylinder" && geometry.point && geometry.axis);
        const uniquePoints: Array<{ point: any; axis: any; xDirection?: any }> = [];
        for (const geometry of cylinderGeometries) {
          const existing = uniquePoints.some((candidate) =>
            Math.abs(candidate.point.x - geometry.point.x) < 1e-6 &&
            Math.abs(candidate.point.y - geometry.point.y) < 1e-6 &&
            Math.abs(candidate.point.z - geometry.point.z) < 1e-6
          );
          if (!existing) {
            uniquePoints.push({
              point: geometry.point,
              axis: geometry.axis,
              xDirection: geometry.xDirection
            });
          }
        }
        return uniquePoints;
      };

      const toleranceByEntityId = new Map<string, any>(
        allTolerances.map((tolerance: any) => [tolerance.entityId, tolerance])
      );
      const getFrameTolerances = (frame: any) =>
        (frame.toleranceEntityIds || [])
          .map((entityId: string) => toleranceByEntityId.get(entityId))
          .filter((tolerance: any) => !!tolerance);
      const getToleranceTargetFaceNames = (tolerance: any): string[] => {
        const targetIds = Array.isArray(tolerance.targetIds) && tolerance.targetIds.length > 0
          ? tolerance.targetIds
          : (tolerance.targetId ? [tolerance.targetId] : []);
        return targetIds
          .map((targetId: string) =>
            mapTargetToWebGLName(targetId, "", false) ||
            mapTargetToTopologicalWebGLName(targetId)
          )
          .filter((name: string | null): name is string => !!name)
          .filter((name: string, index: number, all: string[]) => all.indexOf(name) === index);
      };
      const getControlledTargetFrames = (tolerancesForFrame: any[]) =>
        tolerancesForFrame
          .flatMap((tolerance: any) => getToleranceTargetFaceNames(tolerance))
          .map((faceName: string) => {
            const frame = getFaceFrameInAssembly(faceName);
            const object = assemblyGroup.getObjectByName(faceName);
            const cylinderAxis = object?.userData.interactionCache?.cylinderAxis instanceof THREE.Vector3
              ? getAssemblyDirection(object, object.userData.interactionCache.cylinderAxis)
              : null;
            return frame ? { ...frame, faceName, cylinderAxis } : null;
          })
          .filter((frame): frame is {
            object: THREE.Object3D;
            center: THREE.Vector3;
            normal: THREE.Vector3 | null;
            area: number;
            faceName: string;
            cylinderAxis: THREE.Vector3 | null;
          } => !!frame);
      const getControlledTargetCenter = (tolerancesForFrame: any[]): THREE.Vector3 | null => {
        const targetFrames = getControlledTargetFrames(tolerancesForFrame);

        if (targetFrames.length === 0) return null;
        const center = new THREE.Vector3();
        for (const targetFrame of targetFrames) {
          center.add(targetFrame.center);
        }
        return center.multiplyScalar(1 / targetFrames.length);
      };

      const shouldPlotToleranceFrame = (tolerance: any) => {
        if (!tolerance?.datumReferenceFrame) return false;
        const references = tolerance.datumReferenceFrame.references || [];
        const uniqueReferences = getUniqueFrameReferences(tolerance.datumReferenceFrame);
        const uniqueReferenceCount = uniqueReferences.length;
        const primaryPlaneCount = (uniqueReferences[0]?.surfaceGeometry || [])
          .filter((geometry: any) => geometry.surfaceType === "plane" && geometry.normal).length;
        const primaryDatum = datumByIdentifier.get(uniqueReferences[0]?.datumIdentifier);
        const isSingleDatumTargetFrame = uniqueReferenceCount === 1 &&
          /datum target/i.test(`${primaryDatum?.type || ""} ${primaryDatum?.targetName || ""}`);
        const isSingleCylinderPatternFrame = uniqueReferenceCount === 1 &&
          getUniqueCylinderDatumPoints(tolerance.datumReferenceFrame).length > 1;
        const isSinglePrimaryPlaneWithSecondaryAxes = uniqueReferenceCount >= 3 &&
          primaryPlaneCount === 1 &&
          uniqueReferences.slice(1, 3).every((reference: any) =>
            (reference.surfaceGeometry || []).some((geometry: any) => geometry.surfaceType === "cylinder" && geometry.axis)
          );
        const isPatternPrimaryWithSecondaryAxes = uniqueReferenceCount >= 3 &&
          primaryPlaneCount > 1 &&
          uniqueReferences.slice(1, 3).every((reference: any) =>
            (reference.surfaceGeometry || []).some((geometry: any) => geometry.surfaceType === "cylinder" && geometry.axis)
          );
        const isThreePlaneFrame = uniqueReferenceCount >= 3 &&
          uniqueReferences.slice(0, 3).every((reference: any) =>
            (reference.surfaceGeometry || []).some((geometry: any) => geometry.surfaceType === "plane" && geometry.normal)
          );
        const isTwoReferenceTargetPositionFrame = uniqueReferenceCount === 2 &&
          /position/i.test(tolerance.type || "") &&
          primaryPlaneCount >= 1 &&
          (uniqueReferences[1]?.surfaceGeometry || []).some((geometry: any) =>
            geometry.surfaceType === "unknown" && geometry.point
          );
        if (/profile/i.test(tolerance.type || "")) {
          return (isSinglePrimaryPlaneWithSecondaryAxes || isPatternPrimaryWithSecondaryAxes || isThreePlaneFrame) &&
            references.every((reference: any) => (reference.modifiers || []).length === 0);
        }
        if (isSingleCylinderPatternFrame) {
          return true;
        }
        if (isTwoReferenceTargetPositionFrame) {
          return true;
        }
        if (/position/i.test(tolerance.type || "")) {
          return uniqueReferenceCount >= 3;
        }
        if (uniqueReferenceCount < 3 && !isSingleDatumTargetFrame && !isSingleCylinderPatternFrame) {
          return false;
        }
        if (/perpendicularity/i.test(tolerance.type || "")) {
          if (uniqueReferenceCount <= 1 && primaryPlaneCount > 1) return false;
          const surfaceTypes = tolerance.targetSurfaceTypes || [];
          if (references.length <= 1 && surfaceTypes.length > 0 && surfaceTypes.every((type: string) => /plane/i.test(type))) {
            return false;
          }
        }
        return /position|perpendicularity|parallelism|angularity|runout|coaxiality|concentricity|symmetry/i.test(tolerance.type || "");
      };
      const plottedFrameByEntity = new Map<string, { frame: any; tolerances: any[]; score: number }>();
      for (const tolerance of allTolerances) {
        if (!shouldPlotToleranceFrame(tolerance)) continue;
        const frame = tolerance.datumReferenceFrame;
        if (!Array.isArray(frame.references) || frame.references.length === 0) continue;
        const key = getFrameKey(frame) || frame.entityId;
        const score = getFramePlotScore(tolerance);
        const existing = plottedFrameByEntity.get(key);
        if (existing) {
          existing.tolerances.push(tolerance);
          if (score > existing.score) {
            existing.frame = makePlottedFrame(frame);
            existing.score = score;
          }
        } else {
          plottedFrameByEntity.set(key, { frame: makePlottedFrame(frame), tolerances: [tolerance], score });
        }
      }
      const uniqueFrames = Array.from(plottedFrameByEntity.values())
        .sort((a: any, b: any) => {
          const refDelta = getUniqueFrameReferences(b.frame).length - getUniqueFrameReferences(a.frame).length;
          return refDelta || (b.tolerances.length - a.tolerances.length);
        })
        .filter((candidate: any) =>
          getControlledTargetFrames(candidate.tolerances).length > 0 ||
          !!candidate.frame?.frameBasis
        );

      const fallbackFrames = [...frames]
        .filter((frame: any) => Array.isArray(frame.references) && frame.references.length > 0)
        .sort((a: any, b: any) => getUniqueFrameReferences(b).length - getUniqueFrameReferences(a).length)
        .map((frame: any) => ({ frame, tolerances: getFrameTolerances(frame) }));

      const expandCylinderPatternFrame = (candidate: { frame: any; tolerances: any[] }) => {
        const cylinderPoints = getUniqueCylinderDatumPoints(candidate.frame);
        if (cylinderPoints.length <= 1) return [candidate];
        return cylinderPoints.map((cylinderPoint, index) => {
          return {
            frame: {
              ...candidate.frame,
              id: `${candidate.frame.id || candidate.frame.entityId || "frame"}-${index + 1}`,
              entityId: `${candidate.frame.entityId || candidate.frame.id || "frame"}-${index + 1}`,
              label: candidate.frame.label || getFrameDisplayLabel(candidate.frame),
              frameBasis: {
                ...(candidate.frame.frameBasis || {}),
                origin: cylinderPoint.point
              }
            },
            tolerances: candidate.tolerances
          };
        });
      };

      const candidateFrames = (uniqueFrames.length > 0 ? uniqueFrames : fallbackFrames)
        .flatMap(expandCylinderPatternFrame);

      const drawFrame = (candidate: { frame: any; tolerances: any[] }): boolean => {
        const frame = candidate.frame;
        const uniqueReferences = getUniqueFrameReferences(frame).slice(0, 3);
        if (uniqueReferences.length === 0) return false;

        const toVector3 = (value?: { x: number; y: number; z: number } | null) =>
          value ? new THREE.Vector3(value.x, value.y, value.z) : null;

        const datumAnchors = uniqueReferences.map((reference: any) => {
        const datum = datumByIdentifier.get(reference.datumIdentifier);
        const faceName = getDatumFaceNames(reference)[0];
        const faceFrame = faceName ? getFaceFrameInAssembly(faceName) : null;
        const faceObject = faceName ? assemblyGroup.getObjectByName(faceName) : null;
        const cylinderAxis = faceObject?.userData.interactionCache?.cylinderAxis instanceof THREE.Vector3
          ? getAssemblyDirection(faceObject, faceObject.userData.interactionCache.cylinderAxis)
          : null;
        const stepGeometry = Array.isArray(reference.surfaceGeometry) && reference.surfaceGeometry.length > 0
          ? reference.surfaceGeometry
          : (Array.isArray(datum?.surfaceGeometry) ? datum.surfaceGeometry : []);
        const primaryStepGeometry = stepGeometry[0] || null;
        const stepPoint = toVector3(primaryStepGeometry?.point);
        const stepNormal = toVector3(primaryStepGeometry?.normal);
        const stepAxis = toVector3(primaryStepGeometry?.axis);
        const stepXDirection = toVector3(primaryStepGeometry?.xDirection);
        const datumText = `${datum?.type || ""} ${datum?.targetName || ""}`;
        const datumAxis = /cylind|hole|bore|axis/i.test(datumText)
          ? stepAxis || cylinderAxis || faceFrame?.normal || null
          : stepNormal || faceFrame?.normal || cylinderAxis || null;
        return {
          reference,
          faceName,
          frame: faceFrame,
          cylinderAxis,
          stepGeometry,
          stepPoint,
          stepNormal,
          stepAxis,
          stepXDirection,
          datumAxis
          };
        });

        const targetFrames = getControlledTargetFrames(candidate.tolerances);
        const controlledTargetCenter = getControlledTargetCenter(candidate.tolerances);
        const primary = datumAnchors[0];
        const secondary = datumAnchors[1];
        const tertiary = datumAnchors[2];
        const firstTolerance = candidate.tolerances[0] || {};
        const targetIsCylindrical = (firstTolerance.targetSurfaceTypes || []).some((type: string) => /cylinder/i.test(type));
        const primaryDatum = datumByIdentifier.get(primary?.reference?.datumIdentifier);
        const resolveDatumSurfaceKind = (datumAnchor: any): "plane" | "cylinder" | "curved" | "unknown" => {
          const stepGeometry = Array.isArray(datumAnchor?.stepGeometry) && datumAnchor.stepGeometry.length > 0
            ? datumAnchor.stepGeometry[0]
            : null;
          if (stepGeometry?.surfaceType) return stepGeometry.surfaceType;
          const datumText = `${datumByIdentifier.get(datumAnchor?.reference?.datumIdentifier)?.type || ""} ${datumByIdentifier.get(datumAnchor?.reference?.datumIdentifier)?.targetName || ""}`.toLowerCase();
          if (/cylind|hole|bore|axis/i.test(datumText)) return "cylinder";
          if (/plane|planar|flat/i.test(datumText)) return "plane";
          return "unknown";
        };
        const primarySurfaceKind = resolveDatumSurfaceKind(primary);
        const primaryIsPlane = primarySurfaceKind === "plane";
        const primaryIsCylinder = primarySurfaceKind === "cylinder";
        const parserFrameBasis = frame?.frameBasis;
        const hasValidParserFrameBasis = !!parserFrameBasis &&
          !!parserFrameBasis.origin &&
          !!parserFrameBasis.xAxis &&
          !!parserFrameBasis.yAxis &&
          !!parserFrameBasis.zAxis;

        const intersectAxisWithPlane = (
          axisPoint: THREE.Vector3 | undefined,
          axisDirection: THREE.Vector3 | null | undefined,
          planePoint: THREE.Vector3 | undefined,
          planeNormal: THREE.Vector3 | null | undefined
        ): THREE.Vector3 | null => {
          if (!axisPoint || !axisDirection || !planePoint || !planeNormal) return null;
          if (axisDirection.lengthSq() <= 1e-8 || planeNormal.lengthSq() <= 1e-8) return null;
          const direction = axisDirection.clone().normalize();
          const normal = planeNormal.clone().normalize();
          const denominator = direction.dot(normal);
          if (Math.abs(denominator) > 1e-8) {
            return axisPoint.clone().addScaledVector(
              direction,
              planePoint.clone().sub(axisPoint).dot(normal) / denominator
            );
          }
          return axisPoint.clone().addScaledVector(
            normal,
            planePoint.clone().sub(axisPoint).dot(normal)
          );
        };

        const secondaryDatumPlanePoint = primaryIsPlane
          ? intersectAxisWithPlane(
              secondary?.stepPoint || secondary?.frame?.center,
              secondary?.stepAxis || secondary?.cylinderAxis || secondary?.datumAxis,
              primary?.stepPoint || primary?.frame?.center,
              primary?.stepNormal || primary?.datumAxis
            )
          : null;
        const tertiaryDatumPlanePoint = primaryIsPlane
          ? intersectAxisWithPlane(
              tertiary?.stepPoint || tertiary?.frame?.center,
              tertiary?.stepAxis || tertiary?.cylinderAxis || tertiary?.datumAxis,
              primary?.stepPoint || primary?.frame?.center,
              primary?.stepNormal || primary?.datumAxis
            )
          : null;

        const origin = (parserFrameBasis?.origin ? new THREE.Vector3(parserFrameBasis.origin.x, parserFrameBasis.origin.y, parserFrameBasis.origin.z) : null) ||
          secondaryDatumPlanePoint ||
          controlledTargetCenter ||
          primary?.frame?.center?.clone() ||
          targetFrames[0]?.center?.clone();
        if (!origin) return false;

        let zAxis = new THREE.Vector3();
        let xAxis = new THREE.Vector3();
        let yAxis = new THREE.Vector3();
        const zAxisFromStepPrimary = primaryIsPlane && !!primary?.stepNormal && primary.stepNormal.lengthSq() > 1e-8;
        if (hasValidParserFrameBasis) {
          const parsedZ = new THREE.Vector3(parserFrameBasis.zAxis.x, parserFrameBasis.zAxis.y, parserFrameBasis.zAxis.z);
          const parsedX = new THREE.Vector3(parserFrameBasis.xAxis.x, parserFrameBasis.xAxis.y, parserFrameBasis.xAxis.z);
          const parsedY = new THREE.Vector3(parserFrameBasis.yAxis.x, parserFrameBasis.yAxis.y, parserFrameBasis.yAxis.z);
          if (parsedZ.lengthSq() > 1e-8 && parsedX.lengthSq() > 1e-8 && parsedY.lengthSq() > 1e-8) {
            zAxis.copy(parsedZ.normalize());
            xAxis.copy(parsedX.normalize());
            yAxis.copy(parsedY.normalize());
          }
        }
        if (zAxis.lengthSq() <= 1e-8 || xAxis.lengthSq() <= 1e-8 || yAxis.lengthSq() <= 1e-8) {
          if (zAxisFromStepPrimary) {
            zAxis.copy(primary.stepNormal);
          } else if (primary?.stepAxis && primary.stepAxis.lengthSq() > 1e-8) {
            zAxis.copy(primary.stepAxis);
          } else if (primaryIsPlane && primary?.datumAxis && primary.datumAxis.lengthSq() > 1e-8) {
            zAxis.copy(primary.datumAxis);
          } else if (targetIsCylindrical || primaryIsCylinder) {
            for (const targetFrame of targetFrames) {
              const axis = targetFrame.cylinderAxis?.clone();
              if (!axis || axis.lengthSq() <= 1e-8) continue;
              axis.normalize();
              if (zAxis.lengthSq() > 1e-8 && zAxis.dot(axis) < 0) axis.negate();
              zAxis.add(axis);
            }
          } else {
            for (const targetFrame of targetFrames) {
              const normal = targetFrame.normal?.clone();
              if (!normal || normal.lengthSq() <= 1e-8) continue;
              normal.normalize();
              if (zAxis.lengthSq() > 1e-8 && zAxis.dot(normal) < 0) normal.negate();
              zAxis.add(normal);
            }
          }
          if (zAxis.lengthSq() <= 1e-8 && primary?.datumAxis) {
            zAxis.copy(primary.datumAxis);
          }
          if (zAxis.lengthSq() <= 1e-8) return false;
          zAxis.normalize();

          const primaryPlanePoint = primary?.stepPoint?.clone() || primary?.frame?.center?.clone() || origin.clone();
          const secondaryPoint = secondaryDatumPlanePoint || secondary?.frame?.center;
          const tertiaryPoint = tertiaryDatumPlanePoint || tertiary?.frame?.center;
          if (!zAxisFromStepPrimary && primary?.datumAxis && primary.datumAxis.dot(zAxis) < 0) {
            zAxis.negate();
          }

          const choosePerpendicularAxis = (candidates: THREE.Vector3[]) => {
            for (const candidateAxis of candidates) {
              const axis = candidateAxis.clone().addScaledVector(zAxis, -candidateAxis.dot(zAxis));
              if (axis.lengthSq() > 1e-8) return axis.normalize();
            }
            const worldCandidates = [
              new THREE.Vector3(1, 0, 0),
              new THREE.Vector3(0, 1, 0),
              new THREE.Vector3(0, 0, 1),
            ]
              .map((axis) => axis.addScaledVector(zAxis, -axis.dot(zAxis)))
              .filter((axis) => axis.lengthSq() > 1e-8)
              .sort((a, b) => b.lengthSq() - a.lengthSq());
            return worldCandidates[0]?.normalize() || new THREE.Vector3(1, 0, 0);
          };

          const secondaryXDirection = secondary?.stepXDirection;
          const secondaryDatumDirection = secondary?.stepAxis || secondary?.datumAxis || secondary?.cylinderAxis || null;
          const datumPointDirection = primaryIsPlane && secondaryPoint && tertiaryPoint
            ? tertiaryPoint.clone().sub(secondaryPoint)
            : null;
          const projectedDatumPointDirection = datumPointDirection && datumPointDirection.lengthSq() > 1e-8
            ? datumPointDirection.clone().subScaledVector(zAxis, datumPointDirection.dot(zAxis))
            : null;
          if (secondaryXDirection && secondaryXDirection.lengthSq() > 1e-8) {
            xAxis.copy(secondaryXDirection);
          } else if (primaryIsPlane && projectedDatumPointDirection && projectedDatumPointDirection.lengthSq() > 1e-8) {
            xAxis.copy(projectedDatumPointDirection);
          } else if (primaryIsPlane && secondary?.stepNormal && secondary.stepNormal.lengthSq() > 1e-8) {
            xAxis.copy(secondary.stepNormal);
          } else if (secondaryDatumDirection && secondaryDatumDirection.lengthSq() > 1e-8) {
            xAxis.copy(secondaryDatumDirection);
          } else if (secondaryPoint && tertiaryPoint) {
            xAxis.copy(tertiaryPoint).sub(secondaryPoint);
          } else if (secondaryPoint) {
            xAxis.copy(secondaryPoint).sub(origin);
          } else if (primary?.frame?.center) {
            xAxis.copy(primary.frame.center).sub(origin);
          } else if (datumAnchors[1]?.datumAxis) {
            xAxis.copy(datumAnchors[1].datumAxis);
          } else if (datumAnchors[1]?.cylinderAxis) {
            xAxis.copy(datumAnchors[1].cylinderAxis);
          } else {
            xAxis.copy(choosePerpendicularAxis([
              ...targetFrames.map((targetFrame) => targetFrame.normal || new THREE.Vector3()),
              modelOrbitTarget.clone().sub(origin),
            ]));
          }
          xAxis.addScaledVector(zAxis, -xAxis.dot(zAxis));
          if (xAxis.lengthSq() <= 1e-8) xAxis.copy(choosePerpendicularAxis([modelOrbitTarget.clone().sub(origin)]));
          if (xAxis.lengthSq() <= 1e-8) return false;
          xAxis.normalize();
          if (primaryIsPlane && projectedDatumPointDirection && projectedDatumPointDirection.dot(xAxis) < 0) {
            xAxis.negate();
          }
          if (controlledTargetCenter) {
            const xReferencePoint = secondaryPoint || origin;
            const targetBias = controlledTargetCenter.clone().sub(xReferencePoint).dot(xAxis);
            if (targetBias < 0 && Math.abs(targetBias) > 1e-6) {
              xAxis.negate();
            }
          }

          yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
          if (yAxis.lengthSq() <= 1e-8) return false;
          yAxis.normalize();
          xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
        }

        if (hasValidParserFrameBasis && zAxis.lengthSq() > 1e-8 && xAxis.lengthSq() > 1e-8) {
          yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
          xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
        }

        const group = new THREE.Group();
        group.name = `DatumReferenceFrameOverlay-${frame.id || frame.entityId || "active"}`;
        group.renderOrder = 45;

        const axisLength = Math.max(modelSizeMax * 0.12, 0.65);
        const badgeText = frame.label || frame.name || "DRF";
        const badgeCanvas = document.createElement("canvas");
        const badgeContext = badgeCanvas.getContext("2d");
        if (badgeContext) {
          const paddingX = 9;
          const fontSize = 12;
          badgeContext.font = `700 ${fontSize}px Arial`;
          const textMetrics = badgeContext.measureText(badgeText);
          const width = Math.max(54, Math.ceil(textMetrics.width + paddingX * 2));
          const height = 22;
          badgeCanvas.width = width;
          badgeCanvas.height = height;
          badgeContext.font = `700 ${fontSize}px Arial`;
          badgeContext.textAlign = "center";
          badgeContext.textBaseline = "middle";
          badgeContext.fillStyle = "rgba(15, 23, 42, 0.86)";
          badgeContext.fillRect(0, 0, width, height);
          badgeContext.strokeStyle = "rgba(255, 255, 255, 0.92)";
          badgeContext.lineWidth = 1;
          badgeContext.strokeRect(0.5, 0.5, width - 1, height - 1);
          badgeContext.fillStyle = "#f8fafc";
          badgeContext.fillText(badgeText, width / 2, height / 2);
          const badgeTexture = new THREE.CanvasTexture(badgeCanvas);
          badgeTexture.needsUpdate = true;
          const badgeMaterial = new THREE.SpriteMaterial({
            map: badgeTexture,
            transparent: true,
            depthTest: false,
            depthWrite: false,
          });
          const badgeSprite = new THREE.Sprite(badgeMaterial);
          const badgeWorldHeight = Math.max(axisLength * 0.18, modelSizeMax * 0.026, 0.16);
          const badgeWorldWidth = badgeWorldHeight * (width / height);
          badgeSprite.scale.set(badgeWorldWidth, badgeWorldHeight, 1);
          badgeSprite.position.copy(origin.clone()
            .addScaledVector(xAxis, axisLength * 0.2)
            .addScaledVector(yAxis, axisLength * 0.2)
            .addScaledVector(zAxis, axisLength * 0.12));
          badgeSprite.renderOrder = 49;
          badgeSprite.name = `DatumReferenceFrameBadge-${frame.id || frame.entityId || "active"}`;
          group.add(badgeSprite);
        }

        const arrowLength = Math.max(modelSizeMax * 0.017, 0.095);
        const arrowHalfWidth = arrowLength * 0.32;
        const originRadius = Math.max(modelSizeMax * 0.007, 0.04);

        const addAxis = (name: string, direction: THREE.Vector3, color: number) => {
          const end = origin.clone().addScaledVector(direction, axisLength);
          const lineEnd = end.clone().addScaledVector(direction, -arrowLength);
          const lineGeometry = new THREE.BufferGeometry().setFromPoints([origin.clone(), end.clone()]);
          const lineMaterial = new THREE.LineBasicMaterial({
            color,
            depthTest: false,
            depthWrite: false,
            transparent: true,
            opacity: 0.95,
          });
          const line = new THREE.Line(lineGeometry, lineMaterial);
          line.name = `DatumReferenceFrameOverlay-${name}-Axis`;
          line.renderOrder = 46;
          line.raycast = () => undefined;
          group.add(line);

          let sideDirection = new THREE.Vector3().crossVectors(direction, zAxis);
          if (sideDirection.lengthSq() <= 1e-8) {
            sideDirection.crossVectors(direction, yAxis);
          }
          if (sideDirection.lengthSq() <= 1e-8) {
            sideDirection.crossVectors(direction, new THREE.Vector3(0, 1, 0));
          }
          if (sideDirection.lengthSq() <= 1e-8) {
            sideDirection.crossVectors(direction, new THREE.Vector3(1, 0, 0));
          }
          sideDirection.normalize().multiplyScalar(arrowHalfWidth);

          const arrowGeometry = new THREE.BufferGeometry().setFromPoints([
            end.clone(),
            lineEnd.clone().add(sideDirection),
            lineEnd.clone().sub(sideDirection),
          ]);
          const arrowMaterial = new THREE.MeshBasicMaterial({
            color,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false,
            transparent: true,
            opacity: 0.95,
          });
          const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
          arrow.name = `DatumReferenceFrameOverlay-${name}-Head`;
          arrow.renderOrder = 47;
          arrow.raycast = () => undefined;
          group.add(arrow);
        };

        const originGeometry = new THREE.SphereGeometry(originRadius, 18, 12);
        const originMaterial = new THREE.MeshBasicMaterial({
          color: 0x111827,
          depthTest: false,
          depthWrite: false,
          transparent: true,
          opacity: 0.9,
        });
        const originMarker = new THREE.Mesh(originGeometry, originMaterial);
        originMarker.name = "DatumReferenceFrameOverlay-Origin";
        originMarker.position.copy(origin);
        originMarker.renderOrder = 48;
        originMarker.raycast = () => undefined;
        group.add(originMarker);

        addAxis("X", xAxis, 0xef4444);
        addAxis("Y", yAxis, 0x22c55e);
        addAxis("Z", zAxis, 0x3b82f6);
        assemblyGroup.add(group);
        return true;
      };

      let plottedCount = 0;
      for (const frame of candidateFrames) {
        if (drawFrame(frame)) plottedCount++;
      }

      if (plottedCount === 0 && candidateFrames.length > 0) {
        [...frames]
          .filter((frame: any) => Array.isArray(frame.references) && frame.references.length > 0)
          .sort((a: any, b: any) => getUniqueFrameReferences(b).length - getUniqueFrameReferences(a).length)
          .map((frame: any) => ({ frame, tolerances: getFrameTolerances(frame) }))
          .some((candidate: { frame: any; tolerances: any[] }) => drawFrame(candidate));
      }
    };

    const addDatumTargetRegionOverlay = (datum: any, faceObject: THREE.Object3D, webglName: string) => {
      if (!(faceObject instanceof THREE.Mesh)) return;

      const addLocalRectangleOverlay = (
        center: THREE.Vector3,
        xAxis: THREE.Vector3,
        yAxis: THREE.Vector3,
        normal: THREE.Vector3,
        width: number,
        length: number,
        isExactZone: boolean
      ) => {
        if (xAxis.lengthSq() <= 1e-8 || yAxis.lengthSq() <= 1e-8 || normal.lengthSq() <= 1e-8) return false;

        xAxis.normalize();
        yAxis.normalize();
        normal.normalize();
        const lift = Math.max(modelSizeMax * 0.0006, 1e-5);
        const liftedCenter = center.clone().addScaledVector(normal, lift);
        const halfWidth = width / 2;
        const halfLength = length / 2;
        const corners = [
          liftedCenter.clone().addScaledVector(xAxis, -halfWidth).addScaledVector(yAxis, -halfLength),
          liftedCenter.clone().addScaledVector(xAxis, halfWidth).addScaledVector(yAxis, -halfLength),
          liftedCenter.clone().addScaledVector(xAxis, halfWidth).addScaledVector(yAxis, halfLength),
          liftedCenter.clone().addScaledVector(xAxis, -halfWidth).addScaledVector(yAxis, halfLength),
        ];

        const overlayGeometry = new THREE.BufferGeometry().setFromPoints(corners);
        overlayGeometry.setIndex([0, 1, 2, 0, 2, 3]);
        overlayGeometry.computeVertexNormals();
        const overlayMaterial = new THREE.MeshBasicMaterial({
          color: 0x22c55e,
          transparent: true,
          opacity: isExactZone ? 0.34 : 0.26,
          depthWrite: false,
          depthTest: true,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        });
        const overlay = new THREE.Mesh(overlayGeometry, overlayMaterial);
        overlay.name = `DatumTargetRegion-${datum.id}`;
        overlay.userData = { datumTargetId: datum.id, parentFaceName: webglName, targetZone: isExactZone };
        overlay.renderOrder = 5;
        overlay.raycast = () => undefined;
        faceObject.add(overlay);

        const outlineGeometry = new THREE.BufferGeometry().setFromPoints([...corners, corners[0].clone()]);
        const outlineMaterial = new THREE.LineBasicMaterial({
          color: 0x047857,
          transparent: true,
          opacity: 0.98,
          depthWrite: false,
          depthTest: true,
        });
        const outline = new THREE.Line(outlineGeometry, outlineMaterial);
        outline.name = `DatumTargetRegionOutline-${datum.id}`;
        outline.userData = { datumTargetId: datum.id, parentFaceName: webglName, targetZone: isExactZone };
        outline.renderOrder = 6;
        outline.raycast = () => undefined;
        faceObject.add(outline);

        const hatchPoints: THREE.Vector3[] = [];
        const hatchSpacing = Math.max(Math.min(width, length) / 5, modelSizeMax * 0.004);
        const minK = -halfWidth - halfLength;
        const maxK = halfWidth + halfLength;
        const within = (value: number, min: number, max: number) => value >= min - 1e-6 && value <= max + 1e-6;
        for (let k = minK; k <= maxK + 1e-6; k += hatchSpacing) {
          const intersections: { u: number; v: number }[] = [];
          const leftV = -halfWidth - k;
          const rightV = halfWidth - k;
          const bottomU = k - halfLength;
          const topU = k + halfLength;
          if (within(leftV, -halfLength, halfLength)) intersections.push({ u: -halfWidth, v: leftV });
          if (within(rightV, -halfLength, halfLength)) intersections.push({ u: halfWidth, v: rightV });
          if (within(bottomU, -halfWidth, halfWidth)) intersections.push({ u: bottomU, v: -halfLength });
          if (within(topU, -halfWidth, halfWidth)) intersections.push({ u: topU, v: halfLength });
          if (intersections.length >= 2) {
            hatchPoints.push(
              liftedCenter.clone().addScaledVector(xAxis, intersections[0].u).addScaledVector(yAxis, intersections[0].v),
              liftedCenter.clone().addScaledVector(xAxis, intersections[1].u).addScaledVector(yAxis, intersections[1].v)
            );
          }
        }

        if (hatchPoints.length >= 2) {
          const hatchGeometry = new THREE.BufferGeometry().setFromPoints(hatchPoints);
          const hatchMaterial = new THREE.LineBasicMaterial({
            color: 0x047857,
            transparent: true,
            opacity: 0.82,
            depthWrite: false,
            depthTest: true,
          });
          const hatch = new THREE.LineSegments(hatchGeometry, hatchMaterial);
          hatch.name = `DatumTargetRegionHatch-${datum.id}`;
          hatch.userData = { datumTargetId: datum.id, parentFaceName: webglName, targetZone: isExactZone };
          hatch.renderOrder = 7;
          hatch.raycast = () => undefined;
          faceObject.add(hatch);
        }

        return true;
      };

      const zone = datum.targetZone;
      if (
        zone?.shape === "rectangle" &&
        zone.center &&
        zone.xDirection &&
        zone.yDirection &&
        Number.isFinite(zone.width) &&
        Number.isFinite(zone.length) &&
        zone.width > 0 &&
        zone.length > 0
      ) {
        const toVector = (value: { x: number; y: number; z: number }) => new THREE.Vector3(value.x, value.y, value.z);
        const assemblyPointToFaceLocal = (point: THREE.Vector3) =>
          faceObject.worldToLocal(assemblyGroup.localToWorld(point.clone()));
        const assemblyDirectionToFaceLocal = (direction: THREE.Vector3) => {
          const worldStart = assemblyGroup.localToWorld(new THREE.Vector3());
          const worldEnd = assemblyGroup.localToWorld(direction.clone());
          const localStart = faceObject.worldToLocal(worldStart);
          const localEnd = faceObject.worldToLocal(worldEnd);
          return localEnd.sub(localStart).normalize();
        };

        const center = assemblyPointToFaceLocal(toVector(zone.center));
        const xAxis = assemblyDirectionToFaceLocal(toVector(zone.xDirection));
        const yAxis = assemblyDirectionToFaceLocal(toVector(zone.yDirection));
        const normal = zone.normal
          ? assemblyDirectionToFaceLocal(toVector(zone.normal))
          : new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
        const modelCenterLocal = faceObject.worldToLocal(assemblyGroup.localToWorld(modelOrbitTarget.clone()));
        if (center.clone().sub(modelCenterLocal).dot(normal) < 0) {
          normal.negate();
        }
        if (addLocalRectangleOverlay(center, xAxis, yAxis, normal, zone.width, zone.length, true)) {
          return;
        }
      }

      if (datum.targetPoint) {
        const center = faceObject.worldToLocal(
          assemblyGroup.localToWorld(new THREE.Vector3(datum.targetPoint.x, datum.targetPoint.y, datum.targetPoint.z))
        );
        const cache = faceObject.userData.interactionCache;
        const modelCenterLocal = faceObject.worldToLocal(modelOrbitTarget.clone());
        const normal = cache?.coherentNormal instanceof THREE.Vector3
          ? cache.coherentNormal.clone()
          : new THREE.Vector3(0, 0, 1);
        if (center.clone().sub(modelCenterLocal).dot(normal) < 0) {
          normal.negate();
        }
        normal.normalize();

        const tangentCandidates = [
          new THREE.Vector3(1, 0, 0),
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(0, 0, 1),
        ]
          .map((axis) => axis.clone().addScaledVector(normal, -axis.dot(normal)))
          .filter((axis) => axis.lengthSq() > 1e-8)
          .sort((a, b) => b.lengthSq() - a.lengthSq());
        const xAxis = tangentCandidates[0]?.normalize() || new THREE.Vector3(1, 0, 0);
        const yAxis = new THREE.Vector3().crossVectors(normal, xAxis).normalize();
        const faceSize = cache?.size instanceof THREE.Vector3 ? cache.size : new THREE.Vector3();
        if (faceSize.lengthSq() <= 1e-8) {
          if (!faceObject.geometry.boundingBox) faceObject.geometry.computeBoundingBox();
          faceObject.geometry.boundingBox?.getSize(faceSize);
        }
        const positiveSpans = [faceSize.x, faceSize.y, faceSize.z].filter((value) => value > 1e-6).sort((a, b) => a - b);
        const fallbackSide = Math.max(
          modelSizeMax * 0.035,
          Math.min(modelSizeMax * 0.12, (positiveSpans[0] || modelSizeMax) * 0.18)
        );
        if (addLocalRectangleOverlay(center, xAxis, yAxis, normal, fallbackSide, fallbackSide, false)) {
          return;
        }
      }

      const overlayGeometry = faceObject.geometry.clone();
      const overlayMaterial = new THREE.MeshBasicMaterial({
        color: 0x22c55e,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const overlay = new THREE.Mesh(overlayGeometry, overlayMaterial);
      overlay.name = `DatumTargetRegion-${datum.id}`;
      overlay.userData = { datumTargetId: datum.id, parentFaceName: webglName };
      overlay.position.copy(faceObject.position);
      overlay.rotation.copy(faceObject.rotation);
      overlay.scale.copy(faceObject.scale);
      overlay.renderOrder = 3;
      overlay.raycast = () => undefined;
      assemblyGroup.add(overlay);

      const outlineGeometry = new THREE.EdgesGeometry(faceObject.geometry, 20);
      const outlineMaterial = new THREE.LineBasicMaterial({
        color: 0x047857,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        depthTest: true,
      });
      const outline = new THREE.LineSegments(outlineGeometry, outlineMaterial);
      outline.name = `DatumTargetRegionOutline-${datum.id}`;
      outline.userData = { datumTargetId: datum.id, parentFaceName: webglName };
      outline.position.copy(faceObject.position);
      outline.rotation.copy(faceObject.rotation);
      outline.scale.copy(faceObject.scale);
      outline.renderOrder = 4;
      outline.raycast = () => undefined;
      assemblyGroup.add(outline);
    };

    const findFaceNameForDatumTargetPoint = (targetPoint: { x: number; y: number; z: number } | undefined): string | null => {
      if (!targetPoint) return null;

      const point = new THREE.Vector3(targetPoint.x, targetPoint.y, targetPoint.z);
      const triangle = new THREE.Triangle();
      const closest = new THREE.Vector3();
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      const expandedBox = new THREE.Box3();
      const padding = Math.max(modelSizeMax * 0.015, 1e-3);
      let bestName: string | null = null;
      let bestDistance = Infinity;

      const readVertex = (positions: ArrayLike<number>, vertexIndex: number, target: THREE.Vector3) => {
        target.set(
          positions[vertexIndex * 3],
          positions[vertexIndex * 3 + 1],
          positions[vertexIndex * 3 + 2]
        );
      };

      for (const child of assemblyGroup.children) {
        if (!child.name.startsWith("BRepFace-")) continue;
        if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Points)) continue;

        const geometry = child.geometry;
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        if (geometry.boundingBox) {
          expandedBox.copy(geometry.boundingBox).expandByScalar(padding);
          if (!expandedBox.containsPoint(point)) continue;
        }

        const positionAttribute = geometry.getAttribute("position");
        if (!positionAttribute) continue;

        const positions = positionAttribute.array;
        const indexArray = geometry.getIndex()?.array;
        const triCount = indexArray && indexArray.length > 0
          ? Math.floor(indexArray.length / 3)
          : Math.floor(positionAttribute.count / 3);

        for (let i = 0; i < triCount; i++) {
          if (indexArray && indexArray.length > 0) {
            readVertex(positions, Number(indexArray[i * 3]), a);
            readVertex(positions, Number(indexArray[i * 3 + 1]), b);
            readVertex(positions, Number(indexArray[i * 3 + 2]), c);
          } else {
            readVertex(positions, i * 3, a);
            readVertex(positions, i * 3 + 1, b);
            readVertex(positions, i * 3 + 2, c);
          }

          triangle.set(a, b, c).closestPointToPoint(point, closest);
          const distance = closest.distanceToSquared(point);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestName = child.name;
          }
        }
      }

      return bestName;
    };

    const getBadgeEdgeDirectionLocal = (
      object: THREE.Object3D,
      leaderAxis: THREE.Vector3,
      fallback: THREE.Vector3
    ) => {
      const inverseWorld = new THREE.Matrix4().copy(object.matrixWorld).invert();
      const cameraRightLocal = new THREE.Vector3(1, 0, 0)
        .transformDirection(camera.matrixWorld)
        .transformDirection(inverseWorld);
      if (cameraRightLocal.lengthSq() <= 1e-8) {
        cameraRightLocal.copy(fallback);
      }
      if (cameraRightLocal.lengthSq() <= 1e-8) {
        cameraRightLocal.crossVectors(leaderAxis, new THREE.Vector3(1, 0, 0));
      }
      if (cameraRightLocal.lengthSq() <= 1e-8) {
        cameraRightLocal.crossVectors(leaderAxis, new THREE.Vector3(0, 1, 0));
      }
      cameraRightLocal.normalize();
      if (cameraRightLocal.dot(leaderAxis) < 0) {
        cameraRightLocal.negate();
      }
      return cameraRightLocal;
    };

    const getPerpendicularBadgeStemDirectionLocal = (
      badgeEdgeDirection: THREE.Vector3,
      outwardReference: THREE.Vector3,
      fallback: THREE.Vector3
    ) => {
      const stemDirection = outwardReference.clone().addScaledVector(
        badgeEdgeDirection,
        -outwardReference.dot(badgeEdgeDirection)
      );
      if (stemDirection.lengthSq() <= 1e-8) {
        stemDirection.copy(fallback).addScaledVector(
          badgeEdgeDirection,
          -fallback.dot(badgeEdgeDirection)
        );
      }
      if (stemDirection.lengthSq() <= 1e-8) {
        stemDirection.crossVectors(badgeEdgeDirection, new THREE.Vector3(1, 0, 0));
      }
      if (stemDirection.lengthSq() <= 1e-8) {
        stemDirection.crossVectors(badgeEdgeDirection, new THREE.Vector3(0, 1, 0));
      }
      stemDirection.normalize();
      if (stemDirection.dot(outwardReference) < 0) {
        stemDirection.negate();
      }
      return stemDirection;
    };

    const refreshDatumAnchorCache = () => {
      const currentAnnotations = [
        ...(propsRef.current.datums || [])
          .filter((d: any) => d.type !== "Datum Target Set")
          .map((d: any) => ({ ...d, annotationKind: "datum" })),
        ...(propsRef.current.datumTargets || []).map((d: any) => ({ ...d, annotationKind: "datumTarget" })),
      ];
      datumCacheMissingElements = 0;
      clearDatumTargetRegionOverlays();
      clearDatumLeaderGeometry();
      drawDatumReferenceFrameOverlay();
      const sharedHoleLeaderDirections = new Map<string, THREE.Vector3>();
      const quantizeForGrouping = (value: number, tolerance: number) =>
        Math.round(value / tolerance);
      const getHolePlaneGroupKey = (axis: THREE.Vector3, axisFoot: THREE.Vector3) => {
        const normal = axis.clone().normalize();
        const planeValue = axisFoot.dot(normal);
        const directionTolerance = 1e-3;
        const positionTolerance = Math.max(modelSizeMax * 0.002, 1e-3);
        return [
          quantizeForGrouping(normal.x, directionTolerance),
          quantizeForGrouping(normal.y, directionTolerance),
          quantizeForGrouping(normal.z, directionTolerance),
          quantizeForGrouping(planeValue, positionTolerance),
        ].join(":");
      };
      const getCanonicalLeaderDirection = (blockedAxis: THREE.Vector3, anchorPoint: THREE.Vector3) => {
        const localBounds = new THREE.Box3();
        const localSize = new THREE.Vector3();
        const corner = new THREE.Vector3();
        localBounds.makeEmpty();
        assemblyGroup.children.forEach((item) => {
          if (!item.name.startsWith("BRepFace-")) return;
          const mesh = item as THREE.Mesh | THREE.LineSegments | THREE.Points;
          const geometry = mesh.geometry;
          if (!geometry) return;
          if (!geometry.boundingBox) geometry.computeBoundingBox();
          const bbox = geometry.boundingBox;
          if (!bbox) return;
          for (const x of [bbox.min.x, bbox.max.x]) {
            for (const y of [bbox.min.y, bbox.max.y]) {
              for (const z of [bbox.min.z, bbox.max.z]) {
                corner.set(x, y, z);
                item.localToWorld(corner);
                assemblyGroup.worldToLocal(corner);
                localBounds.expandByPoint(corner);
              }
            }
          }
        });
        localBounds.getSize(localSize);

        const canonicalAxes = [
          { axis: new THREE.Vector3(1, 0, 0), size: localSize.x },
          { axis: new THREE.Vector3(0, 1, 0), size: localSize.y },
          { axis: new THREE.Vector3(0, 0, 1), size: localSize.z },
        ]
          .map(({ axis, size }) => {
            const projected = axis.clone().addScaledVector(blockedAxis, -axis.dot(blockedAxis));
            return {
              axis: projected,
              score: Math.max(size, 1e-6) * projected.lengthSq()
            };
          })
          .filter(({ axis }) => axis.lengthSq() > 1e-8)
          .sort((a, b) => b.score - a.score);

        const leaderDirection = canonicalAxes[0]?.axis.normalize() || new THREE.Vector3(0, 1, 0);
        const modelCenterLocal = modelOrbitTarget.clone();
        if (
          anchorPoint.clone().add(leaderDirection).distanceToSquared(modelCenterLocal) <
          anchorPoint.distanceToSquared(modelCenterLocal)
        ) {
          leaderDirection.negate();
        }
        return leaderDirection;
      };
      const getPrimaryDatumNormalLocal = (): THREE.Vector3 | null => {
        const primaryDatum = (propsRef.current.datums || []).find((datum: any) =>
          datum.identifier === "A" && datum.type !== "Datum Target Set"
        );
        if (!primaryDatum) return null;

        const primaryFaceName = mapDatumTargetsToWebGLNames(primaryDatum)[0];
        if (!primaryFaceName) return null;

        return getFaceFrameInAssembly(primaryFaceName)?.normal || null;
      };
      datumAnchorCache = currentAnnotations.flatMap((d: any) => {
        const element = document.getElementById(`3d-datum-badge-${d.id}`);
        const leaderElement = document.getElementById(`3d-datum-leader-${d.id}`);
        const triangleElement = document.getElementById(`3d-datum-triangle-${d.id}`);
        const webglNames = mapDatumTargetsToWebGLNames(d);
        const webglName = webglNames[0] ||
          (d.annotationKind === "datumTarget"
            ? findFaceNameForDatumTargetPoint(d.targetPoint || d.targetLine?.center || d.targetCircle?.center || d.targetCurve?.center)
            : null);
        const hasStandaloneTargetGeometry = d.annotationKind === "datumTarget" && (d.targetLine || d.targetCircle || d.targetCurve);
        if (!element || (!webglName && !hasStandaloneTargetGeometry)) {
          if (!element) datumCacheMissingElements++;
          if (element) element.style.display = "none";
          if (leaderElement) leaderElement.style.display = "none";
          if (triangleElement) triangleElement.style.display = "none";
          return [];
        }

        const child = webglName ? assemblyGroup.getObjectByName(webglName) : assemblyGroup;
        if (!child) {
          element.style.display = "none";
          if (leaderElement) leaderElement.style.display = "none";
          if (triangleElement) triangleElement.style.display = "none";
          return [];
        }
        let anchorObject: THREE.Object3D = child;

        const geom = (child as THREE.Mesh | THREE.LineSegments | THREE.Points).geometry;
        if (geom && !geom.boundingBox) {
          geom.computeBoundingBox();
        }

        if (webglName && isRegionDatumTarget(d)) {
          addDatumTargetRegionOverlay(d, child, webglName);
        }

        const datumTargetText = `${d.type || ""} ${d.targetName || ""}`;
        const baseWebglNames = webglNames.length > 0 ? webglNames : mapDatumTargetsToWebGLNames(d);
        const datumRenderKind = getDatumRenderKindForFaces(d, baseWebglNames);
        const isDimensionDatum = d.annotationKind !== "datumTarget" &&
          (datumRenderKind === "twoFaceDimension" || datumRenderKind === "medianPlane");
        const medianWebglNames = isDimensionDatum ? mapMedianDatumTargetsToWebGLNames(d) : [];
        if (isDimensionDatum && medianWebglNames.length < 2) {
          datumCacheMissingElements++;
          element.style.display = "none";
          if (leaderElement) leaderElement.style.display = "none";
          if (triangleElement) triangleElement.style.display = "none";
          return [];
        }
        let isMedianDatum = isDimensionDatum && medianWebglNames.length >= 2;
        const isPlanarDatum = /plane|planar|flat/i.test(datumTargetText);
        const isCylindricalDatum = /cylind|hole wall|bore/i.test(datumTargetText);
        const isHoleDatum = /hole|bore/i.test(datumTargetText);
        const hasLeader = d.annotationKind === "datumTarget" || isMedianDatum || (isPlanarDatum || isCylindricalDatum);

        const datumTargetCenter = d.targetPoint || d.targetLine?.center || d.targetCircle?.center || d.targetCurve?.center;
        const usePresentationPoint = d.annotationKind === "datumTarget" &&
          datumTargetCenter;
        const localPoint = usePresentationPoint
          ? new THREE.Vector3(datumTargetCenter.x, datumTargetCenter.y, datumTargetCenter.z)
          : d.annotationKind === "datumTarget"
            ? (geom ? getStableSurfacePoint(child) : new THREE.Vector3())
            : new THREE.Vector3();
        if (d.annotationKind !== "datumTarget") {
          if (hasLeader) {
            localPoint.copy(getStableSurfacePoint(child));
          } else if (child.userData.interactionCache?.localCenter) {
            localPoint.copy(child.userData.interactionCache.localCenter);
          } else {
            geom.boundingBox?.getCenter(localPoint);
          }
        }

        const offset = new THREE.Vector3();
        const leaderTangent = new THREE.Vector3(1, 0, 0);
        const leaderAxisLocal = new THREE.Vector3();
        let triangleObject: THREE.LineLoop | null = null;
        let leaderObject: THREE.Line | null = null;
        let arrowShaftObject: THREE.Line | THREE.LineSegments | null = null;
        let arrowHeadObject: THREE.Mesh | THREE.LineSegments | null = null;
        let targetMarkObject: THREE.Line | THREE.LineSegments | null = null;
        let dimensionObject: THREE.LineSegments | null = null;
        let dimensionStartLocal: THREE.Vector3 | null = null;
        let dimensionEndLocal: THREE.Vector3 | null = null;
        let dimensionTouchStartLocal: THREE.Vector3 | null = null;
        let dimensionTouchEndLocal: THREE.Vector3 | null = null;
        let dimensionExtensionLocal: THREE.Vector3 | null = null;
        let triangleApexLocal: THREE.Vector3 | null = null;
        let calloutKind: "planar" | "cylindrical" | "median" | "targetPoint" | "targetZone" | "targetLine" | "targetCircle" | "targetCurve" | null = null;
        let triangleHeight = 0;
        let triangleHalfBase = 0;
        let arrowLength = 0;
        let arrowHalfWidth = 0;
        let leaderRadialLength = 0;
        let leaderDoglegLength = 0;
        let leaderStemLength = 0;
        let dimensionHalfLength = 0;
        let dimensionTickLength = 0;
        let targetMarkHalfSize = 0;

        if (isMedianDatum) {
          const faceObjects = medianWebglNames
            .map((name) => assemblyGroup.getObjectByName(name))
            .filter((obj): obj is THREE.Object3D => !!obj && obj.name.startsWith("BRepFace-"))
            .slice(0, 2);

          if (faceObjects.length >= 2) {
            anchorObject = assemblyGroup;
            const faceFrames = faceObjects.map((faceObject) => getFaceFrameInAssembly(faceObject.name));
            const stableFacePoints = faceObjects.map((faceObject) => {
              const localAnchor = getStableSurfacePoint(faceObject);
              const worldAnchor = faceObject.localToWorld(localAnchor.clone());
              return assemblyGroup.worldToLocal(worldAnchor);
            });
            const firstFrame = faceFrames[0];
            const secondFrame = faceFrames[1];
            let firstPoint = stableFacePoints[0];
            let secondPoint = stableFacePoints[1];
            let dimensionAxis = secondPoint.clone().sub(firstPoint);

            if (firstFrame?.normal && secondFrame?.normal) {
              const normalAlignment = Math.abs(firstFrame.normal.dot(secondFrame.normal));
              const separation = secondFrame.center.clone().sub(firstFrame.center);
              const normalDistance = separation.dot(firstFrame.normal);
              if (normalAlignment > 0.94 && Math.abs(normalDistance) > Math.max(modelSizeMax * 0.001, 1e-6)) {
                dimensionAxis = firstFrame.normal.clone();
                if (normalDistance < 0) {
                  dimensionAxis.negate();
                }
                const lateralCenter = stableFacePoints[0].clone().add(stableFacePoints[1]).multiplyScalar(0.5);
                const centerPlaneCoordinate = (firstFrame.center.dot(dimensionAxis) + secondFrame.center.dot(dimensionAxis)) * 0.5;
                const dimensionCenter = lateralCenter
                  .clone()
                  .addScaledVector(dimensionAxis, centerPlaneCoordinate - lateralCenter.dot(dimensionAxis));
                const dimensionHalfDistance = Math.abs(normalDistance) * 0.5;
                firstPoint = dimensionCenter.clone().addScaledVector(dimensionAxis, -dimensionHalfDistance);
                secondPoint = dimensionCenter.clone().addScaledVector(dimensionAxis, dimensionHalfDistance);
              }
            }
            dimensionAxis = secondPoint.clone().sub(firstPoint);
            if (dimensionAxis.lengthSq() > 1e-8) {
              dimensionHalfLength = dimensionAxis.length() * 0.5;
              dimensionAxis.normalize();
              localPoint.copy(firstPoint).add(secondPoint).multiplyScalar(0.5);

              const primaryNormal = getPrimaryDatumNormalLocal();
              let leaderDirection = primaryNormal
                ? primaryNormal.clone().addScaledVector(dimensionAxis, -primaryNormal.dot(dimensionAxis))
                : new THREE.Vector3();
              if (leaderDirection.lengthSq() <= 1e-8 && primaryNormal) {
                leaderDirection.crossVectors(primaryNormal, dimensionAxis);
              }
              if (leaderDirection.lengthSq() <= 1e-8) {
                leaderDirection = getCanonicalLeaderDirection(dimensionAxis, localPoint);
              } else {
                leaderDirection.normalize();
                const modelCenterLocal = modelOrbitTarget.clone();
                if (
                  localPoint.clone().add(leaderDirection).distanceToSquared(modelCenterLocal) <
                  localPoint.distanceToSquared(modelCenterLocal)
                ) {
                  leaderDirection.negate();
                }
              }
              dimensionExtensionLocal = leaderDirection.clone();

              leaderTangent.copy(dimensionAxis);
              leaderAxisLocal.copy(leaderDirection);
              calloutKind = "median";
              const normalOffset = Math.max(modelSizeMax * 0.065, 1e-4);
              leaderDoglegLength = 0;
              leaderStemLength = Math.max(normalOffset * 0.88, modelSizeMax * 0.058);
              triangleHeight = Math.max(normalOffset * 0.28, modelSizeMax * 0.018);
              triangleHalfBase = triangleHeight / Math.sqrt(3);
              arrowLength = normalOffset * 0.18;
              arrowHalfWidth = arrowLength * 0.36;
              dimensionTickLength = Math.max(arrowHalfWidth * 8.0, modelSizeMax * 0.045);

              dimensionStartLocal = localPoint.clone().addScaledVector(dimensionAxis, -dimensionHalfLength);
              dimensionEndLocal = localPoint.clone().addScaledVector(dimensionAxis, dimensionHalfLength);
              dimensionTouchStartLocal = dimensionStartLocal.clone();
              dimensionTouchEndLocal = dimensionEndLocal.clone();
              const triangleBaseCenterLocal = localPoint.clone();
              triangleApexLocal = triangleBaseCenterLocal.clone().addScaledVector(leaderDirection, triangleHeight);
              const badgeStemEndLocal = triangleApexLocal.clone().addScaledVector(leaderDirection, leaderStemLength);
              offset.copy(badgeStemEndLocal).sub(localPoint);

              const dimensionGeometry = new THREE.BufferGeometry().setFromPoints([
                dimensionStartLocal.clone(),
                dimensionEndLocal.clone(),
                dimensionStartLocal.clone().addScaledVector(leaderDirection, -dimensionTickLength * 0.5),
                dimensionStartLocal.clone().addScaledVector(leaderDirection, dimensionTickLength * 0.5),
                dimensionEndLocal.clone().addScaledVector(leaderDirection, -dimensionTickLength * 0.5),
                dimensionEndLocal.clone().addScaledVector(leaderDirection, dimensionTickLength * 0.5),
              ]);
              const dimensionMaterial = new THREE.LineBasicMaterial({
                color: 0x1e293b,
                depthTest: false,
                depthWrite: false,
                transparent: true,
                opacity: 0.95,
              });
              dimensionObject = new THREE.LineSegments(dimensionGeometry, dimensionMaterial);
              dimensionObject.name = `DatumMedianDimension-${d.id}`;
              dimensionObject.renderOrder = 30;
              dimensionObject.raycast = () => undefined;
              assemblyGroup.add(dimensionObject);

              const arrowSide = leaderDirection.clone().multiplyScalar(arrowHalfWidth);
              const startArrowBase = dimensionStartLocal.clone().addScaledVector(dimensionAxis, arrowLength);
              const endArrowBase = dimensionEndLocal.clone().addScaledVector(dimensionAxis, -arrowLength);
              const arrowGeometry = new THREE.BufferGeometry().setFromPoints([
                dimensionStartLocal.clone(),
                startArrowBase.clone().add(arrowSide),
                startArrowBase.clone().sub(arrowSide),
                dimensionEndLocal.clone(),
                endArrowBase.clone().add(arrowSide),
                endArrowBase.clone().sub(arrowSide),
              ]);
              const arrowMaterial = new THREE.MeshBasicMaterial({
                color: 0x1e293b,
                depthTest: false,
                depthWrite: false,
                transparent: true,
                opacity: 0.95,
                side: THREE.DoubleSide,
              });
              arrowHeadObject = new THREE.Mesh(arrowGeometry, arrowMaterial);
              arrowHeadObject.name = `DatumLeaderArrow-${d.id}-MedianHeads`;
              arrowHeadObject.renderOrder = 30;
              arrowHeadObject.raycast = () => undefined;
              assemblyGroup.add(arrowHeadObject);

              const triangleGeometry = new THREE.BufferGeometry().setFromPoints([
                triangleBaseCenterLocal.clone().addScaledVector(dimensionAxis, -triangleHalfBase),
                triangleBaseCenterLocal.clone().addScaledVector(dimensionAxis, triangleHalfBase),
                triangleApexLocal.clone(),
              ]);
              const triangleMaterial = new THREE.LineBasicMaterial({
                color: 0x1e293b,
                depthTest: false,
                depthWrite: false,
                transparent: true,
                opacity: 0.95,
              });
              triangleObject = new THREE.LineLoop(triangleGeometry, triangleMaterial);
              triangleObject.name = `DatumLeaderTriangle-${d.id}`;
              triangleObject.renderOrder = 30;
              triangleObject.raycast = () => undefined;
              assemblyGroup.add(triangleObject);

              const leaderGeometry = new THREE.BufferGeometry().setFromPoints([
                triangleApexLocal.clone(),
                badgeStemEndLocal.clone(),
              ]);
              const leaderMaterial = new THREE.LineBasicMaterial({
                color: 0x1e293b,
                depthTest: false,
                depthWrite: false,
                transparent: true,
                opacity: 0.95,
              });
              leaderObject = new THREE.Line(leaderGeometry, leaderMaterial);
              leaderObject.name = `DatumLeaderLine-${d.id}`;
              leaderObject.renderOrder = 30;
              leaderObject.raycast = () => undefined;
              assemblyGroup.add(leaderObject);
            }
          } else {
            isMedianDatum = false;
          }
        }

        if (d.annotationKind === "datumTarget") {
          const cache = child.userData.interactionCache;
          const normalOffset = Math.max(modelSizeMax * 0.065, 1e-4);
          const toVector = (value: { x: number; y: number; z: number }) => new THREE.Vector3(value.x, value.y, value.z);
          const assemblyPointToChildLocal = (point: THREE.Vector3) =>
            child.worldToLocal(assemblyGroup.localToWorld(point.clone()));
          const assemblyDirectionToChildLocal = (direction: THREE.Vector3) => {
            const worldStart = assemblyGroup.localToWorld(new THREE.Vector3());
            const worldEnd = assemblyGroup.localToWorld(direction.clone());
            const localStart = child.worldToLocal(worldStart);
            const localEnd = child.worldToLocal(worldEnd);
            return localEnd.sub(localStart).normalize();
          };
          if (datumTargetCenter) {
            localPoint.copy(assemblyPointToChildLocal(toVector(datumTargetCenter)));
          }
          const modelCenterLocal = child === assemblyGroup
            ? modelOrbitTarget.clone()
            : child.worldToLocal(modelOrbitTarget.clone());
          const semanticNormal = d.targetCurve?.normal || d.targetCircle?.normal || d.targetLine?.normal;
          const unitNormal = semanticNormal
            ? assemblyDirectionToChildLocal(toVector(semanticNormal))
            : cache?.coherentNormal instanceof THREE.Vector3
              ? cache.coherentNormal.clone()
              : new THREE.Vector3(0, 0, 1);
          if (unitNormal.lengthSq() <= 1e-8) {
            unitNormal.set(0, 0, 1);
          }
          unitNormal.normalize();
          if (localPoint.clone().sub(modelCenterLocal).dot(unitNormal) < 0) {
            unitNormal.negate();
          }

          calloutKind = isRegionDatumTarget(d)
            ? "targetZone"
            : isCurveDatumTarget(d)
              ? "targetCurve"
              : isLineDatumTarget(d)
              ? "targetLine"
              : isCircleDatumTarget(d)
                ? "targetCircle"
                : "targetPoint";
          const targetPlaneNormal = unitNormal.clone();
          const leaderDirection = unitNormal.clone();
          if ((calloutKind === "targetCurve" || calloutKind === "targetCircle") && datumTargetCenter) {
            const centerLocal = assemblyPointToChildLocal(toVector(datumTargetCenter));
            let radialDirection = centerLocal.clone().sub(modelCenterLocal);
            radialDirection.addScaledVector(targetPlaneNormal, -radialDirection.dot(targetPlaneNormal));

            if (radialDirection.lengthSq() <= 1e-8 && Array.isArray(d.targetCurve?.points) && d.targetCurve.points.length > 0) {
              radialDirection.copy(assemblyPointToChildLocal(toVector(d.targetCurve.points[0])).sub(centerLocal));
            }
            if (radialDirection.lengthSq() <= 1e-8 && d.targetCircle?.xDirection) {
              radialDirection.copy(assemblyDirectionToChildLocal(toVector(d.targetCircle.xDirection)));
            }
            if (radialDirection.lengthSq() <= 1e-8) {
              radialDirection.crossVectors(targetPlaneNormal, new THREE.Vector3(1, 0, 0));
              if (radialDirection.lengthSq() <= 1e-8) {
                radialDirection.crossVectors(targetPlaneNormal, new THREE.Vector3(0, 1, 0));
              }
            }
            radialDirection.normalize();

            let circleLandingLocal = centerLocal.clone();
            if (Array.isArray(d.targetCurve?.points) && d.targetCurve.points.length > 0) {
              let bestScore = -Infinity;
              for (const point of d.targetCurve.points) {
                const pointLocal = assemblyPointToChildLocal(toVector(point));
                const score = pointLocal.clone().sub(centerLocal).dot(radialDirection);
                if (score > bestScore) {
                  bestScore = score;
                  circleLandingLocal = pointLocal;
                }
              }
            } else if (d.targetCircle?.diameter) {
              circleLandingLocal.addScaledVector(radialDirection, d.targetCircle.diameter / 2);
            }

            localPoint.copy(circleLandingLocal);
            leaderDirection.copy(radialDirection);
          }

          offset.copy(leaderDirection.clone().multiplyScalar(normalOffset));
          leaderAxisLocal.copy(leaderDirection);
          arrowLength = normalOffset * 0.18;
          arrowHalfWidth = arrowLength * 0.36;
          targetMarkHalfSize = normalOffset * 0.16;

          const tangentCandidates = [
            new THREE.Vector3(1, 0, 0),
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(0, 0, 1),
          ]
            .map((axis) => axis.clone().addScaledVector(leaderDirection, -axis.dot(leaderDirection)))
            .filter((tangent) => tangent.lengthSq() > 1e-8)
            .sort((a, b) => b.lengthSq() - a.lengthSq());
          if (tangentCandidates[0]) {
            leaderTangent.copy(tangentCandidates[0].normalize());
          }
          const tangentSecond = new THREE.Vector3().crossVectors(leaderDirection, leaderTangent).normalize();

          if (child instanceof THREE.Mesh || child === assemblyGroup) {
            const leaderEndLocal = localPoint.clone().add(offset);
            const arrowDirection = localPoint.clone().sub(leaderEndLocal).normalize();
            const arrowBaseLocal = localPoint.clone().addScaledVector(arrowDirection, -arrowLength);
            const arrowSide = leaderTangent.clone().multiplyScalar(arrowHalfWidth);

            const shaftGeometry = new THREE.BufferGeometry().setFromPoints([
              leaderEndLocal.clone(),
              arrowBaseLocal.clone(),
            ]);
            const shaftMaterial = new THREE.LineBasicMaterial({
              color: 0x047857,
              depthTest: false,
              depthWrite: false,
              transparent: true,
              opacity: 0.95,
            });
            arrowShaftObject = new THREE.Line(shaftGeometry, shaftMaterial);
            arrowShaftObject.name = `DatumLeaderArrow-${d.id}-TargetShaft`;
            arrowShaftObject.renderOrder = 31;
            arrowShaftObject.raycast = () => undefined;
            child.add(arrowShaftObject);

            const arrowGeometry = new THREE.BufferGeometry().setFromPoints([
              localPoint.clone(),
              arrowBaseLocal.clone().add(arrowSide),
              arrowBaseLocal.clone().sub(arrowSide),
            ]);
            const arrowMaterial = new THREE.MeshBasicMaterial({
              color: 0x047857,
              depthTest: false,
              depthWrite: false,
              transparent: true,
              opacity: 0.95,
              side: THREE.DoubleSide,
            });
            arrowHeadObject = new THREE.Mesh(arrowGeometry, arrowMaterial);
            arrowHeadObject.name = `DatumLeaderArrow-${d.id}-TargetHead`;
              arrowHeadObject.renderOrder = 31;
              arrowHeadObject.raycast = () => undefined;
              child.add(arrowHeadObject);

            if (calloutKind === "targetLine" && d.targetLine?.start && d.targetLine?.end) {
              const markerLift = Math.max(modelSizeMax * 0.0012, 1e-5);
              const startLocal = assemblyPointToChildLocal(toVector(d.targetLine.start)).addScaledVector(unitNormal, markerLift);
              const endLocal = assemblyPointToChildLocal(toVector(d.targetLine.end)).addScaledVector(unitNormal, markerLift);
              const lineGeometry = new THREE.BufferGeometry().setFromPoints([startLocal, endLocal]);
              const lineMaterial = new THREE.LineBasicMaterial({
                color: 0x047857,
                depthTest: false,
                depthWrite: false,
                transparent: true,
                opacity: 0.98,
              });
              targetMarkObject = new THREE.Line(lineGeometry, lineMaterial);
              targetMarkObject.name = `DatumTargetLineMark-${d.id}`;
              targetMarkObject.renderOrder = 32;
              targetMarkObject.raycast = () => undefined;
              child.add(targetMarkObject);
            }

            if (calloutKind === "targetCurve" && Array.isArray(d.targetCurve?.points) && d.targetCurve.points.length >= 2) {
              const markerLift = Math.max(modelSizeMax * 0.0012, 1e-5);
              const curvePoints = d.targetCurve.points.map((point: { x: number; y: number; z: number }) =>
                assemblyPointToChildLocal(toVector(point)).addScaledVector(unitNormal, markerLift)
              );
              const curveGeometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
              const curveMaterial = new THREE.LineBasicMaterial({
                color: 0x047857,
                depthTest: false,
                depthWrite: false,
                transparent: true,
                opacity: 0.98,
              });
              targetMarkObject = new THREE.Line(curveGeometry, curveMaterial);
              targetMarkObject.name = `DatumTargetCurveMark-${d.id}`;
              targetMarkObject.renderOrder = 32;
              targetMarkObject.raycast = () => undefined;
              child.add(targetMarkObject);
            }

            if (calloutKind === "targetCircle" && d.targetCircle?.center && d.targetCircle?.diameter) {
              const markerLift = Math.max(modelSizeMax * 0.0012, 1e-5);
              const centerLocal = assemblyPointToChildLocal(toVector(d.targetCircle.center)).addScaledVector(unitNormal, markerLift);
              const xAxis = d.targetCircle.xDirection
                ? assemblyDirectionToChildLocal(toVector(d.targetCircle.xDirection))
                : leaderTangent.clone();
              const yAxis = d.targetCircle.yDirection
                ? assemblyDirectionToChildLocal(toVector(d.targetCircle.yDirection))
                : tangentSecond.clone();
              if (xAxis.lengthSq() > 1e-8 && yAxis.lengthSq() > 1e-8) {
                xAxis.normalize();
                yAxis.normalize();
                const radius = Math.max(d.targetCircle.diameter / 2, modelSizeMax * 0.002);
                const circlePoints: THREE.Vector3[] = [];
                const segmentCount = 64;
                for (let i = 0; i <= segmentCount; i++) {
                  const theta = (i / segmentCount) * Math.PI * 2;
                  circlePoints.push(
                    centerLocal.clone()
                      .addScaledVector(xAxis, Math.cos(theta) * radius)
                      .addScaledVector(yAxis, Math.sin(theta) * radius)
                  );
                }
                const circleGeometry = new THREE.BufferGeometry().setFromPoints(circlePoints);
                const circleMaterial = new THREE.LineBasicMaterial({
                  color: 0x047857,
                  depthTest: false,
                  depthWrite: false,
                  transparent: true,
                  opacity: 0.98,
                });
                targetMarkObject = new THREE.Line(circleGeometry, circleMaterial);
                targetMarkObject.name = `DatumTargetCircleMark-${d.id}`;
                targetMarkObject.renderOrder = 32;
                targetMarkObject.raycast = () => undefined;
                child.add(targetMarkObject);

                const hatchPoints: THREE.Vector3[] = [];
                const hatchSpacing = Math.max(radius / 3.5, modelSizeMax * 0.003);
                const hatchDirection = xAxis.clone().add(yAxis).normalize();
                const hatchNormal = yAxis.clone().sub(xAxis).normalize();
                for (let offset = -radius; offset <= radius + 1e-6; offset += hatchSpacing) {
                  const halfChord = Math.sqrt(Math.max(radius * radius - offset * offset, 0));
                  if (halfChord <= 1e-8) continue;
                  const chordCenter = centerLocal.clone().addScaledVector(hatchNormal, offset);
                  hatchPoints.push(
                    chordCenter.clone().addScaledVector(hatchDirection, -halfChord),
                    chordCenter.clone().addScaledVector(hatchDirection, halfChord)
                  );
                }
                if (hatchPoints.length >= 2) {
                  const hatchGeometry = new THREE.BufferGeometry().setFromPoints(hatchPoints);
                  const hatchMaterial = new THREE.LineBasicMaterial({
                    color: 0x047857,
                    depthTest: false,
                    depthWrite: false,
                    transparent: true,
                    opacity: 0.55,
                  });
                  const hatch = new THREE.LineSegments(hatchGeometry, hatchMaterial);
                  hatch.name = `DatumTargetCircleHatch-${d.id}`;
                  hatch.renderOrder = 31;
                  hatch.raycast = () => undefined;
                  child.add(hatch);
                }
              }
            }

            if (calloutKind === "targetPoint") {
              const markGeometry = new THREE.BufferGeometry().setFromPoints([
                localPoint.clone().addScaledVector(leaderTangent, -targetMarkHalfSize).addScaledVector(tangentSecond, -targetMarkHalfSize),
                localPoint.clone().addScaledVector(leaderTangent, targetMarkHalfSize).addScaledVector(tangentSecond, targetMarkHalfSize),
                localPoint.clone().addScaledVector(leaderTangent, -targetMarkHalfSize).addScaledVector(tangentSecond, targetMarkHalfSize),
                localPoint.clone().addScaledVector(leaderTangent, targetMarkHalfSize).addScaledVector(tangentSecond, -targetMarkHalfSize),
              ]);
              const markMaterial = new THREE.LineBasicMaterial({
                color: 0x047857,
                depthTest: false,
                depthWrite: false,
                transparent: true,
                opacity: 0.95,
              });
              targetMarkObject = new THREE.LineSegments(markGeometry, markMaterial);
              targetMarkObject.name = `DatumTargetPointMark-${d.id}`;
              targetMarkObject.renderOrder = 32;
              targetMarkObject.raycast = () => undefined;
              child.add(targetMarkObject);
            }
          }
        }

        if (d.annotationKind !== "datumTarget" && !isMedianDatum) {
          if (hasLeader) {
            const cache = child.userData.interactionCache;
            const faceSize = cache?.size instanceof THREE.Vector3 ? cache.size.clone() : new THREE.Vector3(20, 20, 20);
            const normalOffset = Math.max(modelSizeMax * 0.065, 1e-4);
            const axisPointLocal = cache?.localCenter instanceof THREE.Vector3
              ? cache.localCenter.clone()
              : localPoint.clone();
            const modelCenterLocal = child.worldToLocal(modelOrbitTarget.clone());
            const cylinderAxis = cache?.cylinderAxis instanceof THREE.Vector3
              ? cache.cylinderAxis.clone().normalize()
              : new THREE.Vector3(0, 1, 0);
            const cylinderAxisPointLocal = axisPointLocal.clone();
            if (isCylindricalDatum) {
              cylinderAxisPointLocal.addScaledVector(
                cylinderAxis,
                localPoint.clone().sub(cylinderAxisPointLocal).dot(cylinderAxis)
              );
            }

            const unitNormal = cache?.coherentNormal instanceof THREE.Vector3
                ? cache.coherentNormal.clone()
                : new THREE.Vector3(0, 0, 1);
            if (unitNormal.lengthSq() <= 1e-8) {
              unitNormal.crossVectors(cylinderAxis, new THREE.Vector3(1, 0, 0));
              if (unitNormal.lengthSq() <= 1e-8) {
                unitNormal.crossVectors(cylinderAxis, new THREE.Vector3(0, 1, 0));
              }
            }
            unitNormal.normalize();
            if (isCylindricalDatum) {
              const radialDirection = localPoint.clone().sub(cylinderAxisPointLocal);
              if (radialDirection.lengthSq() <= 1e-8) {
                radialDirection.copy(unitNormal).addScaledVector(
                  cylinderAxis,
                  -unitNormal.dot(cylinderAxis)
                );
              }
              if (radialDirection.lengthSq() <= 1e-8) {
                radialDirection.crossVectors(cylinderAxis, new THREE.Vector3(1, 0, 0));
                if (radialDirection.lengthSq() <= 1e-8) {
                  radialDirection.crossVectors(cylinderAxis, new THREE.Vector3(0, 1, 0));
                }
              }
              radialDirection.normalize();

              if (isHoleDatum && child instanceof THREE.Mesh) {
                const positionAttribute = child.geometry.getAttribute("position");
                const axisOrigin = axisPointLocal.clone();
                let minAxis = Infinity;
                let maxAxis = -Infinity;
                for (let i = 0; i < positionAttribute.count; i++) {
                  const vertex = new THREE.Vector3().fromBufferAttribute(positionAttribute, i);
                  const axisValue = vertex.sub(axisOrigin).dot(cylinderAxis);
                  minAxis = Math.min(minAxis, axisValue);
                  maxAxis = Math.max(maxAxis, axisValue);
                }

                if (Number.isFinite(minAxis) && Number.isFinite(maxAxis)) {
                  const radius = Math.max(localPoint.distanceTo(cylinderAxisPointLocal), 1e-6);
                  const pointAtAxisValue = (axisValue: number) => {
                    const axisFoot = axisOrigin.clone().addScaledVector(cylinderAxis, axisValue);
                    return {
                      axisFoot,
                      surfacePoint: axisFoot.clone().addScaledVector(radialDirection, radius)
                    };
                  };
                  const minCandidate = pointAtAxisValue(minAxis);
                  const maxCandidate = pointAtAxisValue(maxAxis);
                  const minWorld = child.localToWorld(minCandidate.surfacePoint.clone());
                  const maxWorld = child.localToWorld(maxCandidate.surfacePoint.clone());
                  const selected = minWorld.distanceToSquared(camera.position) <= maxWorld.distanceToSquared(camera.position)
                    ? minCandidate
                    : maxCandidate;
                  cylinderAxisPointLocal.copy(selected.axisFoot);
                  const planeKey = getHolePlaneGroupKey(cylinderAxis, selected.axisFoot);
                  const sharedDirection = sharedHoleLeaderDirections.get(planeKey);
                  if (sharedDirection) {
                    radialDirection.copy(sharedDirection);
                    selected.surfacePoint.copy(selected.axisFoot).addScaledVector(radialDirection, radius);
                  } else {
                    sharedHoleLeaderDirections.set(planeKey, radialDirection.clone());
                  }
                  localPoint.copy(selected.surfacePoint);
                }
              }

              const positiveRadialEnd = localPoint.clone().addScaledVector(radialDirection, normalOffset);
              const negativeRadialEnd = localPoint.clone().addScaledVector(radialDirection, -normalOffset);
              if (!isHoleDatum && negativeRadialEnd.distanceToSquared(modelCenterLocal) > positiveRadialEnd.distanceToSquared(modelCenterLocal)) {
                radialDirection.negate();
              }
              const doglegDirection = getBadgeEdgeDirectionLocal(child, radialDirection, cylinderAxis);
              leaderTangent.copy(doglegDirection);
              leaderRadialLength = Math.max(normalOffset * 0.7, modelSizeMax * 0.045);
              leaderDoglegLength = Math.max(normalOffset * 0.85, modelSizeMax * 0.055);
              leaderStemLength = Math.max(normalOffset * 0.88, modelSizeMax * 0.058);
              triangleHeight = Math.max(normalOffset * 0.28, modelSizeMax * 0.018);
              triangleHalfBase = triangleHeight / Math.sqrt(3);
              const stemDirection = getPerpendicularBadgeStemDirectionLocal(
                doglegDirection,
                radialDirection,
                cylinderAxis
              );
              offset.copy(radialDirection)
                .multiplyScalar(leaderRadialLength)
                .addScaledVector(doglegDirection, leaderDoglegLength)
                .addScaledVector(stemDirection, triangleHeight + leaderStemLength);
              leaderAxisLocal.copy(offset).normalize();
              leaderAxisLocal.copy(radialDirection);
              calloutKind = "cylindrical";
            } else {
              offset.copy(unitNormal.clone().multiplyScalar(normalOffset));
              leaderAxisLocal.copy(unitNormal);
              calloutKind = "planar";
            }

            const tangentCandidates = [
              { axis: new THREE.Vector3(1, 0, 0), size: faceSize.x },
              { axis: new THREE.Vector3(0, 1, 0), size: faceSize.y },
              { axis: new THREE.Vector3(0, 0, 1), size: faceSize.z },
            ]
              .map(({ axis, size }) => {
                const tangentReferenceNormal = isCylindricalDatum ? leaderAxisLocal : unitNormal;
                const projected = axis.clone().addScaledVector(tangentReferenceNormal, -axis.dot(tangentReferenceNormal));
                return { tangent: projected, score: projected.lengthSq() * Math.max(size, 1e-6) };
              })
              .filter(({ tangent }) => tangent.lengthSq() > 1e-8)
              .sort((a, b) => b.score - a.score);

            if (!isCylindricalDatum && tangentCandidates[0]) {
              leaderTangent.copy(tangentCandidates[0].tangent.normalize());
            }

            if (child instanceof THREE.Mesh) {
              const leaderEndLocal = localPoint.clone().add(offset);

              if (isCylindricalDatum) {
                const radialLeadEndLocal = localPoint.clone().addScaledVector(leaderAxisLocal, leaderRadialLength);
                const triangleBaseCenterLocal = radialLeadEndLocal.clone().addScaledVector(leaderTangent, leaderDoglegLength);
                const stemDirection = getPerpendicularBadgeStemDirectionLocal(
                  leaderTangent,
                  leaderAxisLocal,
                  cylinderAxis
                );
                triangleApexLocal = triangleBaseCenterLocal.clone().addScaledVector(stemDirection, triangleHeight);
                const badgeStemEndLocal = triangleApexLocal.clone().addScaledVector(stemDirection, leaderStemLength);
                const arrowDirection = localPoint.clone().sub(radialLeadEndLocal);
                if (arrowDirection.lengthSq() > 1e-8) {
                  arrowDirection.normalize();
                  arrowLength = normalOffset * 0.18;
                  arrowHalfWidth = arrowLength * 0.36;
                  const arrowBaseLocal = localPoint.clone().addScaledVector(arrowDirection, -arrowLength);
                  const arrowSide = leaderTangent.clone().addScaledVector(arrowDirection, -leaderTangent.dot(arrowDirection));
                  if (arrowSide.lengthSq() <= 1e-8) {
                    arrowSide.copy(unitNormal).addScaledVector(arrowDirection, -unitNormal.dot(arrowDirection));
                  }
                  arrowSide.normalize().multiplyScalar(arrowHalfWidth);

                  const shaftGeometry = new THREE.BufferGeometry().setFromPoints([
                    arrowBaseLocal.clone(),
                    radialLeadEndLocal.clone(),
                    triangleBaseCenterLocal.clone(),
                  ]);
                  const shaftMaterial = new THREE.LineBasicMaterial({
                    color: 0x1e293b,
                    depthTest: false,
                    depthWrite: false,
                    transparent: true,
                    opacity: 0.95,
                  });
                  arrowShaftObject = new THREE.Line(shaftGeometry, shaftMaterial);
                  arrowShaftObject.name = `DatumLeaderArrow-${d.id}-Shaft`;
                  arrowShaftObject.renderOrder = 30;
                  arrowShaftObject.raycast = () => undefined;
                  child.add(arrowShaftObject);

                  const trianglePoints = [
                    triangleBaseCenterLocal.clone().addScaledVector(leaderTangent, -triangleHalfBase),
                    triangleBaseCenterLocal.clone().addScaledVector(leaderTangent, triangleHalfBase),
                    triangleApexLocal.clone(),
                  ];
                  const triangleGeometry = new THREE.BufferGeometry().setFromPoints(trianglePoints);
                  const triangleMaterial = new THREE.LineBasicMaterial({
                    color: 0x1e293b,
                    depthTest: false,
                    depthWrite: false,
                    transparent: true,
                    opacity: 0.95,
                  });
                  triangleObject = new THREE.LineLoop(triangleGeometry, triangleMaterial);
                  triangleObject.name = `DatumLeaderTriangle-${d.id}`;
                  triangleObject.renderOrder = 30;
                  triangleObject.raycast = () => undefined;
                  child.add(triangleObject);

                  const leaderGeometry = new THREE.BufferGeometry().setFromPoints([
                    triangleApexLocal.clone(),
                    badgeStemEndLocal.clone(),
                  ]);
                  const leaderMaterial = new THREE.LineBasicMaterial({
                    color: 0x1e293b,
                    depthTest: false,
                    depthWrite: false,
                    transparent: true,
                    opacity: 0.95,
                  });
                  leaderObject = new THREE.Line(leaderGeometry, leaderMaterial);
                  leaderObject.name = `DatumLeaderLine-${d.id}`;
                  leaderObject.renderOrder = 30;
                  leaderObject.raycast = () => undefined;
                  child.add(leaderObject);

                  offset.copy(badgeStemEndLocal).sub(localPoint);

                  const arrowGeometry = new THREE.BufferGeometry().setFromPoints([
                    localPoint.clone(),
                    arrowBaseLocal.clone().add(arrowSide),
                    arrowBaseLocal.clone().sub(arrowSide),
                  ]);
                  const arrowMaterial = new THREE.MeshBasicMaterial({
                    color: 0x1e293b,
                    depthTest: false,
                    depthWrite: false,
                    transparent: true,
                    opacity: 0.95,
                    side: THREE.DoubleSide,
                  });
                  arrowHeadObject = new THREE.Mesh(arrowGeometry, arrowMaterial);
                  arrowHeadObject.name = `DatumLeaderArrow-${d.id}-Head`;
                  arrowHeadObject.renderOrder = 30;
                  arrowHeadObject.raycast = () => undefined;
                  child.add(arrowHeadObject);
                }
              } else {
                triangleHeight = normalOffset * 0.28;
                triangleHalfBase = triangleHeight / Math.sqrt(3);
                triangleApexLocal = localPoint.clone().addScaledVector(unitNormal, triangleHeight);
                const trianglePoints = [
                  localPoint.clone().addScaledVector(leaderTangent, -triangleHalfBase),
                  localPoint.clone().addScaledVector(leaderTangent, triangleHalfBase),
                  triangleApexLocal.clone(),
                ];
                const triangleGeometry = new THREE.BufferGeometry().setFromPoints(trianglePoints);
                const triangleMaterial = new THREE.LineBasicMaterial({
                  color: 0x1e293b,
                  depthTest: false,
                  depthWrite: false,
                  transparent: true,
                  opacity: 0.95,
                });
                triangleObject = new THREE.LineLoop(triangleGeometry, triangleMaterial);
                triangleObject.name = `DatumLeaderTriangle-${d.id}`;
                triangleObject.renderOrder = 30;
                triangleObject.raycast = () => undefined;
                child.add(triangleObject);

                if (leaderEndLocal.distanceToSquared(triangleApexLocal) > 1e-8) {
                  const leaderGeometry = new THREE.BufferGeometry().setFromPoints([
                    triangleApexLocal.clone(),
                    leaderEndLocal,
                  ]);
                  const leaderMaterial = new THREE.LineBasicMaterial({
                    color: 0x1e293b,
                    depthTest: false,
                    depthWrite: false,
                    transparent: true,
                    opacity: 0.95,
                  });
                  leaderObject = new THREE.Line(leaderGeometry, leaderMaterial);
                  leaderObject.name = `DatumLeaderLine-${d.id}`;
                  leaderObject.renderOrder = 30;
                  leaderObject.raycast = () => undefined;
                  child.add(leaderObject);
                }
              }
            }
          } else {
            const alphabetIndex = d.identifier ? (d.identifier.charCodeAt(0) - 65) : 0;
            if (alphabetIndex === 0) {
              offset.z = 0.3;
            } else if (alphabetIndex % 3 === 1) {
              offset.y = -0.25 + Math.floor(alphabetIndex / 3) * 0.08;
            } else if (alphabetIndex % 3 === 2) {
              offset.y = 0.25 + Math.floor(alphabetIndex / 3) * 0.08;
            } else {
              offset.z = -0.3 - Math.floor(alphabetIndex / 3) * 0.08;
            }
          }
        }

        return [{
          id: d.id,
          element,
          leaderElement,
          triangleElement,
          triangleObject,
          leaderObject,
          arrowShaftObject,
          arrowHeadObject,
          targetMarkObject,
          dimensionObject,
          object: anchorObject,
          localPoint,
          offset,
          dimensionStartLocal,
          dimensionEndLocal,
          dimensionTouchStartLocal,
          dimensionTouchEndLocal,
          dimensionExtensionLocal,
          triangleApexLocal,
          leaderTangent,
          leaderAxisLocal,
          calloutKind,
          triangleHeight,
          triangleHalfBase,
          arrowLength,
          arrowHalfWidth,
          leaderRadialLength,
          leaderDoglegLength,
          leaderStemLength,
          dimensionHalfLength,
          dimensionTickLength,
          targetMarkHalfSize,
          annotationKind: d.annotationKind,
          hasLeader,
        }];
      });
    };

    const updateDatumCalloutFacing = (anchor: (typeof datumAnchorCache)[number]) => {
      if (!anchor.calloutKind || !anchor.hasLeader) return;

      const leaderAxis = anchor.leaderAxisLocal.clone();
      if (leaderAxis.lengthSq() <= 1e-8) return;
      leaderAxis.normalize();

      const leaderEndLocal = anchor.localPoint.clone().add(anchor.offset);
      const cameraLocal = anchor.object.worldToLocal(camera.position.clone());
      const viewDirection = cameraLocal.sub(anchor.localPoint);
      if (viewDirection.lengthSq() <= 1e-8) return;
      viewDirection.normalize();

      const getViewFacingSide = (axis: THREE.Vector3, fallback: THREE.Vector3) => {
        const side = new THREE.Vector3().crossVectors(viewDirection, axis);
        if (side.lengthSq() <= 1e-8) {
          side.copy(fallback).addScaledVector(axis, -fallback.dot(axis));
        }
        if (side.lengthSq() <= 1e-8) {
          side.crossVectors(axis, new THREE.Vector3(1, 0, 0));
        }
        if (side.lengthSq() <= 1e-8) {
          side.crossVectors(axis, new THREE.Vector3(0, 1, 0));
        }
        return side.normalize();
      };

      const updateGeometryPoints = (geometry: THREE.BufferGeometry, points: THREE.Vector3[]) => {
        const position = geometry.getAttribute("position");
        if (position instanceof THREE.BufferAttribute && position.count === points.length) {
          points.forEach((point, index) => {
            position.setXYZ(index, point.x, point.y, point.z);
          });
          position.needsUpdate = true;
        } else {
          geometry.setFromPoints(points);
        }
        geometry.computeBoundingSphere();
      };

      if (anchor.calloutKind === "planar" && anchor.triangleObject && anchor.leaderObject) {
        const tangent = getViewFacingSide(leaderAxis, anchor.leaderTangent);
        const apexLocal = anchor.localPoint.clone().addScaledVector(leaderAxis, anchor.triangleHeight);
        const trianglePoints = [
          anchor.localPoint.clone().addScaledVector(tangent, -anchor.triangleHalfBase),
          anchor.localPoint.clone().addScaledVector(tangent, anchor.triangleHalfBase),
          apexLocal.clone(),
        ];
        updateGeometryPoints(anchor.triangleObject.geometry, trianglePoints);
        updateGeometryPoints(anchor.leaderObject.geometry, [apexLocal, leaderEndLocal]);
        anchor.triangleApexLocal?.copy(apexLocal);
        return;
      }

      if (anchor.calloutKind === "median") {
        return;
      }

      if (anchor.calloutKind === "cylindrical" && anchor.arrowShaftObject && anchor.arrowHeadObject) {
        const tangent = getBadgeEdgeDirectionLocal(anchor.object, leaderAxis, anchor.leaderTangent);
        const stemDirection = getPerpendicularBadgeStemDirectionLocal(
          tangent,
          leaderAxis,
          anchor.leaderTangent
        );

        const radialLeadEndLocal = anchor.localPoint.clone().addScaledVector(leaderAxis, anchor.leaderRadialLength);
        const triangleBaseCenterLocal = radialLeadEndLocal.clone().addScaledVector(tangent, anchor.leaderDoglegLength);
        const apexLocal = triangleBaseCenterLocal.clone().addScaledVector(stemDirection, anchor.triangleHeight);
        const badgeStemEndLocal = apexLocal.clone().addScaledVector(stemDirection, anchor.leaderStemLength);
        anchor.offset.copy(badgeStemEndLocal).sub(anchor.localPoint);
        const arrowDirection = anchor.localPoint.clone().sub(radialLeadEndLocal);
        if (arrowDirection.lengthSq() <= 1e-8) return;
        arrowDirection.normalize();

        const arrowSide = tangent.clone().addScaledVector(arrowDirection, -tangent.dot(arrowDirection));
        if (arrowSide.lengthSq() <= 1e-8) {
          arrowSide.copy(getViewFacingSide(arrowDirection, tangent));
        } else {
          arrowSide.normalize();
        }
        arrowSide.multiplyScalar(anchor.arrowHalfWidth);
        const arrowBaseLocal = anchor.localPoint.clone().addScaledVector(arrowDirection, -anchor.arrowLength);

        updateGeometryPoints(anchor.arrowShaftObject.geometry, [
          arrowBaseLocal,
          radialLeadEndLocal,
          triangleBaseCenterLocal,
        ]);
        updateGeometryPoints(anchor.arrowHeadObject.geometry, [
          anchor.localPoint.clone(),
          arrowBaseLocal.clone().add(arrowSide),
          arrowBaseLocal.clone().sub(arrowSide),
        ]);

        if (anchor.triangleObject) {
          updateGeometryPoints(anchor.triangleObject.geometry, [
            triangleBaseCenterLocal.clone().addScaledVector(tangent, -anchor.triangleHalfBase),
            triangleBaseCenterLocal.clone().addScaledVector(tangent, anchor.triangleHalfBase),
            apexLocal.clone(),
          ]);
          anchor.triangleApexLocal?.copy(apexLocal);
        }

        if (anchor.leaderObject) {
          updateGeometryPoints(anchor.leaderObject.geometry, [apexLocal, badgeStemEndLocal]);
        }
      }

      if (
        (
          anchor.calloutKind === "targetPoint" ||
          anchor.calloutKind === "targetZone" ||
          anchor.calloutKind === "targetLine" ||
          anchor.calloutKind === "targetCircle" ||
          anchor.calloutKind === "targetCurve"
        ) &&
        anchor.arrowShaftObject &&
        anchor.arrowHeadObject
      ) {
        const arrowDirection = anchor.localPoint.clone().sub(leaderEndLocal);
        if (arrowDirection.lengthSq() <= 1e-8) return;
        arrowDirection.normalize();

        const arrowSide = getViewFacingSide(arrowDirection, anchor.leaderTangent).multiplyScalar(anchor.arrowHalfWidth);
        const arrowBaseLocal = anchor.localPoint.clone().addScaledVector(arrowDirection, -anchor.arrowLength);

        updateGeometryPoints(anchor.arrowShaftObject.geometry, [leaderEndLocal, arrowBaseLocal]);
        updateGeometryPoints(anchor.arrowHeadObject.geometry, [
          anchor.localPoint.clone(),
          arrowBaseLocal.clone().add(arrowSide),
          arrowBaseLocal.clone().sub(arrowSide),
        ]);

        if (anchor.calloutKind === "targetPoint" && anchor.targetMarkObject) {
          const markTangent = getViewFacingSide(leaderAxis, anchor.leaderTangent);
          const markSecond = new THREE.Vector3().crossVectors(leaderAxis, markTangent).normalize();
          updateGeometryPoints(anchor.targetMarkObject.geometry, [
            anchor.localPoint.clone().addScaledVector(markTangent, -anchor.targetMarkHalfSize).addScaledVector(markSecond, -anchor.targetMarkHalfSize),
            anchor.localPoint.clone().addScaledVector(markTangent, anchor.targetMarkHalfSize).addScaledVector(markSecond, anchor.targetMarkHalfSize),
            anchor.localPoint.clone().addScaledVector(markTangent, -anchor.targetMarkHalfSize).addScaledVector(markSecond, anchor.targetMarkHalfSize),
            anchor.localPoint.clone().addScaledVector(markTangent, anchor.targetMarkHalfSize).addScaledVector(markSecond, -anchor.targetMarkHalfSize),
          ]);
        }
      }
    };

    datumClickHandlerRef.current = (datum: any) => {
      const webglNames = mapDatumTargetsToWebGLNames(datum);
      const webglName = webglNames[0] || mapTargetToWebGLName(datum.targetId, datum.identifier);
      if (!webglName) return;

      const obj = assemblyGroup.getObjectByName(webglName);
      if (!obj) return;

      const type = obj.name.startsWith("BRepFace-") ? "face" : "edge";
      const idx = obj.userData.index;

      // Get local geometry center 
      const geom = (obj as THREE.Mesh | THREE.LineSegments).geometry;
      if (!geom.boundingBox) {
        geom.computeBoundingBox();
      }
      const localCenter = new THREE.Vector3();
      geom.boundingBox!.getCenter(localCenter);
      const datumRenderKind = getDatumRenderKindForFaces(datum, webglNames);
      const isDatumDimensionSelection =
        (datumRenderKind === "twoFaceDimension" || datumRenderKind === "medianPlane") &&
        webglNames.length > 1;
      const dimensionSelectionPoints = isDatumDimensionSelection
        ? webglNames
          .map((name) => assemblyGroup.getObjectByName(name))
          .filter((faceObject): faceObject is THREE.Object3D => !!faceObject)
          .map((faceObject) => {
            const localAnchor = getStableSurfacePoint(faceObject);
            return assemblyGroup.worldToLocal(faceObject.localToWorld(localAnchor.clone()));
          })
        : [];
      const dimensionSelectionPoint = dimensionSelectionPoints.length > 0
        ? dimensionSelectionPoints.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / dimensionSelectionPoints.length)
        : null;

      let blockDetails: any = {
        id: isDatumDimensionSelection ? `Datum-${datum.identifier}-Dimension` : obj.name,
        type: isDatumDimensionSelection ? "datum" : type,
        index: idx,
        name: datumRenderKind === "twoFaceDimension" && webglNames.length > 1
          ? `Datum ${datum.identifier} dimensional location (${webglNames.length} faces)`
          : datumRenderKind === "medianPlane" && webglNames.length > 1
          ? `Datum ${datum.identifier} median plane (${webglNames.length} faces)`
          : webglNames.length > 1
          ? `Datum ${datum.identifier} pattern (${webglNames.length} faces)`
          : type === "face" ? `B-Rep Face #${idx + 1}` : `B-Rep Edge #${idx + 1}`,
        datumIdentifier: datum.identifier,
        datumKind: datumRenderKind,
        relatedFaces: webglNames,
        point: {
          x: parseFloat((dimensionSelectionPoint?.x ?? localCenter.x).toFixed(2)),
          y: parseFloat((dimensionSelectionPoint?.y ?? localCenter.y).toFixed(2)),
          z: parseFloat((dimensionSelectionPoint?.z ?? localCenter.z).toFixed(2)),
        }
      };

      if (isDatumDimensionSelection) {
        blockDetails.referenceFaces = webglNames;
      } else if (type === "face") {
        blockDetails.triangles = obj.userData.triangles;
        blockDetails.colorString = obj.userData.color;
        blockDetails.area = obj.userData.area || 14.28;
      } else {
        blockDetails.length = 4.5;
      }

      const isCylindricalDatum = /cylind|hole wall|bore/i.test(`${datum.type || ""} ${datum.targetName || ""}`);
      focusCameraOnFeature(obj, isCylindricalDatum);
      onSelectEntity(blockDetails);
    };

    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("mouseleave", handleMouseLeave);
    canvas.addEventListener("click", handleMouseClick);

    const releaseFocusedDatumOrbit = () => {
      if (!focusedDatumOrbit) return;
      cameraFocusTarget = null;
      controls.target.copy(modelOrbitTarget);
      controls.update();
      focusedDatumOrbit = false;
    };

    const handleControlsStart = () => {
      isNavigatingView = true;
      pendingMouseEvent = null;
      clearHoverState();
      releaseFocusedDatumOrbit();
      requestRenderRef.current?.(60);
    };

    const handleControlsEnd = () => {
      isNavigatingView = false;
      if (pointerMovedSinceDown) {
        suppressMeasurementUntil = performance.now() + 180;
      }
      requestRenderRef.current?.(24);
    };

    const handleControlsChange = () => {
      requestRenderRef.current?.(12);
    };

    controls.addEventListener("start", handleControlsStart);
    controls.addEventListener("change", handleControlsChange);
    controls.addEventListener("end", handleControlsEnd);

    // Dynamic cache keys trackers
    let prevResToken = "";
    let prevViewMode = "";
    let prevOverlay = false;
    let prevMat = "";
    let prevDatumDatumsRef: any[] | null = null;
    let prevDatumTargetsRef: any[] | null = null;
    let prevDatumReferenceFramesRef: any[] | null = null;
    let prevDatumMappingRef: Record<string, string> | null = null;
    let prevDatumSceneFaces = -1;
    let prevFocusRequestNonce = -1;
    const projectedDatumPoint = new THREE.Vector3();

    let animationFrameId: number | null = null;
    let requestedContinuationFrames = 0;
    const requestRender = (frames = 1) => {
      requestedContinuationFrames = Math.max(requestedContinuationFrames, frames);
      if (animationFrameId === null) {
        animationFrameId = requestAnimationFrame(animationLoop);
      }
    };
    requestRenderRef.current = requestRender;

    const animationLoop = () => {
      animationFrameId = null;
      requestedContinuationFrames = Math.max(0, requestedContinuationFrames - 1);

      // Dampened rotation controls update
      const controlsChanged = controls.update();

      const { viewMode: vMode, wireframeOverlay: wOverlay, materialType: mType, autoRotate: spinOn } = propsRef.current;

      if (spinOn) {
        assemblyGroup.rotation.y += 0.003;
        updateFloorGridPosition();
      }

      if (cameraFocusTarget) {
        const t = THREE.MathUtils.clamp(
          (performance.now() - cameraFocusTarget.startedAt) / cameraFocusTarget.durationMs,
          0,
          1
        );
        const eased = 1 - Math.pow(1 - t, 3);

        camera.position.lerpVectors(cameraFocusTarget.fromPosition, cameraFocusTarget.position, eased);
        controls.target.lerpVectors(cameraFocusTarget.fromTarget, cameraFocusTarget.target, eased);
        if (cameraFocusTarget.up) {
          camera.up.lerpVectors(cameraFocusTarget.fromUp, cameraFocusTarget.up, eased).normalize();
        }
        controls.update();

        if (t >= 1) {
          camera.position.copy(cameraFocusTarget.position);
          controls.target.copy(cameraFocusTarget.target);
          if (cameraFocusTarget.up) {
            camera.up.copy(cameraFocusTarget.up);
          }
          controls.update();
          cameraFocusTarget = null;
        }
      }

      const activeToken = occtResult ? (occtResult.meshes ? occtResult.meshes.length : 0) + "-" + (occtResult.lines ? occtResult.lines.length : 0) : "";
      const isNewModel = activeToken !== prevResToken;
      const currentMeasurementMode = propsRef.current.measurementMode;
      if (currentMeasurementMode !== prevMeasurementMode) {
        prevMeasurementMode = currentMeasurementMode;
        measurementPoints = [];
        disposeMeasurementGroup();
        disposePreviousMeasurementGroup();
      }

      if (
        isNewModel ||
        vMode !== prevViewMode ||
        wOverlay !== prevOverlay ||
        mType !== prevMat
      ) {
        measurementPoints = [];
        disposeMeasurementGroup();
        disposePreviousMeasurementGroup();
        rebuildSceneTopology(isNewModel);
        prevResToken = activeToken;
        prevViewMode = vMode;
        prevOverlay = wOverlay;
        prevMat = mType;
        prevHighlightToken = "";
        previousHighlightNames = new Set();
        prevDatumDatumsRef = null;
        prevDatumTargetsRef = null;
        prevDatumReferenceFramesRef = null;
        prevDatumMappingRef = null;
        prevDatumSceneFaces = -1;
      }

      const highlightToken = getHighlightToken();
      if (highlightToken !== prevHighlightToken) {
        updateHighlightStyles();
        prevHighlightToken = highlightToken;
      }

      const focusRequest = propsRef.current.focusEntityRequest;
      if (focusRequest && focusRequest.nonce !== prevFocusRequestNonce) {
        const focusObj = assemblyGroup.getObjectByName(focusRequest.id);
        if (focusObj) {
          focusCameraOnFeature(focusObj, !!focusRequest.preferAxisView);
          prevFocusRequestNonce = focusRequest.nonce;
        }
      }

      // Badge projection must use the same camera/object matrices as this render.
      // Three refreshes these during render, so update them here before converting
      // GL coordinates to overlay pixels.
      camera.updateMatrixWorld(true);
      assemblyGroup.updateMatrixWorld(true);

      if (orientationCubeRef.current) {
        const cameraDirection = camera.position.clone().sub(controls.target).normalize();
        const yaw = Math.atan2(cameraDirection.x, cameraDirection.z);
        const pitch = Math.asin(THREE.MathUtils.clamp(cameraDirection.y, -1, 1));
        orientationCubeRef.current.style.transform = `rotateX(${pitch}rad) rotateY(${-yaw}rad)`;
      }

      // 3D Projected Annotations update (Reference Datums overlay)
      const currentDatumsRef = propsRef.current.datums || [];
      const currentDatumTargetsRef = propsRef.current.datumTargets || [];
      const currentDatumReferenceFramesRef = propsRef.current.datumReferenceFrames || [];
      const currentMappingRef = propsRef.current.customFaceMapping || {};
      const datumAnchorInputsChanged =
        currentDatumsRef !== prevDatumDatumsRef ||
        currentDatumTargetsRef !== prevDatumTargetsRef ||
        currentDatumReferenceFramesRef !== prevDatumReferenceFramesRef ||
        currentMappingRef !== prevDatumMappingRef ||
        assemblyGroup.children.length !== prevDatumSceneFaces;

      if (datumAnchorInputsChanged) {
        refreshDatumAnchorCache();
        prevDatumDatumsRef = currentDatumsRef;
        prevDatumTargetsRef = currentDatumTargetsRef;
        prevDatumReferenceFramesRef = currentDatumReferenceFramesRef;
        prevDatumMappingRef = currentMappingRef;
        prevDatumSceneFaces = assemblyGroup.children.length;
        datumCacheRetryFrame = 0;
      } else if (datumCacheMissingElements > 0 && datumCacheRetryFrame < 12) {
        datumCacheRetryFrame++;
        refreshDatumAnchorCache();
      }

      if (datumAnchorCache.length > 0) {
        const width = renderer.domElement.clientWidth;
        const height = renderer.domElement.clientHeight;
        datumAnchorCache.forEach((anchor) => {
          updateDatumCalloutFacing(anchor);

          projectedDatumPoint.copy(anchor.localPoint).add(anchor.offset);
          anchor.object.localToWorld(projectedDatumPoint);
          projectedDatumPoint.project(camera);

          const rawX = (projectedDatumPoint.x * 0.5 + 0.5) * width;
          const rawY = (projectedDatumPoint.y * -0.5 + 0.5) * height;
          if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) {
            anchor.element.style.display = "none";
            if (anchor.leaderElement) anchor.leaderElement.style.display = "none";
            if (anchor.triangleElement) anchor.triangleElement.style.display = "none";
            return;
          }

          if (
            anchor.annotationKind === "datumTarget" &&
            (projectedDatumPoint.z < -1 || projectedDatumPoint.z > 1)
          ) {
            anchor.element.style.display = "none";
            if (anchor.leaderElement) anchor.leaderElement.style.display = "none";
            if (anchor.triangleElement) anchor.triangleElement.style.display = "none";
            return;
          }

          if (
            anchor.annotationKind !== "datumTarget" &&
            (projectedDatumPoint.z < -1 || projectedDatumPoint.z > 1)
          ) {
            anchor.element.style.display = "none";
            if (anchor.leaderElement) anchor.leaderElement.style.display = "none";
            if (anchor.triangleElement) anchor.triangleElement.style.display = "none";
            return;
          }

          const x = anchor.annotationKind === "datumTarget"
            ? THREE.MathUtils.clamp(rawX, 24, Math.max(24, width - 24))
            : rawX;
          const y = anchor.annotationKind === "datumTarget"
            ? THREE.MathUtils.clamp(rawY, 24, Math.max(24, height - 24))
            : rawY;

          const anchorTransform = anchor.annotationKind === "datumTarget"
            ? "translate(-50%, -50%)"
            : "translate(-50%, -100%)";
          anchor.element.style.transform = `translate3d(${x}px, ${y}px, 0) ${anchorTransform}`;
          anchor.element.style.display = "flex";
          anchor.element.style.opacity = "1";
          anchor.element.style.zIndex = "20";

          if (anchor.leaderElement) anchor.leaderElement.style.display = "none";
          if (anchor.triangleElement) anchor.triangleElement.style.display = "none";
        });
      }

      if (measurementLabelRef.current && measurementLabelPoint) {
        projectedDatumPoint.copy(measurementLabelPoint);
        assemblyGroup.localToWorld(projectedDatumPoint);
        projectedDatumPoint.project(camera);

        const width = renderer.domElement.clientWidth;
        const height = renderer.domElement.clientHeight;
        const rawX = (projectedDatumPoint.x * 0.5 + 0.5) * width;
        const rawY = (projectedDatumPoint.y * -0.5 + 0.5) * height;
        if (
          Number.isFinite(rawX) &&
          Number.isFinite(rawY) &&
          projectedDatumPoint.z >= -1 &&
          projectedDatumPoint.z <= 1
        ) {
          measurementLabelRef.current.style.display = "block";
          measurementLabelRef.current.style.transform = `translate3d(${rawX}px, ${rawY}px, 0) translate(-50%, -50%)`;
        } else {
          measurementLabelRef.current.style.display = "none";
        }
      } else if (measurementLabelRef.current) {
        measurementLabelRef.current.style.display = "none";
      }

      renderer.render(scene, camera);

      const keepRendering =
        spinOn ||
        isNavigatingView ||
        !!cameraFocusTarget ||
        controlsChanged ||
        requestedContinuationFrames > 0 ||
        (datumCacheMissingElements > 0 && datumCacheRetryFrame < 12);

      if (keepRendering) {
        requestRender(1);
      }
    };

    requestRender(2);

    // Release GPU materials and event handlers cleanly
    return () => {
      requestRenderRef.current = null;
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
      if (mouseMoveFrameId !== null) {
        cancelAnimationFrame(mouseMoveFrameId);
      }
      if (hoverRaycastTimeoutId !== null) {
        window.clearTimeout(hoverRaycastTimeoutId);
      }
      if (hoverNotifyTimeoutId !== null) {
        window.clearTimeout(hoverNotifyTimeoutId);
      }
      resizeObserver.disconnect();
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
      canvas.removeEventListener("click", handleMouseClick);
      controls.removeEventListener("start", handleControlsStart);
      controls.removeEventListener("change", handleControlsChange);
      controls.removeEventListener("end", handleControlsEnd);
      controls.dispose();
      disposeMeasurementGroup();
      disposePreviousMeasurementGroup();
      renderer.dispose();
      orientationViewHandlerRef.current = null;
      partRollHandlerRef.current = null;
    };
  }, [occtResult]);

  const orientationFaces = [
    { label: "Front", title: "Front view", direction: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0), transform: "translateZ(24px)" },
    { label: "Back", title: "Back view", direction: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0), transform: "rotateY(180deg) translateZ(24px)" },
    { label: "Right", title: "Right view", direction: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0), transform: "rotateY(90deg) translateZ(24px)" },
    { label: "Left", title: "Left view", direction: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0), transform: "rotateY(-90deg) translateZ(24px)" },
    { label: "Top", title: "Top view", direction: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(0, 0, -1), transform: "rotateX(90deg) translateZ(24px)" },
    { label: "Bottom", title: "Bottom view", direction: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, 1), transform: "rotateX(-90deg) translateZ(24px)" },
  ];

  return (
    <div className="relative w-full h-full bg-slate-50 rounded-2xl overflow-hidden border border-slate-200 flex flex-col" ref={containerRef}>
      
      {/* Three.JS CAD Canvas */}
      <canvas
        ref={canvasRef}
        className="block w-full h-full active:cursor-grabbing"
        id="cad_viewport_canvas"
        style={{
          cursor: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='25' height='25' viewBox='0 0 25 25'%3E%3Cpath d='M12 1v23M1 12h23' stroke='black' stroke-width='1' stroke-linecap='square'/%3E%3Ccircle cx='12' cy='12' r='3' fill='none' stroke='black' stroke-width='1'/%3E%3C/svg%3E") 12 12, crosshair`,
        }}
      />

      {/* 3D Datums Overlay */}
      {(datums.length > 0 || datumTargets.length > 0) && (
        <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden" id="datum-annotations-overlay" style={{ width: '100%', height: '100%' }}>
          {[
            ...datums.filter((d) => d.type !== "Datum Target Set").map((d) => ({ ...d, annotationKind: "datum" })),
            ...datumTargets.map((d) => ({ ...d, annotationKind: "datumTarget" })),
          ].map((d) => (
            <div key={d.id}>
              <div
                id={`3d-datum-leader-${d.id}`}
                style={{
                  position: "absolute",
                  left: "0px",
                  top: "0px",
                  height: "1.5px",
                  width: "0px",
                  transformOrigin: "0 50%",
                  willChange: "transform, width",
                  display: "none",
                }}
                className="pointer-events-none rounded-full bg-slate-800/80 shadow-[0_0_0_1px_rgba(255,255,255,0.8)]"
              />
              <svg
                id={`3d-datum-triangle-${d.id}`}
                viewBox="0 0 1 1"
                style={{
                  position: "absolute",
                  left: "0px",
                  top: "0px",
                  width: "100%",
                  height: "100%",
                  willChange: "transform",
                  display: "none",
                }}
                className="pointer-events-none overflow-visible drop-shadow-[0_0_1px_rgba(255,255,255,0.9)]"
              >
                <polygon
                  points="0,0 0,0 0,0"
                  fill="none"
                  stroke="rgb(30 41 59)"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
              </svg>
              <button
                id={`3d-datum-badge-${d.id}`}
                style={{
                  position: "absolute",
                  left: "0px",
                  top: "0px",
                  transform: "translate3d(0, 0, 0) translate(-50%, -100%)",
                  willChange: "transform",
                  display: "none",
                }}
                onClick={() => {
                  datumClickHandlerRef.current?.(d);
                }}
                title={`${d.name}: ${d.type}`}
                className={`pointer-events-auto relative flex items-center justify-center bg-white font-mono font-black shadow-md cursor-pointer select-none shrink-0 ${
                  d.annotationKind === "datumTarget"
                    ? "h-8 w-8 min-w-8 overflow-hidden rounded-full border-2 border-emerald-700 p-0 text-emerald-800 hover:border-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
                    : "h-6 min-w-7 rounded-none border-2 border-slate-800 px-1.5 text-[10.5px] text-slate-800 hover:border-blue-600 hover:bg-blue-50 hover:text-blue-700"
                }`}
              >
                {d.annotationKind === "datumTarget" ? (
                  <>
                    <span className="absolute left-0 right-0 top-1/2 h-0.5 -translate-y-1/2 bg-emerald-700" />
                    <span className="absolute bottom-[3px] left-0 right-0 flex justify-center text-[9.5px] font-black leading-none text-emerald-800">
                      {d.identifier}
                    </span>
                  </>
                ) : (
                  <span className="text-[11px] font-black leading-none text-slate-800">
                    {d.identifier}
                  </span>
                )}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Triangulating loading screen */}
      {isLoading && (
        <div className="absolute inset-0 bg-white/90 backdrop-blur-sm flex flex-col items-center justify-center gap-4 z-20">
          <div className="relative">
            <div className="w-14 h-14 rounded-full border-4 border-blue-100 border-t-blue-600 animate-spin" />
            <Orbit className="w-5 h-5 text-blue-600 absolute inset-0 m-auto animate-pulse" />
          </div>
          <div className="text-center">
            <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest font-mono">Tessellating Mesh...</h4>
            <p className="text-[10px] text-slate-500 mt-1 font-mono">Converting analytical STEP topology in WebAssembly...</p>
          </div>
        </div>
      )}

      {/* View cube and in-plane part roll */}
      <div className="absolute top-4 right-4 z-30 hidden sm:flex flex-col items-center gap-2 select-none">
        <div
          className="relative h-20 w-20"
          style={{ perspective: "420px" }}
          aria-label="View orientation cube"
        >
          <div
            ref={orientationCubeRef}
            className="absolute left-4 top-4 h-12 w-12"
            style={{ transformStyle: "preserve-3d" }}
          >
            {orientationFaces.map((face) => (
              <button
                key={face.title}
                type="button"
                title={face.title}
                aria-label={face.title}
                onClick={() => orientationViewHandlerRef.current?.(face.direction, face.up)}
                className="absolute flex h-12 w-12 items-center justify-center border border-slate-300 bg-white/90 px-0.5 text-[8px] font-black text-slate-700 shadow-sm hover:border-blue-500 hover:bg-blue-50 hover:text-blue-700"
                style={{
                  transform: face.transform,
                  backfaceVisibility: "hidden",
                }}
              >
                {face.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-1 rounded-md border border-slate-200 bg-white/90 p-1 shadow-md backdrop-blur-sm">
          <button
            type="button"
            title="Rotate part counterclockwise 45 degrees in the current view"
            aria-label="Rotate part counterclockwise 45 degrees in the current view"
            onClick={() => partRollHandlerRef.current?.(Math.PI / 4)}
            className="h-6 w-8 rounded border border-slate-200 bg-slate-50 text-[10px] font-black text-slate-600 hover:border-blue-500 hover:bg-blue-50 hover:text-blue-700"
          >
            CCW
          </button>
          <button
            type="button"
            title="Rotate part clockwise 45 degrees in the current view"
            aria-label="Rotate part clockwise 45 degrees in the current view"
            onClick={() => partRollHandlerRef.current?.(-Math.PI / 4)}
            className="h-6 w-8 rounded border border-slate-200 bg-slate-50 text-[10px] font-black text-slate-600 hover:border-blue-500 hover:bg-blue-50 hover:text-blue-700"
          >
            CW
          </button>
        </div>
      </div>

      {/* Floating viewport details overlay */}
      {showBrepOverlays && modelStats && (
        <div className="hidden sm:block absolute top-4 left-4 bg-white/95 backdrop-blur-md px-3.5 py-2.5 rounded-xl border border-slate-200 shadow-lg pointer-events-none select-none max-w-[210px]">
          <div className="text-[9px] font-black text-blue-600 tracking-wider uppercase flex items-center gap-1.5 font-mono">
            <Sparkles className="w-3.5 h-3.5 animate-pulse" />
            B-Rep Discretization Specs
          </div>
          
          <div className="mt-2 space-y-1 text-[10px] font-mono text-slate-600">
            <div className="flex justify-between border-b border-slate-100 pb-0.5">
              <span>Bounding Size:</span>
              <span className="text-slate-900 font-bold">{modelStats.width}×{modelStats.depth}×{modelStats.height} mm</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-0.5">
              <span>Selected Faces:</span>
              <span className="text-blue-600 font-bold">{modelStats.meshes} faces</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-0.5">
              <span>Selected Edges:</span>
              <span className="text-blue-600 font-bold">{modelStats.edges} edges</span>
            </div>
            <div className="flex justify-between">
              <span>Tessellated Tris:</span>
              <span className="text-slate-900 font-bold">{modelStats.triangles.toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      {/* Floating Hover Coordinates Probe */}
      {showBrepOverlays && hoveredCoordinate && (
        <div className="absolute bottom-3 sm:bottom-4 left-3 sm:left-4 right-3 sm:right-4 pointer-events-none bg-white/95 backdrop-blur-md px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg border border-slate-200 flex items-center justify-between text-[10px] sm:text-[11px] font-mono shadow-md">
          <div className="flex items-center gap-1 sm:gap-1.5 text-slate-800">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-ping" />
            <span className="text-slate-500 font-bold font-sans hidden xs:inline">Tactile Probe_</span>
            <span>X: {hoveredCoordinate.x} • Y: {hoveredCoordinate.y} • Z: {hoveredCoordinate.z}</span>
          </div>
          <span className="text-[7.5px] sm:text-[8px] text-blue-600 font-bold tracking-widest uppercase">
            3D RAYCASTING
          </span>
        </div>
      )}

      {measurementLabel && (
        <div
          ref={measurementLabelRef}
          className="absolute left-0 top-0 hidden pointer-events-none rounded border border-emerald-700 bg-white px-2 py-1 text-[10px] font-black font-mono text-emerald-800 shadow-md"
        >
          {measurementLabel.text}
        </div>
      )}

    </div>
  );
}

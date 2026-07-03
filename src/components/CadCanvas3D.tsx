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
  faceRecords?: { id: string; referencedIds: string[] }[];
  cylinderIds?: string[];
  customFaceMapping?: Record<string, string>;
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
  faceRecords = [],
  cylinderIds = [],
  customFaceMapping = {},
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
  const propsRef = useRef({ viewMode, wireframeOverlay, materialType, autoRotate, selectedEntityId, selectedRelatedEntityIds, hoveredEntityId, focusEntityRequest, measurementMode, selectionClickEnabled, datums, datumTargets, faceRecords, cylinderIds, customFaceMapping });
  useEffect(() => {
    propsRef.current = { viewMode, wireframeOverlay, materialType, autoRotate, selectedEntityId, selectedRelatedEntityIds, hoveredEntityId, focusEntityRequest, measurementMode, selectionClickEnabled, datums, datumTargets, faceRecords, cylinderIds, customFaceMapping };
    requestRenderRef.current?.(4);
  }, [viewMode, wireframeOverlay, materialType, autoRotate, selectedEntityId, selectedRelatedEntityIds, hoveredEntityId, focusEntityRequest, measurementMode, selectionClickEnabled, datums, datumTargets, faceRecords, cylinderIds, customFaceMapping]);

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
      arrowHeadObject: THREE.Mesh | null;
      targetMarkObject: THREE.Line | THREE.LineSegments | null;
      dimensionObject: THREE.LineSegments | null;
      object: THREE.Object3D;
      localPoint: THREE.Vector3;
      offset: THREE.Vector3;
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

    const mapDatumTargetsToWebGLNames = (datum: any): string[] => {
      const targetIds = Array.isArray(datum.targetIds) && datum.targetIds.length > 0
        ? datum.targetIds
        : (datum.targetId ? [datum.targetId] : []);
      return targetIds
        .map((targetId: string) => mapTargetToWebGLName(targetId, datum.identifier, false))
        .filter((name: string | null): name is string => !!name)
        .filter((name: string, index: number, all: string[]) => all.indexOf(name) === index);
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
          item.name.startsWith("DatumTargetCurveMark-")
        );
        staleLeaderGeometry.forEach((item) => {
          child.remove(item);
          if (item instanceof THREE.Line || item instanceof THREE.LineSegments || item instanceof THREE.Mesh) {
            item.geometry.dispose();
            if (Array.isArray(item.material)) {
              item.material.forEach((material) => material.dispose());
            } else {
              item.material.dispose();
            }
          }
        });
      });
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
        const isSemanticMedianDatum = d.annotationKind !== "datumTarget" &&
          (d.derivedDatum === "medianPlane" || /feature-of-size|median plane|opposed planar faces/i.test(datumTargetText));
        let isMedianDatum = isSemanticMedianDatum && webglNames.length >= 2;
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
        let arrowHeadObject: THREE.Mesh | null = null;
        let targetMarkObject: THREE.Line | THREE.LineSegments | null = null;
        let dimensionObject: THREE.LineSegments | null = null;
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
          const faceObjects = webglNames
            .map((name) => assemblyGroup.getObjectByName(name))
            .filter((obj): obj is THREE.Object3D => !!obj && obj.name.startsWith("BRepFace-"))
            .slice(0, 2);

          if (faceObjects.length >= 2) {
            anchorObject = assemblyGroup;
            const facePoints = faceObjects.map((faceObject) => {
              const localAnchor = getStableSurfacePoint(faceObject);
              const worldAnchor = faceObject.localToWorld(localAnchor.clone());
              return assemblyGroup.worldToLocal(worldAnchor);
            });
            const firstPoint = facePoints[0];
            const secondPoint = facePoints[1];
            const dimensionAxis = secondPoint.clone().sub(firstPoint);
            if (dimensionAxis.lengthSq() > 1e-8) {
              dimensionHalfLength = dimensionAxis.length() * 0.5;
              dimensionAxis.normalize();
              localPoint.copy(firstPoint).add(secondPoint).multiplyScalar(0.5);

              const leaderDirection = getCanonicalLeaderDirection(dimensionAxis, localPoint);

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

              const dimensionStartLocal = localPoint.clone().addScaledVector(dimensionAxis, -dimensionHalfLength);
              const dimensionEndLocal = localPoint.clone().addScaledVector(dimensionAxis, dimensionHalfLength);
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

      let blockDetails: any = {
        id: obj.name,
        type,
        index: idx,
        name: webglNames.length > 1
          ? `Datum ${datum.identifier} pattern (${webglNames.length} faces)`
          : type === "face" ? `B-Rep Face #${idx + 1}` : `B-Rep Edge #${idx + 1}`,
        relatedFaces: webglNames,
        point: {
          x: parseFloat(localCenter.x.toFixed(2)),
          y: parseFloat(localCenter.y.toFixed(2)),
          z: parseFloat(localCenter.z.toFixed(2)),
        }
      };

      if (type === "face") {
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
      const currentMappingRef = propsRef.current.customFaceMapping || {};
      const datumAnchorInputsChanged =
        currentDatumsRef !== prevDatumDatumsRef ||
        currentDatumTargetsRef !== prevDatumTargetsRef ||
        currentMappingRef !== prevDatumMappingRef ||
        assemblyGroup.children.length !== prevDatumSceneFaces;

      if (datumAnchorInputsChanged) {
        refreshDatumAnchorCache();
        prevDatumDatumsRef = currentDatumsRef;
        prevDatumTargetsRef = currentDatumTargetsRef;
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
      {modelStats && (
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
      {hoveredCoordinate && (
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

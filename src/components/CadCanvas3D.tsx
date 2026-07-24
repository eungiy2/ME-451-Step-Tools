import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree, SAH } from "three-mesh-bvh";
import { Orbit, Sparkles } from "lucide-react";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
(THREE.Mesh.prototype as any).raycast = acceleratedRaycast;

interface CadCanvas3DProps {
  occtResult: any;
  isLoading: boolean;
  viewMode: "solid" | "xray";
  cameraProjection: "perspective" | "orthographic";
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
  showDatumFeatures?: boolean;
  showDatumTargets?: boolean;
  showDatumReferenceFrames?: boolean;
  showDimensionalTolerances?: boolean;
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
  kind: "face" | "edge" | "vertex" | "cylinder";
  objectName: string;
  normal?: THREE.Vector3;
  planeConstant?: number;
  circle?: MeasurementCircleSnap;
};

type BRepVertexRecord = {
  id: string;
  index: number;
  point: { x: number; y: number; z: number };
  edgeIds: string[];
  parentFaceIndices: number[];
  parentFaceIds: string[];
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

type MeasurementFrameBasis = {
  xAxis: THREE.Vector3;
  yAxis: THREE.Vector3;
  zAxis: THREE.Vector3;
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
  cameraProjection,
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
  showDatumFeatures = true,
  showDatumTargets = true,
  showDatumReferenceFrames = true,
  showDimensionalTolerances = true,
}: CadCanvas3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const measurementLabelRef = useRef<HTMLDivElement>(null);
  const datumClickHandlerRef = useRef<((datum: any) => void) | null>(null);
  const orientationCubeRef = useRef<HTMLDivElement>(null);
  const orientationViewHandlerRef = useRef<((direction: THREE.Vector3, up?: THREE.Vector3) => void) | null>(null);
  const partRollHandlerRef = useRef<((angle: number) => void) | null>(null);
  const requestRenderRef = useRef<((frames?: number) => void) | null>(null);
  const dimensionOverlayVisibilityRefreshRef = useRef<(() => void) | null>(null);
  const prevShowDimensionalTolerancesPropRef = useRef(showDimensionalTolerances);

  // Tracker for dynamic coordinates info
  const [hoveredCoordinate, setHoveredCoordinate] = useState<{ x: number; y: number; z: number } | null>(null);
  const [modelStats, setModelStats] = useState<{ width: number; height: number; depth: number; triangles: number; meshes: number; edges: number } | null>(null);
  const [measurementLabel, setMeasurementLabel] = useState<MeasurementLabelState | null>(null);

  // Capture fast-updating props in a ref for animation loops
  const propsRef = useRef({ viewMode, cameraProjection, materialType, autoRotate, selectedEntityId, selectedRelatedEntityIds, hoveredEntityId, focusEntityRequest, measurementMode, selectionClickEnabled, datums, datumTargets, datumReferenceFrames, tolerances, faceRecords, cylinderIds, customFaceMapping, showDatumFeatures, showDatumTargets, showDatumReferenceFrames, showDimensionalTolerances });
  useEffect(() => {
    const dimensionVisibilityChanged = prevShowDimensionalTolerancesPropRef.current !== showDimensionalTolerances;
    prevShowDimensionalTolerancesPropRef.current = showDimensionalTolerances;
    propsRef.current = { viewMode, cameraProjection, materialType, autoRotate, selectedEntityId, selectedRelatedEntityIds, hoveredEntityId, focusEntityRequest, measurementMode, selectionClickEnabled, datums, datumTargets, datumReferenceFrames, tolerances, faceRecords, cylinderIds, customFaceMapping, showDatumFeatures, showDatumTargets, showDatumReferenceFrames, showDimensionalTolerances };
    if (dimensionVisibilityChanged) {
      dimensionOverlayVisibilityRefreshRef.current?.();
    }
    requestRenderRef.current?.(4);
  }, [viewMode, cameraProjection, materialType, autoRotate, selectedEntityId, selectedRelatedEntityIds, hoveredEntityId, focusEntityRequest, measurementMode, selectionClickEnabled, datums, datumTargets, datumReferenceFrames, tolerances, faceRecords, cylinderIds, customFaceMapping, showDatumFeatures, showDatumTargets, showDatumReferenceFrames, showDimensionalTolerances]);

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
    type ViewCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;
    let viewportWidth = 1;
    let viewportHeight = 1;
    let activeCameraProjection: "perspective" | "orthographic" = propsRef.current.cameraProjection;
    const perspectiveCamera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
    const orthographicCamera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
    let camera: ViewCamera = activeCameraProjection === "orthographic" ? orthographicCamera : perspectiveCamera;
    let controls: OrbitControls;
    camera.position.set(15, 12, 22);

    const getViewportAspect = () => viewportWidth / Math.max(viewportHeight, 1);

    const getPerspectiveFitDistance = (sizeMax: number) => {
      const cameraFov = perspectiveCamera.fov * (Math.PI / 180);
      return Math.max(10, Math.abs(sizeMax / 2 / Math.tan(cameraFov / 2)) * 1.55);
    };

    const updateOrthographicCameraFrustum = () => {
      const aspect = getViewportAspect();
      const distance = Math.max(camera.position.distanceTo(controls?.target || modelOrbitTarget), modelSizeMax || 10);
      const visibleHeight = Math.max(modelSizeMax * 0.8, 2 * distance * Math.tan(THREE.MathUtils.degToRad(perspectiveCamera.fov) / 2));
      orthographicCamera.left = -visibleHeight * aspect / 2;
      orthographicCamera.right = visibleHeight * aspect / 2;
      orthographicCamera.top = visibleHeight / 2;
      orthographicCamera.bottom = -visibleHeight / 2;
      orthographicCamera.updateProjectionMatrix();
    };

    const updateActiveCameraProjectionMatrix = () => {
      perspectiveCamera.aspect = getViewportAspect();
      perspectiveCamera.updateProjectionMatrix();
      updateOrthographicCameraFrustum();
    };

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
        viewportWidth = Math.max(width, 1);
        viewportHeight = Math.max(height, 1);
        updateActiveCameraProjectionMatrix();
        renderer.setSize(width, height);
        requestRenderRef.current?.(2);
      }
    });
    resizeObserver.observe(containerRef.current);

    // Orbit Navigator Controls
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxDistance = 450;
    controls.minDistance = 2;

    const switchCameraProjection = (nextProjection: "perspective" | "orthographic") => {
      if (nextProjection === activeCameraProjection) return;
      const previousCamera = camera;
      const nextCamera = nextProjection === "orthographic" ? orthographicCamera : perspectiveCamera;

      nextCamera.position.copy(previousCamera.position);
      nextCamera.rotation.copy(previousCamera.rotation);
      nextCamera.up.copy(previousCamera.up);
      nextCamera.near = previousCamera.near;
      nextCamera.far = previousCamera.far;
      camera = nextCamera;
      controls.object = camera;
      activeCameraProjection = nextProjection;
      updateActiveCameraProjectionMatrix();
      controls.update();
      camera.updateMatrixWorld(true);
      requestRenderRef.current?.(4);
    };

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
    let drfBadgeCache: {
      id: string;
      element: HTMLElement;
      object: THREE.Object3D;
      localPoint: THREE.Vector3;
    }[] = [];
    let datumAnchorCache: {
      id: string;
      datum: any;
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
    let pmiDimensionLeaderCache: {
      tolerance: any;
      faceName: string;
      slotIndex: number;
      slotCount: number;
      anchor: {
        surfacePoint: THREE.Vector3;
        radialDirection: THREE.Vector3;
      };
      line: THREE.LineSegments;
      arrow: THREE.Mesh;
      labelEntry: {
        element: HTMLElement;
        point: THREE.Vector3;
        screenX: number;
        screenY: number;
        visible: boolean;
      } | null;
    }[] = [];
    let pmiDimensionLabelCache: {
      element: HTMLElement;
      point: THREE.Vector3;
      resolvePoint?: () => THREE.Vector3 | null;
      resolveTransform?: () => string;
      screenX: number;
      screenY: number;
      visible: boolean;
    }[] = [];
    let updatePmiDimensionLeaderFacing: () => void = () => undefined;
    let cadFacePickObjects: THREE.Object3D[] = [];
    let cadFallbackFacePickObjects: THREE.Object3D[] = [];
    let cadEdgePickObjects: THREE.Object3D[] = [];
    let cadVertexPickObjects: THREE.Object3D[] = [];
    let renderedObjectByName = new Map<string, THREE.Object3D>();
    let edgeNamesByFaceIndex = new Map<number, string[]>();
    let vertexRecordsByName = new Map<string, BRepVertexRecord>();
    let datumCacheMissingElements = 0;
    let datumCacheRetryFrame = 0;
    const partBounds = new THREE.Box3();
    const partCenter = new THREE.Vector3();
    let measurementPoints: MeasurementSample[] = [];
    let measurementGroup: THREE.Group | null = null;
    let previousMeasurementGroup: THREE.Group | null = null;
    let edgeHighlightGroup: THREE.Group | null = null;
    let vertexHighlightGroup: THREE.Group | null = null;
    let measurementLabelPoint: THREE.Vector3 | null = null;
    let prevMeasurementMode = measurementMode;
    let edgeHighlightResolutionWidth = -1;
    let edgeHighlightResolutionHeight = -1;
    const vertexMarkerWorldPoint = new THREE.Vector3();

    const updateEdgeHighlightResolution = (force = false) => {
      if (!edgeHighlightGroup) return;
      const width = Math.max(viewportWidth, 1);
      const height = Math.max(viewportHeight, 1);
      if (!force && width === edgeHighlightResolutionWidth && height === edgeHighlightResolutionHeight) return;

      edgeHighlightResolutionWidth = width;
      edgeHighlightResolutionHeight = height;
      edgeHighlightGroup.children.forEach((item) => {
        const material = (item as any).material;
        if (material instanceof LineMaterial) {
          material.resolution.set(width, height);
        }
      });
    };

    const updateVertexMarkerScreenScale = () => {
      if (!vertexHighlightGroup) return;
      const targetPixels = 6;
      const viewportScale = viewportHeight > 0 ? viewportHeight : renderer.domElement.clientHeight || 1;
      const perspectiveFov = THREE.MathUtils.degToRad(perspectiveCamera.fov);
      vertexHighlightGroup.children.forEach((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const worldPoint = child.getWorldPosition(vertexMarkerWorldPoint);
        const worldRadius = camera instanceof THREE.OrthographicCamera
          ? (targetPixels / viewportScale) * (camera.top - camera.bottom) / Math.max(camera.zoom, 1e-6)
          : (2 * camera.position.distanceTo(worldPoint) * Math.tan(perspectiveFov / 2) * targetPixels) / viewportScale;
        child.scale.setScalar(Math.max(worldRadius, 1e-6));
      });
    };

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

    // Helper: Obtain base face standard material
    const getFaceMaterial = (type: string, baseColor: THREE.Color, mode: "solid" | "xray", isSelected: boolean, isHovered: boolean) => {
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

    const clearPmiDimensionLabelElements = () => {
      pmiDimensionLeaderCache = [];
      pmiDimensionLabelCache = [];
      containerRef.current
        ?.querySelectorAll("[data-pmi-dimension-label='true']")
        .forEach((element) => element.remove());
    };

    // Rebuild B-Rep objects inside the canvas
    const rebuildSceneTopology = (resetCamera = false) => {
      clearPmiDimensionLabelElements();
      updatePmiDimensionLeaderFacing = () => undefined;
      // Clean previously rendered nodes
      while (assemblyGroup.children.length > 0) {
        const item = assemblyGroup.children[0];
        assemblyGroup.remove(item);
        item.traverse((child) => {
          if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments || child instanceof THREE.Line || child instanceof THREE.Points) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach((m) => m.dispose());
            } else {
              child.material.dispose();
            }
          }
        });
      }

      cadFacePickObjects = [];
      cadFallbackFacePickObjects = [];
      cadEdgePickObjects = [];
      cadVertexPickObjects = [];
      renderedObjectByName = new Map();
      edgeNamesByFaceIndex = new Map();
      vertexRecordsByName = new Map();

      if (!occtResult || !occtResult.success) return;

      const { materialType: activeMat, viewMode: activeMode, selectedEntityId: selectId, hoveredEntityId: hoverId } = propsRef.current;
      let totalTriangles = 0;
      let meshCounter = 0;
      let edgeCounter = 0;
      const pickPositions: number[] = [];
      const pickIndices: number[] = [];
      const pickFaceNamesByTriangle: string[] = [];
      const pickFaceNamesByVertex: string[] = [];
      const visibleEdgePositions: number[] = [];
      const edgePickPositions: number[] = [];
      const edgePickNamesBySegment: string[] = [];
      const vertexRecordsByKey = new Map<string, BRepVertexRecord>();

      const addVertexCandidate = (
        point: { x: number; y: number; z: number },
        edgeName: string,
        parentFaceIndices: number[] = [],
        parentFaceIds: string[] = []
      ) => {
        const key = `${point.x.toFixed(5)}|${point.y.toFixed(5)}|${point.z.toFixed(5)}`;
        let record = vertexRecordsByKey.get(key);
        if (!record) {
          const index = vertexRecordsByKey.size;
          record = {
            id: `BRepVertex-${index}`,
            index,
            point: { x: point.x, y: point.y, z: point.z },
            edgeIds: [],
            parentFaceIndices: [],
            parentFaceIds: []
          };
          vertexRecordsByKey.set(key, record);
        }
        if (!record.edgeIds.includes(edgeName)) record.edgeIds.push(edgeName);
        parentFaceIndices.forEach((faceIndex) => {
          if (!record!.parentFaceIndices.includes(faceIndex)) record!.parentFaceIndices.push(faceIndex);
        });
        parentFaceIds.forEach((faceId) => {
          if (faceId && !record!.parentFaceIds.includes(faceId)) record!.parentFaceIds.push(faceId);
        });
      };

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

          const mat = getFaceMaterial(activeMat, baseColor, activeMode, isSelected, isHovered);
          const meshObj = new THREE.Mesh(geometry, mat);
          meshObj.name = `BRepFace-${idx}`;
          meshObj.userData = faceUserData;
          assemblyGroup.add(meshObj);
          renderedObjectByName.set(meshObj.name, meshObj);
          cadFallbackFacePickObjects.push(meshObj);
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

      // Translate face-to-face intersection segments into selectable B-Rep edges.
      if (occtResult.lines && occtResult.lines.length > 0) {
        occtResult.lines.forEach((line: any, idx: number) => {
          if (!line.positions || line.positions.length === 0) return;
          edgeCounter++;
          const edgeName = `BRepEdge-${idx}`;
          const parentFaceIndices = line.parentFaceIndices || (line.parentFaceIndex !== undefined ? [line.parentFaceIndex] : []);
          const parentFaceIds = line.parentFaceIds || (line.parentFaceId ? [line.parentFaceId] : []);
          let firstEndpointIndex: number | null = null;
          let lastEndpointIndex: number | null = null;
          const appendEdgePickSegment = (aIndex: number, bIndex: number) => {
            const aOffset = aIndex * 3;
            const bOffset = bIndex * 3;
            const ax = line.positions[aOffset] || 0;
            const ay = line.positions[aOffset + 1] || 0;
            const az = line.positions[aOffset + 2] || 0;
            const bx = line.positions[bOffset] || 0;
            const by = line.positions[bOffset + 1] || 0;
            const bz = line.positions[bOffset + 2] || 0;
            edgePickPositions.push(ax, ay, az, bx, by, bz);
            edgePickNamesBySegment.push(edgeName);
            if (firstEndpointIndex === null) firstEndpointIndex = aIndex;
            lastEndpointIndex = bIndex;
          };

          if (line.indices && line.indices.length > 0) {
            line.indices.forEach((vertexIndex: number) => {
              const offset = vertexIndex * 3;
              visibleEdgePositions.push(
                line.positions[offset] || 0,
                line.positions[offset + 1] || 0,
                line.positions[offset + 2] || 0
              );
            });
            for (let i = 0; i < line.indices.length - 1; i += 2) {
              appendEdgePickSegment(line.indices[i], line.indices[i + 1]);
            }
          } else {
            visibleEdgePositions.push(...line.positions);
            const vertexCount = Math.floor(line.positions.length / 3);
            for (let i = 0; i < vertexCount - 1; i += 2) {
              appendEdgePickSegment(i, i + 1);
            }
          }

          if (Array.isArray(line.vertexPoints) && line.vertexPoints.length > 0) {
            line.vertexPoints.forEach((point: any) => {
              if (
                Number.isFinite(point?.x) &&
                Number.isFinite(point?.y) &&
                Number.isFinite(point?.z)
              ) {
                addVertexCandidate({ x: point.x, y: point.y, z: point.z }, edgeName, parentFaceIndices, parentFaceIds);
              }
            });
          } else if (firstEndpointIndex !== null && lastEndpointIndex !== null) {
            const firstOffset = firstEndpointIndex * 3;
            const lastOffset = lastEndpointIndex * 3;
            const firstPoint = {
              x: line.positions[firstOffset] || 0,
              y: line.positions[firstOffset + 1] || 0,
              z: line.positions[firstOffset + 2] || 0
            };
            const lastPoint = {
              x: line.positions[lastOffset] || 0,
              y: line.positions[lastOffset + 1] || 0,
              z: line.positions[lastOffset + 2] || 0
            };
            const endpointDistanceSq =
              (firstPoint.x - lastPoint.x) * (firstPoint.x - lastPoint.x) +
              (firstPoint.y - lastPoint.y) * (firstPoint.y - lastPoint.y) +
              (firstPoint.z - lastPoint.z) * (firstPoint.z - lastPoint.z);
            if (endpointDistanceSq > 1e-10) {
              addVertexCandidate(firstPoint, edgeName, parentFaceIndices, parentFaceIds);
              addVertexCandidate(lastPoint, edgeName, parentFaceIndices, parentFaceIds);
            }
          }

          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.Float32BufferAttribute(line.positions, 3));

          if (line.indices && line.indices.length > 0) {
            geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(line.indices), 1));
          }

          const isEdgeSelected = selectId === `BRepEdge-${idx}`;
          const isEdgeHovered = hoverId === `BRepEdge-${idx}`;

          // Detect if parent face is selected/hovered to activate synchronization
          const isParentSelected = parentFaceIndices.some((parentFaceIdx: number) => selectId === `BRepFace-${parentFaceIdx}`);
          const isParentHovered = parentFaceIndices.some((parentFaceIdx: number) => hoverId === `BRepFace-${parentFaceIdx}`);

          const isDirectlyActive = isEdgeSelected || isEdgeHovered;
          const isParentActive = isParentSelected || isParentHovered;
          const isHighlighted = isDirectlyActive || isParentActive;

          let edgeColor = 0x64748b; // neutral slate grey
          let edgeWidth = 1.5;
          let edgeOpacity = 0.0;

          if (isEdgeSelected || isParentSelected) {
            edgeColor = 0x10b981; // Emerald green
            edgeWidth = 4.0;
            edgeOpacity = 1.0;
          } else if (isEdgeHovered || isParentHovered) {
            edgeColor = 0xf43f5e; // Pink/rose high-luminance hover glow
            edgeWidth = 4.5;
            edgeOpacity = 1.0;
          }

          const edgeMaterial = new THREE.LineBasicMaterial({
            color: edgeColor,
            linewidth: edgeWidth,
            transparent: true,
            opacity: edgeOpacity,
            depthWrite: false,
          });

          // Draw using THREE.LineSegments to prevent crossing lines across disjoint segments!
          const lineObj = new THREE.LineSegments(geometry, edgeMaterial);
          lineObj.name = edgeName;
          lineObj.visible = isHighlighted;
          lineObj.userData = { 
            index: idx, 
            type: "edge", 
            positions: line.positions,
            parentFaceId: line.parentFaceId,
            parentFaceIndex: line.parentFaceIndex,
            parentFaceIds: line.parentFaceIds,
            parentFaceIndices: line.parentFaceIndices,
            vertexPoints: line.vertexPoints
          };
          assemblyGroup.add(lineObj);
          renderedObjectByName.set(lineObj.name, lineObj);

          parentFaceIndices.forEach((parentFaceIdx: number) => {
            const edgeNames = edgeNamesByFaceIndex.get(parentFaceIdx) || [];
            edgeNames.push(lineObj.name);
            edgeNamesByFaceIndex.set(parentFaceIdx, edgeNames);
          });
        });

        if (visibleEdgePositions.length > 0) {
          const mergedEdgeGeometry = new THREE.BufferGeometry();
          mergedEdgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(visibleEdgePositions, 3));
          const mergedEdgeMaterial = new THREE.LineBasicMaterial({
            color: 0x64748b,
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
          });
          const mergedEdgeObject = new THREE.LineSegments(mergedEdgeGeometry, mergedEdgeMaterial);
          mergedEdgeObject.name = "BRepVisibleEdges";
          mergedEdgeObject.renderOrder = 1;
          assemblyGroup.add(mergedEdgeObject);
        }

        if (edgePickPositions.length > 0) {
          const edgePickGeometry = new THREE.BufferGeometry();
          edgePickGeometry.setAttribute("position", new THREE.Float32BufferAttribute(edgePickPositions, 3));
          edgePickGeometry.computeBoundingBox();
          edgePickGeometry.computeBoundingSphere();
          const edgePickMaterial = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0,
            depthWrite: false,
          });
          edgePickMaterial.colorWrite = false;
          const edgePickObject = new THREE.LineSegments(edgePickGeometry, edgePickMaterial);
          edgePickObject.name = "CADEdgePickSegments";
          edgePickObject.userData.edgePickNamesBySegment = edgePickNamesBySegment;
          assemblyGroup.add(edgePickObject);
          cadEdgePickObjects = [edgePickObject];
        }

        const vertexRecords = Array.from(vertexRecordsByKey.values())
          .filter((record) => record.edgeIds.length >= 2);
        if (vertexRecords.length > 0) {
          const vertexPositions = vertexRecords.flatMap((record) => [record.point.x, record.point.y, record.point.z]);
          const vertexPickGeometry = new THREE.BufferGeometry();
          vertexPickGeometry.setAttribute("position", new THREE.Float32BufferAttribute(vertexPositions, 3));
          vertexPickGeometry.computeBoundingBox();
          vertexPickGeometry.computeBoundingSphere();
          const vertexPickMaterial = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 1,
            sizeAttenuation: false,
            transparent: true,
            opacity: 0,
            depthWrite: false,
          });
          vertexPickMaterial.colorWrite = false;
          const vertexPickObject = new THREE.Points(vertexPickGeometry, vertexPickMaterial);
          vertexPickObject.name = "BRepVertexPickPoints";
          vertexPickObject.userData.vertexRecords = vertexRecords;
          assemblyGroup.add(vertexPickObject);
          cadVertexPickObjects = [vertexPickObject];
          vertexRecords.forEach((record) => {
            vertexRecordsByName.set(record.id, record);
            const vertexProxy = new THREE.Object3D();
            vertexProxy.name = record.id;
            vertexProxy.userData = {
              index: record.index,
              type: "vertex",
              point: record.point,
              edgeIds: record.edgeIds,
              parentFaceIndices: record.parentFaceIndices,
              parentFaceIds: record.parentFaceIds
            };
            renderedObjectByName.set(record.id, vertexProxy);
          });
        }
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

      const sizeMax = Math.max(sizeVec.x, sizeVec.y, sizeVec.z) || 10;
      modelSizeMax = sizeMax;

      // Dynamically adjust camera clipping and orbit controller limits based on model size
      camera.near = Math.max(0.01, sizeMax * 0.001);
      camera.far = Math.max(5000, sizeMax * 150);
      updateActiveCameraProjectionMatrix();

      controls.minDistance = Math.max(0.1, sizeMax * 0.02);
      controls.maxDistance = Math.max(1000, sizeMax * 50);

      // Dynamically orient Lights based on model size for perfect highlights
      mainDirLight.position.set(sizeMax * 1.5, sizeMax * 2.5, sizeMax * 1.2);
      sideCyanLight.position.set(-sizeMax * 1.2, -sizeMax * 0.9, -sizeMax * 1.2);
      ambientPurpleLight.position.set(0, 0, -sizeMax * 2);

      // Re-center Orbit controls focus
      if (resetCamera) {
        const fitDist = getPerspectiveFitDistance(sizeMax);

        camera.position.set(fitDist * 0.7, fitDist * 0.6, fitDist);
        controls.target.copy(modelOrbitTarget);
        updateActiveCameraProjectionMatrix();
        controls.update();
      }

      assemblyGroup.updateMatrixWorld(true);

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
      `${propsRef.current.selectedEntityId || ""}|${(propsRef.current.selectedRelatedEntityIds || []).join(",")}|${currentHoverObj?.name || propsRef.current.hoveredEntityId || ""}`;

    const notifyParentHover = (entity: any | null, immediate = false) => {
      pendingHoverEntity = entity;
      const now = performance.now();
      const delay = immediate ? 0 : Math.max(0, 60 - (now - lastHoverNotifyAt));

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
      const pickThreshold = Math.max(modelSizeMax * 0.0015, 0.015);
      pointerRaycaster.params.Line = { threshold: pickThreshold };
      pointerRaycaster.params.Points = { threshold: Math.max(modelSizeMax * 0.002, 0.018) };

      const setRayFromClientPoint = (x: number, y: number) => {
        const ptX = ((x - rect.left) / rect.width) * 2 - 1;
        const ptY = -((y - rect.top) / rect.height) * 2 + 1;
        pointerNdc.set(ptX, ptY);
        pointerRaycaster.setFromCamera(pointerNdc, camera);
      };

      setRayFromClientPoint(clientX, clientY);
      const centerVertexHits = pointerRaycaster.intersectObjects(cadVertexPickObjects, false);
      const centerEdgeHits = pointerRaycaster.intersectObjects(cadEdgePickObjects, false);
      const acceleratedHits = pointerRaycaster.intersectObjects(cadFacePickObjects, false);
      const centerTopologyHits = [...centerVertexHits, ...centerEdgeHits]
        .sort((a, b) => a.distance - b.distance);
      if (centerTopologyHits.length > 0) {
        return [
          ...centerVertexHits.sort((a, b) => a.distance - b.distance),
          ...centerEdgeHits.sort((a, b) => a.distance - b.distance),
          ...acceleratedHits.sort((a, b) => a.distance - b.distance),
        ];
      }
      if (acceleratedHits.length > 0) {
        return acceleratedHits.sort((a, b) => a.distance - b.distance);
      }

      const aperturePx = propsRef.current.measurementMode ? 6 : 4;
      const apertureOffsets = [
        [-aperturePx, 0],
        [aperturePx, 0],
        [0, -aperturePx],
        [0, aperturePx],
        [-aperturePx, -aperturePx],
        [aperturePx, -aperturePx],
        [-aperturePx, aperturePx],
        [aperturePx, aperturePx],
      ];
      const apertureTopologyHits: THREE.Intersection[] = [];
      apertureOffsets.forEach(([dx, dy]) => {
        setRayFromClientPoint(clientX + dx, clientY + dy);
        apertureTopologyHits.push(
          ...pointerRaycaster.intersectObjects(cadVertexPickObjects, false),
          ...pointerRaycaster.intersectObjects(cadEdgePickObjects, false)
        );
      });
      if (apertureTopologyHits.length > 0) {
        const uniqueTopologyHits = apertureTopologyHits
          .filter((hit, index, all) => {
            const objectName = hit.object.name;
            const hitIndex = hit.index ?? Math.floor((hit as any).faceIndex ?? -1);
            return all.findIndex((candidate) =>
              candidate.object.name === objectName &&
              (candidate.index ?? Math.floor((candidate as any).faceIndex ?? -1)) === hitIndex
            ) === index;
          })
          .sort((a, b) => a.distance - b.distance);
        const vertexHits = uniqueTopologyHits.filter((hit) => hit.object.name === "BRepVertexPickPoints");
        const edgeHits = uniqueTopologyHits.filter((hit) => hit.object.name === "CADEdgePickSegments");
        return [
          ...vertexHits,
          ...edgeHits,
          ...acceleratedHits.sort((a, b) => a.distance - b.distance),
        ];
      }

      const primaryHits = acceleratedHits
        .sort((a, b) => a.distance - b.distance);
      if (primaryHits.length > 0 || !allowFallback) return primaryHits;
      setRayFromClientPoint(clientX, clientY);
      return pointerRaycaster.intersectObjects(cadFallbackFacePickObjects, false);
    };

    const pickCadIntersection = (intersections: THREE.Intersection[], allowFallback = false) => {
      for (const item of intersections) {
        if (item.object.name.startsWith("BRepFace-")) return item;
        if (item.object.name.startsWith("BRepEdge-")) return item;

        if (item.object.name === "BRepVertexPickPoints") {
          const vertexIndex = item.index ?? -1;
          const vertexRecord = item.object.userData.vertexRecords?.[vertexIndex] as BRepVertexRecord | undefined;
          const vertexObject = vertexRecord ? renderedObjectByName.get(vertexRecord.id) : null;
          if (vertexObject) {
            return { ...item, object: vertexObject };
          }
        }

        if (item.object.name === "CADEdgePickSegments") {
          const rawIndex = item.index ?? 0;
          const segmentIndex = Math.max(0, Math.floor(rawIndex / 2));
          const edgeName =
            item.object.userData.edgePickNamesBySegment?.[segmentIndex] ||
            item.object.userData.edgePickNamesBySegment?.[rawIndex];
          const edgeObject = edgeName ? renderedObjectByName.get(edgeName) : null;
          if (edgeObject) {
            return { ...item, object: edgeObject };
          }
        }

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
      if (faceMatch?.object.name.startsWith("BRepVertex-")) {
        return {
          point: assemblyGroup.worldToLocal(faceMatch.point.clone()),
          kind: "vertex",
          objectName: faceMatch.object.name,
        };
      }
      if (faceMatch?.object.name.startsWith("BRepEdge-")) {
        return {
          point: assemblyGroup.worldToLocal(faceMatch.point.clone()),
          kind: "edge",
          objectName: faceMatch.object.name,
          circle: getEdgeCircleSnap(faceMatch.object, assemblyGroup.worldToLocal(faceMatch.point.clone())),
        };
      }
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

    const isPointerNearHoveredVertex = (clientX: number, clientY: number) => {
      if (!currentHoverObj?.name?.startsWith("BRepVertex-")) return false;
      const point = currentHoverObj.userData.point;
      if (!point) return false;
      const rect = canvas.getBoundingClientRect();
      const worldPoint = assemblyGroup.localToWorld(new THREE.Vector3(point.x, point.y, point.z));
      const projected = worldPoint.project(camera);
      if (projected.z < -1 || projected.z > 1) return false;
      const screenX = rect.left + (projected.x + 1) * rect.width * 0.5;
      const screenY = rect.top + (1 - projected.y) * rect.height * 0.5;
      const dx = clientX - screenX;
      const dy = clientY - screenY;
      const stickyRadius = propsRef.current.measurementMode ? 18 : 14;
      return dx * dx + dy * dy <= stickyRadius * stickyRadius;
    };

    const findNearestScreenVertex = (clientX: number, clientY: number, radiusPx: number) => {
      const rect = canvas.getBoundingClientRect();
      let best: { object: THREE.Object3D; point: THREE.Vector3; distanceSq: number } | null = null;
      vertexRecordsByName.forEach((record, name) => {
        const object = renderedObjectByName.get(name);
        if (!object) return;
        const point = new THREE.Vector3(record.point.x, record.point.y, record.point.z);
        const projected = assemblyGroup.localToWorld(point.clone()).project(camera);
        if (projected.z < -1 || projected.z > 1) return;
        const screenX = rect.left + (projected.x + 1) * rect.width * 0.5;
        const screenY = rect.top + (1 - projected.y) * rect.height * 0.5;
        const dx = clientX - screenX;
        const dy = clientY - screenY;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq > radiusPx * radiusPx) return;
        if (!best || distanceSq < best.distanceSq) {
          best = { object, point, distanceSq };
        }
      });
      return best;
    };

    const setHoverObject = (hoveredObj: THREE.Object3D, localPoint: THREE.Vector3) => {
      const x = parseFloat((localPoint.x + assemblyGroup.position.x).toFixed(2));
      const y = parseFloat((localPoint.y + assemblyGroup.position.y).toFixed(2));
      const z = parseFloat((localPoint.z + assemblyGroup.position.z).toFixed(2));
      const coordinateKey = `${x}|${y}|${z}`;
      if (coordinateKey !== lastHoveredCoordinateKey) {
        lastHoveredCoordinateKey = coordinateKey;
        const now = performance.now();
        if (now - lastHoveredCoordinateUpdateAt > 90) {
          lastHoveredCoordinateUpdateAt = now;
          setHoveredCoordinate({ x, y, z });
        }
      }

      if (currentHoverObj === hoveredObj) return;
      if (currentHoverObj && currentHoverObj.material instanceof THREE.MeshStandardMaterial) {
        currentHoverObj.material.emissive.set(oldEmissiveColor);
      }

      currentHoverObj = hoveredObj;
      const type = currentHoverObj.name.startsWith("BRepFace-")
        ? "face"
        : currentHoverObj.name.startsWith("BRepVertex-")
        ? "vertex"
        : "edge";
      const index = currentHoverObj.userData.index;

      setViewportHoverEntity({
        id: currentHoverObj.name,
        type,
        index,
        name: type === "face"
          ? `B-Rep Face #${index + 1}`
          : type === "vertex"
          ? `B-Rep Vertex #${index + 1}`
          : `B-Rep Edge #${index + 1}`,
        triangles: currentHoverObj.userData.triangles || 0,
        source: "viewport",
      });

      if (currentHoverObj.material instanceof THREE.MeshStandardMaterial) {
        oldEmissiveColor.copy(currentHoverObj.material.emissive);
        currentHoverObj.material.emissive.setHex(0x1e1b4b);
        requestRenderRef.current?.(2);
      }
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
          const localPoint = assemblyGroup.worldToLocal(match.point.clone());
          setHoverObject(match.object, localPoint);
          return;
        }
      }

      if (isPointerNearHoveredVertex(e.clientX, e.clientY)) {
        return;
      }

      const nearestVertex = findNearestScreenVertex(e.clientX, e.clientY, propsRef.current.measurementMode ? 12 : 9);
      if (nearestVertex) {
        setHoverObject(nearestVertex.object, nearestVertex.point);
        return;
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
            start: b.point.clone().addScaledVector(n1, -signedDistance),
            end: b.point.clone(),
            text: formatMm(Math.abs(signedDistance)),
            normalReference: n1.clone(),
            surfaceReference: n2.clone(),
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
        color: 0x0f172a,
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
        color: 0x0f172a,
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

    const getLinearDimensionProjectionDirection = (
      axis: THREE.Vector3,
      viewDirection: THREE.Vector3,
      result: LinearMeasurementResult,
      frameBasis?: MeasurementFrameBasis | null
    ): THREE.Vector3 | null => {
      const unitAxis = axis.clone().normalize();
      if (frameBasis) {
        const frameProjection = [frameBasis.xAxis, frameBasis.yAxis, frameBasis.zAxis]
          .map((frameAxis) => frameAxis.clone().addScaledVector(unitAxis, -frameAxis.dot(unitAxis)))
          .filter((frameAxis) => frameAxis.lengthSq() > 1e-8)
          .sort((a, b) => b.lengthSq() - a.lengthSq())[0];
        if (frameProjection) {
          frameProjection.normalize();
          if (frameProjection.dot(viewDirection) < 0) frameProjection.negate();
          return frameProjection;
        }
      }

      let planeNormal: THREE.Vector3 | null = null;

      if (
        result.surfaceReference &&
        result.surfaceReference.lengthSq() > 1e-8 &&
        Math.abs(result.surfaceReference.clone().normalize().dot(unitAxis)) < 0.985
      ) {
        planeNormal = result.surfaceReference.clone().normalize();
      } else {
        planeNormal = new THREE.Vector3().crossVectors(unitAxis, viewDirection);
        if (planeNormal.lengthSq() <= 1e-8) {
          planeNormal.crossVectors(unitAxis, new THREE.Vector3(0, 1, 0));
        }
        if (planeNormal.lengthSq() <= 1e-8) {
          planeNormal.crossVectors(unitAxis, new THREE.Vector3(1, 0, 0));
        }
        if (planeNormal.lengthSq() <= 1e-8) return null;
        planeNormal.normalize();
      }

      let projectionDirection = new THREE.Vector3().crossVectors(planeNormal, unitAxis);
      if (projectionDirection.lengthSq() <= 1e-8) {
        projectionDirection.crossVectors(unitAxis, planeNormal);
      }
      if (projectionDirection.lengthSq() <= 1e-8) return null;
      projectionDirection.normalize();
      if (projectionDirection.dot(viewDirection) < 0) projectionDirection.negate();
      return projectionDirection;
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
        const projectionDirection = getLinearDimensionProjectionDirection(axis, viewDirection, result);
        if (!projectionDirection) return;

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

      const offsetDirection = getLinearDimensionProjectionDirection(axis, viewDirection, result);
      if (!offsetDirection) return;

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
      if (!obj.name.startsWith("BRepFace-") && !obj.name.startsWith("BRepEdge-") && !obj.name.startsWith("BRepVertex-")) return null;
      const type = obj.name.startsWith("BRepFace-")
        ? "face"
        : obj.name.startsWith("BRepVertex-")
        ? "vertex"
        : "edge";
      const idx = obj.userData.index;
      const pt = match.point;

      const blockDetails: any = {
        id: obj.name,
        type,
        index: idx,
        name: type === "face"
          ? `B-Rep Face #${idx + 1}`
          : type === "vertex"
          ? `B-Rep Vertex #${idx + 1}`
          : `B-Rep Edge #${idx + 1}`,
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
          for (let i = 0; i < pointsPos.length - 3; i += 6) {
            const dx = pointsPos[i + 3] - pointsPos[i];
            const dy = pointsPos[i + 4] - pointsPos[i + 1];
            const dz = pointsPos[i + 5] - pointsPos[i + 2];
            pathLen += Math.sqrt(dx * dx + dy * dy + dz * dz);
          }
        }
        blockDetails.length = parseFloat(pathLen.toFixed(2)) || 4.5;
      } else if (type === "vertex") {
        blockDetails.edgeIds = obj.userData.edgeIds || [];
        blockDetails.parentFaceIndices = obj.userData.parentFaceIndices || [];
        blockDetails.parentFaceIds = obj.userData.parentFaceIds || [];
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
        return renderedObjectByName.has(name) ? name : null;
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
        return renderedObjectByName.has(name) ? name : null;
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
      return mapped && renderedObjectByName.has(mapped) ? mapped : null;
    };

    const getFaceFrameInAssembly = (faceName: string): {
      object: THREE.Object3D;
      center: THREE.Vector3;
      normal: THREE.Vector3 | null;
      area: number;
    } | null => {
      const object = renderedObjectByName.get(faceName);
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
      } else if (object instanceof THREE.Mesh && geometry) {
        const cachedFallbackNormal = object.userData.fallbackPlanarNormal;
        const localNormal = cachedFallbackNormal instanceof THREE.Vector3
          ? cachedFallbackNormal.clone()
          : (() => {
              const positionAttribute = geometry.getAttribute("position");
              const indexAttribute = geometry.getIndex();
              const a = new THREE.Vector3();
              const b = new THREE.Vector3();
              const c = new THREE.Vector3();
              const edgeA = new THREE.Vector3();
              const edgeB = new THREE.Vector3();
              const triangleNormal = new THREE.Vector3();
              const accumulated = new THREE.Vector3();
              const triangleCount = indexAttribute ? Math.floor(indexAttribute.count / 3) : Math.floor(positionAttribute.count / 3);
              const readVertex = (vertexIndex: number, target: THREE.Vector3) => target.fromBufferAttribute(positionAttribute, vertexIndex);
              for (let i = 0; i < triangleCount; i++) {
                if (indexAttribute) {
                  readVertex(indexAttribute.getX(i * 3), a);
                  readVertex(indexAttribute.getX(i * 3 + 1), b);
                  readVertex(indexAttribute.getX(i * 3 + 2), c);
                } else {
                  readVertex(i * 3, a);
                  readVertex(i * 3 + 1, b);
                  readVertex(i * 3 + 2, c);
                }
                edgeA.subVectors(b, a);
                edgeB.subVectors(c, a);
                triangleNormal.crossVectors(edgeA, edgeB);
                if (triangleNormal.lengthSq() > 1e-12) accumulated.add(triangleNormal);
              }
              if (accumulated.lengthSq() <= 1e-12) return null;
              const computed = accumulated.normalize();
              object.userData.fallbackPlanarNormal = computed.clone();
              return computed;
            })();
        if (localNormal) {
          const worldNormal = localNormal.transformDirection(object.matrixWorld).normalize();
          const assemblyRotation = new THREE.Quaternion();
          assemblyGroup.getWorldQuaternion(assemblyRotation);
          normal = worldNormal.applyQuaternion(assemblyRotation.invert()).normalize();
        }
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
      if (datum?.derivedDatum === "multiface") return "multiface";
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
      if (datum?.derivedDatum === "multiface") return "multiface";

      const baseKind = getDatumRenderKind(datum);
      if (baseKind !== "multiface") return baseKind;

      const semanticText = `${datum?.type || ""} ${datum?.targetName || ""} ${datum?.clinicalContext || ""}`;
      const typeText = `${datum?.type || ""}`;
      const isTwoPlanarDatumFeature =
        mappedFaceNames.length === 2 &&
        /^Planar Datum Feature$/i.test(typeText.trim());
      const isExplicitMultiFeature = /primary flat|pattern|multi[-\s]?face|multiple physical faces|cylind|hole|bore|target set/i.test(semanticText);
      return isTwoPlanarDatumFeature && !isExplicitMultiFeature ? "twoFaceDimension" : "multiface";
    };

    const updateHighlightStyles = () => {
      const { selectedEntityId: selectId, selectedRelatedEntityIds } = propsRef.current;
      const hoverId = currentHoverObj?.name || propsRef.current.hoveredEntityId || "";
      const selectedNames = new Set<string>([
        ...(selectId ? [selectId] : []),
        ...(selectedRelatedEntityIds || []),
      ]);

      const edgeNamesForActiveEntity = (id?: string | null) => {
        const edgeNames = new Set<string>();
        if (!id) return edgeNames;

        if (id.startsWith("BRepVertex-")) {
          return edgeNames;
        }

        if (id.startsWith("BRepEdge-")) {
          edgeNames.add(id);
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
      const hoveredEdgeNames = hoverId?.startsWith("BRepVertex-")
        ? new Set<string>()
        : edgeNamesForActiveEntity(hoverId);
      const directSelectedEdgeNames = new Set<string>(selectId?.startsWith("BRepEdge-") ? [selectId] : []);
      const directHoveredEdgeNames = new Set<string>(hoverId?.startsWith("BRepEdge-") ? [hoverId] : []);
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

      const activeVertexNames = [...nextHighlightNames].filter((name) => name.startsWith("BRepVertex-"));
      if (edgeHighlightGroup) {
        edgeHighlightGroup.traverse((item) => {
          if (item instanceof LineSegments2) {
            item.geometry.dispose();
            if (Array.isArray(item.material)) {
              item.material.forEach((material) => material.dispose());
            } else {
              item.material.dispose();
            }
          }
        });
        assemblyGroup.remove(edgeHighlightGroup);
        edgeHighlightGroup = null;
      }
      const activeEdgeNames = [...new Set([
        ...directSelectedEdgeNames,
        ...directHoveredEdgeNames,
      ])];
      if (activeEdgeNames.length > 0) {
        edgeHighlightGroup = new THREE.Group();
        edgeHighlightGroup.name = "BRepActiveEdgeWideHighlights";
        activeEdgeNames.forEach((edgeName) => {
          const edgeObject = renderedObjectByName.get(edgeName) as THREE.LineSegments | undefined;
          const edgeGeometry = edgeObject?.geometry as THREE.BufferGeometry | undefined;
          const position = edgeGeometry?.getAttribute("position") as THREE.BufferAttribute | undefined;
          if (!position || position.count < 2) return;
          const index = edgeGeometry.getIndex();
          const positions: number[] = [];
          const appendSegment = (aIndex: number, bIndex: number) => {
            if (aIndex < 0 || bIndex < 0 || aIndex >= position.count || bIndex >= position.count) return;
            positions.push(
              position.getX(aIndex), position.getY(aIndex), position.getZ(aIndex),
              position.getX(bIndex), position.getY(bIndex), position.getZ(bIndex)
            );
          };
          if (index && index.count >= 2) {
            for (let i = 0; i < index.count - 1; i += 2) {
              appendSegment(index.getX(i), index.getX(i + 1));
            }
          } else {
            for (let i = 0; i < position.count - 1; i += 2) {
              appendSegment(i, i + 1);
            }
          }
          if (positions.length < 6) return;
          const geometry = new LineSegmentsGeometry();
          geometry.setPositions(positions);
          const material = new LineMaterial({
            color: selectedEdgeNames.has(edgeName) ? 0x10b981 : 0xf43f5e,
            linewidth: selectedEdgeNames.has(edgeName) ? 3.0 : 2.6,
            transparent: true,
            opacity: 0.88,
            depthTest: false,
            depthWrite: false,
          });
          material.resolution.set(Math.max(viewportWidth, 1), Math.max(viewportHeight, 1));
          const wideLine = new LineSegments2(geometry, material);
          wideLine.name = `BRepWideHighlight-${edgeName}`;
          wideLine.renderOrder = 19;
          wideLine.raycast = () => undefined;
          edgeHighlightGroup!.add(wideLine);
        });
        if (edgeHighlightGroup.children.length > 0) {
          assemblyGroup.add(edgeHighlightGroup);
          updateEdgeHighlightResolution();
        } else {
          edgeHighlightGroup = null;
        }
      }
      if (vertexHighlightGroup) {
        vertexHighlightGroup.traverse((item) => {
          if (item instanceof THREE.Points || item instanceof THREE.Mesh) {
            item.geometry.dispose();
            if (Array.isArray(item.material)) {
              item.material.forEach((material) => material.dispose());
            } else {
              item.material.dispose();
            }
          }
        });
        assemblyGroup.remove(vertexHighlightGroup);
        vertexHighlightGroup = null;
      }
      if (activeVertexNames.length > 0) {
        const sphereGeometry = new THREE.SphereGeometry(1, 12, 8);
        activeVertexNames.forEach((name) => {
          const record = vertexRecordsByName.get(name);
          if (!record) return;
          if (!vertexHighlightGroup) {
            vertexHighlightGroup = new THREE.Group();
            vertexHighlightGroup.name = "BRepVertexActiveMarkers";
            assemblyGroup.add(vertexHighlightGroup);
          }
          const material = new THREE.MeshBasicMaterial({
            color: selectedNames.has(name) ? 0x10b981 : 0xf43f5e,
            transparent: true,
            opacity: 0.95,
            depthWrite: false,
          });
          const marker = new THREE.Mesh(sphereGeometry.clone(), material);
          marker.name = `BRepVertexMarker-${record.index}`;
          marker.position.set(record.point.x, record.point.y, record.point.z);
          marker.renderOrder = 18;
          marker.raycast = () => undefined;
          vertexHighlightGroup.add(marker);
        });
        sphereGeometry.dispose();
        updateVertexMarkerScreenScale();
      }

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
          child.visible = isHighlighted;

          const material = (child as THREE.LineSegments).material;
          if (material instanceof THREE.LineBasicMaterial) {
            if (directSelectedEdgeNames.has(child.name)) {
              material.color.setHex(0x10b981);
              material.opacity = 1.0;
            } else if (directHoveredEdgeNames.has(child.name)) {
              material.color.setHex(0xf43f5e);
              material.opacity = 1.0;
            } else if (selectedEdgeNames.has(child.name)) {
              material.color.setHex(0x10b981);
              material.linewidth = 2.4;
              material.opacity = 0.66;
            } else if (hoveredEdgeNames.has(child.name)) {
              material.color.setHex(0xf43f5e);
              material.linewidth = 2.4;
              material.opacity = 0.6;
            } else {
              material.color.setHex(0x64748b);
              material.linewidth = 1.5;
              material.opacity = 0.0;
            }
            material.depthWrite = false;
          }
        }
      });

      previousHighlightNames = nextHighlightNames;
    };

    const getFeatureViewDirection = (obj: THREE.Object3D, center: THREE.Vector3, preferAxisView = false): THREE.Vector3 => {
      const currentViewDirection = camera.position.clone().sub(center).normalize();
      const cache = obj.userData.interactionCache;
      const axis = (cache?.cylinderAxis ? cache.cylinderAxis.clone() : new THREE.Vector3(1, 0, 0))
        .transformDirection(obj.matrixWorld)
        .normalize();

      const axisViewDirection = () => axis.dot(currentViewDirection) >= 0 ? axis : axis.clone().negate();

      if (preferAxisView && cache?.cylinderAxis) {
        return axisViewDirection();
      }

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

      return axisViewDirection();
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

    const rotatePartAroundWorldAxis = (axis: THREE.Vector3, angle: number, pivot = controls.target) => {
      const rotation = new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), angle);
      assemblyGroup.position.sub(pivot).applyQuaternion(rotation).add(pivot);
      assemblyGroup.quaternion.premultiply(rotation);
      assemblyGroup.updateMatrixWorld(true);
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
      focusedDatumOrbit = false;
    };

    partRollHandlerRef.current = (angle: number) => {
      const fixedCameraPosition = camera.position.clone();
      const fixedCameraTarget = controls.target.clone();
      const fixedCameraUp = camera.up.clone();
      const viewDirection = controls.target.clone().sub(camera.position).normalize();

      cameraFocusTarget = null;
      focusedDatumOrbit = false;
      rotatePartAroundWorldAxis(viewDirection, angle, fixedCameraTarget);

      camera.position.copy(fixedCameraPosition);
      controls.target.copy(fixedCameraTarget);
      camera.up.copy(fixedCameraUp);
      controls.update();
      controls.saveState();
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
            if (nested instanceof THREE.Line || nested instanceof THREE.LineSegments || nested instanceof THREE.Mesh || nested instanceof THREE.Sprite) {
              nested.geometry.dispose();
              if (Array.isArray(nested.material)) {
                nested.material.forEach((material) => {
                  if ("map" in material && material.map) material.map.dispose();
                  material.dispose();
                });
              } else {
                if ("map" in nested.material && nested.material.map) nested.material.map.dispose();
                nested.material.dispose();
              }
            }
          });
        });
      });
    };

    const clearPmiDimensionToleranceOverlay = () => {
      const staleDimensionGeometry: THREE.Object3D[] = [];
      clearPmiDimensionLabelElements();
      assemblyGroup.traverse((child) => {
        if (
          child.name.startsWith("PmiDimensionToleranceOverlay") &&
          !child.parent?.name.startsWith("PmiDimensionToleranceOverlay")
        ) {
          staleDimensionGeometry.push(child);
        }
      });
      staleDimensionGeometry.forEach((item) => {
        item.parent?.remove(item);
        item.traverse((nested) => {
          if (nested instanceof THREE.Line || nested instanceof THREE.LineSegments || nested instanceof THREE.Mesh || nested instanceof THREE.Sprite) {
            nested.geometry.dispose();
            if (Array.isArray(nested.material)) {
              nested.material.forEach((material) => {
                if ("map" in material && material.map) material.map.dispose();
                material.dispose();
              });
            } else {
              if ("map" in nested.material && nested.material.map) nested.material.map.dispose();
              nested.material.dispose();
            }
          }
        });
      });
    };

    const refreshPmiDimensionToleranceOverlay = () => {
      clearPmiDimensionToleranceOverlay();
      drawPmiDimensionToleranceOverlay();
    };

    function getDatumLeaderDimensionLabelLocalGeometry(anchor: (typeof datumAnchorCache)[number]): { point: THREE.Vector3; tangent: THREE.Vector3 } | null {
      if (!anchor.hasLeader) return null;
      if (anchor.calloutKind === "median") {
        const tangent = anchor.leaderTangent.clone();
        if (tangent.lengthSq() <= 1e-8) return null;
        tangent.normalize();
        const basePoint = (anchor.triangleApexLocal || anchor.localPoint).clone();
        const point = basePoint.addScaledVector(tangent, Math.max(anchor.triangleHalfBase * 1.8, modelSizeMax * 0.018));
        return { point, tangent };
      }
      if (anchor.calloutKind !== "cylindrical") return null;
      const leaderAxis = anchor.leaderAxisLocal.clone();
      if (leaderAxis.lengthSq() <= 1e-8) return null;
      leaderAxis.normalize();
      const tangent = getBadgeEdgeDirectionLocal(anchor.object, leaderAxis, anchor.leaderTangent);
      if (tangent.lengthSq() <= 1e-8) return null;
      const radialLeadEndLocal = anchor.localPoint.clone().addScaledVector(leaderAxis, anchor.leaderRadialLength);
      const doglegExtendedEndLocal = radialLeadEndLocal
        .clone()
        .addScaledVector(tangent, anchor.leaderDoglegLength + Math.max(anchor.triangleHalfBase * 1.75, modelSizeMax * 0.018));
      return {
        point: doglegExtendedEndLocal,
        tangent
      };
    }

    function getDatumLeaderDimensionLabelPoint(anchor: (typeof datumAnchorCache)[number]): THREE.Vector3 | null {
      const geometry = getDatumLeaderDimensionLabelLocalGeometry(anchor);
      return geometry ? assemblyGroup.worldToLocal(anchor.object.localToWorld(geometry.point.clone())) : null;
    }

    function getDatumLeaderDimensionLabelTransform(anchor: (typeof datumAnchorCache)[number]): string {
      const geometry = getDatumLeaderDimensionLabelLocalGeometry(anchor);
      if (!geometry) return "translate(4px, -50%)";
      const pointNdc = anchor.object.localToWorld(geometry.point.clone()).project(camera);
      const tangentNdc = anchor.object.localToWorld(geometry.point.clone().add(geometry.tangent)).project(camera);
      return tangentNdc.x < pointNdc.x
        ? "translate(calc(-100% - 4px), -50%)"
        : "translate(4px, -50%)";
    }

    const clearDatumReferenceFrameBadges = () => {
      drfBadgeCache.forEach((badge) => {
        badge.element.remove();
      });
      containerRef.current
        ?.querySelectorAll("[data-drf-badge='true']")
        .forEach((element) => element.remove());
      drfBadgeCache = [];
    };

    const drawDatumReferenceFrameOverlay = () => {
      const frames = propsRef.current.datumReferenceFrames || [];
      const allDatums = propsRef.current.datums || [];
      const allTolerances = propsRef.current.tolerances || [];
      if (frames.length === 0 || allDatums.length === 0) return;
      const drfBadgeOverlay = document.getElementById("drf-badges-overlay");

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
            const object = renderedObjectByName.get(faceName);
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
      const plottedFrameByEntity = new Map<string, { frame: any; tolerances: any[]; score: number; showBadge: boolean }>();
      const parsedFrameBadgeKeys = new Set(
        frames
          .filter((frame: any) => Array.isArray(frame.references) && frame.references.length > 0)
          .map((frame: any) => getFrameKey(frame) || frame.entityId)
      );
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
          plottedFrameByEntity.set(key, {
            frame: makePlottedFrame(frame),
            tolerances: [tolerance],
            score,
            showBadge: parsedFrameBadgeKeys.has(key)
          });
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
        .map((frame: any) => ({ frame, tolerances: getFrameTolerances(frame), showBadge: true }));

      const expandCylinderPatternFrame = (candidate: { frame: any; tolerances: any[]; showBadge?: boolean }) => {
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
            tolerances: candidate.tolerances,
            showBadge: candidate.showBadge
          };
        });
      };

      const candidateFrames = (uniqueFrames.length > 0 ? uniqueFrames : fallbackFrames)
        .flatMap(expandCylinderPatternFrame);

      const getPrimaryReferenceNormal = (frame: any): THREE.Vector3 | null => {
        const primaryReference = getUniqueFrameReferences(frame)[0];
        if (!primaryReference) return null;
        const faceName = getDatumFaceNames(primaryReference)[0];
        const faceFrame = faceName ? getFaceFrameInAssembly(faceName) : null;
        if (faceFrame?.normal && faceFrame.normal.lengthSq() > 1e-8) {
          return faceFrame.normal.clone().normalize();
        }
        const primaryGeometry = (primaryReference.surfaceGeometry || [])[0];
        const stepNormal = primaryGeometry?.normal
          ? new THREE.Vector3(primaryGeometry.normal.x, primaryGeometry.normal.y, primaryGeometry.normal.z)
          : null;
        return stepNormal && stepNormal.lengthSq() > 1e-8 ? stepNormal.normalize() : null;
      };

      const getFrameBasisVectors = (frame: any, alignToPrimaryDatumNormal = false) => {
        const basis = frame?.frameBasis;
        if (!basis?.xAxis || !basis?.yAxis || !basis?.zAxis) return null;
        const xAxis = new THREE.Vector3(basis.xAxis.x, basis.xAxis.y, basis.xAxis.z);
        const yAxis = new THREE.Vector3(basis.yAxis.x, basis.yAxis.y, basis.yAxis.z);
        const zAxis = new THREE.Vector3(basis.zAxis.x, basis.zAxis.y, basis.zAxis.z);
        if (xAxis.lengthSq() <= 1e-8 || yAxis.lengthSq() <= 1e-8 || zAxis.lengthSq() <= 1e-8) return null;
        if (alignToPrimaryDatumNormal) {
          const primaryNormal = getPrimaryReferenceNormal(frame);
          if (primaryNormal) {
            const alignedX = xAxis.clone().addScaledVector(primaryNormal, -xAxis.dot(primaryNormal));
            if (alignedX.lengthSq() > 1e-8) {
              const alignedY = new THREE.Vector3().crossVectors(primaryNormal, alignedX.normalize()).normalize();
              if (alignedY.lengthSq() > 1e-8) {
                return {
                  xAxis: new THREE.Vector3().crossVectors(alignedY, primaryNormal).normalize(),
                  yAxis: alignedY,
                  zAxis: primaryNormal,
                };
              }
            }
          }
        }
        return {
          xAxis: xAxis.normalize(),
          yAxis: yAxis.normalize(),
          zAxis: zAxis.normalize(),
        };
      };

      const getBaseOrientationScore = (frame: any) => {
        const references = getUniqueFrameReferences(frame);
        if (references.length < 3 || !getFrameBasisVectors(frame)) return -Infinity;
        const tolerancesForFrame = getFrameTolerances(frame);
        const toleranceScore = tolerancesForFrame
          .reduce((score: number, tolerance: any) => score + getFramePlotScore(tolerance), 0);
        const modifierCount = references
          .reduce((count: number, reference: any) => count + ((reference.modifiers || []).length || 0), 0);
        return references.length * 1000 + toleranceScore + tolerancesForFrame.length * 10 - modifierCount;
      };

      const scoredBaseOrientationFrames = [...frames]
        .map((frame: any) => ({ frame, score: getBaseOrientationScore(frame) }))
        .filter((candidate) => candidate.score > -Infinity);
      const baseOrientationFrame = scoredBaseOrientationFrames
        .sort((a, b) => b.score - a.score)
        [0]?.frame;
      const baseOrientationBasis = getFrameBasisVectors(baseOrientationFrame, true);

      const drawFrame = (candidate: { frame: any; tolerances: any[]; showBadge?: boolean }): boolean => {
        const frame = candidate.frame;
        const uniqueReferences = getUniqueFrameReferences(frame).slice(0, 3);
        if (uniqueReferences.length === 0) return false;

        const toVector3 = (value?: { x: number; y: number; z: number } | null) =>
          value ? new THREE.Vector3(value.x, value.y, value.z) : null;

        const datumAnchors = uniqueReferences.map((reference: any) => {
          const datum = datumByIdentifier.get(reference.datumIdentifier);
          const faceName = getDatumFaceNames(reference)[0];
          const faceFrame = faceName ? getFaceFrameInAssembly(faceName) : null;
          const faceObject = faceName ? renderedObjectByName.get(faceName) : null;
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
        const primaryCylinderPointCount = (primary?.stepGeometry || [])
          .filter((geometry: any) => geometry.surfaceType === "cylinder" && geometry.point && geometry.axis)
          .reduce((points: string[], geometry: any) => {
            const key = `${geometry.point.x.toFixed(6)}|${geometry.point.y.toFixed(6)}|${geometry.point.z.toFixed(6)}`;
            return points.includes(key) ? points : [...points, key];
          }, []).length;
        const shouldInheritBaseOrientation =
          !!baseOrientationBasis &&
          uniqueReferences.length === 1 &&
          primaryIsCylinder &&
          primaryCylinderPointCount > 1;
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

        const primaryCanonicalZ =
          (primaryIsPlane ? primary?.frame?.normal || primary?.stepNormal || primary?.datumAxis : primary?.stepAxis || primary?.datumAxis) ||
          primary?.datumAxis ||
          null;
        if (primaryCanonicalZ && primaryCanonicalZ.lengthSq() > 1e-8) {
          const canonicalZ = primaryCanonicalZ.clone().normalize();

          const pickCanonicalXAxis = (candidates: Array<THREE.Vector3 | null | undefined>) => {
            for (const candidate of candidates) {
              if (!candidate || candidate.lengthSq() <= 1e-8) continue;
              const projected = candidate.clone().addScaledVector(canonicalZ, -candidate.dot(canonicalZ));
              if (projected.lengthSq() > 1e-8) return projected.normalize();
            }
            const worldAxes = [
              new THREE.Vector3(1, 0, 0),
              new THREE.Vector3(0, 1, 0),
              new THREE.Vector3(0, 0, 1),
            ]
              .map((axis) => axis.addScaledVector(canonicalZ, -axis.dot(canonicalZ)))
              .filter((axis) => axis.lengthSq() > 1e-8)
              .sort((a, b) => b.lengthSq() - a.lengthSq());
            return worldAxes[0]?.normalize() || null;
          };

          const canonicalX = pickCanonicalXAxis([
            primary?.stepXDirection,
            hasValidParserFrameBasis && parserFrameBasis?.xAxis
              ? new THREE.Vector3(parserFrameBasis.xAxis.x, parserFrameBasis.xAxis.y, parserFrameBasis.xAxis.z)
              : null,
            xAxis,
            modelOrbitTarget.clone().sub(origin),
          ]);

          if (canonicalX) {
            const canonicalY = new THREE.Vector3().crossVectors(canonicalZ, canonicalX).normalize();
            if (canonicalY.lengthSq() > 1e-8) {
              zAxis.copy(canonicalZ);
              yAxis.copy(canonicalY);
              xAxis.copy(new THREE.Vector3().crossVectors(yAxis, zAxis).normalize());
            }
          }
        }

        if (shouldInheritBaseOrientation && baseOrientationBasis) {
          xAxis.copy(baseOrientationBasis.xAxis);
          yAxis.copy(baseOrientationBasis.yAxis);
          zAxis.copy(baseOrientationBasis.zAxis);
        }

        const group = new THREE.Group();
        group.name = `DatumReferenceFrameOverlay-${frame.id || frame.entityId || "active"}`;
        group.renderOrder = 45;

        const axisLength = Math.max(modelSizeMax * 0.12, 0.65);
        const badgeText = frame.label || frame.name || "DRF";
        const badgePoint = origin.clone()
          .addScaledVector(xAxis, axisLength * 0.2)
          .addScaledVector(yAxis, axisLength * 0.2)
          .addScaledVector(zAxis, axisLength * 0.12);
        if (drfBadgeOverlay && candidate.showBadge !== false) {
          const badgeElement = document.createElement("div");
          badgeElement.className = "absolute left-0 top-0 hidden h-4 min-w-0 items-center justify-center border border-slate-800 bg-white/95 px-1 font-mono text-[7.5px] font-black leading-none text-slate-800 shadow-sm backdrop-blur-sm";
          badgeElement.style.transform = "translate3d(0, 0, 0) translate(-50%, -50%)";
          badgeElement.style.willChange = "transform";
          badgeElement.style.whiteSpace = "nowrap";
          badgeElement.dataset.drfBadge = "true";
          badgeElement.textContent = badgeText;
          badgeElement.title = `Datum reference frame ${badgeText}`;
          drfBadgeOverlay.appendChild(badgeElement);
          drfBadgeCache.push({
            id: frame.id || frame.entityId || "active",
            element: badgeElement,
            object: assemblyGroup,
            localPoint: badgePoint,
          });
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

    const drawPmiDimensionToleranceOverlay = () => {
      if (!propsRef.current.showDimensionalTolerances) return;
      const dimensionTolerances = (propsRef.current.tolerances || [])
        .filter((tolerance: any) => tolerance?.category === "Dimension" && Array.isArray(tolerance.targetIds) && tolerance.targetIds.length > 0);
      if (dimensionTolerances.length === 0) return;

      const group = new THREE.Group();
      group.name = "PmiDimensionToleranceOverlay";
      const labelOverlay = document.getElementById("pmi-dimensional-labels-overlay");

      const getFaceNamesForTolerance = (tolerance: any): string[] => {
        const mappedNames = (tolerance.targetIds || [])
          .map((targetId: string) =>
            mapTargetToWebGLName(targetId, "", false) ||
            mapTargetToTopologicalWebGLName(targetId)
          )
          .filter((name: string | null): name is string => !!name)
          .filter((name: string, index: number, all: string[]) => all.indexOf(name) === index);
        if (
          tolerance.dimensionKind !== "linear" &&
          tolerance.dimensionKind !== "size" &&
          tolerance.dimensionKind !== "angular" &&
          !tolerance.isDatumTargetDimension &&
          !tolerance.isCounterboreDimension &&
          !tolerance.isCountersinkDimension
        ) {
          const cylindricalName = mappedNames.find((name) => {
            const object = renderedObjectByName.get(name);
            const cache = object?.userData.interactionCache;
            return cache?.cylinderAxis instanceof THREE.Vector3 && !(cache?.coherentNormal instanceof THREE.Vector3);
          });
          return (cylindricalName || mappedNames[0]) ? [cylindricalName || mappedNames[0]] : [];
        }
        return mappedNames;
      };

      const makeVectorFromParsedPoint = (point: any): THREE.Vector3 | null => {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) return null;
        return new THREE.Vector3(Number(point.x), Number(point.y), Number(point.z));
      };

      const isCylindricalFace = (faceName: string) => {
        const object = renderedObjectByName.get(faceName);
        const cache = object?.userData.interactionCache;
        return cache?.cylinderAxis instanceof THREE.Vector3 && !(cache?.coherentNormal instanceof THREE.Vector3);
      };

      const getPrimaryCylindricalFaceName = (faceNames: string[]) =>
        faceNames.find(isCylindricalFace) || null;

      const getCylindricalFaceRadius = (faceName: string): number | null => {
        const object = renderedObjectByName.get(faceName);
        const cache = object?.userData.interactionCache;
        if (!object || !(cache?.localCenter instanceof THREE.Vector3) || !(cache.cylinderAxis instanceof THREE.Vector3)) return null;
        const axis = getAssemblyDirection(object, cache.cylinderAxis.clone());
        if (!axis) return null;
        const center = assemblyGroup.worldToLocal(object.localToWorld(cache.localCenter.clone()));
        const surfacePoint = assemblyGroup.worldToLocal(object.localToWorld(getStableSurfacePoint(object)));
        const axisFoot = center.clone().addScaledVector(axis, surfacePoint.clone().sub(center).dot(axis));
        const radius = surfacePoint.distanceTo(axisFoot);
        return Number.isFinite(radius) && radius > 1e-8 ? radius : null;
      };

      const getLargestCylindricalFaceName = (faceNames: string[]): string | null =>
        faceNames
          .filter(isCylindricalFace)
          .map((name) => ({ name, radius: getCylindricalFaceRadius(name) }))
          .filter((candidate): candidate is { name: string; radius: number } => candidate.radius !== null)
          .sort((a, b) => b.radius - a.radius)[0]?.name || null;

      const getBoundarySideHoleCalloutFaceName = (faceNames: string[], tolerance: any): string | null => {
        if (tolerance?.isCounterboreDimension) {
          return getLargestCylindricalFaceName(faceNames) || getPrimaryCylindricalFaceName(faceNames);
        }
        if (tolerance?.isCountersinkDimension) {
          return getPrimaryCylindricalFaceName(faceNames) || getNearestCylindricalFaceName(faceNames);
        }
        return getPrimaryCylindricalFaceName(faceNames);
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

      const makeMeasurementFrameBasis = (frame: any): MeasurementFrameBasis | null => {
        const basis = frame?.frameBasis;
        if (!basis?.xAxis || !basis?.yAxis || !basis?.zAxis) return null;
        const xAxis = new THREE.Vector3(basis.xAxis.x, basis.xAxis.y, basis.xAxis.z);
        const yAxis = new THREE.Vector3(basis.yAxis.x, basis.yAxis.y, basis.yAxis.z);
        const zAxis = new THREE.Vector3(basis.zAxis.x, basis.zAxis.y, basis.zAxis.z);
        if (xAxis.lengthSq() <= 1e-8 || yAxis.lengthSq() <= 1e-8 || zAxis.lengthSq() <= 1e-8) return null;
        return {
          xAxis: xAxis.normalize(),
          yAxis: yAxis.normalize(),
          zAxis: zAxis.normalize()
        };
      };

      const getPrimaryMeasurementFrameBasis = (): MeasurementFrameBasis | null => {
        const frames = propsRef.current.datumReferenceFrames || [];
        const sortedFrames = [...frames]
          .filter((frame: any) => !!makeMeasurementFrameBasis(frame))
          .sort((a: any, b: any) => {
            const aRefs = Array.isArray(a.references) ? a.references.length : 0;
            const bRefs = Array.isArray(b.references) ? b.references.length : 0;
            const aPrimary = (a.references || []).some((reference: any) => reference.precedence === 1) ? 1 : 0;
            const bPrimary = (b.references || []).some((reference: any) => reference.precedence === 1) ? 1 : 0;
            return bPrimary - aPrimary || bRefs - aRefs;
          });
        return makeMeasurementFrameBasis(sortedFrames[0]);
      };

      const getToleranceMeasurementFrameBasis = (tolerance: any): MeasurementFrameBasis | null => {
        return makeMeasurementFrameBasis(tolerance?.datumReferenceFrame) || getPrimaryMeasurementFrameBasis();
      };

      const makeDimensionTextElement = (tolerance: any, datumIdentifiers: string[] = []) => {
        const nominal = Number.isFinite(tolerance.nominalDimension) ? Number(tolerance.nominalDimension) : null;
        const upper = Number.isFinite(tolerance.upperTolerance) ? Number(tolerance.upperTolerance) : null;
        const lower = Number.isFinite(tolerance.lowerTolerance) ? Number(tolerance.lowerTolerance) : null;
        const dimensionLowerLimit = Number.isFinite(tolerance.dimensionLowerLimit) ? Number(tolerance.dimensionLowerLimit) : null;
        const dimensionUpperLimit = Number.isFinite(tolerance.dimensionUpperLimit) ? Number(tolerance.dimensionUpperLimit) : null;
        const hasDimensionLimitRange = dimensionLowerLimit !== null && dimensionUpperLimit !== null;
        const pilotNominal = Number.isFinite(tolerance.counterboreHoleNominal) ? Number(tolerance.counterboreHoleNominal) : null;
        const pilotUpper = Number.isFinite(tolerance.counterboreHoleUpperTolerance) ? Number(tolerance.counterboreHoleUpperTolerance) : null;
        const pilotLower = Number.isFinite(tolerance.counterboreHoleLowerTolerance) ? Number(tolerance.counterboreHoleLowerTolerance) : null;
        const nominalText = nominal !== null ? nominal.toFixed(3) : "DIM";
        const preModifier = `${tolerance.dimensionPreModifier || ""}`.trim();
        const dimensionLimitPreModifier = `${tolerance.dimensionLimitPreModifier || ""}`.trim();
        const dimensionLimitNote = `${tolerance.dimensionLimitNote || ""}`.trim();
        const counterboreEvaluationNote = `${tolerance.counterboreEvaluationNote || ""}`.trim();
        const counterborePreModifier = tolerance.isCounterboreDimension && counterboreEvaluationNote ? "" : preModifier;
        const modifiedNominalText = preModifier ? `${preModifier} ${nominalText}` : nominalText;
        const diameterSymbol = tolerance.isSphericalDimension ? "S\u2300" : "\u2300";
        const diameterNominalText = `${preModifier ? `${preModifier} ` : ""}${diameterSymbol}${nominalText}`;
        const dimensionLimitText = hasDimensionLimitRange
          ? `${dimensionLimitPreModifier ? `${dimensionLimitPreModifier} ` : ""}${tolerance.dimensionKind === "radius" ? "R" : ""}${dimensionLowerLimit.toFixed(3)} - ${dimensionUpperLimit.toFixed(3)}`
          : "";
        const threadDesignation = `${tolerance.threadDesignation || ""}`.trim();
        const depthNominal = Number.isFinite(tolerance.counterboreDepthNominal)
          ? Number(tolerance.counterboreDepthNominal)
          : null;
        const depthUpper = Number.isFinite(tolerance.counterboreDepthUpperTolerance)
          ? Number(tolerance.counterboreDepthUpperTolerance)
          : null;
        const depthLower = Number.isFinite(tolerance.counterboreDepthLowerTolerance)
          ? Number(tolerance.counterboreDepthLowerTolerance)
          : null;
        const countersinkAngle = Number.isFinite(tolerance.countersinkAngleNominal)
          ? Number(tolerance.countersinkAngleNominal)
          : null;
        const countersinkAngleUpper = Number.isFinite(tolerance.countersinkAngleUpperTolerance)
          ? Number(tolerance.countersinkAngleUpperTolerance)
          : null;
        const countersinkAngleLower = Number.isFinite(tolerance.countersinkAngleLowerTolerance)
          ? Number(tolerance.countersinkAngleLowerTolerance)
          : null;
        const baseMainText = hasDimensionLimitRange
          ? dimensionLimitText
          : tolerance.isCountersinkDimension
          ? `${preModifier ? `${preModifier} ` : ""}\u2335 \u2300${nominalText}`
        : tolerance.isCounterboreDimension
          ? `${counterborePreModifier ? `${counterborePreModifier} ` : ""}\u2334 \u2300${nominalText}`
        : tolerance.dimensionKind === "threadDepth" && threadDesignation
          ? `${preModifier ? `${preModifier} ` : ""}${threadDesignation} \u21a7 ${nominalText}`
          : tolerance.dimensionKind === "diameter"
          ? diameterNominalText
          : tolerance.dimensionKind === "radius" && tolerance.isControlledRadiusDimension
          ? `${preModifier ? `${preModifier} ` : ""}CR ${nominalText}`
          : tolerance.dimensionKind === "radius" && tolerance.isSphericalDimension
          ? `${preModifier ? `${preModifier} ` : ""}SR ${nominalText}`
          : tolerance.dimensionKind === "radius"
          ? `${preModifier ? `${preModifier} ` : ""}R ${nominalText}`
          : `${modifiedNominalText}${tolerance.dimensionKind === "angular" ? "\u00b0" : ""}`;
        const mainText = tolerance.isBasicDimension
          ? `[${baseMainText}]`
          : tolerance.isReferenceDimension
            ? `(${baseMainText})`
            : baseMainText;
        const upperText = !hasDimensionLimitRange && upper !== null ? `+${upper.toFixed(3)}` : "";
        const lowerText = !hasDimensionLimitRange && lower !== null ? `${lower.toFixed(3)}` : "";

        const element = document.createElement("div");
        element.dataset.pmiDimensionLabel = "true";
        element.className = "absolute left-0 top-0 hidden items-center gap-1 whitespace-nowrap font-mono leading-none text-slate-900";
        element.style.transform = "translate3d(0, 0, 0) translate(0, -50%)";
        element.style.willChange = "transform";
        element.style.pointerEvents = "none";
        element.style.fontSize = "13px";
        element.style.contain = "layout style paint";
        element.style.zIndex = "19";

        datumIdentifiers.forEach((identifier) => {
          const datumElement = document.createElement("span");
          datumElement.textContent = identifier;
          datumElement.style.display = "inline-flex";
          datumElement.style.alignItems = "center";
          datumElement.style.justifyContent = "center";
          datumElement.style.minWidth = "28px";
          datumElement.style.height = "24px";
          datumElement.style.border = "2px solid #0f172a";
          datumElement.style.background = "rgba(248, 250, 252, 0.92)";
          datumElement.style.color = "#0f172a";
          datumElement.style.fontSize = "11px";
          datumElement.style.fontWeight = "900";
          datumElement.style.lineHeight = "1";
          datumElement.style.padding = "0 6px";
          datumElement.style.boxSizing = "border-box";
          element.appendChild(datumElement);
        });

        const makeNominalSpan = (text: string) => {
          const span = document.createElement("span");
          span.textContent = text;
          span.style.fontSize = "13px";
          span.style.fontWeight = "300";
          span.style.lineHeight = "1";
          return span;
        };

        const nominalElement = document.createElement("span");
        nominalElement.textContent = mainText;
        nominalElement.style.fontSize = "13px";
        nominalElement.style.fontWeight = "300";
        nominalElement.style.lineHeight = "1";

        const makeLimitsElement = (topText: string, bottomText: string) => {
          const limitsElement = document.createElement("span");
          limitsElement.className = "flex flex-col items-start justify-center";
          limitsElement.style.fontSize = "9px";
          limitsElement.style.fontWeight = "300";
          limitsElement.style.lineHeight = "0.9";
          const upperElement = document.createElement("span");
          upperElement.textContent = topText;
          const lowerElement = document.createElement("span");
          lowerElement.textContent = bottomText;
          limitsElement.appendChild(upperElement);
          limitsElement.appendChild(lowerElement);
          return limitsElement;
        };

        if (tolerance.isCounterboreDimension && (pilotNominal !== null || counterboreEvaluationNote) && nominal !== null) {
          element.className = "absolute left-0 top-0 hidden flex-col items-start gap-0.5 whitespace-nowrap font-mono leading-none text-slate-900";
          element.style.transform = "translate3d(0, 0, 0) translate(0, -50%)";

          const makeRow = (main: string, top: string, bottom: string) => {
            const row = document.createElement("div");
            row.style.display = "inline-flex";
            row.style.alignItems = "center";
            row.style.gap = "4px";
            row.appendChild(makeNominalSpan(main));
            row.appendChild(makeLimitsElement(top, bottom));
            return row;
          };

          if (pilotNominal !== null) {
            element.appendChild(makeRow(
              `${preModifier ? `${preModifier} ` : ""}\u2300${pilotNominal.toFixed(3)}`,
              pilotUpper !== null ? `+${pilotUpper.toFixed(3)}` : "",
              pilotLower !== null ? `${pilotLower.toFixed(3)}` : ""
            ));
          }
          const counterboreRow = makeRow(
            `${counterborePreModifier ? `${counterborePreModifier} ` : ""}\u2334 \u2300${nominalText}`,
            upper !== null ? `+${upper.toFixed(3)}` : "",
            lower !== null ? `${lower.toFixed(3)}` : ""
          );
          if (depthNominal !== null) {
            counterboreRow.appendChild(makeNominalSpan(`\u21a7 ${depthNominal.toFixed(3)}`));
            counterboreRow.appendChild(makeLimitsElement(
              depthUpper !== null ? `+${depthUpper.toFixed(3)}` : "",
              depthLower !== null ? `${depthLower.toFixed(3)}` : ""
            ));
          }
          element.appendChild(counterboreRow);
          if (counterboreEvaluationNote) {
            const noteElement = document.createElement("div");
            noteElement.textContent = counterboreEvaluationNote;
            noteElement.style.fontSize = "10px";
            noteElement.style.fontWeight = "300";
            noteElement.style.lineHeight = "1";
            element.appendChild(noteElement);
          }
          return element;
        }

        element.appendChild(nominalElement);
        if (hasDimensionLimitRange && dimensionLimitNote) {
          element.className = "absolute left-0 top-0 hidden flex-col items-start gap-0.5 whitespace-nowrap font-mono leading-none text-slate-900";
        }
        if (tolerance.isStatisticalTolerance) {
          const statisticalElement = document.createElement("span");
          statisticalElement.textContent = "ST";
          statisticalElement.title = "Statistical tolerance";
          statisticalElement.style.display = "inline-flex";
          statisticalElement.style.alignItems = "center";
          statisticalElement.style.justifyContent = "center";
          statisticalElement.style.width = "18px";
          statisticalElement.style.height = "18px";
          statisticalElement.style.border = "1.4px solid #0f172a";
          statisticalElement.style.borderRadius = "999px";
          statisticalElement.style.fontSize = "7px";
          statisticalElement.style.fontWeight = "600";
          statisticalElement.style.lineHeight = "1";
          statisticalElement.style.letterSpacing = "0";
          element.appendChild(statisticalElement);
        }
        if (!hasDimensionLimitRange) {
          element.appendChild(makeLimitsElement(upperText, lowerText));
        }
        if (hasDimensionLimitRange && dimensionLimitNote) {
          const noteElement = document.createElement("span");
          noteElement.textContent = dimensionLimitNote;
          noteElement.style.fontSize = "9px";
          noteElement.style.fontWeight = "300";
          noteElement.style.lineHeight = "1";
          element.appendChild(noteElement);
        }

        if (depthNominal !== null) {
          const depthNominalElement = document.createElement("span");
          depthNominalElement.textContent = `\u21a7 ${depthNominal.toFixed(3)}`;
          depthNominalElement.style.fontSize = "13px";
          depthNominalElement.style.fontWeight = "300";
          depthNominalElement.style.lineHeight = "1";
          element.appendChild(depthNominalElement);
          element.appendChild(makeLimitsElement(
            depthUpper !== null ? `+${depthUpper.toFixed(3)}` : "",
            depthLower !== null ? `${depthLower.toFixed(3)}` : ""
          ));
        }

        if (tolerance.isCountersinkDimension && countersinkAngle !== null) {
          const separatorElement = document.createElement("span");
          separatorElement.textContent = "\u00d7";
          separatorElement.style.fontSize = "12px";
          separatorElement.style.fontWeight = "300";
          separatorElement.style.lineHeight = "1";
          element.appendChild(separatorElement);

          const angleElement = document.createElement("span");
          angleElement.textContent = `${countersinkAngle.toFixed(3)}\u00b0`;
          angleElement.style.fontSize = "13px";
          angleElement.style.fontWeight = "300";
          angleElement.style.lineHeight = "1";
          element.appendChild(angleElement);
          element.appendChild(makeLimitsElement(
            countersinkAngleUpper !== null ? `+${countersinkAngleUpper.toFixed(3)}\u00b0` : "",
            countersinkAngleLower !== null ? `${countersinkAngleLower.toFixed(3)}\u00b0` : ""
          ));
        }
        return element;
      };

      const addPmiDimensionLabel = (
        tolerance: any,
        point: THREE.Vector3,
        datumIdentifiers: string[] = [],
        resolvePoint?: () => THREE.Vector3 | null,
        resolveTransform?: () => string
      ) => {
        if (!labelOverlay) return null;
        const element = makeDimensionTextElement(tolerance, datumIdentifiers);
        labelOverlay.appendChild(element);
        const entry = {
          element,
          point: point.clone(),
          resolvePoint,
          resolveTransform,
          screenX: Number.NaN,
          screenY: Number.NaN,
          visible: false
        };
        pmiDimensionLabelCache.push(entry);
        return entry;
      };

      const makeDimensionStackTextElement = (tolerances: any[]) => {
        const element = document.createElement("div");
        element.dataset.pmiDimensionLabel = "true";
        element.className = "absolute left-0 top-0 hidden flex-col items-start gap-0.5 whitespace-nowrap font-mono leading-none text-slate-900";
        element.style.transform = "translate3d(0, 0, 0) translate(0, -50%)";
        element.style.willChange = "transform";
        element.style.pointerEvents = "none";
        element.style.fontSize = "13px";
        element.style.contain = "layout style paint";
        element.style.zIndex = "19";
        tolerances.forEach((tolerance) => {
          const row = makeDimensionTextElement(tolerance);
          row.style.position = "static";
          row.style.display = "flex";
          row.style.transform = "";
          row.style.willChange = "";
          element.appendChild(row);
        });
        return element;
      };

      const addPmiDimensionStackLabel = (
        tolerances: any[],
        point: THREE.Vector3,
        resolvePoint?: () => THREE.Vector3 | null,
        resolveTransform?: () => string
      ) => {
        if (!labelOverlay || tolerances.length === 0) return null;
        const element = tolerances.length === 1
          ? makeDimensionTextElement(tolerances[0])
          : makeDimensionStackTextElement(tolerances);
        labelOverlay.appendChild(element);
        const entry = {
          element,
          point: point.clone(),
          resolvePoint,
          resolveTransform,
          screenX: Number.NaN,
          screenY: Number.NaN,
          visible: false
        };
        pmiDimensionLabelCache.push(entry);
        return entry;
      };

      const makeFaceSample = (faceName: string): MeasurementSample | null => {
        const object = renderedObjectByName.get(faceName);
        if (!object) return null;
        const frame = getFaceFrameInAssembly(faceName);
        const localAnchor = getStableSurfacePoint(object);
        const point = assemblyGroup.worldToLocal(object.localToWorld(localAnchor.clone()));
        const normal = frame?.normal?.clone().normalize();
        const isCylinder = isCylindricalFace(faceName);
        return {
          point,
          kind: isCylinder ? "cylinder" : "face",
          objectName: faceName,
          normal,
          planeConstant: normal && frame ? normal.dot(frame.center) : undefined
        };
      };

      const makePointTargetDimensionResult = (tolerance: any): LinearMeasurementResult | null => {
        const points = (tolerance.targetPoints || [])
          .map(makeVectorFromParsedPoint)
          .filter((point: THREE.Vector3 | null): point is THREE.Vector3 => !!point);
        if (points.length < 2) return null;

        let bestPair: { start: THREE.Vector3; end: THREE.Vector3; distanceSq: number } | null = null;
        for (let i = 0; i < points.length; i++) {
          for (let j = i + 1; j < points.length; j++) {
            const distanceSq = points[i].distanceToSquared(points[j]);
            if (!bestPair || distanceSq > bestPair.distanceSq) {
              bestPair = { start: points[i], end: points[j], distanceSq };
            }
          }
        }
        if (!bestPair || bestPair.distanceSq <= 1e-10) return null;

        return {
          mode: "linear",
          start: bestPair.start,
          end: bestPair.end,
          text: Number.isFinite(tolerance.nominalDimension)
            ? Number(tolerance.nominalDimension).toFixed(3)
          : Math.sqrt(bestPair.distanceSq).toFixed(3)
        };
      };

      const getLineSegmentClosestPoints = (
        firstStart: THREE.Vector3,
        firstEnd: THREE.Vector3,
        secondStart: THREE.Vector3,
        secondEnd: THREE.Vector3
      ): { start: THREE.Vector3; end: THREE.Vector3; distanceSq: number } | null => {
        const u = firstEnd.clone().sub(firstStart);
        const v = secondEnd.clone().sub(secondStart);
        const w = firstStart.clone().sub(secondStart);
        const a = u.dot(u);
        const b = u.dot(v);
        const c = v.dot(v);
        const d = u.dot(w);
        const e = v.dot(w);
        const small = 1e-10;
        if (a <= small || c <= small) return null;

        const denominator = a * c - b * b;
        let s = denominator <= small ? 0 : THREE.MathUtils.clamp((b * e - c * d) / denominator, 0, 1);
        let t = (b * s + e) / c;
        if (t < 0) {
          t = 0;
          s = THREE.MathUtils.clamp(-d / a, 0, 1);
        } else if (t > 1) {
          t = 1;
          s = THREE.MathUtils.clamp((b - d) / a, 0, 1);
        }

        const start = firstStart.clone().addScaledVector(u, s);
        const end = secondStart.clone().addScaledVector(v, t);
        return { start, end, distanceSq: start.distanceToSquared(end) };
      };

      const makeLineTargetMinimumDistanceResult = (tolerance: any): LinearMeasurementResult | null => {
        const points = (tolerance.targetPoints || [])
          .map(makeVectorFromParsedPoint)
          .filter((point: THREE.Vector3 | null): point is THREE.Vector3 => !!point);
        if (points.length !== 4) return null;

        const pairings: Array<[number, number, number, number]> = [
          [0, 1, 2, 3],
          [0, 2, 1, 3],
          [0, 3, 1, 2]
        ];
        const nominal = Number.isFinite(tolerance.nominalDimension) ? Number(tolerance.nominalDimension) : null;
        const candidates = pairings
          .map(([a, b, c, d]) => getLineSegmentClosestPoints(points[a], points[b], points[c], points[d]))
          .filter((candidate): candidate is { start: THREE.Vector3; end: THREE.Vector3; distanceSq: number } =>
            !!candidate && candidate.distanceSq > 1e-10
          )
          .map((candidate) => ({
            ...candidate,
            distance: Math.sqrt(candidate.distanceSq)
          }))
          .sort((a, b) => {
            if (nominal !== null) {
              const nominalScoreA = Math.abs(a.distance - nominal);
              const nominalScoreB = Math.abs(b.distance - nominal);
              if (Math.abs(nominalScoreA - nominalScoreB) > 1e-6) return nominalScoreA - nominalScoreB;
            }
            return a.distance - b.distance;
          });

        const best = candidates[0];
        if (!best) return null;
        return {
          mode: "linear",
          start: best.start,
          end: best.end,
          text: nominal !== null ? nominal.toFixed(3) : best.distance.toFixed(3)
        };
      };

      const getPointTargetLabelPoint = (tolerance: any): THREE.Vector3 | null => {
        const points = (tolerance.targetPoints || [])
          .map(makeVectorFromParsedPoint)
          .filter((point: THREE.Vector3 | null): point is THREE.Vector3 => !!point);
        if (points.length === 0) return null;
        return points
          .reduce((acc, point) => acc.add(point), new THREE.Vector3())
          .multiplyScalar(1 / points.length);
      };

      const canDrawCircularPointTargetDimension = (tolerance: any): boolean => {
        const pointCount = Array.isArray(tolerance.targetPoints) ? tolerance.targetPoints.length : 0;
        const targetCount = Array.isArray(tolerance.targetIds) ? tolerance.targetIds.length : 0;
        const preModifier = `${tolerance.dimensionPreModifier || ""}`.trim();
        if (preModifier && targetCount > 1) return false;
        return pointCount >= 2 && pointCount <= 4;
      };

      const isRepeatedCircularPointTargetPattern = (tolerance: any): boolean => {
        const pointCount = Array.isArray(tolerance.targetPoints) ? tolerance.targetPoints.length : 0;
        const targetCount = Array.isArray(tolerance.targetIds) ? tolerance.targetIds.length : 0;
        const preModifier = `${tolerance.dimensionPreModifier || ""}`.trim();
        return !!preModifier && targetCount > 1 && pointCount > 4;
      };

      const getNearestCylindricalFaceName = (faceNames: string[]): string | null => {
        const referenceSamples = faceNames
          .map(makeFaceSample)
          .filter((sample): sample is MeasurementSample => !!sample);
        if (referenceSamples.length === 0) return null;

        const referenceCenter = referenceSamples
          .reduce((acc, sample) => acc.add(sample.point), new THREE.Vector3())
          .multiplyScalar(1 / referenceSamples.length);

        return Array.from(renderedObjectByName.keys())
          .filter((name) => name.startsWith("BRepFace-") && isCylindricalFace(name))
          .map((name) => {
            const object = renderedObjectByName.get(name);
            const cache = object?.userData.interactionCache;
            const cylinderCenter = object && cache?.localCenter instanceof THREE.Vector3
              ? assemblyGroup.worldToLocal(object.localToWorld(cache.localCenter.clone()))
              : getFaceFrameInAssembly(name)?.center;
            return cylinderCenter
              ? { name, distance: cylinderCenter.distanceToSquared(referenceCenter) }
              : null;
          })
          .filter((candidate): candidate is { name: string; distance: number } => !!candidate)
          .sort((a, b) => a.distance - b.distance)[0]?.name || null;
      };

      const makeDiameterResult = (faceName: string): LinearMeasurementResult | null => {
        const object = renderedObjectByName.get(faceName);
        const cache = object?.userData.interactionCache;
        if (!object || !cache?.localCenter || !(cache.cylinderAxis instanceof THREE.Vector3)) return null;

        const axis = getAssemblyDirection(object, cache.cylinderAxis.clone());
        if (!axis) return null;
        const center = assemblyGroup.worldToLocal(object.localToWorld(cache.localCenter.clone()));
        const surfacePoint = assemblyGroup.worldToLocal(object.localToWorld(getStableSurfacePoint(object)));
        const axisFoot = center.clone().addScaledVector(axis, surfacePoint.clone().sub(center).dot(axis));
        let radial = surfacePoint.clone().sub(axisFoot);
        let radius = radial.length();
        if (radius <= 1e-8) {
          const viewDirection = assemblyGroup.worldToLocal(camera.position.clone()).sub(center).normalize();
          radial = new THREE.Vector3().crossVectors(axis, viewDirection);
          if (radial.lengthSq() <= 1e-8) radial.crossVectors(axis, new THREE.Vector3(1, 0, 0));
          if (radial.lengthSq() <= 1e-8) radial.crossVectors(axis, new THREE.Vector3(0, 1, 0));
          radial.normalize();
          const size = cache.size instanceof THREE.Vector3 ? cache.size : new THREE.Vector3(modelSizeMax * 0.03, modelSizeMax * 0.03, modelSizeMax * 0.03);
          const sorted = [size.x, size.y, size.z].filter((value) => value > 1e-8).sort((a, b) => a - b);
          radius = Math.max((sorted[0] || modelSizeMax * 0.03) * 0.5, modelSizeMax * 0.005);
        } else {
          radial.normalize();
        }

        return {
          mode: "linear",
          start: center.clone().addScaledVector(radial, -radius),
          end: center.clone().addScaledVector(radial, radius),
          text: `DIA ${formatMm(radius * 2)}`,
          diameterReference: true
        };
      };

      const getCylinderAxisCenter = (faceName: string): THREE.Vector3 | null => {
        const object = renderedObjectByName.get(faceName);
        const cache = object?.userData.interactionCache;
        if (!object || !(cache?.localCenter instanceof THREE.Vector3)) return null;
        return assemblyGroup.worldToLocal(object.localToWorld(cache.localCenter.clone()));
      };

      const getStackedHoleDimensionKey = (tolerance: any): string | null => {
        if (tolerance.dimensionKind !== "diameter" && tolerance.dimensionKind !== "radius") return null;
        if (tolerance.isCounterboreDimension || tolerance.isCountersinkDimension || tolerance.isSphericalDimension) return null;
        if (!Number.isFinite(tolerance.nominalDimension)) return null;
        const targets = Array.isArray(tolerance.targetIds) ? [...tolerance.targetIds].sort() : [];
        if (targets.length === 0) return null;
        return [
          tolerance.dimensionKind,
          `${Number(tolerance.nominalDimension).toFixed(6)}`,
          `${tolerance.dimensionPreModifier || ""}`.trim(),
          targets.join("|")
        ].join("::");
      };

      const stackedHoleDimensionGroups = new Map<string, any[]>();
      dimensionTolerances.forEach((tolerance: any) => {
        const key = getStackedHoleDimensionKey(tolerance);
        if (!key) return;
        const groupItems = stackedHoleDimensionGroups.get(key) || [];
        groupItems.push(tolerance);
        stackedHoleDimensionGroups.set(key, groupItems);
      });
      const stackedHoleDimensionOwnerById = new Map<string, any[]>();
      stackedHoleDimensionGroups.forEach((groupItems) => {
        if (groupItems.length < 2) return;
        groupItems.forEach((item, index) => {
          stackedHoleDimensionOwnerById.set(item.id, index === 0 ? groupItems : []);
        });
      });

      const makeCylinderCenterDistanceResult = (faceNames: string[], tolerance?: any): LinearMeasurementResult | null => {
        const cylinderCenters = faceNames
          .filter(isCylindricalFace)
          .map((name) => ({ name, center: getCylinderAxisCenter(name) }))
          .filter((item): item is { name: string; center: THREE.Vector3 } => !!item.center);
        if (cylinderCenters.length < 2) return null;

        let bestPair: [THREE.Vector3, THREE.Vector3] | null = null;
        let bestScore = Number.POSITIVE_INFINITY;
        const nominal = Number.isFinite(tolerance?.nominalDimension)
          ? Number(tolerance.nominalDimension)
          : null;
        for (let i = 0; i < cylinderCenters.length; i++) {
          for (let j = i + 1; j < cylinderCenters.length; j++) {
            const distance = cylinderCenters[i].center.distanceTo(cylinderCenters[j].center);
            const score = nominal !== null ? Math.abs(distance - nominal) : distance;
            if (score < bestScore) {
              bestScore = score;
              bestPair = [cylinderCenters[i].center, cylinderCenters[j].center];
            }
          }
        }

        if (!bestPair) return null;
        const selectedDistance = bestPair[0].distanceTo(bestPair[1]);
        if (selectedDistance <= 1e-8) return null;
        const axis = bestPair[1].clone().sub(bestPair[0]).normalize();
        return {
          mode: "linear",
          start: bestPair[0].clone(),
          end: bestPair[0].clone().addScaledVector(axis, selectedDistance),
          text: formatMm(selectedDistance)
        };
      };

      const computeHoleToleranceLeaderGeometry = (
        faceName: string,
        slotIndex = 0,
        slotCount = 1,
        fixedAnchor?: { surfacePoint: THREE.Vector3; radialDirection: THREE.Vector3 },
        tolerance?: any
      ) => {
        const object = renderedObjectByName.get(faceName);
        const cache = object?.userData.interactionCache;
        if (!object || !cache?.localCenter || !(cache.cylinderAxis instanceof THREE.Vector3)) return null;

        const cylinderAxis = getAssemblyDirection(object, cache.cylinderAxis.clone());
        if (!cylinderAxis) return null;
        const viewLocal = assemblyGroup.worldToLocal(camera.position.clone());

        let surfacePoint: THREE.Vector3;
        let radialDirection: THREE.Vector3;
        if (fixedAnchor) {
          surfacePoint = fixedAnchor.surfacePoint.clone();
          radialDirection = fixedAnchor.radialDirection.clone();
        } else {
          const localAxis = cache.cylinderAxis.clone().normalize();
          const localAxisOrigin = cache.localCenter.clone();
          let localPoint = getStableSurfacePoint(object);
          let localAxisFoot = localAxisOrigin.clone().addScaledVector(
            localAxis,
            localPoint.clone().sub(localAxisOrigin).dot(localAxis)
          );
          let localRadialDirection = localPoint.clone().sub(localAxisFoot);
          if (localRadialDirection.lengthSq() <= 1e-8) {
            localRadialDirection.crossVectors(localAxis, new THREE.Vector3(1, 0, 0));
            if (localRadialDirection.lengthSq() <= 1e-8) {
              localRadialDirection.crossVectors(localAxis, new THREE.Vector3(0, 1, 0));
            }
          }
          localRadialDirection.normalize();
          if (slotCount > 1) {
            const stepAngle = Math.PI / Math.max(slotCount + 1, 2);
            const slotOffset = (slotIndex - (slotCount - 1) / 2) * stepAngle;
            localRadialDirection.applyAxisAngle(localAxis, slotOffset).normalize();
          }
          const biasRadialAwayFromCameraHorizontal = () => {
            const cameraWorldPoint = camera.position.clone();
            const cameraRightWorldPoint = cameraWorldPoint.clone().add(new THREE.Vector3(1, 0, 0).transformDirection(camera.matrixWorld));
            const cameraUpWorldPoint = cameraWorldPoint.clone().add(new THREE.Vector3(0, 1, 0).transformDirection(camera.matrixWorld));
            const localCameraPoint = object.worldToLocal(cameraWorldPoint.clone());
            const localCameraRight = object.worldToLocal(cameraRightWorldPoint).sub(localCameraPoint);
            const localCameraUp = object.worldToLocal(cameraUpWorldPoint).sub(localCameraPoint);
            localCameraRight.addScaledVector(localAxis, -localCameraRight.dot(localAxis));
            localCameraUp.addScaledVector(localAxis, -localCameraUp.dot(localAxis));
            if (localCameraRight.lengthSq() <= 1e-8 || localCameraUp.lengthSq() <= 1e-8) return;
            localCameraRight.normalize();
            localCameraUp.normalize();
            const horizontalAlignment = Math.abs(localRadialDirection.dot(localCameraRight));
            const verticalAlignment = Math.abs(localRadialDirection.dot(localCameraUp));
            if (horizontalAlignment < 0.82 || verticalAlignment > 0.32) return;
            const signedUp = localCameraUp.dot(localRadialDirection) >= 0
              ? localCameraUp
              : localCameraUp.clone().negate();
            localRadialDirection.lerp(signedUp, 0.45).addScaledVector(localAxis, -localRadialDirection.dot(localAxis));
            if (localRadialDirection.lengthSq() > 1e-8) localRadialDirection.normalize();
          };
          biasRadialAwayFromCameraHorizontal();

          if (object instanceof THREE.Mesh) {
            const cachedBounds = object.userData.pmiHoleAxisBounds as { minAxis: number; maxAxis: number } | undefined;
            const bounds = cachedBounds || (() => {
              const positionAttribute = object.geometry.getAttribute("position");
              let minAxis = Infinity;
              let maxAxis = -Infinity;
              for (let i = 0; i < positionAttribute.count; i++) {
                const vertex = new THREE.Vector3().fromBufferAttribute(positionAttribute, i);
                const axisValue = vertex.sub(localAxisOrigin).dot(localAxis);
                minAxis = Math.min(minAxis, axisValue);
                maxAxis = Math.max(maxAxis, axisValue);
              }
              const nextBounds = { minAxis, maxAxis };
              object.userData.pmiHoleAxisBounds = nextBounds;
              return nextBounds;
            })();

            if (Number.isFinite(bounds.minAxis) && Number.isFinite(bounds.maxAxis)) {
              const localPointAtAxis = (axisValue: number) =>
                localAxisOrigin.clone().addScaledVector(localAxis, axisValue);
              const radius = Math.max(localPoint.distanceTo(localAxisFoot), 1e-6);
              const minCandidate = {
                axisFoot: localPointAtAxis(bounds.minAxis),
                surfacePoint: localPointAtAxis(bounds.minAxis).addScaledVector(localRadialDirection, radius)
              };
              const maxCandidate = {
                axisFoot: localPointAtAxis(bounds.maxAxis),
                surfacePoint: localPointAtAxis(bounds.maxAxis).addScaledVector(localRadialDirection, radius)
              };
              const minWorld = object.localToWorld(minCandidate.surfacePoint.clone());
              const maxWorld = object.localToWorld(maxCandidate.surfacePoint.clone());
              const minAxisFootAssembly = assemblyGroup.worldToLocal(object.localToWorld(minCandidate.axisFoot.clone()));
              const maxAxisFootAssembly = assemblyGroup.worldToLocal(object.localToWorld(maxCandidate.axisFoot.clone()));
              const findCounterboreLipBoundaryCandidate = () => {
                if (!tolerance?.isCounterboreDimension) return null;
                const targetFaces = getFaceNamesForTolerance(tolerance).filter((name) => name !== faceName);
                if (targetFaces.length === 0) return null;
                const currentAxisOrigin = assemblyGroup.worldToLocal(object.localToWorld(localAxisOrigin.clone()));
                const currentDiameter = radius * 2;
                const candidates = targetFaces
                  .map((name) => {
                    const targetObject = renderedObjectByName.get(name);
                    const targetCache = targetObject?.userData.interactionCache;
                    if (!targetObject || !(targetCache?.localCenter instanceof THREE.Vector3) || !(targetCache.cylinderAxis instanceof THREE.Vector3)) return null;
                    if (targetCache.coherentNormal instanceof THREE.Vector3) return null;
                    const targetAxis = getAssemblyDirection(targetObject, targetCache.cylinderAxis.clone());
                    if (!targetAxis || Math.abs(targetAxis.dot(cylinderAxis)) < 0.92) return null;
                    const targetCenter = assemblyGroup.worldToLocal(targetObject.localToWorld(targetCache.localCenter.clone()));
                    const centerDelta = targetCenter.clone().sub(currentAxisOrigin);
                    const radialDistance = centerDelta.clone().addScaledVector(cylinderAxis, -centerDelta.dot(cylinderAxis)).length();
                    if (radialDistance > Math.max(radius * 0.35, modelSizeMax * 0.003, 1e-4)) return null;
                    const targetSurfacePoint = assemblyGroup.worldToLocal(targetObject.localToWorld(getStableSurfacePoint(targetObject)));
                    const targetAxisFoot = targetCenter.clone().addScaledVector(targetAxis, targetSurfacePoint.clone().sub(targetCenter).dot(targetAxis));
                    const targetDiameter = targetSurfacePoint.distanceTo(targetAxisFoot) * 2;
                    if (!Number.isFinite(targetDiameter) || targetDiameter <= currentDiameter + Math.max(currentDiameter * 0.08, modelSizeMax * 0.001)) return null;
                    return { name, targetDiameter };
                  })
                  .filter((candidate): candidate is { name: string; targetDiameter: number } => !!candidate)
                  .sort((a, b) => b.targetDiameter - a.targetDiameter);
                if (candidates.length === 0) return null;
                const counterboreObject = renderedObjectByName.get(candidates[0].name);
                const counterboreCache = counterboreObject?.userData.interactionCache;
                if (!counterboreObject || !(counterboreCache?.localCenter instanceof THREE.Vector3) || !(counterboreCache.cylinderAxis instanceof THREE.Vector3)) return null;
                const counterboreLocalAxis = counterboreCache.cylinderAxis.clone().normalize();
                const counterboreLocalOrigin = counterboreCache.localCenter.clone();
                const positionAttribute = (counterboreObject as THREE.Mesh).geometry?.getAttribute("position");
                if (!(positionAttribute instanceof THREE.BufferAttribute)) return null;
                let cbMinAxis = Infinity;
                let cbMaxAxis = -Infinity;
                for (let i = 0; i < positionAttribute.count; i++) {
                  const vertex = new THREE.Vector3().fromBufferAttribute(positionAttribute, i);
                  const axisValue = vertex.sub(counterboreLocalOrigin).dot(counterboreLocalAxis);
                  cbMinAxis = Math.min(cbMinAxis, axisValue);
                  cbMaxAxis = Math.max(cbMaxAxis, axisValue);
                }
                if (!Number.isFinite(cbMinAxis) || !Number.isFinite(cbMaxAxis)) return null;
                const counterborePointAtAxis = (axisValue: number) =>
                  assemblyGroup.worldToLocal(counterboreObject.localToWorld(
                    counterboreLocalOrigin.clone().addScaledVector(counterboreLocalAxis, axisValue)
                  ));
                const cbMinFoot = counterborePointAtAxis(cbMinAxis);
                const cbMaxFoot = counterborePointAtAxis(cbMaxAxis);
                const minDistance = Math.min(minAxisFootAssembly.distanceTo(cbMinFoot), minAxisFootAssembly.distanceTo(cbMaxFoot));
                const maxDistance = Math.min(maxAxisFootAssembly.distanceTo(cbMinFoot), maxAxisFootAssembly.distanceTo(cbMaxFoot));
                return minDistance <= maxDistance ? minCandidate : maxCandidate;
              };
              const findCoaxialConicalBoundaryCandidate = () => {
                const cachedPreference = object.userData.pmiConeBoundaryPreference as "min" | "max" | "none" | undefined;
                if (cachedPreference === "min") return minCandidate;
                if (cachedPreference === "max") return maxCandidate;
                if (cachedPreference === "none") return null;

                const axisOriginAssembly = assemblyGroup.worldToLocal(object.localToWorld(localAxisOrigin.clone()));
                const axisSpan = Math.abs(bounds.maxAxis - bounds.minAxis);
                const axisTolerance = Math.max(axisSpan * 0.22, modelSizeMax * 0.006, 1e-4);
                const radialTolerance = Math.max(radius * 1.6, modelSizeMax * 0.008, 1e-4);
                const coneRadiusTolerance = Math.max(radius * 0.12, modelSizeMax * 0.0015, 1e-4);
                let bestPreference: "min" | "max" | null = null;
                let bestScore = Infinity;

                assemblyGroup.children.forEach((child) => {
                  if (child === object || !child.name.startsWith("BRepFace-") || !(child instanceof THREE.Mesh)) return;
                  const childCache = child.userData.interactionCache;
                  if (childCache?.coherentNormal instanceof THREE.Vector3) return;
                  if (!(childCache?.cylinderAxis instanceof THREE.Vector3)) return;
                  const childAxis = getAssemblyDirection(child, childCache.cylinderAxis.clone());
                  if (!childAxis || Math.abs(childAxis.dot(cylinderAxis)) < 0.92) return;

                  const childOrigin = childCache.localCenter instanceof THREE.Vector3
                    ? assemblyGroup.worldToLocal(child.localToWorld(childCache.localCenter.clone()))
                    : getFaceFrameInAssembly(child.name)?.center;
                  if (!childOrigin) return;
                  const originDelta = childOrigin.clone().sub(axisOriginAssembly);
                  const originRadial = originDelta.clone().addScaledVector(cylinderAxis, -originDelta.dot(cylinderAxis)).length();
                  if (originRadial > radialTolerance) return;

                  const positionAttribute = child.geometry.getAttribute("position");
                  if (!(positionAttribute instanceof THREE.BufferAttribute) || positionAttribute.count < 6) return;

                  const samples: { axisValue: number; radiusValue: number }[] = [];
                  let childMinAxis = Infinity;
                  let childMaxAxis = -Infinity;
                  for (let i = 0; i < positionAttribute.count; i++) {
                    const vertex = new THREE.Vector3().fromBufferAttribute(positionAttribute, i);
                    const vertexAssembly = assemblyGroup.worldToLocal(child.localToWorld(vertex));
                    const delta = vertexAssembly.clone().sub(childOrigin);
                    const axisValue = delta.dot(childAxis);
                    const radialVector = delta.addScaledVector(childAxis, -axisValue);
                    const radiusValue = radialVector.length();
                    if (!Number.isFinite(axisValue) || !Number.isFinite(radiusValue)) continue;
                    samples.push({ axisValue, radiusValue });
                    childMinAxis = Math.min(childMinAxis, axisValue);
                    childMaxAxis = Math.max(childMaxAxis, axisValue);
                  }
                  const childAxisSpan = childMaxAxis - childMinAxis;
                  if (samples.length < 6 || childAxisSpan <= 1e-6) return;

                  const endBand = Math.max(childAxisSpan * 0.2, 1e-5);
                  const summarizeEnd = (atMin: boolean) => {
                    let total = 0;
                    let count = 0;
                    samples.forEach((sample) => {
                      const inBand = atMin
                        ? sample.axisValue <= childMinAxis + endBand
                        : sample.axisValue >= childMaxAxis - endBand;
                      if (!inBand) return;
                      total += sample.radiusValue;
                      count++;
                    });
                    return count > 0 ? total / count : null;
                  };
                  const minEndRadius = summarizeEnd(true);
                  const maxEndRadius = summarizeEnd(false);
                  if (minEndRadius === null || maxEndRadius === null) return;
                  if (Math.abs(minEndRadius - maxEndRadius) <= coneRadiusTolerance) return;

                  const coneEndAxis = minEndRadius < maxEndRadius ? childMinAxis : childMaxAxis;
                  const coneEndPoint = childOrigin.clone().addScaledVector(childAxis, coneEndAxis);
                  const minDistance = coneEndPoint.distanceTo(minAxisFootAssembly);
                  const maxDistance = coneEndPoint.distanceTo(maxAxisFootAssembly);
                  const endpointDistance = Math.min(minDistance, maxDistance);
                  if (endpointDistance > axisTolerance) return;

                  const preference = minDistance <= maxDistance ? "min" : "max";
                  const score = endpointDistance + originRadial;
                  if (score < bestScore) {
                    bestScore = score;
                    bestPreference = preference;
                  }
                });

                object.userData.pmiConeBoundaryPreference = bestPreference ?? "none";
                if (bestPreference === "min") return minCandidate;
                if (bestPreference === "max") return maxCandidate;
                return null;
              };
              const getPlanarCapsAt = (axisFootAssembly: THREE.Vector3) => {
                const axisTolerance = Math.max(Math.abs(bounds.maxAxis - bounds.minAxis) * 0.045, modelSizeMax * 0.002, 1e-4);
                const radialTolerance = Math.max(radius * 1.35, modelSizeMax * 0.01);
                const getPlanarProjectionBounds = (
                  child: THREE.Object3D,
                  frame: NonNullable<ReturnType<typeof getFaceFrameInAssembly>>
                ) => {
                  const cachedBounds = child.userData.pmiPlanarProjectionBounds as {
                    center: THREE.Vector3;
                    normal: THREE.Vector3;
                    uAxis: THREE.Vector3;
                    vAxis: THREE.Vector3;
                    minU: number;
                    maxU: number;
                    minV: number;
                    maxV: number;
                  } | undefined;
                  if (
                    cachedBounds &&
                    cachedBounds.center.distanceToSquared(frame.center) <= 1e-10 &&
                    cachedBounds.normal.dot(frame.normal) > 0.9999
                  ) {
                    return cachedBounds;
                  }
                  if (!(child instanceof THREE.Mesh)) return null;
                  const positionAttribute = child.geometry.getAttribute("position");
                  if (!(positionAttribute instanceof THREE.BufferAttribute) || positionAttribute.count < 3) return null;

                  let uAxis = new THREE.Vector3().crossVectors(frame.normal, new THREE.Vector3(1, 0, 0));
                  if (uAxis.lengthSq() <= 1e-8) {
                    uAxis = new THREE.Vector3().crossVectors(frame.normal, new THREE.Vector3(0, 1, 0));
                  }
                  if (uAxis.lengthSq() <= 1e-8) return null;
                  uAxis.normalize();
                  const vAxis = new THREE.Vector3().crossVectors(frame.normal, uAxis).normalize();
                  let minU = Infinity;
                  let maxU = -Infinity;
                  let minV = Infinity;
                  let maxV = -Infinity;
                  for (let i = 0; i < positionAttribute.count; i++) {
                    const vertex = new THREE.Vector3().fromBufferAttribute(positionAttribute, i);
                    const vertexAssembly = assemblyGroup.worldToLocal(child.localToWorld(vertex));
                    const vertexDelta = vertexAssembly.sub(frame.center);
                    const u = vertexDelta.dot(uAxis);
                    const v = vertexDelta.dot(vAxis);
                    minU = Math.min(minU, u);
                    maxU = Math.max(maxU, u);
                    minV = Math.min(minV, v);
                    maxV = Math.max(maxV, v);
                  }
                  if (![minU, maxU, minV, maxV].every(Number.isFinite)) return null;
                  const nextBounds = {
                    center: frame.center.clone(),
                    normal: frame.normal.clone(),
                    uAxis,
                    vAxis,
                    minU,
                    maxU,
                    minV,
                    maxV
                  };
                  child.userData.pmiPlanarProjectionBounds = nextBounds;
                  return nextBounds;
                };
                return assemblyGroup.children
                  .map((child) => {
                    if (child === object || !child.name.startsWith("BRepFace-")) return false;
                    const frame = getFaceFrameInAssembly(child.name);
                    if (!frame?.normal) return false;
                    const normalAlignment = Math.abs(frame.normal.dot(cylinderAxis));
                    if (normalAlignment < 0.92) return false;
                    const planeDistance = Math.abs(frame.normal.dot(axisFootAssembly.clone().sub(frame.center)));
                    if (planeDistance > axisTolerance) return false;

                    const delta = frame.center.clone().sub(axisFootAssembly);
                    const radialDistance = delta.clone().addScaledVector(cylinderAxis, -delta.dot(cylinderAxis)).length();
                    if (radialDistance <= radialTolerance) return frame;

                    const projectionBounds = getPlanarProjectionBounds(child, frame);
                    if (!projectionBounds) return false;
                    const targetDelta = axisFootAssembly.clone().sub(projectionBounds.center);
                    const targetU = targetDelta.dot(projectionBounds.uAxis);
                    const targetV = targetDelta.dot(projectionBounds.vAxis);
                    const boundsPadding = Math.max(radius * 0.4, modelSizeMax * 0.002, 1e-4);
                    return targetU >= projectionBounds.minU - boundsPadding &&
                      targetU <= projectionBounds.maxU + boundsPadding &&
                      targetV >= projectionBounds.minV - boundsPadding &&
                      targetV <= projectionBounds.maxV + boundsPadding
                      ? frame
                      : false;
                  })
                  .filter((frame): frame is NonNullable<ReturnType<typeof getFaceFrameInAssembly>> => !!frame);
              };
              const minCaps = getPlanarCapsAt(minAxisFootAssembly);
              const maxCaps = getPlanarCapsAt(maxAxisFootAssembly);
              const minHasCap = minCaps.length > 0;
              const maxHasCap = maxCaps.length > 0;
              const nearestCandidate = minWorld.distanceToSquared(camera.position) <= maxWorld.distanceToSquared(camera.position)
                ? minCandidate
                : maxCandidate;
              const minBulkDistance = minAxisFootAssembly.distanceToSquared(modelOrbitTarget);
              const maxBulkDistance = maxAxisFootAssembly.distanceToSquared(modelOrbitTarget);
              const bulkDistanceDelta = Math.abs(minBulkDistance - maxBulkDistance);
              const exteriorCandidate = bulkDistanceDelta > Math.max(modelSizeMax * modelSizeMax * 0.0001, 1e-8)
                ? (minBulkDistance > maxBulkDistance ? minCandidate : maxCandidate)
                : null;
              const cappedBoundaryCandidate =
                minHasCap !== maxHasCap
                  ? (minHasCap ? minCandidate : maxCandidate)
                  : null;
              const getLargestCapArea = (caps: typeof minCaps) =>
                caps.reduce((largest, cap) => Math.max(largest, cap.area || 0), 0);
              const isHoleStyleCallout =
                tolerance?.isCounterboreDimension ||
                tolerance?.isCountersinkDimension ||
                (tolerance?.dimensionKind !== "linear" && tolerance?.dimensionKind !== "angular" && !tolerance?.isDatumTargetDimension);
              const outerFaceBoundaryCandidate = isHoleStyleCallout
                ? minHasCap && maxHasCap
                  ? (getLargestCapArea(minCaps) >= getLargestCapArea(maxCaps) ? minCandidate : maxCandidate)
                  : cappedBoundaryCandidate || exteriorCandidate
                : null;
              const counterboreLipCandidate = findCounterboreLipBoundaryCandidate();
              const coneBoundaryCandidate = findCoaxialConicalBoundaryCandidate();
              const selected = outerFaceBoundaryCandidate || counterboreLipCandidate || cappedBoundaryCandidate || coneBoundaryCandidate || exteriorCandidate || nearestCandidate || minCandidate;
              localAxisFoot = selected.axisFoot;
              localPoint = selected.surfacePoint;
            }
          }

          if (tolerance?.isSphericalDimension && object instanceof THREE.Mesh) {
            const sphereCenter = cache.localCenter.clone();
            const localCameraPoint = object.worldToLocal(camera.position.clone());
            const viewRadialDirection = localCameraPoint.clone().sub(sphereCenter);
            if (viewRadialDirection.lengthSq() > 1e-8) {
              viewRadialDirection.normalize();
              const positionAttribute = object.geometry.getAttribute("position");
              let radius = localPoint.distanceTo(sphereCenter);
              if (positionAttribute instanceof THREE.BufferAttribute && positionAttribute.count > 0) {
                let totalRadius = 0;
                let sampleCount = 0;
                for (let i = 0; i < positionAttribute.count; i++) {
                  const vertex = new THREE.Vector3().fromBufferAttribute(positionAttribute, i);
                  const vertexRadius = vertex.distanceTo(sphereCenter);
                  if (!Number.isFinite(vertexRadius) || vertexRadius <= 1e-8) continue;
                  totalRadius += vertexRadius;
                  sampleCount++;
                }
                if (sampleCount > 0) radius = totalRadius / sampleCount;
              }
              localPoint = sphereCenter.clone().addScaledVector(viewRadialDirection, radius);
              localAxisFoot = sphereCenter.clone();
              localRadialDirection.copy(viewRadialDirection);
            }
          }

          surfacePoint = assemblyGroup.worldToLocal(object.localToWorld(localPoint.clone()));
          const axisFoot = assemblyGroup.worldToLocal(object.localToWorld(localAxisFoot.clone()));
          radialDirection = surfacePoint.clone().sub(axisFoot);
          if (radialDirection.lengthSq() <= 1e-8) {
            radialDirection = getAssemblyDirection(object, localRadialDirection) || localRadialDirection.clone();
          }
          radialDirection.normalize();
        }

        const cameraWorldPoint = camera.position.clone();
        const cameraRightWorldPoint = cameraWorldPoint.clone().add(new THREE.Vector3(1, 0, 0).transformDirection(camera.matrixWorld));
        const cameraPointLocal = assemblyGroup.worldToLocal(cameraWorldPoint.clone());
        const cameraRightLocal = assemblyGroup.worldToLocal(cameraRightWorldPoint).sub(cameraPointLocal).normalize();
        let doglegDirection = cameraRightLocal.clone();
        if (doglegDirection.lengthSq() <= 1e-8) {
          doglegDirection.crossVectors(radialDirection, new THREE.Vector3(1, 0, 0));
        }
        if (doglegDirection.lengthSq() <= 1e-8) {
          doglegDirection.crossVectors(radialDirection, new THREE.Vector3(0, 1, 0));
        }
        doglegDirection.normalize();
        if (doglegDirection.dot(cameraRightLocal) < 0) doglegDirection.negate();

        const normalOffset = Math.max(modelSizeMax * 0.065, 1e-4);
        const radialEnd = surfacePoint.clone().addScaledVector(radialDirection, Math.max(normalOffset * 0.7, modelSizeMax * 0.045));
        const doglegEnd = radialEnd.clone().addScaledVector(doglegDirection, Math.max(normalOffset * 0.5, modelSizeMax * 0.032));
        const arrowLength = normalOffset * 0.18;
        const arrowHalfWidth = arrowLength * 0.36;
        const arrowTip = surfacePoint.clone();
        const leaderDirection = radialEnd.clone().sub(arrowTip).normalize();
        const arrowBase = arrowTip.clone().addScaledVector(leaderDirection, arrowLength);
        const arrowSide = doglegDirection.clone().addScaledVector(leaderDirection, -doglegDirection.dot(leaderDirection));
        if (arrowSide.lengthSq() <= 1e-8) {
          arrowSide.crossVectors(cylinderAxis, leaderDirection);
        }
        if (arrowSide.lengthSq() <= 1e-8) {
          arrowSide.crossVectors(leaderDirection, new THREE.Vector3(1, 0, 0));
          arrowSide.addScaledVector(cylinderAxis, -arrowSide.dot(cylinderAxis));
        }
        if (arrowSide.lengthSq() <= 1e-8) {
          arrowSide.crossVectors(leaderDirection, new THREE.Vector3(0, 1, 0));
          arrowSide.addScaledVector(cylinderAxis, -arrowSide.dot(cylinderAxis));
        }
        arrowSide.normalize().multiplyScalar(arrowHalfWidth);

        const cameraUpWorldPoint = cameraWorldPoint.clone().add(new THREE.Vector3(0, 1, 0).transformDirection(camera.matrixWorld));
        const cameraUpLocal = assemblyGroup.worldToLocal(cameraUpWorldPoint).sub(cameraPointLocal).normalize();
        const labelPosition = doglegEnd.clone()
          .addScaledVector(cameraRightLocal, Math.max(modelSizeMax * 0.0075, 0.035))
          .addScaledVector(cameraUpLocal, Math.max(modelSizeMax * 0.0025, 0.01));

        return {
          linePoints: [arrowBase, radialEnd, radialEnd, doglegEnd],
          arrowPoints: [
            arrowTip,
            arrowBase.clone().add(arrowSide),
            arrowBase.clone().sub(arrowSide)
          ],
          labelPosition,
          anchor: {
            surfacePoint: surfacePoint.clone(),
            radialDirection: radialDirection.clone()
          }
        };
      };

      const updatePmiGeometryPoints = (geometry: THREE.BufferGeometry, points: THREE.Vector3[]) => {
        const position = geometry.getAttribute("position");
        if (position instanceof THREE.BufferAttribute && position.count === points.length) {
          points.forEach((point, index) => {
            position.setXYZ(index, point.x, point.y, point.z);
          });
          position.needsUpdate = true;
        } else {
          geometry.setFromPoints(points);
        }
      };

      const updatePmiLeaderObjects = (entry: (typeof pmiDimensionLeaderCache)[number]) => {
        const geometry = computeHoleToleranceLeaderGeometry(entry.faceName, entry.slotIndex, entry.slotCount, entry.anchor, entry.tolerance);
        if (!geometry) return false;
        updatePmiGeometryPoints(entry.line.geometry, geometry.linePoints);
        updatePmiGeometryPoints(entry.arrow.geometry, geometry.arrowPoints);
        entry.labelEntry?.point.copy(geometry.labelPosition);
        return true;
      };
      updatePmiDimensionLeaderFacing = () => {
        pmiDimensionLeaderCache = pmiDimensionLeaderCache.filter(updatePmiLeaderObjects);
      };

      const drawHoleToleranceLeader = (tolerance: any, faceName: string) => {
        const stackedGroup = stackedHoleDimensionOwnerById.get(tolerance.id);
        if (stackedGroup && stackedGroup.length === 0) return true;
        const shouldAttachDimensionToDatumLeader = !tolerance.isCounterboreDimension && !tolerance.isCountersinkDimension;
        const datumAnchorForFace = shouldAttachDimensionToDatumLeader && propsRef.current.showDatumFeatures
          ? datumAnchorCache.find((anchor) =>
              anchor.annotationKind === "datum" &&
              anchor.calloutKind === "cylindrical" &&
              mapDatumTargetsToWebGLNames(anchor.datum).includes(faceName)
            )
          : null;
        if (datumAnchorForFace) {
          const resolveDatumDimensionPoint = () => getDatumLeaderDimensionLabelPoint(datumAnchorForFace);
          const resolveDatumDimensionTransform = () => getDatumLeaderDimensionLabelTransform(datumAnchorForFace);
          const labelPoint = resolveDatumDimensionPoint();
          if (labelPoint) {
            if (stackedGroup && stackedGroup.length > 1) {
              addPmiDimensionStackLabel(stackedGroup, labelPoint, resolveDatumDimensionPoint, resolveDatumDimensionTransform);
            } else {
              addPmiDimensionLabel(tolerance, labelPoint, [], resolveDatumDimensionPoint, resolveDatumDimensionTransform);
            }
            return true;
          }
        }

        const faceDatumIds = (propsRef.current.showDatumFeatures ? (propsRef.current.datums || []) : [])
          .filter((datum: any) => datum.type !== "Datum Target Set")
          .filter((datum: any) => mapDatumTargetsToWebGLNames(datum).includes(faceName))
          .map((datum: any) => `datum:${datum.id || datum.identifier || datum.entityId}`)
          .sort();
        const faceToleranceIds = dimensionTolerances
          .filter((candidate: any) => getFaceNamesForTolerance(candidate).includes(faceName))
          .map((candidate: any) => `tolerance:${candidate.id}`)
          .sort();
        const occupiedSlots = [...faceDatumIds, ...faceToleranceIds];
        const slotCount = Math.max(occupiedSlots.length, 1);
        const slotIndex = Math.max(occupiedSlots.indexOf(`tolerance:${tolerance.id}`), faceDatumIds.length);
        const geometry = computeHoleToleranceLeaderGeometry(faceName, slotIndex, slotCount, undefined, tolerance);
        if (!geometry) return false;

        const lineGeometry = new THREE.BufferGeometry().setFromPoints(geometry.linePoints);
        const lineMaterial = new THREE.LineBasicMaterial({
          color: 0x0f172a,
          depthTest: false,
          depthWrite: false,
          transparent: true,
          opacity: 0.96
        });
        const line = new THREE.LineSegments(lineGeometry, lineMaterial);
        line.name = `PmiDimensionToleranceOverlay-${tolerance.id}-Leader`;
        line.renderOrder = 43;
        line.frustumCulled = false;
        line.raycast = () => undefined;
        group.add(line);

        const arrowGeometry = new THREE.BufferGeometry().setFromPoints(geometry.arrowPoints);
        const arrowMaterial = new THREE.MeshBasicMaterial({
          color: 0x0f172a,
          depthTest: false,
          depthWrite: false,
          transparent: true,
          opacity: 0.96,
          side: THREE.DoubleSide
        });
        const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
        arrow.name = `PmiDimensionToleranceOverlay-${tolerance.id}-Arrow`;
        arrow.renderOrder = 44;
        arrow.frustumCulled = false;
        arrow.raycast = () => undefined;
        group.add(arrow);

        const labelEntry = stackedGroup && stackedGroup.length > 1
          ? addPmiDimensionStackLabel(stackedGroup, geometry.labelPosition)
          : addPmiDimensionLabel(tolerance, geometry.labelPosition);
        pmiDimensionLeaderCache.push({
          tolerance,
          faceName,
          slotIndex,
          slotCount,
          anchor: geometry.anchor,
          line,
          arrow,
          labelEntry
        });
        return true;
      };

      const addPmiLineSegments = (points: THREE.Vector3[], name: string) => {
        const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
        const lineMaterial = new THREE.LineBasicMaterial({
          color: 0x0f172a,
          depthTest: false,
          depthWrite: false,
          transparent: true,
          opacity: 0.96
        });
        const lineObject = new THREE.LineSegments(lineGeometry, lineMaterial);
        lineObject.name = name;
        lineObject.renderOrder = 43;
        lineObject.frustumCulled = false;
        lineObject.raycast = () => undefined;
        group.add(lineObject);
        return lineObject;
      };

      const addPmiPolyline = (points: THREE.Vector3[], name: string) => {
        if (points.length < 2) return null;
        const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
        const lineMaterial = new THREE.LineBasicMaterial({
          color: 0x0f172a,
          depthTest: false,
          depthWrite: false,
          transparent: true,
          opacity: 0.96
        });
        const lineObject = new THREE.Line(lineGeometry, lineMaterial);
        lineObject.name = name;
        lineObject.renderOrder = 43;
        lineObject.frustumCulled = false;
        lineObject.raycast = () => undefined;
        group.add(lineObject);
        return lineObject;
      };

      const addPmiArrowHead = (
        apex: THREE.Vector3,
        backDirection: THREE.Vector3,
        sideDirection: THREE.Vector3,
        arrowLength: number,
        arrowHalfWidth: number,
        name: string
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
          color: 0x0f172a,
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false,
          transparent: true,
          opacity: 0.96,
        });
        const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial);
        arrow.name = name;
        arrow.renderOrder = 44;
        arrow.frustumCulled = false;
        arrow.raycast = () => undefined;
        group.add(arrow);
      };

      const drawAngularDimension = (result: AngularMeasurementResult, tolerance: any, name: string) => {
        const cross = new THREE.Vector3().crossVectors(result.directionA, result.directionB);
        const signedAngle = Math.atan2(result.axis.dot(cross), result.directionA.dot(result.directionB));
        if (Math.abs(signedAngle) <= 1e-5) return;

        const steps = Math.max(14, Math.ceil(Math.abs(signedAngle) / (Math.PI / 48)));
        const arcPoints: THREE.Vector3[] = [];
        for (let i = 0; i <= steps; i++) {
          const rotation = new THREE.Quaternion().setFromAxisAngle(result.axis, signedAngle * (i / steps));
          const direction = result.directionA.clone().applyQuaternion(rotation).normalize();
          arcPoints.push(result.center.clone().addScaledVector(direction, result.radius));
        }
        const arcStart = arcPoints[0];
        const arcEnd = arcPoints[arcPoints.length - 1];
        const extensionLengthA = Math.max(
          Math.abs(result.sourceA.clone().sub(result.center).dot(result.directionA)),
          result.radius * 1.35
        );
        const extensionLengthB = Math.max(
          Math.abs(result.sourceB.clone().sub(result.center).dot(result.directionB)),
          result.radius * 1.35
        );
        const extensionStartA = result.center.clone().addScaledVector(result.directionA, extensionLengthA);
        const extensionStartB = result.center.clone().addScaledVector(result.directionB, extensionLengthB);

        addPmiLineSegments([
          extensionStartA,
          arcStart.clone(),
          extensionStartB,
          arcEnd.clone(),
        ], `${name}-AngleProjectionLines`);

        const midIndex = Math.floor(arcPoints.length / 2);
        const gapPointCount = Math.max(2, Math.ceil(arcPoints.length * 0.12));
        const gapStart = Math.max(1, midIndex - gapPointCount);
        const gapEnd = Math.min(arcPoints.length - 2, midIndex + gapPointCount);
        addPmiPolyline(arcPoints.slice(0, gapStart + 1), `${name}-AngleArcA`);
        addPmiPolyline(arcPoints.slice(gapEnd), `${name}-AngleArcB`);

        const arrowLength = Math.min(Math.max(modelSizeMax * 0.012, 0.055), result.radius * 0.22);
        const arrowHalfWidth = arrowLength * 0.36;
        const sign = signedAngle >= 0 ? 1 : -1;
        const tangentStart = new THREE.Vector3().crossVectors(result.axis, result.directionA).multiplyScalar(sign).normalize();
        const tangentEnd = new THREE.Vector3().crossVectors(result.axis, result.directionB).multiplyScalar(sign).normalize();
        addPmiArrowHead(arcStart, tangentStart, result.axis, arrowLength, arrowHalfWidth, `${name}-AngleStartArrow`);
        addPmiArrowHead(arcEnd, tangentEnd.negate(), result.axis, arrowLength, arrowHalfWidth, `${name}-AngleEndArrow`);

        const midRotation = new THREE.Quaternion().setFromAxisAngle(result.axis, signedAngle * 0.5);
        const midDirection = result.directionA.clone().applyQuaternion(midRotation).normalize();
        addPmiDimensionLabel(tolerance, result.center.clone().addScaledVector(midDirection, result.radius));
      };

      const drawLinearDimension = (result: LinearMeasurementResult, name: string, tolerance?: any, datumIdentifiers: string[] = []) => {
        const start = result.start;
        const end = result.end;
        const axis = end.clone().sub(start);
        const distance = axis.length();
        if (distance <= 1e-8) return;

        axis.normalize();
        const midpoint = start.clone().add(end).multiplyScalar(0.5);
        const viewDirection = assemblyGroup.worldToLocal(camera.position.clone()).sub(midpoint).normalize();
        const targetLeaderOffset = Math.max(modelSizeMax * 0.065, 1e-4);
        const arrowLength = Math.min(targetLeaderOffset * 0.18, distance * 0.35);
        const arrowHalfWidth = arrowLength * 0.36;

        if (result.diameterReference) {
          let arrowSide = new THREE.Vector3().crossVectors(axis, viewDirection);
          if (arrowSide.lengthSq() <= 1e-8) arrowSide.crossVectors(axis, new THREE.Vector3(0, 1, 0));
          if (arrowSide.lengthSq() <= 1e-8) arrowSide.crossVectors(axis, new THREE.Vector3(1, 0, 0));
          arrowSide.normalize();
          addMeasurementLineSegments(group, [start, end], `${name}-Diameter`);
          addMeasurementArrowHead(group, start, axis, arrowSide, arrowLength, arrowHalfWidth);
          addMeasurementArrowHead(group, end, axis.clone().negate(), arrowSide, arrowLength, arrowHalfWidth);
          return;
        }

        const offsetDirection = getLinearDimensionProjectionDirection(
          axis,
          viewDirection,
          result,
          getToleranceMeasurementFrameBasis(tolerance)
        );
        if (!offsetDirection) return;

        const offsetDistance = Math.max(modelSizeMax * 0.045, distance * 0.08, 0.15);
        const dimStart = start.clone().addScaledVector(offsetDirection, offsetDistance);
        const dimEnd = end.clone().addScaledVector(offsetDirection, offsetDistance);
        addMeasurementLineSegments(group, [
          start, dimStart,
          end, dimEnd,
          dimStart, dimEnd,
        ], name);
        addMeasurementArrowHead(group, dimStart, axis, offsetDirection, arrowLength, arrowHalfWidth);
        addMeasurementArrowHead(group, dimEnd, axis.clone().negate(), offsetDirection, arrowLength, arrowHalfWidth);
        if (tolerance) {
          addPmiDimensionLabel(
            tolerance,
            dimStart.clone().add(dimEnd).multiplyScalar(0.5).addScaledVector(offsetDirection, Math.max(modelSizeMax * 0.01, 0.04)),
            datumIdentifiers
          );
        }
      };

      const resolveAngularDimensionFromFaces = (faceNames: string[], tolerance: any): AngularMeasurementResult | null => {
        const makeAngularSamples = (names: string[]) => names
          .map(makeFaceSample)
          .filter((sample): sample is MeasurementSample => !!sample && sample.kind === "face" && !!sample.normal && sample.normal.lengthSq() > 1e-8);
        const preferredSamples = makeAngularSamples(faceNames);
        const fallbackSamples = preferredSamples.length >= 2
          ? preferredSamples
          : makeAngularSamples(
              assemblyGroup.children
                .filter((child) => child.name.startsWith("BRepFace-"))
                .map((child) => child.name)
            );
        const samples = fallbackSamples;
        const nominalAngle = Number.isFinite(tolerance.nominalDimension) ? Number(tolerance.nominalDimension) : null;

        let bestResult: AngularMeasurementResult | null = null;
        let bestScore = -Infinity;
        for (let i = 0; i < samples.length; i++) {
          for (let j = i + 1; j < samples.length; j++) {
            const result = resolveMeasurement(samples[i], samples[j]);
            if (result.mode !== "angle") continue;
            const angle = Math.acos(THREE.MathUtils.clamp(result.directionA.dot(result.directionB), -1, 1));
            const angleDegrees = THREE.MathUtils.radToDeg(angle);
            const nominalPenalty = nominalAngle !== null
              ? Math.min(
                  Math.abs(angleDegrees - nominalAngle),
                  Math.abs((180 - angleDegrees) - nominalAngle)
                )
              : 0;
            const preferredBonus = preferredSamples.includes(samples[i]) && preferredSamples.includes(samples[j]) ? 100 : 0;
            const score =
              preferredBonus +
              Math.sin(angle) * 10 +
              Math.min(result.sourceA.distanceTo(result.sourceB) / Math.max(modelSizeMax, 1e-6), 1) -
              nominalPenalty * 12;
            if (score > bestScore) {
              bestScore = score;
              bestResult = result;
            }
          }
        }
        return bestResult;
      };

      for (const tolerance of dimensionTolerances) {
        const faceNames = getFaceNamesForTolerance(tolerance);
        const mergedDatumIdentifiers: string[] = [];
        const isAngularDimension = /angular/i.test(`${tolerance.dimensionKind || ""} ${tolerance.type || ""}`);
        const isLinearLikeDimension = tolerance.dimensionKind === "linear" || tolerance.dimensionKind === "size";

        if (tolerance.associatedDatumIdentifier) {
          const datumAnchor = datumAnchorCache.find((anchor) =>
            anchor.annotationKind === "datum" &&
            anchor.datum?.identifier === tolerance.associatedDatumIdentifier
          );
          if (datumAnchor) {
            const resolveDatumDimensionPoint = () => getDatumLeaderDimensionLabelPoint(datumAnchor);
            const resolveDatumDimensionTransform = () => getDatumLeaderDimensionLabelTransform(datumAnchor);
            const labelPoint = resolveDatumDimensionPoint();
            if (labelPoint) {
              addPmiDimensionLabel(
                tolerance,
                labelPoint,
                [],
                resolveDatumDimensionPoint,
                resolveDatumDimensionTransform
              );
            }
          }
          continue;
        }

        if (isAngularDimension) {
          const result = resolveAngularDimensionFromFaces(faceNames, tolerance);
          if (result) {
            drawAngularDimension(result, tolerance, `PmiDimensionToleranceOverlay-${tolerance.id}`);
          } else if (faceNames.length >= 2) {
            const frames = faceNames
              .map(getFaceFrameInAssembly)
              .filter((frame): frame is NonNullable<ReturnType<typeof getFaceFrameInAssembly>> => !!frame);
            if (frames.length >= 2) {
              const midpoint = frames[0].center.clone().add(frames[1].center).multiplyScalar(0.5);
              addPmiDimensionLabel(tolerance, midpoint, mergedDatumIdentifiers);
            }
          }
          continue;
        }

        const cylindricalFaceName = getBoundarySideHoleCalloutFaceName(faceNames, tolerance);
        if (tolerance.dimensionKind === "threadDepth") {
          const threadCylinderFaceNames = (tolerance.threadCylinderTargetIds || [])
            .map((targetId: string) =>
              mapTargetToWebGLName(targetId, "", false) ||
              mapTargetToTopologicalWebGLName(targetId)
            )
            .filter((name: string | null): name is string => !!name)
            .filter((name: string, index: number, all: string[]) => all.indexOf(name) === index)
            .filter(isCylindricalFace);
          const threadHoleFaceName = threadCylinderFaceNames[0] || cylindricalFaceName || getNearestCylindricalFaceName(faceNames);
          if (threadHoleFaceName && drawHoleToleranceLeader(tolerance, threadHoleFaceName)) continue;

          const samples = faceNames.map(makeFaceSample).filter((sample): sample is MeasurementSample => !!sample);
          if (samples.length > 0) {
            const center = samples
              .reduce((acc, sample) => acc.add(sample.point), new THREE.Vector3())
              .multiplyScalar(1 / samples.length);
            addPmiDimensionLabel(tolerance, center, mergedDatumIdentifiers);
          }
          continue;
        }

        if (tolerance.isCounterboreDimension) {
          const counterboreFaceName = cylindricalFaceName || getNearestCylindricalFaceName(faceNames);
          if (counterboreFaceName && drawHoleToleranceLeader(tolerance, counterboreFaceName)) continue;
          continue;
        }

        if (tolerance.isCountersinkDimension) {
          const countersinkHoleFaceName = cylindricalFaceName || getNearestCylindricalFaceName(faceNames);
          if (countersinkHoleFaceName && drawHoleToleranceLeader(tolerance, countersinkHoleFaceName)) continue;
          continue;
        }

        if (!isAngularDimension && cylindricalFaceName) {
          const isLinearCylinderDistance =
            tolerance.dimensionKind === "linear" &&
            faceNames.filter(isCylindricalFace).length >= 2;
          if (isLinearCylinderDistance) {
            const result = makeCylinderCenterDistanceResult(faceNames, tolerance);
            if (result) {
              drawLinearDimension(result, `PmiDimensionToleranceOverlay-${tolerance.id}`, tolerance, mergedDatumIdentifiers);
              continue;
            }
          }
          if (drawHoleToleranceLeader(tolerance, cylindricalFaceName)) continue;
          if (!isLinearLikeDimension) {
            const samples = faceNames.map(makeFaceSample).filter((sample): sample is MeasurementSample => !!sample);
            if (samples.length > 0) {
              const center = samples
                .reduce((acc, sample) => acc.add(sample.point), new THREE.Vector3())
                .multiplyScalar(1 / samples.length);
              addPmiDimensionLabel(tolerance, center, mergedDatumIdentifiers);
            }
            continue;
          }
        }

        if (!isAngularDimension && isLinearLikeDimension && faceNames.length >= 2) {
          const samples = faceNames.slice(0, 2).map(makeFaceSample).filter((sample): sample is MeasurementSample => !!sample);
          if (samples.length >= 2) {
            const result = resolveMeasurement(samples[0], samples[1]);
            if (result.mode === "angle") {
              drawAngularDimension(result, tolerance, `PmiDimensionToleranceOverlay-${tolerance.id}`);
              continue;
            }
            if (result.mode === "linear") drawLinearDimension(result, `PmiDimensionToleranceOverlay-${tolerance.id}`, tolerance, mergedDatumIdentifiers);
          }
          continue;
        }

        if (
          !isAngularDimension &&
          (tolerance.dimensionKind === "diameter" || tolerance.dimensionKind === "radius") &&
          faceNames.length === 0
        ) {
          if (canDrawCircularPointTargetDimension(tolerance)) {
            const result = makePointTargetDimensionResult(tolerance);
            if (result) {
              drawLinearDimension(result, `PmiDimensionToleranceOverlay-${tolerance.id}`, tolerance, mergedDatumIdentifiers);
              continue;
            }
          }
          if (isRepeatedCircularPointTargetPattern(tolerance)) {
            continue;
          }
          const labelPoint = getPointTargetLabelPoint(tolerance);
          if (labelPoint) {
            addPmiDimensionLabel(tolerance, labelPoint, mergedDatumIdentifiers);
            continue;
          }
        }

        if (!isAngularDimension && (isLinearLikeDimension || tolerance.isDatumTargetDimension)) {
          const result =
            isLinearLikeDimension
              ? makeLineTargetMinimumDistanceResult(tolerance) || makePointTargetDimensionResult(tolerance)
              : makePointTargetDimensionResult(tolerance);
          if (result) {
            drawLinearDimension(result, `PmiDimensionToleranceOverlay-${tolerance.id}`, tolerance, mergedDatumIdentifiers);
            continue;
          }
          const labelPoint = getPointTargetLabelPoint(tolerance);
          if (labelPoint) {
            addPmiDimensionLabel(tolerance, labelPoint, mergedDatumIdentifiers);
            continue;
          }
        }
      }

      if (group.children.length > 0) {
        assemblyGroup.add(group);
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
        ...(propsRef.current.showDatumFeatures
          ? (propsRef.current.datums || [])
              .filter((d: any) => d.type !== "Datum Target Set")
              .map((d: any) => ({ ...d, annotationKind: "datum" }))
          : []),
        ...(propsRef.current.showDatumTargets
          ? (propsRef.current.datumTargets || []).map((d: any) => ({ ...d, annotationKind: "datumTarget" }))
          : []),
      ];
      datumCacheMissingElements = 0;
      clearDatumTargetRegionOverlays();
      clearDatumLeaderGeometry();
      clearDatumReferenceFrameBadges();
      if (propsRef.current.showDatumReferenceFrames) {
        drawDatumReferenceFrameOverlay();
      }
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
      const selectPhysicalDatumLeaderFaceName = (datum: any, faceNames: string[]) => {
        if (faceNames.length <= 1) return faceNames[0] || null;
        const renderKind = getDatumRenderKindForFaces(datum, faceNames);
        if (renderKind !== "multiface") return faceNames[0] || null;

        const semanticText = `${datum?.type || ""} ${datum?.targetName || ""} ${datum?.clinicalContext || ""}`;
        if (/cylind|hole|bore|axis|target set/i.test(semanticText)) return faceNames[0] || null;

        const cameraLocal = assemblyGroup.worldToLocal(camera.position.clone());
        const centerReference = modelOrbitTarget.clone();
        const maxArea = Math.max(
          ...faceNames.map((name) => Math.max(getFaceFrameInAssembly(name)?.area || 0, 0)),
          1e-6
        );

        return faceNames
          .map((name, index) => {
            const frame = getFaceFrameInAssembly(name);
            if (!frame?.normal) return null;
            const viewDirection = cameraLocal.clone().sub(frame.center);
            if (viewDirection.lengthSq() <= 1e-8) return null;
            viewDirection.normalize();
            const cameraFacing = Math.abs(frame.normal.dot(viewDirection));
            const exteriorScore = Math.min(
              frame.center.distanceTo(centerReference) / Math.max(modelSizeMax, 1e-6),
              1
            );
            const areaScore = Math.min(Math.sqrt(Math.max(frame.area, 0) / maxArea), 1);
            return {
              name,
              score: cameraFacing * 6 + exteriorScore * 2 + areaScore - index * 1e-3
            };
          })
          .filter((candidate): candidate is { name: string; score: number } => !!candidate)
          .sort((a, b) => b.score - a.score)[0]?.name || faceNames[0] || null;
      };
      datumAnchorCache = currentAnnotations.flatMap((d: any) => {
        const element = document.getElementById(`3d-datum-badge-${d.id}`);
        const leaderElement = document.getElementById(`3d-datum-leader-${d.id}`);
        const triangleElement = document.getElementById(`3d-datum-triangle-${d.id}`);
        const webglNames = mapDatumTargetsToWebGLNames(d);
        const selectedDatumFaceName = d.annotationKind === "datumTarget"
          ? webglNames[0] || null
          : selectPhysicalDatumLeaderFaceName(d, webglNames);
        const webglName = selectedDatumFaceName ||
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

        const child = webglName ? renderedObjectByName.get(webglName) : assemblyGroup;
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
        const isPhysicalMultiPlaneDatum = d.annotationKind !== "datumTarget" &&
          datumRenderKind === "multiface" &&
          baseWebglNames.length > 1 &&
          !/cylind|hole wall|bore|axis|target set/i.test(datumTargetText);
        const isPlanarDatum = /plane|planar|flat/i.test(datumTargetText) || isPhysicalMultiPlaneDatum;
        const isCylindricalDatum = /cylind|hole wall|bore/i.test(datumTargetText);
        const isHoleDatum = /hole|bore/i.test(datumTargetText);
        const hasLeader = d.annotationKind === "datumTarget" || d.annotationKind === "datum";

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
            .map((name) => renderedObjectByName.get(name))
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
              leaderStemLength = Math.max(normalOffset * 0.66, modelSizeMax * 0.0435);
              triangleHeight = Math.max(normalOffset * 0.28, modelSizeMax * 0.018);
              triangleHalfBase = triangleHeight / Math.sqrt(3);
              arrowLength = normalOffset * 0.18;
              arrowHalfWidth = arrowLength * 0.36;
              dimensionTickLength = Math.max(arrowHalfWidth * 8.0, modelSizeMax * 0.045);

              dimensionStartLocal = localPoint.clone().addScaledVector(dimensionAxis, -dimensionHalfLength);
              dimensionEndLocal = localPoint.clone().addScaledVector(dimensionAxis, dimensionHalfLength);
              dimensionTouchStartLocal = dimensionStartLocal.clone();
              dimensionTouchEndLocal = dimensionEndLocal.clone();
              const useExternalDimensionArrows =
                dimensionHalfLength < triangleHalfBase + arrowLength * 1.25;
              const externalArrowLineLength = Math.max(
                triangleHalfBase + arrowLength * 1.75,
                modelSizeMax * 0.04
              );
              const triangleBaseCenterLocal = useExternalDimensionArrows
                ? (() => {
                    const startSideCenter = dimensionStartLocal!
                      .clone()
                      .addScaledVector(dimensionAxis, -externalArrowLineLength * 0.58);
                    const endSideCenter = dimensionEndLocal!
                      .clone()
                      .addScaledVector(dimensionAxis, externalArrowLineLength * 0.58);
                    return startSideCenter.distanceToSquared(modelOrbitTarget) >
                      endSideCenter.distanceToSquared(modelOrbitTarget)
                      ? startSideCenter
                      : endSideCenter;
                  })()
                : localPoint.clone();
              triangleApexLocal = triangleBaseCenterLocal.clone().addScaledVector(leaderDirection, triangleHeight);
              const badgeStemEndLocal = triangleApexLocal.clone().addScaledVector(leaderDirection, leaderStemLength);
              offset.copy(badgeStemEndLocal).sub(localPoint);

              const dimensionLinePoints = useExternalDimensionArrows
                ? [
                    dimensionStartLocal.clone().addScaledVector(dimensionAxis, -externalArrowLineLength),
                    dimensionStartLocal.clone().addScaledVector(dimensionAxis, -arrowLength),
                    dimensionEndLocal.clone().addScaledVector(dimensionAxis, arrowLength),
                    dimensionEndLocal.clone().addScaledVector(dimensionAxis, externalArrowLineLength),
                    dimensionStartLocal.clone().addScaledVector(leaderDirection, -dimensionTickLength * 0.5),
                    dimensionStartLocal.clone().addScaledVector(leaderDirection, dimensionTickLength * 0.5),
                    dimensionEndLocal.clone().addScaledVector(leaderDirection, -dimensionTickLength * 0.5),
                    dimensionEndLocal.clone().addScaledVector(leaderDirection, dimensionTickLength * 0.5),
                  ]
                : [
                    dimensionStartLocal.clone(),
                    dimensionEndLocal.clone(),
                    dimensionStartLocal.clone().addScaledVector(leaderDirection, -dimensionTickLength * 0.5),
                    dimensionStartLocal.clone().addScaledVector(leaderDirection, dimensionTickLength * 0.5),
                    dimensionEndLocal.clone().addScaledVector(leaderDirection, -dimensionTickLength * 0.5),
                    dimensionEndLocal.clone().addScaledVector(leaderDirection, dimensionTickLength * 0.5),
                  ];
              const dimensionGeometry = new THREE.BufferGeometry().setFromPoints(dimensionLinePoints);
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
              const startArrowBase = dimensionStartLocal
                .clone()
                .addScaledVector(dimensionAxis, useExternalDimensionArrows ? -arrowLength : arrowLength);
              const endArrowBase = dimensionEndLocal
                .clone()
                .addScaledVector(dimensionAxis, useExternalDimensionArrows ? arrowLength : -arrowLength);
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
              leaderStemLength = Math.max(normalOffset * 0.66, modelSizeMax * 0.0435);
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
              offset.copy(unitNormal.clone().multiplyScalar(normalOffset * 0.82));
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

                  const doglegExtendedEndLocal = triangleBaseCenterLocal
                    .clone()
                    .addScaledVector(leaderTangent, Math.max(triangleHalfBase * 1.35, modelSizeMax * 0.012));
                  const shaftGeometry = new THREE.BufferGeometry().setFromPoints([
                    arrowBaseLocal.clone(),
                    radialLeadEndLocal.clone(),
                    doglegExtendedEndLocal,
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
            datum: d,
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

        const doglegExtendedEndLocal = triangleBaseCenterLocal
          .clone()
          .addScaledVector(tangent, Math.max(anchor.triangleHalfBase * 1.35, modelSizeMax * 0.012));

        updateGeometryPoints(anchor.arrowShaftObject.geometry, [
          arrowBaseLocal,
          radialLeadEndLocal,
          doglegExtendedEndLocal,
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

    dimensionOverlayVisibilityRefreshRef.current = () => {
      refreshDatumAnchorCache();
      refreshPmiDimensionToleranceOverlay();
      requestRenderRef.current?.(3);
    };

    datumClickHandlerRef.current = (datum: any) => {
      const webglNames = mapDatumTargetsToWebGLNames(datum);
      const webglName = webglNames[0] || mapTargetToWebGLName(datum.targetId, datum.identifier);
      if (!webglName) return;

      const obj = renderedObjectByName.get(webglName);
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
          .map((name) => renderedObjectByName.get(name))
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
      if (wheelNavigationPending) {
        cameraFocusTarget = null;
        focusedDatumOrbit = false;
      } else {
        releaseFocusedDatumOrbit();
      }
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

    const handleWheelNavigation = () => {
      wheelNavigationPending = true;
      if (wheelNavigationResetId !== null) {
        window.clearTimeout(wheelNavigationResetId);
      }
      wheelNavigationResetId = window.setTimeout(() => {
        wheelNavigationPending = false;
        wheelNavigationResetId = null;
      }, 80);
    };

    canvas.addEventListener("wheel", handleWheelNavigation, { passive: true });
    controls.addEventListener("start", handleControlsStart);
    controls.addEventListener("change", handleControlsChange);
    controls.addEventListener("end", handleControlsEnd);

    // Dynamic cache keys trackers
    let prevResToken = "";
    let prevViewMode = "";
    let prevMat = "";
    let prevDatumDatumsRef: any[] | null = null;
    let prevDatumTargetsRef: any[] | null = null;
    let prevDatumReferenceFramesRef: any[] | null = null;
    let prevToleranceRef: any[] | null = null;
    let prevDatumMappingRef: Record<string, string> | null = null;
    let prevShowDatumFeatures = true;
    let prevShowDatumTargets = true;
    let prevShowDatumReferenceFrames = true;
    let prevShowDimensionalTolerances = true;
    let prevDatumSceneFaces = -1;
    let prevFocusRequestNonce = -1;
    const projectedDatumPoint = new THREE.Vector3();
    const orientationCubeCameraDirection = new THREE.Vector3();
    let wheelNavigationPending = false;
    let wheelNavigationResetId: number | null = null;

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

      switchCameraProjection(propsRef.current.cameraProjection);

      // Dampened rotation controls update
      const controlsChanged = controls.update();

      const { viewMode: vMode, materialType: mType, autoRotate: spinOn } = propsRef.current;

      if (spinOn) {
        assemblyGroup.rotation.y += 0.003;
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
        mType !== prevMat
      ) {
        measurementPoints = [];
        disposeMeasurementGroup();
        disposePreviousMeasurementGroup();
        rebuildSceneTopology(isNewModel);
        prevResToken = activeToken;
        prevViewMode = vMode;
        prevMat = mType;
        prevHighlightToken = "";
        previousHighlightNames = new Set();
        prevDatumDatumsRef = null;
        prevDatumTargetsRef = null;
        prevDatumReferenceFramesRef = null;
        prevToleranceRef = null;
        prevDatumMappingRef = null;
        prevDatumSceneFaces = -1;
        refreshDatumAnchorCache();
        refreshPmiDimensionToleranceOverlay();
        prevDatumDatumsRef = propsRef.current.datums || [];
        prevDatumTargetsRef = propsRef.current.datumTargets || [];
        prevDatumReferenceFramesRef = propsRef.current.datumReferenceFrames || [];
        prevToleranceRef = propsRef.current.tolerances || [];
        prevDatumMappingRef = propsRef.current.customFaceMapping || {};
        prevShowDatumFeatures = propsRef.current.showDatumFeatures;
        prevShowDatumTargets = propsRef.current.showDatumTargets;
        prevShowDatumReferenceFrames = propsRef.current.showDatumReferenceFrames;
        prevShowDimensionalTolerances = propsRef.current.showDimensionalTolerances;
        prevDatumSceneFaces = renderedObjectByName.size;
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
      updateEdgeHighlightResolution();
      updateVertexMarkerScreenScale();

      if (orientationCubeRef.current) {
        orientationCubeCameraDirection.copy(camera.position).sub(controls.target).normalize();
        const yaw = Math.atan2(orientationCubeCameraDirection.x, orientationCubeCameraDirection.z);
        const pitch = Math.asin(THREE.MathUtils.clamp(orientationCubeCameraDirection.y, -1, 1));
        orientationCubeRef.current.style.transform = `rotateX(${pitch}rad) rotateY(${-yaw}rad)`;
      }

      // 3D Projected Annotations update (Reference Datums overlay)
      const currentDatumsRef = propsRef.current.datums || [];
      const currentDatumTargetsRef = propsRef.current.datumTargets || [];
      const currentDatumReferenceFramesRef = propsRef.current.datumReferenceFrames || [];
      const currentToleranceRef = propsRef.current.tolerances || [];
      const currentMappingRef = propsRef.current.customFaceMapping || {};
      const currentShowDatumFeatures = propsRef.current.showDatumFeatures;
      const currentShowDatumTargets = propsRef.current.showDatumTargets;
      const currentShowDatumReferenceFrames = propsRef.current.showDatumReferenceFrames;
      const currentShowDimensionalTolerances = propsRef.current.showDimensionalTolerances;
      const currentSceneObjectCount = renderedObjectByName.size;
      const pmiDimensionInputsChanged =
        currentToleranceRef !== prevToleranceRef ||
        currentMappingRef !== prevDatumMappingRef ||
        currentShowDimensionalTolerances !== prevShowDimensionalTolerances ||
        currentSceneObjectCount !== prevDatumSceneFaces;
      const datumAnchorInputsChanged =
        currentDatumsRef !== prevDatumDatumsRef ||
        currentDatumTargetsRef !== prevDatumTargetsRef ||
        currentDatumReferenceFramesRef !== prevDatumReferenceFramesRef ||
        currentToleranceRef !== prevToleranceRef ||
        currentMappingRef !== prevDatumMappingRef ||
        currentShowDatumFeatures !== prevShowDatumFeatures ||
        currentShowDatumTargets !== prevShowDatumTargets ||
        currentShowDatumReferenceFrames !== prevShowDatumReferenceFrames ||
        currentSceneObjectCount !== prevDatumSceneFaces;

      if (datumAnchorInputsChanged || pmiDimensionInputsChanged) {
        if (datumAnchorInputsChanged) {
          refreshDatumAnchorCache();
        }
        if (pmiDimensionInputsChanged) {
          refreshPmiDimensionToleranceOverlay();
        }
        prevDatumDatumsRef = currentDatumsRef;
        prevDatumTargetsRef = currentDatumTargetsRef;
        prevDatumReferenceFramesRef = currentDatumReferenceFramesRef;
        prevToleranceRef = currentToleranceRef;
        prevDatumMappingRef = currentMappingRef;
        prevShowDatumFeatures = currentShowDatumFeatures;
        prevShowDatumTargets = currentShowDatumTargets;
        prevShowDatumReferenceFrames = currentShowDatumReferenceFrames;
        prevShowDimensionalTolerances = currentShowDimensionalTolerances;
        prevDatumSceneFaces = currentSceneObjectCount;
        datumCacheRetryFrame = 0;
      } else if (datumCacheMissingElements > 0 && datumCacheRetryFrame < 12) {
        datumCacheRetryFrame++;
        refreshDatumAnchorCache();
      } else if (controlsChanged || isNavigatingView || !!cameraFocusTarget) {
        updatePmiDimensionLeaderFacing();
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

      if (drfBadgeCache.length > 0) {
        const width = renderer.domElement.clientWidth;
        const height = renderer.domElement.clientHeight;
        drfBadgeCache.forEach((badge) => {
          projectedDatumPoint.copy(badge.localPoint);
          badge.object.localToWorld(projectedDatumPoint);
          projectedDatumPoint.project(camera);

          const rawX = (projectedDatumPoint.x * 0.5 + 0.5) * width;
          const rawY = (projectedDatumPoint.y * -0.5 + 0.5) * height;
          if (
            !Number.isFinite(rawX) ||
            !Number.isFinite(rawY) ||
            projectedDatumPoint.z < -1 ||
            projectedDatumPoint.z > 1
          ) {
            badge.element.style.display = "none";
            return;
          }

          badge.element.style.transform = `translate3d(${rawX}px, ${rawY}px, 0) translate(-50%, -50%)`;
          badge.element.style.display = "flex";
          badge.element.style.zIndex = "18";
        });
      }

      if (pmiDimensionLabelCache.length > 0) {
        const width = renderer.domElement.clientWidth;
        const height = renderer.domElement.clientHeight;
        pmiDimensionLabelCache.forEach((entry) => {
          const resolvedPoint = entry.resolvePoint?.();
          if (resolvedPoint) {
            entry.point.copy(resolvedPoint);
          }
          projectedDatumPoint.copy(entry.point);
          assemblyGroup.localToWorld(projectedDatumPoint);
          projectedDatumPoint.project(camera);

          const rawX = (projectedDatumPoint.x * 0.5 + 0.5) * width;
          const rawY = (projectedDatumPoint.y * -0.5 + 0.5) * height;
          if (
            !Number.isFinite(rawX) ||
            !Number.isFinite(rawY) ||
            projectedDatumPoint.z < -1 ||
            projectedDatumPoint.z > 1
          ) {
            if (entry.visible) {
              entry.element.style.display = "none";
              entry.visible = false;
            }
            return;
          }

          const screenX = Math.round(rawX * 2) / 2;
          const screenY = Math.round(rawY * 2) / 2;
          const labelTransform = entry.resolveTransform?.() || "translate(0, -50%)";
          const fullTransform = `translate3d(${screenX}px, ${screenY}px, 0) ${labelTransform}`;
          if (
            !entry.visible ||
            Math.abs(screenX - entry.screenX) >= 0.5 ||
            Math.abs(screenY - entry.screenY) >= 0.5 ||
            entry.element.style.transform !== fullTransform
          ) {
            entry.element.style.transform = fullTransform;
            entry.screenX = screenX;
            entry.screenY = screenY;
          }
          if (!entry.visible) {
            entry.element.style.display = "flex";
            entry.visible = true;
          }
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
      dimensionOverlayVisibilityRefreshRef.current = null;
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
      if (wheelNavigationResetId !== null) {
        window.clearTimeout(wheelNavigationResetId);
      }
      resizeObserver.disconnect();
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
      canvas.removeEventListener("click", handleMouseClick);
      canvas.removeEventListener("wheel", handleWheelNavigation);
      controls.removeEventListener("start", handleControlsStart);
      controls.removeEventListener("change", handleControlsChange);
      controls.removeEventListener("end", handleControlsEnd);
      controls.dispose();
      clearPmiDimensionToleranceOverlay();
      clearDatumReferenceFrameBadges();
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
          cursor: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='25' height='25' viewBox='0 0 25 25'%3E%3Cpath d='M12.5 1v23M1 12.5h23' stroke='black' stroke-width='1' stroke-linecap='square'/%3E%3Ccircle cx='12.5' cy='12.5' r='3' fill='none' stroke='black' stroke-width='1'/%3E%3C/svg%3E") 12 12, crosshair`,
        }}
      />

      {/* Datum reference frame labels */}
      {showDatumReferenceFrames && datumReferenceFrames.length > 0 && (
        <div
          className="absolute inset-0 pointer-events-none z-10 overflow-hidden"
          id="drf-badges-overlay"
          style={{ width: "100%", height: "100%" }}
        />
      )}

      {/* Dimensional PMI labels */}
      <div
        className="absolute inset-0 pointer-events-none z-10 overflow-hidden"
        id="pmi-dimensional-labels-overlay"
        style={{ width: "100%", height: "100%" }}
      />

      {/* 3D Datums Overlay */}
      {((showDatumFeatures && datums.length > 0) || (showDatumTargets && datumTargets.length > 0)) && (
        <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden" id="datum-annotations-overlay" style={{ width: '100%', height: '100%' }}>
          {[
            ...(showDatumFeatures
              ? datums.filter((d) => d.type !== "Datum Target Set").map((d) => ({ ...d, annotationKind: "datum" }))
              : []),
            ...(showDatumTargets
              ? datumTargets.map((d) => ({ ...d, annotationKind: "datumTarget" }))
              : []),
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
                    ? "h-8 w-8 min-w-8 overflow-visible rounded-full border-2 border-emerald-700 p-0 text-emerald-800 hover:border-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
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

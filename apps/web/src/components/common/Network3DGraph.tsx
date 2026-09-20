import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ViewHelper } from 'three/examples/jsm/helpers/ViewHelper.js';
import {
  RotateCw, ZoomIn, ZoomOut, Maximize2, Minimize2, Play, Pause,
  Layers, Eye, EyeOff, RefreshCw, Sparkles, Filter, Check, ChevronDown,
  Search, X,
  User, Phone as PhoneIcon, Car, Building2, MapPin, CreditCard, Briefcase, Package, Calendar, Circle,
  Network, Box
} from 'lucide-react';

export interface Graph3DNode {
  id: string;
  nodeType: string;
  name?: string;
  number?: string;
  licensePlate?: string;
  accountNumber?: string;
  risk_score?: number | string;
  occupation?: string;
  status?: string;
  flagged?: boolean;
  [key: string]: any;
}

export interface Graph3DEdge {
  id?: string;
  source: string;
  target: string;
  type: string;
  confidence?: number;
  amount?: number | string;
  duration?: number;
  [key: string]: any;
}

interface Network3DGraphProps {
  nodes: Graph3DNode[];
  edges: Graph3DEdge[];
  selectedNodeId?: string | null;
  onSelectNode: (node: Graph3DNode | null) => void;
  onSelectEdge?: (edge: Graph3DEdge | null) => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onSwitchTo2D?: () => void;
}

const TYPE_COLORS: Record<string, string> = {
  Person: '#3b82f6',       // Blue
  Phone: '#10b981',        // Emerald Green
  Vehicle: '#f97316',      // Orange
  Organization: '#8b5cf6', // Purple
  Location: '#ef4444',     // Crimson
  Account: '#f59e0b',      // Amber
  Case: '#06b6d4',         // Cyan
  Evidence: '#6366f1',     // Indigo
  Event: '#ec4899',        // Pink
};

const renderEntityIcon = (type: string, size = 14, color?: string) => {
  const iconProps = { size, color: color || TYPE_COLORS[type] || '#94a3b8', strokeWidth: 2 };
  switch (type) {
    case 'Person': return <User {...iconProps} />;
    case 'Phone': return <PhoneIcon {...iconProps} />;
    case 'Vehicle': return <Car {...iconProps} />;
    case 'Organization': return <Building2 {...iconProps} />;
    case 'Location': return <MapPin {...iconProps} />;
    case 'Account': return <CreditCard {...iconProps} />;
    case 'Case': return <Briefcase {...iconProps} />;
    case 'Evidence': return <Package {...iconProps} />;
    case 'Event': return <Calendar {...iconProps} />;
    default: return <Circle {...iconProps} />;
  }
};

export default function Network3DGraph({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  isFullscreen,
  onToggleFullscreen,
  onSwitchTo2D,
}: Network3DGraphProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<Graph3DNode | null>(null);
  const [simRunning, setSimRunning] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);

  // Distinct entity types present in the dataset
  const availableTypes = useMemo(() => {
    const types = new Set<string>();
    nodes.forEach(n => {
      if (n.nodeType) types.add(n.nodeType);
    });
    if (types.size === 0) {
      ['Person', 'Phone', 'Vehicle', 'Account', 'Case', 'Organization', 'Location'].forEach(t => types.add(t));
    }
    return Array.from(types).sort();
  }, [nodes]);

  // Selected types multi-select state (starts with all available types selected)
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(() => new Set(availableTypes));
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement>(null);

  // Sync initial selection once availableTypes is ready
  const hasInitializedTypes = useRef(false);
  useEffect(() => {
    if (!hasInitializedTypes.current && availableTypes.length > 0) {
      setSelectedTypes(new Set(availableTypes));
      hasInitializedTypes.current = true;
    }
  }, [availableTypes]);

  // Close filter menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
        setFilterMenuOpen(false);
      }
    };
    if (filterMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [filterMenuOpen]);

  const isAllSelected = availableTypes.length > 0 && selectedTypes.size === availableTypes.length;
  const isNoneSelected = selectedTypes.size === 0;

  const toggleType = (t: string) => {
    setSelectedTypes(prev => {
      const next = new Set(prev);
      if (next.has(t)) {
        next.delete(t);
      } else {
        next.add(t);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedTypes(new Set(availableTypes));
  };

  const handleClearAll = () => {
    setSelectedTypes(new Set());
  };

  // References to keep Three.js state across re-renders
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const viewHelperRef = useRef<ViewHelper | null>(null);
  const animFrameId = useRef<number | null>(null);

  const nodeMeshes = useRef<Map<string, THREE.Mesh>>(new Map());
  const haloMeshes = useRef<Map<string, THREE.Mesh>>(new Map());
  const edgeLineSegments = useRef<THREE.LineSegments | null>(null);
  const particleSystem = useRef<THREE.Points | null>(null);
  const labelSprites = useRef<Map<string, THREE.Sprite>>(new Map());

  // 3D physics position data
  const simNodes = useRef<Map<string, { x: number; y: number; z: number; vx: number; vy: number; vz: number }>>(new Map());

  // Helper to get display label
  const getNodeLabel = useCallback((n: Graph3DNode) => {
    return n.name || n.number || n.licensePlate || n.accountNumber || n.id || 'Unknown';
  }, []);

  // Smooth camera fly-to for target node
  const flyToNode = useCallback((targetNode: Graph3DNode) => {
    onSelectNode(targetNode);

    const mesh = nodeMeshes.current.get(targetNode.id);
    const simPos = simNodes.current.get(targetNode.id);
    const camera = cameraRef.current;
    const controls = controlsRef.current;

    if (!camera || !controls) return;

    const pos = mesh ? mesh.position.clone() : (simPos ? new THREE.Vector3(simPos.x, simPos.y, simPos.z) : new THREE.Vector3(0, 0, 0));
    const targetPos = new THREE.Vector3(pos.x + 40, pos.y + 30, pos.z + 80);

    let t = 0;
    const startPos = camera.position.clone();
    const flyAnim = () => {
      t += 0.04;
      const ease = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(t, 1));
      camera.position.lerpVectors(startPos, targetPos, ease);
      controls.target.lerp(pos, 0.08);
      controls.update();
      if (t < 1) requestAnimationFrame(flyAnim);
    };
    flyAnim();
  }, [onSelectNode]);

  // 3D Search State & Logic
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Close search dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter matching search results
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return nodes
      .filter(n => {
        const label = getNodeLabel(n).toLowerCase();
        const id = (n.id || '').toLowerCase();
        const type = (n.nodeType || '').toLowerCase();
        const num = (n.number || '').toLowerCase();
        const plate = (n.licensePlate || '').toLowerCase();
        const acc = (n.accountNumber || '').toLowerCase();
        const occ = (n.occupation || '').toLowerCase();
        return (
          label.includes(q) ||
          id.includes(q) ||
          type.includes(q) ||
          num.includes(q) ||
          plate.includes(q) ||
          acc.includes(q) ||
          occ.includes(q)
        );
      })
      .slice(0, 10);
  }, [searchQuery, nodes, getNodeLabel]);

  const handleSelectSearchResult = (node: Graph3DNode) => {
    // If the node's type is filtered out, automatically re-enable it so the node is visible
    if (node.nodeType && !selectedTypes.has(node.nodeType) && selectedTypes.size > 0 && selectedTypes.size < availableTypes.length) {
      setSelectedTypes(prev => {
        const next = new Set(prev);
        next.add(node.nodeType);
        return next;
      });
    }

    flyToNode(node);
    setSearchOpen(false);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (searchResults.length > 0) {
        handleSelectSearchResult(searchResults[0]);
      }
    } else if (e.key === 'Escape') {
      setSearchOpen(false);
      setSearchQuery('');
    }
  };

  // Filter nodes based on active type filter
  const visibleNodes = useMemo(() => {
    if (selectedTypes.size === 0) {
      return [];
    }
    if (selectedTypes.size === availableTypes.length) {
      return nodes;
    }
    return nodes.filter(n => selectedTypes.has(n.nodeType));
  }, [nodes, selectedTypes, availableTypes]);

  const visibleNodeIdSet = useMemo(() => new Set(visibleNodes.map(n => n.id)), [visibleNodes]);
  const visibleEdges = useMemo(() => edges.filter(e => visibleNodeIdSet.has(e.source) && visibleNodeIdSet.has(e.target)), [edges, visibleNodeIdSet]);

  // Initialize 3D physics positions randomly in sphere or preserve existing
  useEffect(() => {
    const existing = simNodes.current;
    const count = visibleNodes.length || 1;
    const radius = Math.max(120, Math.cbrt(count) * 65);

    visibleNodes.forEach((n, i) => {
      if (!existing.has(n.id)) {
        // Distribute uniformly in 3D sphere (Fibonacci lattice)
        const phi = Math.acos(1 - 2 * (i + 0.5) / count);
        const theta = Math.PI * (1 + Math.sqrt(5)) * (i + 0.5);
        const r = radius * (0.6 + Math.random() * 0.4);

        existing.set(n.id, {
          x: r * Math.sin(phi) * Math.cos(theta),
          y: r * Math.sin(phi) * Math.sin(theta),
          z: r * Math.cos(phi),
          vx: 0,
          vy: 0,
          vz: 0,
        });
      }
    });
  }, [visibleNodes]);

  // Main Three.js Scene Setup & Render Loop
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    // 1. Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color('#070c18'); // Cyber intelligence dark
    scene.fog = new THREE.FogExp2('#070c18', 0.0012);

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(50, width / height, 1, 4000);
    camera.position.set(0, 80, 420);
    cameraRef.current = camera;

    // 3. WebGL Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    rendererRef.current = renderer;

    renderer.autoClear = false;
    container.replaceChildren(renderer.domElement);

    // 4. Orbit Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.8;
    controls.maxDistance = 1600;
    controls.minDistance = 30;
    controlsRef.current = controls;

    // 4b. 3D Viewport Orientation Gizmo (like Unity Scene Gizmo)
    const viewHelper = new ViewHelper(camera, renderer.domElement);
    viewHelper.setLabels('X', 'Y', 'Z');
    viewHelper.setLabelStyle('bold 24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', '#ffffff', 14);
    viewHelper.location = { top: null, right: 18, bottom: 18, left: null };
    viewHelper.center.copy(controls.target);
    viewHelperRef.current = viewHelper;

    // Disable depthWrite on all ViewHelper sprites so their transparent billboard quads never clip rings
    viewHelper.traverse((child) => {
      if ((child as any).isSprite) {
        const sprite = child as THREE.Sprite;
        sprite.material.depthWrite = false;
        sprite.renderOrder = 2;
      }
    });

    // Glowing center sphere inside gizmo
    const centerGizmoMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 20, 20),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, depthWrite: false, toneMapped: false })
    );
    centerGizmoMesh.renderOrder = 1;
    viewHelper.add(centerGizmoMesh);

    // Two prominent 3D Torus Rings (Horizontal Equator & Vertical Meridian)
    // depthTest: false & depthWrite: false ensures rings are never clipped or masked at ANY angle
    // 1. Horizontal Ring (XZ plane - Equator)
    const hRingGeo = new THREE.TorusGeometry(1.0, 0.032, 16, 64);
    const hRingMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    const horizontalRing = new THREE.Mesh(hRingGeo, hRingMat);
    horizontalRing.rotation.x = Math.PI / 2;
    horizontalRing.renderOrder = 0;
    viewHelper.add(horizontalRing);

    // 2. Vertical Ring (XY plane - Meridian)
    const vRingGeo = new THREE.TorusGeometry(1.0, 0.032, 16, 64);
    const vRingMat = new THREE.MeshBasicMaterial({
      color: 0x818cf8,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    const verticalRing = new THREE.Mesh(vRingGeo, vRingMat);
    verticalRing.renderOrder = 0;
    viewHelper.add(verticalRing);

    setSceneReady(true);

    // 5. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambientLight);

    const blueLight = new THREE.PointLight(0x3b82f6, 40, 800);
    blueLight.position.set(200, 250, 200);
    scene.add(blueLight);

    const purpleLight = new THREE.PointLight(0xa855f7, 30, 800);
    purpleLight.position.set(-200, -150, -200);
    scene.add(purpleLight);

    // 6. Deep Space Grid Plane
    const grid = new THREE.GridHelper(800, 40, 0x1e293b, 0x0f172a);
    grid.position.y = -180;
    scene.add(grid);

    // 6b. Central Holographic Cyber Globe
    const cyberGlobeGroup = new THREE.Group();
    const globeRadius = Math.max(120, Math.cbrt(visibleNodes.length || 1) * 58);

    const globeGeo = new THREE.SphereGeometry(globeRadius, 24, 16);
    const globeMat = new THREE.MeshBasicMaterial({
      color: 0x0284c7,
      wireframe: true,
      transparent: true,
      opacity: 0.10,
    });
    const globeMesh = new THREE.Mesh(globeGeo, globeMat);
    cyberGlobeGroup.add(globeMesh);

    const eqGeo = new THREE.RingGeometry(globeRadius - 0.8, globeRadius + 1.2, 56);
    const eqMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.22,
    });
    const eqMesh = new THREE.Mesh(eqGeo, eqMat);
    eqMesh.rotation.x = Math.PI / 2;
    cyberGlobeGroup.add(eqMesh);

    const merGeo = new THREE.RingGeometry(globeRadius - 0.8, globeRadius + 1.2, 56);
    const merMat = new THREE.MeshBasicMaterial({
      color: 0x818cf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.16,
    });
    const merMesh = new THREE.Mesh(merGeo, merMat);
    merMesh.rotation.y = Math.PI / 2;
    cyberGlobeGroup.add(merMesh);

    scene.add(cyberGlobeGroup);

    // 7. Raycaster for clicking & hovering
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2(-9999, -9999);

    let pointerDownPos = { x: 0, y: 0 };
    const onPointerDown = (event: MouseEvent) => {
      pointerDownPos = { x: event.clientX, y: event.clientY };
    };

    const onMouseMove = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;

      // Bottom-right Gizmo region check (dim=128, right=18, bottom=18)
      const gizmoCenterX = rect.width - 18 - 64;
      const gizmoCenterY = rect.height - 18 - 64;
      const distFromGizmo = Math.hypot(mouseX - gizmoCenterX, mouseY - gizmoCenterY);

      if (distFromGizmo <= 64) {
        container.style.cursor = 'pointer';
        setHoveredNode(null);
        mouse.x = -9999;
        mouse.y = -9999;
        return;
      }

      mouse.x = (mouseX / rect.width) * 2 - 1;
      mouse.y = -(mouseY / rect.height) * 2 + 1;
    };

    // Smooth transition to Isometric perspective
    const animateToIsometric = () => {
      const currentDist = camera.position.distanceTo(controls.target) || 420;
      const isoDir = new THREE.Vector3(1, 0.75, 1).normalize();
      const targetPos = controls.target.clone().add(isoDir.multiplyScalar(currentDist));

      let t = 0;
      const startPos = camera.position.clone();
      const startTarget = controls.target.clone();
      const isoAnim = () => {
        t += 0.05;
        const ease = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(t, 1));
        camera.position.lerpVectors(startPos, targetPos, ease);
        camera.lookAt(startTarget);
        controls.update();
        if (t < 1) {
          requestAnimationFrame(isoAnim);
        }
      };
      isoAnim();
    };

    const onClick = (event: MouseEvent) => {
      // If mouse moved noticeably during press, user was orbiting/dragging -> ignore click
      const distMoved = Math.hypot(event.clientX - pointerDownPos.x, event.clientY - pointerDownPos.y);
      if (distMoved > 6) return;

      const rect = container.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const clickY = event.clientY - rect.top;

      // Check if click was inside Bottom-Right Gizmo (dim=128, right=18, bottom=18)
      const gizmoCenterX = rect.width - 18 - 64;
      const gizmoCenterY = rect.height - 18 - 64;
      const distFromGizmo = Math.hypot(clickX - gizmoCenterX, clickY - gizmoCenterY);

      if (distFromGizmo <= 64) {
        // Center sphere click -> Isometric view
        if (distFromGizmo <= 20) {
          animateToIsometric();
          return;
        }

        // Axis cone / badge click -> Snap to orthogonal axis
        if (viewHelper.handleClick(event)) {
          return;
        }
        return; // Absorb click inside gizmo bounds so background nodes aren't triggered
      }

      const clickMouse = new THREE.Vector2(
        (clickX / rect.width) * 2 - 1,
        -(clickY / rect.height) * 2 + 1
      );

      raycaster.setFromCamera(clickMouse, camera);
      const meshes = Array.from(nodeMeshes.current.values());
      const intersects = raycaster.intersectObjects(meshes);

      if (intersects.length > 0) {
        const hit = intersects[0].object as THREE.Mesh;
        const targetNode = hit.userData.node as Graph3DNode;
        if (targetNode) {
          flyToNode(targetNode);
        }
      } else {
        onSelectNode(null);
      }
    };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('click', onClick);

    // 8. Resize Observer
    const resizeObserver = new ResizeObserver(() => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    // 9. Particles Traveling along Edges
    const maxParticles = 200;
    const particleGeo = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(maxParticles * 3);
    const particleColors = new Float32Array(maxParticles * 3);

    for (let i = 0; i < maxParticles; i++) {
      particlePositions[i * 3] = 0;
      particlePositions[i * 3 + 1] = 0;
      particlePositions[i * 3 + 2] = 0;
      particleColors[i * 3] = 0.3;
      particleColors[i * 3 + 1] = 0.7;
      particleColors[i * 3 + 2] = 1.0;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    particleGeo.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));

    const particleMat = new THREE.PointsMaterial({
      size: 4.5,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });
    const pPoints = new THREE.Points(particleGeo, particleMat);
    scene.add(pPoints);
    particleSystem.current = pPoints;

    // Track particle progress along random edges
    const particleEdges = Array.from({ length: maxParticles }, () => ({
      edgeIndex: Math.floor(Math.random() * (visibleEdges.length || 1)),
      progress: Math.random(),
      speed: 0.006 + Math.random() * 0.008,
    }));

    // 10. Animation & Physics Simulation Loop
    let lastTime = performance.now();

    const animate = (currentTime: number) => {
      animFrameId.current = requestAnimationFrame(animate);
      const delta = Math.min((currentTime - lastTime) / 1000, 0.1);
      lastTime = currentTime;

      // Force simulation step (Spring-Embedder vector forces)
      if (simRunning) {
        const sim = simNodes.current;
        const kCenter = 0.0018;
        const kRepel = 24000;
        const kSpring = 0.025;
        const damping = 0.88;

        // Repulsion between all pairs
        const nodeArr = visibleNodes;
        for (let i = 0; i < nodeArr.length; i++) {
          const nA = sim.get(nodeArr[i].id);
          if (!nA) continue;

          // Centering gravity
          nA.vx -= nA.x * kCenter;
          nA.vy -= nA.y * kCenter;
          nA.vz -= nA.z * kCenter;

          for (let j = i + 1; j < nodeArr.length; j++) {
            const nB = sim.get(nodeArr[j].id);
            if (!nB) continue;

            const dx = nA.x - nB.x;
            const dy = nA.y - nB.y;
            const dz = nA.z - nB.z;
            const distSq = dx * dx + dy * dy + dz * dz + 100;
            const dist = Math.sqrt(distSq);

            if (dist < 350) {
              const force = kRepel / (distSq * dist);
              nA.vx += dx * force;
              nA.vy += dy * force;
              nA.vz += dz * force;

              nB.vx -= dx * force;
              nB.vy -= dy * force;
              nB.vz -= dz * force;
            }
          }
        }

        // Spring attraction along edges
        visibleEdges.forEach(e => {
          const nA = sim.get(e.source);
          const nB = sim.get(e.target);
          if (!nA || !nB) return;

          const dx = nB.x - nA.x;
          const dy = nB.y - nA.y;
          const dz = nB.z - nA.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
          const idealDist = 75;
          const force = (dist - idealDist) * kSpring;

          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          const fz = (dz / dist) * force;

          nA.vx += fx;
          nA.vy += fy;
          nA.vz += fz;

          nB.vx -= fx;
          nB.vy -= fy;
          nB.vz -= fz;
        });

        // Apply velocity to position
        nodeArr.forEach(n => {
          const data = sim.get(n.id);
          if (!data) return;

          data.vx *= damping;
          data.vy *= damping;
          data.vz *= damping;

          data.x += data.vx;
          data.y += data.vy;
          data.z += data.vz;

          // Update Three.js mesh positions
          const mesh = nodeMeshes.current.get(n.id);
          if (mesh) {
            mesh.position.set(data.x, data.y, data.z);
          }

          const halo = haloMeshes.current.get(n.id);
          if (halo) {
            halo.position.set(data.x, data.y, data.z);
          }

          const sprite = labelSprites.current.get(n.id);
          if (sprite) {
            sprite.position.set(data.x, data.y + 14, data.z);
          }
        });
      }

      // Update 3D Edge Lines
      if (edgeLineSegments.current) {
        const posAttr = edgeLineSegments.current.geometry.attributes.position as THREE.BufferAttribute;
        const sim = simNodes.current;

        visibleEdges.forEach((e, i) => {
          const nA = sim.get(e.source);
          const nB = sim.get(e.target);
          if (nA && nB) {
            posAttr.setXYZ(i * 2, nA.x, nA.y, nA.z);
            posAttr.setXYZ(i * 2 + 1, nB.x, nB.y, nB.z);
          }
        });
        posAttr.needsUpdate = true;
      }

      // Update Traveling Data Particles
      if (particleSystem.current && visibleEdges.length > 0) {
        const sim = simNodes.current;
        const posAttr = particleSystem.current.geometry.attributes.position as THREE.BufferAttribute;

        particleEdges.forEach((p, i) => {
          const edge = visibleEdges[p.edgeIndex % visibleEdges.length];
          if (!edge) return;

          const nA = sim.get(edge.source);
          const nB = sim.get(edge.target);
          if (nA && nB) {
            p.progress += p.speed;
            if (p.progress > 1) {
              p.progress = 0;
              p.edgeIndex = Math.floor(Math.random() * visibleEdges.length);
            }

            const t = p.progress;
            const px = nA.x + (nB.x - nA.x) * t;
            const py = nA.y + (nB.y - nA.y) * t;
            const pz = nA.z + (nB.z - nA.z) * t;

            posAttr.setXYZ(i, px, py, pz);
          }
        });
        posAttr.needsUpdate = true;
      }

      // Raycast for Hover Effects
      raycaster.setFromCamera(mouse, camera);
      const meshes = Array.from(nodeMeshes.current.values());
      const intersects = raycaster.intersectObjects(meshes);

      if (intersects.length > 0) {
        const hit = intersects[0].object as THREE.Mesh;
        const targetNode = hit.userData.node as Graph3DNode;
        setHoveredNode(targetNode);
        container.style.cursor = 'pointer';
      } else {
        setHoveredNode(null);
        container.style.cursor = 'grab';
      }

      // Pulse high-risk halos
      const time = performance.now() * 0.003;
      haloMeshes.current.forEach(halo => {
        const scale = 1 + Math.sin(time) * 0.15;
        halo.scale.set(scale, scale, scale);
      });

      cyberGlobeGroup.rotation.y += 0.0006;

      viewHelper.center.copy(controls.target);
      if (viewHelper.animating) {
        controls.enabled = false;
        viewHelper.update(delta);
      } else {
        controls.enabled = true;
        controls.update();
      }

      renderer.clear();
      renderer.render(scene, camera);
      viewHelper.render(renderer);
    };

    animFrameId.current = requestAnimationFrame(animate);

    return () => {
      if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
      setSceneReady(false);
      resizeObserver.disconnect();
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('mousemove', onMouseMove);
      container.removeEventListener('click', onClick);
      hRingGeo.dispose();
      hRingMat.dispose();
      vRingGeo.dispose();
      vRingMat.dispose();
      viewHelper.dispose();
      renderer.dispose();
    };
  }, [visibleNodes, visibleEdges, autoRotate, simRunning]);

  // Sync Node & Edge 3D Geometries into Scene
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Clear old meshes
    nodeMeshes.current.forEach(m => scene.remove(m));
    nodeMeshes.current.clear();

    haloMeshes.current.forEach(h => scene.remove(h));
    haloMeshes.current.clear();

    labelSprites.current.forEach(s => scene.remove(s));
    labelSprites.current.clear();

    if (edgeLineSegments.current) {
      scene.remove(edgeLineSegments.current);
      edgeLineSegments.current.geometry.dispose();
      edgeLineSegments.current = null;
    }

    // Shared Geometries
    const sphereGeo = new THREE.SphereGeometry(6, 24, 24);
    const haloGeo = new THREE.RingGeometry(8, 10, 32);

    // Create 3D Node Meshes
    visibleNodes.forEach(node => {
      const colorHex = TYPE_COLORS[node.nodeType] || '#64748b';
      const isSelected = selectedNodeId === node.id;
      const isHighRisk = Number(node.risk_score || 0) >= 0.7 || node.flagged;

      const nodeMat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(colorHex),
        emissive: new THREE.Color(colorHex),
        emissiveIntensity: isSelected ? 0.6 : 0.25,
        shininess: 90,
      });

      const mesh = new THREE.Mesh(sphereGeo, nodeMat);
      mesh.userData = { id: node.id, node };

      const scale = isSelected ? 1.5 : isHighRisk ? 1.25 : 1.0;
      mesh.scale.set(scale, scale, scale);

      const simPos = simNodes.current.get(node.id) || { x: 0, y: 0, z: 0 };
      mesh.position.set(simPos.x, simPos.y, simPos.z);

      scene.add(mesh);
      nodeMeshes.current.set(node.id, mesh);

      // Add Glowing Halo Ring around High-Risk or Selected nodes
      if (isHighRisk || isSelected) {
        const haloMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(isSelected ? '#38bdf8' : '#ef4444'),
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.65,
        });
        const halo = new THREE.Mesh(haloGeo, haloMat);
        halo.position.copy(mesh.position);
        scene.add(halo);
        haloMeshes.current.set(node.id, halo);
      }

      // Create Floating 3D Text Billboard Label
      if (showLabels) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.font = 'bold 24px "Inter", sans-serif';
          ctx.fillStyle = isSelected ? '#38bdf8' : '#f8fafc';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.shadowColor = 'rgba(0,0,0,0.9)';
          ctx.shadowBlur = 6;

          const labelText = getNodeLabel(node);
          ctx.fillText(labelText, 128, 32);

          const texture = new THREE.CanvasTexture(canvas);
          texture.minFilter = THREE.LinearFilter;
          const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: isSelected ? 1 : 0.85 });
          const sprite = new THREE.Sprite(spriteMat);
          sprite.scale.set(38, 9.5, 1);
          sprite.position.set(simPos.x, simPos.y + 14, simPos.z);

          scene.add(sprite);
          labelSprites.current.set(node.id, sprite);
        }
      }
    });

    // Create 3D Edge Line Segments
    if (visibleEdges.length > 0) {
      const linePositions = new Float32Array(visibleEdges.length * 6);
      const lineColors = new Float32Array(visibleEdges.length * 6);

      visibleEdges.forEach((e, i) => {
        const nA = simNodes.current.get(e.source) || { x: 0, y: 0, z: 0 };
        const nB = simNodes.current.get(e.target) || { x: 0, y: 0, z: 0 };

        linePositions[i * 6] = nA.x;
        linePositions[i * 6 + 1] = nA.y;
        linePositions[i * 6 + 2] = nA.z;

        linePositions[i * 6 + 3] = nB.x;
        linePositions[i * 6 + 4] = nB.y;
        linePositions[i * 6 + 5] = nB.z;

        const srcNode = nodes.find(n => n.id === e.source);
        const col = new THREE.Color(srcNode ? TYPE_COLORS[srcNode.nodeType] || '#64748b' : '#64748b');

        lineColors[i * 6] = col.r * 0.7;
        lineColors[i * 6 + 1] = col.g * 0.7;
        lineColors[i * 6 + 2] = col.b * 0.7;

        lineColors[i * 6 + 3] = 0.4;
        lineColors[i * 6 + 4] = 0.5;
        lineColors[i * 6 + 5] = 0.7;
      });

      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
      lineGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));

      const lineMat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.45,
        linewidth: 1,
      });

      const lines = new THREE.LineSegments(lineGeo, lineMat);
      scene.add(lines);
      edgeLineSegments.current = lines;
    }
  }, [visibleNodes, visibleEdges, selectedNodeId, showLabels, getNodeLabel]);

  // Update controls auto-rotate state
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
    }
  }, [autoRotate]);

  // Camera reset
  const handleResetCamera = () => {
    if (cameraRef.current && controlsRef.current) {
      cameraRef.current.position.set(0, 80, 420);
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  };

  const handleZoom = (factor: number) => {
    if (cameraRef.current) {
      cameraRef.current.position.multiplyScalar(factor);
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: '#070c18' }}>
      {/* 3D WebGL Canvas Container */}
      <div ref={mountRef} style={{ width: '100%', height: '100%', cursor: 'grab' }} />

      {/* Floating 3D Control Bar (Vertical Icon-Only Toolbar) */}
      <div style={{
        position: 'absolute',
        top: 14,
        left: 16,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        zIndex: 10,
        background: 'rgba(15, 23, 42, 0.88)',
        backdropFilter: 'blur(12px)',
        padding: '6px',
        borderRadius: 10,
        border: '1px solid rgba(255, 255, 255, 0.12)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
      }}>
        {/* Orbit Auto-Rotate Toggle */}
        <button
          onClick={() => setAutoRotate(!autoRotate)}
          style={{
            width: 30,
            height: 30,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 6,
            cursor: 'pointer',
            transition: 'all 150ms ease',
            background: autoRotate ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255, 255, 255, 0.05)',
            color: autoRotate ? '#38bdf8' : '#94a3b8',
            border: autoRotate ? '1px solid rgba(56, 189, 248, 0.6)' : '1px solid rgba(255, 255, 255, 0.08)',
            boxShadow: autoRotate ? '0 0 10px rgba(56, 189, 248, 0.35)' : 'none',
          }}
          title={autoRotate ? 'Pause 3D Orbit' : 'Start 3D Orbit'}
        >
          {autoRotate ? <Pause size={14} /> : <Play size={14} />}
        </button>

        {/* Labels Toggle */}
        <button
          onClick={() => setShowLabels(!showLabels)}
          style={{
            width: 30,
            height: 30,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 6,
            cursor: 'pointer',
            transition: 'all 150ms ease',
            background: showLabels ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255, 255, 255, 0.05)',
            color: showLabels ? '#38bdf8' : '#94a3b8',
            border: showLabels ? '1px solid rgba(56, 189, 248, 0.6)' : '1px solid rgba(255, 255, 255, 0.08)',
            boxShadow: showLabels ? '0 0 10px rgba(56, 189, 248, 0.35)' : 'none',
          }}
          title={showLabels ? 'Hide Floating Labels' : 'Show Floating Labels'}
        >
          {showLabels ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>

        {/* Physics toggle */}
        <button
          onClick={() => setSimRunning(!simRunning)}
          style={{
            width: 30,
            height: 30,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 6,
            cursor: 'pointer',
            transition: 'all 150ms ease',
            background: simRunning ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255, 255, 255, 0.05)',
            color: simRunning ? '#38bdf8' : '#94a3b8',
            border: simRunning ? '1px solid rgba(56, 189, 248, 0.6)' : '1px solid rgba(255, 255, 255, 0.08)',
            boxShadow: simRunning ? '0 0 10px rgba(56, 189, 248, 0.35)' : 'none',
          }}
          title={simRunning ? 'Pause 3D Physics (Static)' : 'Resume 3D Physics'}
        >
          <Sparkles size={14} />
        </button>

        {/* Horizontal Divider */}
        <div style={{ width: 20, height: 1, background: 'rgba(255,255,255,0.15)', margin: '2px 0' }} />

        {/* Zoom Controls */}
        <button
          onClick={() => handleZoom(0.85)}
          style={{
            width: 30,
            height: 30,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 6,
            cursor: 'pointer',
            transition: 'all 150ms ease',
            background: 'rgba(255, 255, 255, 0.05)',
            color: '#94a3b8',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
          title="Zoom In"
        >
          <ZoomIn size={14} />
        </button>
        <button
          onClick={() => handleZoom(1.15)}
          style={{
            width: 30,
            height: 30,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 6,
            cursor: 'pointer',
            transition: 'all 150ms ease',
            background: 'rgba(255, 255, 255, 0.05)',
            color: '#94a3b8',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
          title="Zoom Out"
        >
          <ZoomOut size={14} />
        </button>
        <button
          onClick={handleResetCamera}
          style={{
            width: 30,
            height: 30,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 6,
            cursor: 'pointer',
            transition: 'all 150ms ease',
            background: 'rgba(255, 255, 255, 0.05)',
            color: '#94a3b8',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
          title="Reset 3D Camera"
        >
          <RotateCw size={14} />
        </button>
      </div>

      {/* Top Left Bar: Entity Filter & 3D Search Controls */}
      <div style={{
        position: 'absolute',
        top: 14,
        left: 70,
        zIndex: 25,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        {/* Schema Filter Dropdown Menu */}
        <div ref={filterMenuRef} style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setFilterMenuOpen(!filterMenuOpen)}
            style={{
              height: 30,
              padding: '0 10px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(15, 23, 42, 0.88)',
              backdropFilter: 'blur(12px)',
              border: `1px solid ${filterMenuOpen ? 'rgba(56, 189, 248, 0.5)' : 'rgba(255, 255, 255, 0.12)'}`,
              borderRadius: 8,
              color: '#e2e8f0',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
              transition: 'all 150ms ease',
            }}
            title="Filter Entities by Type"
          >
            <Filter size={13} style={{ color: '#38bdf8' }} />
            <span>Filters</span>
            <span style={{
              fontSize: '0.66rem',
              padding: '1px 6px',
              borderRadius: 10,
              background: isAllSelected
                ? 'rgba(255,255,255,0.1)'
                : isNoneSelected
                  ? 'rgba(239, 68, 68, 0.2)'
                  : 'rgba(56, 189, 248, 0.25)',
              color: isAllSelected
                ? '#cbd5e1'
                : isNoneSelected
                  ? '#f87171'
                  : '#38bdf8',
              fontWeight: 700,
            }}>
              {isAllSelected ? 'ALL' : isNoneSelected ? 'NONE' : `${selectedTypes.size} active`}
            </span>
            <ChevronDown
              size={12}
              style={{
                color: '#94a3b8',
                transform: filterMenuOpen ? 'rotate(180deg)' : 'none',
                transition: 'transform 150ms ease',
              }}
            />
          </button>

          {filterMenuOpen && (
            <div style={{
              position: 'absolute',
              top: 36,
              left: 0,
              width: 220,
              background: 'rgba(15, 23, 42, 0.96)',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: 10,
              boxShadow: '0 16px 40px rgba(0, 0, 0, 0.65)',
              padding: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              maxHeight: 340,
              overflowY: 'auto',
            }}>
              {/* Header / Quick Actions */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '2px 6px 6px 6px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                fontSize: '0.68rem',
                color: '#94a3b8',
                fontWeight: 600,
              }}>
                <span>SELECT TYPES</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#38bdf8',
                      cursor: 'pointer',
                      fontSize: '0.68rem',
                      fontWeight: 600,
                      padding: 0,
                    }}
                  >
                    All
                  </button>
                  <span style={{ color: 'rgba(255,255,255,0.2)' }}>|</span>
                  <button
                    type="button"
                    onClick={handleClearAll}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      fontSize: '0.68rem',
                      fontWeight: 600,
                      padding: 0,
                    }}
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* List of entity checkboxes */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                {availableTypes.map(t => {
                  const isChecked = selectedTypes.has(t);
                  const col = TYPE_COLORS[t] || '#38bdf8';
                  const count = nodes.filter(n => n.nodeType === t).length;

                  return (
                    <div
                      key={t}
                      onClick={() => toggleType(t)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '5px 8px',
                        borderRadius: 6,
                        background: isChecked ? 'rgba(255, 255, 255, 0.06)' : 'transparent',
                        cursor: 'pointer',
                        transition: 'background 120ms ease',
                        userSelect: 'none',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {/* Checkbox box */}
                        <div style={{
                          width: 15,
                          height: 15,
                          borderRadius: 4,
                          border: `1.5px solid ${isChecked ? col : 'rgba(255,255,255,0.3)'}`,
                          background: isChecked ? col : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 120ms ease',
                          flexShrink: 0,
                        }}>
                          {isChecked && <Check size={11} color="#0f172a" strokeWidth={3.5} />}
                        </div>

                        {/* Icon and label */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, flexShrink: 0 }}>
                          {renderEntityIcon(t, 13, col)}
                        </div>
                        <span style={{
                          fontSize: '0.76rem',
                          fontWeight: isChecked ? 600 : 500,
                          color: isChecked ? '#f8fafc' : '#94a3b8',
                        }}>
                          {t}
                        </span>
                      </div>

                      {/* Count badge */}
                      <span style={{
                        fontSize: '0.68rem',
                        color: 'rgba(148, 163, 184, 0.7)',
                        fontWeight: 500,
                      }}>
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 3D Search Bar Container */}
        <div ref={searchContainerRef} style={{ position: 'relative' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            height: 30,
            padding: '0 8px 0 10px',
            background: 'rgba(15, 23, 42, 0.88)',
            backdropFilter: 'blur(12px)',
            border: `1px solid ${searchOpen && searchQuery ? 'rgba(56, 189, 248, 0.5)' : 'rgba(255, 255, 255, 0.12)'}`,
            borderRadius: 8,
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
            transition: 'all 150ms ease',
            width: 220,
          }}>
            <Search size={13} style={{ color: '#38bdf8', flexShrink: 0 }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search 3D entities..."
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#f8fafc',
                fontSize: '0.75rem',
                width: '100%',
                fontWeight: 500,
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSearchOpen(false);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 2,
                  cursor: 'pointer',
                  color: '#94a3b8',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Autocomplete Results Dropdown */}
          {searchOpen && searchQuery.trim().length > 0 && (
            <div style={{
              position: 'absolute',
              top: 36,
              left: 0,
              width: 270,
              background: 'rgba(15, 23, 42, 0.96)',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: 10,
              boxShadow: '0 16px 40px rgba(0, 0, 0, 0.65)',
              padding: '6px',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              maxHeight: 320,
              overflowY: 'auto',
              zIndex: 100,
            }}>
              <div style={{
                fontSize: '0.66rem',
                fontWeight: 700,
                color: '#94a3b8',
                padding: '4px 6px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                display: 'flex',
                justifyContent: 'space-between',
              }}>
                <span>Search Results</span>
                <span>{searchResults.length} found</span>
              </div>

              {searchResults.length === 0 ? (
                <div style={{
                  padding: '12px 8px',
                  fontSize: '0.74rem',
                  color: '#64748b',
                  textAlign: 'center',
                }}>
                  No entities matching "{searchQuery}"
                </div>
              ) : (
                searchResults.map(n => {
                  const col = TYPE_COLORS[n.nodeType] || '#38bdf8';
                  const label = getNodeLabel(n);
                  return (
                    <div
                      key={n.id}
                      onClick={() => handleSelectSearchResult(n)}
                      style={{
                        padding: '6px 8px',
                        borderRadius: 6,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        transition: 'background 120ms ease',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                        <div style={{
                          width: 24,
                          height: 24,
                          borderRadius: 6,
                          background: `${col}18`,
                          border: `1px solid ${col}30`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}>
                          {renderEntityIcon(n.nodeType, 13, col)}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                          <span style={{
                            fontSize: '0.76rem',
                            fontWeight: 600,
                            color: '#f8fafc',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}>
                            {label}
                          </span>
                          <span style={{ fontSize: '0.64rem', color: '#94a3b8' }}>
                            ID: {n.id} {n.occupation ? `· ${n.occupation}` : ''}
                          </span>
                        </div>
                      </div>

                      <span style={{
                        fontSize: '0.62rem',
                        fontWeight: 700,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: `${col}25`,
                        color: col,
                        border: `1px solid ${col}40`,
                        textTransform: 'uppercase',
                        flexShrink: 0,
                      }}>
                        {n.nodeType}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right Top Corner: Standalone Switch & Standalone Fullscreen Button */}
      <div style={{
        position: 'absolute',
        top: 14,
        right: 16,
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        {/* Standalone 2D / 3D Segmented Switch */}
        {onSwitchTo2D && (
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            height: 32,
            boxSizing: 'border-box',
            background: 'rgba(15, 23, 42, 0.88)',
            backdropFilter: 'blur(12px)',
            padding: '2px',
            borderRadius: 8,
            border: '1px solid rgba(255, 255, 255, 0.12)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
            gap: 2,
          }}>
            <button
              type="button"
              onClick={onSwitchTo2D}
              title="Switch to 2D Graph View"
              style={{
                height: 26,
                boxSizing: 'border-box',
                padding: '0 9px',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                borderRadius: 6,
                cursor: 'pointer',
                transition: 'all 150ms ease',
                background: 'transparent',
                color: '#94a3b8',
                border: 'none',
                fontSize: '0.74rem',
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = '#f8fafc';
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = '#94a3b8';
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <Network size={13} style={{ color: '#94a3b8' }} />
              <span>2D</span>
            </button>

            <button
              type="button"
              title="Currently in 3D Space View"
              style={{
                height: 26,
                boxSizing: 'border-box',
                padding: '0 9px',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                borderRadius: 6,
                cursor: 'default',
                transition: 'all 150ms ease',
                background: 'rgba(56, 189, 248, 0.22)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.45)',
                boxShadow: '0 0 10px rgba(56, 189, 248, 0.25)',
                fontSize: '0.74rem',
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              <Box size={13} style={{ color: '#38bdf8' }} />
              <span>3D</span>
            </button>
          </div>
        )}

        {/* Standalone Fullscreen Button */}
        {onToggleFullscreen && (
          <button
            type="button"
            onClick={onToggleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen (Esc / F11)' : 'Full Screen (F11)'}
            style={{
              width: 32,
              height: 32,
              boxSizing: 'border-box',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
              cursor: 'pointer',
              transition: 'all 150ms ease',
              background: isFullscreen ? 'rgba(56, 189, 248, 0.25)' : 'rgba(15, 23, 42, 0.88)',
              backdropFilter: 'blur(12px)',
              color: isFullscreen ? '#38bdf8' : '#e2e8f0',
              border: isFullscreen ? '1px solid rgba(56, 189, 248, 0.6)' : '1px solid rgba(255, 255, 255, 0.12)',
              boxShadow: isFullscreen
                ? '0 0 12px rgba(56, 189, 248, 0.35), 0 8px 32px rgba(0, 0, 0, 0.4)'
                : '0 8px 32px rgba(0, 0, 0, 0.4)',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              if (!isFullscreen) {
                e.currentTarget.style.background = 'rgba(30, 41, 59, 0.95)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.25)';
                e.currentTarget.style.color = '#ffffff';
              }
            }}
            onMouseLeave={(e) => {
              if (!isFullscreen) {
                e.currentTarget.style.background = 'rgba(15, 23, 42, 0.88)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)';
                e.currentTarget.style.color = '#e2e8f0';
              }
            }}
          >
            {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        )}
      </div>

      {/* Hover Info Tooltip HUD */}
      {hoveredNode && (
        <div style={{
          position: 'absolute',
          bottom: 20,
          left: 20,
          zIndex: 10,
          background: 'rgba(15, 23, 42, 0.95)',
          backdropFilter: 'blur(16px)',
          border: `1px solid ${TYPE_COLORS[hoveredNode.nodeType] || '#38bdf8'}80`,
          borderRadius: 10,
          padding: '12px 16px',
          color: '#f8fafc',
          boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
          pointerEvents: 'none',
          maxWidth: 320,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: `${TYPE_COLORS[hoveredNode.nodeType] || '#38bdf8'}20`,
              border: `1px solid ${TYPE_COLORS[hoveredNode.nodeType] || '#38bdf8'}40`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              {renderEntityIcon(hoveredNode.nodeType, 18, TYPE_COLORS[hoveredNode.nodeType] || '#38bdf8')}
            </div>
            <div>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff' }}>
                {getNodeLabel(hoveredNode)}
              </div>
              <span style={{
                fontSize: '0.65rem',
                fontWeight: 700,
                color: TYPE_COLORS[hoveredNode.nodeType] || '#38bdf8',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}>
                {hoveredNode.nodeType} · ID: {hoveredNode.id}
              </span>
            </div>
          </div>
          {hoveredNode.occupation && (
            <div style={{ fontSize: '0.74rem', color: '#cbd5e1', marginTop: 4 }}>
              Occupation: <strong>{hoveredNode.occupation}</strong>
            </div>
          )}
          {hoveredNode.risk_score !== undefined && (
            <div style={{ fontSize: '0.74rem', color: Number(hoveredNode.risk_score) >= 0.7 ? '#ef4444' : '#10b981', marginTop: 2, fontWeight: 600 }}>
              Risk Assessment: {(Number(hoveredNode.risk_score) * 100).toFixed(0)}%
            </div>
          )}
          <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: 6, fontStyle: 'italic' }}>
            Click node to lock camera & inspect full dossier
          </div>
        </div>
      )}

      {/* 3D Space Legend in Bottom Left */}
      <div style={{
        position: 'absolute',
        bottom: 16,
        left: 16,
        zIndex: 10,
        background: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: '0.7rem',
        color: '#94a3b8',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        pointerEvents: 'none',
      }}>
        <div style={{ fontWeight: 700, color: '#e2e8f0', marginBottom: 2 }}>3D Navigation Guide:</div>
        <div>• <strong>Left Click + Drag:</strong> 360° Space Orbit</div>
        <div>• <strong>Right Click + Drag:</strong> Pan / Translate</div>
        <div>• <strong>Scroll Wheel:</strong> Zoom In / Out</div>
        <div>• <strong>Click Sphere:</strong> Fly to Target Node</div>
      </div>

    </div>
  );
}

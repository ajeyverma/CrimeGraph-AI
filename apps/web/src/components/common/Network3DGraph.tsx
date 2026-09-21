import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ViewHelper } from 'three/examples/jsm/helpers/ViewHelper.js';
import {
  RotateCw, ZoomIn, ZoomOut, Maximize2, Minimize2, Play, Pause,
  Layers, Eye, EyeOff, RefreshCw, Sparkles, Filter, Check, ChevronDown,
  Search, X, Globe, RotateCcw, Sun, Moon,
  User, Phone as PhoneIcon, Car, Building2, MapPin, CreditCard, Briefcase, Package, Calendar, Circle,
  Network, Box, Info, LayoutGrid, Disc, Shuffle, Target
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
  showGlobeDiagonals?: boolean;
  investigationCase?: string;
  isLightTheme?: boolean;
  onThemeChange?: (isLight: boolean) => void;
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

const TYPE_THREE_COLORS: Record<string, THREE.Color> = {
  Person: new THREE.Color('#3b82f6'),
  Phone: new THREE.Color('#10b981'),
  Vehicle: new THREE.Color('#f97316'),
  Organization: new THREE.Color('#8b5cf6'),
  Location: new THREE.Color('#ef4444'),
  Account: new THREE.Color('#f59e0b'),
  Case: new THREE.Color('#06b6d4'),
  Evidence: new THREE.Color('#6366f1'),
  Event: new THREE.Color('#ec4899'),
};
const DEFAULT_PARTICLE_COLOR = new THREE.Color('#38bdf8');
export const DEFAULT_CAMERA_POS = new THREE.Vector3(0, 130, 850);
export const DEFAULT_TARGET_POS = new THREE.Vector3(0, 0, 0);


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

export type Layout3DType = 'spherical' | 'isolated' | 'concentric' | 'cylinder' | 'grid' | 'cone';

export interface Layout3DOption {
  id: Layout3DType;
  label: string;
  badge: string;
  description?: string;
  icon: React.ComponentType<{ size?: number; color?: string; style?: React.CSSProperties }>;
}

export const LAYOUT_3D_OPTIONS: Layout3DOption[] = [
  {
    id: 'spherical',
    label: 'Spherical Orbit',
    badge: 'Present',
    icon: Globe,
  },
  {
    id: 'isolated',
    label: 'Isolated Connection',
    badge: 'Isolated',
    icon: Target,
  },
  {
    id: 'concentric',
    label: 'Concentric Risk Spheres',
    badge: 'Risk Orbit',
    icon: Disc,
  },
  {
    id: 'cylinder',
    label: 'Helical Cyber Cylinder',
    badge: 'DNA Spiral',
    icon: Shuffle,
  },
  {
    id: 'grid',
    label: '3D Matrix Grid',
    badge: 'Cube Lattice',
    icon: LayoutGrid,
  },
  {
    id: 'cone',
    label: 'Hierarchical Pyramid',
    badge: 'Tree Cone',
    icon: Network,
  },
];

export function calculateLayoutPositions(
  layout: Layout3DType,
  nodes: Graph3DNode[],
  edges: Graph3DEdge[],
  selectedNodeId?: string | null
): Map<string, { x: number; y: number; z: number }> {
  const positions = new Map<string, { x: number; y: number; z: number }>();
  const count = nodes.length || 1;
  const radius = Math.max(130, Math.cbrt(count) * 65);

  switch (layout) {
    case 'spherical': {
      nodes.forEach((n, i) => {
        const phi = Math.acos(1 - 2 * (i + 0.5) / count);
        const theta = Math.PI * (1 + Math.sqrt(5)) * (i + 0.5);
        const r = radius * (0.65 + (i % 3) * 0.18);
        positions.set(n.id, {
          x: r * Math.sin(phi) * Math.cos(theta),
          y: r * Math.sin(phi) * Math.sin(theta),
          z: r * Math.cos(phi),
        });
      });
      break;
    }

    case 'isolated': {
      // Find the focal target: selectedNodeId if present, otherwise highest-risk or most connected node
      let targetId = selectedNodeId;
      if (!targetId || !nodes.some(n => n.id === targetId)) {
        const degreeMap = new Map<string, number>();
        edges.forEach(e => {
          degreeMap.set(e.source, (degreeMap.get(e.source) || 0) + 1);
          degreeMap.set(e.target, (degreeMap.get(e.target) || 0) + 1);
        });
        let maxDeg = -1;
        nodes.forEach(n => {
          const deg = degreeMap.get(n.id) || 0;
          if (deg > maxDeg) {
            maxDeg = deg;
            targetId = n.id;
          }
        });
        if (!targetId && nodes.length > 0) targetId = nodes[0].id;
      }

      // Directly connected neighbors of targetId
      const firstDegree = new Set<string>();
      edges.forEach(e => {
        if (e.source === targetId) firstDegree.add(e.target);
        if (e.target === targetId) firstDegree.add(e.source);
      });

      // Place target node at center (0, 0, 0)
      if (targetId) {
        positions.set(targetId, { x: 0, y: 0, z: 0 });
      }

      // First-degree connected neighbors arranged in an inner orbit ring
      const neighborList = nodes.filter(n => n.id !== targetId && firstDegree.has(n.id));
      const neighborRadius = Math.max(90, Math.min(160, 50 + neighborList.length * 10));
      neighborList.forEach((n, idx) => {
        const angle = (idx / (neighborList.length || 1)) * Math.PI * 2;
        const elevation = (idx % 3 - 1) * 22;
        positions.set(n.id, {
          x: neighborRadius * Math.cos(angle),
          y: elevation,
          z: neighborRadius * Math.sin(angle),
        });
      });

      // Remaining distant nodes arranged in an outer spherical perimeter
      const remainingNodes = nodes.filter(n => n.id !== targetId && !firstDegree.has(n.id));
      const outerRadius = Math.max(280, neighborRadius + 140);
      remainingNodes.forEach((n, idx) => {
        const phi = Math.acos(1 - 2 * (idx + 0.5) / (remainingNodes.length || 1));
        const theta = Math.PI * (1 + Math.sqrt(5)) * (idx + 0.5);
        positions.set(n.id, {
          x: outerRadius * Math.sin(phi) * Math.cos(theta),
          y: outerRadius * Math.sin(phi) * Math.sin(theta) * 0.75,
          z: outerRadius * Math.cos(phi),
        });
      });
      break;
    }

    case 'concentric': {
      nodes.forEach((n, i) => {
        const risk = Number(n.risk_score || 0);
        const isHigh = risk >= 0.7 || n.flagged;
        const isMed = risk >= 0.4 && risk < 0.7;

        const r = isHigh ? 100 : isMed ? 190 : 290;
        const phi = Math.acos(1 - 2 * (i + 0.5) / count);
        const theta = Math.PI * (1 + Math.sqrt(5)) * (i + 0.5);

        positions.set(n.id, {
          x: r * Math.sin(phi) * Math.cos(theta),
          y: r * Math.sin(phi) * Math.sin(theta) * 0.8,
          z: r * Math.cos(phi),
        });
      });
      break;
    }

    case 'cylinder': {
      const height = 360;
      const cylRadius = 140;
      nodes.forEach((n, i) => {
        const strand = i % 2 === 0 ? 0 : Math.PI;
        const progress = i / count;
        const angle = progress * Math.PI * 6 + strand;
        const y = (progress - 0.5) * height;
        positions.set(n.id, {
          x: cylRadius * Math.cos(angle),
          y,
          z: cylRadius * Math.sin(angle),
        });
      });
      break;
    }

    case 'grid': {
      const gridSize = Math.ceil(Math.cbrt(count));
      const spacing = 95;
      const offset = ((gridSize - 1) * spacing) / 2;

      nodes.forEach((n, i) => {
        const gx = i % gridSize;
        const gy = Math.floor(i / gridSize) % gridSize;
        const gz = Math.floor(i / (gridSize * gridSize));

        positions.set(n.id, {
          x: gx * spacing - offset,
          y: gy * spacing - offset,
          z: gz * spacing - offset,
        });
      });
      break;
    }

    case 'cone': {
      const levels: Record<string, number> = {
        Case: 0,
        Person: 1,
        Organization: 2,
        Vehicle: 3,
        Account: 3,
        Phone: 4,
        Location: 4,
        Evidence: 5,
        Event: 5,
      };

      const groups = new Map<number, Graph3DNode[]>();
      nodes.forEach(n => {
        const lvl = levels[n.nodeType] ?? 2;
        if (!groups.has(lvl)) groups.set(lvl, []);
        groups.get(lvl)!.push(n);
      });

      const maxLevel = 5;
      const totalHeight = 340;

      groups.forEach((groupNodes, lvl) => {
        const y = totalHeight / 2 - (lvl / maxLevel) * totalHeight;
        const ringR = 30 + (lvl / maxLevel) * 220;
        groupNodes.forEach((n, idx) => {
          const angle = (idx / groupNodes.length) * Math.PI * 2;
          positions.set(n.id, {
            x: ringR * Math.cos(angle),
            y,
            z: ringR * Math.sin(angle),
          });
        });
      });
      break;
    }
  }

  return positions;
}

const MAX_PARTICLES = 200;

/**
 * GLOBE DIAGONAL FEATURE CONFIGURATION:
 * • Set SHOW_GLOBE_DIAGONALS = false (default) for a clean orthogonal cyber globe (circular latitude parallels & longitude meridians with ZERO diagonal lines).
 * • Set SHOW_GLOBE_DIAGONALS = true to enable diagonal triangular wireframe lines dividing each globe grid cell.
 * • Can also be controlled dynamically via the `showGlobeDiagonals` prop on <Network3DGraph />.
 */
export const SHOW_GLOBE_DIAGONALS = true; //@codebtn:control_visibility_of_globe_diagonals

const createDotTexture = () => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.95)');
    gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.5)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(32, 32, 30, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  return texture;
};

export default function Network3DGraph({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  isFullscreen,
  onToggleFullscreen,
  onSwitchTo2D,
  showGlobeDiagonals = SHOW_GLOBE_DIAGONALS,
  investigationCase,
  isLightTheme: propIsLightTheme,
  onThemeChange,
}: Network3DGraphProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [hoveredNode, setHoveredNode] = useState<Graph3DNode | null>(null);
  const [simRunning, setSimRunning] = useState(false);
  const simRunningRef = useRef(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [showNavGuide, setShowNavGuide] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [activeLayout, setActiveLayout] = useState<Layout3DType>('spherical');
  const activeLayoutRef = useRef<Layout3DType>('spherical');
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const layoutMenuRef = useRef<HTMLDivElement>(null);
  const layoutAnimRef = useRef<number | null>(null);
  const [isolateSelection, setIsolateSelection] = useState(false);
  const isolateSelectionRef = useRef(false);

  useEffect(() => {
    isolateSelectionRef.current = isolateSelection;
  }, [isolateSelection]);

  // Close layout menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (layoutMenuRef.current && !layoutMenuRef.current.contains(e.target as Node)) {
        setLayoutMenuOpen(false);
      }
    };
    if (layoutMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [layoutMenuOpen]);

  // If layout is not spherical orbit, automatically disable and pause 3D physics
  useEffect(() => {
    activeLayoutRef.current = activeLayout;
    if (activeLayout !== 'spherical') {
      setSimRunning(false);
      simRunningRef.current = false;
    }
  }, [activeLayout]);

  useEffect(() => {
    simRunningRef.current = simRunning;
  }, [simRunning]);
  const [showGlobe, setShowGlobe] = useState(true);
  const [globeRotating, setGlobeRotating] = useState(true);
  const cyberGlobeRef = useRef<THREE.Group | null>(null);
  const showGlobeRef = useRef(true);
  const globeRotatingRef = useRef(true);

  const [internalLightTheme, setInternalLightTheme] = useState(false);
  const isLightTheme = propIsLightTheme !== undefined ? propIsLightTheme : internalLightTheme;
  const isLightThemeRef = useRef(isLightTheme);
  const gridRef = useRef<THREE.GridHelper | null>(null);

  const toggleTheme = useCallback(() => {
    const nextVal = !isLightTheme;
    setInternalLightTheme(nextVal);
    onThemeChange?.(nextVal);
  }, [isLightTheme, onThemeChange]);

  useEffect(() => {
    const isGlobeVisible = showGlobe && activeLayout === 'spherical';
    showGlobeRef.current = isGlobeVisible;
    if (cyberGlobeRef.current) {
      cyberGlobeRef.current.visible = isGlobeVisible;
    }
  }, [showGlobe, activeLayout]);

  useEffect(() => {
    globeRotatingRef.current = globeRotating;
  }, [globeRotating]);

  // Ref & effect for dynamic globe diagonal wireframe visibility
  const globeDiagonalMeshRef = useRef<THREE.Mesh | null>(null);
  useEffect(() => {
    if (globeDiagonalMeshRef.current) {
      globeDiagonalMeshRef.current.visible = showGlobeDiagonals;
    }
  }, [showGlobeDiagonals]);

  useEffect(() => {
    isLightThemeRef.current = isLightTheme;
    if (sceneRef.current) {
      const bgCol = isLightTheme ? '#f8fafc' : '#070c18';
      sceneRef.current.background = new THREE.Color(bgCol);
      sceneRef.current.fog = new THREE.FogExp2(bgCol, isLightTheme ? 0.0008 : 0.0012);

      if (gridRef.current) {
        sceneRef.current.remove(gridRef.current);
        gridRef.current.geometry.dispose();
        (gridRef.current.material as THREE.Material).dispose();
        const newGrid = new THREE.GridHelper(
          800,
          40,
          isLightTheme ? 0x94a3b8 : 0x1e293b,
          isLightTheme ? 0xe2e8f0 : 0x0f172a
        );
        newGrid.position.y = -180;
        gridRef.current = newGrid;
        sceneRef.current.add(newGrid);
      }

      if (globeDiagonalMeshRef.current) {
        const mat = globeDiagonalMeshRef.current.material as THREE.MeshBasicMaterial;
        if (mat) {
          mat.color.setHex(isLightTheme ? 0x0284c7 : 0x0ea5e9);
          mat.opacity = isLightTheme ? 0.03 : 0.045;
          mat.needsUpdate = true;
        }
      }

      // Update moving data flow particles for light/dark theme visibility
      if (particleMatRef.current) {
        particleMatRef.current.blending = isLightTheme ? THREE.NormalBlending : THREE.AdditiveBlending;
        particleMatRef.current.opacity = isLightTheme ? 0.95 : 0.85;
        particleMatRef.current.size = isLightTheme ? 7.0 : 5.5;
        particleMatRef.current.needsUpdate = true;
      }
    }
  }, [isLightTheme]);

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
  const cameraAnimFrameRef = useRef<number | null>(null);

  const nodeMeshes = useRef<Map<string, THREE.Mesh>>(new Map());
  const haloMeshes = useRef<Map<string, THREE.Mesh>>(new Map());
  const edgeLineSegments = useRef<THREE.LineSegments | null>(null);
  const highlightedEdgeSegments = useRef<THREE.LineSegments | null>(null);
  const selectedNodeIdRef = useRef<string | null | undefined>(selectedNodeId);
  const connectedEdgesRef = useRef<Graph3DEdge[]>([]);
  const particleSystem = useRef<THREE.Points | null>(null);
  const particleMatRef = useRef<THREE.PointsMaterial | null>(null);
  const particleGeoRef = useRef<THREE.BufferGeometry | null>(null);
  const labelSprites = useRef<Map<string, THREE.Sprite>>(new Map());

  // 3D physics position data
  const simNodes = useRef<Map<string, { x: number; y: number; z: number; vx: number; vy: number; vz: number }>>(new Map());

  // Helper to get display label
  const getNodeLabel = useCallback((n: Graph3DNode) => {
    return n.name || n.number || n.licensePlate || n.accountNumber || n.id || 'Unknown';
  }, []);

  // Smooth camera fly-to for target node
  const flyToNode = useCallback((targetNode: Graph3DNode) => {
    selectedNodeIdRef.current = targetNode.id;
    const tConnEdges = visibleEdgesRef.current.filter(e => {
      const s = typeof e.source === 'object' ? (e.source as any)?.id : String(e.source);
      const t = typeof e.target === 'object' ? (e.target as any)?.id : String(e.target);
      return s === targetNode.id || t === targetNode.id;
    });
    connectedEdgesRef.current = tConnEdges;
    if (tConnEdges.length === 0 && particleSystem.current) {
      particleSystem.current.visible = false;
      const posAttr = particleSystem.current.geometry.attributes.position as THREE.BufferAttribute;
      if (posAttr) {
        for (let i = 0; i < MAX_PARTICLES; i++) {
          posAttr.setXYZ(i, 99999, 99999, 99999);
        }
        posAttr.needsUpdate = true;
      }
    }

    onSelectNode(targetNode);

    const mesh = nodeMeshes.current.get(targetNode.id);
    const simPos = simNodes.current.get(targetNode.id);
    const camera = cameraRef.current;
    const controls = controlsRef.current;

    if (!camera || !controls) return;

    const pos = mesh ? mesh.position.clone() : (simPos ? new THREE.Vector3(simPos.x, simPos.y, simPos.z) : new THREE.Vector3(0, 0, 0));
    const targetPos = new THREE.Vector3(pos.x + 40, pos.y + 30, pos.z + 80);

    if (cameraAnimFrameRef.current) {
      cancelAnimationFrame(cameraAnimFrameRef.current);
      cameraAnimFrameRef.current = null;
    }

    let t = 0;
    const startPos = camera.position.clone();
    const flyAnim = () => {
      t += 0.04;
      const ease = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(t, 1));
      camera.position.lerpVectors(startPos, targetPos, ease);
      controls.target.lerp(pos, 0.08);
      controls.update();
      if (t < 1) {
        cameraAnimFrameRef.current = requestAnimationFrame(flyAnim);
      } else {
        cameraAnimFrameRef.current = null;
      }
    };
    cameraAnimFrameRef.current = requestAnimationFrame(flyAnim);
  }, [onSelectNode]);

  // Smooth camera reset to default view and center target (used for both double click and toolbar reset)
  const resetCameraToDefault = useCallback(() => {
    selectedNodeIdRef.current = null;
    connectedEdgesRef.current = [];
    onSelectNode(null);

    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    if (cameraAnimFrameRef.current) {
      cancelAnimationFrame(cameraAnimFrameRef.current);
      cameraAnimFrameRef.current = null;
    }

    let t = 0;
    const startCamPos = camera.position.clone();
    const startTarget = controls.target.clone();

    const centerAnim = () => {
      t += 0.04;
      const ease = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(t, 1));
      camera.position.lerpVectors(startCamPos, DEFAULT_CAMERA_POS, ease);
      controls.target.lerpVectors(startTarget, DEFAULT_TARGET_POS, ease);
      camera.up.set(0, 1, 0);
      controls.update();
      if (t < 1) {
        cameraAnimFrameRef.current = requestAnimationFrame(centerAnim);
      } else {
        cameraAnimFrameRef.current = null;
      }
    };
    cameraAnimFrameRef.current = requestAnimationFrame(centerAnim);
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

  const visibleNodesRef = useRef(visibleNodes);
  visibleNodesRef.current = visibleNodes;

  const visibleEdgesRef = useRef(visibleEdges);
  visibleEdgesRef.current = visibleEdges;

  // Smooth 3D Layout Transition
  const apply3DLayout = useCallback((layoutId: Layout3DType) => {
    setActiveLayout(layoutId);
    setLayoutMenuOpen(false);

    // If layout is not spherical orbit, immediately disable and pause 3D physics and hide cyber globe
    if (layoutId !== 'spherical') {
      setSimRunning(false);
      simRunningRef.current = false;
    }
    if (cyberGlobeRef.current) {
      cyberGlobeRef.current.visible = layoutId === 'spherical' && showGlobe;
    }

    const targetPositions = calculateLayoutPositions(layoutId, visibleNodes, visibleEdges, selectedNodeId);
    const sim = simNodes.current;

    if (layoutAnimRef.current) {
      cancelAnimationFrame(layoutAnimRef.current);
    }

    const startPositions = new Map<string, { x: number; y: number; z: number }>();
    visibleNodes.forEach(n => {
      const cur = sim.get(n.id) || { x: 0, y: 0, z: 0 };
      startPositions.set(n.id, { x: cur.x, y: cur.y, z: cur.z });
    });

    let step = 0;
    const totalSteps = 45;

    const transitionAnim = () => {
      step++;
      const progress = Math.min(step / totalSteps, 1);
      const ease = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      visibleNodes.forEach(n => {
        const start = startPositions.get(n.id);
        const target = targetPositions.get(n.id);
        const cur = sim.get(n.id);

        if (start && target && cur) {
          cur.x = start.x + (target.x - start.x) * ease;
          cur.y = start.y + (target.y - start.y) * ease;
          cur.z = start.z + (target.z - start.z) * ease;
          cur.vx = 0;
          cur.vy = 0;
          cur.vz = 0;

          const mesh = nodeMeshes.current.get(n.id);
          if (mesh) mesh.position.set(cur.x, cur.y, cur.z);

          const halo = haloMeshes.current.get(n.id);
          if (halo) halo.position.set(cur.x, cur.y, cur.z);

          const sprite = labelSprites.current.get(n.id);
          if (sprite) {
            const isSel = selectedNodeId === n.id;
            sprite.position.set(cur.x, cur.y + (isSel ? 18 : 14), cur.z);
          }
        }
      });

      if (edgeLineSegments.current) {
        const posAttr = edgeLineSegments.current.geometry.attributes.position as THREE.BufferAttribute;
        visibleEdgesRef.current.forEach((e, i) => {
          const nA = sim.get(e.source);
          const nB = sim.get(e.target);
          if (nA && nB && posAttr.count > i * 2 + 1) {
            posAttr.setXYZ(i * 2, nA.x, nA.y, nA.z);
            posAttr.setXYZ(i * 2 + 1, nB.x, nB.y, nB.z);
          }
        });
        posAttr.needsUpdate = true;
      }

      if (highlightedEdgeSegments.current) {
        const hPosAttr = highlightedEdgeSegments.current.geometry.attributes.position as THREE.BufferAttribute;
        connectedEdgesRef.current.forEach((e, i) => {
          const nA = sim.get(e.source);
          const nB = sim.get(e.target);
          if (nA && nB && hPosAttr.count > i * 2 + 1) {
            hPosAttr.setXYZ(i * 2, nA.x, nA.y, nA.z);
            hPosAttr.setXYZ(i * 2 + 1, nB.x, nB.y, nB.z);
          }
        });
        hPosAttr.needsUpdate = true;
      }

      if (step < totalSteps) {
        layoutAnimRef.current = requestAnimationFrame(transitionAnim);
      } else {
        layoutAnimRef.current = null;
      }
    };

    transitionAnim();
  }, [visibleNodes, visibleEdges, selectedNodeId, onSelectNode]);

  // Set of node IDs directly connected to selectedNodeId
  const connectedNeighbors = useMemo(() => {
    if (!selectedNodeId) return new Set<string>();
    const set = new Set<string>();
    visibleEdges.forEach(e => {
      if (e.source === selectedNodeId) set.add(e.target);
      if (e.target === selectedNodeId) set.add(e.source);
    });
    return set;
  }, [selectedNodeId, visibleEdges]);

  // Edges directly connected to selectedNodeId
  const connectedEdges = useMemo(() => {
    if (!selectedNodeId) return [];
    return visibleEdges.filter(e => e.source === selectedNodeId || e.target === selectedNodeId);
  }, [selectedNodeId, visibleEdges]);

  // Keep refs strictly synchronous on every render pass
  selectedNodeIdRef.current = selectedNodeId;
  connectedEdgesRef.current = connectedEdges;
  isolateSelectionRef.current = isolateSelection;

  if (selectedNodeId && connectedEdges.length === 0 && particleSystem.current) {
    particleSystem.current.visible = false;
    const posAttr = particleSystem.current.geometry.attributes.position as THREE.BufferAttribute;
    if (posAttr) {
      for (let i = 0; i < MAX_PARTICLES; i++) {
        posAttr.setXYZ(i, 99999, 99999, 99999);
      }
      posAttr.needsUpdate = true;
    }
  }

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
    if (activeLayout === 'isolated' && selectedNodeId) {
      apply3DLayout('isolated');
    }
  }, [selectedNodeId, activeLayout, apply3DLayout]);

  useEffect(() => {
    connectedEdgesRef.current = connectedEdges;
  }, [connectedEdges]);

  // Fast node lookup map
  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  const nodeMapRef = useRef(nodeMap);
  useEffect(() => {
    nodeMapRef.current = nodeMap;
  }, [nodeMap]);

  // Precomputed source & target colors for each edge for high-performance 60fps particle coloring
  const edgeColorsMap = useMemo(() => {
    const map = new Map<string, { c1: THREE.Color; c2: THREE.Color }>();
    visibleEdges.forEach(e => {
      const srcNode = nodeMap.get(e.source);
      const tgtNode = nodeMap.get(e.target);
      const c1 = (srcNode?.nodeType && TYPE_THREE_COLORS[srcNode.nodeType]) || DEFAULT_PARTICLE_COLOR;
      const c2 = (tgtNode?.nodeType && TYPE_THREE_COLORS[tgtNode.nodeType]) || c1;
      map.set(`${e.source}_${e.target}`, { c1, c2 });
    });
    return map;
  }, [visibleEdges, nodeMap]);

  const edgeColorsRef = useRef(edgeColorsMap);
  useEffect(() => {
    edgeColorsRef.current = edgeColorsMap;
  }, [edgeColorsMap]);

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
    const initialBg = isLightThemeRef.current ? '#f8fafc' : '#070c18';
    scene.background = new THREE.Color(initialBg);
    scene.fog = new THREE.FogExp2(initialBg, isLightThemeRef.current ? 0.0008 : 0.0012);

    // 2. Camera (Balanced zoomed-out default framing so cyber globe and all nodes fit comfortably in screen)
    const camera = new THREE.PerspectiveCamera(50, width / height, 1, 4000);
    camera.position.copy(DEFAULT_CAMERA_POS);
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
    controls.maxDistance = 2400;
    controls.minDistance = 30;
    controls.enableZoom = false; // Disable default center zoom; custom zoom-to-mouse-pointer is handled via wheel event
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
    const grid = new THREE.GridHelper(
      800,
      40,
      isLightThemeRef.current ? 0x94a3b8 : 0x1e293b,
      isLightThemeRef.current ? 0xe2e8f0 : 0x0f172a
    );
    grid.position.y = -180;
    scene.add(grid);
    gridRef.current = grid;

    // 6b. Central Holographic Cyber Globe (Clean Latitude & Longitude Circles + Optional Diagonals)
    const cyberGlobeGroup = new THREE.Group();
    cyberGlobeRef.current = cyberGlobeGroup;
    cyberGlobeGroup.visible = showGlobeRef.current;
    const globeRadius = Math.max(120, Math.cbrt(visibleNodes.length || 1) * 58);

    // Optional: Triangular wireframe mesh (adds diagonal lines inside each globe cell when enabled)
    const diagonalGeo = new THREE.SphereGeometry(globeRadius, 24, 16);
    const diagonalMat = new THREE.MeshBasicMaterial({
      color: isLightThemeRef.current ? 0x0284c7 : 0x0ea5e9,
      wireframe: true,
      transparent: true,
      opacity: isLightThemeRef.current ? 0.03 : 0.045,
    });
    const diagonalMesh = new THREE.Mesh(diagonalGeo, diagonalMat);
    diagonalMesh.visible = showGlobeDiagonals;
    globeDiagonalMeshRef.current = diagonalMesh;
    cyberGlobeGroup.add(diagonalMesh);

    // Shared circular geometry for longitude meridians (vertical great circles)
    const segments = 64;
    const meridianPoints: THREE.Vector3[] = [];
    for (let j = 0; j <= segments; j++) {
      const theta = (j / segments) * Math.PI * 2;
      meridianPoints.push(new THREE.Vector3(Math.cos(theta) * globeRadius, Math.sin(theta) * globeRadius, 0));
    }
    const meridianGeo = new THREE.BufferGeometry().setFromPoints(meridianPoints);

    // 12 Longitude Meridians (vertical circles rotated evenly around Y)
    const meridianCount = 12;
    for (let m = 0; m < meridianCount; m++) {
      const isPrime = m === 0 || m === meridianCount / 2;
      const mMat = new THREE.LineBasicMaterial({
        color: isPrime ? 0x6366f1 : 0x0284c7,
        transparent: true,
        opacity: isPrime ? (isLightThemeRef.current ? 0.10 : 0.14) : (isLightThemeRef.current ? 0.035 : 0.05),
      });
      const mLine = new THREE.LineLoop(meridianGeo, mMat);
      mLine.rotation.y = (m / meridianCount) * Math.PI;
      cyberGlobeGroup.add(mLine);
    }

    // Latitude Parallels (horizontal circles at different degrees)
    const latAngles = [-70, -50, -30, -15, 0, 15, 30, 50, 70];
    latAngles.forEach(deg => {
      const rad = (deg * Math.PI) / 180;
      const r = globeRadius * Math.cos(rad);
      const y = globeRadius * Math.sin(rad);

      const latPoints: THREE.Vector3[] = [];
      for (let j = 0; j <= segments; j++) {
        const theta = (j / segments) * Math.PI * 2;
        latPoints.push(new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r));
      }
      const latGeo = new THREE.BufferGeometry().setFromPoints(latPoints);
      const isEquator = deg === 0;
      const latMat = new THREE.LineBasicMaterial({
        color: isEquator ? 0x38bdf8 : 0x0284c7,
        transparent: true,
        opacity: isEquator ? (isLightThemeRef.current ? 0.14 : 0.18) : (isLightThemeRef.current ? 0.035 : 0.05),
      });
      const latLine = new THREE.LineLoop(latGeo, latMat);
      cyberGlobeGroup.add(latLine);
    });

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
      const currentDist = camera.position.distanceTo(controls.target) || DEFAULT_CAMERA_POS.length();
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
        selectedNodeIdRef.current = null;
        connectedEdgesRef.current = [];
        onSelectNode(null);
      }
    };

    // Zoom towards exact 3D area under the mouse pointer on wheel scroll
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();

      const delta = event.deltaY;
      if (Math.abs(delta) < 0.001) return;

      const rect = container.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;

      // Bottom-right Gizmo region check (dim=128, right=18, bottom=18)
      const gizmoCenterX = rect.width - 18 - 64;
      const gizmoCenterY = rect.height - 18 - 64;
      const distFromGizmo = Math.hypot(mouseX - gizmoCenterX, mouseY - gizmoCenterY);
      if (distFromGizmo <= 64) {
        return; // Absorb wheel inside gizmo bounds
      }

      const mouseNDC = new THREE.Vector2(
        (mouseX / rect.width) * 2 - 1,
        -(mouseY / rect.height) * 2 + 1
      );

      // Smooth zoom factor based on delta (supports both discrete mouse wheels and precision touchpads)
      const zoomFactor = Math.min(Math.max(Math.pow(0.998, -delta), 0.75), 1.35);

      const currentDist = camera.position.distanceTo(controls.target);
      const nextDist = currentDist * zoomFactor;

      let effectiveZoomFactor = zoomFactor;
      if (nextDist < controls.minDistance) {
        effectiveZoomFactor = controls.minDistance / (currentDist || 1);
      } else if (nextDist > controls.maxDistance) {
        effectiveZoomFactor = controls.maxDistance / (currentDist || 1);
      }

      if (Math.abs(effectiveZoomFactor - 1) < 0.0001) return;

      raycaster.setFromCamera(mouseNDC, camera);

      // Plane passing through controls.target facing camera
      const planeNormal = new THREE.Vector3();
      camera.getWorldDirection(planeNormal).negate();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, controls.target);
      const targetPoint = new THREE.Vector3();

      if (raycaster.ray.intersectPlane(plane, targetPoint)) {
        // Shift camera.position and controls.target so the exact point under the mouse pointer
        // remains anchored in place while the area zooms in/out smoothly!
        const lerpFactor = 1 - effectiveZoomFactor;
        camera.position.lerp(targetPoint, lerpFactor);
        controls.target.lerp(targetPoint, lerpFactor);
        controls.update();
      }
    };

    // Double-click on blank / empty space -> smoothly move graph and camera back to center
    const onDoubleClick = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const clickY = event.clientY - rect.top;

      // Ignore if double-click happened inside bottom-right gizmo
      const gizmoCenterX = rect.width - 18 - 64;
      const gizmoCenterY = rect.height - 18 - 64;
      const distFromGizmo = Math.hypot(clickX - gizmoCenterX, clickY - gizmoCenterY);
      if (distFromGizmo <= 64) return;

      const clickMouse = new THREE.Vector2(
        (clickX / rect.width) * 2 - 1,
        -(clickY / rect.height) * 2 + 1
      );

      raycaster.setFromCamera(clickMouse, camera);
      const meshes = Array.from(nodeMeshes.current.values());
      const intersects = raycaster.intersectObjects(meshes);

      // If user double-clicked directly on a node, let node interaction handle it
      if (intersects.length > 0) return;

      // Blank space double-clicked: reset camera and graph back to default view
      resetCameraToDefault();
    };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('click', onClick);
    container.addEventListener('dblclick', onDoubleClick);
    container.addEventListener('wheel', onWheel, { passive: false });

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
    const particleGeo = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(MAX_PARTICLES * 3);
    const particleColors = new Float32Array(MAX_PARTICLES * 3);

    const isLightInitial = isLightThemeRef.current;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      particlePositions[i * 3] = 99999;
      particlePositions[i * 3 + 1] = 99999;
      particlePositions[i * 3 + 2] = 99999;
      particleColors[i * 3] = isLightInitial ? 0.01 : 0.25;
      particleColors[i * 3 + 1] = isLightInitial ? 0.35 : 0.82;
      particleColors[i * 3 + 2] = isLightInitial ? 0.85 : 1.0;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    particleGeo.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));
    particleGeoRef.current = particleGeo;

    const dotTexture = createDotTexture();

    const particleMat = new THREE.PointsMaterial({
      size: isLightInitial ? 7.0 : 5.0,
      vertexColors: true,
      transparent: true,
      opacity: isLightInitial ? 0.95 : 0.85,
      blending: isLightInitial ? THREE.NormalBlending : THREE.AdditiveBlending,
      map: dotTexture,
      depthWrite: false,
    });
    particleMatRef.current = particleMat;

    const pPoints = new THREE.Points(particleGeo, particleMat);
    scene.add(pPoints);
    particleSystem.current = pPoints;

    // Track particle progress along random edges
    const particleEdges = Array.from({ length: MAX_PARTICLES }, () => ({
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

      // Force simulation step (Spring-Embedder vector forces - disabled for non-spherical layouts)
      if (simRunningRef.current && activeLayoutRef.current === 'spherical') {
        const sim = simNodes.current;
        const kCenter = 0.0018;
        const kRepel = 24000;
        const kSpring = 0.025;
        const damping = 0.88;

        // Repulsion between all pairs
        const nodeArr = visibleNodesRef.current;
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
        visibleEdgesRef.current.forEach(e => {
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

        visibleEdgesRef.current.forEach((e, i) => {
          const nA = sim.get(e.source);
          const nB = sim.get(e.target);
          if (nA && nB && posAttr.count > i * 2 + 1) {
            posAttr.setXYZ(i * 2, nA.x, nA.y, nA.z);
            posAttr.setXYZ(i * 2 + 1, nB.x, nB.y, nB.z);
          }
        });
        posAttr.needsUpdate = true;
      }

      // Update Highlighted Connected 3D Edge Lines
      if (highlightedEdgeSegments.current) {
        const hPosAttr = highlightedEdgeSegments.current.geometry.attributes.position as THREE.BufferAttribute;
        const sim = simNodes.current;

        connectedEdgesRef.current.forEach((e, i) => {
          const nA = sim.get(e.source);
          const nB = sim.get(e.target);
          if (nA && nB && hPosAttr.count > i * 2 + 1) {
            hPosAttr.setXYZ(i * 2, nA.x, nA.y, nA.z);
            hPosAttr.setXYZ(i * 2 + 1, nB.x, nB.y, nB.z);
          }
        });
        hPosAttr.needsUpdate = true;
      }

      // Update Traveling Data Particles (prioritize connected paths when a node is selected)
      const allEdges = visibleEdgesRef.current;
      const activeSelectedId = selectedNodeIdRef.current;

      // If an entity is selected:
      // - If it has connections, animate along those connections.
      // - If it has zero connections, curEdges is [] (suppressed on that single disconnected entity).
      // If no entity is selected:
      // - Keep movement dots flowing across all visible edges (do not hide when isolate mode is active).
      let curEdges: Graph3DEdge[] = [];
      if (activeSelectedId) {
        curEdges = connectedEdgesRef.current;
      } else {
        curEdges = allEdges;
      }

      if (particleSystem.current) {
        if (!curEdges || curEdges.length === 0) {
          particleSystem.current.visible = false;
          const posAttr = particleSystem.current.geometry.attributes.position as THREE.BufferAttribute;
          if (posAttr) {
            for (let i = 0; i < MAX_PARTICLES; i++) {
              posAttr.setXYZ(i, 99999, 99999, 99999);
            }
            posAttr.needsUpdate = true;
          }
        } else {
          particleSystem.current.visible = true;
          const sim = simNodes.current;
          const posAttr = particleSystem.current.geometry.attributes.position as THREE.BufferAttribute;
          const colAttr = particleSystem.current.geometry.attributes.color as THREE.BufferAttribute;
          const edgeColors = edgeColorsRef.current;

          particleEdges.forEach((p, i) => {
            const edge = curEdges[p.edgeIndex % curEdges.length];
            if (!edge) {
              posAttr.setXYZ(i, 99999, 99999, 99999);
              return;
            }

            const nA = sim.get(edge.source);
            const nB = sim.get(edge.target);
            if (nA && nB) {
              p.progress += p.speed;
              if (p.progress > 1) {
                p.progress = 0;
                p.edgeIndex = Math.floor(Math.random() * curEdges.length);
              }

              const t = p.progress;
              const px = nA.x + (nB.x - nA.x) * t;
              const py = nA.y + (nB.y - nA.y) * t;
              const pz = nA.z + (nB.z - nA.z) * t;

              posAttr.setXYZ(i, px, py, pz);

              // Dynamic multi-color based on connected entity types of this edge
              if (colAttr) {
                const edgeCol = edgeColors.get(`${edge.source}_${edge.target}`) ||
                                edgeColors.get(`${edge.target}_${edge.source}`);
                if (edgeCol) {
                  const pr = edgeCol.c1.r + (edgeCol.c2.r - edgeCol.c1.r) * t;
                  const pg = edgeCol.c1.g + (edgeCol.c2.g - edgeCol.c1.g) * t;
                  const pb = edgeCol.c1.b + (edgeCol.c2.b - edgeCol.c1.b) * t;
                  colAttr.setXYZ(i, pr, pg, pb);
                }
              }
            } else {
              posAttr.setXYZ(i, 99999, 99999, 99999);
            }
          });
          posAttr.needsUpdate = true;
          if (colAttr) colAttr.needsUpdate = true;
        }
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

      // Billboard and pulse selection/high-risk halos (facing camera directly so they never slice or clip into spheres)
      const time = performance.now() * 0.003;
      haloMeshes.current.forEach((halo, nodeId) => {
        halo.quaternion.copy(camera.quaternion);
        const isSel = nodeId === selectedNodeIdRef.current;
        if (isSel) {
          const scale = 1.45 + Math.sin(time) * 0.06;
          halo.scale.set(scale, scale, scale);
        } else {
          const scale = 1.15 + Math.sin(time) * 0.08;
          halo.scale.set(scale, scale, scale);
        }
      });

      if (showGlobeRef.current && globeRotatingRef.current) {
        cyberGlobeGroup.rotation.y += 0.0008;
      }

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
      container.removeEventListener('dblclick', onDoubleClick);
      container.removeEventListener('wheel', onWheel);
      hRingGeo.dispose();
      hRingMat.dispose();
      vRingGeo.dispose();
      vRingMat.dispose();
      if (gridRef.current) {
        gridRef.current.geometry.dispose();
        (gridRef.current.material as THREE.Material).dispose();
        gridRef.current = null;
      }
      cyberGlobeGroup.traverse(child => {
        if ((child as any).geometry) (child as any).geometry.dispose();
        if ((child as any).material) (child as any).material.dispose();
      });
      if (particleMatRef.current) {
        if (particleMatRef.current.map) particleMatRef.current.map.dispose();
        particleMatRef.current.dispose();
        particleMatRef.current = null;
      }
      if (particleGeoRef.current) {
        particleGeoRef.current.dispose();
        particleGeoRef.current = null;
      }
      viewHelper.dispose();
      renderer.dispose();
      globeDiagonalMeshRef.current = null;
      container.replaceChildren();
    };
  }, []);

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
      (edgeLineSegments.current.material as THREE.Material).dispose();
      edgeLineSegments.current = null;
    }

    if (highlightedEdgeSegments.current) {
      scene.remove(highlightedEdgeSegments.current);
      highlightedEdgeSegments.current.geometry.dispose();
      (highlightedEdgeSegments.current.material as THREE.Material).dispose();
      highlightedEdgeSegments.current = null;
    }

    // Hide particles immediately if no edges are visible or if selected entity has no connections
    if (particleSystem.current) {
      const hasActiveEdges = selectedNodeId
        ? connectedEdges.length > 0
        : visibleEdges.length > 0;

      particleSystem.current.visible = hasActiveEdges;
      if (!hasActiveEdges && particleGeoRef.current) {
        const posAttr = particleGeoRef.current.attributes.position as THREE.BufferAttribute;
        if (posAttr) {
          for (let i = 0; i < MAX_PARTICLES; i++) {
            posAttr.setXYZ(i, 99999, 99999, 99999);
          }
          posAttr.needsUpdate = true;
        }
      }
    }

    // Shared Geometries
    const sphereGeo = new THREE.SphereGeometry(6, 24, 24);
    const haloGeo = new THREE.RingGeometry(8, 10, 32);

    // Create 3D Node Meshes
    visibleNodes.forEach(node => {
      const colorHex = TYPE_COLORS[node.nodeType] || '#64748b';
      const isSelected = selectedNodeId === node.id;
      const isConnectedNeighbor = Boolean(selectedNodeId && connectedNeighbors.has(node.id));
      const isDimmed = Boolean(selectedNodeId && !isSelected && !isConnectedNeighbor);
      const isHighRisk = Number(node.risk_score || 0) >= 0.7 || node.flagged;

      // When isolate mode is enabled and an entity is selected, completely hide all other unconnected entities
      if (isolateSelection && isDimmed) {
        return;
      }

      let nodeOpacity = 1.0;
      let emissiveIntensity = 0.25;
      let emissiveColor = new THREE.Color(colorHex);
      let scale = 1.0;

      if (isSelected) {
        scale = 1.65;
        emissiveColor = new THREE.Color(isLightTheme ? '#2563eb' : '#38bdf8');
        emissiveIntensity = 0.85;
        nodeOpacity = 1.0;
      } else if (isConnectedNeighbor) {
        scale = 1.25;
        emissiveColor = new THREE.Color(isLightTheme ? '#d97706' : '#fbbf24');
        emissiveIntensity = 0.6;
        nodeOpacity = 1.0;
      } else if (isDimmed) {
        scale = 0.7;
        emissiveColor = new THREE.Color(0x000000);
        emissiveIntensity = 0.0;
        nodeOpacity = isLightTheme ? 0.16 : 0.12;
      } else {
        scale = isHighRisk ? 1.25 : 1.0;
        emissiveIntensity = 0.25;
        nodeOpacity = 1.0;
      }

      const nodeMat = new THREE.MeshPhongMaterial({
        color: new THREE.Color(colorHex),
        emissive: emissiveColor,
        emissiveIntensity,
        shininess: isDimmed ? 5 : 90,
        transparent: isDimmed,
        opacity: nodeOpacity,
      });

      const mesh = new THREE.Mesh(sphereGeo, nodeMat);
      mesh.userData = { id: node.id, node };
      mesh.scale.set(scale, scale, scale);

      const simPos = simNodes.current.get(node.id) || { x: 0, y: 0, z: 0 };
      mesh.position.set(simPos.x, simPos.y, simPos.z);

      scene.add(mesh);
      nodeMeshes.current.set(node.id, mesh);

      // Add Glowing Halo Ring around High-Risk or Selected/Connected nodes
      // Dimmed nodes NEVER show halos so visual focus stays strictly on selected & connections
      if (!isDimmed) {
        if (isSelected) {
          const haloMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(isLightTheme ? '#2563eb' : '#38bdf8'),
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
          });
          const halo = new THREE.Mesh(haloGeo, haloMat);
          halo.scale.set(1.45, 1.45, 1.45);
          halo.position.copy(mesh.position);
          scene.add(halo);
          haloMeshes.current.set(node.id, halo);
        } else if (isConnectedNeighbor) {
          const haloMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(isLightTheme ? '#d97706' : '#fbbf24'),
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.75,
            depthWrite: false,
          });
          const halo = new THREE.Mesh(haloGeo, haloMat);
          halo.scale.set(1.15, 1.15, 1.15);
          halo.position.copy(mesh.position);
          scene.add(halo);
          haloMeshes.current.set(node.id, halo);
        } else if (isHighRisk) {
          const haloMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color('#ef4444'),
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.65,
            depthWrite: false,
          });
          const halo = new THREE.Mesh(haloGeo, haloMat);
          halo.position.copy(mesh.position);
          scene.add(halo);
          haloMeshes.current.set(node.id, halo);
        }
      }

      // Create Floating 3D Text Billboard Label
      // Skip labels on dimmed nodes so the space is crystal clear
      if (showLabels && !isDimmed) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.font = isSelected ? 'bold 26px "Inter", sans-serif' : 'bold 24px "Inter", sans-serif';
          ctx.fillStyle = isSelected
            ? (isLightTheme ? '#0284c7' : '#38bdf8')
            : isConnectedNeighbor
            ? (isLightTheme ? '#b45309' : '#fde047')
            : (isLightTheme ? '#0f172a' : '#f8fafc');
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.shadowColor = isLightTheme ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.9)';
          ctx.shadowBlur = 6;

          const labelText = getNodeLabel(node);
          ctx.fillText(labelText, 128, 32);

          const texture = new THREE.CanvasTexture(canvas);
          texture.minFilter = THREE.LinearFilter;
          const spriteMat = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            opacity: isSelected ? 1.0 : isConnectedNeighbor ? 0.95 : 0.85,
          });
          const sprite = new THREE.Sprite(spriteMat);
          const spriteYOffset = isSelected ? 18 : 14;
          sprite.scale.set(isSelected ? 42 : 38, isSelected ? 10.5 : 9.5, 1);
          sprite.position.set(simPos.x, simPos.y + spriteYOffset, simPos.z);

          scene.add(sprite);
          labelSprites.current.set(node.id, sprite);
        }
      }
    });

    // Create 3D Edge Line Segments (Base Layer - Dimmed when node is selected, or hidden if isolate mode is active)
    if (visibleEdges.length > 0 && (!isolateSelection || !selectedNodeId)) {
      const linePositions = new Float32Array(visibleEdges.length * 6);
      const lineColors = new Float32Array(visibleEdges.length * 6);
      const isDimmedState = Boolean(selectedNodeId);

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

        lineColors[i * 6 + 3] = isLightTheme ? 0.6 : 0.4;
        lineColors[i * 6 + 4] = isLightTheme ? 0.65 : 0.5;
        lineColors[i * 6 + 5] = isLightTheme ? 0.75 : 0.7;
      });

      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
      lineGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));

      const lineMat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: isDimmedState ? (isLightTheme ? 0.08 : 0.05) : 0.45,
        linewidth: 1,
      });

      const lines = new THREE.LineSegments(lineGeo, lineMat);
      scene.add(lines);
      edgeLineSegments.current = lines;
    }

    // Create Highlighted Connected 3D Edge Segments (Top Layer - Bright and Vibrant)
    if (selectedNodeId && connectedEdges.length > 0) {
      const hPositions = new Float32Array(connectedEdges.length * 6);
      const hColors = new Float32Array(connectedEdges.length * 6);

      connectedEdges.forEach((e, i) => {
        const nA = simNodes.current.get(e.source) || { x: 0, y: 0, z: 0 };
        const nB = simNodes.current.get(e.target) || { x: 0, y: 0, z: 0 };

        hPositions[i * 6] = nA.x;
        hPositions[i * 6 + 1] = nA.y;
        hPositions[i * 6 + 2] = nA.z;

        hPositions[i * 6 + 3] = nB.x;
        hPositions[i * 6 + 4] = nB.y;
        hPositions[i * 6 + 5] = nB.z;

        const hlColor = new THREE.Color(isLightTheme ? 0x2563eb : 0x38bdf8);
        hColors[i * 6] = hlColor.r;
        hColors[i * 6 + 1] = hlColor.g;
        hColors[i * 6 + 2] = hlColor.b;

        hColors[i * 6 + 3] = isLightTheme ? 0.15 : 0.9;
        hColors[i * 6 + 4] = isLightTheme ? 0.45 : 0.95;
        hColors[i * 6 + 5] = isLightTheme ? 0.95 : 1.0;
      });

      const hGeo = new THREE.BufferGeometry();
      hGeo.setAttribute('position', new THREE.BufferAttribute(hPositions, 3));
      hGeo.setAttribute('color', new THREE.BufferAttribute(hColors, 3));

      const hMat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        linewidth: 2,
      });

      const hLines = new THREE.LineSegments(hGeo, hMat);
      scene.add(hLines);
      highlightedEdgeSegments.current = hLines;
    }
  }, [visibleNodes, visibleEdges, selectedNodeId, connectedNeighbors, connectedEdges, showLabels, getNodeLabel, isLightTheme, sceneReady, activeLayout, isolateSelection]);

  // Update controls auto-rotate state
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = autoRotate;
    }
  }, [autoRotate]);

  // Camera reset (Smooth animation back to center default view framing)
  const handleResetCamera = () => {
    resetCameraToDefault();
  };

  const handleZoom = (factor: number) => {
    if (cameraRef.current) {
      cameraRef.current.position.multiplyScalar(factor);
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: isLightTheme ? '#f8fafc' : '#070c18' }}>
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
        background: isLightTheme ? 'rgba(255, 255, 255, 0.92)' : 'rgba(15, 23, 42, 0.88)',
        backdropFilter: 'blur(12px)',
        padding: '6px',
        borderRadius: 10,
        border: isLightTheme ? '1px solid rgba(203, 213, 225, 0.8)' : '1px solid rgba(255, 255, 255, 0.12)',
        boxShadow: isLightTheme ? '0 8px 32px rgba(15, 23, 42, 0.08)' : '0 8px 32px rgba(0, 0, 0, 0.4)',
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
            background: autoRotate ? 'rgba(56, 189, 248, 0.25)' : isLightTheme ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.05)',
            color: autoRotate ? '#0284c7' : isLightTheme ? '#64748b' : '#94a3b8',
            border: autoRotate ? '1px solid rgba(56, 189, 248, 0.6)' : isLightTheme ? '1px solid rgba(203, 213, 225, 0.6)' : '1px solid rgba(255, 255, 255, 0.08)',
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
            background: showLabels ? 'rgba(56, 189, 248, 0.25)' : isLightTheme ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.05)',
            color: showLabels ? '#0284c7' : isLightTheme ? '#64748b' : '#94a3b8',
            border: showLabels ? '1px solid rgba(56, 189, 248, 0.6)' : isLightTheme ? '1px solid rgba(203, 213, 225, 0.6)' : '1px solid rgba(255, 255, 255, 0.08)',
            boxShadow: showLabels ? '0 0 10px rgba(56, 189, 248, 0.35)' : 'none',
          }}
          title={showLabels ? 'Hide Floating Labels' : 'Show Floating Labels'}
        >
          {showLabels ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>

        {/* Isolate Mode Quick Toggle */}
        <button
          onClick={() => setIsolateSelection(prev => !prev)}
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
            background: isolateSelection ? 'rgba(56, 189, 248, 0.25)' : isLightTheme ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.05)',
            color: isolateSelection ? '#0284c7' : isLightTheme ? '#64748b' : '#94a3b8',
            border: isolateSelection ? '1px solid rgba(56, 189, 248, 0.6)' : isLightTheme ? '1px solid rgba(203, 213, 225, 0.6)' : '1px solid rgba(255, 255, 255, 0.08)',
            boxShadow: isolateSelection ? '0 0 10px rgba(56, 189, 248, 0.35)' : 'none',
          }}
          title={isolateSelection ? 'Isolate Mode Active: Unconnected entities are hidden on selection. Click to dim instead.' : 'Isolate Mode Inactive: Unconnected entities are dimmed on selection. Click to hide them.'}
        >
          <Target size={14} />
        </button>

        {/* Physics toggle (only available in spherical orbit layout) */}
        {activeLayout === 'spherical' && (
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
              background: simRunning ? 'rgba(56, 189, 248, 0.25)' : isLightTheme ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.05)',
              color: simRunning ? '#0284c7' : isLightTheme ? '#64748b' : '#94a3b8',
              border: simRunning ? '1px solid rgba(56, 189, 248, 0.6)' : isLightTheme ? '1px solid rgba(203, 213, 225, 0.6)' : '1px solid rgba(255, 255, 255, 0.08)',
              boxShadow: simRunning ? '0 0 10px rgba(56, 189, 248, 0.35)' : 'none',
            }}
            title={simRunning ? 'Pause 3D Physics (Static)' : 'Resume 3D Physics'}
          >
            <Sparkles size={14} />
          </button>
        )}

        {/* Globe Controls (only visible when in spherical orbit layout) */}
        {activeLayout === 'spherical' && (
          <>
            {/* Globe Enable / Disable */}
            <button
              onClick={() => setShowGlobe(!showGlobe)}
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
                background: showGlobe ? 'rgba(56, 189, 248, 0.25)' : isLightTheme ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.05)',
                color: showGlobe ? '#0284c7' : isLightTheme ? '#64748b' : '#94a3b8',
                border: showGlobe ? '1px solid rgba(56, 189, 248, 0.6)' : isLightTheme ? '1px solid rgba(203, 213, 225, 0.6)' : '1px solid rgba(255, 255, 255, 0.08)',
                boxShadow: showGlobe ? '0 0 10px rgba(56, 189, 248, 0.35)' : 'none',
              }}
              title={showGlobe ? 'Disable Cyber Globe' : 'Enable Cyber Globe'}
            >
              <Globe size={14} />
            </button>

            {/* Globe Auto-Rotation Toggle (available when globe is enabled) */}
            {showGlobe && (
              <button
                onClick={() => setGlobeRotating(!globeRotating)}
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
                  background: globeRotating ? 'rgba(56, 189, 248, 0.25)' : isLightTheme ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.05)',
                  color: globeRotating ? '#0284c7' : isLightTheme ? '#64748b' : '#94a3b8',
                  border: globeRotating ? '1px solid rgba(56, 189, 248, 0.6)' : isLightTheme ? '1px solid rgba(203, 213, 225, 0.6)' : '1px solid rgba(255, 255, 255, 0.08)',
                  boxShadow: globeRotating ? '0 0 10px rgba(56, 189, 248, 0.35)' : 'none',
                }}
                title={globeRotating ? 'Pause Globe Auto-Rotation' : 'Start Globe Auto-Rotation'}
              >
                <RotateCcw size={14} style={{ transform: globeRotating ? 'rotate(-45deg)' : 'none', transition: 'transform 200ms ease' }} />
              </button>
            )}
          </>
        )}

        {/* Light / Dark Theme Toggle */}
        <button
          onClick={toggleTheme}
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
            background: isLightTheme ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.05)',
            color: isLightTheme ? '#d97706' : '#f59e0b',
            border: isLightTheme ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
            boxShadow: isLightTheme ? '0 0 10px rgba(245, 158, 11, 0.25)' : 'none',
          }}
          title={isLightTheme ? 'Switch to Dark Theme' : 'Switch to Light Theme'}
        >
          {isLightTheme ? <Moon size={14} /> : <Sun size={14} />}
        </button>

        {/* Horizontal Divider */}
        <div style={{ width: 20, height: 1, background: isLightTheme ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.15)', margin: '2px 0' }} />

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
            background: 'transparent',
            color: isLightTheme ? '#64748b' : '#94a3b8',
            border: 'none',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = isLightTheme ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.08)';
            e.currentTarget.style.color = '#0284c7';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = isLightTheme ? '#64748b' : '#94a3b8';
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
            background: 'transparent',
            color: isLightTheme ? '#64748b' : '#94a3b8',
            border: 'none',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = isLightTheme ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.08)';
            e.currentTarget.style.color = '#0284c7';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = isLightTheme ? '#64748b' : '#94a3b8';
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
            background: 'transparent',
            color: isLightTheme ? '#64748b' : '#94a3b8',
            border: 'none',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = isLightTheme ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.08)';
            e.currentTarget.style.color = '#0284c7';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = isLightTheme ? '#64748b' : '#94a3b8';
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
              background: isLightTheme ? 'rgba(255, 255, 255, 0.92)' : 'rgba(15, 23, 42, 0.88)',
              backdropFilter: 'blur(12px)',
              border: `1px solid ${filterMenuOpen ? (isLightTheme ? '#0284c7' : 'rgba(56, 189, 248, 0.5)') : isLightTheme ? 'rgba(203, 213, 225, 0.8)' : 'rgba(255, 255, 255, 0.12)'}`,
              borderRadius: 8,
              color: isLightTheme ? '#0f172a' : '#e2e8f0',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: isLightTheme ? '0 8px 32px rgba(15, 23, 42, 0.08)' : '0 8px 32px rgba(0, 0, 0, 0.4)',
              transition: 'all 150ms ease',
            }}
            title="Filter Entities by Type"
          >
            <Filter size={13} style={{ color: isLightTheme ? '#0284c7' : '#38bdf8' }} />
            <span>Filters</span>
            <span style={{
              fontSize: '0.66rem',
              padding: '1px 6px',
              borderRadius: 10,
              background: isAllSelected
                ? isLightTheme ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.1)'
                : isNoneSelected
                  ? 'rgba(239, 68, 68, 0.2)'
                  : 'rgba(56, 189, 248, 0.25)',
              color: isAllSelected
                ? isLightTheme ? '#475569' : '#cbd5e1'
                : isNoneSelected
                  ? '#ef4444'
                  : isLightTheme ? '#0284c7' : '#38bdf8',
              fontWeight: 700,
            }}>
              {isAllSelected ? 'ALL' : isNoneSelected ? 'NONE' : `${selectedTypes.size} active`}
            </span>
            <ChevronDown
              size={12}
              style={{
                color: isLightTheme ? '#64748b' : '#94a3b8',
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
              background: isLightTheme ? 'rgba(255, 255, 255, 0.98)' : 'rgba(15, 23, 42, 0.96)',
              backdropFilter: 'blur(16px)',
              border: isLightTheme ? '1px solid rgba(203, 213, 225, 0.9)' : '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: 10,
              boxShadow: isLightTheme ? '0 16px 40px rgba(15, 23, 42, 0.16)' : '0 16px 40px rgba(0, 0, 0, 0.65)',
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
                borderBottom: isLightTheme ? '1px solid rgba(0, 0, 0, 0.08)' : '1px solid rgba(255, 255, 255, 0.08)',
                fontSize: '0.68rem',
                color: isLightTheme ? '#64748b' : '#94a3b8',
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
                      color: isLightTheme ? '#0284c7' : '#38bdf8',
                      cursor: 'pointer',
                      fontSize: '0.68rem',
                      fontWeight: 600,
                      padding: 0,
                    }}
                  >
                    All
                  </button>
                  <span style={{ color: isLightTheme ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.2)' }}>|</span>
                  <button
                    type="button"
                    onClick={handleClearAll}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: isLightTheme ? '#64748b' : '#94a3b8',
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
                        background: isChecked ? (isLightTheme ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.06)') : 'transparent',
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
                          border: `1.5px solid ${isChecked ? col : isLightTheme ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.3)'}`,
                          background: isChecked ? col : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 120ms ease',
                          flexShrink: 0,
                        }}>
                          {isChecked && <Check size={11} color={isLightTheme ? '#ffffff' : '#0f172a'} strokeWidth={3.5} />}
                        </div>

                        {/* Icon and label */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, flexShrink: 0 }}>
                          {renderEntityIcon(t, 13, col)}
                        </div>
                        <span style={{
                          fontSize: '0.76rem',
                          fontWeight: isChecked ? 600 : 500,
                          color: isChecked ? (isLightTheme ? '#0f172a' : '#f8fafc') : (isLightTheme ? '#64748b' : '#94a3b8'),
                        }}>
                          {t}
                        </span>
                      </div>

                      {/* Count badge */}
                      <span style={{
                        fontSize: '0.68rem',
                        color: isLightTheme ? '#94a3b8' : 'rgba(148, 163, 184, 0.7)',
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

        {/* 3D Layout Topology Dropdown */}
        <div ref={layoutMenuRef} style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setLayoutMenuOpen(!layoutMenuOpen)}
            style={{
              height: 30,
              padding: '0 10px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: isLightTheme ? 'rgba(255, 255, 255, 0.92)' : 'rgba(15, 23, 42, 0.88)',
              backdropFilter: 'blur(12px)',
              border: `1px solid ${layoutMenuOpen ? (isLightTheme ? '#0284c7' : 'rgba(56, 189, 248, 0.5)') : isLightTheme ? 'rgba(203, 213, 225, 0.8)' : 'rgba(255, 255, 255, 0.12)'}`,
              borderRadius: 8,
              color: isLightTheme ? '#0f172a' : '#e2e8f0',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: isLightTheme ? '0 8px 32px rgba(15, 23, 42, 0.08)' : '0 8px 32px rgba(0, 0, 0, 0.4)',
              transition: 'all 150ms ease',
            }}
            title="Change 3D Layout Topology"
          >
            <LayoutGrid size={13} style={{ color: isLightTheme ? '#0284c7' : '#38bdf8' }} />
            <span>Layout</span>
            <span style={{
              fontSize: '0.66rem',
              padding: '1px 6px',
              borderRadius: 10,
              background: isLightTheme ? 'rgba(2, 132, 199, 0.12)' : 'rgba(56, 189, 248, 0.22)',
              color: isLightTheme ? '#0284c7' : '#38bdf8',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.02em',
            }}>
              {LAYOUT_3D_OPTIONS.find(l => l.id === activeLayout)?.badge || 'Present'}
            </span>
            <ChevronDown
              size={12}
              style={{
                color: isLightTheme ? '#64748b' : '#94a3b8',
                transform: layoutMenuOpen ? 'rotate(180deg)' : 'none',
                transition: 'transform 150ms ease',
              }}
            />
          </button>

          {layoutMenuOpen && (
            <div style={{
              position: 'absolute',
              top: 36,
              left: 0,
              width: 255,
              background: isLightTheme ? 'rgba(255, 255, 255, 0.98)' : 'rgba(15, 23, 42, 0.96)',
              backdropFilter: 'blur(16px)',
              border: isLightTheme ? '1px solid rgba(203, 213, 225, 0.9)' : '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: 10,
              boxShadow: isLightTheme ? '0 16px 40px rgba(15, 23, 42, 0.2)' : '0 16px 40px rgba(0, 0, 0, 0.75)',
              padding: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              zIndex: 100,
            }}>
              {/* Header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '2px 6px 6px 6px',
                borderBottom: isLightTheme ? '1px solid rgba(0, 0, 0, 0.08)' : '1px solid rgba(255, 255, 255, 0.08)',
                fontSize: '0.68rem',
                color: isLightTheme ? '#64748b' : '#94a3b8',
                fontWeight: 600,
                letterSpacing: '0.04em',
              }}>
                <span>3D GRAPH TOPOLOGY</span>
                <span style={{
                  fontSize: '0.64rem',
                  color: isLightTheme ? '#0284c7' : '#38bdf8',
                  fontWeight: 600,
                }}>
                  {LAYOUT_3D_OPTIONS.length} Presets
                </span>
              </div>

              {/* Layout Options List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
                {LAYOUT_3D_OPTIONS.map((opt) => {
                  const isActive = activeLayout === opt.id;
                  const IconComp = opt.icon;

                  return (
                    <div
                      key={opt.id}
                      onClick={() => apply3DLayout(opt.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '7px 9px',
                        borderRadius: 7,
                        background: isActive
                          ? isLightTheme ? 'rgba(2, 132, 199, 0.1)' : 'rgba(56, 189, 248, 0.14)'
                          : 'transparent',
                        border: isActive
                          ? isLightTheme ? '1px solid rgba(2, 132, 199, 0.35)' : '1px solid rgba(56, 189, 248, 0.4)'
                          : '1px solid transparent',
                        cursor: 'pointer',
                        transition: 'all 120ms ease',
                        userSelect: 'none',
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.background = isLightTheme ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.05)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.background = 'transparent';
                        }
                      }}
                    >
                      <div style={{
                        width: 26,
                        height: 26,
                        borderRadius: 6,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: isActive
                          ? isLightTheme ? '#0284c7' : '#38bdf8'
                          : isLightTheme ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.08)',
                        color: isActive
                          ? '#ffffff'
                          : isLightTheme ? '#0f172a' : '#cbd5e1',
                        flexShrink: 0,
                      }}>
                        <IconComp size={14} />
                      </div>

                      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                        <span style={{
                          fontSize: '0.78rem',
                          fontWeight: isActive ? 700 : 600,
                          color: isActive
                            ? isLightTheme ? '#0284c7' : '#38bdf8'
                            : isLightTheme ? '#0f172a' : '#f1f5f9',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}>
                          {opt.label}
                        </span>
                        <span style={{
                          fontSize: '0.62rem',
                          fontWeight: 700,
                          padding: '1px 5px',
                          borderRadius: 4,
                          background: isActive
                            ? isLightTheme ? 'rgba(2, 132, 199, 0.15)' : 'rgba(56, 189, 248, 0.25)'
                            : isLightTheme ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.08)',
                          color: isActive
                            ? isLightTheme ? '#0284c7' : '#38bdf8'
                            : isLightTheme ? '#64748b' : '#94a3b8',
                          letterSpacing: '0.02em',
                          whiteSpace: 'nowrap',
                        }}>
                          {opt.badge}
                        </span>
                      </div>
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
            background: isLightTheme ? 'rgba(255, 255, 255, 0.92)' : 'rgba(15, 23, 42, 0.88)',
            backdropFilter: 'blur(12px)',
            border: `1px solid ${searchOpen && searchQuery ? (isLightTheme ? '#0284c7' : 'rgba(56, 189, 248, 0.5)') : isLightTheme ? 'rgba(203, 213, 225, 0.8)' : 'rgba(255, 255, 255, 0.12)'}`,
            borderRadius: 8,
            boxShadow: isLightTheme ? '0 8px 32px rgba(15, 23, 42, 0.08)' : '0 8px 32px rgba(0, 0, 0, 0.4)',
            transition: 'all 150ms ease',
            width: 220,
          }}>
            <Search size={13} style={{ color: isLightTheme ? '#0284c7' : '#38bdf8', flexShrink: 0 }} />
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
                color: isLightTheme ? '#0f172a' : '#f8fafc',
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
                  color: isLightTheme ? '#64748b' : '#94a3b8',
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
              background: isLightTheme ? 'rgba(255, 255, 255, 0.98)' : 'rgba(15, 23, 42, 0.96)',
              backdropFilter: 'blur(16px)',
              border: isLightTheme ? '1px solid rgba(203, 213, 225, 0.9)' : '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: 10,
              boxShadow: isLightTheme ? '0 16px 40px rgba(15, 23, 42, 0.16)' : '0 16px 40px rgba(0, 0, 0, 0.65)',
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
                color: isLightTheme ? '#64748b' : '#94a3b8',
                padding: '4px 6px',
                borderBottom: isLightTheme ? '1px solid rgba(0, 0, 0, 0.08)' : '1px solid rgba(255, 255, 255, 0.08)',
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
                  color: isLightTheme ? '#94a3b8' : '#64748b',
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
                      onMouseEnter={(e) => (e.currentTarget.style.background = isLightTheme ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.08)')}
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
                            color: isLightTheme ? '#0f172a' : '#f8fafc',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}>
                            {label}
                          </span>
                          <span style={{ fontSize: '0.64rem', color: isLightTheme ? '#64748b' : '#94a3b8' }}>
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
            background: isLightTheme ? 'rgba(255, 255, 255, 0.92)' : 'rgba(15, 23, 42, 0.88)',
            backdropFilter: 'blur(12px)',
            padding: '2px',
            borderRadius: 8,
            border: isLightTheme ? '1px solid rgba(203, 213, 225, 0.8)' : '1px solid rgba(255, 255, 255, 0.12)',
            boxShadow: isLightTheme ? '0 8px 32px rgba(15, 23, 42, 0.08)' : '0 8px 32px rgba(0, 0, 0, 0.4)',
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
                color: isLightTheme ? '#64748b' : '#94a3b8',
                border: 'none',
                fontSize: '0.74rem',
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = isLightTheme ? '#0f172a' : '#f8fafc';
                e.currentTarget.style.background = isLightTheme ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.08)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = isLightTheme ? '#64748b' : '#94a3b8';
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <Network size={13} style={{ color: isLightTheme ? '#64748b' : '#94a3b8' }} />
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
                color: isLightTheme ? '#0284c7' : '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.45)',
                boxShadow: '0 0 10px rgba(56, 189, 248, 0.25)',
                fontSize: '0.74rem',
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              <Box size={13} style={{ color: isLightTheme ? '#0284c7' : '#38bdf8' }} />
              <span>3D</span>
            </button>
          </div>
        )}

        {/* Standalone About / 3D Navigation Guide Button */}
        <div
          style={{ position: 'relative' }}
          onMouseEnter={() => setShowNavGuide(true)}
          onMouseLeave={() => setShowNavGuide(false)}
        >
          <button
            type="button"
            title="About 3D Navigation Guide"
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
              background: showNavGuide
                ? isLightTheme ? 'rgba(241, 245, 249, 0.98)' : 'rgba(56, 189, 248, 0.25)'
                : isLightTheme ? 'rgba(255, 255, 255, 0.92)' : 'rgba(15, 23, 42, 0.88)',
              backdropFilter: 'blur(12px)',
              color: showNavGuide
                ? (isLightTheme ? '#0284c7' : '#38bdf8')
                : isLightTheme ? '#334155' : '#cbd5e1',
              border: showNavGuide
                ? '1px solid rgba(56, 189, 248, 0.6)'
                : isLightTheme ? '1px solid rgba(203, 213, 225, 0.8)' : '1px solid rgba(255, 255, 255, 0.12)',
              boxShadow: showNavGuide
                ? '0 0 12px rgba(56, 189, 248, 0.35)'
                : isLightTheme ? '0 8px 32px rgba(15, 23, 42, 0.08)' : '0 8px 32px rgba(0, 0, 0, 0.4)',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              if (!showNavGuide) {
                e.currentTarget.style.background = isLightTheme ? 'rgba(241, 245, 249, 0.95)' : 'rgba(30, 41, 59, 0.95)';
                e.currentTarget.style.borderColor = isLightTheme ? 'rgba(148, 163, 184, 0.5)' : 'rgba(255, 255, 255, 0.25)';
                e.currentTarget.style.color = isLightTheme ? '#0284c7' : '#38bdf8';
              }
            }}
            onMouseLeave={(e) => {
              if (!showNavGuide) {
                e.currentTarget.style.background = isLightTheme ? 'rgba(255, 255, 255, 0.92)' : 'rgba(15, 23, 42, 0.88)';
                e.currentTarget.style.borderColor = isLightTheme ? '1px solid rgba(203, 213, 225, 0.8)' : '1px solid rgba(255, 255, 255, 0.12)';
                e.currentTarget.style.color = isLightTheme ? '#334155' : '#cbd5e1';
              }
            }}
          >
            <Info size={15} />
          </button>

          {/* 3D Navigation Guide Popover on Hover (Top-Right) */}
          {showNavGuide && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                width: 255,
                background: isLightTheme ? 'rgba(255, 255, 255, 0.98)' : 'rgba(15, 23, 42, 0.96)',
                backdropFilter: 'blur(16px)',
                border: isLightTheme ? '1px solid rgba(203, 213, 225, 0.9)' : '1px solid rgba(56, 189, 248, 0.4)',
                borderRadius: 10,
                padding: '12px 14px',
                boxShadow: isLightTheme
                  ? '0 12px 32px rgba(15, 23, 42, 0.15)'
                  : '0 12px 32px rgba(0, 0, 0, 0.7), 0 0 15px rgba(56, 189, 248, 0.15)',
                fontSize: '0.72rem',
                color: isLightTheme ? '#334155' : '#cbd5e1',
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
                pointerEvents: 'none',
                lineHeight: 1.45,
                zIndex: 100,
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  color: isLightTheme ? '#0f172a' : '#f8fafc',
                  fontSize: '0.78rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  paddingBottom: 6,
                  borderBottom: isLightTheme ? '1px solid rgba(0, 0, 0, 0.08)' : '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <Info size={14} color={isLightTheme ? '#0284c7' : '#38bdf8'} />
                <span>3D Navigation Guide</span>
              </div>
              <div>• <strong>Left Click + Drag:</strong> 360° Space Orbit</div>
              <div>• <strong>Right Click + Drag:</strong> Pan / Translate View</div>
              <div>• <strong>Scroll Wheel:</strong> Zoom Towards Mouse Pointer</div>
              <div>• <strong>Click Any Node:</strong> Focus Camera & Dossier</div>
              <div>• <strong>Double Click Blank Space:</strong> Reset View to Default</div>
              <div>• <strong>Bottom-Right Gizmo:</strong> Snap X, Y, Z, or Isometric</div>
            </div>
          )}
        </div>

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
              background: isFullscreen ? 'rgba(56, 189, 248, 0.25)' : isLightTheme ? 'rgba(255, 255, 255, 0.92)' : 'rgba(15, 23, 42, 0.88)',
              backdropFilter: 'blur(12px)',
              color: isFullscreen ? (isLightTheme ? '#0284c7' : '#38bdf8') : isLightTheme ? '#334155' : '#e2e8f0',
              border: isFullscreen ? '1px solid rgba(56, 189, 248, 0.6)' : isLightTheme ? '1px solid rgba(203, 213, 225, 0.8)' : '1px solid rgba(255, 255, 255, 0.12)',
              boxShadow: isFullscreen
                ? '0 0 12px rgba(56, 189, 248, 0.35), 0 8px 32px rgba(0, 0, 0, 0.4)'
                : isLightTheme ? '0 8px 32px rgba(15, 23, 42, 0.08)' : '0 8px 32px rgba(0, 0, 0, 0.4)',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              if (!isFullscreen) {
                e.currentTarget.style.background = isLightTheme ? 'rgba(241, 245, 249, 0.95)' : 'rgba(30, 41, 59, 0.95)';
                e.currentTarget.style.borderColor = isLightTheme ? 'rgba(148, 163, 184, 0.5)' : 'rgba(255, 255, 255, 0.25)';
                e.currentTarget.style.color = isLightTheme ? '#0f172a' : '#ffffff';
              }
            }}
            onMouseLeave={(e) => {
              if (!isFullscreen) {
                e.currentTarget.style.background = isLightTheme ? 'rgba(255, 255, 255, 0.92)' : 'rgba(15, 23, 42, 0.88)';
                e.currentTarget.style.borderColor = isLightTheme ? '1px solid rgba(203, 213, 225, 0.8)' : '1px solid rgba(255, 255, 255, 0.12)';
                e.currentTarget.style.color = isLightTheme ? '#334155' : '#e2e8f0';
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
          bottom: 50,
          left: 12,
          zIndex: 10,
          background: isLightTheme ? 'rgba(255, 255, 255, 0.97)' : 'rgba(15, 23, 42, 0.95)',
          backdropFilter: 'blur(16px)',
          border: `1px solid ${TYPE_COLORS[hoveredNode.nodeType] || '#38bdf8'}80`,
          borderRadius: 10,
          padding: '12px 16px',
          color: isLightTheme ? '#0f172a' : '#f8fafc',
          boxShadow: isLightTheme ? '0 12px 32px rgba(15, 23, 42, 0.14)' : '0 12px 32px rgba(0,0,0,0.6)',
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
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: isLightTheme ? '#0f172a' : '#fff' }}>
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
            <div style={{ fontSize: '0.74rem', color: isLightTheme ? '#475569' : '#cbd5e1', marginTop: 4 }}>
              Occupation: <strong>{hoveredNode.occupation}</strong>
            </div>
          )}
          {hoveredNode.risk_score !== undefined && (
            <div style={{ fontSize: '0.74rem', color: Number(hoveredNode.risk_score) >= 0.7 ? '#ef4444' : '#10b981', marginTop: 2, fontWeight: 600 }}>
              Risk Assessment: {(Number(hoveredNode.risk_score) * 100).toFixed(0)}%
            </div>
          )}
          <div style={{ fontSize: '0.68rem', color: isLightTheme ? '#64748b' : '#94a3b8', marginTop: 6, fontStyle: 'italic' }}>
            Click node to lock camera & inspect full dossier
          </div>
        </div>
      )}

      {/* Bottom Stats Overlay (Nodes & Edges Count) */}
      <div style={{
        position: 'absolute',
        bottom: 12,
        left: 12,
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        zIndex: 10,
        pointerEvents: 'none',
      }}>
        <div style={{
          padding: '5px 12px',
          background: isLightTheme ? 'rgba(255, 255, 255, 0.94)' : 'rgba(15, 23, 42, 0.88)',
          backdropFilter: 'blur(10px)',
          border: isLightTheme ? '1px solid var(--border-primary, #cbd5e1)' : '1px solid rgba(56, 189, 248, 0.3)',
          borderRadius: 8,
          fontSize: '0.74rem',
          color: isLightTheme ? '#334155' : '#e2e8f0',
          boxShadow: isLightTheme ? '0 4px 12px rgba(0, 0, 0, 0.05)' : '0 4px 16px rgba(0, 0, 0, 0.4)',
        }}>
          {selectedNodeId && isolateSelection ? (
            <>
              <strong style={{ color: isLightTheme ? 'var(--accent-primary, #2563eb)' : '#38bdf8' }}>{1 + connectedNeighbors.size}</strong> visible ({connectedNeighbors.size} connected) · <strong style={{ color: isLightTheme ? 'var(--accent-primary, #2563eb)' : '#38bdf8' }}>{connectedEdges.length}</strong> edges
            </>
          ) : (
            <>
              <strong style={{ color: isLightTheme ? 'var(--accent-primary, #2563eb)' : '#38bdf8' }}>{visibleNodes.length}</strong> nodes · <strong style={{ color: isLightTheme ? 'var(--accent-primary, #2563eb)' : '#38bdf8' }}>{visibleEdges.length}</strong> edges
            </>
          )}
        </div>
        {investigationCase && (
          <div style={{
            padding: '5px 12px',
            background: isLightTheme ? 'rgba(37, 99, 235, 0.08)' : 'rgba(56, 189, 248, 0.12)',
            backdropFilter: 'blur(10px)',
            border: isLightTheme ? '1px solid rgba(37, 99, 235, 0.25)' : '1px solid rgba(56, 189, 248, 0.35)',
            borderRadius: 8,
            fontSize: '0.74rem',
            color: isLightTheme ? 'var(--accent-primary, #2563eb)' : '#38bdf8',
            boxShadow: isLightTheme ? '0 4px 12px rgba(0, 0, 0, 0.05)' : '0 4px 16px rgba(0, 0, 0, 0.4)',
          }}>
            Case: <strong>{investigationCase}</strong>
          </div>
        )}
        {/* Red About Icon Button with Hover Disclaimer */}
        <div style={{ position: 'relative', display: 'inline-flex', pointerEvents: 'auto' }}>
          <button
            type="button"
            aria-label="Analytical disclaimer"
            title="Analytical relationships — not proof of wrongdoing"
            onMouseEnter={() => setShowDisclaimer(true)}
            onMouseLeave={() => setShowDisclaimer(false)}
            onClick={() => setShowDisclaimer(prev => !prev)}
            style={{
              width: 28,
              height: 28,
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
              cursor: 'pointer',
              background: isLightTheme ? 'rgba(239, 68, 68, 0.12)' : 'rgba(239, 68, 68, 0.22)',
              border: isLightTheme ? '1px solid rgba(239, 68, 68, 0.45)' : '1px solid rgba(239, 68, 68, 0.55)',
              color: '#ef4444',
              backdropFilter: 'blur(10px)',
              boxShadow: isLightTheme ? '0 2px 8px rgba(239, 68, 68, 0.15)' : '0 2px 10px rgba(239, 68, 68, 0.3)',
              transition: 'all 150ms ease',
            }}
            onFocus={() => setShowDisclaimer(true)}
            onBlur={() => setShowDisclaimer(false)}
          >
            <Info size={15} strokeWidth={2.4} />
          </button>

          {/* Hover Disclaimer Popover */}
          {showDisclaimer && (
            <div
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 8px)',
                left: 0,
                whiteSpace: 'nowrap',
                background: isLightTheme ? 'rgba(255, 255, 255, 0.98)' : 'rgba(15, 23, 42, 0.96)',
                backdropFilter: 'blur(16px)',
                border: '1px solid rgba(239, 68, 68, 0.45)',
                borderRadius: 8,
                padding: '6px 12px',
                fontSize: '0.74rem',
                fontWeight: 500,
                color: isLightTheme ? '#991b1b' : '#fca5a5',
                boxShadow: isLightTheme
                  ? '0 8px 24px rgba(239, 68, 68, 0.15)'
                  : '0 8px 24px rgba(0, 0, 0, 0.6), 0 0 12px rgba(239, 68, 68, 0.25)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                pointerEvents: 'none',
                zIndex: 100,
                lineHeight: 1.4,
              }}
            >
              <Info size={13} color="#ef4444" strokeWidth={2.4} />
              <span>Analytical relationships — not proof of wrongdoing</span>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

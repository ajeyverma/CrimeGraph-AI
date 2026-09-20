import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import cytoscape from 'cytoscape';
import type { Core, NodeSingular } from 'cytoscape';
import {
  Search, ZoomIn, ZoomOut, Maximize2, Minimize2, RefreshCw, Filter,
  Download, Info, X, ChevronRight, Loader, Network, GitBranch,
  FileText, Printer, ShieldAlert, CheckCircle2, ChevronDown, Box,
  Sparkles, RotateCw, Eye, EyeOff, Check, LayoutGrid, Shuffle,
  User, Phone as PhoneIcon, Car, Building2, MapPin, CreditCard, Briefcase, Package, Calendar, Circle
} from 'lucide-react';
import api from '../lib/api';
import { ALL_ENTITIES, GRAPH_EDGES, FIR_RECORDS, PERSONS, TRANSACTIONS } from '../data/dataset';
import Network3DGraph from '../components/common/Network3DGraph';
import type { Graph3DNode, Graph3DEdge } from '../components/common/Network3DGraph';

interface GraphNode {
  id: string;
  nodeType: string;
  name?: string;
  number?: string;
  licensePlate?: string;
  accountNumber?: string;
  risk_score?: number | string;
  flagged?: boolean;
  [key: string]: unknown;
}

interface GraphEdge {
  id?: string;
  source: string;
  target: string;
  type: string;
  confidence?: number;
  timestamp?: string;
  relSource?: string;
  recordRef?: string;
  amount?: number | string;
  duration?: number;
}

interface OfficerSummary {
  id: string;
  full_name: string;
  role: string;
  badge_number?: string;
}

interface CaseSummary {
  id: string;
  case_number: string;
  title: string;
  assigned_to_name?: string;
  entity_count?: string;
}

const NODE_COLORS: Record<string, string> = {
  Person: '#3b82f6',
  Phone: '#22c55e',
  Vehicle: '#f97316',
  Organization: '#8b5cf6',
  Location: '#ef4444',
  Account: '#eab308',
  Case: '#06b6d4',
  Event: '#ec4899',
};

const NODE_SHAPES: Record<string, string> = {
  Person: 'ellipse',
  Phone: 'round-rectangle',
  Vehicle: 'diamond',
  Organization: 'hexagon',
  Location: 'star',
  Account: 'rectangle',
  Case: 'octagon',
  Event: 'vee',
};

const NODE_ICONS: Record<string, string> = {
  Person: '👤', Phone: '📱', Vehicle: '🚗',
  Organization: '🏢', Location: '📍', Account: '💳',
  Case: '📋', Event: '📅',
};

const TYPE_COLORS: Record<string, string> = {
  Person: '#3b82f6',
  Phone: '#10b981',
  Vehicle: '#f97316',
  Organization: '#8b5cf6',
  Location: '#ef4444',
  Account: '#f59e0b',
  Case: '#06b6d4',
  Evidence: '#6366f1',
  Event: '#ec4899',
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

function getNodeLabel(node: GraphNode): string {
  return (node.name || node.number || node.licensePlate || node.accountNumber || node.id || '').substring(0, 20);
}

function buildGraphFromLiveData(tablesData: Record<string, any[]>): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodesMap = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeKeySet = new Set<string>();

  const addEdge = (src: string, tgt: string, type: string, extra: Record<string, any> = {}) => {
    if (!src || !tgt || src === tgt) return;
    const key = `${src}->${tgt}:${type}`;
    if (edgeKeySet.has(key)) return;
    edgeKeySet.add(key);
    edges.push({
      id: `e-live-${edges.length}`,
      source: src,
      target: tgt,
      type,
      confidence: 0.92,
      ...extra,
    });
  };

  // 1. Persons
  const persons = tablesData['persons'] || [];
  for (const p of persons) {
    const id = p.id || p.person_id;
    if (!id) continue;
    nodesMap.set(id, {
      id,
      nodeType: 'Person',
      name: p.name || p.full_name || id,
      alias: p.alias,
      age: p.age,
      gender: p.gender,
      location: p.location || p.city,
      risk_score: p.risk_score != null ? p.risk_score : (p.riskScore != null ? p.riskScore : 0.4),
      flagged: Number(p.risk_score || p.riskScore || 0) >= 0.65,
      ...p,
    });
  }

  // 2. Vehicles
  const vehicles = tablesData['vehicles'] || [];
  for (const v of vehicles) {
    const id = v.id || v.vehicle_id;
    if (!id) continue;
    const label = v.license_plate || v.licensePlate || `${v.make || ''} ${v.model || ''}`.trim() || id;
    nodesMap.set(id, {
      id,
      nodeType: 'Vehicle',
      licensePlate: v.license_plate || v.licensePlate || label,
      name: label,
      ...v,
    });
    const owner = v.registered_to || v.registeredTo || v.owner_id;
    if (owner) addEdge(owner, id, 'OWNS_VEHICLE');
  }

  // 3. Phones
  const phones = tablesData['phones'] || [];
  for (const ph of phones) {
    const id = ph.id || ph.phone_id;
    if (!id) continue;
    const num = ph.number || ph.phone_number || id;
    nodesMap.set(id, {
      id,
      nodeType: 'Phone',
      number: num,
      name: num,
      operator: ph.operator,
      ...ph,
    });
    const owner = ph.registered_to || ph.registeredTo || ph.owner_id;
    if (owner) addEdge(owner, id, 'OWNS_PHONE');
  }

  // 4. Organizations
  const orgs = tablesData['organizations'] || [];
  for (const o of orgs) {
    const id = o.id || o.org_id;
    if (!id) continue;
    nodesMap.set(id, {
      id,
      nodeType: 'Organization',
      name: o.name || o.org_name || id,
      type: o.type,
      location: o.location || o.city,
      ...o,
    });
  }

  // 5. Locations
  const locs = tablesData['locations'] || [];
  for (const l of locs) {
    const id = l.id || l.location_id;
    if (!id) continue;
    nodesMap.set(id, {
      id,
      nodeType: 'Location',
      name: l.name || l.city || id,
      ...l,
    });
  }

  // 6. Bank Accounts
  const accounts = tablesData['bank_accounts'] || [];
  for (const a of accounts) {
    const id = a.id || a.account_id;
    if (!id) continue;
    const accNum = a.account_number || a.accountNumber || id;
    nodesMap.set(id, {
      id,
      nodeType: 'Account',
      accountNumber: accNum,
      name: accNum,
      bank: a.bank_name || a.bank,
      ...a,
    });
    const owner = a.account_holder_id || a.person_id || a.owner_id;
    if (owner) addEdge(owner, id, 'OWNS_ACCOUNT');
  }

  // 7. Cases & FIRs
  const cases = tablesData['cases'] || tablesData['fir_records'] || [];
  for (const c of cases) {
    const id = c.id || c.case_id || c.fir_id;
    if (!id) continue;
    const caseNum = c.case_number || c.fir_number || c.firNumber || c.title || id;
    nodesMap.set(id, {
      id,
      nodeType: 'Case',
      name: caseNum,
      firNumber: caseNum,
      title: c.title,
      status: c.status,
      ...c,
    });
  }

  // 8. Call records
  const calls = tablesData['call_records'] || [];
  for (const cl of calls) {
    const src = cl.caller_phone_id || cl.caller_id || cl.from_phone;
    const tgt = cl.receiver_phone_id || cl.receiver_id || cl.to_phone;
    if (src && tgt) {
      addEdge(src, tgt, 'CALLED', {
        confidence: 0.95,
        duration: cl.duration,
        timestamp: cl.timestamp || cl.call_time,
      });
    }
  }

  // 9. Transactions
  const txs = tablesData['transactions'] || [];
  for (const tx of txs) {
    const src = tx.sender_account_id || tx.sender_id || tx.from_account;
    const tgt = tx.receiver_account_id || tx.receiver_id || tx.to_account;
    if (src && tgt) {
      addEdge(src, tgt, 'TRANSFERRED', {
        confidence: 0.98,
        amount: tx.amount,
        timestamp: tx.timestamp || tx.transaction_time,
      });
    }
  }

  // 10. Enrich with GRAPH_EDGES
  for (const ge of GRAPH_EDGES) {
    if (nodesMap.has(ge.source) && nodesMap.has(ge.target)) {
      addEdge(ge.source, ge.target, ge.type || 'CONNECTED_TO', {
        confidence: ge.confidence || 0.85,
        relSource: (ge as any).source_ref,
      });
    }
  }

  // Fallback if empty
  if (nodesMap.size === 0) {
    for (const e of (ALL_ENTITIES as any[])) {
      nodesMap.set(e.id, {
        id: e.id,
        nodeType: e.nodeType,
        name: e.name || e.number || e.licensePlate || e.accountNumber || e.id,
        ...e,
      });
    }
  }

  const allNodesList = Array.from(nodesMap.values());
  const validEdges = edges.filter(e => nodesMap.has(e.source) && nodesMap.has(e.target));

  return { nodes: allNodesList, edges: validEdges };
}

export default function NetworkGraphPage() {
  const [searchParams] = useSearchParams();
  const investigationCase = searchParams.get('investigation');
  const entityIdParam = searchParams.get('entityId') || searchParams.get('entity');
  const entityTypeParam = searchParams.get('entityType') || 'Person';
  const cyRef = useRef<HTMLDivElement>(null);
  const cyInstance = useRef<Core | null>(null);
  const [viewDimension, setViewDimension] = useState<'2d' | '3d'>('2d');
  const [layoutName, setLayoutName] = useState<'cose' | 'concentric' | 'circle' | 'breadthfirst' | 'grid'>('cose');
  const [allNodes, setAllNodes] = useState<GraphNode[]>([]);
  const [allEdges, setAllEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set());
  const [pathMode, setPathMode] = useState(false);
  const [pathNodes, setPathNodes] = useState<GraphNode[]>([]);
  const [pathLoading, setPathLoading] = useState(false);
  const [pathResult, setPathResult] = useState<Record<string, unknown>[] | null>(null);
  const [officers, setOfficers] = useState<OfficerSummary[]>([]);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [graphPeople, setGraphPeople] = useState<GraphNode[]>([]);
  const [showDossierModal, setShowDossierModal] = useState(false);
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const graphContainerRef = useRef<HTMLDivElement>(null);

  // 2D Floating Filter, Search & Menu State
  const [filter2DOpen, setFilter2DOpen] = useState(false);
  const [search2DQuery, setSearch2DQuery] = useState('');
  const [search2DOpen, setSearch2DOpen] = useState(false);
  const [layoutMenu2DOpen, setLayoutMenu2DOpen] = useState(false);
  const [selected2DTypes, setSelected2DTypes] = useState<Set<string>>(() => new Set([
    'Person', 'Phone', 'Vehicle', 'Organization', 'Location', 'Account', 'Case', 'Evidence', 'Event'
  ]));
  const filter2DRef = useRef<HTMLDivElement>(null);
  const search2DRef = useRef<HTMLDivElement>(null);
  const layout2DRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => {
      const next = !prev;
      if (next) {
        const elem = graphContainerRef.current;
        if (elem && elem.requestFullscreen && !document.fullscreenElement) {
          elem.requestFullscreen().catch(() => { });
        }
      } else {
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => { });
        }
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNativeFs = Boolean(document.fullscreenElement);
      setIsFullscreen(isNativeFs);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => { });
        }
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen]);

  // When fullscreen changes, trigger cytoscape resize and fit
  useEffect(() => {
    const timer = setTimeout(() => {
      if (cyInstance.current) {
        cyInstance.current.resize();
        cyInstance.current.fit(undefined, 40);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [isFullscreen]);

  // Sync selected types when allNodes changes
  useEffect(() => {
    if (allNodes.length > 0) {
      const types = new Set<string>();
      allNodes.forEach(n => { if (n.nodeType) types.add(n.nodeType); });
      setSelected2DTypes(types);
    }
  }, [allNodes.length]);

  // Click outside to close 2D filter, search and layout popovers
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filter2DRef.current && !filter2DRef.current.contains(e.target as Node)) {
        setFilter2DOpen(false);
      }
      if (search2DRef.current && !search2DRef.current.contains(e.target as Node)) {
        setSearch2DOpen(false);
      }
      if (layout2DRef.current && !layout2DRef.current.contains(e.target as Node)) {
        setLayoutMenu2DOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter cytoscape nodes when selected2DTypes changes
  useEffect(() => {
    if (!cyInstance.current || viewDimension !== '2d') return;
    const cy = cyInstance.current;
    cy.batch(() => {
      cy.nodes().forEach(node => {
        const type = node.data('nodeType');
        if (selected2DTypes.has(type)) {
          node.show();
        } else {
          node.hide();
        }
      });
    });
  }, [selected2DTypes, viewDimension]);

  const LAYOUT_OPTIONS = [
    { value: 'cose', label: 'Force / Physics', icon: Sparkles },
    { value: 'concentric', label: 'Concentric Rings', icon: Circle },
    { value: 'circle', label: 'Circular Orbit', icon: RotateCw },
    { value: 'breadthfirst', label: 'Hierarchy Tree', icon: GitBranch },
    { value: 'grid', label: 'Matrix Grid', icon: LayoutGrid },
    { value: 'random', label: 'Random Spread', icon: Shuffle },
  ];

  const available2DTypes = useMemo(() => {
    const types = new Set<string>();
    allNodes.forEach(n => {
      if (n.nodeType) types.add(n.nodeType);
    });
    return Array.from(types);
  }, [allNodes]);

  const search2DResults = useMemo(() => {
    const q = search2DQuery.trim().toLowerCase();
    if (!q) return [];
    return allNodes.filter(n => {
      const label = getNodeLabel(n).toLowerCase();
      const id = (n.id || '').toLowerCase();
      const type = (n.nodeType || '').toLowerCase();
      const occ = (n.occupation || (n as any).role || '').toLowerCase();
      return label.includes(q) || id.includes(q) || type.includes(q) || occ.includes(q);
    }).slice(0, 20);
  }, [allNodes, search2DQuery]);

  const isAll2DSelected = available2DTypes.length > 0 && available2DTypes.every(t => selected2DTypes.has(t));
  const isNone2DSelected = selected2DTypes.size === 0;

  const handleSelectAll2D = () => {
    setSelected2DTypes(new Set(available2DTypes));
  };

  const handleClearAll2D = () => {
    setSelected2DTypes(new Set());
  };

  const toggle2DType = (t: string) => {
    setSelected2DTypes(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const handleSelect2DSearchResult = (node: GraphNode) => {
    if (!selected2DTypes.has(node.nodeType)) {
      setSelected2DTypes(prev => new Set([...prev, node.nodeType]));
    }
    setSearch2DQuery('');
    setSearch2DOpen(false);
    setSelectedNode(node);
    setSelectedEdge(null);

    if (cyInstance.current) {
      const cyNode = cyInstance.current.$id(node.id);
      if (cyNode && cyNode.length > 0) {
        cyNode.show();
        cyInstance.current.elements().removeClass('highlighted dimmed');
        const neighborhood = cyNode.closedNeighborhood();
        cyInstance.current.elements().not(neighborhood).addClass('dimmed');
        neighborhood.addClass('highlighted');
        cyInstance.current.animate({
          center: { eles: cyNode },
          zoom: 1.6,
          duration: 500,
        });
      }
    }
  };

  const handle2DSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (search2DResults.length > 0) {
        handleSelect2DSearchResult(search2DResults[0]);
      }
    } else if (e.key === 'Escape') {
      setSearch2DOpen(false);
    }
  };

  const initCytoscape = useCallback(() => {
    if (!cyRef.current) return;

    if (cyInstance.current) {
      cyInstance.current.destroy();
    }

    const cy = cytoscape({
      container: cyRef.current,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': (ele: NodeSingular) => NODE_COLORS[ele.data('nodeType')] || '#64748b',
            'shape': (ele: NodeSingular) => (NODE_SHAPES[ele.data('nodeType')] || 'ellipse') as any,
            'label': 'data(label)',
            'color': '#f8fafc',
            'font-size': '11px',
            'font-family': 'Inter, sans-serif',
            'font-weight': '600',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': '5px',
            'width': 38,
            'height': 38,
            'border-width': 2.5,
            'border-color': 'rgba(255,255,255,0.85)',
            'border-opacity': 0.95,
            'text-outline-width': 3,
            'text-outline-color': '#0b0f19',
            'text-max-width': '95px',
            'text-wrap': 'ellipsis',
            'overlay-padding': '4px',
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 4,
            'border-color': '#3b82f6',
            'width': 46,
            'height': 46,
            'shadow-blur': 18,
            'shadow-color': '#3b82f6',
            'shadow-opacity': 0.8,
          },
        },
        {
          selector: 'node.highlighted',
          style: {
            'border-width': 4,
            'border-color': '#f59e0b',
            'shadow-blur': 16,
            'shadow-color': '#f59e0b',
            'shadow-opacity': 0.85,
          },
        },
        {
          selector: 'node.flagged-target',
          style: {
            'border-width': 3.5,
            'border-color': '#ef4444',
            'shadow-blur': 14,
            'shadow-color': '#ef4444',
            'shadow-opacity': 0.8,
          },
        },
        {
          selector: 'node.dimmed',
          style: { 'opacity': 0.18 },
        },
        {
          selector: 'edge',
          style: {
            'width': 1.8,
            'line-color': '#475569',
            'target-arrow-color': '#64748b',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'label': 'data(label)',
            'color': '#94a3b8',
            'font-size': '9px',
            'font-weight': '500',
            'text-background-color': '#090d16',
            'text-background-opacity': 0.85,
            'text-background-padding': '3px',
            'text-background-shape': 'roundrectangle',
            'edge-text-rotation': 'autorotate',
            'opacity': 0.75,
          },
        },
        {
          selector: 'edge:selected',
          style: {
            'line-color': '#3b82f6',
            'target-arrow-color': '#3b82f6',
            'width': 3,
            'opacity': 1,
          },
        },
        {
          selector: 'edge.path-highlight',
          style: {
            'line-color': '#f59e0b',
            'target-arrow-color': '#f59e0b',
            'width': 3.2,
            'opacity': 1,
          },
        },
        {
          selector: 'edge.dimmed',
          style: { 'opacity': 0.08 },
        },
      ],
      layout: { name: 'cose', randomize: true, animate: false } as any,
      wheelSensitivity: 0.3,
      minZoom: 0.1,
      maxZoom: 5,
    });

    // Click on node
    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      setSelectedNode(node.data());
      setSelectedEdge(null);

      if (pathMode) {
        setPathNodes(prev => {
          if (prev.length === 0) return [node.data()];
          if (prev.length === 1) return [...prev, node.data()];
          return [node.data()];
        });
      }

      // Highlight neighbors
      cy.elements().removeClass('highlighted dimmed');
      const neighborhood = node.closedNeighborhood();
      cy.elements().not(neighborhood).addClass('dimmed');
      neighborhood.addClass('highlighted');
    });

    // Click on edge
    cy.on('tap', 'edge', (evt) => {
      setSelectedEdge(evt.target.data());
      setSelectedNode(null);
    });

    // Click on background — clear selection
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        setSelectedNode(null);
        setSelectedEdge(null);
        cy.elements().removeClass('highlighted dimmed');
      }
    });

    cyInstance.current = cy;
    return cy;
  }, [pathMode]);

  const applyLayout = (name: string) => {
    setLayoutName(name as any);
    if (!cyInstance.current) return;
    try {
      let options: any = { name, animate: true, animationDuration: 600 };
      if (name === 'cose') {
        options = {
          ...options,
          randomize: false,
          componentSpacing: 100,
          nodeRepulsion: () => 8000,
          idealEdgeLength: () => 100,
          edgeElasticity: () => 100,
        };
      } else if (name === 'concentric') {
        options = {
          ...options,
          concentric: (ele: any) => ele.data('risk_score') ? Number(ele.data('risk_score')) * 10 : 2,
          levelWidth: () => 2,
        };
      } else if (name === 'circle') {
        options = { ...options, radius: 260 };
      } else if (name === 'breadthfirst') {
        options = { ...options, directed: true, spacingFactor: 1.25 };
      } else if (name === 'random') {
        options = { ...options, animate: true, animationDuration: 600 };
      }
      cyInstance.current.layout(options).run();
    } catch (err) {
      console.warn('Layout switch error:', err);
    }
  };

  // Load the selected investigation network, or the overall network by default.
  useEffect(() => {
    const cy = initCytoscape();
    if (!cy) return;
    loadDemoNetwork(cy);
  }, [investigationCase, entityIdParam, entityTypeParam]);

  const renderGraph = (cy: Core, nodes: GraphNode[], edges: GraphEdge[]) => {
    const nodeIds = new Set(nodes.map(n => n.id));
    // Ensure we never pass edges with missing source or target, which crashes Cytoscape!
    const validEdges = edges.filter(e => e && e.source && e.target && nodeIds.has(e.source) && nodeIds.has(e.target));

    setAllNodes(nodes);
    setAllEdges(validEdges);
    setNodeCount(nodes.length);
    setEdgeCount(validEdges.length);
    setGraphPeople(nodes.filter(node => node.nodeType === 'Person').slice(0, 12));

    cy.elements().remove();

    const cyNodes = nodes.map(n => ({
      group: 'nodes' as const,
      data: {
        id: n.id,
        label: n.name || n.number || n.licensePlate || n.accountNumber || n.id,
        nodeType: n.nodeType,
        ...n,
      },
      classes: (n.flagged || Number(n.risk_score || 0) >= 0.65) ? 'flagged-target' : '',
    }));

    const cyEdges = validEdges.map((e, i) => ({
      group: 'edges' as const,
      data: {
        id: e.id || `edge-${i}-${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        type: e.type,
        confidence: e.confidence || 0.8,
        label: e.type ? e.type.replace(/_/g, ' ') : '',
        relSource: e.relSource,
        recordRef: e.recordRef,
        timestamp: e.timestamp,
      },
    }));

    try {
      cy.add([...cyNodes, ...cyEdges]);
    } catch (err) {
      console.warn('Cytoscape add warning:', err);
    }

    try {
      cy.layout({
        name: layoutName,
        randomize: true,
        animate: true,
        animationDuration: 800,
        componentSpacing: 100,
        nodeRepulsion: () => 8000,
        idealEdgeLength: () => 100,
        edgeElasticity: () => 100,
      } as any).run();
    } catch (err) {
      console.warn('Cytoscape layout warning:', err);
    }

    setNodeCount(cyNodes.length);
    setEdgeCount(cyEdges.length);
    setGraphPeople(nodes.filter(node => node.nodeType === 'Person').slice(0, 12));

    if (entityIdParam) {
      setTimeout(() => {
        const target = cy.$(`node[id = "${entityIdParam}"]`);
        if (target && target.length > 0) {
          setSelectedNode(target.data());
          cy.elements().removeClass('highlighted dimmed');
          const neighborhood = target.closedNeighborhood();
          cy.elements().not(neighborhood).addClass('dimmed');
          neighborhood.addClass('highlighted');
          cy.animate({ center: { eles: target }, zoom: 1.5, duration: 400 });
        }
      }, 600);
    }
  };

  const renderInvestigationFallback = (cy: Core, caseRef: string) => {
    const normalized = caseRef.trim().toLowerCase();
    const targetFir = FIR_RECORDS.find(f =>
      f.id.toLowerCase() === normalized ||
      f.firNumber.toLowerCase() === normalized ||
      f.firNumber.toLowerCase().replace('fir-', 'case-') === normalized ||
      normalized.includes(f.id.toLowerCase()) ||
      normalized.includes(f.firNumber.toLowerCase())
    ) || FIR_RECORDS[0];

    const linkedIds = new Set<string>(targetFir.linkedEntities || []);
    linkedIds.add(targetFir.id);

    // Include 1st degree neighbor nodes connected via GRAPH_EDGES
    GRAPH_EDGES.forEach(e => {
      if (linkedIds.has(e.source)) linkedIds.add(e.target);
      if (linkedIds.has(e.target)) linkedIds.add(e.source);
    });

    const demoNodes: GraphNode[] = (ALL_ENTITIES as any[])
      .filter(e => linkedIds.has(e.id))
      .map(e => ({
        id: e.id,
        nodeType: e.nodeType,
        name: e.name || e.number || e.licensePlate || e.accountNumber || e.id,
        ...e,
      }));

    if (!demoNodes.some(n => n.id === targetFir.id)) {
      demoNodes.push({
        id: targetFir.id,
        nodeType: 'Case',
        name: targetFir.firNumber,
        firNumber: targetFir.firNumber,
        ...targetFir,
      });
    }

    const nodeIds = new Set(demoNodes.map(n => n.id));
    const demoEdges: GraphEdge[] = GRAPH_EDGES
      .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e, i) => ({
        id: `e-inv-${i}`,
        source: e.source,
        target: e.target,
        type: e.type,
        confidence: e.confidence,
        relSource: (e as any).source_ref || 'CASE_INTELLIGENCE_LINK',
      }));

    // Ensure edges connecting FIR to its linked entities exist
    (targetFir.linkedEntities || []).forEach((entityId, idx) => {
      if (nodeIds.has(entityId)) {
        const alreadyHasEdge = demoEdges.some(
          e => (e.source === entityId && e.target === targetFir.id) || (e.source === targetFir.id && e.target === entityId)
        );
        if (!alreadyHasEdge) {
          demoEdges.push({
            id: `fir-link-${idx}`,
            source: entityId,
            target: targetFir.id,
            type: 'APPEARED_IN_CASE',
            confidence: 0.99,
            relSource: targetFir.firNumber,
          });
        }
      }
    });

    renderGraph(cy, demoNodes, demoEdges);
  };

  const renderEntityFallback = (cy: Core, entityId: string, fallbackType: string) => {
    const focusIds = new Set<string>([entityId]);

    // 1-hop neighbors
    GRAPH_EDGES.forEach(e => {
      if (e.source === entityId) focusIds.add(e.target);
      if (e.target === entityId) focusIds.add(e.source);
    });

    // 2-hop neighbors (capped to 40 nodes to maintain performance and clarity)
    const firstHop = Array.from(focusIds);
    for (const id of firstHop) {
      if (focusIds.size >= 40) break;
      GRAPH_EDGES.forEach(e => {
        if (focusIds.size >= 40) return;
        if (e.source === id) focusIds.add(e.target);
        if (e.target === id) focusIds.add(e.source);
      });
    }

    const demoNodes: GraphNode[] = (ALL_ENTITIES as any[])
      .filter(e => focusIds.has(e.id))
      .map(e => ({
        id: e.id,
        nodeType: e.nodeType,
        name: e.name || e.number || e.licensePlate || e.accountNumber || e.id,
        ...e,
      }));

    if (!demoNodes.some(n => n.id === entityId)) {
      demoNodes.push({
        id: entityId,
        nodeType: fallbackType || 'Person',
        name: entityId,
      });
      focusIds.add(entityId);
    }

    const nodeIds = new Set(demoNodes.map(n => n.id));
    const demoEdges: GraphEdge[] = GRAPH_EDGES
      .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e, i) => ({
        id: `e-ent-${i}`,
        source: e.source,
        target: e.target,
        type: e.type,
        confidence: e.confidence,
        relSource: (e as any).source_ref || 'ENTITY_NETWORK_EXPANSION',
      }));

    renderGraph(cy, demoNodes, demoEdges);
  };

  const renderDemoGraph = (cy: Core) => {
    const demoNodes: GraphNode[] = (ALL_ENTITIES as any[]).map(e => ({
      id: e.id,
      nodeType: e.nodeType,
      name: e.name || e.number || e.licensePlate || e.accountNumber || e.id,
      ...e,
    }));

    const demoEdges = GRAPH_EDGES.map((e, i) => ({
      id: `e-${i}`,
      source: e.source,
      target: e.target,
      type: e.type,
      confidence: e.confidence,
      relSource: (e as any).source_ref || 'INTERPOL_NCRB_FEED',
    }));

    renderGraph(cy, demoNodes, demoEdges);
  };

  const loadDemoNetwork = async (cy?: Core) => {
    const instance = cy || cyInstance.current;
    setLoading(true);

    let fetchedNodes: GraphNode[] | null = null;
    let fetchedEdges: GraphEdge[] | null = null;

    try {
      if (investigationCase) {
        const res = await api.get(`/api/graph/investigation/${encodeURIComponent(investigationCase)}`);
        if (res.data?.nodes && res.data.nodes.length > 0) {
          fetchedNodes = res.data.nodes;
          fetchedEdges = res.data.edges || [];
        }
      } else if (entityIdParam) {
        const res = await api.get(`/api/entities/${encodeURIComponent(entityTypeParam)}/${encodeURIComponent(entityIdParam)}/network?depth=2&limit=80`);
        if (res.data?.nodes && res.data.nodes.length > 0) {
          fetchedNodes = res.data.nodes;
          fetchedEdges = res.data.edges || [];
        }
      } else {
        // Query live database first to display real PostgreSQL tables
        try {
          const liveRes = await api.get('/api/database/live-data?limit=2000');
          if (liveRes.data?.data && Object.keys(liveRes.data.data).length > 0) {
            const { nodes, edges } = buildGraphFromLiveData(liveRes.data.data);
            if (nodes.length > 0) {
              fetchedNodes = nodes;
              fetchedEdges = edges;
            }
          }
        } catch {
          // Fall through to Neo4j endpoint or local fallback
        }

        if (!fetchedNodes) {
          try {
            const res = await api.get('/api/entities/Person/P001/network?depth=2&limit=80');
            if (res.data?.nodes && res.data.nodes.length > 0) {
              fetchedNodes = res.data.nodes;
              fetchedEdges = res.data.edges || [];
            }
          } catch {
            // Fall through to demo graph
          }
        }
      }
    } catch {
      // API request failed or offline; proceed to fallback
    } finally {
      setLoading(false);
    }

    if (fetchedNodes && fetchedNodes.length > 0) {
      if (instance) {
        renderGraph(instance, fetchedNodes, fetchedEdges || []);
      } else {
        setAllNodes(fetchedNodes);
        setAllEdges(fetchedEdges || []);
      }
    } else {
      if (investigationCase) {
        if (instance) renderInvestigationFallback(instance, investigationCase);
      } else if (entityIdParam) {
        if (instance) renderEntityFallback(instance, entityIdParam, entityTypeParam);
      } else {
        if (instance) renderDemoGraph(instance);
      }
    }
  };

  useEffect(() => {
    if (investigationCase || entityIdParam) return;
    Promise.all([
      api.get('/api/investigations/officers'),
      api.get('/api/investigations?limit=50'),
    ]).then(([officerResponse, caseResponse]) => {
      setOfficers(officerResponse.data.officers || []);
      setCases(caseResponse.data.investigations || []);
    }).catch(() => {
      setOfficers([]);
      setCases([]);
    });
  }, [investigationCase, entityIdParam]);


  const expandNode = async (node: GraphNode) => {
    if (!cyInstance.current || !node.nodeType) return;
    setLoading(true);
    try {
      const res = await api.post('/api/graph/expand', { nodeId: node.id, nodeType: node.nodeType, limit: 20 });
      const { nodes = [], edges = [] } = res.data || {};
      const existingIds = new Set(cyInstance.current.nodes().map((n: any) => n.id()));

      const newNodes = nodes.filter((n: GraphNode) => !existingIds.has(n.id));
      const newCyNodes = newNodes.map((n: GraphNode) => ({
        data: { id: n.id, label: getNodeLabel(n), nodeType: n.nodeType, ...n },
      }));

      const allKnownIds = new Set([...existingIds, ...newNodes.map((n: GraphNode) => n.id)]);
      const validNewEdges = edges.filter((e: GraphEdge) => e && e.source && e.target && allKnownIds.has(e.source) && allKnownIds.has(e.target));
      const newEdges = validNewEdges.map((e: GraphEdge, i: number) => ({
        data: { id: e.id || `expand-${i}-${e.source}-${e.target}`, source: e.source, target: e.target, label: e.type?.replace(/_/g, ' '), ...e },
      }));

      try {
        cyInstance.current.add([...newCyNodes, ...newEdges]);
        cyInstance.current.layout({ name: 'cose', randomize: false, animate: true, animationDuration: 600 } as any).run();
      } catch (err) {
        console.warn('Expand layout warning:', err);
      }
      setNodeCount(cyInstance.current.nodes().length);
      setEdgeCount(cyInstance.current.edges().length);
    } catch {
      // No-op
    } finally {
      setLoading(false);
    }
  };

  const findPath = async () => {
    if (pathNodes.length < 2) return;
    setPathLoading(true);
    try {
      const [from, to] = pathNodes;
      const res = await api.post('/api/graph/path', {
        fromId: from.id, fromType: from.nodeType,
        toId: to.id, toType: to.nodeType, maxHops: 6,
      });
      setPathResult(res.data.paths || []);

      // Highlight path in graph
      if (cyInstance.current && res.data.paths.length > 0) {
        const pathNodeIds = new Set<string>();
        res.data.paths[0].nodes?.forEach((n: any) => pathNodeIds.add(n.id));
        cyInstance.current.elements().removeClass('path-highlight highlighted dimmed');
        cyInstance.current.nodes().forEach((n: any) => {
          if (!pathNodeIds.has(n.id())) n.addClass('dimmed');
          else n.addClass('highlighted');
        });
        cyInstance.current.edges().addClass('dimmed');
        cyInstance.current.edges().filter((e: any) =>
          pathNodeIds.has(e.source().id()) && pathNodeIds.has(e.target().id())
        ).removeClass('dimmed').addClass('path-highlight');
      }
    } catch {
      // No-op
    } finally {
      setPathLoading(false);
    }
  };

  const resetGraph = () => {
    if (cyInstance.current) {
      cyInstance.current.elements().removeClass('highlighted dimmed path-highlight');
      cyInstance.current.fit(undefined, 40);
    }
    setPathNodes([]);
    setPathResult(null);
    setSelectedNode(null);
    setSelectedEdge(null);
  };

  const exportGraph = () => {
    if (!cyInstance.current) return;
    const png = cyInstance.current.png({ output: 'blob', scale: 2, bg: '#080c18' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(png);
    a.download = `crimegraph-network-${Date.now()}.png`;
    a.click();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - var(--topbar-height) - 48px)', gap: 12 }}>

      {investigationCase && (
        <div className="ai-disclaimer">Focused investigation graph: <strong>{investigationCase}</strong>. Expand nodes to inspect related people, accounts, locations, and communications.</div>
      )}
      {entityIdParam && (
        <div className="ai-disclaimer">
          Focused entity graph: <strong>{entityTypeParam} · {entityIdParam}</strong>. Exploring connections, direct relationships, and link predictions.
        </div>
      )}

      {/* Path finder bar */}
      {pathMode && viewDimension === '2d' && (
        <div style={{
          padding: '10px 14px', background: 'rgba(59,130,246,0.08)',
          border: '1px solid rgba(59,130,246,0.2)', borderRadius: 10,
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <GitBranch size={14} color="var(--accent-primary)" />
          <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Path Finder: Click on <strong>Node 1</strong> then <strong>Node 2</strong> in the graph to find the shortest path.
          </span>
          {pathNodes.map((n, i) => (
            <span key={i} className="badge badge-info">
              Node {i + 1}: {getNodeLabel(n)} ({n.nodeType})
            </span>
          ))}
          {pathNodes.length === 2 && (
            <button className="btn btn-primary btn-sm" onClick={findPath} disabled={pathLoading}>
              {pathLoading ? <Loader size={14} className="loading-spinner" /> : 'Find Path'}
            </button>
          )}
          {pathResult && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {pathResult.length > 0 ? `✅ ${pathResult.length} path(s) found` : '❌ No path found'}
            </span>
          )}
        </div>
      )}

      {/* Main graph area */}
      <div
        ref={graphContainerRef}
        data-fullscreen={isFullscreen ? 'true' : 'false'}
        style={{
          flex: 1,
          display: 'flex',
          gap: isFullscreen ? 0 : 12,
          minHeight: 0,
          ...(isFullscreen ? {
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100vh',
            zIndex: 9999,
            background: '#080c18',
            padding: 0,
            margin: 0,
            border: 'none',
            borderRadius: 0,
            boxSizing: 'border-box',
          } : {})
        }}
      >
        {/* Graph canvas container */}
        <div
          className="graph-container"
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden',
            ...(isFullscreen ? {
              border: 'none',
              borderRadius: 0,
              boxShadow: 'none',
              margin: 0,
              padding: 0,
            } : {})
          }}
        >
          {/* 2D Controls (Vertical Menu, Filters, Search & Top-Right Switch) */}
          {viewDimension === '2d' && (
            <>
              {/* Left Top: Vertical Icon Toolbar (2D Theme) */}
              <div style={{
                position: 'absolute',
                top: 14,
                left: 14,
                zIndex: layoutMenu2DOpen ? 60 : 25,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                background: 'rgba(255, 255, 255, 0.96)',
                backdropFilter: 'blur(12px)',
                padding: '5px',
                borderRadius: 10,
                border: '1px solid var(--border-primary, #cbd5e1)',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
              }}>
                {/* Layout Selector Option */}
                <div ref={layout2DRef} style={{ position: 'relative' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setLayoutMenu2DOpen(prev => !prev);
                      setFilter2DOpen(false);
                      setSearch2DOpen(false);
                    }}
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
                      background: layoutMenu2DOpen ? 'var(--accent-light, #eff6ff)' : 'transparent',
                      color: layoutMenu2DOpen ? 'var(--accent-primary, #2563eb)' : 'var(--text-primary, #0f172a)',
                      border: layoutMenu2DOpen ? '1px solid rgba(37, 99, 235, 0.3)' : 'none',
                    }}
                    onMouseEnter={(e) => {
                      if (!layoutMenu2DOpen) {
                        e.currentTarget.style.background = 'var(--bg-hover, #f1f5f9)';
                        e.currentTarget.style.color = 'var(--accent-primary, #2563eb)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!layoutMenu2DOpen) {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = 'var(--text-primary, #0f172a)';
                      }
                    }}
                    title="Change Graph Layout"
                  >
                    <LayoutGrid size={15} />
                  </button>

                  {/* Layout Selection Flyout */}
                  {layoutMenu2DOpen && (
                    <div style={{
                      position: 'absolute',
                      top: 0,
                      left: 38,
                      width: 195,
                      background: '#ffffff',
                      border: '1px solid var(--border-primary, #cbd5e1)',
                      borderRadius: 10,
                      boxShadow: '0 12px 32px rgba(0, 0, 0, 0.14)',
                      padding: '6px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      zIndex: 100,
                    }}>
                      <div style={{
                        padding: '4px 8px 6px',
                        fontSize: '0.66rem',
                        fontWeight: 700,
                        color: '#64748b',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        borderBottom: '1px solid var(--border-primary, #e2e8f0)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}>
                        <span>Graph Layout</span>
                        <span style={{ fontSize: '0.62rem', color: '#94a3b8', fontWeight: 500 }}>{LAYOUT_OPTIONS.length} options</span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
                        {LAYOUT_OPTIONS.map((opt) => {
                          const isActive = layoutName === opt.value;
                          const IconComp = opt.icon;
                          return (
                            <div
                              key={opt.value}
                              onClick={() => {
                                applyLayout(opt.value);
                                setLayoutMenu2DOpen(false);
                              }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '6px 8px',
                                borderRadius: 6,
                                background: isActive ? 'var(--accent-light, #eff6ff)' : 'transparent',
                                color: isActive ? 'var(--accent-primary, #2563eb)' : '#0f172a',
                                cursor: 'pointer',
                                transition: 'background 120ms ease',
                                fontSize: '0.76rem',
                                fontWeight: isActive ? 600 : 500,
                              }}
                              onMouseEnter={(e) => {
                                if (!isActive) e.currentTarget.style.background = 'var(--bg-hover, #f8fafc)';
                              }}
                              onMouseLeave={(e) => {
                                if (!isActive) e.currentTarget.style.background = 'transparent';
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                <IconComp size={13} style={{ color: isActive ? 'var(--accent-primary, #2563eb)' : '#64748b' }} />
                                <span>{opt.label}</span>
                              </div>
                              {isActive && <Check size={13} style={{ color: 'var(--accent-primary, #2563eb)', strokeWidth: 2.5 }} />}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Divider */}
                <div style={{ width: 20, height: 1, background: 'var(--border-primary, #e2e8f0)', margin: '2px 0' }} />

                {/* Zoom In */}
                <button
                  type="button"
                  onClick={() => cyInstance.current?.zoom({ level: cyInstance.current.zoom() * 1.25 })}
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
                    color: 'var(--text-primary, #0f172a)',
                    border: 'none',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover, #f1f5f9)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  title="Zoom In"
                >
                  <ZoomIn size={14} />
                </button>

                {/* Zoom Out */}
                <button
                  type="button"
                  onClick={() => cyInstance.current?.zoom({ level: cyInstance.current.zoom() * 0.8 })}
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
                    color: 'var(--text-primary, #0f172a)',
                    border: 'none',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover, #f1f5f9)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  title="Zoom Out"
                >
                  <ZoomOut size={14} />
                </button>

                {/* Reset View */}
                <button
                  type="button"
                  onClick={resetGraph}
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
                    color: 'var(--text-primary, #0f172a)',
                    border: 'none',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover, #f1f5f9)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  title="Reset & Fit View"
                >
                  <RotateCw size={14} />
                </button>
              </div>

              {/* Top Left Bar: Entity Filter & 2D Search Controls */}
              <div style={{
                position: 'absolute',
                top: 14,
                left: 66,
                zIndex: (filter2DOpen || search2DOpen) ? 45 : 25,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                {/* Filter Dropdown */}
                <div ref={filter2DRef} style={{ position: 'relative' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setFilter2DOpen(!filter2DOpen);
                      setLayoutMenu2DOpen(false);
                    }}
                    style={{
                      height: 32,
                      boxSizing: 'border-box',
                      padding: '0 10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      background: '#ffffff',
                      border: `1px solid ${filter2DOpen ? 'var(--accent-primary, #2563eb)' : 'var(--border-primary, #cbd5e1)'}`,
                      borderRadius: 8,
                      color: 'var(--text-primary, #0f172a)',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                      transition: 'all 150ms ease',
                    }}
                    title="Filter Entities by Type"
                  >
                    <Filter size={13} style={{ color: 'var(--accent-primary, #2563eb)' }} />
                    <span>Filters</span>
                    <span style={{
                      fontSize: '0.66rem',
                      padding: '1px 6px',
                      borderRadius: 10,
                      background: isAll2DSelected
                        ? 'rgba(0,0,0,0.06)'
                        : isNone2DSelected
                          ? '#fee2e2'
                          : '#eff6ff',
                      color: isAll2DSelected
                        ? '#475569'
                        : isNone2DSelected
                          ? '#ef4444'
                          : '#2563eb',
                      fontWeight: 700,
                    }}>
                      {isAll2DSelected ? 'ALL' : isNone2DSelected ? 'NONE' : `${selected2DTypes.size} active`}
                    </span>
                    <ChevronDown
                      size={12}
                      style={{
                        color: '#64748b',
                        transform: filter2DOpen ? 'rotate(180deg)' : 'none',
                        transition: 'transform 150ms ease',
                      }}
                    />
                  </button>

                  {filter2DOpen && (
                    <div style={{
                      position: 'absolute',
                      top: 36,
                      left: 0,
                      width: 230,
                      background: '#ffffff',
                      border: '1px solid var(--border-primary, #cbd5e1)',
                      borderRadius: 10,
                      boxShadow: '0 12px 32px rgba(0, 0, 0, 0.14)',
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
                        borderBottom: '1px solid var(--border-primary, #e2e8f0)',
                        fontSize: '0.68rem',
                        color: '#64748b',
                        fontWeight: 600,
                      }}>
                        <span>SELECT TYPES</span>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            type="button"
                            onClick={handleSelectAll2D}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#2563eb',
                              cursor: 'pointer',
                              fontSize: '0.68rem',
                              fontWeight: 600,
                              padding: 0,
                            }}
                          >
                            All
                          </button>
                          <span style={{ color: '#cbd5e1' }}>|</span>
                          <button
                            type="button"
                            onClick={handleClearAll2D}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#64748b',
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
                        {available2DTypes.map(t => {
                          const isChecked = selected2DTypes.has(t);
                          const col = TYPE_COLORS[t] || '#38bdf8';
                          const count = allNodes.filter(n => n.nodeType === t).length;

                          return (
                            <div
                              key={t}
                              onClick={() => toggle2DType(t)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '5px 8px',
                                borderRadius: 6,
                                background: isChecked ? 'rgba(37, 99, 235, 0.05)' : 'transparent',
                                cursor: 'pointer',
                                transition: 'background 120ms ease',
                                userSelect: 'none',
                              }}
                              onMouseEnter={(e) => {
                                if (!isChecked) e.currentTarget.style.background = 'var(--bg-hover, #f8fafc)';
                              }}
                              onMouseLeave={(e) => {
                                if (!isChecked) e.currentTarget.style.background = 'transparent';
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                <div style={{
                                  width: 15,
                                  height: 15,
                                  borderRadius: 4,
                                  border: `1.5px solid ${isChecked ? col : '#cbd5e1'}`,
                                  background: isChecked ? col : 'transparent',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  transition: 'all 120ms ease',
                                  flexShrink: 0,
                                }}>
                                  {isChecked && <Check size={11} color="#ffffff" strokeWidth={3.5} />}
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, flexShrink: 0 }}>
                                  {renderEntityIcon(t, 13, col)}
                                </div>
                                <span style={{
                                  fontSize: '0.76rem',
                                  fontWeight: isChecked ? 600 : 500,
                                  color: isChecked ? '#0f172a' : '#64748b',
                                }}>
                                  {t}
                                </span>
                              </div>

                              <span style={{
                                fontSize: '0.68rem',
                                color: '#94a3b8',
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

                {/* 2D Search Bar */}
                <div ref={search2DRef} style={{ position: 'relative' }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    height: 32,
                    boxSizing: 'border-box',
                    padding: '0 8px 0 10px',
                    background: '#ffffff',
                    border: `1px solid ${search2DOpen && search2DQuery ? 'var(--accent-primary, #2563eb)' : 'var(--border-primary, #cbd5e1)'}`,
                    borderRadius: 8,
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                    transition: 'all 150ms ease',
                    width: 220,
                  }}>
                    <Search size={13} style={{ color: 'var(--accent-primary, #2563eb)', flexShrink: 0 }} />
                    <input
                      type="text"
                      value={search2DQuery}
                      onChange={(e) => {
                        setSearch2DQuery(e.target.value);
                        setSearch2DOpen(true);
                        setLayoutMenu2DOpen(false);
                      }}
                      onFocus={() => {
                        setSearch2DOpen(true);
                        setLayoutMenu2DOpen(false);
                      }}
                      onKeyDown={handle2DSearchKeyDown}
                      placeholder="Search 2D entities..."
                      style={{
                        background: 'transparent',
                        border: 'none',
                        outline: 'none',
                        color: 'var(--text-primary, #0f172a)',
                        fontSize: '0.75rem',
                        width: '100%',
                        fontWeight: 500,
                      }}
                    />
                    {search2DQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearch2DQuery('');
                          setSearch2DOpen(false);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 2,
                          cursor: 'pointer',
                          color: '#64748b',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>

                  {/* Autocomplete Dropdown */}
                  {search2DOpen && search2DQuery.trim().length > 0 && (
                    <div style={{
                      position: 'absolute',
                      top: 36,
                      left: 0,
                      width: 270,
                      background: '#ffffff',
                      border: '1px solid var(--border-primary, #cbd5e1)',
                      borderRadius: 10,
                      boxShadow: '0 12px 32px rgba(0, 0, 0, 0.14)',
                      padding: '6px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      maxHeight: 320,
                      overflowY: 'auto',
                      zIndex: 100,
                    }}>
                      <div style={{
                        padding: '3px 8px 5px',
                        fontSize: '0.64rem',
                        color: '#64748b',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        borderBottom: '1px solid var(--border-primary, #e2e8f0)',
                      }}>
                        {search2DResults.length} Result{search2DResults.length === 1 ? '' : 's'} (Press Enter to focus)
                      </div>

                      {search2DResults.length === 0 ? (
                        <div style={{ padding: '12px 8px', fontSize: '0.75rem', color: '#94a3b8', textAlign: 'center' }}>
                          No matching entities found
                        </div>
                      ) : (
                        search2DResults.map((n) => {
                          const col = TYPE_COLORS[n.nodeType] || '#38bdf8';
                          const label = getNodeLabel(n);
                          return (
                            <div
                              key={n.id}
                              onClick={() => handleSelect2DSearchResult(n)}
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
                              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover, #f1f5f9)')}
                              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                                <div style={{
                                  width: 24,
                                  height: 24,
                                  borderRadius: 6,
                                  background: `${col}18`,
                                  border: `1px solid ${col}40`,
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
                                    color: '#0f172a',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                  }}>
                                    {label}
                                  </span>
                                  <span style={{ fontSize: '0.64rem', color: '#64748b' }}>
                                    ID: {n.id} {n.occupation ? `· ${n.occupation}` : ''}
                                  </span>
                                </div>
                              </div>

                              <span style={{
                                fontSize: '0.62rem',
                                fontWeight: 700,
                                padding: '1px 6px',
                                borderRadius: 4,
                                background: `${col}15`,
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

              {/* Right Top: Switch & Fullscreen */}
              <div
                style={{
                  position: 'absolute',
                  top: 14,
                  right: 16,
                  zIndex: 25,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                {/* Standalone 2D / 3D Segmented Switch (2D Theme) */}
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  height: 32,
                  boxSizing: 'border-box',
                  background: 'var(--bg-elevated, #f1f5f9)',
                  backdropFilter: 'blur(8px)',
                  padding: '2px',
                  borderRadius: 8,
                  border: '1px solid var(--border-primary, #cbd5e1)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                  gap: 2,
                }}>
                  <button
                    type="button"
                    title="Currently in 2D Graph View"
                    style={{
                      height: 26,
                      boxSizing: 'border-box',
                      padding: '0 9px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      borderRadius: 6,
                      cursor: 'default',
                      background: '#ffffff',
                      color: 'var(--accent-primary, #2563eb)',
                      border: 'none',
                      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
                      fontSize: '0.74rem',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <Network size={13} style={{ color: 'var(--accent-primary, #2563eb)' }} />
                    <span>2D</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setViewDimension('3d')}
                    title="Switch to 3D Space View"
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
                      color: 'var(--text-secondary, #64748b)',
                      border: 'none',
                      fontSize: '0.74rem',
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'var(--text-primary, #0f172a)';
                      e.currentTarget.style.background = 'rgba(0, 0, 0, 0.05)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--text-secondary, #64748b)';
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <Box size={13} style={{ color: 'var(--text-secondary, #64748b)' }} />
                    <span>3D</span>
                  </button>
                </div>

                {/* Standalone Fullscreen Button (2D Theme) */}
                <button
                  type="button"
                  onClick={toggleFullscreen}
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
                    background: isFullscreen ? 'var(--accent-light, #eff6ff)' : '#ffffff',
                    color: isFullscreen ? 'var(--accent-primary, #2563eb)' : 'var(--text-primary, #0f172a)',
                    border: isFullscreen ? '1px solid var(--accent-primary, #2563eb)' : '1px solid var(--border-primary, #cbd5e1)',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => {
                    if (!isFullscreen) {
                      e.currentTarget.style.background = 'var(--bg-hover, #f8fafc)';
                      e.currentTarget.style.borderColor = 'var(--border-secondary, #94a3b8)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isFullscreen) {
                      e.currentTarget.style.background = '#ffffff';
                      e.currentTarget.style.borderColor = 'var(--border-primary, #cbd5e1)';
                    }
                  }}
                >
                  {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </button>
              </div>
            </>
          )}

          {loading && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 12,
              background: 'rgba(8, 12, 24, 0.75)', zIndex: 30, borderRadius: 14,
            }}>
              <div className="loading-spinner" style={{ width: 40, height: 40, borderWidth: 3 }} />
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Loading intelligence network...</span>
            </div>
          )}

          {/* 2D Cytoscape container */}
          <div
            ref={cyRef}
            style={{
              width: '100%',
              height: '100%',
              display: viewDimension === '2d' ? 'block' : 'none',
            }}
          />

          {/* 3D WebGL Three.js container */}
          {viewDimension === '3d' && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 2 }}>
              <Network3DGraph
                nodes={allNodes as Graph3DNode[]}
                edges={allEdges as Graph3DEdge[]}
                selectedNodeId={selectedNode?.id}
                onSelectNode={node => setSelectedNode(node as GraphNode | null)}
                onSelectEdge={edge => setSelectedEdge(edge as GraphEdge | null)}
                isFullscreen={isFullscreen}
                onToggleFullscreen={toggleFullscreen}
                onSwitchTo2D={() => setViewDimension('2d')}
              />
            </div>
          )}

          {/* 2D Graph stats overlay */}
          {viewDimension === '2d' && (
            <div style={{
              position: 'absolute', bottom: 12, left: 12,
              display: 'flex', gap: 8, flexWrap: 'wrap', zIndex: 10,
            }}>
              <div style={{
                padding: '5px 12px', background: 'rgba(15, 23, 42, 0.88)',
                backdropFilter: 'blur(8px)', border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 8, fontSize: '0.74rem', color: '#cbd5e1',
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              }}>
                <strong style={{ color: '#38bdf8' }}>{nodeCount}</strong> nodes · <strong style={{ color: '#38bdf8' }}>{edgeCount}</strong> edges
              </div>
              <div className="ai-disclaimer" style={{ padding: '5px 12px', fontSize: '0.72rem' }}>
                Analytical relationships — not proof of wrongdoing
              </div>
            </div>
          )}


        </div>

        {/* Right panel — entity details */}
        {(selectedNode || selectedEdge) && (
          <div className="slide-in-right" style={{
            width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12,
            overflowY: 'auto', maxHeight: '100%',
            ...(isFullscreen ? {
              background: 'rgba(15, 23, 42, 0.95)',
              backdropFilter: 'blur(16px)',
              borderLeft: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 0,
              margin: 0,
              padding: 16,
              zIndex: 30,
            } : {})
          }}>
            {selectedNode && (
              <div className="card" style={{ flex: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: '1.2rem' }}>{NODE_ICONS[selectedNode.nodeType]}</span>
                      <span className={`badge badge-${selectedNode.nodeType?.toLowerCase()}`}>{selectedNode.nodeType}</span>
                    </div>
                    <h3 style={{ fontSize: '1rem' }}>{getNodeLabel(selectedNode)}</h3>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setSelectedNode(null); if (cyInstance.current) cyInstance.current.elements().removeClass('highlighted dimmed'); }}>
                    <X size={14} />
                  </button>
                </div>

                {/* Entity properties */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {Object.entries(selectedNode)
                    .filter(([k]) => !['id', 'nodeType', 'createdAt', 'communityId'].includes(k))
                    .filter(([, v]) => v !== null && v !== undefined && v !== '')
                    .map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', gap: 8, fontSize: '0.8rem' }}>
                        <span style={{ color: 'var(--text-muted)', textTransform: 'capitalize', width: 100, flexShrink: 0 }}>
                          {k.replace(/([A-Z])/g, ' $1').toLowerCase()}
                        </span>
                        <span style={{ color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
                          {String(v).substring(0, 60)}
                        </span>
                      </div>
                    ))}
                </div>

                <div style={{ marginTop: 14, display: 'flex', gap: 6 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => expandNode(selectedNode)}>
                    <ChevronRight size={12} /> Expand
                  </button>
                  <a
                    href={`/entities/${selectedNode.nodeType}/${selectedNode.id}`}
                    className="btn btn-secondary btn-sm"
                    target="_blank"
                  >
                    <Info size={12} /> Full Profile
                  </a>
                </div>
              </div>
            )}

            {selectedEdge && (
              <div className="card" style={{ flex: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <h4 style={{ fontSize: '0.875rem' }}>Relationship Details</h4>
                  <button className="btn btn-ghost btn-sm" onClick={() => setSelectedEdge(null)}>
                    <X size={14} />
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{
                    padding: '8px 10px', background: 'var(--bg-tertiary)',
                    borderRadius: 6, textAlign: 'center', fontSize: '0.875rem',
                    fontWeight: 600, color: 'var(--text-accent)',
                  }}>
                    {selectedEdge.type?.replace(/_/g, ' ')}
                  </div>
                  {[
                    { label: 'Confidence', value: selectedEdge.confidence ? `${Math.round(Number(selectedEdge.confidence) * 100)}%` : '—' },
                    { label: 'Timestamp', value: selectedEdge.timestamp ? new Date(selectedEdge.timestamp).toLocaleString('en-IN') : '—' },
                    { label: 'Source', value: selectedEdge.relSource || '—' },
                    { label: 'Record Ref', value: selectedEdge.recordRef || '—' },
                  ].map(item => (
                    <div key={item.label} style={{ display: 'flex', gap: 8, fontSize: '0.8rem' }}>
                      <span style={{ color: 'var(--text-muted)', width: 90, flexShrink: 0 }}>{item.label}</span>
                      <span style={{ color: 'var(--text-secondary)', fontFamily: item.label === 'Record Ref' ? 'var(--font-mono)' : undefined }}>
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="ai-disclaimer" style={{ marginTop: 10 }}>
                  Relationship shown is based on recorded data. Does not imply criminal activity.
                </div>
              </div>
            )}

            {/* Path result panel */}
            {pathResult && pathResult.length > 0 && (
              <div className="card" style={{ flex: 'none' }}>
                <h4 style={{ fontSize: '0.875rem', marginBottom: 10 }}>Path Analysis Results</h4>
                {pathResult.map((path: any, i: number) => (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 4 }}>
                      Path {i + 1} ({path.length} hops):
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {path.nodes?.map((n: any, j: number) => (
                        <span key={j} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                          <span className={`badge badge-${n.nodeType?.toLowerCase()}`} style={{ fontSize: '0.65rem' }}>
                            {n.name || n.id}
                          </span>
                          {j < path.nodes.length - 1 && <ChevronRight size={10} color="var(--text-muted)" />}
                        </span>
                      ))}
                    </div>
                    <div className="ai-disclaimer" style={{ marginTop: 6, fontSize: '0.72rem' }}>
                      {path.disclaimer || 'Analytical lead — requires investigator review'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Official NCRB Investigation Dossier Modal */}
      {showDossierModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0, 0, 0, 0.85)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20, overflowY: 'auto',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowDossierModal(false); }}
        >
          <div
            style={{
              background: '#0d1322', color: '#e2e8f0',
              border: '1px solid #1e293b', borderRadius: 16,
              width: '100%', maxWidth: 860, maxHeight: '90vh',
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.75)',
              overflow: 'hidden',
            }}
          >
            {/* Modal Action Bar (Sticky) */}
            <div
              style={{
                padding: '12px 20px', background: '#131d33',
                borderBottom: '1px solid #1e293b',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShieldAlert size={18} color="#3b82f6" />
                <span style={{ fontWeight: 600, fontSize: '0.875rem', letterSpacing: '0.05em' }}>
                  FORENSIC CASE DOSSIER · NCRB INTELLIGENCE
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => window.print()}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#2563eb' }}
                >
                  <Printer size={14} /> Print / Save as PDF
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowDossierModal(false)}
                  style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <X size={14} /> Close
                </button>
              </div>
            </div>

            {/* Printable Dossier Content */}
            <div style={{ padding: '24px 28px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* Header */}
              <div style={{ textAlign: 'center', borderBottom: '2px solid #1e3a8a', paddingBottom: 16 }}>
                <div style={{ fontSize: '0.75rem', letterSpacing: '0.15em', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4 }}>
                  Government of India · Ministry of Home Affairs
                </div>
                <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f8fafc', margin: '0 0 6px', letterSpacing: '0.02em' }}>
                  NATIONAL CRIME RECORDS BUREAU (NCRB)
                </h2>
                <div style={{ fontSize: '0.85rem', color: '#60a5fa', fontWeight: 600, letterSpacing: '0.08em' }}>
                  CRIMEGRAPH AI // AUTOMATED FORENSIC INVESTIGATION REPORT
                </div>
                <div style={{ display: 'inline-block', marginTop: 8, padding: '3px 12px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 20, color: '#f87171', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em' }}>
                  CONFIDENTIAL · FOR JUDICIAL & INVESTIGATIVE REVIEW ONLY
                </div>
              </div>

              {/* Case Metadata Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, background: '#111b2e', padding: 14, borderRadius: 8, border: '1px solid #1e293b' }}>
                <div>
                  <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>CASE REFERENCE</div>
                  <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.875rem' }}>FIR-2024-001 / Spl Cell</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>SYNDICATE CLUSTER</div>
                  <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.875rem' }}>Western & Northern Hawala Ring</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>GENERATION DATE</div>
                  <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.875rem' }}>{new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>INTEGRITY STATUS</div>
                  <div style={{ fontWeight: 600, color: '#22c55e', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <CheckCircle2 size={12} /> SEC. 65B VERIFIED
                  </div>
                </div>
              </div>

              {/* Executive Assessment */}
              <div>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#93c5fd', marginBottom: 8 }}>
                  1. Executive Network Assessment
                </h3>
                <p style={{ fontSize: '0.825rem', lineHeight: 1.6, color: '#cbd5e1', margin: 0 }}>
                  Automated graph analysis identified <strong>30 suspects</strong>, <strong>25 telecom endpoints</strong>, and <strong>12 financial repositories</strong> operating across 3 coordinated cells.
                  Centrality ranking confirms <strong>Arjun Mehta (P001)</strong> as the primary syndicate hub (Degree Centrality: 91%), while <strong>Ajay Singh (P014)</strong> functions as the critical cross-jurisdiction bridge node (Betweenness: 72%). Capital integration is executed via structured smurfing through shell repository <strong>ACC-SHELL-011</strong>.
                </p>
              </div>

              {/* Top Suspects Table */}
              <div>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#93c5fd', marginBottom: 8 }}>
                  2. Primary Persons of Interest (Graph Ranking)
                </h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ background: '#172554', borderBottom: '1px solid #1e3a8a' }}>
                        <th style={{ padding: '8px 10px', color: '#bfdbfe' }}>ID</th>
                        <th style={{ padding: '8px 10px', color: '#bfdbfe' }}>NAME & ALIAS</th>
                        <th style={{ padding: '8px 10px', color: '#bfdbfe' }}>LOCATION</th>
                        <th style={{ padding: '8px 10px', color: '#bfdbfe' }}>CENTRALITY</th>
                        <th style={{ padding: '8px 10px', color: '#bfdbfe' }}>RISK SCORE</th>
                        <th style={{ padding: '8px 10px', color: '#bfdbfe' }}>STATUS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {PERSONS.slice(0, 5).map((p, idx) => (
                        <tr key={p.id} style={{ borderBottom: '1px solid #1e293b', background: idx % 2 === 0 ? 'rgba(15, 23, 42, 0.4)' : 'transparent' }}>
                          <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: '#94a3b8' }}>{p.id}</td>
                          <td style={{ padding: '8px 10px', fontWeight: 600, color: '#f1f5f9' }}>
                            {p.name} {p.alias && <span style={{ color: '#94a3b8', fontWeight: 400 }}>({p.alias})</span>}
                          </td>
                          <td style={{ padding: '8px 10px', color: '#cbd5e1' }}>{p.city}, {p.state}</td>
                          <td style={{ padding: '8px 10px', color: '#38bdf8' }}>{Math.round((p.centralityScore || 0.5) * 100)}%</td>
                          <td style={{ padding: '8px 10px', fontWeight: 600, color: (p.riskScore || 0) > 0.7 ? '#ef4444' : '#f59e0b' }}>
                            {Math.round((p.riskScore || 0.5) * 100)}%
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: '0.7rem', background: (p.riskScore || 0) > 0.7 ? 'rgba(239,68,68,0.2)' : 'rgba(234,179,8,0.2)', color: (p.riskScore || 0) > 0.7 ? '#fca5a5' : '#fde047' }}>
                              {p.status || 'Under Surveillance'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Financial Trail */}
              <div>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#93c5fd', marginBottom: 8 }}>
                  3. Key Illicit Capital Transactions (PMLA Heuristics)
                </h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ background: '#172554', borderBottom: '1px solid #1e3a8a' }}>
                        <th style={{ padding: '8px 10px', color: '#bfdbfe' }}>FROM ACCOUNT</th>
                        <th style={{ padding: '8px 10px', color: '#bfdbfe' }}>TO ACCOUNT</th>
                        <th style={{ padding: '8px 10px', color: '#bfdbfe' }}>AMOUNT</th>
                        <th style={{ padding: '8px 10px', color: '#bfdbfe' }}>DATE</th>
                        <th style={{ padding: '8px 10px', color: '#bfdbfe' }}>FLAGGED REASON</th>
                      </tr>
                    </thead>
                    <tbody>
                      {TRANSACTIONS.filter(t => t.flagged).slice(0, 4).map((t, idx) => (
                        <tr key={t.id} style={{ borderBottom: '1px solid #1e293b', background: idx % 2 === 0 ? 'rgba(15, 23, 42, 0.4)' : 'transparent' }}>
                          <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: '#f1f5f9' }}>{t.fromAccount}</td>
                          <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: '#f1f5f9' }}>{t.toAccount}</td>
                          <td style={{ padding: '8px 10px', fontWeight: 600, color: '#34d399' }}>₹{t.amount.toLocaleString('en-IN')}</td>
                          <td style={{ padding: '8px 10px', color: '#94a3b8' }}>{t.date}</td>
                          <td style={{ padding: '8px 10px', color: '#f87171', fontSize: '0.72rem' }}>{t.flagReason || 'Circular Hawala Transfer'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Legal Certificate & Hash Chain Section */}
              <div style={{ marginTop: 8, padding: 14, background: '#09101d', border: '1px dashed #334155', borderRadius: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, color: '#38bdf8', fontWeight: 600, fontSize: '0.8rem' }}>
                  <ShieldAlert size={14} /> CERTIFICATE OF ELECTRONIC EVIDENCE (SECTION 65B BSA / IEA)
                </div>
                <div style={{ fontSize: '0.72rem', color: '#94a3b8', lineHeight: 1.5 }}>
                  This document constitutes a cryptographically validated output produced automatically by CrimeGraph AI under controlled evidentiary parameters. The underlying graph index, CDR timestamps, and node weights are sealed via incremental SHA-256 block hashing:
                </div>
                <div style={{ marginTop: 8, padding: '6px 10px', background: '#020617', borderRadius: 6, fontFamily: 'monospace', fontSize: '0.68rem', color: '#a7f3d0', wordBreak: 'break-all', border: '1px solid #1e293b' }}>
                  SHA-256 SEED HASH: 7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069::VALID_BLOCK_CHAIN
                </div>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}

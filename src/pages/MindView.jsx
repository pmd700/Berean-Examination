import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsActiveTab } from '@/lib/WorkspaceTabs';
import { desktopClient } from '@/api/desktopClient';
import { useAuth } from '@/lib/AuthContext';
import { webDeepLink, noteDeepLink } from '@/utils';
import { confirmDialog } from '@/components/ui/confirm-dialog';
import { LoadingScreen } from '../components/ui/loading-screen';
import {
  Network, NotebookPen, ArrowLeft, ExternalLink, Lock, RotateCcw,
  Search, SlidersHorizontal, X,
} from 'lucide-react';
import MindMapToolbar, { MIND_TOOLS } from '../components/knowledgeweb/MindMapToolbar';
import useKeybinds from '../components/knowledgeweb/useKeybinds';
import KeybindRemapModal from '../components/knowledgeweb/KeybindRemapModal';
import NameInputModal from '../components/knowledgeweb/NameInputModal';

// Spec default shortcuts for the Mind View tools (remappable via useKeybinds).
const MINDMAP_DEFAULT_KEYS = { connect: '1', web: '2', note: '3', point: '7', erase: '8', hand: '`' };

// ── Force simulation defaults ───────────────────────────────────────
// Tuned for the macro graph (typically dozens to low-hundreds of nodes).
// The simulation is a lightweight O(n^2) spring-electrical layout run on a
// requestAnimationFrame loop with a cooling `alpha`. It is intentionally
// dependency-free (no d3/cytoscape installed in this project). The three
// user-tunable forces below are seeded here and then driven live via refs
// from the Force-controls sliders.
const DEFAULT_REPULSION = 9000;     // node-node electrostatic push
const DEFAULT_SPRING_LENGTH = 150;  // rest length of an edge
const DEFAULT_CENTER_K = 0.012;     // pull to origin so the graph stays put
const SPRING_K = 0.015;             // edge stiffness (fixed)
const DAMPING = 0.82;               // velocity decay per tick (fixed)
const MIN_ALPHA = 0.006;            // below this the sim is considered settled
const ALPHA_DECAY = 0.985;          // per-tick cooling

const MIN_R = 16;
const MAX_R = 46;

// On-brand palette for "color by group" (no orange/amber per design system).
const GROUP_PALETTE = [
  '#7C5CB7', '#C9A94E', '#A8B2C1', '#4E9AC9',
  '#4EC9A9', '#9A4E8C', '#5C7CB7', '#B79A5C',
];

function nodeKey(type, id) {
  return `${type}:${id}`;
}

// Map a connection weight to a node radius using a sqrt curve so a few
// very-connected hubs don't dwarf everything else.
function radiusForWeight(weight) {
  const r = MIN_R + Math.sqrt(weight) * 6;
  return Math.max(MIN_R, Math.min(MAX_R, r));
}

function nodeWeight(n) {
  return n.type === 'web' ? n.internal + n.degree : n.degree;
}

// Deterministic group → palette colour so the same category always renders
// the same hue across reloads.
function colorForGroup(group) {
  if (!group) return null;
  let h = 0;
  for (let i = 0; i < group.length; i++) h = (h * 31 + group.charCodeAt(i)) >>> 0;
  return GROUP_PALETTE[h % GROUP_PALETTE.length];
}

// Undirected pair key for aggregating parallel links into a weight.
function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// ── Pure graph splice helpers ───────────────────────────────────────
// Shared by the live mutators and the undo stack so creating/removing an
// edge or node always recomputes parallel-link weights and node degrees
// the same way. Each returns a NEW graph object (never mutates `g`).
function addEdgeToGraph(g, edge) {
  if (g.edges.some((e) => e.id === edge.id)) return g;
  const edges = [...g.edges, edge];
  const cnt = edges.filter((e) => e.pk === edge.pk).length;
  edges.forEach((e) => { if (e.pk === edge.pk) e.weight = cnt; });
  const nodes = g.nodes.map((n) =>
    (n.key === edge.source || n.key === edge.target) ? { ...n, degree: n.degree + 1 } : n);
  return { nodes, edges };
}

function removeEdgeFromGraph(g, edgeId) {
  const edge = g.edges.find((e) => e.id === edgeId);
  if (!edge) return g;
  const edges = g.edges.filter((e) => e.id !== edgeId);
  const cnt = edges.filter((e) => e.pk === edge.pk).length;
  edges.forEach((e) => { if (e.pk === edge.pk) e.weight = Math.max(1, cnt); });
  const nodes = g.nodes.map((n) =>
    (n.key === edge.source || n.key === edge.target) ? { ...n, degree: Math.max(0, n.degree - 1) } : n);
  return { nodes, edges };
}

function removeNodeFromGraph(g, key) {
  const degDelta = new Map();
  g.edges.forEach((e) => {
    if (e.source === key) degDelta.set(e.target, (degDelta.get(e.target) || 0) + 1);
    else if (e.target === key) degDelta.set(e.source, (degDelta.get(e.source) || 0) + 1);
  });
  const edges = g.edges.filter((e) => e.source !== key && e.target !== key);
  const nodes = g.nodes.filter((n) => n.key !== key).map((n) => {
    const d = degDelta.get(n.key);
    return d ? { ...n, degree: Math.max(0, n.degree - d) } : n;
  });
  return { nodes, edges };
}

export default function MindView() {
  const navigate = useNavigate();
  // Background tabs stay mounted; only the visible one may redirect.
  const isActiveTab = useIsActiveTab();
  const { isAuthenticated, isLoadingAuth } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [graph, setGraph] = useState({ nodes: [], edges: [] });
  const [focusKey, setFocusKey] = useState(null);
  const [selectedKey, setSelectedKey] = useState(null);
  const [hoverKey, setHoverKey] = useState(null);

  // ── Micro-feature controls ──
  const [panelOpen, setPanelOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState({ web: true, note: true });
  const [tagFilter, setTagFilter] = useState(() => new Set());
  const [showOrphans, setShowOrphans] = useState(true);
  const [showArrows, setShowArrows] = useState(false);
  const [colorByGroup, setColorByGroup] = useState(false);
  const [depth, setDepth] = useState(1);

  // ── Editing tools (T004) ──
  // `mode` is the active interaction tool: point (default), connect, erase or
  // hand. modeRef mirrors it so the long-lived pointer handlers read the
  // latest value without being re-created on every mode switch.
  const [mode, setMode] = useState('point');
  const modeRef = useRef('point');
  useEffect(() => { modeRef.current = mode; }, [mode]);
  // Live "noodle" while dragging a connect gesture (world coords).
  const [tempLine, setTempLine] = useState(null);
  const connectRef = useRef(null);
  // Snapshot of the current visible nodes for O(1)-ish hit testing inside
  // pointer handlers without adding render-time deps to useCallback.
  const visibleNodesRef = useRef([]);
  const editHandlersRef = useRef({});
  const [showRemap, setShowRemap] = useState(false);

  // ── Undo stack (Cmd/Ctrl+Z) ──
  // A LIFO list of async inverse closures. Each reversible edit (create
  // link / web / note, erase link) pushes a closure that undoes it.
  // Destructive NODE deletes are intentionally NOT undoable (their confirm
  // dialog already says "cannot be undone"), so Ctrl+Z never silently tries
  // to resurrect a web and all its cards.
  const undoStackRef = useRef([]);
  const undoBusyRef = useRef(false);

  // ── In-app naming dialog (replaces window.prompt) ──
  // `{ kind: 'web' | 'note' }` while open, else null.
  const [nameModal, setNameModal] = useState(null);

  // Remappable, persisted keybinds for the Mind View scope.
  const { binds: keybinds, setBind, resetBinds, keyToTool } = useKeybinds('mindmap', MINDMAP_DEFAULT_KEYS);
  const keyToToolRef = useRef(keyToTool);
  useEffect(() => { keyToToolRef.current = keyToTool; }, [keyToTool]);

  // Force-control sliders (drive the sim via refs).
  const [repel, setRepel] = useState(DEFAULT_REPULSION);
  const [linkDist, setLinkDist] = useState(DEFAULT_SPRING_LENGTH);
  const [centerForce, setCenterForce] = useState(DEFAULT_CENTER_K);
  const repelRef = useRef(repel);
  const linkDistRef = useRef(linkDist);
  const centerRef = useRef(centerForce);

  // View transform (pan/zoom). Applied to the SVG content group.
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const transformRef = useRef(transform);
  useEffect(() => { transformRef.current = transform; }, [transform]);

  const containerRef = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  // Live simulation node store (keyed by node key). Holds x/y/vx/vy and is
  // mutated in place each tick; React re-renders are driven by a tick bump.
  const simRef = useRef(new Map());
  const alphaRef = useRef(1);
  const rafRef = useRef(null);
  const [, bumpTick] = useState(0);

  // Drag state for nodes and for panning the background.
  const dragRef = useRef(null);  // { key, moved, startX, startY }
  const panRef = useRef(null);   // { startX, startY, origX, origY }

  // Tracks the currently-attached window pointer listeners so they can be
  // force-removed if the component unmounts mid-drag (e.g. route change while
  // the pointer is down). Without this, the handlers would outlive the page
  // and fire setState on an unmounted component.
  const activePointerRef = useRef(null); // { onMove, onUp }
  useEffect(() => () => {
    const a = activePointerRef.current;
    if (a) {
      window.removeEventListener('pointermove', a.onMove);
      window.removeEventListener('pointerup', a.onUp);
      activePointerRef.current = null;
    }
  }, []);

  // ── Load aggregate graph ──
  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) { if (isActiveTab) navigate('/'); return; }
    let cancelled = false;
    (async () => {
      try {
        const [webRows, noteRows, links, cards, connections] = await Promise.all([
          desktopClient.entities.KnowledgeWeb.list('sort_order', 1000),
          desktopClient.entities.MindNote.list('sort_order', 1000),
          desktopClient.entities.MindLink.list('-updated_date', 5000),
          desktopClient.entities.WebCard.list('-updated_date', 5000),
          desktopClient.entities.WebConnection.list('-updated_date', 5000),
        ]);
        const cardCounts = new Map();
        const connectionCounts = new Map();
        cards.forEach(card => cardCounts.set(card.web_id, (cardCounts.get(card.web_id) || 0) + 1));
        connections.forEach(connection => {
          connectionCounts.set(
            connection.web_id,
            (connectionCounts.get(connection.web_id) || 0) + 1,
          );
        });
        const data = {
          webs: webRows.map(web => ({
            ...web,
            card_count: cardCounts.get(web.id) || 0,
            connection_count: connectionCounts.get(web.id) || 0,
          })),
          notes: noteRows.map(note => ({
            ...note,
            preview: String(note.content || '').replace(/<[^>]+>/g, ' ').slice(0, 240),
          })),
          links,
        };
        if (cancelled) return;

        const nodes = [];
        const nodeByKey = new Map();
        (data.webs || []).forEach((w) => {
          const n = {
            key: nodeKey('web', w.id),
            type: 'web',
            id: w.id,
            label: w.title || 'Untitled Web',
            isPrivate: !!w.is_private,
            internal: w.connection_count || 0,
            cardCount: w.card_count || 0,
            color: null,
            group: null,
            tags: [],
            preview: '',
            degree: 0,
          };
          nodes.push(n);
          nodeByKey.set(n.key, n);
        });
        (data.notes || []).forEach((nt) => {
          const n = {
            key: nodeKey('note', nt.id),
            type: 'note',
            id: nt.id,
            label: nt.title || 'Untitled Note',
            isPrivate: false,
            internal: 0,
            cardCount: 0,
            color: nt.color || null,
            group: nt.group_label || null,
            tags: Array.isArray(nt.tags) ? nt.tags : [],
            preview: nt.preview || '',
            degree: 0,
          };
          nodes.push(n);
          nodeByKey.set(n.key, n);
        });

        const edges = [];
        const pairCount = new Map();
        (data.links || []).forEach((l) => {
          const sk = nodeKey(l.from_type, l.from_id);
          const tk = nodeKey(l.to_type, l.to_id);
          const s = nodeByKey.get(sk);
          const t = nodeByKey.get(tk);
          if (!s || !t) return; // drop edges with a missing endpoint
          const pk = pairKey(sk, tk);
          pairCount.set(pk, (pairCount.get(pk) || 0) + 1);
          edges.push({ id: l.id, source: sk, target: tk, label: l.label || '', color: l.color || null, pk });
          s.degree += 1;
          t.degree += 1;
        });
        // Stamp each edge with its pair weight (parallel-link multiplicity).
        edges.forEach((e) => { e.weight = pairCount.get(e.pk) || 1; });

        // Seed simulation positions on a circle so the first frames expand
        // outward smoothly instead of from a single overlapping point.
        const sim = new Map();
        const R0 = Math.max(120, nodes.length * 8);
        nodes.forEach((n, i) => {
          const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
          sim.set(n.key, {
            x: Math.cos(a) * R0 + (Math.random() - 0.5) * 40,
            y: Math.sin(a) * R0 + (Math.random() - 0.5) * 40,
            vx: 0, vy: 0,
          });
        });
        simRef.current = sim;
        alphaRef.current = 1;

        setGraph({ nodes, edges });
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || 'Failed to load Mind View.');
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [isLoadingAuth, isAuthenticated, navigate]);

  // ── Track container size ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const apply = () => {
      const rect = el.getBoundingClientRect();
      setSize((prev) => (prev.w === rect.width && prev.h === rect.height
        ? prev
        : { w: rect.width, h: rect.height }));
    };
    // Defer the measurement out of the ResizeObserver callback with rAF so a
    // size change that triggers a re-layout can't synchronously feed back into
    // the same observer tick — that feedback is what throws the browser's
    // "ResizeObserver loop completed with undelivered notifications" error
    // (dispatched as a window error event with a null error object). The flex
    // sidebar layout makes that loop easy to hit, so we debounce via rAF.
    let raf = 0;
    apply();
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(apply);
    });
    ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [loading]);

  // Key → node lookup so edge rendering can resolve target radius in O(1)
  // instead of scanning all nodes per edge per frame.
  const nodeByKey = useMemo(() => {
    const m = new Map();
    graph.nodes.forEach((n) => m.set(n.key, n));
    return m;
  }, [graph]);

  // Adjacency for focus mode + hover highlighting.
  const adjacency = useMemo(() => {
    const m = new Map();
    graph.nodes.forEach((n) => m.set(n.key, new Set()));
    graph.edges.forEach((e) => {
      m.get(e.source)?.add(e.target);
      m.get(e.target)?.add(e.source);
    });
    return m;
  }, [graph]);

  // All tags present across notes (for the tag filter UI).
  const allTags = useMemo(() => {
    const s = new Set();
    graph.nodes.forEach((n) => (n.tags || []).forEach((t) => s.add(t)));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [graph]);

  // Groups present (for the color-by-group legend).
  const allGroups = useMemo(() => {
    const s = new Set();
    graph.nodes.forEach((n) => { if (n.group) s.add(n.group); });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [graph]);

  // BFS from the focus node out to `depth` hops.
  const focusSet = useMemo(() => {
    if (!focusKey) return null; // null => no focus restriction
    const seen = new Set([focusKey]);
    let frontier = [focusKey];
    for (let d = 0; d < depth; d++) {
      const next = [];
      frontier.forEach((k) => {
        (adjacency.get(k) || new Set()).forEach((nb) => {
          if (!seen.has(nb)) { seen.add(nb); next.push(nb); }
        });
      });
      frontier = next;
      if (frontier.length === 0) break;
    }
    return seen;
  }, [focusKey, depth, adjacency]);

  // Combined filter set (search + type + tag + orphans), independent of focus.
  const filteredKeys = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hasTagFilter = tagFilter.size > 0;
    const s = new Set();
    graph.nodes.forEach((n) => {
      if (!typeFilter[n.type]) return;
      if (q && !n.label.toLowerCase().includes(q)) return;
      if (hasTagFilter) {
        // Only tagged nodes (notes) can satisfy a tag filter; webs have none.
        if (!(n.tags && n.tags.some((t) => tagFilter.has(t)))) return;
      }
      if (!showOrphans && n.degree === 0) return;
      s.add(n.key);
    });
    return s;
  }, [graph, query, typeFilter, tagFilter, showOrphans]);

  // Final visible key set: filters ∩ focus neighbourhood.
  const visibleKeys = useMemo(() => {
    const s = new Set();
    filteredKeys.forEach((k) => {
      if (!focusSet || focusSet.has(k)) s.add(k);
    });
    return s;
  }, [filteredKeys, focusSet]);

  // ── Simulation loop ──
  const startSim = useCallback(() => {
    if (rafRef.current) return;
    const step = () => {
      const sim = simRef.current;
      const nodes = graph.nodes;
      const edges = graph.edges;
      const alpha = alphaRef.current;
      const REPULSION = repelRef.current;
      const SPRING_LENGTH = linkDistRef.current;
      const CENTER_K = centerRef.current;

      if (nodes.length === 0 || alpha < MIN_ALPHA) {
        rafRef.current = null;
        return;
      }

      // Repulsion (every pair).
      for (let i = 0; i < nodes.length; i++) {
        const a = sim.get(nodes[i].key);
        if (!a) continue;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = sim.get(nodes[j].key);
          if (!b) continue;
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { d2 = 1; dx = Math.random() - 0.5; dy = Math.random() - 0.5; }
          const dist = Math.sqrt(d2);
          const f = (REPULSION / d2) * alpha;
          const fx = (dx / dist) * f;
          const fy = (dy / dist) * f;
          a.vx += fx; a.vy += fy;
          b.vx -= fx; b.vy -= fy;
        }
      }

      // Springs (edges).
      edges.forEach((e) => {
        const a = sim.get(e.source);
        const b = sim.get(e.target);
        if (!a || !b) return;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (dist - SPRING_LENGTH) * SPRING_K * alpha;
        const fx = (dx / dist) * f;
        const fy = (dy / dist) * f;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      });

      // Centering + integration.
      nodes.forEach((n) => {
        const p = sim.get(n.key);
        if (!p) return;
        if (dragRef.current && dragRef.current.key === n.key) return; // pinned
        p.vx += -p.x * CENTER_K * alpha;
        p.vy += -p.y * CENTER_K * alpha;
        p.vx *= DAMPING;
        p.vy *= DAMPING;
        p.x += p.vx;
        p.y += p.vy;
      });

      alphaRef.current = alpha * ALPHA_DECAY;
      bumpTick((t) => (t + 1) % 1000000);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [graph]);

  const reheat = useCallback((a = 0.6) => {
    alphaRef.current = Math.max(alphaRef.current, a);
    startSim();
  }, [startSim]);

  useEffect(() => {
    startSim();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [startSim]);

  // While focused, refit the view when the depth slider expands/contracts the
  // visible neighbourhood so the new hops stay in frame.
  useEffect(() => {
    if (!focusKey || loading) return;
    const t = setTimeout(() => fitView(visibleKeys), 60);
    return () => clearTimeout(t);
  }, [depth]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mirror force-slider state into refs and reheat so changes take effect live.
  useEffect(() => { repelRef.current = repel; reheat(0.4); }, [repel, reheat]);
  useEffect(() => { linkDistRef.current = linkDist; reheat(0.4); }, [linkDist, reheat]);
  useEffect(() => { centerRef.current = centerForce; reheat(0.4); }, [centerForce, reheat]);

  // ── Fit the view to the visible nodes ──
  const fitView = useCallback((keysSet) => {
    const sim = simRef.current;
    const pts = [];
    graph.nodes.forEach((n) => {
      if (keysSet && !keysSet.has(n.key)) return;
      const p = sim.get(n.key);
      if (p) pts.push(p);
    });
    if (pts.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach((p) => {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    });
    const pad = 90;
    const gw = (maxX - minX) + pad * 2;
    const gh = (maxY - minY) + pad * 2;
    const scale = Math.max(0.25, Math.min(1.6, Math.min(size.w / gw, size.h / gh)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setTransform({
      x: size.w / 2 - cx * scale,
      y: size.h / 2 - cy * scale,
      scale,
    });
  }, [graph, size]);

  // Auto-fit once the first layout has cooled a bit on initial load.
  const didInitialFit = useRef(false);
  useEffect(() => {
    if (loading || didInitialFit.current || graph.nodes.length === 0) return;
    const t = setTimeout(() => {
      fitView(null);
      didInitialFit.current = true;
    }, 700);
    return () => clearTimeout(t);
  }, [loading, graph, fitView]);

  // ── Pointer helpers ──
  const screenToWorld = useCallback((sx, sy) => {
    const tr = transformRef.current;
    return { x: (sx - tr.x) / tr.scale, y: (sy - tr.y) / tr.scale };
  }, []);

  const openNode = useCallback((node) => {
    if (!node) return;
    if (node.type === 'web') {
      navigate(webDeepLink(node.id, node.is_private ? null : (node.title || node.label)));
    } else {
      navigate(noteDeepLink(node.id, node.title || node.label));
    }
  }, [navigate]);

  const onNodePointerDown = useCallback((e, node) => {
    e.stopPropagation();
    e.preventDefault();
    // Tool-aware dispatch. The handlers live in editHandlersRef (assigned each
    // render) so this callback never needs them as deps / never goes stale.
    const m = modeRef.current;
    if (m === 'erase') { editHandlersRef.current.eraseNode?.(node); return; }
    if (m === 'connect') { editHandlersRef.current.startConnect?.(e, node); return; }
    if (m === 'hand') { editHandlersRef.current.onBgPointerDown?.(e); return; }
    // point (default): drag the node, or click to open it.
    dragRef.current = { key: node.key, moved: false, startX: e.clientX, startY: e.clientY };

    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      if (Math.abs(ev.clientX - d.startX) > 3 || Math.abs(ev.clientY - d.startY) > 3) {
        d.moved = true;
      }
      const p = simRef.current.get(node.key);
      if (p) {
        const rect = containerRef.current.getBoundingClientRect();
        const w = screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top);
        p.x = w.x; p.y = w.y; p.vx = 0; p.vy = 0;
        reheat(0.3);
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      activePointerRef.current = null;
      if (d && !d.moved) {
        // Plain click (not a drag) opens the node's Knowledge Web or Mind
        // Note. Focused/local mode is a separate gesture (right-click) so the
        // two interactions don't conflict.
        openNode(node);
      }
    };
    activePointerRef.current = { onMove, onUp };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [openNode, reheat, screenToWorld]);

  // Right-click (context menu) selects a node and enters Focused/local mode:
  // the graph filters to that node plus its neighbours (out to the depth
  // slider). A "Back to global" control returns to the full view.
  const enterFocus = useCallback((node) => {
    setSelectedKey(node.key);
    setFocusKey(node.key);
    const seen = new Set([node.key]);
    let frontier = [node.key];
    for (let d = 0; d < depth; d++) {
      const next = [];
      frontier.forEach((k) => {
        (adjacency.get(k) || new Set()).forEach((nb) => {
          if (!seen.has(nb)) { seen.add(nb); next.push(nb); }
        });
      });
      frontier = next;
      if (frontier.length === 0) break;
    }
    setTimeout(() => fitView(seen), 30);
    reheat(0.3);
  }, [adjacency, depth, fitView, reheat]);

  const onNodeContextMenu = useCallback((e, node) => {
    e.preventDefault();
    e.stopPropagation();
    enterFocus(node);
  }, [enterFocus]);

  const onNodeDoubleClick = useCallback((e, node) => {
    e.stopPropagation();
    openNode(node);
  }, [openNode]);

  // Background pan.
  const onBgPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    const tr = transformRef.current;
    panRef.current = { startX: e.clientX, startY: e.clientY, origX: tr.x, origY: tr.y, moved: false };
    const onMove = (ev) => {
      const pan = panRef.current;
      if (!pan) return;
      pan.moved = true;
      setTransform((t) => ({ ...t, x: pan.origX + (ev.clientX - pan.startX), y: pan.origY + (ev.clientY - pan.startY) }));
    };
    const onUp = () => {
      panRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      activePointerRef.current = null;
    };
    activePointerRef.current = { onMove, onUp };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  // Wheel zoom toward the cursor.
  const onWheel = useCallback((e) => {
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setTransform((t) => {
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const newScale = Math.max(0.15, Math.min(3, t.scale * factor));
      // Keep the point under the cursor stationary.
      const wx = (sx - t.x) / t.scale;
      const wy = (sy - t.y) / t.scale;
      return { scale: newScale, x: sx - wx * newScale, y: sy - wy * newScale };
    });
  }, []);

  // Attach the wheel handler natively so preventDefault actually blocks the
  // browser's page zoom (React onWheel is passive).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel, loading]);

  const backToGlobal = useCallback(() => {
    setFocusKey(null);
    setSelectedKey(null);
    setTimeout(() => fitView(filteredKeys.size ? filteredKeys : null), 30);
    reheat(0.4);
  }, [fitView, filteredKeys, reheat]);

  const toggleTag = useCallback((tag) => {
    setTagFilter((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  }, []);

  const resetForces = useCallback(() => {
    setRepel(DEFAULT_REPULSION);
    setLinkDist(DEFAULT_SPRING_LENGTH);
    setCenterForce(DEFAULT_CENTER_K);
  }, []);

  // ── Editing helpers (connect / erase / create) ──
  const parseKey = (key) => {
    const i = key.indexOf(':');
    return { type: key.slice(0, i), id: key.slice(i + 1) };
  };

  // Hit-test the topmost visible node at a world coordinate (reads a ref so
  // it carries no render-time deps).
  const findNodeAtWorld = useCallback((wx, wy) => {
    const vis = visibleNodesRef.current;
    for (let i = vis.length - 1; i >= 0; i--) {
      const n = vis[i];
      const p = simRef.current.get(n.key);
      if (!p) continue;
      const r = radiusForWeight(nodeWeight(n)) + 6;
      const dx = wx - p.x, dy = wy - p.y;
      if (dx * dx + dy * dy <= r * r) return n;
    }
    return null;
  }, []);

  // Push an inverse closure onto the undo stack (capped so it can't grow
  // without bound during a long editing session).
  const pushUndo = useCallback((fn) => {
    undoStackRef.current.push(fn);
    if (undoStackRef.current.length > 60) undoStackRef.current.shift();
  }, []);

  // Pop and run the most recent inverse. Re-entrancy guarded so holding
  // Ctrl+Z can't fire overlapping API calls.
  const performUndo = useCallback(async () => {
    if (undoBusyRef.current) return;
    const fn = undoStackRef.current.pop();
    if (!fn) return;
    undoBusyRef.current = true;
    try {
      await fn();
    } catch (e) {
      setError(e?.message || 'Undo failed.');
    } finally {
      undoBusyRef.current = false;
    }
  }, []);

  // Create a macro link between two nodes and splice it into the graph.
  const createLink = useCallback(async (srcKey, tgtKey) => {
    const a = parseKey(srcKey);
    const b = parseKey(tgtKey);
    try {
      const link = await desktopClient.entities.MindLink.create({
        from_type: a.type,
        from_id: Number(a.id),
        to_type: b.type,
        to_id: Number(b.id),
      });
      if (!link || link.id == null) throw new Error('Link creation returned no id.');
      const pk = pairKey(srcKey, tgtKey);
      setGraph((g) => addEdgeToGraph(g, {
        id: link.id, source: srcKey, target: tgtKey,
        label: link.label || '', color: link.color || null, pk, weight: 1,
      }));
      reheat(0.3);
      // Undo = delete the link we just created.
      pushUndo(async () => {
        await desktopClient.entities.MindLink.delete(link.id);
        setGraph((g) => removeEdgeFromGraph(g, link.id));
        reheat(0.2);
      });
    } catch (e) {
      setError(e?.message || 'Failed to create link.');
    }
  }, [reheat, pushUndo]);

  // Begin a connect "noodle" from a source node; on drop over a target node,
  // create the link. A single straight center-to-center line — intentionally
  // far simpler than the Knowledge Web's 4-side routing.
  const startConnect = useCallback((e, node) => {
    const sp = simRef.current.get(node.key);
    if (!sp) return;
    connectRef.current = { sourceKey: node.key };
    setTempLine({ x1: sp.x, y1: sp.y, x2: sp.x, y2: sp.y });
    const onMove = (ev) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const w = screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top);
      setTempLine((tl) => (tl ? { ...tl, x2: w.x, y2: w.y } : null));
    };
    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      activePointerRef.current = null;
      const rect = containerRef.current?.getBoundingClientRect();
      const src = connectRef.current?.sourceKey;
      connectRef.current = null;
      setTempLine(null);
      if (!rect || !src) return;
      const w = screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top);
      const target = findNodeAtWorld(w.x, w.y);
      if (target && target.key !== src) createLink(src, target.key);
    };
    activePointerRef.current = { onMove, onUp };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [screenToWorld, findNodeAtWorld, createLink]);

  // Delete a single link (used by the erase tool clicking an edge).
  const eraseLink = useCallback(async (edge) => {
    try {
      await desktopClient.entities.MindLink.delete(edge.id);
      setGraph((g) => removeEdgeFromGraph(g, edge.id));
      reheat(0.2);
      // Undo = recreate the link between the same two endpoints. The
      // recreated link gets a fresh server id (the old one is gone).
      const srcKey = edge.source, tgtKey = edge.target;
      pushUndo(async () => {
        const a = parseKey(srcKey);
        const b = parseKey(tgtKey);
        const link = await desktopClient.entities.MindLink.create({
          from_type: a.type,
          from_id: Number(a.id),
          to_type: b.type,
          to_id: Number(b.id),
        });
        if (!link || link.id == null) throw new Error('Could not restore link.');
        setGraph((g) => addEdgeToGraph(g, {
          id: link.id, source: srcKey, target: tgtKey,
          label: link.label || '', color: link.color || null,
          pk: pairKey(srcKey, tgtKey), weight: 1,
        }));
        reheat(0.2);
      });
    } catch (e) {
      setError(e?.message || 'Failed to delete link.');
    }
  }, [reheat, pushUndo]);

  // Delete a node. Webs are destructive (whole web + cards) so the confirm
  // copy spells that out; notes are a lighter confirm.
  const eraseNode = useCallback(async (node) => {
    const isWeb = node.type === 'web';
    const ok = await confirmDialog({
      title: isWeb
        ? `Delete the Knowledge Web "${node.label}"?`
        : `Delete the Mind Note "${node.label}"?`,
      description: isWeb
        ? 'This permanently removes the web AND all of its cards and connections. This cannot be undone.'
        : 'This permanently deletes the note. This cannot be undone.',
      confirmText: isWeb ? 'Delete web' : 'Delete note',
      cancelText: 'Keep',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const entity = isWeb ? desktopClient.entities.KnowledgeWeb : desktopClient.entities.MindNote;
      await entity.delete(node.id);
      setGraph((g) => removeNodeFromGraph(g, node.key));
      simRef.current.delete(node.key);
      setSelectedKey((k) => (k === node.key ? null : k));
      setFocusKey((k) => (k === node.key ? null : k));
      setHoverKey((k) => (k === node.key ? null : k));
      reheat(0.3);
    } catch (e) {
      setError(e?.message || 'Failed to delete.');
    }
  }, [reheat]);

  // Drop a freshly-created node near the centre of the current viewport.
  const addNodeToGraph = useCallback((node) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const tr = transformRef.current;
    const cw = rect?.width || size.w;
    const ch = rect?.height || size.h;
    const cx = (cw / 2 - tr.x) / tr.scale;
    const cy = (ch / 2 - tr.y) / tr.scale;
    simRef.current.set(node.key, {
      x: cx + (Math.random() - 0.5) * 60,
      y: cy + (Math.random() - 0.5) * 60,
      vx: 0, vy: 0,
    });
    setGraph((g) => (g.nodes.some((n) => n.key === node.key) ? g : { nodes: [...g.nodes, node], edges: g.edges }));
    reheat(0.5);
  }, [reheat, size.w, size.h]);

  // ── Sidebar ⇄ graph sync ──
  // Build graph nodes from raw web / note rows exactly the way the initial
  // loader does, so a node added via the sidebar looks identical to one loaded
  // from the local library.
  // Actually create the entity (web or note) once the naming dialog has
  // returned a title. Adds the node to the graph and registers an undo that
  // removes the freshly-created entity again.
  const performCreate = useCallback(async (kind, rawTitle) => {
    const title = (rawTitle || '').trim();
    try {
      if (kind === 'web') {
        const web = await desktopClient.entities.KnowledgeWeb.create({
          title: title || 'Untitled Web',
        });
        if (!web || web.id == null) throw new Error('Web creation failed.');
        const key = nodeKey('web', web.id);
        addNodeToGraph({
          key, type: 'web', id: web.id,
          label: web.title || 'Untitled Web', isPrivate: !!web.is_private, internal: 0, cardCount: 0,
          color: null, group: null, tags: [], preview: '', degree: 0,
        });
        pushUndo(async () => {
          await desktopClient.entities.KnowledgeWeb.delete(web.id);
          setGraph((g) => removeNodeFromGraph(g, key));
          simRef.current.delete(key);
          reheat(0.2);
        });
      } else {
        const note = await desktopClient.entities.MindNote.create({
          title: title || 'Untitled Note',
          content: '',
          tags: [],
        });
        if (!note || note.id == null) throw new Error('Note creation failed.');
        const key = nodeKey('note', note.id);
        addNodeToGraph({
          key, type: 'note', id: note.id,
          label: note.title || 'Untitled Note', isPrivate: false, internal: 0, cardCount: 0,
          color: note.color || null, group: note.group_label || null,
          tags: Array.isArray(note.tags) ? note.tags : [], preview: '', degree: 0,
        });
        pushUndo(async () => {
          await desktopClient.entities.MindNote.delete(note.id);
          setGraph((g) => removeNodeFromGraph(g, key));
          simRef.current.delete(key);
          reheat(0.2);
        });
      }
    } catch (e) {
      setError(e?.message || 'Failed to create.');
    }
  }, [addNodeToGraph, pushUndo, reheat]);

  // Tool entry points just open the in-app naming dialog; performCreate runs
  // on confirm.
  const createNote = useCallback(() => setNameModal({ kind: 'note' }), []);
  const createWeb = useCallback(() => setNameModal({ kind: 'web' }), []);

  // Keyboard shortcuts: switch tool / trigger create actions. Bindings come
  // from the remappable keymap (keyToToolRef). Ignored while typing in a
  // field or while the remap modal is capturing keys.
  useEffect(() => {
    const onKey = (e) => {
      if (showRemap) return;
      const t = e.target;
      const tag = t?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable;
      // Cmd/Ctrl+Z → undo the last reversible edit. (Shift+Cmd+Z / redo is
      // intentionally not supported.) Checked BEFORE the modifier early-return
      // below, and skipped while typing so it doesn't hijack field undo.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
        if (e.shiftKey || typing) return;
        e.preventDefault();
        performUndo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (typing) return;
      const k = e.key === ' ' ? 'space' : e.key.toLowerCase();
      const tool = keyToToolRef.current[k];
      if (!tool) return;
      e.preventDefault();
      if (tool === 'web') { createWeb(); return; }
      if (tool === 'note') { createNote(); return; }
      // point / connect / erase / hand
      setMode(tool);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showRemap, createWeb, createNote, performUndo]);

  const selectedNode = useMemo(
    () => graph.nodes.find((n) => n.key === selectedKey) || null,
    [graph, selectedKey],
  );

  // Hover neighbourhood: hovered node + its direct neighbours.
  const hoverSet = useMemo(() => {
    if (!hoverKey) return null;
    const s = new Set([hoverKey]);
    (adjacency.get(hoverKey) || new Set()).forEach((k) => s.add(k));
    return s;
  }, [hoverKey, adjacency]);

  if (loading) return <LoadingScreen />;

  const sim = simRef.current;
  const visibleNodes = graph.nodes.filter((n) => visibleKeys.has(n.key));
  const visibleEdges = graph.edges.filter(
    (e) => visibleKeys.has(e.source) && visibleKeys.has(e.target),
  );

  // Keep pointer-handler refs current each render so the long-lived
  // onNodePointerDown dispatch (and connect hit-testing) always see the
  // latest handlers/visible set without re-binding listeners.
  visibleNodesRef.current = visibleNodes;
  editHandlersRef.current = { startConnect, eraseNode, onBgPointerDown };

  // Labels fade in as you zoom in so the graph stays legible when zoomed out.
  const labelOpacity = Math.max(0, Math.min(1, (transform.scale - 0.45) / 0.4));
  const showLabelsBase = labelOpacity > 0.02;

  const fillForNode = (n) => {
    if (colorByGroup) {
      return colorForGroup(n.group) || (n.type === 'web' ? '#6B4C9A' : '#5A6473');
    }
    return n.type === 'web' ? '#6B4C9A' : (n.color || '#A8B2C1');
  };

  // ── Hover preview popup geometry ──
  // Resolve the hovered node and its on-screen position so the mini preview
  // card can float beside it. Recomputed each sim tick so the card tracks the
  // node while the layout is still settling. The card itself is
  // pointer-events:none so it never steals the hover and flicker-loops.
  const hoveredNode = hoverKey ? graph.nodes.find((n) => n.key === hoverKey) : null;
  let hoverCard = null;
  if (hoveredNode && !dragRef.current && !panRef.current) {
    const hp = sim.get(hoveredNode.key);
    if (hp) {
      const scrX = transform.x + hp.x * transform.scale;
      const scrY = transform.y + hp.y * transform.scale;
      const nodeR = radiusForWeight(nodeWeight(hoveredNode)) * transform.scale;
      const CARD_W = 248;
      const placeLeft = scrX + nodeR + 16 + CARD_W > size.w;
      const left = placeLeft
        ? Math.max(8, scrX - nodeR - 16 - CARD_W)
        : scrX + nodeR + 16;
      const top = Math.max(8, Math.min(size.h - 150, scrY - 24));
      hoverCard = { node: hoveredNode, left, top, width: CARD_W };
    }
  }

  return (
    <div className="fixed inset-0 flex cyber-bg text-ink-muted overflow-hidden" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0 }}>
      {/* Mind View is now graph-only. Library navigation lives on New Tab. */}
      <div className="relative flex-1 min-w-0 overflow-hidden">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-20 px-5 py-4 flex items-center justify-between pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-2">
          <div>
          <h1 className="font-signature text-2xl text-gold flex items-center gap-2">
            <Network className="w-6 h-6 text-brand-strong" />
            Mind View
          </h1>
          <p className="text-xs text-ink-muted/60 mt-0.5">
            {visibleNodes.length} / {graph.nodes.length} nodes · {visibleEdges.length} links
          </p>
          </div>
        </div>
      </div>

      {/* Top-right controls — placed in their own container offset BELOW the
          fixed account pill (top-right) so the settings/Controls icon can
          never sit underneath it, regardless of the pill's width. */}
      <div className="absolute z-20 top-16 right-5 pointer-events-auto flex items-center gap-2">
        <button
          onClick={() => setPanelOpen((v) => !v)}
          className={`btn-metal text-xs px-3 py-2 flex items-center gap-1.5 ${panelOpen ? 'text-gold' : ''}`}
          data-testid="button-toggle-controls"
          title="Controls & filters"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" /> Controls
        </button>
        <button
          onClick={() => fitView(visibleKeys)}
          className="btn-metal text-xs px-3 py-2 flex items-center gap-1.5"
          data-testid="button-fit-view"
          title="Fit graph to view"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Fit
        </button>
        {focusKey && (
          <button
            onClick={backToGlobal}
            className="btn-metal text-xs px-3 py-2 flex items-center gap-1.5"
            data-testid="button-back-global"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to global
          </button>
        )}
      </div>

      {/* Controls / filters panel */}
      {panelOpen && (
        <div
          className="absolute z-30 top-28 right-5 w-72 max-h-[calc(100vh-9rem)] overflow-y-auto card-metal p-4 pointer-events-auto space-y-4"
          data-testid="panel-controls"
        >
          {/* Search */}
          <div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted/50" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search nodes by name…"
                className="input-metal w-full text-sm pl-8 pr-7 py-2"
                data-testid="input-search"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted/50 hover:text-ink-muted"
                  data-testid="button-clear-search"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Type filter */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-muted/50 mb-1.5">Node types</div>
            <div className="flex gap-2">
              {['web', 'note'].map((t) => (
                <button
                  key={t}
                  onClick={() => setTypeFilter((p) => ({ ...p, [t]: !p[t] }))}
                  className={`flex-1 text-xs px-2 py-1.5 rounded border transition-colors ${
                    typeFilter[t]
                      ? 'border-brand-strong bg-brand/20 text-white'
                      : 'border-ink-muted/20 text-ink-muted/50'
                  }`}
                  data-testid={`button-filter-type-${t}`}
                >
                  {t === 'web' ? 'Webs' : 'Notes'}
                </button>
              ))}
            </div>
          </div>

          {/* Tag filter */}
          {allTags.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] uppercase tracking-wider text-ink-muted/50">Tags</span>
                {tagFilter.size > 0 && (
                  <button
                    onClick={() => setTagFilter(new Set())}
                    className="text-[10px] text-gold hover:underline"
                    data-testid="button-clear-tags"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                      tagFilter.has(tag)
                        ? 'border-gold bg-gold/15 text-gold'
                        : 'border-ink-muted/20 text-ink-muted/60'
                    }`}
                    data-testid={`button-tag-${tag}`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Display toggles */}
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-ink-muted/50">Display</div>
            <ToggleRow label="Show orphan nodes" checked={showOrphans} onChange={setShowOrphans} testid="toggle-orphans" />
            <ToggleRow label="Directional arrows" checked={showArrows} onChange={setShowArrows} testid="toggle-arrows" />
            <ToggleRow label="Color by group" checked={colorByGroup} onChange={setColorByGroup} testid="toggle-color-group" />
          </div>

          {/* Depth slider (focus mode only) */}
          {focusKey && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider text-ink-muted/50">Neighbor depth</span>
                <span className="text-xs text-gold">{depth} hop{depth === 1 ? '' : 's'}</span>
              </div>
              <input
                type="range" min={1} max={4} step={1} value={depth}
                onChange={(e) => setDepth(Number(e.target.value))}
                className="w-full accent-brand-strong"
                data-testid="slider-depth"
              />
            </div>
          )}

          {/* Force controls */}
          <div className="space-y-3 pt-1 border-t border-ink-muted/15">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-ink-muted/50">Forces</span>
              <button
                onClick={resetForces}
                className="text-[10px] text-gold hover:underline"
                data-testid="button-reset-forces"
              >
                Reset
              </button>
            </div>
            <SliderRow
              label="Repel strength" value={repel} min={2000} max={20000} step={500}
              onChange={setRepel} testid="slider-repel"
            />
            <SliderRow
              label="Link distance" value={linkDist} min={60} max={320} step={10}
              onChange={setLinkDist} testid="slider-linkdist"
            />
            <SliderRow
              label="Spread / center" value={centerForce} min={0} max={0.05} step={0.002}
              onChange={setCenterForce} testid="slider-center"
              format={(v) => v.toFixed(3)}
            />
          </div>
        </div>
      )}

      {/* Selected-node info panel */}
      {selectedNode && (
        <div
          className="absolute z-20 left-5 bottom-5 card-metal p-4 w-72 pointer-events-auto"
          data-testid="panel-selected-node"
        >
          <div className="flex items-center gap-2 mb-1">
            {selectedNode.type === 'web'
              ? <Network className="w-4 h-4 text-brand-strong" />
              : <NotebookPen className="w-4 h-4 text-gold" />}
            <span className="text-[10px] uppercase tracking-wider text-ink-muted/60">
              {selectedNode.type === 'web' ? 'Knowledge Web' : 'Mind Note'}
            </span>
            {selectedNode.isPrivate && <Lock className="w-3 h-3 text-ink-muted/60" />}
          </div>
          <div className="font-signature text-lg text-white truncate" title={selectedNode.label}>
            {selectedNode.label}
          </div>
          <div className="text-xs text-ink-muted/60 mt-1">
            {selectedNode.degree} connection{selectedNode.degree === 1 ? '' : 's'}
            {selectedNode.type === 'web' && selectedNode.internal > 0
              ? ` · ${selectedNode.internal} internal` : ''}
            {selectedNode.group ? ` · ${selectedNode.group}` : ''}
          </div>
          {selectedNode.tags && selectedNode.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {selectedNode.tags.map((t) => (
                <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-ink-muted/10 text-ink-muted/70">
                  {t}
                </span>
              ))}
            </div>
          )}
          <button
            onClick={() => openNode(selectedNode)}
            className="btn-metal text-xs px-3 py-2 mt-3 w-full flex items-center justify-center gap-1.5"
            data-testid="button-open-node"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open {selectedNode.type === 'web' ? 'Web' : 'Note'}
          </button>
        </div>
      )}

      {error && (
        <div className="absolute z-20 inset-x-0 top-20 flex justify-center">
          <div className="card-metal px-4 py-2 text-sm text-red-400">{error}</div>
        </div>
      )}

      {graph.nodes.length === 0 && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-center px-6">
          <div>
            <Network className="w-10 h-10 text-brand-strong mx-auto mb-3 opacity-60" />
            <p className="text-ink-muted">Your Mind View is empty.</p>
            <p className="text-xs text-ink-muted/60 mt-1">
              Create Knowledge Webs and Mind Notes, then link them to see the map of your Second Brain.
            </p>
          </div>
        </div>
      )}

      {graph.nodes.length > 0 && visibleNodes.length === 0 && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-center px-6 pointer-events-none">
          <p className="text-sm text-ink-muted/60">No nodes match the current filters.</p>
        </div>
      )}

      {/* Graph canvas */}
      <svg
        ref={containerRef}
        className={`absolute inset-0 w-full h-full ${
          mode === 'connect' ? 'cursor-crosshair'
          : mode === 'erase' ? 'cursor-pointer'
          : 'cursor-grab active:cursor-grabbing'
        }`}
        onPointerDown={onBgPointerDown}
        data-testid="svg-mindview"
      >
        <defs>
          <marker
            id="mv-arrow"
            viewBox="0 0 10 10"
            refX="9" refY="5"
            markerWidth="7" markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#6E6890" />
          </marker>
        </defs>
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}>
          {/* Edges */}
          {visibleEdges.map((e) => {
            const a = sim.get(e.source);
            const b = sim.get(e.target);
            if (!a || !b) return null;
            const dimmed = hoverSet && !(hoverSet.has(e.source) && hoverSet.has(e.target));
            // When showing arrows, pull the endpoint back to the target node's
            // rim so the arrowhead sits just outside the node, not under it.
            let x2 = b.x, y2 = b.y;
            if (showArrows) {
              const tNode = nodeByKey.get(e.target);
              const tr = tNode ? radiusForWeight(nodeWeight(tNode)) : MIN_R;
              const dx = b.x - a.x, dy = b.y - a.y;
              const dist = Math.sqrt(dx * dx + dy * dy) || 1;
              x2 = b.x - (dx / dist) * (tr + 4);
              y2 = b.y - (dy / dist) * (tr + 4);
            }
            const w = 1 + Math.min(e.weight - 1, 5) * 0.9;
            return (
              <g key={e.id}>
                <line
                  x1={a.x} y1={a.y} x2={x2} y2={y2}
                  stroke={e.color || '#3A3550'}
                  strokeWidth={w}
                  strokeOpacity={dimmed ? 0.28 : 0.75}
                  markerEnd={showArrows ? 'url(#mv-arrow)' : undefined}
                />
                {/* Erase tool: fat invisible hit-line so links are easy to click. */}
                {mode === 'erase' && (
                  <line
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke="#FF5C5C"
                    strokeOpacity={0.001}
                    strokeWidth={14}
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(ev) => { ev.stopPropagation(); eraseLink(e); }}
                    data-testid={`erase-link-${e.id}`}
                  />
                )}
              </g>
            );
          })}

          {/* Live connect noodle (single straight center-to-center line). */}
          {tempLine && (
            <line
              x1={tempLine.x1} y1={tempLine.y1} x2={tempLine.x2} y2={tempLine.y2}
              stroke="#C9A94E"
              strokeWidth={2}
              strokeOpacity={0.85}
              strokeDasharray="6 5"
              style={{ pointerEvents: 'none' }}
            />
          )}

          {/* Nodes */}
          {visibleNodes.map((n) => {
            const p = sim.get(n.key);
            if (!p) return null;
            const r = radiusForWeight(nodeWeight(n));
            const isSel = n.key === selectedKey;
            const isHover = n.key === hoverKey;
            const dimmed = hoverSet && !hoverSet.has(n.key);
            const fill = fillForNode(n);
            const stroke = n.type === 'web' ? '#7C5CB7' : '#C9A94E';
            const showLabel = (showLabelsBase || isHover || isSel);
            const thisLabelOpacity = (isHover || isSel) ? 1 : labelOpacity;
            return (
              <g
                key={n.key}
                transform={`translate(${p.x},${p.y})`}
                style={{ cursor: 'pointer', opacity: dimmed ? 0.55 : 1, transition: 'opacity 120ms ease' }}
                onPointerDown={(ev) => onNodePointerDown(ev, n)}
                onDoubleClick={(ev) => onNodeDoubleClick(ev, n)}
                onContextMenu={(ev) => onNodeContextMenu(ev, n)}
                onPointerEnter={() => setHoverKey(n.key)}
                onPointerLeave={() => setHoverKey((k) => (k === n.key ? null : k))}
                data-testid={`node-${n.type}-${n.id}`}
              >
                {n.type === 'web' ? (
                  <circle
                    r={r}
                    fill={fill}
                    fillOpacity={1}
                    stroke={isSel || isHover ? '#C9A94E' : stroke}
                    strokeWidth={isSel || isHover ? 3 : 1.5}
                  />
                ) : (
                  <rect
                    x={-r} y={-r} width={r * 2} height={r * 2} rx={6}
                    fill={fill}
                    fillOpacity={1}
                    stroke={isSel || isHover ? '#C9A94E' : stroke}
                    strokeWidth={isSel || isHover ? 3 : 1.5}
                  />
                )}
                {showLabel && (
                  <text
                    y={r + 14}
                    textAnchor="middle"
                    fontSize={12}
                    fill="#A8B2C1"
                    opacity={thisLabelOpacity}
                    style={{ fontFamily: 'var(--bex-app-font-family, serif)', pointerEvents: 'none' }}
                  >
                    {n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Hover preview card — a creative mini look inside a node */}
      {hoverCard && (
        <div
          className="absolute z-30 pointer-events-none"
          style={{ left: hoverCard.left, top: hoverCard.top, width: hoverCard.width }}
          data-testid="mindview-hover-preview"
        >
          <div
            className="card-metal rounded-xl overflow-hidden shadow-2xl"
            style={{ animation: 'mvPreviewIn 120ms ease-out' }}
          >
            {/* Accent bar in the node's own colour */}
            <div
              className="h-1 w-full"
              style={{ background: fillForNode(hoverCard.node) }}
            />
            <div className="p-3">
              <div className="flex items-center gap-2 mb-1.5">
                {hoverCard.node.type === 'web' ? (
                  <Network className="w-3.5 h-3.5 text-brand-strong shrink-0" />
                ) : (
                  <NotebookPen className="w-3.5 h-3.5 text-gold shrink-0" />
                )}
                <span className="text-[10px] uppercase tracking-wider text-ink-muted/60">
                  {hoverCard.node.type === 'web' ? 'Knowledge Web' : 'Mind Note'}
                </span>
                {hoverCard.node.isPrivate && (
                  <Lock className="w-3 h-3 text-ink-muted/50 ml-auto" />
                )}
              </div>

              <div className="text-sm font-semibold text-ink leading-snug mb-1.5 break-words">
                {hoverCard.node.label}
              </div>

              {hoverCard.node.type === 'note' && hoverCard.node.preview ? (
                <p className="text-[11px] leading-relaxed text-ink-muted/75 mb-2"
                   style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {hoverCard.node.preview}
                </p>
              ) : hoverCard.node.type === 'note' ? (
                <p className="text-[11px] italic text-ink-muted/40 mb-2">No content yet.</p>
              ) : null}

              {/* Group + tag chips for notes */}
              {(hoverCard.node.group || (hoverCard.node.tags && hoverCard.node.tags.length > 0)) && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {hoverCard.node.group && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-strong/20 text-[#C9A4E8] border border-brand-strong/30">
                      {hoverCard.node.group}
                    </span>
                  )}
                  {(hoverCard.node.tags || []).slice(0, 4).map((t) => (
                    <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-ink-muted/10 text-ink-muted/80 border border-ink-muted/15">
                      #{t}
                    </span>
                  ))}
                  {(hoverCard.node.tags || []).length > 4 && (
                    <span className="text-[10px] text-ink-muted/40">+{hoverCard.node.tags.length - 4}</span>
                  )}
                </div>
              )}

              {/* Stat row */}
              <div className="flex items-center gap-3 text-[10px] text-ink-muted/55 pt-1.5 border-t border-ink-muted/10">
                {hoverCard.node.type === 'web' && (
                  <span>{hoverCard.node.cardCount} card{hoverCard.node.cardCount === 1 ? '' : 's'}</span>
                )}
                {hoverCard.node.type === 'web' && (
                  <span>{hoverCard.node.internal} internal</span>
                )}
                <span>{hoverCard.node.degree} link{hoverCard.node.degree === 1 ? '' : 's'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute z-20 right-5 bottom-5 card-metal px-3 py-2 text-[11px] text-ink-muted/80 pointer-events-none">
        {colorByGroup && allGroups.length > 0 ? (
          <>
            <div className="text-[10px] uppercase tracking-wider text-ink-muted/50 mb-1">Groups</div>
            <div className="space-y-1 max-h-40 overflow-hidden">
              {allGroups.slice(0, 8).map((g) => (
                <div key={g} className="flex items-center gap-2">
                  <span className="inline-block w-3 h-3 rounded-full" style={{ background: colorForGroup(g) }} />
                  <span className="truncate max-w-[140px]">{g}</span>
                </div>
              ))}
              {allGroups.length > 8 && <div className="text-ink-muted/40">+{allGroups.length - 8} more</div>}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#6B4C9A', border: '1px solid #7C5CB7' }} />
              Knowledge Web
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#A8B2C1', border: '1px solid #C9A94E' }} />
              Mind Note
            </div>
          </>
        )}
        <div className="mt-1.5 pt-1.5 border-t border-ink-muted/15 text-[10px] text-ink-muted/60 leading-tight">
          Click to open · Right-click to focus · Drag to move
        </div>
      </div>

      {/* Mind-Map editing toolbar (radial "+" menu, reduced tool set) */}
      <MindMapToolbar
        mode={mode}
        onModeChange={setMode}
        onNewWeb={createWeb}
        onNewNote={createNote}
        onOpenRemap={() => setShowRemap(true)}
        keybinds={keybinds}
      />

      {/* Remappable shortcut editor */}
      <KeybindRemapModal
        open={showRemap}
        onClose={() => setShowRemap(false)}
        title="Mind View shortcuts"
        tools={MIND_TOOLS.map((t) => ({ id: t.id, label: t.label }))}
        binds={keybinds}
        onSetBind={setBind}
        onReset={resetBinds}
      />

      {/* In-app naming dialog for new Web / new Note (replaces window.prompt) */}
      <NameInputModal
        open={!!nameModal}
        title={nameModal?.kind === 'web' ? 'New Knowledge Web' : 'New Mind Note'}
        label={nameModal?.kind === 'web' ? 'Web title' : 'Note title'}
        placeholder={nameModal?.kind === 'web' ? 'Untitled Web' : 'Untitled Note'}
        confirmLabel="Create"
        icon={nameModal?.kind === 'web' ? Network : NotebookPen}
        onCancel={() => setNameModal(null)}
        onConfirm={(value) => {
          const kind = nameModal?.kind;
          setNameModal(null);
          if (kind) performCreate(kind, value);
        }}
      />

      </div>
    </div>
  );
}

// ── Small presentational helpers ──
function ToggleRow({ label, checked, onChange, testid }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between text-xs text-ink-muted/80 group"
      data-testid={testid}
    >
      <span>{label}</span>
      <span
        className={`relative inline-block w-9 h-5 rounded-full transition-colors ${
          checked ? 'bg-brand' : 'bg-ink-muted/20'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-4' : ''
          }`}
        />
      </span>
    </button>
  );
}

function SliderRow({ label, value, min, max, step, onChange, testid, format }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-ink-muted/70">{label}</span>
        <span className="text-[11px] text-ink-muted/50">{format ? format(value) : Math.round(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-brand-strong"
        data-testid={testid}
      />
    </div>
  );
}

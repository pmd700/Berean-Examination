const KNOWN_NODE_KEYS = ['elements', 'nodes', 'vertices', 'items', 'entities', 'points', 'actors'];
const KNOWN_EDGE_KEYS = ['connections', 'edges', 'links', 'relationships', 'arcs', 'lines'];

const TITLE_FIELDS = ['label', 'name', 'title', 'text', 'display_name', 'displayName', 'heading'];
const DESC_FIELDS = ['description', 'desc', 'content', 'body', 'details', 'notes', 'summary', 'bio', 'about', 'info'];
const TYPE_FIELDS = ['type', 'element type', 'category', 'kind', 'group', 'class', 'role', 'nodeType', 'node_type'];
const TAG_FIELDS = ['tags', 'labels', 'keywords', 'categories', 'groups'];
const IMAGE_FIELDS = ['image', 'image_url', 'imageUrl', 'img', 'photo', 'avatar', 'thumbnail', 'icon'];
const COLOR_FIELDS = ['color', 'colour', 'fill', 'background', 'bg', 'bgColor', 'backgroundColor'];
const URL_FIELDS = ['url', 'link', 'href', 'link_url', 'linkUrl', 'website', 'web'];
const SCRIPTURE_FIELDS = ['scripture_refs', 'scripture', 'scriptures', 'references', 'refs', 'verse', 'verses', 'passage', 'passages'];
const X_FIELDS = ['x', 'px', 'cx', 'posX', 'pos_x', 'left'];
const Y_FIELDS = ['y', 'py', 'cy', 'posY', 'pos_y', 'top'];

const FROM_FIELDS = ['from', 'source', 'from_card_id', 'from_id', 'fromId', 'start', 'origin', 'tail', 'src'];
const TO_FIELDS = ['to', 'target', 'to_card_id', 'to_id', 'toId', 'end', 'destination', 'head', 'dst'];
const LABEL_FIELDS = ['label', 'name', 'title', 'text', 'relationship', 'rel', 'type'];
const DIRECTION_FIELDS = ['direction', 'directed', 'has_arrow', 'hasArrow', 'arrow', 'directional'];
const THICKNESS_FIELDS = ['thickness', 'weight', 'width', 'size', 'strength', 'value'];
const STYLE_FIELDS = ['style', 'line_style', 'lineStyle', 'dash', 'stroke'];

function findField(obj, candidates) {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of candidates) {
    const lower = key.toLowerCase();
    for (const objKey of Object.keys(obj)) {
      if (objKey.toLowerCase() === lower) return obj[objKey];
    }
  }
  return undefined;
}

function extractString(val, maxLen = 500) {
  if (val === null || val === undefined) return undefined;
  if (typeof val === 'string') return val.slice(0, maxLen);
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) return val.map(v => String(v)).join(', ').slice(0, maxLen);
  return undefined;
}

function extractTags(val) {
  if (!val) return undefined;
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val.map(v => String(v)).join(', ');
  return undefined;
}

function extractNumber(val) {
  if (val === null || val === undefined) return undefined;
  const n = Number(val);
  return isFinite(n) ? Math.round(n) : undefined;
}

function extractColor(val) {
  if (!val || typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
  if (/^(rgb|hsl|hwb)/i.test(trimmed)) return trimmed;
  const CSS_COLORS = ['red','blue','green','yellow','orange','purple','pink','cyan','teal','white','black','gray','grey',
    'brown','violet','indigo','lime','magenta','navy','olive','maroon','aqua','silver','gold','coral','salmon','crimson'];
  if (CSS_COLORS.includes(trimmed.toLowerCase())) return trimmed.toLowerCase();
  return undefined;
}

function extractBool(val, defaultVal = undefined) {
  if (val === true || val === 'true' || val === 1 || val === 'yes' || val === 'directed') return true;
  if (val === false || val === 'false' || val === 0 || val === 'no' || val === 'undirected' || val === 'mutual') return false;
  return defaultVal;
}

function resolveD3LinkEndpoint(val, nodesList) {
  if (val === null || val === undefined) return undefined;
  if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
    return String(val.id ?? val._id ?? val.name ?? val.label ?? JSON.stringify(val));
  }
  if (typeof val === 'number' && Number.isInteger(val) && val >= 0 && val < nodesList.length) {
    const refNode = nodesList[val];
    if (refNode && refNode._originalId) return refNode._originalId;
  }
  return String(val);
}

function isAdjacencyList(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const keys = Object.keys(data);
  if (keys.length === 0) return false;
  let adjacencyCount = 0;
  for (const key of keys.slice(0, 20)) {
    const val = data[key];
    if (Array.isArray(val)) {
      const allPrimitive = val.every(v => typeof v === 'string' || typeof v === 'number');
      if (allPrimitive) adjacencyCount++;
    }
  }
  return adjacencyCount >= keys.length * 0.5 && adjacencyCount >= 2;
}

function extractAdjacencyList(data) {
  const nodeIds = new Set();
  const edges = [];

  for (const [fromId, neighbors] of Object.entries(data)) {
    nodeIds.add(fromId);
    if (Array.isArray(neighbors)) {
      for (const toId of neighbors) {
        const toStr = String(toId);
        nodeIds.add(toStr);
        edges.push({
          _fromOriginal: fromId,
          _toOriginal: toStr,
          label: null,
          has_arrow: true,
          color: null,
          style: null,
          thickness: null,
        });
      }
    }
  }

  const nodes = [...nodeIds].map(id => ({
    _originalId: id,
    title: id,
    description: null,
    tags: null,
    image_url: null,
    color: null,
    link_url: null,
    x: undefined,
    y: undefined,
  }));

  return { nodes, edges };
}

function isObjectAdjacencyWithMetadata(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (data.nodes && typeof data.nodes === 'object' && !Array.isArray(data.nodes)) {
    if (data.edges && typeof data.edges === 'object' && !Array.isArray(data.edges)) return true;
    const nodeKeys = Object.keys(data.nodes);
    if (nodeKeys.length > 0 && typeof data.nodes[nodeKeys[0]] === 'object') return true;
  }
  return false;
}

function extractObjectAdjacency(data) {
  const nodes = [];
  const edges = [];
  const stats = { malformedNodes: 0, malformedEdges: 0 };

  const nodesObj = data.nodes || {};
  for (const [id, val] of Object.entries(nodesObj)) {
    if (!val || typeof val !== 'object') { stats.malformedNodes++; continue; }
    nodes.push({
      _originalId: id,
      title: extractString(findField(val, TITLE_FIELDS)) || id,
      description: extractString(findField(val, DESC_FIELDS), 10000),
      tags: extractTags(findField(val, TAG_FIELDS)),
      image_url: extractString(findField(val, IMAGE_FIELDS)),
      color: extractColor(findField(val, COLOR_FIELDS)),
      link_url: extractString(findField(val, URL_FIELDS)),
      x: extractNumber(findField(val, X_FIELDS)),
      y: extractNumber(findField(val, Y_FIELDS)),
    });
  }

  const edgesSource = data.edges || data.links || data.connections;
  if (edgesSource && typeof edgesSource === 'object' && !Array.isArray(edgesSource)) {
    for (const [edgeId, val] of Object.entries(edgesSource)) {
      if (!val || typeof val !== 'object') { stats.malformedEdges++; continue; }
      const from = findField(val, FROM_FIELDS);
      const to = findField(val, TO_FIELDS);
      if (from === undefined || to === undefined) { stats.malformedEdges++; continue; }
      edges.push({
        _fromOriginal: String(from),
        _toOriginal: String(to),
        label: extractString(findField(val, LABEL_FIELDS)),
        has_arrow: extractBool(findField(val, DIRECTION_FIELDS), true),
        color: extractColor(findField(val, COLOR_FIELDS)),
        style: extractString(findField(val, STYLE_FIELDS)),
        thickness: extractNumber(findField(val, THICKNESS_FIELDS)),
      });
    }
  } else if (Array.isArray(edgesSource)) {
    for (const item of edgesSource) {
      if (!item || typeof item !== 'object') { stats.malformedEdges++; continue; }
      const from = findField(item, FROM_FIELDS);
      const to = findField(item, TO_FIELDS);
      if (from === undefined || to === undefined) { stats.malformedEdges++; continue; }
      edges.push({
        _fromOriginal: String(from),
        _toOriginal: String(to),
        label: extractString(findField(item, LABEL_FIELDS)),
        has_arrow: extractBool(findField(item, DIRECTION_FIELDS), true),
        color: extractColor(findField(item, COLOR_FIELDS)),
        style: extractString(findField(item, STYLE_FIELDS)),
        thickness: extractNumber(findField(item, THICKNESS_FIELDS)),
      });
    }
  }

  return { nodes, edges, stats };
}

function detectFormat(data) {
  if (data?.format === 'berean-knowledge-web') return 'berean';

  if (data?.elements && !Array.isArray(data.elements) && typeof data.elements === 'object') {
    if (data.elements.nodes || data.elements.edges) return 'cytoscape';
  }

  if (data?.elements && Array.isArray(data.elements) && data?.connections && Array.isArray(data.connections)) {
    return 'kumu';
  }
  if (data?.maps && typeof data.maps === 'object') {
    for (const mapKey of Object.keys(data.maps)) {
      const map = data.maps[mapKey];
      if (map?.elements || map?.connections) return 'kumu-project';
    }
  }

  if (Array.isArray(data?.nodes) && Array.isArray(data?.links)) return 'd3-force';
  if (Array.isArray(data?.nodes) && Array.isArray(data?.edges)) return 'generic-nodes-edges';

  for (const nk of KNOWN_NODE_KEYS) {
    if (Array.isArray(data?.[nk])) {
      for (const ek of KNOWN_EDGE_KEYS) {
        if (Array.isArray(data?.[ek])) return 'generic-custom';
      }
    }
  }

  if (isObjectAdjacencyWithMetadata(data)) return 'object-adjacency';

  if (Array.isArray(data?.nodes) && !Array.isArray(data?.edges) && !Array.isArray(data?.links)) {
    return 'nodes-only';
  }

  for (const nk of KNOWN_NODE_KEYS) {
    if (Array.isArray(data?.[nk])) return 'nodes-only';
  }

  if (isAdjacencyList(data)) return 'adjacency-list';

  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
    return 'flat-array';
  }

  return 'unknown';
}

function extractKumuNodes(data, stats) {
  const nodes = [];
  const elements = data.elements || [];

  for (const el of elements) {
    if (!el || typeof el !== 'object') { stats.malformedNodes++; continue; }
    const attrs = el.attributes || el;
    const id = el._id || el.id || el.label || `node-${nodes.length}`;
    nodes.push({
      _originalId: String(id),
      title: extractString(attrs.label || el.label) || extractString(id),
      description: extractString(findField(attrs, DESC_FIELDS), 10000),
      tags: extractTags(findField(attrs, TAG_FIELDS) || attrs.tags),
      image_url: extractString(findField(attrs, IMAGE_FIELDS)),
      color: extractColor(findField(attrs, COLOR_FIELDS)),
      link_url: extractString(findField(attrs, URL_FIELDS)),
      scripture_refs: extractString(findField(attrs, SCRIPTURE_FIELDS)),
      x: extractNumber(findField(attrs, X_FIELDS)),
      y: extractNumber(findField(attrs, Y_FIELDS)),
    });
  }
  return nodes;
}

function extractKumuEdges(data, stats) {
  const edges = [];
  const connections = data.connections || [];

  for (const conn of connections) {
    if (!conn || typeof conn !== 'object') { stats.malformedEdges++; continue; }
    const attrs = conn.attributes || conn;
    const from = conn.from || conn.source || findField(conn, FROM_FIELDS);
    const to = conn.to || conn.target || findField(conn, TO_FIELDS);
    if (from === undefined || to === undefined) { stats.malformedEdges++; continue; }

    edges.push({
      _fromOriginal: String(from),
      _toOriginal: String(to),
      label: extractString(findField(attrs, LABEL_FIELDS)),
      has_arrow: extractBool(findField(attrs, DIRECTION_FIELDS), true),
      color: extractColor(findField(attrs, COLOR_FIELDS)),
      style: extractString(findField(attrs, STYLE_FIELDS)),
      thickness: extractNumber(findField(attrs, THICKNESS_FIELDS)),
    });
  }
  return edges;
}

function extractKumuProjectData(data, stats) {
  const mapKeys = Object.keys(data.maps || {});
  if (mapKeys.length === 0) return { nodes: [], edges: [] };

  const firstMap = data.maps[mapKeys[0]];
  const positionMap = {};

  if (firstMap?.elements) {
    for (const [elKey, elVal] of Object.entries(firstMap.elements)) {
      if (elVal?.position) {
        positionMap[elKey] = {
          x: extractNumber(elVal.position.x),
          y: extractNumber(elVal.position.y),
        };
      }
    }
  }

  const rawElements = data.elements || [];
  const rawConnections = data.connections || [];
  const topLevel = {
    elements: Array.isArray(rawElements) ? rawElements : Object.values(rawElements),
    connections: Array.isArray(rawConnections) ? rawConnections : Object.values(rawConnections),
  };

  const nodes = extractKumuNodes(topLevel, stats);
  const edges = extractKumuEdges(topLevel, stats);

  for (const node of nodes) {
    const pos = positionMap[node._originalId];
    if (pos) {
      if (node.x === undefined) node.x = pos.x;
      if (node.y === undefined) node.y = pos.y;
    }
  }

  return { nodes, edges };
}

function extractCytoscapeData(data, stats) {
  const nodes = [];
  const edges = [];
  const cyNodes = data.elements?.nodes || [];
  const cyEdges = data.elements?.edges || [];

  for (const n of cyNodes) {
    if (!n || typeof n !== 'object') { stats.malformedNodes++; continue; }
    const d = n.data || n;
    const pos = n.position || {};
    nodes.push({
      _originalId: String(d.id || `node-${nodes.length}`),
      title: extractString(d.label || d.name || d.id),
      description: extractString(findField(d, DESC_FIELDS), 10000),
      tags: extractTags(findField(d, TAG_FIELDS)),
      image_url: extractString(findField(d, IMAGE_FIELDS)),
      color: extractColor(findField(d, COLOR_FIELDS)),
      link_url: extractString(findField(d, URL_FIELDS)),
      x: extractNumber(pos.x ?? findField(d, X_FIELDS)),
      y: extractNumber(pos.y ?? findField(d, Y_FIELDS)),
    });
  }

  for (const e of cyEdges) {
    if (!e || typeof e !== 'object') { stats.malformedEdges++; continue; }
    const d = e.data || e;
    if (d.source === undefined || d.target === undefined) { stats.malformedEdges++; continue; }
    edges.push({
      _fromOriginal: String(d.source),
      _toOriginal: String(d.target),
      label: extractString(d.label || findField(d, LABEL_FIELDS)),
      has_arrow: extractBool(findField(d, DIRECTION_FIELDS), true),
      color: extractColor(findField(d, COLOR_FIELDS)),
      style: extractString(findField(d, STYLE_FIELDS)),
      thickness: extractNumber(findField(d, THICKNESS_FIELDS)),
    });
  }

  return { nodes, edges };
}

function extractGenericData(data, stats) {
  let rawNodes = null;
  let rawEdges = null;

  for (const nk of KNOWN_NODE_KEYS) {
    if (Array.isArray(data?.[nk])) { rawNodes = data[nk]; break; }
  }
  if (!rawNodes && Array.isArray(data?.nodes)) rawNodes = data.nodes;

  for (const ek of KNOWN_EDGE_KEYS) {
    if (Array.isArray(data?.[ek])) { rawEdges = data[ek]; break; }
  }
  if (!rawEdges) {
    if (Array.isArray(data?.links)) rawEdges = data.links;
    else if (Array.isArray(data?.edges)) rawEdges = data.edges;
  }

  const nodes = [];
  for (const item of (rawNodes || [])) {
    if (!item || typeof item !== 'object') { stats.malformedNodes++; continue; }
    const id = item.id ?? item._id ?? item.key ?? `node-${nodes.length}`;
    nodes.push({
      _originalId: String(id),
      title: extractString(findField(item, TITLE_FIELDS)) || extractString(id),
      description: extractString(findField(item, DESC_FIELDS), 10000),
      tags: extractTags(findField(item, TAG_FIELDS)),
      image_url: extractString(findField(item, IMAGE_FIELDS)),
      color: extractColor(findField(item, COLOR_FIELDS)),
      link_url: extractString(findField(item, URL_FIELDS)),
      x: extractNumber(findField(item, X_FIELDS)),
      y: extractNumber(findField(item, Y_FIELDS)),
    });
  }

  const edges = [];
  for (const item of (rawEdges || [])) {
    if (!item || typeof item !== 'object') { stats.malformedEdges++; continue; }
    const rawFrom = findField(item, FROM_FIELDS);
    const rawTo = findField(item, TO_FIELDS);
    if (rawFrom === undefined || rawTo === undefined) { stats.malformedEdges++; continue; }
    const from = resolveD3LinkEndpoint(rawFrom, nodes);
    const to = resolveD3LinkEndpoint(rawTo, nodes);
    if (from === undefined || to === undefined) { stats.malformedEdges++; continue; }
    edges.push({
      _fromOriginal: from,
      _toOriginal: to,
      label: extractString(findField(item, LABEL_FIELDS)),
      has_arrow: extractBool(findField(item, DIRECTION_FIELDS), true),
      color: extractColor(findField(item, COLOR_FIELDS)),
      style: extractString(findField(item, STYLE_FIELDS)),
      thickness: extractNumber(findField(item, THICKNESS_FIELDS)),
    });
  }

  return { nodes, edges };
}

function extractFlatArray(data, stats) {
  const nodes = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') { stats.malformedNodes++; continue; }
    const id = item.id ?? item._id ?? item.key ?? `node-${nodes.length}`;
    nodes.push({
      _originalId: String(id),
      title: extractString(findField(item, TITLE_FIELDS)) || extractString(id),
      description: extractString(findField(item, DESC_FIELDS), 10000),
      tags: extractTags(findField(item, TAG_FIELDS)),
      image_url: extractString(findField(item, IMAGE_FIELDS)),
      color: extractColor(findField(item, COLOR_FIELDS)),
      link_url: extractString(findField(item, URL_FIELDS)),
      x: extractNumber(findField(item, X_FIELDS)),
      y: extractNumber(findField(item, Y_FIELDS)),
    });
  }
  return { nodes, edges: [] };
}

function applyGridLayout(nodes, startX = 100, startY = 100, colWidth = 280, rowHeight = 200, cols = 10) {
  const needsLayout = nodes.filter(n => n.x === undefined || n.y === undefined);
  const hasLayout = nodes.filter(n => n.x !== undefined && n.y !== undefined);

  let offsetX = startX;
  let offsetY = startY;

  if (hasLayout.length > 0) {
    const maxX = Math.max(...hasLayout.map(n => n.x));
    offsetX = maxX + colWidth * 2;
  }

  needsLayout.forEach((node, i) => {
    node.x = offsetX + (i % cols) * colWidth;
    node.y = offsetY + Math.floor(i / cols) * rowHeight;
  });
}

// Layered (Sugiyama-style) layout for directed graphs. Roots (nodes with
// no incoming edges) go on layer 0; each subsequent layer holds nodes
// whose deepest reachable depth from a root is N. Cycles are tolerated by
// only walking forward edges. Within a layer, nodes are ordered by the
// barycenter (average) of their parents' x positions to minimize crossings.
// Coordinates are written in graph space; downstream `scalePositions`
// would distort the layered shape, so callers should skip it.
function applyLayeredLayout(nodes, edges, opts = {}) {
  const {
    startX = 100,
    startY = 100,
    colWidth = 320, // horizontal gap between layers (left → right flow)
    rowHeight = 180, // vertical gap between siblings in a layer
  } = opts;

  if (nodes.length === 0) return;

  const idToNode = new Map();
  nodes.forEach((n) => idToNode.set(n._originalId, n));

  // Build adjacency, ignoring edges that reference unknown nodes.
  const outgoing = new Map(); // id -> [childIds]
  const incoming = new Map(); // id -> [parentIds]
  nodes.forEach((n) => {
    outgoing.set(n._originalId, []);
    incoming.set(n._originalId, []);
  });
  for (const e of edges) {
    if (!idToNode.has(e._fromOriginal) || !idToNode.has(e._toOriginal)) continue;
    if (e._fromOriginal === e._toOriginal) continue; // skip self-loops
    outgoing.get(e._fromOriginal).push(e._toOriginal);
    incoming.get(e._toOriginal).push(e._fromOriginal);
  }

  // Assign layers: BFS from every root (in-degree 0). For nodes inside
  // cycles (no root reaches them), seed them at layer 0 in a second pass
  // so the layout is still produced.
  const layer = new Map();
  const queue = [];
  for (const n of nodes) {
    if ((incoming.get(n._originalId) || []).length === 0) {
      layer.set(n._originalId, 0);
      queue.push(n._originalId);
    }
  }
  // Cycle fallback: any node not reachable from a root gets layer 0 too.
  for (const n of nodes) {
    if (!layer.has(n._originalId)) {
      layer.set(n._originalId, 0);
      queue.push(n._originalId);
    }
  }

  // Longest-path layering: a node's layer is max(parent layers) + 1.
  // Iterate to a fixed point (bounded by node count to avoid runaway).
  let changed = true;
  let iterations = 0;
  const maxIterations = nodes.length + 4;
  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;
    for (const n of nodes) {
      const parents = incoming.get(n._originalId) || [];
      if (parents.length === 0) continue;
      let maxParent = -1;
      for (const p of parents) {
        const pl = layer.get(p);
        if (pl !== undefined && pl > maxParent) maxParent = pl;
      }
      const desired = maxParent + 1;
      if (desired > (layer.get(n._originalId) ?? 0)) {
        layer.set(n._originalId, desired);
        changed = true;
      }
    }
  }

  // Group nodes per layer.
  const layers = [];
  for (const n of nodes) {
    const l = layer.get(n._originalId) ?? 0;
    if (!layers[l]) layers[l] = [];
    layers[l].push(n);
  }

  // Assign initial column index = order seen, then refine top-down using
  // the barycenter (average column of parents) so children sit under
  // their parents and edge crossings drop.
  const columnOf = new Map();
  layers.forEach((layerNodes) => {
    layerNodes.forEach((n, i) => columnOf.set(n._originalId, i));
  });
  for (let li = 1; li < layers.length; li++) {
    const layerNodes = layers[li];
    const ranked = layerNodes
      .map((n) => {
        const parents = incoming.get(n._originalId) || [];
        const cols = parents
          .map((p) => columnOf.get(p))
          .filter((c) => c !== undefined);
        const bary = cols.length
          ? cols.reduce((a, b) => a + b, 0) / cols.length
          : columnOf.get(n._originalId) ?? 0;
        return { node: n, bary };
      })
      .sort((a, b) => a.bary - b.bary);
    ranked.forEach((r, i) => columnOf.set(r.node._originalId, i));
    layers[li] = ranked.map((r) => r.node);
  }

  // Place: x by layer (left → right), y centered per layer.
  const maxRows = Math.max(...layers.map((l) => l.length));
  const layerHeight = (maxRows - 1) * rowHeight;
  layers.forEach((layerNodes, li) => {
    const rows = layerNodes.length;
    const totalHeight = (rows - 1) * rowHeight;
    const yOffset = startY + (layerHeight - totalHeight) / 2;
    layerNodes.forEach((n, i) => {
      n.x = Math.round(startX + li * colWidth);
      n.y = Math.round(yOffset + i * rowHeight);
    });
  });
}

function scalePositions(nodes) {
  const positioned = nodes.filter(n => n.x !== undefined && n.y !== undefined);
  if (positioned.length < 2) return;

  const minX = Math.min(...positioned.map(n => n.x));
  const minY = Math.min(...positioned.map(n => n.y));
  const maxX = Math.max(...positioned.map(n => n.x));
  const maxY = Math.max(...positioned.map(n => n.y));
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  const targetWidth = Math.max(2000, positioned.length * 120);
  const targetHeight = Math.max(1500, positioned.length * 90);

  for (const node of positioned) {
    node.x = Math.round(100 + ((node.x - minX) / rangeX) * targetWidth);
    node.y = Math.round(100 + ((node.y - minY) / rangeY) * targetHeight);
  }
}

function nodesToCards(nodes) {
  return nodes.map((n, i) => {
    const { _originalId, ...rest } = n;
    return {
      id: i,
      title: rest.title || 'Untitled',
      description: rest.description || null,
      tags: rest.tags || null,
      image_url: rest.image_url || null,
      scripture_refs: rest.scripture_refs || null,
      color: rest.color || null,
      x: rest.x ?? 100,
      y: rest.y ?? 100,
      width: 200,
      height: 120,
      layout_mode: 'smart',
      is_collapsed: false,
      link_url: rest.link_url || null,
    };
  });
}

function edgesToConnections(edges, nodeIdMap) {
  const connections = [];
  const unresolvedEdges = [];

  for (const edge of edges) {
    const fromId = nodeIdMap[edge._fromOriginal];
    const toId = nodeIdMap[edge._toOriginal];

    if (fromId === undefined || toId === undefined) {
      unresolvedEdges.push(edge);
      continue;
    }

    connections.push({
      from_card_id: fromId,
      to_card_id: toId,
      label: edge.label || null,
      has_arrow: edge.has_arrow ?? true,
      color: edge.color || null,
      style: edge.style || null,
      thickness: edge.thickness || 2,
    });
  }

  return { connections, unresolvedEdges };
}

const MAX_NODES = 2000;
const MAX_EDGES = 5000;

export async function importJsonGraph(file) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('The file is not valid JSON.');
  }

  const format = detectFormat(data);

  if (format === 'berean') {
    throw new Error('BEREAN_FORMAT');
  }

  if (format === 'unknown') {
    throw new Error('Could not recognize this JSON as a graph format. Expected objects with nodes/elements and edges/connections arrays, or an adjacency list.');
  }

  const stats = { malformedNodes: 0, malformedEdges: 0 };
  let rawResult;

  switch (format) {
    case 'kumu':
      rawResult = { nodes: extractKumuNodes(data, stats), edges: extractKumuEdges(data, stats) };
      break;
    case 'kumu-project':
      rawResult = extractKumuProjectData(data, stats);
      break;
    case 'cytoscape':
      rawResult = extractCytoscapeData(data, stats);
      break;
    case 'adjacency-list':
      rawResult = extractAdjacencyList(data);
      break;
    case 'object-adjacency': {
      const result = extractObjectAdjacency(data);
      stats.malformedNodes += result.stats.malformedNodes;
      stats.malformedEdges += result.stats.malformedEdges;
      rawResult = { nodes: result.nodes, edges: result.edges };
      break;
    }
    case 'd3-force':
    case 'generic-nodes-edges':
    case 'generic-custom':
    case 'nodes-only':
      rawResult = extractGenericData(data, stats);
      break;
    case 'flat-array':
      rawResult = extractFlatArray(data, stats);
      break;
    default:
      rawResult = extractGenericData(data, stats);
  }

  let { nodes, edges } = rawResult;

  let truncatedNodes = 0;
  let truncatedEdges = 0;
  if (nodes.length > MAX_NODES) {
    truncatedNodes = nodes.length - MAX_NODES;
    nodes = nodes.slice(0, MAX_NODES);
  }
  if (edges.length > MAX_EDGES) {
    truncatedEdges = edges.length - MAX_EDGES;
    edges = edges.slice(0, MAX_EDGES);
  }

  const nodeIdMap = {};
  const duplicateIds = new Set();
  nodes.forEach((n, i) => {
    if (nodeIdMap[n._originalId] !== undefined) {
      duplicateIds.add(n._originalId);
      n._originalId = `${n._originalId}__dup_${i}`;
    }
    nodeIdMap[n._originalId] = i;
  });

  // For directed graph formats (Kumu, Cytoscape, generic edge lists) where
  // the source frequently leaves nodes unpositioned, a hierarchical layered
  // layout matches the conversational/flow intent far better than a grid
  // strip glued onto the right of partially-positioned nodes. We discard
  // any partial positions in this case to keep the result coherent.
  const isDirectedFlow =
    (format === 'kumu' ||
      format === 'kumu-project' ||
      format === 'cytoscape' ||
      format === 'd3-force' ||
      format === 'generic-nodes-edges' ||
      format === 'generic-custom') &&
    edges.length > 0;
  const positionedCount = nodes.filter(
    (n) => n.x !== undefined && n.y !== undefined,
  ).length;
  const hasPartialPositions =
    positionedCount > 0 && positionedCount < nodes.length;

  // When every node already has a position (e.g. a round-trip from a Berean
  // JSON export), honour the stored coordinates exactly — don't rescale them.
  const allPositioned = positionedCount === nodes.length && nodes.length > 0;

  if (isDirectedFlow && (hasPartialPositions || positionedCount === 0)) {
    // Drop partial positions so layered layout owns the geometry.
    nodes.forEach((n) => {
      n.x = undefined;
      n.y = undefined;
    });
    applyLayeredLayout(nodes, edges);
  } else if (allPositioned) {
    // All positions already present — use as-is. applyGridLayout is a no-op
    // when every node is positioned, but we skip scalePositions so we don't
    // warp the original canvas layout.
    applyGridLayout(nodes);
  } else {
    scalePositions(nodes);
    applyGridLayout(nodes);
  }

  const cards = nodesToCards(nodes);
  const { connections, unresolvedEdges } = edgesToConnections(edges, nodeIdMap);

  return {
    cards,
    connections,
    canvasObjects: [],
    meta: {
      detectedFormat: format,
      totalNodes: nodes.length,
      totalEdges: connections.length,
      skippedEdges: unresolvedEdges.length,
      malformedNodes: stats.malformedNodes,
      malformedEdges: stats.malformedEdges,
      duplicateNodeIds: duplicateIds.size,
      truncatedNodes,
      truncatedEdges,
      fileName: file.name,
    },
  };
}

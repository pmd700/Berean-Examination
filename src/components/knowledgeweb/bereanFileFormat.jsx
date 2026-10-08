export function sanitizeFileName(name = 'knowledge-web') {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'knowledge-web';
}

export function downloadFile(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportKnowledgeWebToKumuJson({ web, cards, connections }) {
  // Build a label-to-id-safe map so connections can reference by id string.
  // Kumu blueprint: { elements: [...], connections: [...] }
  // Berean extensions stored as plain top-level fields on each element/connection.

  const elements = (cards || []).map((card) => {
    // Never include enc_payload — that is encrypted binary and meaningless outside Berean.
    const el = {
      id: String(card.id),
      label: card.title || `card-${card.id}`,
    };
    if (card.description) el.description = card.description;
    if (card.tags) {
      // Store as array (Kumu native) so it round-trips cleanly.
      const arr = card.tags.split(',').map((t) => t.trim()).filter(Boolean);
      if (arr.length) el.tags = arr;
    }
    if (card.scripture_refs) el.scripture_refs = card.scripture_refs;
    // Position & styling — Berean extensions that Kumu ignores but we re-import.
    if (card.x != null) el.x = card.x;
    if (card.y != null) el.y = card.y;
    if (card.color) el.color = card.color;
    if (card.image_url) el.image_url = card.image_url;
    if (card.link_url) el.link_url = card.link_url;
    return el;
  });

  const connectionsList = (connections || []).map((conn) => {
    const c = {
      from: String(conn.from_card_id),
      to: String(conn.to_card_id),
      // Kumu direction values: "directed" | "undirected" | "mutual"
      direction: conn.has_arrow ? 'directed' : 'undirected',
    };
    if (conn.label) c.label = conn.label;
    if (conn.color) c.color = conn.color;
    if (conn.style) c.style = conn.style;
    if (conn.thickness && conn.thickness !== 2) c.thickness = conn.thickness;
    return c;
  });

  const payload = {
    elements,
    connections: connectionsList,
    _berean: {
      exported_at: new Date().toISOString(),
      web_title: web?.title || 'Knowledge Web',
      note: 'Exported from Berean Examination. Fields x, y, color, scripture_refs, image_url, and link_url are Berean extensions — Kumu will ignore them but they are preserved on re-import.',
    },
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  downloadFile(blob, `${sanitizeFileName(web?.title)}.json`);
}

const MAX_BEREAN_FILE_BYTES = 32 * 1024 * 1024;

function portableIdKey(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && value.trim() && value.length <= 200) return value.trim();
  return null;
}

function inspectPortableGraph(cards, connections, canvasObjects) {
  const cardIds = new Set();
  const objectIds = new Map();
  for (const card of cards) {
    const key = portableIdKey(card?.id);
    if (key === null || cardIds.has(key)) {
      throw new Error('This web has a card with a missing or duplicate ID and cannot be exported safely.');
    }
    cardIds.add(key);
  }
  for (const object of canvasObjects) {
    const key = portableIdKey(object?.id);
    if (key === null || objectIds.has(key)) {
      throw new Error('This web has a canvas object with a missing or duplicate ID and cannot be exported safely.');
    }
    objectIds.set(key, object.object_type);
  }
  let unresolvedConnections = 0;
  for (const connection of connections) {
    let connectionResolved = true;
    for (const side of ['from', 'to']) {
      const kind = connection?.[`${side}_kind`] || 'card';
      const key = portableIdKey(connection?.[`${side}_card_id`]);
      const valid = kind === 'card'
        ? key !== null && cardIds.has(key)
        : key !== null && objectIds.get(key) === kind;
      if (!valid) connectionResolved = false;
    }
    if (!connectionResolved) unresolvedConnections += 1;
  }
  return Object.freeze({ unresolvedConnections });
}

function stripLocalRecordFields(value, { stripId = false } = {}) {
  const portable = { ...(value || {}) };
  for (const key of ['created_date', 'updated_date', 'created_by', 'enc_payload']) {
    delete portable[key];
  }
  if (stripId) delete portable.id;
  return portable;
}

export function buildBereanKnowledgeWebPayload({ web, cards, connections, canvasObjects }) {
  const safeCards = Array.isArray(cards) ? cards : [];
  const safeConnections = Array.isArray(connections) ? connections : [];
  const safeObjects = Array.isArray(canvasObjects) ? canvasObjects : [];
  const integrity = inspectPortableGraph(safeCards, safeConnections, safeObjects);
  return {
    format: 'berean-knowledge-web',
    version: 2,
    exported_at: new Date().toISOString(),
    web: {
      title: web?.title || 'Knowledge Web',
      description: web?.description || '',
      connector_style: web?.connector_style || null,
    },
    // `enc_payload` belongs only to the source private web and is encrypted
    // with that web's key. Explicit-key export overlays the decrypted fields,
    // so carrying the obsolete ciphertext would be both useless and a risky
    // round-trip contaminant when the portable file is imported elsewhere.
    cards: safeCards.map((card) => stripLocalRecordFields(card)),
    connections: safeConnections.map((connection) => (
      stripLocalRecordFields(connection, { stripId: true })
    )),
    canvasObjects: safeObjects.map((object) => stripLocalRecordFields(object)),
    integrity,
  };
}

export function exportKnowledgeWebToBerean({ web, cards, connections, canvasObjects }) {
  const payload = buildBereanKnowledgeWebPayload({ web, cards, connections, canvasObjects });

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/octet-stream' });
  downloadFile(blob, `${sanitizeFileName(web?.title)}.berean`);
}

export async function importKnowledgeWebFromBerean(file) {
  if (file?.size > MAX_BEREAN_FILE_BYTES) {
    throw new Error('This .berean file is too large to import safely.');
  }
  const text = await file.text();
  const parsed = JSON.parse(text);

  if (parsed?.format !== 'berean-knowledge-web' || ![1, 2].includes(parsed?.version)) {
    throw new Error('Invalid .berean file.');
  }

  return {
    formatVersion: parsed.version,
    web: parsed.web || {},
    cards: Array.isArray(parsed.cards) ? parsed.cards : [],
    connections: Array.isArray(parsed.connections) ? parsed.connections : [],
    canvasObjects: Array.isArray(parsed.canvasObjects) ? parsed.canvasObjects : [],
  };
}

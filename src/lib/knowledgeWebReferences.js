/** Card and canvas-object IDs are separate SQLite namespaces. A routing point
 * can have the same numeric ID as a card, so connection kinds are authoritative. */
export function knowledgeWebReferenceResolver(cards = [], objects = [], webId = '') {
  const cardById = new Map(cards.map(card => [String(card.id), card]));
  const objectById = new Map(objects.map(object => [String(object.id), object]));
  return (id, kind) => {
    const key = String(id);
    const card = cardById.get(key), object = objectById.get(key);
    // Older Markdown exports accepted untyped organization points. Preserve
    // that fallback only when a connection has no explicit endpoint kind.
    const isCard = kind ? kind === 'card' : Boolean(card);
    const objectType = isCard ? null : kind || object?.object_type || 'point';
    const record = isCard ? card : object;
    const fallback = isCard ? `missing card ${key}` : objectType === 'point' ? `organization point ${key}` : `${objectType} ${key}`;
    const nodeKey = /^[a-zA-Z0-9_]+$/.test(key) ? key : `id_${Array.from(new TextEncoder().encode(key), byte => byte.toString(16).padStart(2, '0')).join('')}`;
    return {
      id, kind: isCard ? 'card' : 'object', objectType,
      sourceId: `web:${webId}/${isCard ? 'card' : 'object'}:${key}`,
      nodeId: `${isCard ? 'C' : 'O'}${nodeKey}`,
      label: record?.title || fallback,
      exists: Boolean(record),
    };
  };
}

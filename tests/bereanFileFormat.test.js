import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBereanKnowledgeWebPayload,
  importKnowledgeWebFromBerean,
} from '../src/components/knowledgeweb/bereanFileFormat.jsx';

function portableFile(payload) {
  const text = JSON.stringify(payload);
  return { size: Buffer.byteLength(text), text: async () => text };
}

const completeGraph = {
  web: { title: 'Portable', description: 'Proof', connector_style: 'curvy' },
  cards: [
    { id: 'card-a', title: 'A', x: 10, y: 20, width: 200, height: 120 },
    { id: 'card-b', title: 'B', x: 30, y: 40, width: 240, height: 160 },
  ],
  canvasObjects: [
    { id: 'point-a', object_type: 'point', x: 50, y: 60 },
  ],
  connections: [
    { id: 'edge-a', from_card_id: 'card-a', to_card_id: 'card-b', from_kind: 'card', to_kind: 'card' },
    { id: 'edge-b', from_card_id: 'card-b', to_card_id: 'point-a', from_kind: 'card', to_kind: 'point' },
  ],
};

describe('bereanFileFormat', () => {
  it('writes version 2 with canvas IDs and point endpoints intact', () => {
    const payload = buildBereanKnowledgeWebPayload(completeGraph);
    assert.equal(payload.version, 2);
    assert.equal(payload.canvasObjects[0].id, 'point-a');
    assert.equal(payload.connections[1].to_card_id, 'point-a');
    assert.equal(payload.connections[1].to_kind, 'point');
    assert.equal(payload.connections[0].id, undefined);
  });

  it('never carries source-web ciphertext into a portable .berean file', () => {
    const payload = buildBereanKnowledgeWebPayload({
      ...completeGraph,
      cards: completeGraph.cards.map((card) => ({ ...card, enc_payload: 'old-card-ciphertext' })),
      connections: completeGraph.connections.map((connection) => ({
        ...connection,
        enc_payload: 'old-connection-ciphertext',
      })),
      canvasObjects: completeGraph.canvasObjects.map((object) => ({
        ...object,
        enc_payload: 'old-object-ciphertext',
      })),
    });

    assert.equal(payload.cards[0].enc_payload, undefined);
    assert.equal(payload.connections[0].enc_payload, undefined);
    assert.equal(payload.canvasObjects[0].enc_payload, undefined);
    assert.doesNotMatch(JSON.stringify(payload), /old-(card|connection|object)-ciphertext/);
  });

  it('preserves unresolved connections without blocking the web export', async () => {
    const payload = buildBereanKnowledgeWebPayload({
      ...completeGraph,
      connections: [{
        id: 'broken-edge',
        from_card_id: 'card-a',
        to_card_id: 'missing',
        label: 'Keep this record',
      }],
    });

    assert.equal(payload.connections.length, 1);
    assert.equal(payload.connections[0].to_card_id, 'missing');
    assert.equal(payload.connections[0].label, 'Keep this record');
    assert.equal(payload.integrity.unresolvedConnections, 1);

    const parsed = await importKnowledgeWebFromBerean(portableFile(payload));
    assert.equal(parsed.connections.length, 1);
    assert.equal(parsed.connections[0].to_card_id, 'missing');
  });

  it('reads both legacy version 1 and corrected version 2 files', async () => {
    const version2 = buildBereanKnowledgeWebPayload(completeGraph);
    const parsed2 = await importKnowledgeWebFromBerean(portableFile(version2));
    assert.equal(parsed2.formatVersion, 2);
    assert.equal(parsed2.canvasObjects[0].id, 'point-a');

    const version1 = { ...version2, version: 1, canvasObjects: [{ object_type: 'point', x: 50, y: 60 }] };
    const parsed1 = await importKnowledgeWebFromBerean(portableFile(version1));
    assert.equal(parsed1.formatVersion, 1);
    assert.equal(parsed1.canvasObjects[0].id, undefined);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildKnowledgeWebMarkdown,
  parseKnowledgeWebMarkdown,
  htmlToMarkdown,
} from '../src/components/knowledgeweb/markdownFileFormat.jsx';

const sampleBoard = {
  web: {
    title: 'Romans 9 — Election',
    description: 'A study on corporate vs individual election.',
    connector_style: 'curvy',
  },
  cards: [
    {
      id: 'c1',
      title: 'Jacob have I loved',
      card_type: 'scripture',
      tags: 'romans, election',
      scripture_refs: 'Rom 9:13',
      description: '<p>Quote from <strong>Mal 1:2-3</strong> applied corporately.</p>',
      x: 100,
      y: 200,
      color: '#aabbcc',
    },
    {
      id: 'c2',
      title: 'Pharaoh hardening',
      card_type: 'argument',
      description: '<p>God hardens whom he wills.</p><ul><li>Active or passive?</li></ul>',
      x: 400,
      y: 200,
    },
  ],
  connections: [
    { id: 'e1', from_card_id: 'c1', to_card_id: 'c2', label: 'parallel example', has_arrow: true },
  ],
  canvasObjects: [
    { id: 'o1', object_type: 'section', title: 'Old Testament Anchors', x: 50, y: 150, width: 400, height: 200 },
  ],
};

describe('markdownFileFormat', () => {
  it('round-trips a board through buildKnowledgeWebMarkdown → parseKnowledgeWebMarkdown', () => {
    const md = buildKnowledgeWebMarkdown(sampleBoard);
    const parsed = parseKnowledgeWebMarkdown(md);

    assert.equal(parsed.formatVersion, 2);
    assert.equal(parsed.web.title, sampleBoard.web.title);
    assert.equal(parsed.web.description, sampleBoard.web.description);
    assert.equal(parsed.cards.length, 2);
    assert.equal(parsed.cards[0].id, 'c1');
    assert.equal(parsed.cards[0].title, 'Jacob have I loved');
    assert.equal(parsed.cards[0].x, 100);
    assert.equal(parsed.connections.length, 1);
    assert.equal(parsed.connections[0].from_card_id, 'c1');
    assert.equal(parsed.connections[0].to_card_id, 'c2');
    assert.equal(parsed.connections[0].has_arrow, true);
    assert.equal(parsed.canvasObjects.length, 1);
    assert.equal(parsed.canvasObjects[0].id, 'o1');
    assert.equal(parsed.canvasObjects[0].title, 'Old Testament Anchors');
  });

  it('renders human-readable markdown with card titles, types, and connection lines on top', () => {
    const md = buildKnowledgeWebMarkdown(sampleBoard);
    const human = md.split('<!-- BEREAN_KNOWLEDGE_WEB:BEGIN')[0];

    assert.match(human, /^# Romans 9 — Election/);
    assert.match(human, /A study on corporate vs individual election\./);
    assert.match(human, /### Jacob have I loved/);
    assert.match(human, /\*\*Type:\*\* scripture/);
    assert.match(human, /\*\*Scripture:\*\* Rom 9:13/);
    assert.match(human, /### Pharaoh hardening/);
    assert.match(human, /## Connections/);
    assert.match(human, /\*\*Jacob have I loved\*\* → \*\*Pharaoh hardening\*\*: parallel example/);
  });

  it('groups cards under their containing section heading', () => {
    const md = buildKnowledgeWebMarkdown(sampleBoard);
    const human = md.split('<!-- BEREAN_KNOWLEDGE_WEB:BEGIN')[0];
    assert.match(human, /## Old Testament Anchors/);
    assert.ok(
      human.indexOf('## Old Testament Anchors') < human.indexOf('### Jacob have I loved'),
      'cards inside a section should appear under that section heading',
    );
  });

  it('throws a descriptive error when the embedded data block is missing', () => {
    assert.throws(
      () => parseKnowledgeWebMarkdown('# Just a regular markdown file\n\nNo board here.'),
      /No Berean knowledge web data found/,
    );
  });

  it('throws when the embedded JSON is corrupted', () => {
    const broken = '# Title\n\n<!-- BEREAN_KNOWLEDGE_WEB:BEGIN\n{ not json\nBEREAN_KNOWLEDGE_WEB:END -->\n';
    assert.throws(() => parseKnowledgeWebMarkdown(broken), /corrupted/);
  });

  it('round-trips even when card content contains the framing markers (collision safety)', () => {
    const tricky = {
      web: { title: 'Adversarial' },
      cards: [
        {
          id: 'c1',
          title: 'A card whose body literally types BEREAN_KNOWLEDGE_WEB:END --> in it',
          description:
            '<p>Here is some text mentioning <!-- BEREAN_KNOWLEDGE_WEB:BEGIN fake stuff BEREAN_KNOWLEDGE_WEB:END --> as if it were a comment.</p>',
          x: 0,
          y: 0,
        },
      ],
      connections: [],
      canvasObjects: [],
    };
    const md = buildKnowledgeWebMarkdown(tricky);
    const parsed = parseKnowledgeWebMarkdown(md);
    assert.equal(parsed.cards.length, 1);
    assert.equal(parsed.cards[0].id, 'c1');
    assert.match(parsed.cards[0].description, /BEREAN_KNOWLEDGE_WEB:END/);
  });

  it('also accepts a manually-edited file with raw JSON in the embedded block (forward-compat)', () => {
    const rawJsonPayload = JSON.stringify({
      format: 'berean-knowledge-web',
      version: 1,
      web: { title: 'Manual' },
      cards: [{ id: 'm1', title: 'Hand-typed', x: 0, y: 0 }],
      connections: [],
      canvasObjects: [],
    });
    const md = `# Manual\n\n<!-- BEREAN_KNOWLEDGE_WEB:BEGIN\n${rawJsonPayload}\nBEREAN_KNOWLEDGE_WEB:END -->\n`;
    const parsed = parseKnowledgeWebMarkdown(md);
    assert.equal(parsed.cards[0].id, 'm1');
    assert.equal(parsed.formatVersion, 1);
  });

  it('falls back to an earlier valid block if a later one is corrupted (resilient parser)', () => {
    // Real-world scenario: a manually-edited file where someone added a fake
    // marker block above the genuine one (or the genuine one got truncated).
    // The parser walks last-to-first and accepts the first valid candidate.
    const goodPayload = JSON.stringify({
      format: 'berean-knowledge-web',
      version: 1,
      web: { title: 'Real' },
      cards: [{ id: 'real', title: 'Real card', x: 0, y: 0 }],
      connections: [],
      canvasObjects: [],
    });
    const md =
      `# Mixed\n\n` +
      `<!-- BEREAN_KNOWLEDGE_WEB:BEGIN\n${goodPayload}\nBEREAN_KNOWLEDGE_WEB:END -->\n` +
      `\n## Some notes someone added later\n\n` +
      `<!-- BEREAN_KNOWLEDGE_WEB:BEGIN\nnot json at all\nBEREAN_KNOWLEDGE_WEB:END -->\n`;
    const parsed = parseKnowledgeWebMarkdown(md);
    assert.equal(parsed.cards[0].id, 'real');
  });

  it('throws when the format/version markers do not match', () => {
    const wrongVersion = JSON.stringify({ format: 'berean-knowledge-web', version: 99, web: {}, cards: [], connections: [] });
    const md = `# Title\n\n<!-- BEREAN_KNOWLEDGE_WEB:BEGIN\n${wrongVersion}\nBEREAN_KNOWLEDGE_WEB:END -->\n`;
    assert.throws(() => parseKnowledgeWebMarkdown(md), /unrecognized format\/version/);
  });

  it('htmlToMarkdown converts common TipTap formatting correctly', () => {
    assert.equal(htmlToMarkdown('<p>Hello <strong>world</strong>.</p>').trim(), 'Hello **world**.');
    assert.equal(htmlToMarkdown('<p>One</p><p>Two</p>').trim(), 'One\n\nTwo');
    assert.equal(htmlToMarkdown('<ul><li>a</li><li>b</li></ul>').trim(), '- a\n- b');
    assert.equal(htmlToMarkdown('<a href="https://x.com">x</a>').trim(), '[x](https://x.com)');
    assert.equal(htmlToMarkdown('<em>i</em>').trim(), '_i_');
    assert.equal(htmlToMarkdown(''), '');
    assert.equal(htmlToMarkdown(null), '');
  });

  it('strips internal/created fields from the embedded payload', () => {
    const board = {
      web: { title: 'T' },
      cards: [{ id: 'c1', title: 'a', created_date: '2024-01-01', updated_date: '2024-01-02', created_by: 'u', x: 0, y: 0 }],
      connections: [{ id: 'e1', from_card_id: 'c1', to_card_id: 'c1', created_date: 'x', updated_date: 'y', created_by: 'z' }],
      canvasObjects: [{ id: 'o1', object_type: 'point', x: 10, y: 20, created_date: 'x' }],
    };
    const md = buildKnowledgeWebMarkdown(board);
    const parsed = parseKnowledgeWebMarkdown(md);
    assert.equal(parsed.cards[0].created_date, undefined);
    assert.equal(parsed.cards[0].updated_date, undefined);
    assert.equal(parsed.cards[0].created_by, undefined);
    // Connection internal id is also stripped, mirroring the .berean exporter.
    assert.equal(parsed.connections[0].id, undefined);
    assert.equal(parsed.canvasObjects[0].id, 'o1');
    assert.equal(parsed.canvasObjects[0].created_date, undefined);
  });
});

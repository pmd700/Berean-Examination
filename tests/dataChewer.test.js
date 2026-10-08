import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ChewProposal from '../src/components/brain/ChewProposal.jsx';

// Render-level guard for the Data Chewer "review & commit" UI (Step 6).
// ChewProposal is the GitHub-PR-style review panel shown inline in Brain Chat
// after the existing source AI pipeline runs. These tests pin:
//   • the proposal renders cards/connections/tags from ai_processing_v1
//   • per-item Accept/Reject controls + a Commit button are present
//   • the "nothing committed until you commit" guardrail copy is present
//   • the changelog preview + sections (warnings/duplicates) render
//   • an analysis failure degrades gracefully instead of crashing
//
// Rendered via react-dom/server (no JSDOM / extra devDeps), matching the
// existing exportMenu.test.js approach.

function render(m, extra = {}) {
  return renderToStaticMarkup(React.createElement(ChewProposal, { m, idx: 0, ...extra }));
}

const sampleProposal = {
  summary: 'A short faithful summary of the pasted material.',
  confidence: 'medium',
  possible_card_drafts: [
    { title: 'Imputed Righteousness', description: 'Central claim.', tags: ['justification', 'soteriology'], reason_this_card_matters: 'repeated across the text' },
    { title: 'Union with Christ', description: '', tags: ['soteriology'] },
  ],
  possible_connection_drafts: [
    { from_title: 'Imputed Righteousness', to_title: 'Union with Christ', relationship_type: 'supports', label: 'grounds', reason_this_connection_matters: 'linked argument' },
  ],
  warnings: ['One reference could not be verified.'],
};

const sampleMeta = {
  id: 42, title: 'Pasted sermon notes', source_type: 'sermon', web_id: 7, raw_text_chars: 1234,
};

describe('ChewProposal (Data Chewer Phase 1)', () => {
  it('renders the proposal shell with confidence and preview banner', () => {
    const html = render({ kind: 'chew', proposal: sampleProposal, sourceMeta: sampleMeta });
    assert.match(html, /data-testid="chew-proposal-0"/);
    assert.match(html, /Proposed changes/);
    assert.match(html, /confidence: medium/);
  });

  it('renders card drafts, connection drafts, and tags', () => {
    const html = render({ kind: 'chew', proposal: sampleProposal, sourceMeta: sampleMeta });
    assert.match(html, /data-testid="chew-card-0-0"/);
    assert.match(html, /Imputed Righteousness/);
    assert.match(html, /data-testid="chew-connection-0-0"/);
    assert.match(html, /supports/);
    assert.match(html, /justification/);
  });

  it('shows source context metadata', () => {
    const html = render({ kind: 'chew', proposal: sampleProposal, sourceMeta: sampleMeta });
    assert.match(html, /Source #42/);
    assert.match(html, /sermon/);
    assert.match(html, /web #7/);
  });

  it('shows the guardrail footer and commit control', () => {
    const html = render({ kind: 'chew', proposal: sampleProposal, sourceMeta: sampleMeta });
    assert.match(html, /data-testid="chew-footer-0"/);
    assert.match(html, /Nothing is added to your Knowledge Web until you commit/);
    assert.match(html, /data-testid="chew-commit-0"/);
    assert.match(html, /Commit accepted changes/);
  });

  it('renders per-item Accept/Reject controls', () => {
    const html = render({ kind: 'chew', proposal: sampleProposal, sourceMeta: sampleMeta });
    assert.match(html, /data-testid="chew-card-reject-0-0"/);
    assert.match(html, /data-testid="chew-connection-reject-0-0"/);
    assert.match(html, /data-testid="chew-accept-all-0"/);
    assert.match(html, /data-testid="chew-reject-all-0"/);
  });

  it('renders a changelog preview reflecting the accepted counts', () => {
    const html = render({ kind: 'chew', proposal: sampleProposal, sourceMeta: sampleMeta }, { targetWebId: 7, targetWebName: 'Romans' });
    assert.match(html, /data-testid="chew-changelog-0"/);
    assert.match(html, /2 card\(s\) to add/);
    assert.match(html, /1 connection\(s\) to add/);
    assert.match(html, /target: Romans/);
  });

  it('flags possible duplicate cards within the batch', () => {
    const dupProposal = {
      ...sampleProposal,
      possible_card_drafts: [
        { title: 'Grace', description: 'one', tags: [] },
        { title: 'grace', description: 'two', tags: [] },
      ],
      possible_connection_drafts: [],
    };
    const html = render({ kind: 'chew', proposal: dupProposal, sourceMeta: sampleMeta });
    assert.match(html, /data-testid="chew-duplicates-0"/);
    assert.match(html, /possible duplicate/i);
  });

  it('renders warnings when present', () => {
    const html = render({ kind: 'chew', proposal: sampleProposal, sourceMeta: sampleMeta });
    assert.match(html, /data-testid="chew-warnings-0"/);
    assert.match(html, /could not be verified/);
  });

  it('degrades gracefully when analysis failed (no proposal)', () => {
    const html = render({ kind: 'chew', proposal: null, procError: { message: 'AI upstream error' } });
    assert.match(html, /data-testid="chew-proposal-0"/);
    assert.match(html, /couldn.{1,8}analyze/i);
    assert.match(html, /AI upstream error/);
    assert.match(html, /Nothing was added to your graph/);
  });

  it('handles an empty-but-successful analysis (no drafts)', () => {
    const html = render({ kind: 'chew', proposal: { summary: 'x', possible_card_drafts: [], possible_connection_drafts: [], warnings: [] }, sourceMeta: sampleMeta });
    assert.match(html, /data-testid="chew-no-drafts-0"/);
    assert.match(html, /didn.{1,8}surface any card or connection drafts/);
  });
});

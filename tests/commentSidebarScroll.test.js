import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('comment sidebar scroll ownership', () => {
  it('wires an in-flow spacer into both editor overflow modes', () => {
    const editor = read('src/components/editor/TEXT_EDITOR_MACHINERY.jsx');
    assert.match(editor, /tailSpacerRef=\{commentTailSpacerRef\}/);
    assert.equal(
      (editor.match(/data-comment-tail-spacer/g) || []).length,
      2,
      'both the ordinary and fill-height editors need the comment tail spacer',
    );
  });

  it('measures overflow from the writing bottom, not from the spacer itself', () => {
    const sidebar = read('src/components/editor/CommentSidebar.jsx');
    assert.match(sidebar, /editor\.view\.dom\.getBoundingClientRect\(\)\.bottom/);
    assert.match(sidebar, /finalBottom - contentBottom \+ TAIL_GAP/);
  });

  it('keeps one viewport of natural reading runway unless comments need more', () => {
    const sidebar = read('src/components/editor/CommentSidebar.jsx');
    const editor = read('src/components/editor/TEXT_EDITOR_MACHINERY.jsx');
    assert.match(sidebar, /scrollViewportHeight\(spacer\)/);
    assert.match(sidebar, /spacer\.dataset\.scrollPastEnd === 'true'/);
    assert.match(sidebar, /Math\.max\(0, Math\.ceil\(naturalHeight\), Math\.ceil\(commentHeight\)\)/);
    assert.match(editor, /data-scroll-past-end=\{scrollPastEnd \? 'true' : 'false'\}/);
  });

  it('keeps long comments collapsed until the reader expands them', () => {
    const sidebar = read('src/components/editor/CommentSidebar.jsx');
    assert.match(sidebar, /COLLAPSED_BODY_HEIGHT = 120/);
    assert.match(sidebar, /aria-expanded=\{isExpanded\}/);
    assert.match(sidebar, /isExpanded \? 'Show less' : 'Show more'/);
  });
});

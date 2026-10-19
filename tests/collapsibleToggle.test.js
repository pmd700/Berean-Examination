import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Disclosure-triangle behaviour.
 *
 * `toggleHasContent` is the pure rule behind the triangle's colour and is tested
 * directly against ProseMirror-shaped nodes. The rest are source assertions: the
 * triangle's geometry and the collapsed-on-creation default are both single
 * values whose regression would be silent and immediately visible to the user,
 * and neither can be exercised without a DOM and a live editor.
 */

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(
  path.join(root, 'src/components/editor/CollapsibleToggleExtension.js'),
  'utf8',
);
const editorCss = fs.readFileSync(
  path.join(root, 'src/components/editor/TEXT_EDITOR_MACHINERY.jsx'),
  'utf8',
);

// Minimal stand-ins for the ProseMirror nodes the helper reads.
const textblock = (size) => ({ isTextblock: true, content: { size } });
const toggle = (children) => ({
  lastChild: { childCount: children.length, firstChild: children[0] ?? null },
});

describe('disclosure triangle', () => {
  it('reads an empty toggle as having no content', async () => {
    const { toggleHasContent } = await import('../src/components/editor/CollapsibleToggleExtension.js');
    // The body always carries one empty paragraph, so that is the created state,
    // not content. Counting it would make every new toggle look full.
    assert.equal(toggleHasContent(toggle([textblock(0)])), false);
    assert.equal(toggleHasContent(toggle([])), false);
  });

  it('reads a toggle with text as having content', async () => {
    const { toggleHasContent } = await import('../src/components/editor/CollapsibleToggleExtension.js');
    assert.equal(toggleHasContent(toggle([textblock(12)])), true);
  });

  it('reads more than one child as content, even if the first is empty', async () => {
    const { toggleHasContent } = await import('../src/components/editor/CollapsibleToggleExtension.js');
    assert.equal(toggleHasContent(toggle([textblock(0), textblock(0)])), true);
  });

  it('treats a non-textblock child as content', async () => {
    const { toggleHasContent } = await import('../src/components/editor/CollapsibleToggleExtension.js');
    // An image or a nested toggle has no `content.size` to inspect.
    assert.equal(toggleHasContent(toggle([{ isTextblock: false }])), true);
  });

  it('survives a missing or malformed node', async () => {
    const { toggleHasContent } = await import('../src/components/editor/CollapsibleToggleExtension.js');
    assert.equal(toggleHasContent(null), false);
    assert.equal(toggleHasContent({}), false);
  });

  it('draws a solid triangle, not a stroked V', () => {
    // A filled path: a 2.5px stroke at 11px rendered as two grey smudges.
    assert.match(source, /<path d="M[\d. ]+L[\d. ]+L[\d. ]+Z" fill="currentColor"/);
    assert.equal(/polyline/.test(source), false, 'the stroked chevron is still being drawn');
  });

  it('creates toggles collapsed', () => {
    const openAttr = source.slice(source.indexOf('open: {'), source.indexOf('parseHTML:'));
    assert.match(openAttr, /default: false/);
  });

  it('still round-trips an open toggle through HTML', () => {
    // Collapsing the default must not reopen or close saved documents: an open
    // toggle serialises `open=""` and parses back as open.
    assert.match(source, /parseHTML: \(element\) => element\.hasAttribute\('open'\)/);
    assert.match(source, /renderHTML: \(\{ open \}\) => \(open \? \{ open: '' \} : \{\}\)/);
  });

  it('rotates its triangle from the node view, which owns the open state', () => {
    // Driven inline rather than by a descendant CSS rule, so the rotation cannot
    // fall out of step with the class or lose a specificity fight.
    assert.match(source, /chevron\.style\.transform = open \? 'rotate\(90deg\)' : 'rotate\(0deg\)'/);
    assert.match(source, /chevron\.style\.transform = startOpen \? 'rotate\(90deg\)'/);
  });

  it('still rotates in read-only rendering, where there is no node view', () => {
    // Direct child, so a closed toggle nested in an open one keeps its own
    // triangle pointing right.
    assert.match(editorCss, /details\.toggle-block\[open\] > \.toggle-block__chevron\s*\{\s*transform: rotate\(90deg\)/);
  });

  it('leaves room for a nested triangle the clipping body would cut off', () => {
    // The body must clip to animate its height, and a triangle sits 22px out in
    // the gutter, so a nested toggle lost its control entirely.
    assert.match(editorCss, /\.toggle-block__body > \.toggle-block \{[^}]*padding-left: 22px/s);
    assert.match(editorCss, /\.toggle-block__body > \.toggle-block > \.toggle-block__chevron \{\s*left: 0/);
  });

  it('does not add a second indent to lists directly inside a toggle', () => {
    assert.ok(editorCss.includes(`.ProseMirror .toggle-block__body > ol,
        .ProseMirror .toggle-block__body > ul {
          padding-left: 0;
          list-style-position: inside;
        }`));
    assert.ok(editorCss.includes(`details.toggle-block > div[data-type="detailsContent"] > ol,
        details.toggle-block > div[data-type="detailsContent"] > ul {
          padding-left: 0;
          list-style-position: inside;
        }`));
  });

  it('keeps an inside marker on the same line as its TipTap paragraph', () => {
    assert.match(
      editorCss,
      /\.toggle-block__body > ul > li > p:first-child \{\s*display: inline;/,
    );
    assert.match(
      editorCss,
      /details\.toggle-block > div\[data-type="detailsContent"\] > ul > li > p:first-child \{\s*display: inline;/,
    );
  });

  it('brightens the triangle only once the toggle holds something', () => {
    assert.match(editorCss, /\.toggle-block\.has-content > \.toggle-block__chevron/);
  });
});

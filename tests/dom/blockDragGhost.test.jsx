import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { cleanGhostClone, ghostPlacement, GHOST_MAX_BLOCKS } from '@/components/editor/BlockDragExtension';

/**
 * What the page looks like while you are carrying a block.
 *
 * The old ghost was a 12px dark card holding the blocks' text — a tooltip
 * *about* the paragraph rather than the paragraph itself. Notion lifts the real
 * block: same width, same type, just faded. These cover the two halves of that
 * — the clone, and where it sits — plus the styling, which is the whole point
 * of the change and would otherwise regress unnoticed.
 */

const css = fs.readFileSync(
  path.join(path.resolve(import.meta.dirname, '../..'), 'src/index.css'),
  'utf8',
);
const ghostCss = css.slice(css.indexOf('.bex-block-drag-ghost {'), css.indexOf('.bex-block-drag-ghost__more'));

let host;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => host.remove());

function liveBlock(html) {
  host.innerHTML = html;
  return host.firstElementChild;
}

describe('the clone that gets carried', () => {
  it('keeps the block markup, so it still looks like itself', () => {
    const block = liveBlock('<p>Matthew 12 and Mark 3 are the <strong>same scene</strong></p>');
    const clone = cleanGhostClone(block);

    expect(clone.tagName).toBe('P');
    expect(clone.textContent).toBe('Matthew 12 and Mark 3 are the same scene');
    expect(clone.querySelector('strong')).toBeTruthy();
  });

  it('keeps a heading a heading rather than flattening it to text', () => {
    const clone = cleanGhostClone(liveBlock('<h3>THST Jesus only spoke about this</h3>'));
    expect(clone.tagName).toBe('H3');
  });

  it('keeps a list a list', () => {
    const clone = cleanGhostClone(liveBlock('<ul><li><p>12:4-7</p></li><li><p>12:8-9</p></li></ul>'));
    expect(clone.tagName).toBe('UL');
    expect(clone.querySelectorAll('li')).toHaveLength(2);
  });

  it('strips the selection styling, so the ghost reads as lifted and not selected', () => {
    const block = liveBlock('<p class="bex-draggable-block bex-block-selected bex-item-box">Selected line</p>');
    const clone = cleanGhostClone(block);

    expect(clone.classList.contains('bex-block-selected')).toBe(false);
    expect(clone.classList.contains('bex-item-box')).toBe(false);
    // The block class itself stays: the editor's own layout rules key on it.
    expect(clone.classList.contains('bex-draggable-block')).toBe(true);
  });

  it('strips the selection styling from nested blocks too', () => {
    const block = liveBlock('<div><p class="bex-item-box bex-block-selected">Inner</p></div>');
    const clone = cleanGhostClone(block);
    const inner = clone.querySelector('p');
    expect(inner.classList.contains('bex-item-box')).toBe(false);
    expect(inner.classList.contains('bex-block-selected')).toBe(false);
  });

  it('is not editable, so it cannot take the caret away from the document', () => {
    const block = liveBlock('<p contenteditable="true"><span contenteditable="true">Editable</span></p>');
    const clone = cleanGhostClone(block);
    expect(clone.hasAttribute('contenteditable')).toBe(false);
    expect(clone.querySelector('[contenteditable]')).toBeNull();
  });

  it('carries no ids, which would otherwise exist twice in the page', () => {
    // A toggle's chevron points at its body by id; a duplicate silently steals
    // every lookup and every aria-controls that resolves it.
    const block = liveBlock('<div id="toggle-1"><div id="toggle-body-1">Body</div></div>');
    const clone = cleanGhostClone(block);
    expect(clone.hasAttribute('id')).toBe(false);
    expect(clone.querySelector('[id]')).toBeNull();
  });

  it('does not disturb the block it copied', () => {
    const block = liveBlock('<p id="keep" class="bex-item-box" contenteditable="true">Original</p>');
    cleanGhostClone(block);
    expect(block.id).toBe('keep');
    expect(block.classList.contains('bex-item-box')).toBe(true);
    expect(block.getAttribute('contenteditable')).toBe('true');
  });
});

describe('where the lifted block sits', () => {
  const rect = (left, top, width) => ({ left, top, width });

  it('matches the block width, so the clone wraps exactly where the original does', () => {
    const placement = ghostPlacement([rect(544, 420, 916)], { clientX: 560, clientY: 434 });
    expect(placement.width).toBe(916);
  });

  it('keeps the grab point, so the block lifts in place instead of jumping', () => {
    // Grabbed 16px in and 14px down; the clone has to stay under that spot.
    const placement = ghostPlacement([rect(544, 420, 916)], { clientX: 560, clientY: 434 });
    expect(placement.offsetX).toBe(16);
    expect(placement.offsetY).toBe(14);
  });

  it('spans the whole run when several blocks are carried', () => {
    const placement = ghostPlacement(
      [rect(544, 420, 700), rect(544, 460, 916), rect(560, 500, 500)],
      { clientX: 570, clientY: 430 },
    );
    expect(placement.left).toBe(544);
    expect(placement.top).toBe(420);
    // The widest, so no line in the run is forced to rewrap.
    expect(placement.width).toBe(916);
    expect(placement.offsetY).toBe(10);
  });

  it('has nothing to place when nothing was picked up', () => {
    expect(ghostPlacement([], { clientX: 0, clientY: 0 })).toBeNull();
    expect(ghostPlacement(undefined, { clientX: 0, clientY: 0 })).toBeNull();
  });

  it('caps how many blocks are cloned', () => {
    // Carrying a whole page would build a second copy of the document.
    expect(GHOST_MAX_BLOCKS).toBeGreaterThan(1);
    expect(GHOST_MAX_BLOCKS).toBeLessThanOrEqual(12);
  });
});

describe('the ghost styling', () => {
  it('paints no card of its own', () => {
    // Every one of these is what made it read as a little black box.
    expect(ghostCss).not.toMatch(/\bbackground:/);
    expect(ghostCss).not.toMatch(/\bborder:/);
    expect(ghostCss).not.toMatch(/box-shadow:/);
    expect(ghostCss).not.toMatch(/border-radius:/);
  });

  it('imposes no type size of its own, so the clone keeps the editor’s', () => {
    expect(ghostCss).not.toMatch(/font-size:/);
    expect(ghostCss).not.toMatch(/max-width:/);
    expect(ghostCss).not.toMatch(/white-space:/);
  });

  it('is faded rather than solid', () => {
    const visible = css.slice(css.indexOf('.bex-block-drag-ghost.is-visible'));
    const opacity = Number(visible.match(/opacity:\s*([\d.]+)/)?.[1]);
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(0.7);
  });

  it('undoes the editing-surface rules the .ProseMirror wrapper drags in', () => {
    // Without this the ghost is 150px tall no matter how short the block is.
    expect(css).toMatch(/\.bex-block-drag-ghost__surface\.ProseMirror \{[^}]*min-height: 0/s);
    expect(css).toMatch(/\.bex-block-drag-ghost__surface \> :first-child \{\s*margin-top: 0/);
  });
});

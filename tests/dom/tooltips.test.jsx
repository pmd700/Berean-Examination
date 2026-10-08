import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Tooltip, {
  TOOLTIP_BADGE_CLASS,
  TOOLTIP_CLASS,
  TOOLTIP_OPEN_EVENT,
  collectTooltips,
  getTooltipState,
} from '@/components/editor/TooltipExtension';
import { TOOLTIP_SHORTCUT_REQUEST, requestTooltipShortcut } from '@/lib/tooltipShortcut';

/**
 * Tooltips: an aside attached to a phrase that leaves no mark on the page.
 *
 * Three things are worth guarding. That the text itself carries no standing
 * decoration — the moment a tooltip starts tinting or underlining its words it
 * has become a comment. That the ⓘ marking it is nevertheless there, exactly
 * once, so the aside is never something you have to go hunting for. And that ⌘T
 * is only taken away from "new tab" when there is genuinely a selection to
 * annotate.
 */

let editor;
let host;

function mount(content = '<p>the Second Temple era</p>') {
  host = document.createElement('div');
  document.body.appendChild(host);
  editor = new Editor({ element: host, extensions: [StarterKit, Tooltip], content });
  return editor;
}

afterEach(() => { editor?.destroy(); host?.remove(); });
beforeEach(() => { editor = null; host = null; });

const selectPhrase = () => editor.commands.setTextSelection({ from: 5, to: 18 });

describe('raising a tooltip', () => {
  it('marks the selected phrase and opens it for writing', () => {
    mount();
    selectPhrase();
    expect(editor.commands.addTooltip()).toBe(true);

    const [tooltip] = collectTooltips(editor.state.doc);
    expect(tooltip.quote).toBe('Second Temple');
    expect(getTooltipState(editor.state).draftId).toBe(tooltip.id);
  });

  it('refuses to annotate nothing', () => {
    mount();
    editor.commands.setTextSelection(5);
    expect(editor.commands.addTooltip()).toBe(false);
    expect(collectTooltips(editor.state.doc)).toHaveLength(0);
  });

  it('reopens the tooltip already on a phrase instead of stacking a second', () => {
    mount();
    selectPhrase();
    editor.commands.addTooltip();
    const [first] = collectTooltips(editor.state.doc);
    editor.commands.updateTooltip(first.id, '<p>Between the testaments.</p>');

    selectPhrase();
    editor.commands.addTooltip();

    const tooltips = collectTooltips(editor.state.doc);
    expect(tooltips).toHaveLength(1);
    expect(tooltips[0].id).toBe(first.id);
    expect(getTooltipState(editor.state).draftId).toBe(first.id);
  });

  it('keeps its body inside the note, through a save and reload', () => {
    mount();
    selectPhrase();
    editor.commands.addTooltip();
    editor.commands.updateTooltip(collectTooltips(editor.state.doc)[0].id, '<p>Between the testaments.</p>');
    const saved = editor.getHTML();

    editor.destroy();
    host.remove();
    mount(saved);

    expect(collectTooltips(editor.state.doc)[0].text).toBe('<p>Between the testaments.</p>');
  });

  it('leaves the words untouched when the tooltip is removed', () => {
    mount();
    selectPhrase();
    editor.commands.addTooltip();
    editor.commands.removeTooltip(collectTooltips(editor.state.doc)[0].id);

    expect(editor.state.doc.textContent).toBe('the Second Temple era');
    expect(editor.getHTML()).not.toContain('data-tooltip-id');
  });
});

describe('the page it is written on', () => {
  it('draws no highlight, underline or zone around the text', () => {
    mount();
    selectPhrase();
    editor.commands.addTooltip();

    const span = host.querySelector(`span.${TOOLTIP_CLASS}`);
    expect(span).not.toBeNull();
    // A comment renders a title attribute and is painted by a decoration; a
    // tooltip must carry neither, or the two features look the same.
    expect(span.getAttribute('title')).toBeNull();
    expect(host.querySelector('.bex-comment')).toBeNull();
  });

  it('marks the phrase with a single ⓘ', () => {
    mount();
    selectPhrase();
    editor.commands.addTooltip();

    const badges = host.querySelectorAll(`.${TOOLTIP_BADGE_CLASS}`);
    expect(badges).toHaveLength(1);
    expect(badges[0].getAttribute('data-tooltip-badge')).toBe(collectTooltips(editor.state.doc)[0].id);
  });

  it('shows one ⓘ for a phrase whose formatting splits the mark in two', () => {
    mount();
    selectPhrase();
    editor.commands.addTooltip();
    // Bolding half of it breaks the mark into two spans in the rendered DOM.
    editor.commands.setTextSelection({ from: 5, to: 11 });
    editor.commands.toggleBold();

    expect(host.querySelectorAll(`span.${TOOLTIP_CLASS}`).length).toBeGreaterThan(1);
    expect(host.querySelectorAll(`.${TOOLTIP_BADGE_CLASS}`)).toHaveLength(1);
  });

  it('opens the aside when the ⓘ is pressed', () => {
    mount();
    selectPhrase();
    editor.commands.addTooltip();
    const [tooltip] = collectTooltips(editor.state.doc);
    editor.commands.clearTooltipDraft();
    editor.commands.setActiveTooltip(null);

    const seen = [];
    editor.view.dom.addEventListener(TOOLTIP_OPEN_EVENT, event => seen.push(event.detail.id));

    host.querySelector(`.${TOOLTIP_BADGE_CLASS}`).dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    expect(seen).toEqual([tooltip.id]);
    expect(getTooltipState(editor.state).activeId).toBe(tooltip.id);
  });

  it('takes its ⓘ away with it when the tooltip is removed', () => {
    mount();
    selectPhrase();
    editor.commands.addTooltip();
    editor.commands.removeTooltip(collectTooltips(editor.state.doc)[0].id);

    expect(host.querySelectorAll(`.${TOOLTIP_BADGE_CLASS}`)).toHaveLength(0);
  });

  it('opens when the marked text is pressed', () => {
    mount();
    selectPhrase();
    editor.commands.addTooltip();
    const [tooltip] = collectTooltips(editor.state.doc);
    editor.commands.clearTooltipDraft();
    editor.commands.setActiveTooltip(null);

    const seen = [];
    editor.view.dom.addEventListener(TOOLTIP_OPEN_EVENT, event => seen.push(event.detail.id));

    const handled = editor.view.someProp(
      'handleClick',
      handler => handler(editor.view, 8, new MouseEvent('click')),
    );

    expect(handled).toBe(true);
    expect(seen).toEqual([tooltip.id]);
    expect(getTooltipState(editor.state).activeId).toBe(tooltip.id);
  });

  it('closes again when the reader presses elsewhere', () => {
    mount();
    selectPhrase();
    editor.commands.addTooltip();
    editor.commands.setActiveTooltip(collectTooltips(editor.state.doc)[0].id);

    editor.view.someProp('handleClick', handler => handler(editor.view, 2, new MouseEvent('click')));
    expect(getTooltipState(editor.state).activeId).toBeNull();
  });
});

describe('sharing ⌘T with "new tab"', () => {
  it('reports the key as unclaimed when no editor wants it', () => {
    expect(requestTooltipShortcut()).toBe(false);
  });

  it('reports it as claimed once an editor takes it', () => {
    const claim = (event) => event.preventDefault();
    window.addEventListener(TOOLTIP_SHORTCUT_REQUEST, claim);
    try {
      expect(requestTooltipShortcut()).toBe(true);
    } finally {
      window.removeEventListener(TOOLTIP_SHORTCUT_REQUEST, claim);
    }
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { CollapsibleToggle, ToggleSummary, ToggleContent } from '@/components/editor/CollapsibleToggleExtension';
import { FindInEditor, getFindState } from '@/components/editor/findInEditor';
import { SpotlightJourney, closedSpotlightSections, spotlightMatch, startEditorSpotlight } from '@/components/editor/spotlightJourney';
import { startFieldSpotlight } from '@/lib/spotlightMotion';

let editor;
let host;
let trip;
const originalRangeRect = Range.prototype.getBoundingClientRect;
const toggle = (title, body, open = false) => `<details ${open ? 'open' : ''}><summary>${title}</summary><div data-type="detailsContent">${body}</div></details>`;

function mount(html) {
  host = document.createElement('div');
  document.body.append(host);
  editor = new Editor({
    element: host,
    extensions: [StarterKit, CollapsibleToggle, ToggleSummary, ToggleContent, FindInEditor, SpotlightJourney],
    content: html,
  });
}
const advance = ms => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  trip?.cancel();
  await trip?.finished;
  editor?.destroy();
  host?.remove();
  trip = editor = host = null;
  if (originalRangeRect) Range.prototype.getBoundingClientRect = originalRangeRect;
  else delete Range.prototype.getBoundingClientRect;
  vi.useRealTimers();
});

describe('search arrival through the shared editor', () => {
  it('opens nested dropdowns in order, then highlights just the destination and fades', async () => {
    mount(toggle('Outer', toggle('Inner', '<p>The <strong>conscience</strong> speaks.</p>')));
    const sections = [...host.querySelectorAll('.toggle-block')];
    const originalText = editor.state.doc.textContent;
    trip = startEditorSpotlight(editor, 'conscience');
    expect(sections.every(section => !section.classList.contains('is-open'))).toBe(true);
    await advance(100);
    expect(sections[0].classList.contains('is-open')).toBe(true);
    expect(sections[1].classList.contains('is-open')).toBe(false);
    expect(host.querySelector('.bex-spotlight-hit')).toBeNull();
    await advance(260);
    expect(sections[1].classList.contains('is-open')).toBe(true);
    expect(host.querySelector('.bex-spotlight-hit')).toBeNull();
    await advance(300);
    expect(host.querySelector('.bex-spotlight-hit')?.textContent).toBe('conscience');
    expect(editor.state.doc.textContent).toBe(originalText);
    expect(editor.getHTML()).not.toContain('bex-spotlight-hit');
    expect(editor.getHTML()).toContain('<strong>conscience</strong>');
    await advance(2250);
    expect(host.querySelector('.bex-spotlight-hit--fading')).toBeTruthy();
    await advance(700);
    expect(host.querySelector('.bex-spotlight-hit')).toBeNull();
    expect(await trip.finished).toBe(true);
  });

  it('scrolls over multiple frames BEFORE opening the closed dropdown', async () => {
    mount(toggle('Far away', '<p>Destination</p>'));
    host.style.overflowY = 'auto';
    Object.defineProperties(host, { clientHeight: { value: 500 }, scrollHeight: { value: 4000 } });
    host.getBoundingClientRect = () => ({ top: 0 });
    const section = host.querySelector('.toggle-block');
    section.querySelector('summary').getBoundingClientRect = () => ({ top: 2000 - host.scrollTop });
    // jsdom has no text layout; the destination sits 80px below the summary.
    Range.prototype.getBoundingClientRect = () => ({ top: 2080 - host.scrollTop });
    trip = startEditorSpotlight(editor, 'Destination');
    await advance(200);
    expect(host.scrollTop).toBeGreaterThan(0);
    expect(host.scrollTop).toBeLessThan(1800);
    expect(section.classList.contains('is-open')).toBe(false);
    await advance(700);
    expect(host.scrollTop).toBeCloseTo(1800, 0);
    expect(section.classList.contains('is-open')).toBe(true);
    expect(host.querySelector('.bex-spotlight-hit')).toBeNull();
    await advance(900);
    expect(host.querySelector('.bex-spotlight-hit')).toBeTruthy();
  });

  it('does not open the dropdown when the summary itself matched', async () => {
    mount(toggle('Conscience', '<p>Hidden</p>'));
    expect(closedSpotlightSections(editor.state.doc, spotlightMatch(editor.state.doc, 'Conscience').from)).toEqual([]);
    const original = editor.getHTML();
    trip = startEditorSpotlight(editor, 'Conscience');
    await advance(150);
    expect(host.querySelector('.toggle-block').classList.contains('is-open')).toBe(false);
    expect(host.querySelector('.bex-spotlight-hit').textContent).toBe('Conscience');
    expect(editor.getHTML()).toBe(original);
  });

  it('keeps ordinary Cmd+F results, the caret, and saved marks unchanged', async () => {
    mount('<p>Living <em>conscience</em> and conscience.</p>');
    editor.commands.setFindTerm('Living');
    const selection = editor.state.selection.toJSON();
    const original = editor.getHTML();
    trip = startEditorSpotlight(editor, 'conscience');
    await advance(200);
    expect(host.querySelectorAll('.bex-spotlight-hit')).toHaveLength(1);
    expect(getFindState(editor.state).term).toBe('Living');
    expect(editor.state.selection.toJSON()).toEqual(selection);
    await advance(3200);
    expect(getFindState(editor.state).term).toBe('Living');
    expect(editor.getHTML()).toBe(original);
  });

  it.each(['wheel', 'pointerdown', 'keydown', 'touchstart'])('cancels immediately on %s without opening deeper sections', async eventName => {
    mount(toggle('Outer', toggle('Inner', '<p>Destination</p>')));
    trip = startEditorSpotlight(editor, 'Destination');
    await advance(100);
    window.dispatchEvent(new Event(eventName));
    await advance(4000);
    expect(host.querySelectorAll('.toggle-block.is-open')).toHaveLength(1);
    expect(host.querySelector('.bex-spotlight-hit')).toBeNull();
    expect(await trip.finished).toBe(false);
  });

  it('stops on an edit so a stale position cannot highlight different text', async () => {
    mount('<p>Destination</p>');
    trip = startEditorSpotlight(editor, 'Destination');
    await advance(100);
    editor.commands.insertContent('New ');
    await advance(100);
    expect(host.querySelector('.bex-spotlight-hit')).toBeNull();
    expect(await trip.finished).toBe(false);
  });

  it('handles phrases across formatting boundaries and fallback search terms', () => {
    mount('<p>The living <strong>word</strong> endures.</p>');
    const phrase = spotlightMatch(editor.state.doc, 'living word');
    expect(editor.state.doc.textBetween(phrase.from, phrase.to)).toBe('living word');
    expect(spotlightMatch(editor.state.doc, 'missing word')).toMatchObject({ from: 12, to: 16 });
    expect(spotlightMatch(editor.state.doc, 'absent')).toBeNull();
  });

  it('respects reduced motion while still revealing and identifying the match', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true });
    mount(toggle('Outer', toggle('Inner', '<p>Destination</p>')));
    trip = startEditorSpotlight(editor, 'Destination');
    await advance(600);
    expect(host.querySelectorAll('.toggle-block.is-open')).toHaveLength(2);
    expect(host.querySelector('.bex-spotlight-hit')).toBeTruthy();
    await advance(2500);
    expect(host.querySelector('.bex-spotlight-hit')).toBeNull();
  });

  it('cleans up safely if the editor unmounts mid-journey', async () => {
    mount(toggle('Outer', '<p>Destination</p>'));
    trip = startEditorSpotlight(editor, 'Destination');
    await advance(100);
    trip.cancel();
    editor.destroy();
    await advance(1000);
    expect(await trip.finished).toBe(false);
  });

  it('fades and retires short-field selections without editing their value', async () => {
    host = document.createElement('textarea');
    host.value = 'A living conscience';
    document.body.append(host);
    trip = startFieldSpotlight(host, 'conscience');
    await advance(100);
    expect(host.value.slice(host.selectionStart, host.selectionEnd)).toBe('conscience');
    await advance(2400);
    expect(Number(host.style.getPropertyValue('--bex-spotlight-alpha'))).toBeLessThan(0.75);
    await advance(700);
    expect(host.selectionStart).toBe(host.selectionEnd);
    expect(host.value).toBe('A living conscience');
    expect(host.classList.contains('bex-spotlight-field-arrival')).toBe(false);
  });
});

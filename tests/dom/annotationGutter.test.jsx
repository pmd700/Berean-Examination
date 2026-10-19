import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AnnotationGutter from '@/components/study/AnnotationGutter';
import UserSettings from '@/components/settings/UserSettings';
import { ANNOTATION_DISPLAY_KEY, useAnnotationDisplayPreference } from '@/lib/annotationDisplayPreference';
import { gutterConnector, routeFromMidpoint, stackGutterCards } from '@/lib/annotationGutterGeometry';

const annotation = { id: 1, book: 'Matthew', chapter_number: 16, start_verse: 16, end_verse: 16,
  start_token_index: 0, end_token_index: 2, selected_text: 'Simon Peter', content: '<p>My commentary.</p>' };
let owner;
beforeEach(() => {
  localStorage.clear();
  owner = { is_local_owner: true };
  window.bexDesktop = { isDesktop: true,
    getLocalOwner: vi.fn(async () => ({ ok: true, owner })),
    updateLocalOwner: vi.fn(async patch => ({ ok: true, owner: (owner = { ...owner, ...patch }) })),
  };
});
afterEach(() => { cleanup(); delete window.bexDesktop; localStorage.clear(); });
function ReaderPreference() {
  const { style } = useAnnotationDisplayPreference();
  return <output data-testid="reader-style">{style}</output>;
}

it('defaults to gutter cards and persists the legacy choice through the local owner, synchronizing reader tabs', async () => {
  const view = render(<><UserSettings /><ReaderPreference /></>);
  expect(screen.getByTestId('reader-style').textContent).toBe('gutter');
  fireEvent.click(screen.getByRole('button', { name: 'Open user settings' }));
  const hover = screen.getByRole('radio', { name: /Underline & hover/ });
  await waitFor(() => expect(hover.disabled).toBe(false));
  fireEvent.click(hover);
  await screen.findByText('Saved locally.');
  expect(window.bexDesktop.updateLocalOwner).toHaveBeenCalledWith({ [ANNOTATION_DISPLAY_KEY]: 'hover' });
  expect(screen.getByTestId('reader-style').textContent).toBe('hover');
  view.unmount(); localStorage.clear();
  render(<ReaderPreference />);
  await waitFor(() => expect(screen.getByTestId('reader-style').textContent).toBe('hover'));
});
it('does not announce success or switch readers when saving a preference fails', async () => {
  window.bexDesktop.updateLocalOwner.mockResolvedValue({ ok: false, error: 'Disk unavailable' });
  render(<><UserSettings /><ReaderPreference /></>);
  fireEvent.click(screen.getByRole('button', { name: 'Open user settings' }));
  const hover = screen.getByRole('radio', { name: /Underline & hover/ });
  await waitFor(() => expect(hover.disabled).toBe(false));
  fireEvent.click(hover);
  expect((await screen.findByRole('alert')).textContent).toContain('Disk unavailable');
  expect(screen.getByTestId('reader-style').textContent).toBe('gutter');
  expect(screen.queryByText('Saved locally.')).toBeNull();
});

it('closes the settings panel when Home becomes a background tab', async () => {
  const view = render(<UserSettings active />);
  fireEvent.click(screen.getByRole('button', { name: 'Open user settings' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  view.rerender(<UserSettings active={false} />);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('puts the routing dot on the actual curve, supports large bends, and reflows without overlapping cards', () => {
  const start = { x: -40, y: 150 }, end = { x: 280, y: 260 };
  const route = routeFromMidpoint({ x: 650, y: 520 }, start, end);
  const cable = gutterConnector(start, end, route, 800, 1000, -264);
  const values = cable.path.match(/-?\d+(?:\.\d+)?/g).map(Number);
  expect((values[0] + 2 * values[2] + values[4]) / 4).toBe(cable.midpoint.x);
  expect((values[1] + 2 * values[3] + values[5]) / 4).toBe(cable.midpoint.y);
  const cards = stackGutterCards([{ id: 1, anchor: { y: 90 }, height: 220 }, { id: 2, anchor: { y: 100 }, height: 180 }]);
  expect(cards[1].top).toBeGreaterThanOrEqual(cards[0].top + cards[0].height + 16);
});

it('renders saved commentary at its selection, edits the existing annotation and persists keyboard cable adjustments', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    if (this.classList.contains('bex-annotation-rail')) return new DOMRect(220, 40, 180, 800);
    return new DOMRect(200, 40, 800, 1000);
  });
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function () {
    return this.dataset.annotationIds ? [new DOMRect(400, 100, 80, 20)] : [];
  });
  const edit = vi.fn(), save = vi.fn(async () => {});
  const view = render(<AnnotationGutter annotations={[annotation]} enabled onEdit={edit} onSaveRoute={save}>
    <span data-annotation-ids="1" data-token-key="token-16-0">Simon Peter</span>
  </AnnotationGutter>);
  await screen.findByTestId('gutter-annotation-1');
  expect(screen.getByText('My commentary.')).toBeTruthy();
  expect(screen.getByTestId('gutter-annotation-1').querySelector('blockquote')).toBeNull();
  expect(screen.getByTestId('annotation-gutter-layout').style.minHeight).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Edit annotation for Matthew 16:16' }));
  expect(edit).toHaveBeenCalledWith(annotation);
  const path = screen.getByTestId('annotation-cable-1').getAttribute('d');
  fireEvent.keyDown(screen.getByRole('button', { name: 'Adjust connector for Matthew 16:16' }), { key: 'ArrowDown' });
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0].id).toBe(1);
  expect(screen.getByTestId('annotation-cable-1').getAttribute('d')).not.toBe(path);
  view.rerender(<AnnotationGutter annotations={[annotation]} enabled={false} onEdit={edit} onSaveRoute={save}>
    <span data-annotation-ids="1" data-token-key="token-16-0">Simon Peter</span>
  </AnnotationGutter>);
  await act(async () => {});
  expect(screen.queryByTestId('gutter-annotation-1')).toBeNull();
  expect(screen.getByText('Simon Peter')).toBeTruthy();
});

it('copies the live editor body rather than stale rendered commentary or editing controls', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(300, 100, 800, 100));
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function () {
    return this.dataset.annotationIds ? [new DOMRect(400, 100, 80, 20)] : [];
  });
  const copy = vi.fn();
  render(<AnnotationGutter annotations={[annotation]} enabled editingId={annotation.id} onCopyContent={copy}
    editor={<div><div className="ProseMirror"><p>Latest unsaved commentary</p></div><button>Done</button></div>}>
    <span data-annotation-ids="1" data-token-key="token-16-0">Simon Peter</span>
  </AnnotationGutter>);
  const card = await screen.findByTestId('gutter-annotation-1');
  fireEvent.click(screen.getByRole('button', { name: 'Copy commentary text for Matthew 16:16' }));
  expect(copy).toHaveBeenCalledWith(annotation, card.querySelector('.ProseMirror'));
  expect(copy.mock.calls[0][1].textContent).toBe('Latest unsaved commentary');
  expect(screen.queryByText('My commentary.')).toBeNull();
});

it('shows every saved section and hyperlink in the reading card without changing the stored note', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(300, 100, 800, 100));
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function () {
    return this.dataset.annotationIds ? [new DOMRect(400, 100, 80, 20)] : [];
  });
  const content = '<p>Introduction.</p><p></p><p><a class="external-link" href="https://example.com/source">Complete source</a></p>'
    + '<details class="toggle-block"><summary>Supporting material</summary><div data-type="detailsContent"><p>Previously hidden argument.</p>'
    + '<details class="toggle-block"><summary>Nested material</summary><div data-type="detailsContent"><p>The final paragraph.</p></div></details></div></details>';
  const note = { ...annotation, content };
  const edit = vi.fn();
  render(<AnnotationGutter annotations={[note]} enabled onEdit={edit}>
    <span data-annotation-ids="1" data-token-key="token-16-0">Simon Peter</span>
  </AnnotationGutter>);
  const card = await screen.findByTestId('gutter-annotation-1');
  expect(card.querySelectorAll('details[open]')).toHaveLength(2);
  expect(card.querySelector('.bex-gutter-full-note').textContent).toContain('The final paragraph.');
  expect(card.querySelector('p:empty')).toBeTruthy();
  expect(card.querySelector('a').getAttribute('href')).toBe('https://example.com/source');
  expect(fireEvent.click(card.querySelector('summary'))).toBe(false);
  expect(card.querySelectorAll('details[open]')).toHaveLength(2);
  fireEvent.click(card.querySelector('button[title="Edit annotation"]'));
  expect(edit).toHaveBeenCalledWith(note);
  expect(note.content).toBe(content);
  expect(note.content).not.toContain('open=');
});

it('points a whole-verse range at every number box and keeps partial selections anchored to their words', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    if (this.hasAttribute('data-verse-number')) return new DOMRect(340, this.textContent === '16' ? 100 : 200, 28, 24);
    if (this.classList.contains('bex-annotation-rail')) return new DOMRect(-480, 40, 640, 800);
    return new DOMRect(200, 40, 800, 1000);
  });
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function () {
    return this.hasAttribute('data-token-key') ? [new DOMRect(400, this.closest('[data-verse-id]')?.dataset.verseId === '16' ? 100 : 200, 80, 20)] : [];
  });
  const multi = { ...annotation, end_verse: 17, selected_text: 'Repeated scripture that must stay out of the card' };
  const content = partial => <>
    <div data-scripture-verse><span data-verse-number>16</span><div data-verse-id="16">
      <span data-token-key="token-16-0" data-annotation-ids="1">First verse.</span>
    </div></div>
    <div data-scripture-verse><span data-verse-number>17</span><div data-verse-id="17">
      <span data-token-key="token-17-0" data-annotation-ids="1">Second</span>{' '}
      <span data-token-key="token-17-2" data-annotation-ids={partial ? undefined : '1'}>verse.</span>
    </div></div>
  </>;
  const view = render(<AnnotationGutter annotations={[multi]} enabled onEdit={() => {}} onSaveRoute={async () => {}}>{content(false)}</AnnotationGutter>);
  await screen.findByTestId('gutter-annotation-1');
  const arrows = () => [...view.container.querySelectorAll('path[data-annotation-arrow]')];
  expect(arrows().map(arrow => arrow.dataset.targetVerse)).toEqual(['16', '17']);
  expect(arrows().every(arrow => arrow.dataset.targetKind === 'verse')).toBe(true);
  expect(arrows()[0].getAttribute('d')).toMatch(/136 72$/);
  expect(arrows()[1].getAttribute('d')).toMatch(/136 172$/);
  expect(view.container.querySelector('.bex-annotation-cables line')).toBeNull();
  expect(screen.getByTestId('gutter-annotation-1').textContent).not.toContain(multi.selected_text);
  view.rerender(<AnnotationGutter annotations={[multi]} enabled onEdit={() => {}} onSaveRoute={async () => {}}>{content(true)}</AnnotationGutter>);
  await waitFor(() => expect(arrows()[1].dataset.targetKind).toBe('text'));
  expect(arrows()[0].dataset.targetKind).toBe('verse');
  expect(arrows()[1].getAttribute('d')).toMatch(/200 170$/);
});

describe('moving whole annotation cards', () => {
  function scene(value = annotation, save = vi.fn(async () => {})) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.classList.contains('bex-annotation-rail')) return new DOMRect(-180, 40, 320, 1000);
      return new DOMRect(200, 40, 800, 1000);
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(320);
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function () {
      return this.dataset.annotationIds ? [new DOMRect(400, 300, 80, 20)] : [];
    });
    const view = render(<AnnotationGutter annotations={[value]} enabled onSavePosition={save} onSaveRoute={async () => {}}>
      <span data-annotation-ids="1" data-token-key="token-16-0">Simon Peter</span>
    </AnnotationGutter>);
    return { view, save };
  }
  const pointer = (handle, type, x, y) => fireEvent(handle, Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
    button: 0, pointerId: 5, clientX: x, clientY: y,
  }));
  it('moves from the six-dot handle and stretches the arrow while keeping its scripture endpoint fixed', async () => {
    const { save } = scene();
    const card = await screen.findByTestId('gutter-annotation-1');
    const handle = screen.getByRole('button', { name: 'Move annotation for Matthew 16:16' });
    expect(handle.querySelector('.lucide-grip-vertical')).toBeTruthy();
    const top = parseFloat(card.style.top);
    const path = screen.getByTestId('annotation-cable-1').getAttribute('d');
    pointer(handle, 'pointerdown', 100, 300);
    pointer(handle, 'pointermove', 40, 360);
    expect(card.style.right).toBe('60px');
    expect(parseFloat(card.style.top)).toBe(top + 60);
    const moved = screen.getByTestId('annotation-cable-1').getAttribute('d');
    expect(moved).not.toBe(path);
    expect(moved.split(' ').slice(-2)).toEqual(path.split(' ').slice(-2));
    expect(save).not.toHaveBeenCalled();
    pointer(handle, 'pointerup', 40, 360);
    await waitFor(() => expect(save).toHaveBeenCalledWith(annotation, { x: -60, y: top + 60, absolute: true }));
    pointer(handle, 'pointerdown', 40, 360);
    pointer(handle, 'pointermove', 140, 420);
    pointer(handle, 'pointercancel', 140, 420);
    expect(card.style.right).toBe('60px');
    expect(parseFloat(card.style.top)).toBe(top + 60);
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('can move above the reader origin without changing width or height', async () => {
    const { save } = scene();
    const card = await screen.findByTestId('gutter-annotation-1');
    const handle = screen.getByTestId('annotation-move-1');
    const width = card.style.width, height = card.style.height;
    pointer(handle, 'pointerdown', 100, 300);
    pointer(handle, 'pointermove', -200, -900);
    expect(parseFloat(card.style.top)).toBeLessThan(0);
    expect(card.style.width).toBe(width); expect(card.style.height).toBe(height);
    pointer(handle, 'pointerup', -200, -900);
    await waitFor(() => expect(save).toHaveBeenCalledWith(annotation, expect.objectContaining({ x: -300, absolute: true })));
  });
  it('restores a saved position and supports keyboard movement and resetting', async () => {
    const saved = { ...annotation, gutter_position: { x: -90, y: 120 } };
    const { save } = scene(saved);
    const card = await screen.findByTestId('gutter-annotation-1');
    const handle = screen.getByTestId('annotation-move-1');
    expect(card.style.right).toBe('90px');
    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true });
    await waitFor(() => expect(save).toHaveBeenCalledWith(saved, { x: -114, y: parseFloat(card.style.top), absolute: true }));
    fireEvent.doubleClick(handle);
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(saved, { x: 0, y: 0 }));
    expect(card.style.right).toBe('0px');
  });
  it('rolls back a failed queued move to the last successful position, preserving the writing', async () => {
    let release;
    const save = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockRejectedValue(new Error('Disk unavailable'));
    scene(annotation, save);
    const card = await screen.findByTestId('gutter-annotation-1');
    const handle = screen.getByTestId('annotation-move-1');
    const top = parseFloat(card.style.top);
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    await waitFor(() => expect(release).toBeTruthy());
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    await act(async () => release());
    await waitFor(() => expect(parseFloat(card.style.top)).toBe(top + 8));
    expect(save).toHaveBeenCalledTimes(2);
    expect(screen.getByText('My commentary.')).toBeTruthy();
  });
});


describe('four independent annotation resize corners', () => {
  const pointer = (handle, type, x, y) => fireEvent(handle, Object.assign(new Event(type, { bubbles: true, cancelable: true }), { button: 0, pointerId: 8, clientX: x, clientY: y }));
  it('does not overwrite saved layout when a corner is clicked without dragging', async () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function () { return this.dataset.annotationIds ? [new DOMRect(200, 100, 80, 20)] : []; });
    const saved = { ...annotation, gutter_position: { x: -50, y: -90, absolute: true }, gutter_size: { width: 700, height: 350 } };
    const save = vi.fn();
    render(<AnnotationGutter annotations={[saved]} enabled onSaveSize={save}><span data-annotation-ids="1">Simon Peter</span></AnnotationGutter>);
    const card = await screen.findByTestId('gutter-annotation-1');
    const handle = screen.getByTestId('annotation-resize-1-ne');
    pointer(handle, 'pointerdown', 100, 100); pointer(handle, 'pointerup', 100, 100);
    expect(save).not.toHaveBeenCalled(); expect(card.style.width).toBe('700px'); expect(card.style.height).toBe('350px'); expect(card.style.top).toBe('-90px');
  });
  it.each(['nw', 'ne', 'sw', 'se'])('resizes %s with independent axes and keeps the opposite corner fixed', async corner => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.classList.contains('bex-annotation-rail')) return new DOMRect(-180, 40, 320, 1000);
      return new DOMRect(200, 40, 800, 1000);
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(320);
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function () { return this.dataset.annotationIds ? [new DOMRect(400, 300, 80, 20)] : []; });
    const save = vi.fn(async () => {});
    render(<AnnotationGutter annotations={[annotation]} enabled onSaveSize={save}><span data-annotation-ids="1">Simon Peter</span></AnnotationGutter>);
    const card = await screen.findByTestId('gutter-annotation-1');
    const top = parseFloat(card.style.top);
    const handle = screen.getByTestId(`annotation-resize-1-${corner}`);
    pointer(handle, 'pointerdown', 100, 300);
    const x = corner.includes('e') ? 240 : -40;
    pointer(handle, 'pointermove', x, 300);
    expect(card.style.width).toBe('460px'); expect(card.style.height).toBe('200px');
    const y = corner.includes('s') ? 330 : 270;
    pointer(handle, 'pointermove', x, y);
    expect(card.style.width).toBe('460px'); expect(card.style.height).toBe('230px');
    expect(parseFloat(card.style.top)).toBe(top + (corner.includes('s') ? 0 : -30));
    expect(card.style.right).toBe(corner.includes('e') ? '-140px' : '0px');
    expect(save).not.toHaveBeenCalled();
    pointer(handle, 'pointerup', x, y);
    await waitFor(() => expect(save).toHaveBeenCalledWith(annotation, { width: 460, height: 230 }, expect.objectContaining({ absolute: true })));
  });
});

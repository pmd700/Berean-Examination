import React from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CommentSidebar from '@/components/editor/CommentSidebar';
import { commentKey } from '@/components/editor/CommentExtension';
import { ActiveTabProvider } from '@/lib/WorkspaceTabs';
import useCanvasState from '@/components/knowledgeweb/useCanvasState';

let host;

afterEach(() => {
  host?.remove();
  host = null;
  vi.unstubAllGlobals();
});

function controlledFrames() {
  const pending = new Map();
  let id = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { pending.set(++id, callback); return id; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(frame => pending.delete(frame));
  return { pending, named: name => [...pending.values()].filter(callback => callback.name === name) };
}

function emptyHost() {
  host = document.createElement('div');
  document.body.appendChild(host);
  host.style.overflowY = 'auto';
  Object.defineProperty(host, 'offsetParent', { configurable: true, get: () => document.body });
  host.getBoundingClientRect = () => rect({ right: 900, bottom: 600 });
  const spacer = document.createElement('div');
  spacer.dataset.scrollPastEnd = 'true'; host.appendChild(spacer);
  return spacer;
}

describe('editor idle animation ownership', () => {
  it('does not rescan unchanged text for selection transactions while active/draft state keeps updating', () => {
    controlledFrames(); const spacer = emptyHost(), editor = makeEditor();
    const descendants = vi.spyOn(editor.state.doc, 'descendants');
    const view = render(<CommentSidebar editor={editor} anchorRef={{ current: host }} tailSpacerRef={{ current: spacer }} />);
    const sync = editor.on.mock.calls.find(([event]) => event === 'transaction')[1];
    expect(descendants).toHaveBeenCalledTimes(1);
    act(() => {
      for (let i = 0; i < 100; i++) sync();
    });
    expect(descendants).toHaveBeenCalledTimes(1);
    editor.state[commentKey.key] = { activeId: 'comment-1', draftId: null };
    act(() => sync());
    expect(screen.getByTestId('card-comment-comment-1').className).toContain('border-violet-500');
    expect(descendants).toHaveBeenCalledTimes(1);

    // The new editor deliberately shares the same doc object: subscriptions
    // must initialize independently even when hydrating an existing document.
    const other = { ...editor, on: vi.fn(), off: vi.fn() };
    view.rerender(<CommentSidebar editor={other} anchorRef={{ current: host }} tailSpacerRef={{ current: spacer }} />);
    expect(descendants).toHaveBeenCalledTimes(2);
    expect(editor.off).toHaveBeenCalledWith('transaction', sync);
  });

  it('keeps an empty editor resize-responsive without scheduling animation frames', () => {
    const frames = controlledFrames(), spacer = emptyHost();
    let viewportHeight = 600;
    Object.defineProperty(host, 'clientHeight', { configurable: true, get: () => viewportHeight });
    const observers = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback) { this.callback = callback; this.observe = vi.fn(); this.disconnect = vi.fn(); observers.push(this); }
    });
    const editor = makeEditor(600, { commentCount: 0 });
    const view = render(<CommentSidebar editor={editor} anchorRef={{ current: host }} tailSpacerRef={{ current: spacer }} />);
    expect(frames.pending.size).toBe(0);
    expect(spacer.style.height).toBe('600px');
    viewportHeight = 900; fireEvent.resize(window);
    expect(spacer.style.height).toBe('900px');
    viewportHeight = 750;
    act(() => observers.forEach(observer => observer.callback([])));
    expect(spacer.style.height).toBe('750px');
    expect(frames.pending.size).toBe(0);
    view.unmount();
    expect(observers.every(observer => observer.disconnect.mock.calls.length === 1)).toBe(true);
  });

  it('runs comment positioning only for the active tab and removes hidden portals', () => {
    const frames = controlledFrames(), spacer = emptyHost(), editor = makeEditor();
    const tree = active => <ActiveTabProvider isActive={active}><CommentSidebar editor={editor} anchorRef={{ current: host }} tailSpacerRef={{ current: spacer }} /></ActiveTabProvider>;
    const view = render(tree(false));
    expect(frames.named('tick')).toHaveLength(0);
    expect(screen.queryByTestId('card-comment-comment-1')).toBeNull();
    view.rerender(tree(true));
    expect(host.hasAttribute('data-bex-margin-comments')).toBe(true);
    expect(frames.named('tick')).toHaveLength(1);
    expect(screen.getByTestId('card-comment-comment-1')).not.toBeNull();
    view.rerender(tree(false));
    expect(host.hasAttribute('data-bex-margin-comments')).toBe(false);
    expect(frames.named('tick')).toHaveLength(0);
    expect(screen.queryByTestId('card-comment-comment-1')).toBeNull();
  });

  it('cancels recurring positioning when the final comment is removed', () => {
    const frames = controlledFrames(), spacer = emptyHost(), editor = makeEditor();
    const view = render(<CommentSidebar editor={editor} anchorRef={{ current: host }} tailSpacerRef={{ current: spacer }} />);
    expect(frames.named('tick')).toHaveLength(1);
    editor.state.doc = { descendants() {} };
    const sync = editor.on.mock.calls.find(([event]) => event === 'transaction')[1];
    act(() => sync());
    expect(frames.named('tick')).toHaveLength(0);
    expect(screen.queryByTestId('card-comment-comment-1')).toBeNull();
    view.unmount();
  });

  it.each(['zoom', 'pan'])('cancels an unfinished canvas %s animation on unmount', kind => {
    const frames = controlledFrames();
    const hook = renderHook(() => useCanvasState());
    act(() => {
      if (kind === 'zoom') hook.result.current.smoothZoomTo(2, 100, 100);
      else hook.result.current.smoothPanTo(100, 100, 800, 600, 1);
    });
    expect(frames.pending.size).toBe(1);
    hook.unmount();
    expect(frames.pending.size).toBe(0);
  });
});

function rect({ left = 0, top = 0, right = 0, bottom = 0 } = {}) {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

function makeEditor(contentBottom = 600, { commentCount = 1, anchorTops = [] } = {}) {
  const commentMarks = Array.from({ length: commentCount }, (_, index) => ({
    type: { name: 'comment' },
    attrs: {
      id: `comment-${index + 1}`,
      text: index === 0
        ? '<p>A long margin comment</p>'
        : `<p>Comment ${index + 1}</p>`,
      createdAt: '2026-08-22T00:00:00.000Z',
    },
  }));
  const doc = {
    descendants(callback) {
      commentMarks.forEach((commentMark, index) => {
        callback({
          isText: true,
          marks: [commentMark],
          nodeSize: 6,
          text: `anchor ${index + 1}`,
        }, 10 + index * 10);
      });
    },
  };

  const editorDom = document.createElement('div');
  editorDom.getBoundingClientRect = () => rect({ bottom: contentBottom, right: 800 });
  commentMarks.forEach((commentMark, index) => {
    const commentAnchor = document.createElement('span');
    commentAnchor.setAttribute('data-comment-id', commentMark.attrs.id);
    const top = anchorTops[index] ?? (300 + index * 180);
    commentAnchor.getBoundingClientRect = () => rect({
      left: 120,
      top,
      right: 180,
      bottom: top + 18,
    });
    editorDom.appendChild(commentAnchor);
  });
  host.appendChild(editorDom);

  return {
    state: {
      doc,
      [commentKey.key]: { activeId: null, draftId: null },
    },
    view: {
      dom: editorDom,
      coordsAtPos: () => ({ top: 300 }),
    },
    commands: {
      setActiveComment: vi.fn(),
      clearCommentDraft: vi.fn(),
      removeComment: vi.fn(),
      updateComment: vi.fn(),
      focus: vi.fn(),
    },
    on: vi.fn(),
    off: vi.fn(),
  };
}

describe('comment sidebar scroll range', () => {
  it('extends the document until the final comment can scroll fully onscreen', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    Object.defineProperty(host, 'offsetParent', {
      configurable: true,
      get: () => document.body,
    });
    host.getBoundingClientRect = () => rect({ right: 900, bottom: 600 });
    host.style.overflowY = 'auto';
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 600 });

    const spacer = document.createElement('div');
    spacer.dataset.scrollPastEnd = 'true';
    host.appendChild(spacer);
    const editor = makeEditor(600);
    let cardHeight = 1200;

    render(
      <CommentSidebar
        editor={editor}
        anchorRef={{ current: host }}
        tailSpacerRef={{ current: spacer }}
      />,
    );

    const card = await screen.findByTestId('card-comment-comment-1');
    Object.defineProperty(card, 'offsetHeight', {
      configurable: true,
      get: () => cardHeight,
    });

    // A super-long comment wins: 300 + 1200 - 600 + 24px breathing room.
    await waitFor(() => expect(card.style.top).toBe('300px'));
    await waitFor(() => expect(spacer.style.height).toBe('924px'));

    cardHeight = 100;
    // Once the comment is short, the normal one-viewport reading tail wins.
    await waitFor(() => expect(spacer.style.height).toBe('600px'));
  });

  it('collapses a long comment by default and lets the reader expand it', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    Object.defineProperty(host, 'offsetParent', {
      configurable: true,
      get: () => document.body,
    });
    host.getBoundingClientRect = () => rect({ right: 900, bottom: 600 });
    host.style.overflowY = 'auto';
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 600 });

    const spacer = document.createElement('div');
    spacer.dataset.scrollPastEnd = 'true';
    host.appendChild(spacer);
    const editor = makeEditor(600);

    render(
      <CommentSidebar
        editor={editor}
        anchorRef={{ current: host }}
        tailSpacerRef={{ current: spacer }}
      />,
    );

    const body = await screen.findByText('A long margin comment');
    const bodyContainer = body.closest('[data-comment-body]');
    Object.defineProperty(bodyContainer, 'scrollHeight', {
      configurable: true,
      get: () => 420,
    });
    fireEvent.resize(window);

    const toggle = await screen.findByTestId('button-comment-toggle-comment-1');
    expect(bodyContainer.style.maxHeight).toBe('120px');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('Show more');

    fireEvent.click(toggle);
    expect(bodyContainer.style.maxHeight).toBe('none');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toContain('Show less');

    fireEvent.click(toggle);
    expect(bodyContainer.style.maxHeight).toBe('120px');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('bundles seven comments that would overlap at the same parent text', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    Object.defineProperty(host, 'offsetParent', {
      configurable: true,
      get: () => document.body,
    });
    host.getBoundingClientRect = () => rect({ right: 900, bottom: 900 });
    host.style.overflowY = 'auto';
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 900 });

    const spacer = document.createElement('div');
    spacer.dataset.scrollPastEnd = 'true';
    host.appendChild(spacer);
    const editor = makeEditor(900, {
      commentCount: 7,
      anchorTops: [200, 212, 224, 236, 248, 260, 272],
    });

    render(
      <CommentSidebar
        editor={editor}
        anchorRef={{ current: host }}
        tailSpacerRef={{ current: spacer }}
      />,
    );

    const bundle = await screen.findByTestId('bundle-comments-comment-1');
    const bundleButton = screen.getByTestId('button-comment-bundle-comment-1');
    await waitFor(() => expect(bundle.style.top).toBe('200px'));
    expect(bundleButton.textContent).toContain('See 7+ comments');
    expect(screen.queryAllByTestId(/^card-comment-/)).toHaveLength(0);

    fireEvent.click(bundleButton);
    expect(bundleButton.textContent).toContain('Hide 7 comments');
    expect(await screen.findAllByTestId(/^card-comment-/)).toHaveLength(7);
  });

  it('hides comments inside a closed dropdown and restores them when reopened', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    Object.defineProperty(host, 'offsetParent', {
      configurable: true,
      get: () => document.body,
    });
    host.getBoundingClientRect = () => rect({ right: 900, bottom: 600 });
    host.style.overflowY = 'auto';
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 600 });

    const spacer = document.createElement('div');
    spacer.dataset.scrollPastEnd = 'true';
    host.appendChild(spacer);
    const editor = makeEditor(600);
    const anchor = editor.view.dom.querySelector('[data-comment-id="comment-1"]');
    const dropdown = document.createElement('div');
    dropdown.className = 'toggle-block is-open';
    const dropdownBody = document.createElement('div');
    dropdownBody.className = 'toggle-block__body';
    dropdownBody.appendChild(anchor);
    dropdown.appendChild(dropdownBody);
    editor.view.dom.appendChild(dropdown);

    render(
      <CommentSidebar
        editor={editor}
        anchorRef={{ current: host }}
        tailSpacerRef={{ current: spacer }}
      />,
    );

    expect(await screen.findByTestId('card-comment-comment-1')).not.toBeNull();

    dropdown.classList.remove('is-open');
    dropdownBody.hidden = true;
    await waitFor(() => expect(screen.queryByTestId('card-comment-comment-1')).toBeNull());
    expect(spacer.style.height).toBe('600px');

    dropdown.classList.add('is-open');
    dropdownBody.hidden = false;
    expect(await screen.findByTestId('card-comment-comment-1')).not.toBeNull();
  });
});

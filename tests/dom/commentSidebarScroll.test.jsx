import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CommentSidebar from '@/components/editor/CommentSidebar';
import { commentKey } from '@/components/editor/CommentExtension';

let host;

afterEach(() => {
  host?.remove();
  host = null;
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

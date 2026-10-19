import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/desktopClient', () => ({ desktopClient: { entities: {
  Keyword: { list: async () => [] },
  MindNote: { listPage: async () => ({ records: [], nextCursor: null }) },
  KnowledgeWeb: { listPage: async () => ({ records: [], nextCursor: null }) },
  Timegraph: { listPage: async () => ({ records: [], nextCursor: null }) },
} } }));
vi.mock('@/lib/PrivateWebContext', () => ({ usePrivateWeb: () => ({ getKey: () => null }) }));
import AnnotationGutter from '@/components/study/AnnotationGutter';
import ScriptureWorkspace from '@/components/study/ScriptureWorkspace';
import TEXT_EDITOR_MACHINERY from '@/components/editor/TEXT_EDITOR_MACHINERY';
import { libraryLinkPath } from '@/lib/libraryLinks';
import {
  centeredScrollTop, commentaryLinkHref, commentaryLinkLabel, commentaryPassage, copyCommentaryContent,
  copyCommentaryLink, OPEN_COMMENTARY_TAB_EVENT, parseCommentaryLinkTarget, revealAnnotation,
} from '@/lib/commentaryLink';

const annotation = { id: 7, book: 'Matthew', chapter_number: 16, start_verse: 18, end_verse: 19,
  start_token_index: 0, end_token_index: 2, selected_text: 'And I also say', content: '<p>Peter is the Petros.</p>' };

afterEach(() => { cleanup(); delete document.execCommand; });

describe('commentary link address', () => {
  it('names the exact passage and the annotation', () => {
    expect(commentaryPassage(annotation)).toBe('Matthew 16:18-19');
    expect(commentaryLinkLabel(annotation)).toBe('Commentary on Matthew 16:18-19');
    expect(commentaryLinkHref(annotation)).toBe('/Study?q=Matthew%2016%3A18-19&annotation_id=7');
    expect(commentaryPassage({ ...annotation, end_verse: 18 })).toBe('Matthew 16:18');
    expect(commentaryLinkHref({ ...annotation, book: '1 John', chapter_number: 2, start_verse: 3, end_verse: 3 }))
      .toBe('/Study?q=1%20John%202%3A3&annotation_id=7');
  });

  it('round-trips through the tab path and is recognized as a local BEX route', () => {
    const href = commentaryLinkHref(annotation);
    expect(parseCommentaryLinkTarget(href)).toEqual({ annotationId: '7', query: 'Matthew 16:18-19' });
    expect(parseCommentaryLinkTarget('q=Matthew%2016')).toBeNull();
    expect(parseCommentaryLinkTarget('')).toBeNull();
    expect(libraryLinkPath(href)).toBe(href);
    expect(libraryLinkPath('/Study?q=Matthew%2016%3A18-19')).toBe('/Study?q=Matthew%2016%3A18-19');
    expect(libraryLinkPath('https://example.com/Study?q=John%203', 'https://local.test/')).toBeNull();
    expect(libraryLinkPath('/Study?x=1')).toBeNull();
    expect(libraryLinkPath('/Study?q=a&annotation_id=1<script>')).toBeNull();
    expect(libraryLinkPath('/notes/12')).toBe('/notes/12');
  });
});

describe('copying a commentary link', () => {
  it('puts a hyperlink on the clipboard, with a Markdown fallback', () => {
    const data = {};
    document.execCommand = vi.fn(command => {
      expect(command).toBe('copy');
      const event = new Event('copy', { cancelable: true });
      event.clipboardData = { setData: (type, value) => { data[type] = value; } };
      window.dispatchEvent(event);
      return true;
    });
    expect(copyCommentaryLink(annotation)).toBe(true);
    const link = new DOMParser().parseFromString(data['text/html'], 'text/html').querySelector('a');
    expect(link.textContent).toBe('Commentary on Matthew 16:18-19');
    expect(link.getAttribute('href')).toBe('/Study?q=Matthew%2016%3A18-19&annotation_id=7');
    expect(data['text/plain']).toBe('[Commentary on Matthew 16:18-19](/Study?q=Matthew%2016%3A18-19&annotation_id=7)');
  });

  it('reports a blocked copy instead of pretending it worked', () => {
    document.execCommand = vi.fn(() => false);
    expect(copyCommentaryLink(annotation)).toBe(false);
  });

  it('leaves nothing behind in the page', () => {
    document.execCommand = vi.fn(() => true);
    copyCommentaryLink(annotation);
    expect(document.querySelector('textarea')).toBeNull();
  });
});

describe('edition-aware commentary links', () => {
  const nasb = { ...annotation, version: 'API:a761ca71e0b3ddcf-01' };
  it('carries the canonical edition, names NASB 2020, and remains an in-app route', () => {
    const href = commentaryLinkHref(nasb);
    expect(commentaryLinkHref({ ...nasb, version: 'NASB' }, 'a761ca71e0b3ddcf-01')).toBe(href);
    expect(href).toBe('/Study?q=Matthew%2016%3A18-19&annotation_id=7&version=API%3Aa761ca71e0b3ddcf-01');
    expect(parseCommentaryLinkTarget(href)).toEqual({ annotationId: '7', query: 'Matthew 16:18-19', version: nasb.version });
    expect(commentaryLinkLabel(nasb, 'NASB')).toBe('Commentary on Matthew 16:18-19 (NASB 2020)');
    expect(commentaryLinkLabel({ ...nasb, version: 'API:b8ee27bcd1cae43a-01' })).toContain('(NASB 1995)');
    expect(libraryLinkPath(href)).toBe(href);
    expect(libraryLinkPath(href + '&extra=1')).toBeNull();
    expect(libraryLinkPath('/Study?q=John%2020&annotation_id=7&version=https%3Aevil')).toBeNull();
  });
  it('copies the edition into rich and Markdown links', () => {
    const data = {};
    document.execCommand = vi.fn(() => {
      const event = new Event('copy', { cancelable: true });
      event.clipboardData = { setData: (type, value) => { data[type] = value; } };
      window.dispatchEvent(event); return true;
    });
    expect(copyCommentaryLink(nasb, 'NASB')).toBe(true);
    const link = new DOMParser().parseFromString(data['text/html'], 'text/html').querySelector('a');
    expect(link.textContent).toContain('(NASB 2020)');
    expect(link.getAttribute('href')).toBe(commentaryLinkHref(nasb));
    expect(data['text/plain']).toContain('&version=API%3Aa761ca71e0b3ddcf-01');
  });
});

describe('copying commentary contents', () => {
  it('copies rendered HTML and plain text to the clipboard', () => {
    const data = {};
    document.execCommand = vi.fn(command => {
      expect(command).toBe('copy');
      const event = new Event('copy', { cancelable: true });
      event.clipboardData = { setData: (type, value) => { data[type] = value; } };
      window.dispatchEvent(event);
      return true;
    });
    const el = document.createElement('div');
    el.innerHTML = '<p>Line 1</p><p>Line 2</p>';
    expect(copyCommentaryContent(el)).toBe(true);
    expect(data['text/html']).toBe('<p>Line 1</p><p>Line 2</p>');
    expect(data['text/plain']).toContain('Line 1');
    expect(data['text/plain']).toContain('Line 2');
  });

  it('handles missing or empty elements cleanly', () => {
    expect(copyCommentaryContent(null)).toBe(false);
    const empty = document.createElement('div');
    expect(copyCommentaryContent(empty)).toBe(false);
  });
});

describe('the 3 buttons on a commentary card', () => {
  const renderGutter = ({ onCopyLink, onCopyContent, onEdit } = {}) => render(
    <AnnotationGutter annotations={[annotation]} enabled onEdit={onEdit || (() => {})} onCopyLink={onCopyLink} onCopyContent={onCopyContent} onSaveRoute={async () => {}}>
      <span data-annotation-ids="7" data-token-key="token-18-0">And I also say</span>
    </AnnotationGutter>);
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => new DOMRect(200, 40, 800, 1000));
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function () {
      return this.dataset.annotationIds ? [new DOMRect(400, 100, 80, 20)] : [];
    });
  });

  it('has buttons to copy the link, copy the contents, and edit', async () => {
    const copyLink = vi.fn(), copyContent = vi.fn(), edit = vi.fn();
    renderGutter({ onCopyLink: copyLink, onCopyContent: copyContent, onEdit: edit });
    const card = await screen.findByTestId('gutter-annotation-7');
    expect(card.getAttribute('data-annotation-card-id')).toBe('7');

    // 1st button: Copy link
    fireEvent.click(screen.getByRole('button', { name: 'Copy link to commentary on Matthew 16:18' }));
    expect(copyLink).toHaveBeenCalledWith(annotation);
    expect(copyContent).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();

    // 2nd button: Copy content
    fireEvent.click(screen.getByRole('button', { name: 'Copy commentary text for Matthew 16:18' }));
    expect(copyContent).toHaveBeenCalledWith(annotation, expect.any(HTMLElement));
    expect(edit).not.toHaveBeenCalled();

    // 3rd button: Edit
    fireEvent.click(screen.getByRole('button', { name: 'Edit annotation for Matthew 16:18' }));
    expect(edit).toHaveBeenCalledWith(annotation);
  });

  it('shows no copy buttons where nothing handles them', async () => {
    renderGutter({});
    await screen.findByTestId('gutter-annotation-7');
    expect(screen.queryByRole('button', { name: /Copy link/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Copy commentary text/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Edit annotation/ })).toBeTruthy();
  });
});

describe('opening a commentary link', () => {
  function Route() {
    const location = useLocation();
    return <output data-testid="route">{location.pathname}{location.search}</output>;
  }

  it('requests opening in a new tab via OPEN_COMMENTARY_TAB_EVENT', async () => {
    const href = commentaryLinkHref(annotation);
    const tabRequests = [];
    const onOpenTab = event => {
      tabRequests.push(event.detail);
      event.detail.handled = true;
    };
    window.addEventListener(OPEN_COMMENTARY_TAB_EVENT, onOpenTab);
    try {
      const view = render(<MemoryRouter><Route />
        <TEXT_EDITOR_MACHINERY bare content={`<p><a href="${href}">Commentary on Matthew 16:18-19</a></p>`} onChange={() => {}} />
      </MemoryRouter>);
      await waitFor(() => expect(view.container.querySelector('.ProseMirror a')).toBeTruthy());
      fireEvent.click(view.container.querySelector('.ProseMirror a'));
      expect(tabRequests).toHaveLength(1);
      expect(tabRequests[0].path).toBe(href);
      expect(tabRequests[0].title).toBe('Commentary on Matthew 16:18-19');
      // When handled, current tab route does NOT change
      expect(screen.getByTestId('route').textContent).toBe('/');
    } finally {
      window.removeEventListener(OPEN_COMMENTARY_TAB_EVENT, onOpenTab);
    }
  });

  it('falls back to in-app navigation when no tab shell is present', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null);
    const href = commentaryLinkHref(annotation);
    const view = render(<MemoryRouter><Route />
      <TEXT_EDITOR_MACHINERY bare content={`<p><a href="${href}">Commentary on Matthew 16:18-19</a></p>`} onChange={() => {}} />
    </MemoryRouter>);
    await waitFor(() => expect(view.container.querySelector('.ProseMirror a')).toBeTruthy());
    expect(view.container.querySelector('.ProseMirror a').getAttribute('href')).toBe(href);
    fireEvent.click(view.container.querySelector('.ProseMirror a'));
    expect(screen.getByTestId('route').textContent).toBe(href);
    expect(window.open).not.toHaveBeenCalled();
  });
});

describe('centering the card on screen', () => {
  it('pans the workspace sideways until an off-screen card is centered', async () => {
    render(<ScriptureWorkspace enabled><div className="bex-study-page"><article data-testid="far-card">Card</article></div></ScriptureWorkspace>);
    const viewport = screen.getByTestId('scripture-workspace');
    viewport.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 800);
    const card = screen.getByTestId('far-card');
    // The card starts 900px left of the screen; the camera moves it by `panX`.
    card.getBoundingClientRect = () => new DOMRect(-900 - Number(viewport.dataset.panX || 0), 1100 - Number(viewport.dataset.panY || 0), 400, 200);
    card.dispatchEvent(new CustomEvent('scripture-workspace-center', { bubbles: true, detail: { target: card } }));
    await waitFor(() => expect(Number(viewport.dataset.panX)).toBeCloseTo(-1200, 0), { timeout: 2000 });
    expect(Number(viewport.dataset.panY)).toBeCloseTo(800, 0);
  });

  it('ignores requests for elements outside the workspace', () => {
    render(<><ScriptureWorkspace enabled><p>Scripture</p></ScriptureWorkspace><i data-testid="outside" /></>);
    const outside = screen.getByTestId('outside');
    outside.dispatchEvent(new CustomEvent('scripture-workspace-center', { bubbles: true, detail: { target: outside } }));
    expect(screen.getByTestId('scripture-workspace').dataset.panX).toBe('0');
  });

  function layout({ paneTop = 100, paneHeight = 600, cardTop = 1000, cardHeight = 200, scrollTop = 0 } = {}) {
    const pane = document.createElement('div');
    pane.className = 'bex-tab-pane';
    pane.scrollTop = scrollTop;
    Object.defineProperty(pane, 'clientHeight', { value: paneHeight, configurable: true });
    pane.getBoundingClientRect = () => new DOMRect(0, paneTop, 800, paneHeight);
    pane.scrollTo = vi.fn(({ top }) => { pane.scrollTop = top; });
    const reader = document.createElement('div');
    const card = document.createElement('article');
    card.setAttribute('data-annotation-card-id', '7');
    card.getBoundingClientRect = () => new DOMRect(0, cardTop - pane.scrollTop, 300, cardHeight);
    reader.appendChild(card);
    pane.appendChild(reader);
    document.body.appendChild(pane);
    return { pane, reader, card };
  }
  afterEach(() => { document.body.innerHTML = ''; });

  it('puts the middle of the card in the middle of the pane', () => {
    const { pane, card } = layout();
    // Pane middle is at 400; the card's middle is at 1100.
    expect(centeredScrollTop(card, pane)).toBe(700);
  });

  it('top-aligns a card taller than the pane and never scrolls above the page', () => {
    const tall = layout({ cardHeight: 900 });
    expect(centeredScrollTop(tall.card, tall.pane)).toBe(1000 - 116);
    document.body.innerHTML = '';
    const near = layout({ cardTop: 150 });
    expect(centeredScrollTop(near.card, near.pane)).toBe(0);
  });

  it('scrolls to the card once it exists, tells the workspace to pan, then reports done', async () => {
    const { pane, reader, card } = layout();
    const panned = vi.fn();
    reader.addEventListener('scripture-workspace-center', event => panned(event.detail.target));
    const onDone = vi.fn();
    revealAnnotation(reader, '7', { onDone });
    await waitFor(() => expect(onDone).toHaveBeenCalled(), { timeout: 3000 });
    expect(pane.scrollTop).toBe(700);
    expect(panned).toHaveBeenCalledTimes(1);
    expect(panned).toHaveBeenCalledWith(card);
  });

  it('waits for a card that renders late', async () => {
    const { pane, reader, card } = layout();
    card.remove();
    const onDone = vi.fn();
    revealAnnotation(reader, '7', { onDone });
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(pane.scrollTo).not.toHaveBeenCalled();
    reader.appendChild(card);
    await waitFor(() => expect(onDone).toHaveBeenCalled(), { timeout: 3000 });
    expect(pane.scrollTop).toBe(700);
  });

  it('stays out of the way once the reader scrolls or types, and when cancelled', async () => {
    const first = layout();
    const interrupted = vi.fn();
    revealAnnotation(first.reader, '7', { onDone: interrupted });
    fireEvent.wheel(window);
    expect(interrupted).toHaveBeenCalledTimes(1);
    first.pane.scrollTo.mockClear();
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(first.pane.scrollTo).not.toHaveBeenCalled();

    document.body.innerHTML = '';
    const second = layout();
    const done = vi.fn();
    revealAnnotation(second.reader, '7', { onDone: done })();
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(done).not.toHaveBeenCalled();
    expect(second.pane.scrollTo).not.toHaveBeenCalled();
  });

  it('ignores ids that are not safe to put in a selector', () => {
    const { reader } = layout();
    const onDone = vi.fn();
    revealAnnotation(reader, '7"] , body', { onDone })();
    expect(onDone).not.toHaveBeenCalled();
  });
});

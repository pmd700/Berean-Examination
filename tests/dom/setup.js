import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Shared setup for the DOM suites.
 *
 * jsdom implements the document but not the parts of the platform this app leans
 * on for layout and pointer work, so the gaps are filled once here rather than
 * in every test. Each stub is the smallest thing that lets real component code
 * run — none of them fake behaviour a test then asserts on.
 */

afterEach(() => {
  cleanup();
});

// The editor, the timeline canvas and the tab panes all observe their own size.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// ProseMirror and the marquee use pointer capture, which jsdom does not ship.
if (typeof Element !== 'undefined' && !Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  Element.prototype.releasePointerCapture = function releasePointerCapture() {};
  Element.prototype.hasPointerCapture = function hasPointerCapture() { return false; };
}

// jsdom has no layout engine, so every rect is zero and `scrollIntoView` is
// missing. Tests that genuinely depend on geometry must set their own rects —
// see the marquee suite — rather than relying on anything here.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

if (typeof globalThis.matchMedia === 'undefined') {
  globalThis.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return false; },
  });
}

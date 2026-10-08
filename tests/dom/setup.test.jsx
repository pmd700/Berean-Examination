import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import { createPageUrl } from '@/utils';

/**
 * Guards on the test environment itself.
 *
 * A DOM suite that silently stops resolving `@/` imports, or runs without jsdom,
 * fails in ways that look like application bugs. These check the harness first so
 * a broken environment is never mistaken for broken code.
 */

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('DOM test environment', () => {
  it('runs in a real document', () => {
    expect(typeof document).toBe('object');
    expect(document.createElement('div').nodeType).toBe(1);
  });

  it('renders React into that document', () => {
    render(<p data-testid="probe">mounted</p>);
    expect(screen.getByTestId('probe').textContent).toBe('mounted');
  });

  it('resolves the app import alias', () => {
    // If `@/` stops resolving, every DOM suite fails at import time with an
    // error that reads like a missing module rather than a broken config.
    expect(createPageUrl('Study')).toBe('/Study');
  });

  it('fills the platform gaps jsdom leaves', () => {
    // Real components observe their own size and use pointer capture; without
    // these the editor and the marquee throw before any assertion is reached.
    expect(typeof globalThis.ResizeObserver).toBe('function');
    expect(typeof document.createElement('div').setPointerCapture).toBe('function');
  });

  it('keeps its aliases in step with the app build', () => {
    // Two configs that must agree. A drift here means tests resolve a different
    // module than the app ships.
    const appConfig = read('vite.config.js');
    const testConfig = read('vitest.config.js');
    for (const alias of ['@', '@shared', '@assets']) {
      const pattern = new RegExp(`'${alias}':\\s*path\\.resolve`);
      expect(pattern.test(appConfig), `${alias} missing from vite.config.js`).toBe(true);
      expect(pattern.test(testConfig), `${alias} missing from vitest.config.js`).toBe(true);
    }
  });

  it('does not collect the node --test suites', () => {
    // The two runners cover different things and must not try to run each
    // other's files: the node suites use node:test, which vitest cannot execute.
    const testConfig = read('vitest.config.js');
    expect(testConfig).toMatch(/include: \['tests\/dom\/\*\*/);
  });
});

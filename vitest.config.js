import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * The DOM test environment.
 *
 * This exists alongside the `node --test` suites rather than replacing them.
 * Those suites cover pure logic and structure and run fine without a DOM; this
 * one covers the things they cannot reach — a click actually opening a toggle, a
 * crash actually being contained, a press actually landing in the right widget.
 *
 * Deliberately scoped to `tests/dom/**` so the two runners never try to collect
 * each other's files, and so `npm test` keeps behaving exactly as it did.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirrors vite.config.js. Kept in step by a test in tests/dom/setup.test.jsx
    // rather than by hoping someone remembers.
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
      '@assets': path.resolve(__dirname, './attached_assets'),
      // tippy positions with Popper, which needs a layout engine jsdom lacks, so
      // it throws the moment the editor takes focus. Only the bubble menu's
      // placement depends on it. See tests/dom/stubs/tippy.js.
      'tippy.js': path.resolve(__dirname, './tests/dom/stubs/tippy.js'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    server: {
      deps: {
        // Vitest loads node_modules natively, which bypasses `resolve.alias` —
        // so the tippy stub above only ever applied to our own source, and any
        // suite that actually made the bubble menu build its tooltip still
        // crashed with "tippy is not a function". Routing the editor packages
        // through Vite is what makes the stub take effect.
        inline: [/@tiptap\//],
      },
    },
    include: ['tests/dom/**/*.test.{js,jsx}'],
    setupFiles: ['tests/dom/setup.js'],
    restoreMocks: true,
    css: false,
  },
});

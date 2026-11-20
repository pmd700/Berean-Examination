import { pdfAssetsPlugin } from '../../tools/vite-pdf-assets.mjs';
import { iphoneBibleAssets } from '../../tools/iphone-bible-assets.mjs';
import { licenseAssetsPlugin } from '../../tools/vite-license-assets.mjs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../..');
export default defineConfig({
  root: import.meta.dirname,
  plugins: [pdfAssetsPlugin(),iphoneBibleAssets(),licenseAssetsPlugin({ sourceRoot: root }),react()],
  publicDir: 'public',
  resolve: { alias: [
    { find: '@/lib/localOwner', replacement: path.join(import.meta.dirname, 'src/localOwner.js') },
    { find: '@/api/desktopClient', replacement: path.join(import.meta.dirname, 'src/mobileClient.js') },
    { find: '@', replacement: path.join(root, 'src') },
    { find: '@shared', replacement: path.join(root, 'shared') },
    { find: '@assets', replacement: path.join(root, 'attached_assets') },
  ] },
  server: { host: '127.0.0.1', port: 5178, fs: { allow: [root] } },
  build: { outDir: 'dist', emptyOutDir: true, manifest: true },
});

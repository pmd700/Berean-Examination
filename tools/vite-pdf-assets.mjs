import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ASSET_FOLDERS = ['cmaps', 'standard_fonts', 'wasm'];
const MIME_TYPES = { '.wasm': 'application/wasm', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };

// Bundle PDF.js's optional rendering resources and license notices locally.
// Same installed package as React-PDF's worker, served in both Vite and dist.
export function pdfAssetsPlugin() {
  let assets;
  function readAssets() {
    if (assets) return assets;
    const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
    assets = new Map();
    for (const folder of ASSET_FOLDERS) {
      const directory = path.join(root, folder);
      for (const name of fs.readdirSync(directory)) {
        const file = path.join(directory, name);
        if (fs.statSync(file).isFile()) assets.set(`pdf-assets/${folder}/${name}`, file);
      }
    }
    const reactPdfRoot = path.dirname(require.resolve('react-pdf/package.json'));
    for (const [name, file] of [
      ['PDFJS-LICENSE', path.join(root, 'LICENSE')],
      ['REACT-PDF-LICENSE', path.join(reactPdfRoot, 'LICENSE')],
    ]) assets.set(`pdf-assets/${name}`, file);
    return assets;
  }
  return {
    name: 'bex-local-pdf-assets',
    configureServer(server) {
      const files = readAssets();
      server.middlewares.use((request, response, next) => {
        let requestPath;
        try { requestPath = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname).replace(/^\//, ''); }
        catch { return next(); }
        const file = files.get(requestPath);
        if (!file) return next();
        if (!['GET', 'HEAD'].includes(request.method)) { response.statusCode = 405; response.end(); return; }
        response.setHeader('Content-Type', MIME_TYPES[path.extname(file)] || 'application/octet-stream');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Content-Length', fs.statSync(file).size);
        if (request.method === 'HEAD') { response.end(); return; }
        fs.createReadStream(file).on('error', () => response.destroy()).pipe(response);
      });
    },
    generateBundle() {
      for (const [fileName, sourcePath] of readAssets()) {
        this.emitFile({ type: 'asset', fileName, source: fs.readFileSync(sourcePath) });
      }
    },
  };
}

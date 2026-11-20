import { defineConfig, bindings } from 'cf/config';
export default defineConfig({ worker: {
  name: 'bex-iphone',
  compatibilityDate: '2026-11-11',
  entrypoint: './worker.js',
  assets: { htmlHandling: 'none', notFoundHandling: 'single-page-application', runWorkerFirst: ['/api/*'] },
  env: { BLOBS0: bindings.d1({ id: 'f54d9a8d-813c-4308-b2a1-84af8d3187be', name: 'bex-sync-blobs-0' }), BLOBS1: bindings.d1({ id: 'cb20040c-57a1-4858-9c22-d1c636826a0f', name: 'bex-sync-blobs-1' }), BLOBS2: bindings.d1({ id: '9fad4624-7c2e-4694-80d0-1e8525c4c7dc', name: 'bex-sync-blobs-2' }), BLOBS3: bindings.d1({ id: '08dec98a-dade-4ef0-b945-983255d3e53b', name: 'bex-sync-blobs-3' }), ASSETS: bindings.assets(), BOOTSTRAP_SECRET: bindings.secret(), SCRIPTURE_API_KEY: bindings.secret(), SCRIPTURE_VAULT_ID: bindings.secret(), DB: bindings.d1({ id: '78e8d3b9-1f15-47b3-bd4e-1675337f55e5', name: 'bex-sync-control' }) },
  observability: { enabled: true, redactQueryString: true, logs: { enabled: true, invocationLogs: false }, traces: { enabled: true, headSamplingRate: 0.01 } },
} });

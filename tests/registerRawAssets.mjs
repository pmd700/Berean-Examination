// Register an async loader alongside tsx so Node-only tests can read Vite's
// explicit ?raw imports without replacing actual bundled notices with mocks.
import { register } from 'node:module';
register('./rawAssetsLoader.mjs', import.meta.url);

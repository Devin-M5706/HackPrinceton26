import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Multi-page build.
 *
 * Three entry points, each a real HTML page rather than a client-side route,
 * so the landing page and the case map load without booting a router.
 *
 * Leaflet, Three.js and Firebase are npm dependencies bundled into the output.
 * They used to be <script> tags pointing at unpkg, gstatic and esm.sh, which
 * meant three third-party CDNs could each break or alter the app at runtime,
 * with no subresource integrity to detect it.
 */
export default defineConfig({
  build: {
    target: 'es2020',
    sourcemap: true,
    // Three.js makes the viewer chunk large, but it is only fetched on
    // viewer.html — the landing page and the map never pay for it.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        map: resolve(__dirname, 'map.html'),
        viewer: resolve(__dirname, 'viewer.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Lets `npm run dev` talk to a local backend without CORS setup.
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});

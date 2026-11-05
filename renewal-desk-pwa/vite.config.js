import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'splash/*.png'],
      // Single manifest: public/manifest.json ("Renewal Desk") is the one
      // manifest file. The plugin must not also emit manifest.webmanifest.
      manifest: false,
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          /^\/admin(\/.*)?$/,
          /^\/auth(\/.*)?$/,
          /^\/api(\/.*)?$/,
          /^\/bridge(\/.*)?$/,
          /^\/operations(\/.*)?$/,
          /^\/gym(\/.*)?$/,
          /^\/bot-web(\/.*)?$/,
          /^\/static(\/.*)?$/,
          /^\/uploads(\/.*)?$/,
        ],
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /\/api\/mobile\/v1\/(dashboard|settings)/,
            // Authenticated live data must never appear fresh from an old cache.
            handler: 'NetworkOnly'
          }
        ]
      }
    })
  ],
  server: {
    port: 5173,
    host: true
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    // Never prune hashed chunks: devices on a cached bundle still request
    // old chunk URLs. The build only ADDS new hashed files.
    emptyOutDir: false
  }
});

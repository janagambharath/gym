import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'splash/*.png'],
      manifest: {
        name: 'Renewal Desk',
        short_name: 'Renewal Desk',
        description: 'Gym management command center',
        theme_color: '#2563EB',
        background_color: '#F8F9FB',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /\/api\/mobile\/v1\/(dashboard|settings)/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 20, maxAgeSeconds: 300 }
            }
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
    outDir: 'dist'
  }
});

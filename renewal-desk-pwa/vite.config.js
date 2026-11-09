import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// V10-L19: stamp the build with a version string + build time so the app
// can show which bundle a phone is running (stale-bundle diagnosis
// without devtools). The Settings footer renders it; main.js logs it.
let appVersion = '1.0.0';
try {
  appVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version || appVersion;
} catch { /* keep the fallback */ }
let gitHash = '';
try {
  gitHash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch { /* not a git checkout — version without a hash is fine */ }
const versionString = gitHash ? `${appVersion}+${gitHash}` : appVersion;

export default defineConfig({
  // V10-L19: build-time version injection (see src/version.js).
  define: {
    __APP_VERSION__: JSON.stringify(versionString),
    __APP_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
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

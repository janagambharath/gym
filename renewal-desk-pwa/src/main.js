/* ═══════════════════════════════════════════════════════════════════════
   Renewal Desk PWA — Entry Point
   ═══════════════════════════════════════════════════════════════════════ */

import { boot } from './app.js';
import { bootVynla } from './vynla.js';
import { APP_VERSION, APP_BUILD_TIME } from './version.js';

// V10-L19: log the running build at boot so a bundle version is visible
// in any console capture (and in the Settings footer) — stale-bundle
// diagnosis without devtools.
console.log(`[Renewal Desk] App version ${APP_VERSION}${APP_BUILD_TIME ? ` (built ${APP_BUILD_TIME})` : ''}`);

// Boot when DOM is ready
const isVynla = window.location.pathname === '/vynla' || window.location.pathname.startsWith('/vynla/');
const start = isVynla ? bootVynla : boot;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}

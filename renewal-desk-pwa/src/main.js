/* ═══════════════════════════════════════════════════════════════════════
   Renewal Desk PWA — Entry Point
   ═══════════════════════════════════════════════════════════════════════ */

import { boot } from './app.js';
import { bootVynla } from './vynla.js';

// Boot when DOM is ready
const isVynla = window.location.pathname === '/vynla' || window.location.pathname.startsWith('/vynla/');
const start = isVynla ? bootVynla : boot;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}

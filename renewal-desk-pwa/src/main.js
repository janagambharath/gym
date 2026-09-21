/* ═══════════════════════════════════════════════════════════════════════
   Renewal Desk PWA — Entry Point
   ═══════════════════════════════════════════════════════════════════════ */

import { boot } from './app.js';

// Boot when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

/* App version stamp (V10-L19).
 *
 * Vite replaces __APP_VERSION__ / __APP_BUILD_TIME__ at build time (see
 * vite.config.js `define`). Under `node --test` those globals do not
 * exist — the typeof guards keep this module safe there, and the
 * Settings footer then reads "dev" instead of crashing.
 */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
export const APP_BUILD_TIME = typeof __APP_BUILD_TIME__ !== 'undefined' ? __APP_BUILD_TIME__ : '';

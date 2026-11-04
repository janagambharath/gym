// A screen owns its refresh work; hidden tabs keep their state, not their timers.
const controllers = new WeakMap();

export function activateScreen(el, active) {
  if (!el) return;
  el.dataset.screenActive = String(active);
  controllers.get(el)?.[active ? 'resume' : 'pause']();
}

export function disposeScreen(el) {
  if (!el) return;
  el.dataset.screenDisposed = 'true';
  controllers.get(el)?.dispose();
  controllers.delete(el);
}

export function attachLiveRefresh(el, refresh, intervalMs = 30000, cleanup = () => {}) {
  if (el.dataset.screenDisposed === 'true') { cleanup(); return; }
  controllers.get(el)?.dispose();
  let timer, busy = false, disposed = false, lastAttempt = 0;
  const visible = () => !disposed && el.isConnected && el.dataset.screenActive !== 'false'
    && document.visibilityState !== 'hidden' && navigator.onLine !== false;
  const run = async () => {
    if (!visible() || busy || Date.now() - lastAttempt < 1000) return;
    // Do not rebuild a form, an open confirmation, or text the owner is editing.
    if (document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')
      || document.querySelector('.modal-overlay, .sheet-overlay, #quick-assign-overlay')) return;
    busy = true;
    lastAttempt = Date.now();
    const positions = [el, ...el.querySelectorAll('.scroll-view, .rrr-page')].map(node => node.scrollTop);
    const windowPosition = window.scrollY;
    try { await refresh(); }
    catch (error) { console.warn('Automatic refresh failed', error); }
    finally {
      if (visible()) {
        [el, ...el.querySelectorAll('.scroll-view, .rrr-page')].forEach((node, index) => {
          if (positions[index] !== undefined) node.scrollTop = positions[index];
        });
        window.scrollTo(0, windowPosition);
      }
      busy = false;
    }
  };
  const pause = () => { clearInterval(timer); timer = undefined; };
  const resume = () => {
    pause();
    if (!visible()) return;
    void run();
    timer = setInterval(run, intervalMs);
  };
  const wake = () => visible() ? resume() : pause();
  const dispose = () => {
    disposed = true;
    pause();
    document.removeEventListener('visibilitychange', wake);
    window.removeEventListener('focus', wake);
    window.removeEventListener('online', wake);
    window.removeEventListener('offline', wake);
    cleanup();
  };
  controllers.set(el, { resume, pause, dispose });
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('focus', wake);
  window.addEventListener('online', wake);
  window.addEventListener('offline', wake);
  // The caller has already performed the initial load.
  if (visible()) timer = setInterval(run, intervalMs);
}

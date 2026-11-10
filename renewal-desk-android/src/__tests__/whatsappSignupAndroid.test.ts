import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// NOTE: the modal itself is never imported here — it pulls in react-native
// (see avatarContent.test.ts for the same constraint). All assertions are
// source-regex checks, the established pattern for component behaviour.

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const modal = () => readSource('../components/WhatsAppOnboardingModal.tsx');

// ── W-H6 (Android half): the app is the single owner of the code exchange ──

test('W-H6: code branch ignores a second code post while an exchange is in flight', () => {
  const src = modal();
  assert.match(src, /codeExchangeInFlightRef = useRef<string \| null>\(null\)/);
  assert.match(src, /if \(codeExchangeInFlightRef\.current\) return;/);
  assert.match(src, /codeExchangeInFlightRef\.current = data\.code;/);
  // The flag is always released, even when the exchange throws.
  assert.match(src, /codeExchangeInFlightRef\.current = null;/);
});

test('W-H6: IDs fallthrough branch never runs a second exchange during a code exchange', () => {
  const src = modal();
  assert.match(
    src,
    /if \(codeExchangeInFlightRef\.current \|\| signupCompletedRef\.current\) return;/,
  );
});

test('W-H6: a failed code exchange re-checks server status before alerting failure', () => {
  const src = modal();
  // Both the !ok path and the throw path consult connection status first.
  const statusChecks = src.match(/const status = await fetchConnectionStatus\(\);/g) ?? [];
  assert.ok(
    statusChecks.length >= 3,
    `expected >=3 status re-checks (code !ok, code throw, complete), got ${statusChecks.length}`,
  );
  assert.match(src, /if \(status\?\.status === 'CONNECTED'\) \{\s*finishConnected\(status\);/);
  // The failure alert survives only for a connection that really failed.
  assert.match(src, /Alert\.alert\('Verification Pending'/);
});

test('W-H6: a late second success signal cannot double-alert or double-fire onConnected', () => {
  const src = modal();
  assert.match(src, /signupCompletedRef = useRef\(false\)/);
  assert.match(src, /if \(signupCompletedRef\.current\) return;/);
});

// ── W-M6: explicit embedded_signup_complete case ───────────────────────────

test('W-M6: embedded_signup_complete has its own case (no reliance on IDs fallthrough)', () => {
  const src = modal();
  assert.match(src, /if \(data\.type === 'embedded_signup_complete'\) \{/);
  const completeIdx = src.indexOf("data.type === 'embedded_signup_complete'");
  const codeIdx = src.indexOf("data.type === 'embedded_signup_code'");
  assert.ok(completeIdx !== -1 && codeIdx !== -1 && completeIdx < codeIdx);
});

test('W-M6: complete case re-checks connection status and surfaces Connected on CONNECTED', () => {
  const src = modal();
  const completeBlock = src.slice(
    src.indexOf("data.type === 'embedded_signup_complete'"),
    src.indexOf("data.type === 'embedded_signup_code'"),
  );
  assert.match(completeBlock, /fetchConnectionStatus\(\)/);
  assert.match(completeBlock, /finishConnected\(status\)/);
  // No IDs + not connected: an explicit alert, never a silent ignore.
  assert.match(completeBlock, /Alert\.alert\(\s*'Signup Finished',/);
});

// ── W-M7: WebView stall watchdog ───────────────────────────────────────────

test('W-M7: stall watchdog is 5 minutes (300000 ms)', () => {
  assert.match(modal(), /export const WEBVIEW_STALL_TIMEOUT_MS = 300_000;/);
});

test('W-M7: watchdog arms on load/navigation, alerts Retry/Cancel, reloads on Retry', () => {
  const src = modal();
  assert.match(src, /onLoadEnd=\{\(\) => \{\s*if \(webViewOpenRef\.current\) armWebViewStallTimer\(\);/);
  assert.match(src, /onNavigationStateChange=\{\(navState\) => \{\s*currentWebViewUrlRef\.current = navState\.url;\s*if \(webViewOpenRef\.current\) armWebViewStallTimer\(\);/);
  assert.match(src, /setTimeout\(\(\) => \{[\s\S]*?WEBVIEW_STALL_TIMEOUT_MS\)/);
  assert.match(src, /Alert\.alert\(\s*'Setup is taking too long',/);
  // Retry reloads; the watchdog is re-armed by onLoadEnd when the
  // reloaded page loads (no self-reference inside the timer callback).
  assert.match(src, /text: 'Retry',[\s\S]*?onPress: \(\) => \{[\s\S]*?webViewRef\.current\?\.reload\(\);/);
  assert.match(src, /text: 'Cancel', style: 'cancel', onPress: \(\) => handleWebViewClose\(\) \}/);
});

test('W-M7: watchdog is cleared on close, on load failure, and on unmount', () => {
  const src = modal();
  assert.match(src, /const handleWebViewClose = useCallback\(\(\) => \{\s*clearWebViewStallTimer\(\);/);
  assert.match(src, /useEffect\(\(\) => clearWebViewStallTimer, \[clearWebViewStallTimer\]\)/);
  const onErrorIdx = src.indexOf('onError={() => {');
  assert.ok(onErrorIdx !== -1);
  assert.match(src.slice(onErrorIdx, onErrorIdx + 400), /clearWebViewStallTimer\(\);/);
});

// ── W-L7: bare catch fixed ─────────────────────────────────────────────────

test('W-L7: no bare catch {} remains in the modal; the code-branch throw surfaces a reason', () => {
  const src = modal();
  const codeIdx = src.indexOf("data.type === 'embedded_signup_code'");
  const codeBlock = src.slice(codeIdx, src.indexOf('Support both standard formats'));
  // The code branch must name its error (no bare catch) and alert it.
  // (The W-L7 comment itself mentions "catch {}" in prose, so match
  // the statement form `} catch {`.)
  assert.doesNotMatch(codeBlock, /\} catch \{/);
  assert.match(codeBlock, /catch \(err\) \{/);
  assert.match(codeBlock, /Alert\.alert\(\s*'Connection Failed',/);
  assert.match(codeBlock, /err instanceof Error && err\.message/);
});

// ── W-H3 (Android half): external-browser return path ─────────────────────

test('W-H3: return from the external browser is detected via AppState, not the open promise', () => {
  const src = modal();
  // On Android openBrowserAsync resolves with {type:'opened'} as soon
  // as the tab opens, so the promise cannot be the return signal.
  assert.match(src, /AppState\.addEventListener\('change',/);
  assert.match(src, /handleExternalBrowserReturn/);
  assert.match(src, /externalBrowserPendingRef\.current = true;/);
  assert.doesNotMatch(src, /void WebBrowser\.openBrowserAsync/);
});

test('W-H3: every external-browser open routes through the pending + return-check helper', () => {
  const src = modal();
  const calls = src.match(/openMetaInExternalBrowser\(/g) ?? [];
  // Page message + header button + FB popup window (definition line
  // is `= useCallback(`, so it does not match this pattern).
  assert.ok(calls.length >= 3, `expected >=3 openMetaInExternalBrowser call sites, got ${calls.length}`);
  const returnBlock = src.slice(
    src.indexOf('const handleExternalBrowserReturn'),
    src.indexOf('const openMetaInExternalBrowser'),
  );
  assert.match(returnBlock, /fetchConnectionStatus\(\)/);
  assert.match(returnBlock, /if \(status\?\.status === 'CONNECTED'\) \{\s*finishConnected\(status\);/);
  // Not connected after return: stay in the WebView, re-arm the watchdog.
  assert.match(returnBlock, /armWebViewStallTimer\(\);/);
});

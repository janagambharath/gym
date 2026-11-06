/**
 * WhatsAppSetupScreen — Meta Embedded Signup flow via WebView.
 *
 * This screen loads a lightweight HTML page (served by the backend at
 * /api/mobile/v1/whatsapp/embedded-signup-page) inside a WebView.
 *
 * The HTML page loads Meta's Facebook SDK and initiates the Embedded Signup
 * OAuth flow. When the user completes (or cancels) the flow, the page sends
 * a postMessage back to React Native with the waba_id, phone_number_id, and
 * business_phone_number. This screen then POSTs them to /connect-waba.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as WebBrowser from 'expo-web-browser';
import { AppHeader } from '../components/AppHeader';
import { connectWaba, getWhatsAppOnboardingConfig } from '../services/apiClient';
import { getRuntimeConfiguration } from '../config/runtime';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing, fontFamily} from '../theme/tokens';

type WhatsAppSetupScreenProps = {
  onBack: () => void;
  onConnected?: () => void;
};

type SetupState =
  | { phase: 'loading' }
  | { phase: 'ready'; url: string }
  | { phase: 'connecting'; waba_id: string; phone_number_id: string; business_phone_number?: string }
  | { phase: 'success'; phone_number_id: string }
  | { phase: 'error'; message: string };

export function WhatsAppSetupScreen({ onBack, onConnected }: WhatsAppSetupScreenProps) {
  const [state, setState] = useState<SetupState>({ phase: 'loading' });
  const webViewRef = useRef<WebView>(null);
  // URL actually loaded in the WebView right now (updated on every
  // navigation). The postMessage origin check below is based on THIS, not
  // on the URL we originally asked the WebView to load — after an OAuth
  // redirect the two differ, and a message from the redirected page must
  // not be trusted as if it came from our signup page.
  const currentUrlRef = useRef<string | null>(null);

  // ── 1. Load onboarding config → build Embedded Signup page URL ──
  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      const config = getRuntimeConfiguration();
      if (!config.apiBaseUrl) {
        setState({ phase: 'error', message: 'API URL is not configured.' });
        return;
      }

      const res = await getWhatsAppOnboardingConfig();
      if (cancelled) return;

      if (!res.ok) {
        setState({
          phase: 'error',
          message: res.error.message || 'Could not load WhatsApp setup configuration.',
        });
        return;
      }

      const { meta_app_id, config_id, signup_handshake } = res.data;
      if (!meta_app_id || !config_id || !signup_handshake) {
        setState({
          phase: 'error',
          message: 'Meta App ID or Configuration ID is missing. Contact support.',
        });
        return;
      }

      // Build the URL for the backend-hosted Embedded Signup page.
      // The backend injects the correct META_APP_ID and META_CONFIG_ID into
      // the HTML. The page is served at a public (no-auth) route so the
      // WebView doesn't need to send Bearer tokens for the page load itself.
      // Never put the full access token in the URL — use the short-lived handshake.
      const pageUrl = `${config.apiBaseUrl}/api/mobile/v1/whatsapp/embedded-signup-page?handshake=${encodeURIComponent(signup_handshake)}&meta_app_id=${encodeURIComponent(meta_app_id)}&config_id=${encodeURIComponent(config_id)}`;

      setState({ phase: 'ready', url: pageUrl });
    }

    void loadConfig();
    return () => { cancelled = true; };
  }, []);

  // ── 2. Handle postMessage from the Embedded Signup WebView ──
  const handleWebViewMessage = useCallback(async (event: WebViewMessageEvent) => {
    // Origin check (same pattern as the live WhatsAppOnboardingModal):
    // react-native-webview does not report the posting frame's origin, so
    // only accept messages while the URL actually loaded in the WebView
    // is our backend-hosted signup page (same origin as the configured API
    // base). Messages from any other page — a redirect, an ad, a spoofed
    // frame — are ignored.
    const loadedUrl = currentUrlRef.current ?? (state.phase === 'ready' ? state.url : null);
    if (!loadedUrl) return;
    let loadedOrigin = '';
    try {
      loadedOrigin = new URL(loadedUrl).origin;
    } catch {
      return;
    }
    let expectedOrigin = '';
    try {
      const base = getRuntimeConfiguration().apiBaseUrl;
      expectedOrigin = base ? new URL(base).origin : '';
    } catch {
      return;
    }
    if (!expectedOrigin || loadedOrigin !== expectedOrigin) return;

    let data: Record<string, any>;
    try {
      data = JSON.parse(event.nativeEvent.data);
    } catch {
      console.warn('[WhatsAppSetup] Invalid postMessage data:', event.nativeEvent.data);
      return;
    }

    if (data.type === 'open_external_browser') {
      const targetUrl = data.direct_meta_url || (state.phase === 'ready' ? state.url : null);
      // Only ever open Meta signup URLs from this message — never an
      // arbitrary URL supplied by page content.
      if (targetUrl) {
        try {
          const host = new URL(targetUrl).hostname.toLowerCase();
          if (host === 'facebook.com' || host.endsWith('.facebook.com')) {
            void WebBrowser.openBrowserAsync(targetUrl);
          }
        } catch {
          // Ignore malformed URLs.
        }
      }
      return;
    }

    if (data.type === 'embedded_signup_cancel') {
      onBack();
      return;
    }

    if (data.type === 'embedded_signup_error') {
      setState({ phase: 'error', message: data.message || 'Embedded Signup failed.' });
      return;
    }

    if (data.type === 'embedded_signup_code' && data.code) {
      setState({ phase: 'connecting', waba_id: '', phone_number_id: '' });
      const connectRes = await connectWaba({
        code: data.code,
        businessId: data.business_id || '',
      });
      if (connectRes.ok) {
        setState({ phase: 'success', phone_number_id: connectRes.data.phone_number_id });
      } else {
        setState({
          phase: 'error',
          message: connectRes.error.message || 'Failed to connect WhatsApp Business account.',
        });
      }
      return;
    }


    let phone_number_id = data.phone_number_id || data.phoneNumberId;
    let waba_id = data.waba_id || data.wabaId;
    let business_phone_number = data.business_phone_number || data.businessPhoneNumber || data.display_phone_number;

    if (data.type === 'WA_EMBEDDED_SIGNUP' && data.data) {
      phone_number_id = data.data.phone_number_id || data.data.phoneNumberId || phone_number_id;
      waba_id = data.data.waba_id || data.data.wabaId || waba_id;
      business_phone_number = data.data.display_phone_number || data.data.business_phone_number || business_phone_number;
    }

    if (!phone_number_id && !waba_id) {
      if (data.type === 'embedded_signup_complete' || data.type === 'WA_EMBEDDED_SIGNUP') {
        setState({ phase: 'error', message: 'No WhatsApp account details were returned by Meta.' });
      }
      return;
    }

    setState({ phase: 'connecting', waba_id: waba_id || '', phone_number_id: phone_number_id || '', business_phone_number });

    // POST to backend
    const connectRes = await connectWaba({
      wabaId: waba_id ? String(waba_id) : undefined,
      phoneNumberId: phone_number_id ? String(phone_number_id) : undefined,
      businessPhoneNumber: business_phone_number ? String(business_phone_number) : undefined,
    });

    if (connectRes.ok) {
      setState({ phase: 'success', phone_number_id: connectRes.data.phone_number_id });
    } else {
      setState({
        phase: 'error',
        message: connectRes.error.message || 'Failed to connect WhatsApp Business account.',
      });
    }
  }, [onBack, state]);

  // ── Render ────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Connect WhatsApp" onBack={onBack} />

      {state.phase === 'loading' && (
        <View style={styles.centeredContainer}>
          <ActivityIndicator color={colors.brand} size="large" />
          <Text style={styles.loadingText}>Loading WhatsApp setup...</Text>
        </View>
      )}

      {state.phase === 'ready' && (
        <WebView
          ref={webViewRef}
          source={{ uri: state.url }}
          style={styles.webview}
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
          allowsInlineMediaPlayback
          setSupportMultipleWindows
          javaScriptCanOpenWindowsAutomatically
          onMessage={handleWebViewMessage}
          onNavigationStateChange={(navState) => {
            currentUrlRef.current = navState.url;
          }}
          startInLoadingState
          userAgent="Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36"
          onShouldStartLoadWithRequest={(request) => {
            // Allow only our own signup page and Meta OAuth hosts. (This
            // previously returned true for every URL — "Allow all".)
            const url = request.url || '';
            try {
              const parsed = new URL(url);
              const host = parsed.hostname.toLowerCase();
              if (state.phase === 'ready' && parsed.origin === new URL(state.url).origin) {
                return true;
              }
              if (
                host === 'facebook.com' ||
                host.endsWith('.facebook.com') ||
                host.endsWith('.fbcdn.net') ||
                host === 'fb.com' ||
                host.endsWith('.fb.com') ||
                host === 'connect.facebook.net' ||
                host === 'whatsapp.com' ||
                host.endsWith('.whatsapp.com')
              ) {
                return true;
              }
            } catch {
              return false;
            }
            return false;
          }}
          onOpenWindow={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent;
            if (nativeEvent.targetUrl) {
              void WebBrowser.openBrowserAsync(nativeEvent.targetUrl);
            }
          }}
          renderLoading={() => (
            <View style={styles.webviewLoading}>
              <ActivityIndicator color={colors.brand} size="large" />
              <Text style={styles.loadingText}>Opening Meta Business setup...</Text>
            </View>
          )}
          onError={(event) => {
            setState({
              phase: 'error',
              message: `Could not load setup page: ${event.nativeEvent.description || 'Network error'}`,
            });
          }}
        />
      )}

      {state.phase === 'connecting' && (
        <View style={styles.centeredContainer}>
          <ActivityIndicator color={colors.brand} size="large" />
          <Text style={styles.connectingTitle}>Connecting your WhatsApp Business account...</Text>
          <Text style={styles.connectingSubtext}>
            Phone Number ID: {state.phone_number_id}
          </Text>
        </View>
      )}

      {state.phase === 'success' && (
        <View style={styles.centeredContainer}>
          <View style={styles.successIconWrap}>
            <Icon name="checkmark" size={40} color={colors.textInverse} />
          </View>
          <Text style={styles.successTitle}>WhatsApp Connected!</Text>
          <Text style={styles.successSubtext}>
            Your business number is now linked to Renewal Desk. Automated renewal reminders and AI receptionist are ready to go.
          </Text>
          <TouchableOpacity
            style={styles.successButton}
            onPress={() => {
              onConnected?.();
              onBack();
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.successButtonText}>Go to WhatsApp Dashboard</Text>
            <Icon name="forward" size={16} color={colors.textInverse} />
          </TouchableOpacity>
        </View>
      )}

      {state.phase === 'error' && (
        <View style={styles.centeredContainer}>
          <View style={styles.errorIconWrap}>
            <Icon name="warning" size={40} color={colors.textInverse} />
          </View>
          <Text style={styles.errorTitle}>Setup Failed</Text>
          <Text style={styles.errorSubtext}>{state.message}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => setState({ phase: 'loading' })}
            activeOpacity={0.8}
          >
            <Icon name="refresh" size={16} color={colors.brand} />
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.backButton}
            onPress={onBack}
            activeOpacity={0.7}
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  centeredContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxxl,
  },
  loadingText: {
    color: colors.muted,
    fontSize: fontSize.base,
    marginTop: spacing.lg,
  },
  webview: {
    flex: 1,
  },
  webviewLoading: {
    alignItems: 'center',
    backgroundColor: colors.background,
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  connectingTitle: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
    marginTop: spacing.xxl,
    textAlign: 'center',
  },
  connectingSubtext: {
    color: colors.muted,
    fontSize: fontSize.sm,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  successIconWrap: {
    alignItems: 'center',
    backgroundColor: colors.success,
    borderRadius: 40,
    height: 80,
    justifyContent: 'center',
    width: 80,
    ...shadows.lg,
  },
  successTitle: {
    color: colors.text,
    fontSize: fontSize['4xl'],
    fontWeight: fontWeight.extrabold, fontFamily: fontFamily.displayExtra,
    marginTop: spacing.xxl,
    textAlign: 'center',
  },
  successSubtext: {
    color: colors.textSecondary,
    fontSize: fontSize.base,
    lineHeight: 22,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  successButton: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radius.lg,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    marginTop: spacing.xxxl,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.lg,
    ...shadows.md,
  },
  successButtonText: {
    color: colors.textInverse,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
  errorIconWrap: {
    alignItems: 'center',
    backgroundColor: colors.critical,
    borderRadius: 40,
    height: 80,
    justifyContent: 'center',
    width: 80,
    ...shadows.lg,
  },
  errorTitle: {
    color: colors.text,
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
    marginTop: spacing.xxl,
    textAlign: 'center',
  },
  errorSubtext: {
    color: colors.textSecondary,
    fontSize: fontSize.base,
    lineHeight: 22,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  retryButton: {
    alignItems: 'center',
    borderColor: colors.brand,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    marginTop: spacing.xxxl,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
  },
  retryButtonText: {
    color: colors.brand,
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
  backButton: {
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  backButtonText: {
    color: colors.muted,
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
  },
});

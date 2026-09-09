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
import { AppHeader } from '../components/AppHeader';
import { connectWaba, getWhatsAppOnboardingConfig } from '../services/apiClient';
import { getRuntimeConfiguration } from '../config/runtime';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';

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

      const { meta_app_id, config_id } = res.data;
      if (!meta_app_id || !config_id) {
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
      const pageUrl = `${config.apiBaseUrl}/api/mobile/v1/whatsapp/embedded-signup-page?meta_app_id=${encodeURIComponent(meta_app_id)}&config_id=${encodeURIComponent(config_id)}`;

      setState({ phase: 'ready', url: pageUrl });
    }

    void loadConfig();
    return () => { cancelled = true; };
  }, []);

  // ── 2. Handle postMessage from the Embedded Signup WebView ──
  const handleWebViewMessage = useCallback(async (event: WebViewMessageEvent) => {
    let data: Record<string, string>;
    try {
      data = JSON.parse(event.nativeEvent.data);
    } catch {
      console.warn('[WhatsAppSetup] Invalid postMessage data:', event.nativeEvent.data);
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

    if (data.type !== 'embedded_signup_complete') {
      return;
    }

    const { waba_id, phone_number_id, business_phone_number } = data;
    if (!phone_number_id) {
      setState({ phase: 'error', message: 'Phone Number ID was not returned by Meta.' });
      return;
    }

    setState({ phase: 'connecting', waba_id: waba_id || '', phone_number_id, business_phone_number });

    // POST to backend
    const connectRes = await connectWaba({
      wabaId: waba_id,
      phoneNumberId: phone_number_id,
      businessPhoneNumber: business_phone_number,
    });

    if (connectRes.ok) {
      setState({ phase: 'success', phone_number_id: connectRes.data.phone_number_id });
    } else {
      setState({
        phase: 'error',
        message: connectRes.error.message || 'Failed to connect WhatsApp Business account.',
      });
    }
  }, [onBack]);

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
          onMessage={handleWebViewMessage}
          startInLoadingState
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
    fontWeight: fontWeight.bold,
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
    fontWeight: fontWeight.extrabold,
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
    fontWeight: fontWeight.bold,
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
    fontWeight: fontWeight.bold,
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
    fontWeight: fontWeight.bold,
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

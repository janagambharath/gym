import React, { useCallback, useState } from 'react';
import {
  Alert,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
} from 'react-native';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { colors, fontSize, fontWeight, radius } from '../theme/tokens';

try {
  WebBrowser.maybeCompleteAuthSession();
} catch {
  // Graceful no-op if unsupported in runtime
}

const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID?.trim() || '';
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() || '';

// Verify that a valid client ID exists before mounting the hook
export const isGoogleAuthConfigured = Boolean(
  GOOGLE_ANDROID_CLIENT_ID || GOOGLE_WEB_CLIENT_ID
);

interface GoogleAuthButtonProps {
  onSuccess: (idToken: string) => Promise<void> | void;
  onError: (errorMsg: string) => void;
  disabled?: boolean;
  text?: string;
}

/**
 * Inner component that ONLY mounts when a valid Google Client ID is configured.
 * This guarantees `Google.useIdTokenAuthRequest` is never called without a client ID,
 * preventing `invariantClientId` from throwing a fatal crash on Android.
 */
function ActiveGoogleAuthButton({
  onSuccess,
  onError,
  disabled,
  text = 'Continue with Google',
}: GoogleAuthButtonProps) {
  const [loading, setLoading] = useState(false);

  const activeClientId = GOOGLE_ANDROID_CLIENT_ID || GOOGLE_WEB_CLIENT_ID;

  const [, , promptAsync] = Google.useIdTokenAuthRequest({
    clientId: activeClientId,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID || GOOGLE_WEB_CLIENT_ID,
    webClientId: GOOGLE_WEB_CLIENT_ID || GOOGLE_ANDROID_CLIENT_ID,
  });

  const handlePress = useCallback(async () => {
    if (loading || disabled) return;
    setLoading(true);
    try {
      const res = await promptAsync();
      if (res?.type === 'success') {
        const idToken = res.params?.id_token || (res as any)?.authentication?.idToken;
        if (idToken) {
          await onSuccess(idToken);
        } else {
          onError('Google sign-in did not return a valid credential token.');
        }
      } else if (res?.type === 'error') {
        onError('Google sign-in failed. Please try again.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An error occurred during Google sign-in.';
      onError(msg);
    } finally {
      setLoading(false);
    }
  }, [loading, disabled, promptAsync, onSuccess, onError]);

  return (
    <TouchableOpacity
      style={[styles.googleBtn, (loading || disabled) && styles.googleBtnDisabled]}
      onPress={() => void handlePress()}
      disabled={loading || disabled}
      activeOpacity={0.8}
    >
      <Image
        source={{ uri: 'https://developers.google.com/identity/images/g-logo.png' }}
        style={styles.googleIcon}
      />
      <Text style={styles.googleBtnText}>
        {loading ? 'Connecting...' : text}
      </Text>
    </TouchableOpacity>
  );
}

/**
 * Safe wrapper: If Google OAuth credentials are not configured in this build,
 * it renders a fallback button that informs the user via Alert rather than crashing.
 */
export function GoogleAuthButton(props: GoogleAuthButtonProps) {
  const { disabled, text = 'Continue with Google' } = props;

  if (!isGoogleAuthConfigured) {
    return (
      <TouchableOpacity
        style={[styles.googleBtn, disabled && styles.googleBtnDisabled]}
        onPress={() => {
          Alert.alert(
            'Google Sign-In',
            'Google Sign-In is not configured for this build. Please sign in with your email and password.',
            [{ text: 'OK' }]
          );
        }}
        disabled={disabled}
        activeOpacity={0.8}
      >
        <Image
          source={{ uri: 'https://developers.google.com/identity/images/g-logo.png' }}
          style={styles.googleIcon}
        />
        <Text style={styles.googleBtnText}>{text}</Text>
      </TouchableOpacity>
    );
  }

  return <ActiveGoogleAuthButton {...props} />;
}

const styles = StyleSheet.create({
  googleBtn: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    height: 50,
    justifyContent: 'center',
    gap: 10,
  },
  googleBtnDisabled: {
    opacity: 0.6,
  },
  googleBtnText: {
    color: colors.text,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  googleIcon: {
    height: 20,
    width: 20,
  },
});

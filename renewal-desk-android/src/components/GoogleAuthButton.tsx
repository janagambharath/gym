import React, { useCallback, useEffect, useRef, useState } from 'react';
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

  const activeClientId = GOOGLE_WEB_CLIENT_ID || GOOGLE_ANDROID_CLIENT_ID;

  // On Android the provider first returns an authorization code, then
  // exchanges it asynchronously for an ID token. The hook's ``response``
  // changes only after that exchange; reading the value returned directly by
  // promptAsync therefore drops valid sign-ins before their token arrives.
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: activeClientId,
    webClientId: GOOGLE_WEB_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
    selectAccount: true,
  });
  const completedToken = useRef<string | null>(null);

  useEffect(() => {
    if (!response || response.type !== 'success') {
      if (response?.type === 'error') {
        setLoading(false);
        onError('Google sign-in could not be completed. Please try again or use email and password.');
      }
      return;
    }

    const idToken = response.params?.id_token || response.authentication?.idToken;
    if (!idToken) {
      // The hook temporarily reports a successful code response while it is
      // exchanging that code. Wait for the completed response rather than
      // incorrectly treating it as a failed sign-in.
      return;
    }
    if (completedToken.current === idToken) {
      return;
    }
    completedToken.current = idToken;

    void Promise.resolve(onSuccess(idToken))
      .catch(() => onError('Google sign-in could not be completed. Please try again or use email and password.'))
      .finally(() => setLoading(false));
  }, [onError, onSuccess, response]);

  const handlePress = useCallback(async () => {
    if (loading || disabled) return;
    if (!request) {
      onError('Google sign-in is still preparing. Please wait a moment and try again.');
      return;
    }
    setLoading(true);
    completedToken.current = null;
    try {
      const result = await promptAsync();
      if (result.type !== 'success') {
        setLoading(false);
        if (result.type === 'error') {
          onError('Google sign-in could not be completed. Please try again or use email and password.');
        }
      }
    } catch (err: unknown) {
      setLoading(false);
      const msg = err instanceof Error ? err.message : 'An error occurred during Google sign-in.';
      onError(msg);
    }
  }, [loading, disabled, onError, promptAsync, request]);

  return (
    <TouchableOpacity
      style={[styles.googleBtn, (loading || disabled || !request) && styles.googleBtnDisabled]}
      onPress={() => void handlePress()}
      disabled={loading || disabled || !request}
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

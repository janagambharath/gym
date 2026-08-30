import { useCallback, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
import { login } from '../services/apiClient';
import { colors, fontSize, fontWeight, radius, spacing } from '../theme/tokens';

type LoginScreenProps = {
  onLogin: () => void;
  onNavigateSignup?: () => void;
};

export function LoginScreen({ onLogin, onNavigateSignup }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const handleLogin = useCallback(async () => {
    if (loading) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('Email and password are required.');
      return;
    }

    setLoading(true);
    setError(undefined);

    const result = await login(trimmedEmail, password);
    if (result.ok) {
      onLogin();
    } else {
      setError(result.error.message);
    }
    setLoading(false);
  }, [email, password, loading, onLogin]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <View style={styles.container}>
          {/* Branding */}
          <View style={styles.branding}>
            <View style={styles.logoContainer}>
              <Image
                source={require('../../assets/logo.png')}
                style={styles.logoImage}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.brandTitle}>Renewal Desk</Text>
            <Text style={styles.brandSubtitle}>
              Your gym management command center
            </Text>
          </View>

          {/* Form */}
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>Sign in</Text>
            <Text style={styles.formSubtitle}>
              Enter your credentials to continue
            </Text>

            <View style={styles.form}>
              <FormField
                label="Email"
                value={email}
                onChangeText={(t) => { setEmail(t); setError(undefined); }}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                returnKeyType="next"
              />

              <FormField
                label="Password"
                value={password}
                onChangeText={(t) => { setPassword(t); setError(undefined); }}
                placeholder="Enter your password"
                secureTextEntry
                returnKeyType="go"
                onSubmitEditing={() => void handleLogin()}
              />

              {error ? (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <PrimaryButton
                label="Sign In"
                onPress={() => void handleLogin()}
                loading={loading}
                disabled={!email.trim() || !password}
              />
            </View>
          </View>

          {/* Signup Link */}
          {onNavigateSignup && (
            <View style={styles.signupRow}>
              <Text style={styles.signupText}>New gym owner? </Text>
              <TouchableOpacity onPress={onNavigateSignup}>
                <Text style={styles.signupLink}>Create an Account</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Footer */}
          <Text style={styles.footer}>
            Secure login · Data encrypted in transit
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  branding: {
    alignItems: 'center',
    marginBottom: spacing.xxxl,
  },
  brandSubtitle: {
    color: colors.muted,
    fontSize: fontSize.lg,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  brandTitle: {
    color: colors.text,
    fontSize: fontSize['6xl'],
    fontWeight: fontWeight.extrabold,
    letterSpacing: -1,
    marginTop: spacing.lg,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  errorBanner: {
    backgroundColor: colors.criticalSurface,
    borderColor: colors.criticalBorder,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  errorText: {
    color: colors.critical,
    fontSize: fontSize.base,
  },
  flex: {
    flex: 1,
  },
  signupRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  signupText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  signupLink: {
    color: colors.brand,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  footer: {
    color: colors.muted,
    fontSize: fontSize.sm,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  form: {
    gap: spacing.lg,
    marginTop: spacing.xxl,
  },
  formCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.xxl,
  },
  formSubtitle: {
    color: colors.muted,
    fontSize: fontSize.base,
    marginTop: spacing.xs,
  },
  formTitle: {
    color: colors.text,
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.bold,
  },
  logoContainer: {
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: radius.xl,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  logoImage: {
    height: 56,
    width: 56,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
});

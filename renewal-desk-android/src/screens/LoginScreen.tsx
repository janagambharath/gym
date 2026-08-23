import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { PrimaryButton } from '../components/PrimaryButton';
import { login } from '../services/apiClient';
import { colors, radius, spacing } from '../theme/tokens';

type LoginScreenProps = {
  onLoginSuccess: () => void;
};

export function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const handleLogin = useCallback(async () => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !password) {
      setError('Please enter your email and password.');
      return;
    }

    setError(undefined);
    setLoading(true);

    try {
      const result = await login(trimmedEmail, password);
      if (result.ok) {
        onLoginSuccess();
      } else {
        setError(result.error.message);
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [email, password, onLoginSuccess]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.brand}>
              Renewal Desk
            </Text>
            <Text style={styles.subtitle}>Sign in to manage your gym</Text>
          </View>

          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                accessibilityLabel="Email address"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                editable={!loading}
                keyboardType="email-address"
                onChangeText={setEmail}
                placeholder="owner@yourgym.com"
                placeholderTextColor={colors.muted}
                returnKeyType="next"
                style={styles.input}
                textContentType="emailAddress"
                value={email}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                accessibilityLabel="Password"
                autoCapitalize="none"
                autoComplete="password"
                editable={!loading}
                onChangeText={setPassword}
                onSubmitEditing={() => void handleLogin()}
                placeholder="Enter your password"
                placeholderTextColor={colors.muted}
                returnKeyType="go"
                secureTextEntry
                style={styles.input}
                textContentType="password"
                value={password}
              />
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {loading ? (
              <ActivityIndicator
                accessibilityLabel="Signing in"
                color={colors.brand}
                size="large"
                style={styles.spinner}
              />
            ) : (
              <PrimaryButton
                disabled={!email.trim() || !password}
                label="Sign in"
                onPress={() => void handleLogin()}
              />
            )}
          </View>

          <Text style={styles.footer}>
            Secure login via your Renewal Desk backend.{'\n'}
            No credentials are stored in this app.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  brand: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  errorBox: {
    backgroundColor: colors.criticalSurface,
    borderColor: '#FDA29B',
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.sm,
  },
  errorText: {
    color: colors.critical,
    fontSize: 14,
    lineHeight: 20,
  },
  field: {
    gap: spacing.xxs,
  },
  flex: {
    flex: 1,
  },
  footer: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: spacing.xl,
    textAlign: 'center',
  },
  form: {
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  header: {
    alignItems: 'center',
    gap: spacing.xxs,
  },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  spinner: {
    marginVertical: spacing.sm,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 16,
  },
});

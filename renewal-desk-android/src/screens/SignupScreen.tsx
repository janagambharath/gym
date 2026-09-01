import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Google from 'expo-auth-session/providers/google';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import { googleLogin, signup } from '../services/apiClient';

interface SignupScreenProps {
  onSignupSuccess: () => void;
  onNavigateLogin: () => void;
}

const COUNTRIES = [
  { name: 'India', code: '+91', currency: 'INR', timezone: 'Asia/Kolkata' },
  { name: 'UAE', code: '+971', currency: 'AED', timezone: 'Asia/Dubai' },
  { name: 'United States', code: '+1', currency: 'USD', timezone: 'America/New_York' },
  { name: 'United Kingdom', code: '+44', currency: 'GBP', timezone: 'Europe/London' },
  { name: 'Australia', code: '+61', currency: 'AUD', timezone: 'Australia/Sydney' },
  { name: 'Saudi Arabia', code: '+966', currency: 'SAR', timezone: 'Asia/Riyadh' },
  { name: 'Canada', code: '+1', currency: 'CAD', timezone: 'America/Toronto' },
];

export function SignupScreen({ onSignupSuccess, onNavigateLogin }: SignupScreenProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [gymName, setGymName] = useState('');
  const [selectedCountry, setSelectedCountry] = useState(COUNTRIES[0]);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [, , promptAsync] = Google.useIdTokenAuthRequest({
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || undefined,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || undefined,
  });

  const handleGoogleSignUp = async () => {
    setGoogleLoading(true);
    setErrorMessage(null);
    try {
      const res = await promptAsync();
      if (res?.type === 'success') {
        const idToken = res.params.id_token;
        if (idToken) {
          const result = await googleLogin(idToken, {
            country: selectedCountry.name,
            timezone: selectedCountry.timezone,
          });
          if (result.ok) {
            onSignupSuccess();
            return;
          } else {
            setErrorMessage(result.error.message);
          }
        }
      } else if (res?.type === 'error') {
        setErrorMessage('Google sign-in failed. Please try again.');
      }
    } catch {
      setErrorMessage('An error occurred during Google sign-in.');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleNextStep = () => {
    setErrorMessage(null);
    if (!fullName.trim() || !email.trim() || !phone.trim() || !password.trim()) {
      setErrorMessage('Please fill in all owner details.');
      return;
    }
    if (!email.includes('@') || !email.includes('.')) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters.');
      return;
    }
    setStep(2);
  };

  const handleCompleteSignup = async () => {
    setErrorMessage(null);
    if (!gymName.trim()) {
      setErrorMessage('Please enter your gym name.');
      return;
    }

    setLoading(true);
    try {
      const formattedPhone = phone.startsWith('+') ? phone : `${selectedCountry.code}${phone.replace(/\D/g, '')}`;
      const result = await signup({
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        phone: formattedPhone,
        password: password,
        gymName: gymName.trim(),
        country: selectedCountry.name,
        currency: selectedCountry.currency,
        timezone: selectedCountry.timezone,
      });

      if (result.ok) {
        onSignupSuccess();
      } else {
        setErrorMessage(result.error?.message || 'Registration failed. Please try again.');
      }
    } catch {
      setErrorMessage('Network error during signup. Check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Brand Header */}
        <View style={styles.header}>
          <View style={styles.logoBadge}>
            <Icon name="fitness" size={28} color={colors.brand} />
          </View>
          <Text style={styles.title}>Renewal Desk</Text>
          <Text style={styles.subtitle}>Gym Member CRM & 24/7 Desk Automation</Text>
        </View>

        {/* Step Indicator */}
        <View style={styles.stepContainer}>
          <View style={[styles.stepDot, styles.stepDotActive]}>
            <Text style={styles.stepDotText}>1</Text>
          </View>
          <View style={[styles.stepLine, step === 2 && styles.stepLineActive]} />
          <View style={[styles.stepDot, step === 2 && styles.stepDotActive]}>
            <Text style={[styles.stepDotText, step !== 2 && styles.stepDotTextInactive]}>2</Text>
          </View>
        </View>
        <Text style={styles.stepLabel}>
          {step === 1 ? 'Step 1 of 2: Owner Account' : 'Step 2 of 2: Gym Information'}
        </Text>

        {/* Card */}
        <View style={styles.card}>
          {errorMessage && (
            <View style={styles.errorBanner}>
              <Icon name="alert" size={18} color={colors.critical} />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          {step === 1 ? (
            /* STEP 1: Owner Details */
            <View>
              <Text style={styles.inputLabel}>Full Name</Text>
              <View style={styles.inputWrapper}>
                <View style={styles.inputIcon}>
                  <Icon name="person" size={20} color={colors.textSecondary} />
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Rajesh Kumar"
                  placeholderTextColor={colors.muted}
                  value={fullName}
                  onChangeText={setFullName}
                  autoCapitalize="words"
                />
              </View>

              <Text style={styles.inputLabel}>Email Address</Text>
              <View style={styles.inputWrapper}>
                <View style={styles.inputIcon}>
                  <Icon name="mail" size={20} color={colors.textSecondary} />
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="owner@yourgym.com"
                  placeholderTextColor={colors.muted}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>

              <Text style={styles.inputLabel}>Mobile Phone</Text>
              <View style={styles.inputWrapper}>
                <Text style={styles.countryCodePrefix}>{selectedCountry.code}</Text>
                <TextInput
                  style={styles.input}
                  placeholder="9876543210"
                  placeholderTextColor={colors.muted}
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                />
              </View>

              <Text style={styles.inputLabel}>Create Password</Text>
              <View style={styles.inputWrapper}>
                <View style={styles.inputIcon}>
                  <Icon name="lock" size={20} color={colors.textSecondary} />
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="Minimum 6 characters"
                  placeholderTextColor={colors.muted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                />
              </View>

              <TouchableOpacity style={styles.primaryButton} onPress={handleNextStep} activeOpacity={0.8}>
                <Text style={styles.primaryButtonText}>Next: Gym Details</Text>
                <Icon name="forward" size={18} color="#fff" />
              </TouchableOpacity>

              {/* Divider */}
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* Google Sign-Up */}
              <TouchableOpacity
                style={[styles.googleBtn, googleLoading && styles.googleBtnDisabled]}
                onPress={() => void handleGoogleSignUp()}
                disabled={googleLoading || loading}
                activeOpacity={0.8}
              >
                <Image
                  source={{ uri: 'https://developers.google.com/identity/images/g-logo.png' }}
                  style={styles.googleIcon}
                />
                <Text style={styles.googleBtnText}>
                  {googleLoading ? 'Signing up...' : 'Continue with Google'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            /* STEP 2: Gym Details */
            <View>
              <Text style={styles.inputLabel}>Gym / Fitness Center Name</Text>
              <View style={styles.inputWrapper}>
                <View style={styles.inputIcon}>
                  <Icon name="fitness" size={20} color={colors.textSecondary} />
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Iron Pulse Fitness"
                  placeholderTextColor={colors.muted}
                  value={gymName}
                  onChangeText={setGymName}
                  autoCapitalize="words"
                />
              </View>

              <Text style={styles.inputLabel}>Operating Country</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.countryScroll}>
                {COUNTRIES.map((c) => (
                  <TouchableOpacity
                    key={c.name}
                    style={[
                      styles.countryChip,
                      selectedCountry.name === c.name && styles.countryChipActive,
                    ]}
                    onPress={() => setSelectedCountry(c)}
                  >
                    <Text
                      style={[
                        styles.countryChipText,
                        selectedCountry.name === c.name && styles.countryChipTextActive,
                      ]}
                    >
                      {c.name} ({c.currency})
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <View style={styles.infoBox}>
                <Icon name="checkmark" size={16} color={colors.success} />
                <Text style={styles.infoBoxText}>
                  Includes a free 7-day trial with full access to automated renewals and AI receptionist.
                </Text>
              </View>

              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={styles.backButton}
                  onPress={() => setStep(1)}
                  disabled={loading}
                >
                  <Icon name="back" size={18} color={colors.textSecondary} />
                  <Text style={styles.backButtonText}>Back</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.primaryButton, styles.primaryButtonFlex, loading && styles.buttonDisabled]}
                  onPress={handleCompleteSignup}
                  disabled={loading}
                  activeOpacity={0.8}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Text style={styles.primaryButtonText}>Start 7-Day Trial</Text>
                      <Icon name="checkmark" size={18} color="#fff" />
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Footer switch to Login */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <TouchableOpacity onPress={onNavigateLogin}>
            <Text style={styles.footerLink}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  logoBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.brandSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  subtitle: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  stepContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotActive: {
    backgroundColor: colors.brand,
  },
  stepDotText: {
    color: '#fff',
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  stepDotTextInactive: {
    color: colors.textSecondary,
  },
  stepLine: {
    width: 40,
    height: 2,
    backgroundColor: colors.border,
    marginHorizontal: spacing.xs,
  },
  stepLineActive: {
    backgroundColor: colors.brand,
  },
  stepLabel: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
    fontWeight: fontWeight.semibold,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: spacing.xl,
    ...shadows.md,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.criticalSurface,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  errorText: {
    fontSize: fontSize.sm,
    color: colors.critical,
    marginLeft: spacing.sm,
    flex: 1,
  },
  inputLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
  },
  inputIcon: {
    marginRight: spacing.sm,
  },
  countryCodePrefix: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginRight: spacing.sm,
  },
  input: {
    flex: 1,
    height: 48,
    fontSize: fontSize.base,
    color: colors.text,
  },
  countryScroll: {
    flexDirection: 'row',
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  countryChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    marginRight: spacing.sm,
  },
  countryChipActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  countryChipText: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    fontWeight: fontWeight.semibold,
  },
  countryChipTextActive: {
    color: '#fff',
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successSurface,
    padding: spacing.md,
    borderRadius: radius.md,
    marginVertical: spacing.md,
  },
  infoBoxText: {
    fontSize: fontSize.xs,
    color: colors.success,
    marginLeft: spacing.sm,
    flex: 1,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.sm,
    height: 48,
  },
  backButtonText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    marginLeft: spacing.xs,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
    height: 48,
    borderRadius: radius.md,
    marginTop: spacing.lg,
  },
  primaryButtonFlex: {
    flex: 1,
    marginTop: 0,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    marginRight: spacing.xs,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    color: colors.muted,
    fontSize: fontSize.sm,
    marginHorizontal: spacing.md,
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    height: 48,
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
    width: 20,
    height: 20,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  footerText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  footerLink: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.brand,
  },
});

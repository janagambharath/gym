/**
 * MemberLoginScreen — Phone-based OTP login for gym members.
 *
 * Flow: Phone input → OTP verification → Dashboard
 * Uses HMAC-signed stateless challenges for multi-worker safety.
 */
import { useCallback, useRef, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fontSize, fontWeight, radius, spacing } from '../../theme/tokens';
import { requestOtp, verifyOtp } from '../../services/memberApiClient';

type MemberLoginScreenProps = {
  onLoginSuccess: () => void;
  onSwitchToOwner?: () => void;
};

export function MemberLoginScreen({ onLoginSuccess, onSwitchToOwner }: MemberLoginScreenProps) {
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [challenge, setChallenge] = useState('');
  const [gymName, setGymName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const otpInputRef = useRef<TextInput>(null);

  const handleRequestOtp = useCallback(async () => {
    const trimmedPhone = phone.trim();
    if (trimmedPhone.length < 10) {
      setError('Please enter a valid phone number.');
      return;
    }

    setLoading(true);
    setError(undefined);

    const result = await requestOtp(trimmedPhone);
    if (result.ok) {
      setChallenge(result.data.challenge);
      setGymName(result.data.gym_name || '');
      setStep('otp');
      setTimeout(() => otpInputRef.current?.focus(), 200);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, [phone]);

  const handleVerifyOtp = useCallback(async () => {
    if (otp.length !== 6) {
      setError('Please enter the 6-digit verification code.');
      return;
    }

    setLoading(true);
    setError(undefined);

    const result = await verifyOtp(phone.trim(), otp, challenge);
    if (result.ok) {
      onLoginSuccess();
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, [phone, otp, challenge, onLoginSuccess]);

  const handleBack = useCallback(() => {
    setStep('phone');
    setOtp('');
    setError(undefined);
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Branding */}
          <View style={styles.branding}>
            <View style={styles.logoContainer}>
              <Image
                source={require('../../../assets/logo.png')}
                style={styles.logoImage}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.brandTitle}>Renewal Desk</Text>
            <Text style={styles.brandSubtitle}>Member Portal</Text>
          </View>

          {step === 'phone' ? (
            <View style={styles.formCard}>
              <Text style={styles.formTitle}>Sign in</Text>
              <Text style={styles.formSubtitle}>
                Enter your registered phone number to receive a verification code via WhatsApp
              </Text>

              <View style={styles.form}>
                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>Phone Number</Text>
                  <TextInput
                    style={styles.phoneInput}
                    value={phone}
                    onChangeText={(t) => { setPhone(t); setError(undefined); }}
                    placeholder="Enter your phone number"
                    placeholderTextColor={colors.muted}
                    keyboardType="phone-pad"
                    autoFocus
                    returnKeyType="go"
                    onSubmitEditing={() => void handleRequestOtp()}
                  />
                </View>

                {error ? (
                  <View style={styles.errorBanner}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  style={[styles.primaryButton, (loading || phone.trim().length < 10) && styles.buttonDisabled]}
                  onPress={() => void handleRequestOtp()}
                  disabled={loading || phone.trim().length < 10}
                  activeOpacity={0.7}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Send Verification Code</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.formCard}>
              <TouchableOpacity onPress={handleBack} style={styles.backButton}>
                <Text style={styles.backButtonText}>← Back</Text>
              </TouchableOpacity>

              <Text style={styles.formTitle}>Verification Code</Text>
              <Text style={styles.formSubtitle}>
                Enter the 6-digit code sent to your WhatsApp{'\n'}
                {phone ? `ending in ${phone.slice(-4)}` : ''}
                {gymName ? `\nFrom: ${gymName}` : ''}
              </Text>

              <View style={styles.form}>
                <TextInput
                  ref={otpInputRef}
                  style={styles.otpInput}
                  value={otp}
                  onChangeText={(t) => { setOtp(t.replace(/[^0-9]/g, '')); setError(undefined); }}
                  placeholder="000000"
                  placeholderTextColor={colors.muted}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                  returnKeyType="go"
                  onSubmitEditing={() => void handleVerifyOtp()}
                />

                {error ? (
                  <View style={styles.errorBanner}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}

                <TouchableOpacity
                  style={[styles.primaryButton, (loading || otp.length !== 6) && styles.buttonDisabled]}
                  onPress={() => void handleVerifyOtp()}
                  disabled={loading || otp.length !== 6}
                  activeOpacity={0.7}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Verify & Sign In</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => void handleRequestOtp()}
                  disabled={loading}
                  style={styles.resendButton}
                >
                  <Text style={styles.resendText}>{"Didn't receive it? Resend Code"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Switch to owner login */}
          {onSwitchToOwner && (
            <View style={styles.switchRow}>
              <Text style={styles.switchText}>Gym owner? </Text>
              <TouchableOpacity onPress={onSwitchToOwner}>
                <Text style={styles.switchLink}>Sign in as Owner</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={styles.footer}>
            Secure login · OTP via WhatsApp
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.bottomTabSafe,
  },
  branding: {
    alignItems: 'center',
    marginBottom: spacing.xxxl,
  },
  logoContainer: {
    alignItems: 'center',
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.xl,
    height: 72,
    justifyContent: 'center',
    width: 72,
  },
  logoImage: {
    height: 56,
    width: 56,
  },
  brandTitle: {
    color: colors.text,
    fontSize: fontSize['6xl'],
    fontWeight: fontWeight.extrabold,
    letterSpacing: -1,
    marginTop: spacing.lg,
  },
  brandSubtitle: {
    color: colors.brand,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    marginTop: spacing.xs,
  },
  formCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.xxl,
  },
  formTitle: {
    color: colors.text,
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.bold,
  },
  formSubtitle: {
    color: colors.muted,
    fontSize: fontSize.base,
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  form: {
    gap: spacing.lg,
    marginTop: spacing.xxl,
  },
  inputContainer: {
    gap: spacing.sm,
  },
  inputLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  phoneInput: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    fontSize: fontSize['2xl'],
    color: colors.text,
    fontWeight: fontWeight.semibold,
  },
  otpInput: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    fontSize: 32,
    color: colors.text,
    fontWeight: fontWeight.extrabold,
    textAlign: 'center',
    letterSpacing: 8,
  },
  primaryButton: {
    backgroundColor: colors.brand,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    height: 52,
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  backButton: {
    marginBottom: spacing.md,
  },
  backButtonText: {
    color: colors.brand,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  resendButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  resendText: {
    color: colors.brand,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
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
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  switchText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  switchLink: {
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
});

import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { colors, radii, spacing, typography } from '../theme/tokens';

export const LoginScreen: React.FC = () => {
  const { requestOtp, verifyOtp } = useAuth();

  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [challenge, setChallenge] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [loading, setLoading] = useState(false);
  const [gymName, setGymName] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [staffNotice, setStaffNotice] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleRequestOtp = async () => {
    setErrorMessage(null);
    setStaffNotice(null);
    const cleanPhone = phone.replace(/\D/g, '');

    if (cleanPhone.length < 10) {
      setErrorMessage('Please enter a valid 10-digit mobile number.');
      return;
    }

    setLoading(true);
    try {
      const res = await requestOtp(cleanPhone);
      if (res.success && res.challenge) {
        setChallenge(res.challenge);
        setGymName(res.gym_name || null);
        setStep('otp');
        setCountdown(60);
      } else if (res.is_staff) {
        setStaffNotice(res.error || 'This phone number is registered as gym staff. Please use the Renewal Desk owner app.');
      } else {
        const msg = typeof res.error === 'string' ? res.error : (res.error as any)?.message || "We couldn't find a member account for this number. Please contact your gym.";
        setErrorMessage(msg);
      }
    } catch (err: any) {
      const msg = typeof err?.message === 'string' ? err.message : "Couldn't connect to server. Check your connection.";
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setErrorMessage(null);
    if (otp.length < 4) {
      setErrorMessage('Please enter the 6-digit verification code.');
      return;
    }

    setLoading(true);
    try {
      const cleanPhone = phone.replace(/\D/g, '');
      const res = await verifyOtp(cleanPhone, otp, challenge);
      if (!res.success) {
        setErrorMessage(res.error || 'Invalid verification code. Please check and try again.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (countdown > 0 || loading) return;
    await handleRequestOtp();
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardContainer}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {/* Logo & Platform Header */}
          <View style={styles.brandHeader}>
            <View style={styles.logoBadge}>
              <Ionicons name="barbell" size={36} color="#FFFFFF" />
            </View>
            <Text style={styles.brandTitle}>VYNLA</Text>
            <Text style={styles.brandSubtitle}>
              Your gym membership, renewals, payments and attendance in one place.
            </Text>
          </View>

          {/* Form Card */}
          <View style={styles.card}>
            {step === 'phone' ? (
              <>
                <Text style={styles.cardTitle}>Member Login</Text>
                <Text style={styles.cardSubtitle}>
                  Enter the phone number registered with your gym to receive an OTP.
                </Text>

                {staffNotice ? (
                  <View style={styles.staffAlert}>
                    <Ionicons name="information-circle" size={20} color={colors.platform} />
                    <Text style={styles.staffAlertText}>{staffNotice}</Text>
                  </View>
                ) : null}

                {errorMessage ? (
                  <View style={styles.errorAlert}>
                    <Ionicons name="alert-circle" size={20} color={colors.expired} />
                    <Text style={styles.errorAlertText}>{errorMessage}</Text>
                  </View>
                ) : null}

                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>Mobile Number</Text>
                  <View style={styles.phoneInputRow}>
                    <View style={styles.countryCodeBox}>
                      <Text style={styles.countryCodeText}>+91</Text>
                    </View>
                    <TextInput
                      style={styles.phoneInput}
                      placeholder="98765 43210"
                      placeholderTextColor={colors.muted}
                      keyboardType="phone-pad"
                      maxLength={14}
                      value={phone}
                      onChangeText={(val) => {
                        setPhone(val);
                        setErrorMessage(null);
                        setStaffNotice(null);
                      }}
                      autoFocus
                    />
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.primaryButton, loading && styles.buttonDisabled]}
                  onPress={handleRequestOtp}
                  disabled={loading}
                  activeOpacity={0.85}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      <Text style={styles.primaryButtonText}>Continue with WhatsApp OTP</Text>
                      <Ionicons name="logo-whatsapp" size={18} color="#FFFFFF" />
                    </>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.backButton}
                  onPress={() => {
                    setStep('phone');
                    setOtp('');
                    setErrorMessage(null);
                  }}
                >
                  <Ionicons name="arrow-back" size={18} color={colors.textSecondary} />
                  <Text style={styles.backButtonText}>Change phone number</Text>
                </TouchableOpacity>

                <Text style={styles.cardTitle}>Enter Verification Code</Text>
                <Text style={styles.cardSubtitle}>
                  We sent a 6-digit code via WhatsApp to{' '}
                  <Text style={styles.boldText}>+91 {phone.replace(/\D/g, '')}</Text>
                  {gymName ? ` for your membership at ${gymName}` : ''}.
                </Text>

                {errorMessage ? (
                  <View style={styles.errorAlert}>
                    <Ionicons name="alert-circle" size={20} color={colors.expired} />
                    <Text style={styles.errorAlertText}>{errorMessage}</Text>
                  </View>
                ) : null}

                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>6-Digit OTP</Text>
                  <TextInput
                    style={styles.otpInput}
                    placeholder="••••••"
                    placeholderTextColor={colors.muted}
                    keyboardType="number-pad"
                    maxLength={6}
                    value={otp}
                    onChangeText={(val) => {
                      setOtp(val);
                      setErrorMessage(null);
                    }}
                    autoFocus
                  />
                </View>

                <TouchableOpacity
                  style={[styles.primaryButton, (loading || otp.length < 4) && styles.buttonDisabled]}
                  onPress={handleVerifyOtp}
                  disabled={loading || otp.length < 4}
                  activeOpacity={0.85}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Verify & Continue</Text>
                  )}
                </TouchableOpacity>

                <View style={styles.resendRow}>
                  {countdown > 0 ? (
                    <Text style={styles.resendTimerText}>Resend code in {countdown}s</Text>
                  ) : (
                    <TouchableOpacity onPress={handleResendOtp} disabled={loading}>
                      <Text style={styles.resendActionText}>Resend Code via WhatsApp</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            )}
          </View>

          {/* Footer note */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>
              By signing in, you agree to the gym's terms of membership and privacy policy.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  keyboardContainer: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  brandHeader: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  logoBadge: {
    width: 68,
    height: 68,
    borderRadius: radii.xl,
    backgroundColor: colors.platform,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    shadowColor: colors.platform,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  brandTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: 1.5,
  },
  brandSubtitle: {
    ...typography.subtext,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    maxWidth: 300,
    lineHeight: 18,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 4,
  },
  cardTitle: {
    ...typography.h2,
    color: colors.text,
  },
  cardSubtitle: {
    ...typography.subtext,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    lineHeight: 18,
  },
  boldText: {
    fontWeight: '700',
    color: colors.text,
  },
  staffAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.platformSubtle,
    borderWidth: 1,
    borderColor: colors.platform,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  staffAlertText: {
    ...typography.subtext,
    color: colors.platformDark,
    flex: 1,
    fontWeight: '500',
  },
  errorAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.expiredSurface,
    borderWidth: 1,
    borderColor: colors.expiredBorder,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  errorAlertText: {
    ...typography.subtext,
    color: colors.expired,
    flex: 1,
    fontWeight: '500',
  },
  inputContainer: {
    marginBottom: spacing.lg,
  },
  inputLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  phoneInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.bg,
    overflow: 'hidden',
  },
  countryCodeBox: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    backgroundColor: '#F1F5F9',
  },
  countryCodeText: {
    ...typography.bodySemibold,
    color: colors.text,
  },
  phoneInput: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...typography.bodySemibold,
    color: colors.text,
  },
  otpInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...typography.h2,
    letterSpacing: 8,
    textAlign: 'center',
    color: colors.text,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.platform,
    borderRadius: radii.lg,
    paddingVertical: spacing.md + 2,
    gap: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    ...typography.bodySemibold,
    color: '#FFFFFF',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  backButtonText: {
    ...typography.subtext,
    color: colors.textSecondary,
  },
  resendRow: {
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  resendTimerText: {
    ...typography.subtext,
    color: colors.muted,
  },
  resendActionText: {
    ...typography.subtext,
    color: colors.platform,
    fontWeight: '600',
  },
  footer: {
    marginTop: spacing.xl,
    alignItems: 'center',
  },
  footerText: {
    ...typography.caption,
    color: colors.muted,
    textAlign: 'center',
    maxWidth: 280,
  },
});

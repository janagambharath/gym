import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../components/AppHeader';
import { PrimaryButton } from '../components/PrimaryButton';
import { SectionHeader } from '../components/SectionHeader';
import { apiRequest } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';

type PaymentSettingsData = {
  upi_id?: string | null;
  payment_label?: string | null;
  instructions?: string | null;
  qr_public_url?: string | null;
  is_active?: boolean;
};

type PaymentSetupScreenProps = {
  onBack: () => void;
};

export function PaymentSetupScreen({ onBack }: PaymentSetupScreenProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [upiId, setUpiId] = useState('');
  const [paymentLabel, setPaymentLabel] = useState('');
  const [instructions, setInstructions] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiRequest<PaymentSettingsData>('/api/mobile/v1/settings/payment').then((res) => {
      if (cancelled) return;
      if (res.ok && res.data) {
        setUpiId(res.data.upi_id || '');
        setPaymentLabel(res.data.payment_label || '');
        setInstructions(res.data.instructions || '');
        setIsActive(res.data.is_active !== false);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = useCallback(async () => {
    const trimmedUpi = upiId.trim();
    if (trimmedUpi && !trimmedUpi.includes('@')) {
      Alert.alert(
        'Invalid UPI ID',
        'Please enter a valid UPI ID (e.g. gymname@okhdfcbank or 9876543210@paytm).',
      );
      return;
    }

    setSaving(true);
    setSavedSuccess(false);

    const res = await apiRequest<{ message: string; data: PaymentSettingsData }>(
      '/api/mobile/v1/settings/payment',
      {
        method: 'PUT',
        body: {
          upi_id: trimmedUpi,
          payment_label: paymentLabel.trim() || undefined,
          instructions: instructions.trim() || undefined,
          is_active: isActive,
        },
      },
    );

    setSaving(false);
    if (res.ok) {
      setSavedSuccess(true);
      Alert.alert('Saved', 'Your gym payment details have been saved successfully.');
    } else {
      Alert.alert('Save Failed', res.error.message || 'Could not update payment settings.');
    }
  }, [upiId, paymentLabel, instructions, isActive]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <AppHeader title="Payment & UPI Setup" onBack={onBack} />
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.brand} />
          <Text style={styles.loadingText}>Loading payment settings...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Payment & UPI Setup" onBack={onBack} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardContainer}
      >
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Explanation Info Banner */}
          <View style={styles.infoBanner}>
            <Icon name="shield" size={20} color={colors.brand} />
            <Text style={styles.infoBannerText}>
              Members in VYNLA pay directly into your gym's UPI or bank account. Renewal Desk never holds your funds.
            </Text>
          </View>

          {/* 1. UPI Receiver Setup */}
          <View style={styles.card}>
            <SectionHeader
              title="1. Merchant UPI ID (Required for VYNLA)"
              icon={<Icon name="wallet" size={18} color={colors.brand} />}
            />
            <Text style={styles.helperText}>
              Enter your gym's official UPI ID (VPA). This will receive 1-tap payments from Google Pay, PhonePe, and Paytm.
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>UPI ID / VPA *</Text>
              <TextInput
                style={styles.textInput}
                value={upiId}
                onChangeText={setUpiId}
                placeholder="e.g. yourgym@okhdfcbank or 9876543210@paytm"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Merchant / Gym Display Name</Text>
              <TextInput
                style={styles.textInput}
                value={paymentLabel}
                onChangeText={setPaymentLabel}
                placeholder="e.g. Iron Paradise Fitness Club"
                placeholderTextColor={colors.muted}
              />
            </View>

            <View style={styles.switchRow}>
              <View style={styles.switchLeft}>
                <Text style={styles.switchTitle}>Accept UPI Payments</Text>
                <Text style={styles.switchSubtitle}>Allow members to renew via UPI in VYNLA</Text>
              </View>
              <Switch
                value={isActive}
                onValueChange={setIsActive}
                trackColor={{ false: colors.gray300, true: colors.brand }}
                thumbColor={colors.surface}
              />
            </View>
          </View>

          {/* 2. Bank Details & Instructions */}
          <View style={styles.card}>
            <SectionHeader
              title="2. Bank Details & Counter Instructions"
              icon={<Icon name="cash" size={18} color={colors.brand} />}
            />
            <Text style={styles.helperText}>
              Add bank account numbers, IFSC codes, or instructions for members who pay via direct bank transfer or at the counter.
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Payment Instructions & Bank Account Info</Text>
              <TextInput
                style={[styles.textInput, styles.textArea]}
                value={instructions}
                onChangeText={setInstructions}
                placeholder="e.g.&#10;Bank: HDFC Bank&#10;A/C: 50200012345678&#10;IFSC: HDFC0001234&#10;Remark: Please mention your registered mobile number."
                placeholderTextColor={colors.muted}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
              />
            </View>
          </View>

          {/* Live Preview Card */}
          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>Live VYNLA Member Preview</Text>
            <View style={styles.previewRow}>
              <Text style={styles.previewLabel}>Paying to:</Text>
              <Text style={styles.previewValue}>{paymentLabel || 'Your Gym Name'}</Text>
            </View>
            <View style={styles.previewRow}>
              <Text style={styles.previewLabel}>UPI ID:</Text>
              <Text style={[styles.previewValue, !upiId && styles.previewMissing]}>
                {upiId || 'Not set (members cannot pay via UPI)'}
              </Text>
            </View>
            <View style={styles.previewRow}>
              <Text style={styles.previewLabel}>Status:</Text>
              <Text style={[styles.previewValue, { color: isActive && upiId ? colors.successDark : colors.critical }]}>
                {isActive && upiId ? 'Ready for Instant Payments' : 'Inactive'}
              </Text>
            </View>
          </View>

          {savedSuccess ? (
            <View style={styles.successBanner}>
              <Icon name="checkmark" size={16} color={colors.successDark} />
              <Text style={styles.successBannerText}>Payment configuration active and live!</Text>
            </View>
          ) : null}

          {/* Save CTA */}
          <View style={styles.buttonContainer}>
            <PrimaryButton
              title="Save Payment Details"
              onPress={() => void handleSave()}
              loading={saving}
              variant="primary"
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  keyboardContainer: {
    flex: 1,
  },
  content: {
    gap: spacing.md,
    padding: spacing.md,
    paddingBottom: spacing.bottomTabSafe,
  },
  centerContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginTop: spacing.md,
  },
  infoBanner: {
    alignItems: 'center',
    backgroundColor: colors.brandSubtle,
    borderColor: colors.brandLight,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  infoBannerText: {
    color: colors.brandDark,
    flex: 1,
    fontSize: fontSize.xs,
    lineHeight: 18,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    ...shadows.sm,
  },
  helperText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    lineHeight: 18,
    marginBottom: spacing.md,
    marginTop: spacing.xs,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  inputLabel: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    marginBottom: spacing.xs,
  },
  textInput: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: fontSize.base,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  textArea: {
    minHeight: 110,
  },
  switchRow: {
    alignItems: 'center',
    borderTopColor: colors.borderLight,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
  },
  switchLeft: {
    flex: 1,
    paddingRight: spacing.md,
  },
  switchTitle: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  switchSubtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  previewCard: {
    backgroundColor: colors.surface,
    borderColor: colors.borderLight,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
  },
  previewTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  previewLabel: {
    color: colors.muted,
    fontSize: fontSize.sm,
  },
  previewValue: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  previewMissing: {
    color: colors.critical,
    fontStyle: 'italic',
  },
  successBanner: {
    alignItems: 'center',
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  successBannerText: {
    color: colors.successDark,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  buttonContainer: {
    marginTop: spacing.sm,
  },
});

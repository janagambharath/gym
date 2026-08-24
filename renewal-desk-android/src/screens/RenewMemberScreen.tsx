import { useCallback, useRef, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { Avatar } from '../components/Avatar';
import { InfoRow } from '../components/InfoRow';
import { PrimaryButton } from '../components/PrimaryButton';
import { SectionHeader } from '../components/SectionHeader';
import { StatusBadge } from '../components/StatusBadge';
import { apiRequest } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type { Member, Payment } from '../types';
import { formatCurrency, formatDate, getMemberDisplayStatus } from '../types';

type RenewMemberScreenProps = {
  member: Member;
  onBack: () => void;
  onLogout: () => void;
  onViewMember?: (member: Member) => void;
  onComplete?: () => void;
};

type PaymentMethod = 'cash' | 'upi' | 'other';

function createPaymentRequestKey(): string {
  return `payment-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function formatPaymentMethod(method: string): string {
  return method === 'upi'
    ? 'UPI'
    : method.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function RenewMemberScreen({
  member,
  onBack,
  onLogout,
  onViewMember,
  onComplete,
}: RenewMemberScreenProps) {
  const [renewing, setRenewing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [paymentResult, setPaymentResult] = useState<Payment | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [agreementChecked, setAgreementChecked] = useState(false);
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);
  const [whatsAppFeedback, setWhatsAppFeedback] = useState<{
    message: string;
    type: 'error' | 'success';
  }>();
  const paymentRequestKeyRef = useRef<string | undefined>(undefined);

  const renewalDays = member.plan?.duration_days ?? 30;
  const amount = member.plan?.price ?? '0';
  const displayStatus = getMemberDisplayStatus(member);

  const handleRenew = useCallback(async () => {
    if (renewing) return; // Prevent double tap

    setRenewing(true);
    setError(undefined);
    const idempotencyKey = paymentRequestKeyRef.current ?? createPaymentRequestKey();
    paymentRequestKeyRef.current = idempotencyKey;

    const result = await apiRequest<Payment>('/api/mobile/v1/payments', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: {
        member_id: member.id,
        renewal_days: renewalDays,
        amount,
        method: paymentMethod,
        notes: 'Renewal payment recorded from the mobile app.',
      },
    });

    if (result.ok) {
      paymentRequestKeyRef.current = undefined;
      setPaymentResult(result.data);
      setSuccess(true);
      onComplete?.();
    } else {
      if (result.error.status === 401) { onLogout(); return; }
      // Retain the key after an uncertain network/server failure so retrying
      // the same payment cannot create a duplicate. Reset it for a definite
      // client-side validation/conflict error instead.
      if (result.error.status && result.error.status < 500) {
        paymentRequestKeyRef.current = undefined;
      }
      setError(result.error.message);
    }
    setRenewing(false);
  }, [member.id, renewalDays, amount, paymentMethod, renewing, onLogout, onComplete]);

  const handleSendWhatsApp = useCallback(async () => {
    if (sendingWhatsApp) return;

    setSendingWhatsApp(true);
    setWhatsAppFeedback(undefined);
    const result = await apiRequest<{ message: string; status: string }>('/api/mobile/v1/whatsapp/send-reminder', {
      method: 'POST',
      body: { member_id: member.id },
    });

    if (result.ok) {
      setWhatsAppFeedback({
        message: result.data.message || 'WhatsApp reminder sent.',
        type: 'success',
      });
    } else if (result.error.status === 401) {
      onLogout();
    } else {
      setWhatsAppFeedback({ message: result.error.message, type: 'error' });
    }
    setSendingWhatsApp(false);
  }, [member.id, onLogout, sendingWhatsApp]);

  if (success && paymentResult) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <AppHeader title="Renew Membership" onBack={onBack} />
        <ScrollView contentContainerStyle={styles.successContent}>
          {/* Success Icon */}
          <View style={styles.successIcon}>
            <Icon name="checkmark" size={48} color={colors.textInverse} />
          </View>

          <Text style={styles.successTitle}>Payment Recorded</Text>
          <Text style={styles.successSubtitle}>
            Membership will be extended after this payment is verified.
          </Text>

          {/* Member Info */}
          <View style={styles.successCard}>
            <View style={styles.successMemberRow}>
              <Avatar
                name={member.full_name}
                size={50}
                color={colors.brandSubtle}
                textColor={colors.brand}
              />
              <View style={styles.successMemberInfo}>
                <Text style={styles.successMemberName} numberOfLines={1}>{member.full_name}</Text>
                <Text style={styles.successMemberPlan}>{member.plan?.name ?? 'Standard Plan'}</Text>
              </View>
            </View>
          </View>

          {/* Renewal status */}
          <View style={[styles.successCard, styles.renewalStatusCard]}>
            <View style={styles.renewalStatusIcon}>
              <Icon name="time" size={22} color={colors.statusPending} />
            </View>
            <Text style={styles.successLabel}>Renewal activation</Text>
            <Text style={styles.successExpiry}>Awaiting verification</Text>
            <Text style={styles.renewalStatusHint}>Access is unchanged until the payment is approved.</Text>
            <StatusBadge status={paymentResult.status} size="md" />
          </View>

          {/* Payment Info */}
          <View style={styles.successCard}>
            <SectionHeader title="Payment Information" icon={<Icon name="currency" size={18} color={colors.brand} />} />
            <InfoRow label="Amount recorded" value={formatCurrency(paymentResult.amount)} />
            <InfoRow label="Payment method" value={formatPaymentMethod(paymentResult.method)} />
            <InfoRow label="Recorded on" value={formatDate(paymentResult.created_at)} />
            <View style={styles.successPaymentStatus}>
              <Text style={styles.successPaymentLabel}>Payment Status</Text>
              <StatusBadge status={paymentResult.status} size="md" />
            </View>
          </View>

          {/* Security Notice */}
          <View style={styles.secureNotice}>
            <Icon name="shield" size={19} color={colors.success} />
            <View style={styles.secureTextContainer}>
              <Text style={styles.secureTitle}>Secure & Recorded</Text>
              <Text style={styles.secureText}>
                The payment is recorded securely and will be reviewed before access is extended.
              </Text>
            </View>
          </View>

          {/* Actions */}
          <PrimaryButton
            label="View Member"
            icon={<Icon name="person" size={16} color={colors.brand} />}
            onPress={() => onViewMember?.(member)}
            variant="primary"
          />

          {whatsAppFeedback ? (
            <View style={[
              styles.whatsAppFeedback,
              whatsAppFeedback.type === 'error' ? styles.whatsAppFeedbackError : styles.whatsAppFeedbackSuccess,
            ]}>
              <Text style={[
                styles.whatsAppFeedbackText,
                { color: whatsAppFeedback.type === 'error' ? colors.critical : colors.successDark },
              ]}>
                {whatsAppFeedback.message}
              </Text>
            </View>
          ) : null}

          <TouchableOpacity
            accessibilityLabel="Send WhatsApp reminder"
            accessibilityRole="button"
            disabled={sendingWhatsApp}
            onPress={() => void handleSendWhatsApp()}
            style={[styles.successWhatsAppButton, sendingWhatsApp ? styles.successWhatsAppButtonDisabled : undefined]}
          >
            <Icon name="whatsapp" size={19} color={colors.whatsappDark} />
            <Text style={styles.successWhatsAppText}>{sendingWhatsApp ? 'Sending...' : 'Send WhatsApp'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Renew Membership" onBack={onBack} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Member Identity */}
        <View style={styles.memberCard}>
          <Avatar
            name={member.full_name}
            size={46}
            color={colors.brandSubtle}
            textColor={colors.brand}
          />
          <View style={styles.memberCardInfo}>
            <Text style={styles.memberCardName} numberOfLines={1}>{member.full_name}</Text>
            <Text style={styles.memberCardPlan}>{member.plan?.name ?? 'No plan'}</Text>
          </View>
          <StatusBadge status={displayStatus} size="md" />
        </View>

        {/* Renewal Summary */}
        <View style={styles.card}>
          <SectionHeader title="Renewal Summary" icon={<Icon name="clipboard" size={18} color={colors.brand} />} />
          <InfoRow label="Current Expiry" value={formatDate(member.membership_end)} />
          <InfoRow label="Renewal Duration" value={`${renewalDays} days`} />
          <InfoRow label="Amount" value={formatCurrency(amount)} />
          <View style={styles.summaryHighlight}>
            <InfoRow
              label="Extension after verification"
              value={`${renewalDays} days`}
              valueColor={colors.brand}
            />
          </View>
        </View>

        {/* Payment Status */}
        <View style={styles.paymentStatusCard}>
          <View style={styles.paymentStatusIconWrap}>
            <Icon name="time" size={20} color={colors.statusExpiring} />
          </View>
          <View>
            <Text style={styles.paymentStatusTitle}>Payment Status: PENDING</Text>
            <Text style={styles.paymentStatusText}>
              Membership will be extended only after payment verification.
            </Text>
          </View>
        </View>

        {/* Payment Information */}
        <View style={styles.card}>
          <SectionHeader title="Payment Information" icon={<Icon name="currency" size={18} color={colors.brand} />} />
          <InfoRow label="Renewal amount" value={formatCurrency(amount)} />
          <InfoRow label="Verification" value="Required before renewal" />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total Amount</Text>
            <Text style={styles.totalValue}>{formatCurrency(amount)}</Text>
          </View>
        </View>

        {/* Payment Method */}
        <View style={styles.card}>
          <SectionHeader title="Payment Method" icon={<Icon name="payments" size={18} color={colors.brand} />} />
          <View style={styles.methodRow}>
            {(['cash', 'upi', 'other'] as PaymentMethod[]).map((method) => (
              <TouchableOpacity
                key={method}
                style={[styles.methodChip, paymentMethod === method && styles.methodChipActive]}
                onPress={() => {
                  paymentRequestKeyRef.current = undefined;
                  setPaymentMethod(method);
                }}
              >
                <Text style={[styles.methodText, paymentMethod === method && styles.methodTextActive]}>
                  {method.charAt(0).toUpperCase() + method.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Security Notice */}
        <View style={[styles.secureNotice, styles.verificationNotice]}>
          <Icon name="shield" size={19} color={colors.info} />
          <View style={styles.secureTextContainer}>
            <Text style={styles.secureTitle}>Secure & Accurate</Text>
            <Text style={styles.secureText}>
              This payment record will be sent for verification. Membership access is not extended until it is approved.
            </Text>
          </View>
        </View>

        {/* Agreement Checkbox */}
        <TouchableOpacity
          style={styles.agreement}
          onPress={() => setAgreementChecked(!agreementChecked)}
        >
          <View style={[styles.checkbox, agreementChecked && styles.checkboxChecked]}>
            {agreementChecked ? <Icon name="checkmark" size={15} color={colors.textInverse} /> : null}
          </View>
          <Text style={styles.agreementText}>
            I confirm the amount and payment method are correct and want to record this payment for verification.
          </Text>
        </TouchableOpacity>

        {/* Error */}
        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Confirm Button */}
        <PrimaryButton
          label="Record Payment for Renewal"
          icon={<Icon name="lock" size={16} color={colors.textInverse} />}
          onPress={() => void handleRenew()}
          disabled={!agreementChecked}
          loading={renewing}
        />

        <TouchableOpacity onPress={onBack} style={styles.cancelButton}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>

        {/* Review reminder */}
        <View style={styles.duplicateNotice}>
          <Icon name="info" size={20} color={colors.brand} />
          <View>
            <Text style={styles.duplicateTitle}>Review before submitting</Text>
            <Text style={styles.duplicateText}>
              A payment record is created for this renewal and remains pending until it is verified.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  agreement: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  agreementText: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: fontSize.base,
    lineHeight: 20,
  },
  cancelButton: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: spacing.md,
  },
  cancelText: {
    color: colors.textSecondary,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.medium,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.xs,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    marginTop: 2,
    width: 22,
  },
  checkboxChecked: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  duplicateNotice: {
    alignItems: 'flex-start',
    backgroundColor: colors.infoSurface,
    borderColor: colors.infoBorder,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
  },
  duplicateText: {
    color: colors.muted,
    fontSize: fontSize.md,
    lineHeight: 18,
    marginTop: spacing.xxs,
  },
  duplicateTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.base,
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
  memberCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    padding: spacing.xl,
    ...shadows.sm,
  },
  memberCardInfo: {
    flex: 1,
    marginLeft: spacing.md,
  },
  memberCardName: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  memberCardPlan: {
    color: colors.muted,
    fontSize: fontSize.md,
  },
  methodChip: {
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  methodChipActive: {
    backgroundColor: colors.brandSubtle,
    borderColor: colors.brand,
  },
  methodRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  methodText: {
    color: colors.textSecondary,
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
  },
  methodTextActive: {
    color: colors.brand,
    fontWeight: fontWeight.semibold,
  },
  paymentStatusCard: {
    alignItems: 'flex-start',
    backgroundColor: colors.statusExpiringSurface,
    borderColor: colors.warningBorder,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
  },
  paymentStatusIconWrap: {
    alignItems: 'center',
    backgroundColor: colors.warningSurface,
    borderRadius: radius.full,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  paymentStatusText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    marginTop: spacing.xxs,
  },
  paymentStatusTitle: {
    color: colors.statusExpiring,
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  secureNotice: {
    alignItems: 'flex-start',
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    padding: spacing.lg,
  },
  secureText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    lineHeight: 18,
    marginTop: spacing.xxs,
  },
  secureTextContainer: {
    flex: 1,
  },
  secureTitle: {
    color: colors.success,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  successCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.xxl,
    ...shadows.sm,
  },
  successContent: {
    alignItems: 'stretch',
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  successExpiry: {
    color: colors.statusPending,
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.extrabold,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  successIcon: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.success,
    borderRadius: 40,
    height: 84,
    justifyContent: 'center',
    width: 84,
  },
  successLabel: {
    color: colors.muted,
    fontSize: fontSize.sm,
  },
  successMemberInfo: {
    flex: 1,
    marginLeft: spacing.md,
  },
  successMemberName: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  successMemberPlan: {
    color: colors.muted,
    fontSize: fontSize.base,
  },
  successMemberRow: {
    alignItems: 'center',
    flexDirection: 'row',
    width: '100%',
  },
  successPaymentLabel: {
    color: colors.muted,
    fontSize: fontSize.base,
    marginRight: spacing.md,
  },
  successPaymentStatus: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopColor: colors.borderLight,
    borderTopWidth: 1,
  },
  successWhatsAppButton: {
    alignItems: 'center',
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  successWhatsAppButtonDisabled: {
    opacity: 0.6,
  },
  successWhatsAppText: {
    color: colors.whatsappDark,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  whatsAppFeedback: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  whatsAppFeedbackError: {
    backgroundColor: colors.criticalSurface,
    borderColor: colors.criticalBorder,
  },
  whatsAppFeedbackSuccess: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  whatsAppFeedbackText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
    textAlign: 'center',
  },
  successSubtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.lg,
    textAlign: 'center',
  },
  successTitle: {
    color: colors.text,
    fontSize: fontSize['4xl'],
    fontWeight: fontWeight.extrabold,
    textAlign: 'center',
  },
  totalLabel: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  totalRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  totalValue: {
    color: colors.text,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.extrabold,
    fontVariant: ['tabular-nums'],
  },
  renewalStatusCard: {
    backgroundColor: colors.statusPendingSurface,
  },
  renewalStatusHint: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    lineHeight: 18,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  renewalStatusIcon: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.full,
    height: 40,
    justifyContent: 'center',
    marginBottom: spacing.sm,
    width: 40,
  },
  summaryHighlight: {
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.sm,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  verificationNotice: {
    backgroundColor: colors.infoSurface,
    borderColor: colors.infoBorder,
  },
});

import { useCallback, useState } from 'react';
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
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type { Member, Renewal } from '../types';
import { formatCurrency, formatDate, getMemberDisplayStatus } from '../types';

type RenewMemberScreenProps = {
  member: Member;
  onBack: () => void;
  onLogout: () => void;
  onViewMember?: (member: Member) => void;
  onComplete?: () => void;
};

type PaymentMethod = 'cash' | 'upi' | 'other';

export function RenewMemberScreen({
  member,
  onBack,
  onLogout,
  onViewMember,
  onComplete,
}: RenewMemberScreenProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [renewalResult, setRenewalResult] = useState<Renewal | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [agreementChecked, setAgreementChecked] = useState(false);

  const renewalDays = member.plan?.duration_days ?? 30;
  const amount = member.plan?.price ?? '0';
  const displayStatus = getMemberDisplayStatus(member);

  // Calculate new expiry
  const currentExpiry = member.membership_end ? new Date(member.membership_end) : new Date();
  const today = new Date();
  const newStartDate = currentExpiry > today
    ? new Date(currentExpiry.getTime() + 86400000) // day after expiry
    : today;
  const newExpiry = new Date(newStartDate.getTime() + (renewalDays - 1) * 86400000);
  const newExpiryStr = newExpiry.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const handleRenew = useCallback(async () => {
    if (renewing) return; // Prevent double tap

    setRenewing(true);
    setError(undefined);

    const result = await apiRequest<Renewal>(`/api/mobile/v1/renewals/${member.id}`, {
      method: 'POST',
      body: {
        renewal_days: renewalDays,
        amount,
        notes: `Renewed via mobile app · ${paymentMethod.toUpperCase()}`,
      },
    });

    if (result.ok) {
      setRenewalResult(result.data);
      setSuccess(true);
      onComplete?.();
    } else {
      if (result.error.status === 401) { onLogout(); return; }
      setError(result.error.message);
    }
    setRenewing(false);
  }, [member.id, renewalDays, amount, paymentMethod, renewing, onLogout, onComplete]);

  const handleSendWhatsApp = useCallback(async () => {
    await apiRequest('/api/mobile/v1/whatsapp/send-reminder', {
      method: 'POST',
      body: { member_id: member.id },
    });
  }, [member.id]);

  if (success && renewalResult) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <AppHeader title="Renew Membership" onBack={onBack} />
        <ScrollView contentContainerStyle={styles.successContent}>
          {/* Success Icon */}
          <View style={styles.successIcon}>
            <Text style={styles.successCheckmark}>✓</Text>
          </View>

          <Text style={styles.successTitle}>Membership Renewed!</Text>
          <Text style={styles.successSubtitle}>
            The membership has been renewed successfully.
          </Text>

          {/* Member Info */}
          <View style={styles.successCard}>
            <View style={styles.successMemberRow}>
              <Avatar name={member.full_name} size={48} />
              <View style={styles.successMemberInfo}>
                <Text style={styles.successMemberName}>{member.full_name}</Text>
                <Text style={styles.successMemberPlan}>{member.plan?.name ?? 'Standard Plan'}</Text>
              </View>
            </View>
          </View>

          {/* New Expiry */}
          <View style={styles.successCard}>
            <Text style={styles.successLabel}>New Expiry Date</Text>
            <Text style={styles.successExpiry}>{formatDate(renewalResult.new_end)}</Text>
            <StatusBadge status="active" size="md" />
          </View>

          {/* Payment Info */}
          <View style={styles.successCard}>
            <SectionHeader title="Payment Information" icon="₹" />
            <InfoRow label="Amount Paid" value={formatCurrency(renewalResult.amount)} />
            <InfoRow label="Payment Method" value={paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1)} />
            <InfoRow label="Payment Date" value={formatDate(renewalResult.created_at)} />
            <View style={styles.successPaymentStatus}>
              <Text style={styles.successPaymentLabel}>Payment Status</Text>
              <StatusBadge status="pending" size="md" />
            </View>
          </View>

          {/* Security Notice */}
          <View style={styles.secureNotice}>
            <Text style={styles.secureIcon}>✓</Text>
            <View style={styles.secureTextContainer}>
              <Text style={styles.secureTitle}>Secure & Recorded</Text>
              <Text style={styles.secureText}>
                This renewal and payment have been recorded securely.
              </Text>
            </View>
          </View>

          {/* Actions */}
          <PrimaryButton
            label="View Member"
            icon="👤"
            onPress={() => onViewMember?.(member)}
            variant="primary"
          />

          <PrimaryButton
            label="Send WhatsApp"
            icon="💬"
            onPress={() => void handleSendWhatsApp()}
            variant="outline"
          />
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
          <Avatar name={member.full_name} size={44} />
          <View style={styles.memberCardInfo}>
            <Text style={styles.memberCardName}>{member.full_name}</Text>
            <Text style={styles.memberCardPlan}>{member.plan?.name ?? 'No plan'}</Text>
          </View>
          <StatusBadge status={displayStatus} size="md" />
        </View>

        {/* Renewal Summary */}
        <View style={styles.card}>
          <SectionHeader title="Renewal Summary" icon="📋" />
          <InfoRow label="Current Expiry" value={formatDate(member.membership_end)} />
          <InfoRow label="Renewal Duration" value={`${renewalDays} days`} />
          <InfoRow label="Amount" value={formatCurrency(amount)} />
          <InfoRow label="New Expiry" value={newExpiryStr} valueColor={colors.brand} />
        </View>

        {/* Payment Status */}
        <View style={styles.paymentStatusCard}>
          <Text style={styles.paymentStatusIcon}>⊙</Text>
          <View>
            <Text style={styles.paymentStatusTitle}>Payment Status: PENDING</Text>
            <Text style={styles.paymentStatusText}>
              Renewal will be activated after payment is received.
            </Text>
          </View>
        </View>

        {/* Payment Information */}
        <View style={styles.card}>
          <SectionHeader title="Payment Information" icon="₹" />
          <InfoRow label="Membership Amount" value={formatCurrency(amount)} />
          <InfoRow label="Discount" value="₹0" />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total Amount</Text>
            <Text style={styles.totalValue}>{formatCurrency(amount)}</Text>
          </View>
        </View>

        {/* Payment Method */}
        <View style={styles.card}>
          <SectionHeader title="Payment Method" icon="💳" />
          <View style={styles.methodRow}>
            {(['cash', 'upi', 'other'] as PaymentMethod[]).map((method) => (
              <TouchableOpacity
                key={method}
                style={[styles.methodChip, paymentMethod === method && styles.methodChipActive]}
                onPress={() => setPaymentMethod(method)}
              >
                <Text style={[styles.methodText, paymentMethod === method && styles.methodTextActive]}>
                  {method.charAt(0).toUpperCase() + method.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Security Notice */}
        <View style={styles.secureNotice}>
          <Text style={styles.secureIcon}>🔒</Text>
          <View style={styles.secureTextContainer}>
            <Text style={styles.secureTitle}>Secure & Accurate</Text>
            <Text style={styles.secureText}>
              This renewal will be recorded securely. You can review it in the member's activity anytime.
            </Text>
          </View>
        </View>

        {/* Agreement Checkbox */}
        <TouchableOpacity
          style={styles.agreement}
          onPress={() => setAgreementChecked(!agreementChecked)}
        >
          <View style={[styles.checkbox, agreementChecked && styles.checkboxChecked]}>
            {agreementChecked ? <Text style={styles.checkboxIcon}>✓</Text> : null}
          </View>
          <Text style={styles.agreementText}>
            I confirm the details above are correct and want to proceed with this renewal.
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
          label="Confirm Renewal"
          icon="🔒"
          onPress={() => void handleRenew()}
          disabled={!agreementChecked}
          loading={renewing}
        />

        <TouchableOpacity onPress={onBack} style={styles.cancelButton}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>

        {/* Duplicate Protection Notice */}
        <View style={styles.duplicateNotice}>
          <Text style={styles.duplicateIcon}>🛡</Text>
          <View>
            <Text style={styles.duplicateTitle}>Duplicate Protection</Text>
            <Text style={styles.duplicateText}>
              This action is protected to prevent accidental duplicate renewals. Please confirm only once.
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
  checkboxIcon: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: fontWeight.bold,
  },
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.section,
  },
  duplicateIcon: {
    fontSize: 20,
    marginRight: spacing.md,
  },
  duplicateNotice: {
    alignItems: 'flex-start',
    backgroundColor: colors.gray50,
    borderRadius: radius.lg,
    flexDirection: 'row',
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
    padding: spacing.lg,
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
  paymentStatusIcon: {
    color: colors.statusExpiring,
    fontSize: 20,
    marginTop: 2,
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
  secureIcon: {
    fontSize: 16,
    marginRight: spacing.md,
    marginTop: 2,
    color: colors.success,
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
  successCheckmark: {
    color: colors.textInverse,
    fontSize: 36,
    fontWeight: fontWeight.bold,
  },
  successContent: {
    alignItems: 'stretch',
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.section,
  },
  successExpiry: {
    color: colors.text,
    fontSize: fontSize['4xl'],
    fontWeight: fontWeight.extrabold,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  successIcon: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.success,
    borderRadius: 40,
    height: 80,
    justifyContent: 'center',
    width: 80,
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
});

import { useCallback, useEffect, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../components/AppHeader';
import { Avatar } from '../components/Avatar';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PrimaryButton } from '../components/PrimaryButton';
import { StatusBadge } from '../components/StatusBadge';
import { apiRequest, getCachedSession } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type { Member, Renewal, Payment } from '../types';
import { formatCurrency, formatDate, getMemberDisplayStatus, getDaysText } from '../types';

type MemberDetailScreenProps = {
  member: Member;
  onBack: () => void;
  onLogout: () => void;
  onRenew?: (member: Member) => void;
  onEdit?: (memberId: number) => void;
  onRecordPayment?: (memberId: number) => void;
  onMemberUpdated?: () => void;
  refreshToken?: number;
};

export function MemberDetailScreen({
  member: initialMember,
  onBack,
  onLogout,
  onRenew,
  onEdit,
  onRecordPayment,
  onMemberUpdated,
  refreshToken,
}: MemberDetailScreenProps) {
  const [member, setMember] = useState(initialMember);
  const [renewals, setRenewals] = useState<Renewal[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');
  const [refreshing, setRefreshing] = useState(false);
  const [showDeactivate, setShowDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const session = getCachedSession();

  const displayStatus = getMemberDisplayStatus(member);
  const daysText = getDaysText(member.days_until_expiry);

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => setMessage(undefined), 4000);
  };

  const fetchMemberData = useCallback(() => Promise.all([
      apiRequest<Member>(`/api/mobile/v1/members/${member.id}`),
      apiRequest<{ renewals: Renewal[] }>(`/api/mobile/v1/renewals?member_id=${member.id}&page_size=5`),
      apiRequest<{ payments: Payment[] }>(`/api/mobile/v1/payments?page_size=50`),
    ]).then(([memberRes, renewalRes, paymentRes]) => {

    if (memberRes.ok) setMember(memberRes.data);
    else if (memberRes.error.status === 401) { onLogout(); return; }

    if (renewalRes.ok) setRenewals(renewalRes.data.renewals);
    if (paymentRes.ok) {
      // Filter payments for this member
      setPayments(paymentRes.data.payments.filter((p) => p.member_id === member.id));
    }
    setRefreshing(false);
  }), [member.id, onLogout]);

  useEffect(() => {
    void fetchMemberData();
  }, [fetchMemberData, refreshToken]);

  const handleSendReminder = useCallback(async () => {
    if (!member.whatsapp_opted_in) {
      showMessage('This member has not opted in to WhatsApp reminders.', 'error');
      return;
    }
    if (sendingReminder) return;

    setSendingReminder(true);
    const result = await apiRequest<{ message: string; status: string }>('/api/mobile/v1/whatsapp/send-reminder', {
      method: 'POST',
      body: { member_id: member.id },
    });

    if (result.ok) {
      showMessage(`Reminder sent to ${member.full_name}.`, 'success');
    } else {
      if (result.error.status === 401) { onLogout(); return; }
      showMessage(result.error.message, 'error');
    }
    setSendingReminder(false);
  }, [member.id, member.full_name, member.whatsapp_opted_in, onLogout, sendingReminder]);

  const verifiedPaidAmount = payments
    .filter((payment) => ['verified', 'paid'].includes(payment.status.toLowerCase()))
    .reduce((total, payment) => total + (Number(payment.amount) || 0), 0);
  const pendingPaymentCount = payments.filter(
    (payment) => payment.status.toLowerCase() === 'pending',
  ).length;
  const hasExpiringMembership = member.days_until_expiry !== null
    && member.days_until_expiry > 0
    && member.days_until_expiry <= 7;
  const hasExpiredMembership = member.days_until_expiry !== null && member.days_until_expiry <= 0;
  const expiryTone = hasExpiredMembership
    ? { backgroundColor: colors.statusExpiredSurface, color: colors.statusExpired }
    : hasExpiringMembership
      ? { backgroundColor: colors.statusExpiringSurface, color: colors.statusExpiring }
      : { backgroundColor: colors.statusActiveSurface, color: colors.statusActive };

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Member Details" onBack={onBack} />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); void fetchMemberData(); }}
            colors={[colors.brand]}
          />
        }
      >
        {/* Message banner */}
        {message ? (
          <View style={[styles.messageBanner, messageType === 'error' ? styles.errorBanner : styles.successBanner]}>
            <Text style={messageType === 'error' ? styles.errorBannerText : styles.successBannerText}>{message}</Text>
          </View>
        ) : null}

        {/* Member profile */}
        <View style={[styles.card, styles.profileCard]}>
          <View style={styles.identityRow}>
            <Avatar
              name={member.full_name}
              size={58}
              color={colors.brandSubtle}
              textColor={colors.brand}
            />
            <View style={styles.identityInfo}>
              <Text style={styles.memberName} numberOfLines={1}>{member.full_name}</Text>
              <Text style={styles.memberPhone}>{member.phone}</Text>
              <Text style={styles.memberId}>ID: MBR{member.id}</Text>
              {member.plan ? (
                <View style={styles.planBadge}>
                  <Text style={styles.planBadgeText}>{member.plan.name}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.identityRight}>
              <StatusBadge status={displayStatus} size="md" />
              {daysText ? (
                <Text style={[
                  styles.daysText,
                  { color: expiryTone.color },
                ]}>
                  {member.days_until_expiry !== null && member.days_until_expiry >= 0
                    ? `${member.days_until_expiry} days remaining`
                    : daysText}
                </Text>
              ) : null}
            </View>
          </View>
        </View>

        {/* Membership Card */}
        <View style={styles.card}>
          <View style={styles.sectionTitleRow}>
            <View style={[styles.sectionIcon, styles.membershipIcon]}>
              <Icon name="star" size={17} color={colors.statusExpiring} />
            </View>
            <Text style={styles.sectionTitle}>Membership</Text>
          </View>
          <View style={styles.membershipGrid}>
            <View style={styles.membershipItem}>
              <Text style={styles.membershipLabel}>Plan</Text>
              <Text style={[styles.membershipValue, !member.plan && { color: colors.statusExpiring }]}>
                {member.plan?.name ?? 'Plan not set'}
              </Text>
              {member.plan ? <Text style={styles.membershipSub}>{member.plan.duration_days} days</Text> : null}
            </View>
            <View style={[styles.membershipItem, styles.membershipItemBorder]}>
              <Text style={styles.membershipLabel}>Start Date</Text>
              <Text style={styles.membershipValue}>{formatDate(member.membership_start)}</Text>
            </View>
            <View style={[styles.membershipItem, styles.membershipItemBorder]}>
              <Text style={styles.membershipLabel}>Expiry Date</Text>
              <Text style={styles.membershipValue}>{formatDate(member.membership_end)}</Text>
            </View>
          </View>

          {/* Days remaining bar */}
          {member.days_until_expiry !== null ? (
            <View style={[styles.daysBar, { backgroundColor: expiryTone.backgroundColor }]}>
              <View style={styles.daysBarLeft}>
                <Icon name="time" size={16} color={expiryTone.color} />
                <Text style={[
                  styles.daysBarText,
                  { color: expiryTone.color },
                ]}>
                  {member.days_until_expiry >= 0
                    ? `${member.days_until_expiry} days remaining`
                    : `${Math.abs(member.days_until_expiry)} days overdue`}
                </Text>
              </View>
              <StatusBadge status={displayStatus} />
            </View>
          ) : null}
        </View>

        {/* Financial Summary */}
        <View style={styles.card}>
          <View style={styles.sectionTitleRow}>
            <View style={[styles.sectionIcon, styles.financialIcon]}>
              <Icon name="currency" size={17} color={colors.statusActive} />
            </View>
            <Text style={styles.sectionTitle}>Financial Summary</Text>
          </View>
          <View style={styles.financialGrid}>
            <View style={styles.financialItem}>
              <Text style={styles.financialLabel}>Membership Amount</Text>
              <Text style={styles.financialValue}>
                {member.plan ? formatCurrency(member.plan.price) : '—'}
              </Text>
            </View>
            <View style={[styles.financialItem, styles.financialItemBorder]}>
              <Text style={styles.financialLabel}>Verified Paid</Text>
              <Text style={[styles.financialValue, { color: colors.statusActive }]}>
                {formatCurrency(verifiedPaidAmount)}
              </Text>
              {verifiedPaidAmount > 0 ? (
                <View style={[styles.smallBadge, { backgroundColor: colors.statusPaidSurface }]}>
                  <Text style={[styles.smallBadgeText, { color: colors.statusPaid }]}>VERIFIED</Text>
                </View>
              ) : pendingPaymentCount > 0 ? (
                <View style={[styles.smallBadge, { backgroundColor: colors.statusPendingSurface }]}>
                  <Text style={[styles.smallBadgeText, { color: colors.statusPending }]}>PENDING</Text>
                </View>
              ) : null}
            </View>
            <View style={[styles.financialItem, styles.financialItemBorder]}>
              <Text style={styles.financialLabel}>Pending Review</Text>
              <Text style={[
                styles.financialValue,
                { color: pendingPaymentCount > 0 ? colors.statusPending : colors.statusActive },
              ]}>
                {pendingPaymentCount}
              </Text>
              <View style={[
                styles.smallBadge,
                { backgroundColor: pendingPaymentCount > 0 ? colors.statusPendingSurface : colors.successSurface },
              ]}>
                <Text style={[
                  styles.smallBadgeText,
                  { color: pendingPaymentCount > 0 ? colors.statusPending : colors.success },
                ]}>
                  {pendingPaymentCount > 0 ? 'PENDING' : 'CLEAR'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Activity */}
        <View style={styles.card}>
          <View style={styles.sectionTitleRow}>
            <View style={[styles.sectionIcon, styles.activityIcon]}>
              <Icon name="flash" size={17} color={colors.statusPending} />
            </View>
            <Text style={styles.sectionTitle}>Activity</Text>
          </View>
          <View style={styles.activityRow}>
            <View>
              <Text style={styles.activityTitle}>Renewal History</Text>
              <Text style={styles.activitySub}>{renewals.length} renewal{renewals.length !== 1 ? 's' : ''}</Text>
            </View>
            <Icon name="forward" size={16} color={colors.muted} />
          </View>
          <View style={styles.activityRow}>
            <View>
              <Text style={styles.activityTitle}>Payment History</Text>
              <Text style={styles.activitySub}>{payments.length} payment{payments.length !== 1 ? 's' : ''}</Text>
            </View>
            <Icon name="forward" size={16} color={colors.muted} />
          </View>
          <View style={styles.activityRow}>
            <View>
              <Text style={styles.activityTitle}>WhatsApp Reminders</Text>
              <Text style={styles.activitySub}>
                {member.whatsapp_opted_in ? 'Reminders enabled' : 'Not opted in'}
              </Text>
            </View>
            <Icon name="whatsapp" size={17} color={member.whatsapp_opted_in ? colors.whatsapp : colors.muted} />
          </View>
          <View style={styles.activityRow}>
            <View>
              <Text style={styles.activityTitle}>Biometric / Access State</Text>
              <Text style={styles.activitySub}>
                {member.has_biometric ? 'Enrolled on Access Device' : 'Not enrolled on device'}
              </Text>
            </View>
            <StatusBadge status={member.has_biometric ? 'active' : 'pending'} />
          </View>
        </View>

        {/* Primary CTA */}
        <PrimaryButton
          title="Renew Membership"
          icon={<Icon name="renewals" size={18} color={colors.textInverse} />}
          onPress={() => onRenew?.(member)}
          variant="primary"
        />

        {/* Secondary Actions */}
        <View style={styles.secondaryActions}>
          <TouchableOpacity
            accessibilityLabel="Send WhatsApp reminder"
            accessibilityRole="button"
            disabled={sendingReminder || !member.whatsapp_opted_in}
            onPress={() => void handleSendReminder()}
            style={[
              styles.memberAction,
              styles.memberActionWhatsApp,
              sendingReminder || !member.whatsapp_opted_in ? styles.memberActionDisabled : undefined,
            ]}
          >
            <Icon name="whatsapp" size={18} color={colors.whatsappDark} />
            <Text style={[styles.memberActionLabel, { color: colors.whatsappDark }]}>
              {sendingReminder ? 'Sending...' : member.whatsapp_opted_in ? 'Send WhatsApp' : 'WhatsApp not opted in'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityLabel="Record payment"
            accessibilityRole="button"
            disabled={!onRecordPayment}
            onPress={() => onRecordPayment?.(member.id)}
            style={[styles.memberAction, styles.memberActionPayment, !onRecordPayment ? styles.memberActionDisabled : undefined]}
          >
            <Icon name="cash" size={18} color={colors.statusPending} />
            <Text style={[styles.memberActionLabel, { color: colors.statusPending }]}>Record Payment</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityLabel="Edit member"
            accessibilityRole="button"
            disabled={!onEdit}
            onPress={() => onEdit?.(member.id)}
            style={[styles.memberAction, styles.memberActionEdit, !onEdit ? styles.memberActionDisabled : undefined]}
          >
            <Icon name="edit" size={18} color={colors.brand} />
            <Text style={[styles.memberActionLabel, { color: colors.brand }]}>Edit Member</Text>
          </TouchableOpacity>
        </View>

        {/* Notes */}
        {member.notes ? (
          <View style={styles.card}>
            <View style={styles.sectionTitleRow}>
              <View style={[styles.sectionIcon, styles.notesIcon]}>
                <Icon name="document" size={16} color={colors.muted} />
              </View>
              <Text style={styles.sectionTitle}>Notes</Text>
            </View>
            <Text style={styles.notesText}>{member.notes}</Text>
          </View>
        ) : null}

        {/* Deactivate (Owner only) */}
        {session?.userRole === 'gym_owner' && member.status !== 'deleted' ? (
          <PrimaryButton
            title="Deactivate Member"
            icon={<Icon name="delete" size={16} color={colors.textInverse} />}
            onPress={() => setShowDeactivate(true)}
            variant="danger"
            size="md"
          />
        ) : null}
      </ScrollView>

      <ConfirmDialog
        visible={showDeactivate}
        title="Deactivate Member?"
        message={`This will deactivate ${member.full_name}. They will be removed from active member lists.`}
        confirmLabel="Deactivate"
        confirmVariant="danger"
        loading={deactivating}
        onConfirm={async () => {
          setDeactivating(true);
          const res = await apiRequest(`/api/mobile/v1/members/${member.id}/deactivate`, { method: 'POST' });
          setDeactivating(false);
          setShowDeactivate(false);
          if (res.ok) {
            onMemberUpdated?.();
            onBack();
          } else {
            showMessage(res.error.message, 'error');
          }
        }}
        onCancel={() => setShowDeactivate(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  activityRow: {
    alignItems: 'center',
    borderTopColor: colors.borderLight,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    paddingTop: spacing.md,
  },
  activitySub: {
    color: colors.muted,
    fontSize: fontSize.sm,
    marginTop: 1,
  },
  activityTitle: {
    color: colors.text,
    fontSize: fontSize.base,
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
  chevron: {
    color: colors.muted,
    fontSize: fontSize['3xl'],
  },
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  daysBar: {
    alignItems: 'center',
    backgroundColor: colors.gray50,
    borderRadius: radius.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  daysBarIcon: {
    fontSize: 14,
    marginRight: spacing.sm,
  },
  daysBarLeft: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  daysBarText: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  daysText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    marginTop: spacing.xxs,
  },
  errorBanner: {
    backgroundColor: colors.criticalSurface,
    borderColor: colors.criticalBorder,
  },
  errorBannerText: {
    color: colors.critical,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  financialGrid: {
    flexDirection: 'row',
    gap: 0,
    marginTop: spacing.md,
  },
  financialItem: {
    flex: 1,
  },
  financialItemBorder: {
    borderLeftColor: colors.border,
    borderLeftWidth: 1,
    paddingLeft: spacing.sm,
  },
  financialLabel: {
    color: colors.muted,
    fontSize: fontSize.sm,
  },
  financialValue: {
    color: colors.text,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.extrabold,
    fontVariant: ['tabular-nums'],
    marginTop: spacing.xs,
  },
  identityInfo: {
    flex: 1,
    marginLeft: spacing.lg,
  },
  identityRight: {
    alignItems: 'flex-end',
    gap: spacing.xs,
    marginLeft: spacing.sm,
    maxWidth: 90,
  },
  identityRow: {
    flexDirection: 'row',
  },
  memberId: {
    color: colors.muted,
    fontSize: fontSize.sm,
    marginTop: spacing.xxs,
  },
  memberName: {
    color: colors.text,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
  },
  memberPhone: {
    color: colors.textSecondary,
    fontSize: fontSize.base,
    marginTop: spacing.xxs,
  },
  membershipGrid: {
    flexDirection: 'row',
    gap: 0,
    marginTop: spacing.md,
  },
  membershipItem: {
    flex: 1,
  },
  membershipItemBorder: {
    borderLeftColor: colors.border,
    borderLeftWidth: 1,
    paddingLeft: spacing.xs,
  },
  membershipLabel: {
    color: colors.muted,
    fontSize: fontSize.sm,
  },
  membershipSub: {
    color: colors.muted,
    fontSize: fontSize.sm,
    marginTop: 1,
  },
  membershipValue: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    marginTop: spacing.xxs,
  },
  messageBanner: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  notesText: {
    color: colors.textSecondary,
    fontSize: fontSize.base,
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  notesIcon: {
    backgroundColor: colors.gray100,
  },
  planBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.sm,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  planBadgeText: {
    color: colors.brand,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  profileCard: {
    paddingVertical: spacing.xl,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  secondaryActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  memberAction: {
    alignItems: 'center',
    borderRadius: radius.md,
    flex: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 72,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  memberActionDisabled: {
    opacity: 0.5,
  },
  memberActionEdit: {
    backgroundColor: colors.brandSubtle,
  },
  memberActionLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    textAlign: 'center',
  },
  memberActionPayment: {
    backgroundColor: colors.statusPendingSurface,
  },
  memberActionWhatsApp: {
    backgroundColor: colors.successSurface,
  },
  sectionIcon: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  sectionTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  membershipIcon: {
    backgroundColor: colors.warningSurface,
  },
  financialIcon: {
    backgroundColor: colors.successSurface,
  },
  activityIcon: {
    backgroundColor: colors.statusPendingSurface,
  },
  smallBadge: {
    alignSelf: 'flex-start',
    borderRadius: radius.xs,
    marginTop: spacing.xs,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  smallBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  successBanner: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  successBannerText: {
    color: colors.success,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
});

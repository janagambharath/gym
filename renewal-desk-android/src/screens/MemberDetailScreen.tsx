import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { apiRequest } from '../services/apiClient';
import { colors, radius, spacing } from '../theme/tokens';
import type { Member } from './MembersScreen';

type MemberDetailScreenProps = {
  member: Member;
  onBack: () => void;
  onLogout: () => void;
  onMemberUpdated?: () => void;
};

const STATUS_COLORS: Record<string, string> = {
  active: colors.success,
  expired: colors.critical,
  deleted: colors.muted,
};

export function MemberDetailScreen({ member: initialMember, onBack, onLogout, onMemberUpdated }: MemberDetailScreenProps) {
  const [member, setMember] = useState(initialMember);
  const [renewDays, setRenewDays] = useState('30');
  const [renewAmount, setRenewAmount] = useState(member.plan?.price ?? '0');
  const [renewing, setRenewing] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => setMessage(undefined), 4000);
  };

  const handleRenew = useCallback(async () => {
    const days = parseInt(renewDays, 10);
    if (!days || days < 1 || days > 730) {
      showMessage('Days must be between 1 and 730.', 'error');
      return;
    }

    setRenewing(true);
    const result = await apiRequest<unknown>(`/api/mobile/v1/renewals/${member.id}`, {
      method: 'POST',
      body: { renewal_days: days, amount: renewAmount, notes: `Renewed via mobile app` },
    });

    if (result.ok) {
      showMessage(`Membership renewed for ${days} days.`, 'success');
      // Refresh member data
      const refresh = await apiRequest<Member>(`/api/mobile/v1/members/${member.id}`);
      if (refresh.ok) setMember(refresh.data);
      onMemberUpdated?.();
    } else {
      if (result.error.status === 401) { onLogout(); return; }
      showMessage(result.error.message, 'error');
    }
    setRenewing(false);
  }, [member.id, renewDays, renewAmount, onLogout, onMemberUpdated]);

  const handleSendReminder = useCallback(async () => {
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
  }, [member.id, member.full_name, onLogout]);

  const daysText = member.days_until_expiry !== null && member.days_until_expiry !== undefined
    ? member.days_until_expiry > 0
      ? `${member.days_until_expiry} days left`
      : member.days_until_expiry === 0
        ? 'Expires today'
        : `${Math.abs(member.days_until_expiry)} days overdue`
    : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.topBarTitle} numberOfLines={1}>Member Details</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Message banner */}
        {message ? (
          <View style={[styles.messageBanner, messageType === 'error' ? styles.errorBanner : styles.successBanner]}>
            <Text style={messageType === 'error' ? styles.errorBannerText : styles.successBannerText}>{message}</Text>
          </View>
        ) : null}

        {/* Identity card */}
        <View style={styles.card}>
          <View style={styles.identityRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{member.full_name.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.memberName}>{member.full_name}</Text>
              <Text style={styles.memberSub}>📱 {member.phone}</Text>
              {member.email ? <Text style={styles.memberSub}>✉️ {member.email}</Text> : null}
            </View>
            <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[member.status] ?? colors.muted }]}>
              <Text style={styles.statusText}>{member.status.toUpperCase()}</Text>
            </View>
          </View>
        </View>

        {/* Membership info */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Membership</Text>
          {member.plan ? (
            <InfoRow label="Plan" value={`${member.plan.name} · ₹${member.plan.price}`} />
          ) : (
            <InfoRow label="Plan" value="No plan assigned" />
          )}
          <InfoRow label="Start" value={member.membership_start ? new Date(member.membership_start).toLocaleDateString('en-IN') : '—'} />
          <InfoRow label="End" value={member.membership_end ? new Date(member.membership_end).toLocaleDateString('en-IN') : '—'} />
          {daysText ? (
            <InfoRow
              label="Status"
              value={daysText}
              valueColor={
                member.days_until_expiry !== null && member.days_until_expiry <= 0
                  ? colors.critical
                  : member.days_until_expiry !== null && member.days_until_expiry <= 7
                    ? colors.warning
                    : colors.success
              }
            />
          ) : null}
          {member.has_biometric ? <InfoRow label="Biometric" value="✅ Enrolled" /> : null}
        </View>

        {/* Quick actions */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Renew Membership</Text>
          <View style={styles.renewRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.inputLabel}>Days</Text>
              <TextInput
                style={styles.input}
                keyboardType="number-pad"
                value={renewDays}
                onChangeText={setRenewDays}
                placeholder="30"
                placeholderTextColor={colors.muted}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.inputLabel}>Amount (₹)</Text>
              <TextInput
                style={styles.input}
                keyboardType="decimal-pad"
                value={renewAmount}
                onChangeText={setRenewAmount}
                placeholder="0"
                placeholderTextColor={colors.muted}
              />
            </View>
          </View>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: colors.success }]}
            onPress={() => void handleRenew()}
            disabled={renewing}
          >
            {renewing ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={styles.actionButtonText}>✓ Renew Membership</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* WhatsApp */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>WhatsApp Reminder</Text>
          <Text style={styles.reminderInfo}>Send a renewal reminder to {member.full_name} at {member.phone}</Text>
          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: '#25D366' }]}
            onPress={() => void handleSendReminder()}
            disabled={sendingReminder}
          >
            {sendingReminder ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={styles.actionButtonText}>📱 Send Reminder</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Notes */}
        {member.notes ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Notes</Text>
            <Text style={styles.notesText}>{member.notes}</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, valueColor ? { color: valueColor } : undefined]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: 'center',
    borderRadius: radius.sm,
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    marginRight: spacing.sm,
    width: 48,
  },
  avatarText: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '800',
  },
  backButton: { minWidth: 60 },
  backText: { color: colors.brand, fontSize: 15, fontWeight: '600' },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  content: {
    gap: spacing.md,
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  errorBanner: { backgroundColor: colors.criticalSurface, borderColor: '#FDA29B' },
  errorBannerText: { color: colors.critical, fontSize: 14, fontWeight: '600' },
  identityRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  infoLabel: {
    color: colors.muted,
    fontSize: 14,
    width: 80,
  },
  infoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: spacing.xs,
  },
  infoValue: {
    color: colors.text,
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.text,
    fontSize: 15,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
  },
  inputLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  memberName: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  memberSub: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 2,
  },
  messageBanner: {
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.sm,
  },
  notesText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  reminderInfo: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: spacing.xs,
  },
  renewRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  statusBadge: {
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  successBanner: { backgroundColor: colors.successSurface, borderColor: '#A6F4C5' },
  successBannerText: { color: colors.success, fontSize: 14, fontWeight: '600' },
  topBar: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  topBarTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
});

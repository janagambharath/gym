import { useCallback, useState } from 'react';
import { useLiveEffect } from '../hooks/useLiveEffect';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
import { colors, fontSize, fontWeight, radius, shadows, spacing, fontFamily} from '../theme/tokens';
import type { Member, Renewal, Payment } from '../types';
import { formatCurrency, formatDate, formatDateTime, getMemberDisplayStatus, getDaysText } from '../types';

type MemberDetailScreenProps = {
  member: Member;
  onBack: () => void;
  onLogout: () => void;
  onRenew?: (member: Member) => void;
  onEdit?: (memberId: number) => void;
  onRecordPayment?: (memberId: number) => void;
  onNavigateMemberHistory?: (memberId: number) => void;
  onMemberUpdated?: () => void;
  refreshToken?: number;
};

type BiometricRecord = {
  id: number;
  punch_time: string | null;
  biometric_user_id?: string | null;
  device_serial?: string | null;
  verify_method?: string | null;
  direction?: string | null;
  source?: string | null;
};
type BiometricHistory = {
  events: BiometricRecord[];
  stats: { total_punches: number; last_30_days: number };
  member: { enroll_number?: string | null };
  pagination: { page: number; pages: number; total: number; per_page: number };
};

export function MemberDetailScreen({
  member: initialMember,
  onBack,
  onLogout,
  onRenew,
  onEdit,
  onRecordPayment,
  onNavigateMemberHistory,
  onMemberUpdated,
  refreshToken,
}: MemberDetailScreenProps) {
  const [member, setMember] = useState(initialMember);
  const [renewals, setRenewals] = useState<Renewal[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  // Server-side total for this member (the loaded page is capped at 50).
  const [paymentTotal, setPaymentTotal] = useState<number | null>(null);
  const [biometricHistory, setBiometricHistory] = useState<BiometricHistory>();
  const [biometricError, setBiometricError] = useState<string>();
  const [loadingMoreBiometrics, setLoadingMoreBiometrics] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');
  const [refreshing, setRefreshing] = useState(false);
  const [showDeactivate, setShowDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [enrollNumberInput, setEnrollNumberInput] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [unenrolling, setUnenrolling] = useState(false);
  const [togglingAccess, setTogglingAccess] = useState(false);
  const [accessBlocked, setAccessBlocked] = useState(false);
  const [doorAccessPending, setDoorAccessPending] = useState(false);
  const [doorAccessPendingAction, setDoorAccessPendingAction] = useState<'block' | 'unblock' | null>(null);
  const [doorAccessError, setDoorAccessError] = useState<string | undefined>();
  const [showFreezeModal, setShowFreezeModal] = useState(false);
  const [freezeDaysInput, setFreezeDaysInput] = useState('14');
  const [freezeReasonInput, setFreezeReasonInput] = useState('');
  const [freezing, setFreezing] = useState(false);
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
      apiRequest<{ payments: Payment[]; pagination?: { total: number } }>(`/api/mobile/v1/payments?member_id=${member.id}&page_size=50`),
      // Poll only page 1 of the punch history: already-loaded pages are kept
      // (merged below) instead of re-downloading every page on each poll.
      apiRequest<BiometricHistory>(`/api/mobile/v1/rrr/member/${member.id}/attendance?page=1&per_page=50`),
    ]).then(([memberRes, renewalRes, paymentRes, biometricRes]) => {

    if (memberRes.ok) {
      setMember(memberRes.data);
      setAccessBlocked(memberRes.data.door_blocked === true);
      setDoorAccessPending(memberRes.data.door_access_pending === true);
      setDoorAccessPendingAction(memberRes.data.door_access_pending_action || null);
      setDoorAccessError(memberRes.data.door_access_error || undefined);
    }
    else if (memberRes.error.status === 401) { onLogout(); return; }

    if (renewalRes.ok) setRenewals(renewalRes.data.renewals);
    if (paymentRes.ok) {
      // Server-filtered to this member; the count comes from the server
      // total, not the (50-row) loaded page.
      setPayments(paymentRes.data.payments);
      setPaymentTotal(paymentRes.data.pagination?.total ?? paymentRes.data.payments.length);
    }
    if (biometricRes.ok) {
      // Merge page 1 over already-loaded pages (dedupe by record id) so a
      // poll never re-downloads — or drops — pages loaded via "Load more".
      setBiometricHistory((prev) => {
        if (!prev) return biometricRes.data;
        const freshIds = new Set(biometricRes.data.events.map((e) => e.id));
        return {
          ...biometricRes.data,
          events: [
            ...biometricRes.data.events,
            ...prev.events.filter((e) => !freshIds.has(e.id)),
          ],
          pagination: {
            ...biometricRes.data.pagination,
            page: Math.max(prev.pagination.page, biometricRes.data.pagination.page),
          },
        };
      });
      setBiometricError(undefined);
    } else if (biometricRes.error.status === 401) {
      onLogout();
      return;
    } else {
      setBiometricHistory(undefined);
      setBiometricError(biometricRes.error.message);
    }
    setRefreshing(false);
  }), [member.id, onLogout]);

  const [checkingIn, setCheckingIn] = useState(false);

  const loadMoreBiometricRecords = useCallback(async () => {
    if (!biometricHistory || loadingMoreBiometrics || biometricHistory.pagination.page >= biometricHistory.pagination.pages) return;
    setLoadingMoreBiometrics(true);
    const nextPage = biometricHistory.pagination.page + 1;
    const result = await apiRequest<BiometricHistory>(`/api/mobile/v1/rrr/member/${member.id}/attendance?page=${nextPage}&per_page=${biometricHistory.pagination.per_page}`);
    if (result.ok) {
      setBiometricHistory((current) => current ? {
        ...result.data,
        events: [
          ...current.events,
          ...result.data.events.filter((e) => !current.events.some((existing) => existing.id === e.id)),
        ],
      } : result.data);
    } else if (result.error.status === 401) {
      onLogout();
    } else {
      showMessage(result.error.message, 'error');
    }
    setLoadingMoreBiometrics(false);
  }, [biometricHistory, loadingMoreBiometrics, member.id, onLogout]);

  const handleCheckInToggle = useCallback(async () => {
    if (checkingIn) return;
    setCheckingIn(true);
    const isExiting = !!member.is_inside;
    const result = await apiRequest<{ message: string }>('/api/mobile/v1/access/checkin', {
      method: 'POST',
      body: { member_id: member.id, type: isExiting ? 'EXIT' : 'ENTRY' },
    });
    if (result.ok) {
      showMessage(isExiting ? `${member.full_name} checked out.` : `${member.full_name} checked in!`, 'success');
      void fetchMemberData();
    } else {
      showMessage(result.error.message, 'error');
    }
    setCheckingIn(false);
  }, [checkingIn, member.id, member.full_name, member.is_inside, fetchMemberData]);

  useLiveEffect(() => {
    void fetchMemberData();
  }, [fetchMemberData, refreshToken]);

  const handleSendReminder = useCallback(async () => {
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
  }, [member.id, member.full_name, onLogout, sendingReminder]);

  const handleOpenEnrollModal = useCallback(() => {
    setEnrollNumberInput(member.device_enroll_number ? String(member.device_enroll_number) : '');
    setShowEnrollModal(true);
  }, [member.device_enroll_number]);

  const handleSaveEnrollment = useCallback(async () => {
    if (!enrollNumberInput.trim()) {
      showMessage('Please enter a device enroll number', 'error');
      return;
    }
    setEnrolling(true);
    const res = await apiRequest<{ message: string; enroll_number: string }>(
      `/api/mobile/v1/members/${member.id}/enroll`,
      {
        method: 'POST',
        body: { enroll_number: enrollNumberInput.trim() },
      }
    );
    setEnrolling(false);
    if (res.ok) {
      setShowEnrollModal(false);
      showMessage(`Biometric Enroll #${res.data.enroll_number} saved & synchronized!`, 'success');
      void fetchMemberData();
      onMemberUpdated?.();
    } else {
      showMessage(res.error.message, 'error');
    }
  }, [enrollNumberInput, member.id, fetchMemberData, onMemberUpdated]);

  const handleUnenroll = useCallback(async () => {
    setUnenrolling(true);
    const res = await apiRequest<{ message: string }>(
      `/api/mobile/v1/members/${member.id}/unenroll`,
      {
        method: 'POST',
      }
    );
    setUnenrolling(false);
    if (res.ok) {
      showMessage('Biometric enrollment removed from device.', 'success');
      void fetchMemberData();
      onMemberUpdated?.();
    } else {
      showMessage(res.error.message, 'error');
    }
  }, [member.id, fetchMemberData, onMemberUpdated]);

  const handleToggleAccess = useCallback(async (action: 'block' | 'unblock') => {
    setTogglingAccess(true);
    const res = await apiRequest(
      `/api/mobile/v1/rrr/members/${member.id}/access`,
      { method: 'POST', body: { action } }
    );
    setTogglingAccess(false);
    if (res.ok) {
      setAccessBlocked(action === 'block');
      setDoorAccessPending(true);
      setDoorAccessPendingAction(action);
      setDoorAccessError(undefined);
      showMessage(
        action === 'block'
          ? 'Block command queued. Access changes after the terminal acknowledges its next cloud poll.'
          : 'Unblock command queued. Access changes after the terminal acknowledges its next cloud poll.',
        'success'
      );
      onMemberUpdated?.();
      void fetchMemberData();
    } else {
      // A 409 BLOCK_NOT_ALLOWED (or any rejection) is surfaced on the card,
      // never shown as a queued success — the door did not change.
      if (res.error.status === 409) setDoorAccessError(res.error.message);
      showMessage(res.error.message, 'error');
    }
  }, [member.id, onMemberUpdated, fetchMemberData]);

  const handleFreeze = useCallback(async () => {
    const days = parseInt(freezeDaysInput, 10);
    if (isNaN(days) || days < 1) {
      showMessage('Please enter a valid number of days to pause', 'error');
      return;
    }
    setFreezing(true);
    const res = await apiRequest<{ data: Member; message: string }>(`/api/mobile/v1/members/${member.id}/freeze`, {
      method: 'POST',
      body: { days, reason: freezeReasonInput.trim() },
    });
    setFreezing(false);
    setShowFreezeModal(false);
    if (res.ok) {
      showMessage(res.data?.message || 'Membership paused successfully.', 'success');
      void fetchMemberData();
      onMemberUpdated?.();
    } else {
      showMessage(res.error.message, 'error');
    }
  }, [freezeDaysInput, freezeReasonInput, member.id, fetchMemberData, onMemberUpdated]);

  const handleUnfreeze = useCallback(async () => {
    Alert.alert(
      'Resume Membership?',
      `Resume ${member.full_name}'s membership and restore biometric gate access?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Resume',
          onPress: async () => {
            const res = await apiRequest<{ data: Member; message: string }>(`/api/mobile/v1/members/${member.id}/unfreeze`, {
              method: 'POST',
            });
            if (res.ok) {
              showMessage(res.data?.message || 'Membership resumed!', 'success');
              void fetchMemberData();
              onMemberUpdated?.();
            } else {
              showMessage(res.error.message, 'error');
            }
          },
        },
      ]
    );
  }, [member.id, member.full_name, fetchMemberData, onMemberUpdated]);

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
              <View style={styles.contactRow}>
                <TouchableOpacity style={[styles.contactBtn, styles.callBtn]} onPress={() => void Linking.openURL(`tel:${member.phone}`)}>
                  <Text style={[styles.contactBtnText, styles.callBtnText]}>📞 Call</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.contactBtn, styles.waBtn]} onPress={() => void Linking.openURL(`https://wa.me/${String(member.phone).replace(/\D/g, '')}`)}>
                  <Text style={styles.contactBtnText}>💬 WhatsApp</Text>
                </TouchableOpacity>
              </View>
              {member.address ? (
                <Text style={styles.memberAddress} numberOfLines={2}>📍 {member.address}</Text>
              ) : null}
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
            <View style={[styles.sectionIcon, styles.contactIcon]}>
              <Icon name="person" size={17} color={colors.brand} />
            </View>
            <Text style={styles.sectionTitle}>Contact</Text>
          </View>
          <View style={styles.contactGrid}>
            <View style={styles.contactItem}>
              <Text style={styles.membershipLabel}>Email</Text>
              <Text style={styles.membershipValue}>{member.email || '—'}</Text>
            </View>
            <View style={[styles.contactItem, styles.membershipItemBorder]}>
              <Text style={styles.membershipLabel}>Gender</Text>
              <Text style={styles.membershipValue}>{member.gender || '—'}</Text>
            </View>
            <View style={[styles.contactItem, styles.membershipItemBorder]}>
              <Text style={styles.membershipLabel}>Joined</Text>
              <Text style={styles.membershipValue}>{formatDate(member.joined_on)}</Text>
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
          {onNavigateMemberHistory ? (
            <TouchableOpacity
              style={styles.activityRow}
              onPress={() => onNavigateMemberHistory(member.id)}
              activeOpacity={0.7}
            >
              <View>
                <Text style={styles.activityTitle}>Renewal History</Text>
                <Text style={styles.activitySub}>{renewals.length} renewal{renewals.length !== 1 ? 's' : ''}</Text>
              </View>
              <Text style={styles.activityLink}>View full history ›</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.activityRow}>
              <View>
                <Text style={styles.activityTitle}>Renewal History</Text>
                <Text style={styles.activitySub}>{renewals.length} renewal{renewals.length !== 1 ? 's' : ''}</Text>
              </View>
            </View>
          )}
          <View style={styles.activityRow}>
            <View>
              <Text style={styles.activityTitle}>Payment History</Text>
              <Text style={styles.activitySub}>{paymentTotal ?? payments.length} payment{(paymentTotal ?? payments.length) !== 1 ? 's' : ''}</Text>
            </View>
          </View>
          <View style={styles.activityRow}>
            <View>
              <Text style={styles.activityTitle}>WhatsApp Reminders</Text>
              <Text style={styles.activitySub}>
                Verified templates active
              </Text>
            </View>
            <Icon name="whatsapp" size={17} color={colors.whatsapp} />
          </View>
          <View style={styles.activityRow}>
            <View>
              <Text style={styles.activityTitle}>Access & Attendance</Text>
              <Text style={styles.activitySub}>
                {member.is_inside ? 'Currently Inside Gym' : 'Outside'}
              </Text>
            </View>
            <StatusBadge status={member.is_inside ? 'active' : 'pending'} />
          </View>
          <View style={styles.activityRow}>
            <View>
              <Text style={styles.activityTitle}>Biometric Terminal</Text>
              <Text style={styles.activitySub}>
                {member.has_biometric ? `ID #${member.device_enroll_number || 'Enrolled'} · Active` : 'Not enrolled on machine'}
              </Text>
            </View>
            <StatusBadge status={member.has_biometric ? 'active' : 'pending'} />
          </View>
          <View style={styles.biometricRecords}>
            <View style={styles.biometricRecordsHeader}>
              <Text style={styles.activityTitle}>Biometric Records</Text>
              <Text style={styles.activitySub}>
                {biometricHistory ? `${biometricHistory.stats.total_punches} punches · ${biometricHistory.stats.last_30_days} in last 30 days` : biometricError ? 'Punch history unavailable' : 'Loading records…'}
              </Text>
            </View>
            {biometricError ? (
              <Text style={styles.activitySub}>{biometricError}</Text>
            ) : !member.has_biometric && !biometricHistory?.events.length ? (
              <Text style={styles.activitySub}>Link this member’s terminal ID to show their punches here.</Text>
            ) : biometricHistory?.events.length ? biometricHistory.events.map((record) => (
              <View style={styles.biometricRecordRow} key={record.id}>
                <View style={styles.biometricRecordIcon}>
                  <Icon name="time" size={14} color={colors.successDark} />
                </View>
                <View style={styles.biometricRecordCopy}>
                  <Text style={styles.activityTitle}>
                    {record.punch_time ? formatDateTime(record.punch_time) : 'Punch time unavailable'}
                  </Text>
                  <Text style={styles.activitySub}>
                    {[record.direction ? record.direction[0].toUpperCase() + record.direction.slice(1) : 'Entry', record.verify_method, record.device_serial || record.source].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </View>
            )) : biometricHistory ? (
              <Text style={styles.activitySub}>No mapped biometric punches yet.</Text>
            ) : null}
            {!!biometricHistory && biometricHistory.pagination.page < biometricHistory.pagination.pages && (
              <TouchableOpacity onPress={() => void loadMoreBiometricRecords()} disabled={loadingMoreBiometrics} style={styles.biometricLoadMore}>
                <Text style={styles.biometricLoadMoreText}>{loadingMoreBiometrics ? 'Loading…' : `Load more (${Math.max(0, biometricHistory.pagination.total - biometricHistory.events.length)} remaining)`}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Biometric Access Management Card */}
        <View style={styles.card}>
          <View style={styles.sectionTitleRow}>
            <View style={[styles.sectionIcon, { backgroundColor: colors.brandSubtle }]}>
              <Icon name="access" size={17} color={colors.brand} />
            </View>
            <Text style={styles.sectionTitle}>Biometric Device Access</Text>
          </View>

          <View style={styles.biometricCardContent}>
            {member.has_biometric ? (
              <View style={styles.biometricActiveBox}>
                <View style={styles.biometricRow}>
                  <View>
                    <Text style={styles.biometricLabel}>Machine Enroll Number</Text>
                    <Text style={styles.biometricValue}>#{member.device_enroll_number || 'Enrolled'}</Text>
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: '#DCFCE7' }]}>
                    <Text style={[styles.statusPillText, { color: colors.successDark }]}>● Synced on Device</Text>
                  </View>
                </View>
                <View style={styles.biometricBtnRow}>
                  <TouchableOpacity
                    style={[styles.biometricActionBtn, { borderColor: colors.brand }]}
                    onPress={handleOpenEnrollModal}
                    activeOpacity={0.7}
                  >
                    <Icon name="edit" size={14} color={colors.brand} />
                    <Text style={[styles.biometricActionBtnText, { color: colors.brand }]}>Change ID</Text>
                  </TouchableOpacity>
                  {member.status === 'active' && !accessBlocked ? (
                    <Text style={styles.biometricAccessHint}>
                      Active members can&apos;t be blocked from here — pause (freeze) the membership instead. Blocking is only for expired or paused members.
                    </Text>
                  ) : (
                  <TouchableOpacity
                    style={[styles.biometricActionBtn, { borderColor: accessBlocked ? colors.successDark : colors.warningDark }]}
                    onPress={() => {
                      const action = accessBlocked ? 'unblock' : 'block';
                      Alert.alert(
                        accessBlocked ? 'Unblock Biometric Access?' : 'Block Biometric Access?',
                        accessBlocked
                          ? `${member.full_name} will be able to verify on the terminal again.`
                          : `${member.full_name} will be denied on the terminal until unblocked. Their fingerprint stays enrolled.`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: accessBlocked ? 'Unblock' : 'Block',
                            style: accessBlocked ? 'default' : 'destructive',
                            onPress: () => void handleToggleAccess(action),
                          },
                        ]
                      );
                    }}
                    disabled={togglingAccess}
                    activeOpacity={0.7}
                  >
                    <Icon name="access" size={14} color={accessBlocked ? colors.successDark : colors.warningDark} />
                    <Text style={[styles.biometricActionBtnText, { color: accessBlocked ? colors.successDark : colors.warningDark }]}>
                      {togglingAccess ? 'Working...' : accessBlocked ? 'Unblock Access' : 'Block Access'}
                    </Text>
                  </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.biometricActionBtn, { borderColor: colors.critical }]}
                    onPress={() => {
                      Alert.alert(
                        'Remove Biometric Enrollment?',
                        `This will unassign device ID #${member.device_enroll_number} and block biometric access for ${member.full_name}.`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Remove', style: 'destructive', onPress: () => void handleUnenroll() },
                        ]
                      );
                    }}
                    disabled={unenrolling}
                    activeOpacity={0.7}
                  >
                    <Icon name="delete" size={14} color={colors.critical} />
                    <Text style={[styles.biometricActionBtnText, { color: colors.critical }]}>
                      {unenrolling ? 'Removing...' : 'Unenroll'}
                    </Text>
                  </TouchableOpacity>
                </View>
                {doorAccessError ? (
                  <Text style={[styles.biometricAccessHint, { color: colors.critical }]}>{doorAccessError}</Text>
                ) : doorAccessPending ? (
                  <Text style={styles.biometricAccessHint}>
                    Waiting for the terminal to confirm {doorAccessPendingAction || 'the access change'}.
                  </Text>
                ) : null}
              </View>
            ) : (
              <View style={styles.biometricEmptyBox}>
                <Text style={styles.biometricEmptyText}>
                  Not enrolled on eSSL biometric device yet. Assign a machine user ID to enable automatic fingerprint entry/turnstile lock.
                </Text>
                <TouchableOpacity
                  style={styles.enrollCtaBtn}
                  onPress={handleOpenEnrollModal}
                  activeOpacity={0.8}
                >
                  <Icon name="access" size={16} color={colors.textInverse} />
                  <Text style={styles.enrollCtaBtnText}>Enroll on Biometric Device</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>

        {/* Attendance Check In / Out Action */}
        <View style={{ marginBottom: spacing.xs }}>
          <PrimaryButton
            title={checkingIn ? (member.is_inside ? 'Checking out...' : 'Checking in...') : (member.is_inside ? 'Check Out Member' : 'Check In Member (Attendance)')}
            icon={<Icon name="access" size={18} color={member.is_inside ? colors.brand : colors.textInverse} />}
            onPress={() => void handleCheckInToggle()}
            variant={member.is_inside ? 'outline' : 'primary'}
          />
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
            disabled={sendingReminder}
            onPress={() => void handleSendReminder()}
            style={[
              styles.memberAction,
              styles.memberActionWhatsApp,
              sendingReminder ? styles.memberActionDisabled : undefined,
            ]}
          >
            <Icon name="whatsapp" size={18} color={colors.whatsappDark} />
            <Text style={[styles.memberActionLabel, { color: colors.whatsappDark }]}>
              {sendingReminder ? 'Sending...' : 'Send WhatsApp'}
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

        {/* Pause / Resume Membership Button */}
        {member.status === 'paused' ? (
          <PrimaryButton
            title="Resume Membership (Unpause)"
            icon={<Icon name="checkmark" size={18} color={colors.textInverse} />}
            onPress={handleUnfreeze}
            variant="primary"
            style={{ backgroundColor: colors.success, borderColor: colors.success, marginTop: spacing.sm }}
          />
        ) : member.status !== 'deleted' ? (
          <PrimaryButton
            title="Pause / Freeze Membership"
            icon={<Icon name="lock" size={18} color={colors.textSecondary} />}
            onPress={() => setShowFreezeModal(true)}
            variant="outline"
            style={{ marginTop: spacing.sm }}
          />
        ) : null}

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

      {/* Biometric Enrollment Modal */}
      <Modal
        visible={showEnrollModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEnrollModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderLeft}>
                <View style={[styles.sectionIcon, { backgroundColor: colors.brandSubtle, width: 28, height: 28 }]}>
                  <Icon name="access" size={16} color={colors.brand} />
                </View>
                <Text style={styles.modalTitle}>Assign Biometric ID</Text>
              </View>
              <TouchableOpacity onPress={() => setShowEnrollModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Icon name="close" size={20} color={colors.muted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDesc}>
              Enter the User ID / Enroll Number for {member.full_name} from your eSSL biometric machine.
            </Text>

            <Text style={styles.inputLabel}>Device Enroll Number</Text>
            <TextInput
              style={styles.modalInput}
              keyboardType="number-pad"
              placeholder="e.g. 101"
              placeholderTextColor={colors.muted}
              value={enrollNumberInput}
              onChangeText={setEnrollNumberInput}
              autoFocus
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowEnrollModal(false)}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={() => void handleSaveEnrollment()}
                disabled={enrolling}
              >
                {enrolling ? (
                  <ActivityIndicator color={colors.textInverse} size="small" />
                ) : (
                  <Text style={styles.modalSaveBtnText}>Save & Sync</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Freeze / Pause Modal */}
      <Modal
        visible={showFreezeModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFreezeModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderLeft}>
                <View style={[styles.sectionIcon, { backgroundColor: colors.brandSubtle, width: 28, height: 28 }]}>
                  <Icon name="lock" size={16} color={colors.brand} />
                </View>
                <Text style={styles.modalTitle}>Pause Membership</Text>
              </View>
              <TouchableOpacity onPress={() => setShowFreezeModal(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Icon name="close" size={20} color={colors.muted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDesc}>
              Temporarily freeze {member.full_name}&apos;s membership. Gate access will be locked and expiry will be extended.
            </Text>

            <Text style={[styles.biometricLabel, { marginTop: spacing.md }]}>Number of Days</Text>
            <TextInput
              style={styles.modalInput}
              keyboardType="number-pad"
              value={freezeDaysInput}
              onChangeText={setFreezeDaysInput}
              placeholder="e.g. 14"
              placeholderTextColor={colors.muted}
            />

            <Text style={[styles.biometricLabel, { marginTop: spacing.sm }]}>Reason (Optional)</Text>
            <TextInput
              style={styles.modalInput}
              value={freezeReasonInput}
              onChangeText={setFreezeReasonInput}
              placeholder="e.g. Travel, Medical, Exam"
              placeholderTextColor={colors.muted}
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowFreezeModal(false)}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={() => void handleFreeze()}
                disabled={freezing}
              >
                {freezing ? (
                  <ActivityIndicator color={colors.textInverse} size="small" />
                ) : (
                  <Text style={styles.modalSaveBtnText}>Confirm Pause</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  activityLink: { color: colors.brand, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
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
  biometricRecords: {
    borderTopColor: colors.borderLight,
    borderTopWidth: 1,
    marginTop: spacing.sm,
    paddingTop: spacing.md,
  },
  biometricRecordsHeader: {
    marginBottom: spacing.sm,
  },
  biometricRecordRow: {
    alignItems: 'center',
    borderTopColor: colors.borderLight,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  biometricRecordIcon: {
    alignItems: 'center',
    backgroundColor: colors.successSurface,
    borderRadius: radius.full,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  biometricRecordCopy: {
    flex: 1,
  },
  biometricLoadMore: {
    alignItems: 'center',
    borderTopColor: colors.borderLight,
    borderTopWidth: 1,
    paddingVertical: spacing.md,
  },
  biometricLoadMoreText: {
    color: colors.brandDark,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
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
    paddingBottom: spacing.bottomTabSafe,
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
    fontWeight: fontWeight.extrabold, fontFamily: fontFamily.displayExtra,
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
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
  memberPhone: {
    color: colors.textSecondary,
    fontSize: fontSize.base,
    marginTop: spacing.xxs,
  },
  contactRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  contactBtn: { flex: 1, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center' },
  callBtn: { backgroundColor: colors.brandSubtle, borderWidth: 1, borderColor: colors.brand },
  waBtn: { backgroundColor: '#25D366' },
  contactBtnText: { color: '#fff', fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold, fontSize: fontSize.sm },
  callBtnText: { color: colors.brandDark },
  memberAddress: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginTop: spacing.xxs,
  },
  membershipGrid: {
    flexDirection: 'row',
    gap: 0,
    marginTop: spacing.md,
  },
  contactGrid: {
    flexDirection: 'row',
    gap: 0,
    marginTop: spacing.md,
  },
  contactItem: {
    flex: 1,
  },
  contactIcon: {
    backgroundColor: colors.brandSubtle,
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
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
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
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
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
  biometricCardContent: {
    marginTop: spacing.md,
  },
  biometricActiveBox: {
    backgroundColor: colors.surface,
    borderColor: colors.borderLight,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  biometricRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  biometricLabel: {
    color: colors.muted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  biometricValue: {
    color: colors.text,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
    marginTop: 2,
  },
  statusPill: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  statusPillText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  biometricBtnRow: {
    borderTopColor: colors.borderLight,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  biometricAccessHint: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    lineHeight: 17,
    marginTop: spacing.sm,
  },
  biometricActionBtn: {
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  biometricActionBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  biometricEmptyBox: {
    backgroundColor: colors.gray50,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderStyle: 'dashed',
    borderWidth: 1,
    padding: spacing.md,
  },
  biometricEmptyText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  enrollCtaBtn: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    paddingVertical: spacing.sm + 2,
  },
  enrollCtaBtnText: {
    color: colors.textInverse,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  modalOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 400,
    ...shadows.lg,
  },
  modalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  modalHeaderLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  modalTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
  modalDesc: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  inputLabel: {
    color: colors.text,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.xs,
  },
  modalInput: {
    backgroundColor: colors.gray50,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginBottom: spacing.lg,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  modalCancelBtn: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    paddingVertical: spacing.sm + 2,
  },
  modalCancelBtnText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  modalSaveBtn: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    flex: 1,
    paddingVertical: spacing.sm + 2,
  },
  modalSaveBtnText: {
    color: colors.textInverse,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
});

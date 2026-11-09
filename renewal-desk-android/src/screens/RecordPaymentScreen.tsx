import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../components/AppHeader';
import { Avatar } from '../components/Avatar';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
import { SearchBar } from '../components/SearchBar';
import { apiRequest, getCachedSession } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type { Member, Payment } from '../types';
import { formatCurrency, formatDate, getCurrencySymbol, safeDateKeyInTimezone } from '../types';

function createPaymentRequestKey(): string {
  return `payment-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function dateKeyInTimezone(value: Date, timezone: string): string {
  // V5-L32: the shared safe helper — an invalid gym timezone falls back
  // to the device-local date with a loud warning instead of throwing
  // RangeError during render and crashing this screen.
  return safeDateKeyInTimezone(value, timezone);
}

function dateKeyFromLocalDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day + days, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function pickerDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

const PAYMENT_METHODS = ['cash', 'upi', 'bank_transfer', 'card', 'other'] as const;

type RecordPaymentScreenProps = {
  onBack: () => void;
  preselectedMemberId?: number;
  onCreated?: (payment: Payment) => void;
};

export function RecordPaymentScreen({ onBack, preselectedMemberId, onCreated }: RecordPaymentScreenProps) {
  // Member selection
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Member[]>([]);
  const [selectedMember, setSelectedMember] = useState<Member | undefined>();
  const [searching, setSearching] = useState(false);

  // Form
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<string>('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [renewalDays, setRenewalDays] = useState('30');
  const [gymTimezone, setGymTimezone] = useState('Asia/Kolkata');
  const [renewalStartDateOverride, setRenewalStartDateOverride] = useState<string>();
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [saving, setSaving] = useState(false);
  const paymentRequestKeyRef = useRef<string | undefined>(undefined);
  // V10-L28: the settings leg used to fail silently — the timezone
  // stayed at the Asia/Kolkata fallback and every date on the screen
  // was computed in the wrong zone for a non-IST gym. Surface the
  // failure with a retry and do not render date-dependent defaults
  // until the settings load succeeds.
  const [settingsError, setSettingsError] = useState<string | undefined>();
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  // V10-L28: the preselected-member fetch was silently ignored too —
  // the owner arriving from member-detail saw a blank search with no
  // signal that the member they came from failed to load.
  const [preselectedMemberError, setPreselectedMemberError] = useState<string | undefined>();

  const loadSettings = useCallback(async () => {
    setSettingsError(undefined);
    const res = await apiRequest<{ gym?: { timezone?: string } }>('/api/mobile/v1/settings');
    if (res.ok) {
      setGymTimezone(res.data.gym?.timezone || 'Asia/Kolkata');
      setSettingsLoaded(true);
    } else {
      setSettingsError(res.error.message);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const minimumStartDate = (() => {
    const today = dateKeyInTimezone(new Date(), gymTimezone);
    return selectedMember?.membership_end && selectedMember.membership_end >= today
      ? addDays(selectedMember.membership_end, 1)
      : today;
  })();
  const renewalStartDate = renewalStartDateOverride || minimumStartDate;
  // Backdated renewals: the backend accepts any start date for EXPIRED
  // members — the picker floor applies only while the member is active.
  const isExpiredMember = Boolean(
    selectedMember &&
      (selectedMember.status === 'expired' ||
        (selectedMember.membership_end !== null &&
          selectedMember.membership_end < dateKeyInTimezone(new Date(), gymTimezone))),
  );
  const parsedRenewalDays = parseInt(renewalDays, 10);
  const renewalEndDate =
    renewalStartDate && parsedRenewalDays > 0
      ? addDays(renewalStartDate, parsedRenewalDays - 1)
      : '';

  // Pre-select member if provided
  const loadPreselectedMember = useCallback(async (memberId: number) => {
    setPreselectedMemberError(undefined);
    const res = await apiRequest<Member>(`/api/mobile/v1/members/${memberId}`);
    if (res.ok) {
      setSelectedMember(res.data);
      setRenewalStartDateOverride(undefined);
      if (res.data.plan?.duration_days) {
        setRenewalDays(String(res.data.plan.duration_days));
      }
      if (res.data.plan?.price) {
        setAmount(res.data.plan.price);
      }
    } else {
      // V10-L28: surface the failure instead of a blank search box.
      setPreselectedMemberError(res.error.message);
    }
  }, []);

  useEffect(() => {
    if (preselectedMemberId) {
      void loadPreselectedMember(preselectedMemberId);
    }
  }, [preselectedMemberId, loadPreselectedMember]);

  // Search members
  useEffect(() => {
    if (!searchQuery.trim() || selectedMember) {
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      const res = await apiRequest<{ members: Member[] }>(
        `/api/mobile/v1/members?q=${encodeURIComponent(searchQuery.trim())}&page_size=10`
      );
      setSearching(false);
      if (res.ok) setSearchResults(res.data.members);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, selectedMember]);

  const handleSubmit = useCallback(async () => {
    if (saving) return;
    if (!selectedMember) {
      Alert.alert('Error', 'Please select a member.');
      return;
    }
    const parsedAmount = parseFloat(amount);
    if (!amount.trim() || isNaN(parsedAmount) || parsedAmount < 0) {
      Alert.alert('Error', 'Please enter a valid amount.');
      return;
    }
    const days = parseInt(renewalDays, 10);
    if (!days || days < 1 || days > 730) {
      Alert.alert('Error', 'Renewal days must be between 1 and 730.');
      return;
    }

    const submitPayment = async () => {
      setSaving(true);

      // Stable idempotency key per screen instance: a timeout retry after the
      // server already committed must not double-create the payment.
      const idempotencyKey = paymentRequestKeyRef.current ?? createPaymentRequestKey();
      paymentRequestKeyRef.current = idempotencyKey;

      const result = await apiRequest<Payment>('/api/mobile/v1/payments', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: {
          member_id: selectedMember.id,
          amount: parsedAmount,
          method,
          reference: reference.trim() || undefined,
          notes: notes.trim() || undefined,
          renewal_days: days,
          renewal_start_date: renewalStartDate,
          // Off-plan days are rejected server-side without this.
          override_reason: days !== selectedMember.plan?.duration_days ? overrideReason.trim() || undefined : undefined,
        },
      });

      setSaving(false);

      if (result.ok) {
        paymentRequestKeyRef.current = undefined;
        const whatsappUrl = result.data?.whatsapp_url || result.data?.receipt?.whatsapp_url;
        if (whatsappUrl) {
          Alert.alert(
            'Payment Recorded! 🎉',
            `Payment of ${formatCurrency(parsedAmount)} recorded for ${selectedMember.full_name}. Send digital receipt via WhatsApp?`,
            [
              {
                text: 'Done',
                style: 'cancel',
                onPress: () => {
                  onCreated?.(result.data);
                  onBack();
                },
              },
              {
                text: 'Send WhatsApp',
                style: 'default',
                onPress: () => {
                  void Linking.openURL(whatsappUrl);
                  onCreated?.(result.data);
                  onBack();
                },
              },
            ]
          );
        } else {
          Alert.alert('Success', `Payment of ${formatCurrency(parsedAmount)} recorded for ${selectedMember.full_name}.`);
          onCreated?.(result.data);
          onBack();
        }
      } else {
        if (result.error.status && result.error.status < 500) {
          paymentRequestKeyRef.current = undefined;
        }
        Alert.alert('Error', result.error.message);
      }
    };

    const proceed = async () => {
      // Off-plan days need an owner override reason — the backend rejects
      // the payment without one, so require it before submitting.
      if (
        selectedMember.plan?.duration_days &&
        days !== selectedMember.plan.duration_days &&
        !overrideReason.trim()
      ) {
        Alert.alert(
          'Override reason required',
          'Off-plan renewal days need a reason (owner only). Enter it below, then tap Proceed Anyway.',
        );
        return;
      }
      if (parsedAmount === 0) {
        Alert.alert(
          'Confirm Complementary Payment',
          `Are you sure you want to record a ₹0 (complementary) payment for ${selectedMember.full_name}?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Confirm', onPress: () => { void submitPayment(); } },
          ]
        );
        return;
      }

      await submitPayment();
    };

    // Guard: a mistyped renewal-days value silently moves the member's
    // end date by that many days. If it differs from the plan's actual
    // duration, make it deliberate — and honest about who may override it.
    // Staff cannot override: the backend rejects off-plan days without an
    // owner override reason, so staff get the rejection up front instead of
    // a "Proceed Anyway" that always fails.
    const planDays = selectedMember.plan?.duration_days;
    if (planDays && days !== planDays) {
      if (getCachedSession()?.userRole !== 'gym_owner') {
        Alert.alert(
          'Off-plan renewal days',
          `You entered ${days} days, but ${selectedMember.plan?.name || 'the selected plan'} is ${planDays} days. Only the gym owner can record off-plan days (with a reason) — please ask the owner to record this payment.`,
        );
        return;
      }
      Alert.alert(
        'Check Renewal Days',
        `You entered ${days} days, but ${selectedMember.plan?.name || 'the selected plan'} is ${planDays} days. The member's end date will move by ${days} days. Enter an override reason below, then tap Proceed Anyway.`,
        [
          { text: 'Go Back', style: 'cancel' },
          { text: 'Proceed Anyway', onPress: () => { void proceed(); } },
        ]
      );
      return;
    }

    await proceed();
  }, [selectedMember, amount, method, reference, notes, renewalDays, renewalStartDate, overrideReason, onBack, onCreated, saving]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Record Payment" onBack={onBack} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* V10-L28: settings-load failure — dates on this screen are
              computed in the gym timezone, so a failed load must be
              visible with a retry, not a silent Asia/Kolkata fallback. */}
          {settingsError ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>
                Couldn&apos;t load gym settings — {settingsError} Dates below may be wrong until settings load.
              </Text>
              <TouchableOpacity onPress={() => void loadSettings()} activeOpacity={0.7}>
                <Text style={styles.retryLinkText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {/* Member Selection */}
          <View style={styles.card}>
            <View style={styles.sectionHeader}>
              <Icon name="person" size={18} color={colors.brand} />
              <Text style={styles.sectionTitle}>Member</Text>
            </View>

            {selectedMember ? (
              <View style={styles.selectedMember}>
                <Avatar name={selectedMember.full_name} size={40} />
                <View style={styles.selectedMemberInfo}>
                  <Text style={styles.selectedMemberName}>{selectedMember.full_name}</Text>
                  <Text style={styles.selectedMemberPhone}>{selectedMember.phone}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    setSelectedMember(undefined);
                    setRenewalStartDateOverride(undefined);
                    setSearchQuery('');
                  }}
                  style={styles.changeMember}
                >
                  <Text style={styles.changeMemberText}>Change</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {/* V10-L28: the preselected member failed to load — say
                    which member was expected and offer a retry instead
                    of a blank search box. */}
                {preselectedMemberId && preselectedMemberError ? (
                  <View style={styles.errorBanner}>
                    <Text style={styles.errorText}>
                      Couldn&apos;t load the selected member — {preselectedMemberError}
                    </Text>
                    <TouchableOpacity onPress={() => void loadPreselectedMember(preselectedMemberId)} activeOpacity={0.7}>
                      <Text style={styles.retryLinkText}>Retry</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
                <SearchBar
                  value={searchQuery}
                  onChangeText={(text) => {
                    setSearchQuery(text);
                    if (!text.trim()) setSearchResults([]);
                  }}
                  placeholder="Search member by name or phone..."
                />
                {searching ? (
                  <Text style={styles.searchingText}>Searching...</Text>
                ) : null}
                {searchResults.map((m) => (
                  <TouchableOpacity
                    key={m.id}
                    style={styles.searchResult}
                    onPress={() => {
                      setSelectedMember(m);
                      setRenewalStartDateOverride(undefined);
                      setSearchResults([]);
                      if (m.plan?.price) setAmount(m.plan.price);
                      if (m.plan?.duration_days) setRenewalDays(String(m.plan.duration_days));
                    }}
                  >
                    <Avatar name={m.full_name} size={32} />
                    <View style={styles.searchResultInfo}>
                      <Text style={styles.searchResultName}>{m.full_name}</Text>
                      <Text style={styles.searchResultPhone}>
                        {m.phone} · {m.plan?.name ?? 'Plan not set'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            )}
          </View>

          {/* Payment Details */}
          <View style={styles.card}>
            <View style={styles.sectionHeader}>
              <Icon name="cash" size={18} color={colors.brand} />
              <Text style={styles.sectionTitle}>Payment Details</Text>
            </View>

            <FormField
              label={`Amount (${getCurrencySymbol().trim()}) *`}
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              keyboardType="decimal-pad"
            />

            <Text style={styles.fieldLabel}>Payment Method</Text>
            <View style={styles.methodGrid}>
              {PAYMENT_METHODS.map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.methodChip, method === m && styles.methodChipActive]}
                  onPress={() => setMethod(m)}
                >
                  <Text style={[styles.methodChipText, method === m && styles.methodChipTextActive]}>
                    {m.replace('_', ' ').toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <FormField
              label="Reference / Transaction ID"
              value={reference}
              onChangeText={setReference}
              placeholder="Optional"
            />

            <FormField
              label="Renewal Days"
              value={renewalDays}
              onChangeText={setRenewalDays}
              placeholder="30"
              keyboardType="number-pad"
            />

            {/* V10-L28: date-dependent defaults render only once the
                settings leg has succeeded — until then the gym timezone
                is an unverified fallback and the start/end dates would
                be computed in the wrong zone. */}
            {settingsLoaded ? (
              <>
                <Text style={styles.fieldLabel}>Membership Start Date</Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => setShowStartDatePicker(true)}
                  style={styles.startDateButton}
                >
                  <Icon name="calendar" size={18} color={colors.brand} />
                  <Text style={styles.startDateText}>{renewalStartDate}</Text>
                  <Icon name="forward" size={16} color={colors.muted} />
                </TouchableOpacity>
                {showStartDatePicker ? (
                  <DateTimePicker
                    value={pickerDate(renewalStartDate)}
                    mode="date"
                    display="default"
                    minimumDate={isExpiredMember ? undefined : pickerDate(minimumStartDate)}
                    onChange={(_, selectedDate) => {
                      setShowStartDatePicker(false);
                      if (selectedDate) setRenewalStartDateOverride(dateKeyFromLocalDate(selectedDate));
                    }}
                  />
                ) : null}
                {isExpiredMember ? (
                  <Text style={styles.noticeText}>
                    This membership already expired — you can backdate the start to when the member actually paid.
                  </Text>
                ) : null}
                {renewalEndDate ? (
                  <Text style={styles.noticeText}>
                    New end date: {formatDate(renewalEndDate)}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text style={styles.noticeText}>Loading gym settings to set the membership dates…</Text>
            )}

            {selectedMember?.plan?.duration_days && parsedRenewalDays !== selectedMember.plan.duration_days ? (
              <FormField
                label="Override reason (required for off-plan days, owner only)"
                value={overrideReason}
                onChangeText={setOverrideReason}
                placeholder="e.g. Owner approved 45-day extension"
                multiline
                numberOfLines={2}
              />
            ) : null}

            <FormField
              label="Notes"
              value={notes}
              onChangeText={setNotes}
              placeholder="Optional notes..."
              multiline
              numberOfLines={2}
            />
          </View>

          {/* Security Notice */}
          <View style={styles.notice}>
            <Icon name="shield" size={16} color={colors.muted} />
            <Text style={styles.noticeText}>
              Payment will be recorded as &quot;pending&quot; and requires verification.
            </Text>
          </View>

          <PrimaryButton
            title="Record Payment"
            variant="primary"
            onPress={() => void handleSubmit()}
            loading={saving}
            disabled={saving || !selectedMember}
            icon={<Icon name="checkmark" size={18} color={colors.textInverse} />}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  changeMember: { paddingHorizontal: spacing.sm },
  changeMemberText: { color: colors.brand, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.bottomTabSafe },
  fieldLabel: { color: colors.textSecondary, fontSize: fontSize.base, fontWeight: fontWeight.medium, marginBottom: spacing.sm, marginTop: spacing.md },
  flex: { flex: 1 },
  methodChip: {
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  methodChipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  methodChipText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  methodChipTextActive: { color: colors.textInverse },
  methodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  notice: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.sm },
  noticeText: { color: colors.muted, flex: 1, fontSize: fontSize.sm },
  // V10-L28: slim settings / preselected-member error banner + retry.
  errorBanner: {
    backgroundColor: colors.criticalSurface,
    borderColor: colors.criticalBorder,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  errorText: {
    color: colors.critical,
    fontSize: fontSize.sm,
  },
  retryLinkText: {
    color: colors.brand,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    marginTop: spacing.xs,
  },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  searchResult: {
    alignItems: 'center',
    borderTopColor: colors.borderLight,
    borderTopWidth: 1,
    flexDirection: 'row',
    paddingVertical: spacing.md,
  },
  searchResultInfo: { flex: 1, marginLeft: spacing.md },
  searchResultName: { color: colors.text, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  searchResultPhone: { color: colors.muted, fontSize: fontSize.sm },
  searchingText: { color: colors.muted, fontSize: fontSize.sm, paddingVertical: spacing.sm },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  sectionTitle: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  startDateButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  startDateText: { color: colors.text, flex: 1, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  selectedMember: {
    alignItems: 'center',
    backgroundColor: colors.gray50,
    borderRadius: radius.md,
    flexDirection: 'row',
    padding: spacing.md,
  },
  selectedMemberInfo: { flex: 1, marginLeft: spacing.md },
  selectedMemberName: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  selectedMemberPhone: { color: colors.muted, fontSize: fontSize.sm },
});

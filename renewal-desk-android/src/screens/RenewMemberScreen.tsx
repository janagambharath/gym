import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../components/AppHeader';
import { Avatar } from '../components/Avatar';
import { InfoRow } from '../components/InfoRow';
import { PrimaryButton } from '../components/PrimaryButton';
import { SectionHeader } from '../components/SectionHeader';
import { StatusBadge } from '../components/StatusBadge';
import { apiRequest } from '../services/apiClient';
import { plansBlockSubmit, plansGateState } from '../services/plansGate';
import { keyForAction, shouldReleaseKey, type StableKeySlot } from '../services/stableKey';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing, fontFamily} from '../theme/tokens';
import type { Member, Payment, Plan } from '../types';
import { formatCurrency, formatDate, getCurrencySymbol, getMemberDisplayStatus, safeDateKeyInTimezone } from '../types';

type RenewMemberScreenProps = {
  member: Member;
  onBack: () => void;
  onLogout: () => void;
  onViewMember?: (member: Member) => void;
  onComplete?: () => void;
  /** V11-M3: the "create a plan first" link in the zero-plans banner. */
  onNavigatePlans?: () => void;
};

type PaymentMethod = 'cash' | 'upi' | 'card' | 'other';
type ChannelMode = 'online' | 'offline';

function createPaymentRequestKey(): string {
  return `payment-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function dateKeyInTimezone(value: Date, timezone: string): string {
  // V5-L32: the shared safe helper — an invalid gym timezone falls back
  // to the device-local date with a loud warning instead of throwing
  // RangeError during render and crashing this screen.
  return safeDateKeyInTimezone(value, timezone);
}

function addDaysToDateKey(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const result = new Date(year, month - 1, day + days, 12);
  return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, '0')}-${String(result.getDate()).padStart(2, '0')}`;
}

function dateKeyFromLocalDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function datePickerValue(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function suggestedRenewalStart(membershipEnd: string | null, timezone: string): string {
  const today = dateKeyInTimezone(new Date(), timezone);
  return membershipEnd && membershipEnd >= today
    ? addDaysToDateKey(membershipEnd, 1)
    : today;
}

export function RenewMemberScreen({
  member,
  onBack,
  onLogout,
  onViewMember,
  onComplete,
  onNavigatePlans,
}: RenewMemberScreenProps) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(member.plan?.id ?? null);
  // V10-L27: the plans leg used to fail silently — the picker rendered
  // empty with no error, and a plan-less member could be renewed for a
  // silent 30-day / ₹0 span. Capture the failure with a retry, and
  // block Renew while no plan is resolved and the load failed.
  // V11-M3: load *success with zero plans* is the same hole through
  // the empty leg — a blocking state, not an empty picker.
  const [plansError, setPlansError] = useState<string | undefined>();
  const [plansLoaded, setPlansLoaded] = useState(false);
  const [gymTimezone, setGymTimezone] = useState('Asia/Kolkata');
  const [renewalStartDate, setRenewalStartDate] = useState(() => suggestedRenewalStart(member.membership_end, 'Asia/Kolkata'));
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const startDateTouchedRef = useRef(false);

  // Financial Pricing Engine
  const [finalPayable, setFinalPayable] = useState<string>(member.plan?.price ?? '0');
  // Desk renewals are normally paid at the counter; online invoice mode is
  // an explicit switch. Offline payments should activate immediately.
  const [channelMode, setChannelMode] = useState<ChannelMode>('offline');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [discountNote, setDiscountNote] = useState('');

  const [renewing, setRenewing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [paymentResult, setPaymentResult] = useState<Payment | null>(null);
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);
  const [whatsAppFeedback, setWhatsAppFeedback] = useState<{
    message: string;
    type: 'error' | 'success';
  }>();
  const paymentRequestKeyRef = useRef<string | undefined>(undefined);
  // V11-L32: stable per-action key for the WhatsApp reminder, so a
  // timeout-retry after the server already sent it replays instead of
  // sending the member a second WhatsApp.
  const whatsAppKeyRef = useRef<StableKeySlot>(undefined);

  // Fetch available gym plans
  const loadPlans = useCallback(async () => {
    setPlansError(undefined);
    setPlansLoaded(false);
    const res = await apiRequest<{ plans: Plan[]; gym?: { timezone?: string } }>('/api/mobile/v1/settings');
    if (res.ok) {
      setPlans(res.data.plans);
      const timezone = res.data.gym?.timezone || 'Asia/Kolkata';
      setGymTimezone(timezone);
      if (!startDateTouchedRef.current) {
        setRenewalStartDate(suggestedRenewalStart(member.membership_end, timezone));
      }
      if (res.data.plans.length > 0 && !selectedPlanId) {
        const match = res.data.plans.find((p) => p.id === member.plan?.id) || res.data.plans[0];
        setSelectedPlanId(match.id);
        setFinalPayable(match.price);
      }
    } else {
      setPlansError(res.error.message);
    }
    setPlansLoaded(true);
  }, [member.membership_end, member.plan?.id, selectedPlanId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await loadPlans();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPlans]);

  const activePlan = plans.find((p) => p.id === selectedPlanId) || member.plan;
  const plansGate = plansGateState({ loaded: plansLoaded, plansCount: plans.length, error: plansError });
  const standardPrice = activePlan?.price ? parseFloat(activePlan.price) : 0;
  const renewalDays = activePlan?.duration_days ?? 30;
  const minimumStartDate = suggestedRenewalStart(member.membership_end, gymTimezone);
  // Backdated renewals: the backend accepts any start date for EXPIRED
  // members, so the picker floor (previous end + 1) applies only while the
  // member is still active. Expired members may backdate freely.
  const isExpiredMember =
    member.status === 'expired' ||
    (member.membership_end !== null &&
      member.membership_end < dateKeyInTimezone(new Date(), gymTimezone));
  const renewalEndDate = renewalStartDate
    ? addDaysToDateKey(renewalStartDate, renewalDays - 1)
    : '';

  // Derive discount and savings
  const numericPayable = parseFloat(finalPayable) || 0;
  const derivedDiscount = Math.max(0, standardPrice - numericPayable);
  const discountPercent = standardPrice > 0 ? Math.round((derivedDiscount / standardPrice) * 100) : 0;
  const displayStatus = getMemberDisplayStatus(member);

  const handleSelectPlan = (plan: Plan) => {
    setSelectedPlanId(plan.id);
    setFinalPayable(plan.price);
  };

  const handleRenew = useCallback(async () => {
    if (renewing) return;
    // V10-L27 / V11-M3: no plan resolved and the plans leg resolved
    // empty or failed — renewing now would post a silent 30-day / ₹0
    // renewal for a plan-less member. (A member WITH a plan renews
    // fine even when the fetch fails, via the member.plan fallback.)
    if (plansBlockSubmit(plansGate, Boolean(activePlan))) {
      if (plansGate === 'no-plans') {
        Alert.alert(
          'No membership plans yet',
          'Create a membership plan first — otherwise the renewal would have no plan to anchor on.',
        );
      } else {
        Alert.alert(
          'Plans could not be loaded',
          `Membership plans failed to load (${plansError}). Retry loading plans before renewing — otherwise the renewal would have no plan to anchor on.`,
        );
      }
      return;
    }
    if (numericPayable < 0) {
      Alert.alert('Invalid Amount', 'Payable amount cannot be negative.');
      return;
    }

    setRenewing(true);
    setError(undefined);
    const idempotencyKey = paymentRequestKeyRef.current ?? createPaymentRequestKey();
    paymentRequestKeyRef.current = idempotencyKey;

    const result = await apiRequest<Payment>('/api/mobile/v1/payments', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: {
        member_id: member.id,
        plan_id: selectedPlanId,
        standard_price: String(standardPrice),
        discount: String(derivedDiscount),
        final_payable: String(numericPayable),
        channel: channelMode,
        method: channelMode === 'online' ? 'upi' : paymentMethod,
        auto_verify: channelMode === 'offline',
        renewal_days: renewalDays,
        renewal_start_date: renewalStartDate,
        notes: discountNote.trim() || (derivedDiscount > 0 ? `Member-specific discount of ${getCurrencySymbol()}${derivedDiscount}` : 'Renewal recorded from Desk.'),
      },
    });

    if (result.ok) {
      paymentRequestKeyRef.current = undefined;
      setPaymentResult(result.data);
      setSuccess(true);
      onComplete?.();
    } else {
      // V6-L38: reset the busy flag before the 401 early-return, like
      // RecordPayment does — otherwise the renew button stays dead if
      // the logout navigation ever doesn't unmount this screen.
      if (result.error.status === 401) { setRenewing(false); onLogout(); return; }
      if (result.error.status && result.error.status < 500) {
        paymentRequestKeyRef.current = undefined;
      }
      setError(result.error.message);
    }
    setRenewing(false);
  }, [renewing, numericPayable, selectedPlanId, standardPrice, derivedDiscount, channelMode, paymentMethod, renewalDays, renewalStartDate, discountNote, member.id, onComplete, onLogout, activePlan, plansError, plansGate]);

  const handleSendWhatsApp = useCallback(async () => {
    if (sendingWhatsApp) return;

    setSendingWhatsApp(true);
    setWhatsAppFeedback(undefined);
    // V11-L32: stable per-action key — a retry after a lost response
    // replays instead of sending a second WhatsApp.
    const { key: whatsAppKey, slot } = keyForAction(whatsAppKeyRef.current, `reminder:${member.id}`);
    whatsAppKeyRef.current = slot;
    const result = await apiRequest<{ message: string; status: string }>('/api/mobile/v1/whatsapp/send-reminder', {
      method: 'POST',
      headers: { 'Idempotency-Key': whatsAppKey },
      body: { member_id: member.id },
    });
    if (shouldReleaseKey(result.ok, result.ok ? undefined : result.error.status)) {
      whatsAppKeyRef.current = undefined;
    }

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
    const isOnlineDemand = paymentResult.channel === 'online';
    const isScheduledRenewal = paymentResult.status === 'verified'
      && Boolean(paymentResult.renewal_start_date)
      && String(paymentResult.renewal_start_date) > dateKeyInTimezone(new Date(), gymTimezone);
    return (
      <SafeAreaView style={styles.safeArea}>
        <AppHeader title="Renewal Created" onBack={onBack} />
        <ScrollView contentContainerStyle={styles.successContent}>
          <View style={[styles.successIcon, isOnlineDemand && { backgroundColor: colors.infoSurface }]}>
            <Icon
              name={isOnlineDemand ? "send" : "checkmark"}
              size={44}
              color={isOnlineDemand ? colors.info : colors.textInverse}
            />
          </View>

          <Text style={styles.successTitle}>
            {isOnlineDemand
              ? "Invoice Published to VYNLA"
              : isScheduledRenewal ? "Payment Recorded & Scheduled" : "Payment Recorded & Active"}
          </Text>
          <Text style={styles.successSubtitle}>
            {isOnlineDemand
              ? `${member.full_name} will see a fixed payable amount of ${formatCurrency(paymentResult.amount)} on VYNLA.`
              : isScheduledRenewal
                ? `${member.full_name}'s renewed membership starts on ${formatDate(paymentResult.renewal_start_date)}.`
                : `Membership for ${member.full_name} has been renewed and activated.`}
          </Text>

          {/* Pricing breakdown card */}
          <View style={styles.successCard}>
            <SectionHeader title="Financial Breakdown" icon={<Icon name="currency" size={18} color={colors.brand} />} />
            <InfoRow label="Plan" value={activePlan?.name ?? 'Membership'} />
            <InfoRow label="Standard Catalog Price" value={formatCurrency(standardPrice)} />
            {derivedDiscount > 0 ? (
              <InfoRow label="Discount Applied" value={`- ${formatCurrency(derivedDiscount)} (${discountPercent}%)`} valueColor={colors.successDark} />
            ) : null}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Actual Paid / Payable</Text>
              <Text style={styles.totalValue}>{formatCurrency(paymentResult.amount)}</Text>
            </View>
            <InfoRow label="Channel" value={isOnlineDemand ? "Online (VYNLA UPI)" : `Counter (${(paymentResult.method || 'cash').toUpperCase()})`} />
            <InfoRow label="Status" value={paymentResult.status.toUpperCase()} valueColor={paymentResult.status === 'verified' ? colors.successDark : colors.statusPending} />
          </View>

          {/* Actions */}
          <PrimaryButton
            label="View Member Details"
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
            accessibilityLabel="Send WhatsApp confirmation"
            accessibilityRole="button"
            disabled={sendingWhatsApp}
            onPress={() => void handleSendWhatsApp()}
            style={[
              styles.successWhatsAppButton,
              sendingWhatsApp ? styles.successWhatsAppButtonDisabled : undefined,
            ]}
          >
            <Icon name="whatsapp" size={19} color={colors.whatsappDark} />
            <Text style={styles.successWhatsAppText}>
              {sendingWhatsApp ? 'Sending WhatsApp...' : 'Send WhatsApp Confirmation'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Renew Membership" onBack={onBack} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Member Identity Card */}
        <View style={styles.memberCard}>
          <Avatar
            name={member.full_name}
            size={46}
            color={colors.brandSubtle}
            textColor={colors.brand}
          />
          <View style={styles.memberCardInfo}>
            <Text style={styles.memberCardName} numberOfLines={1}>{member.full_name}</Text>
            <Text style={styles.memberCardPlan}>Current: {member.plan?.name ?? 'Plan not set'}</Text>
          </View>
          <StatusBadge status={displayStatus} size="md" />
        </View>

        {/* 1. Plan Selector Card */}
        <View style={styles.card}>
          <SectionHeader title="1. Select Target Plan" icon={<Icon name="clipboard" size={18} color={colors.brand} />} />
          {plansError ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>
                Couldn&apos;t load membership plans — {plansError}
              </Text>
              <TouchableOpacity onPress={() => void loadPlans()} activeOpacity={0.7}>
                <Text style={styles.retryLinkText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {/* V11-M3: zero plans blocks the renewal — the owner must
              create a plan first. Only shown when no plan is resolved
              at all; a member WITH a plan renews against it. */}
          {plansGate === 'no-plans' && !activePlan ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>
                No membership plans yet — create a plan first. Otherwise the renewal would have no plan to anchor on.
              </Text>
              {onNavigatePlans ? (
                <TouchableOpacity onPress={onNavigatePlans} activeOpacity={0.7}>
                  <Text style={styles.retryLinkText}>Create a plan →</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity onPress={() => void loadPlans()} activeOpacity={0.7}>
                <Text style={styles.retryLinkText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <View style={styles.planChipsContainer}>
            {plans.map((p) => {
              const isSelected = p.id === selectedPlanId;
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.planChip, isSelected && styles.planChipSelected]}
                  onPress={() => handleSelectPlan(p)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.planChipName, isSelected && styles.planChipNameSelected]}>{p.name}</Text>
                  <Text style={[styles.planChipPrice, isSelected && styles.planChipPriceSelected]}>{formatCurrency(p.price)}</Text>
                  <Text style={[styles.planChipDuration, isSelected && styles.planChipDurationSelected]}>{p.duration_days} days</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <InfoRow label="Current Expiry Date" value={formatDate(member.membership_end)} />
          <InfoRow label="Renewal Extension" value={`+${renewalDays} days`} valueColor={colors.brand} />
            <Text style={styles.inputLabel}>Membership Start Date</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Renewal starts ${formatDate(renewalStartDate)}`}
              onPress={() => setShowStartDatePicker(true)}
              style={styles.startDateButton}
            >
              <Icon name="calendar" size={18} color={colors.brand} />
              <Text style={styles.startDateButtonText}>{formatDate(renewalStartDate)}</Text>
              <Icon name="forward" size={16} color={colors.muted} />
            </TouchableOpacity>
            {showStartDatePicker ? (
              <DateTimePicker
                value={datePickerValue(renewalStartDate)}
                mode="date"
                display="default"
                minimumDate={isExpiredMember ? undefined : datePickerValue(minimumStartDate)}
                onChange={(_, selectedDate) => {
                  setShowStartDatePicker(false);
                  if (selectedDate) {
                    startDateTouchedRef.current = true;
                    setRenewalStartDate(dateKeyFromLocalDate(selectedDate));
                  }
                }}
              />
            ) : null}
            {isExpiredMember ? (
              <Text style={styles.helperText}>
                This membership already expired — you can backdate the start to when the member actually paid.
              </Text>
            ) : null}
            <InfoRow label="New Membership End Date" value={formatDate(renewalEndDate)} valueColor={colors.brand} />
        </View>

        {/* 2. Commercial Pricing Engine */}
        <View style={styles.card}>
          <SectionHeader title="2. Commercial Pricing (Custom Member Rate)" icon={<Icon name="currency" size={18} color={colors.brand} />} />
          <Text style={styles.helperText}>
            Plan catalog price remains standard. Customize the exact amount {member.full_name} will actually pay.
          </Text>

          {standardPrice > 0 && (
            <>
              <View style={styles.pricingRow}>
                <Text style={styles.pricingLabel}>Standard Catalog Price</Text>
                <Text style={styles.catalogPriceValue}>{formatCurrency(standardPrice)}</Text>
              </View>

              {/* Quick Discount Presets */}
              <View style={styles.discountPresetsRow}>
                <TouchableOpacity
                  style={[styles.presetChip, numericPayable === standardPrice && styles.presetChipActive]}
                  onPress={() => setFinalPayable(standardPrice.toString())}
                >
                  <Text style={[styles.presetChipText, numericPayable === standardPrice && styles.presetChipTextActive]}>
                    Full Price
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.presetChip, numericPayable === Math.max(0, standardPrice - 100) && styles.presetChipActive]}
                  onPress={() => setFinalPayable(Math.max(0, standardPrice - 100).toString())}
                >
                  <Text style={[styles.presetChipText, numericPayable === Math.max(0, standardPrice - 100) && styles.presetChipTextActive]}>
                    ₹100 Off
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.presetChip, numericPayable === Math.max(0, standardPrice - 200) && styles.presetChipActive]}
                  onPress={() => setFinalPayable(Math.max(0, standardPrice - 200).toString())}
                >
                  <Text style={[styles.presetChipText, numericPayable === Math.max(0, standardPrice - 200) && styles.presetChipTextActive]}>
                    ₹200 Off
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.presetChip, numericPayable === Math.max(0, Math.round(standardPrice * 0.9)) && styles.presetChipActive]}
                  onPress={() => setFinalPayable(Math.max(0, Math.round(standardPrice * 0.9)).toString())}
                >
                  <Text style={[styles.presetChipText, numericPayable === Math.max(0, Math.round(standardPrice * 0.9)) && styles.presetChipTextActive]}>
                    10% Off
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* Editable Final Payable */}
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Final Payable Amount ({getCurrencySymbol().trim()})</Text>
            <View style={styles.currencyInputRow}>
              <Text style={styles.currencyPrefix}>{getCurrencySymbol().trim()}</Text>
              <TextInput
                style={styles.currencyTextInput}
                value={finalPayable}
                onChangeText={setFinalPayable}
                keyboardType="numeric"
                placeholder="0.00"
                placeholderTextColor={colors.muted}
              />
            </View>
          </View>

          {/* Derived Discount & Savings Badge */}
          {standardPrice > 0 && (
            <View style={styles.derivedRow}>
              <View>
                <Text style={styles.derivedLabel}>Derived Discount</Text>
                <Text style={styles.derivedValue}>
                  {formatCurrency(derivedDiscount)} {derivedDiscount > 0 ? `(${discountPercent}% off)` : ''}
                </Text>
              </View>
              {derivedDiscount > 0 ? (
                <View style={styles.savingsPill}>
                  <Text style={styles.savingsPillText}>Member Saves {formatCurrency(derivedDiscount)}</Text>
                </View>
              ) : null}
            </View>
          )}

          {/* Commercial Note / Rationale */}
          <View style={styles.noteContainer}>
            <Text style={styles.inputLabel}>Commercial Note / Discount Reason</Text>
            <TextInput
              style={styles.noteInput}
              value={discountNote}
              onChangeText={setDiscountNote}
              placeholder="e.g. Retention Deal, Referral Bonus, Owner Special..."
              placeholderTextColor={colors.muted}
            />
          </View>
        </View>

        {/* 3. Delivery Route & Method */}
        <View style={styles.card}>
          <SectionHeader title="3. Payment Route & Execution" icon={<Icon name="payments" size={18} color={colors.brand} />} />
          
          <View style={styles.routeToggleContainer}>
            <TouchableOpacity
              style={[styles.routeTab, channelMode === 'online' && styles.routeTabActive]}
              onPress={() => setChannelMode('online')}
            >
              <Icon name="wallet" size={18} color={channelMode === 'online' ? colors.brand : colors.muted} />
              <Text style={[styles.routeTabText, channelMode === 'online' && styles.routeTabTextActive]}>
                Publish to VYNLA (UPI)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.routeTab, channelMode === 'offline' && styles.routeTabActive]}
              onPress={() => setChannelMode('offline')}
            >
              <Icon name="cash" size={18} color={channelMode === 'offline' ? colors.brand : colors.muted} />
              <Text style={[styles.routeTabText, channelMode === 'offline' && styles.routeTabTextActive]}>
                Counter Payment (Desk)
              </Text>
            </TouchableOpacity>
          </View>

          {channelMode === 'online' ? (
            <View style={styles.routeInfoBox}>
              <Icon name="info" size={18} color={colors.brand} />
              <Text style={styles.routeInfoText}>
                Member will see a fixed, non-editable price of <Text style={styles.boldText}>{formatCurrency(numericPayable)}</Text> in VYNLA and pay via direct UPI. Membership auto-extends once verified.
              </Text>
            </View>
          ) : (
            <View style={styles.offlineMethodsBox}>
              <Text style={styles.offlineMethodsLabel}>Select Counter Method:</Text>
              <View style={styles.methodRow}>
                {(['cash', 'upi', 'card', 'other'] as PaymentMethod[]).map((method) => (
                  <TouchableOpacity
                    key={method}
                    style={[styles.methodChip, paymentMethod === method && styles.methodChipActive]}
                    onPress={() => setPaymentMethod(method)}
                  >
                    <Text style={[styles.methodText, paymentMethod === method && styles.methodTextActive]}>
                      {method.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.offlineHelpText}>
                Counter payment will be recorded and membership will activate immediately.
              </Text>
            </View>
          )}
        </View>

        {/* Error */}
        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Action Button */}
        <PrimaryButton
          label={
            channelMode === 'online'
              ? `Publish to VYNLA (${formatCurrency(numericPayable)})`
              : `Confirm & Activate (${formatCurrency(numericPayable)})`
          }
          icon={<Icon name={channelMode === 'online' ? "send" : "checkmark"} size={16} color={colors.textInverse} />}
          onPress={() => void handleRenew()}
          disabled={numericPayable <= 0 || plansBlockSubmit(plansGate, Boolean(activePlan))}
          loading={renewing}
        />

        <TouchableOpacity onPress={onBack} style={styles.cancelButton}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.bottomTabSafe,
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
  // V10-L27: retry link inside the plans-load error banner.
  retryLinkText: {
    color: colors.brand,
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
    marginTop: spacing.xs,
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
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
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
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
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
    paddingBottom: spacing.bottomTabSafe,
  },
  successExpiry: {
    color: colors.statusPending,
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.extrabold, fontFamily: fontFamily.displayExtra,
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
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
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
    fontWeight: fontWeight.extrabold, fontFamily: fontFamily.displayExtra,
    textAlign: 'center',
  },
  totalLabel: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
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
    fontWeight: fontWeight.extrabold, fontFamily: fontFamily.displayExtra,
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
  planChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  planChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    minWidth: '47%',
    padding: spacing.md,
  },
  planChipSelected: {
    backgroundColor: colors.brandSubtle,
    borderColor: colors.brand,
    borderWidth: 2,
  },
  planChipName: {
    color: colors.text,
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
  planChipNameSelected: {
    color: colors.brand,
  },
  planChipPrice: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    marginTop: 2,
  },
  planChipPriceSelected: {
    color: colors.brand,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
  planChipDuration: {
    color: colors.muted,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  planChipDurationSelected: {
    color: colors.brand,
  },
  helperText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginBottom: spacing.md,
  },
  pricingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  pricingLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.base,
  },
  catalogPriceValue: {
    color: colors.muted,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
    textDecorationLine: 'line-through',
  },
  inputContainer: {
    marginTop: spacing.md,
  },
  inputLabel: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.xs,
  },
  startDateButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  startDateButtonText: {
    color: colors.text,
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  currencyInputRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.brand,
    borderRadius: radius.md,
    borderWidth: 2,
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
  },
  currencyPrefix: {
    color: colors.brand,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
    marginRight: spacing.xs,
  },
  currencyTextInput: {
    color: colors.text,
    flex: 1,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.extrabold, fontFamily: fontFamily.displayExtra,
    paddingVertical: spacing.sm,
  },
  derivedRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  discountPresetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  presetChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  presetChipActive: {
    backgroundColor: colors.brandSubtle,
    borderColor: colors.brand,
  },
  presetChipText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  presetChipTextActive: {
    color: colors.brand,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
  derivedLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  derivedValue: {
    color: colors.successDark,
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
  savingsPill: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  savingsPillText: {
    color: colors.successDark,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
  noteContainer: {
    marginTop: spacing.md,
  },
  noteInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: fontSize.base,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  routeToggleContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  routeTab: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  routeTabActive: {
    backgroundColor: colors.brandSubtle,
    borderColor: colors.brand,
    borderWidth: 2,
  },
  routeTabText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  routeTabTextActive: {
    color: colors.brand,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
  routeInfoBox: {
    alignItems: 'flex-start',
    backgroundColor: colors.infoSurface,
    borderColor: colors.infoBorder,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  routeInfoText: {
    color: colors.text,
    flex: 1,
    fontSize: fontSize.sm,
    lineHeight: 18,
  },
  boldText: {
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
  offlineMethodsBox: {
    gap: spacing.sm,
  },
  offlineMethodsLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  offlineHelpText: {
    color: colors.muted,
    fontSize: fontSize.xs,
  },
});

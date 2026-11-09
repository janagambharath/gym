import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
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
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
import { apiRequest, getCachedSession } from '../services/apiClient';
import { plansBlockSubmit, plansGateState } from '../services/plansGate';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing, fontFamily} from '../theme/tokens';
import type { Member, Plan } from '../types';
import { formatCurrency, getCurrencySymbol, getGymTodayISO, getPhoneCountryPrefix } from '../types';

function createMemberRequestKey(): string {
  return `member-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

const PAYMENT_METHODS = [
  { id: 'cash', label: 'CASH' },
  { id: 'upi', label: 'UPI' },
  { id: 'card', label: 'CARD' },
  { id: 'bank_transfer', label: 'BANK' },
  { id: 'other', label: 'OTHER' },
] as const;

type PaymentMethodType = (typeof PAYMENT_METHODS)[number]['id'];

function dateFromISO(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function dateToISO(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

type AddMemberScreenProps = {
  onBack: () => void;
  onLogout: () => void;
  onMemberCreated?: (member: Member) => void;
  /** V11-M3: the "create a plan first" link in the zero-plans banner. */
  onNavigatePlans?: () => void;
  plans?: Plan[];
  /** Convert-to-member prefill from a bot lead (name + phone). */
  prefillName?: string;
  prefillPhone?: string;
  /** Bot lead this member was converted from — PATCHed to `converted`
   * on success (V5-L31). The backend endpoint exists:
   * PATCH /api/mobile/v1/bot/leads/{id} {status: "converted"}. */
  leadId?: number;
};

export function AddMemberScreen({ onBack, onLogout, onMemberCreated, onNavigatePlans, plans: initialPlans = [], prefillName, prefillPhone, leadId }: AddMemberScreenProps) {
  const session = getCachedSession();
  const countryPrefix = getPhoneCountryPrefix(session?.gymTimezone, session?.gymCountry);
  const memberRequestKeyRef = useRef<string | undefined>(undefined);

  const [plans, setPlans] = useState<Plan[]>(initialPlans);
  const [fullName, setFullName] = useState(prefillName?.trim() ?? '');
  const [phone, setPhone] = useState(prefillPhone?.trim() ? prefillPhone.trim() : countryPrefix);

  // V5-L30: prefill is NOT initializer-only — navigating to an already
  // mounted AddMember with a new lead's params used to keep the previous
  // lead's name/phone. Re-sync whenever the prefill props change.
  useEffect(() => {
    setFullName(prefillName?.trim() ?? '');
    setPhone(prefillPhone?.trim() ? prefillPhone.trim() : countryPrefix);
  }, [prefillName, prefillPhone, countryPrefix]);
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const dupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkDuplicatePhone = useCallback((digits: string) => {
    if (dupTimer.current) clearTimeout(dupTimer.current);
    setDupWarning(null);
    if (digits.replace(/\D/g, '').length < 10) return;
    dupTimer.current = setTimeout(async () => {
      const clean = digits.replace(/\D/g, '');
      const res = await apiRequest<{ members: { full_name: string; phone: string }[] }>(`/api/mobile/v1/members?q=${encodeURIComponent(clean)}&page_size=3`);
      if (res.ok) {
        const matches = (res.data.members || []).filter(m => String(m.phone).replace(/\D/g, '').endsWith(clean.slice(-10)));
        if (matches.length) setDupWarning(`Possible duplicate: ${matches.map(m => m.full_name).join(', ')} already uses a similar number.`);
      }
    }, 600);
  }, []);
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [gender, setGender] = useState('');
  const [startDate, setStartDate] = useState(getGymTodayISO());
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(initialPlans.length > 0 ? initialPlans[0].id : null);

  // Customizable Money & Payment Engine
  const [customAmount, setCustomAmount] = useState<string>(initialPlans.length > 0 ? initialPlans[0].price : '');
  const [isPaid, setIsPaid] = useState<boolean>(true);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>('cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);

  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  // V10-M8: the plans leg used to fail silently — the plan section just
  // vanished and submit created a plan-less member with a fabricated
  // 30-day span. Capture the failure with a retry, and block submit
  // while no plan is selected and the load failed.
  // V11-M3: load *success with zero plans* is the same hole through
  // the empty leg (a new gym has no plans yet) — treat it as a
  // blocking state too, with a "create a plan first" link.
  const [plansError, setPlansError] = useState<string | undefined>();
  const [plansLoaded, setPlansLoaded] = useState(false);

  // Ensure fresh plans are loaded
  const loadPlans = useCallback(async () => {
    setPlansError(undefined);
    setPlansLoaded(false);
    const res = await apiRequest<{ plans: Plan[] }>('/api/mobile/v1/settings');
    if (res.ok) {
      setPlans(res.data.plans);
      if (res.data.plans.length > 0) {
        setSelectedPlanId((prev) => {
          if (prev === null) {
            setCustomAmount(res.data.plans[0].price);
            return res.data.plans[0].id;
          }
          return prev;
        });
      }
    } else {
      setPlansError(res.error.message);
    }
    setPlansLoaded(true);
  }, []);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  const plansGate = plansGateState({ loaded: plansLoaded, plansCount: plans.length, error: plansError });

  const selectedPlan = plans.find((p) => p.id === selectedPlanId);
  const standardPrice = selectedPlan?.price ? parseFloat(selectedPlan.price) : 0;
  const numericAmount = parseFloat(customAmount) || 0;
  const currencySymbol = getCurrencySymbol().trim();

  // Pricing analysis
  const derivedDiscount = Math.max(0, standardPrice - numericAmount);
  const discountPercent = standardPrice > 0 ? Math.round((derivedDiscount / standardPrice) * 100) : 0;
  const isDiscounted = standardPrice > 0 && numericAmount < standardPrice;
  const isAdditionalFee = standardPrice > 0 && numericAmount > standardPrice;
  const isComplementary = customAmount.trim() === '0' || (customAmount.trim() !== '' && numericAmount === 0);

  const handleSelectPlan = (plan: Plan) => {
    setSelectedPlanId(plan.id);
    setCustomAmount(plan.price);
    setErrors((e) => ({ ...e, amount: '' }));
  };

  const applyPreset = (amt: number) => {
    const clamped = Math.max(0, amt);
    setCustomAmount(clamped.toString());
    setErrors((e) => ({ ...e, amount: '' }));
  };

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};
    if (!fullName.trim()) newErrors.fullName = 'Name is required.';
    if (!phone.trim()) newErrors.phone = 'Phone number is required.';
    else if (phone.trim().length < 10) newErrors.phone = 'Phone number must be at least 10 digits.';

    if (customAmount.trim() !== '') {
      const parsed = parseFloat(customAmount);
      if (isNaN(parsed) || parsed < 0) {
        newErrors.amount = 'Please enter a valid non-negative amount.';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [fullName, phone, customAmount]);

  const handleSubmit = useCallback(async () => {
    if (!validate()) return;
    if (loading) return;
    // V10-M8 / V11-M3: never create a plan-less member — a plan is
    // what anchors duration, price and renewals. Blocks both when
    // the plans load failed and when it succeeded with zero plans
    // (new gym, no plans yet) and no plan is selected.
    if (plansBlockSubmit(plansGate, selectedPlanId !== null)) {
      if (plansGate === 'no-plans') {
        Alert.alert(
          'No membership plans yet',
          'Create a membership plan first — a member needs a plan for duration and pricing. Otherwise the member would be created without a plan.',
        );
      } else {
        Alert.alert(
          'Plans could not be loaded',
          `Membership plans failed to load (${plansError}). Retry loading plans before adding the member — otherwise the member would be created without a plan.`,
        );
      }
      return;
    }

    setLoading(true);
    setError(undefined);

    const today = getGymTodayISO();
    const start = /^\d{4}-\d{2}-\d{2}$/.test(startDate.trim()) ? startDate.trim() : today;
    const duration = selectedPlan?.duration_days ?? 30;
    const startObj = dateFromISO(start);
    startObj.setDate(startObj.getDate() + duration - 1);
    const endDate = dateToISO(startObj);

    const cleanDigits = phone.replace(/\D/g, '');
    // 10-digit local numbers get the gym's own country prefix — never a
    // hardcoded +91 (a US gym's 10-digit number is not an Indian number).
    const normalizedPhone = phone.trim().startsWith('+')
      ? phone.trim()
      : (cleanDigits.length === 10 ? `${countryPrefix}${cleanDigits}` : `+${cleanDigits}`);

    // Stable idempotency key per screen instance: a timeout retry after the
    // server already created the member must not create a duplicate.
    const idempotencyKey = memberRequestKeyRef.current ?? createMemberRequestKey();
    memberRequestKeyRef.current = idempotencyKey;

    const result = await apiRequest<Member>('/api/mobile/v1/members', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: {
        full_name: fullName.trim(),
        phone: normalizedPhone,
        email: email.trim() || undefined,
        address: address.trim() || undefined,
        gender: gender || undefined,
        plan_id: selectedPlanId,
        membership_start: start,
        membership_end: endDate,
        notes: notes.trim() || undefined,
        amount: customAmount.trim() !== '' ? customAmount.trim() : undefined,
        paid: isPaid,
        payment_method: isPaid ? paymentMethod : undefined,
        payment_reference: isPaid && paymentReference.trim() ? paymentReference.trim() : undefined,
      },
    });

    if (result.ok) {
      memberRequestKeyRef.current = undefined;
      // V5-L31: a member converted from a bot lead must mark the lead
      // converted, or it sits `new` in the pipeline forever. Fire and
      // forget — navigation must not wait on it — but warn loudly on
      // failure so a stuck lead is visible in logs.
      if (leadId) {
        void apiRequest(`/api/mobile/v1/bot/leads/${leadId}`, {
          method: 'PATCH',
          body: { status: 'converted' },
        }).then((leadRes) => {
          if (!leadRes.ok) {
            console.warn(`[AddMember] Could not mark bot lead ${leadId} converted: ${leadRes.error.message}`);
          }
        });
      }
      onMemberCreated?.(result.data);
    } else {
      // V6-L38: reset the busy flag before the 401 early-return, like
      // RecordPayment does — otherwise the submit button stays dead if
      // the logout navigation ever doesn't unmount this screen.
      if (result.error.status === 401) { setLoading(false); onLogout(); return; }
      if (result.error.status && result.error.status < 500) {
        memberRequestKeyRef.current = undefined;
      }
      setError(result.error.message);
    }
    setLoading(false);
  }, [
    fullName,
    phone,
    email,
    address,
    gender,
    selectedPlanId,
    notes,
    customAmount,
    isPaid,
    paymentMethod,
    paymentReference,
    startDate,
    loading,
    countryPrefix,
    onLogout,
    onMemberCreated,
    selectedPlan,
    validate,
    leadId,
    plansError,
    plansGate,
  ]);

  const submitLabel = isPaid
    ? numericAmount > 0
      ? `Add Member · ${formatCurrency(numericAmount)}`
      : 'Add Member (Free / ₹0)'
    : 'Add Member (Pay Later)';

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Add Member" onBack={onBack} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Member Information */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Member Information</Text>

            <View style={styles.form}>
              <FormField
                label="Full Name *"
                value={fullName}
                onChangeText={(t) => { setFullName(t); setErrors((e) => ({ ...e, fullName: '' })); }}
                placeholder="Enter full name"
                error={errors.fullName}
                autoCapitalize="words"
                returnKeyType="next"
              />

              <FormField
                label="Phone Number *"
                value={phone}
                onChangeText={(t) => { setPhone(t); setErrors((e) => ({ ...e, phone: '' })); checkDuplicatePhone(t); }}
                placeholder={countryPrefix ? `${countryPrefix} 9876543210` : 'Enter phone number'}
                error={errors.phone}
                keyboardType="phone-pad"
                returnKeyType="next"
              />
              {dupWarning ? (
                <View style={styles.dupWarning}>
                  <Text style={styles.dupWarningText}>⚠️ {dupWarning}</Text>
                </View>
              ) : null}

              <FormField
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="Enter email (optional)"
                keyboardType="email-address"
                autoCapitalize="none"
                returnKeyType="next"
              />

              <FormField
                label="Address"
                value={address}
                onChangeText={setAddress}
                placeholder="Enter street, area, city (optional)"
                returnKeyType="next"
              />

              <View>
                <Text style={styles.fieldLabel}>Gender</Text>
                <View style={styles.genderRow}>
                  {['Male', 'Female', 'Other'].map((g) => (
                    <TouchableOpacity
                      key={g}
                      style={[styles.genderChip, gender === g && styles.genderChipSelected]}
                      onPress={() => setGender(gender === g ? '' : g)}
                    >
                      <Text style={[styles.genderChipText, gender === g && styles.genderChipTextSelected]}>{g}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          </View>

          {/* Plan Selection */}
          {plansError ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Membership Plan</Text>
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>
                  Couldn&apos;t load membership plans — {plansError}
                </Text>
                <TouchableOpacity onPress={() => void loadPlans()} activeOpacity={0.7}>
                  <Text style={styles.retryLinkText}>Retry</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
          {/* V11-M3: zero plans is a blocking state, not an empty
              section — the owner must create a plan first, or the
              member would be created plan-less. */}
          {plansGate === 'no-plans' ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Membership Plan</Text>
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>
                  No membership plans yet — create a plan first. A member needs a plan for duration and pricing.
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
            </View>
          ) : null}
          {plans.length > 0 ? (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.sectionTitle}>Membership Plan</Text>
                {selectedPlan ? (
                  <Text style={styles.planDurationBadge}>{selectedPlan.duration_days} days</Text>
                ) : null}
              </View>
              <Text style={styles.sectionSubtitle}>
                Select a base plan to calculate duration and standard pricing:
              </Text>

              <View style={styles.planChipsContainer}>
                {plans.map((plan) => {
                  const isSelected = selectedPlanId === plan.id;
                  return (
                    <TouchableOpacity
                      key={plan.id}
                      style={[styles.planChip, isSelected && styles.planChipSelected]}
                      onPress={() => handleSelectPlan(plan)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.planChipName, isSelected && styles.planChipNameSelected]}>
                        {plan.name}
                      </Text>
                      <Text style={[styles.planChipPrice, isSelected && styles.planChipPriceSelected]}>
                        {formatCurrency(plan.price)}
                      </Text>
                      <Text style={[styles.planChipDuration, isSelected && styles.planChipDurationSelected]}>
                        {plan.duration_days} days
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* Customizable Money & Payment Section */}
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.sectionTitle}>Fee & Payment</Text>
              <View style={styles.customBadge}>
                <Text style={styles.customBadgeText}>Customizable Money</Text>
              </View>
            </View>
            <Text style={styles.sectionSubtitle}>
              {"You can adjust this member's joining fee, apply discounts, or mark as complementary:"}
            </Text>

            {/* Standard Catalog Price */}
            {standardPrice > 0 ? (
              <View style={styles.pricingRow}>
                <Text style={styles.pricingLabel}>Standard Plan Price</Text>
                <Text style={[styles.catalogPriceValue, isDiscounted && styles.catalogPriceStrikethrough]}>
                  {formatCurrency(standardPrice)}
                </Text>
              </View>
            ) : null}

            {/* Quick Discount / Amount Presets */}
            {standardPrice > 0 ? (
              <View style={styles.discountPresetsRow}>
                <TouchableOpacity
                  style={[styles.presetChip, numericAmount === standardPrice && styles.presetChipActive]}
                  onPress={() => applyPreset(standardPrice)}
                >
                  <Text style={[styles.presetChipText, numericAmount === standardPrice && styles.presetChipTextActive]}>
                    Full Price
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.presetChip, numericAmount === Math.max(0, standardPrice - 100) && styles.presetChipActive]}
                  onPress={() => applyPreset(standardPrice - 100)}
                >
                  <Text style={[styles.presetChipText, numericAmount === Math.max(0, standardPrice - 100) && styles.presetChipTextActive]}>
                    {currencySymbol}100 Off
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.presetChip, numericAmount === Math.max(0, standardPrice - 200) && styles.presetChipActive]}
                  onPress={() => applyPreset(standardPrice - 200)}
                >
                  <Text style={[styles.presetChipText, numericAmount === Math.max(0, standardPrice - 200) && styles.presetChipTextActive]}>
                    {currencySymbol}200 Off
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.presetChip, numericAmount === Math.max(0, Math.round(standardPrice * 0.9)) && styles.presetChipActive]}
                  onPress={() => applyPreset(Math.round(standardPrice * 0.9))}
                >
                  <Text style={[styles.presetChipText, numericAmount === Math.max(0, Math.round(standardPrice * 0.9)) && styles.presetChipTextActive]}>
                    10% Off
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.presetChip, isComplementary && styles.presetChipActive]}
                  onPress={() => applyPreset(0)}
                >
                  <Text style={[styles.presetChipText, isComplementary && styles.presetChipTextActive]}>
                    Free / {currencySymbol}0
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Customizable Amount Input */}
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>
                Membership Fee ({currencySymbol}) *
              </Text>
              <View style={[styles.currencyInputRow, errors.amount ? styles.currencyInputRowError : null]}>
                <Text style={styles.currencyPrefix}>{currencySymbol}</Text>
                <TextInput
                  style={styles.currencyTextInput}
                  value={customAmount}
                  onChangeText={(t) => {
                    const sanitized = t.replace(/[^0-9.]/g, '');
                    setCustomAmount(sanitized);
                    setErrors((e) => ({ ...e, amount: '' }));
                  }}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={colors.muted}
                />
              </View>
              {errors.amount ? <Text style={styles.errorSubText}>{errors.amount}</Text> : null}
            </View>

            {/* Savings or Custom Fee Notice */}
            {isDiscounted ? (
              <View style={styles.savingsPill}>
                <Icon name="check" size={14} color={colors.success} />
                <Text style={styles.savingsPillText}>
                  Member Saves {formatCurrency(derivedDiscount)} ({discountPercent}% off standard price)
                </Text>
              </View>
            ) : isAdditionalFee ? (
              <View style={styles.additionalFeePill}>
                <Icon name="info" size={14} color={colors.brand} />
                <Text style={styles.additionalFeePillText}>
                  Custom Price: +{formatCurrency(numericAmount - standardPrice)} over standard plan
                </Text>
              </View>
            ) : isComplementary ? (
              <View style={styles.complementaryPill}>
                <Icon name="info" size={14} color={colors.textSecondary} />
                <Text style={styles.complementaryPillText}>
                  Complementary membership ({currencySymbol}0 fee)
                </Text>
              </View>
            ) : null}

            {/* Payment Collection Toggle */}
            <View style={styles.paymentSection}>
              <Text style={styles.inputLabel}>Payment Status</Text>
              <View style={styles.paymentStatusRow}>
                <TouchableOpacity
                  style={[styles.statusTab, isPaid && styles.statusTabActive]}
                  onPress={() => setIsPaid(true)}
                  activeOpacity={0.7}
                >
                  <Icon name="cash" size={16} color={isPaid ? colors.brand : colors.muted} />
                  <Text style={[styles.statusTabText, isPaid && styles.statusTabTextActive]}>
                    Paid Now
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.statusTab, !isPaid && styles.statusTabActive]}
                  onPress={() => setIsPaid(false)}
                  activeOpacity={0.7}
                >
                  <Icon name="time" size={16} color={!isPaid ? colors.brand : colors.muted} />
                  <Text style={[styles.statusTabText, !isPaid && styles.statusTabTextActive]}>
                    Collect Later
                  </Text>
                </TouchableOpacity>
              </View>

              {isPaid ? (
                <View style={styles.paidMethodContainer}>
                  <Text style={styles.methodHeaderLabel}>Payment Method:</Text>
                  <View style={styles.methodRow}>
                    {PAYMENT_METHODS.map((m) => (
                      <TouchableOpacity
                        key={m.id}
                        style={[styles.methodChip, paymentMethod === m.id && styles.methodChipActive]}
                        onPress={() => setPaymentMethod(m.id)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.methodText, paymentMethod === m.id && styles.methodTextActive]}>
                          {m.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <View style={styles.referenceContainer}>
                    <FormField
                      label="Transaction / Reference ID"
                      value={paymentReference}
                      onChangeText={setPaymentReference}
                      placeholder="e.g. UPI Ref / Cheque No (optional)"
                      autoCapitalize="characters"
                    />
                  </View>

                  <Text style={styles.paymentHelpText}>
                    A verified payment of {formatCurrency(numericAmount)} will be recorded immediately for this member.
                  </Text>
                </View>
              ) : (
                <View style={styles.unpaidNoticeBox}>
                  <Icon name="info" size={16} color={colors.warning} />
                  <Text style={styles.unpaidNoticeText}>
                    Member will be enrolled with pending fee of {formatCurrency(numericAmount)}. You can record payment anytime from Desk.
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Notes */}
          <View style={styles.card}>
            <Text style={styles.dateLabel}>Membership Start Date</Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Choose membership start date, currently ${startDate}`}
              style={styles.dateButton}
              onPress={() => setShowStartDatePicker(true)}
            >
              <Text style={styles.dateButtonText}>{startDate}</Text>
              <Icon name="calendar" size={18} color={colors.brand} />
            </TouchableOpacity>
            <Text style={styles.dateHelp}>Choose the actual membership start date. Plan expiry is calculated from this date.</Text>
            <FormField
              label="Notes"
              value={notes}
              onChangeText={setNotes}
              placeholder="Any additional notes (optional)"
              multiline
            />
          </View>

          {/* Error */}
          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Submit */}
          <PrimaryButton
            label={submitLabel}
            icon={<Icon name="personAdd" size={18} color={colors.textInverse} />}
            onPress={() => void handleSubmit()}
            loading={loading}
            disabled={!fullName.trim() || !phone.trim() || plansBlockSubmit(plansGate, selectedPlanId !== null)}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      {showStartDatePicker ? (
        <DateTimePicker
          value={dateFromISO(startDate)}
          mode="date"
          display="default"
          onChange={(event, selectedDate) => {
            setShowStartDatePicker(false);
            if (event.type === 'set' && selectedDate) setStartDate(dateToISO(selectedDate));
          }}
        />
      ) : null}

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  dateLabel: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  dateButton: {
    alignItems: 'center', backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.md,
    borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 48,
    paddingHorizontal: spacing.lg,
  },
  dateButtonText: { color: colors.text, fontSize: fontSize.lg },
  dateHelp: { color: colors.muted, fontSize: fontSize.xs, lineHeight: 18 },
  dupWarning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: spacing.xs,
  },
  dupWarningText: { color: colors.warningDark, fontSize: fontSize.sm },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    marginBottom: spacing.xs,
  },
  genderRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  genderChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.card,
  },
  genderChipSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSubtle,
  },
  genderChipText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  genderChipTextSelected: {
    color: colors.brand,
    fontWeight: fontWeight.semibold,
  },
  additionalFeePill: {
    alignItems: 'center',
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  additionalFeePillText: {
    color: colors.brand,
    fontSize: fontSize.xs,
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
  cardHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  catalogPriceStrikethrough: {
    textDecorationLine: 'line-through',
  },
  catalogPriceValue: {
    color: colors.muted,
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
  complementaryPill: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  complementaryPillText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.bottomTabSafe,
  },
  currencyInputRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.brand,
    borderRadius: radius.md,
    borderWidth: 1.5,
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
  },
  currencyInputRowError: {
    borderColor: colors.critical,
  },
  currencyPrefix: {
    color: colors.brand,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
    marginRight: spacing.xs,
  },
  currencyTextInput: {
    color: colors.text,
    flex: 1,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
    paddingVertical: spacing.sm,
  },
  customBadge: {
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  customBadgeText: {
    color: colors.brand,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  discountPresetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  errorBanner: {
    backgroundColor: colors.criticalSurface,
    borderColor: colors.criticalBorder,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  errorSubText: {
    color: colors.critical,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
  errorText: {
    color: colors.critical,
    fontSize: fontSize.base,
  },
  retryLinkText: {
    color: colors.brand,
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
    marginTop: spacing.xs,
  },
  flex: {
    flex: 1,
  },
  form: {
    gap: spacing.lg,
    marginTop: spacing.lg,
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
  methodChip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  methodChipActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  methodHeaderLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    marginBottom: spacing.xs,
  },
  methodRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  methodText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  methodTextActive: {
    color: colors.textInverse,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
  paidMethodContainer: {
    marginTop: spacing.md,
  },
  paymentHelpText: {
    color: colors.muted,
    fontSize: fontSize.xs,
    lineHeight: 16,
    marginTop: spacing.sm,
  },
  paymentSection: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
  },
  paymentStatusRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  planChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    minWidth: '47%',
    padding: spacing.md,
  },
  planChipDuration: {
    color: colors.muted,
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  planChipDurationSelected: {
    color: colors.brand,
  },
  planChipName: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
  planChipNameSelected: {
    color: colors.brand,
  },
  planChipPrice: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    marginTop: 2,
  },
  planChipPriceSelected: {
    color: colors.brand,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
  planChipSelected: {
    backgroundColor: colors.brandSubtle,
    borderColor: colors.brand,
    borderWidth: 2,
  },
  planChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  planDurationBadge: {
    color: colors.brand,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  presetChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
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
  pricingLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  pricingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  referenceContainer: {
    marginTop: spacing.sm,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  savingsPill: {
    alignItems: 'center',
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  savingsPillText: {
    color: colors.successDark,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  sectionSubtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
  statusTab: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  statusTabActive: {
    backgroundColor: colors.brandSubtle,
    borderColor: colors.brand,
  },
  statusTabText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  statusTabTextActive: {
    color: colors.brand,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
  unpaidNoticeBox: {
    alignItems: 'center',
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  unpaidNoticeText: {
    color: colors.warning,
    flex: 1,
    fontSize: fontSize.xs,
    lineHeight: 16,
  },
});

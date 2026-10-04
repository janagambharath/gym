import { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../components/AppHeader';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
import { apiRequest, getCachedSession } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type { Member, Plan } from '../types';
import { formatCurrency, getCurrencySymbol, getGymTodayISO } from '../types';

/** Map gym timezone to a phone country prefix. */
function getCountryPrefix(timezone?: string): string {
  if (!timezone) return '+91';
  const tz = timezone.toLowerCase();
  if (tz.startsWith('asia/kolkata') || tz.startsWith('asia/calcutta') || tz === 'ist') return '+91';
  if (tz.startsWith('america/')) return '+1';
  if (tz.startsWith('europe/london')) return '+44';
  if (tz.startsWith('asia/dubai')) return '+971';
  if (tz.startsWith('asia/singapore')) return '+65';
  return '+91';
}

const PAYMENT_METHODS = [
  { id: 'cash', label: 'CASH' },
  { id: 'upi', label: 'UPI' },
  { id: 'card', label: 'CARD' },
  { id: 'bank_transfer', label: 'BANK' },
  { id: 'other', label: 'OTHER' },
] as const;

type PaymentMethodType = (typeof PAYMENT_METHODS)[number]['id'];

type AddMemberScreenProps = {
  onBack: () => void;
  onLogout: () => void;
  onMemberCreated?: (member: Member) => void;
  plans?: Plan[];
};

export function AddMemberScreen({ onBack, onLogout, onMemberCreated, plans: initialPlans = [] }: AddMemberScreenProps) {
  const session = getCachedSession();
  const countryPrefix = getCountryPrefix(session?.gymTimezone);

  const [plans, setPlans] = useState<Plan[]>(initialPlans);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState(countryPrefix);
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(initialPlans.length > 0 ? initialPlans[0].id : null);

  // Customizable Money & Payment Engine
  const [customAmount, setCustomAmount] = useState<string>(initialPlans.length > 0 ? initialPlans[0].price : '');
  const [isPaid, setIsPaid] = useState<boolean>(true);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>('cash');
  const [paymentReference, setPaymentReference] = useState('');

  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Ensure fresh plans are loaded
  useEffect(() => {
    let cancelled = false;
    void apiRequest<{ plans: Plan[] }>('/api/mobile/v1/settings').then((res) => {
      if (cancelled) return;
      if (res.ok && res.data.plans.length > 0) {
        setPlans(res.data.plans);
        setSelectedPlanId((prev) => {
          if (prev === null) {
            setCustomAmount(res.data.plans[0].price);
            return res.data.plans[0].id;
          }
          return prev;
        });
      }
    });
    return () => { cancelled = true; };
  }, []);

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

    setLoading(true);
    setError(undefined);

    const today = getGymTodayISO();
    const duration = selectedPlan?.duration_days ?? 30;
    const endDate = new Date(Date.now() + duration * 86400000).toISOString().split('T')[0];

    const cleanDigits = phone.replace(/\D/g, '');
    const normalizedPhone = phone.trim().startsWith('+')
      ? phone.trim()
      : (cleanDigits.length === 10 ? `+91${cleanDigits}` : `+${cleanDigits}`);

    const result = await apiRequest<Member>('/api/mobile/v1/members', {
      method: 'POST',
      body: {
        full_name: fullName.trim(),
        phone: normalizedPhone,
        email: email.trim() || undefined,
        address: address.trim() || undefined,
        plan_id: selectedPlanId,
        membership_start: today,
        membership_end: endDate,
        notes: notes.trim() || undefined,
        amount: customAmount.trim() !== '' ? customAmount.trim() : undefined,
        paid: isPaid,
        payment_method: isPaid ? paymentMethod : undefined,
        payment_reference: isPaid && paymentReference.trim() ? paymentReference.trim() : undefined,
      },
    });

    if (result.ok) {
      onMemberCreated?.(result.data);
    } else {
      if (result.error.status === 401) { onLogout(); return; }
      setError(result.error.message);
    }
    setLoading(false);
  }, [
    fullName,
    phone,
    email,
    address,
    selectedPlanId,
    notes,
    customAmount,
    isPaid,
    paymentMethod,
    paymentReference,
    loading,
    onLogout,
    onMemberCreated,
    selectedPlan,
    validate,
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
                onChangeText={(t) => { setPhone(t); setErrors((e) => ({ ...e, phone: '' })); }}
                placeholder={countryPrefix ? `${countryPrefix} 9876543210` : 'Enter phone number'}
                error={errors.phone}
                keyboardType="phone-pad"
                returnKeyType="next"
              />

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
            </View>
          </View>

          {/* Plan Selection */}
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
            disabled={!fullName.trim() || !phone.trim()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
    fontWeight: fontWeight.bold,
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
    fontWeight: fontWeight.bold,
    marginRight: spacing.xs,
  },
  currencyTextInput: {
    color: colors.text,
    flex: 1,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
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
    fontWeight: fontWeight.bold,
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
    fontWeight: fontWeight.bold,
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
    fontWeight: fontWeight.bold,
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
    fontWeight: fontWeight.bold,
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
    fontWeight: fontWeight.bold,
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
    fontWeight: fontWeight.bold,
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

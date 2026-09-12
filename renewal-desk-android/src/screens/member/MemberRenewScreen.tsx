/**
 * MemberRenewScreen — Self-service renewal flow for gym members.
 *
 * Flow: Select plan → View payment info → "I've Paid" → Confirmation
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../../theme/tokens';
import type { MemberPlan, MemberPaymentInfo } from '../../services/memberApiClient';
import {
  claimPayment,
  fetchMemberPaymentInfo,
  fetchMemberPlans,
} from '../../services/memberApiClient';

type MemberRenewScreenProps = {
  onBack: () => void;
  onSuccess: () => void;
};

export function MemberRenewScreen({ onBack, onSuccess }: MemberRenewScreenProps) {
  const [step, setStep] = useState<'plan' | 'pay' | 'confirm' | 'done'>('plan');
  const [plans, setPlans] = useState<MemberPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<MemberPlan | null>(null);
  const [paymentInfo, setPaymentInfo] = useState<MemberPaymentInfo | null>(null);
  const [reference, setReference] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const load = async () => {
      const [plansResult, paymentResult] = await Promise.all([
        fetchMemberPlans(),
        fetchMemberPaymentInfo(),
      ]);

      if (plansResult.ok) {
        setPlans(plansResult.data.plans);
        if (plansResult.data.plans.length === 1) {
          setSelectedPlan(plansResult.data.plans[0]);
        }
      }
      if (paymentResult.ok) {
        setPaymentInfo(paymentResult.data);
      }
      setLoading(false);
    };
    void load();
  }, []);

  const handleSelectPlan = useCallback((plan: MemberPlan) => {
    setSelectedPlan(plan);
    setStep('pay');
  }, []);

  const handleConfirmPayment = useCallback(() => {
    setStep('confirm');
  }, []);

  const handleClaimPayment = useCallback(async () => {
    setSubmitting(true);
    setError(undefined);

    const result = await claimPayment(selectedPlan?.id, reference.trim() || undefined);
    if (result.ok) {
      setStep('done');
    } else {
      setError(result.error);
      Alert.alert('Error', result.error);
    }
    setSubmitting(false);
  }, [selectedPlan, reference]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={step === 'done' ? onSuccess : onBack} style={styles.backBtn}>
          <Icon name="back" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {step === 'plan'
            ? 'Choose a Plan'
            : step === 'pay'
            ? 'Make Payment'
            : step === 'confirm'
            ? 'Confirm Payment'
            : 'Success!'}
        </Text>
        <View style={{ width: 32 }} />
      </View>

      {/* Step Indicators */}
      <View style={styles.steps}>
        {['Plan', 'Pay', 'Confirm'].map((label, idx) => {
          const stepIdx = ['plan', 'pay', 'confirm', 'done'].indexOf(step);
          const isActive = idx <= stepIdx;
          return (
            <View key={label} style={styles.stepItem}>
              <View style={[styles.stepDot, isActive && styles.stepDotActive]}>
                <Text style={[styles.stepDotText, isActive && styles.stepDotTextActive]}>
                  {idx < stepIdx ? '✓' : idx + 1}
                </Text>
              </View>
              <Text style={[styles.stepLabel, isActive && styles.stepLabelActive]}>
                {label}
              </Text>
            </View>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Step 1: Plan Selection */}
        {step === 'plan' && (
          <>
            <Text style={styles.sectionTitle}>Select your membership plan</Text>
            {plans.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>
                  No plans available. Contact your gym for renewal.
                </Text>
              </View>
            ) : (
              plans.map((plan) => (
                <TouchableOpacity
                  key={plan.id}
                  style={[
                    styles.planCard,
                    selectedPlan?.id === plan.id && styles.planCardSelected,
                  ]}
                  onPress={() => handleSelectPlan(plan)}
                  activeOpacity={0.7}
                >
                  <View style={styles.planHeader}>
                    <Text style={styles.planName}>{plan.name}</Text>
                    <View style={[styles.planBadge, selectedPlan?.id === plan.id && styles.planBadgeSelected]}>
                      <Text style={[styles.planBadgeText, selectedPlan?.id === plan.id && styles.planBadgeTextSelected]}>
                        {plan.duration_days} days
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.planPrice}>₹{plan.price}</Text>
                  <Text style={styles.planPerDay}>
                    ₹{(parseFloat(plan.price) / plan.duration_days).toFixed(0)}/day
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </>
        )}

        {/* Step 2: Payment Info */}
        {step === 'pay' && (
          <>
            <View style={styles.selectedPlanBanner}>
              <Text style={styles.selectedPlanLabel}>Selected Plan</Text>
              <Text style={styles.selectedPlanName}>{selectedPlan?.name}</Text>
              <Text style={styles.selectedPlanPrice}>₹{selectedPlan?.price}</Text>
            </View>

            <Text style={styles.sectionTitle}>Payment Details</Text>

            {paymentInfo?.upi_id ? (
              <View style={styles.paymentInfoCard}>
                <View style={styles.paymentInfoRow}>
                  <Text style={styles.paymentInfoLabel}>UPI ID</Text>
                  <Text style={styles.paymentInfoValue}>{paymentInfo.upi_id}</Text>
                </View>
                {paymentInfo.payment_label && (
                  <View style={styles.paymentInfoRow}>
                    <Text style={styles.paymentInfoLabel}>Pay To</Text>
                    <Text style={styles.paymentInfoValue}>{paymentInfo.payment_label}</Text>
                  </View>
                )}
                {paymentInfo.instructions && (
                  <View style={styles.instructionsBox}>
                    <Icon name="info" size={16} color={colors.brand} />
                    <Text style={styles.instructionsText}>{paymentInfo.instructions}</Text>
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.paymentInfoCard}>
                <Text style={styles.paymentInfoLabel}>
                  Contact your gym to make payment
                </Text>
                {paymentInfo?.gym_phone && (
                  <Text style={styles.gymPhoneText}>📞 {paymentInfo.gym_phone}</Text>
                )}
              </View>
            )}

            <TouchableOpacity
              style={styles.confirmButton}
              onPress={handleConfirmPayment}
              activeOpacity={0.7}
            >
              <Icon name="checkmark" size={20} color="#fff" />
              <Text style={styles.confirmButtonText}>{"I've Made the Payment"}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* Step 3: Confirm */}
        {step === 'confirm' && (
          <>
            <View style={styles.confirmCard}>
              <Icon name="receipt" size={32} color={colors.brand} />
              <Text style={styles.confirmTitle}>Confirm Your Payment</Text>
              <Text style={styles.confirmSubtitle}>
                Enter your transaction reference (optional) and submit for verification.
              </Text>

              <View style={styles.confirmDetails}>
                <DetailRow label="Plan" value={selectedPlan?.name ?? ''} />
                <DetailRow label="Amount" value={`₹${selectedPlan?.price ?? '0'}`} />
                <DetailRow label="Duration" value={`${selectedPlan?.duration_days ?? 0} days`} />
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Transaction Reference (Optional)</Text>
                <TextInput
                  style={styles.textInput}
                  value={reference}
                  onChangeText={setReference}
                  placeholder="e.g. UPI ref, bank transaction ID"
                  placeholderTextColor={colors.muted}
                />
              </View>

              {error && (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              <TouchableOpacity
                style={[styles.submitButton, submitting && styles.buttonDisabled]}
                onPress={() => void handleClaimPayment()}
                disabled={submitting}
                activeOpacity={0.7}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Icon name="send" size={18} color="#fff" />
                    <Text style={styles.submitButtonText}>Submit Payment Claim</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Step 4: Done */}
        {step === 'done' && (
          <View style={styles.doneCard}>
            <View style={styles.doneIconWrap}>
              <Text style={styles.doneIcon}>🎉</Text>
            </View>
            <Text style={styles.doneTitle}>Payment Submitted!</Text>
            <Text style={styles.doneSubtitle}>
              {"Your gym will verify the payment and renew your membership. You'll receive a confirmation on WhatsApp."}
            </Text>

            <TouchableOpacity
              style={styles.doneButton}
              onPress={onSuccess}
              activeOpacity={0.7}
            >
              <Text style={styles.doneButtonText}>Back to Home</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { padding: spacing.xs },
  headerTitle: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  steps: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xxxl,
    padding: spacing.lg,
    backgroundColor: colors.surface,
  },
  stepItem: { alignItems: 'center', gap: spacing.xs },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.gray200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotActive: { backgroundColor: colors.brand },
  stepDotText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.muted },
  stepDotTextActive: { color: '#fff' },
  stepLabel: { fontSize: fontSize.xs, color: colors.muted, fontWeight: fontWeight.medium },
  stepLabelActive: { color: colors.brand, fontWeight: fontWeight.semibold },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.bottomTabSafe,
  },
  sectionTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  planCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    borderWidth: 2,
    borderColor: colors.border,
    gap: spacing.xs,
    ...shadows.sm,
  },
  planCardSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSubtle,
  },
  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  planName: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  planBadge: {
    backgroundColor: colors.gray100,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  planBadgeSelected: { backgroundColor: colors.brand },
  planBadgeText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
  },
  planBadgeTextSelected: { color: '#fff' },
  planPrice: {
    fontSize: fontSize['4xl'],
    fontWeight: fontWeight.extrabold,
    color: colors.text,
  },
  planPerDay: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xxl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyText: {
    fontSize: fontSize.base,
    color: colors.muted,
    textAlign: 'center',
  },
  selectedPlanBanner: {
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.infoBorder,
    gap: spacing.xxs,
  },
  selectedPlanLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.brand,
  },
  selectedPlanName: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  selectedPlanPrice: {
    fontSize: fontSize['4xl'],
    fontWeight: fontWeight.extrabold,
    color: colors.brand,
  },
  paymentInfoCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  paymentInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  paymentInfoLabel: {
    fontSize: fontSize.base,
    color: colors.muted,
    fontWeight: fontWeight.medium,
  },
  paymentInfoValue: {
    fontSize: fontSize.base,
    color: colors.text,
    fontWeight: fontWeight.bold,
  },
  gymPhoneText: {
    fontSize: fontSize.xl,
    color: colors.brand,
    fontWeight: fontWeight.semibold,
    marginTop: spacing.sm,
  },
  instructionsBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.infoSurface,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'flex-start',
  },
  instructionsText: {
    flex: 1,
    fontSize: fontSize.md,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  confirmButton: {
    backgroundColor: colors.success,
    borderRadius: radius.xl,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    ...shadows.md,
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  confirmCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xxl,
    gap: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  confirmTitle: {
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  confirmSubtitle: {
    fontSize: fontSize.base,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
  confirmDetails: {
    width: '100%',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.borderLight,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: fontSize.base,
    color: colors.muted,
    fontWeight: fontWeight.medium,
  },
  detailValue: {
    fontSize: fontSize.base,
    color: colors.text,
    fontWeight: fontWeight.semibold,
  },
  inputContainer: { width: '100%', gap: spacing.sm },
  inputLabel: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontWeight: fontWeight.semibold,
  },
  textInput: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    fontSize: fontSize.base,
    color: colors.text,
  },
  errorBanner: {
    backgroundColor: colors.criticalSurface,
    borderColor: colors.criticalBorder,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    width: '100%',
  },
  errorText: { color: colors.critical, fontSize: fontSize.base },
  submitButton: {
    backgroundColor: colors.brand,
    borderRadius: radius.xl,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    width: '100%',
    ...shadows.md,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  buttonDisabled: { opacity: 0.5 },
  doneCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xxxl,
    gap: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.successBorder,
    marginTop: spacing.xxxl,
  },
  doneIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.successSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneIcon: { fontSize: 40 },
  doneTitle: {
    fontSize: fontSize['4xl'],
    fontWeight: fontWeight.extrabold,
    color: colors.success,
  },
  doneSubtitle: {
    fontSize: fontSize.base,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  doneButton: {
    backgroundColor: colors.brand,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxxl,
  },
  doneButtonText: {
    color: '#fff',
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
});

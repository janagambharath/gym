import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { apiClient } from '../services/apiClient';
import { useBranding } from '../context/BrandingContext';
import { MembershipPlan, PaymentInfo, RootStackParamList } from '../types';
import { colors, radii, spacing, typography } from '../theme/tokens';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RenewRouteProp = RouteProp<RootStackParamList, 'Renew'>;

export const RenewScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RenewRouteProp>();
  const { theme } = useBranding();

  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(route.params?.initialPlanId || null);
  const [reference, setReference] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [claimedSuccess, setClaimedSuccess] = useState(false);
  const [claimedData, setClaimedData] = useState<any>(null);
  const [copiedUpi, setCopiedUpi] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        const [plansRes, infoRes] = await Promise.all([
          apiClient.getPlans(),
          apiClient.getPaymentInfo(),
        ]);
        setPlans(plansRes);
        setPaymentInfo(infoRes);
        if (plansRes.length > 0 && !selectedPlanId) {
          setSelectedPlanId(plansRes[0].id);
        }
      } catch (err: any) {
        Alert.alert('Error', err.message || 'Unable to load payment instructions.');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [selectedPlanId]);

  const selectedPlan = plans.find((p) => p.id === selectedPlanId) || plans[0];

  const handleCopyUpi = () => {
    // In React Native / Expo, copy to clipboard
    setCopiedUpi(true);
    setTimeout(() => setCopiedUpi(false), 2500);
  };

  const handleClaimPayment = async () => {
    if (submitting) return; // Prevent double tap
    setSubmitting(true);
    try {
      const res = await apiClient.claimPayment(selectedPlan?.id, reference.trim());
      setClaimedData(res);
      setClaimedSuccess(true);
    } catch (err: any) {
      Alert.alert('Unable to Submit Claim', err.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={styles.loadingText}>Loading renewal plans & payment details...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Claim Confirmation State (Authoritative PAYMENT_CLAIMED status)
  if (claimedSuccess) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.successContainer}>
          <View style={[styles.successIconCircle, { backgroundColor: colors.expiringSurface }]}>
            <Ionicons name="hourglass" size={48} color={colors.expiring} />
          </View>
          <Text style={styles.successTitle}>Payment Claimed</Text>
          <Text style={styles.successSubtitle}>
            Your payment submission of ₹{claimedData?.amount || selectedPlan?.price} for the{' '}
            <Text style={styles.boldText}>{selectedPlan?.name}</Text> has been sent to{' '}
            <Text style={styles.boldText}>{theme.gymName}</Text>.
          </Text>

          <View style={styles.verificationNoteCard}>
            <Ionicons name="information-circle" size={20} color={colors.platform} />
            <Text style={styles.verificationNoteText}>
              Your membership will be updated to ACTIVE as soon as the gym owner confirms your transaction.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.doneButton, { backgroundColor: theme.primary }]}
            onPress={() => navigation.navigate('MainTabs')}
            activeOpacity={0.85}
          >
            <Text style={[styles.doneButtonText, { color: theme.primaryText }]}>Back to Home</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardContainer}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Renew Membership</Text>
          </View>

          {/* Step 1: Select Plan */}
          <View style={styles.stepSection}>
            <Text style={styles.stepTitle}>1. Choose Membership Plan</Text>
            <View style={styles.planList}>
              {plans.map((plan) => {
                const isSelected = plan.id === selectedPlanId;
                return (
                  <TouchableOpacity
                    key={plan.id}
                    style={[
                      styles.planCard,
                      isSelected && [styles.planCardSelected, { borderColor: theme.primary }],
                    ]}
                    onPress={() => setSelectedPlanId(plan.id)}
                    activeOpacity={0.85}
                  >
                    <View style={styles.planCardLeft}>
                      <View
                        style={[
                          styles.radioCircle,
                          isSelected && [styles.radioSelected, { borderColor: theme.primary }],
                        ]}
                      >
                        {isSelected && (
                          <View style={[styles.radioDot, { backgroundColor: theme.primary }]} />
                        )}
                      </View>
                      <View>
                        <Text style={styles.planName}>{plan.name}</Text>
                        <Text style={styles.planDuration}>{plan.duration_days} Days Validity</Text>
                      </View>
                    </View>
                    <Text style={[styles.planPrice, isSelected && { color: theme.primary }]}>
                      ₹{plan.price}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Step 2: Pay the Gym */}
          <View style={styles.stepSection}>
            <Text style={styles.stepTitle}>2. Pay to Gym</Text>
            <View style={styles.paymentCard}>
              <Text style={styles.paymentLabel}>PAY DIRECTLY TO</Text>
              <Text style={styles.gymPayeeName}>{theme.gymName}</Text>

              {paymentInfo?.upi_id ? (
                <View style={styles.upiContainer}>
                  <View style={styles.upiRow}>
                    <View style={styles.upiInfo}>
                      <Text style={styles.upiSublabel}>UPI ID</Text>
                      <Text style={styles.upiIdText}>{paymentInfo.upi_id}</Text>
                    </View>
                    <TouchableOpacity style={styles.copyButton} onPress={handleCopyUpi}>
                      <Ionicons
                        name={copiedUpi ? 'checkmark-circle' : 'copy-outline'}
                        size={18}
                        color={copiedUpi ? colors.active : colors.platform}
                      />
                      <Text
                        style={[
                          styles.copyButtonText,
                          copiedUpi && { color: colors.active },
                        ]}
                      >
                        {copiedUpi ? 'Copied' : 'Copy'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}

              {paymentInfo?.instructions ? (
                <Text style={styles.instructionsText}>{paymentInfo.instructions}</Text>
              ) : null}

              {paymentInfo?.qr_public_url ? (
                <View style={styles.qrContainer}>
                  <Image
                    source={{ uri: paymentInfo.qr_public_url }}
                    style={styles.qrImage}
                    resizeMode="contain"
                  />
                  <Text style={styles.qrCaption}>Scan with any UPI app to pay ₹{selectedPlan?.price}</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Step 3: Reference & I've Paid */}
          <View style={styles.stepSection}>
            <Text style={styles.stepTitle}>3. Submit Payment Claim</Text>
            <View style={styles.claimForm}>
              <Text style={styles.inputLabel}>UPI Reference / Transaction ID (Optional)</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 423985729103"
                placeholderTextColor={colors.muted}
                value={reference}
                onChangeText={setReference}
              />
              <Text style={styles.inputHelp}>
                Entering your transaction ID helps the gym verify your payment faster.
              </Text>

              <TouchableOpacity
                style={[
                  styles.claimButton,
                  { backgroundColor: theme.primary },
                  submitting && styles.buttonDisabled,
                ]}
                onPress={handleClaimPayment}
                disabled={submitting}
                activeOpacity={0.85}
              >
                {submitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="checkmark-done" size={20} color={theme.primaryText} />
                    <Text style={[styles.claimButtonText, { color: theme.primaryText }]}>
                      I've Paid ₹{selectedPlan?.price || '0'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  keyboardContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    ...typography.subtext,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  closeButton: {
    padding: spacing.xs,
  },
  headerTitle: {
    ...typography.h2,
    color: colors.text,
  },
  stepSection: {
    marginBottom: spacing.xl,
  },
  stepTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.md,
  },
  planList: {
    gap: spacing.sm,
  },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  planCardSelected: {
    backgroundColor: '#F8FAFC',
  },
  planCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: radii.full,
    borderWidth: 2,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: colors.platform,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: radii.full,
  },
  planName: {
    ...typography.bodySemibold,
    color: colors.text,
  },
  planDuration: {
    ...typography.subtext,
    color: colors.textSecondary,
    marginTop: 2,
  },
  planPrice: {
    ...typography.h3,
    color: colors.text,
  },
  paymentCard: {
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  paymentLabel: {
    ...typography.caption,
    color: colors.muted,
    letterSpacing: 0.8,
  },
  gymPayeeName: {
    ...typography.h3,
    color: colors.text,
    marginTop: 2,
    marginBottom: spacing.md,
  },
  upiContainer: {
    backgroundColor: '#F8FAFC',
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.md,
  },
  upiRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  upiInfo: {
    flex: 1,
  },
  upiSublabel: {
    ...typography.caption,
    color: colors.muted,
  },
  upiIdText: {
    ...typography.bodySemibold,
    color: colors.text,
    marginTop: 2,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  copyButtonText: {
    ...typography.caption,
    color: colors.platform,
    fontWeight: '600',
  },
  instructionsText: {
    ...typography.subtext,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  qrContainer: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  qrImage: {
    width: 180,
    height: 180,
    borderRadius: radii.md,
  },
  qrCaption: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.sm,
  },
  claimForm: {
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  inputLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.bg,
  },
  inputHelp: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    lineHeight: 14,
  },
  claimButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    gap: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  claimButtonText: {
    ...typography.bodySemibold,
  },
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  successIconCircle: {
    width: 88,
    height: 88,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  successTitle: {
    ...typography.h1,
    color: colors.text,
    textAlign: 'center',
  },
  successSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 22,
    maxWidth: 320,
  },
  boldText: {
    fontWeight: '700',
    color: colors.text,
  },
  verificationNoteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.platformSubtle,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
    marginVertical: spacing.xl,
    maxWidth: 340,
  },
  verificationNoteText: {
    ...typography.subtext,
    color: colors.platformDark,
    flex: 1,
    lineHeight: 18,
  },
  doneButton: {
    width: '100%',
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    alignItems: 'center',
  },
  doneButtonText: {
    ...typography.bodySemibold,
  },
});

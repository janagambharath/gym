import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
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
import { formatGymDate } from '../utils/gymTime';
import {
  MembershipPlan,
  PaymentInfo,
  RenewalDemand,
  RootStackParamList,
  UPIPaymentSession,
} from '../types';
import { colors, radii, spacing, typography } from '../theme/tokens';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RenewRouteProp = RouteProp<RootStackParamList, 'Renew'>;

export const RenewScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RenewRouteProp>();
  const { theme } = useBranding();

  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
  const [activeDemand, setActiveDemand] = useState<RenewalDemand | null>(null);
  // V12-M3: a failed dashboard fetch used to silently hide the gym's
  // discounted demand, so the member renewed at full price with no
  // error and no retry. Track it so the screen can say so + retry.
  const [demandError, setDemandError] = useState(false);
  // V12-M4: plans/payment-info failures used to be swallowed (.catch(() =>
  // [])), so a transient failure was indistinguishable from a genuinely
  // plan-less gym and the screen offered a "Pay ₹0" CTA. Track load
  // failure separately from a genuinely-empty plan list.
  const [loadError, setLoadError] = useState<string | null>(null);
  // V12-L8: claim-status poll cap (30 attempts, ~2 min, with backoff).
  const [pollExpired, setPollExpired] = useState(false);
  const [pollRound, setPollRound] = useState(0);
  const pollAttempts = useRef(0);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(route.params?.initialPlanId || null);
  const [reference, setReference] = useState('');
  const [loading, setLoading] = useState(true);

  // In-flight UPI states
  const [initiatingUpi, setInitiatingUpi] = useState(false);
  const [upiSession, setUpiSession] = useState<UPIPaymentSession | null>(null);
  const [confirmingUpi, setConfirmingUpi] = useState(false);
  const [confirmedSuccess, setConfirmedSuccess] = useState<any>(null);

  // Manual claim states
  const [submittingClaim, setSubmittingClaim] = useState(false);
  const [claimedSuccess, setClaimedSuccess] = useState(false);
  const [claimedData, setClaimedData] = useState<any>(null);

  // V11-M11: a paused member's dates extend on verify but the door stays
  // blocked — re-fetch status after a verified renewal and say so.
  const [pausedAfterRenew, setPausedAfterRenew] = useState(false);
  const checkPausedAfterRenew = useCallback(async () => {
    try {
      const dash = await apiClient.getDashboard();
      if (dash.member?.status?.toLowerCase() === 'paused') setPausedAfterRenew(true);
    } catch {
      // Best-effort: a failed re-fetch must not hide the success screen.
    }
  }, []);

  const handleAskResumeCall = useCallback(() => {
    const phone = theme.phone;
    if (phone) {
      void Linking.openURL(`tel:${phone.replace(/\s+/g, '')}`);
    } else {
      Alert.alert('Not Available', 'No contact phone number is configured for this gym.');
    }
  }, [theme.phone]);

  const handleAskResumeWhatsApp = useCallback(() => {
    const wa = theme.whatsapp || theme.phone;
    if (wa) {
      const clean = wa.replace(/\D/g, '');
      const num = clean.startsWith('91') ? clean : `91${clean}`;
      void Linking.openURL(
        `https://wa.me/${num}?text=${encodeURIComponent(`Hi ${theme.gymName}, I just renewed my membership but my door access is still paused. Could you please resume it?`)}`,
      );
    } else {
      Alert.alert('Not Available', 'No WhatsApp number is configured for this gym.');
    }
  }, [theme.whatsapp, theme.phone, theme.gymName]);

  // UI helpers
  const [copiedUpi, setCopiedUpi] = useState(false);
  const [showManualSection, setShowManualSection] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setDemandError(false);
    try {
      const [dashRes, plansRes, infoRes] = await Promise.all([
        apiClient.getDashboard().catch(() => null),
        apiClient.getPlans().catch(() => null),
        apiClient.getPaymentInfo().catch(() => null),
      ]);

      // V12-M3: a null dashboard means the demand leg failed — the
      // discounted offer may exist but is not shown. Never silently
      // render full-price plans as if that were the whole story.
      if (!dashRes) {
        setDemandError(true);
      } else if (dashRes.active_renewal_demand) {
        setActiveDemand(dashRes.active_renewal_demand);
        if (dashRes.active_renewal_demand.plan_id) {
          setSelectedPlanId(dashRes.active_renewal_demand.plan_id);
        }
      }

      // V12-M4: a failed plans/payment-info leg is an error state, not
      // an empty gym. Do not render the pay CTA until these answer.
      if (plansRes === null || infoRes === null) {
        setLoadError('Could not load renewal details. Check your connection and try again.');
        return;
      }

      setPlans(plansRes);
      setPaymentInfo(infoRes);

      if (plansRes.length > 0 && !route.params?.initialPlanId && !dashRes?.active_renewal_demand) {
        setSelectedPlanId(plansRes[0].id);
      }
    } catch (err: any) {
      setLoadError(err.message || 'Unable to load payment details.');
    } finally {
      setLoading(false);
    }
  }, [route.params?.initialPlanId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const selectedPlan = plans.find((p) => p.id === selectedPlanId) || plans[0];

  // Active demand takes strict precedence: amount is authoritative & locked!
  const isDemandLocked = Boolean(activeDemand);
  const payableAmount = activeDemand
    ? activeDemand.final_payable || activeDemand.amount
    : selectedPlan?.price || '0';
  const standardPrice = activeDemand
    ? activeDemand.standard_price
    : selectedPlan?.price || '0';
  const savingsAmount = activeDemand ? activeDemand.savings : '0.00';
  const hasSavings = parseFloat(savingsAmount || '0') > 0;
  const planDisplayName = activeDemand
    ? activeDemand.plan_name
    : selectedPlan?.name || 'Membership Renewal';

  const handleCopyUpi = () => {
    setCopiedUpi(true);
    setTimeout(() => setCopiedUpi(false), 2500);
  };

  // Automated 1-Tap UPI Launch
  const handleLaunchUpi = async () => {
    if (initiatingUpi) return;
    setInitiatingUpi(true);
    try {
      const planId = activeDemand?.plan_id || selectedPlan?.id;
      const session = await apiClient.initiateUpiRenewal(planId);
      setUpiSession(session);

      // Attempt native UPI intent trigger
      const canOpen = await Linking.canOpenURL(session.upi_intent_uri).catch(() => false);
      if (canOpen) {
        await Linking.openURL(session.upi_intent_uri);
      } else {
        // Direct open fallback
        await Linking.openURL(session.upi_intent_uri).catch(() => {
          Alert.alert(
            'UPI App Not Found',
            `No compatible UPI app detected. You can scan the QR code or pay manually to ${session.upi_id}.`,
          );
        });
      }
    } catch (err: any) {
      Alert.alert('Unable to Start UPI', err.message || 'Please try again or use manual QR payment.');
    } finally {
      setInitiatingUpi(false);
    }
  };

  // Confirming UPI settlement after user returns from UPI app
  const handleVerifySettlement = async () => {
    if (confirmingUpi || !upiSession) return;
    setConfirmingUpi(true);
    try {
      const res = await apiClient.confirmUpiPayment(upiSession.payment_id, upiSession.reference);
      if (res.status === 'verified') {
        setConfirmedSuccess(res);
        setUpiSession(null);
        void checkPausedAfterRenew();
      } else {
        // Payment is in pending verification state (awaiting gym desk/soundbox confirmation)
        setClaimedData({
          payment_id: res.payment_id,
          amount: res.amount_paid,
          plan_name: res.plan_name,
          status: 'pending',
          already_pending: false,
        });
        setClaimedSuccess(true);
        setUpiSession(null);
        // V12-M5: the pending-claim screen (State 3) needs the paused
        // warning too, not only the verified paths.
        void checkPausedAfterRenew();
      }
    } catch (err: any) {
      Alert.alert(
        'Payment Not Confirmed Yet',
        err.message || 'We could not confirm the bank transaction yet. If money was debited, you can enter the UTR reference below or try again.',
      );
    } finally {
      setConfirmingUpi(false);
    }
  };

  // Live polling while awaiting staff verification
  // V12-L8: the old 4s setInterval polled forever on a stuck claim.
  // Cap at 30 attempts (~2 min) with backoff (4s → 12s max), then show
  // "still processing — check back later" with a manual re-check
  // instead of polling indefinitely.
  useEffect(() => {
    if (!claimedSuccess || !claimedData?.payment_id) return;
    let isSubscribed = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    pollAttempts.current = 0;
    setPollExpired(false);
    const poll = (delay: number) => {
      timer = setTimeout(async () => {
        if (!isSubscribed) return;
        pollAttempts.current += 1;
        try {
          const res = await apiClient.getPaymentStatus(claimedData.payment_id);
          if (!isSubscribed) return;
          if (res.is_verified) {
            setConfirmedSuccess({
              payment_id: res.payment_id,
              amount_paid: res.amount,
              new_end: res.new_end || undefined,
              plan_name: claimedData.plan_name || undefined,
              status: 'verified',
            });
            setClaimedSuccess(false);
            void checkPausedAfterRenew();
            return;
          }
        } catch {
          // Silently retry next poll
        }
        if (!isSubscribed) return;
        if (pollAttempts.current >= 30) {
          setPollExpired(true);
          return;
        }
        poll(Math.min(Math.round(delay * 1.25), 12000));
      }, delay);
    };
    poll(4000);

    return () => {
      isSubscribed = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [claimedSuccess, claimedData?.payment_id, pollRound]);

  // V12-L8: one manual re-check after the poll cap, restarting the
  // bounded poll if the claim is still pending.
  const handleRecheckClaim = useCallback(async () => {
    if (!claimedData?.payment_id) return;
    try {
      const res = await apiClient.getPaymentStatus(claimedData.payment_id);
      if (res.is_verified) {
        setConfirmedSuccess({
          payment_id: res.payment_id,
          amount_paid: res.amount,
          new_end: res.new_end || undefined,
          plan_name: claimedData.plan_name || undefined,
          status: 'verified',
        });
        setClaimedSuccess(false);
        void checkPausedAfterRenew();
        return;
      }
    } catch {
      // Still unknown — restart the bounded poll below regardless.
    }
    setPollExpired(false);
    setPollRound((round) => round + 1);
  }, [claimedData?.payment_id, claimedData?.plan_name, checkPausedAfterRenew]);

  // Cancel/abort current in-flight UPI session
  const handleCancelUpiSession = async () => {
    if (upiSession) {
      void apiClient.failUpiPayment(upiSession.payment_id);
      setUpiSession(null);
    }
  };

  // Manual Reference Claim Submission (Fallback)
  const handleClaimPayment = async () => {
    if (submittingClaim) return;
    setSubmittingClaim(true);
    try {
      const planId = activeDemand?.plan_id || selectedPlan?.id;
      const res = await apiClient.claimPayment(planId, reference.trim());
      setClaimedData(res);
      setClaimedSuccess(true);
      // V12-M5: check the paused state at claim time — State 3 (manual
      // claim pending) must warn a paused member the door stays blocked,
      // the same warning web shows (vynla.js:664-670).
      void checkPausedAfterRenew();
    } catch (err: any) {
      Alert.alert('Unable to Submit Claim', err.message || 'Please try again.');
    } finally {
      setSubmittingClaim(false);
    }
  };

  // V12-L4: renewal dates render in gym time, not device-local time.
  const formatDate = (iso: string | null | undefined) => formatGymDate(iso);

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={styles.loadingText}>Fetching renewal invoice & plans...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // V12-M4: a plans/payment-info leg failed — error + retry, never the
  // pay CTA (a failed fetch must not look like a plan-less gym, and a
  // plan-less gym must never show "Pay ₹0").
  if (loadError) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContainer}>
          <Ionicons name="alert-circle" size={48} color={colors.expired} />
          <Text style={styles.loadErrorTitle}>Couldn’t load renewal details</Text>
          <Text style={styles.loadErrorText}>{loadError}</Text>
          <TouchableOpacity
            style={[styles.primaryCtaBtn, { backgroundColor: theme.primary, width: '80%' }]}
            onPress={() => void loadData()}
            activeOpacity={0.85}
          >
            <Text style={[styles.primaryCtaBtnText, { color: theme.primaryText }]}>Try again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.textLinkBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.textLinkBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // State 1: Automated UPI Verification Success Celebration
  if (confirmedSuccess) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.celebrationContainer} showsVerticalScrollIndicator={false}>
          <View style={[styles.successIconCircle, { backgroundColor: '#DCFCE7' }]}>
            <Ionicons name="checkmark-circle" size={56} color="#16A34A" />
          </View>
          <Text style={styles.successTitle}>Membership Renewed!</Text>
          <Text style={styles.successSubtitle}>
            Your payment of <Text style={styles.boldText}>₹{confirmedSuccess.amount_paid}</Text> has been verified and settled instantly.
          </Text>

          {/* V11-M11: a paused member's renewal is recorded but the door
              stays blocked until the gym resumes the membership. */}
          {pausedAfterRenew ? (
            <View style={styles.pausedNoticeCard}>
              <View style={styles.pausedNoticeHeader}>
                <Ionicons name="pause-circle" size={22} color={colors.expiring} />
                <Text style={styles.pausedNoticeTitle}>Door access is still paused</Text>
              </View>
              <Text style={styles.pausedNoticeText}>
                Your renewal is recorded and your membership dates are extended, but door access stays paused until the gym resumes it.
              </Text>
              <View style={styles.resumeRow}>
                <TouchableOpacity
                  style={[styles.resumeButton, { backgroundColor: theme.primary }]}
                  onPress={handleAskResumeCall}
                  activeOpacity={0.85}
                >
                  <Ionicons name="call" size={16} color={theme.primaryText} />
                  <Text style={[styles.resumeButtonText, { color: theme.primaryText }]}>Call gym to resume</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.resumeButton, styles.resumeButtonOutline]}
                  onPress={handleAskResumeWhatsApp}
                  activeOpacity={0.85}
                >
                  <Ionicons name="logo-whatsapp" size={16} color={colors.whatsapp} />
                  <Text style={[styles.resumeButtonText, { color: colors.whatsapp }]}>WhatsApp gym</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {/* Receipt Breakdown Card */}
          <View style={styles.receiptCard}>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Plan</Text>
              <Text style={styles.receiptValue}>{confirmedSuccess.plan_name || planDisplayName}</Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Valid Through</Text>
              <Text style={[styles.receiptValue, styles.highlightGreen]}>
                {formatDate(confirmedSuccess.new_end)}
              </Text>
            </View>
            {hasSavings ? (
              <View style={styles.receiptRow}>
                <Text style={styles.receiptLabel}>Total Savings</Text>
                <Text style={[styles.receiptValue, styles.highlightGreen]}>₹{savingsAmount}</Text>
              </View>
            ) : null}
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Reference / UTR</Text>
              <Text style={styles.receiptValue}>{confirmedSuccess.reference || 'Bank Verified'}</Text>
            </View>
            <View style={[styles.receiptRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.receiptLabel}>Gym</Text>
              <Text style={styles.receiptValue}>{theme.gymName}</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.primaryCtaBtn, { backgroundColor: theme.primary }]}
            onPress={() => navigation.navigate('MainTabs')}
            activeOpacity={0.85}
          >
            <Text style={[styles.primaryCtaBtnText, { color: theme.primaryText }]}>Go to Dashboard</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // State 2: In-Flight UPI Verification Modal / Screen
  if (upiSession) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.inFlightContainer}>
          <View style={styles.inFlightPulseBox}>
            <ActivityIndicator size="large" color={theme.primary} />
          </View>

          <Text style={styles.inFlightTitle}>Waiting for UPI Settlement</Text>
          <Text style={styles.inFlightSubtitle}>
            Please complete the payment of <Text style={styles.boldText}>₹{upiSession.payable_amount}</Text> in your UPI app.
          </Text>

          <View style={styles.upiRefBadge}>
            <Text style={styles.upiRefBadgeText}>Ref: {upiSession.reference}</Text>
          </View>

          <View style={styles.inFlightActions}>
            <TouchableOpacity
              style={[styles.primaryCtaBtn, { backgroundColor: theme.primary }]}
              onPress={() => void handleVerifySettlement()}
              disabled={confirmingUpi}
              activeOpacity={0.85}
            >
              {confirmingUpi ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="checkmark-done" size={20} color={theme.primaryText} />
                  <Text style={[styles.primaryCtaBtnText, { color: theme.primaryText }]}>
                    I've Completed Payment
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryCtaBtn, { borderColor: colors.border }]}
              onPress={() => void Linking.openURL(upiSession.upi_intent_uri)}
              activeOpacity={0.85}
            >
              <Ionicons name="open-outline" size={18} color={colors.text} />
              <Text style={styles.secondaryCtaBtnText}>Re-open UPI App</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.textLinkBtn}
              onPress={() => void handleCancelUpiSession()}
            >
              <Text style={styles.textLinkBtnText}>Cancel & Choose Another Method</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // State 3: Manual Claim Pending Confirmation
  if (claimedSuccess) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.successContainer}>
          <View style={[styles.successIconCircle, { backgroundColor: colors.expiringSurface }]}>
            <Ionicons name="hourglass" size={48} color={colors.expiring} />
          </View>
          <Text style={styles.successTitle}>
            {claimedData?.already_pending ? 'Payment Already Pending' : 'Payment Claim Submitted'}
          </Text>
          <Text style={styles.successSubtitle}>
            {claimedData?.already_pending ? (
              <>
                You already have a pending request for{' '}
                <Text style={styles.boldText}>₹{claimedData?.amount || payableAmount}</Text> for{' '}
                <Text style={styles.boldText}>{planDisplayName}</Text> — the gym will confirm it.
              </>
            ) : (
              <>
                Your payment submission of ₹{claimedData?.amount || payableAmount} for{' '}
                <Text style={styles.boldText}>{planDisplayName}</Text> has been sent to{' '}
                <Text style={styles.boldText}>{theme.gymName}</Text>.
              </>
            )}
          </Text>

          <View style={styles.verificationNoteCard}>
            <ActivityIndicator size="small" color={colors.platform} style={{ marginRight: 8 }} />
            <Text style={styles.verificationNoteText}>
              {pollExpired
                ? 'Still processing — the gym hasn’t confirmed this payment yet. Check back later, or tap below to check the status now.'
                : 'Awaiting verification from gym counter. This screen will update automatically as soon as payment is confirmed.'}
            </Text>
          </View>

          {/* V12-L8: the bounded poll gave up — offer one manual re-check. */}
          {pollExpired ? (
            <TouchableOpacity
              style={[styles.secondaryCtaBtn, { borderColor: theme.primary, marginBottom: spacing.md }]}
              onPress={() => void handleRecheckClaim()}
              activeOpacity={0.85}
            >
              <Ionicons name="refresh" size={18} color={theme.primary} />
              <Text style={[styles.secondaryCtaBtnText, { color: theme.primary }]}>Check status now</Text>
            </TouchableOpacity>
          ) : null}

          {/* V12-M5: a paused member's renewal is recorded but the door
              stays blocked until the gym resumes it — same warning as
              the verified screen (State 1) and web (vynla.js:664-670). */}
          {pausedAfterRenew ? (
            <View style={[styles.pausedNoticeCard, { marginTop: 0, marginBottom: spacing.xl }]}>
              <View style={styles.pausedNoticeHeader}>
                <Ionicons name="pause-circle" size={22} color={colors.expiring} />
                <Text style={styles.pausedNoticeTitle}>Door access is still paused</Text>
              </View>
              <Text style={styles.pausedNoticeText}>
                Your renewal is recorded and your membership dates are extended, but door access stays paused until the gym resumes it.
              </Text>
              <View style={styles.resumeRow}>
                <TouchableOpacity
                  style={[styles.resumeButton, { backgroundColor: theme.primary }]}
                  onPress={handleAskResumeCall}
                  activeOpacity={0.85}
                >
                  <Ionicons name="call" size={16} color={theme.primaryText} />
                  <Text style={[styles.resumeButtonText, { color: theme.primaryText }]}>Call gym to resume</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.resumeButton, styles.resumeButtonOutline]}
                  onPress={handleAskResumeWhatsApp}
                  activeOpacity={0.85}
                >
                  <Ionicons name="logo-whatsapp" size={16} color={colors.whatsapp} />
                  <Text style={[styles.resumeButtonText, { color: colors.whatsapp }]}>WhatsApp gym</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.primaryCtaBtn, { backgroundColor: theme.primary }]}
            onPress={() => navigation.navigate('MainTabs')}
            activeOpacity={0.85}
          >
            <Text style={[styles.primaryCtaBtnText, { color: theme.primaryText }]}>Back to Home</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // V12-M4: genuinely no plans and no demand — say so with NO pay
  // button and no manual-claim path (a ₹0 claim must never be mintable
  // from a plan-less gym). Mirrors web vynla.js, which renders no pay
  // section when there are no plans.
  if (!isDemandLocked && plans.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContainer}>
          <Ionicons name="information-circle" size={48} color={colors.textSecondary} />
          <Text style={styles.loadErrorTitle}>No renewal plans are available</Text>
          <Text style={styles.loadErrorText}>Contact your gym to renew your membership.</Text>
          <TouchableOpacity style={styles.textLinkBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.textLinkBtnText}>Back</Text>
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

          {/* V12-M3: the dashboard leg failed, so the gym's discounted
              offer may be hidden — warn + offer a retry instead of
              silently showing full-price plans. Renewing is not blocked. */}
          {demandError && !isDemandLocked ? (
            <View style={styles.demandErrorCard}>
              <Ionicons name="alert-circle" size={20} color={colors.expiring} />
              <View style={styles.demandErrorBody}>
                <Text style={styles.demandErrorTitle}>Couldn’t load your gym’s offer</Text>
                <Text style={styles.demandErrorText}>
                  Your gym may have a discounted renewal price that isn’t shown here. Retry before paying full price.
                </Text>
              </View>
              <TouchableOpacity onPress={() => void loadData()} style={styles.demandErrorRetry}>
                <Text style={styles.demandErrorRetryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Special Authoritative Price Invoice Card (if active demand exists) */}
          {isDemandLocked ? (
            <View style={styles.specialOfferCard}>
              <View style={styles.specialOfferHeader}>
                <View style={styles.specialOfferBadge}>
                  <Ionicons name="sparkles" size={14} color="#D97706" />
                  <Text style={styles.specialOfferBadgeText}>SPECIAL RENEWAL OFFER</Text>
                </View>
                {hasSavings ? (
                  <View style={styles.savingsPill}>
                    <Text style={styles.savingsPillText}>SAVE ₹{savingsAmount}</Text>
                  </View>
                ) : null}
              </View>

              <Text style={styles.specialOfferPlanName}>{planDisplayName}</Text>
              <Text style={styles.specialOfferDuration}>
                {activeDemand?.renewal_days || 30} Days Extended Access
              </Text>

              <View style={styles.pricingLockRow}>
                {hasSavings ? (
                  <Text style={styles.specialOfferStrikethrough}>₹{standardPrice}</Text>
                ) : null}
                <Text style={styles.specialOfferPrice}>₹{payableAmount}</Text>
              </View>

              <Text style={styles.specialOfferNotice}>
                ✓ Authoritative price curated for your renewal by {theme.gymName}. Amount is non-editable.
              </Text>
            </View>
          ) : (
            /* Catalog Plan Selector (if no active gym demand) */
            <View style={styles.stepSection}>
              <Text style={styles.stepTitle}>Choose Membership Plan</Text>
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
          )}

          {/* Primary Automated UPI Payment Card */}
          <View style={styles.stepSection}>
            <View style={styles.upiActionCard}>
              <View style={styles.upiActionHeader}>
                <Ionicons name="flash" size={22} color="#4F46E5" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.upiActionTitle}>Instant UPI Renewal</Text>
                  <Text style={styles.upiActionSubtitle}>
                    Google Pay · PhonePe · Paytm · BHIM
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={[
                  styles.primaryCtaBtn,
                  { backgroundColor: theme.primary },
                  initiatingUpi && styles.buttonDisabled,
                ]}
                onPress={() => void handleLaunchUpi()}
                disabled={initiatingUpi}
                activeOpacity={0.85}
              >
                {initiatingUpi ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="wallet-outline" size={20} color={theme.primaryText} />
                    <Text style={[styles.primaryCtaBtnText, { color: theme.primaryText }]}>
                      Pay ₹{payableAmount} via UPI App
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              <Text style={styles.secureNotice}>
                🔒 Membership extends automatically immediately upon bank settlement.
              </Text>
            </View>
          </View>

          {/* Manual QR / UTR Fallback Toggle */}
          <TouchableOpacity
            style={styles.toggleFallbackRow}
            onPress={() => setShowManualSection(!showManualSection)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={showManualSection ? 'chevron-up-circle' : 'qr-code-outline'}
              size={18}
              color={colors.textSecondary}
            />
            <Text style={styles.toggleFallbackText}>
              {showManualSection
                ? 'Hide Manual QR Code & UTR Entry'
                : 'Paying with another device? Scan QR or Enter UTR'}
            </Text>
          </TouchableOpacity>

          {/* Manual QR & Claim Section (Shown when expanded) */}
          {showManualSection && (
            <View style={styles.manualSectionContainer}>
              {/* Gym UPI Details */}
              <View style={styles.paymentCard}>
                <Text style={styles.paymentLabel}>PAY DIRECTLY TO</Text>
                <Text style={styles.gymPayeeName}>{theme.gymName}</Text>

                {paymentInfo?.upi_id ? (
                  <View style={styles.upiContainer}>
                    <View style={styles.upiRow}>
                      <View style={styles.upiInfo}>
                        <Text style={styles.upiSublabel}>UPI ID / VPA</Text>
                        <Text style={styles.upiIdText}>{paymentInfo.upi_id}</Text>
                      </View>
                      <TouchableOpacity style={styles.copyButton} onPress={handleCopyUpi}>
                        <Ionicons
                          name={copiedUpi ? 'checkmark-circle' : 'copy-outline'}
                          size={18}
                          color={copiedUpi ? colors.active : colors.platform}
                        />
                        <Text style={[styles.copyButtonText, copiedUpi && { color: colors.active }]}>
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
                    <Text style={styles.qrCaption}>Scan with any UPI app to pay ₹{payableAmount}</Text>
                  </View>
                ) : null}
              </View>

              {/* Manual Claim Form */}
              <View style={styles.claimForm}>
                <Text style={styles.inputLabel}>UPI Reference / UTR ID</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 423985729103"
                  placeholderTextColor={colors.muted}
                  value={reference}
                  onChangeText={setReference}
                />
                <Text style={styles.inputHelp}>
                  Entering your 12-digit UTR helps gym staff verify and approve your payment quickly.
                </Text>

                <TouchableOpacity
                  style={[
                    styles.secondaryCtaBtn,
                    { borderColor: theme.primary },
                    submittingClaim && styles.buttonDisabled,
                  ]}
                  onPress={handleClaimPayment}
                  disabled={submittingClaim}
                  activeOpacity={0.85}
                >
                  {submittingClaim ? (
                    <ActivityIndicator color={theme.primary} />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle-outline" size={18} color={theme.primary} />
                      <Text style={[styles.secondaryCtaBtnText, { color: theme.primary }]}>
                        Submit Claim (₹{payableAmount})
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  boldText: {
    color: colors.text,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  celebrationContainer: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  centerContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  claimForm: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radii.xl,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  closeButton: {
    padding: spacing.xs,
  },
  copyButton: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  copyButtonText: {
    ...typography.caption,
    color: colors.platform,
    fontWeight: '600',
  },
  gymPayeeName: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.md,
    marginTop: 2,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  headerTitle: {
    ...typography.h2,
    color: colors.text,
  },
  highlightGreen: {
    color: '#16A34A',
  },
  inFlightActions: {
    gap: spacing.md,
    marginTop: spacing.xl,
    width: '100%',
  },
  inFlightContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  inFlightPulseBox: {
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    borderRadius: radii.full,
    height: 84,
    justifyContent: 'center',
    marginBottom: spacing.lg,
    width: 84,
  },
  inFlightSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  inFlightTitle: {
    ...typography.h2,
    color: colors.text,
    textAlign: 'center',
  },
  input: {
    ...typography.body,
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1.5,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  inputHelp: {
    ...typography.caption,
    color: colors.muted,
    lineHeight: 14,
    marginBottom: spacing.lg,
    marginTop: spacing.xs,
  },
  inputLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  instructionsText: {
    ...typography.subtext,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  keyboardContainer: {
    flex: 1,
  },
  loadingText: {
    ...typography.subtext,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  manualSectionContainer: {
    marginTop: spacing.md,
  },
  paymentCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radii.xl,
    borderWidth: 1,
    padding: spacing.lg,
  },
  paymentLabel: {
    ...typography.caption,
    color: colors.muted,
    letterSpacing: 0.8,
  },
  planCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radii.xl,
    borderWidth: 1.5,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.lg,
  },
  planCardLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  planCardSelected: {
    backgroundColor: '#F8FAFC',
  },
  planDuration: {
    ...typography.subtext,
    color: colors.textSecondary,
    marginTop: 2,
  },
  planList: {
    gap: spacing.sm,
  },
  planName: {
    ...typography.bodySemibold,
    color: colors.text,
  },
  planPrice: {
    ...typography.h3,
    color: colors.text,
  },
  pricingLockRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  primaryCtaBtn: {
    alignItems: 'center',
    borderRadius: radii.lg,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingVertical: spacing.md,
    width: '100%',
  },
  primaryCtaBtnText: {
    ...typography.bodySemibold,
    fontSize: 16,
  },
  qrCaption: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.sm,
  },
  qrContainer: {
    alignItems: 'center',
    borderTopColor: colors.borderSubtle,
    borderTopWidth: 1,
    paddingVertical: spacing.md,
  },
  qrImage: {
    borderRadius: radii.md,
    height: 170,
    width: 170,
  },
  radioCircle: {
    alignItems: 'center',
    borderColor: colors.muted,
    borderRadius: radii.full,
    borderWidth: 2,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  radioDot: {
    borderRadius: radii.full,
    height: 10,
    width: 10,
  },
  radioSelected: {
    borderColor: colors.platform,
  },
  receiptCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radii.xl,
    borderWidth: 1,
    marginVertical: spacing.xl,
    padding: spacing.lg,
    width: '100%',
  },
  receiptRow: {
    borderBottomColor: colors.borderSubtle,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
  },
  receiptLabel: {
    ...typography.subtext,
    color: colors.textSecondary,
  },
  receiptValue: {
    ...typography.bodySemibold,
    color: colors.text,
  },
  safeArea: {
    backgroundColor: colors.bg,
    flex: 1,
  },
  savingsPill: {
    backgroundColor: '#DCFCE7',
    borderRadius: radii.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  savingsPillText: {
    color: '#15803D',
    fontSize: 11,
    fontWeight: '700',
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  secondaryCtaBtn: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingVertical: spacing.md,
    width: '100%',
  },
  secondaryCtaBtnText: {
    ...typography.bodySemibold,
    color: colors.text,
  },
  secureNotice: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  specialOfferBadge: {
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderRadius: radii.sm,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  specialOfferBadgeText: {
    color: '#B45309',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  specialOfferCard: {
    backgroundColor: colors.card,
    borderColor: '#F59E0B',
    borderRadius: radii.xl,
    borderWidth: 1.5,
    marginBottom: spacing.xl,
    padding: spacing.lg,
  },
  specialOfferDuration: {
    ...typography.subtext,
    color: colors.textSecondary,
    marginTop: 2,
  },
  specialOfferHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  specialOfferNotice: {
    ...typography.caption,
    color: colors.muted,
    lineHeight: 16,
    marginTop: spacing.md,
  },
  specialOfferPlanName: {
    ...typography.h2,
    color: colors.text,
  },
  specialOfferPrice: {
    ...typography.h1,
    color: colors.text,
    fontSize: 32,
  },
  specialOfferStrikethrough: {
    ...typography.h3,
    color: colors.muted,
    textDecorationLine: 'line-through',
  },
  stepSection: {
    marginBottom: spacing.lg,
  },
  stepTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.md,
  },
  successContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  successIconCircle: {
    alignItems: 'center',
    borderRadius: radii.full,
    height: 88,
    justifyContent: 'center',
    marginBottom: spacing.lg,
    width: 88,
  },
  successSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
    maxWidth: 320,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  successTitle: {
    ...typography.h1,
    color: colors.text,
    textAlign: 'center',
  },
  // V12-M4: load-failure / no-plans states (error + retry, never a pay CTA).
  loadErrorTitle: {
    ...typography.h2,
    color: colors.text,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  loadErrorText: {
    ...typography.subtext,
    color: colors.textSecondary,
    lineHeight: 18,
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.xl,
    textAlign: 'center',
  },
  // V12-M3: "couldn't load your gym's offer" banner + retry.
  demandErrorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.expiringSurface,
    borderColor: colors.expiringBorder,
    borderRadius: radii.xl,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  demandErrorBody: {
    flex: 1,
  },
  demandErrorTitle: {
    ...typography.bodySemibold,
    color: colors.expiring,
  },
  demandErrorText: {
    ...typography.subtext,
    color: colors.textSecondary,
    lineHeight: 18,
    marginTop: 2,
  },
  demandErrorRetry: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  demandErrorRetryText: {
    ...typography.bodySemibold,
    color: colors.platformDark,
  },
  // V11-M11: paused-after-renew notice + resume actions.
  pausedNoticeCard: {
    backgroundColor: colors.expiringSurface,
    borderColor: colors.expiringBorder,
    borderRadius: radii.xl,
    borderWidth: 1,
    marginTop: spacing.xl,
    padding: spacing.lg,
    width: '100%',
  },
  pausedNoticeHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  pausedNoticeTitle: {
    ...typography.bodySemibold,
    color: colors.expiring,
  },
  pausedNoticeText: {
    ...typography.subtext,
    color: colors.textSecondary,
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  resumeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  resumeButton: {
    alignItems: 'center',
    borderRadius: radii.lg,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    paddingVertical: spacing.sm + 2,
  },
  resumeButtonOutline: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1.5,
  },
  resumeButtonText: {
    ...typography.bodySemibold,
    fontSize: 14,
  },
  textLinkBtn: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  textLinkBtnText: {
    ...typography.caption,
    color: colors.muted,
    textDecorationLine: 'underline',
  },
  toggleFallbackRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    marginTop: spacing.xs,
    paddingVertical: spacing.sm,
  },
  toggleFallbackText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  upiActionCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radii.xl,
    borderWidth: 1,
    padding: spacing.lg,
  },
  upiActionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  upiActionSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 1,
  },
  upiActionTitle: {
    ...typography.bodySemibold,
    color: colors.text,
    fontSize: 16,
  },
  upiContainer: {
    backgroundColor: '#F8FAFC',
    borderColor: colors.borderSubtle,
    borderRadius: radii.lg,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  upiIdText: {
    ...typography.bodySemibold,
    color: colors.text,
    marginTop: 2,
  },
  upiInfo: {
    flex: 1,
  },
  upiRefBadge: {
    backgroundColor: '#F1F5F9',
    borderRadius: radii.full,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  upiRefBadgeText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  upiRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  upiSublabel: {
    ...typography.caption,
    color: colors.muted,
  },
  verificationNoteCard: {
    alignItems: 'center',
    backgroundColor: colors.platformSubtle,
    borderRadius: radii.lg,
    flexDirection: 'row',
    gap: spacing.sm,
    marginVertical: spacing.xl,
    maxWidth: 340,
    padding: spacing.md,
  },
  verificationNoteText: {
    ...typography.subtext,
    color: colors.platformDark,
    flex: 1,
    lineHeight: 18,
  },
});

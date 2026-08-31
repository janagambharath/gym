import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  deepLinkToSubscriptions,
  endConnection,
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  type ProductSubscription,
  type Purchase,
} from 'expo-iap';
import { AppHeader } from '../components/AppHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import {
  BillingCatalogPlan,
  BillingEntitlement,
  getBillingCatalog,
  getBillingEntitlement,
  getGooglePlayPurchaseContext,
  restoreGooglePlayPurchases,
  verifyGooglePlayPurchase,
} from '../services/apiClient';
import { formatDate } from '../types';

type Feedback = { type: 'success' | 'error'; message: string };

const PLAN_DETAILS: Record<string, { tagline: string; features: string[]; recommended?: boolean }> = {
  Starter: {
    tagline: 'Core membership CRM and renewal tracking for small teams.',
    features: ['Member and renewal tracking', 'Payment recording', 'CSV import and export'],
  },
  Growth: {
    tagline: 'Automated reminders and revenue tools for growing gyms.',
    recommended: true,
    features: ['Everything in Starter', 'WhatsApp renewal reminders', 'Revenue reporting'],
  },
  Pro: {
    tagline: 'AI-assisted conversations and lead conversion for larger teams.',
    features: ['Everything in Growth', 'AI receptionist', 'Human takeover controls'],
  },
};

interface SubscriptionScreenProps {
  onBack: () => void;
}

export function SubscriptionScreen({ onBack }: SubscriptionScreenProps) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [entitlement, setEntitlement] = useState<BillingEntitlement | null>(null);
  const [plans, setPlans] = useState<BillingCatalogPlan[]>([]);
  const [storeProducts, setStoreProducts] = useState<ProductSubscription[]>([]);
  const [purchaseContext, setPurchaseContext] = useState<string | null>(null);
  const [storeReady, setStoreReady] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const verifyingTransactions = useRef(new Set<string>());

  const fetchBillingData = useCallback(async () => {
    try {
      const [entitlementResult, catalogResult, contextResult] = await Promise.all([
        getBillingEntitlement(),
        getBillingCatalog(),
        getGooglePlayPurchaseContext(),
      ]);
      if (entitlementResult.ok) {
        setEntitlement(entitlementResult.data);
      } else {
        setFeedback({ type: 'error', message: entitlementResult.error.message });
      }
      if (catalogResult.ok) {
        setPlans(catalogResult.data.plans);
      } else {
        setFeedback({ type: 'error', message: catalogResult.error.message });
      }
      if (contextResult.ok) {
        setPurchaseContext(contextResult.data.obfuscated_account_id);
      } else {
        setFeedback({ type: 'error', message: 'Could not securely prepare Google Play checkout.' });
      }
    } catch {
      setFeedback({ type: 'error', message: 'Failed to load subscription information.' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const handlePurchaseUpdate = useCallback(async (purchase: Purchase) => {
    const transactionKey = purchase.transactionId || purchase.purchaseToken || purchase.productId;
    if (!transactionKey || verifyingTransactions.current.has(transactionKey)) {
      return;
    }
    if (purchase.purchaseState === 'pending') {
      setActionLoading(false);
      setFeedback({ type: 'success', message: 'Purchase is pending. Access will update after Google Play confirms payment.' });
      return;
    }
    if (purchase.purchaseState !== 'purchased' || !purchase.purchaseToken || !purchase.productId) {
      setActionLoading(false);
      setFeedback({ type: 'error', message: 'Google Play did not return a completed subscription purchase.' });
      return;
    }

    verifyingTransactions.current.add(transactionKey);
    setActionLoading(true);
    try {
      const result = await verifyGooglePlayPurchase(purchase.productId, purchase.purchaseToken);
      if (!result.ok) {
        setFeedback({
          type: 'error',
          message: result.error.message || 'Google Play purchase could not be verified. Your entitlement was not changed.',
        });
        return;
      }

      setEntitlement(result.data);
      try {
        await finishTransaction({ purchase, isConsumable: false });
      } catch {
        setFeedback({
          type: 'success',
          message: 'Purchase verified. Google Play acknowledgement will be retried when the app reconnects.',
        });
        return;
      }
      setFeedback({ type: 'success', message: 'Purchase verified. Your subscription is now up to date.' });
    } catch {
      setFeedback({
        type: 'error',
        message: 'Unable to verify this Google Play purchase. Your entitlement has not been changed.',
      });
    } finally {
      verifyingTransactions.current.delete(transactionKey);
      setActionLoading(false);
    }
  }, []);

  useEffect(() => {
    const purchaseSubscription = purchaseUpdatedListener((purchase) => {
      void handlePurchaseUpdate(purchase);
    });
    const errorSubscription = purchaseErrorListener((error) => {
      setActionLoading(false);
      if (error.code !== 'user-cancelled') {
        setFeedback({ type: 'error', message: error.message || 'Google Play could not complete this purchase.' });
      }
    });

    const connectStore = async () => {
      if (Platform.OS !== 'android') {
        return;
      }
      try {
        const connected = await initConnection();
        if (!connected) {
          throw new Error('Google Play Billing is unavailable.');
        }
        setStoreReady(true);
      } catch {
        setStoreReady(false);
        setFeedback({ type: 'error', message: 'Google Play Billing is unavailable on this device.' });
      }
    };

    void connectStore();
    return () => {
      purchaseSubscription.remove();
      errorSubscription.remove();
      void endConnection();
    };
  }, [handlePurchaseUpdate]);

  useEffect(() => {
    if (!storeReady || plans.length === 0) {
      return;
    }
    const loadProducts = async () => {
      try {
        const products = await fetchProducts({ skus: plans.map((plan) => plan.id), type: 'subs' });
        setStoreProducts((products || []) as ProductSubscription[]);
      } catch {
        setFeedback({ type: 'error', message: 'Google Play could not load the subscription products.' });
      }
    };
    void loadProducts();
  }, [plans, storeReady]);

  useEffect(() => {
    const deferredFetch = setTimeout(() => {
      void fetchBillingData();
    }, 0);
    return () => clearTimeout(deferredFetch);
  }, [fetchBillingData]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setFeedback(null);
    void fetchBillingData();
  }, [fetchBillingData]);

  const handleSubscribePlan = async (plan: BillingCatalogPlan) => {
    if (Platform.OS !== 'android') {
      setFeedback({ type: 'error', message: 'Google Play subscriptions are available in the Android app.' });
      return;
    }
    if (!storeReady || !purchaseContext) {
      setFeedback({ type: 'error', message: 'Google Play is not ready. Check your connection and try again.' });
      return;
    }
    const product = storeProducts.find((candidate) => candidate.id === plan.id);
    const offerToken = product?.subscriptionOffers?.find((offer) => Boolean(offer.offerTokenAndroid))?.offerTokenAndroid;
    if (!product || !offerToken) {
      setFeedback({ type: 'error', message: 'This subscription is not currently available from Google Play.' });
      return;
    }

    setFeedback(null);
    setActionLoading(true);
    try {
      await requestPurchase({
        type: 'subs',
        request: {
          google: {
            skus: [plan.id],
            subscriptionOffers: [{ sku: plan.id, offerToken }],
            obfuscatedAccountId: purchaseContext,
          },
        },
      });
    } catch {
      setActionLoading(false);
      setFeedback({ type: 'error', message: 'Google Play could not start this purchase.' });
    }
  };

  const handleRestorePurchases = async () => {
    if (!storeReady) {
      setFeedback({ type: 'error', message: 'Google Play is not ready. Check your connection and try again.' });
      return;
    }
    setFeedback(null);
    setActionLoading(true);
    try {
      const available = await getAvailablePurchases();
      const catalogIds = new Set(plans.map((plan) => plan.id));
      const purchases = available
        .filter((purchase) => Boolean(purchase.productId && purchase.purchaseToken && catalogIds.has(purchase.productId)))
        .slice(0, 10)
        .map((purchase) => ({ product_id: purchase.productId, purchase_token: purchase.purchaseToken as string }));
      if (purchases.length === 0) {
        setFeedback({ type: 'error', message: 'No eligible Google Play subscription was found for this account.' });
        return;
      }
      const result = await restoreGooglePlayPurchases(purchases);
      if (!result.ok) {
        setFeedback({ type: 'error', message: result.error.message || 'No subscription could be restored.' });
        return;
      }
      setEntitlement(result.data);
      for (const purchase of available) {
        if (purchase.productId && purchase.purchaseToken && catalogIds.has(purchase.productId)) {
          try {
            await finishTransaction({ purchase, isConsumable: false });
          } catch {
            // The server has verified entitlement. Native acknowledgement can retry on the next app launch.
          }
        }
      }
      Alert.alert('Purchases Restored', 'Your Google Play subscription has been verified and restored.');
    } catch {
      setFeedback({ type: 'error', message: 'Failed to query existing Google Play purchases.' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleManageSubscription = async () => {
    if (!entitlement?.plan_id) {
      return;
    }
    try {
      await deepLinkToSubscriptions({
        skuAndroid: entitlement.plan_id,
        packageNameAndroid: 'online.revorax.renewaldesk',
      });
    } catch {
      setFeedback({ type: 'error', message: 'Could not open Google Play subscription management.' });
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <AppHeader title="Subscription & Billing" onBack={onBack} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      </View>
    );
  }

  const isManual = entitlement?.billing_source === 'MANUAL';
  const status = entitlement?.subscription_status || 'TRIAL';

  return (
    <View style={styles.container}>
      <AppHeader title="Subscription & Billing" onBack={onBack} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {feedback && (
          <View accessibilityLiveRegion="polite" style={[styles.feedbackBanner, feedback.type === 'success' ? styles.feedbackSuccess : styles.feedbackError]}>
            <Icon name={feedback.type === 'success' ? 'checkmark' : 'alert'} size={18} color={feedback.type === 'success' ? colors.success : colors.critical} />
            <Text style={[styles.feedbackText, feedback.type === 'success' ? styles.feedbackTextSuccess : styles.feedbackTextError]}>{feedback.message}</Text>
          </View>
        )}

        <View style={styles.currentPlanCard}>
          <View style={styles.currentPlanHeader}>
            <View>
              <Text style={styles.currentPlanLabel}>Current Plan</Text>
              <Text style={styles.currentPlanName}>{entitlement?.plan_name || 'Trial'}</Text>
            </View>
            <StatusBadge status={status} />
          </View>
          <View style={styles.planDetailsGrid}>
            <View style={styles.planDetailItem}>
              <Text style={styles.planDetailLabel}>Billing Source</Text>
              <View style={styles.billingSourceTag}>
                <Icon name={isManual ? 'person' : 'wallet'} size={14} color={isManual ? colors.brand : colors.success} />
                <Text style={styles.billingSourceText}>{isManual ? 'Founder / Concierge' : 'Google Play Store'}</Text>
              </View>
            </View>
            <View style={styles.planDetailItem}>
              <Text style={styles.planDetailLabel}>Renews / Expires</Text>
              <Text style={styles.planDetailValue}>{formatDate(entitlement?.renews_at || entitlement?.expires_at)}</Text>
            </View>
          </View>
          {isManual ? (
            <View style={styles.manualNotice}>
              <Icon name="info" size={16} color={colors.brand} />
              <Text style={styles.manualNoticeText}>Your account is managed directly. No Google Play charge will be created.</Text>
            </View>
          ) : (
            <View style={styles.playActionRow}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Restore Google Play purchases" style={styles.restoreButton} onPress={handleRestorePurchases} disabled={actionLoading}>
                <Icon name="retry" size={16} color={colors.textSecondary} />
                <Text style={styles.restoreButtonText}>Restore Purchases</Text>
              </TouchableOpacity>
              {entitlement?.purchase_management_available && (
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Manage Google Play subscription" style={styles.restoreButton} onPress={handleManageSubscription} disabled={actionLoading}>
                  <Icon name="wallet" size={16} color={colors.textSecondary} />
                  <Text style={styles.restoreButtonText}>Manage in Play</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        {!isManual && (
          <>
            <Text style={styles.catalogSectionTitle}>Choose Your Plan</Text>
            <Text style={styles.catalogSectionSubtitle}>Prices and eligibility are loaded directly from Google Play.</Text>
            {plans.map((plan) => {
              const detail = PLAN_DETAILS[plan.name] || { tagline: '', features: [] };
              const product = storeProducts.find((candidate) => candidate.id === plan.id);
              const isCurrentPlan = plan.id === entitlement?.plan_id;
              const isAvailable = Boolean(product?.subscriptionOffers?.some((offer) => offer.offerTokenAndroid));
              return (
                <View key={plan.id} style={[styles.planCard, detail.recommended && styles.planCardRecommended, isCurrentPlan && styles.planCardActive]}>
                  {detail.recommended && <View style={styles.recommendedBadge}><Text style={styles.recommendedBadgeText}>MOST POPULAR</Text></View>}
                  <View style={styles.planCardHeader}>
                    <View style={styles.planTextColumn}>
                      <Text style={styles.planTitle}>{plan.name}</Text>
                      <Text style={styles.planTagline}>{detail.tagline}</Text>
                    </View>
                    <Text style={styles.priceAmount}>{product?.displayPrice || 'Unavailable'}</Text>
                  </View>
                  <View style={styles.featureDivider} />
                  {detail.features.map((feature) => (
                    <View key={feature} style={styles.featureRow}><Icon name="checkmark" size={16} color={colors.success} /><Text style={styles.featureText}>{feature}</Text></View>
                  ))}
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={isCurrentPlan ? `${plan.name} is the current plan` : `Subscribe to ${plan.name}`}
                    accessibilityHint={isCurrentPlan ? undefined : 'Opens the Google Play purchase screen'}
                    style={[styles.subscribeButton, detail.recommended && styles.subscribeButtonRecommended, isCurrentPlan && styles.subscribeButtonActive, (!isAvailable || actionLoading) && styles.buttonDisabled]}
                    onPress={() => handleSubscribePlan(plan)}
                    disabled={!isAvailable || actionLoading || isCurrentPlan}
                  >
                    {actionLoading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={[styles.subscribeButtonText, isCurrentPlan && styles.subscribeButtonTextActive]}>{isCurrentPlan ? 'Current Plan' : isAvailable ? `Choose ${plan.name}` : 'Unavailable in Play'}</Text>}
                  </TouchableOpacity>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.xxl },
  feedbackBanner: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.md },
  feedbackSuccess: { backgroundColor: colors.successSurface },
  feedbackError: { backgroundColor: colors.criticalSurface },
  feedbackText: { fontSize: fontSize.sm, marginLeft: spacing.sm, flex: 1 },
  feedbackTextSuccess: { color: colors.success },
  feedbackTextError: { color: colors.critical },
  currentPlanCard: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg, ...shadows.sm, borderWidth: 1, borderColor: colors.border },
  currentPlanHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.md },
  currentPlanLabel: { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: fontWeight.semibold },
  currentPlanName: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text, marginTop: spacing.xs },
  planDetailsGrid: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.borderLight },
  planDetailItem: { flex: 1 },
  planDetailLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  billingSourceTag: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs },
  billingSourceText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text, marginLeft: spacing.xs },
  planDetailValue: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text, marginTop: spacing.xs },
  manualNotice: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.brandSubtle, padding: spacing.md, borderRadius: radius.md, marginTop: spacing.sm },
  manualNoticeText: { fontSize: fontSize.xs, color: colors.brandDark, marginLeft: spacing.sm, flex: 1, lineHeight: 16 },
  playActionRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: spacing.sm },
  restoreButton: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  restoreButtonText: { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: fontWeight.semibold, marginLeft: spacing.xs },
  catalogSectionTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  catalogSectionSubtitle: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.md },
  planCard: { backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.lg, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border, ...shadows.sm },
  planCardRecommended: { borderColor: colors.brand, borderWidth: 2 },
  planCardActive: { backgroundColor: colors.successSurface, borderColor: colors.success },
  recommendedBadge: { position: 'absolute', top: -12, right: spacing.lg, backgroundColor: colors.brand, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.full },
  recommendedBadgeText: { color: '#fff', fontSize: 10, fontWeight: fontWeight.bold },
  planCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  planTextColumn: { flex: 1, marginRight: spacing.sm },
  planTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  planTagline: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: spacing.xs },
  priceAmount: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text, textAlign: 'right' },
  featureDivider: { height: 1, backgroundColor: colors.borderLight, marginVertical: spacing.md },
  featureRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  featureText: { fontSize: fontSize.xs, color: colors.textSecondary, marginLeft: spacing.sm, flex: 1 },
  subscribeButton: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.md, alignItems: 'center', marginTop: spacing.md },
  subscribeButtonRecommended: { backgroundColor: colors.brand, borderColor: colors.brand },
  subscribeButtonActive: { backgroundColor: colors.successSurface, borderColor: colors.success },
  subscribeButtonText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  subscribeButtonTextActive: { color: colors.success },
  buttonDisabled: { opacity: 0.6 },
});

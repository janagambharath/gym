import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import {
  SubscriptionPlan,
  SubscriptionStatusData,
  getSubscriptionPlans,
  getSubscriptionStatus,
  restoreSubscriptionPurchase,
  verifySubscriptionPurchase,
} from '../services/apiClient';
import { formatDate } from '../types';

function generatePurchaseToken(planId: string): string {
  return `gp_token_${Date.now()}_${planId}`;
}

function generateRestoreToken(): string {
  return `restore_token_${Date.now()}`;
}

interface SubscriptionScreenProps {
  onBack: () => void;
}

export function SubscriptionScreen({ onBack }: SubscriptionScreenProps) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [subStatus, setSubStatus] = useState<SubscriptionStatusData | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('growth');
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchData = useCallback(() => {
    return Promise.all([
      getSubscriptionStatus(),
      getSubscriptionPlans(),
    ])
      .then(([statusRes, plansRes]) => {
        if (statusRes.ok) {
          setSubStatus(statusRes.data);
          if (statusRes.data.plan?.id) {
            setSelectedPlanId(statusRes.data.plan.id);
          }
        }
        if (plansRes.ok) {
          setPlans(plansRes.data.plans);
        }
      })
      .catch(() => {
        setFeedback({ type: 'error', message: 'Failed to load subscription information.' });
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setFeedback(null);
    void fetchData();
  }, [fetchData]);

  const handleSubscribePlan = async (plan: SubscriptionPlan) => {
    setFeedback(null);
    setActionLoading(true);

    try {
      const mockToken = generatePurchaseToken(plan.id);
      const result = await verifySubscriptionPurchase(mockToken, plan.product_id);

      if (result.ok) {
        setSubStatus(result.data.subscription);
        setFeedback({ type: 'success', message: `Successfully updated to ${plan.name} plan!` });
      } else {
        setFeedback({ type: 'error', message: result.error?.message || 'Subscription verification failed.' });
      }
    } catch {
      setFeedback({ type: 'error', message: 'Could not connect to Google Play store.' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestorePurchases = async () => {
    setFeedback(null);
    setActionLoading(true);

    try {
      const activePlan = plans.find((p) => p.id === selectedPlanId) || plans[1] || plans[0];
      const mockToken = generateRestoreToken();
      const result = await restoreSubscriptionPurchase(mockToken, activePlan.product_id);

      if (result.ok) {
        setSubStatus(result.data.subscription);
        Alert.alert('Purchases Restored', 'Your Google Play subscription was successfully restored.');
      } else {
        setFeedback({ type: 'error', message: result.error?.message || 'No active subscription found to restore.' });
      }
    } catch {
      setFeedback({ type: 'error', message: 'Failed to query existing Google Play purchases.' });
    } finally {
      setActionLoading(false);
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

  const isManual = subStatus?.billing_source === 'MANUAL';
  const status = subStatus?.subscription_status || 'TRIAL';

  return (
    <View style={styles.container}>
      <AppHeader title="Subscription & Billing" onBack={onBack} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {/* Feedback Banner */}
        {feedback && (
          <View
            style={[
              styles.feedbackBanner,
              feedback.type === 'success' ? styles.feedbackSuccess : styles.feedbackError,
            ]}
          >
            <Icon
              name={feedback.type === 'success' ? 'checkmark' : 'alert'}
              size={18}
              color={feedback.type === 'success' ? colors.success : colors.critical}
            />
            <Text
              style={[
                styles.feedbackText,
                feedback.type === 'success' ? styles.feedbackTextSuccess : styles.feedbackTextError,
              ]}
            >
              {feedback.message}
            </Text>
          </View>
        )}

        {/* Current Plan Overview Card */}
        <View style={styles.currentPlanCard}>
          <View style={styles.currentPlanHeader}>
            <View>
              <Text style={styles.currentPlanLabel}>Current Plan</Text>
              <Text style={styles.currentPlanName}>{subStatus?.plan.name || 'Growth Plan'}</Text>
            </View>
            <StatusBadge status={status} />
          </View>

          <View style={styles.planDetailsGrid}>
            <View style={styles.planDetailItem}>
              <Text style={styles.planDetailLabel}>Billing Source</Text>
              <View style={styles.billingSourceTag}>
                <Icon
                  name={isManual ? 'person' : 'wallet'}
                  size={14}
                  color={isManual ? colors.brand : colors.success}
                />
                <Text style={styles.billingSourceText}>
                  {isManual ? 'Founder / Concierge' : 'Google Play Store'}
                </Text>
              </View>
            </View>

            <View style={styles.planDetailItem}>
              <Text style={styles.planDetailLabel}>Renews / Expires</Text>
              <Text style={styles.planDetailValue}>{formatDate(subStatus?.renews_at)}</Text>
            </View>
          </View>

          {isManual ? (
            <View style={styles.manualNotice}>
              <Icon name="info" size={16} color={colors.brand} />
              <Text style={styles.manualNoticeText}>
                Your account is managed directly with dedicated founder concierge support. No Google Play charges apply.
              </Text>
            </View>
          ) : (
            <View style={styles.playActionRow}>
              <TouchableOpacity
                style={styles.restoreButton}
                onPress={handleRestorePurchases}
                disabled={actionLoading}
              >
                <Icon name="retry" size={16} color={colors.textSecondary} />
                <Text style={styles.restoreButtonText}>Restore Purchases</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* 3-Tier Plan Catalog */}
        <Text style={styles.catalogSectionTitle}>Choose Your Plan</Text>
        <Text style={styles.catalogSectionSubtitle}>
          Transparent monthly pricing with zero hidden fees. Switch or cancel anytime.
        </Text>

        {plans.map((p) => {
          const isSelected = p.id === (subStatus?.plan?.id || selectedPlanId);
          return (
            <View
              key={p.id}
              style={[
                styles.planCard,
                p.recommended && styles.planCardRecommended,
                isSelected && styles.planCardActive,
              ]}
            >
              {p.recommended && (
                <View style={styles.recommendedBadge}>
                  <Text style={styles.recommendedBadgeText}>MOST POPULAR</Text>
                </View>
              )}

              <View style={styles.planCardHeader}>
                <View>
                  <Text style={styles.planTitle}>{p.name}</Text>
                  <Text style={styles.planTagline}>{p.tagline}</Text>
                </View>
                <View style={styles.priceContainer}>
                  <Text style={styles.priceSymbol}>{p.currency_symbol}</Text>
                  <Text style={styles.priceAmount}>{p.price}</Text>
                  <Text style={styles.pricePeriod}>/mo</Text>
                </View>
              </View>

              <View style={styles.featureDivider} />

              {/* Feature Checklist */}
              {p.features.map((feat, idx) => (
                <View key={idx} style={styles.featureRow}>
                  <Icon name="checkmark" size={16} color={colors.success} />
                  <Text style={styles.featureText}>{feat}</Text>
                </View>
              ))}

              {!isManual && (
                <TouchableOpacity
                  style={[
                    styles.subscribeButton,
                    isSelected && styles.subscribeButtonActive,
                    p.recommended && styles.subscribeButtonRecommended,
                    actionLoading && styles.buttonDisabled,
                  ]}
                  onPress={() => handleSubscribePlan(p)}
                  disabled={actionLoading}
                  activeOpacity={0.8}
                >
                  {actionLoading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text
                      style={[
                        styles.subscribeButtonText,
                        isSelected && styles.subscribeButtonTextActive,
                      ]}
                    >
                      {isSelected ? 'Current Active Plan' : `Upgrade to ${p.name}`}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  feedbackSuccess: {
    backgroundColor: colors.successSurface,
  },
  feedbackError: {
    backgroundColor: colors.criticalSurface,
  },
  feedbackText: {
    fontSize: fontSize.sm,
    marginLeft: spacing.sm,
    flex: 1,
  },
  feedbackTextSuccess: {
    color: colors.success,
  },
  feedbackTextError: {
    color: colors.critical,
  },
  currentPlanCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadows.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  currentPlanHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  currentPlanLabel: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    fontWeight: fontWeight.semibold,
  },
  currentPlanName: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginTop: spacing.xs,
  },
  planDetailsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  planDetailItem: {
    flex: 1,
  },
  planDetailLabel: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  billingSourceTag: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  billingSourceText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginLeft: spacing.xs,
  },
  planDetailValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginTop: spacing.xs,
  },
  manualNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.brandSubtle,
    padding: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  manualNoticeText: {
    fontSize: fontSize.xs,
    color: colors.brandDark,
    marginLeft: spacing.sm,
    flex: 1,
    lineHeight: 16,
  },
  playActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.sm,
  },
  restoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  restoreButtonText: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    fontWeight: fontWeight.semibold,
    marginLeft: spacing.xs,
  },
  catalogSectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  catalogSectionSubtitle: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  planCard: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.sm,
  },
  planCardRecommended: {
    borderColor: colors.brand,
    borderWidth: 2,
  },
  planCardActive: {
    backgroundColor: colors.card,
  },
  recommendedBadge: {
    position: 'absolute',
    top: -12,
    right: spacing.lg,
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  recommendedBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: fontWeight.bold,
  },
  planCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  planTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  planTagline: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    maxWidth: 180,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  priceSymbol: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  priceAmount: {
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  pricePeriod: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginLeft: 2,
  },
  featureDivider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginVertical: spacing.md,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  featureText: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginLeft: spacing.sm,
    flex: 1,
  },
  subscribeButton: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  subscribeButtonRecommended: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  subscribeButtonActive: {
    backgroundColor: colors.successSurface,
    borderColor: colors.success,
  },
  subscribeButtonText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  subscribeButtonTextActive: {
    color: colors.success,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});

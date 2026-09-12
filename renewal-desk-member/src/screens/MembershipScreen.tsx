import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { apiClient } from '../services/apiClient';
import { useBranding } from '../context/BrandingContext';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState } from '../components/EmptyState';
import { RootStackParamList, RenewalRecord } from '../types';
import { colors, radii, spacing, typography } from '../theme/tokens';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export const MembershipScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useBranding();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [membershipData, setMembershipData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchMembership = useCallback(async () => {
    try {
      setError(null);
      const data = await apiClient.getMembership();
      setMembershipData(data);
    } catch (err: any) {
      setError(err.message || 'Unable to load membership details.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchMembership();
  }, [fetchMembership]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchMembership();
  }, [fetchMembership]);

  const formatDate = (iso: string | null) => {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      return iso;
    }
  };

  if (loading && !membershipData) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={styles.loadingText}>Loading membership details...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const membership = membershipData?.membership;
  const renewals: RenewalRecord[] = membershipData?.renewal_history || [];

  const daysLeft = membership?.days_left;
  const isExpired = membership?.is_expired || (daysLeft !== null && daysLeft < 0);
  const isExpiring = !isExpired && daysLeft !== null && daysLeft <= 7;
  const isPaused = membership?.status?.toLowerCase() === 'paused';

  let statusBadgeLabel = 'ACTIVE';
  if (membership?.status?.toLowerCase() === 'cancelled') statusBadgeLabel = 'CANCELLED';
  else if (isPaused) statusBadgeLabel = 'PAUSED';
  else if (isExpired) statusBadgeLabel = 'EXPIRED';
  else if (isExpiring) statusBadgeLabel = 'EXPIRING';

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.primary]} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Screen Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Membership Details</Text>
          <Text style={styles.headerSubtitle}>Authoritative subscription record at {theme.gymName}</Text>
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle" size={20} color={colors.expired} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {membership && (
          <>
            {/* Primary Membership Status Card */}
            <View style={styles.statusCard}>
              <View style={styles.statusTopRow}>
                <View>
                  <Text style={styles.gymNameLabel}>{theme.gymName.toUpperCase()}</Text>
                  <Text style={styles.planTitle}>{membership.plan_name || 'Standard Plan'}</Text>
                </View>
                <StatusBadge status={statusBadgeLabel} />
              </View>

              {/* Countdown Banner */}
              <View
                style={[
                  styles.countdownBanner,
                  isExpired && styles.bannerExpired,
                  isExpiring && styles.bannerExpiring,
                ]}
              >
                <Ionicons
                  name={isExpired ? 'alert-circle' : isExpiring ? 'time' : 'checkmark-circle'}
                  size={20}
                  color={isExpired ? colors.expired : isExpiring ? colors.expiring : colors.active}
                />
                <Text
                  style={[
                    styles.countdownText,
                    isExpired && styles.countdownExpired,
                    isExpiring && styles.countdownExpiring,
                  ]}
                >
                  {isExpired
                    ? `Expired ${Math.abs(daysLeft ?? 0)} days ago`
                    : isPaused
                    ? 'Membership is paused'
                    : `${daysLeft} days remaining`}
                </Text>
              </View>

              {/* Key Value Details Grid */}
              <View style={styles.grid}>
                <View style={styles.gridRow}>
                  <Text style={styles.gridLabel}>Start Date</Text>
                  <Text style={styles.gridValue}>{formatDate(membership.membership_start)}</Text>
                </View>
                <View style={styles.gridRow}>
                  <Text style={styles.gridLabel}>Expiry Date</Text>
                  <Text style={[styles.gridValue, isExpired && styles.expiredText]}>
                    {formatDate(membership.membership_end)}
                  </Text>
                </View>
                <View style={styles.gridRow}>
                  <Text style={styles.gridLabel}>Plan Duration</Text>
                  <Text style={styles.gridValue}>
                    {membership.plan_duration_days ? `${membership.plan_duration_days} Days` : '—'}
                  </Text>
                </View>
                <View style={styles.gridRow}>
                  <Text style={styles.gridLabel}>Plan Price</Text>
                  <Text style={styles.gridValue}>
                    {membership.plan_price ? `₹${membership.plan_price}` : '—'}
                  </Text>
                </View>
                <View style={[styles.gridRow, { borderBottomWidth: 0 }]}>
                  <Text style={styles.gridLabel}>Member Since</Text>
                  <Text style={styles.gridValue}>{formatDate(membership.joined_on)}</Text>
                </View>
              </View>

              {/* Renew CTA */}
              <TouchableOpacity
                style={[styles.renewButton, { backgroundColor: theme.primary }]}
                onPress={() => navigation.navigate('Renew')}
                activeOpacity={0.85}
              >
                <Ionicons name="refresh" size={18} color={theme.primaryText} />
                <Text style={[styles.renewButtonText, { color: theme.primaryText }]}>Renew Membership</Text>
              </TouchableOpacity>
            </View>

            {/* Renewal History Section */}
            <View style={styles.historySection}>
              <Text style={styles.sectionTitle}>Renewal History</Text>
              {renewals.length === 0 ? (
                <EmptyState
                  icon="receipt-outline"
                  title="No Past Renewals"
                  description="Your renewal and membership extension history will be displayed here."
                />
              ) : (
                renewals.map((item) => (
                  <View key={item.id} style={styles.historyItem}>
                    <View style={styles.historyLeft}>
                      <Text style={styles.historyPlan}>{item.plan_name || 'Membership Renewal'}</Text>
                      <Text style={styles.historyDates}>
                        {formatDate(item.new_start)} – {formatDate(item.new_end)}
                      </Text>
                      {item.created_at && (
                        <Text style={styles.historyTimestamp}>
                          Processed on {formatDate(item.created_at)}
                        </Text>
                      )}
                    </View>
                    <View style={styles.historyRight}>
                      <Text style={styles.historyAmount}>₹{item.amount}</Text>
                      <StatusBadge status="VERIFIED" size="sm" />
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
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
    marginBottom: spacing.lg,
  },
  headerTitle: {
    ...typography.h1,
    color: colors.text,
  },
  headerSubtitle: {
    ...typography.subtext,
    color: colors.textSecondary,
    marginTop: 2,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.expiredSurface,
    padding: spacing.md,
    borderRadius: radii.md,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  errorText: {
    ...typography.subtext,
    color: colors.expired,
  },
  statusCard: {
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
    marginBottom: spacing.xl,
  },
  statusTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  gymNameLabel: {
    ...typography.caption,
    color: colors.muted,
    letterSpacing: 0.8,
  },
  planTitle: {
    ...typography.h2,
    color: colors.text,
    marginTop: 2,
  },
  countdownBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.activeSurface,
    borderWidth: 1,
    borderColor: colors.activeBorder,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  bannerExpiring: {
    backgroundColor: colors.expiringSurface,
    borderColor: colors.expiringBorder,
  },
  bannerExpired: {
    backgroundColor: colors.expiredSurface,
    borderColor: colors.expiredBorder,
  },
  countdownText: {
    ...typography.bodySemibold,
    color: colors.active,
  },
  countdownExpiring: {
    color: colors.expiring,
  },
  countdownExpired: {
    color: colors.expired,
  },
  grid: {
    backgroundColor: '#F8FAFC',
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginBottom: spacing.lg,
  },
  gridRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  gridLabel: {
    ...typography.subtext,
    color: colors.textSecondary,
  },
  gridValue: {
    ...typography.bodySemibold,
    color: colors.text,
  },
  expiredText: {
    color: colors.expired,
  },
  renewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: radii.lg,
    gap: spacing.sm,
  },
  renewButtonText: {
    ...typography.bodySemibold,
  },
  historySection: {
    marginTop: spacing.xs,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.md,
  },
  historyItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  historyLeft: {
    flex: 1,
  },
  historyPlan: {
    ...typography.bodySemibold,
    color: colors.text,
  },
  historyDates: {
    ...typography.subtext,
    color: colors.textSecondary,
    marginTop: 2,
  },
  historyTimestamp: {
    ...typography.caption,
    color: colors.muted,
    marginTop: 2,
  },
  historyRight: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  historyAmount: {
    ...typography.bodySemibold,
    color: colors.text,
  },
});

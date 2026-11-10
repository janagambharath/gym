import React, { useCallback, useState } from 'react';
import { useLiveEffect } from '../hooks/useLiveEffect';
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
import { useAuth } from '../context/AuthContext';
import { useBranding } from '../context/BrandingContext';
import { apiClient } from '../services/apiClient';
import { formatGymDate, formatGymDateTime } from '../utils/gymTime';
import { DashboardResponse, RootStackParamList } from '../types';
import { VynlaHeader } from '../components/VynlaHeader';
import { MembershipCard } from '../components/MembershipCard';
import { StatusBadge } from '../components/StatusBadge';
import { OfflineBanner } from '../components/OfflineBanner';
import { colors, radii, spacing, typography } from '../theme/tokens';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export const HomeScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { member, updateMember } = useAuth();
  const { theme, refreshBranding } = useBranding();

  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [isOffline, setIsOffline] = useState<boolean>(false);
  const [lastVisit, setLastVisit] = useState<string | null>(null);
  // V11-H7: the door-eligibility value from the access summary. Null
  // until the access call answers (or when it fails) — the tile then
  // falls back to the same definition the backend uses.
  const [accessActive, setAccessActive] = useState<boolean | null>(null);

  const fetchDashboard = useCallback(async () => {
    try {
      const dash = await apiClient.getDashboard();
      setData(dash);
      updateMember(dash.member);
      setIsOffline(false);

      // Fetch last access visit
      try {
        const accessData = await apiClient.getAccess(1, 1);
        setLastVisit(accessData.summary.last_visit);
        setAccessActive(accessData.summary.access_active ?? null);
      } catch {
        // Non-blocking
      }
    } catch {
      setIsOffline(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [updateMember]);

  useLiveEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchDashboard(), refreshBranding()]);
  }, [fetchDashboard, refreshBranding]);

  const handleRenew = () => {
    navigation.navigate('Renew');
  };

  // V12-L4: last-visit renders in gym time, not device-local time.
  const formatDateTime = (iso: string | null) => {
    if (!iso) return 'No visits recorded yet';
    return formatGymDateTime(iso);
  };

  if (loading && !data) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <VynlaHeader />
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={styles.loadingText}>Loading your membership...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const activeMember = data?.member || member;
  const recentRenewal = data?.recent_renewals?.[0];
  const pendingPayment = data?.pending_payment;
  const announcements = data?.branding?.announcements || [];
  const offers = data?.branding?.offers || [];
  // V11-H7: drive the tile from the backend's access_active (status ==
  // 'active' and not expired). The fallback below is the same definition,
  // used only while the access call has not answered. A paused member is
  // never 'active', so they no longer see "Access eligible".
  const doorEligible =
    accessActive ?? (activeMember?.status?.toLowerCase() === 'active' && !activeMember?.is_expired);

  return (
    <SafeAreaView style={styles.safeArea}>
      <OfflineBanner visible={isOffline} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.primary]} />}
        showsVerticalScrollIndicator={false}
      >
        <VynlaHeader />

        <View style={styles.content}>
          {/* Pending Payment Notice (if member claimed a payment awaiting owner verification) */}
          {pendingPayment && (
            <View style={styles.pendingCard}>
              <View style={styles.pendingHeader}>
                <Ionicons name="time" size={20} color={colors.expiring} />
                <Text style={styles.pendingTitle}>Payment Verification Pending</Text>
              </View>
              <Text style={styles.pendingText}>
                Your payment of ₹{pendingPayment.amount} has been submitted. The gym will confirm it and update your membership shortly.
              </Text>
              <View style={styles.pendingFooter}>
                <StatusBadge status="CLAIMED" size="sm" />
                <Text style={styles.pendingDate}>
                  {pendingPayment.created_at ? formatGymDate(pendingPayment.created_at) : 'Recent'}
                </Text>
              </View>
            </View>
          )}

          {/* Core Authoritative Membership Card */}
          {activeMember && <MembershipCard member={activeMember} onRenew={handleRenew} />}

          {/* Quick Stat Tiles: Recent Activity & Recent Payment */}
          <View style={styles.tileRow}>
            {/* Recent Visit Tile */}
            <View style={styles.tile}>
              <View style={styles.tileHeader}>
                <View style={[styles.tileIconCircle, { backgroundColor: theme.accent }]}>
                  <Ionicons name="footsteps" size={16} color={theme.primary} />
                </View>
                <Text style={styles.tileLabel}>LAST VISIT</Text>
              </View>
              <Text style={styles.tileValue} numberOfLines={2}>
                {formatDateTime(lastVisit)}
              </Text>
              <View style={styles.tileFooter}>
                <Ionicons
                  name={doorEligible ? 'checkmark-circle' : 'close-circle'}
                  size={13}
                  color={doorEligible ? colors.active : colors.expired}
                />
                <Text
                  style={[
                    styles.tileStatusText,
                    { color: doorEligible ? colors.active : colors.expired },
                  ]}
                >
                  {doorEligible ? 'Access eligible' : 'Access inactive'}
                </Text>
              </View>
            </View>

            {/* Recent Payment Tile */}
            <View style={styles.tile}>
              <View style={styles.tileHeader}>
                <View style={[styles.tileIconCircle, { backgroundColor: '#ECFDF5' }]}>
                  <Ionicons name="receipt" size={16} color={colors.active} />
                </View>
                <Text style={styles.tileLabel}>LAST PAYMENT</Text>
              </View>
              <Text style={styles.tileValue}>
                {recentRenewal ? `₹${recentRenewal.amount}` : '—'}
              </Text>
              <View style={styles.tileFooter}>
                {recentRenewal ? (
                  <StatusBadge status="VERIFIED" size="sm" />
                ) : (
                  <Text style={styles.noPaymentText}>No payments yet</Text>
                )}
              </View>
            </View>
          </View>

          {/* Real Gym Announcements */}
          {announcements.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="megaphone" size={18} color={theme.primary} />
                <Text style={styles.sectionTitle}>Gym Announcements</Text>
              </View>
              {announcements.map((item) => (
                <View key={item.id} style={styles.announcementCard}>
                  <Text style={styles.announcementTitle}>{item.title}</Text>
                  <Text style={styles.announcementMessage}>{item.message}</Text>
                  {item.date && (
                    <Text style={styles.announcementDate}>
                      {formatGymDate(item.date)}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          )}

          {/* Real Gym Offers */}
          {offers.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="pricetag" size={18} color={colors.expiring} />
                <Text style={styles.sectionTitle}>Exclusive Offers</Text>
              </View>
              {offers.map((offer) => (
                <View key={offer.id} style={[styles.offerCard, { borderColor: theme.accent }]}>
                  <View style={styles.offerBadge}>
                    <Text style={styles.offerBadgeText}>SPECIAL</Text>
                  </View>
                  <Text style={styles.offerTitle}>{offer.title}</Text>
                  <Text style={styles.offerDescription}>{offer.description}</Text>
                  <TouchableOpacity
                    style={[styles.offerButton, { backgroundColor: theme.primary }]}
                    onPress={handleRenew}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.offerButtonText, { color: theme.primaryText }]}>Claim Offer</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* Gym Support Footer Card */}
          <View style={styles.supportCard}>
            <Text style={styles.supportTitle}>Need Help with Your Membership?</Text>
            <Text style={styles.supportSubtitle}>
              Contact {theme.gymName} staff directly for plan upgrades, trainer guidance, or payments.
            </Text>
            {theme.phone && (
              <Text style={styles.supportPhone}>Call or WhatsApp: {theme.phone}</Text>
            )}
          </View>
        </View>
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
    paddingBottom: spacing.xxl,
  },
  content: {
    paddingHorizontal: spacing.lg,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  loadingText: {
    ...typography.subtext,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  pendingCard: {
    backgroundColor: colors.expiringSurface,
    borderWidth: 1,
    borderColor: colors.expiringBorder,
    borderRadius: radii.xl,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  pendingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  pendingTitle: {
    ...typography.bodySemibold,
    color: colors.expiring,
  },
  pendingText: {
    ...typography.subtext,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  pendingFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  pendingDate: {
    ...typography.caption,
    color: colors.muted,
  },
  tileRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  tile: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
    justifyContent: 'space-between',
    minHeight: 120,
  },
  tileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  tileIconCircle: {
    width: 26,
    height: 26,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: {
    ...typography.caption,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  tileValue: {
    ...typography.h3,
    color: colors.text,
    marginVertical: spacing.xs,
  },
  tileFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  tileStatusText: {
    ...typography.caption,
    fontWeight: '600',
  },
  // V11-L42: shown in place of the VERIFIED badge when the member has
  // never paid — the plan price is not a payment.
  noPaymentText: {
    ...typography.caption,
    color: colors.muted,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
  },
  announcementCard: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  announcementTitle: {
    ...typography.bodySemibold,
    color: colors.text,
  },
  announcementMessage: {
    ...typography.subtext,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
    lineHeight: 18,
  },
  announcementDate: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.xs,
    alignSelf: 'flex-end',
  },
  offerCard: {
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1.5,
    marginBottom: spacing.sm,
  },
  offerBadge: {
    backgroundColor: colors.expiringSurface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.full,
    alignSelf: 'flex-start',
    marginBottom: spacing.xs,
  },
  offerBadgeText: {
    ...typography.caption,
    color: colors.expiring,
    fontWeight: '700',
  },
  offerTitle: {
    ...typography.bodySemibold,
    color: colors.text,
  },
  offerDescription: {
    ...typography.subtext,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  offerButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
  },
  offerButtonText: {
    ...typography.caption,
    fontWeight: '700',
  },
  supportCard: {
    backgroundColor: '#F1F5F9',
    borderRadius: radii.lg,
    padding: spacing.md,
    marginTop: spacing.sm,
    alignItems: 'center',
  },
  supportTitle: {
    ...typography.bodySemibold,
    color: colors.text,
    textAlign: 'center',
  },
  supportSubtitle: {
    ...typography.subtext,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 2,
    lineHeight: 16,
  },
  supportPhone: {
    ...typography.caption,
    color: colors.platform,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
});

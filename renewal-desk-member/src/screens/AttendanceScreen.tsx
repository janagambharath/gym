import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiClient } from '../services/apiClient';
import { useBranding } from '../context/BrandingContext';
import { AccessEventRecord, AccessSummary } from '../types';
import { EmptyState } from '../components/EmptyState';
import { colors, radii, spacing, typography } from '../theme/tokens';

export const AttendanceScreen: React.FC = () => {
  const { theme } = useBranding();

  const [summary, setSummary] = useState<AccessSummary | null>(null);
  const [events, setEvents] = useState<AccessEventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const fetchAccess = useCallback(async (pageNum = 1) => {
    try {
      const res = await apiClient.getAccess(pageNum, 20);
      setSummary(res.summary);
      if (pageNum === 1) {
        setEvents(res.events);
      } else {
        setEvents((prev) => [...prev, ...res.events]);
      }
      setHasMore(res.pagination.page < res.pagination.total_pages);
      setPage(pageNum);
    } catch {
      // Non-fatal
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAccess(1);
  }, [fetchAccess]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchAccess(1);
  }, [fetchAccess]);

  const onEndReached = () => {
    if (!loading && hasMore) {
      fetchAccess(page + 1);
    }
  };

  const formatEventTime = (iso: string) => {
    try {
      const d = new Date(iso);
      const today = new Date();
      const yesterday = new Date();
      yesterday.setDate(today.getDate() - 1);

      const isToday = d.toDateString() === today.toDateString();
      const isYesterday = d.toDateString() === yesterday.toDateString();
      const timeStr = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });

      if (isToday) return `Today · ${timeStr}`;
      if (isYesterday) return `Yesterday · ${timeStr}`;
      return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · ${timeStr}`;
    } catch {
      return iso;
    }
  };

  const renderEventItem = ({ item }: { item: AccessEventRecord }) => {
    const isEntry = item.event_type === 'ENTRY';
    const isExit = item.event_type === 'EXIT';
    const isDenied = item.event_type === 'DENIED';

    let iconName: keyof typeof Ionicons.glyphMap = 'radio-button-on';
    let iconColor = colors.textSecondary;
    let label = 'Check-in';

    if (isEntry) {
      iconName = 'log-in';
      iconColor = colors.active;
      label = 'Gym Entry';
    } else if (isExit) {
      iconName = 'log-out';
      iconColor = colors.expiring;
      label = 'Gym Exit';
    } else if (isDenied) {
      iconName = 'ban';
      iconColor = colors.expired;
      label = 'Access Denied';
    } else {
      label = 'Gate Check-in';
    }

    return (
      <View style={styles.eventCard}>
        <View style={[styles.eventIconCircle, { backgroundColor: isEntry ? colors.activeSurface : isExit ? colors.expiringSurface : '#F1F5F9' }]}>
          <Ionicons name={iconName} size={18} color={iconColor} />
        </View>
        <View style={styles.eventInfo}>
          <Text style={styles.eventLabel}>{label}</Text>
          <Text style={styles.eventTime}>{formatEventTime(item.timestamp)}</Text>
        </View>
        {item.device_name ? (
          <Text style={styles.deviceName}>{item.device_name}</Text>
        ) : null}
      </View>
    );
  };

  if (loading && events.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={styles.loadingText}>Loading attendance activity...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isEligible = summary?.access_active ?? false;
  const isInside = summary?.is_inside ?? false;

  return (
    <SafeAreaView style={styles.safeArea}>
      <FlatList
        data={events}
        renderItem={renderEventItem}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.primary]} />}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <View>
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Gym Attendance</Text>
              <Text style={styles.headerSubtitle}>Turnstile and entry check-ins at {theme.gymName}</Text>
            </View>

            {/* Access Status Hero Card */}
            <View style={styles.statusCard}>
              <View style={styles.statusRow}>
                <View>
                  <Text style={styles.cardSectionLabel}>GYM ACCESS STATUS</Text>
                  <Text style={styles.cardStatusHeading}>
                    {isEligible ? 'Access Eligible' : 'Access Inactive'}
                  </Text>
                </View>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: isEligible ? colors.activeSurface : colors.expiredSurface },
                  ]}
                >
                  <Ionicons
                    name={isEligible ? 'shield-checkmark' : 'shield-outline'}
                    size={16}
                    color={isEligible ? colors.active : colors.expired}
                  />
                  <Text
                    style={[
                      styles.statusBadgeText,
                      { color: isEligible ? colors.active : colors.expired },
                    ]}
                  >
                    {isEligible ? 'ACTIVE' : 'EXPIRED'}
                  </Text>
                </View>
              </View>

              {/* Real-time Inside / Outside indicator */}
              <View style={styles.presenceRow}>
                <View style={[styles.presenceDot, { backgroundColor: isInside ? colors.active : colors.muted }]} />
                <Text style={styles.presenceText}>
                  {isInside ? 'Currently inside gym floor' : 'Currently checked out'}
                </Text>
              </View>

              {/* Last visit & Today count summary */}
              <View style={styles.statsRow}>
                <View style={styles.statBox}>
                  <Text style={styles.statBoxLabel}>TODAY'S VISITS</Text>
                  <Text style={styles.statBoxValue}>{summary?.today_entries ?? 0}</Text>
                </View>
                <View style={[styles.statBox, { borderLeftWidth: 1, borderLeftColor: colors.borderSubtle }]}>
                  <Text style={styles.statBoxLabel}>LAST VISIT</Text>
                  <Text style={styles.statBoxValue}>
                    {summary?.last_visit ? formatEventTime(summary.last_visit).split('·')[0].trim() : '—'}
                  </Text>
                </View>
              </View>
            </View>

            <Text style={styles.logSectionTitle}>Recent Check-In Activity</Text>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="footsteps-outline"
            title="No Attendance Records Yet"
            description="Your check-ins at the gym entrance terminal will automatically appear here."
          />
        }
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  listContent: {
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
  statusCard: {
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardSectionLabel: {
    ...typography.caption,
    color: colors.muted,
    letterSpacing: 0.8,
  },
  cardStatusHeading: {
    ...typography.h2,
    color: colors.text,
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: radii.full,
    gap: spacing.xs,
  },
  statusBadgeText: {
    ...typography.badge,
  },
  presenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
  },
  presenceDot: {
    width: 8,
    height: 8,
    borderRadius: radii.full,
  },
  presenceText: {
    ...typography.subtext,
    color: colors.textSecondary,
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  statBox: {
    flex: 1,
    paddingHorizontal: spacing.sm,
  },
  statBoxLabel: {
    ...typography.caption,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  statBoxValue: {
    ...typography.bodySemibold,
    color: colors.text,
    marginTop: 2,
  },
  logSectionTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.md,
  },
  eventCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  eventIconCircle: {
    width: 36,
    height: 36,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  eventInfo: {
    flex: 1,
  },
  eventLabel: {
    ...typography.bodySemibold,
    color: colors.text,
  },
  eventTime: {
    ...typography.subtext,
    color: colors.textSecondary,
    marginTop: 2,
  },
  deviceName: {
    ...typography.caption,
    color: colors.muted,
  },
});

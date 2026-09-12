/**
 * MemberAccessScreen — Gym check-in & attendance history for members.
 *
 * Shows: access validity status, today's visits, current inside state,
 * and attendance log.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../../theme/tokens';
import type {
  MemberAccessEvent,
  MemberAccessSummary,
} from '../../services/memberApiClient';
import { fetchMemberAccess } from '../../services/memberApiClient';
import { ErrorState } from '../../components/ErrorState';

export function MemberAccessScreen() {
  const [summary, setSummary] = useState<MemberAccessSummary | null>(null);
  const [events, setEvents] = useState<MemberAccessEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const loadAccessData = useCallback(async (pageNum = 1) => {
    const result = await fetchMemberAccess(pageNum);
    if (result.ok) {
      setSummary(result.data.summary);
      if (pageNum === 1) {
        setEvents(result.data.events);
      } else {
        setEvents((prev) => [...prev, ...result.data.events]);
      }
      setTotalPages(result.data.pagination.total_pages);
      setPage(pageNum);
      setError(undefined);
    } else {
      setError(result.error);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    void fetchMemberAccess(1).then((result) => {
      if (!active) return;
      if (result.ok) {
        setSummary(result.data.summary);
        setEvents(result.data.events);
        setTotalPages(result.data.pagination.total_pages);
        setPage(1);
        setError(undefined);
      } else {
        setError(result.error);
      }
      setLoading(false);
      setRefreshing(false);
    });
    return () => {
      active = false;
    };
  }, [revision]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setRevision((r) => r + 1);
  }, []);

  const handleLoadMore = useCallback(() => {
    if (page < totalPages && !loading && !refreshing) {
      void loadAccessData(page + 1);
    }
  }, [page, totalPages, loading, refreshing, loadAccessData]);

  if (loading && !summary) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      </SafeAreaView>
    );
  }

  if (error && !summary) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ErrorState message={error} onRetry={handleRefresh} />
      </SafeAreaView>
    );
  }

  const formatTime = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return ts;
    }
  };

  const formatDate = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return ts;
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Access & Attendance</Text>
        <Text style={styles.headerSubtitle}>Your gym visit history</Text>
      </View>

      <FlatList
        data={events}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.brand}
          />
        }
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.3}
        ListHeaderComponent={
          <View style={styles.headerComponent}>
            {/* Status Card */}
            <View style={styles.statusCard}>
              <View style={styles.statusTop}>
                <Text style={styles.statusTitle}>Access Status</Text>
                <View
                  style={[
                    styles.statusBadge,
                    {
                      backgroundColor: summary?.access_active
                        ? colors.successSurface
                        : colors.criticalSurface,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusBadgeText,
                      {
                        color: summary?.access_active
                          ? colors.success
                          : colors.critical,
                      },
                    ]}
                  >
                    {summary?.access_active ? 'Active' : 'Inactive'}
                  </Text>
                </View>
              </View>

              <View style={styles.statsRow}>
                <View style={styles.statBox}>
                  <Text style={styles.statValue}>{summary?.today_entries ?? 0}</Text>
                  <Text style={styles.statLabel}>{"Today's Entries"}</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={styles.statValue}>{summary?.today_exits ?? 0}</Text>
                  <Text style={styles.statLabel}>{"Today's Exits"}</Text>
                </View>
                <View style={styles.statBox}>
                  <Text
                    style={[
                      styles.statValue,
                      { color: summary?.is_inside ? colors.success : colors.muted },
                    ]}
                  >
                    {summary?.is_inside ? 'Inside' : 'Outside'}
                  </Text>
                  <Text style={styles.statLabel}>Current State</Text>
                </View>
              </View>

              {summary?.last_visit && (
                <View style={styles.lastVisitRow}>
                  <Icon name="time" size={16} color={colors.muted} />
                  <Text style={styles.lastVisitText}>
                    Last Visit: {formatDate(summary.last_visit)} at {formatTime(summary.last_visit)}
                  </Text>
                </View>
              )}
            </View>

            <Text style={styles.historyTitle}>Activity Log</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Icon name="access" size={48} color={colors.muted} />
            <Text style={styles.emptyTitle}>No access records yet</Text>
            <Text style={styles.emptySubtitle}>
              When you check in at the gym gate or biometric device, your visits will appear here.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const isEntry = item.event_type === 'ENTRY' || item.direction === 'in';
          return (
            <View style={styles.eventCard}>
              <View
                style={[
                  styles.eventIconWrap,
                  {
                    backgroundColor: isEntry
                      ? colors.successSurface
                      : colors.infoSurface,
                  },
                ]}
              >
                <Icon
                  name={isEntry ? 'checkmark' : 'forward'}
                  size={18}
                  color={isEntry ? colors.success : colors.brand}
                />
              </View>

              <View style={styles.eventInfo}>
                <Text style={styles.eventType}>
                  {isEntry ? 'Gym Entry' : 'Gym Exit'}
                </Text>
                <Text style={styles.eventDate}>
                  {formatDate(item.timestamp)} · {formatTime(item.timestamp)}
                </Text>
              </View>

              {item.device_name ? (
                <Text style={styles.deviceName}>{item.device_name}</Text>
              ) : null}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: fontSize['4xl'],
    fontWeight: fontWeight.extrabold,
    color: colors.text,
  },
  headerSubtitle: {
    fontSize: fontSize.base,
    color: colors.muted,
    marginTop: spacing.xxs,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.bottomTabSafe,
  },
  headerComponent: {
    gap: spacing.lg,
    marginBottom: spacing.md,
  },
  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.lg,
    ...shadows.sm,
  },
  statusTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusTitle: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  statusBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  statusBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: spacing.md,
    borderRadius: radius.lg,
    gap: spacing.xxs,
  },
  statValue: {
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.extrabold,
    color: colors.text,
  },
  statLabel: {
    fontSize: fontSize.xs,
    color: colors.muted,
    fontWeight: fontWeight.medium,
  },
  lastVisitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  lastVisitText: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  historyTitle: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  eventCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  eventIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventInfo: {
    flex: 1,
    gap: spacing.xxs,
  },
  eventType: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  eventDate: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  deviceName: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    backgroundColor: colors.gray100,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.sm,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxl * 2,
    gap: spacing.md,
  },
  emptyTitle: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  emptySubtitle: {
    fontSize: fontSize.base,
    color: colors.muted,
    textAlign: 'center',
    paddingHorizontal: spacing.xxl,
  },
});

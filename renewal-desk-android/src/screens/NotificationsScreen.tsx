import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../components/AppHeader';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { FilterChips } from '../components/FilterChips';
import { CardSkeleton } from '../components/LoadingSkeleton';
import { apiRequest } from '../services/apiClient';
import { Icon, type IconName } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import { formatShortDate, type AppNotificationItem, type NotificationsResponse } from '../types';

type NotificationsScreenProps = {
  onBack: () => void;
  onNavigateScreen?: (screen: string, data?: any) => void;
};

const CATEGORY_CHIPS = [
  { key: 'all', label: 'All' },
  { key: 'handover', label: 'Handovers', dotColor: colors.critical },
  { key: 'lead', label: 'Leads', dotColor: colors.brand },
  { key: 'payment', label: 'Payments', dotColor: colors.success },
  { key: 'renewal', label: 'Renewals', dotColor: colors.statusExpiring },
];

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const now = new Date();
  const past = new Date(dateStr);
  const diffMs = now.getTime() - past.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;
  return formatShortDate(dateStr);
}

function getCategoryConfig(category: string): { icon: IconName; iconBg: string; iconColor: string } {
  switch (category) {
    case 'handover':
      return { icon: 'alert', iconBg: '#FEE2E2', iconColor: colors.critical };
    case 'lead':
    case 'trial':
      return { icon: 'lead', iconBg: colors.brandSubtle, iconColor: colors.brand };
    case 'payment':
      return { icon: 'cash', iconBg: colors.statusActiveSurface, iconColor: colors.success };
    case 'renewal':
      return { icon: 'time', iconBg: colors.statusExpiringSurface, iconColor: colors.statusExpiring };
    default:
      return { icon: 'notifications', iconBg: colors.gray50, iconColor: colors.textSecondary };
  }
}

export function NotificationsScreen({ onBack, onNavigateScreen }: NotificationsScreenProps) {
  const [notifications, setNotifications] = useState<AppNotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [category, setCategory] = useState('all');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: '1', page_size: '50' });
    if (category !== 'all') params.set('category', category);

    void apiRequest<NotificationsResponse>(`/api/mobile/v1/notifications?${params.toString()}`).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setNotifications(res.data.notifications);
        setUnreadCount(res.data.unread_count);
        setError(undefined);
      } else {
        setError(res.error.message);
      }
      setLoading(false);
      setRefreshing(false);
    });

    return () => {
      cancelled = true;
    };
  }, [category, revision]);

  const handleMarkAllRead = useCallback(async () => {
    const res = await apiRequest('/api/mobile/v1/notifications/read-all', { method: 'POST' });
    if (res.ok) {
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    }
  }, []);

  const handlePressItem = useCallback(
    async (item: AppNotificationItem) => {
      // Mark as read in background
      if (!item.is_read) {
        void apiRequest(`/api/mobile/v1/notifications/${item.id}/read`, { method: 'POST' });
        setNotifications((prev) =>
          prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n))
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      }

      // Handle navigation
      if (item.data?.screen && onNavigateScreen) {
        onNavigateScreen(item.data.screen, item.data);
      }
    },
    [onNavigateScreen]
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader
        title="Notifications"
        onBack={onBack}
        rightAction={
          unreadCount > 0 ? (
            <TouchableOpacity onPress={handleMarkAllRead} style={styles.markAllBtn}>
              <Text style={styles.markAllText}>Mark all read</Text>
            </TouchableOpacity>
          ) : undefined
        }
      />

      <FilterChips options={CATEGORY_CHIPS} selected={category} onSelect={(cat) => { setLoading(true); setCategory(cat); }} />

      {loading && !refreshing ? (
        <View style={styles.content}>
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </View>
      ) : error ? (
        <ErrorState message={error} onRetry={() => { setLoading(true); setRevision((r) => r + 1); }} />
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl colors={[colors.brand]} refreshing={refreshing} onRefresh={() => {
              setRefreshing(true);
              setRevision((r) => r + 1);
            }} />
          }
          ListEmptyComponent={
            <EmptyState
              icon={<Icon name="notifications" size={40} color={colors.muted} />}
              title="No Notifications"
              message="You're all caught up! New inquiries, handovers, and payments will appear here."
            />
          }
          renderItem={({ item }) => {
            const { icon, iconBg, iconColor } = getCategoryConfig(item.category);
            return (
              <TouchableOpacity
                style={[styles.notificationCard, !item.is_read && styles.unreadCard]}
                onPress={() => void handlePressItem(item)}
                activeOpacity={0.7}
              >
                <View style={[styles.iconContainer, { backgroundColor: iconBg }]}>
                  <Icon name={icon} size={20} color={iconColor} />
                </View>
                <View style={styles.textContainer}>
                  <View style={styles.cardHeader}>
                    <Text style={[styles.title, !item.is_read && styles.unreadTitle]} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={styles.timeAgo}>{formatTimeAgo(item.created_at)}</Text>
                  </View>
                  <Text style={styles.body} numberOfLines={2}>
                    {item.body}
                  </Text>
                </View>
                {!item.is_read ? <View style={styles.unreadDot} /> : null}
              </TouchableOpacity>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 18,
    marginTop: 2,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  content: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  iconContainer: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  listContent: {
    gap: spacing.sm,
    padding: spacing.lg,
    paddingBottom: spacing.section,
  },
  markAllBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  markAllText: {
    color: colors.brand,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  notificationCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.borderLight,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    ...shadows.sm,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  textContainer: {
    flex: 1,
    minWidth: 0,
  },
  timeAgo: {
    color: colors.muted,
    fontSize: fontSize.xs,
    marginLeft: spacing.xs,
  },
  title: {
    color: colors.text,
    flex: 1,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  unreadCard: {
    backgroundColor: '#F8FAFC',
    borderColor: colors.border,
  },
  unreadDot: {
    backgroundColor: colors.brand,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  unreadTitle: {
    fontWeight: fontWeight.extrabold,
  },
});

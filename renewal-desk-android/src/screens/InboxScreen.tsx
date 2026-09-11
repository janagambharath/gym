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
import { Avatar } from '../components/Avatar';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { CardSkeleton } from '../components/LoadingSkeleton';
import { apiRequest } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, spacing } from '../theme/tokens';

type InboxConversation = {
  id: string;
  type: 'bot' | 'campaign_reply' | 'member';
  phone: string;
  name: string;
  last_message: string;
  last_message_at: string;
  status: string;
  is_handover: boolean;
  unread: boolean;
  source_id: number;
  member_id?: number;
  campaign_id?: number;
};

type InboxScreenProps = {
  onLogout: () => void;
  onSelectConversation?: (conv: InboxConversation) => void;
  onNavigateBotConversations?: () => void;
  refreshToken?: number;
};

const FILTER_TABS = [
  { key: 'all', label: 'All' },
  { key: 'bot', label: 'Bot Chats' },
  { key: 'campaign', label: 'Campaign Replies' },
  { key: 'member', label: 'Members' },
];

export function InboxScreen({
  onLogout,
  onSelectConversation,
  onNavigateBotConversations,
  refreshToken,
}: InboxScreenProps) {
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [filter, setFilter] = useState('all');
  const [summary, setSummary] = useState<{ total: number; handovers: number; unread: number }>({
    total: 0,
    handovers: 0,
    unread: 0,
  });

  const fetchInbox = useCallback(async () => {
    const typeParam = filter !== 'all' ? `&type=${filter}` : '';
    const res = await apiRequest<{
      conversations: InboxConversation[];
      summary: { total: number; handovers: number; unread: number };
    }>(`/api/mobile/v1/inbox?page_size=50${typeParam}`);
    if (res.ok) {
      setConversations(res.data.conversations);
      setSummary(res.data.summary);
      setError(undefined);
    } else if (res.error.status === 401) {
      onLogout();
    } else {
      setError(res.error.message);
    }
    setLoading(false);
    setRefreshing(false);
  }, [filter, onLogout]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const typeParam = filter !== 'all' ? `&type=${filter}` : '';
      const res = await apiRequest<{
        conversations: InboxConversation[];
        summary: { total: number; handovers: number; unread: number };
      }>(`/api/mobile/v1/inbox?page_size=50${typeParam}`);
      if (cancelled) return;
      if (res.ok) {
        setConversations(res.data.conversations);
        setSummary(res.data.summary);
        setError(undefined);
      } else if (res.error.status === 401) {
        onLogout();
      } else {
        setError(res.error.message);
      }
      setLoading(false);
      setRefreshing(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [filter, onLogout, refreshToken]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchInbox();
  }, [fetchInbox]);

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'bot': return 'robot';
      case 'campaign_reply': return 'target';
      case 'member': return 'person';
      default: return 'chatbubble';
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'bot': return colors.brand;
      case 'campaign_reply': return colors.success;
      case 'member': return colors.textSecondary;
      default: return colors.muted;
    }
  };

  const formatTime = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const renderConversation = useCallback(
    ({ item }: { item: InboxConversation }) => (
      <TouchableOpacity
        style={[styles.conversationCard, item.unread && styles.conversationCardUnread]}
        activeOpacity={0.7}
        onPress={() => onSelectConversation?.(item)}
      >
        <View style={styles.avatarContainer}>
          <Avatar name={item.name} size={44} />
          <View style={[styles.typeBadge, { backgroundColor: getTypeColor(item.type) }]}>
            <Icon name={getTypeIcon(item.type)} size={10} color={colors.textInverse} />
          </View>
        </View>

        <View style={styles.conversationInfo}>
          <View style={styles.conversationHeader}>
            <Text style={[styles.conversationName, item.unread && styles.conversationNameUnread]} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.conversationTime}>{formatTime(item.last_message_at)}</Text>
          </View>
          <Text style={[styles.conversationMessage, item.unread && styles.conversationMessageUnread]} numberOfLines={1}>
            {item.last_message}
          </Text>
          <View style={styles.conversationMeta}>
            {item.is_handover && (
              <View style={styles.handoverTag}>
                <Icon name="alert" size={10} color={colors.critical} />
                <Text style={styles.handoverTagText}>Staff Handover</Text>
              </View>
            )}
            {item.type === 'campaign_reply' && (
              <View style={styles.campaignTag}>
                <Icon name="target" size={10} color={colors.success} />
                <Text style={styles.campaignTagText}>Campaign Reply</Text>
              </View>
            )}
          </View>
        </View>

        {item.unread && <View style={styles.unreadDot} />}
      </TouchableOpacity>
    ),
    [onSelectConversation],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Inbox</Text>
        {summary.unread > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadBadgeText}>{summary.unread}</Text>
          </View>
        )}
      </View>

      {/* Summary Bar */}
      {summary.handovers > 0 && (
        <TouchableOpacity style={styles.handoverBanner} onPress={onNavigateBotConversations} activeOpacity={0.7}>
          <Icon name="alert" size={16} color={colors.critical} />
          <Text style={styles.handoverBannerText}>
            {summary.handovers} conversation{summary.handovers !== 1 ? 's' : ''} need staff attention
          </Text>
          <Icon name="forward" size={14} color={colors.critical} />
        </TouchableOpacity>
      )}

      {/* Filter Tabs */}
      <View style={styles.filterRow}>
        {FILTER_TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.filterTab, filter === tab.key && styles.filterTabActive]}
            onPress={() => setFilter(tab.key)}
          >
            <Text style={[styles.filterTabText, filter === tab.key && styles.filterTabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Conversations List */}
      {loading && !refreshing ? (
        <View style={styles.loadingContainer}>
          <CardSkeleton count={5} />
        </View>
      ) : error ? (
        <ErrorState message={error} onRetry={fetchInbox} />
      ) : (
        <FlatList
          data={conversations}
          renderItem={renderConversation}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
          }
          ListEmptyComponent={
            <EmptyState
              title="No conversations"
              message="When members reply to campaigns or the AI bot, their conversations will appear here."
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  unreadBadge: {
    backgroundColor: colors.critical,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    marginLeft: spacing.sm,
  },
  unreadBadgeText: {
    color: colors.textInverse,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  handoverBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.criticalSurface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.criticalBorder,
  },
  handoverBannerText: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.critical,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterTab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.gray100,
  },
  filterTabActive: { backgroundColor: colors.brand },
  filterTabText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.textSecondary,
  },
  filterTabTextActive: { color: colors.textInverse },
  loadingContainer: { flex: 1, padding: spacing.lg },
  list: { paddingBottom: spacing.bottomTabSafe },
  conversationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    gap: spacing.md,
  },
  conversationCardUnread: {
    backgroundColor: colors.brandSubtle,
  },
  avatarContainer: { position: 'relative' },
  typeBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  conversationInfo: { flex: 1, gap: 2 },
  conversationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  conversationName: {
    flex: 1,
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
    color: colors.text,
    marginRight: spacing.sm,
  },
  conversationNameUnread: { fontWeight: fontWeight.bold },
  conversationTime: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  conversationMessage: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  conversationMessageUnread: { color: colors.textSecondary, fontWeight: fontWeight.medium },
  conversationMeta: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 2,
  },
  handoverTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.criticalSurface,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: radius.xs,
  },
  handoverTagText: {
    fontSize: fontSize.xs,
    color: colors.critical,
    fontWeight: fontWeight.medium,
  },
  campaignTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.successSurface,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: radius.xs,
  },
  campaignTagText: {
    fontSize: fontSize.xs,
    color: colors.success,
    fontWeight: fontWeight.medium,
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.brand,
  },
});

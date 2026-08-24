import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { BotAccessState } from '../components/BotAccessState';
import { EmptyState } from '../components/EmptyState';
import { FilterChips } from '../components/FilterChips';
import { CardSkeleton } from '../components/LoadingSkeleton';
import { SearchBar } from '../components/SearchBar';
import { StatusBadge } from '../components/StatusBadge';
import type { ApiError } from '../services/apiClient';
import { apiRequest } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type { BotConversation, BotConversationsResponse } from '../types';

type BotConversationsScreenProps = {
  onBack: () => void;
  onSelectConversation: (conversation: BotConversation) => void;
  onLogout?: () => void;
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'bot', label: 'Bot', dotColor: colors.brand },
  { key: 'needs_staff', label: 'Needs staff', dotColor: colors.warning },
  { key: 'staff_active', label: 'Staff active', dotColor: colors.statusPending },
  { key: 'closed', label: 'Closed', dotColor: colors.muted },
];

function displayName(conversation: BotConversation): string {
  return conversation.customer_name?.trim() || conversation.phone;
}

function formatLastMessageAt(timestamp: string | null): string {
  if (!timestamp) return 'No messages yet';
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return 'No recent message';

  const elapsed = Date.now() - parsed.getTime();
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return parsed.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function statusMatches(status: string, selectedFilter: string): boolean {
  switch (selectedFilter) {
    case 'bot':
      return status === 'bot_active' || status === 'bot_resumed';
    case 'needs_staff':
      return status === 'human_requested';
    case 'staff_active':
      return status === 'human_active';
    case 'closed':
      return status === 'closed';
    default:
      return true;
  }
}

export function BotConversationsScreen({
  onBack,
  onSelectConversation,
  onLogout,
}: BotConversationsScreenProps) {
  const [conversations, setConversations] = useState<BotConversation[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ApiError>();

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    const result = await apiRequest<BotConversationsResponse>('/api/mobile/v1/bot/conversations');
    if (result.ok) {
      setConversations(result.data.conversations);
      setError(undefined);
    } else if (result.error.status === 401 && onLogout) {
      onLogout();
    } else {
      setError(result.error);
    }

    setLoading(false);
    setRefreshing(false);
  }, [onLogout]);

  useEffect(() => {
    const initialLoad = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(initialLoad);
  }, [load]);

  const visibleConversations = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return conversations.filter((conversation) => {
      const matchesFilter = statusMatches(conversation.handover_status, filter);
      if (!matchesFilter) return false;
      if (!normalizedSearch) return true;
      return [conversation.customer_name, conversation.phone, conversation.state]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(normalizedSearch));
    });
  }, [conversations, filter, search]);

  const renderConversation = useCallback(({ item }: { item: BotConversation }) => (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={() => onSelectConversation(item)}
      style={styles.conversationCard}
    >
      <View style={styles.avatar}>
        <Icon name="person" size={20} color={colors.brand} />
      </View>
      <View style={styles.conversationBody}>
        <View style={styles.nameRow}>
          <Text numberOfLines={1} style={styles.customerName}>{displayName(item)}</Text>
          <Text style={styles.timestamp}>{formatLastMessageAt(item.last_message_at)}</Text>
        </View>
        <Text numberOfLines={1} style={styles.phone}>{item.phone}</Text>
        <Text numberOfLines={1} style={styles.state}>{item.state.replace(/_/g, ' ')}</Text>
      </View>
      <View style={styles.statusWrap}>
        <StatusBadge status={item.handover_status} />
        <Icon name="forward" size={16} color={colors.muted} />
      </View>
    </TouchableOpacity>
  ), [onSelectConversation]);

  if (loading && conversations.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <AppHeader title="Conversations" onBack={onBack} />
        <View style={styles.loadingWrap}>
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <AppHeader title="Conversations" onBack={onBack} />
        <BotAccessState error={error} onRetry={() => void load()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Conversations" subtitle={`${conversations.length} total`} onBack={onBack} />
      <FlatList
        contentContainerStyle={styles.listContent}
        data={visibleConversations}
        keyExtractor={(item) => String(item.id)}
        ListEmptyComponent={(
          <EmptyState
            icon={<Icon name="chatbubble" size={40} color={colors.muted} />}
            subtitle={search || filter !== 'all'
              ? 'Try a different search or status filter.'
              : 'Incoming WhatsApp conversations will appear here.'}
            title={search || filter !== 'all' ? 'No matching conversations' : 'No conversations yet'}
          />
        )}
        ListHeaderComponent={(
          <View style={styles.listHeader}>
            <Text style={styles.helperText}>
              Take over a conversation when a customer needs a human response.
            </Text>
            <SearchBar
              onChangeText={setSearch}
              placeholder="Search customer or phone"
              value={search}
            />
            <FilterChips onSelect={setFilter} options={FILTERS} selected={filter} />
          </View>
        )}
        refreshControl={(
          <RefreshControl
            colors={[colors.brand]}
            onRefresh={() => void load(true)}
            refreshing={refreshing}
          />
        )}
        renderItem={renderConversation}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.full,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  conversationBody: {
    flex: 1,
    marginLeft: spacing.md,
  },
  conversationCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    padding: spacing.md,
    ...shadows.sm,
  },
  customerName: {
    color: colors.text,
    flex: 1,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    marginRight: spacing.sm,
  },
  helperText: {
    color: colors.textSecondary,
    fontSize: fontSize.base,
    lineHeight: 20,
  },
  listContent: {
    flexGrow: 1,
    gap: spacing.sm,
    padding: spacing.lg,
    paddingBottom: spacing.section,
  },
  listHeader: {
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  loadingWrap: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  nameRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  phone: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginTop: spacing.xxs,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  state: {
    color: colors.muted,
    fontSize: fontSize.xs,
    marginTop: spacing.xxs,
    textTransform: 'capitalize',
  },
  statusWrap: {
    alignItems: 'flex-end',
    gap: spacing.sm,
    marginLeft: spacing.sm,
  },
  timestamp: {
    color: colors.muted,
    fontSize: fontSize.xs,
  },
});

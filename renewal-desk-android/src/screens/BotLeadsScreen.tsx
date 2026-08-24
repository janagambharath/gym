import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
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
import type { BotLead, BotLeadsResponse } from '../types';

type BotLeadsScreenProps = {
  onBack: () => void;
  onSelectLead: (lead: BotLead) => void;
  onLogout?: () => void;
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New', dotColor: colors.info },
  { key: 'contacted', label: 'Contacted', dotColor: colors.statusPending },
  { key: 'interested', label: 'Interested', dotColor: colors.warning },
  { key: 'trial_requested', label: 'Trial', dotColor: colors.warning },
  { key: 'converted', label: 'Converted', dotColor: colors.success },
  { key: 'lost', label: 'Lost', dotColor: colors.critical },
];

function formatCreatedAt(timestamp: string | null): string {
  if (!timestamp) return 'Date unavailable';
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return 'Date unavailable';
  return parsed.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function BotLeadsScreen({ onBack, onSelectLead, onLogout }: BotLeadsScreenProps) {
  const [leads, setLeads] = useState<BotLead[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ApiError>();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const endpoint = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), page_size: '20' });
    if (status !== 'all') params.set('status', status);
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
    return `/api/mobile/v1/bot/leads?${params.toString()}`;
  }, [debouncedSearch, page, status]);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    const result = await apiRequest<BotLeadsResponse>(endpoint);
    if (result.ok) {
      setLeads(result.data.leads);
      setTotal(result.data.pagination.total);
      setTotalPages(result.data.pagination.total_pages);
      setError(undefined);
    } else if (result.error.status === 401 && onLogout) {
      onLogout();
    } else {
      setError(result.error);
    }

    setLoading(false);
    setRefreshing(false);
  }, [endpoint, onLogout]);

  useEffect(() => {
    const initialLoad = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(initialLoad);
  }, [load]);

  const renderLead = useCallback(({ item }: { item: BotLead }) => (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={() => onSelectLead(item)}
      style={styles.leadCard}
    >
      <View style={styles.avatar}>
        <Icon name="lead" size={20} color={colors.success} />
      </View>
      <View style={styles.leadBody}>
        <View style={styles.topRow}>
          <Text numberOfLines={1} style={styles.name}>{item.name?.trim() || item.phone}</Text>
          <StatusBadge status={item.status} />
        </View>
        <Text numberOfLines={1} style={styles.phone}>{item.phone}</Text>
        <View style={styles.metaRow}>
          {item.interested_plan ? <Text numberOfLines={1} style={styles.meta}>{item.interested_plan}</Text> : null}
          {item.intent ? <Text numberOfLines={1} style={styles.meta}>{item.intent.replace(/_/g, ' ')}</Text> : null}
          {item.trial_requested ? <Text style={styles.trial}>Trial requested</Text> : null}
        </View>
        <Text style={styles.date}>{formatCreatedAt(item.created_at)}</Text>
      </View>
      <Icon name="forward" size={17} color={colors.muted} />
    </TouchableOpacity>
  ), [onSelectLead]);

  if (loading && leads.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <AppHeader title="Bot Leads" onBack={onBack} />
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
        <AppHeader title="Bot Leads" onBack={onBack} />
        <BotAccessState error={error} onRetry={() => void load()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Bot Leads" subtitle={`${total} total`} onBack={onBack} />
      <FlatList
        contentContainerStyle={styles.listContent}
        data={leads}
        keyExtractor={(item) => String(item.id)}
        ListEmptyComponent={(
          <EmptyState
            icon={<Icon name="lead" size={40} color={colors.muted} />}
            subtitle={search || status !== 'all'
              ? 'Try a different search or lead status.'
              : 'Leads captured by the WhatsApp Bot will appear here.'}
            title={search || status !== 'all' ? 'No matching leads' : 'No leads yet'}
          />
        )}
        ListFooterComponent={totalPages > 1 ? (
          <View style={styles.pagination}>
            <TouchableOpacity
              accessibilityLabel="Previous lead page"
              accessibilityRole="button"
              disabled={page <= 1}
              onPress={() => setPage((current) => current - 1)}
              style={[styles.pageButton, page <= 1 && styles.pageButtonDisabled]}
            >
              <Icon name="back" size={18} color={colors.brand} />
            </TouchableOpacity>
            <Text style={styles.pageLabel}>Page {page} of {totalPages}</Text>
            <TouchableOpacity
              accessibilityLabel="Next lead page"
              accessibilityRole="button"
              disabled={page >= totalPages}
              onPress={() => setPage((current) => current + 1)}
              style={[styles.pageButton, page >= totalPages && styles.pageButtonDisabled]}
            >
              <Icon name="forward" size={18} color={colors.brand} />
            </TouchableOpacity>
          </View>
        ) : null}
        ListHeaderComponent={(
          <View style={styles.listHeader}>
            <Text style={styles.helperText}>Track every enquiry captured by your WhatsApp Bot.</Text>
            <SearchBar
              onChangeText={setSearch}
              placeholder="Search name, phone or plan"
              value={search}
            />
            <FilterChips
              onSelect={(nextStatus) => {
                setStatus(nextStatus);
                setPage(1);
              }}
              options={FILTERS}
              selected={status}
            />
          </View>
        )}
        refreshControl={(
          <RefreshControl
            colors={[colors.brand]}
            onRefresh={() => void load(true)}
            refreshing={refreshing}
          />
        )}
        renderItem={renderLead}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.successSurface,
    borderRadius: radius.full,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  date: {
    color: colors.muted,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
  helperText: {
    color: colors.textSecondary,
    fontSize: fontSize.base,
    lineHeight: 20,
  },
  leadBody: {
    flex: 1,
    marginHorizontal: spacing.md,
  },
  leadCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    padding: spacing.md,
    ...shadows.sm,
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
  meta: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    maxWidth: 112,
    textTransform: 'capitalize',
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xxs,
  },
  name: {
    color: colors.text,
    flex: 1,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    marginRight: spacing.sm,
  },
  pageButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  pageButtonDisabled: {
    opacity: 0.35,
  },
  pageLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  pagination: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.lg,
    justifyContent: 'center',
    paddingTop: spacing.lg,
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
  topRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  trial: {
    color: colors.warningDark,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
});

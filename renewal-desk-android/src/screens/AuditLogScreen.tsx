import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../components/AppHeader';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { CardSkeleton } from '../components/LoadingSkeleton';
import { apiRequest } from '../services/apiClient';
import {
  buildAuditLogsUrl,
  formatAuditAction,
  formatAuditMetadata,
  formatAuditResource,
  hasMoreAuditLogs,
  mergeAuditLogPage,
  type AuditLogItem,
  type AuditLogResponse,
} from '../services/auditLog';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing, fontFamily } from '../theme/tokens';
import { formatDateTime } from '../types';

type AuditLogScreenProps = {
  onBack: () => void;
  onLogout?: () => void;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateFilter(value: string): boolean {
  if (!value.trim()) return true;
  if (!DATE_PATTERN.test(value.trim())) return false;
  return !Number.isNaN(new Date(`${value.trim()}T00:00:00`).getTime());
}

export function AuditLogScreen({ onBack, onLogout }: AuditLogScreenProps) {
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [revision, setRevision] = useState(0);
  // Draft filters (typed) vs applied filters (sent to the API).
  const [actionDraft, setActionDraft] = useState('');
  const [fromDraft, setFromDraft] = useState('');
  const [toDraft, setToDraft] = useState('');
  const [appliedAction, setAppliedAction] = useState('');
  const [appliedFrom, setAppliedFrom] = useState('');
  const [appliedTo, setAppliedTo] = useState('');

  const loadPage = useCallback(async (pageToLoad: number, append: boolean) => {
    const res = await apiRequest<AuditLogResponse>(buildAuditLogsUrl({
      page: pageToLoad,
      per_page: 20,
      action: appliedAction,
      from: appliedFrom,
      to: appliedTo,
    }));
    if (res.ok) {
      const pageItems = res.data.items ?? [];
      setItems((prev) => (append ? mergeAuditLogPage(prev, pageItems) : pageItems));
      // Contract shape is top-level page/per_page/total; tolerate a
      // nested pagination object if the backend ever sends one.
      setTotal(res.data.total ?? res.data.pagination?.total ?? pageItems.length);
      setPage(res.data.page ?? pageToLoad);
      setError(undefined);
    } else {
      if (res.error.status === 401 && onLogout) { onLogout(); return; }
      setError(res.error.message);
    }
    setLoading(false);
    setRefreshing(false);
    setLoadingMore(false);
  }, [appliedAction, appliedFrom, appliedTo, onLogout]);

  useEffect(() => {
    setLoading(true);
    void loadPage(1, false);
  }, [revision, loadPage]);

  const applyFilters = useCallback(() => {
    if (!isValidDateFilter(fromDraft) || !isValidDateFilter(toDraft)) {
      Alert.alert('Invalid date', 'Use YYYY-MM-DD for the from / to dates, or leave them blank.');
      return;
    }
    setAppliedAction(actionDraft.trim());
    setAppliedFrom(fromDraft.trim());
    setAppliedTo(toDraft.trim());
    setItems([]);
    setTotal(0);
    setPage(1);
    setRevision((r) => r + 1);
  }, [actionDraft, fromDraft, toDraft]);

  const clearFilters = useCallback(() => {
    setActionDraft('');
    setFromDraft('');
    setToDraft('');
    setAppliedAction('');
    setAppliedFrom('');
    setAppliedTo('');
    setItems([]);
    setTotal(0);
    setPage(1);
    setRevision((r) => r + 1);
  }, []);

  const handleLoadMore = useCallback(() => {
    if (loadingMore || !hasMoreAuditLogs(total, items.length)) return;
    setLoadingMore(true);
    void loadPage(page + 1, true);
  }, [loadingMore, total, items.length, page, loadPage]);

  const filtersActive = appliedAction !== '' || appliedFrom !== '' || appliedTo !== '';

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Audit Log" subtitle="Owner activity" onBack={onBack} />

      <View style={styles.filterCard}>
        <TextInput
          style={styles.filterInput}
          value={actionDraft}
          onChangeText={setActionDraft}
          placeholder="Filter by action (e.g. member_blocked)"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={applyFilters}
        />
        <View style={styles.dateRow}>
          <TextInput
            style={[styles.filterInput, styles.dateInput]}
            value={fromDraft}
            onChangeText={setFromDraft}
            placeholder="From YYYY-MM-DD"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={[styles.filterInput, styles.dateInput]}
            value={toDraft}
            onChangeText={setToDraft}
            placeholder="To YYYY-MM-DD"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <View style={styles.filterActions}>
          <TouchableOpacity style={styles.applyBtn} onPress={applyFilters} activeOpacity={0.7}>
            <Text style={styles.applyBtnText}>Apply filters</Text>
          </TouchableOpacity>
          {filtersActive || actionDraft !== '' || fromDraft !== '' || toDraft !== '' ? (
            <TouchableOpacity style={styles.clearBtn} onPress={clearFilters} activeOpacity={0.7}>
              <Text style={styles.clearBtnText}>Clear</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

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
          data={items}
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
              icon={<Icon name="document" size={40} color={colors.muted} />}
              title="No audit entries"
              message={filtersActive
                ? 'Nothing matches these filters. Clear them to see the full log.'
                : 'Owner and staff actions will appear here.'}
            />
          }
          ListFooterComponent={
            total > 0 ? (
              <View style={styles.footer}>
                <Text style={styles.footerText}>
                  Showing {items.length} of {total}
                </Text>
                {hasMoreAuditLogs(total, items.length) ? (
                  <TouchableOpacity
                    style={styles.loadMoreBtn}
                    onPress={handleLoadMore}
                    disabled={loadingMore}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.loadMoreText}>{loadingMore ? 'Loading…' : 'Load more'}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : undefined
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowHeader}>
                <Text style={styles.action} numberOfLines={1}>{formatAuditAction(item.action)}</Text>
                <Text style={styles.time}>{formatDateTime(item.created_at)}</Text>
              </View>
              <Text style={styles.actor} numberOfLines={1}>
                {item.actor_name ?? 'Unknown actor'} · {formatAuditResource(item)}
              </Text>
              <Text style={styles.metadata} numberOfLines={2}>
                {formatAuditMetadata(item.metadata)}
              </Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  filterCard: {
    backgroundColor: colors.card,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  filterInput: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: fontSize.base,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  dateRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  dateInput: {
    flex: 1,
  },
  filterActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  applyBtn: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  applyBtnText: {
    color: colors.textInverse,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  clearBtn: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  clearBtnText: {
    color: colors.brand,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  listContent: {
    gap: spacing.sm,
    padding: spacing.lg,
    paddingBottom: spacing.bottomTabSafe,
  },
  footer: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  footerText: {
    color: colors.muted,
    fontSize: fontSize.sm,
  },
  loadMoreBtn: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  loadMoreText: {
    color: colors.brand,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  row: {
    backgroundColor: colors.card,
    borderColor: colors.borderLight,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 2,
    padding: spacing.md,
    ...shadows.sm,
  },
  rowHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  action: {
    color: colors.text,
    flex: 1,
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
  time: {
    color: colors.muted,
    fontSize: fontSize.xs,
    marginLeft: spacing.xs,
  },
  actor: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
  metadata: {
    color: colors.muted,
    fontSize: fontSize.sm,
    lineHeight: 18,
  },
});

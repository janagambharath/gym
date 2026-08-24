import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Avatar } from '../components/Avatar';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { FilterChips } from '../components/FilterChips';
import { CardSkeleton } from '../components/LoadingSkeleton';
import { SearchBar } from '../components/SearchBar';
import { StatusBadge } from '../components/StatusBadge';
import { apiRequest } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, spacing } from '../theme/tokens';
import type { Member, MembersResponse } from '../types';
import { formatDate, getDaysText, getMemberDisplayStatus } from '../types';

type MembersScreenProps = {
  onLogout: () => void;
  onSelectMember?: (member: Member) => void;
  onAddMember?: () => void;
  refreshToken?: number;
};

const FILTER_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active', dotColor: colors.statusActive },
  { key: 'expiring', label: 'Expiring', dotColor: colors.statusExpiring },
  { key: 'expired', label: 'Expired', dotColor: colors.statusExpired },
];

export function MembersScreen({ onLogout, onSelectMember, onAddMember, refreshToken }: MembersScreenProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [error, setError] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [requestRevision, setRequestRevision] = useState(0);
  const [completedRequestKey, setCompletedRequestKey] = useState<string | undefined>();
  const requestKey = `${page}:${debouncedSearch}:${statusFilter}:${refreshToken ?? ''}:${requestRevision}`;
  const loading = completedRequestKey !== requestKey;

  const handleSearch = useCallback((text: string) => {
    setSearch(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(text);
      setPage(1);
    }, 400);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const params = new URLSearchParams({ page: String(page), page_size: '20' });
    if (debouncedSearch.trim()) {
      params.set('q', debouncedSearch.trim());
    }
    if (statusFilter !== 'all' && statusFilter !== 'expiring') {
      params.set('status', statusFilter);
    }

    void apiRequest<MembersResponse>(`/api/mobile/v1/members?${params.toString()}`).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        let filtered = result.data.members;
        // Client-side filter for "expiring" (backend doesn't have this status filter)
        if (statusFilter === 'expiring') {
          filtered = filtered.filter(
            (m) => m.days_until_expiry !== null && m.days_until_expiry >= 0 && m.days_until_expiry <= 7,
          );
        }
        setMembers(filtered);
        setTotalPages(result.data.pagination.total_pages);
        setTotalCount(result.data.pagination.total);
        setError(undefined);
      } else {
        if (result.error.status === 401) { onLogout(); return; }
        setError(result.error.message);
      }
      setCompletedRequestKey(requestKey);
    });

    return () => { cancelled = true; };
  }, [page, debouncedSearch, statusFilter, refreshToken, requestKey, onLogout]);

  const renderMember = useCallback(({ item }: { item: Member }) => {
    const displayStatus = getMemberDisplayStatus(item);
    const daysText = getDaysText(item.days_until_expiry);

    return (
      <TouchableOpacity
        style={styles.memberRow}
        onPress={() => onSelectMember?.(item)}
        activeOpacity={0.6}
      >
        <Avatar name={item.full_name} size={40} />
        <View style={styles.memberInfo}>
          <Text style={styles.memberName} numberOfLines={1}>{item.full_name}</Text>
          <Text style={styles.memberPhone}>{item.phone}</Text>
          {item.plan ? (
            <Text style={styles.memberPlan}>
              {item.plan.name} · {item.plan.duration_days}d
            </Text>
          ) : null}
        </View>
        <View style={styles.memberRight}>
          <Text style={styles.memberExpiry}>{formatDate(item.membership_end)}</Text>
          {daysText ? (
            <Text style={[
              styles.memberDays,
              {
                color: item.days_until_expiry !== null && item.days_until_expiry <= 0
                  ? colors.statusExpired
                  : item.days_until_expiry !== null && item.days_until_expiry <= 7
                    ? colors.statusExpiring
                    : colors.statusActive,
              },
            ]}>
              {daysText}
            </Text>
          ) : null}
          <StatusBadge status={displayStatus} />
        </View>
      </TouchableOpacity>
    );
  }, [onSelectMember]);

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Members</Text>
          <Text style={styles.headerSubtitle}>{totalCount} members</Text>
        </View>
        {onAddMember ? (
          <TouchableOpacity
            accessibilityLabel="Add member"
            accessibilityRole="button"
            onPress={onAddMember}
            style={styles.addButton}
          >
            <Text style={styles.addButtonText}>+ Add Member</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <SearchBar
          value={search}
          onChangeText={handleSearch}
          placeholder="Search name, phone or member ID"
        />
      </View>

      {/* Filters */}
      <FilterChips
        options={FILTER_OPTIONS}
        selected={statusFilter}
        onSelect={(key) => { setStatusFilter(key); setPage(1); }}
      />

      {/* List */}
      {loading ? (
        <View style={styles.skeletonContainer}>
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </View>
      ) : error ? (
        <ErrorState message={error} onRetry={() => { setPage(1); setRequestRevision((revision) => revision + 1); }} />
      ) : members.length === 0 ? (
        <EmptyState
          icon={<Icon name="members" size={40} color={colors.muted} />}
          title={search ? 'No results' : 'No members yet'}
          subtitle={search ? 'No members found matching your search.' : 'Add your first member to get started.'}
          actionLabel={search ? undefined : 'Add Member'}
          onAction={onAddMember}
        />
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={members}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderMember}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}

      {/* Pagination */}
      {totalPages > 1 && !loading ? (
        <View style={styles.pagination}>
          <TouchableOpacity
            disabled={page <= 1}
            onPress={() => setPage((p) => p - 1)}
            style={[styles.pageButton, page <= 1 && styles.pageButtonDisabled]}
          >
            <Text style={styles.pageButtonText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.pageInfo}>
            Page {page} of {totalPages}
          </Text>
          <TouchableOpacity
            disabled={page >= totalPages}
            onPress={() => setPage((p) => p + 1)}
            style={[styles.pageButton, page >= totalPages && styles.pageButtonDisabled]}
          >
            <Text style={styles.pageButtonText}>›</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

export type { Member };

const styles = StyleSheet.create({
  addButton: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  addButtonText: {
    color: colors.textInverse,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  header: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  headerSubtitle: {
    color: colors.muted,
    fontSize: fontSize.md,
    marginTop: spacing.xxs,
  },
  headerTitle: {
    color: colors.text,
    fontSize: fontSize['4xl'],
    fontWeight: fontWeight.extrabold,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  memberDays: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
  memberExpiry: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontVariant: ['tabular-nums'],
  },
  memberInfo: {
    flex: 1,
    marginLeft: spacing.md,
  },
  memberName: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  memberPhone: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    marginTop: 1,
  },
  memberPlan: {
    color: colors.muted,
    fontSize: fontSize.sm,
    marginTop: 1,
  },
  memberRight: {
    alignItems: 'flex-end',
    gap: spacing.xxs,
    marginLeft: spacing.sm,
  },
  memberRow: {
    alignItems: 'center',
    flexDirection: 'row',
    paddingVertical: spacing.md,
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
    opacity: 0.3,
  },
  pageButtonText: {
    color: colors.brand,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
  },
  pageInfo: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
  },
  pagination: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.lg,
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  searchContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  separator: {
    backgroundColor: colors.borderLight,
    height: 1,
  },
  skeletonContainer: {
    gap: spacing.md,
    padding: spacing.lg,
  },
});

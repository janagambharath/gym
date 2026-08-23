import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { apiRequest } from '../services/apiClient';
import { colors, radius, spacing } from '../theme/tokens';

// Matches actual backend /api/mobile/v1/members response (unwrapped)
type Member = {
  id: number;
  full_name: string;
  phone: string;
  email: string | null;
  gender: string | null;
  status: 'active' | 'expired' | 'deleted';
  membership_start: string | null;
  membership_end: string | null;
  days_until_expiry: number | null;
  plan: { id: number; name: string; duration_days: number; price: string } | null;
  joined_on: string | null;
  notes: string | null;
  whatsapp_opted_in: boolean;
  has_biometric: boolean;
};

type MembersResponse = {
  members: Member[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
};

type MembersScreenProps = {
  onBack: () => void;
  onLogout: () => void;
  onSelectMember?: (member: Member) => void;
};

const STATUS_COLORS: Record<string, string> = {
  active: colors.success,
  expired: colors.critical,
  deleted: colors.muted,
};

export function MembersScreen({ onBack, onLogout, onSelectMember }: MembersScreenProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search input
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
    setLoading(true);

    const params = new URLSearchParams({ page: String(page), page_size: '20' });
    if (debouncedSearch.trim()) {
      params.set('q', debouncedSearch.trim());
    }
    if (statusFilter !== 'all') {
      params.set('status', statusFilter);
    }

    apiRequest<MembersResponse>(`/api/mobile/v1/members?${params.toString()}`).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setMembers(result.data.members);
        setTotalPages(result.data.pagination.total_pages);
        setError(undefined);
      } else {
        if (result.error.status === 401) {
          onLogout();
          return;
        }
        setError(result.error.message);
      }
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [page, debouncedSearch, statusFilter, onLogout]);

  const handleStatusFilter = useCallback((status: string) => {
    setStatusFilter(status);
    setPage(1);
  }, []);

  const renderMember = useCallback(({ item }: { item: Member }) => {
    const daysText = item.days_until_expiry !== null && item.days_until_expiry !== undefined
      ? item.days_until_expiry > 0
        ? `${item.days_until_expiry}d left`
        : item.days_until_expiry === 0
          ? 'Expires today'
          : `${Math.abs(item.days_until_expiry)}d overdue`
      : null;

    return (
      <TouchableOpacity
        style={styles.memberCard}
        onPress={() => onSelectMember?.(item)}
        activeOpacity={onSelectMember ? 0.7 : 1}
      >
        <View style={styles.memberHeader}>
          <Text style={styles.memberName} numberOfLines={1}>{item.full_name}</Text>
          <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.status] ?? colors.muted }]}>
            <Text style={styles.statusText}>{item.status.toUpperCase()}</Text>
          </View>
        </View>
        <Text style={styles.memberDetail}>📱 {item.phone}</Text>
        {item.plan ? (
          <Text style={styles.memberDetail}>📋 {item.plan.name} · ₹{item.plan.price}</Text>
        ) : null}
        {item.membership_end ? (
          <View style={styles.expiryRow}>
            <Text style={styles.memberDetail}>
              📅 {new Date(item.membership_end).toLocaleDateString('en-IN')}
            </Text>
            {daysText ? (
              <Text style={[
                styles.daysTag,
                item.days_until_expiry !== null && item.days_until_expiry <= 0
                  ? { backgroundColor: colors.criticalSurface, color: colors.critical }
                  : item.days_until_expiry !== null && item.days_until_expiry <= 7
                    ? { backgroundColor: colors.warningSurface, color: colors.warning }
                    : { backgroundColor: colors.successSurface, color: colors.success },
              ]}>
                {daysText}
              </Text>
            ) : null}
          </View>
        ) : null}
      </TouchableOpacity>
    );
  }, [onSelectMember]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.topBar}>
        <TouchableOpacity
          accessibilityLabel="Go back"
          onPress={onBack}
          style={styles.backButton}
        >
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Members</Text>
        <View style={styles.backButton} />
      </View>

      <View style={styles.searchContainer}>
        <TextInput
          accessibilityLabel="Search members"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={handleSearch}
          placeholder="Search by name or phone..."
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
          value={search}
        />
      </View>

      <View style={styles.filterRow}>
        {['all', 'active', 'expired'].map((status) => (
          <TouchableOpacity
            key={status}
            onPress={() => handleStatusFilter(status)}
            style={[
              styles.filterChip,
              statusFilter === status && styles.filterChipActive,
            ]}
          >
            <Text
              style={[
                styles.filterChipText,
                statusFilter === status && styles.filterChipTextActive,
              ]}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator
          accessibilityLabel="Loading members"
          color={colors.brand}
          size="large"
          style={styles.spinner}
        />
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => setPage(1)} style={styles.retryButton}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : members.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>👥</Text>
          <Text style={styles.emptyText}>
            {search ? 'No members found matching your search.' : 'No members yet.'}
          </Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={members}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderMember}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
        />
      )}

      {totalPages > 1 ? (
        <View style={styles.pagination}>
          <TouchableOpacity
            disabled={page <= 1}
            onPress={() => setPage((p) => p - 1)}
            style={[styles.pageButton, page <= 1 && styles.pageButtonDisabled]}
          >
            <Text style={styles.pageButtonText}>Previous</Text>
          </TouchableOpacity>
          <Text style={styles.pageInfo}>
            Page {page} of {totalPages}
          </Text>
          <TouchableOpacity
            disabled={page >= totalPages}
            onPress={() => setPage((p) => p + 1)}
            style={[styles.pageButton, page >= totalPages && styles.pageButtonDisabled]}
          >
            <Text style={styles.pageButtonText}>Next</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

export type { Member };

const styles = StyleSheet.create({
  backButton: {
    minWidth: 60,
  },
  backText: {
    color: colors.brand,
    fontSize: 15,
    fontWeight: '600',
  },
  daysTag: {
    borderRadius: 6,
    fontSize: 12,
    fontWeight: '700',
    marginLeft: spacing.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  emptyContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.sm,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 15,
    textAlign: 'center',
  },
  errorContainer: {
    alignItems: 'center',
    margin: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.criticalSurface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#FDA29B',
  },
  errorText: {
    color: colors.critical,
    fontSize: 14,
  },
  expiryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 2,
  },
  filterChip: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  filterChipActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  filterChipText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  listContent: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  memberCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  memberDetail: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 2,
  },
  memberHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  memberName: {
    color: colors.text,
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    marginRight: spacing.sm,
  },
  pageButton: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  pageButtonDisabled: {
    opacity: 0.4,
  },
  pageButtonText: {
    color: colors.brand,
    fontSize: 13,
    fontWeight: '600',
  },
  pageInfo: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  pagination: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  retryButton: {
    backgroundColor: colors.brand,
    borderRadius: radius.sm,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  searchContainer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  searchInput: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  spinner: {
    flex: 1,
    justifyContent: 'center',
  },
  statusBadge: {
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  topBar: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  topBarTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
});

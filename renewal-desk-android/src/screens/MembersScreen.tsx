import { useCallback, useEffect, useState } from 'react';
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

type Member = {
  id: number;
  full_name: string;
  phone: string;
  status: 'active' | 'expired' | 'inactive';
  membership_end: string | null;
  plan_name: string | null;
};

type MembersResponse = {
  members: Member[];
  total: number;
  page: number;
  pages: number;
};

type MembersScreenProps = {
  onBack: () => void;
  onLogout: () => void;
};

const STATUS_COLORS: Record<string, string> = {
  active: colors.success,
  expired: colors.critical,
  inactive: colors.muted,
};

async function loadMembers(
  pageNum: number,
  searchQuery: string,
  status: string,
): Promise<
  { ok: true; data: MembersResponse } | { ok: false; message: string; status?: number }
> {
  const params = new URLSearchParams({ page: String(pageNum), per_page: '20' });
  if (searchQuery.trim()) {
    params.set('search', searchQuery.trim());
  }
  if (status !== 'all') {
    params.set('status', status);
  }

  const result = await apiRequest<MembersResponse>(
    `/api/mobile/v1/members?${params.toString()}`,
  );
  if (result.ok) {
    return result;
  }
  return { ok: false, message: result.error.message, status: result.error.status };
}

export function MembersScreen({ onBack, onLogout }: MembersScreenProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    let cancelled = false;

    loadMembers(page, search, statusFilter).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setMembers(result.data.members);
        setPage(result.data.page);
        setTotalPages(result.data.pages);
        setError(undefined);
      } else {
        if (result.status === 401) {
          onLogout();
          return;
        }
        setError(result.message);
      }
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [page, search, statusFilter, onLogout]);

  const handleSearch = useCallback((text: string) => {
    setLoading(true);
    setSearch(text);
    setPage(1);
  }, []);

  const handleStatusFilter = useCallback((status: string) => {
    setLoading(true);
    setStatusFilter(status);
    setPage(1);
  }, []);

  const renderMember = useCallback(({ item }: { item: Member }) => (
    <View style={styles.memberCard}>
      <View style={styles.memberHeader}>
        <Text style={styles.memberName} numberOfLines={1}>{item.full_name}</Text>
        <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.status] ?? colors.muted }]}>
          <Text style={styles.statusText}>{item.status.toUpperCase()}</Text>
        </View>
      </View>
      <Text style={styles.memberDetail}>{item.phone}</Text>
      {item.plan_name ? (
        <Text style={styles.memberDetail}>{item.plan_name}</Text>
      ) : null}
      {item.membership_end ? (
        <Text style={styles.memberDetail}>
          Expires: {new Date(item.membership_end).toLocaleDateString('en-IN')}
        </Text>
      ) : null}
    </View>
  ), []);

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
        {['all', 'active', 'expired', 'inactive'].map((status) => (
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
        </View>
      ) : members.length === 0 ? (
        <View style={styles.emptyContainer}>
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

const styles = StyleSheet.create({
  backButton: {
    minWidth: 60,
  },
  backText: {
    color: colors.brand,
    fontSize: 15,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 15,
    textAlign: 'center',
  },
  errorContainer: {
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

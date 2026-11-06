import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../components/AppHeader';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { PrimaryButton } from '../components/PrimaryButton';
import { SearchBar } from '../components/SearchBar';
import { StatusBadge } from '../components/StatusBadge';
import { apiRequest, getCachedSession } from '../services/apiClient';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import { formatDate, type Member, type Pagination } from '../types';

type BulkDeactivateScreenProps = {
  onBack: () => void;
  onLogout: () => void;
};

/**
 * Bulk Terminal Deactivation — select members and deactivate them in one
 * batch. Mirrors the PWA rrr-delete-members flow: server-paginated,
 * searchable member list (page_size=50), select-all, then one POST
 * /api/mobile/v1/members/<id>/deactivate per selected member. Records are
 * kept, not permanently deleted; deactivation ends the membership and
 * blocks terminal access. Owner-only, like the single-member deactivate
 * on the member detail screen.
 */
export function BulkDeactivateScreen({ onBack, onLogout }: BulkDeactivateScreenProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [result, setResult] = useState<string | undefined>();
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // V5-L33: sequence guard — only the latest search may apply its
  // results, so a slow response for an older query can never overwrite
  // newer results (same pattern as AccessScreen's eventsSeqRef).
  const loadSeqRef = useRef(0);

  const isOwner = getCachedSession()?.userRole === 'gym_owner';

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 400);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => () => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
  }, []);

  const load = useCallback(async (nextPage: number, search: string, append: boolean) => {
    const seq = ++loadSeqRef.current;
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    // V5-L34: filter to terminal-enrolled members — the empty state
    // promises "No members with terminal enroll numbers", so the list
    // must not show members with no enroll number to deactivate.
    const res = await apiRequest<{ members: Member[]; pagination?: Pagination }>(
      `/api/mobile/v1/members?biometric=enrolled&page=${nextPage}&page_size=50${search ? `&q=${encodeURIComponent(search)}` : ''}`,
    );
    if (seq !== loadSeqRef.current) return;
    if (!res.ok && res.error.status === 401) {
      onLogout();
      return;
    }
    if (res.ok) {
      // V6-L34: dedupe appended members by id — a member added between
      // page fetches used to duplicate at the boundary.
      setMembers((current) => {
        if (!append) return res.data.members || [];
        const seen = new Set(current.map((m) => m.id));
        return [...current, ...(res.data.members || []).filter((m) => !seen.has(m.id))];
      });
      setTotal(res.data.pagination?.total ?? res.data.members?.length ?? 0);
      setTotalPages(res.data.pagination?.total_pages ?? 1);
      setPage(nextPage);
      setError(undefined);
    } else if (!append) {
      setError(res.error.message);
    } else {
      // V6-L34: an append failure used to be silent — the user just saw
      // nothing happen. The page isn't advanced, so tapping again
      // retries, but now with feedback.
      Alert.alert('Could not load more', res.error.message);
    }
    setLoading(false);
    setLoadingMore(false);
    setRefreshing(false);
  }, [onLogout]);

  useEffect(() => {
    setSelected(new Set());
    void load(1, debouncedQuery, false);
  }, [debouncedQuery, load]);

  const toggleMember = (id: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((current) =>
      current.size === members.length ? new Set() : new Set(members.map((m) => m.id)),
    );
  };

  const handleDeactivate = async () => {
    setShowConfirm(false);
    setDeactivating(true);
    setResult(undefined);
    let success = 0;
    const failedNames: string[] = [];
    const selectedMembers = members.filter((m) => selected.has(m.id));
    // One stable key per member per batch: a retry of this batch after a
    // timeout must not deactivate the same member twice. NOTE: the
    // backend deactivate endpoint does not honour Idempotency-Key yet
    // (no idempotency handling in app/mobile_api/members.py) — the
    // header is sent so the endpoint can honour it without a client
    // change; until then the soft-delete is itself idempotent-ish
    // (re-deactivating an already-deleted member 404s, not double-acts).
    const batchKey = `bulk-deactivate-${Date.now()}`;
    for (const member of selectedMembers) {
      try {
        const res = await apiRequest(`/api/mobile/v1/members/${member.id}/deactivate`, {
          method: 'POST',
          headers: { 'Idempotency-Key': `${batchKey}-${member.id}` },
        });
        if (res.ok) success += 1;
        else failedNames.push(member.full_name || `ID ${member.id}`);
      } catch {
        failedNames.push(member.full_name || `ID ${member.id}`);
      }
    }
    setDeactivating(false);
    setSelected(new Set());
    // V5-L34: name the failures instead of a bare count — the owner
    // needs to know WHO is still active, not just how many failed.
    setResult(
      failedNames.length > 0
        ? `✓ ${success} deactivated, ⚠ ${failedNames.length} failed: ${failedNames.slice(0, 5).join(', ')}${failedNames.length > 5 ? ` +${failedNames.length - 5} more` : ''}`
        : `✓ All ${success} deactivated`,
    );
    reloadTimerRef.current = setTimeout(() => void load(1, debouncedQuery, false), 2000);
  };

  const selectedCount = selected.size;
  const allSelected = members.length > 0 && selectedCount === members.length;

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Deactivate Members" onBack={onBack} />
      <View style={styles.hero}>
        <Text style={styles.heroCopy}>
          Select members to deactivate in Renewal Desk. Deactivation ends their membership and blocks
          terminal access — their records are kept, not permanently deleted.
        </Text>
      </View>
      <SearchBar placeholder="Search by name or phone…" value={query} onChangeText={setQuery} />
      {loading ? (
        <LoadingSkeleton lines={6} height={18} />
      ) : error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            void load(1, debouncedQuery, false);
          }}
        />
      ) : (
        <>
          <Text style={styles.countLine}>
            Showing {members.length} of {total} members
          </Text>
          {isOwner ? (
            <View style={styles.toolbar}>
              <TouchableOpacity style={styles.selectAllRow} onPress={toggleSelectAll} activeOpacity={0.7}>
                <View style={[styles.checkbox, allSelected && styles.checkboxChecked]}>
                  {allSelected ? <Text style={styles.checkMark}>✓</Text> : null}
                </View>
                {/* V5-L34: "Select all" only ever selected the loaded
                    page — label it honestly instead of implying all Y. */}
                <Text style={styles.selectAllText}>Select all on this page ({members.length})</Text>
              </TouchableOpacity>
              <Text style={styles.selectedCount}>{selectedCount} selected</Text>
            </View>
          ) : (
            <Text style={styles.ownerNote}>Only the gym owner can deactivate members.</Text>
          )}
          {result ? <Text style={styles.result}>{result}</Text> : null}
          <ScrollView
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            style={styles.list}
            refreshControl={
              <RefreshControl
                colors={[colors.brand]}
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  void load(1, debouncedQuery, false);
                }}
              />
            }
          >
            {members.length === 0 ? (
              <EmptyState
                title="No members"
                subtitle="No members with terminal enroll numbers."
              />
            ) : (
              members.map((member) => {
                const checked = selected.has(member.id);
                const row = (
                  <>
                    {isOwner ? (
                      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                        {checked ? <Text style={styles.checkMark}>✓</Text> : null}
                      </View>
                    ) : null}
                    <View style={styles.memberInfo}>
                      <Text style={styles.memberName}>{member.full_name || 'Unknown'}</Text>
                      <Text style={styles.memberMeta}>
                        ID {member.device_enroll_number || ''} · {member.status}
                        {member.membership_end ? ` · ends ${formatDate(member.membership_end)}` : ''}
                      </Text>
                    </View>
                    {member.status === 'expired' ? <StatusBadge status="expired" /> : null}
                  </>
                );
                return isOwner ? (
                  <TouchableOpacity
                    key={member.id}
                    style={styles.memberRow}
                    onPress={() => toggleMember(member.id)}
                    activeOpacity={0.7}
                  >
                    {row}
                  </TouchableOpacity>
                ) : (
                  <View key={member.id} style={styles.memberRow}>
                    {row}
                  </View>
                );
              })
            )}
            {page < totalPages ? (
              <PrimaryButton
                label={loadingMore ? 'Loading…' : 'Load more members'}
                onPress={() => void load(page + 1, debouncedQuery, true)}
                loading={loadingMore}
                disabled={loadingMore}
              />
            ) : null}
          </ScrollView>
          {isOwner ? (
            <View style={styles.footer}>
              <PrimaryButton
                title={
                  selectedCount > 0
                    ? `🗑️ Deactivate ${selectedCount} member${selectedCount === 1 ? '' : 's'}`
                    : '🗑️ Deactivate Selected'
                }
                onPress={() => setShowConfirm(true)}
                variant="danger"
                disabled={selectedCount === 0 || deactivating}
                loading={deactivating}
                fullWidth
              />
            </View>
          ) : null}
        </>
      )}

      <ConfirmDialog
        visible={showConfirm}
        title={`Deactivate ${selectedCount} member${selectedCount === 1 ? '' : 's'}?`}
        message="Their membership ends and terminal access is blocked. Records are kept."
        confirmLabel="Deactivate"
        confirmVariant="danger"
        loading={deactivating}
        onConfirm={() => void handleDeactivate()}
        onCancel={() => setShowConfirm(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  hero: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  heroCopy: { color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 19 },
  countLine: { color: colors.muted, fontSize: fontSize.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  toolbar: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  selectAllRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  selectAllText: { color: colors.text, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  selectedCount: { color: colors.muted, fontSize: fontSize.sm },
  ownerNote: { color: colors.muted, fontSize: fontSize.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  result: {
    color: colors.successDark,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    textAlign: 'center',
  },
  listContent: { gap: spacing.xs, padding: spacing.lg, paddingBottom: spacing.bottomTabSafe },
  list: { flex: 1 },
  memberRow: {
    alignItems: 'center',
    borderBottomColor: colors.borderLight,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.xs,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  checkboxChecked: { backgroundColor: colors.critical, borderColor: colors.critical },
  checkMark: { color: colors.textInverse, fontSize: 14, fontWeight: fontWeight.bold },
  memberInfo: { flex: 1, minWidth: 0 },
  memberName: { color: colors.text, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  memberMeta: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 2 },
  footer: {
    backgroundColor: colors.card,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    padding: spacing.lg,
  },
});

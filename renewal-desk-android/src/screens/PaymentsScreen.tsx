import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { apiRequest } from '../services/apiClient';
import { colors, radius, spacing } from '../theme/tokens';

type Payment = {
  id: number;
  member_id: number;
  member_name: string | null;
  amount: string;
  paid_on: string | null;
  method: string;
  reference: string | null;
  status: string;
  renewal_days: number | null;
  notes: string | null;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string | null;
};

type PaymentsResponse = {
  payments: Payment[];
  pagination: { page: number; page_size: number; total: number; total_pages: number };
};

type PaymentsScreenProps = {
  onBack: () => void;
  onLogout: () => void;
};

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  pending: { bg: colors.warningSurface, text: colors.warning },
  verified: { bg: colors.successSurface, text: colors.success },
  rejected: { bg: colors.criticalSurface, text: colors.critical },
};

export function PaymentsScreen({ onBack, onLogout }: PaymentsScreenProps) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page), page_size: '20' });
    if (statusFilter !== 'all') params.set('status', statusFilter);

    void apiRequest<PaymentsResponse>(`/api/mobile/v1/payments?${params.toString()}`).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setPayments(result.data.payments);
        setError(undefined);
      } else {
        if (result.error.status === 401) { onLogout(); return; }
        setError(result.error.message);
      }
      setLoading(false);
      setRefreshing(false);
    });

    return () => { cancelled = true; };
  }, [page, statusFilter, revision, onLogout]);

  const handleVerify = useCallback(async (paymentId: number) => {
    setActionLoading(paymentId);
    const result = await apiRequest<{ message: string }>(`/api/mobile/v1/payments/${paymentId}/verify`, { method: 'POST' });
    if (result.ok) {
      setRevision((r) => r + 1);
    } else {
      if (result.error.status === 401) { onLogout(); return; }
      setError(result.error.message);
    }
    setActionLoading(null);
  }, [onLogout]);

  const handleReject = useCallback(async (paymentId: number) => {
    setActionLoading(paymentId);
    const result = await apiRequest<{ message: string }>(`/api/mobile/v1/payments/${paymentId}/reject`, { method: 'POST' });
    if (result.ok) {
      setRevision((r) => r + 1);
    } else {
      if (result.error.status === 401) { onLogout(); return; }
      setError(result.error.message);
    }
    setActionLoading(null);
  }, [onLogout]);

  const renderPayment = useCallback(({ item }: { item: Payment }) => {
    const style = STATUS_STYLES[item.status] ?? STATUS_STYLES.pending;
    const isPending = item.status === 'pending';

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.memberName} numberOfLines={1}>{item.member_name ?? `Member #${item.member_id}`}</Text>
          <View style={[styles.badge, { backgroundColor: style.bg }]}>
            <Text style={[styles.badgeText, { color: style.text }]}>{item.status.toUpperCase()}</Text>
          </View>
        </View>
        <Text style={styles.amount}>₹{Number(item.amount).toLocaleString('en-IN')}</Text>
        <Text style={styles.detail}>{item.method.toUpperCase()} · {item.paid_on ? new Date(item.paid_on).toLocaleDateString('en-IN') : '—'}</Text>
        {item.reference ? <Text style={styles.detail}>Ref: {item.reference}</Text> : null}
        {item.renewal_days ? <Text style={styles.detail}>Renewal: {item.renewal_days} days</Text> : null}
        {item.verified_by ? <Text style={styles.detail}>By: {item.verified_by}</Text> : null}

        {isPending ? (
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.success }]}
              onPress={() => void handleVerify(item.id)}
              disabled={actionLoading === item.id}
            >
              {actionLoading === item.id ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={styles.actionBtnText}>✓ Verify</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: colors.critical }]}
              onPress={() => void handleReject(item.id)}
              disabled={actionLoading === item.id}
            >
              <Text style={styles.actionBtnText}>✗ Reject</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  }, [actionLoading, handleVerify, handleReject]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Payments</Text>
        <View style={styles.backButton} />
      </View>

      <View style={styles.filterRow}>
        {['all', 'pending', 'verified', 'rejected'].map((s) => (
          <TouchableOpacity key={s} onPress={() => { setStatusFilter(s); setPage(1); }}
            style={[styles.filterChip, statusFilter === s && styles.filterChipActive]}>
            <Text style={[styles.filterChipText, statusFilter === s && styles.filterChipTextActive]}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading && !refreshing ? (
        <ActivityIndicator color={colors.brand} size="large" style={styles.spinner} />
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : payments.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>💳</Text>
          <Text style={styles.emptyText}>No payments found.</Text>
        </View>
      ) : (
        <FlatList
          data={payments}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderPayment}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setRevision((r) => r + 1); }} colors={[colors.brand]} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  actionBtn: { alignItems: 'center', borderRadius: radius.sm, flex: 1, minHeight: 36, justifyContent: 'center' },
  actionBtnText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  actionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  amount: { color: colors.text, fontSize: 22, fontWeight: '800', marginTop: spacing.xs },
  backButton: { minWidth: 60 },
  backText: { color: colors.brand, fontSize: 15, fontWeight: '600' },
  badge: { borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  card: { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, padding: spacing.md },
  cardHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  detail: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  emptyContainer: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: spacing.xl },
  emptyIcon: { fontSize: 48, marginBottom: spacing.sm },
  emptyText: { color: colors.muted, fontSize: 15 },
  errorContainer: { backgroundColor: colors.criticalSurface, borderColor: '#FDA29B', borderRadius: radius.md, borderWidth: 1, margin: spacing.md, padding: spacing.md },
  errorText: { color: colors.critical, fontSize: 14 },
  filterChip: { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  filterChipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  filterChipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  filterChipTextActive: { color: '#FFF' },
  filterRow: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  listContent: { gap: spacing.sm, padding: spacing.md },
  memberName: { color: colors.text, flex: 1, fontSize: 16, fontWeight: '700', marginRight: spacing.sm },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  spinner: { flex: 1, justifyContent: 'center' },
  topBar: { alignItems: 'center', borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  topBarTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
});

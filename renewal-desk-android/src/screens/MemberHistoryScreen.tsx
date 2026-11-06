import { useCallback, useEffect, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../components/AppHeader';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { InfoRow } from '../components/InfoRow';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { StatusBadge } from '../components/StatusBadge';
import { apiRequest } from '../services/apiClient';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import {
  formatCurrency,
  formatDate,
  getDaysText,
  getMemberDisplayStatus,
  type Member,
  type Pagination,
  type Payment,
  type Renewal,
} from '../types';

type MemberHistoryScreenProps = {
  memberId: number;
  onBack: () => void;
  onLogout: () => void;
  onSelectPayment?: (paymentId: number) => void;
};

/**
 * Member Full History — current membership, EVERY renewal period and EVERY
 * payment for one member. Mirrors the PWA member-history flow: it pages
 * through /renewals and /payments (page_size=100) instead of the capped
 * page_size=5 / page_size=50 preview on the member detail screen.
 */
export function MemberHistoryScreen({ memberId, onBack, onLogout, onSelectPayment }: MemberHistoryScreenProps) {
  const [member, setMember] = useState<Member | null>(null);
  const [renewals, setRenewals] = useState<Renewal[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [renewalsError, setRenewalsError] = useState(false);
  const [paymentsError, setPaymentsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    const [memberRes, renewalsRes, paymentsRes] = await Promise.all([
      apiRequest<Member>(`/api/mobile/v1/members/${memberId}`),
      fetchAllPages<Renewal>(`/api/mobile/v1/renewals?member_id=${memberId}`, 'renewals'),
      fetchAllPages<Payment>(`/api/mobile/v1/payments?member_id=${memberId}`, 'payments'),
    ]);

    for (const res of [memberRes, renewalsRes, paymentsRes]) {
      if (!res.ok && res.error?.status === 401) {
        onLogout();
        return;
      }
    }

    if (memberRes.ok) {
      setMember(memberRes.data);
      setError(undefined);
    } else {
      setError(memberRes.error.message);
    }
    // V6-L35: keep already-fetched pages on a mid-fetch failure instead
    // of discarding them — fetchAllPages returns its partial items.
    if (renewalsRes.ok) {
      setRenewals(renewalsRes.items);
      setRenewalsError(false);
    } else {
      setRenewals(renewalsRes.items);
      setRenewalsError(true);
    }
    if (paymentsRes.ok) {
      setPayments(paymentsRes.items);
      setPaymentsError(false);
    } else {
      setPayments(paymentsRes.items);
      setPaymentsError(true);
    }
    setLoading(false);
    setRefreshing(false);
  }, [memberId, onLogout]);

  useEffect(() => {
    void load();
  }, [load]);

  const status = member ? getMemberDisplayStatus(member) : null;
  const daysText = member ? getDaysText(member.days_until_expiry) : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Renewal History" onBack={onBack} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            colors={[colors.brand]}
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
      >
        {loading ? (
          <LoadingSkeleton lines={6} height={18} />
        ) : error || !member ? (
          <ErrorState
            message={error || 'Member not found'}
            onRetry={() => {
              setLoading(true);
              void load();
            }}
          />
        ) : (
          <>
            {/* Current Membership */}
            <View style={styles.card}>
              <Text style={styles.memberName}>{member.full_name}</Text>
              <InfoRow label="Plan" value={member.plan?.name || '—'} />
              <InfoRow
                label="Period"
                value={`${formatDate(member.membership_start)} → ${formatDate(member.membership_end)}`}
              />
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>Status</Text>
                {status ? <StatusBadge status={status} /> : null}
              </View>
              {daysText ? <InfoRow label="Days Left" value={daysText} /> : null}
            </View>

            {/* Renewal Periods */}
            <Text style={styles.sectionTitle}>
              Membership Renewals{renewals.length ? ` (${renewals.length})` : ''}
            </Text>
            {renewalsError ? (
              <TouchableOpacity
                onPress={() => {
                  setLoading(true);
                  void load();
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.inlineError}>
                  Couldn&apos;t load all renewals{renewals.length ? ` — showing ${renewals.length} loaded so far` : ''}. Tap to retry.
                </Text>
              </TouchableOpacity>
            ) : null}
            {renewals.length ? (
              <View style={styles.listCard}>
                {renewals.map((renewal) => (
                  <View key={renewal.id} style={styles.listRow}>
                    <View style={styles.listMain}>
                      <Text style={styles.listTitle}>{renewal.plan_name || 'Membership Renewal'}</Text>
                      <Text style={styles.listSub}>
                        {formatDate(renewal.new_start)} → {formatDate(renewal.new_end)}
                        {/* V5-L35: render the channel the PWA shows. */}
                        {renewal.channel ? ` · ${renewal.channel === 'online' ? 'Online' : 'Offline'}` : ''}
                      </Text>
                    </View>
                    <View style={styles.listRight}>
                      <Text style={styles.listAmount}>{formatCurrency(renewal.amount)}</Text>
                      <Text style={styles.listSub}>{formatDate(renewal.created_at)}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : renewalsError ? null : (
              <Text style={styles.inlineMuted}>No renewals recorded for this member.</Text>
            )}

            {/* Payments */}
            <Text style={styles.sectionTitle}>
              Payments{payments.length ? ` (${payments.length})` : ''}
            </Text>
            {paymentsError ? (
              <TouchableOpacity
                onPress={() => {
                  setLoading(true);
                  void load();
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.inlineError}>
                  Couldn&apos;t load all payments{payments.length ? ` — showing ${payments.length} loaded so far` : ''}. Tap to retry.
                </Text>
              </TouchableOpacity>
            ) : null}
            {payments.length ? (
              <View style={styles.listCard}>
                {payments.map((payment) => {
                  const sub = [
                    payment.method,
                    // V5-L35: Payment.channel exists but was never shown.
                    payment.channel ? (payment.channel === 'online' ? 'Online' : 'Offline') : null,
                    formatDate(payment.paid_on || payment.created_at),
                    payment.renewal_days ? `${payment.renewal_days} days` : null,
                    payment.reference ? `Ref: ${payment.reference}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  const row = (
                    <>
                      <View style={styles.listMain}>
                        <Text style={styles.listTitle}>{payment.plan_name || 'Payment'}</Text>
                        <Text style={styles.listSub}>{sub}</Text>
                      </View>
                      <View style={styles.listRight}>
                        <Text style={styles.listAmount}>{formatCurrency(payment.amount)}</Text>
                        <StatusBadge status={payment.status} />
                      </View>
                    </>
                  );
                  return onSelectPayment ? (
                    <TouchableOpacity
                      key={payment.id}
                      style={styles.listRow}
                      onPress={() => onSelectPayment(payment.id)}
                      activeOpacity={0.7}
                    >
                      {row}
                    </TouchableOpacity>
                  ) : (
                    <View key={payment.id} style={styles.listRow}>
                      {row}
                    </View>
                  );
                })}
              </View>
            ) : paymentsError ? null : (
              <EmptyState
                title="No payments"
                subtitle={`No payments recorded for ${member.full_name}`}
              />
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

async function fetchAllPages<T extends { id: number }>(
  baseUrl: string,
  key: 'renewals' | 'payments',
): Promise<{ ok: boolean; error?: { status?: number; message: string }; items: T[] }> {
  // V5-L39: cap the page loop (20 pages × 100 = 2,000 rows) and dedupe
  // by id across pages — a renewal created mid-fetch used to duplicate
  // a boundary row, and a server that kept returning total > loaded
  // could loop unboundedly.
  const MAX_PAGES = 20;
  const items: T[] = [];
  const seenIds = new Set<number>();
  let page = 1;
  let total = Infinity;
  while (items.length < total && page <= MAX_PAGES) {
    const sep = baseUrl.includes('?') ? '&' : '?';
    const res = await apiRequest<{ renewals?: T[]; payments?: T[]; pagination?: Pagination }>(
      `${baseUrl}${sep}page=${page}&page_size=100`,
    );
    if (!res.ok) return { ok: false, error: res.error, items };
    const batch = res.data?.[key] || [];
    for (const item of batch) {
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      items.push(item);
    }
    total = res.data?.pagination?.total ?? items.length;
    if (batch.length === 0) break;
    page += 1;
  }
  return { ok: true, items };
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.bottomTabSafe },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
    ...shadows.sm,
  },
  memberName: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  statusRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  statusLabel: { color: colors.muted, fontSize: fontSize.base },
  sectionTitle: { color: colors.text, fontSize: fontSize.base, fontWeight: fontWeight.bold },
  inlineError: { color: colors.muted, fontSize: fontSize.sm },
  inlineMuted: { color: colors.muted, fontSize: fontSize.sm },
  listCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    ...shadows.sm,
  },
  listRow: {
    alignItems: 'flex-start',
    borderTopColor: colors.borderLight,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  listMain: { flex: 1 },
  listTitle: { color: colors.text, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  listSub: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 2 },
  listRight: { alignItems: 'flex-end', gap: 4 },
  listAmount: { color: colors.text, fontSize: fontSize.base, fontWeight: fontWeight.bold },
});

import { useCallback, useEffect, useState } from 'react';
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
import { apiRequest } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing, fontFamily } from '../theme/tokens';
import { formatCurrency, formatDate } from '../types';

type FlaggedMember = {
  member_id: number;
  full_name: string;
  phone: string | null;
  plan_name: string | null;
  plan_duration_days: number | null;
  membership_start: string | null;
  membership_end: string | null;
  span_days: number | null;
  ledger_periods: number;
  freeze_events: number;
  confidence: 'high' | 'review';
  classification: string;
  reason: string;
  proposed_end?: string | null;
  expected_end?: string | null;
  proposed_start?: string | null;
  verified_payments: number;
  verified_paid_total: string;
  paid_days?: number;
};

const CLASS_LABELS: Record<string, string> = {
  ledger_mismatch: 'End date changed outside a payment/renewal',
  span_mismatch: 'Span longer than the plan, no renewal history',
  oversized_renewal: 'A renewal applied more days than the plan allows',
  historyless_pushed_end: 'No renewal history, but the end runs past the current period — check payments before confirming',
  start_missing: 'No start date stored',
  start_after_end: 'Start date is after the end date',
  start_in_future: 'Start date is in the future — check if this is a pre-registration',
  start_ledger_mismatch: 'Start date disagrees with the renewal history',
  period_overlap: 'Two renewal periods overlap — check payments before fixing by hand',
  payment_coverage_gap: 'Days in the period are not covered by a payment on record — check cash / free / discount before fixing by hand',
};

type DateRepairScreenProps = {
  onBack: () => void;
};

/**
 * Date Repair (owner only) — members whose membership end date does not
 * match their plan + payment history. The scan is read-only; nothing
 * changes until the owner selects members and taps Apply. Mirrors the PWA
 * date-repair flow against the same backend endpoints.
 */
export function DateRepairScreen({ onBack }: DateRepairScreenProps) {
  const [flagged, setFlagged] = useState<FlaggedMember[]>([]);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [confirming, setConfirming] = useState<'apply' | 'confirm' | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    const res = await apiRequest<{ flagged: FlaggedMember[]; flagged_count: number }>(
      '/api/mobile/v1/date-repair/scan',
    );
    if (res.ok) {
      const rows = res.data.flagged || [];
      setFlagged(rows);
      // High-confidence findings are pre-selected, exactly like the PWA.
      setSelected(Object.fromEntries(rows.map((f) => [f.member_id, f.confidence === 'high'])));
      setError(undefined);
    } else {
      setError(res.error.message);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedIds = flagged.filter((f) => selected[f.member_id]).map((f) => f.member_id);
  const confirmableIds = selectedIds.filter(
    (id) => flagged.find((f) => f.member_id === id)?.classification === 'historyless_pushed_end',
  );

  const toggle = (id: number) =>
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));

  const runApply = async () => {
    if (!selectedIds.length) return;
    setWorking(true);
    const res = await apiRequest<{ results: { applied: boolean }[] }>(
      '/api/mobile/v1/date-repair/apply',
      { method: 'POST', body: { member_ids: selectedIds } },
    );
    setWorking(false);
    setConfirming(null);
    if (res.ok) {
      const applied = (res.data.results || []).filter((r) => r.applied).length;
      Alert.alert('Repairs applied', `Repaired ${applied} member${applied === 1 ? '' : 's'}.`);
      setLoading(true);
      void load();
    } else {
      Alert.alert('Could not apply repairs', res.error.message);
    }
  };

  const runConfirm = async () => {
    if (!confirmableIds.length) return;
    setWorking(true);
    const res = await apiRequest<{ results: { applied: boolean }[] }>(
      '/api/mobile/v1/date-repair/confirm',
      { method: 'POST', body: { member_ids: confirmableIds, confirmed_no_extra_payment: true } },
    );
    setWorking(false);
    setConfirming(null);
    if (res.ok) {
      const applied = (res.data.results || []).filter((r) => r.applied).length;
      Alert.alert('Confirmed', `Confirmed ${applied} member${applied === 1 ? '' : 's'} — no extra payment.`);
      setLoading(true);
      void load();
    } else {
      Alert.alert('Could not confirm', res.error.message);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Date Repair" onBack={onBack} />
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
        ) : error ? (
          <ErrorState
            message={error}
            onRetry={() => {
              setLoading(true);
              void load();
            }}
          />
        ) : (
          <>
            <View style={styles.introCard}>
              <Text style={styles.introText}>
                Members whose <Text style={styles.bold}>end date</Text> doesn&apos;t match their plan
                and payment history. Review each one — nothing changes until you tap Apply.
              </Text>
            </View>

            {flagged.length === 0 ? (
              <EmptyState
                icon={<Icon name="checkmark" size={40} color={colors.success} />}
                title="All dates look correct"
                subtitle="No members need repair right now."
              />
            ) : (
              <>
                <Text style={styles.countText}>
                  {flagged.length} member{flagged.length === 1 ? '' : 's'} flagged
                </Text>
                {flagged.map((f) => {
                  const proposed = f.proposed_end || f.expected_end;
                  const checked = Boolean(selected[f.member_id]);
                  return (
                    <TouchableOpacity
                      key={f.member_id}
                      style={[styles.card, checked && styles.cardSelected]}
                      onPress={() => toggle(f.member_id)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.row}>
                        <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                          {checked ? <Icon name="checkmark" size={15} color={colors.textInverse} /> : null}
                        </View>
                        <View style={styles.copy}>
                          <Text style={styles.name}>
                            {f.full_name}
                            <Text style={styles.planText}>
                              {' '}· {f.plan_name ?? 'No plan'}
                              {f.plan_duration_days ? ` (${f.plan_duration_days}d)` : ''}
                            </Text>
                          </Text>
                          <Text style={styles.line}>
                            Now: {formatDate(f.membership_start)} →{' '}
                            <Text style={styles.bold}>{formatDate(f.membership_end)}</Text>
                            {f.span_days !== null ? ` (${f.span_days} days)` : ''}
                          </Text>
                          {proposed ? (
                            <Text style={styles.line}>
                              Should be: → <Text style={styles.bold}>{formatDate(proposed)}</Text>
                              {f.classification === 'historyless_pushed_end'
                                ? ' (needs your confirm below — Apply alone will not change it)'
                                : ''}
                            </Text>
                          ) : null}
                          {f.proposed_start ? (
                            <Text style={styles.line}>
                              Original start on record: {formatDate(f.proposed_start)}
                            </Text>
                          ) : null}
                          <Text style={styles.muted}>
                            {CLASS_LABELS[f.classification] || f.classification}. {f.reason}
                          </Text>
                          <Text style={styles.muted}>
                            Verified payments: {f.verified_payments} (
                            {formatCurrency(f.verified_paid_total || '0')}) · Renewals on record:{' '}
                            {f.ledger_periods}
                            {f.paid_days !== undefined
                              ? ` · Paid days: ${f.paid_days} vs ${f.span_days ?? '—'} stored days`
                              : ''}
                            {f.freeze_events ? ` · Freezes: ${f.freeze_events} — verify before applying` : ''}
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}

                <PrimaryButton
                  label={`Apply Selected Repairs${selectedIds.length ? ` (${selectedIds.length})` : ''}`}
                  onPress={() => {
                    if (!selectedIds.length) {
                      Alert.alert('Select at least one member', 'Tap a flagged member to select it first.');
                      return;
                    }
                    setConfirming('apply');
                  }}
                  disabled={!selectedIds.length || working}
                />
                <TouchableOpacity
                  style={styles.confirmButton}
                  onPress={() => {
                    if (!confirmableIds.length) {
                      Alert.alert(
                        'Nothing to confirm',
                        'Select at least one member with no renewal history whose end runs past the current period.',
                      );
                      return;
                    }
                    setConfirming('confirm');
                  }}
                  disabled={!confirmableIds.length || working}
                  activeOpacity={0.7}
                >
                  <Text style={styles.confirmButtonText}>
                    Confirm Selected — No Extra Payment{confirmableIds.length ? ` (${confirmableIds.length})` : ''}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.muted}>
                  Confirm is only for members with no renewal history whose end runs past the current
                  period. Tap it only if you are sure they did NOT pay for the extra time — it will
                  shorten their end date to the expected end shown.
                </Text>
              </>
            )}
          </>
        )}
      </ScrollView>

      <ConfirmDialog
        visible={confirming === 'apply'}
        title="Apply date repairs?"
        message={`This will change the membership end date for ${selectedIds.length} member${selectedIds.length === 1 ? '' : 's'} to the corrected values shown. Payments and history are not changed.`}
        confirmLabel="Apply"
        loading={working}
        onConfirm={() => void runApply()}
        onCancel={() => setConfirming(null)}
      />
      <ConfirmDialog
        visible={confirming === 'confirm'}
        title="Confirm no extra payment?"
        message={`This will shorten the end date for ${confirmableIds.length} member${confirmableIds.length === 1 ? '' : 's'} to the expected end shown. Only confirm if they did NOT pay for time past that end. Payments and history are not changed.`}
        confirmLabel="Confirm — no extra payment"
        confirmVariant="danger"
        loading={working}
        onConfirm={() => void runConfirm()}
        onCancel={() => setConfirming(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.bottomTabSafe },
  introCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  introText: { color: colors.textSecondary, fontSize: fontSize.base, lineHeight: 20 },
  bold: { color: colors.text, fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold },
  countText: { color: colors.muted, fontSize: fontSize.base },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  cardSelected: { borderColor: colors.brand, borderWidth: 2 },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.xs,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    marginTop: 2,
    width: 22,
  },
  checkboxChecked: { backgroundColor: colors.brand, borderColor: colors.brand },
  copy: { flex: 1, gap: 4 },
  name: { color: colors.text, fontSize: fontSize.base, fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold },
  planText: { color: colors.muted, fontWeight: fontWeight.medium },
  line: { color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 19 },
  muted: { color: colors.muted, fontSize: fontSize.sm, lineHeight: 18 },
  confirmButton: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderColor: colors.critical,
    borderRadius: radius.md,
    borderWidth: 2,
    paddingVertical: spacing.md,
  },
  confirmButtonText: { color: colors.critical, fontSize: fontSize.base, fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold },
});

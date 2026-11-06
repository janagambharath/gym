import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../components/AppHeader';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { FormField } from '../components/FormField';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { PrimaryButton } from '../components/PrimaryButton';
import { SectionHeader } from '../components/SectionHeader';
import { apiRequest, getCachedSession } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import { formatCurrency } from '../types';

type FinanceData = {
  today: { total: string; by_method: Record<string, string>; expected_cash: string };
  last_7_days: { total: string; by_method: Record<string, string> };
  pending_verification: string;
  cash_close: { closed: boolean; counted_cash: string | null; variance: string | null; notes: string | null };
};

type OwnerFinanceScreenProps = {
  onBack: () => void;
};

/**
 * Owner Finance — daily collections + cash-close. Mirrors the PWA
 * owner-finance flow against the same backend endpoints: collected today,
 * cash expected, pending verification, last 7 days, today-by-method
 * (verified only), and the cash-close form with variance.
 */
export function OwnerFinanceScreen({ onBack }: OwnerFinanceScreenProps) {
  const [data, setData] = useState<FinanceData | undefined>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [countedCash, setCountedCash] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedVariance, setSavedVariance] = useState<string | null>(null);
  const isOwner = getCachedSession()?.userRole === 'gym_owner';

  const load = useCallback(async () => {
    const res = await apiRequest<FinanceData>('/api/mobile/v1/owner/finance');
    if (res.ok) {
      setData(res.data);
      setCountedCash(res.data.cash_close.counted_cash ?? res.data.today.expected_cash);
      setNotes(res.data.cash_close.notes ?? '');
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

  const handleCashClose = async () => {
    if (saving) return;
    const counted = parseFloat(countedCash);
    if (countedCash.trim() === '' || Number.isNaN(counted) || counted < 0) {
      Alert.alert('Enter counted cash', 'Enter the physical cash counted at the desk (0 or more).');
      return;
    }
    setSaving(true);
    const res = await apiRequest<{ variance: string; counted_cash: string; expected_cash: string }>(
      '/api/mobile/v1/owner/cash-close',
      { method: 'POST', body: { counted_cash: countedCash.trim(), notes: notes.trim() || undefined } },
    );
    setSaving(false);
    if (res.ok) {
      setSavedVariance(res.data.variance);
      Alert.alert('Cash close saved', `Variance: ${formatCurrency(res.data.variance)}`);
      void load();
    } else {
      Alert.alert('Could not save cash close', res.error.message);
    }
  };

  const methods = data ? Object.entries(data.today.by_method || {}) : [];

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Daily Collections" onBack={onBack} />
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
        ) : data ? (
          <>
            <View style={styles.heroCard}>
              <Text style={styles.heroLabel}>Collected today</Text>
              <Text style={styles.heroValue}>{formatCurrency(data.today.total)}</Text>
              <Text style={styles.heroSub}>Verified payments only</Text>
            </View>

            <View style={styles.grid}>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Cash expected</Text>
                <Text style={styles.statValue}>{formatCurrency(data.today.expected_cash)}</Text>
                <Text style={styles.statSub}>Verified cash payments</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Pending verification</Text>
                <Text style={styles.statValue}>{formatCurrency(data.pending_verification)}</Text>
                <Text style={styles.statSub}>Review before closing</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>Last 7 days</Text>
                <Text style={styles.statValue}>{formatCurrency(data.last_7_days.total)}</Text>
                <Text style={styles.statSub}>Verified collections</Text>
              </View>
            </View>

            <View style={styles.card}>
              <SectionHeader
                title="Today by payment method"
                icon={<Icon name="wallet" size={18} color={colors.brand} />}
              />
              <Text style={styles.cardSub}>Only verified payments are included.</Text>
              {methods.length ? (
                methods.map(([method, value]) => (
                  <View key={method} style={styles.methodRow}>
                    <Text style={styles.methodLabel}>{method.replace('_', ' ')}</Text>
                    <Text style={styles.methodValue}>{formatCurrency(value)}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.cardSub}>No verified payments recorded today.</Text>
              )}
            </View>

            <View style={styles.card}>
              <SectionHeader
                title={data.cash_close.closed ? 'Cash close recorded' : 'Close cash for today'}
                icon={<Icon name="cash" size={18} color={colors.brand} />}
              />
              <Text style={styles.cardSub}>
                {data.cash_close.closed
                  ? `Counted ${formatCurrency(data.cash_close.counted_cash ?? '0')} · variance ${formatCurrency(data.cash_close.variance ?? '0')}`
                  : 'Enter the physical cash counted at the desk. This does not change payment records.'}
              </Text>
              {savedVariance !== null ? (
                <Text style={styles.varianceText}>Saved variance: {formatCurrency(savedVariance)}</Text>
              ) : null}
              {isOwner ? (
                <>
                  <FormField
                    label="Physical cash counted"
                    value={countedCash}
                    onChangeText={setCountedCash}
                    placeholder="0.00"
                    keyboardType="decimal-pad"
                  />
                  <FormField
                    label="Notes"
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Optional: float, refund, or variance explanation"
                    multiline
                    numberOfLines={2}
                  />
                  <PrimaryButton
                    label={data.cash_close.closed ? 'Update cash close' : 'Record cash close'}
                    onPress={() => void handleCashClose()}
                    loading={saving}
                    disabled={saving}
                  />
                </>
              ) : (
                <Text style={styles.cardSub}>Only the gym owner can record the cash close.</Text>
              )}
            </View>
          </>
        ) : (
          <EmptyState
            icon={<Icon name="wallet" size={40} color={colors.muted} />}
            title="Collections unavailable"
            subtitle="Pull to refresh and try again."
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.bottomTabSafe },
  heroCard: {
    backgroundColor: colors.brand,
    borderRadius: radius.xl,
    gap: spacing.xs,
    padding: spacing.xl,
    ...shadows.sm,
  },
  heroLabel: { color: 'rgba(255,255,255,0.8)', fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  heroValue: { color: colors.textInverse, fontSize: fontSize['4xl'], fontWeight: fontWeight.extrabold },
  heroSub: { color: 'rgba(255,255,255,0.8)', fontSize: fontSize.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flex: 1,
    minWidth: '30%',
    padding: spacing.md,
    ...shadows.sm,
  },
  statLabel: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  statValue: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.extrabold, marginTop: 2 },
  statSub: { color: colors.muted, fontSize: fontSize.xs, marginTop: 2 },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
    ...shadows.sm,
  },
  cardSub: { color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 19 },
  methodRow: {
    alignItems: 'center',
    borderTopColor: colors.borderLight,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  methodLabel: { color: colors.text, fontSize: fontSize.base, fontWeight: fontWeight.medium, textTransform: 'capitalize' },
  methodValue: { color: colors.text, fontSize: fontSize.base, fontWeight: fontWeight.bold },
  varianceText: { color: colors.successDark, fontSize: fontSize.base, fontWeight: fontWeight.bold },
});

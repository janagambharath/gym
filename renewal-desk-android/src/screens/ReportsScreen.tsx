import { useCallback, useEffect, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { ErrorState } from '../components/ErrorState';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { apiRequest } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import { formatCurrency } from '../types';

type ReportData = {
  period: string;
  members: { total: number; active: number; expired: number; new: number };
  revenue: { collected: string; pending: string };
  renewals: { completed: number };
  whatsapp: { sent: number; failed: number };
};

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
];

type ReportsScreenProps = {
  onBack: () => void;
};

export function ReportsScreen({ onBack }: ReportsScreenProps) {
  const [data, setData] = useState<ReportData | undefined>();
  const [period, setPeriod] = useState('30d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const fetchReport = useCallback((p: string) => apiRequest<ReportData>(`/api/mobile/v1/reports/summary?period=${p}`).then((res) => {
    if (res.ok) {
      setData(res.data);
      setError(undefined);
    } else {
      setError(res.error.message);
    }
    setLoading(false);
  }), []);

  useEffect(() => {
    void fetchReport(period);
  }, [period, fetchReport]);

  const handlePeriodChange = useCallback((nextPeriod: string) => {
    if (nextPeriod === period) return;
    setLoading(true);
    setPeriod(nextPeriod);
  }, [period]);

  const handleRetry = useCallback(() => {
    setLoading(true);
    void fetchReport(period);
  }, [fetchReport, period]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Reports" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Period Selector */}
        <View style={styles.periodRow}>
          {PERIODS.map((p) => (
            <TouchableOpacity
              key={p.key}
              style={[styles.periodChip, period === p.key && styles.periodChipActive]}
              onPress={() => handlePeriodChange(p.key)}
            >
              <Text style={[styles.periodText, period === p.key && styles.periodTextActive]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? (
          <LoadingSkeleton lines={8} height={18} />
        ) : error ? (
          <ErrorState message={error} onRetry={handleRetry} />
        ) : data ? (
          <>
            {/* Members */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Icon name="members" size={18} color={colors.brand} />
                <Text style={styles.cardTitle}>Members</Text>
              </View>
              <View style={styles.statsGrid}>
                <StatItem label="Total" value={data.members.total} />
                <StatItem label="Active" value={data.members.active} valueColor={colors.success} />
                <StatItem label="Expired" value={data.members.expired} valueColor={colors.critical} />
                <StatItem label="New" value={data.members.new} valueColor={colors.brand} />
              </View>
            </View>

            {/* Revenue */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Icon name="currency" size={18} color={colors.brand} />
                <Text style={styles.cardTitle}>Revenue</Text>
              </View>
              <View style={styles.statsGrid}>
                <StatItem label="Collected" value={formatCurrency(data.revenue.collected)} valueColor={colors.success} />
                <StatItem label="Pending" value={formatCurrency(data.revenue.pending)} valueColor={colors.statusPending} />
              </View>
            </View>

            {/* Renewals */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Icon name="renewals" size={18} color={colors.brand} />
                <Text style={styles.cardTitle}>Renewals</Text>
              </View>
              <View style={styles.statsGrid}>
                <StatItem label="Completed" value={data.renewals.completed} valueColor={colors.success} />
              </View>
            </View>

            {/* WhatsApp */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Icon name="whatsapp" size={18} color={colors.whatsapp} />
                <Text style={styles.cardTitle}>WhatsApp</Text>
              </View>
              <View style={styles.statsGrid}>
                <StatItem label="Sent" value={data.whatsapp.sent} valueColor={colors.success} />
                <StatItem label="Failed" value={data.whatsapp.failed} valueColor={colors.critical} />
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatItem({ label, value, valueColor }: { label: string; value: number | string; valueColor?: string }) {
  return (
    <View style={styles.statItem}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, valueColor ? { color: valueColor } : undefined]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  cardHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  cardTitle: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.section },
  periodChip: {
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  periodChipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  periodRow: { flexDirection: 'row', gap: spacing.sm },
  periodText: { color: colors.textSecondary, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  periodTextActive: { color: colors.textInverse },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  statItem: { flex: 1, minWidth: '40%' as unknown as number },
  statLabel: { color: colors.muted, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  statValue: { color: colors.text, fontSize: fontSize['3xl'], fontVariant: ['tabular-nums'], fontWeight: fontWeight.extrabold, marginTop: spacing.xxs },
});

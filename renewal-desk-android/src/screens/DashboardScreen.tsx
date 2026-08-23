import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusCard } from '../components/StatusCard';
import { apiRequest, getCachedSession, logout } from '../services/apiClient';
import { colors, radius, spacing } from '../theme/tokens';

// Matches actual backend /api/mobile/v1/dashboard response (unwrapped)
type DashboardData = {
  total_active: number;
  expiring_soon: number;
  expired: number;
  pending_payments: number;
  sent_reminders: number;
  failed_reminders: number;
  total_collected: string;
};

type DashboardScreenProps = {
  onLogout: () => void;
  onNavigateMembers: () => void;
  onNavigatePayments?: () => void;
  onNavigateRenewals?: () => void;
  onNavigateSettings?: () => void;
};

export function DashboardScreen({
  onLogout,
  onNavigateMembers,
  onNavigatePayments,
  onNavigateRenewals,
  onNavigateSettings,
}: DashboardScreenProps) {
  const [data, setData] = useState<DashboardData | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [revision, setRevision] = useState(0);

  const session = getCachedSession();

  useEffect(() => {
    let cancelled = false;

    apiRequest<DashboardData>('/api/mobile/v1/dashboard').then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setData(result.data);
        setError(undefined);
      } else {
        if (result.error.status === 401) {
          onLogout();
          return;
        }
        setError(result.error.message);
      }
      setLoading(false);
      setRefreshing(false);
    });

    return () => { cancelled = true; };
  }, [revision, onLogout]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setRevision((n) => n + 1);
  }, []);

  const handleLogout = useCallback(async () => {
    await logout();
    onLogout();
  }, [onLogout]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <Text style={styles.topBarTitle} numberOfLines={1}>
            {session?.tenantName ?? 'Dashboard'}
          </Text>
          {session?.userName ? (
            <Text style={styles.topBarSubtitle} numberOfLines={1}>
              {session.userName} · {session.userRole === 'gym_owner' ? 'Owner' : 'Staff'}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity
          accessibilityLabel="Sign out"
          onPress={() => void handleLogout()}
          style={styles.logoutButton}
        >
          <Text style={styles.logoutText}>Sign out</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            colors={[colors.brand]}
            onRefresh={refresh}
            refreshing={refreshing}
          />
        }
      >
        {loading && !refreshing ? (
          <ActivityIndicator
            accessibilityLabel="Loading dashboard"
            color={colors.brand}
            size="large"
            style={styles.spinner}
          />
        ) : null}

        {error ? (
          <StatusCard detail={error} title="Could not load dashboard" tone="critical" />
        ) : null}

        {data ? (
          <>
            {/* Key metrics */}
            <View style={styles.statRow}>
              <StatBox label="Active" value={data.total_active} color={colors.success} />
              <StatBox label="Expiring Soon" value={data.expiring_soon} color={colors.warning} />
            </View>
            <View style={styles.statRow}>
              <StatBox label="Expired" value={data.expired} color={colors.critical} />
              <StatBox label="Pending Pay" value={data.pending_payments} color="#7C3AED" />
            </View>

            {/* Revenue */}
            <StatusCard
              detail={`₹${Number(data.total_collected || 0).toLocaleString('en-IN')} collected`}
              title="Revenue"
              tone="success"
            />

            {/* Reminders */}
            {(data.sent_reminders > 0 || data.failed_reminders > 0) ? (
              <StatusCard
                detail={`${data.sent_reminders} sent · ${data.failed_reminders} failed`}
                title="WhatsApp Reminders"
                tone={data.failed_reminders > 0 ? 'warning' : 'success'}
              />
            ) : null}

            {/* Quick actions */}
            <TouchableOpacity
              accessibilityRole="button"
              onPress={onNavigateMembers}
              style={styles.actionCard}
            >
              <Text style={styles.actionTitle}>Members →</Text>
              <Text style={styles.actionDetail}>
                Search, filter, and manage gym members
              </Text>
            </TouchableOpacity>

            {onNavigateRenewals ? (
              <TouchableOpacity
                accessibilityRole="button"
                onPress={onNavigateRenewals}
                style={[styles.actionCard, { backgroundColor: '#059669' }]}
              >
                <Text style={styles.actionTitle}>Renewals →</Text>
                <Text style={styles.actionDetail}>Upcoming and expired memberships</Text>
              </TouchableOpacity>
            ) : null}

            {onNavigatePayments ? (
              <TouchableOpacity
                accessibilityRole="button"
                onPress={onNavigatePayments}
                style={[styles.actionCard, { backgroundColor: '#7C3AED' }]}
              >
                <Text style={styles.actionTitle}>Payments →</Text>
                <Text style={styles.actionDetail}>Verify and manage payments</Text>
              </TouchableOpacity>
            ) : null}

            {onNavigateSettings ? (
              <TouchableOpacity
                accessibilityRole="button"
                onPress={onNavigateSettings}
                style={[styles.actionCard, { backgroundColor: colors.textSecondary }]}
              >
                <Text style={styles.actionTitle}>Settings →</Text>
                <Text style={styles.actionDetail}>Gym settings and plans</Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : null}

        {!loading && !error && !data ? (
          <StatusCard
            detail="The Mobile API is not available. This dashboard will populate once the backend deploys /api/mobile/v1/dashboard."
            title="Awaiting Mobile API"
            tone="warning"
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={[styles.statValue, color ? { color } : undefined]}>
        {value.toLocaleString('en-IN')}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  actionCard: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  actionDetail: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 14,
    marginTop: spacing.xxs,
  },
  actionTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  content: {
    gap: spacing.md,
    padding: spacing.md,
  },
  logoutButton: {
    backgroundColor: colors.criticalSurface,
    borderColor: '#FDA29B',
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  logoutText: {
    color: colors.critical,
    fontSize: 13,
    fontWeight: '600',
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  spinner: {
    marginTop: spacing.xl,
  },
  statBox: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    padding: spacing.md,
  },
  statLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: spacing.xxs,
  },
  statRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statValue: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '800',
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
  topBarLeft: {
    flex: 1,
    marginRight: spacing.sm,
  },
  topBarSubtitle: {
    color: colors.muted,
    fontSize: 13,
  },
  topBarTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
});

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

type DashboardData = {
  total_members: number;
  active_members: number;
  expired_members: number;
  expiring_soon: number;
  total_revenue: number;
  recent_payments: number;
};

type DashboardScreenProps = {
  onLogout: () => void;
  onNavigateMembers: () => void;
};

async function loadDashboard(): Promise<
  { ok: true; data: DashboardData } | { ok: false; message: string; status?: number }
> {
  const result = await apiRequest<DashboardData>('/api/mobile/v1/dashboard');
  if (result.ok) {
    return result;
  }
  return { ok: false, message: result.error.message, status: result.error.status };
}

export function DashboardScreen({ onLogout, onNavigateMembers }: DashboardScreenProps) {
  const [data, setData] = useState<DashboardData | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [revision, setRevision] = useState(0);

  const session = getCachedSession();

  useEffect(() => {
    let cancelled = false;

    loadDashboard().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setData(result.data);
        setError(undefined);
      } else {
        if (result.status === 401) {
          onLogout();
          return;
        }
        setError(result.message);
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
            <View style={styles.statRow}>
              <StatBox label="Total Members" value={data.total_members} />
              <StatBox label="Active" value={data.active_members} color={colors.success} />
            </View>
            <View style={styles.statRow}>
              <StatBox label="Expired" value={data.expired_members} color={colors.critical} />
              <StatBox label="Expiring Soon" value={data.expiring_soon} color={colors.warning} />
            </View>

            <StatusCard
              detail={`₹${data.total_revenue.toLocaleString('en-IN')} total revenue · ${data.recent_payments} recent payments`}
              title="Revenue"
              tone="success"
            />

            <TouchableOpacity
              accessibilityRole="button"
              onPress={onNavigateMembers}
              style={styles.actionCard}
            >
              <Text style={styles.actionTitle}>View Members →</Text>
              <Text style={styles.actionDetail}>
                Search, filter, and manage gym members
              </Text>
            </TouchableOpacity>
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

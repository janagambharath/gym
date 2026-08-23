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
import { apiRequest, getCachedSession, logout } from '../services/apiClient';
import { colors, radius, spacing } from '../theme/tokens';

type GymSettings = {
  id: number;
  name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  timezone: string;
  whatsapp_enabled: boolean;
  max_members: number | null;
  subscription_status: string | null;
};

type Plan = {
  id: number;
  name: string;
  duration_days: number;
  price: string;
};

type SettingsResponse = {
  gym: GymSettings;
  plans: Plan[];
};

type SettingsScreenProps = {
  onBack: () => void;
  onLogout: () => void;
};

export function SettingsScreen({ onBack, onLogout }: SettingsScreenProps) {
  const [data, setData] = useState<SettingsResponse | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [refreshing, setRefreshing] = useState(false);
  const [revision, setRevision] = useState(0);
  const session = getCachedSession();

  useEffect(() => {
    let cancelled = false;

    void apiRequest<SettingsResponse>('/api/mobile/v1/settings').then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setData(result.data);
        setError(undefined);
      } else {
        if (result.error.status === 401) { onLogout(); return; }
        setError(result.error.message);
      }
      setLoading(false);
      setRefreshing(false);
    });

    return () => { cancelled = true; };
  }, [revision, onLogout]);

  const handleLogout = useCallback(async () => {
    await logout();
    onLogout();
  }, [onLogout]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Settings</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setRevision((r) => r + 1); }} colors={[colors.brand]} />}
      >
        {loading && !refreshing ? (
          <ActivityIndicator color={colors.brand} size="large" style={styles.spinner} />
        ) : error ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : data ? (
          <>
            {/* Account */}
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Account</Text>
              <InfoRow label="Name" value={session?.userName ?? '—'} />
              <InfoRow label="Role" value={session?.userRole === 'gym_owner' ? 'Owner' : 'Staff'} />
            </View>

            {/* Gym info */}
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Gym</Text>
              <InfoRow label="Name" value={data.gym.name} />
              <InfoRow label="Email" value={data.gym.email ?? '—'} />
              <InfoRow label="Phone" value={data.gym.phone ?? '—'} />
              <InfoRow label="Address" value={data.gym.address ?? '—'} />
              <InfoRow label="Timezone" value={data.gym.timezone} />
              <InfoRow label="Status" value={data.gym.subscription_status ?? 'active'} />
              {data.gym.max_members ? <InfoRow label="Max Members" value={String(data.gym.max_members)} /> : null}
              <InfoRow label="WhatsApp" value={data.gym.whatsapp_enabled ? '✅ Enabled' : '❌ Disabled'} />
            </View>

            {/* Plans */}
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Membership Plans</Text>
              {data.plans.length === 0 ? (
                <Text style={styles.emptyText}>No plans configured.</Text>
              ) : (
                data.plans.map((plan) => (
                  <View key={plan.id} style={styles.planRow}>
                    <Text style={styles.planName}>{plan.name}</Text>
                    <Text style={styles.planDetail}>{plan.duration_days} days · ₹{plan.price}</Text>
                  </View>
                ))
              )}
            </View>

            {/* About */}
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>About</Text>
              <InfoRow label="App" value="Renewal Desk v1.0.0" />
              <InfoRow label="Package" value="online.revorax.renewaldesk" />
            </View>

            {/* Logout */}
            <TouchableOpacity
              style={styles.logoutBtn}
              onPress={() => void handleLogout()}
            >
              <Text style={styles.logoutBtnText}>Sign Out</Text>
            </TouchableOpacity>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: { minWidth: 60 },
  backText: { color: colors.brand, fontSize: 15, fontWeight: '600' },
  card: { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, padding: spacing.md },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xl },
  emptyText: { color: colors.muted, fontSize: 14, marginTop: spacing.xs },
  errorContainer: { backgroundColor: colors.criticalSurface, borderColor: '#FDA29B', borderRadius: radius.md, borderWidth: 1, margin: spacing.md, padding: spacing.md },
  errorText: { color: colors.critical, fontSize: 14 },
  infoLabel: { color: colors.muted, fontSize: 14, width: 90 },
  infoRow: { alignItems: 'center', flexDirection: 'row', marginTop: spacing.xs },
  infoValue: { color: colors.text, flex: 1, fontSize: 14, fontWeight: '600' },
  logoutBtn: { alignItems: 'center', backgroundColor: colors.criticalSurface, borderColor: '#FDA29B', borderRadius: radius.md, borderWidth: 1, minHeight: 48, justifyContent: 'center' },
  logoutBtnText: { color: colors.critical, fontSize: 16, fontWeight: '700' },
  planDetail: { color: colors.textSecondary, fontSize: 13 },
  planName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  planRow: { borderTopColor: colors.border, borderTopWidth: 1, marginTop: spacing.xs, paddingTop: spacing.xs },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  spinner: { marginTop: spacing.xl },
  topBar: { alignItems: 'center', borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  topBarTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
});

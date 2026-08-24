import { useCallback, useEffect, useState } from 'react';
import { FlatList, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { Avatar } from '../components/Avatar';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { CardSkeleton } from '../components/LoadingSkeleton';
import { StatusBadge } from '../components/StatusBadge';
import { apiRequest } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';

type StaffMember = {
  id: number;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string | null;
};

type StaffScreenProps = {
  onBack: () => void;
};

export function StaffScreen({ onBack }: StaffScreenProps) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const fetchStaff = useCallback(() => apiRequest<{ staff: StaffMember[] }>('/api/mobile/v1/staff').then((res) => {
    if (res.ok) {
      setStaff(res.data.staff);
      setError(undefined);
    } else {
      setError(res.error.message);
    }
    setLoading(false);
  }), []);

  useEffect(() => {
    void fetchStaff();
  }, [fetchStaff]);

  const handleRetry = useCallback(() => {
    setLoading(true);
    void fetchStaff();
  }, [fetchStaff]);

  const formatDate = (iso: string | null) => {
    if (!iso) return 'Never';
    try {
      return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return '—'; }
  };

  const renderStaff = ({ item }: { item: StaffMember }) => (
    <View style={styles.card}>
      <View style={styles.row}>
        <Avatar name={item.full_name} size={44} />
        <View style={styles.info}>
          <Text style={styles.name}>{item.full_name}</Text>
          <Text style={styles.email}>{item.email}</Text>
          <Text style={styles.meta}>
            Last login: {formatDate(item.last_login_at)}
          </Text>
        </View>
        <View style={styles.badges}>
          <StatusBadge status={item.role === 'gym_owner' ? 'Owner' : 'Staff'} />
          {!item.is_active ? <StatusBadge status="inactive" /> : null}
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Staff" onBack={onBack} />
      {loading ? (
        <View style={styles.loadingWrap}>
          <CardSkeleton />
          <CardSkeleton />
        </View>
      ) : error ? (
        <ErrorState message={error} onRetry={handleRetry} />
      ) : staff.length === 0 ? (
        <EmptyState
          icon={<Icon name="staff" size={40} color={colors.muted} />}
          title="No staff members"
          subtitle="Staff accounts are managed via the web dashboard."
        />
      ) : (
        <FlatList
          data={staff}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderStaff}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  badges: { alignItems: 'flex-end', gap: spacing.xs },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  email: { color: colors.muted, fontSize: fontSize.sm },
  info: { flex: 1, marginLeft: spacing.md },
  list: { gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.section },
  loadingWrap: { gap: spacing.md, padding: spacing.lg },
  meta: { color: colors.muted, fontSize: fontSize.xs, marginTop: spacing.xs },
  name: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  row: { alignItems: 'center', flexDirection: 'row' },
  safeArea: { backgroundColor: colors.background, flex: 1 },
});

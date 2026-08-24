import { useCallback, useEffect, useState } from 'react';
import { FlatList, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { CardSkeleton } from '../components/LoadingSkeleton';
import { apiRequest } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type { Plan } from '../types';

type PlansScreenProps = {
  onBack: () => void;
};

export function PlansScreen({ onBack }: PlansScreenProps) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    const res = await apiRequest<{ plans: Plan[] }>('/api/mobile/v1/settings');
    if (res.ok) {
      setPlans(res.data.plans);
      setError(undefined);
    } else {
      setError(res.error.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchPlans();
  }, [fetchPlans]);

  const renderPlan = ({ item }: { item: Plan }) => (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.iconWrap}>
          <Icon name="plan" size={20} color={colors.brand} />
        </View>
        <View style={styles.planInfo}>
          <Text style={styles.planName}>{item.name}</Text>
          <Text style={styles.planDuration}>{item.duration_days} days</Text>
        </View>
        <Text style={styles.planPrice}>₹{item.price}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Membership Plans" onBack={onBack} />
      {loading ? (
        <View style={styles.loadingWrap}><CardSkeleton /><CardSkeleton /></View>
      ) : error ? (
        <ErrorState message={error} onRetry={fetchPlans} />
      ) : plans.length === 0 ? (
        <EmptyState
          icon={<Icon name="plan" size={40} color={colors.muted} />}
          title="No plans configured"
          subtitle="Create plans in the web dashboard."
        />
      ) : (
        <FlatList
          data={plans}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderPlan}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
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
  cardTop: { alignItems: 'center', flexDirection: 'row' },
  iconWrap: {
    alignItems: 'center',
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.md,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  list: { gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.section },
  loadingWrap: { gap: spacing.md, padding: spacing.lg },
  planDuration: { color: colors.muted, fontSize: fontSize.sm },
  planInfo: { flex: 1, marginLeft: spacing.md },
  planName: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  planPrice: { color: colors.brand, fontSize: fontSize['2xl'], fontVariant: ['tabular-nums'], fontWeight: fontWeight.extrabold },
  safeArea: { backgroundColor: colors.background, flex: 1 },
});

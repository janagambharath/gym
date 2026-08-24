import { useCallback, useEffect, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { InfoRow } from '../components/InfoRow';
import { PrimaryButton } from '../components/PrimaryButton';
import { SectionHeader } from '../components/SectionHeader';
import { StatusBadge } from '../components/StatusBadge';
import { apiRequest, getCachedSession, logout } from '../services/apiClient';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type { GymSettings, Plan, SettingsResponse } from '../types';

type SettingsScreenProps = {
  onLogout: () => void;
};

export function SettingsScreen({ onLogout }: SettingsScreenProps) {
  const [gym, setGym] = useState<GymSettings | undefined>();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  const session = getCachedSession();

  useEffect(() => {
    void apiRequest<SettingsResponse>('/api/mobile/v1/settings').then((result) => {
      if (result.ok) {
        setGym(result.data.gym);
        setPlans(result.data.plans);
      } else if (result.error.status === 401) {
        onLogout();
      }
      setLoading(false);
    });
  }, [onLogout]);

  const handleLogout = useCallback(async () => {
    await logout();
    onLogout();
  }, [onLogout]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>More</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Account */}
        <View style={styles.card}>
          <SectionHeader title="Account" icon="👤" />
          <View style={styles.accountInfo}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarInitial}>
                {session?.userName?.charAt(0)?.toUpperCase() ?? 'U'}
              </Text>
            </View>
            <View style={styles.accountDetails}>
              <Text style={styles.accountName}>{session?.userName ?? 'User'}</Text>
              <Text style={styles.accountRole}>Gym Owner</Text>
            </View>
          </View>
        </View>

        {/* Gym Information */}
        {gym ? (
          <View style={styles.card}>
            <SectionHeader title="Gym Information" icon="🏢" />
            <View style={styles.infoList}>
              <InfoRow label="Name" value={gym.name} />
              <InfoRow label="Email" value={gym.email ?? '—'} />
              <InfoRow label="Phone" value={gym.phone ?? '—'} />
              <InfoRow label="Address" value={gym.address ?? '—'} />
              <InfoRow label="Timezone" value={gym.timezone ?? 'Asia/Kolkata'} />
            </View>
          </View>
        ) : null}

        {/* Subscription */}
        {gym ? (
          <View style={styles.card}>
            <SectionHeader title="Subscription" icon="📋" />
            <View style={styles.subscriptionRow}>
              <Text style={styles.subscriptionLabel}>Status</Text>
              <StatusBadge
                status={gym.subscription_status === 'active' ? 'active' : gym.subscription_status ?? 'pending'}
                size="md"
              />
            </View>
            {gym.max_members ? (
              <InfoRow label="Member Limit" value={String(gym.max_members)} />
            ) : null}
          </View>
        ) : null}

        {/* WhatsApp */}
        {gym ? (
          <View style={styles.card}>
            <SectionHeader title="WhatsApp" icon="💬" />
            <View style={styles.whatsappRow}>
              <View style={[styles.whatsappDot, { backgroundColor: gym.whatsapp_enabled ? colors.whatsapp : colors.gray300 }]} />
              <Text style={styles.whatsappStatus}>
                {gym.whatsapp_enabled ? 'Connected & Active' : 'Not Configured'}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Membership Plans */}
        {plans.length > 0 ? (
          <View style={styles.card}>
            <SectionHeader title="Membership Plans" icon="⭐" />
            <View style={styles.planList}>
              {plans.map((plan) => (
                <View key={plan.id} style={styles.planItem}>
                  <View>
                    <Text style={styles.planName}>{plan.name}</Text>
                    <Text style={styles.planDuration}>{plan.duration_days} days</Text>
                  </View>
                  <Text style={styles.planPrice}>₹{plan.price}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* About */}
        <View style={styles.card}>
          <SectionHeader title="About" icon="ℹ" />
          <InfoRow label="Version" value="1.0.0" />
          <InfoRow label="Build" value="Preview" />
        </View>

        {/* Logout */}
        <PrimaryButton
          label="Sign Out"
          icon="🚪"
          onPress={() => void handleLogout()}
          variant="danger"
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  accountDetails: {
    marginLeft: spacing.lg,
  },
  accountInfo: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: spacing.lg,
  },
  accountName: {
    color: colors.text,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
  },
  accountRole: {
    color: colors.muted,
    fontSize: fontSize.base,
    marginTop: spacing.xxs,
  },
  avatarCircle: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  avatarInitial: {
    color: colors.textInverse,
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.bold,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.section,
  },
  header: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  headerTitle: {
    color: colors.text,
    fontSize: fontSize['4xl'],
    fontWeight: fontWeight.extrabold,
  },
  infoList: {
    marginTop: spacing.sm,
  },
  planDuration: {
    color: colors.muted,
    fontSize: fontSize.sm,
    marginTop: 1,
  },
  planItem: {
    alignItems: 'center',
    borderTopColor: colors.borderLight,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  planList: {
    marginTop: spacing.xs,
  },
  planName: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
  },
  planPrice: {
    color: colors.brand,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  subscriptionLabel: {
    color: colors.muted,
    fontSize: fontSize.base,
    marginRight: spacing.md,
  },
  subscriptionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  whatsappDot: {
    borderRadius: 5,
    height: 10,
    marginRight: spacing.sm,
    width: 10,
  },
  whatsappRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: spacing.md,
  },
  whatsappStatus: {
    color: colors.textSecondary,
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
  },
});

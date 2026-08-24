import { useCallback, useEffect, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Avatar } from '../components/Avatar';
import { InfoRow } from '../components/InfoRow';
import { PrimaryButton } from '../components/PrimaryButton';
import { SectionHeader } from '../components/SectionHeader';
import { StatusBadge } from '../components/StatusBadge';
import { apiRequest, getCachedSession, logout } from '../services/apiClient';
import { Icon, type IconName } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type { GymSettings, SettingsResponse } from '../types';

type SettingsScreenProps = {
  onLogout: () => void;
  onNavigateWhatsApp?: () => void;
  onNavigatePlans?: () => void;
  onNavigateStaff?: () => void;
  onNavigateReports?: () => void;
  onNavigateBot?: () => void;
  onNavigateBotTest?: () => void;
};

export function SettingsScreen({
  onLogout,
  onNavigateWhatsApp,
  onNavigatePlans,
  onNavigateStaff,
  onNavigateReports,
  onNavigateBot,
  onNavigateBotTest,
}: SettingsScreenProps) {
  const [gym, setGym] = useState<GymSettings | undefined>();
  const session = getCachedSession();

  useEffect(() => {
    void apiRequest<SettingsResponse>('/api/mobile/v1/settings').then((result) => {
      if (result.ok) {
        setGym(result.data.gym);
      } else if (result.error.status === 401) {
        onLogout();
      }
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
          <SectionHeader title="Account" icon={<Icon name="person" size={18} color={colors.brand} />} />
          <View style={styles.accountInfo}>
            <Avatar name={session?.userName ?? 'U'} size={56} />
            <View style={styles.accountDetails}>
              <Text style={styles.accountName}>{session?.userName ?? 'User'}</Text>
              <Text style={styles.accountRole}>
                {session?.userRole === 'gym_owner' ? 'Gym Owner' : 'Staff'}
              </Text>
            </View>
          </View>
        </View>

        {/* Quick Navigation */}
        <View style={styles.card}>
          <SectionHeader title="Navigation" icon={<Icon name="dashboard" size={18} color={colors.brand} />} />
          <View style={styles.menuList}>
            <MenuItem icon="whatsapp" label="WhatsApp reminders" onPress={onNavigateWhatsApp} />
            <MenuItem icon="robot" label="WhatsApp Bot" onPress={onNavigateBot} />
            <MenuItem icon="testTube" label="Bot test sandbox" onPress={onNavigateBotTest} />
            <MenuItem icon="plan" label="Membership Plans" onPress={onNavigatePlans} />
            {session?.userRole === 'gym_owner' ? (
              <MenuItem icon="staff" label="Staff" onPress={onNavigateStaff} />
            ) : null}
            <MenuItem icon="analytics" label="Reports" onPress={onNavigateReports} />
          </View>
        </View>

        {/* Gym Information */}
        {gym ? (
          <View style={styles.card}>
            <SectionHeader title="Gym Information" icon={<Icon name="business" size={18} color={colors.brand} />} />
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
            <SectionHeader title="Subscription" icon={<Icon name="shield" size={18} color={colors.brand} />} />
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
          <TouchableOpacity style={styles.card} onPress={onNavigateWhatsApp} activeOpacity={0.7}>
            <SectionHeader title="WhatsApp" icon={<Icon name="whatsapp" size={18} color={colors.whatsapp} />} />
            <View style={styles.whatsappRow}>
              <View style={[styles.whatsappDot, { backgroundColor: gym.whatsapp_enabled ? colors.whatsapp : colors.gray300 }]} />
              <Text style={styles.whatsappStatus}>
                {gym.whatsapp_enabled ? 'Connected & Active' : 'Not Configured'}
              </Text>
              <View style={styles.flex} />
              <Icon name="forward" size={16} color={colors.muted} />
            </View>
          </TouchableOpacity>
        ) : null}

        {/* About */}
        <View style={styles.card}>
          <SectionHeader title="About" icon={<Icon name="info" size={18} color={colors.brand} />} />
          <InfoRow label="Version" value="1.0.0" />
          <InfoRow label="Build" value="Preview" />
        </View>

        {/* Logout */}
        <PrimaryButton
          title="Sign Out"
          icon={<Icon name="logout" size={18} color={colors.textInverse} />}
          onPress={() => void handleLogout()}
          variant="danger"
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function MenuItem({ icon, label, onPress }: { icon: IconName; label: string; onPress?: () => void }) {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress} activeOpacity={0.6}>
      <View style={styles.menuIconWrap}>
        <Icon name={icon} size={18} color={colors.brand} />
      </View>
      <Text style={styles.menuLabel}>{label}</Text>
      <Icon name="forward" size={16} color={colors.muted} />
    </TouchableOpacity>
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
  flex: { flex: 1 },
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
  menuIconWrap: {
    alignItems: 'center',
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.md,
    height: 36,
    justifyContent: 'center',
    marginRight: spacing.md,
    width: 36,
  },
  menuItem: {
    alignItems: 'center',
    borderTopColor: colors.borderLight,
    borderTopWidth: 1,
    flexDirection: 'row',
    paddingVertical: spacing.md,
  },
  menuLabel: {
    color: colors.text,
    flex: 1,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.medium,
  },
  menuList: {
    marginTop: spacing.xs,
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

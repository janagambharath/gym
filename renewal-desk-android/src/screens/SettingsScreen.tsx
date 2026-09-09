import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';

import { PrimaryButton } from '../components/PrimaryButton';

import { StatusBadge } from '../components/StatusBadge';
import { apiRequest, deleteAccount, getCachedSession, logout } from '../services/apiClient';
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
  onNavigateSubscription?: () => void;
};

export function SettingsScreen({
  onLogout,
  onNavigateWhatsApp,
  onNavigatePlans,
  onNavigateStaff,
  onNavigateReports,
  onNavigateBot,
  onNavigateBotTest,
  onNavigateSubscription,
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

  const handleDeleteAccount = useCallback(() => {
    Alert.alert(
      'Delete Account & Data',
      'Are you sure you want to permanently delete your account and all associated gym records? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Permanently',
          style: 'destructive',
          onPress: async () => {
            const res = await deleteAccount();
            if (res.ok) {
              onLogout();
            } else {
              Alert.alert('Error', res.error.message || 'Could not delete account. Please try again.');
            }
          },
        },
      ],
    );
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
          <View style={styles.accountInfo}>
            <Avatar name={session?.userName ?? 'U'} size={56} />
            <View style={styles.accountDetails}>
              <Text style={styles.accountName}>{session?.userName ?? 'User'}</Text>
              <Text style={styles.accountRole}>
                {session?.userRole === 'gym_owner' ? 'Gym Owner' : 'Staff'}
              </Text>
              {gym ? (
                <View style={styles.gymNameRow}>
                  <Icon name="fitness" size={13} color={colors.muted} />
                  <Text style={styles.gymNameInline} numberOfLines={1}>{gym.name}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {/* Gym Operations */}
        <View style={styles.card}>
          <Text style={styles.sectionGroupTitle}>GYM OPERATIONS</Text>
          <View style={styles.menuList}>
            <MenuItem icon="plan" label="Membership Plans" onPress={onNavigatePlans} />
            {session?.userRole === 'gym_owner' ? (
              <MenuItem icon="staff" label="Staff Management" onPress={onNavigateStaff} />
            ) : null}
            <MenuItem icon="analytics" label="Analytics & Reports" onPress={onNavigateReports} />
          </View>
        </View>

        {/* Integrations */}
        <View style={styles.card}>
          <Text style={styles.sectionGroupTitle}>INTEGRATIONS</Text>
          <View style={styles.menuList}>
            <TouchableOpacity style={styles.menuItem} onPress={onNavigateWhatsApp} activeOpacity={0.6}>
              <View style={[styles.menuIconWrap, { backgroundColor: '#ECFDF5' }]}>
                <Icon name="whatsapp" size={18} color={colors.whatsapp} />
              </View>
              <Text style={styles.menuLabel}>WhatsApp Reminders</Text>
              <View style={[styles.statusDotInline, { backgroundColor: gym?.whatsapp_enabled ? colors.whatsapp : colors.gray300 }]} />
              <Icon name="forward" size={16} color={colors.muted} />
            </TouchableOpacity>
            <MenuItem icon="robot" label="AI Receptionist" onPress={onNavigateBot} />
            <MenuItem icon="testTube" label="Test AI Receptionist" onPress={onNavigateBotTest} />
          </View>
        </View>

        {/* Billing */}
        <View style={styles.card}>
          <Text style={styles.sectionGroupTitle}>BILLING</Text>
          <View style={styles.menuList}>
            <TouchableOpacity style={styles.menuItem} onPress={onNavigateSubscription} activeOpacity={0.6}>
              <View style={styles.menuIconWrap}>
                <Icon name="shield" size={18} color={colors.brand} />
              </View>
              <Text style={styles.menuLabel}>Subscription & Billing</Text>
              {gym ? (
                <StatusBadge
                  status={gym.subscription_status === 'active' ? 'active' : gym.subscription_status ?? 'pending'}
                  size="sm"
                />
              ) : null}
              <Icon name="forward" size={16} color={colors.muted} />
            </TouchableOpacity>
          </View>
        </View>

        {/* About footer */}
        <View style={styles.aboutFooter}>
          <Text style={styles.aboutFooterText}>Renewal Desk v1.0.0 · Build 5</Text>
        </View>

        {/* Sign Out */}
        <PrimaryButton
          title="Sign Out"
          icon={<Icon name="logout" size={18} color={colors.textInverse} />}
          onPress={() => void handleLogout()}
          variant="secondary"
        />

        {/* Delete Account — separated visually */}
        <TouchableOpacity
          style={styles.deleteAccountBtn}
          onPress={handleDeleteAccount}
          activeOpacity={0.7}
        >
          <Icon name="delete" size={16} color={colors.critical} />
          <Text style={styles.deleteAccountBtnText}>Delete Account & Data</Text>
        </TouchableOpacity>
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
  aboutHeader: {
    alignItems: 'center',
    borderBottomColor: colors.borderLight,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    paddingBottom: spacing.md,
    marginBottom: spacing.sm,
  },
  aboutInfo: {
    flex: 1,
  },
  aboutLogo: {
    borderRadius: radius.md,
    height: 44,
    width: 44,
  },
  aboutSubtitle: {
    color: colors.muted,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  aboutTitle: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  accountDetails: {
    marginLeft: spacing.lg,
  },
  accountInfo: {
    alignItems: 'center',
    flexDirection: 'row',
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
    paddingBottom: spacing.bottomTabSafe,
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
  dangerZoneText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 18,
    marginTop: spacing.xs,
  },
  deleteAccountBtn: {
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    marginTop: spacing.md,
    paddingVertical: spacing.md,
  },
  deleteAccountBtnText: {
    color: colors.critical,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  sectionGroupTitle: {
    color: colors.muted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
  },
  gymNameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  gymNameInline: {
    color: colors.muted,
    fontSize: fontSize.sm,
  },
  statusDotInline: {
    borderRadius: 5,
    height: 8,
    marginRight: spacing.sm,
    width: 8,
  },
  aboutFooter: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  aboutFooterText: {
    color: colors.muted,
    fontSize: fontSize.xs,
  },
});

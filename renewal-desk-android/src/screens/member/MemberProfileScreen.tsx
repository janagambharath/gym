/**
 * MemberProfileScreen — Member profile, gym info, settings, and sign-out.
 *
 * Shows: member details, gym contact, payment info, sign out,
 * and account deletion flow.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../../theme/tokens';
import type { MemberProfile } from '../../services/memberApiClient';
import {
  clearMemberSession,
  fetchMemberProfile,
  getMemberSession,
} from '../../services/memberApiClient';
import { ErrorState } from '../../components/ErrorState';
import { getRuntimeConfiguration } from '../../config/runtime';

type MemberProfileScreenProps = {
  onLogout: () => void;
};

export function MemberProfileScreen({ onLogout }: MemberProfileScreenProps) {
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const session = getMemberSession();

  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    void fetchMemberProfile().then((result) => {
      if (!active) return;
      if (result.ok) {
        setProfile(result.data);
        setError(undefined);
      } else {
        setError(result.error);
      }
      setLoading(false);
      setRefreshing(false);
    });
    return () => {
      active = false;
    };
  }, [revision]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setRevision((r) => r + 1);
  }, []);

  const handleSignOut = useCallback(() => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await clearMemberSession();
          onLogout();
        },
      },
    ]);
  }, [onLogout]);

  const handleDeleteAccount = useCallback(() => {
    const config = getRuntimeConfiguration();
    const deleteUrl = `${config.apiBaseUrl || 'https://gym-production-910c.up.railway.app'}/delete-account`;

    Alert.alert(
      'Delete Account',
      'To delete your member account and associated data, you can submit a deletion request or contact your gym administrator.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Open Deletion Page',
          onPress: () => {
            void Linking.openURL(deleteUrl);
          },
        },
      ],
    );
  }, []);

  const handlePrivacyPolicy = useCallback(() => {
    const config = getRuntimeConfiguration();
    const privacyUrl = `${config.apiBaseUrl || 'https://gym-production-910c.up.railway.app'}/privacy`;
    void Linking.openURL(privacyUrl);
  }, []);

  if (loading && !profile) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      </SafeAreaView>
    );
  }

  if (error && !profile) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ErrorState message={error} onRetry={handleRefresh} />
      </SafeAreaView>
    );
  }

  const member = profile?.member;
  const gym = profile?.gym;
  const payment = profile?.payment_info;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Profile</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.brand}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* User Card */}
        <View style={styles.card}>
          <View style={styles.avatarRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(member?.full_name ?? session?.fullName ?? 'M')[0].toUpperCase()}
              </Text>
            </View>
            <View style={styles.avatarDetails}>
              <Text style={styles.memberName}>
                {member?.full_name ?? session?.fullName ?? 'Member'}
              </Text>
              <Text style={styles.memberPhone}>
                {member?.phone ?? session?.phone ?? ''}
              </Text>
              <View style={styles.statusBadge}>
                <Text style={styles.statusBadgeText}>
                  {member?.status ? member.status.toUpperCase() : 'ACTIVE'}
                </Text>
              </View>
            </View>
          </View>

          {member?.email && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Email</Text>
              <Text style={styles.infoValue}>{member.email}</Text>
            </View>
          )}

          {member?.joined_on && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Member Since</Text>
              <Text style={styles.infoValue}>{member.joined_on}</Text>
            </View>
          )}
        </View>

        {/* Gym Information */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Icon name="business" size={20} color={colors.brand} />
            <Text style={styles.cardTitle}>Gym Details</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Gym</Text>
            <Text style={styles.infoValue}>{gym?.name ?? session?.gymName ?? 'N/A'}</Text>
          </View>

          {gym?.phone && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Phone</Text>
              <Text style={styles.infoValue}>{gym.phone}</Text>
            </View>
          )}

          {gym?.address && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Address</Text>
              <Text style={styles.infoValue}>{gym.address}</Text>
            </View>
          )}
        </View>

        {/* Gym Payment Info */}
        {payment?.upi_id && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Icon name="cash" size={20} color={colors.brand} />
              <Text style={styles.cardTitle}>Gym Payment Details</Text>
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>UPI ID</Text>
              <Text style={styles.infoValue}>{payment.upi_id}</Text>
            </View>

            {payment.payment_label && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Name</Text>
                <Text style={styles.infoValue}>{payment.payment_label}</Text>
              </View>
            )}

            {payment.instructions && (
              <Text style={styles.instructionsText}>{payment.instructions}</Text>
            )}
          </View>
        )}

        {/* Legal & Account Links */}
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.menuRow}
            onPress={handlePrivacyPolicy}
            activeOpacity={0.7}
          >
            <View style={styles.menuLeft}>
              <Icon name="document" size={20} color={colors.textSecondary} />
              <Text style={styles.menuText}>Privacy Policy</Text>
            </View>
            <Icon name="forward" size={16} color={colors.muted} />
          </TouchableOpacity>

          <View style={styles.menuDivider} />

          <TouchableOpacity
            style={styles.menuRow}
            onPress={handleDeleteAccount}
            activeOpacity={0.7}
          >
            <View style={styles.menuLeft}>
              <Icon name="trash" size={20} color={colors.critical} />
              <Text style={[styles.menuText, { color: colors.critical }]}>
                Delete Account
              </Text>
            </View>
            <Icon name="forward" size={16} color={colors.muted} />
          </TouchableOpacity>
        </View>

        {/* Sign Out Button */}
        <TouchableOpacity
          style={styles.signOutBtn}
          onPress={handleSignOut}
          activeOpacity={0.7}
        >
          <Icon name="logout" size={20} color={colors.critical} />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        <Text style={styles.versionText}>Renewal Desk v1.0 · Member App</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: fontSize['4xl'],
    fontWeight: fontWeight.extrabold,
    color: colors.text,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.bottomTabSafe,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
    ...shadows.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  cardTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.brandSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.brand,
  },
  avatarText: {
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.extrabold,
    color: colors.brand,
  },
  avatarDetails: {
    flex: 1,
    gap: spacing.xxs,
  },
  memberName: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  memberPhone: {
    fontSize: fontSize.md,
    color: colors.muted,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.successSurface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    marginTop: spacing.xxs,
  },
  statusBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.success,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xxs,
  },
  infoLabel: {
    fontSize: fontSize.base,
    color: colors.muted,
    fontWeight: fontWeight.medium,
  },
  infoValue: {
    fontSize: fontSize.base,
    color: colors.text,
    fontWeight: fontWeight.semibold,
  },
  instructionsText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    backgroundColor: colors.infoSurface,
    padding: spacing.md,
    borderRadius: radius.md,
    lineHeight: 18,
  },
  menuRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  menuLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  menuText: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.medium,
    color: colors.text,
  },
  menuDivider: {
    height: 1,
    backgroundColor: colors.borderLight,
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.criticalBorder,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginTop: spacing.sm,
  },
  signOutText: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.critical,
  },
  versionText: {
    fontSize: fontSize.xs,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});

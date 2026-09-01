import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../components/AppHeader';
import { Icon, type IconName } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';

type ImportMembersScreenProps = {
  onBack: () => void;
  onNavigateCSV: () => void;
  onNavigateScan: () => void;
  onNavigateManual: () => void;
};

export function ImportMembersScreen({
  onBack,
  onNavigateCSV,
  onNavigateScan,
  onNavigateManual,
}: ImportMembersScreenProps) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Import your members" onBack={onBack} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.introHeader}>
          <Text style={styles.title}>Bring Your Members Into Renewal Desk</Text>
          <Text style={styles.subtitle}>
            Quickly load your existing gym members to start tracking renewals, preventing churn, and collecting fees.
          </Text>
        </View>

        {/* Option 1: CSV Import */}
        <ImportOptionCard
          icon="document"
          badge="Best for Spreadsheets"
          badgeColor={colors.brand}
          badgeBg={colors.brandSubtle}
          title="Import CSV"
          description="Upload a CSV file exported from Excel, Google Sheets, or your previous software."
          buttonLabel="Import CSV"
          onPress={onNavigateCSV}
          primary
        />

        {/* Option 2: AI Document Scanner */}
        <ImportOptionCard
          icon="camera"
          badge="AI-Assisted Scan"
          badgeColor={colors.successDark}
          badgeBg={colors.successSurface}
          title="Scan Member Records"
          description="Photograph paper registers, membership forms, fee receipts, or printed rosters. AI extracts member details for your review before importing."
          buttonLabel="Scan Records"
          onPress={onNavigateScan}
        />

        {/* Option 3: Manual Entry */}
        <ImportOptionCard
          icon="personAdd"
          badge="Single Entry"
          badgeColor={colors.textSecondary}
          badgeBg={colors.gray100}
          title="Add Manually"
          description="Best if you only have a few members to add or want to enter details individually."
          buttonLabel="Add Member"
          onPress={onNavigateManual}
        />

        {/* Privacy Note */}
        <View style={styles.privacyCard}>
          <Icon name="lock" size={16} color={colors.textSecondary} />
          <Text style={styles.privacyText}>
            Your member data is strictly private, tenant-isolated to your gym, and never used to train public models.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ImportOptionCard({
  icon,
  badge,
  badgeColor,
  badgeBg,
  title,
  description,
  buttonLabel,
  onPress,
  primary = false,
}: {
  icon: IconName;
  badge: string;
  badgeColor: string;
  badgeBg: string;
  title: string;
  description: string;
  buttonLabel: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <View style={[styles.card, primary && styles.cardPrimary]}>
      <View style={styles.cardHeader}>
        <View style={[styles.iconWrap, { backgroundColor: badgeBg }]}>
          <Icon name={icon} size={22} color={badgeColor} />
        </View>
        <View style={styles.cardHeaderRight}>
          <View style={[styles.badge, { backgroundColor: badgeBg }]}>
            <Text style={[styles.badgeText, { color: badgeColor }]}>{badge}</Text>
          </View>
          <Text style={styles.cardTitle}>{title}</Text>
        </View>
      </View>

      <Text style={styles.cardDescription}>{description}</Text>

      <TouchableOpacity
        style={[styles.actionBtn, primary ? styles.actionBtnPrimary : styles.actionBtnOutline]}
        onPress={onPress}
        activeOpacity={0.8}
      >
        <Text style={[styles.actionBtnText, primary ? styles.actionBtnTextPrimary : styles.actionBtnTextOutline]}>
          {buttonLabel}
        </Text>
        <Icon name="forward" size={16} color={primary ? colors.textInverse : colors.brand} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.section,
  },
  introHeader: {
    gap: spacing.xs,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
    ...shadows.sm,
  },
  cardPrimary: {
    borderColor: colors.brand,
    borderWidth: 1.5,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  iconWrap: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  cardHeaderRight: {
    flex: 1,
    gap: 3,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.3,
  },
  cardTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  cardDescription: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  actionBtn: {
    alignItems: 'center',
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  actionBtnPrimary: {
    backgroundColor: colors.brand,
  },
  actionBtnOutline: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  actionBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  actionBtnTextPrimary: {
    color: colors.textInverse,
  },
  actionBtnTextOutline: {
    color: colors.brand,
  },
  privacyCard: {
    alignItems: 'center',
    backgroundColor: colors.gray50,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  privacyText: {
    color: colors.muted,
    flex: 1,
    fontSize: fontSize.xs,
    lineHeight: 16,
  },
});

import React, { useState } from 'react';
import { StyleSheet, Text, View, Image } from 'react-native';
import { useBranding } from '../context/BrandingContext';
import { useAuth } from '../context/AuthContext';
import { colors, radii, spacing, typography } from '../theme/tokens';

export const VynlaHeader: React.FC = () => {
  const { theme } = useBranding();
  const { member } = useAuth();
  const [logoError, setLogoError] = useState(false);

  const firstName = member?.full_name ? member.full_name.split(' ')[0] : 'Member';
  const gymInitial = theme.gymName ? theme.gymName.charAt(0).toUpperCase() : 'G';

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <View style={styles.gymRow}>
          {theme.logoUrl && !logoError ? (
            <Image
              source={{ uri: theme.logoUrl }}
              style={styles.logo}
              resizeMode="contain"
              onError={() => setLogoError(true)}
            />
          ) : (
            <View style={[styles.avatar, { backgroundColor: theme.primary }]}>
              <Text style={[styles.avatarText, { color: theme.primaryText }]}>{gymInitial}</Text>
            </View>
          )}
          <View style={styles.gymInfo}>
            <Text style={styles.gymName} numberOfLines={1}>
              {theme.gymName}
            </Text>
            <Text style={styles.poweredBy}>Powered by VYNLA</Text>
          </View>
        </View>
      </View>

      <View style={styles.welcomeRow}>
        <Text style={styles.welcomeTitle}>Welcome, {firstName} 👋</Text>
        <Text style={styles.tagline}>{theme.tagline}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.bg,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  gymRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  logo: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.card,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '700',
  },
  gymInfo: {
    flex: 1,
  },
  gymName: {
    ...typography.h3,
    color: colors.text,
  },
  poweredBy: {
    ...typography.caption,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 2,
  },
  welcomeRow: {
    marginTop: spacing.xs,
  },
  welcomeTitle: {
    ...typography.h2,
    color: colors.text,
  },
  tagline: {
    ...typography.subtext,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
});

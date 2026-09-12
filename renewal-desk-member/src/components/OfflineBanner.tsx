import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing, typography } from '../theme/tokens';

interface OfflineBannerProps {
  visible: boolean;
  message?: string;
}

export const OfflineBanner: React.FC<OfflineBannerProps> = ({
  visible,
  message = "You're offline. Some information may be out of date.",
}) => {
  if (!visible) return null;

  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Ionicons name="cloud-offline" size={16} color={colors.expiring} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.expiringSurface,
    borderBottomWidth: 1,
    borderBottomColor: colors.expiringBorder,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  text: {
    ...typography.subtext,
    color: colors.expiring,
    fontWeight: '500',
  },
});

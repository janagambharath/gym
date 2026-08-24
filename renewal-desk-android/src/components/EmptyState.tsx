import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, fontSize, fontWeight, radius, spacing } from '../theme/tokens';

type EmptyStateProps = {
  /** React element (Icon component) or emoji string */
  icon?: React.ReactNode;
  title: string;
  /** Use `subtitle` or `message` — both accepted */
  subtitle?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ icon, title, subtitle, message, actionLabel, onAction }: EmptyStateProps) {
  const desc = subtitle ?? message;
  return (
    <View style={styles.container}>
      {icon ? (
        typeof icon === 'string' ? (
          <Text style={styles.iconText}>{icon}</Text>
        ) : (
          <View style={styles.iconWrap}>{icon}</View>
        )
      ) : null}
      <Text style={styles.title}>{title}</Text>
      {desc ? <Text style={styles.message}>{desc}</Text> : null}
      {actionLabel && onAction ? (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={onAction}
          style={styles.action}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
  },
  actionText: {
    color: colors.textInverse,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  container: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxxl,
    paddingVertical: spacing.section,
  },
  iconText: {
    fontSize: 48,
    marginBottom: spacing.lg,
    opacity: 0.4,
  },
  iconWrap: {
    marginBottom: spacing.lg,
    opacity: 0.6,
  },
  message: {
    color: colors.muted,
    fontSize: fontSize.base,
    lineHeight: 20,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  title: {
    color: colors.textSecondary,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    textAlign: 'center',
  },
});

import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, spacing, typography } from '../theme/tokens';
import { useBranding } from '../context/BrandingContext';

interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  actionText?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionText,
  onAction,
}) => {
  const { theme } = useBranding();

  return (
    <View style={styles.container}>
      <View style={[styles.iconCircle, { backgroundColor: theme.accent }]}>
        <Ionicons name={icon} size={32} color={theme.primary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {description && <Text style={styles.description}>{description}</Text>}
      {actionText && onAction && (
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: theme.primary }]}
          onPress={onAction}
          activeOpacity={0.85}
        >
          <Text style={[styles.actionText, { color: theme.primaryText }]}>{actionText}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {
    ...typography.h3,
    color: colors.text,
    textAlign: 'center',
  },
  description: {
    ...typography.subtext,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    maxWidth: 280,
  },
  actionButton: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.md,
  },
  actionText: {
    ...typography.bodySemibold,
  },
});

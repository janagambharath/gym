import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { colors, fontSize, fontWeight, radius, spacing } from '../theme/tokens';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'success' | 'whatsapp';

type PrimaryButtonProps = {
  disabled?: boolean;
  /** Use `title` or `label` — both are accepted */
  title?: string;
  label?: string;
  loading?: boolean;
  onPress: () => void;
  variant?: ButtonVariant;
  /** React element (Icon component) or emoji string */
  icon?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  style?: ViewStyle;
};

const variantStyles: Record<ButtonVariant, { bg: string; bgPressed: string; text: string; border?: string }> = {
  primary: { bg: colors.brand, bgPressed: colors.brandDark, text: colors.textInverse },
  secondary: { bg: colors.card, bgPressed: colors.gray100, text: colors.text, border: colors.border },
  outline: { bg: 'transparent', bgPressed: colors.brandSubtle, text: colors.brand, border: colors.brand },
  danger: { bg: colors.critical, bgPressed: colors.criticalDark, text: colors.textInverse },
  success: { bg: colors.success, bgPressed: colors.successDark, text: colors.textInverse },
  whatsapp: { bg: colors.whatsapp, bgPressed: colors.whatsappDark, text: colors.textInverse },
};

export function PrimaryButton({
  disabled = false,
  title,
  label,
  loading = false,
  onPress,
  variant = 'primary',
  icon,
  size = 'lg',
  fullWidth = true,
  style,
}: PrimaryButtonProps) {
  const vs = variantStyles[variant];
  const isDisabled = disabled || loading;
  const displayLabel = title ?? label ?? '';

  const sizeStyle = size === 'sm' ? styles.sm : size === 'md' ? styles.md : styles.lg;
  const textSize = size === 'sm' ? styles.textSm : size === 'md' ? styles.textMd : styles.textLg;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={displayLabel}
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        sizeStyle,
        {
          backgroundColor: pressed ? vs.bgPressed : vs.bg,
          borderColor: vs.border ?? 'transparent',
          borderWidth: vs.border ? 1 : 0,
          opacity: isDisabled ? 0.5 : 1,
        },
        fullWidth ? styles.fullWidth : undefined,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={vs.text} size="small" />
      ) : (
        <View style={styles.contentRow}>
          {icon ? (
            typeof icon === 'string' ? (
              <Text style={[styles.icon, { color: vs.text }]}>{icon}</Text>
            ) : (
              <View style={styles.iconWrap}>{icon}</View>
            )
          ) : null}
          <Text style={[textSize, { color: vs.text }]} numberOfLines={2}>
            {displayLabel}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: radius.md,
    justifyContent: 'center',
  },
  contentRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  fullWidth: {
    width: '100%' as unknown as number,
  },
  icon: {
    fontSize: fontSize.lg,
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  lg: {
    minHeight: 48,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
  },
  md: {
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  sm: {
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  textLg: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    textAlign: 'center' as const,
  },
  textMd: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    textAlign: 'center' as const,
  },
  textSm: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    textAlign: 'center' as const,
  },
});

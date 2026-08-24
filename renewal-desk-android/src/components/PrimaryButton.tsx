import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, fontWeight, radius, spacing } from '../theme/tokens';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'success' | 'whatsapp';

type PrimaryButtonProps = {
  disabled?: boolean;
  label: string;
  loading?: boolean;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: string;
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
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
  label,
  loading = false,
  onPress,
  variant = 'primary',
  icon,
  size = 'lg',
  fullWidth = true,
}: PrimaryButtonProps) {
  const vs = variantStyles[variant];
  const isDisabled = disabled || loading;

  const sizeStyle = size === 'sm' ? styles.sm : size === 'md' ? styles.md : styles.lg;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        sizeStyle,
        {
          backgroundColor: isDisabled ? colors.gray300 : pressed ? vs.bgPressed : vs.bg,
          borderColor: vs.border ?? 'transparent',
          borderWidth: vs.border ? 1 : 0,
        },
        fullWidth && styles.fullWidth,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={vs.text} size="small" />
      ) : (
        <View style={styles.content}>
          {icon ? <Text style={[styles.icon, { color: isDisabled ? colors.muted : vs.text }]}>{icon}</Text> : null}
          <Text style={[styles.label, { color: isDisabled ? colors.muted : vs.text }, size === 'sm' && styles.labelSm]}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: radius.lg,
    justifyContent: 'center',
  },
  content: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  fullWidth: {
    width: '100%',
  },
  icon: {
    fontSize: 16,
  },
  label: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  labelSm: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  lg: {
    minHeight: 52,
    paddingHorizontal: spacing.xxl,
  },
  md: {
    minHeight: 44,
    paddingHorizontal: spacing.xl,
  },
  sm: {
    minHeight: 36,
    paddingHorizontal: spacing.lg,
  },
});

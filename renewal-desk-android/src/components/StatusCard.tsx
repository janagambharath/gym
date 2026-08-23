import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../theme/tokens';

type StatusTone = 'critical' | 'neutral' | 'success' | 'warning';

type StatusCardProps = {
  children?: ReactNode;
  detail: string;
  title: string;
  tone?: StatusTone;
};

const toneStyles: Record<StatusTone, { borderColor: string; surface: string; title: string }> = {
  critical: {
    borderColor: '#FDA29B',
    surface: colors.criticalSurface,
    title: colors.critical,
  },
  neutral: {
    borderColor: colors.border,
    surface: colors.card,
    title: colors.text,
  },
  success: {
    borderColor: '#A6F4C5',
    surface: colors.successSurface,
    title: colors.success,
  },
  warning: {
    borderColor: '#F7C948',
    surface: colors.warningSurface,
    title: colors.warning,
  },
};

export function StatusCard({ children, detail, title, tone = 'neutral' }: StatusCardProps) {
  const style = toneStyles[tone];
  return (
    <View style={[styles.card, { backgroundColor: style.surface, borderColor: style.borderColor }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: style.title }]}>
        {title}
      </Text>
      <Text style={styles.detail}>{detail}</Text>
      {children ? <View style={styles.content}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  content: {
    marginTop: spacing.sm,
  },
  detail: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing.xxs,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
  },
});

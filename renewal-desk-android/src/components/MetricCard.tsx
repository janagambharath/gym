import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';

type MetricCardProps = {
  icon: React.ReactNode;
  iconBg?: string;
  label: string;
  value: number | string;
  subtext?: string;
  subtextColor?: string;
};

export function MetricCard({
  icon,
  iconBg = colors.gray100,
  label,
  value,
  subtext,
  subtextColor,
}: MetricCardProps) {
  return (
    <View style={styles.container}>
      <View style={[styles.iconContainer, { backgroundColor: iconBg }]}>
        {icon}
      </View>
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      {subtext ? (
        <Text style={[styles.subtext, subtextColor ? { color: subtextColor } : undefined]}>
          {subtext}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flex: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  iconContainer: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 36,
    justifyContent: 'center',
    marginBottom: spacing.sm,
    width: 36,
  },
  label: {
    color: colors.muted,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  subtext: {
    color: colors.muted,
    fontSize: fontSize.xs,
    marginTop: spacing.xxs,
  },
  value: {
    color: colors.text,
    fontSize: fontSize['3xl'],
    fontVariant: ['tabular-nums'],
    fontWeight: fontWeight.extrabold,
    marginTop: spacing.xxs,
  },
});

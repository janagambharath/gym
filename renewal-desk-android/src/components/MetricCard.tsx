import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';

type MetricCardProps = {
  icon: string;
  iconColor?: string;
  iconBg?: string;
  label: string;
  value: string | number;
  subtext?: string;
  subtextColor?: string;
};

export function MetricCard({
  icon,
  iconColor = colors.brand,
  iconBg = colors.brandSubtle,
  label,
  value,
  subtext,
  subtextColor = colors.muted,
}: MetricCardProps) {
  return (
    <View style={styles.card}>
      <View style={[styles.iconContainer, { backgroundColor: iconBg }]}>
        <Text style={[styles.icon, { color: iconColor }]}>{icon}</Text>
      </View>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>
        {typeof value === 'number' ? value.toLocaleString('en-IN') : value}
      </Text>
      {subtext ? (
        <Text style={[styles.subtext, { color: subtextColor }]} numberOfLines={1}>
          {subtext}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flex: 1,
    padding: spacing.md,
    ...shadows.sm,
  },
  icon: {
    fontSize: 18,
  },
  iconContainer: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 32,
    justifyContent: 'center',
    marginBottom: spacing.sm,
    width: 32,
  },
  label: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    marginBottom: spacing.xxs,
  },
  subtext: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    marginTop: spacing.xxs,
  },
  value: {
    color: colors.text,
    fontSize: fontSize['4xl'],
    fontWeight: fontWeight.extrabold,
    lineHeight: 30,
  },
});

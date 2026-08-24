import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, fontSize, fontWeight, spacing } from '../theme/tokens';

type SectionHeaderProps = {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: string;
};

export function SectionHeader({ title, actionLabel, onAction, icon }: SectionHeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.left}>
        {icon ? <Text style={styles.icon}>{icon}</Text> : null}
        <Text style={styles.title}>{title}</Text>
      </View>
      {actionLabel && onAction ? (
        <TouchableOpacity
          accessibilityRole="button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={onAction}
        >
          <Text style={styles.action}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    color: colors.brand,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  icon: {
    fontSize: fontSize.xl,
    marginRight: spacing.sm,
  },
  left: {
    alignItems: 'center',
    flexDirection: 'row',
    flex: 1,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
});

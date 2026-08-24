import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, fontSize, fontWeight, spacing } from '../theme/tokens';

type AppHeaderProps = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
};

export function AppHeader({ title, subtitle, onBack, rightAction }: AppHeaderProps) {
  return (
    <View style={styles.container}>
      {onBack ? (
        <TouchableOpacity
          accessibilityLabel="Go back"
          accessibilityRole="button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={onBack}
          style={styles.backButton}
        >
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.spacer} />
      )}
      <View style={styles.titleContainer}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
        ) : null}
      </View>
      {rightAction ? (
        <View style={styles.rightAction}>{rightAction}</View>
      ) : (
        <View style={styles.spacer} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
  },
  backIcon: {
    color: colors.text,
    fontSize: 28,
    fontWeight: fontWeight.medium,
    lineHeight: 32,
  },
  container: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 56,
    paddingHorizontal: spacing.sm,
  },
  rightAction: {
    alignItems: 'flex-end',
    minWidth: 44,
  },
  spacer: {
    minWidth: 44,
  },
  subtitle: {
    color: colors.muted,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  title: {
    color: colors.text,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    textAlign: 'center',
  },
  titleContainer: {
    alignItems: 'center',
    flex: 1,
  },
});

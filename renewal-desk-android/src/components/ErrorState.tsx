import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, fontSize, fontWeight, radius, spacing } from '../theme/tokens';

type ErrorStateProps = {
  message?: string;
  onRetry?: () => void;
};

export function ErrorState({
  message = 'Something went wrong. Please try again.',
  onRetry,
}: ErrorStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <Text style={styles.icon}>!</Text>
      </View>
      <Text style={styles.message}>{message}</Text>
      {onRetry ? (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={onRetry}
          style={styles.retry}
        >
          <Text style={styles.retryText}>Try Again</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: colors.criticalSurface,
    borderColor: colors.criticalBorder,
    borderRadius: radius.lg,
    borderWidth: 1,
    margin: spacing.lg,
    padding: spacing.xxl,
  },
  icon: {
    color: colors.critical,
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.bold,
  },
  iconContainer: {
    alignItems: 'center',
    backgroundColor: colors.criticalBorder,
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    marginBottom: spacing.md,
    width: 40,
  },
  message: {
    color: colors.critical,
    fontSize: fontSize.base,
    lineHeight: 20,
    textAlign: 'center',
  },
  retry: {
    backgroundColor: colors.critical,
    borderRadius: radius.md,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  retryText: {
    color: colors.textInverse,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
});

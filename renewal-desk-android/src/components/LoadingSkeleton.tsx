import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '../theme/tokens';

type LoadingSkeletonProps = {
  lines?: number;
  height?: number;
  style?: object;
};

function SkeletonLine({ width, height }: { width: `${number}%` | number; height: number }) {
  const [opacity] = useState(() => new Animated.Value(0.3));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        styles.line,
        {
          height,
          opacity,
          width,
        },
      ]}
    />
  );
}

export function LoadingSkeleton({ lines = 3, height = 14 }: LoadingSkeletonProps) {
  const widths: (`${number}%` | number)[] = ['100%', '85%', '70%', '90%', '60%'];

  return (
    <View style={styles.container}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine
          key={i}
          height={height}
          width={widths[i % widths.length]}
        />
      ))}
    </View>
  );
}

export function CardSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <SkeletonLine width={40} height={40} />
        <View style={styles.textBlock}>
          <SkeletonLine width="60%" height={16} />
          <SkeletonLine width="40%" height={12} />
        </View>
      </View>
      <SkeletonLine width="90%" height={12} />
      <SkeletonLine width="70%" height={12} />
    </View>
  );
}

export function DashboardSkeleton() {
  return (
    <View style={styles.dashboardContainer}>
      <SkeletonLine width="50%" height={24} />
      <SkeletonLine width="70%" height={14} />
      <View style={styles.metricsRow}>
        {[1, 2, 3, 4].map((i) => (
          <View key={i} style={styles.metricSkeleton}>
            <SkeletonLine width={32} height={32} />
            <SkeletonLine width="80%" height={12} />
            <SkeletonLine width="60%" height={24} />
          </View>
        ))}
      </View>
      <CardSkeleton />
      <CardSkeleton />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  container: {
    gap: spacing.sm,
    padding: spacing.lg,
  },
  dashboardContainer: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  line: {
    backgroundColor: colors.gray200,
    borderRadius: radius.sm,
  },
  metricSkeleton: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flex: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  textBlock: {
    flex: 1,
    gap: spacing.xs,
  },
});

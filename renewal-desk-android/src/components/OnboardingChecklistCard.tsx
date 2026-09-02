import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import { OnboardingProgressData, getOnboardingProgress } from '../services/apiClient';

interface OnboardingChecklistCardProps {
  onNavigate: (route: string) => void;
}

export function OnboardingChecklistCard({ onNavigate }: OnboardingChecklistCardProps) {
  const [data, setData] = useState<OnboardingProgressData | null>(null);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getOnboardingProgress().then((res) => {
      if (!cancelled && res.ok) {
        setData(res.data);
      }
    });
    return () => { cancelled = true; };
  }, []);

  if (!data || data.is_complete) {
    return null;
  }

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        <View style={styles.headerLeft}>
          <View style={styles.progressBadge}>
            <Text style={styles.progressBadgeText}>{data.percentage}%</Text>
          </View>
          <View>
            <Text style={styles.title}>Setup Checklist</Text>
            <Text style={styles.subtitle}>
              {data.completed_count} of {data.total_count} steps completed
            </Text>
          </View>
        </View>
        <View style={styles.expandIconCircle}>
          <Icon name={expanded ? 'chevronUp' : 'chevronDown'} size={18} color={colors.textSecondary} />
        </View>
      </TouchableOpacity>

      {/* Progress Bar */}
      <View style={styles.progressBarBg}>
        <View style={[styles.progressBarFill, { width: `${Math.max(data.percentage, 4)}%` }]} />
      </View>

      {/* Expanded Checklist Steps */}
      {expanded && (
        <View style={styles.stepList}>
          {data.steps.map((step) => (
            <TouchableOpacity
              key={step.id}
              style={[styles.stepRow, step.completed && styles.stepRowCompleted]}
              onPress={() => {
                if (step.route) {
                  onNavigate(step.route);
                }
              }}
              disabled={!step.route || step.completed}
              activeOpacity={0.7}
            >
              <View style={styles.stepIconWrap}>
                <Icon
                  name={step.completed ? 'checkmark' : 'time'}
                  size={18}
                  color={step.completed ? colors.success : colors.muted}
                />
              </View>
              <Text
                style={[
                  styles.stepTitle,
                  step.completed && styles.stepTitleCompleted,
                ]}
              >
                {step.title}
              </Text>
              {!step.completed && step.route && (
                <View style={styles.stepForwardWrap}>
                  <Icon name="forward" size={14} color={colors.brand} />
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.borderLight,
    borderRadius: radius.xl,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.lg,
    ...shadows.sm,
  },
  expandIconCircle: {
    alignItems: 'center',
    backgroundColor: colors.gray100,
    borderRadius: radius.full,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headerLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  progressBarBg: {
    backgroundColor: colors.gray100,
    borderRadius: radius.full,
    height: 6,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  progressBarFill: {
    backgroundColor: colors.brand,
    borderRadius: radius.full,
    height: 6,
  },
  progressBadge: {
    alignItems: 'center',
    backgroundColor: colors.brandSubtle,
    borderColor: colors.infoBorder,
    borderRadius: radius.full,
    borderWidth: 1,
    justifyContent: 'center',
    minWidth: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  progressBadgeText: {
    color: colors.brandDark,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.extrabold,
  },
  stepForwardWrap: {
    marginLeft: spacing.xs,
  },
  stepIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
  },
  stepList: {
    borderTopColor: colors.borderLight,
    borderTopWidth: 1,
    gap: spacing.xxs,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
  },
  stepRow: {
    alignItems: 'center',
    borderRadius: radius.md,
    flexDirection: 'row',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  stepRowCompleted: {
    opacity: 0.75,
  },
  stepTitle: {
    color: colors.text,
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    marginLeft: spacing.sm,
  },
  stepTitleCompleted: {
    color: colors.muted,
    textDecorationLine: 'line-through',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
  },
});

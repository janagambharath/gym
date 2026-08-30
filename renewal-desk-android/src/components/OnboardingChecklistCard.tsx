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
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    getOnboardingProgress().then((res) => {
      if (res.ok) {
        setData(res.data);
      }
    });
  }, []);

  if (!data || data.is_complete) {
    return null;
  }

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.8}
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
        <Icon name={expanded ? 'chevronUp' : 'chevronDown'} size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      {/* Progress Bar */}
      <View style={styles.progressBarBg}>
        <View style={[styles.progressBarFill, { width: `${data.percentage}%` }]} />
      </View>

      {/* Expanded Checklist Steps */}
      {expanded && (
        <View style={styles.stepList}>
          {data.steps.map((step) => (
            <TouchableOpacity
              key={step.id}
              style={styles.stepRow}
              onPress={() => {
                if (step.route) {
                  onNavigate(step.route);
                }
              }}
              disabled={!step.route || step.completed}
              activeOpacity={0.7}
            >
              <Icon
                name={step.completed ? 'checkmark' : 'time'}
                size={18}
                color={step.completed ? colors.success : colors.muted}
              />
              <Text
                style={[
                  styles.stepTitle,
                  step.completed && styles.stepTitleCompleted,
                ]}
              >
                {step.title}
              </Text>
              {!step.completed && step.route && (
                <Icon name="forward" size={14} color={colors.brand} />
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
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    ...shadows.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressBadge: {
    backgroundColor: colors.brandSubtle,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    marginRight: spacing.md,
  },
  progressBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.brandDark,
  },
  title: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  subtitle: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  progressBarBg: {
    height: 4,
    backgroundColor: colors.background,
    borderRadius: radius.full,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 4,
    backgroundColor: colors.brand,
    borderRadius: radius.full,
  },
  stepList: {
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingTop: spacing.xs,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  stepTitle: {
    fontSize: fontSize.xs,
    color: colors.text,
    fontWeight: fontWeight.medium,
    marginLeft: spacing.sm,
    flex: 1,
  },
  stepTitleCompleted: {
    color: colors.muted,
    textDecorationLine: 'line-through',
  },
});

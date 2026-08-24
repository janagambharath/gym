import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, fontSize, fontWeight, spacing } from '../theme/tokens';

type SectionHeaderProps = {
  title: string;
  icon?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
};

export function SectionHeader({ title, icon, actionLabel, onAction }: SectionHeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.left}>
        {icon ? <View style={styles.iconWrap}>{icon}</View> : null}
        <Text style={styles.title}>{title}</Text>
      </View>
      {actionLabel && onAction ? (
        <TouchableOpacity onPress={onAction} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.action}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    color: colors.brand,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  iconWrap: {
    marginRight: spacing.sm,
  },
  left: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
});

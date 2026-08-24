import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, fontSize, fontWeight, radius, spacing } from '../theme/tokens';

type FilterOption = {
  key: string;
  label: string;
  count?: number;
  dotColor?: string;
};

type FilterChipsProps = {
  options: FilterOption[];
  selected: string;
  onSelect: (key: string) => void;
};

export function FilterChips({ options, selected, onSelect }: FilterChipsProps) {
  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      horizontal
      showsHorizontalScrollIndicator={false}
    >
      {options.map((option) => {
        const isSelected = option.key === selected;
        return (
          <TouchableOpacity
            key={option.key}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(option.key)}
            style={[styles.chip, isSelected && styles.chipActive]}
          >
            <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>
              {option.label}
            </Text>
            {option.dotColor ? (
              <View style={[styles.dot, { backgroundColor: isSelected ? colors.textInverse : option.dotColor }]} />
            ) : null}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    height: 38,
    paddingHorizontal: spacing.lg,
  },
  chipActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  chipText: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  chipTextActive: {
    color: colors.textInverse,
  },
  container: {
    flexGrow: 0,
    maxHeight: 54,
  },
  dot: {
    borderRadius: 4,
    height: 6,
    width: 6,
  },
  scroll: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
});

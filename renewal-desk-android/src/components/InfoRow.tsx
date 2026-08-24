import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, fontWeight, spacing } from '../theme/tokens';

type InfoRowProps = {
  label: string;
  value: string;
  valueColor?: string;
  mono?: boolean;
};

export function InfoRow({ label, value, valueColor, mono }: InfoRowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text
        style={[
          styles.value,
          valueColor ? { color: valueColor } : undefined,
          mono ? styles.mono : undefined,
        ]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    color: colors.muted,
    fontSize: fontSize.base,
    width: 110,
  },
  mono: {
    fontVariant: ['tabular-nums'],
  },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    minHeight: 32,
    paddingVertical: spacing.xs,
  },
  value: {
    color: colors.text,
    flex: 1,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    textAlign: 'right',
  },
});

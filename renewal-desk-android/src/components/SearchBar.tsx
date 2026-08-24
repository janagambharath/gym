import { StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fontSize, radius, spacing } from '../theme/tokens';

type SearchBarProps = {
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
};

export function SearchBar({
  placeholder = 'Search name, phone or member ID',
  value,
  onChangeText,
}: SearchBarProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>⌕</Text>
      <TextInput
        accessibilityLabel="Search"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  icon: {
    color: colors.muted,
    fontSize: 18,
    marginRight: spacing.sm,
  },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: fontSize.lg,
    paddingVertical: spacing.sm,
  },
});

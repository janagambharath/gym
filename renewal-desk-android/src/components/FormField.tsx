import { StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fontSize, fontWeight, radius, spacing } from '../theme/tokens';

type FormFieldProps = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  error?: string;
  keyboardType?: 'default' | 'email-address' | 'number-pad' | 'decimal-pad' | 'phone-pad';
  secureTextEntry?: boolean;
  editable?: boolean;
  multiline?: boolean;
  numberOfLines?: number;
  maxLength?: number;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  returnKeyType?: 'done' | 'go' | 'next' | 'search' | 'send';
  onSubmitEditing?: () => void;
  accessibilityLabel?: string;
};

export function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  keyboardType = 'default',
  secureTextEntry,
  editable = true,
  multiline,
  numberOfLines,
  maxLength,
  autoCapitalize,
  returnKeyType,
  onSubmitEditing,
  accessibilityLabel,
}: FormFieldProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={accessibilityLabel ?? label}
        autoCapitalize={autoCapitalize}
        editable={editable}
        keyboardType={keyboardType}
        maxLength={maxLength}
        multiline={multiline}
        numberOfLines={numberOfLines}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        returnKeyType={returnKeyType}
        secureTextEntry={secureTextEntry}
        style={[
          styles.input,
          multiline && styles.multiline,
          error ? styles.inputError : undefined,
          !editable && styles.disabled,
        ]}
        value={value}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  disabled: {
    backgroundColor: colors.gray100,
    color: colors.muted,
  },
  error: {
    color: colors.critical,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: fontSize.lg,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  inputError: {
    borderColor: colors.critical,
  },
  label: {
    color: colors.textSecondary,
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
});

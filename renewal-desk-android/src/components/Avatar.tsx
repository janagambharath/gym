import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, fontWeight, spacing } from '../theme/tokens';

type AvatarProps = {
  name: string;
  size?: number;
  color?: string;
};

const AVATAR_COLORS = [
  '#2563EB', '#7C3AED', '#059669', '#D97706', '#DC2626',
  '#0891B2', '#4F46E5', '#0D9488', '#CA8A04', '#E11D48',
];

function getColorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return (parts[0]?.[0] ?? '?').toUpperCase();
}

export function Avatar({ name, size = 40, color }: AvatarProps) {
  const bgColor = color ?? getColorForName(name);
  const initials = getInitials(name);
  const textSize = size * 0.4;

  return (
    <View
      accessibilityLabel={`Avatar for ${name}`}
      style={[
        styles.container,
        {
          backgroundColor: bgColor,
          borderRadius: size / 2,
          height: size,
          width: size,
        },
      ]}
    >
      <Text style={[styles.text, { fontSize: textSize }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: colors.textInverse,
    fontWeight: fontWeight.bold,
  },
});

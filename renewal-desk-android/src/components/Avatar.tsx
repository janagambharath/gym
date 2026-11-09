import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, fontWeight, fontFamily} from '../theme/tokens';
import { resolveAvatarContent } from './avatarContent';

type AvatarProps = {
  name: string;
  size?: number;
  color?: string;
  textColor?: string;
  /** Member profile photo URL — renders a circular cover image when
   * present, initials otherwise. Signed URLs expire in 7 days; an
   * expired/offline URL falls back to initials via onError instead of
   * showing a broken image (spec §4.2). */
  photoUrl?: string | null;
};

export function Avatar({ name, size = 40, color, textColor = colors.textInverse, photoUrl }: AvatarProps) {
  // A photo that fails to load (expired signed URL, offline) degrades
  // to initials for this render — the next member re-fetch refreshes
  // the URL.
  const [photoFailed, setPhotoFailed] = useState(false);
  const content = resolveAvatarContent({ name, photoUrl: photoFailed ? undefined : photoUrl, color });
  const textSize = size * 0.4;
  const shape = {
    borderRadius: size / 2,
    height: size,
    width: size,
  };

  if (content.kind === 'photo') {
    return (
      <Image
        source={{ uri: content.uri }}
        style={[styles.image, shape]}
        resizeMode="cover"
        accessibilityLabel={`Avatar for ${name}`}
        onError={() => setPhotoFailed(true)}
      />
    );
  }

  return (
    <View
      accessibilityLabel={`Avatar for ${name}`}
      style={[
        styles.container,
        {
          backgroundColor: content.color,
          ...shape,
        },
      ]}
    >
      <Text style={[styles.text, { color: textColor, fontSize: textSize }]}>{content.initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    // borderRadius on the Image itself (not a wrapper) so the photo is
    // clipped to the circle on Android.
    overflow: 'hidden',
  },
  text: {
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
});

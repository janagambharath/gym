// Pure avatar content decision — which visual an Avatar shows.
//
// Free of react-native imports on purpose: Avatar.tsx cannot be imported
// under node (its chain pulls in react-native, whose Flow-typed entry
// esbuild cannot parse), so the photo-vs-initials branch lives here where
// the `tsx --test` harness can exercise it directly. Same reason
// idempotencyKey.ts / qrUploadHeaders.ts exist as pure modules.
// Avatar.tsx renders whatever this resolves.

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

export type AvatarContent =
  | { kind: 'photo'; uri: string }
  | { kind: 'initials'; initials: string; color: string };

/**
 * Resolve what an Avatar shows. A non-empty photoUrl wins and renders
 * an <Image>; anything else (undefined / null / '') falls back to the
 * coloured initials circle. The empty-string case matters: a backend
 * that ever serialises "" instead of null must not render a broken
 * image.
 */
export function resolveAvatarContent(args: {
  name: string;
  photoUrl?: string | null;
  color?: string;
}): AvatarContent {
  const uri = args.photoUrl?.trim();
  if (uri) {
    return { kind: 'photo', uri };
  }
  return {
    kind: 'initials',
    initials: getInitials(args.name),
    color: args.color ?? getColorForName(args.name),
  };
}

/**
 * MemberProfileScreen — Member profile, gym info, settings, and sign-out.
 *
 * Shows: member details, gym contact, payment info, sign out,
 * and account deletion flow.
 */
import { useCallback, useRef, useState } from 'react';
import { useLiveEffect } from '../../hooks/useLiveEffect';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Icon } from '../../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing, fontFamily} from '../../theme/tokens';
import type { MemberProfile } from '../../services/memberApiClient';
import {
  deleteMemberAccount,
  fetchMemberProfile,
  getMemberSession,
  removeMemberPhoto,
  updateMemberProfile,
  uploadMemberPhoto,
} from '../../services/memberApiClient';
import { keyForAction, shouldReleaseKey, type StableKeySlot } from '../../services/stableKey';
import { ErrorState } from '../../components/ErrorState';
import { getRuntimeConfiguration } from '../../config/runtime';
import { getAppVersion } from '../../services/appVersion';

type MemberProfileScreenProps = {
  onLogout: () => void;
};

export function MemberProfileScreen({ onLogout }: MemberProfileScreenProps) {
  // V11-L34: real version + build from the embedded app config —
  // the hardcoded "v1.0" reported the same string for every build.
  const appVersion = getAppVersion();
  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // V12-L7: member self-service photo + edit (parity with RN
  // ProfileScreen / web renderProfile — this surface was read-only).
  const [photoFailed, setPhotoFailed] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoKeyRef = useRef<StableKeySlot>(undefined);
  const [profileForm, setProfileForm] = useState({ email: '', address: '', gender: '' });
  const [savingDetails, setSavingDetails] = useState(false);
  const formInitRef = useRef(false);

  const session = getMemberSession();

  const [revision, setRevision] = useState(0);

  useLiveEffect(() => {
    let active = true;
    void fetchMemberProfile().then((result) => {
      if (!active) return;
      if (result.ok) {
        setProfile(result.data);
        setError(undefined);
        // V12-L7: prefill the edit form from the saved profile once
        // (later refetches must not clobber typing).
        if (!formInitRef.current) {
          formInitRef.current = true;
          const savedGender = String(result.data.member.gender || '').toLowerCase();
          setProfileForm({
            email: result.data.member.email || '',
            address: result.data.member.address || '',
            gender: ['female', 'male', 'other'].includes(savedGender) ? savedGender : '',
          });
        }
      } else {
        setError(result.error);
      }
      setLoading(false);
      setRefreshing(false);
    });
    return () => {
      active = false;
    };
  }, [revision]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setRevision((r) => r + 1);
  }, []);

  // V12-L7: member self-service photo — picker + guards copied from
  // the owner flow (MemberDetailScreen): 1:1 crop, quality 0.82, no
  // EXIF, 3 MB + MIME guards, then POST /api/member/v1/profile/photo.
  // The returned signed URL replaces local state immediately; the
  // next refetch refreshes it before the 7-day expiry.
  const handleChoosePhoto = useCallback(async () => {
    if (photoBusy) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.82,
        exif: false,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > 3 * 1024 * 1024) {
        Alert.alert('Photo is too large', 'Choose a photo that is 3 MB or smaller.');
        return;
      }
      const mimeType = asset.mimeType || (asset.fileName?.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
        Alert.alert('Unsupported photo', 'Choose a JPEG, PNG, or WebP image.');
        return;
      }
      setPhotoBusy(true);
      // V11-L32: stable key per member — a retry after a lost
      // response replays instead of storing a second photo.
      const { key: photoKey, slot } = keyForAction(photoKeyRef.current, 'member-photo');
      photoKeyRef.current = slot;
      const res = await uploadMemberPhoto(
        {
          uri: asset.uri,
          name: asset.fileName || `profile.${mimeType === 'image/png' ? 'png' : 'jpg'}`,
          mimeType,
        },
        photoKey,
      );
      if (shouldReleaseKey(res.ok, res.ok ? undefined : res.error.status)) {
        photoKeyRef.current = undefined;
      }
      if (res.ok) {
        setPhotoFailed(false);
        setProfile((current) =>
          current
            ? { ...current, member: { ...current.member, profile_photo_url: res.data.profile_photo_url } }
            : current,
        );
        Alert.alert('Profile photo updated', 'Your profile photo has been saved.');
      } else {
        Alert.alert('Could not update photo', res.error.message || 'Please try again.');
      }
    } catch {
      Alert.alert('Could not update photo', 'Please try again.');
    } finally {
      setPhotoBusy(false);
    }
  }, [photoBusy]);

  const handleRemovePhoto = useCallback(() => {
    Alert.alert('Remove profile photo?', 'Your profile will show initials instead.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setPhotoBusy(true);
          const res = await removeMemberPhoto();
          setPhotoBusy(false);
          if (res.ok) {
            setProfile((current) =>
              current
                ? { ...current, member: { ...current.member, profile_photo_url: null } }
                : current,
            );
          } else {
            Alert.alert('Could not remove photo', res.error || 'Please try again.');
          }
        },
      },
    ]);
  }, []);

  const handleSaveDetails = useCallback(async () => {
    if (savingDetails) return;
    const saved = profile?.member;
    const dirty =
      saved &&
      (profileForm.email !== (saved.email || '') ||
        profileForm.address !== (saved.address || '') ||
        profileForm.gender !== (saved.gender || ''));
    if (!dirty) return;
    setSavingDetails(true);
    const result = await updateMemberProfile({
      email: profileForm.email.trim() || null,
      address: profileForm.address.trim() || null,
      gender: profileForm.gender.trim() || null,
    });
    setSavingDetails(false);
    if (result.ok) {
      const savedMember = result.data.member;
      const savedGender = String(savedMember.gender || '').toLowerCase();
      setProfile(result.data);
      setProfileForm({
        email: savedMember.email || '',
        address: savedMember.address || '',
        gender: ['female', 'male', 'other'].includes(savedGender) ? savedGender : '',
      });
      Alert.alert('Profile updated', 'Your contact details have been saved.');
    } else {
      Alert.alert('Could not save details', result.error || 'Please try again.');
    }
  }, [profile, profileForm, savingDetails]);

  const handleSignOut = useCallback(() => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          // V12-M7: do NOT clear the local session here — onLogout
          // (App handleMemberLogout) revokes the server session first
          // via logoutMemberSession, which needs the stored refresh
          // token, then clears locally. Clearing here first would
          // strand the refresh token live server-side.
          onLogout();
        },
      },
    ]);
  }, [onLogout]);

  // Double-confirm: deleting the member account soft-deletes the member
  // record at the gym (same as the owner deactivating the member) and
  // cannot be undone from the app — the gym has to re-add the member.
  const handleDeleteAccount = useCallback(() => {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your member account at this gym, including your membership record and access. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Are you absolutely sure?',
              'Your membership, payment history and gym access will be deleted. To rejoin, the gym will need to add you as a member again.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete Permanently',
                  style: 'destructive',
                  onPress: async () => {
                    const res = await deleteMemberAccount();
                    if (res.ok) {
                      onLogout();
                    } else {
                      Alert.alert('Error', res.error || 'Could not delete account. Please try again.');
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  }, [onLogout]);

  const handlePrivacyPolicy = useCallback(() => {
    const config = getRuntimeConfiguration();
    if (!config.apiBaseUrl) {
      Alert.alert('Error', 'API base URL is not configured for this build.');
      return;
    }
    const privacyUrl = `${config.apiBaseUrl}/privacy`;
    void Linking.openURL(privacyUrl);
  }, []);

  if (loading && !profile) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      </SafeAreaView>
    );
  }

  if (error && !profile) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ErrorState message={error} onRetry={handleRefresh} />
      </SafeAreaView>
    );
  }

  const member = profile?.member;
  const gym = profile?.gym;
  const payment = profile?.payment_info;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Profile</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.brand}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* User Card */}
        <View style={styles.card}>
          <View style={styles.avatarRow}>
            {/* V12-L7: show the member photo when set (with initials
                fallback on load failure), plus change/remove actions. */}
            {member?.profile_photo_url && !photoFailed ? (
              <Image
                source={{ uri: member.profile_photo_url }}
                style={styles.avatarImage}
                onError={() => setPhotoFailed(true)}
              />
            ) : (
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {(member?.full_name ?? session?.fullName ?? 'M')[0].toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.avatarDetails}>
              <Text style={styles.memberName}>
                {member?.full_name ?? session?.fullName ?? 'Member'}
              </Text>
              <Text style={styles.memberPhone}>
                {member?.phone ?? session?.phone ?? ''}
              </Text>
              <View style={styles.statusBadge}>
                <Text style={styles.statusBadgeText}>
                  {member?.status ? member.status.toUpperCase() : 'ACTIVE'}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.photoActions}>
            <TouchableOpacity
              style={[styles.photoButton, photoBusy && styles.buttonDisabled]}
              onPress={() => void handleChoosePhoto()}
              disabled={photoBusy}
              activeOpacity={0.7}
            >
              <Text style={styles.photoButtonText}>
                {photoBusy ? 'Working…' : member?.profile_photo_url ? 'Change photo' : 'Add profile photo'}
              </Text>
            </TouchableOpacity>
            {member?.profile_photo_url && (
              <TouchableOpacity
                style={[styles.photoButton, photoBusy && styles.buttonDisabled]}
                onPress={handleRemovePhoto}
                disabled={photoBusy}
                activeOpacity={0.7}
              >
                <Text style={[styles.photoButtonText, { color: colors.critical }]}>Remove photo</Text>
              </TouchableOpacity>
            )}
          </View>

          {member?.email && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Email</Text>
              <Text style={styles.infoValue}>{member.email}</Text>
            </View>
          )}

          {member?.address && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Address</Text>
              <Text style={styles.infoValue}>{member.address}</Text>
            </View>
          )}

          {member?.joined_on && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Member Since</Text>
              <Text style={styles.infoValue}>{member.joined_on}</Text>
            </View>
          )}
        </View>

        {/* V12-L7: member self-service edit — email / address / gender
            are the only fields the backend PUT accepts
            (member_api.py member_profile). */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Icon name="edit" size={20} color={colors.brand} />
            <Text style={styles.cardTitle}>Edit Details</Text>
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Email</Text>
            <TextInput
              style={styles.textInput}
              value={profileForm.email}
              onChangeText={(t) => setProfileForm((f) => ({ ...f, email: t }))}
              placeholder="you@example.com"
              placeholderTextColor={colors.muted}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Address</Text>
            <TextInput
              style={[styles.textInput, styles.addressInput]}
              value={profileForm.address}
              onChangeText={(t) => setProfileForm((f) => ({ ...f, address: t }))}
              placeholder="Your address"
              placeholderTextColor={colors.muted}
              multiline
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Gender</Text>
            <View style={styles.genderRow}>
              {[
                { value: '', label: 'Prefer not to say' },
                { value: 'female', label: 'Female' },
                { value: 'male', label: 'Male' },
                { value: 'other', label: 'Other' },
              ].map((option) => (
                <TouchableOpacity
                  key={option.value || 'none'}
                  style={[
                    styles.genderOption,
                    profileForm.gender === option.value && styles.genderOptionSelected,
                  ]}
                  onPress={() => setProfileForm((f) => ({ ...f, gender: option.value }))}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.genderOptionText,
                      profileForm.gender === option.value && styles.genderOptionTextSelected,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity
            style={[styles.saveButton, savingDetails && styles.buttonDisabled]}
            onPress={() => void handleSaveDetails()}
            disabled={savingDetails}
            activeOpacity={0.7}
          >
            {savingDetails ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveButtonText}>Save Details</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Gym Information */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Icon name="business" size={20} color={colors.brand} />
            <Text style={styles.cardTitle}>Gym Details</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Gym</Text>
            <Text style={styles.infoValue}>{gym?.name ?? session?.gymName ?? 'N/A'}</Text>
          </View>

          {gym?.phone && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Phone</Text>
              <Text style={styles.infoValue}>{gym.phone}</Text>
            </View>
          )}

          {gym?.address && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Address</Text>
              <Text style={styles.infoValue}>{gym.address}</Text>
            </View>
          )}
        </View>

        {/* Gym Payment Info */}
        {payment?.upi_id && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Icon name="cash" size={20} color={colors.brand} />
              <Text style={styles.cardTitle}>Gym Payment Details</Text>
            </View>

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>UPI ID</Text>
              <Text style={styles.infoValue}>{payment.upi_id}</Text>
            </View>

            {payment.payment_label && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Name</Text>
                <Text style={styles.infoValue}>{payment.payment_label}</Text>
              </View>
            )}

            {payment.instructions && (
              <Text style={styles.instructionsText}>{payment.instructions}</Text>
            )}
          </View>
        )}

        {/* Legal & Account Links */}
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.menuRow}
            onPress={handlePrivacyPolicy}
            activeOpacity={0.7}
          >
            <View style={styles.menuLeft}>
              <Icon name="document" size={20} color={colors.textSecondary} />
              <Text style={styles.menuText}>Privacy Policy</Text>
            </View>
            <Icon name="forward" size={16} color={colors.muted} />
          </TouchableOpacity>

          <View style={styles.menuDivider} />

          <TouchableOpacity
            style={styles.menuRow}
            onPress={handleDeleteAccount}
            activeOpacity={0.7}
          >
            <View style={styles.menuLeft}>
              <Icon name="trash" size={20} color={colors.critical} />
              <Text style={[styles.menuText, { color: colors.critical }]}>
                Delete Account
              </Text>
            </View>
            <Icon name="forward" size={16} color={colors.muted} />
          </TouchableOpacity>
        </View>

        {/* Sign Out Button */}
        <TouchableOpacity
          style={styles.signOutBtn}
          onPress={handleSignOut}
          activeOpacity={0.7}
        >
          <Icon name="logout" size={20} color={colors.critical} />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        <Text style={styles.versionText}>Renewal Desk v{appVersion.versionLabel} · {appVersion.buildLabel} · Member App</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: fontSize['4xl'],
    fontWeight: fontWeight.extrabold, fontFamily: fontFamily.displayExtra,
    color: colors.text,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.bottomTabSafe,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
    ...shadows.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  cardTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
    color: colors.text,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.brandSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.brand,
  },
  avatarText: {
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.extrabold, fontFamily: fontFamily.displayExtra,
    color: colors.brand,
  },
  avatarImage: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: colors.brand,
    backgroundColor: colors.brandSubtle,
  },
  photoActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  photoButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  photoButtonText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.brand,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  inputContainer: { gap: spacing.sm },
  inputLabel: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontWeight: fontWeight.semibold,
  },
  textInput: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    fontSize: fontSize.base,
    color: colors.text,
  },
  addressInput: {
    minHeight: 64,
    textAlignVertical: 'top',
  },
  genderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  genderOption: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  genderOptionSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSubtle,
  },
  genderOptionText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
  },
  genderOptionTextSelected: {
    color: colors.brand,
  },
  saveButton: {
    backgroundColor: colors.brand,
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
  avatarDetails: {
    flex: 1,
    gap: spacing.xxs,
  },
  memberName: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
    color: colors.text,
  },
  memberPhone: {
    fontSize: fontSize.md,
    color: colors.muted,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.successSurface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    marginTop: spacing.xxs,
  },
  statusBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
    color: colors.success,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xxs,
  },
  infoLabel: {
    fontSize: fontSize.base,
    color: colors.muted,
    fontWeight: fontWeight.medium,
  },
  infoValue: {
    fontSize: fontSize.base,
    color: colors.text,
    fontWeight: fontWeight.semibold,
  },
  instructionsText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    backgroundColor: colors.infoSurface,
    padding: spacing.md,
    borderRadius: radius.md,
    lineHeight: 18,
  },
  menuRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  menuLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  menuText: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.medium,
    color: colors.text,
  },
  menuDivider: {
    height: 1,
    backgroundColor: colors.borderLight,
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.criticalBorder,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginTop: spacing.sm,
  },
  signOutText: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
    color: colors.critical,
  },
  versionText: {
    fontSize: fontSize.xs,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});

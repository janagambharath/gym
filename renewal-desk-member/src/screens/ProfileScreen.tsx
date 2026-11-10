
import React, { useCallback, useState } from 'react';
import { useLiveEffect } from '../hooks/useLiveEffect';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../context/AuthContext';
import { useBranding } from '../context/BrandingContext';
import { apiClient } from '../services/apiClient';
import { StatusBadge } from '../components/StatusBadge';
import { Member } from '../types';
import { colors, radii, spacing, typography } from '../theme/tokens';

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL || 'https://gym-production-910c.up.railway.app').replace(/\/$/, '');

export const ProfileScreen: React.FC = () => {
  const { member: authMember, logout } = useAuth();
  const { theme } = useBranding();

  const [profileData, setProfileData] = useState<{
    member: Member;
    gym: { name: string | null; phone: string | null; address: string | null };
    payment_info: any;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  // V11-L47: a signed photo URL that expired (7-day) or was revoked
  // renders a broken avatar without this — fall back to initials.
  const [photoFailed, setPhotoFailed] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [profileForm, setProfileForm] = useState({ email: '', address: '', gender: '' });

  const fetchProfile = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    setProfileError(null);
    try {
      const data = await apiClient.getProfile();
      setProfileData(data);
      setPhotoFailed(false);
      // V11-L44: gender is a select with exactly '', 'female', 'male',
      // 'other' (the web select's values). A legacy free-text value that
      // matches none of them falls back to '' — the same fallback the
      // web select already applies.
      const savedGender = String(data.member.gender || '').toLowerCase();
      setProfileForm({
        email: data.member.email || '',
        address: data.member.address || '',
        gender: ['female', 'male', 'other'].includes(savedGender) ? savedGender : '',
      });
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Could not load your profile.');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChoosePhoto = useCallback(async () => {
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
      const photoUrl = await apiClient.uploadProfilePhoto(
        asset.uri,
        mimeType,
        asset.fileName || `profile.${mimeType === 'image/png' ? 'png' : 'jpg'}`,
      );
      setPhotoFailed(false);
      setProfileData((current) => current ? {
        ...current,
        member: { ...current.member, profile_photo_url: photoUrl },
      } : current);
    } catch (error) {
      Alert.alert('Could not update photo', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setPhotoBusy(false);
    }
  }, []);

  const handleRemovePhoto = useCallback(() => {
    Alert.alert('Remove profile photo?', 'Your profile will show your initials instead.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setPhotoBusy(true);
          try {
            await apiClient.removeProfilePhoto();
            setPhotoFailed(false);
            setProfileData((current) => current ? {
              ...current,
              member: { ...current.member, profile_photo_url: null },
            } : current);
          } catch (error) {
            Alert.alert('Could not remove photo', error instanceof Error ? error.message : 'Please try again.');
          } finally {
            setPhotoBusy(false);
          }
        },
      },
    ]);
  }, []);

  const handleSaveDetails = useCallback(async () => {
    setSavingDetails(true);
    try {
      const saved = await apiClient.updateProfile({
        email: profileForm.email.trim() || null,
        address: profileForm.address.trim() || null,
        gender: profileForm.gender.trim() || null,
      });
      setProfileData((current) => current ? { ...current, member: saved.member } : current);
      Alert.alert('Profile updated', 'Your contact details have been saved.');
    } catch (error) {
      Alert.alert('Could not save details', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSavingDetails(false);
    }
  }, [profileForm]);

  useLiveEffect(() => {
    const saved = profileData?.member;
    const dirty = saved && (profileForm.email !== (saved.email || '')
      || profileForm.address !== (saved.address || '') || profileForm.gender !== (saved.gender || ''));
    if (!dirty && !photoBusy && !savingDetails) void fetchProfile(true);
    // Read the latest draft on focus/foreground; typing must not trigger a fetch.
  }, [fetchProfile], 0);

  const handleCall = () => {
    const phone = theme.phone;
    if (phone) {
      Linking.openURL(`tel:${phone.replace(/\s+/g, '')}`);
    } else {
      Alert.alert('Not Available', 'No contact phone number is configured for this gym.');
    }
  };

  const handleWhatsApp = () => {
    const wa = theme.whatsapp || theme.phone;
    if (wa) {
      const clean = wa.replace(/\D/g, '');
      const num = clean.startsWith('91') ? clean : `91${clean}`;
      Linking.openURL(`https://wa.me/${num}?text=Hi%20${encodeURIComponent(theme.gymName)},%20I%20have%20a%20question%20about%20my%20membership.`);
    } else {
      Alert.alert('Not Available', 'No WhatsApp number is configured for this gym.');
    }
  };

  const handleMaps = () => {
    const address = theme.address;
    const query = address ? `${theme.gymName}, ${address}` : theme.gymName;
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`);
  };

  const handleOpenPrivacy = () => {
    Linking.openURL(`${API_BASE}/privacy`);
  };

  // V12-M6: in-app self-service deletion calling DELETE
  // /api/member/v1/auth/account (member_api.py:848-953) — double-confirm,
  // then sign out + clear the session. The old flow opened a browser
  // page describing the RRR *owner* Android app, which a member cannot
  // use (no owner login). A failed delete never signs the member out.
  const [deletingAccount, setDeletingAccount] = useState(false);
  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your VYNLA member account and signs you out. Your gym may keep business and tax records as required by law. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Are you sure?',
              'Tap "Delete my account" to permanently delete your account now.',
              [
                { text: 'Keep my account', style: 'cancel' },
                {
                  text: 'Delete my account',
                  style: 'destructive',
                  onPress: async () => {
                    if (deletingAccount) return;
                    setDeletingAccount(true);
                    try {
                      await apiClient.deleteAccount();
                      await logout();
                    } catch (error) {
                      Alert.alert('Could not delete account', error instanceof Error ? error.message : 'Please try again.');
                    } finally {
                      setDeletingAccount(false);
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  };

  const handleLogout = () => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to sign out of VYNLA? You will need your WhatsApp verification code to sign back in.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            await logout();
          },
        },
      ]
    );
  };

  const member = profileData?.member || authMember;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Account & Gym</Text>
          <Text style={styles.headerSubtitle}>Member profile and gym contact information</Text>
        </View>

        {profileError ? (
          <View style={styles.loadErrorCard}>
            <Text style={styles.loadErrorText}>{profileError}</Text>
            <TouchableOpacity onPress={() => void fetchProfile()} disabled={loading} style={styles.retryProfileButton}>
              <Text style={styles.retryProfileText}>{loading ? 'Loading…' : 'Try again'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Member Profile Card */}
        <View style={styles.card}>
          <View style={styles.memberHeaderRow}>
            {member?.profile_photo_url && !photoFailed ? (
              <Image
                source={{ uri: member.profile_photo_url }}
                style={styles.avatarPhoto}
                onError={() => setPhotoFailed(true)}
              />
            ) : (
              <View style={[styles.avatarCircle, { backgroundColor: theme.primary }]}>
                <Text style={[styles.avatarText, { color: theme.primaryText }]}>
                  {member?.full_name ? member.full_name.charAt(0).toUpperCase() : 'M'}
                </Text>
              </View>
            )}
            <View style={styles.memberInfo}>
              <Text style={styles.memberName}>{member?.full_name || 'Gym Member'}</Text>
              <Text style={styles.memberPhone}>+91 {member?.phone?.replace(/\D/g, '')}</Text>
              {member?.email && <Text style={styles.memberEmail}>{member.email}</Text>}
              {member?.address && <Text style={styles.memberEmail}>📍 {member.address}</Text>}
            </View>
          </View>
          <View style={styles.statusPillRow}>
            <Text style={styles.memberIdText}>Member ID: #{member?.id}</Text>
            <StatusBadge status={member?.status || 'ACTIVE'} size="sm" />
          </View>
          <View style={styles.photoActions}>
            <TouchableOpacity style={[styles.photoButton, { backgroundColor: theme.primary, opacity: loading || !profileData ? 0.55 : 1 }]} onPress={handleChoosePhoto} disabled={photoBusy || loading || !profileData}>
              <Ionicons name="camera-outline" size={17} color={theme.primaryText} />
              <Text style={[styles.photoButtonText, { color: theme.primaryText }]}>{photoBusy ? 'Working…' : member?.profile_photo_url ? 'Change photo' : 'Add profile photo'}</Text>
            </TouchableOpacity>
            {member?.profile_photo_url ? (
              <TouchableOpacity style={styles.removePhotoButton} onPress={handleRemovePhoto} disabled={photoBusy || loading || !profileData}>
                <Text style={styles.removePhotoText}>Remove</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={styles.photoHint}>JPEG, PNG, or WebP · up to 3 MB</Text>
        </View>

        {/* Member-editable contact details. Name and phone remain gym managed so access records stay matched. */}
        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>Your contact details</Text>
          <Text style={styles.memberEmail}>Your name and login number are managed by your gym.</Text>
          <Text style={styles.fieldLabel}>Email</Text>
          <TextInput
            value={profileForm.email}
            onChangeText={(email) => setProfileForm((current) => ({ ...current, email }))}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            maxLength={255}
            style={styles.profileInput}
          />
          <Text style={styles.fieldLabel}>Address</Text>
          <TextInput
            value={profileForm.address}
            onChangeText={(address) => setProfileForm((current) => ({ ...current, address }))}
            placeholder="Your address"
            multiline
            maxLength={2000}
            style={[styles.profileInput, styles.addressInput]}
          />
          <Text style={styles.fieldLabel}>Gender (optional)</Text>
          {/* V11-L44: a select with exactly the web select's values —
              '', 'female', 'male', 'other' — so a value saved here always
              matches a web option. No extra dependency: option buttons. */}
          <View style={styles.genderOptions}>
            {([
              { value: '', label: 'Prefer not to say' },
              { value: 'female', label: 'Female' },
              { value: 'male', label: 'Male' },
              { value: 'other', label: 'Other' },
            ] as const).map((option) => {
              const selected = profileForm.gender === option.value;
              return (
                <TouchableOpacity
                  key={option.value || 'blank'}
                  style={[
                    styles.genderOption,
                    selected && [styles.genderOptionSelected, { borderColor: theme.primary }],
                  ]}
                  onPress={() => setProfileForm((current) => ({ ...current, gender: option.value }))}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      styles.genderOptionText,
                      selected && { color: theme.primary, fontWeight: '700' },
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity style={[styles.saveDetailsButton, { backgroundColor: theme.primary, opacity: loading || !profileData ? 0.55 : 1 }]} onPress={handleSaveDetails} disabled={savingDetails || loading || !profileData}>
            <Text style={[styles.photoButtonText, { color: theme.primaryText }]}>{savingDetails ? 'Saving…' : 'Save details'}</Text>
          </TouchableOpacity>
        </View>

        {/* Gym Information & Contact Card */}
        <View style={styles.card}>
          <View style={styles.gymHeaderRow}>
            <Ionicons name="business" size={20} color={theme.primary} />
            <Text style={styles.cardSectionTitle}>{theme.gymName}</Text>
          </View>

          {theme.hours ? (
            <View style={styles.infoRow}>
              <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.infoRowText}>{theme.hours}</Text>
            </View>
          ) : null}

          {theme.address ? (
            <View style={styles.infoRow}>
              <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.infoRowText}>{theme.address}</Text>
            </View>
          ) : null}

          {/* Contact Action Buttons */}
          <View style={styles.actionButtonRow}>
            <TouchableOpacity style={styles.contactButton} onPress={handleCall} activeOpacity={0.85}>
              <Ionicons name="call" size={16} color={theme.primary} />
              <Text style={[styles.contactButtonText, { color: theme.primary }]}>Call Gym</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.contactButton} onPress={handleWhatsApp} activeOpacity={0.85}>
              <Ionicons name="logo-whatsapp" size={16} color={colors.whatsapp} />
              <Text style={[styles.contactButtonText, { color: colors.whatsapp }]}>WhatsApp</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.contactButton} onPress={handleMaps} activeOpacity={0.85}>
              <Ionicons name="map-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.contactButtonText}>Directions</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Legal & Compliance Section */}
        <View style={styles.card}>
          <Text style={styles.menuSectionTitle}>Legal & Privacy</Text>

          <TouchableOpacity style={styles.menuItem} onPress={handleOpenPrivacy} activeOpacity={0.7}>
            <View style={styles.menuItemLeft}>
              <Ionicons name="shield-checkmark-outline" size={18} color={colors.textSecondary} />
              <Text style={styles.menuItemText}>Privacy Policy</Text>
            </View>
            <Ionicons name="open-outline" size={16} color={colors.muted} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={handleDeleteAccount} activeOpacity={0.7}>
            <View style={styles.menuItemLeft}>
              <Ionicons name="trash-outline" size={18} color={colors.expired} />
              <Text style={[styles.menuItemText, { color: colors.expired }]}>Request Account Deletion</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.muted} />
          </TouchableOpacity>
        </View>

        {/* App Version & Platform Note */}
        <View style={styles.versionContainer}>
          <Text style={styles.versionText}>VYNLA v1.0.0 (Build 1)</Text>
          <Text style={styles.subtext}>Connected to {theme.gymName} via Renewal Desk</Text>
        </View>

        {/* Sign Out Button */}
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.85}>
          <Ionicons name="log-out-outline" size={20} color={colors.expired} />
          <Text style={styles.logoutText}>Sign Out of VYNLA</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  header: {
    marginBottom: spacing.lg,
  },
  headerTitle: {
    ...typography.h1,
    color: colors.text,
  },
  headerSubtitle: {
    ...typography.subtext,
    color: colors.textSecondary,
    marginTop: 2,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 2,
  },
  memberHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPhoto: {
    width: 64,
    height: 64,
    borderRadius: radii.full,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.borderSubtle,
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '700',
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    ...typography.h2,
    color: colors.text,
  },
  memberPhone: {
    ...typography.bodySemibold,
    color: colors.textSecondary,
    marginTop: 2,
  },
  memberEmail: {
    ...typography.subtext,
    color: colors.muted,
    marginTop: 2,
  },
  statusPillRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  memberIdText: {
    ...typography.caption,
    color: colors.muted,
  },
  photoActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  photoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  photoButtonText: {
    ...typography.bodySemibold,
  },
  removePhotoButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  removePhotoText: {
    ...typography.subtext,
    color: colors.expired,
    fontWeight: '600',
  },
  photoHint: {
    ...typography.caption,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  loadErrorCard: {
    backgroundColor: '#FEF2F2',
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: '#FECACA',
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  loadErrorText: {
    ...typography.subtext,
    color: colors.expired,
  },
  retryProfileButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  retryProfileText: {
    ...typography.bodySemibold,
    color: colors.expired,
  },
  fieldLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  profileInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.text,
    backgroundColor: '#FFFFFF',
    fontSize: 15,
  },
  addressInput: {
    minHeight: 84,
    textAlignVertical: 'top',
  },
  // V11-L44: gender select options.
  genderOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  genderOption: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: '#FFFFFF',
  },
  genderOptionSelected: {
    backgroundColor: '#EFF6FF',
  },
  genderOptionText: {
    ...typography.subtext,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  saveDetailsButton: {
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  gymHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  cardSectionTitle: {
    ...typography.h3,
    color: colors.text,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  infoRowText: {
    ...typography.subtext,
    color: colors.textSecondary,
    flex: 1,
    lineHeight: 18,
  },
  actionButtonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  contactButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: radii.md,
    paddingVertical: spacing.sm + 2,
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  contactButtonText: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.text,
  },
  menuSectionTitle: {
    ...typography.caption,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  menuItemText: {
    ...typography.body,
    color: colors.text,
  },
  versionContainer: {
    alignItems: 'center',
    marginVertical: spacing.lg,
  },
  versionText: {
    ...typography.caption,
    color: colors.muted,
    fontWeight: '600',
  },
  subtext: {
    ...typography.caption,
    color: colors.muted,
    marginTop: 2,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.expiredSurface,
    borderWidth: 1,
    borderColor: colors.expiredBorder,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  logoutText: {
    ...typography.bodySemibold,
    color: colors.expired,
  },
});

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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

  const fetchProfile = useCallback(async () => {
    try {
      const data = await apiClient.getProfile();
      setProfileData(data);
    } catch {
      // Non-fatal
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

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

  const handleDeleteAccount = () => {
    Alert.alert(
      'Account Deletion',
      'Under Google Play and data privacy regulations, you can request account deletion. Gym business and tax records may be retained according to statutory retention rules.\n\nProceed to account deletion request page?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Open Deletion Page',
          onPress: () => Linking.openURL(`${API_BASE}/delete-account`),
        },
      ]
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

        {/* Member Profile Card */}
        <View style={styles.card}>
          <View style={styles.memberHeaderRow}>
            <View style={[styles.avatarCircle, { backgroundColor: theme.primary }]}>
              <Text style={[styles.avatarText, { color: theme.primaryText }]}>
                {member?.full_name ? member.full_name.charAt(0).toUpperCase() : 'M'}
              </Text>
            </View>
            <View style={styles.memberInfo}>
              <Text style={styles.memberName}>{member?.full_name || 'Gym Member'}</Text>
              <Text style={styles.memberPhone}>+91 {member?.phone?.replace(/\D/g, '')}</Text>
              {member?.email && <Text style={styles.memberEmail}>{member.email}</Text>}
            </View>
          </View>
          <View style={styles.statusPillRow}>
            <Text style={styles.memberIdText}>Member ID: #{member?.id}</Text>
            <StatusBadge status={member?.status || 'ACTIVE'} size="sm" />
          </View>
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

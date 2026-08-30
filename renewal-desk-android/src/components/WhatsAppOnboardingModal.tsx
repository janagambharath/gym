import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import { connectWaba, updateWhatsAppProfile } from '../services/apiClient';

interface WhatsAppOnboardingModalProps {
  visible: boolean;
  onClose: () => void;
  onConnected: () => void;
  currentProfile?: {
    about: string;
    description: string;
    address: string;
    email: string;
  };
}

export function WhatsAppOnboardingModal({
  visible,
  onClose,
  onConnected,
  currentProfile,
}: WhatsAppOnboardingModalProps) {
  const [method, setMethod] = useState<'coexistence' | 'new_number'>('coexistence');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [businessPhone, setBusinessPhone] = useState('');
  const [aboutText, setAboutText] = useState(currentProfile?.about || '');
  const [addressText, setAddressText] = useState(currentProfile?.address || '');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'connect' | 'profile'>('connect');

  const handleLaunchEmbeddedSignup = async () => {
    try {
      const onboardingUrl = 'https://www.facebook.com/v19.0/dialog/oauth?client_id=1098320491823901&redirect_uri=https://gym-production-910c.up.railway.app/whatsapp/embedded-callback&scope=whatsapp_business_management,whatsapp_business_messaging';
      const supported = await Linking.canOpenURL(onboardingUrl);
      if (supported) {
        await Linking.openURL(onboardingUrl);
      } else {
        Alert.alert('Browser Error', 'Could not open Meta signup URL in browser.');
      }
    } catch {
      Alert.alert('Error', 'Failed to launch Meta Embedded Signup dialog.');
    }
  };

  const handleSaveConnection = async () => {
    if (!phoneNumberId.trim()) {
      Alert.alert('Validation Error', 'Please enter your Meta Phone Number ID.');
      return;
    }

    setLoading(true);
    try {
      const res = await connectWaba({
        wabaId: wabaId.trim() || undefined,
        phoneNumberId: phoneNumberId.trim(),
        businessPhoneNumber: businessPhone.trim() || undefined,
      });

      if (res.ok) {
        Alert.alert('Connected!', 'WhatsApp Business connected successfully to Renewal Desk.');
        onConnected();
        onClose();
      } else {
        Alert.alert('Connection Failed', res.error?.message || 'Could not verify Meta WABA connection.');
      }
    } catch {
      Alert.alert('Network Error', 'Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    setLoading(true);
    try {
      const res = await updateWhatsAppProfile({
        about: aboutText.trim(),
        address: addressText.trim(),
      });

      if (res.ok) {
        Alert.alert('Profile Updated', 'WhatsApp Business profile updated on Meta Cloud API.');
        onConnected();
        onClose();
      } else {
        Alert.alert('Update Failed', res.error?.message || 'Could not update profile on Meta.');
      }
    } catch {
      Alert.alert('Network Error', 'Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Modal Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Icon name="whatsapp" size={24} color={colors.whatsapp} />
              <Text style={styles.headerTitle}>WhatsApp Business Setup</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Icon name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Tabs */}
          <View style={styles.tabsRow}>
            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'connect' && styles.tabBtnActive]}
              onPress={() => setActiveTab('connect')}
            >
              <Text style={[styles.tabBtnText, activeTab === 'connect' && styles.tabBtnTextActive]}>
                Connect WABA
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'profile' && styles.tabBtnActive]}
              onPress={() => setActiveTab('profile')}
            >
              <Text style={[styles.tabBtnText, activeTab === 'profile' && styles.tabBtnTextActive]}>
                Business Profile
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {activeTab === 'connect' ? (
              <View>
                {/* Method Selector */}
                <Text style={styles.sectionLabel}>Select Connection Path</Text>
                <View style={styles.methodCards}>
                  <TouchableOpacity
                    style={[
                      styles.methodCard,
                      method === 'coexistence' && styles.methodCardActive,
                    ]}
                    onPress={() => setMethod('coexistence')}
                  >
                    <View style={styles.methodRadio}>
                      {method === 'coexistence' && <View style={styles.methodRadioInner} />}
                    </View>
                    <View style={styles.methodTextContainer}>
                      <Text style={styles.methodTitle}>Existing WhatsApp Business</Text>
                      <Text style={styles.methodDesc}>
                        Keep using your WhatsApp Business App with Cloud API coexistence.
                      </Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.methodCard,
                      method === 'new_number' && styles.methodCardActive,
                    ]}
                    onPress={() => setMethod('new_number')}
                  >
                    <View style={styles.methodRadio}>
                      {method === 'new_number' && <View style={styles.methodRadioInner} />}
                    </View>
                    <View style={styles.methodTextContainer}>
                      <Text style={styles.methodTitle}>Dedicated New Number</Text>
                      <Text style={styles.methodDesc}>
                        Register a separate business SIM exclusively for automated 24/7 AI desk.
                      </Text>
                    </View>
                  </TouchableOpacity>
                </View>

                {/* Launch Meta Embedded Signup button */}
                <TouchableOpacity
                  style={styles.metaLaunchBtn}
                  onPress={handleLaunchEmbeddedSignup}
                  activeOpacity={0.8}
                >
                  <Icon name="globe" size={18} color="#fff" />
                  <Text style={styles.metaLaunchBtnText}>Launch Meta Embedded Signup</Text>
                </TouchableOpacity>

                <Text style={styles.orDivider}>— OR ENTER META IDS DIRECTLY —</Text>

                {/* Direct ID input fields */}
                <Text style={styles.inputLabel}>Meta Phone Number ID *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 1098320491823901"
                  placeholderTextColor={colors.muted}
                  value={phoneNumberId}
                  onChangeText={setPhoneNumberId}
                  keyboardType="numeric"
                />

                <Text style={styles.inputLabel}>WhatsApp Business Account ID (WABA ID)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 987654321012345"
                  placeholderTextColor={colors.muted}
                  value={wabaId}
                  onChangeText={setWabaId}
                  keyboardType="numeric"
                />

                <Text style={styles.inputLabel}>Business Phone Number (E.164)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. +919876543210"
                  placeholderTextColor={colors.muted}
                  value={businessPhone}
                  onChangeText={setBusinessPhone}
                  keyboardType="phone-pad"
                />

                <TouchableOpacity
                  style={[styles.saveBtn, loading && styles.btnDisabled]}
                  onPress={handleSaveConnection}
                  disabled={loading}
                  activeOpacity={0.8}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.saveBtnText}>Confirm & Connect</Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <View>
                <Text style={styles.sectionLabel}>WhatsApp Business Profile Info</Text>
                <Text style={styles.helperText}>
                  This information appears on your WhatsApp Business contact card in customers&apos; chats.
                </Text>

                <Text style={styles.inputLabel}>Business Description / About</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="e.g. Premium CrossFit & Strength Training Gym."
                  placeholderTextColor={colors.muted}
                  value={aboutText}
                  onChangeText={setAboutText}
                  multiline
                  numberOfLines={3}
                />

                <Text style={styles.inputLabel}>Physical Gym Address</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 123 Fitness Road, Indiranagar"
                  placeholderTextColor={colors.muted}
                  value={addressText}
                  onChangeText={setAddressText}
                />

                <TouchableOpacity
                  style={[styles.saveBtn, loading && styles.btnDisabled]}
                  onPress={handleSaveProfile}
                  disabled={loading}
                  activeOpacity={0.8}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.saveBtnText}>Update Profile on Meta</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '90%',
    paddingBottom: spacing.xxl,
    ...shadows.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginLeft: spacing.sm,
  },
  closeBtn: {
    padding: spacing.xs,
  },
  tabsRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    paddingHorizontal: spacing.lg,
  },
  tabBtn: {
    paddingVertical: spacing.md,
    marginRight: spacing.lg,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabBtnActive: {
    borderBottomColor: colors.whatsapp,
  },
  tabBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
  },
  tabBtnTextActive: {
    color: colors.whatsapp,
  },
  body: {
    padding: spacing.lg,
  },
  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  helperText: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    lineHeight: 16,
  },
  methodCards: {
    marginBottom: spacing.md,
  },
  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  methodCardActive: {
    borderColor: colors.whatsapp,
    backgroundColor: 'rgba(37, 211, 102, 0.05)',
  },
  methodRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  methodRadioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.whatsapp,
  },
  methodTextContainer: {
    flex: 1,
  },
  methodTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  methodDesc: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },
  metaLaunchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1877F2',
    height: 48,
    borderRadius: radius.md,
    marginVertical: spacing.sm,
  },
  metaLaunchBtnText: {
    color: '#fff',
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    marginLeft: spacing.sm,
  },
  orDivider: {
    fontSize: 10,
    color: colors.muted,
    textAlign: 'center',
    marginVertical: spacing.md,
    fontWeight: fontWeight.bold,
  },
  inputLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    marginTop: spacing.xs,
  },
  input: {
    height: 48,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.sm,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  textArea: {
    height: 72,
    textAlignVertical: 'top',
    paddingTop: spacing.sm,
  },
  saveBtn: {
    backgroundColor: colors.whatsapp,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  btnDisabled: {
    opacity: 0.6,
  },
});

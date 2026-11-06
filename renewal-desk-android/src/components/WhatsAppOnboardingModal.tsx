import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as WebBrowser from 'expo-web-browser';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing, fontFamily} from '../theme/tokens';
import { connectWaba, fetchWabaNumbers, getWhatsAppOnboardingConfig, updateWhatsAppProfile } from '../services/apiClient';
import { getRuntimeConfiguration } from '../config/runtime';

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
  const [fetchingNumbers, setFetchingNumbers] = useState(false);
  const [activeTab, setActiveTab] = useState<'connect' | 'profile'>('connect');
  const [webViewUrl, setWebViewUrl] = useState<string | null>(null);
  // URL actually loaded in the WebView right now (updated on every
  // navigation). The postMessage origin check below is based on THIS, not
  // on webViewUrl (the URL we originally asked the WebView to load): after
  // an OAuth redirect the two differ, and a message from the redirected
  // page must not be trusted as if it came from our signup page.
  const currentWebViewUrlRef = useRef<string | null>(null);
  // Server-provided Meta app/config IDs for the "Open in Meta" fallback link.
  // Never hardcoded: without server config the signup cannot start.
  const [metaAppId, setMetaAppId] = useState('');
  const [configId, setConfigId] = useState('');
  const webViewRef = useRef<WebView>(null);

  const handleAutoFetchNumbers = async () => {
    setFetchingNumbers(true);
    try {
      const res = await fetchWabaNumbers({ wabaId: wabaId.trim() || undefined });
      if (res.ok && res.data.numbers && res.data.numbers.length > 0) {
        const primary = res.data.numbers[0];
        setPhoneNumberId(primary.id);
        if (primary.display_phone_number) {
          setBusinessPhone(primary.display_phone_number);
        }
        if (res.data.waba_id) {
          setWabaId(res.data.waba_id);
        }
        Alert.alert(
          'Phone Number Found!',
          `Found ${primary.display_phone_number || primary.id} (${primary.verified_name || 'Verified'}). Details have been filled in below.`
        );
      } else if (res.ok && res.data.waba_id) {
        setWabaId(res.data.waba_id);
        Alert.alert('WABA Found', 'Found WhatsApp Business Account, but no registered phone numbers were found under it yet.');
      } else {
        Alert.alert(
          'No Numbers Found',
          'Could not automatically detect phone numbers. Please ensure you finished Meta signup, or enter your Phone Number ID manually.'
        );
      }
    } catch {
      Alert.alert('Network Error', 'Failed to reach Meta to fetch phone numbers.');
    } finally {
      setFetchingNumbers(false);
    }
  };

  const handleLaunchEmbeddedSignup = async () => {
    try {
      setLoading(true);
      let handshake = '';
      let appId = '';
      let cfgId = '';

      try {
        const res = await getWhatsAppOnboardingConfig();
        if (res.ok && res.data.meta_app_id) {
          appId = res.data.meta_app_id;
          cfgId = res.data.config_id || '';
        }
        handshake = res.ok ? res.data.signup_handshake || '' : '';
      } catch {
        // No fallback to hardcoded credentials: without server config the
        // signup cannot start safely.
      }
      if (!handshake || !appId) {
        Alert.alert('Error', 'WhatsApp onboarding is not configured on the server. Please try again later.');
        setLoading(false);
        return;
      }

      const config = getRuntimeConfiguration();
      const baseUrl = config.apiBaseUrl;
      if (!baseUrl) {
        Alert.alert('Error', 'API base URL is not configured for this build.');
        setLoading(false);
        return;
      }
      setMetaAppId(appId);
      setConfigId(cfgId);
      const featureParam = method === 'coexistence' ? '&feature_type=whatsapp_business_app_onboarding' : '';
      const pageUrl = `${baseUrl}/api/mobile/v1/whatsapp/embedded-signup-page?handshake=${encodeURIComponent(handshake)}&meta_app_id=${encodeURIComponent(appId)}&config_id=${encodeURIComponent(cfgId)}${featureParam}&v=${Date.now()}`;
      setWebViewUrl(pageUrl);
      currentWebViewUrlRef.current = pageUrl;
    } catch {
      Alert.alert('Error', 'Failed to launch Meta Embedded Signup.');
    } finally {
      setLoading(false);
    }
  };

  const handleWebViewClose = useCallback(() => {
    setWebViewUrl(null);
    currentWebViewUrlRef.current = null;
  }, []);

  const handleClose = () => {
    setWebViewUrl(null);
    currentWebViewUrlRef.current = null;
    onClose();
  };

  const handleWebViewMessage = useCallback(async (event: { nativeEvent: { data: string } }) => {
    // Origin check: react-native-webview does not report the posting
    // frame's origin, so only accept messages while the URL ACTUALLY
    // loaded in the WebView (tracked via onNavigationStateChange) is our
    // embedded-signup page (served from the configured API base origin).
    // Checking the URL we originally requested — the old state-based
    // check — would still trust messages after the WebView navigated
    // away to a redirect, an ad, or a spoofed frame.
    if (!webViewUrl) return;
    const loadedUrl = currentWebViewUrlRef.current ?? webViewUrl;
    let loadedOrigin: string;
    try {
      loadedOrigin = new URL(loadedUrl).origin;
    } catch {
      return;
    }
    let expectedOrigin = '';
    try {
      const base = getRuntimeConfiguration().apiBaseUrl;
      expectedOrigin = base ? new URL(base).origin : '';
    } catch {
      expectedOrigin = '';
    }
    if (!expectedOrigin || loadedOrigin !== expectedOrigin) return;

    let data: any;
    try {
      data = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }

    if (data.type === 'open_external_browser') {
      const targetUrl = data.direct_meta_url || webViewUrl;
      // Only ever open Meta signup URLs from this message — never an
      // arbitrary URL supplied by page content.
      if (targetUrl) {
        try {
          const host = new URL(targetUrl).hostname.toLowerCase();
          if (host === 'facebook.com' || host.endsWith('.facebook.com')) {
            void WebBrowser.openBrowserAsync(targetUrl);
          }
        } catch {
          // Ignore malformed URLs.
        }
      }
      return;
    }

    if (data.type === 'embedded_signup_cancel') {
      setWebViewUrl(null);
      return;
    }

    if (data.type === 'embedded_signup_error') {
      setWebViewUrl(null);
      Alert.alert('Signup Error', data.message || 'Meta Embedded Signup failed.');
      return;
    }

    if (data.type === 'embedded_signup_code' && data.code) {
      setWebViewUrl(null);
      setLoading(true);
      try {
        const connectRes = await connectWaba({
          code: data.code,
          businessId: data.business_id || '',
        });
        if (connectRes.ok) {
          Alert.alert('Connected!', 'WhatsApp Business connected successfully via Embedded Signup.');
          if (connectRes.data?.phone_number_id) setPhoneNumberId(connectRes.data.phone_number_id);
          if (connectRes.data?.waba_id) setWabaId(connectRes.data.waba_id);
          if (connectRes.data?.business_phone_number) setBusinessPhone(connectRes.data.business_phone_number);
          onConnected();
          onClose();
          return;
        } else {
          Alert.alert('Verification Pending', connectRes.error?.message || 'Verification with Meta in progress.');
        }
      } catch {
        // Continue to check other fields
      } finally {
        setLoading(false);
      }
    }


    // Support both standard formats returned by Meta Embedded Signup
    let pId = data.phone_number_id || data.phoneNumberId;
    let wId = data.waba_id || data.wabaId;
    let bPhone = data.business_phone_number || data.businessPhoneNumber || data.display_phone_number;

    if (data.type === 'WA_EMBEDDED_SIGNUP' && data.data) {
      pId = data.data.phone_number_id || data.data.phoneNumberId || pId;
      wId = data.data.waba_id || data.data.wabaId || wId;
      bPhone = data.data.display_phone_number || data.data.business_phone_number || bPhone;
    }

    if (pId) setPhoneNumberId(String(pId));
    if (wId) setWabaId(String(wId));
    if (bPhone) setBusinessPhone(String(bPhone));

    if (pId || wId) {
      setWebViewUrl(null);
      setLoading(true);
      try {
        const connectRes = await connectWaba({
          wabaId: wId ? String(wId) : undefined,
          phoneNumberId: pId ? String(pId) : '',
          businessPhoneNumber: bPhone ? String(bPhone) : undefined,
        });

        if (connectRes.ok) {
          Alert.alert('Connected!', 'WhatsApp Business connected successfully to Renewal Desk.');
          if (connectRes.data?.phone_number_id) setPhoneNumberId(connectRes.data.phone_number_id);
          if (connectRes.data?.waba_id) setWabaId(connectRes.data.waba_id);
          if (connectRes.data?.business_phone_number) setBusinessPhone(connectRes.data.business_phone_number);
          onConnected();
          onClose();
        } else {
          Alert.alert('Connection Failed', connectRes.error?.message || 'Could not verify Meta connection.');
        }
      } catch {
        Alert.alert(
          'Saved Locally',
          'Connection received from Meta. Please tap Confirm & Connect to verify.',
        );
      } finally {
        setLoading(false);
      }
    }
  }, [onClose, onConnected, webViewUrl]);

  const handleSaveConnection = async () => {
    if (!phoneNumberId.trim()) {
      Alert.alert('Validation Error', 'Please enter your WhatsApp Phone Number ID.');
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
    <>
      {/* 1. Main Setup & Direct Entry Bottom Sheet Modal */}
      <Modal
        visible={visible && !webViewUrl}
        animationType="slide"
        transparent
        onRequestClose={handleClose}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Modal Header */}
            <View style={styles.header}>
              <View style={styles.headerTitleRow}>
                <Icon name="whatsapp" size={24} color={colors.whatsapp} />
                <Text style={styles.headerTitle}>WhatsApp Business Setup</Text>
              </View>
              <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
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
                  Connect WhatsApp
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
                          Keep using your WhatsApp Business App on phone with Cloud API coexistence.
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
                    style={[styles.metaLaunchBtn, loading && styles.btnDisabled]}
                    onPress={handleLaunchEmbeddedSignup}
                    disabled={loading}
                    activeOpacity={0.8}
                  >
                    {loading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Icon name="globe" size={18} color="#fff" />
                        <Text style={styles.metaLaunchBtnText}>Launch Meta Embedded Signup</Text>
                      </>
                    )}
                  </TouchableOpacity>

                  <Text style={styles.orDivider}>— OR ENTER WHATSAPP BUSINESS DETAILS DIRECTLY —</Text>

                  {/* Auto-fetch button from Meta */}
                  <TouchableOpacity
                    style={[styles.autoFetchBtn, (fetchingNumbers || loading) && styles.btnDisabled]}
                    onPress={handleAutoFetchNumbers}
                    disabled={fetchingNumbers || loading}
                    activeOpacity={0.8}
                  >
                    {fetchingNumbers ? (
                      <ActivityIndicator size="small" color={colors.brand} />
                    ) : (
                      <>
                        <Icon name="refresh" size={16} color={colors.brand} />
                        <Text style={styles.autoFetchBtnText}>⚡ Auto-Fetch Details from Meta</Text>
                      </>
                    )}
                  </TouchableOpacity>

                  {/* Direct ID input fields */}
                  <Text style={styles.inputLabel}>WhatsApp Phone Number ID *</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. 1711816793132513"
                    placeholderTextColor={colors.muted}
                    value={phoneNumberId}
                    onChangeText={setPhoneNumberId}
                    keyboardType="numeric"
                  />

                  <Text style={styles.inputLabel}>WhatsApp Business Account ID (Optional)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. 987654321012345"
                    placeholderTextColor={colors.muted}
                    value={wabaId}
                    onChangeText={setWabaId}
                    keyboardType="numeric"
                  />

                  <Text style={styles.inputLabel}>Business Phone Number (with Country Code)</Text>
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

      {/* 2. Full-Screen Meta Embedded Signup Modal */}
      <Modal
        visible={visible && Boolean(webViewUrl)}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={handleWebViewClose}
      >
        <SafeAreaView style={styles.webViewContainer} edges={['top', 'bottom']}>
          <View style={styles.webViewHeader}>
            <View style={styles.webViewHeaderLeft}>
              <Icon name="whatsapp" size={22} color={colors.whatsapp} />
              <Text style={styles.webViewTitle}>Meta WhatsApp Signup</Text>
            </View>
            <View style={styles.webViewHeaderRight}>
              <TouchableOpacity
                onPress={() => {
                  if (!metaAppId) {
                    Alert.alert('Error', 'WhatsApp onboarding is not configured on the server.');
                    return;
                  }
                  const extrasObj: Record<string, string> = { sessionInfoVersion: '3', version: 'v4' };
                  if (method === 'coexistence') {
                    extrasObj.featureType = 'whatsapp_business_app_onboarding';
                  }
                  const directMetaUrl = `https://business.facebook.com/messaging/whatsapp/onboard/?app_id=${metaAppId}&config_id=${configId}&extras=${encodeURIComponent(JSON.stringify(extrasObj))}`;
                  void WebBrowser.openBrowserAsync(directMetaUrl);
                }}
                style={styles.browserBtn}
                accessibilityLabel="Open in Browser"
                activeOpacity={0.7}
              >
                <Icon name="globe" size={14} color={colors.brand} />
                <Text style={styles.browserBtnText}>Open in Meta</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleWebViewClose}
                style={styles.webViewCloseBtn}
                accessibilityLabel="Close Meta Signup"
                activeOpacity={0.7}
              >
                <Icon name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>
          </View>

          {webViewUrl ? (
            <WebView
              ref={webViewRef}
              source={{ uri: webViewUrl }}
              style={styles.webView}
              javaScriptEnabled
              domStorageEnabled
              thirdPartyCookiesEnabled
              sharedCookiesEnabled
              cacheEnabled={false}
              setSupportMultipleWindows
              javaScriptCanOpenWindowsAutomatically
              userAgent="Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36"
              startInLoadingState
              renderLoading={() => (
                <View style={styles.webViewLoading}>
                  <ActivityIndicator size="large" color={colors.brand} />
                  <Text style={styles.webViewLoadingText}>Opening Meta WhatsApp Signup...</Text>
                </View>
              )}
              onMessage={handleWebViewMessage}
              onNavigationStateChange={(navState) => {
                currentWebViewUrlRef.current = navState.url;
              }}
              onShouldStartLoadWithRequest={(request) => {
                // V4-L29: navigation allowlist, same shape as
                // Only our own embedded-signup page
                // (served from the configured API base origin) and Meta
                // OAuth hosts. Previously any URL the page navigated to
                // (redirect, ad, spoofed frame) loaded unchecked.
                const url = request.url || '';
                try {
                  const parsed = new URL(url);
                  const host = parsed.hostname.toLowerCase();
                  const base = getRuntimeConfiguration().apiBaseUrl;
                  if (base && parsed.origin === new URL(base).origin) {
                    return true;
                  }
                  if (
                    host === 'facebook.com' ||
                    host.endsWith('.facebook.com') ||
                    host.endsWith('.fbcdn.net') ||
                    host === 'fb.com' ||
                    host.endsWith('.fb.com') ||
                    host === 'connect.facebook.net' ||
                    host === 'whatsapp.com' ||
                    host.endsWith('.whatsapp.com')
                  ) {
                    return true;
                  }
                } catch {
                  return false;
                }
                return false;
              }}
              onOpenWindow={(event) => {
                const targetUrl = event.nativeEvent.targetUrl;
                // Only open Meta signup windows — never an arbitrary URL
                // supplied by page content.
                if (targetUrl) {
                  try {
                    const host = new URL(targetUrl).hostname.toLowerCase();
                    if (host === 'facebook.com' || host.endsWith('.facebook.com')) {
                      void WebBrowser.openBrowserAsync(targetUrl);
                    }
                  } catch {
                    // Ignore malformed URLs.
                  }
                }
              }}
              onError={() => {
                Alert.alert(
                  'Could Not Load Meta Signup',
                  'Failed to load the secure Meta setup. Nothing has been connected. Check your connection and try again.',
                  [
                    { text: 'Try Again', onPress: handleWebViewClose },
                    { text: 'Close', style: 'cancel', onPress: handleWebViewClose },
                  ]
                );
              }}
            />
          ) : null}
        </SafeAreaView>
      </Modal>
    </>
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
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
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
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
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
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
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
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
    marginLeft: spacing.sm,
  },
  orDivider: {
    fontSize: 10,
    color: colors.muted,
    textAlign: 'center',
    marginVertical: spacing.md,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
  autoFetchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.brandSubtle,
    borderWidth: 1,
    borderColor: colors.brandLight,
    marginBottom: spacing.md,
  },
  autoFetchBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
    color: colors.brand,
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
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  webViewContainer: {
    flex: 1,
    backgroundColor: colors.card,
  },
  webViewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    backgroundColor: colors.card,
  },
  webViewHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  webViewHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  browserBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.brandSubtle,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  browserBtnText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.brand,
  },
  webViewTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
    color: colors.text,
  },
  webViewCloseBtn: {
    padding: spacing.xs,
  },
  webView: {
    flex: 1,
  },
  webViewLoading: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.card,
  },
  webViewLoadingText: {
    marginTop: spacing.md,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
});

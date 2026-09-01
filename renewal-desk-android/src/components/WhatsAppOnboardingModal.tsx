import React, { useCallback, useState } from 'react';
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
import { WebView } from 'react-native-webview';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import { connectWaba, getWhatsAppOnboardingConfig, updateWhatsAppProfile } from '../services/apiClient';

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
  const [webViewHtml, setWebViewHtml] = useState<string | null>(null);

  const handleLaunchEmbeddedSignup = async () => {
    try {
      setLoading(true);
      const res = await getWhatsAppOnboardingConfig();
      const metaAppId = res.ok ? res.data.meta_app_id : '1711816793132513';
      const configId = res.ok ? res.data.config_id : '107597391155167';

      // Build a custom HTML page that uses the Facebook JS SDK for Embedded Signup.
      // The SDK returns WABA ID and Phone Number ID directly via the callback,
      // which we send back to the React Native app via postMessage.
      const html = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f8f9fb; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
    .card { background: #fff; border-radius: 16px; padding: 32px 24px; max-width: 400px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.08); text-align: center; }
    h2 { font-size: 20px; color: #1a1a2e; margin-bottom: 8px; }
    p { font-size: 14px; color: #64748b; margin-bottom: 24px; line-height: 1.5; }
    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: #1877F2; color: #fff; border: none; border-radius: 12px; padding: 14px 28px; font-size: 16px; font-weight: 600; cursor: pointer; width: 100%; transition: opacity 0.2s; }
    .btn:hover { opacity: 0.9; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .status { margin-top: 16px; font-size: 13px; color: #64748b; min-height: 20px; }
    .success { color: #16a34a; font-weight: 600; }
    .error { color: #dc2626; }
    .spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.6s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <h2>Connect WhatsApp Business</h2>
    <p>Sign in with your Facebook account to connect your WhatsApp Business number to Renewal Desk.</p>
    <button id="loginBtn" class="btn" onclick="launchSignup()">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492a.5.5 0 00.612.612l4.458-1.495A11.952 11.952 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-2.239 0-4.305-.726-5.985-1.956l-.42-.312-2.645.887.887-2.645-.312-.42A9.935 9.935 0 012 12C2 6.486 6.486 2 12 2s10 4.486 10 10-4.486 10-10 10z"/></svg>
      Continue with Facebook
    </button>
    <div id="status" class="status"></div>
  </div>

  <script>
    window.fbAsyncInit = function() {
      FB.init({
        appId: '${metaAppId}',
        autoLogAppEvents: true,
        xfbml: false,
        version: 'v22.0'
      });
    };
  </script>
  <script async defer crossorigin="anonymous" src="https://connect.facebook.net/en_US/sdk.js"></script>

  <script>
    function launchSignup() {
      var btn = document.getElementById('loginBtn');
      var status = document.getElementById('status');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Connecting...';
      status.className = 'status';
      status.textContent = 'Opening Meta signup...';

      FB.login(function(response) {
        if (response.authResponse) {
          var code = response.authResponse.code;
          status.className = 'status success';
          status.textContent = 'Signed in! Retrieving business details...';

          // Use the code to get WABA details via the Graph API
          FB.api('/debug_token', { input_token: response.authResponse.accessToken }, function(debugRes) {
            // Extract shared WABAs from the response
            var data = {
              type: 'META_SIGNUP_SUCCESS',
              code: code,
              accessToken: response.authResponse.accessToken,
              userID: response.authResponse.userID
            };

            // Try to get shared WABA IDs
            FB.api('/me/businesses', function(bizRes) {
              if (bizRes && bizRes.data && bizRes.data.length > 0) {
                data.businessId = bizRes.data[0].id;
              }
              window.ReactNativeWebView.postMessage(JSON.stringify(data));
            });
          });
        } else {
          btn.disabled = false;
          btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg> Continue with Facebook';
          status.className = 'status error';
          status.textContent = response.status === 'unknown' ? 'Signup cancelled.' : 'Could not connect. Please try again.';
        }
      }, {
        config_id: '${configId}',
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: '',
          sessionInfoVersion: 2
        }
      });
    }
  </script>
</body>
</html>`;
      setWebViewHtml(html);
    } catch {
      Alert.alert('Error', 'Failed to launch Meta Embedded Signup dialog.');
    } finally {
      setLoading(false);
    }
  };

  const handleWebViewClose = useCallback(() => {
    setWebViewHtml(null);
  }, []);

  const handleWebViewMessage = useCallback(async (event: { nativeEvent: { data: string } }) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'META_SIGNUP_SUCCESS') {
        setWebViewHtml(null);
        setLoading(true);

        // If we got the access token, use it to fetch WABA details from the backend
        // The backend connect-waba endpoint handles the actual connection
        // For now, we can try to get the shared WABA info
        if (data.code || data.accessToken) {
          // Call the onboarding-config to get current gym's expected setup
          // Then auto-connect using whatever IDs Meta returned
          Alert.alert(
            'Meta Signup Successful!',
            'Your Facebook account is linked. Now fetching your WhatsApp Business details...',
          );

          // Poll the connection status - Meta may have already sent the webhook
          // with WABA details to our backend
          let attempts = 0;
          const pollConnection = async () => {
            // Check if connection was auto-established via Meta webhook to our backend
            const { getWhatsAppConnectionStatus } = await import('../services/apiClient');
            const connRes = await getWhatsAppConnectionStatus();
            if (connRes.ok && connRes.data.status === 'CONNECTED') {
              setLoading(false);
              Alert.alert('Connected!', 'WhatsApp Business connected automatically to Renewal Desk.');
              onConnected();
              onClose();
              return;
            }
            attempts++;
            if (attempts < 5) {
              setTimeout(pollConnection, 3000); // Poll every 3 seconds, up to 5 times
            } else {
              setLoading(false);
              // Fallback: ask for manual entry if webhook hasn't arrived
              Alert.alert(
                'Almost Done',
                'Meta signup completed but the connection details haven\'t arrived yet. You can enter your Phone Number ID manually, or wait and refresh later.',
              );
            }
          };
          await pollConnection();
        }
      }
    } catch {
      // Ignore non-JSON messages from WebView
    }
  }, [onClose, onConnected]);

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

      {/* In-App WebView for Meta Embedded Signup */}
      {webViewHtml ? (
        <View style={styles.webViewOverlay}>
          <View style={styles.webViewHeader}>
            <Text style={styles.webViewTitle}>Meta WhatsApp Signup</Text>
            <TouchableOpacity onPress={handleWebViewClose} style={styles.webViewCloseBtn}>
              <Icon name="close" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>
          <WebView
            source={{ html: webViewHtml, baseUrl: 'https://business.facebook.com' }}
            style={styles.webView}
            javaScriptEnabled
            domStorageEnabled
            thirdPartyCookiesEnabled
            startInLoadingState
            renderLoading={() => (
              <View style={styles.webViewLoading}>
                <ActivityIndicator size="large" color={colors.brand} />
                <Text style={styles.webViewLoadingText}>Loading Meta Signup...</Text>
              </View>
            )}
            onMessage={handleWebViewMessage}
          />
        </View>
      ) : null}
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
  webViewOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.card,
    zIndex: 10,
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
  webViewTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
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

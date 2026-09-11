import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

// ── Theme ─────────────────────────────────────────────────────────────

const colors = {
  brand: '#2563EB',
  brandSubtle: '#EFF6FF',
  background: '#F8F9FB',
  surface: '#FFFFFF',
  text: '#0F172A',
  textSecondary: '#475569',
  muted: '#94A3B8',
  border: '#E2E8F0',
  success: '#059669',
  successSurface: '#ECFDF5',
  warning: '#D97706',
  warningSurface: '#FFFBEB',
  critical: '#DC2626',
  criticalSurface: '#FEF2F2',
  whatsapp: '#25D366',
};

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://gym-production-910c.up.railway.app';

// ── Types ─────────────────────────────────────────────────────────────

type MemberData = {
  id: number;
  full_name: string;
  phone: string;
  status: string;
  membership_start: string | null;
  membership_end: string | null;
  days_left: number | null;
  is_expired: boolean;
  plan_name: string | null;
  plan_price: string | null;
};

type GymData = { name: string | null; phone: string | null };
type Renewal = { id: number; new_start: string; new_end: string; amount: string; created_at: string | null };
type PendingPayment = { id: number; amount: string; status: string; created_at: string | null } | null;

type DashboardData = {
  member: MemberData;
  gym: GymData;
  recent_renewals: Renewal[];
  pending_payment: PendingPayment;
};

// ── App ───────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState<'login' | 'otp' | 'dashboard'>('login');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState<string>('');
  const [challenge, setChallenge] = useState<string>('');
  const [dashData, setDashData] = useState<DashboardData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [gymName, setGymName] = useState('');

  const requestOtp = useCallback(async () => {
    if (phone.length < 10) {
      Alert.alert('Error', 'Please enter a valid phone number.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/member/v1/auth/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (data.success) {
        setGymName(data.gym_name || '');
        if (data.challenge) setChallenge(data.challenge);
        setScreen('otp');
      } else {
        Alert.alert('Error', data.error || 'Failed to send OTP.');
      }
    } catch {
      Alert.alert('Error', 'Network error. Please try again.');
    }
    setLoading(false);
  }, [phone]);

  const fetchDashboard = useCallback(async (authToken?: string) => {
    const activeToken = authToken || token;
    if (!activeToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/member/v1/dashboard`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${activeToken}`,
        },
      });
      const data = await res.json();
      if (data.success) {
        setDashData(data.data);
      } else if (res.status === 401) {
        setScreen('login');
        setToken('');
        setDashData(null);
      }
    } catch {}
    setRefreshing(false);
  }, [token]);

  const verifyOtp = useCallback(async () => {
    if (otp.length !== 6) {
      Alert.alert('Error', 'Please enter the 6-digit OTP.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/member/v1/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp, challenge }),
      });
      const data = await res.json();
      if (data.success && data.data?.token) {
        const receivedToken = data.data.token;
        setToken(receivedToken);
        await fetchDashboard(receivedToken);
        setScreen('dashboard');
      } else {
        Alert.alert('Error', data.error || 'Invalid OTP.');
      }
    } catch {
      Alert.alert('Error', 'Network error. Please try again.');
    }
    setLoading(false);
  }, [phone, otp, challenge, fetchDashboard]);

  const requestRenewal = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/member/v1/renew/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      Alert.alert(data.success ? 'Sent!' : 'Note', data.message || 'Request submitted.');
      await fetchDashboard();
    } catch {
      Alert.alert('Error', 'Network error.');
    }
    setLoading(false);
  }, [token, fetchDashboard]);

  // ── Login Screen ────────────────────────────────────────────────────

  if (screen === 'login') {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.container}>
          <StatusBar style="dark" />
          <View style={styles.loginContainer}>
            <View style={styles.logoContainer}>
              <Text style={styles.logoText}>💪</Text>
              <Text style={styles.appTitle}>Renewal Desk</Text>
              <Text style={styles.appSubtitle}>Member Portal</Text>
            </View>

            <View style={styles.loginCard}>
              <Text style={styles.loginTitle}>Sign in with your phone</Text>
              <Text style={styles.loginSubtitle}>
                We'll send a verification code to your WhatsApp
              </Text>
              <TextInput
                style={styles.phoneInput}
                value={phone}
                onChangeText={setPhone}
                placeholder="Enter your phone number"
                placeholderTextColor={colors.muted}
                keyboardType="phone-pad"
                autoFocus
              />
              <TouchableOpacity
                style={[styles.primaryButton, loading && styles.buttonDisabled]}
                onPress={requestOtp}
                disabled={loading}
                activeOpacity={0.7}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Send OTP via WhatsApp</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  // ── OTP Screen ──────────────────────────────────────────────────────

  if (screen === 'otp') {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.container}>
          <StatusBar style="dark" />
          <View style={styles.loginContainer}>
            <TouchableOpacity onPress={() => setScreen('login')} style={styles.backButton}>
              <Text style={styles.backButtonText}>← Back</Text>
            </TouchableOpacity>

            <View style={styles.loginCard}>
              <Text style={styles.loginTitle}>Enter verification code</Text>
              <Text style={styles.loginSubtitle}>
                Sent to your WhatsApp {phone.slice(-4) ? `ending in ${phone.slice(-4)}` : ''}
                {gymName ? `\nFrom: ${gymName}` : ''}
              </Text>
              <TextInput
                style={styles.otpInput}
                value={otp}
                onChangeText={setOtp}
                placeholder="000000"
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
              />
              <TouchableOpacity
                style={[styles.primaryButton, loading && styles.buttonDisabled]}
                onPress={verifyOtp}
                disabled={loading}
                activeOpacity={0.7}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Verify</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  // ── Dashboard Screen ────────────────────────────────────────────────

  const member = dashData?.member;
  const gym = dashData?.gym;
  const isExpired = member?.is_expired;
  const daysLeft = member?.days_left;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar style="dark" />

        {/* Header */}
        <View style={styles.dashHeader}>
          <View>
            <Text style={styles.dashGreeting}>Hi, {member?.full_name?.split(' ')[0] ?? 'there'}!</Text>
            <Text style={styles.dashGymName}>{gym?.name ?? ''}</Text>
          </View>
          <TouchableOpacity onPress={() => { setScreen('login'); setToken(''); setChallenge(''); setOtp(''); setDashData(null); }}>
            <Text style={styles.logoutText}>Sign out</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.dashContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); fetchDashboard(); }}
              tintColor={colors.brand}
            />
          }
        >
          {/* Membership Status Card */}
          <View style={[styles.statusCard, {
            borderColor: isExpired ? colors.critical : (daysLeft !== null && daysLeft <= 7) ? colors.warning : colors.success,
          }]}>
            <View style={[styles.statusIndicator, {
              backgroundColor: isExpired ? colors.criticalSurface : (daysLeft !== null && daysLeft <= 7) ? colors.warningSurface : colors.successSurface,
            }]}>
              <Text style={[styles.statusIcon]}>
                {isExpired ? '⚠️' : (daysLeft !== null && daysLeft <= 7) ? '⏰' : '✅'}
              </Text>
              <Text style={[styles.statusText, {
                color: isExpired ? colors.critical : (daysLeft !== null && daysLeft <= 7) ? colors.warning : colors.success,
              }]}>
                {isExpired ? 'Membership Expired' : (daysLeft !== null && daysLeft <= 7) ? 'Expiring Soon' : 'Active'}
              </Text>
            </View>

            <View style={styles.membershipDetails}>
              <DetailRow label="Plan" value={member?.plan_name ?? 'N/A'} />
              <DetailRow label="Valid Until" value={member?.membership_end ?? 'N/A'} />
              {daysLeft !== null && !isExpired && (
                <DetailRow
                  label="Days Remaining"
                  value={daysLeft === 0 ? 'Expires today!' : `${daysLeft} days`}
                  highlight={daysLeft <= 7}
                />
              )}
              {member?.plan_price && <DetailRow label="Plan Price" value={`₹${member.plan_price}`} />}
            </View>
          </View>

          {/* Pending Payment */}
          {dashData?.pending_payment && (
            <View style={[styles.card, { borderColor: colors.warning }]}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardEmoji}>💳</Text>
                <Text style={styles.cardTitle}>Payment Pending</Text>
              </View>
              <Text style={styles.pendingAmount}>₹{dashData.pending_payment.amount}</Text>
              <Text style={styles.pendingNote}>Your payment is being verified by the gym.</Text>
            </View>
          )}

          {/* Renew Button */}
          {(isExpired || (daysLeft !== null && daysLeft <= 14)) && !dashData?.pending_payment && (
            <TouchableOpacity
              style={styles.renewButton}
              onPress={requestRenewal}
              disabled={loading}
              activeOpacity={0.7}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Text style={styles.renewButtonText}>
                    {isExpired ? 'Request Renewal' : 'Renew Membership'}
                  </Text>
                  <Text style={styles.renewButtonSub}>
                    {member?.plan_price ? `₹${member.plan_price} · ${member.plan_name}` : 'Tap to request'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {/* Recent Renewals */}
          {dashData?.recent_renewals && dashData.recent_renewals.length > 0 && (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardEmoji}>📋</Text>
                <Text style={styles.cardTitle}>Recent Renewals</Text>
              </View>
              {dashData.recent_renewals.map((r) => (
                <View key={r.id} style={styles.renewalRow}>
                  <View>
                    <Text style={styles.renewalDates}>{r.new_start} → {r.new_end}</Text>
                  </View>
                  <Text style={styles.renewalAmount}>₹{r.amount}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Contact Gym */}
          {gym?.phone && (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardEmoji}>📞</Text>
                <Text style={styles.cardTitle}>Contact {gym.name}</Text>
              </View>
              <Text style={styles.gymPhone}>{gym.phone}</Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function DetailRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, highlight && { color: colors.warning, fontWeight: '700' as const }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  // Login
  loginContainer: { flex: 1, justifyContent: 'center', padding: 24 },
  logoContainer: { alignItems: 'center', marginBottom: 32 },
  logoText: { fontSize: 48 },
  appTitle: { fontSize: 28, fontWeight: '800', color: colors.text, marginTop: 8 },
  appSubtitle: { fontSize: 16, color: colors.muted, marginTop: 4 },
  loginCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 16,
  },
  loginTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
  loginSubtitle: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  phoneInput: {
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    fontSize: 18,
    color: colors.text,
    fontWeight: '600',
  },
  otpInput: {
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    fontSize: 32,
    color: colors.text,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 8,
  },
  primaryButton: {
    backgroundColor: colors.brand,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  buttonDisabled: { opacity: 0.6 },
  backButton: { marginBottom: 16 },
  backButtonText: { color: colors.brand, fontSize: 16, fontWeight: '600' },
  // Dashboard
  dashHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dashGreeting: { fontSize: 22, fontWeight: '800', color: colors.text },
  dashGymName: { fontSize: 14, color: colors.muted, marginTop: 2 },
  logoutText: { color: colors.critical, fontSize: 14, fontWeight: '600' },
  dashContent: { padding: 16, gap: 16, paddingBottom: 40 },
  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 2,
    gap: 16,
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    gap: 8,
  },
  statusIcon: { fontSize: 20 },
  statusText: { fontSize: 18, fontWeight: '700' },
  membershipDetails: { gap: 12 },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: { fontSize: 14, color: colors.muted, fontWeight: '500' },
  detailValue: { fontSize: 14, color: colors.text, fontWeight: '600' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardEmoji: { fontSize: 18 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  pendingAmount: { fontSize: 28, fontWeight: '800', color: colors.warning, textAlign: 'center' },
  pendingNote: { fontSize: 13, color: colors.muted, textAlign: 'center' },
  renewButton: {
    backgroundColor: colors.success,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 4,
  },
  renewButtonText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  renewButtonSub: { color: 'rgba(255,255,255,0.8)', fontSize: 13 },
  renewalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  renewalDates: { fontSize: 13, color: colors.textSecondary },
  renewalAmount: { fontSize: 14, fontWeight: '700', color: colors.success },
  gymPhone: { fontSize: 16, color: colors.brand, fontWeight: '600' },
});

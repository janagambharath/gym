import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../components/AppHeader';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
import { apiRequest, registerAccount, type RegistrationResponseData } from '../services/apiClient';
import { colors, fontSize, fontWeight, radius, spacing } from '../theme/tokens';
import type { BillingCatalogResponse } from '../types';

type RegistrationScreenProps = {
  onBack: () => void;
  onRegistered: () => void;
};

const countries = [
  { code: 'IN', name: 'India', currency: 'INR', timezone: 'Asia/Kolkata' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', timezone: 'Asia/Dubai' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', timezone: 'Europe/London' },
  { code: 'AU', name: 'Australia', currency: 'AUD', timezone: 'Australia/Sydney' },
  { code: 'US', name: 'United States', currency: 'USD', timezone: 'America/New_York' },
] as const;

export function RegistrationScreen({ onBack, onRegistered }: RegistrationScreenProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [gymName, setGymName] = useState('');
  const [country, setCountry] = useState<(typeof countries)[number]>(countries[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<RegistrationResponseData>();
  const [catalog, setCatalog] = useState<BillingCatalogResponse>();
  const [selectedPlan, setSelectedPlan] = useState<string>();

  useEffect(() => {
    if (!created) return;
    void apiRequest<BillingCatalogResponse>('/api/mobile/v1/billing/catalog').then((result) => {
      if (result.ok) setCatalog(result.data);
    });
  }, [created]);

  const subtitle = useMemo(() => `Step ${Math.min(step, 3)} of 3`, [step]);

  const nextFromOwner = useCallback(() => {
    if (!ownerName.trim() || !email.trim() || !phone.trim() || !password) {
      setError('Complete all owner details to continue.');
      return;
    }
    setError(undefined);
    setStep(2);
  }, [email, ownerName, password, phone]);

  const createAccount = useCallback(async () => {
    if (!gymName.trim() || submitting) {
      if (!gymName.trim()) setError('Gym name is required.');
      return;
    }
    setSubmitting(true);
    setError(undefined);
    const result = await registerAccount({
      owner_name: ownerName.trim(), email: email.trim(), phone: phone.trim(), password,
      gym_name: gymName.trim(), country: country.code, currency: country.currency,
      timezone: country.timezone, terms_accepted: true,
    });
    if (result.ok) {
      setCreated(result.data);
      setStep(4);
    } else {
      setError(result.error.message);
    }
    setSubmitting(false);
  }, [country, email, gymName, ownerName, password, phone, submitting]);

  if (step === 4 && created) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <AppHeader title="Account created" onBack={onBack} />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            <Text style={styles.successTitle}>Your gym is ready</Text>
            <Text style={styles.text}>A trial account was created for {created.gym.name}. Choose a plan when you are ready.</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.title}>Plan selection</Text>
            <Text style={styles.muted}>Prices are supplied by the server for {country.currency}. A subscription is activated only after Google Play verification.</Text>
            {catalog?.plans.map((plan) => (
              <TouchableOpacity key={plan.id} onPress={() => setSelectedPlan(plan.id)} style={[styles.plan, selectedPlan === plan.id && styles.planSelected]}>
                <View><Text style={styles.planName}>{plan.name}</Text><Text style={styles.muted}>{plan.currency} {plan.price}</Text></View>
                <Text style={styles.muted}>{selectedPlan === plan.id ? 'Selected' : 'Select'}</Text>
              </TouchableOpacity>
            ))}
            <Text style={styles.warning}>
              Google Play checkout is intentionally unavailable until a Play-Billing-enabled release build and server credentials are configured. Selecting a plan does not activate access.
            </Text>
          </View>
          <PrimaryButton label="Continue with trial" onPress={onRegistered} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Create account" subtitle={subtitle} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {step === 1 ? <View style={styles.card}>
          <Text style={styles.title}>Owner details</Text>
          <FormField label="Your name" value={ownerName} onChangeText={setOwnerName} autoCapitalize="words" />
          <FormField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          <FormField label="Phone with country code" value={phone} onChangeText={setPhone} placeholder="+919876543210" keyboardType="phone-pad" />
          <FormField label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="12+ characters, upper/lower/number/symbol" />
          <PrimaryButton label="Continue" onPress={nextFromOwner} />
        </View> : null}
        {step === 2 ? <View style={styles.card}>
          <Text style={styles.title}>Gym details</Text>
          <FormField label="Gym name" value={gymName} onChangeText={setGymName} autoCapitalize="words" />
          <PrimaryButton label="Continue" onPress={() => { if (gymName.trim()) { setError(undefined); setStep(3); } else setError('Gym name is required.'); }} />
        </View> : null}
        {step === 3 ? <View style={styles.card}>
          <Text style={styles.title}>Country and currency</Text>
          <Text style={styles.muted}>This controls phone, date, timezone, and currency formatting. No currency conversion is performed.</Text>
          {countries.map((item) => <TouchableOpacity key={item.code} style={[styles.country, country.code === item.code && styles.countrySelected]} onPress={() => setCountry(item)}>
            <View><Text style={styles.planName}>{item.name}</Text><Text style={styles.muted}>{item.currency} · {item.timezone}</Text></View>
            <Text style={styles.muted}>{country.code === item.code ? 'Selected' : ''}</Text>
          </TouchableOpacity>)}
          <PrimaryButton label="Create account" loading={submitting} onPress={() => void createAccount()} />
        </View> : null}
        {error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text></View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.section },
  country: { borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: spacing.md },
  countrySelected: { borderColor: colors.brand, backgroundColor: colors.brandSubtle },
  error: { backgroundColor: colors.criticalSurface, borderColor: colors.criticalBorder, borderRadius: radius.md, borderWidth: 1, padding: spacing.md },
  errorText: { color: colors.critical, fontSize: fontSize.base },
  muted: { color: colors.muted, fontSize: fontSize.sm },
  plan: { borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: spacing.md },
  planName: { color: colors.text, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  planSelected: { borderColor: colors.brand, backgroundColor: colors.brandSubtle },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  successTitle: { color: colors.success, fontSize: fontSize['2xl'], fontWeight: fontWeight.bold },
  text: { color: colors.textSecondary, fontSize: fontSize.base, lineHeight: 22 },
  title: { color: colors.text, fontSize: fontSize['2xl'], fontWeight: fontWeight.bold },
  warning: { color: colors.statusPending, fontSize: fontSize.sm, lineHeight: 20 },
});

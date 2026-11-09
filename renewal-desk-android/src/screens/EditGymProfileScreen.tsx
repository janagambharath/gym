import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiRequest } from '../services/apiClient';
import { resolveSettingsLoadView } from '../services/settingsLoadGate';
import { colors, fontSize, fontWeight, radius, spacing } from '../theme/tokens';
import type { GymSettings, SettingsResponse } from '../types';
import { isValidTimezone } from '../types';
import { AppHeader } from '../components/AppHeader';
import { ErrorState } from '../components/ErrorState';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';

type EditGymProfileScreenProps = {
  onBack: () => void;
  onSaved?: () => void;
};

export function EditGymProfileScreen({ onBack, onSaved }: EditGymProfileScreenProps) {
  const [gym, setGym] = useState<GymSettings | undefined>();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // V9-M8: load gate — the form used to render immediately with blank
  // fields (no loading state, no error branch on the GET), so a failed
  // or merely slow load + Save wiped email/phone/address ('' → null)
  // and forced timezone Asia/Kolkata (backend settings.py:143-147
  // applies every key). No editable form until the GET succeeds.
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>();

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadError(undefined);
    const res = await apiRequest<SettingsResponse>('/api/mobile/v1/settings');
    if (res.ok) {
      const g = res.data.gym;
      setGym(g);
      setName(g.name ?? '');
      setEmail(g.email ?? '');
      setPhone(g.phone ?? '');
      setAddress(g.address ?? '');
      setTimezone(g.timezone ?? 'Asia/Kolkata');
      setLoaded(true);
    } else {
      setLoadError(res.error.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const save = async () => {
    // Defence in depth: the form only renders once loaded, but never
    // let a Save go out on unloaded (blank-default) values.
    if (!loaded) return;
    if (!name.trim()) {
      setError('Gym name cannot be empty.');
      return;
    }
    // V10-L34: the timezone field is free text and used to accept
    // anything — the invalid stored value 'india' (Yodha) got in
    // through a path like this. Refuse an invalid IANA zone on save
    // instead of letting it re-enter the database.
    const typedTimezone = timezone.trim();
    if (typedTimezone && !isValidTimezone(typedTimezone)) {
      setError(
        `"${typedTimezone}" is not a valid timezone. Use an IANA timezone like Asia/Kolkata, Asia/Dubai, Europe/London, or America/New_York.`,
      );
      return;
    }
    setSaving(true);
    setError(undefined);
    const res = await apiRequest('/api/mobile/v1/settings', {
      method: 'PATCH',
      body: {
        name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        timezone: timezone.trim() || 'Asia/Kolkata',
      },
    });
    setSaving(false);
    if (res.ok) {
      Alert.alert('Saved', 'Gym profile updated.');
      onSaved?.();
      onBack();
    } else {
      setError(res.error.message);
    }
  };

  const loadView = resolveSettingsLoadView({ loading, loaded, loadError });

  if (loadView === 'loading') {
    return (
      <SafeAreaView style={styles.safe}>
        <AppHeader title="Edit Gym Profile" onBack={onBack} />
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.brand} />
          <Text style={styles.loadingText}>Loading gym profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadView === 'error') {
    return (
      <SafeAreaView style={styles.safe}>
        <AppHeader title="Edit Gym Profile" onBack={onBack} />
        <ErrorState
          message={loadError ?? 'Could not load the gym profile.'}
          onRetry={() => void loadSettings()}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <AppHeader title="Edit Gym Profile" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <FormField label="Gym name" value={name} onChangeText={setName} placeholder="Elite Gym" autoCapitalize="words" />
        <FormField label="Email" value={email} onChangeText={setEmail} placeholder="owner@gym.com" keyboardType="email-address" autoCapitalize="none" />
        <FormField label="Phone" value={phone} onChangeText={setPhone} placeholder="+91 98765 43210" keyboardType="phone-pad" />
        <FormField label="Address" value={address} onChangeText={setAddress} placeholder="Street, area, city" multiline numberOfLines={2} />
        <FormField label="Timezone" value={timezone} onChangeText={setTimezone} placeholder="Asia/Kolkata" autoCapitalize="none" />
        <View style={styles.actions}>
          <PrimaryButton
            title={saving ? 'Saving...' : 'Save Changes'}
            onPress={() => void save()}
            disabled={saving}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.section },
  error: { color: colors.critical, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  actions: { marginTop: spacing.sm },
  centerContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginTop: spacing.md,
  },
});

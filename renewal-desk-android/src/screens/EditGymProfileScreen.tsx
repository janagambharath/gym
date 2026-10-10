import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiRequest } from '../services/apiClient';
import { colors, fontSize, fontWeight, radius, spacing } from '../theme/tokens';
import type { GymSettings, SettingsResponse } from '../types';
import { AppHeader } from '../components/AppHeader';
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

  useEffect(() => {
    let cancelled = false;
    void apiRequest<SettingsResponse>('/api/mobile/v1/settings').then((res) => {
      if (!cancelled && res.ok) {
        const g = res.data.gym;
        setGym(g);
        setName(g.name ?? '');
        setEmail(g.email ?? '');
        setPhone(g.phone ?? '');
        setAddress(g.address ?? '');
        setTimezone(g.timezone ?? 'Asia/Kolkata');
      }
    });
    return () => { cancelled = true; };
  }, []);

  const save = async () => {
    if (!name.trim()) {
      setError('Gym name cannot be empty.');
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
});

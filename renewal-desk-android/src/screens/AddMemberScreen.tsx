import { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
import { apiRequest } from '../services/apiClient';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type { Member, Plan } from '../types';

type AddMemberScreenProps = {
  onBack: () => void;
  onLogout: () => void;
  onMemberCreated?: (member: Member) => void;
  plans?: Plan[];
};

export function AddMemberScreen({ onBack, onLogout, onMemberCreated, plans = [] }: AddMemberScreenProps) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(plans.length > 0 ? plans[0].id : null);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const selectedPlan = plans.find((p) => p.id === selectedPlanId);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!fullName.trim()) newErrors.fullName = 'Name is required.';
    if (!phone.trim()) newErrors.phone = 'Phone number is required.';
    else if (phone.trim().length < 10) newErrors.phone = 'Phone number must be at least 10 digits.';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = useCallback(async () => {
    if (!validate()) return;
    if (loading) return;

    setLoading(true);
    setError(undefined);

    const today = new Date().toISOString().split('T')[0];
    const duration = selectedPlan?.duration_days ?? 30;
    const endDate = new Date(Date.now() + duration * 86400000).toISOString().split('T')[0];

    const result = await apiRequest<Member>('/api/mobile/v1/members', {
      method: 'POST',
      body: {
        full_name: fullName.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        plan_id: selectedPlanId,
        membership_start: today,
        membership_end: endDate,
        notes: notes.trim() || undefined,
      },
    });

    if (result.ok) {
      onMemberCreated?.(result.data);
    } else {
      if (result.error.status === 401) { onLogout(); return; }
      setError(result.error.message);
    }
    setLoading(false);
  }, [fullName, phone, email, selectedPlanId, notes, loading, onLogout, onMemberCreated, selectedPlan]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Add Member" onBack={onBack} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Form */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Member Information</Text>

            <View style={styles.form}>
              <FormField
                label="Full Name *"
                value={fullName}
                onChangeText={(t) => { setFullName(t); setErrors((e) => ({ ...e, fullName: '' })); }}
                placeholder="Enter full name"
                error={errors.fullName}
                autoCapitalize="words"
                returnKeyType="next"
              />

              <FormField
                label="Phone Number *"
                value={phone}
                onChangeText={(t) => { setPhone(t); setErrors((e) => ({ ...e, phone: '' })); }}
                placeholder="Enter phone number"
                error={errors.phone}
                keyboardType="phone-pad"
                returnKeyType="next"
              />

              <FormField
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="Enter email (optional)"
                keyboardType="email-address"
                autoCapitalize="none"
                returnKeyType="next"
              />
            </View>
          </View>

          {/* Plan Selection */}
          {plans.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Membership Plan</Text>
              <View style={styles.planList}>
                {plans.map((plan) => (
                  <PrimaryButton
                    key={plan.id}
                    label={`${plan.name} · ${plan.duration_days}d · ₹${plan.price}`}
                    onPress={() => setSelectedPlanId(plan.id)}
                    variant={selectedPlanId === plan.id ? 'primary' : 'secondary'}
                    size="md"
                  />
                ))}
              </View>
            </View>
          ) : null}

          {/* Notes */}
          <View style={styles.card}>
            <FormField
              label="Notes"
              value={notes}
              onChangeText={setNotes}
              placeholder="Any additional notes (optional)"
              multiline
            />
          </View>

          {/* Error */}
          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Submit */}
          <PrimaryButton
            label="Add Member"
            icon="+"
            onPress={() => void handleSubmit()}
            loading={loading}
            disabled={!fullName.trim() || !phone.trim()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.section,
  },
  errorBanner: {
    backgroundColor: colors.criticalSurface,
    borderColor: colors.criticalBorder,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  errorText: {
    color: colors.critical,
    fontSize: fontSize.base,
  },
  flex: {
    flex: 1,
  },
  form: {
    gap: spacing.lg,
    marginTop: spacing.lg,
  },
  planList: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
});

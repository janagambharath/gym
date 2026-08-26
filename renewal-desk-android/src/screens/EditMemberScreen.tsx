import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../components/AppHeader';
import { ErrorState } from '../components/ErrorState';
import { FormField } from '../components/FormField';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { PrimaryButton } from '../components/PrimaryButton';
import { apiRequest } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type { Member, Plan } from '../types';

type EditMemberScreenProps = {
  memberId: number;
  onBack: () => void;
  onSaved?: (member: Member) => void;
};

export function EditMemberScreen({ memberId, onBack, onSaved }: EditMemberScreenProps) {
  const [member, setMember] = useState<Member | undefined>();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  // Form state
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [gender, setGender] = useState('');
  const [notes, setNotes] = useState('');
  const [planId, setPlanId] = useState<number | undefined>();

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [memberRes, settingsRes] = await Promise.all([
        apiRequest<Member>(`/api/mobile/v1/members/${memberId}`),
        apiRequest<{ plans: Plan[] }>('/api/mobile/v1/settings'),
      ]);

      if (cancelled) return;

      if (memberRes.ok) {
        const m = memberRes.data;
        setMember(m);
        setFullName(m.full_name);
        setPhone(m.phone);
        setEmail(m.email ?? '');
        setGender(m.gender ?? '');
        setNotes(m.notes ?? '');
        setPlanId(m.plan?.id);
      } else {
        setError(memberRes.error.message);
      }
      if (settingsRes.ok) setPlans(settingsRes.data.plans);
      setLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [memberId]);

  const validate = useCallback(() => {
    const errs: Record<string, string> = {};
    if (!fullName.trim()) errs.fullName = 'Name is required';
    if (!phone.trim()) errs.phone = 'Phone is required';
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  }, [fullName, phone]);

  const handleSave = useCallback(async () => {
    if (!validate()) return;
    setSaving(true);
    setFormErrors({});

    const cleanDigits = phone.replace(/\D/g, '');
    const normalizedPhone = phone.trim().startsWith('+')
      ? phone.trim()
      : (cleanDigits.length === 10 ? `+91${cleanDigits}` : `+${cleanDigits}`);

    const body: Record<string, unknown> = {
      full_name: fullName.trim(),
      phone: normalizedPhone,
    };

    if (email.trim()) body.email = email.trim();
    else body.email = null;
    if (gender.trim()) body.gender = gender.trim();
    else body.gender = null;
    if (notes.trim()) body.notes = notes.trim();
    else body.notes = null;
    if (planId) body.plan_id = planId;

    const result = await apiRequest<Member>(`/api/mobile/v1/members/${memberId}`, {
      method: 'PATCH',
      body,
    });

    setSaving(false);

    if (result.ok) {
      Alert.alert('Success', 'Member updated successfully.');
      onSaved?.(result.data);
      onBack();
    } else {
      Alert.alert('Error', result.error.message);
    }
  }, [fullName, phone, email, gender, notes, planId, memberId, validate, onBack, onSaved]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <AppHeader title="Edit Member" onBack={onBack} />
        <View style={styles.content}><LoadingSkeleton lines={6} height={18} /></View>
      </SafeAreaView>
    );
  }

  if (error || !member) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <AppHeader title="Edit Member" onBack={onBack} />
        <ErrorState message={error ?? 'Member not found'} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Edit Member" onBack={onBack} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <View style={styles.sectionHeader}>
              <Icon name="person" size={18} color={colors.brand} />
              <Text style={styles.sectionTitle}>Personal Information</Text>
            </View>
            <FormField
              label="Full Name *"
              value={fullName}
              onChangeText={setFullName}
              placeholder="Enter full name"
              error={formErrors.fullName}
            />
            <FormField
              label="Phone *"
              value={phone}
              onChangeText={setPhone}
              placeholder="+91 99999 99999"
              keyboardType="phone-pad"
              error={formErrors.phone}
            />
            <FormField
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="email@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <FormField
              label="Gender"
              value={gender}
              onChangeText={setGender}
              placeholder="Male / Female / Other"
            />
          </View>

          <View style={styles.card}>
            <View style={styles.sectionHeader}>
              <Icon name="plan" size={18} color={colors.brand} />
              <Text style={styles.sectionTitle}>Membership</Text>
            </View>
            {plans.length > 0 ? (
              <View style={styles.planGrid}>
                {plans.map((p) => (
                  <PrimaryButton
                    key={p.id}
                    title={`${p.name}\n₹${p.price} · ${p.duration_days}d`}
                    variant={planId === p.id ? 'primary' : 'outline'}
                    size="sm"
                    onPress={() => setPlanId(p.id)}
                    style={styles.planButton}
                  />
                ))}
              </View>
            ) : null}
          </View>

          <View style={styles.card}>
            <View style={styles.sectionHeader}>
              <Icon name="document" size={18} color={colors.brand} />
              <Text style={styles.sectionTitle}>Notes</Text>
            </View>
            <FormField
              label="Notes"
              value={notes}
              onChangeText={setNotes}
              placeholder="Additional notes..."
              multiline
              numberOfLines={3}
            />
          </View>

          <PrimaryButton
            title="Save Changes"
            variant="primary"
            onPress={() => void handleSave()}
            loading={saving}
            disabled={saving}
            icon={<Icon name="checkmark" size={18} color={colors.textInverse} />}
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
  flex: { flex: 1 },
  planButton: {
    flex: 1,
    minWidth: '45%' as unknown as number,
  },
  planGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
});

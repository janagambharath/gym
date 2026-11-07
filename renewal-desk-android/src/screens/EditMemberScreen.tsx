import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../components/AppHeader';
import { ErrorState } from '../components/ErrorState';
import { FormField } from '../components/FormField';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { PrimaryButton } from '../components/PrimaryButton';
import { apiRequest, getCachedSession } from '../services/apiClient';
import { canOpenDateRepair } from '../services/roleAccess';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing, fontFamily} from '../theme/tokens';
import type { Member, Plan } from '../types';
import { formatCurrency, getGymTodayISO, getPhoneCountryPrefix } from '../types';

type EditMemberScreenProps = {
  memberId: number;
  onBack: () => void;
  onSaved?: (member: Member) => void;
  onNavigateDateRepair?: () => void;
};

export function EditMemberScreen({ memberId, onBack, onSaved, onNavigateDateRepair }: EditMemberScreenProps) {
  const canEditMembership = getCachedSession()?.userRole === 'gym_owner';
  const [member, setMember] = useState<Member | undefined>();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  // Form state
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [gender, setGender] = useState('');
  const [notes, setNotes] = useState('');
  const [planId, setPlanId] = useState<number | undefined>();
  const [startDate, setStartDate] = useState('');
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);

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
        setAddress(m.address ?? '');
        setGender(m.gender ?? '');
        setNotes(m.notes ?? '');
        setPlanId(m.plan?.id);
        setStartDate(m.membership_start ?? '');
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
    if (saving) return;
    if (!validate()) return;
    if (!member) return;
    setSaving(true);
    setFormErrors({});

    const cleanDigits = phone.replace(/\D/g, '');
    // 10-digit local numbers get the gym's own country prefix — never a
    // hardcoded +91 (a US gym's 10-digit number is not an Indian number).
    const countryPrefix = getPhoneCountryPrefix(getCachedSession()?.gymTimezone, getCachedSession()?.gymCountry);
    const normalizedPhone = phone.trim().startsWith('+')
      ? phone.trim()
      : (cleanDigits.length === 10 ? `${countryPrefix}${cleanDigits}` : `+${cleanDigits}`);

    const body: Record<string, unknown> = {
      full_name: fullName.trim(),
      phone: normalizedPhone,
    };

    if (email.trim()) body.email = email.trim();
    else body.email = null;
    if (address.trim()) body.address = address.trim();
    else body.address = null;
    if (gender.trim()) body.gender = gender.trim();
    else body.gender = null;
    if (notes.trim()) body.notes = notes.trim();
    else body.notes = null;
    const membershipChanged = planId !== member.plan?.id || startDate !== (member.membership_start ?? '');
    if (canEditMembership && membershipChanged) {
      if (planId !== member.plan?.id && planId) body.plan_id = planId;
      if (startDate) {
        const selectedPlan = plans.find((plan) => plan.id === planId);
        const duration = selectedPlan?.duration_days ?? (
          member.membership_start && member.membership_end
            ? Math.max(1, Math.round((new Date(`${member.membership_end}T12:00:00`).getTime() - new Date(`${member.membership_start}T12:00:00`).getTime()) / 86400000) + 1)
            : 30
        );
        if (duration) {
          const [year, month, day] = startDate.split('-').map(Number);
          const end = new Date(year, month - 1, day);
          end.setDate(end.getDate() + duration - 1);
          body.membership_start = startDate;
          body.membership_end = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
        }
      }
    }

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
  }, [fullName, phone, email, address, gender, notes, planId, startDate, plans, canEditMembership, member, memberId, validate, onBack, onSaved, saving]);

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
              label="Address"
              value={address}
              onChangeText={setAddress}
              placeholder="Street, locality, city"
            />
            <View style={styles.genderField}>
              <Text style={styles.genderLabel}>Gender</Text>
              <View style={styles.genderOptions}>
                {['Male', 'Female', 'Other'].map((option) => (
                  <TouchableOpacity
                    key={option}
                    accessibilityRole="button"
                    accessibilityState={{ selected: gender.toLowerCase() === option.toLowerCase() }}
                    style={[styles.genderOption, gender.toLowerCase() === option.toLowerCase() && styles.genderOptionSelected]}
                    onPress={() => setGender(gender.toLowerCase() === option.toLowerCase() ? '' : option)}
                  >
                    <Text style={[styles.genderOptionText, gender.toLowerCase() === option.toLowerCase() && styles.genderOptionTextSelected]}>{option}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.sectionHeader}>
              <Icon name="plan" size={18} color={colors.brand} />
              <Text style={styles.sectionTitle}>Membership</Text>
            </View>
            {canEditMembership && plans.length > 0 ? (
              <View style={styles.planGrid}>
                {plans.map((p) => (
                  <PrimaryButton
                    key={p.id}
                    title={`${p.name}\n${formatCurrency(p.price)} · ${p.duration_days}d`}
                    variant={planId === p.id ? 'primary' : 'outline'}
                    size="sm"
                    onPress={() => setPlanId(p.id)}
                    style={styles.planButton}
                  />
                ))}
              </View>
            ) : null}
            {!canEditMembership ? <Text style={styles.readOnlyCopy}>Only the gym owner can change the plan or membership dates.</Text> : null}
            {canEditMembership ? (
              <View style={styles.dateField}>
                <Text style={styles.genderLabel}>Membership Start Date</Text>
                <TouchableOpacity style={styles.dateButton} onPress={() => { if (!startDate) setStartDate(getGymTodayISO()); setShowStartDatePicker(true); }}>
                  <Text style={styles.dateButtonText}>{startDate || 'Choose start date'}</Text>
                  <Icon name="calendar" size={18} color={colors.brand} />
                </TouchableOpacity>
                <Text style={styles.readOnlyCopy}>
                  End date will be recalculated from the selected plan or the current membership length.
                </Text>
                {/* V8-L31: this block is already owner-only via
                    canEditMembership, but the Date Repair gate is stated
                    explicitly so moving the link out of this block cannot
                    silently re-expose it to staff. */}
                {onNavigateDateRepair && canOpenDateRepair(canEditMembership) ? (
                  <Text style={styles.readOnlyCopy}>
                    If dates don&apos;t match payments, fix them in{' '}
                    <Text style={styles.dateRepairLink} onPress={onNavigateDateRepair}>
                      Date Repair
                    </Text>
                    .
                  </Text>
                ) : null}
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
      {showStartDatePicker ? (
        <DateTimePicker
          value={(() => { const [year, month, day] = startDate.split('-').map(Number); return new Date(year, month - 1, day); })()}
          mode="date"
          display="default"
          onChange={(event, selectedDate) => {
            setShowStartDatePicker(false);
            if (event.type === 'set' && selectedDate) {
              setStartDate(`${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`);
            }
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  genderField: { gap: spacing.xs },
  genderLabel: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  genderOptions: { flexDirection: 'row', gap: spacing.sm },
  genderOption: { borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, flex: 1, paddingVertical: spacing.sm, alignItems: 'center' },
  genderOptionSelected: { backgroundColor: colors.brandSubtle, borderColor: colors.brand },
  genderOptionText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  genderOptionTextSelected: { color: colors.brand, fontWeight: fontWeight.semibold },
  dateField: { gap: spacing.xs, marginTop: spacing.md },
  dateButton: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 48, paddingHorizontal: spacing.lg },
  dateButtonText: { color: colors.text, fontSize: fontSize.base },
  readOnlyCopy: { color: colors.muted, fontSize: fontSize.xs, lineHeight: 18, marginTop: spacing.xs },
  dateRepairLink: { color: colors.brand, fontWeight: fontWeight.bold, textDecorationLine: 'underline' },
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
    paddingBottom: spacing.bottomTabSafe,
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
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
});

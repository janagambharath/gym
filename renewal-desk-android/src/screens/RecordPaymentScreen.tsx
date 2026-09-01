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
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../components/AppHeader';
import { Avatar } from '../components/Avatar';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
import { SearchBar } from '../components/SearchBar';
import { apiRequest } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type { Member, Payment } from '../types';
import { formatCurrency, getCurrencySymbol } from '../types';

const PAYMENT_METHODS = ['cash', 'upi', 'bank_transfer', 'card', 'other'] as const;

type RecordPaymentScreenProps = {
  onBack: () => void;
  preselectedMemberId?: number;
  onCreated?: (payment: Payment) => void;
};

export function RecordPaymentScreen({ onBack, preselectedMemberId, onCreated }: RecordPaymentScreenProps) {
  // Member selection
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Member[]>([]);
  const [selectedMember, setSelectedMember] = useState<Member | undefined>();
  const [searching, setSearching] = useState(false);

  // Form
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<string>('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [renewalDays, setRenewalDays] = useState('30');
  const [saving, setSaving] = useState(false);

  // Pre-select member if provided
  useEffect(() => {
    if (preselectedMemberId) {
      void apiRequest<Member>(`/api/mobile/v1/members/${preselectedMemberId}`).then((res) => {
        if (res.ok) {
          setSelectedMember(res.data);
          if (res.data.plan?.duration_days) {
            setRenewalDays(String(res.data.plan.duration_days));
          }
          if (res.data.plan?.price) {
            setAmount(res.data.plan.price);
          }
        }
      });
    }
  }, [preselectedMemberId]);

  // Search members
  useEffect(() => {
    if (!searchQuery.trim() || selectedMember) {
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      const res = await apiRequest<{ members: Member[] }>(
        `/api/mobile/v1/members?q=${encodeURIComponent(searchQuery.trim())}&page_size=10`
      );
      setSearching(false);
      if (res.ok) setSearchResults(res.data.members);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, selectedMember]);

  const handleSubmit = useCallback(async () => {
    if (saving) return;
    if (!selectedMember) {
      Alert.alert('Error', 'Please select a member.');
      return;
    }
    const parsedAmount = parseFloat(amount);
    if (!amount.trim() || isNaN(parsedAmount) || parsedAmount < 0) {
      Alert.alert('Error', 'Please enter a valid amount.');
      return;
    }
    const days = parseInt(renewalDays, 10);
    if (!days || days < 1 || days > 730) {
      Alert.alert('Error', 'Renewal days must be between 1 and 730.');
      return;
    }

    setSaving(true);

    const result = await apiRequest<Payment>('/api/mobile/v1/payments', {
      method: 'POST',
      body: {
        member_id: selectedMember.id,
        amount: parsedAmount,
        method,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        renewal_days: days,
      },
    });

    setSaving(false);

    if (result.ok) {
      Alert.alert('Success', `Payment of ${formatCurrency(parsedAmount)} recorded for ${selectedMember.full_name}.`);
      onCreated?.(result.data);
      onBack();
    } else {
      Alert.alert('Error', result.error.message);
    }
  }, [selectedMember, amount, method, reference, notes, renewalDays, onBack, onCreated, saving]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Record Payment" onBack={onBack} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Member Selection */}
          <View style={styles.card}>
            <View style={styles.sectionHeader}>
              <Icon name="person" size={18} color={colors.brand} />
              <Text style={styles.sectionTitle}>Member</Text>
            </View>

            {selectedMember ? (
              <View style={styles.selectedMember}>
                <Avatar name={selectedMember.full_name} size={40} />
                <View style={styles.selectedMemberInfo}>
                  <Text style={styles.selectedMemberName}>{selectedMember.full_name}</Text>
                  <Text style={styles.selectedMemberPhone}>{selectedMember.phone}</Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    setSelectedMember(undefined);
                    setSearchQuery('');
                  }}
                  style={styles.changeMember}
                >
                  <Text style={styles.changeMemberText}>Change</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <SearchBar
                  value={searchQuery}
                  onChangeText={(text) => {
                    setSearchQuery(text);
                    if (!text.trim()) setSearchResults([]);
                  }}
                  placeholder="Search member by name or phone..."
                />
                {searching ? (
                  <Text style={styles.searchingText}>Searching...</Text>
                ) : null}
                {searchResults.map((m) => (
                  <TouchableOpacity
                    key={m.id}
                    style={styles.searchResult}
                    onPress={() => {
                      setSelectedMember(m);
                      setSearchResults([]);
                      if (m.plan?.price) setAmount(m.plan.price);
                      if (m.plan?.duration_days) setRenewalDays(String(m.plan.duration_days));
                    }}
                  >
                    <Avatar name={m.full_name} size={32} />
                    <View style={styles.searchResultInfo}>
                      <Text style={styles.searchResultName}>{m.full_name}</Text>
                      <Text style={styles.searchResultPhone}>
                        {m.phone} · {m.plan?.name ?? 'Plan not set'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            )}
          </View>

          {/* Payment Details */}
          <View style={styles.card}>
            <View style={styles.sectionHeader}>
              <Icon name="cash" size={18} color={colors.brand} />
              <Text style={styles.sectionTitle}>Payment Details</Text>
            </View>

            <FormField
              label={`Amount (${getCurrencySymbol().trim()}) *`}
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              keyboardType="decimal-pad"
            />

            <Text style={styles.fieldLabel}>Payment Method</Text>
            <View style={styles.methodGrid}>
              {PAYMENT_METHODS.map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.methodChip, method === m && styles.methodChipActive]}
                  onPress={() => setMethod(m)}
                >
                  <Text style={[styles.methodChipText, method === m && styles.methodChipTextActive]}>
                    {m.replace('_', ' ').toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <FormField
              label="Reference / Transaction ID"
              value={reference}
              onChangeText={setReference}
              placeholder="Optional"
            />

            <FormField
              label="Renewal Days"
              value={renewalDays}
              onChangeText={setRenewalDays}
              placeholder="30"
              keyboardType="number-pad"
            />

            <FormField
              label="Notes"
              value={notes}
              onChangeText={setNotes}
              placeholder="Optional notes..."
              multiline
              numberOfLines={2}
            />
          </View>

          {/* Security Notice */}
          <View style={styles.notice}>
            <Icon name="shield" size={16} color={colors.muted} />
            <Text style={styles.noticeText}>
              Payment will be recorded as &quot;pending&quot; and requires verification.
            </Text>
          </View>

          <PrimaryButton
            title="Record Payment"
            variant="primary"
            onPress={() => void handleSubmit()}
            loading={saving}
            disabled={saving || !selectedMember}
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
  changeMember: { paddingHorizontal: spacing.sm },
  changeMemberText: { color: colors.brand, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.section },
  fieldLabel: { color: colors.textSecondary, fontSize: fontSize.base, fontWeight: fontWeight.medium, marginBottom: spacing.sm, marginTop: spacing.md },
  flex: { flex: 1 },
  methodChip: {
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  methodChipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  methodChipText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  methodChipTextActive: { color: colors.textInverse },
  methodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  notice: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.sm },
  noticeText: { color: colors.muted, flex: 1, fontSize: fontSize.sm },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  searchResult: {
    alignItems: 'center',
    borderTopColor: colors.borderLight,
    borderTopWidth: 1,
    flexDirection: 'row',
    paddingVertical: spacing.md,
  },
  searchResultInfo: { flex: 1, marginLeft: spacing.md },
  searchResultName: { color: colors.text, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  searchResultPhone: { color: colors.muted, fontSize: fontSize.sm },
  searchingText: { color: colors.muted, fontSize: fontSize.sm, paddingVertical: spacing.sm },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  sectionTitle: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
  selectedMember: {
    alignItems: 'center',
    backgroundColor: colors.gray50,
    borderRadius: radius.md,
    flexDirection: 'row',
    padding: spacing.md,
  },
  selectedMemberInfo: { flex: 1, marginLeft: spacing.md },
  selectedMemberName: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  selectedMemberPhone: { color: colors.muted, fontSize: fontSize.sm },
});

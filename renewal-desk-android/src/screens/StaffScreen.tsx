import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../components/AppHeader';
import { Avatar } from '../components/Avatar';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { FormField } from '../components/FormField';
import { CardSkeleton } from '../components/LoadingSkeleton';
import { PrimaryButton } from '../components/PrimaryButton';
import { StatusBadge } from '../components/StatusBadge';
import { apiRequest } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import { formatDate as formatGymDate } from '../types';

type StaffMember = {
  id: number;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string | null;
};

type CreatedInvite = {
  full_name: string;
  email: string;
  temp_password?: string;
  invite_whatsapp_url?: string;
};

type StaffScreenProps = {
  onBack: () => void;
};

export function StaffScreen({ onBack }: StaffScreenProps) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  // Add staff modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [roleInput, setRoleInput] = useState<'staff' | 'gym_owner'>('staff');
  const [passwordInput, setPasswordInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Invite success modal
  const [createdInvite, setCreatedInvite] = useState<CreatedInvite | null>(null);

  // Action modal state
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);

  const fetchStaff = useCallback(() => apiRequest<{ staff: StaffMember[] }>('/api/mobile/v1/staff').then((res) => {
    if (res.ok) {
      setStaff(res.data.staff);
      setError(undefined);
    } else {
      setError(res.error.message);
    }
    setLoading(false);
  }), []);

  useEffect(() => {
    void fetchStaff();
  }, [fetchStaff]);

  const handleRetry = useCallback(() => {
    setLoading(true);
    void fetchStaff();
  }, [fetchStaff]);

  const formatDate = (iso: string | null) => {
    if (!iso) return 'Never';
    try {
      return formatGymDate(iso);
    } catch { return '—'; }
  };

  const handleCreateStaff = useCallback(async () => {
    if (!nameInput.trim() || !emailInput.trim()) {
      Alert.alert('Required Fields', 'Full Name and Email are required.');
      return;
    }
    setSubmitting(true);
    const res = await apiRequest<{
      id: number;
      full_name: string;
      email: string;
      temp_password?: string;
      invite_whatsapp_url?: string;
    }>('/api/mobile/v1/staff', {
      method: 'POST',
      body: {
        full_name: nameInput.trim(),
        email: emailInput.trim(),
        phone: phoneInput.trim() || undefined,
        role: roleInput,
        password: passwordInput.trim() || undefined,
      },
    });
    setSubmitting(false);

    if (res.ok) {
      setShowAddModal(false);
      setNameInput('');
      setEmailInput('');
      setPhoneInput('');
      setPasswordInput('');
      setRoleInput('staff');
      setCreatedInvite(res.data);
      void fetchStaff();
    } else {
      Alert.alert('Error', res.error.message || 'Could not create staff account.');
    }
  }, [nameInput, emailInput, phoneInput, roleInput, passwordInput, fetchStaff]);

  const handleToggleActive = useCallback(async () => {
    if (!selectedStaff) return;
    const willBeActive = !selectedStaff.is_active;
    const res = await apiRequest(`/api/mobile/v1/staff/${selectedStaff.id}`, {
      method: 'PATCH',
      body: { is_active: willBeActive },
    });
    if (res.ok) {
      setSelectedStaff(null);
      void fetchStaff();
    } else {
      Alert.alert('Error', res.error.message || 'Could not update staff status.');
    }
  }, [selectedStaff, fetchStaff]);

  const handleResetPassword = useCallback(async () => {
    if (!selectedStaff) return;
    const res = await apiRequest<{
      id: number;
      new_password: string;
      invite_whatsapp_url: string;
    }>(`/api/mobile/v1/staff/${selectedStaff.id}/reset-password`, {
      method: 'POST',
    });
    if (res.ok) {
      const invite = {
        full_name: selectedStaff.full_name,
        email: selectedStaff.email,
        temp_password: res.data.new_password,
        invite_whatsapp_url: res.data.invite_whatsapp_url,
      };
      setSelectedStaff(null);
      setCreatedInvite(invite);
    } else {
      Alert.alert('Error', res.error.message || 'Could not reset password.');
    }
  }, [selectedStaff]);

  const renderStaff = ({ item }: { item: StaffMember }) => (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.7}
      onPress={() => setSelectedStaff(item)}
    >
      <View style={styles.row}>
        <Avatar name={item.full_name} size={44} />
        <View style={styles.info}>
          <Text style={styles.name}>{item.full_name}</Text>
          <Text style={styles.email}>{item.email}</Text>
          <Text style={styles.meta}>
            Last login: {formatDate(item.last_login_at)}
          </Text>
        </View>
        <View style={styles.badges}>
          <StatusBadge status={item.role === 'gym_owner' ? 'Owner' : 'Staff'} />
          {!item.is_active ? <StatusBadge status="inactive" /> : null}
        </View>
        <Icon name="forward" size={16} color={colors.muted} />
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader
        title="Staff Management"
        onBack={onBack}
        rightAction={
          <TouchableOpacity onPress={() => setShowAddModal(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ color: colors.brand, fontWeight: '700', fontSize: fontSize.base }}>+ Add</Text>
          </TouchableOpacity>
        }
      />
      {loading ? (
        <View style={styles.loadingWrap}>
          <CardSkeleton />
          <CardSkeleton />
        </View>
      ) : error ? (
        <ErrorState message={error} onRetry={handleRetry} />
      ) : staff.length === 0 ? (
        <EmptyState
          icon={<Icon name="staff" size={40} color={colors.muted} />}
          title="No staff members yet"
          subtitle="Add trainers, front desk, and managers to help run your gym."
          actionLabel="+ Add Staff Member"
          onAction={() => setShowAddModal(true)}
        />
      ) : (
        <FlatList
          data={staff}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderStaff}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Add Staff Modal */}
      <Modal visible={showAddModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>+ Add Staff Member</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)} hitSlop={10}>
                <Icon name="close" size={20} color={colors.muted} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <FormField
                label="Full Name *"
                value={nameInput}
                onChangeText={setNameInput}
                placeholder="e.g. Vikram Singh"
              />
              <FormField
                label="Email Address *"
                value={emailInput}
                onChangeText={setEmailInput}
                placeholder="vikram@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <FormField
                label="Phone Number (for WhatsApp invite)"
                value={phoneInput}
                onChangeText={setPhoneInput}
                placeholder="+91 98765 43210"
                keyboardType="phone-pad"
              />

              <Text style={styles.fieldLabel}>Role</Text>
              <View style={styles.roleSelector}>
                <TouchableOpacity
                  style={[styles.roleOption, roleInput === 'staff' && styles.roleOptionActive]}
                  onPress={() => setRoleInput('staff')}
                >
                  <Text style={[styles.roleOptionText, roleInput === 'staff' && styles.roleOptionTextActive]}>
                    Staff / Trainer
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.roleOption, roleInput === 'gym_owner' && styles.roleOptionActive]}
                  onPress={() => setRoleInput('gym_owner')}
                >
                  <Text style={[styles.roleOptionText, roleInput === 'gym_owner' && styles.roleOptionTextActive]}>
                    Co-Owner / Manager
                  </Text>
                </TouchableOpacity>
              </View>

              <FormField
                label="Password (Optional)"
                value={passwordInput}
                onChangeText={setPasswordInput}
                placeholder="Leave blank to auto-generate"
                secureTextEntry
              />

              <View style={styles.modalActions}>
                <PrimaryButton
                  label={submitting ? 'Creating...' : 'Create & Invite'}
                  onPress={handleCreateStaff}
                  disabled={submitting}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Created Invite Success Dialog */}
      <Modal visible={!!createdInvite} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, styles.successCard]}>
            <Text style={styles.successIcon}>🎉</Text>
            <Text style={styles.modalTitle}>Staff Account Created!</Text>
            <Text style={styles.successSubtext}>
              {createdInvite?.full_name} can now sign into Renewal Desk.
            </Text>

            <View style={styles.credBox}>
              <Text style={styles.credRow}>
                <Text style={styles.credLabel}>Email: </Text>
                {createdInvite?.email}
              </Text>
              <Text style={styles.credRow}>
                <Text style={styles.credLabel}>Password: </Text>
                {createdInvite?.temp_password || '********'}
              </Text>
            </View>

            {createdInvite?.invite_whatsapp_url ? (
              <TouchableOpacity
                style={styles.whatsappBtn}
                onPress={() => {
                  if (createdInvite.invite_whatsapp_url) {
                    void Linking.openURL(createdInvite.invite_whatsapp_url);
                  }
                }}
              >
                <Icon name="whatsapp" size={18} color="#FFFFFF" />
                <Text style={styles.whatsappBtnText}>Share via WhatsApp</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={styles.doneBtn}
              onPress={() => setCreatedInvite(null)}
            >
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Staff Action Modal */}
      <Modal visible={!!selectedStaff} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View style={styles.row}>
                <Avatar name={selectedStaff?.full_name ?? ''} size={40} />
                <View style={{ marginLeft: spacing.sm }}>
                  <Text style={styles.name}>{selectedStaff?.full_name}</Text>
                  <Text style={styles.email}>{selectedStaff?.email} • {selectedStaff?.role}</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setSelectedStaff(null)} hitSlop={10}>
                <Icon name="close" size={20} color={colors.muted} />
              </TouchableOpacity>
            </View>

            <View style={styles.actionOptions}>
              <TouchableOpacity style={styles.actionBtn} onPress={handleResetPassword}>
                <Icon name="lock" size={18} color={colors.brand} />
                <Text style={styles.actionBtnText}>Reset Password</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.actionBtn} onPress={handleToggleActive}>
                <Icon
                  name={selectedStaff?.is_active ? 'warning' : 'check'}
                  size={18}
                  color={selectedStaff?.is_active ? colors.critical : colors.success}
                />
                <Text
                  style={[
                    styles.actionBtnText,
                    { color: selectedStaff?.is_active ? colors.critical : colors.success },
                  ]}
                >
                  {selectedStaff?.is_active ? 'Deactivate Account' : 'Reactivate Account'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  actionBtn: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  actionBtnText: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  actionOptions: {
    gap: spacing.sm,
    marginVertical: spacing.md,
  },
  badges: { alignItems: 'flex-end', gap: spacing.xs, marginRight: spacing.sm },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  credBox: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    marginVertical: spacing.md,
    padding: spacing.md,
    width: '100%',
  },
  credLabel: {
    color: colors.text,
    fontWeight: fontWeight.bold,
  },
  credRow: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    marginVertical: 2,
  },
  doneBtn: {
    alignItems: 'center',
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  doneBtnText: {
    color: colors.muted,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  email: { color: colors.muted, fontSize: fontSize.sm },
  fieldLabel: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    marginBottom: spacing.xs,
  },
  info: { flex: 1, marginLeft: spacing.md },
  list: { gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.bottomTabSafe },
  loadingWrap: { gap: spacing.md, padding: spacing.lg },
  modalActions: {
    marginTop: spacing.lg,
  },
  modalContainer: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    maxHeight: '90%',
    padding: spacing.xl,
    width: '100%',
    ...shadows.lg,
  },
  modalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  modalOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    flex: 1,
    justifyContent: 'flex-end',
    padding: spacing.lg,
  },
  modalTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  name: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  meta: { color: colors.muted, fontSize: fontSize.xs, marginTop: spacing.xxs },
  roleOption: {
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    flex: 1,
    padding: spacing.sm,
  },
  roleOptionActive: {
    backgroundColor: colors.brandLight,
    borderColor: colors.brand,
    borderWidth: 1,
  },
  roleOptionText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  roleOptionTextActive: {
    color: colors.brand,
    fontWeight: fontWeight.bold,
  },
  roleSelector: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  row: { alignItems: 'center', flexDirection: 'row' },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  successCard: {
    alignItems: 'center',
  },
  successIcon: {
    fontSize: 40,
    marginBottom: spacing.xs,
  },
  successSubtext: {
    color: colors.muted,
    fontSize: fontSize.sm,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  whatsappBtn: {
    alignItems: 'center',
    backgroundColor: '#25D366',
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    padding: spacing.md,
    width: '100%',
  },
  whatsappBtnText: {
    color: '#FFFFFF',
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
  },
});

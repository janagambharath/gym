import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../components/AppHeader';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { FormField } from '../components/FormField';
import { CardSkeleton } from '../components/LoadingSkeleton';
import { SectionHeader } from '../components/SectionHeader';
import { apiRequest, getCachedSession } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type { Plan } from '../types';

type PlansScreenProps = {
  onBack: () => void;
};

type Notice = {
  kind: 'success' | 'error';
  text: string;
};

export function PlansScreen({ onBack }: PlansScreenProps) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<Notice>();

  // Add plan form
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newDuration, setNewDuration] = useState('30');
  const [saving, setSaving] = useState(false);

  // Edit plan
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editDuration, setEditDuration] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // Delete
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const canEdit = getCachedSession()?.userRole === 'gym_owner';

  const fetchPlans = useCallback(() => apiRequest<{ plans: Plan[] }>('/api/mobile/v1/settings').then((res) => {
    if (res.ok) {
      setPlans(res.data.plans);
      setError(undefined);
    } else {
      setError(res.error.message);
    }
    setLoading(false);
  }), []);

  useEffect(() => {
    void fetchPlans();
  }, [fetchPlans]);

  const handleRetry = useCallback(() => {
    setLoading(true);
    void fetchPlans();
  }, [fetchPlans]);

  const handleAddPlan = useCallback(async () => {
    if (saving || !newName.trim()) return;
    setSaving(true);
    setNotice(undefined);
    const res = await apiRequest<Plan>('/api/mobile/v1/plans', {
      method: 'POST',
      body: {
        name: newName.trim(),
        price: newPrice.trim() || '0',
        duration_days: parseInt(newDuration, 10) || 30,
      },
    });
    if (res.ok) {
      setPlans((prev) => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName('');
      setNewPrice('');
      setNewDuration('30');
      setShowAdd(false);
      setNotice({ kind: 'success', text: `Plan "${res.data.name}" created!` });
    } else {
      setNotice({ kind: 'error', text: res.error?.message || 'Failed to create plan.' });
    }
    setSaving(false);
  }, [newName, newPrice, newDuration, saving]);

  const handleEditPlan = useCallback(async (planId: number) => {
    if (editSaving) return;
    setEditSaving(true);
    setNotice(undefined);
    const body: Record<string, unknown> = {};
    if (editName.trim()) body.name = editName.trim();
    if (editPrice.trim()) body.price = editPrice.trim();
    if (editDuration.trim()) body.duration_days = parseInt(editDuration, 10);

    const res = await apiRequest<Plan>(`/api/mobile/v1/plans/${planId}`, {
      method: 'PATCH',
      body,
    });
    if (res.ok) {
      setPlans((prev) => prev.map((p) => (p.id === planId ? res.data : p)));
      setEditingId(null);
      setNotice({ kind: 'success', text: 'Plan updated!' });
    } else {
      setNotice({ kind: 'error', text: res.error?.message || 'Failed to update plan.' });
    }
    setEditSaving(false);
  }, [editName, editPrice, editDuration, editSaving]);

  const handleDeletePlan = useCallback(async (planId: number, planName: string) => {
    setDeletingId(planId);
    setNotice(undefined);
    const res = await apiRequest(`/api/mobile/v1/plans/${planId}`, { method: 'DELETE' });
    if (res.ok) {
      setPlans((prev) => prev.filter((p) => p.id !== planId));
      setNotice({ kind: 'success', text: `Plan "${planName}" deleted.` });
    } else {
      setNotice({ kind: 'error', text: res.error?.message || 'Failed to delete plan.' });
    }
    setDeletingId(null);
  }, []);

  const startEdit = useCallback((plan: Plan) => {
    setEditingId(plan.id);
    setEditName(plan.name);
    setEditPrice(plan.price);
    setEditDuration(String(plan.duration_days));
  }, []);

  const renderPlan = ({ item }: { item: Plan }) => {
    if (editingId === item.id) {
      return (
        <View style={styles.card}>
          <SectionHeader title="Edit Plan" icon={<Icon name="edit" size={18} color={colors.brand} />} />
          <View style={styles.editForm}>
            <FormField
              label="Plan name"
              value={editName}
              onChangeText={setEditName}
              placeholder="e.g. Monthly"
            />
            <View style={styles.editRow}>
              <View style={styles.editHalf}>
                <FormField
                  label="Price (₹)"
                  value={editPrice}
                  onChangeText={setEditPrice}
                  placeholder="0"
                  keyboardType="number-pad"
                />
              </View>
              <View style={styles.editHalf}>
                <FormField
                  label="Duration (days)"
                  value={editDuration}
                  onChangeText={setEditDuration}
                  placeholder="30"
                  keyboardType="number-pad"
                />
              </View>
            </View>
            <View style={styles.editActions}>
              <TouchableOpacity
                onPress={() => setEditingId(null)}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={editSaving || !editName.trim()}
                onPress={() => void handleEditPlan(item.id)}
                style={[styles.saveBtn, (editSaving || !editName.trim()) && { opacity: 0.5 }]}
              >
                <Icon name="checkmark" size={16} color={colors.textInverse} />
                <Text style={styles.saveText}>{editSaving ? 'Saving...' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={styles.iconWrap}>
            <Icon name="plan" size={20} color={colors.brand} />
          </View>
          <View style={styles.planInfo}>
            <Text style={styles.planName}>{item.name}</Text>
            <Text style={styles.planDuration}>{item.duration_days} days</Text>
          </View>
          <Text style={styles.planPrice}>₹{item.price}</Text>
        </View>
        {canEdit ? (
          <View style={styles.cardActions}>
            <TouchableOpacity
              onPress={() => startEdit(item)}
              style={styles.actionBtn}
            >
              <Icon name="edit" size={16} color={colors.brand} />
              <Text style={styles.actionText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={deletingId === item.id}
              onPress={() => void handleDeletePlan(item.id, item.name)}
              style={styles.actionBtn}
            >
              <Icon name="close" size={16} color={deletingId === item.id ? colors.muted : colors.critical} />
              <Text style={[styles.actionText, { color: deletingId === item.id ? colors.muted : colors.critical }]}>
                {deletingId === item.id ? 'Deleting...' : 'Delete'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  };

  const ListHeader = () => (
    <>
      {notice ? (
        <View style={[styles.notice, notice.kind === 'success' ? styles.successNotice : styles.errorNotice]}>
          <Icon
            name={notice.kind === 'success' ? 'checkmark' : 'alert'}
            size={18}
            color={notice.kind === 'success' ? colors.successDark : colors.criticalDark}
          />
          <Text style={[styles.noticeText, { color: notice.kind === 'success' ? colors.successDark : colors.criticalDark }]}>
            {notice.text}
          </Text>
        </View>
      ) : null}

      {canEdit && !showAdd ? (
        <TouchableOpacity onPress={() => setShowAdd(true)} style={styles.addBtn}>
          <Icon name="add" size={20} color={colors.textInverse} />
          <Text style={styles.addBtnText}>Add New Plan</Text>
        </TouchableOpacity>
      ) : null}

      {canEdit && showAdd ? (
        <View style={styles.card}>
          <SectionHeader title="New Plan" icon={<Icon name="add" size={18} color={colors.brand} />} />
          <View style={styles.editForm}>
            <FormField
              label="Plan name"
              value={newName}
              onChangeText={setNewName}
              placeholder="e.g. Monthly, Quarterly, Annual"
            />
            <View style={styles.editRow}>
              <View style={styles.editHalf}>
                <FormField
                  label="Price (₹)"
                  value={newPrice}
                  onChangeText={setNewPrice}
                  placeholder="e.g. 1500"
                  keyboardType="number-pad"
                />
              </View>
              <View style={styles.editHalf}>
                <FormField
                  label="Duration (days)"
                  value={newDuration}
                  onChangeText={setNewDuration}
                  placeholder="30"
                  keyboardType="number-pad"
                />
              </View>
            </View>
            <View style={styles.editActions}>
              <TouchableOpacity
                onPress={() => { setShowAdd(false); setNewName(''); setNewPrice(''); setNewDuration('30'); }}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={saving || !newName.trim()}
                onPress={() => void handleAddPlan()}
                style={[styles.saveBtn, (saving || !newName.trim()) && { opacity: 0.5 }]}
              >
                <Icon name="checkmark" size={16} color={colors.textInverse} />
                <Text style={styles.saveText}>{saving ? 'Creating...' : 'Create Plan'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}
    </>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Membership Plans" onBack={onBack} />
      {loading ? (
        <View style={styles.loadingWrap}><CardSkeleton /><CardSkeleton /></View>
      ) : error ? (
        <ErrorState message={error} onRetry={handleRetry} />
      ) : (
        <FlatList
          data={plans}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderPlan}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={
            <EmptyState
              icon={<Icon name="plan" size={40} color={colors.muted} />}
              title="No plans yet"
              subtitle={canEdit ? 'Tap "Add New Plan" above to create your first plan.' : 'No plans configured for this gym.'}
            />
          }
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  addBtn: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingVertical: spacing.md,
    ...shadows.sm,
  },
  addBtnText: {
    color: colors.textInverse,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  actionBtn: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  actionText: {
    color: colors.brand,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  cancelBtn: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  cancelText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  cardActions: {
    borderTopColor: colors.borderLight,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.xl,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  cardTop: { alignItems: 'center', flexDirection: 'row' },
  editActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    marginTop: spacing.sm,
  },
  editForm: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  editHalf: {
    flex: 1,
  },
  editRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  errorNotice: {
    backgroundColor: colors.criticalSurface,
    borderColor: colors.criticalBorder,
  },
  iconWrap: {
    alignItems: 'center',
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.md,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  list: { gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.section },
  loadingWrap: { gap: spacing.md, padding: spacing.lg },
  notice: {
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  noticeText: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  planDuration: { color: colors.muted, fontSize: fontSize.sm },
  planInfo: { flex: 1, marginLeft: spacing.md },
  planName: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  planPrice: { color: colors.brand, fontSize: fontSize['2xl'], fontVariant: ['tabular-nums'], fontWeight: fontWeight.extrabold },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  saveBtn: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  saveText: {
    color: colors.textInverse,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  successNotice: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
});

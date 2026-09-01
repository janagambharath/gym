import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
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
import { PrimaryButton } from '../components/PrimaryButton';
import {
  batchCreateMembers,
  type BatchCreateResult,
  type ScanDocumentResult,
  type ScannedMember,
} from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import { formatCurrency } from '../types';

type MemberScanReviewScreenProps = {
  scanResult: ScanDocumentResult;
  onBack: () => void;
  onImportComplete: (result: BatchCreateResult) => void;
  onViewMembers: () => void;
  onViewRenewals: () => void;
};

type FilterTab = 'all' | 'ready' | 'needs_review' | 'duplicates';

export function MemberScanReviewScreen({
  scanResult,
  onBack,
  onImportComplete,
  onViewMembers,
  onViewRenewals,
}: MemberScanReviewScreenProps) {
  const [members, setMembers] = useState<ScannedMember[]>(scanResult.members || []);
  const [plans] = useState(scanResult.plans || []);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [editingMember, setEditingMember] = useState<ScannedMember | null>(null);
  const [importing, setImporting] = useState(false);
  const [successResult, setSuccessResult] = useState<BatchCreateResult | null>(null);

  // Summary counts
  const summary = useMemo(() => {
    const total = members.length;
    const ready = members.filter((m) => m.is_ready && !m.is_duplicate).length;
    const duplicates = members.filter((m) => m.is_duplicate).length;
    const needs_review = members.filter((m) => !m.is_ready && !m.is_duplicate).length;
    const selectedCount = members.filter((m) => m.selected).length;
    return { total, ready, needs_review, duplicates, selectedCount };
  }, [members]);

  // Filtered members
  const filteredMembers = useMemo(() => {
    switch (filter) {
      case 'ready':
        return members.filter((m) => m.is_ready && !m.is_duplicate);
      case 'needs_review':
        return members.filter((m) => !m.is_ready && !m.is_duplicate);
      case 'duplicates':
        return members.filter((m) => m.is_duplicate);
      default:
        return members;
    }
  }, [members, filter]);

  // Batch toggle
  const toggleSelect = useCallback((tempId: string) => {
    setMembers((prev) =>
      prev.map((m) => (m.temp_id === tempId ? { ...m, selected: !m.selected } : m))
    );
  }, []);

  const selectAllReady = useCallback(() => {
    setMembers((prev) =>
      prev.map((m) => ({
        ...m,
        selected: m.is_ready && !m.is_duplicate,
      }))
    );
  }, []);

  const selectAll = useCallback(() => {
    setMembers((prev) => prev.map((m) => ({ ...m, selected: true })));
  }, []);

  const deselectAll = useCallback(() => {
    setMembers((prev) => prev.map((m) => ({ ...m, selected: false })));
  }, []);

  const removeMember = useCallback((tempId: string) => {
    setMembers((prev) => prev.filter((m) => m.temp_id !== tempId));
  }, []);

  const saveEdit = useCallback((updated: ScannedMember) => {
    // Re-evaluate readiness
    const hasName = Boolean(updated.name.trim());
    const hasPhone = Boolean(updated.phone.trim());
    const isReady = hasName && hasPhone && !updated.is_duplicate;

    setMembers((prev) =>
      prev.map((m) =>
        m.temp_id === updated.temp_id
          ? {
              ...updated,
              is_ready: isReady,
              selected: isReady ? true : updated.selected,
            }
          : m
      )
    );
    setEditingMember(null);
  }, []);

  // Final Import Confirmation
  const handleConfirmImport = useCallback(async () => {
    const selectedMembers = members.filter((m) => m.selected);
    if (selectedMembers.length === 0) {
      Alert.alert('No Members Selected', 'Please select at least one member to import.');
      return;
    }

    // Check for invalid rows among selected
    const invalidSelected = selectedMembers.filter((m) => !m.name.trim() || !m.phone.trim());
    if (invalidSelected.length > 0) {
      Alert.alert(
        'Incomplete Details',
        `${invalidSelected.length} selected member(s) are missing a name or phone number. Please edit them or deselect them before importing.`
      );
      return;
    }

    setImporting(true);
    try {
      const payload = selectedMembers.map((m) => ({
        name: m.name.trim(),
        phone: m.phone.trim(),
        email: m.email?.trim() || null,
        plan_id: m.plan_id || null,
        membership_start: m.membership_start || null,
        membership_end: m.membership_end || null,
        status: m.status || 'active',
        amount: m.amount || null,
        notes: m.notes || null,
      }));

      const res = await batchCreateMembers(payload);
      setImporting(false);

      if (res.ok) {
        setSuccessResult(res.data);
        onImportComplete(res.data);
      } else {
        Alert.alert('Import Failed', res.error.message || 'Could not import members. Please retry.');
      }
    } catch (err: any) {
      setImporting(false);
      Alert.alert('Import Error', err?.message || 'A network error occurred.');
    }
  }, [members, onImportComplete]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Review Extracted Records" onBack={onBack} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Summary Card */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Document Extraction Summary</Text>
          <View style={styles.metricsRow}>
            <SummaryPill label="Total" value={summary.total} color={colors.text} />
            <SummaryPill label="Ready" value={summary.ready} color={colors.success} bg={colors.successSurface} />
            <SummaryPill label="Review" value={summary.needs_review} color={colors.warning} bg={colors.warningSurface} />
            {summary.duplicates > 0 ? (
              <SummaryPill label="Duplicates" value={summary.duplicates} color={colors.critical} bg={colors.criticalSurface} />
            ) : null}
          </View>

          {/* Quick Selection Buttons */}
          <View style={styles.selectionActions}>
            <TouchableOpacity style={styles.smallActionBtn} onPress={selectAllReady} activeOpacity={0.7}>
              <Text style={styles.smallActionBtnText}>Select Ready ({summary.ready})</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.smallActionBtn} onPress={selectAll} activeOpacity={0.7}>
              <Text style={styles.smallActionBtnText}>Select All</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.smallActionBtn} onPress={deselectAll} activeOpacity={0.7}>
              <Text style={styles.smallActionBtnText}>Clear</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Filter Tabs */}
        <View style={styles.tabContainer}>
          <FilterButton
            active={filter === 'all'}
            label={`All (${summary.total})`}
            onPress={() => setFilter('all')}
          />
          <FilterButton
            active={filter === 'ready'}
            label={`Ready (${summary.ready})`}
            onPress={() => setFilter('ready')}
          />
          <FilterButton
            active={filter === 'needs_review'}
            label={`Review (${summary.needs_review})`}
            onPress={() => setFilter('needs_review')}
          />
          {summary.duplicates > 0 ? (
            <FilterButton
              active={filter === 'duplicates'}
              label={`Duplicates (${summary.duplicates})`}
              onPress={() => setFilter('duplicates')}
            />
          ) : null}
        </View>

        {/* Extracted Members List */}
        {filteredMembers.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No records match this filter.</Text>
          </View>
        ) : (
          filteredMembers.map((member) => (
            <MemberReviewCard
              key={member.temp_id}
              member={member}
              plans={plans}
              onToggleSelect={() => toggleSelect(member.temp_id)}
              onEdit={() => setEditingMember(member)}
              onRemove={() => removeMember(member.temp_id)}
            />
          ))
        )}

        {/* Action Button & Confirmation */}
        <View style={styles.bottomSection}>
          <PrimaryButton
            title={
              importing
                ? 'Importing Members…'
                : `Import ${summary.selectedCount} Member${summary.selectedCount !== 1 ? 's' : ''}`
            }
            onPress={handleConfirmImport}
            disabled={summary.selectedCount === 0 || importing}
            size="lg"
          />
          <Text style={styles.footerNote}>
            Imported members will be added immediately. Upcoming renewals and revenue will update automatically.
          </Text>
        </View>
      </ScrollView>

      {/* Inline Edit Member Modal */}
      {editingMember ? (
        <EditMemberModal
          member={editingMember}
          plans={plans}
          onSave={saveEdit}
          onClose={() => setEditingMember(null)}
        />
      ) : null}

      {/* Success Modal */}
      {successResult ? (
        <SuccessModal
          result={successResult}
          onViewMembers={onViewMembers}
          onViewRenewals={onViewRenewals}
        />
      ) : null}
    </SafeAreaView>
  );
}

function SummaryPill({
  label,
  value,
  color,
  bg = colors.gray100,
}: {
  label: string;
  value: number;
  color: string;
  bg?: string;
}) {
  return (
    <View style={[styles.pillWrap, { backgroundColor: bg }]}>
      <Text style={[styles.pillValue, { color }]}>{value}</Text>
      <Text style={[styles.pillLabel, { color }]}>{label}</Text>
    </View>
  );
}

function FilterButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.filterBtn, active && styles.filterBtnActive]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text style={[styles.filterBtnText, active && styles.filterBtnTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function MemberReviewCard({
  member,
  plans,
  onToggleSelect,
  onEdit,
  onRemove,
}: {
  member: ScannedMember;
  plans: { id: number; name: string; duration_days: number; price: string }[];
  onToggleSelect: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const planName = member.plan_name || (member.plan_id ? plans.find((p) => p.id === member.plan_id)?.name : 'Plan not set');

  return (
    <View style={[styles.memberCard, member.is_duplicate && styles.memberCardDuplicate]}>
      <View style={styles.cardTopRow}>
        {/* Checkbox */}
        <TouchableOpacity style={styles.checkboxTouch} onPress={onToggleSelect} activeOpacity={0.7}>
          <View style={[styles.checkbox, member.selected && styles.checkboxChecked]}>
            {member.selected && <Icon name="check" size={12} color="#fff" />}
          </View>
        </TouchableOpacity>

        {/* Member Name & Status */}
        <View style={styles.memberInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.memberName}>{member.name || 'Unnamed Member'}</Text>
            {member.is_duplicate ? (
              <View style={[styles.statusBadge, { backgroundColor: colors.criticalSurface }]}>
                <Text style={[styles.statusBadgeText, { color: colors.critical }]}>Duplicate</Text>
              </View>
            ) : member.is_ready ? (
              <View style={[styles.statusBadge, { backgroundColor: colors.successSurface }]}>
                <Text style={[styles.statusBadgeText, { color: colors.successDark }]}>Ready</Text>
              </View>
            ) : (
              <View style={[styles.statusBadge, { backgroundColor: colors.warningSurface }]}>
                <Text style={[styles.statusBadgeText, { color: colors.warning }]}>Needs Review</Text>
              </View>
            )}
          </View>

          {/* Details Row */}
          <Text style={styles.memberMeta}>
            {member.phone || 'No phone'} · {planName}
          </Text>

          {/* Dates & Amount */}
          <View style={styles.detailsRow}>
            <Text style={styles.detailLabel}>
              Expiry: <Text style={styles.detailValue}>{member.membership_end || 'Not set'}</Text>
            </Text>
            {member.amount ? (
              <Text style={styles.detailLabel}>
                Fee: <Text style={styles.detailValue}>{formatCurrency(member.amount)}</Text>
              </Text>
            ) : null}
          </View>

          {/* Actionable Warnings */}
          {member.warnings && member.warnings.length > 0 ? (
            <View style={styles.warningList}>
              {member.warnings.map((w, i) => (
                <View key={i} style={styles.warningItem}>
                  <Icon name="alert" size={12} color={colors.warning} />
                  <Text style={styles.warningText}>{w}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {/* Edit / Delete Actions */}
        <View style={styles.cardActionIcons}>
          <TouchableOpacity style={styles.iconBtn} onPress={onEdit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="edit" size={16} color={colors.brand} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={onRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="trash" size={16} color={colors.muted} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function EditMemberModal({
  member,
  plans,
  onSave,
  onClose,
}: {
  member: ScannedMember;
  plans: { id: number; name: string; duration_days: number; price: string }[];
  onSave: (updated: ScannedMember) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(member.name);
  const [phone, setPhone] = useState(member.phone);
  const [email, setEmail] = useState(member.email || '');
  const [planId, setPlanId] = useState<number | null>(member.plan_id);
  const [startDate, setStartDate] = useState(member.membership_start || '');
  const [expiryDate, setExpiryDate] = useState(member.membership_end || '');
  const [amount, setAmount] = useState(member.amount || '');
  const [notes, setNotes] = useState(member.notes || '');

  const handleSave = () => {
    const matchedPlan = plans.find((p) => p.id === planId);
    onSave({
      ...member,
      name,
      phone,
      email: email.trim() || null,
      plan_id: planId,
      plan_name: matchedPlan?.name || null,
      membership_start: startDate.trim() || null,
      membership_end: expiryDate.trim() || null,
      amount: amount.trim() || null,
      notes: notes.trim() || null,
      warnings: [], // Cleared on manual review
    });
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Edit Member Details</Text>
            <TouchableOpacity onPress={onClose}>
              <Icon name="close" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalForm}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Full Name *</Text>
              <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Member name" />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Phone Number (E.164) *</Text>
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={setPhone}
                placeholder="+919876543210"
                keyboardType="phone-pad"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email Address</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="member@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Membership Plan</Text>
              <View style={styles.planButtonsRow}>
                {plans.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.planChoiceBtn, planId === p.id && styles.planChoiceBtnActive]}
                    onPress={() => {
                      setPlanId(p.id);
                      if (!amount) setAmount(p.price);
                    }}
                  >
                    <Text style={[styles.planChoiceText, planId === p.id && styles.planChoiceTextActive]}>
                      {p.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.rowInputs}>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.label}>Start Date</Text>
                <TextInput
                  style={styles.input}
                  value={startDate}
                  onChangeText={setStartDate}
                  placeholder="YYYY-MM-DD"
                />
              </View>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.label}>Expiry Date</Text>
                <TextInput
                  style={styles.input}
                  value={expiryDate}
                  onChangeText={setExpiryDate}
                  placeholder="YYYY-MM-DD"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Fee Amount</Text>
              <TextInput
                style={styles.input}
                value={amount}
                onChangeText={setAmount}
                placeholder="1500"
                keyboardType="numeric"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Notes</Text>
              <TextInput
                style={styles.input}
                value={notes}
                onChangeText={setNotes}
                placeholder="Optional notes or batch"
              />
            </View>

            <View style={styles.modalActions}>
              <PrimaryButton title="Save Changes" onPress={handleSave} size="md" />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function SuccessModal({
  result,
  onViewMembers,
  onViewRenewals,
}: {
  result: BatchCreateResult;
  onViewMembers: () => void;
  onViewRenewals: () => void;
}) {
  return (
    <Modal visible animationType="fade" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.successCard}>
          <View style={styles.successIconWrap}>
            <Icon name="check" size={32} color={colors.success} />
          </View>

          <Text style={styles.successTitle}>Import Complete!</Text>
          <Text style={styles.successSub}>
            <Text style={{ fontWeight: fontWeight.bold }}>{result.imported} members</Text> were successfully added to
            Renewal Desk.
          </Text>

          {result.upcoming_renewals_count > 0 ? (
            <View style={styles.roiBanner}>
              <Icon name="refresh" size={18} color={colors.brand} />
              <View style={{ flex: 1 }}>
                <Text style={styles.roiBannerTitle}>
                  {result.upcoming_renewals_count} Upcoming Renewals Discovered
                </Text>
                <Text style={styles.roiBannerSub}>
                  {formatCurrency(result.revenue_at_risk)} revenue at risk within 7 days.
                </Text>
              </View>
            </View>
          ) : null}

          <View style={styles.successActions}>
            <PrimaryButton title="View Upcoming Renewals" onPress={onViewRenewals} size="md" />
            <TouchableOpacity style={styles.viewMembersBtn} onPress={onViewMembers}>
              <Text style={styles.viewMembersBtnText}>View All Members</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    gap: spacing.md,
    padding: spacing.md,
    paddingBottom: spacing.section,
  },
  summaryCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
    ...shadows.sm,
  },
  summaryTitle: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  pillWrap: {
    alignItems: 'center',
    borderRadius: radius.md,
    flex: 1,
    paddingVertical: spacing.xs,
  },
  pillValue: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
  },
  pillLabel: {
    fontSize: 10,
    fontWeight: fontWeight.medium,
  },
  selectionActions: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: 4,
  },
  smallActionBtn: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  smallActionBtnText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: fontWeight.medium,
  },
  tabContainer: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  filterBtn: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  filterBtnActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  filterBtnText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  filterBtnTextActive: {
    color: colors.textInverse,
    fontWeight: fontWeight.bold,
  },
  emptyState: {
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyStateText: {
    color: colors.muted,
    fontSize: fontSize.sm,
  },
  memberCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    ...shadows.sm,
  },
  memberCardDuplicate: {
    borderColor: colors.criticalBorder,
  },
  cardTopRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  checkboxTouch: {
    paddingTop: 2,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 4,
    borderWidth: 1.5,
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  checkboxChecked: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  memberInfo: {
    flex: 1,
    gap: 3,
  },
  nameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  memberName: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  statusBadge: {
    borderRadius: radius.full,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  statusBadgeText: {
    fontSize: 9,
    fontWeight: fontWeight.bold,
  },
  memberMeta: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
  },
  detailsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: 2,
  },
  detailLabel: {
    color: colors.muted,
    fontSize: 11,
  },
  detailValue: {
    color: colors.text,
    fontWeight: fontWeight.medium,
  },
  warningList: {
    gap: 2,
    marginTop: 4,
  },
  warningItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  warningText: {
    color: colors.warningDark,
    fontSize: 10,
  },
  cardActionIcons: {
    gap: spacing.xs,
  },
  iconBtn: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  bottomSection: {
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  footerNote: {
    color: colors.muted,
    fontSize: fontSize.xs,
    lineHeight: 16,
    textAlign: 'center',
  },
  modalOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalContainer: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    maxHeight: '90%',
    width: '100%',
    ...shadows.lg,
  },
  modalHeader: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  modalTitle: {
    color: colors.text,
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
  },
  modalForm: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  inputGroup: {
    gap: 4,
  },
  label: {
    color: colors.text,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.text,
    fontSize: fontSize.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  rowInputs: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  planButtonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  planChoiceBtn: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  planChoiceBtnActive: {
    backgroundColor: colors.brandSubtle,
    borderColor: colors.brand,
  },
  planChoiceText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
  },
  planChoiceTextActive: {
    color: colors.brand,
    fontWeight: fontWeight.bold,
  },
  modalActions: {
    marginTop: spacing.md,
  },
  successCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    gap: spacing.md,
    padding: spacing.xl,
    width: '100%',
    ...shadows.lg,
  },
  successIconWrap: {
    alignItems: 'center',
    backgroundColor: colors.successSurface,
    borderRadius: radius.full,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  successTitle: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  successSub: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 20,
    textAlign: 'center',
  },
  roiBanner: {
    alignItems: 'center',
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    width: '100%',
  },
  roiBannerTitle: {
    color: colors.brand,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  roiBannerSub: {
    color: colors.text,
    fontSize: fontSize.xs,
  },
  successActions: {
    gap: spacing.sm,
    marginTop: spacing.sm,
    width: '100%',
  },
  viewMembersBtn: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  viewMembersBtnText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
});

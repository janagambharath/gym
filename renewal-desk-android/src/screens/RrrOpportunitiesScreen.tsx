import { useCallback, useState } from 'react';
import { useLiveEffect } from '../hooks/useLiveEffect';
import { Alert, Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiRequest } from '../services/apiClient';
import { dismissOpportunityRequest, filterOpportunities, opportunitiesUrl, PILLAR_LABELS, PILLAR_ORDER, PILLAR_SHORT_LABELS, updateOpportunityRequest, type PillarFilter, type RrrOpportunity, type RrrPillar } from '../services/rrrOpportunities';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';

const FILTERS: { key: PillarFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  ...PILLAR_ORDER.map((pillar) => ({ key: pillar as PillarFilter, label: PILLAR_SHORT_LABELS[pillar] })),
];

const tones: Record<RrrPillar, { color: string; surface: string }> = {
  revenue: { color: colors.success, surface: colors.successSurface },
  retain: { color: colors.warning, surface: colors.warningSurface },
  recover: { color: colors.critical, surface: colors.criticalSurface },
};

function money(value: number) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number.isFinite(value) ? value : 0);
}

export function RrrOpportunitiesScreen({ onBack, initialPillar }: { onBack: () => void; initialPillar?: RrrPillar }) {
  const [pillar, setPillar] = useState<PillarFilter>(initialPillar ?? 'all');
  const [items, setItems] = useState<RrrOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [recoveryTarget, setRecoveryTarget] = useState<RrrOpportunity | null>(null);
  const [outcomeAmount, setOutcomeAmount] = useState('');

  const load = useCallback(async (selected: PillarFilter) => {
    const result = await apiRequest<{ opportunities: RrrOpportunity[] }>(opportunitiesUrl(selected));
    if (result.ok) {
      setItems(result.data.opportunities || []);
      setLoadError(undefined);
    } else {
      setLoadError(result.error.message);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  // Same pattern as RrrGrowthScreen: the load is deferred out of the
  // effect body (react-hooks/set-state-in-effect) and re-runs while focused.
  useLiveEffect(() => {
    const timer = setTimeout(() => { void load(pillar); }, 0);
    return () => clearTimeout(timer);
  }, [pillar, load]);

  const selectPillar = (next: PillarFilter) => {
    if (next === pillar) return;
    setLoading(true);
    setPillar(next);
  };

  const visible = filterOpportunities(items, pillar);
  const counts = PILLAR_ORDER.reduce<Record<string, number>>((acc, key) => {
    acc[key] = items.filter((item) => item.pillar === key).length;
    return acc;
  }, {});

  const runUpdate = async (
    item: RrrOpportunity,
    request: { path: string; method: 'PATCH'; body: Record<string, string> },
  ) => {
    if (updatingId !== null) return;
    setUpdatingId(item.id);
    const result = await apiRequest(request.path, { method: request.method, body: request.body });
    setUpdatingId(null);
    if (result.ok) void load(pillar);
    else Alert.alert('Could not update opportunity', result.error.message);
  };

  const dismiss = (item: RrrOpportunity) => {
    Alert.alert(
      'Dismiss this opportunity?',
      `${item.member.name} · ${item.reason}\nIt will no longer appear in the open list.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Dismiss', style: 'destructive', onPress: () => void runUpdate(item, dismissOpportunityRequest(item.id)) },
      ],
    );
  };

  const saveRecovery = async () => {
    const amount = outcomeAmount.trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(amount)) {
      Alert.alert('Enter recovered amount', 'Use a non-negative amount with up to two decimal places.');
      return;
    }
    if (!recoveryTarget) return;
    const target = recoveryTarget;
    setRecoveryTarget(null);
    setOutcomeAmount('');
    // Same single PATCH the PWA sends for "Close as recovered":
    // status=closed with the owner-confirmed outcome_revenue.
    await runUpdate(target, updateOpportunityRequest(target.id, 'closed', amount));
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            tintColor={colors.brand}
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); void load(pillar); }}
          />
        }
      >
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.back}>‹ RRR Growth</Text>
        </TouchableOpacity>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>RRR OPPORTUNITIES</Text>
          <Text style={styles.title}>{pillar === 'all' ? 'All opportunities' : PILLAR_LABELS[pillar]}</Text>
          <Text style={styles.subtitle}>Every action is calculated from your stored member, payment, and attendance data.</Text>
        </View>
        <View style={styles.filters}>
          {FILTERS.map((filter) => (
            <TouchableOpacity
              key={filter.key}
              style={[styles.chip, pillar === filter.key && styles.chipActive]}
              onPress={() => selectPillar(filter.key)}
            >
              <Text style={[styles.chipText, pillar === filter.key && styles.chipTextActive]}>
                {filter.label}
                {filter.key !== 'all' ? ` (${counts[filter.key] ?? 0})` : ` (${items.length})`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {loading ? (
          <Text style={styles.copy}>Loading opportunities…</Text>
        ) : loadError ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Unable to load opportunities.</Text>
            <Text style={styles.copy}>{loadError}</Text>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => { setLoading(true); void load(pillar); }}>
              <Text style={styles.secondaryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : visible.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>No open opportunities.</Text>
            <Text style={styles.copy}>
              {pillar === 'all'
                ? 'Nothing in the queue right now — new revenue, retention and recovery signals will appear here.'
                : `No open ${PILLAR_SHORT_LABELS[pillar].toLowerCase()} opportunities right now.`}
            </Text>
          </View>
        ) : (
          visible.map((item) => {
            const tone = tones[(item.pillar as RrrPillar) in tones ? (item.pillar as RrrPillar) : 'revenue'];
            const busy = updatingId === item.id;
            return (
              <View key={item.id} style={[styles.card, { borderLeftWidth: 3, borderLeftColor: tone.color }]}>
                <View style={styles.itemTop}>
                  <View style={styles.itemCopy}>
                    <Text style={styles.rowTitle}>{item.member.name}</Text>
                    <Text style={styles.rowSub}>{item.reason}</Text>
                    <Text style={styles.rowSub}>
                      {item.priority ? `${item.priority} priority · ` : ''}{item.status}
                    </Text>
                  </View>
                  <Text style={[styles.value, { color: tone.color }]}>₹{money(Number(item.potential_revenue || 0))}</Text>
                </View>
                <View style={styles.actions}>
                  <TouchableOpacity disabled={busy} style={busy ? styles.actionDisabled : undefined} onPress={() => void runUpdate(item, updateOpportunityRequest(item.id, 'actioned'))}>
                    <Text style={[styles.link, { color: tone.color }]}>{busy ? 'Saving…' : 'Mark actioned'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity disabled={busy} onPress={() => { setOutcomeAmount(''); setRecoveryTarget(item); }}>
                    <Text style={[styles.link, { color: colors.successDark }]}>Close as recovered</Text>
                  </TouchableOpacity>
                  <TouchableOpacity disabled={busy} onPress={() => dismiss(item)}>
                    <Text style={[styles.link, { color: colors.critical }]}>Dismiss</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
      <Modal visible={recoveryTarget !== null} transparent animationType="fade" onRequestClose={() => setRecoveryTarget(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.cardEyebrow}>OWNER CONFIRMATION</Text>
            <Text style={styles.cardTitle}>Record recovered revenue</Text>
            <Text style={styles.copy}>{recoveryTarget?.member.name} · Enter the amount actually collected. This is an owner-confirmed outcome.</Text>
            <TextInput
              style={styles.textInput}
              value={outcomeAmount}
              onChangeText={setOutcomeAmount}
              keyboardType="decimal-pad"
              placeholder="Amount collected (₹)"
              placeholderTextColor={colors.muted}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setRecoveryTarget(null)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveButton} onPress={() => void saveRecovery()}>
                <Text style={styles.saveText}>Save recovery</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.section },
  back: { color: colors.brand, fontWeight: fontWeight.semibold, fontSize: fontSize.md },
  hero: { gap: spacing.xs, paddingTop: spacing.xs },
  eyebrow: { color: colors.brand, fontWeight: fontWeight.bold, fontSize: fontSize.xs, letterSpacing: 1 },
  title: { color: colors.text, fontSize: fontSize['4xl'], lineHeight: 30, fontWeight: fontWeight.extrabold },
  subtitle: { color: colors.textSecondary, fontSize: fontSize.lg, lineHeight: 21 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  chipTextActive: { color: colors.textInverse },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm, ...shadows.sm },
  cardEyebrow: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: fontWeight.bold, letterSpacing: .8 },
  cardTitle: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.extrabold, marginTop: 2 },
  copy: { color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 19 },
  rowTitle: { color: colors.text, fontWeight: fontWeight.semibold, fontSize: fontSize.sm },
  rowSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 },
  itemTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  itemCopy: { flex: 1 },
  value: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, borderTopWidth: 1, borderColor: colors.borderLight, paddingTop: spacing.sm },
  actionDisabled: { opacity: 0.5 },
  link: { color: colors.brand, fontWeight: fontWeight.bold, fontSize: fontSize.sm },
  secondaryButton: { borderWidth: 1, borderColor: colors.successBorder, backgroundColor: colors.successSurface, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.xs },
  secondaryText: { color: colors.successDark, fontWeight: fontWeight.bold },
  textInput: { width: '100%', color: colors.text, backgroundColor: colors.gray50, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 11, fontSize: fontSize.base },
  modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.lg },
  modal: { backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.md },
  modalActions: { flexDirection: 'row', gap: spacing.sm },
  cancelButton: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  cancelText: { color: colors.textSecondary, fontWeight: fontWeight.bold },
  saveButton: { flex: 1, backgroundColor: colors.successDark, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  saveText: { color: colors.textInverse, fontWeight: fontWeight.bold },
});

// Dismiss uses the same PATCH the PWA's rrr-list.js sends —
// see dismissOpportunityRequest in ../services/rrrOpportunities.
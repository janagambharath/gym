import { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../components/AppHeader';
import { BotAccessState, isBotEntitlementError, isBotSetupError } from '../components/BotAccessState';
import { BotMessageBubble } from '../components/BotMessageBubble';
import { FilterChips } from '../components/FilterChips';
import { FormField } from '../components/FormField';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { PrimaryButton } from '../components/PrimaryButton';
import { SectionHeader } from '../components/SectionHeader';
import { StatusBadge } from '../components/StatusBadge';
import type { ApiError } from '../services/apiClient';
import { apiRequest } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type { BotLead, BotLeadDetailResponse, BotLeadUpdate } from '../types';

type BotLeadDetailScreenProps = {
  leadId: number;
  onBack: () => void;
  onLeadUpdated?: (lead: BotLead) => void;
  onLogout?: () => void;
};

type Notice = {
  kind: 'success' | 'error';
  text: string;
};

const LEAD_STATUS_OPTIONS = [
  { key: 'new', label: 'New', dotColor: colors.info },
  { key: 'contacted', label: 'Contacted', dotColor: colors.statusPending },
  { key: 'interested', label: 'Interested', dotColor: colors.warning },
  { key: 'trial_requested', label: 'Trial', dotColor: colors.warning },
  { key: 'booked', label: 'Booked', dotColor: colors.info },
  { key: 'converted', label: 'Converted', dotColor: colors.success },
  { key: 'lost', label: 'Lost', dotColor: colors.critical },
  { key: 'closed', label: 'Closed', dotColor: colors.muted },
];

function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return 'Unavailable';
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return 'Unavailable';
  return parsed.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function BotLeadDetailScreen({ leadId, onBack, onLeadUpdated, onLogout }: BotLeadDetailScreenProps) {
  const [lead, setLead] = useState<BotLead>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ApiError>();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('new');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const [messages, setMessages] = useState<BotLeadDetailResponse['messages']>([]);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    const result = await apiRequest<BotLeadDetailResponse>(`/api/mobile/v1/bot/leads/${leadId}`);
    if (result.ok) {
      const nextLead = result.data.lead;
      setLead(nextLead);
      setName(nextLead.name ?? '');
      setNotes(nextLead.notes ?? '');
      setStatus(nextLead.status);
      setMessages(result.data.messages);
      setError(undefined);
    } else if (result.error.status === 401 && onLogout) {
      onLogout();
    } else {
      setError(result.error);
    }

    setLoading(false);
    setRefreshing(false);
  }, [leadId, onLogout]);

  useEffect(() => {
    const initialLoad = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(initialLoad);
  }, [load]);

  const handleSave = useCallback(async () => {
    if (!lead) return;
    setSaving(true);
    setNotice(undefined);

    const update: BotLeadUpdate = {
      name: name.trim() || null,
      notes: notes.trim() || null,
      status,
    };
    const result = await apiRequest<{ message: string; lead: Pick<BotLead, 'id' | 'status' | 'notes'> }>(
      `/api/mobile/v1/bot/leads/${lead.id}`,
      { method: 'PATCH', body: update },
    );

    if (result.ok) {
      const updatedLead: BotLead = {
        ...lead,
        name: update.name,
        notes: result.data.lead.notes,
        status: result.data.lead.status,
      };
      setLead(updatedLead);
      onLeadUpdated?.(updatedLead);
      setNotice({ kind: 'success', text: result.data.message || 'Lead updated.' });
    } else if (result.error.status === 401 && onLogout) {
      onLogout();
    } else {
      setNotice({
        kind: 'error',
        text: isBotEntitlementError(result.error)
          ? 'WhatsApp Bot is not enabled for this gym.'
          : isBotSetupError(result.error)
            ? 'WhatsApp setup is incomplete.'
            : result.error.message,
      });
    }
    setSaving(false);
  }, [lead, name, notes, onLeadUpdated, onLogout, status]);

  if (loading && !lead) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <AppHeader title="Lead Details" onBack={onBack} />
        <View style={styles.loadingWrap}><LoadingSkeleton height={18} lines={8} /></View>
      </SafeAreaView>
    );
  }

  if (error || !lead) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <AppHeader title="Lead Details" onBack={onBack} />
        <BotAccessState error={error ?? { message: 'Lead data is unavailable.' }} onRetry={() => void load()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Lead Details" onBack={onBack} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={(
            <RefreshControl
              colors={[colors.brand]}
              onRefresh={() => void load(true)}
              refreshing={refreshing}
            />
          )}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.identityCard}>
            <View style={styles.avatar}>
              <Icon name="lead" size={25} color={colors.success} />
            </View>
            <View style={styles.identityBody}>
              <Text style={styles.leadName}>{lead.name?.trim() || lead.phone}</Text>
              <Text style={styles.phone}>{lead.phone}</Text>
              <Text style={styles.createdAt}>Captured {formatTimestamp(lead.created_at)}</Text>
            </View>
            <StatusBadge status={lead.status} />
          </View>

          {notice ? (
            <View style={[styles.notice, notice.kind === 'success' ? styles.successNotice : styles.errorNotice]}>
              <Icon
                name={notice.kind === 'success' ? 'checkmark' : 'warning'}
                size={18}
                color={notice.kind === 'success' ? colors.successDark : colors.critical}
              />
              <Text style={[styles.noticeText, { color: notice.kind === 'success' ? colors.successDark : colors.critical }]}>
                {notice.text}
              </Text>
            </View>
          ) : null}

          <View style={styles.summaryCard}>
            <SectionHeader title="Enquiry" icon={<Icon name="target" size={18} color={colors.brand} />} />
            <View style={styles.summaryList}>
              <SummaryRow label="Source" value={lead.source || 'Not recorded'} />
              <SummaryRow label="Intent" value={lead.intent?.replace(/_/g, ' ') || 'Not recorded'} />
              <SummaryRow label="Plan interest" value={lead.interested_plan || 'Not recorded'} />
              <SummaryRow label="Trial" value={lead.trial_requested ? 'Requested' : 'Not requested'} />
              {lead.conversation_id ? <SummaryRow label="Conversation" value={`#${lead.conversation_id}`} /> : null}
            </View>
          </View>

          <View style={styles.editCard}>
            <SectionHeader title="Follow up" icon={<Icon name="edit" size={18} color={colors.brand} />} />
            <View style={styles.formContent}>
              <FormField
                label="Lead name"
                onChangeText={setName}
                placeholder="Name not captured"
                value={name}
              />
              <View>
                <Text style={styles.fieldLabel}>Lead status</Text>
                <FilterChips onSelect={setStatus} options={LEAD_STATUS_OPTIONS} selected={status} />
              </View>
              <FormField
                label="Internal notes"
                multiline
                numberOfLines={4}
                onChangeText={setNotes}
                placeholder="Add follow-up notes for your team"
                value={notes}
              />
              <PrimaryButton
                icon={<Icon name="checkmark" size={18} color={colors.textInverse} />}
                loading={saving}
                onPress={() => void handleSave()}
                title="Save lead"
              />
            </View>
          </View>

          <View style={styles.messagesCard}>
            <SectionHeader title="Conversation history" icon={<Icon name="chatbubble" size={18} color={colors.brand} />} />
            {messages.length > 0 ? (
              <View style={styles.messages}>
                {messages.map((message) => <BotMessageBubble key={message.id} message={message} />)}
              </View>
            ) : (
              <View style={styles.emptyHistory}>
                <Icon name="chatbubble" size={24} color={colors.muted} />
                <Text style={styles.emptyHistoryText}>No messages recorded for this lead yet.</Text>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text numberOfLines={2} style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.successSurface,
    borderRadius: radius.full,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.section,
  },
  createdAt: {
    color: colors.muted,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
  editCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  emptyHistory: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  emptyHistoryText: {
    color: colors.muted,
    fontSize: fontSize.sm,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  errorNotice: {
    backgroundColor: colors.criticalSurface,
    borderColor: colors.criticalBorder,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
    marginBottom: spacing.xs,
  },
  flex: {
    flex: 1,
  },
  formContent: {
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  identityBody: {
    flex: 1,
    marginHorizontal: spacing.md,
  },
  identityCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    padding: spacing.lg,
    ...shadows.sm,
  },
  leadName: {
    color: colors.text,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
  },
  loadingWrap: {
    padding: spacing.lg,
  },
  messages: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  messagesCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
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
  phone: {
    color: colors.textSecondary,
    fontSize: fontSize.base,
    marginTop: spacing.xxs,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  successNotice: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  summaryCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  summaryLabel: {
    color: colors.muted,
    fontSize: fontSize.base,
  },
  summaryList: {
    marginTop: spacing.md,
  },
  summaryRow: {
    alignItems: 'flex-start',
    borderTopColor: colors.borderLight,
    borderTopWidth: 1,
    flexDirection: 'row',
    minHeight: 32,
    paddingVertical: spacing.xs,
  },
  summaryValue: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    marginLeft: spacing.lg,
    textAlign: 'right',
    textTransform: 'capitalize',
  },
});

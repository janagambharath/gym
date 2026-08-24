import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Modal,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { Avatar } from '../components/Avatar';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { FilterChips } from '../components/FilterChips';
import { CardSkeleton } from '../components/LoadingSkeleton';
import { StatusBadge } from '../components/StatusBadge';
import { apiRequest } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';

type ReminderLog = {
  id: number;
  member_id: number;
  member_name: string | null;
  status: string;
  error_message: string | null;
  created_at: string | null;
  template_name: string | null;
};

type BotLead = {
  id: number;
  name: string | null;
  phone: string;
  source: string;
  intent: string | null;
  status: string;
  interested_plan: string | null;
  trial_requested: boolean;
  notes: string | null;
  created_at: string | null;
  conversation_id: number | null;
};

type BotMessage = {
  id: number;
  sender: string;
  body: string;
  created_at: string | null;
};

type WhatsAppScreenProps = {
  onBack: () => void;
  onNavigateMemberDetail?: (memberId: number) => void;
};

const REMINDER_FILTERS = [
  { key: '', label: 'All' },
  { key: 'sent', label: 'Sent' },
  { key: 'failed', label: 'Failed' },
  { key: 'pending', label: 'Pending' },
];

const LEAD_FILTERS = [
  { key: '', label: 'All Leads' },
  { key: 'new', label: 'New' },
  { key: 'trial_requested', label: 'Trial Requested' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'converted', label: 'Converted' },
];

export function WhatsAppScreen({ onBack, onNavigateMemberDetail }: WhatsAppScreenProps) {
  const [activeTab, setActiveTab] = useState<'reminders' | 'leads'>('reminders');

  // Reminders state
  const [reminders, setReminders] = useState<ReminderLog[]>([]);
  const [remindersLoading, setRemindersLoading] = useState(true);
  const [remindersRefreshing, setRemindersRefreshing] = useState(false);
  const [remindersError, setRemindersError] = useState<string | undefined>();
  const [reminderFilter, setReminderFilter] = useState('');
  const [sentToday, setSentToday] = useState(0);
  const [failedToday, setFailedToday] = useState(0);

  // Leads state
  const [leads, setLeads] = useState<BotLead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [leadsRefreshing, setLeadsRefreshing] = useState(false);
  const [leadsError, setLeadsError] = useState<string | undefined>();
  const [leadFilter, setLeadFilter] = useState('');

  // Selected Lead modal state
  const [selectedLead, setSelectedLead] = useState<BotLead | null>(null);
  const [leadMessages, setLeadMessages] = useState<BotMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  const [whatsappEnabled, setWhatsappEnabled] = useState(false);

  // Fetch WhatsApp connection status
  useEffect(() => {
    void apiRequest<{ gym: { whatsapp_enabled: boolean } }>('/api/mobile/v1/settings').then((res) => {
      if (res.ok) setWhatsappEnabled(res.data.gym.whatsapp_enabled);
    });
  }, []);

  // Fetch reminders
  const fetchReminders = useCallback((p: number, filter: string) => {
    const qs = new URLSearchParams({ page: String(p), page_size: '20' });
    if (filter) qs.set('status', filter);

    return apiRequest<{ reminders: ReminderLog[]; pagination: { page: number; total_pages: number; total: number } }>(
      `/api/mobile/v1/whatsapp/reminders?${qs.toString()}`
    ).then((res) => {

      if (res.ok) {
        setReminders(res.data.reminders);
        setRemindersError(undefined);

        if (p === 1) {
          const today = new Date().toISOString().slice(0, 10);
          let sent = 0;
          let failed = 0;
          for (const r of res.data.reminders) {
            if (r.created_at?.startsWith(today)) {
              if (r.status === 'sent') sent++;
              else if (r.status === 'failed') failed++;
            }
          }
          setSentToday(sent);
          setFailedToday(failed);
        }
      } else {
        setRemindersError(res.error.message);
      }

      setRemindersLoading(false);
      setRemindersRefreshing(false);
    });
  }, []);

  // Fetch leads
  const fetchLeads = useCallback((filter: string) => {
    const qs = new URLSearchParams({ page_size: '50' });
    if (filter) qs.set('status', filter);

    return apiRequest<{ leads: BotLead[] }>(`/api/mobile/v1/bot/leads?${qs.toString()}`).then((res) => {
      if (res.ok) {
        setLeads(res.data.leads);
        setLeadsError(undefined);
      } else {
        setLeadsError(res.error.message);
      }
      setLeadsLoading(false);
      setLeadsRefreshing(false);
    });
  }, []);

  useEffect(() => {
    if (activeTab === 'reminders') {
      void fetchReminders(1, reminderFilter);
    } else {
      void fetchLeads(leadFilter);
    }
  }, [activeTab, reminderFilter, leadFilter, fetchReminders, fetchLeads]);

  const handleTabChange = useCallback((tab: 'reminders' | 'leads') => {
    if (tab === activeTab) return;
    if (tab === 'reminders') setRemindersLoading(true);
    else setLeadsLoading(true);
    setActiveTab(tab);
  }, [activeTab]);

  const handleReminderFilterChange = useCallback((filter: string) => {
    if (filter === reminderFilter) return;
    setRemindersLoading(true);
    setReminderFilter(filter);
  }, [reminderFilter]);

  const handleLeadFilterChange = useCallback((filter: string) => {
    if (filter === leadFilter) return;
    setLeadsLoading(true);
    setLeadFilter(filter);
  }, [leadFilter]);

  const refreshReminders = useCallback(() => {
    setRemindersRefreshing(true);
    void fetchReminders(1, reminderFilter);
  }, [fetchReminders, reminderFilter]);

  const refreshLeads = useCallback(() => {
    setLeadsRefreshing(true);
    void fetchLeads(leadFilter);
  }, [fetchLeads, leadFilter]);

  const openLeadDetail = async (lead: BotLead) => {
    setSelectedLead(lead);
    setChatLoading(true);
    const res = await apiRequest<{ lead: BotLead; messages: BotMessage[] }>(`/api/mobile/v1/bot/leads/${lead.id}`);
    if (res.ok) {
      setSelectedLead(res.data.lead);
      setLeadMessages(res.data.messages);
    }
    setChatLoading(false);
  };

  const handleSendReply = async () => {
    if (!selectedLead || !selectedLead.conversation_id || !replyText.trim()) return;
    setSendingReply(true);
    const res = await apiRequest<{ message: BotMessage }>(
      `/api/mobile/v1/bot/conversations/${selectedLead.conversation_id}/message`,
      { method: 'POST', body: { body: replyText.trim() } }
    );
    if (res.ok) {
      setLeadMessages((prev) => [...prev, res.data.message]);
      setReplyText('');
    }
    setSendingReply(false);
  };

  const handleStatusUpdate = async (newStatus: string) => {
    if (!selectedLead) return;
    const res = await apiRequest(`/api/mobile/v1/bot/leads/${selectedLead.id}`, {
      method: 'PATCH',
      body: { status: newStatus },
    });
    if (res.ok) {
      setSelectedLead((prev) => (prev ? { ...prev, status: newStatus } : null));
      setLeadsRefreshing(true);
      void fetchLeads(leadFilter);
    }
  };

  const formatTime = (isoDate: string | null) => {
    if (!isoDate) return '—';
    try {
      const d = new Date(isoDate);
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      if (isToday) {
        return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      }
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch {
      return '—';
    }
  };

  const renderReminder = ({ item }: { item: ReminderLog }) => (
    <TouchableOpacity
      style={styles.cardRow}
      onPress={() => item.member_id && onNavigateMemberDetail?.(item.member_id)}
    >
      <Avatar name={item.member_name ?? 'M'} size={40} />
      <View style={styles.cardInfo}>
        <Text style={styles.cardName} numberOfLines={1}>
          {item.member_name ?? `Member #${item.member_id}`}
        </Text>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {item.template_name ?? 'Reminder'} · {formatTime(item.created_at)}
        </Text>
        {item.error_message ? (
          <Text style={styles.errorText} numberOfLines={1}>{item.error_message}</Text>
        ) : null}
      </View>
      <StatusBadge status={item.status} />
    </TouchableOpacity>
  );

  const renderLead = ({ item }: { item: BotLead }) => (
    <TouchableOpacity style={styles.cardRow} onPress={() => void openLeadDetail(item)}>
      <Avatar name={item.name ?? item.phone} size={40} />
      <View style={styles.cardInfo}>
        <View style={styles.leadHeader}>
          <Text style={styles.cardName} numberOfLines={1}>{item.name || `+${item.phone}`}</Text>
          {item.trial_requested ? (
            <View style={styles.trialBadge}>
              <Text style={styles.trialBadgeText}>Trial</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {item.phone} · {formatTime(item.created_at)}
        </Text>
        {item.notes ? (
          <Text style={styles.notesText} numberOfLines={1}>{item.notes}</Text>
        ) : null}
      </View>
      <StatusBadge status={item.status} />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="WhatsApp & Bot" onBack={onBack} />

      <View style={styles.container}>
        {/* Connection Status */}
        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <Icon name="whatsapp" size={24} color={whatsappEnabled ? colors.whatsapp : colors.muted} />
            <View style={styles.statusInfo}>
              <Text style={styles.statusTitle}>WhatsApp Business AI</Text>
              <Text style={[styles.statusState, whatsappEnabled ? { color: colors.success } : undefined]}>
                {whatsappEnabled ? 'AI Receptionist Active' : 'Not Connected'}
              </Text>
            </View>
            <View style={[styles.statusDot, whatsappEnabled ? styles.dotConnected : styles.dotDisconnected]} />
          </View>
        </View>

        {/* Tab Toggle */}
        <View style={styles.tabToggle}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'reminders' && styles.tabButtonActive]}
            onPress={() => handleTabChange('reminders')}
          >
            <Text style={[styles.tabText, activeTab === 'reminders' && styles.tabTextActive]}>
              Reminders
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'leads' && styles.tabButtonActive]}
            onPress={() => handleTabChange('leads')}
          >
            <Text style={[styles.tabText, activeTab === 'leads' && styles.tabTextActive]}>
              AI Leads & Inquiries
            </Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'reminders' ? (
          <>
            {/* Quick Stats */}
            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Icon name="send" size={18} color={colors.success} />
                <Text style={styles.statValue}>{sentToday}</Text>
                <Text style={styles.statLabel}>Sent Today</Text>
              </View>
              <View style={styles.statBox}>
                <Icon name="warning" size={18} color={colors.critical} />
                <Text style={styles.statValue}>{failedToday}</Text>
                <Text style={styles.statLabel}>Failed Today</Text>
              </View>
            </View>

            <FilterChips
              options={REMINDER_FILTERS}
              selected={reminderFilter}
              onSelect={handleReminderFilterChange}
            />

            {remindersLoading && !remindersRefreshing ? (
              <View style={styles.loadingWrap}>
                <CardSkeleton />
                <CardSkeleton />
              </View>
            ) : remindersError ? (
              <ErrorState message={remindersError} onRetry={refreshReminders} />
            ) : reminders.length === 0 ? (
              <EmptyState
                icon={<Icon name="whatsapp" size={40} color={colors.muted} />}
                title="No reminders yet"
                subtitle="WhatsApp reminders will appear here."
              />
            ) : (
              <FlatList
                data={reminders}
                keyExtractor={(item) => String(item.id)}
                renderItem={renderReminder}
                contentContainerStyle={styles.listContent}
                refreshControl={<RefreshControl onRefresh={refreshReminders} refreshing={remindersRefreshing} colors={[colors.brand]} />}
                showsVerticalScrollIndicator={false}
              />
            )}
          </>
        ) : (
          <>
            <FilterChips
              options={LEAD_FILTERS}
              selected={leadFilter}
              onSelect={handleLeadFilterChange}
            />

            {leadsLoading && !leadsRefreshing ? (
              <View style={styles.loadingWrap}>
                <CardSkeleton />
                <CardSkeleton />
              </View>
            ) : leadsError ? (
              <ErrorState message={leadsError} onRetry={refreshLeads} />
            ) : leads.length === 0 ? (
              <EmptyState
                icon={<Icon name="members" size={40} color={colors.muted} />}
                title="No leads captured yet"
                subtitle="Prospective customers messaging your WhatsApp will appear here automatically."
              />
            ) : (
              <FlatList
                data={leads}
                keyExtractor={(item) => String(item.id)}
                renderItem={renderLead}
                contentContainerStyle={styles.listContent}
                refreshControl={<RefreshControl onRefresh={refreshLeads} refreshing={leadsRefreshing} colors={[colors.brand]} />}
                showsVerticalScrollIndicator={false}
              />
            )}
          </>
        )}
      </View>

      {/* Lead Conversation Modal */}
      <Modal visible={selectedLead !== null} animationType="slide" onRequestClose={() => setSelectedLead(null)}>
        <SafeAreaView style={styles.modalSafe}>
          <AppHeader title={selectedLead?.name || selectedLead?.phone || 'Lead Conversation'} onBack={() => setSelectedLead(null)} />
          
          <View style={styles.modalContent}>
            {/* Lead info banner */}
            <View style={styles.leadBanner}>
              <View style={styles.leadBannerTop}>
                <Avatar name={selectedLead?.name ?? 'L'} size={44} />
                <View style={styles.leadBannerInfo}>
                  <Text style={styles.leadBannerTitle}>{selectedLead?.name || 'Prospect'}</Text>
                  <Text style={styles.leadBannerPhone}>{selectedLead?.phone}</Text>
                </View>
                <StatusBadge status={selectedLead?.status ?? 'new'} />
              </View>
              
              {/* Status change actions */}
              <View style={styles.statusActionRow}>
                <TouchableOpacity style={styles.statusBtn} onPress={() => void handleStatusUpdate('contacted')}>
                  <Text style={styles.statusBtnText}>Mark Contacted</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.statusBtn, styles.statusBtnSuccess]} onPress={() => void handleStatusUpdate('converted')}>
                  <Text style={[styles.statusBtnText, styles.statusBtnTextSuccess]}>Mark Converted</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Conversation Messages */}
            <ScrollView style={styles.messagesList} contentContainerStyle={styles.messagesContent}>
              {chatLoading ? (
                <CardSkeleton />
              ) : leadMessages.length === 0 ? (
                <Text style={styles.emptyMessages}>No messages recorded yet.</Text>
              ) : (
                leadMessages.map((msg) => (
                  <View
                    key={msg.id}
                    style={[
                      styles.messageBubble,
                      msg.sender === 'customer' ? styles.bubbleCustomer : styles.bubbleStaff,
                    ]}
                  >
                    <Text style={styles.msgSender}>
                      {msg.sender === 'customer' ? 'Prospect' : msg.sender === 'bot' ? '🤖 AI Bot' : 'Staff'}
                    </Text>
                    <Text style={styles.msgBody}>{msg.body}</Text>
                    <Text style={styles.msgTime}>{formatTime(msg.created_at)}</Text>
                  </View>
                ))
              )}
            </ScrollView>

            {/* Chat Input */}
            <View style={styles.chatInputRow}>
              <TextInput
                style={styles.chatInput}
                placeholder="Type WhatsApp message..."
                placeholderTextColor={colors.muted}
                value={replyText}
                onChangeText={setReplyText}
              />
              <TouchableOpacity
                style={[styles.sendBtn, (!replyText.trim() || sendingReply) && styles.sendBtnDisabled]}
                disabled={!replyText.trim() || sendingReply}
                onPress={() => void handleSendReply()}
              >
                <Icon name="send" size={18} color={colors.textInverse} />
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bubbleCustomer: {
    alignSelf: 'flex-start',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
  },
  bubbleStaff: {
    alignSelf: 'flex-end',
    backgroundColor: '#DCF8C6',
  },
  cardInfo: { flex: 1, marginLeft: spacing.md },
  cardMeta: { color: colors.muted, fontSize: fontSize.sm, marginTop: 1 },
  cardName: { color: colors.text, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  cardRow: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    padding: spacing.md,
    ...shadows.sm,
  },
  chatInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    fontSize: fontSize.base,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  chatInputRow: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  container: { flex: 1, gap: spacing.md, padding: spacing.lg },
  dotConnected: { backgroundColor: colors.whatsapp },
  dotDisconnected: { backgroundColor: colors.muted },
  emptyMessages: { color: colors.muted, fontSize: fontSize.base, marginTop: spacing.xxl, textAlign: 'center' },
  errorText: { color: colors.critical, fontSize: fontSize.xs, marginTop: 2 },
  leadBanner: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    margin: spacing.md,
    padding: spacing.lg,
  },
  leadBannerInfo: { flex: 1, marginLeft: spacing.md },
  leadBannerPhone: { color: colors.muted, fontSize: fontSize.sm },
  leadBannerTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  leadBannerTop: { alignItems: 'center', flexDirection: 'row' },
  leadHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  listContent: { gap: spacing.xs, paddingBottom: spacing.section },
  loadingWrap: { gap: spacing.md },
  messageBubble: {
    borderRadius: radius.lg,
    maxWidth: '80%',
    padding: spacing.md,
  },
  messagesContent: { gap: spacing.sm, padding: spacing.md },
  messagesList: { flex: 1 },
  modalContent: { flex: 1 },
  modalSafe: { backgroundColor: colors.background, flex: 1 },
  msgBody: { color: colors.text, fontSize: fontSize.base },
  msgSender: { color: colors.muted, fontSize: fontSize.xs, fontWeight: fontWeight.bold, marginBottom: 2 },
  msgTime: { color: colors.muted, fontSize: fontSize.xs, marginTop: 4, textAlign: 'right' },
  notesText: { color: colors.brand, fontSize: fontSize.xs, marginTop: 2 },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  sendBtn: {
    alignItems: 'center',
    backgroundColor: colors.whatsapp,
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  sendBtnDisabled: { opacity: 0.4 },
  statBox: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flex: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  statLabel: { color: colors.muted, fontSize: fontSize.sm },
  statValue: { color: colors.text, fontSize: fontSize['2xl'], fontVariant: ['tabular-nums'], fontWeight: fontWeight.bold },
  statsRow: { flexDirection: 'row', gap: spacing.md },
  statusActionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  statusBtn: {
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  statusBtnSuccess: { backgroundColor: colors.statusActiveSurface },
  statusBtnText: { color: colors.brand, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  statusBtnTextSuccess: { color: colors.statusActive },
  statusCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  statusDot: { borderRadius: 6, height: 12, width: 12 },
  statusInfo: { flex: 1, marginLeft: spacing.md },
  statusRow: { alignItems: 'center', flexDirection: 'row' },
  statusState: { color: colors.muted, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  statusTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  tabButton: { alignItems: 'center', borderRadius: radius.md, flex: 1, paddingVertical: spacing.sm },
  tabButtonActive: { backgroundColor: colors.brand },
  tabText: { color: colors.textSecondary, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  tabTextActive: { color: colors.textInverse },
  tabToggle: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    padding: spacing.xs,
  },
  trialBadge: {
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.full,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
  },
  trialBadgeText: { color: colors.brand, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
});

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
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

const PRESETS = [
  {
    label: '🪔 Festival Wishes',
    text: 'Wishing you and your family a very Happy Festival! Stay strong, consistent, and healthy! 🎉',
  },
  {
    label: '🏖️ Holiday Notice',
    text: 'Please note that the gym will remain closed tomorrow for a public holiday. Regular batch timings resume the next day. 🏖️',
  },
  {
    label: '💥 Renewal Discount',
    text: 'Special Offer: Renew your membership this week and get an extra 1 month free + customized workout plan! 💥',
  },
  {
    label: '🕒 Timings Update',
    text: 'Notice: Morning batch timings are updated to 5:30 AM – 10:30 AM starting this Monday. 🕒',
  },
];

export function WhatsAppScreen({ onBack, onNavigateMemberDetail }: WhatsAppScreenProps) {
  const [activeTab, setActiveTab] = useState<'reminders' | 'broadcast' | 'leads'>('reminders');

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

  // Broadcast state
  const [broadcastAudience, setBroadcastAudience] = useState<'active' | 'expired' | 'all'>('active');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastCounts, setBroadcastCounts] = useState({ active: 0, expired: 0, all: 0 });
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [broadcastSuccess, setBroadcastSuccess] = useState<string | null>(null);

  const [whatsappEnabled, setWhatsappEnabled] = useState(false);

  // Fetch WhatsApp connection status & broadcast stats
  useEffect(() => {
    void apiRequest<{ gym: { whatsapp_enabled: boolean } }>('/api/mobile/v1/settings').then((res) => {
      if (res.ok) setWhatsappEnabled(res.data.gym.whatsapp_enabled);
    });

    void apiRequest<{ counts: { active: number; expired: number; all: number } }>(
      '/api/mobile/v1/whatsapp/broadcast/stats'
    ).then((res) => {
      if (res.ok && res.data.counts) {
        setBroadcastCounts(res.data.counts);
      }
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
    } else if (activeTab === 'leads') {
      void fetchLeads(leadFilter);
    }
  }, [activeTab, reminderFilter, leadFilter, fetchReminders, fetchLeads]);

  const handleTabChange = useCallback((tab: 'reminders' | 'broadcast' | 'leads') => {
    if (tab === activeTab) return;
    if (tab === 'reminders') setRemindersLoading(true);
    else if (tab === 'leads') setLeadsLoading(true);
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
    if (!lead.conversation_id) {
      setLeadMessages([]);
      return;
    }
    setChatLoading(true);
    const res = await apiRequest<{ conversation: { messages: BotMessage[] } }>(
      `/api/mobile/v1/bot/conversations/${lead.conversation_id}`
    );
    if (res.ok) {
      setLeadMessages(res.data.conversation.messages);
    }
    setChatLoading(false);
  };

  const sendReply = async () => {
    if (!selectedLead?.conversation_id || !replyText.trim()) return;
    setSendingReply(true);
    const res = await apiRequest<{ message: BotMessage }>(
      `/api/mobile/v1/bot/conversations/${selectedLead.conversation_id}/reply`,
      {
        method: 'POST',
        body: { message: replyText.trim() },
      }
    );
    if (res.ok) {
      setLeadMessages((prev) => [...prev, res.data.message]);
      setReplyText('');
    }
    setSendingReply(false);
  };

  const handleSendBroadcast = () => {
    if (!broadcastMessage.trim()) {
      Alert.alert('Message Required', 'Please enter an announcement message to broadcast.');
      return;
    }

    const count = broadcastCounts[broadcastAudience];
    Alert.alert(
      'Confirm Broadcast',
      `Send this WhatsApp announcement to ${count} ${broadcastAudience} members?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send Broadcast',
          onPress: async () => {
            setSendingBroadcast(true);
            setBroadcastSuccess(null);
            const res = await apiRequest<{ sent: number; total: number; message: string }>(
              '/api/mobile/v1/whatsapp/broadcast',
              {
                method: 'POST',
                body: {
                  message: broadcastMessage.trim(),
                  audience: broadcastAudience,
                },
              }
            );

            setSendingBroadcast(false);
            if (res.ok) {
              setBroadcastSuccess(res.data.message || `Delivered to ${res.data.sent} of ${res.data.total} members!`);
              setBroadcastMessage('');
            } else {
              Alert.alert('Broadcast Error', res.error.message || 'Failed to send broadcast.');
            }
          },
        },
      ]
    );
  };

  const formatTime = (iso: string | null) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    } catch {
      return '';
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
      <AppHeader title="WhatsApp & Broadcasts" onBack={onBack} />

      <View style={styles.container}>
        {/* Connection Status */}
        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <Icon name="whatsapp" size={24} color={whatsappEnabled ? colors.whatsapp : colors.muted} />
            <View style={styles.statusInfo}>
              <Text style={styles.statusTitle}>WhatsApp Business</Text>
              <Text style={[styles.statusState, whatsappEnabled ? { color: colors.success } : undefined]}>
                {whatsappEnabled ? 'Integration Active & Connected' : 'Not Connected'}
              </Text>
            </View>
            <View style={[styles.statusDot, whatsappEnabled ? styles.dotConnected : styles.dotDisconnected]} />
          </View>
        </View>

        {/* 3-Tab Toggle */}
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
            style={[styles.tabButton, activeTab === 'broadcast' && styles.tabButtonActive]}
            onPress={() => handleTabChange('broadcast')}
          >
            <Text style={[styles.tabText, activeTab === 'broadcast' && styles.tabTextActive]}>
              📢 Broadcast
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'leads' && styles.tabButtonActive]}
            onPress={() => handleTabChange('leads')}
          >
            <Text style={[styles.tabText, activeTab === 'leads' && styles.tabTextActive]}>
              AI Leads
            </Text>
          </TouchableOpacity>
        </View>

        {/* TAB 1: REMINDERS */}
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
                refreshControl={
                  <RefreshControl refreshing={remindersRefreshing} onRefresh={refreshReminders} tintColor={colors.brand} />
                }
              />
            )}
          </>
        ) : null}

        {/* TAB 2: BROADCAST ANNOUNCEMENTS */}
        {activeTab === 'broadcast' ? (
          <ScrollView contentContainerStyle={styles.broadcastContainer} showsVerticalScrollIndicator={false}>
            {broadcastSuccess ? (
              <View style={styles.successBanner}>
                <Icon name="receipt" size={20} color={colors.success} />
                <Text style={styles.successBannerText}>{broadcastSuccess}</Text>
              </View>
            ) : null}

            {/* Audience Selector */}
            <Text style={styles.sectionHeaderTitle}>1. Target Audience</Text>
            <View style={styles.audienceRow}>
              <TouchableOpacity
                style={[styles.audienceBtn, broadcastAudience === 'active' && styles.audienceBtnActive]}
                onPress={() => setBroadcastAudience('active')}
              >
                <Text style={[styles.audienceBtnText, broadcastAudience === 'active' && styles.audienceBtnTextActive]}>
                  Active ({broadcastCounts.active})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.audienceBtn, broadcastAudience === 'expired' && styles.audienceBtnActive]}
                onPress={() => setBroadcastAudience('expired')}
              >
                <Text style={[styles.audienceBtnText, broadcastAudience === 'expired' && styles.audienceBtnTextActive]}>
                  Expired ({broadcastCounts.expired})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.audienceBtn, broadcastAudience === 'all' && styles.audienceBtnActive]}
                onPress={() => setBroadcastAudience('all')}
              >
                <Text style={[styles.audienceBtnText, broadcastAudience === 'all' && styles.audienceBtnTextActive]}>
                  All ({broadcastCounts.all})
                </Text>
              </TouchableOpacity>
            </View>

            {/* Presets */}
            <Text style={styles.sectionHeaderTitle}>2. Quick Presets</Text>
            <View style={styles.presetsWrap}>
              {PRESETS.map((p, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.presetChip}
                  onPress={() => setBroadcastMessage(p.text)}
                >
                  <Text style={styles.presetChipText}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Message Input */}
            <Text style={styles.sectionHeaderTitle}>3. Announcement Body</Text>
            <TextInput
              style={styles.broadcastInput}
              placeholder="Type your festival wishes, holiday notice, or offer..."
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={4}
              value={broadcastMessage}
              onChangeText={setBroadcastMessage}
            />
            <Text style={styles.charCountText}>{broadcastMessage.length} characters</Text>

            {/* WhatsApp Live Preview */}
            <Text style={styles.sectionHeaderTitle}>WhatsApp Preview</Text>
            <View style={styles.waMockupCard}>
              <View style={styles.waHeader}>
                <Icon name="whatsapp" size={18} color={colors.whatsapp} />
                <Text style={styles.waHeaderText}>Gym Verified Announcement</Text>
              </View>
              <View style={styles.waBubble}>
                <Text style={styles.waGreeting}>Hi Member,</Text>
                <Text style={styles.waSubheading}>Important update from our Gym:</Text>
                <Text style={styles.waBody}>
                  {broadcastMessage.trim() || 'Your announcement message will appear here in real time...'}
                </Text>
                <Text style={styles.waFooter}>Thank you,{'\n'}Gym Management</Text>
              </View>
            </View>

            {/* Send Button */}
            <TouchableOpacity
              style={[styles.broadcastSendBtn, sendingBroadcast && { opacity: 0.7 }]}
              onPress={handleSendBroadcast}
              disabled={sendingBroadcast}
            >
              {sendingBroadcast ? (
                <ActivityIndicator color={colors.textInverse} />
              ) : (
                <>
                  <Icon name="send" size={20} color={colors.textInverse} />
                  <Text style={styles.broadcastSendBtnText}>Broadcast via WhatsApp</Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        ) : null}

        {/* TAB 3: LEADS */}
        {activeTab === 'leads' ? (
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
                title="No AI leads yet"
                subtitle="New prospect inquiries from WhatsApp will appear here."
              />
            ) : (
              <FlatList
                data={leads}
                keyExtractor={(item) => String(item.id)}
                renderItem={renderLead}
                contentContainerStyle={styles.listContent}
                refreshControl={
                  <RefreshControl refreshing={leadsRefreshing} onRefresh={refreshLeads} tintColor={colors.brand} />
                }
              />
            )}
          </>
        ) : null}
      </View>

      {/* Selected Lead Modal */}
      <Modal visible={!!selectedLead} animationType="slide" onRequestClose={() => setSelectedLead(null)}>
        <SafeAreaView style={styles.modalSafe}>
          <AppHeader title={selectedLead?.name || selectedLead?.phone || 'Lead'} onBack={() => setSelectedLead(null)} />
          <View style={styles.modalContent}>
            {chatLoading ? (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator color={colors.brand} />
              </View>
            ) : (
              <FlatList
                data={leadMessages}
                keyExtractor={(item) => String(item.id)}
                contentContainerStyle={styles.messagesContent}
                renderItem={({ item }) => (
                  <View
                    style={[
                      styles.messageBubble,
                      item.sender === 'user' ? { alignSelf: 'flex-start', backgroundColor: colors.surface } : { alignSelf: 'flex-end', backgroundColor: colors.brandSubtle },
                    ]}
                  >
                    <Text style={styles.msgBody}>{item.body}</Text>
                  </View>
                )}
              />
            )}
            <View style={styles.chatInputRow}>
              <TextInput
                style={styles.chatInput}
                placeholder="Type a reply to lead..."
                placeholderTextColor={colors.muted}
                value={replyText}
                onChangeText={setReplyText}
              />
              <TouchableOpacity style={styles.sendBtn} onPress={sendReply} disabled={sendingReply}>
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
  audienceBtn: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  audienceBtnActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  audienceBtnText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  audienceBtnTextActive: {
    color: colors.textInverse,
  },
  audienceRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  broadcastContainer: {
    paddingBottom: spacing.section,
  },
  broadcastInput: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: fontSize.base,
    padding: spacing.md,
    textAlignVertical: 'top',
  },
  broadcastSendBtn: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radius.lg,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    ...shadows.md,
  },
  broadcastSendBtnText: {
    color: colors.textInverse,
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
  },
  cardInfo: { flex: 1, gap: 2, marginLeft: spacing.md },
  cardName: { color: colors.text, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  cardMeta: { color: colors.muted, fontSize: fontSize.sm },
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
  charCountText: {
    color: colors.muted,
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    textAlign: 'right',
  },
  chatInput: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  chatInputRow: {
    borderColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  container: { flex: 1, gap: spacing.md, paddingHorizontal: spacing.lg },
  dotConnected: { backgroundColor: colors.success },
  dotDisconnected: { backgroundColor: colors.muted },
  errorText: { color: colors.critical, fontSize: fontSize.xs, marginTop: 2 },
  leadHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  listContent: { gap: spacing.xs, paddingBottom: spacing.section },
  loadingWrap: { gap: spacing.md },
  messageBubble: {
    borderRadius: radius.lg,
    maxWidth: '80%',
    padding: spacing.md,
  },
  messagesContent: { gap: spacing.sm, padding: spacing.md },
  modalContent: { flex: 1 },
  modalSafe: { backgroundColor: colors.background, flex: 1 },
  msgBody: { color: colors.text, fontSize: fontSize.base },
  notesText: { color: colors.brand, fontSize: fontSize.xs, marginTop: 2 },
  presetChip: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  presetChipText: {
    color: colors.text,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  presetsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  sectionHeaderTitle: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    marginBottom: spacing.xs,
  },
  sendBtn: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radius.full,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
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
  successBanner: {
    backgroundColor: colors.statusActiveSurface,
    borderColor: colors.statusActive,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  successBannerText: {
    color: colors.statusActive,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    flex: 1,
  },
  tabButton: { alignItems: 'center', borderRadius: radius.md, flex: 1, paddingVertical: spacing.sm },
  tabButtonActive: { backgroundColor: colors.brand },
  tabText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
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
  waBody: {
    color: '#e9edef',
    fontSize: fontSize.sm,
    marginBottom: spacing.xs,
  },
  waBubble: {
    backgroundColor: '#005c4b',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  waFooter: {
    color: '#8696a0',
    fontSize: fontSize.xs,
  },
  waGreeting: {
    color: '#e9edef',
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    marginBottom: 2,
  },
  waHeader: {
    flexDirection: 'row',
    gap: spacing.xs,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  waHeaderText: {
    color: '#8696a0',
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  waMockupCard: {
    backgroundColor: '#0b141a',
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  waSubheading: {
    color: '#8696a0',
    fontSize: fontSize.xs,
    marginBottom: spacing.xs,
  },
});

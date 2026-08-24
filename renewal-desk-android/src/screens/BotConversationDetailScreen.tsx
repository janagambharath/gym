import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../components/AppHeader';
import { BotAccessState, isBotEntitlementError, isBotSetupError } from '../components/BotAccessState';
import { BotMessageBubble } from '../components/BotMessageBubble';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { PrimaryButton } from '../components/PrimaryButton';
import { SectionHeader } from '../components/SectionHeader';
import { StatusBadge } from '../components/StatusBadge';
import type { ApiError } from '../services/apiClient';
import { apiRequest } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type {
  BotConversation,
  BotConversationDetailResponse,
  BotLeadSummary,
  BotMessage,
} from '../types';

type BotConversationDetailScreenProps = {
  conversation: BotConversation;
  onBack: () => void;
  onOpenLead?: (lead: BotLeadSummary) => void;
  onLogout?: () => void;
};

type Notice = {
  kind: 'success' | 'error';
  text: string;
};

function displayName(conversation: BotConversation): string {
  return conversation.customer_name?.trim() || conversation.phone;
}

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

/** Displays the bounded, server-authoritative transcript for one conversation. */
export function BotConversationDetailScreen({
  conversation,
  onBack,
  onOpenLead,
  onLogout,
}: BotConversationDetailScreenProps) {
  const [currentConversation, setCurrentConversation] = useState(conversation);
  const [linkedLead, setLinkedLead] = useState<BotLeadSummary>();
  const [messages, setMessages] = useState<BotMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<ApiError>();
  const [accessError, setAccessError] = useState<ApiError>();
  const [notice, setNotice] = useState<Notice>();
  const [messageBody, setMessageBody] = useState('');
  const [sending, setSending] = useState(false);
  const [updatingHandover, setUpdatingHandover] = useState(false);

  const loadConversation = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(undefined);
    setAccessError(undefined);

    const result = await apiRequest<BotConversationDetailResponse>(
      `/api/mobile/v1/bot/conversations/${conversation.id}`,
    );

    if (!result.ok) {
      if (result.error.status === 401 && onLogout) {
        onLogout();
      } else if (isBotEntitlementError(result.error)) {
        setAccessError(result.error);
      } else {
        setHistoryError(result.error);
      }
      setHistoryLoading(false);
      return;
    }

    setCurrentConversation(result.data.conversation);
    setLinkedLead(result.data.lead ?? undefined);
    setMessages(result.data.messages);
    setHistoryLoading(false);
  }, [conversation.id, onLogout]);

  useEffect(() => {
    const initialLoad = setTimeout(() => {
      void loadConversation();
    }, 0);
    return () => clearTimeout(initialLoad);
  }, [loadConversation]);

  const isClosed = currentConversation.handover_status === 'closed';
  const isStaffActive = currentConversation.handover_status === 'human_active';
  const handoverAction = isStaffActive ? 'resume_bot' : 'take_over';
  const handoverLabel = isStaffActive ? 'Resume AI receptionist' : 'Take over conversation';

  const handleActionError = useCallback((actionError: ApiError) => {
    if (actionError.status === 401 && onLogout) {
      onLogout();
      return;
    }
    if (isBotEntitlementError(actionError)) {
      setAccessError(actionError);
      return;
    }

    setNotice({
      kind: 'error',
      text: isBotSetupError(actionError)
        ? 'WhatsApp setup is incomplete. Finish setup before sending messages.'
        : actionError.message,
    });
  }, [onLogout]);

  const handleHandover = useCallback(async () => {
    if (isClosed) return;
    setUpdatingHandover(true);
    setNotice(undefined);

    const result = await apiRequest<{ handover_status: string }>(
      `/api/mobile/v1/bot/conversations/${currentConversation.id}/handover`,
      { method: 'POST', body: { action: handoverAction } },
    );

    if (result.ok) {
      setCurrentConversation((current) => ({
        ...current,
        handover_status: result.data.handover_status,
      }));
      setNotice({
        kind: 'success',
        text: handoverAction === 'take_over'
          ? 'You are now handling this conversation.'
          : 'The AI receptionist has been resumed.',
      });
    } else {
      handleActionError(result.error);
    }
    setUpdatingHandover(false);
  }, [currentConversation.id, handleActionError, handoverAction, isClosed]);

  const handleSend = useCallback(async () => {
    const body = messageBody.trim();
    if (!body || isClosed) return;

    setSending(true);
    setNotice(undefined);
    const result = await apiRequest<{ message: BotMessage }>(
      `/api/mobile/v1/bot/conversations/${currentConversation.id}/message`,
      { method: 'POST', body: { body } },
    );

    if (result.ok) {
      setMessages((current) => [...current, result.data.message]);
      setCurrentConversation((current) => ({ ...current, handover_status: 'human_active' }));
      setMessageBody('');
      setNotice({ kind: 'success', text: 'Message sent.' });
    } else {
      handleActionError(result.error);
    }
    setSending(false);
  }, [currentConversation.id, handleActionError, isClosed, messageBody]);

  const historyContent = useMemo(() => {
    if (historyLoading) {
      return <LoadingSkeleton height={16} lines={4} />;
    }
    if (historyError) {
      return (
        <View style={styles.historyNotice}>
          <Text style={styles.historyNoticeText}>{historyError.message}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => void loadConversation()}>
            <Text style={styles.historyRetry}>Retry history</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (messages.length === 0) {
      return (
        <View style={styles.emptyHistory}>
          <Icon name="chatbubble" size={24} color={colors.muted} />
          <Text style={styles.emptyHistoryTitle}>No message history available</Text>
          <Text style={styles.emptyHistoryText}>
            No messages have been recorded for this conversation yet.
          </Text>
        </View>
      );
    }
    return <View style={styles.messages}>{messages.map((message) => <BotMessageBubble key={message.id} message={message} />)}</View>;
  }, [historyError, historyLoading, loadConversation, messages]);

  if (accessError) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <AppHeader title="Conversation" onBack={onBack} />
        <BotAccessState error={accessError} onRetry={() => void loadConversation()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Conversation" onBack={onBack} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.identityCard}>
            <View style={styles.avatar}>
              <Icon name="person" size={24} color={colors.brand} />
            </View>
            <View style={styles.identityBody}>
              <Text style={styles.customerName}>{displayName(currentConversation)}</Text>
              <Text style={styles.phone}>{currentConversation.phone}</Text>
              <Text style={styles.state}>{currentConversation.state.replace(/_/g, ' ')}</Text>
            </View>
            <StatusBadge status={currentConversation.handover_status} />
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

          <View style={styles.detailsCard}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Last activity</Text>
              <Text style={styles.detailValue}>{formatTimestamp(currentConversation.last_message_at)}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Conversation state</Text>
              <Text style={styles.detailValue}>{currentConversation.state.replace(/_/g, ' ')}</Text>
            </View>
          </View>

          {!isClosed ? (
            <PrimaryButton
              icon={<Icon name={isStaffActive ? 'robot' : 'handshake'} size={18} color={colors.textInverse} />}
              loading={updatingHandover}
              onPress={() => void handleHandover()}
              title={handoverLabel}
              variant={isStaffActive ? 'secondary' : 'primary'}
            />
          ) : (
            <View style={styles.closedBanner}>
              <Icon name="lock" size={18} color={colors.muted} />
              <Text style={styles.closedText}>This conversation is closed.</Text>
            </View>
          )}

          <View style={styles.messageCard}>
            <SectionHeader
              actionLabel={linkedLead && onOpenLead ? 'View lead' : undefined}
              icon={<Icon name="chatbubble" size={18} color={colors.brand} />}
              onAction={linkedLead && onOpenLead ? () => onOpenLead(linkedLead) : undefined}
              title="Message history"
            />
            <View style={styles.historyContent}>{historyContent}</View>
          </View>

          <View style={styles.composerCard}>
            <Text style={styles.composerLabel}>Manual reply</Text>
            <TextInput
              accessibilityLabel="Manual message"
              editable={!isClosed && !sending}
              maxLength={4000}
              multiline
              onChangeText={setMessageBody}
              placeholder={isClosed ? 'Closed conversations cannot receive a reply' : 'Write a message to the customer'}
              placeholderTextColor={colors.muted}
              style={[styles.messageInput, isClosed && styles.messageInputDisabled]}
              textAlignVertical="top"
              value={messageBody}
            />
            <Text style={styles.composerHint}>
              Messages are sent through the configured WhatsApp connection.
            </Text>
            <PrimaryButton
              disabled={!messageBody.trim() || isClosed}
              icon={<Icon name="send" size={17} color={colors.textInverse} />}
              loading={sending}
              onPress={() => void handleSend()}
              size="md"
              title="Send message"
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.full,
    height: 50,
    justifyContent: 'center',
    width: 50,
  },
  closedBanner: {
    alignItems: 'center',
    backgroundColor: colors.gray100,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    padding: spacing.md,
  },
  closedText: {
    color: colors.textSecondary,
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
  },
  composerCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
    ...shadows.sm,
  },
  composerHint: {
    color: colors.muted,
    fontSize: fontSize.xs,
    lineHeight: 16,
  },
  composerLabel: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.section,
  },
  customerName: {
    color: colors.text,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
  },
  detailLabel: {
    color: colors.muted,
    fontSize: fontSize.base,
  },
  detailRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  detailValue: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: fontSize.base,
    marginLeft: spacing.lg,
    textAlign: 'right',
    textTransform: 'capitalize',
  },
  detailsCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    ...shadows.sm,
  },
  emptyHistory: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  emptyHistoryText: {
    color: colors.muted,
    fontSize: fontSize.sm,
    lineHeight: 18,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  emptyHistoryTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    marginTop: spacing.sm,
  },
  errorNotice: {
    backgroundColor: colors.criticalSurface,
    borderColor: colors.criticalBorder,
  },
  flex: {
    flex: 1,
  },
  historyContent: {
    marginTop: spacing.md,
  },
  historyNotice: {
    alignItems: 'center',
    backgroundColor: colors.warningSurface,
    borderRadius: radius.md,
    gap: spacing.sm,
    padding: spacing.md,
  },
  historyNoticeText: {
    color: colors.warningDark,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  historyRetry: {
    color: colors.brand,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
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
  messageCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  messageInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: fontSize.base,
    minHeight: 96,
    padding: spacing.md,
  },
  messageInputDisabled: {
    backgroundColor: colors.gray100,
    color: colors.muted,
  },
  messages: {
    gap: spacing.sm,
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
  state: {
    color: colors.muted,
    fontSize: fontSize.sm,
    marginTop: spacing.xxs,
    textTransform: 'capitalize',
  },
  successNotice: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
});

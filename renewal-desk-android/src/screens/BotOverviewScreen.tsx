import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BotAccessState } from '../components/BotAccessState';
import { DashboardSkeleton } from '../components/LoadingSkeleton';
import { PrimaryButton } from '../components/PrimaryButton';
import { SectionHeader } from '../components/SectionHeader';
import { AppHeader } from '../components/AppHeader';
import type { ApiError } from '../services/apiClient';
import { apiRequest } from '../services/apiClient';
import { Icon, type IconName } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type { BotConfig, BotConfigResponse, BotFAQ, BotStats } from '../types';

type BotOverviewScreenProps = {
  onBack?: () => void;
  onOpenConversations: () => void;
  onOpenLeads: () => void;
  onOpenSetup: () => void;
  onLogout?: () => void;
};

type KnowledgeItem = {
  icon: IconName;
  label: string;
  detail: string;
  ready: boolean;
};

type MetricTone = {
  color: string;
  surface: string;
};

function knowledgeItemsFor(config: BotConfig, faqs: BotFAQ[]): KnowledgeItem[] {
  const enabledFaqs = faqs.filter((faq) => faq.enabled).length;
  return [
    {
      icon: 'chatbubble',
      label: 'Welcome message',
      detail: config.greeting_message?.trim() ? 'Configured greeting' : 'Greeting not configured',
      ready: Boolean(config.greeting_message?.trim()),
    },
    {
      icon: 'time',
      label: 'Opening hours',
      detail: config.opening_hours?.trim() ? 'Configured hours' : 'Operating hours not configured',
      ready: Boolean(config.opening_hours?.trim()),
    },
    {
      icon: 'location',
      label: 'Location details',
      detail: config.map_link?.trim() ? 'Configured map link' : 'Location link not configured',
      ready: Boolean(config.map_link?.trim()),
    },
    {
      icon: 'help',
      label: 'FAQ answers',
      detail: enabledFaqs ? `${enabledFaqs} active FAQs` : 'No FAQs configured',
      ready: enabledFaqs > 0,
    },
  ];
}

export function BotOverviewScreen({
  onBack,
  onOpenConversations,
  onOpenLeads,
  onOpenSetup,
  onLogout,
}: BotOverviewScreenProps) {
  const [stats, setStats] = useState<BotStats>();
  const [config, setConfig] = useState<BotConfig>();
  const [faqs, setFaqs] = useState<BotFAQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ApiError>();

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    const [statsResult, configResult] = await Promise.all([
      apiRequest<BotStats>('/api/mobile/v1/bot/stats'),
      apiRequest<BotConfigResponse>('/api/mobile/v1/bot/config'),
    ]);

    const resultError = !statsResult.ok
      ? statsResult.error
      : !configResult.ok
        ? configResult.error
        : undefined;

    if (resultError) {
      if (resultError.status === 401) {
        onLogout?.();
        return;
      }
      setError(resultError);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (statsResult.ok) setStats(statsResult.data);
    if (configResult.ok) {
      setConfig(configResult.data.config);
      setFaqs(configResult.data.faqs);
    }
    setError(undefined);
    setLoading(false);
    setRefreshing(false);
  }, [onLogout]);

  useEffect(() => {
    const initialLoad = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(initialLoad);
  }, [load]);

  const knowledgeItems = useMemo(
    () => (config ? knowledgeItemsFor(config, faqs) : []),
    [config, faqs],
  );
  const configuredCount = useMemo(
    () => knowledgeItems.filter((item) => item.ready).length,
    [knowledgeItems],
  );

  if (loading && !stats) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <AppHeader title="WhatsApp Bot" onBack={onBack} />
        <DashboardSkeleton />
      </SafeAreaView>
    );
  }

  if (error || !stats || !config) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <AppHeader title="WhatsApp Bot" onBack={onBack} />
        <BotAccessState error={error ?? { message: 'Bot data is unavailable.' }} onRetry={() => void load()} />
      </SafeAreaView>
    );
  }

  const botReady = config.handover_enabled;
  const remainingEssentials = knowledgeItems.length - configuredCount;

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader
        title="WhatsApp AI Receptionist"
        onBack={onBack}
        rightAction={(
          <TouchableOpacity
            accessibilityLabel="Refresh WhatsApp Bot"
            accessibilityRole="button"
            onPress={() => void load(true)}
            style={styles.refreshButton}
          >
            <Icon name="retry" size={20} color={colors.brand} />
          </TouchableOpacity>
        )}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={(
          <RefreshControl
            colors={[colors.brand]}
            onRefresh={() => void load(true)}
            refreshing={refreshing}
          />
        )}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: botReady ? colors.success : colors.warning }]} />
          <Text style={[styles.statusText, { color: botReady ? colors.successDark : colors.warningDark }]}>
            {botReady ? 'AI Receptionist Active · Staff Handover Enabled' : 'Setup Needs Attention'}
          </Text>
        </View>
        <Text style={styles.introText}>
          Automate 24/7 membership inquiries, capture prospective member leads, and route urgent chats to staff.
        </Text>

        <View style={styles.metricsRow}>
          <BotMetric
            icon="chatbubble"
            label="Conversations"
            tone={{ color: colors.brand, surface: colors.brandSubtle }}
            value={stats.total_conversations}
          />
          <BotMetric
            icon="lead"
            label="Leads"
            tone={{ color: colors.success, surface: colors.successSurface }}
            value={stats.total_leads}
          />
          <BotMetric
            icon="handshake"
            label="Contacted"
            tone={{ color: colors.warning, surface: colors.warningSurface }}
            value={stats.contacted_leads}
          />
          <BotMetric
            icon="calendar"
            label="Trials"
            tone={{ color: colors.statusPending, surface: colors.statusPendingSurface }}
            value={stats.trial_requests}
          />
        </View>

        {stats.handover_requested > 0 ? (
          <TouchableOpacity
            accessibilityLabel="Open conversations waiting for staff handover"
            accessibilityRole="button"
            onPress={onOpenConversations}
            style={styles.attentionCard}
          >
            <View style={styles.attentionIcon}>
              <Icon name="alert" size={20} color={colors.warningDark} />
            </View>
            <View style={styles.attentionBody}>
              <Text style={styles.attentionTitle}>Staff attention needed</Text>
              <Text style={styles.attentionText}>
                {stats.handover_requested} conversation{stats.handover_requested === 1 ? '' : 's'} waiting for staff reply.
              </Text>
            </View>
            <Icon name="forward" size={18} color={colors.warningDark} />
          </TouchableOpacity>
        ) : null}

        <View style={styles.inboxCard}>
          <View style={styles.inboxIcon}>
            <Icon name="chatbubble" size={20} color={colors.brand} />
          </View>
          <View style={styles.inboxCopy}>
            <Text style={styles.inboxTitle}>Conversation Inbox</Text>
            <Text style={styles.inboxText}>
              {stats.total_conversations > 0
                ? `${stats.total_conversations} live WhatsApp chat${stats.total_conversations === 1 ? '' : 's'} recorded.`
                : 'Customer inquiries received on WhatsApp will appear here.'}
            </Text>
          </View>
          <TouchableOpacity
            accessibilityLabel="Open WhatsApp Bot conversations"
            accessibilityRole="button"
            onPress={onOpenConversations}
            style={styles.inboxAction}
          >
            <Text style={styles.inboxActionText}>View All</Text>
            <Icon name="forward" size={16} color={colors.brand} />
          </TouchableOpacity>
        </View>

        <View style={styles.operationGrid}>
          <OperationCard
            detail={stats.contacted_leads > 0
              ? `${stats.contacted_leads} lead${stats.contacted_leads === 1 ? '' : 's'} contacted`
              : 'Track and convert new leads'}
            icon="lead"
            label="Lead Follow-up"
            onPress={onOpenLeads}
            tone="brand"
          />
          <OperationCard
            detail={botReady ? 'Staff takeover enabled' : 'Enable in bot settings'}
            icon="handshake"
            label="Human Handover"
            onPress={onOpenSetup}
            tone={botReady ? 'success' : 'warning'}
          />
        </View>

        <View style={styles.sectionCard}>
          <SectionHeader
            actionLabel="Edit Settings"
            icon={<Icon name="brain" size={18} color={colors.brand} />}
            onAction={onOpenSetup}
            title="GET YOUR AI RECEPTIONIST READY"
          />
          <Text style={styles.sectionHint}>
            {remainingEssentials > 0
              ? `${configuredCount} / ${knowledgeItems.length} complete · ${remainingEssentials} essentials remaining`
              : '✓ All 4 essentials configured and ready'}
          </Text>
          <View style={styles.knowledgeList}>
            {knowledgeItems.map((item, index) => (
              <KnowledgeRow
                key={item.label}
                item={item}
                isLast={index === knowledgeItems.length - 1}
                onPress={onOpenSetup}
              />
            ))}
          </View>
        </View>

        <View style={styles.sectionCard}>
          <SectionHeader
            actionLabel="View All"
            icon={<Icon name="lead" size={18} color={colors.brand} />}
            onAction={onOpenLeads}
            title="LEAD CAPTURE PIPELINE"
          />
          <View style={styles.captureRow}>
            <CaptureStat icon="lead" label="Total Leads" value={stats.total_leads} />
            <CaptureStat icon="messageReply" label="Contacted" value={stats.contacted_leads} />
            <CaptureStat icon="star" label="Converted" value={stats.converted_leads} />
            <CaptureStat icon="calendar" label="Free Trials" value={stats.trial_requests} />
          </View>
        </View>

        <View style={styles.bottomActions}>
          <View style={styles.bottomActionCell}>
            <PrimaryButton
              icon={<Icon name="settings" size={17} color={colors.brand} />}
              onPress={onOpenSetup}
              size="md"
              title="Customize AI Settings"
              variant="outline"
            />
          </View>
          <View style={styles.bottomActionCell}>
            <PrimaryButton
              icon={<Icon name="chatbubble" size={17} color={colors.textInverse} />}
              onPress={onOpenConversations}
              size="md"
              title="Open inbox"
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function BotMetric({
  icon,
  label,
  tone,
  value,
}: {
  icon: IconName;
  label: string;
  tone: MetricTone;
  value: number;
}) {
  return (
    <View style={styles.metricCard}>
      <View style={[styles.metricIcon, { backgroundColor: tone.surface }]}>
        <Icon name={icon} size={17} color={tone.color} />
      </View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text numberOfLines={2} style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function KnowledgeRow({
  item,
  isLast,
  onPress,
}: {
  item: KnowledgeItem;
  isLast: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      accessibilityLabel={`Manage ${item.label}`}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.knowledgeRow, !isLast && styles.knowledgeRowBorder]}
    >
      <View style={[styles.knowledgeIcon, { backgroundColor: item.ready ? colors.successSurface : colors.gray100 }]}>
        <Icon name={item.ready ? 'checkmark' : item.icon} size={18} color={item.ready ? colors.success : colors.gray500} />
      </View>
      <View style={styles.knowledgeCopy}>
        <Text style={styles.knowledgeTitle}>{item.label}</Text>
        <Text style={styles.knowledgeDetail}>{item.detail}</Text>
      </View>
      <View style={[styles.knowledgeBadge, { backgroundColor: item.ready ? colors.successSurface : colors.gray100 }]}>
        <Text style={[styles.knowledgeBadgeText, { color: item.ready ? colors.successDark : colors.textSecondary }]}>
          {item.ready ? '✓ COMPLETE' : 'NOT CONFIGURED'}
        </Text>
      </View>
      <Icon name="forward" size={15} color={colors.gray400} />
    </TouchableOpacity>
  );
}

function CaptureStat({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label: string;
  value: number;
}) {
  return (
    <View style={styles.captureStat}>
      <View style={styles.captureIcon}>
        <Icon name={icon} size={17} color={colors.brand} />
      </View>
      <Text style={styles.captureValue}>{value}</Text>
      <Text numberOfLines={1} style={styles.captureLabel}>{label}</Text>
    </View>
  );
}

function OperationCard({
  detail,
  icon,
  label,
  onPress,
  tone,
}: {
  detail: string;
  icon: IconName;
  label: string;
  onPress: () => void;
  tone: 'brand' | 'success' | 'warning';
}) {
  const toneMap = {
    brand: { color: colors.brand, surface: colors.brandSubtle },
    success: { color: colors.success, surface: colors.successSurface },
    warning: { color: colors.warning, surface: colors.warningSurface },
  } as const;
  const selectedTone = toneMap[tone];

  return (
    <TouchableOpacity accessibilityRole="button" onPress={onPress} style={styles.operationCard}>
      <View style={[styles.operationIcon, { backgroundColor: selectedTone.surface }]}>
        <Icon name={icon} size={19} color={selectedTone.color} />
      </View>
      <Text style={styles.operationTitle}>{label}</Text>
      <Text numberOfLines={2} style={styles.operationDetail}>{detail}</Text>
      <View style={[styles.operationState, { backgroundColor: selectedTone.color }]} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  attentionBody: {
    flex: 1,
  },
  attentionCard: {
    alignItems: 'center',
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  attentionIcon: {
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderRadius: radius.md,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  attentionText: {
    color: colors.warningDark,
    fontSize: fontSize.sm,
    lineHeight: 18,
    marginTop: spacing.xxs,
  },
  attentionTitle: {
    color: colors.warningDark,
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
  },
  bottomActionCell: {
    flex: 1,
  },
  bottomActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  captureIcon: {
    alignItems: 'center',
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.full,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  captureLabel: {
    color: colors.muted,
    fontSize: fontSize.xs,
    marginTop: spacing.xxs,
    textAlign: 'center',
  },
  captureRow: {
    flexDirection: 'row',
    marginTop: spacing.lg,
  },
  captureStat: {
    alignItems: 'center',
    borderRightColor: colors.borderLight,
    borderRightWidth: 1,
    flex: 1,
    gap: spacing.xxs,
    paddingHorizontal: spacing.xs,
  },
  captureValue: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontVariant: ['tabular-nums'],
    fontWeight: fontWeight.bold,
  },
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.section,
  },
  inboxAction: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xxs,
    paddingLeft: spacing.sm,
  },
  inboxActionText: {
    color: colors.brand,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  inboxCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    padding: spacing.md,
    ...shadows.sm,
  },
  inboxCopy: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  inboxIcon: {
    alignItems: 'center',
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.md,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  inboxText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 18,
    marginTop: spacing.xxs,
  },
  inboxTitle: {
    color: colors.text,
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
  },
  introText: {
    color: colors.textSecondary,
    fontSize: fontSize.base,
    lineHeight: 20,
    marginTop: -spacing.sm,
  },
  knowledgeCopy: {
    flex: 1,
  },
  knowledgeBadge: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
    marginRight: spacing.xs,
  },
  knowledgeBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.extrabold,
    letterSpacing: 0.3,
  },
  knowledgeDetail: {
    color: colors.muted,
    fontSize: fontSize.sm,
    marginTop: spacing.xxs,
  },
  knowledgeIcon: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  knowledgeList: {
    marginTop: spacing.sm,
  },
  knowledgeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 64,
  },
  knowledgeRowBorder: {
    borderBottomColor: colors.borderLight,
    borderBottomWidth: 1,
  },
  knowledgeTitle: {
    color: colors.text,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  metricCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    minHeight: 114,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.md,
    ...shadows.sm,
  },
  metricIcon: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  metricLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    lineHeight: 14,
    marginTop: spacing.xxs,
    textAlign: 'center',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  metricValue: {
    color: colors.text,
    fontSize: fontSize['2xl'],
    fontVariant: ['tabular-nums'],
    fontWeight: fontWeight.extrabold,
    marginTop: spacing.sm,
  },
  operationCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flex: 1,
    minHeight: 142,
    padding: spacing.md,
    ...shadows.sm,
  },
  operationDetail: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 17,
    marginTop: spacing.xxs,
  },
  operationGrid: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  operationIcon: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 36,
    justifyContent: 'center',
    marginBottom: spacing.sm,
    width: 36,
  },
  operationState: {
    borderRadius: radius.full,
    bottom: spacing.md,
    height: 7,
    position: 'absolute',
    right: spacing.md,
    width: 7,
  },
  operationTitle: {
    color: colors.text,
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
  },
  refreshButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  sectionCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  sectionHint: {
    color: colors.muted,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },
  statusDot: {
    borderRadius: radius.full,
    height: 8,
    width: 8,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  statusText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
});

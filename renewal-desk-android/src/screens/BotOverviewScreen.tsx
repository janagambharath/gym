import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { BotAccessState } from '../components/BotAccessState';
import { DashboardSkeleton } from '../components/LoadingSkeleton';
import { MetricCard } from '../components/MetricCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { SectionHeader } from '../components/SectionHeader';
import { AppHeader } from '../components/AppHeader';
import type { ApiError } from '../services/apiClient';
import { apiRequest } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type { BotConfig, BotConfigResponse, BotStats } from '../types';

type BotOverviewScreenProps = {
  onBack?: () => void;
  onOpenConversations: () => void;
  onOpenLeads: () => void;
  onOpenSetup: () => void;
  onLogout?: () => void;
};

type SetupItem = {
  label: string;
  ready: boolean;
};

function setupItemsFor(config: BotConfig): SetupItem[] {
  return [
    { label: 'Greeting message', ready: Boolean(config.greeting_message?.trim()) },
    { label: 'Opening hours', ready: Boolean(config.opening_hours?.trim()) },
    { label: 'Handover settings', ready: config.handover_enabled },
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
      if (resultError.status === 401 && onLogout) {
        onLogout();
      } else {
        setError(resultError);
      }
    } else if (statsResult.ok && configResult.ok) {
      setStats(statsResult.data);
      setConfig(configResult.data.config);
      setError(undefined);
    }

    setLoading(false);
    setRefreshing(false);
  }, [onLogout]);

  useEffect(() => {
    const initialLoad = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(initialLoad);
  }, [load]);

  const setupItems = useMemo(() => (config ? setupItemsFor(config) : []), [config]);
  const configuredCount = setupItems.filter((item) => item.ready).length;

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

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader
        title="WhatsApp Bot"
        subtitle="Operations"
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
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Icon name="robot" size={28} color={colors.brand} />
          </View>
          <View style={styles.heroBody}>
            <Text style={styles.heroTitle}>AI receptionist</Text>
            <Text style={styles.heroSubtitle}>
              {config.handover_enabled
                ? 'Human handover is available for active conversations.'
                : 'Human handover is currently turned off in bot settings.'}
            </Text>
          </View>
          <View style={[styles.livePill, config.handover_enabled ? styles.livePillOn : styles.livePillOff]}>
            <View style={[styles.liveDot, { backgroundColor: config.handover_enabled ? colors.success : colors.muted }]} />
            <Text style={[styles.liveText, { color: config.handover_enabled ? colors.successDark : colors.textSecondary }]}>
              {config.handover_enabled ? 'READY' : 'SETUP'}
            </Text>
          </View>
        </View>

        <View style={styles.metricsGrid}>
          <View style={styles.metricCell}>
            <MetricCard
              icon={<Icon name="chatbubble" size={19} color={colors.brand} />}
              iconBg={colors.brandSubtle}
              label="Conversations"
              value={stats.total_conversations}
            />
          </View>
          <View style={styles.metricCell}>
            <MetricCard
              icon={<Icon name="lead" size={19} color={colors.success} />}
              iconBg={colors.successSurface}
              label="New leads"
              value={stats.total_leads}
            />
          </View>
          <View style={styles.metricCell}>
            <MetricCard
              icon={<Icon name="star" size={19} color={colors.warning} />}
              iconBg={colors.warningSurface}
              label="Trial requests"
              value={stats.trial_requests}
            />
          </View>
          <View style={styles.metricCell}>
            <MetricCard
              icon={<Icon name="messageReply" size={19} color={colors.statusPending} />}
              iconBg={colors.statusPendingSurface}
              label="Need staff"
              value={stats.handover_requested}
            />
          </View>
        </View>

        {stats.handover_requested > 0 ? (
          <TouchableOpacity
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
                {stats.handover_requested} conversation{stats.handover_requested === 1 ? '' : 's'} waiting for a handover.
              </Text>
            </View>
            <Icon name="forward" size={18} color={colors.warningDark} />
          </TouchableOpacity>
        ) : null}

        <View style={styles.actionsCard}>
          <SectionHeader title="Operations" icon={<Icon name="stats" size={19} color={colors.brand} />} />
          <View style={styles.actionRow}>
            <OperationAction
              icon="chatbubble"
              label="Conversations"
              detail="Take over or reply"
              onPress={onOpenConversations}
            />
            <OperationAction
              icon="lead"
              label="Leads"
              detail="Follow up on enquiries"
              onPress={onOpenLeads}
            />
          </View>
        </View>

        <View style={styles.setupCard}>
          <View style={styles.setupHeader}>
            <View>
              <Text style={styles.setupTitle}>Bot setup</Text>
              <Text style={styles.setupSubtitle}>{configuredCount} of {setupItems.length} core items configured</Text>
            </View>
            <TouchableOpacity accessibilityRole="button" onPress={onOpenSetup}>
              <Text style={styles.setupAction}>Manage</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.setupList}>
            {setupItems.map((item) => (
              <View key={item.label} style={styles.setupItem}>
                <Icon
                  name={item.ready ? 'checkmark' : 'warning'}
                  size={17}
                  color={item.ready ? colors.success : colors.warning}
                />
                <Text style={styles.setupItemText}>{item.label}</Text>
                <Text style={[styles.setupValue, { color: item.ready ? colors.successDark : colors.warningDark }]}>
                  {item.ready ? 'Ready' : 'Needs setup'}
                </Text>
              </View>
            ))}
          </View>
          <PrimaryButton
            icon={<Icon name="settings" size={17} color={colors.brand} />}
            onPress={onOpenSetup}
            size="md"
            title="Open bot setup"
            variant="outline"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function OperationAction({
  icon,
  label,
  detail,
  onPress,
}: {
  icon: 'chatbubble' | 'lead';
  label: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity accessibilityRole="button" onPress={onPress} style={styles.operationAction}>
      <View style={styles.operationIcon}>
        <Icon name={icon} size={21} color={colors.brand} />
      </View>
      <Text style={styles.operationLabel}>{label}</Text>
      <Text style={styles.operationDetail}>{detail}</Text>
      <Icon name="forward" size={16} color={colors.muted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionsCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
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
    backgroundColor: colors.warningBorder,
    borderRadius: radius.md,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  attentionText: {
    color: colors.warningDark,
    fontSize: fontSize.sm,
    marginTop: spacing.xxs,
  },
  attentionTitle: {
    color: colors.warningDark,
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
  },
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.section,
  },
  heroBody: {
    flex: 1,
  },
  heroCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    ...shadows.sm,
  },
  heroIcon: {
    alignItems: 'center',
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.lg,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  heroSubtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 18,
    marginTop: spacing.xxs,
  },
  heroTitle: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  liveDot: {
    borderRadius: radius.full,
    height: 6,
    width: 6,
  },
  livePill: {
    alignItems: 'center',
    borderRadius: radius.full,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  livePillOff: {
    backgroundColor: colors.gray100,
  },
  livePillOn: {
    backgroundColor: colors.successSurface,
  },
  liveText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.3,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metricCell: {
    width: '48%',
  },
  operationAction: {
    alignItems: 'center',
    backgroundColor: colors.gray50,
    borderColor: colors.borderLight,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    minHeight: 136,
    padding: spacing.md,
  },
  operationDetail: {
    color: colors.muted,
    fontSize: fontSize.xs,
    lineHeight: 16,
    marginTop: spacing.xxs,
    textAlign: 'center',
  },
  operationIcon: {
    alignItems: 'center',
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.md,
    height: 38,
    justifyContent: 'center',
    marginBottom: spacing.sm,
    width: 38,
  },
  operationLabel: {
    color: colors.text,
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
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
  setupAction: {
    color: colors.brand,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  setupCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  setupHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  setupItem: {
    alignItems: 'center',
    borderTopColor: colors.borderLight,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  setupItemText: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: fontSize.base,
  },
  setupList: {
    marginVertical: spacing.md,
  },
  setupSubtitle: {
    color: colors.muted,
    fontSize: fontSize.sm,
    marginTop: spacing.xxs,
  },
  setupTitle: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  setupValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
});

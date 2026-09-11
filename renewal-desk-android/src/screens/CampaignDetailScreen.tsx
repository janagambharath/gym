import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';
import { CardSkeleton } from '../components/LoadingSkeleton';
import { ErrorState } from '../components/ErrorState';
import { StatusBadge } from '../components/StatusBadge';
import { apiRequest } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type { Campaign, CampaignRecipient, CampaignRecipientsResponse } from '../types';
import { formatCurrency, formatDate, SEGMENT_LABELS } from '../types';

type CampaignDetailScreenProps = {
  campaign: Campaign;
  onBack: () => void;
  onNavigateMember?: (memberId: number) => void;
};

const RECIPIENT_STATUS_COLORS: Record<string, { text: string; bg: string }> = {
  pending: { text: colors.muted, bg: colors.gray100 },
  sent: { text: colors.brand, bg: colors.brandSubtle },
  delivered: { text: colors.brand, bg: colors.brandSubtle },
  read: { text: colors.success, bg: colors.successSurface },
  replied: { text: colors.success, bg: colors.successSurface },
  renewed: { text: colors.success, bg: colors.successSurface },
  failed: { text: colors.critical, bg: colors.criticalSurface },
};

export function CampaignDetailScreen({ campaign, onBack, onNavigateMember }: CampaignDetailScreenProps) {
  const [currentCampaign, setCurrentCampaign] = useState<Campaign>(campaign);
  const [recipients, setRecipients] = useState<CampaignRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [filter, setFilter] = useState<string>('all');

  // Fast Renewal Modal state
  const [renewalModalRecipient, setRenewalModalRecipient] = useState<CampaignRecipient | null>(null);
  const [renewalAmount, setRenewalAmount] = useState('');
  const [renewalDays, setRenewalDays] = useState('30');
  const [confirmingRenewal, setConfirmingRenewal] = useState(false);

  const isRecovery = currentCampaign.campaign_type === 'recovery' || !currentCampaign.campaign_type;

  const fetchCampaignAndRecipients = useCallback(async () => {
    // Fetch latest campaign stats
    const campRes = await apiRequest<{ campaign: Campaign }>(`/api/mobile/v1/campaigns/${campaign.id}`);
    if (campRes.ok) {
      setCurrentCampaign(campRes.data.campaign);
    }

    // Fetch recipients
    const statusParam = filter !== 'all' ? `&status=${filter}` : '';
    const res = await apiRequest<CampaignRecipientsResponse>(
      `/api/mobile/v1/campaigns/${campaign.id}/recipients?page_size=100${statusParam}`,
    );
    if (res.ok) {
      setRecipients(res.data.recipients);
      setError(undefined);
    } else {
      setError(res.error.message);
    }
    setLoading(false);
    setRefreshing(false);
  }, [campaign.id, filter]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const campRes = await apiRequest<{ campaign: Campaign }>(`/api/mobile/v1/campaigns/${campaign.id}`);
      if (!cancelled && campRes.ok) {
        setCurrentCampaign(campRes.data.campaign);
      }

      const statusParam = filter !== 'all' ? `&status=${filter}` : '';
      const res = await apiRequest<CampaignRecipientsResponse>(
        `/api/mobile/v1/campaigns/${campaign.id}/recipients?page_size=100${statusParam}`,
      );
      if (cancelled) return;
      if (res.ok) {
        setRecipients(res.data.recipients);
        setError(undefined);
      } else {
        setError(res.error.message);
      }
      setLoading(false);
      setRefreshing(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [campaign.id, filter]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchCampaignAndRecipients();
  }, [fetchCampaignAndRecipients]);

  const revenue = parseFloat(currentCampaign.total_revenue_recovered || '0');

  const filters = [
    { key: 'all', label: 'All' },
    { key: 'sent', label: 'Sent' },
    { key: 'delivered', label: 'Delivered' },
    { key: 'read', label: 'Read' },
    { key: 'replied', label: 'Replied' },
    { key: 'renewed', label: 'Renewed' },
    { key: 'failed', label: 'Failed' },
  ];

  // Actions
  const onOpenWhatsApp = useCallback((phone: string | null) => {
    if (!phone) return;
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const url = `https://wa.me/${cleanPhone}`;
    void Linking.openURL(url).catch(() => {
      Alert.alert('Cannot Open WhatsApp', 'Please ensure WhatsApp is installed.');
    });
  }, []);

  const onCallPhone = useCallback((phone: string | null) => {
    if (!phone) return;
    const url = `tel:${phone}`;
    void Linking.openURL(url).catch(() => {
      Alert.alert('Cannot Call', 'Could not open the dialer.');
    });
  }, []);

  const onOpenRenewalModal = useCallback((recipient: CampaignRecipient) => {
    setRenewalModalRecipient(recipient);
    // Prefill amount with recipient plan price or previous amount or 1000 default
    const defaultAmount = recipient.renewal_amount || recipient.plan_price || '1000';
    setRenewalAmount(String(parseFloat(defaultAmount) || 1000));
    setRenewalDays('30');
  }, []);

  const onConfirmFastRenewal = useCallback(async () => {
    if (!renewalModalRecipient) return;
    const amountNum = parseFloat(renewalAmount);
    const daysNum = parseInt(renewalDays, 10);

    if (isNaN(amountNum) || amountNum < 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid renewal amount.');
      return;
    }
    if (isNaN(daysNum) || daysNum < 1) {
      Alert.alert('Invalid Duration', 'Please enter a valid renewal duration (e.g. 30 days).');
      return;
    }

    setConfirmingRenewal(true);
    const res = await apiRequest<{ renewal: { id: number; amount: string; new_end: string } }>(
      `/api/mobile/v1/renewals/${renewalModalRecipient.member_id}`,
      {
        method: 'POST',
        body: {
          renewal_days: daysNum,
          amount: amountNum,
          notes: `Fast Renewal attributed to campaign #${currentCampaign.id} (${currentCampaign.name})`,
        },
      },
    );
    setConfirmingRenewal(false);

    if (res.ok) {
      setRenewalModalRecipient(null);
      Alert.alert(
        'Renewal Confirmed! 🎉',
        `Renewed ${renewalModalRecipient.member_name} for ${daysNum} days (${formatCurrency(amountNum)}). This revenue has been directly attributed to this campaign.`,
      );
      // Refresh list and stats
      void fetchCampaignAndRecipients();
    } else {
      Alert.alert('Error', res.error.message || 'Failed to confirm renewal.');
    }
  }, [renewalModalRecipient, renewalAmount, renewalDays, currentCampaign, fetchCampaignAndRecipients]);

  const renderRecipient = useCallback(
    ({ item }: { item: CampaignRecipient }) => {
      const statusColor = RECIPIENT_STATUS_COLORS[item.status] ?? RECIPIENT_STATUS_COLORS.pending;
      const isRenewed = item.status === 'renewed' || !!item.renewed_at;

      return (
        <View style={styles.recipientCard}>
          <TouchableOpacity
            style={styles.recipientHeaderRow}
            activeOpacity={0.7}
            onPress={() => onNavigateMember?.(item.member_id)}
          >
            <Avatar name={item.member_name ?? '?'} size={40} />
            <View style={styles.recipientInfo}>
              <Text style={styles.recipientName} numberOfLines={1}>
                {item.member_name ?? 'Unknown Member'}
              </Text>
              <Text style={styles.recipientMeta}>
                {item.member_phone} · {item.plan_name ?? 'Standard Plan'}
              </Text>
              {item.membership_end && (
                <Text style={styles.recipientExpiry}>
                  Expired: {formatDate(item.membership_end)}
                </Text>
              )}
            </View>
            <StatusBadge
              label={item.status.charAt(0).toUpperCase() + item.status.slice(1)}
              color={statusColor.text}
              backgroundColor={statusColor.bg}
            />
          </TouchableOpacity>

          {/* If already renewed, display prominent attribution confirmation */}
          {isRenewed && (
            <View style={styles.renewedBanner}>
              <Icon name="checkmark" size={16} color={colors.success} />
              <Text style={styles.renewedBannerText}>
                Renewed {item.renewal_amount ? formatCurrency(item.renewal_amount) : ''} · Attributed to this campaign
              </Text>
            </View>
          )}

          {/* Action Row */}
          <View style={styles.recipientActionRow}>
            {/* 1-Tap Fast Renewal button (Only if not already renewed) */}
            {!isRenewed && (
              <TouchableOpacity
                style={styles.fastRenewalButton}
                activeOpacity={0.8}
                onPress={() => onOpenRenewalModal(item)}
              >
                <Icon name="renewed" size={14} color={colors.textInverse} />
                <Text style={styles.fastRenewalButtonText}>Fast Renewal</Text>
              </TouchableOpacity>
            )}

            {/* Open WhatsApp */}
            <TouchableOpacity
              style={styles.actionIconButton}
              activeOpacity={0.7}
              onPress={() => onOpenWhatsApp(item.member_phone)}
            >
              <Icon name="whatsapp" size={16} color={colors.successDark} />
              <Text style={styles.actionIconText}>WhatsApp</Text>
            </TouchableOpacity>

            {/* Follow Up Call */}
            <TouchableOpacity
              style={styles.actionIconButton}
              activeOpacity={0.7}
              onPress={() => onCallPhone(item.member_phone)}
            >
              <Icon name="call" size={16} color={colors.brand} />
              <Text style={styles.actionIconText}>Call</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    },
    [onNavigateMember, onOpenRenewalModal, onOpenWhatsApp, onCallPhone],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Icon name="back" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{currentCampaign.name}</Text>
          <Text style={styles.headerSubtitle}>
            {SEGMENT_LABELS[currentCampaign.segment_type] ?? currentCampaign.segment_type}
          </Text>
        </View>
        <View style={{ width: 22 }} />
      </View>

      {/* Results Summary Section */}
      <View style={styles.summarySection}>
        <View style={styles.metricsGrid}>
          <MetricCard
            label="Sent"
            value={currentCampaign.total_sent}
            total={currentCampaign.total_recipients}
            color={colors.brand}
            icon="sent"
          />
          <MetricCard
            label="Delivered"
            value={currentCampaign.total_delivered}
            total={currentCampaign.total_sent}
            color={colors.brand}
            icon="delivered"
          />
          <MetricCard
            label="Read"
            value={currentCampaign.total_read}
            total={currentCampaign.total_delivered}
            color={colors.success}
            icon="read"
          />
          {isRecovery ? (
            <MetricCard
              label="Renewed"
              value={currentCampaign.total_renewed}
              total={currentCampaign.total_sent}
              color={colors.success}
              icon="renewed"
              highlight
            />
          ) : (
            <MetricCard
              label="Replied"
              value={currentCampaign.total_replied}
              total={currentCampaign.total_sent}
              color={colors.brand}
              icon="reply"
              highlight
            />
          )}
        </View>

        {/* Differentiated Metrics: Recovery shows Revenue Recovered */}
        {isRecovery && (
          <View style={styles.revenueCard}>
            <View style={styles.revenueCardLeft}>
              <Text style={styles.revenueLabel}>REVENUE RECOVERED</Text>
              <Text style={styles.revenueAmount}>{formatCurrency(revenue)}</Text>
              <Text style={styles.revenueSubtext}>
                {currentCampaign.total_renewed} members renewed from this campaign
              </Text>
            </View>
            <View style={styles.revenueIconBadge}>
              <Icon name="revenue" size={28} color={colors.success} />
            </View>
          </View>
        )}

        {!isRecovery && (
          <View style={styles.engagementCard}>
            <View style={styles.engagementCardLeft}>
              <Text style={styles.engagementLabel}>PROMOTION ENGAGEMENT</Text>
              <Text style={styles.engagementAmount}>
                {currentCampaign.total_sent > 0
                  ? `${Math.round(((currentCampaign.total_read + currentCampaign.total_replied) / currentCampaign.total_sent) * 100)}%`
                  : '0%'}
              </Text>
              <Text style={styles.engagementSubtext}>
                {currentCampaign.total_replied} replies · {currentCampaign.total_read} read
              </Text>
            </View>
            <View style={styles.engagementIconBadge}>
              <Icon name="gift" size={24} color={colors.brand} />
            </View>
          </View>
        )}
      </View>

      {/* Filter Chips */}
      <View style={styles.filterRow}>
        {filters.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.filterChipText, filter === f.key && styles.filterChipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Recipients List */}
      {loading ? (
        <View style={styles.content}>
          <CardSkeleton count={4} />
        </View>
      ) : error ? (
        <ErrorState message={error} onRetry={fetchCampaignAndRecipients} />
      ) : (
        <FlatList
          data={recipients}
          renderItem={renderRecipient}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
          }
          ListEmptyComponent={
            <View style={styles.emptyList}>
              <Text style={styles.emptyText}>No recipients match this filter.</Text>
            </View>
          }
        />
      )}

      {/* Fast Renewal Modal */}
      <Modal
        visible={!!renewalModalRecipient}
        transparent
        animationType="fade"
        onRequestClose={() => setRenewalModalRecipient(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Icon name="renewed" size={24} color={colors.success} />
              <Text style={styles.modalTitle}>1-Tap Fast Renewal</Text>
            </View>

            <Text style={styles.modalMemberName}>{renewalModalRecipient?.member_name}</Text>
            <Text style={styles.modalMemberPhone}>{renewalModalRecipient?.member_phone}</Text>

            <View style={styles.modalInputs}>
              <View style={styles.modalField}>
                <Text style={styles.modalFieldLabel}>Renewal Amount (₹)</Text>
                <TextInput
                  style={styles.modalTextInput}
                  keyboardType="numeric"
                  value={renewalAmount}
                  onChangeText={setRenewalAmount}
                  placeholder="e.g. 1500"
                />
              </View>

              <View style={styles.modalField}>
                <Text style={styles.modalFieldLabel}>Renewal Days</Text>
                <TextInput
                  style={styles.modalTextInput}
                  keyboardType="numeric"
                  value={renewalDays}
                  onChangeText={setRenewalDays}
                  placeholder="30"
                />
              </View>
            </View>

            <Text style={styles.modalAttributionNotice}>
              🛡️ This renewal will automatically attribute {formatCurrency(parseFloat(renewalAmount) || 0)} to campaign #{currentCampaign.id}.
            </Text>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setRenewalModalRecipient(null)}
                disabled={confirmingRenewal}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirmButton}
                onPress={onConfirmFastRenewal}
                disabled={confirmingRenewal}
              >
                {confirmingRenewal ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text style={styles.modalConfirmText}>Confirm & Renew</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function MetricCard({
  label,
  value,
  total,
  color,
  highlight,
  icon,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
  highlight?: boolean;
  icon: 'sent' | 'delivered' | 'read' | 'renewed' | 'reply';
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <View style={[styles.metricCard, highlight && styles.metricCardHighlight]}>
      <Icon name={icon} size={16} color={color} />
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
      {total > 0 && <Text style={styles.metricPct}>{pct}%</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, padding: spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerCenter: { flex: 1, marginHorizontal: spacing.md },
  headerTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  headerSubtitle: { fontSize: fontSize.xs, color: colors.muted },
  summarySection: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    gap: spacing.md,
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  metricCard: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.gray50,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    gap: 2,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  metricCardHighlight: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  metricValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  metricLabel: { fontSize: 10, color: colors.muted, fontWeight: fontWeight.medium },
  metricPct: { fontSize: 10, color: colors.muted },
  revenueCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.successSurface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  revenueCardLeft: {
    gap: 2,
  },
  revenueLabel: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: colors.successDark,
    letterSpacing: 0.5,
  },
  revenueAmount: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.successDark,
  },
  revenueSubtext: {
    fontSize: fontSize.xs,
    color: colors.successDark,
  },
  revenueIconBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  engagementCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.infoBorder,
  },
  engagementCardLeft: {
    gap: 2,
  },
  engagementLabel: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: colors.brand,
    letterSpacing: 0.5,
  },
  engagementAmount: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.brand,
  },
  engagementSubtext: {
    fontSize: fontSize.xs,
    color: colors.brand,
  },
  engagementIconBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
    backgroundColor: colors.background,
  },
  filterChip: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  filterChipActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  filterChipText: {
    fontSize: fontSize.xs,
    color: colors.muted,
    fontWeight: fontWeight.medium,
  },
  filterChipTextActive: {
    color: colors.textInverse,
    fontWeight: fontWeight.bold,
  },
  list: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.bottomTabSafe,
  },
  recipientCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    ...shadows.sm,
  },
  recipientHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recipientInfo: {
    flex: 1,
    marginLeft: spacing.sm,
    gap: 2,
  },
  recipientName: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  recipientMeta: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  recipientExpiry: {
    fontSize: fontSize.xs,
    color: colors.critical,
    fontWeight: fontWeight.medium,
  },
  renewedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successSurface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.xs,
    gap: 4,
  },
  renewedBannerText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.successDark,
  },
  recipientActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingTop: spacing.xs + 2,
  },
  fastRenewalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.success,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.sm,
    gap: 4,
  },
  fastRenewalButtonText: {
    color: colors.textInverse,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  actionIconButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.sm,
    gap: 4,
  },
  actionIconText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.textSecondary,
  },
  emptyList: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    color: colors.muted,
    fontSize: fontSize.sm,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  modalCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
    ...shadows.md,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  modalTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  modalMemberName: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  modalMemberPhone: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  modalInputs: {
    gap: spacing.sm,
  },
  modalField: {
    gap: 4,
  },
  modalFieldLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
  },
  modalTextInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    fontSize: fontSize.base,
    color: colors.text,
    backgroundColor: colors.background,
  },
  modalAttributionNotice: {
    fontSize: fontSize.xs,
    color: colors.successDark,
    lineHeight: 16,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  modalCancelButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  modalCancelText: {
    color: colors.muted,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  modalConfirmButton: {
    backgroundColor: colors.success,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalConfirmText: {
    color: colors.textInverse,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
});

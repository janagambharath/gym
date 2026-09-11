import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { CardSkeleton } from '../components/LoadingSkeleton';
import { StatusBadge } from '../components/StatusBadge';
import { apiRequest } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type { Campaign, CampaignsResponse, CampaignType } from '../types';
import { formatCurrency, formatDateTime, SEGMENT_LABELS } from '../types';

type CampaignsScreenProps = {
  onBack: () => void;
  onCreateCampaign: (purpose?: CampaignType) => void;
  onSelectCampaign: (campaign: Campaign) => void;
};

const STATUS_COLORS: Record<string, { text: string; bg: string }> = {
  draft: { text: colors.muted, bg: colors.gray100 },
  sending: { text: colors.brand, bg: colors.brandSubtle },
  sent: { text: colors.success, bg: colors.successSurface },
  completed: { text: colors.success, bg: colors.successSurface },
  failed: { text: colors.critical, bg: colors.criticalSurface },
};

const PRESET_TITLES: Record<string, string> = {
  special_offer: 'Special Offer',
  festival_offer: 'Festival Offer',
  referral_offer: 'Referral Offer',
  pt_offer: 'PT Session Offer',
  new_membership: 'New Membership',
  announcement: 'Gym Announcement',
};

type FilterTab = 'all' | 'recovery' | 'promotion';

export function CampaignsScreen({ onBack, onCreateCampaign, onSelectCampaign }: CampaignsScreenProps) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  const fetchCampaigns = useCallback(async (typeFilter?: FilterTab) => {
    const selectedTab = typeFilter ?? activeTab;
    const typeParam = selectedTab !== 'all' ? `&campaign_type=${selectedTab}` : '';
    const res = await apiRequest<CampaignsResponse>(`/api/mobile/v1/campaigns?page_size=50${typeParam}`);
    if (res.ok) {
      setCampaigns(res.data.campaigns);
      setError(undefined);
    } else {
      setError(res.error.message);
    }
    setLoading(false);
    setRefreshing(false);
  }, [activeTab]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const typeParam = activeTab !== 'all' ? `&campaign_type=${activeTab}` : '';
      const res = await apiRequest<CampaignsResponse>(`/api/mobile/v1/campaigns?page_size=50${typeParam}`);
      if (!active) return;
      if (res.ok) {
        setCampaigns(res.data.campaigns);
        setError(undefined);
      } else {
        setError(res.error.message);
      }
      setLoading(false);
      setRefreshing(false);
    };
    void load();
    return () => {
      active = false;
    };
  }, [activeTab]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchCampaigns();
  }, [fetchCampaigns]);

  const onTabPress = useCallback((tab: FilterTab) => {
    setActiveTab(tab);
    setLoading(true);
  }, []);

  const showAdComingSoon = useCallback(() => {
    Alert.alert(
      'Get New Members — Coming Soon',
      'Lead Ad acquisition is coming in the next release! It connects Meta & Instagram Ad leads straight into your WhatsApp bot and member intake pipeline.\n\nYour WhatsApp bot and attribution tracking are already configured and ad-ready.',
      [{ text: 'Got it' }],
    );
  }, []);

  const renderHeader = useCallback(() => {
    return (
      <View style={styles.headerContainer}>
        {/* Purpose Cards Section */}
        <Text style={styles.sectionTitle}>Campaign Purposes</Text>
        <Text style={styles.sectionSubtitle}>
          Choose the exact purpose for your WhatsApp outreach. Never mixed together.
        </Text>

        <View style={styles.purposesList}>
          {/* Purpose 1: Recover Expired Members */}
          <View style={[styles.purposeCard, styles.purposeCardRecovery]}>
            <View style={styles.purposeHeader}>
              <View style={[styles.purposeIconBadge, styles.purposeIconRecovery]}>
                <Icon name="revenue" size={20} color={colors.success} />
              </View>
              <View style={styles.purposeTagRecovery}>
                <Text style={styles.purposeTagTextRecovery}>REVENUE RECOVERY</Text>
              </View>
            </View>
            <Text style={styles.purposeTitle}>Recover Expired Members</Text>
            <Text style={styles.purposeDescription}>
              Bring expired members back and recover lost dues with approved reactivation templates and 1-tap Fast Renewal.
            </Text>
            <View style={styles.purposeHighlights}>
              <View style={styles.highlightPill}>
                <Icon name="check" size={12} color={colors.success} />
                <Text style={styles.highlightText}>Target only expired</Text>
              </View>
              <View style={styles.highlightPill}>
                <Icon name="check" size={12} color={colors.success} />
                <Text style={styles.highlightText}>1-Tap Fast Renewal</Text>
              </View>
              <View style={styles.highlightPill}>
                <Icon name="check" size={12} color={colors.success} />
                <Text style={styles.highlightText}>Recovered revenue attribution</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.purposeButtonRecovery}
              activeOpacity={0.8}
              onPress={() => onCreateCampaign('recovery')}
            >
              <Text style={styles.purposeButtonTextRecovery}>Start Recovery Campaign</Text>
              <Icon name="forward" size={16} color={colors.textInverse} />
            </TouchableOpacity>
          </View>

          {/* Purpose 2: Promotions */}
          <View style={[styles.purposeCard, styles.purposeCardPromo]}>
            <View style={styles.purposeHeader}>
              <View style={[styles.purposeIconBadge, styles.purposeIconPromo]}>
                <Icon name="gift" size={20} color={colors.brand} />
              </View>
              <View style={styles.purposeTagPromo}>
                <Text style={styles.purposeTagTextPromo}>OFFERS & ANNOUNCEMENTS</Text>
              </View>
            </View>
            <Text style={styles.purposeTitle}>Promotions & Offers</Text>
            <Text style={styles.purposeDescription}>
              Send special offers, festival discounts, and gym announcements to your active or custom customer lists.
            </Text>
            <View style={styles.purposeHighlights}>
              <View style={styles.highlightPill}>
                <Icon name="check" size={12} color={colors.brand} />
                <Text style={styles.highlightText}>6 preset offer templates</Text>
              </View>
              <View style={styles.highlightPill}>
                <Icon name="check" size={12} color={colors.brand} />
                <Text style={styles.highlightText}>CSV / customer list upload</Text>
              </View>
              <View style={styles.highlightPill}>
                <Icon name="check" size={12} color={colors.brand} />
                <Text style={styles.highlightText}>Delivery & reply metrics</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.purposeButtonPromo}
              activeOpacity={0.8}
              onPress={() => onCreateCampaign('promotion')}
            >
              <Text style={styles.purposeButtonTextPromo}>Create Promotion</Text>
              <Icon name="forward" size={16} color={colors.textInverse} />
            </TouchableOpacity>
          </View>

          {/* Purpose 3: Get New Members [COMING SOON] */}
          <View style={[styles.purposeCard, styles.purposeCardAds]}>
            <View style={styles.purposeHeader}>
              <View style={[styles.purposeIconBadge, styles.purposeIconAds]}>
                <Icon name="lead" size={20} color={colors.muted} />
              </View>
              <View style={styles.purposeTagAds}>
                <Text style={styles.purposeTagTextAds}>COMING SOON</Text>
              </View>
            </View>
            <Text style={styles.purposeTitleAds}>Get New Members</Text>
            <Text style={styles.purposeDescriptionAds}>
              Run targeted WhatsApp & Instagram ads to attract new gym trial signups directly into your Renewal Desk lead pipeline.
            </Text>
            <TouchableOpacity
              style={styles.purposeButtonAds}
              activeOpacity={0.7}
              onPress={showAdComingSoon}
            >
              <Icon name="info" size={14} color={colors.muted} />
              <Text style={styles.purposeButtonTextAds}>View Details</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Campaign History & Filter Tabs */}
        <View style={styles.historySectionHeader}>
          <Text style={styles.sectionTitle}>Campaign History</Text>
          <View style={styles.tabsRow}>
            <TouchableOpacity
              style={[styles.filterTab, activeTab === 'all' && styles.filterTabActive]}
              onPress={() => onTabPress('all')}
            >
              <Text style={[styles.filterTabText, activeTab === 'all' && styles.filterTabTextActive]}>
                All
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterTab, activeTab === 'recovery' && styles.filterTabActive]}
              onPress={() => onTabPress('recovery')}
            >
              <Text style={[styles.filterTabText, activeTab === 'recovery' && styles.filterTabTextActive]}>
                Expired Recovery
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterTab, activeTab === 'promotion' && styles.filterTabActive]}
              onPress={() => onTabPress('promotion')}
            >
              <Text style={[styles.filterTabText, activeTab === 'promotion' && styles.filterTabTextActive]}>
                Promotions
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }, [activeTab, onTabPress, onCreateCampaign, showAdComingSoon]);

  const renderCampaignCard = useCallback(
    ({ item }: { item: Campaign }) => {
      const statusColor = STATUS_COLORS[item.status] ?? STATUS_COLORS.draft;
      const isRecovery = item.campaign_type === 'recovery' || !item.campaign_type;
      const segmentLabel = SEGMENT_LABELS[item.segment_type] ?? item.segment_type;
      const presetLabel = item.promo_preset ? PRESET_TITLES[item.promo_preset] || item.promo_preset : null;
      const revenue = parseFloat(item.total_revenue_recovered || '0');

      return (
        <TouchableOpacity
          style={styles.campaignCard}
          activeOpacity={0.7}
          onPress={() => onSelectCampaign(item)}
        >
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <View style={styles.typeBadgeRow}>
                {isRecovery ? (
                  <View style={styles.typeBadgeRecovery}>
                    <Icon name="revenue" size={12} color={colors.success} />
                    <Text style={styles.typeBadgeTextRecovery}>Expired Member Recovery</Text>
                  </View>
                ) : (
                  <View style={styles.typeBadgePromo}>
                    <Icon name="gift" size={12} color={colors.brand} />
                    <Text style={styles.typeBadgeTextPromo}>
                      Promotion {presetLabel ? `• ${presetLabel}` : ''}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={styles.campaignName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.segmentNameText}>
                Audience: {segmentLabel}
              </Text>
            </View>
            <StatusBadge
              label={item.status.charAt(0).toUpperCase() + item.status.slice(1)}
              color={statusColor.text}
              backgroundColor={statusColor.bg}
            />
          </View>

          {item.status !== 'draft' && (
            <View style={styles.metricsRow}>
              <MetricPill label="Sent" value={item.total_sent} icon="sent" />
              <MetricPill label="Delivered" value={item.total_delivered} icon="delivered" />
              <MetricPill label="Read" value={item.total_read} icon="read" />
              {isRecovery ? (
                <MetricPill label="Renewed" value={item.total_renewed} icon="renewed" highlight />
              ) : (
                <MetricPill label="Replied" value={item.total_replied} icon="reply" highlight />
              )}
            </View>
          )}

          {/* Differentiated metrics: ONLY recovery shows Revenue Recovered */}
          {isRecovery && (
            <View style={[styles.revenueRow, revenue > 0 ? styles.revenueRowActive : styles.revenueRowEmpty]}>
              <Icon name="revenue" size={16} color={revenue > 0 ? colors.success : colors.muted} />
              <Text style={revenue > 0 ? styles.revenueText : styles.revenueTextEmpty}>
                {revenue > 0
                  ? `${formatCurrency(revenue)} recovered`
                  : '0 revenue recovered yet'}
              </Text>
            </View>
          )}

          {!isRecovery && item.total_replied > 0 && (
            <View style={styles.replyEngagementRow}>
              <Icon name="reply" size={14} color={colors.brand} />
              <Text style={styles.replyEngagementText}>
                {item.total_replied} interested {item.total_replied === 1 ? 'member' : 'members'} replied
              </Text>
            </View>
          )}

          <View style={styles.cardFooter}>
            <Text style={styles.cardDate}>
              {item.sent_at ? formatDateTime(item.sent_at) : item.created_at ? formatDateTime(item.created_at) : ''}
            </Text>
            {item.created_by && (
              <Text style={styles.cardCreator}>by {item.created_by}</Text>
            )}
          </View>
        </TouchableOpacity>
      );
    },
    [onSelectCampaign],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Navigation Header */}
      <View style={styles.navHeader}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Icon name="back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Campaigns</Text>
        <View style={styles.navActions}>
          <TouchableOpacity
            style={styles.quickCreateButton}
            onPress={() => onCreateCampaign('recovery')}
            activeOpacity={0.7}
          >
            <Icon name="add" size={16} color={colors.textInverse} />
            <Text style={styles.quickCreateText}>New</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading && campaigns.length === 0 ? (
        <View style={styles.skeletonContainer}>
          <CardSkeleton count={3} />
        </View>
      ) : error ? (
        <ErrorState message={error} onRetry={() => fetchCampaigns()} />
      ) : (
        <FlatList
          data={campaigns}
          renderItem={renderCampaignCard}
          keyExtractor={(item) => String(item.id)}
          ListHeaderComponent={renderHeader}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <EmptyState
                title={
                  activeTab === 'recovery'
                    ? 'No recovery campaigns yet'
                    : activeTab === 'promotion'
                      ? 'No promotions yet'
                      : 'No campaigns yet'
                }
                message={
                  activeTab === 'recovery'
                    ? 'Start bringing expired gym members back to recover lost membership revenue.'
                    : activeTab === 'promotion'
                      ? 'Send your first special offer or announcement to your members.'
                      : 'Choose a campaign purpose above to reach your members over WhatsApp.'
                }
                actionLabel={activeTab === 'promotion' ? 'Create Promotion' : 'Start Recovery Campaign'}
                onAction={() => onCreateCampaign(activeTab === 'promotion' ? 'promotion' : 'recovery')}
              />
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

function MetricPill({
  label,
  value,
  icon,
  highlight,
}: {
  label: string;
  value: number;
  icon: 'sent' | 'delivered' | 'read' | 'renewed' | 'reply';
  highlight?: boolean;
}) {
  return (
    <View style={[styles.metricPill, highlight && styles.metricPillHighlight]}>
      <Icon
        name={icon}
        size={14}
        color={highlight ? colors.success : colors.muted}
      />
      <Text style={[styles.metricValue, highlight && styles.metricValueHighlight]}>
        {value}
      </Text>
      <Text style={[styles.metricLabel, highlight && styles.metricLabelHighlight]}>
        {label}
      </Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  navHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  navTitle: {
    flex: 1,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginLeft: spacing.md,
  },
  navActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  quickCreateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    gap: 4,
  },
  quickCreateText: {
    color: colors.textInverse,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  skeletonContainer: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  listContent: {
    paddingBottom: spacing.bottomTabSafe,
  },
  headerContainer: {
    padding: spacing.lg,
    paddingBottom: spacing.xs,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  sectionSubtitle: {
    fontSize: fontSize.sm,
    color: colors.muted,
    marginTop: 2,
    marginBottom: spacing.md,
  },
  purposesList: {
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  purposeCard: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    ...shadows.sm,
  },
  purposeCardRecovery: {
    backgroundColor: colors.card,
    borderColor: colors.successBorder,
  },
  purposeCardPromo: {
    backgroundColor: colors.card,
    borderColor: colors.infoBorder,
  },
  purposeCardAds: {
    backgroundColor: colors.gray50,
    borderColor: colors.borderLight,
    borderStyle: 'dashed',
  },
  purposeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  purposeIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  purposeIconRecovery: {
    backgroundColor: colors.successSurface,
  },
  purposeIconPromo: {
    backgroundColor: colors.brandSubtle,
  },
  purposeIconAds: {
    backgroundColor: colors.gray100,
  },
  purposeTagRecovery: {
    backgroundColor: colors.successSurface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.xs,
  },
  purposeTagTextRecovery: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.successDark,
  },
  purposeTagPromo: {
    backgroundColor: colors.brandSubtle,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.xs,
  },
  purposeTagTextPromo: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.brand,
  },
  purposeTagAds: {
    backgroundColor: colors.gray200,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.xs,
  },
  purposeTagTextAds: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.textSecondary,
  },
  purposeTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginTop: spacing.xs,
  },
  purposeTitleAds: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  purposeDescription: {
    fontSize: fontSize.sm,
    color: colors.muted,
    lineHeight: 20,
    marginTop: 4,
    marginBottom: spacing.md,
  },
  purposeDescriptionAds: {
    fontSize: fontSize.sm,
    color: colors.muted,
    lineHeight: 20,
    marginTop: 4,
    marginBottom: spacing.md,
  },
  purposeHighlights: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  highlightPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  highlightText: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    fontWeight: fontWeight.medium,
  },
  purposeButtonRecovery: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.success,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    gap: spacing.xs,
  },
  purposeButtonTextRecovery: {
    color: colors.textInverse,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  purposeButtonPromo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    gap: spacing.xs,
  },
  purposeButtonTextPromo: {
    color: colors.textInverse,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  purposeButtonAds: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  purposeButtonTextAds: {
    color: colors.muted,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  historySectionHeader: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  tabsRow: {
    flexDirection: 'row',
    backgroundColor: colors.gray100,
    borderRadius: radius.md,
    padding: 3,
    gap: 2,
  },
  filterTab: {
    flex: 1,
    paddingVertical: spacing.xs + 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  filterTabActive: {
    backgroundColor: colors.surface,
    ...shadows.sm,
  },
  filterTabText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.muted,
  },
  filterTabTextActive: {
    color: colors.text,
    fontWeight: fontWeight.bold,
  },
  campaignCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardHeaderLeft: {
    flex: 1,
    marginRight: spacing.sm,
    gap: 4,
  },
  typeBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  typeBadgeRecovery: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successSurface,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
    borderRadius: radius.xs,
    gap: 4,
  },
  typeBadgeTextRecovery: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.successDark,
  },
  typeBadgePromo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.brandSubtle,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
    borderRadius: radius.xs,
    gap: 4,
  },
  typeBadgeTextPromo: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.brand,
  },
  campaignName: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginTop: 2,
  },
  segmentNameText: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: 4,
  },
  metricPill: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.gray50,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.sm,
    gap: 2,
  },
  metricPillHighlight: {
    backgroundColor: colors.successSurface,
  },
  metricValue: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  metricValueHighlight: {
    color: colors.success,
  },
  metricLabel: {
    fontSize: 10,
    color: colors.muted,
    fontWeight: fontWeight.medium,
  },
  metricLabelHighlight: {
    color: colors.successDark,
  },
  revenueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.sm,
  },
  revenueRowActive: {
    backgroundColor: colors.successSurface,
  },
  revenueRowEmpty: {
    backgroundColor: colors.gray50,
  },
  revenueText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.success,
  },
  revenueTextEmpty: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.muted,
  },
  replyEngagementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.brandSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.sm,
  },
  replyEngagementText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.brand,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  cardDate: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  cardCreator: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  emptyContainer: {
    padding: spacing.lg,
  },
});

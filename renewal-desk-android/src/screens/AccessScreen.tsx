import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
import { ErrorState } from '../components/ErrorState';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import { apiRequest } from '../services/apiClient';
import type {
  AccessEvent,
  AccessEventsResponse,
  AccessSummary,
  InsideMember,
  InsideMembersResponse,
  Member,
  Pagination,
} from '../types';

// ─── Types ───────────────────────────────────────────────────────────

type FilterTab = 'all' | 'inside' | 'entry' | 'exit' | 'denied';

type AccessScreenProps = {
  onBack?: () => void;
  onNavigateMemberDetail?: (member: any) => void;
  onLogout?: () => void;
  refreshToken?: number;
};

// ─── Helper ──────────────────────────────────────────────────────────

function formatAccessTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `Today, ${timeStr}`;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
}

function getEventTypeStyle(eventType: string) {
  switch (eventType) {
    case 'ENTRY':
    case 'ATTENDANCE':
      return {
        label: eventType === 'ENTRY' ? 'ENTRY' : 'CHECK IN',
        color: colors.success,
        bgColor: colors.successSurface,
        borderColor: colors.successBorder,
        icon: 'forward' as const,
      };
    case 'EXIT':
      return {
        label: 'EXIT',
        color: colors.warning,
        bgColor: colors.warningSurface,
        borderColor: colors.warningBorder,
        icon: 'back' as const,
      };
    case 'ACCESS_DENIED':
      return {
        label: 'DENIED',
        color: colors.critical,
        bgColor: colors.criticalSurface,
        borderColor: colors.criticalBorder,
        icon: 'lock' as const,
      };
    default:
      return {
        label: 'UNKNOWN',
        color: colors.muted,
        bgColor: colors.gray100,
        borderColor: colors.border,
        icon: 'help' as const,
      };
  }
}

function timeAgo(isoString: string | null): string {
  if (!isoString) return 'Never';
  const diff = Math.max(0, (Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── Component ───────────────────────────────────────────────────────

export function AccessScreen({
  onBack,
  onNavigateMemberDetail,
  refreshToken,
}: AccessScreenProps) {
  const [summary, setSummary] = useState<AccessSummary | null>(null);
  const [events, setEvents] = useState<AccessEvent[]>([]);
  const [insideMembers, setInsideMembers] = useState<InsideMember[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const [showCheckInModal, setShowCheckInModal] = useState(false);
  const [checkInSearch, setCheckInSearch] = useState('');
  const [candidateMembers, setCandidateMembers] = useState<Member[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [checkingInId, setCheckingInId] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // ── Fetch summary ────────────────────────────────────────────────

  const fetchSummary = useCallback(async () => {
    const res = await apiRequest<AccessSummary>('/api/mobile/v1/access/summary');
    if (res.ok) {
      setSummary(res.data);
    }
  }, []);

  // ── Fetch events ─────────────────────────────────────────────────

  const fetchEvents = useCallback(
    async (page = 1, append = false) => {
      if (activeTab === 'inside') return;
      const typeParam =
        activeTab === 'entry' ? '&type=entry' :
        activeTab === 'exit' ? '&type=exit' :
        activeTab === 'denied' ? '&type=denied' : '';
      const searchParam = search.trim() ? `&search=${encodeURIComponent(search.trim())}` : '';
      const url = `/api/mobile/v1/access/events?page=${page}&per_page=25&date=today${typeParam}${searchParam}`;

      const res = await apiRequest<AccessEventsResponse>(url);
      if (res.ok) {
        if (append) {
          setEvents((prev) => [...prev, ...res.data.events]);
        } else {
          setEvents(res.data.events);
        }
        setPagination(res.data.pagination);
        setError(undefined);
      } else {
        if (!append) setError(res.error.message);
      }
    },
    [activeTab, search],
  );

  // ── Fetch inside members ─────────────────────────────────────────

  const fetchInsideMembers = useCallback(async () => {
    if (activeTab !== 'inside') return;
    const searchParam = search.trim() ? `&search=${encodeURIComponent(search.trim())}` : '';
    const res = await apiRequest<InsideMembersResponse>(
      `/api/mobile/v1/access/inside?per_page=50${searchParam}`,
    );
    if (res.ok) {
      setInsideMembers(res.data.members);
      setError(undefined);
    } else {
      setError(res.error.message);
    }
  }, [activeTab, search]);

  // ── Initial + refresh load ───────────────────────────────────────

  const loadAll = useCallback(async () => {
    await Promise.all([
      fetchSummary(),
      activeTab === 'inside' ? fetchInsideMembers() : fetchEvents(1),
    ]);
    setLoading(false);
  }, [fetchSummary, fetchEvents, fetchInsideMembers, activeTab]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await Promise.all([
        fetchSummary(),
        activeTab === 'inside' ? fetchInsideMembers() : fetchEvents(1),
      ]);
      if (!cancelled) {
        setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [activeTab, fetchEvents, fetchInsideMembers, fetchSummary, refreshToken, search]);

  // ── Auto-refresh polling (15s) ───────────────────────────────────

  useEffect(() => {
    pollRef.current = setInterval(() => {
      void fetchSummary();
      if (activeTab === 'inside') {
        void fetchInsideMembers();
      } else {
        void fetchEvents(1);
      }
    }, 15000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchSummary, fetchEvents, fetchInsideMembers, activeTab]);

  // ── Pull-to-refresh ──────────────────────────────────────────────

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [loadAll]);

  // ── Load more (pagination) ───────────────────────────────────────

  const onEndReached = useCallback(async () => {
    if (
      activeTab === 'inside' ||
      loadingMore ||
      !pagination ||
      pagination.page >= pagination.total_pages
    )
      return;
    setLoadingMore(true);
    await fetchEvents(pagination.page + 1, true);
    setLoadingMore(false);
  }, [activeTab, loadingMore, pagination, fetchEvents]);

  const fetchCandidateMembers = useCallback(async (q: string) => {
    setLoadingCandidates(true);
    const url = `/api/mobile/v1/members?per_page=20${q.trim() ? `&search=${encodeURIComponent(q.trim())}` : '&status=active'}`;
    const res = await apiRequest<{ members: Member[] }>(url);
    if (res.ok) {
      setCandidateMembers(res.data.members || []);
    }
    setLoadingCandidates(false);
  }, []);

  const handleManualCheckIn = useCallback(async (memberId: number, type: 'ENTRY' | 'EXIT' = 'ENTRY') => {
    setCheckingInId(memberId);
    const res = await apiRequest<{ message: string }>('/api/mobile/v1/access/checkin', {
      method: 'POST',
      body: { member_id: memberId, type },
    });
    if (res.ok) {
      const msg = res.data?.message || (type === 'ENTRY' ? 'Member checked in successfully!' : 'Member checked out.');
      setActionMessage(msg);
      setTimeout(() => setActionMessage(null), 3500);
      setShowCheckInModal(false);
      void loadAll();
    } else {
      Alert.alert('Action Failed', res.error.message);
    }
    setCheckingInId(null);
  }, [loadAll]);

  const [quickUnlocking, setQuickUnlocking] = useState(false);

  const handleQuickUnlock = useCallback(async () => {
    if (quickUnlocking) return;
    setQuickUnlocking(true);
    const res = await apiRequest<{ pulse_seconds: number; message: string }>('/api/mobile/v1/access/remote-unlock', {
      method: 'POST',
      body: { pulse_seconds: 5 },
    });
    if (res.ok) {
      setActionMessage('Turnstile gate unlocked for 5 seconds!');
      setTimeout(() => {
        setQuickUnlocking(false);
        setActionMessage(null);
      }, 5000);
      void loadAll();
    } else {
      Alert.alert('Remote Unlock Failed', res.error.message || 'Could not unlock gate.');
      setQuickUnlocking(false);
    }
  }, [quickUnlocking, loadAll]);

  const [retryingSync, setRetryingSync] = useState(false);

  const handleRetrySync = useCallback(async () => {
    if (retryingSync) return;
    setRetryingSync(true);
    const res = await apiRequest<{ retried_count: number; message: string }>('/api/mobile/v1/access/retry-sync', {
      method: 'POST',
    });
    setRetryingSync(false);
    if (res.ok) {
      setActionMessage(res.data?.message || 'Commands queued for retry!');
      setTimeout(() => setActionMessage(null), 3500);
      void loadAll();
    } else {
      Alert.alert('Retry Failed', res.error.message || 'Could not retry syncs.');
    }
  }, [retryingSync, loadAll]);

  const renderActionBanner = () => {
    if (!actionMessage) return null;
    return (
      <View style={styles.actionBanner}>
        <Icon name="check" size={16} color={colors.success} />
        <Text style={styles.actionBannerText}>{actionMessage}</Text>
      </View>
    );
  };

  const renderFailedCommandsBanner = () => {
    if (!summary || !summary.failed_commands || summary.failed_commands === 0) return null;
    return (
      <View style={styles.failedCommandsCard}>
        <View style={styles.failedCommandsLeft}>
          <Icon name="alert" size={16} color={colors.warningDark} />
          <Text style={styles.failedCommandsText}>
            {summary.failed_commands} biometric command(s) failed
          </Text>
        </View>
        <TouchableOpacity
          style={styles.retrySyncBtn}
          onPress={handleRetrySync}
          disabled={retryingSync}
        >
          <Text style={styles.retrySyncBtnText}>
            {retryingSync ? 'Retrying...' : 'Retry All'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderCheckInButton = () => (
    <View style={styles.actionButtonRow}>
      <TouchableOpacity
        style={styles.checkInHalfBtn}
        onPress={() => {
          setShowCheckInModal(true);
          void fetchCandidateMembers('');
        }}
        activeOpacity={0.8}
      >
        <Icon name="access" size={16} color={colors.textInverse} />
        <Text style={styles.checkInBtnText}>+ Check In</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.quickUnlockBtn, quickUnlocking && styles.quickUnlockBtnActive]}
        onPress={handleQuickUnlock}
        disabled={quickUnlocking}
        activeOpacity={0.8}
      >
        <Icon name="lock" size={16} color={quickUnlocking ? colors.successDark : colors.success} />
        <Text style={[styles.quickUnlockBtnText, quickUnlocking && styles.quickUnlockBtnTextActive]}>
          {quickUnlocking ? 'Unlocking (5s)...' : 'Open Gate (5s)'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  // ── Renders ──────────────────────────────────────────────────────

  const renderSummaryCards = () => {
    if (!summary) return null;
    return (
      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, { borderLeftColor: colors.success }]}>
          <Text style={[styles.summaryNumber, { color: colors.success }]}>
            {summary.inside_now}
          </Text>
          <Text style={styles.summaryLabel}>Inside Now</Text>
        </View>
        <View style={[styles.summaryCard, { borderLeftColor: colors.brand }]}>
          <Text style={[styles.summaryNumber, { color: colors.brand }]}>
            {summary.entries_today}
          </Text>
          <Text style={styles.summaryLabel}>Entries</Text>
        </View>
        <View style={[styles.summaryCard, { borderLeftColor: colors.warning }]}>
          <Text style={[styles.summaryNumber, { color: colors.warning }]}>
            {summary.exits_today}
          </Text>
          <Text style={styles.summaryLabel}>Exits</Text>
        </View>
      </View>
    );
  };

  const renderDeviceStatus = () => {
    if (!summary) return null;
    const online = summary.device_online;
    return (
      <View style={styles.deviceBar}>
        <View style={styles.deviceLeft}>
          <View style={[styles.statusDot, { backgroundColor: online ? colors.success : colors.critical }]} />
          <Text style={styles.deviceText}>
            {online ? 'Device Online' : 'Device Offline'}
          </Text>
          {summary.device_name ? (
            <Text style={styles.deviceName}> · {summary.device_name}</Text>
          ) : null}
        </View>
        <Text style={styles.deviceRight}>
          {summary.last_event_at ? `Last event: ${timeAgo(summary.last_event_at)}` : 'No events yet'}
        </Text>
      </View>
    );
  };

  const renderDeniedBanner = () => {
    if (!summary || summary.denied_today === 0) return null;
    return (
      <TouchableOpacity
        style={styles.deniedBanner}
        onPress={() => setActiveTab('denied')}
        activeOpacity={0.7}
      >
        <Icon name="alert" size={16} color={colors.critical} />
        <Text style={styles.deniedText}>
          {summary.denied_today} access denied event{summary.denied_today > 1 ? 's' : ''} today
        </Text>
        <Icon name="forward" size={14} color={colors.critical} />
      </TouchableOpacity>
    );
  };

  const renderLegacyBridgeBanner = () => {
    if (!summary?.has_legacy_events) return null;
    return (
      <View style={styles.legacyBanner}>
        <Icon name="info" size={16} color={colors.brand} />
        <Text style={styles.legacyBannerText}>
          {'Some scans show as "Check In" because the bridge software doesn\'t report entry/exit direction. Update your bridge agent to v2+ for full tracking.'}
        </Text>
      </View>
    );
  };

  const TABS: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'inside', label: 'Inside' },
    { key: 'entry', label: 'Entries' },
    { key: 'exit', label: 'Exits' },
    { key: 'denied', label: 'Denied' },
  ];

  const renderFilterTabs = () => (
    <View style={styles.tabRow}>
      {TABS.map((tab) => {
        const isActive = activeTab === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, isActive && styles.tabActive]}
            onPress={() => {
              setActiveTab(tab.key);
              setSearch('');
            }}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderEventItem = ({ item }: { item: AccessEvent }) => {
    const style = getEventTypeStyle(item.event_type);
    return (
      <View style={styles.eventCard}>
        <View style={styles.eventLeft}>
          <Avatar name={item.member_name || '?'} size={40} />
        </View>
        <View style={styles.eventCenter}>
          <Text style={styles.eventName} numberOfLines={1}>
            {item.member_name || 'Unknown Member'}
          </Text>
          <View style={styles.eventMeta}>
            <View style={[styles.eventBadge, { backgroundColor: style.bgColor, borderColor: style.borderColor }]}>
              <Text style={[styles.eventBadgeText, { color: style.color }]}>
                {style.label}
              </Text>
            </View>
            {item.membership_status === 'expired' && item.event_type === 'ACCESS_DENIED' ? (
              <Text style={styles.eventReason}>Membership expired</Text>
            ) : null}
          </View>
          <Text style={styles.eventTime}>
            {formatAccessTime(item.event_timestamp)}
          </Text>
        </View>
        <View style={styles.eventRight}>
          <Icon name={style.icon} size={18} color={style.color} />
        </View>
      </View>
    );
  };

  const renderInsideMemberItem = ({ item }: { item: InsideMember }) => (
    <View style={styles.eventCard}>
      <TouchableOpacity
        style={styles.eventLeft}
        onPress={() => onNavigateMemberDetail?.({ id: item.id, full_name: item.full_name, phone: item.phone, status: item.status } as any)}
      >
        <Avatar name={item.full_name} size={40} />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.eventCenter}
        onPress={() => onNavigateMemberDetail?.({ id: item.id, full_name: item.full_name, phone: item.phone, status: item.status } as any)}
      >
        <Text style={styles.eventName} numberOfLines={1}>
          {item.full_name}
        </Text>
        <Text style={styles.eventTime}>
          {item.entered_at ? `Since ${formatAccessTime(item.entered_at)}` : 'Inside'}
        </Text>
      </TouchableOpacity>
      <View style={styles.eventRight}>
        <TouchableOpacity
          style={[styles.smallCheckOutBtn, checkingInId === item.id && { opacity: 0.5 }]}
          disabled={checkingInId === item.id}
          onPress={() => void handleManualCheckIn(item.id, 'EXIT')}
        >
          <Text style={styles.smallCheckOutText}>
            {checkingInId === item.id ? '...' : 'Check Out'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderEmpty = () => {
    if (loading) return null;
    const message =
      activeTab === 'inside'
        ? 'No members are currently inside.'
        : activeTab === 'denied'
          ? 'No access denied events today.'
          : 'No access events today.';
    return (
      <View style={styles.emptyContainer}>
        <Icon name="shield" size={48} color={colors.muted} />
        <Text style={styles.emptyTitle}>{message}</Text>
        <Text style={styles.emptySubtitle}>
          {summary?.device_online
            ? 'Waiting for device events…'
            : 'Access device may be offline.'}
        </Text>
      </View>
    );
  };

  const renderFooter = () => {
    if (!loadingMore) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={colors.brand} />
      </View>
    );
  };

  // ── Main render ──────────────────────────────────────────────────

  if (error && !summary) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ErrorState message={error} onRetry={onRefresh} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Icon name="access" size={24} color={colors.brand} />
          <Text style={styles.headerTitle}>Live Access</Text>
        </View>
        {summary && (
          <View style={styles.headerRight}>
            <View style={[styles.statusDot, { backgroundColor: summary.device_online ? colors.success : colors.critical }]} />
            <Text style={[styles.headerStatus, { color: summary.device_online ? colors.success : colors.critical }]}>
              {summary.device_online ? 'Live' : 'Offline'}
            </Text>
          </View>
        )}
      </View>

      {/* Content */}
      {activeTab === 'inside' ? (
        <FlatList
          data={insideMembers}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderInsideMemberItem}
          ListHeaderComponent={
            <>
              {renderActionBanner()}
              {renderSummaryCards()}
              {renderCheckInButton()}
              {renderDeviceStatus()}
              {renderFailedCommandsBanner()}
              {renderDeniedBanner()}
              {renderLegacyBridgeBanner()}
              {renderFilterTabs()}
              {/* Search */}
              <View style={styles.searchContainer}>
                <Icon name="search" size={16} color={colors.muted} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search members…"
                  placeholderTextColor={colors.muted}
                  value={search}
                  onChangeText={setSearch}
                />
                {search ? (
                  <TouchableOpacity onPress={() => setSearch('')}>
                    <Icon name="close" size={16} color={colors.muted} />
                  </TouchableOpacity>
                ) : null}
              </View>
            </>
          }
          ListEmptyComponent={renderEmpty}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
          }
        />
      ) : (
        <FlatList
          data={events}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderEventItem}
          ListHeaderComponent={
            <>
              {renderActionBanner()}
              {renderSummaryCards()}
              {renderCheckInButton()}
              {renderDeviceStatus()}
              {renderFailedCommandsBanner()}
              {renderDeniedBanner()}
              {renderLegacyBridgeBanner()}
              {renderFilterTabs()}
              {/* Search */}
              <View style={styles.searchContainer}>
                <Icon name="search" size={16} color={colors.muted} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search by member name…"
                  placeholderTextColor={colors.muted}
                  value={search}
                  onChangeText={setSearch}
                />
                {search ? (
                  <TouchableOpacity onPress={() => setSearch('')}>
                    <Icon name="close" size={16} color={colors.muted} />
                  </TouchableOpacity>
                ) : null}
              </View>
            </>
          }
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
          contentContainerStyle={styles.listContent}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.3}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
          }
        />
      )}

      {/* Manual Check In Modal */}
      <Modal visible={showCheckInModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Manual Check In</Text>
              <TouchableOpacity onPress={() => setShowCheckInModal(false)}>
                <Icon name="close" size={20} color={colors.muted} />
              </TouchableOpacity>
            </View>
            <View style={styles.modalSearchBox}>
              <Icon name="search" size={16} color={colors.muted} />
              <TextInput
                style={styles.modalSearchInput}
                placeholder="Search member by name or phone..."
                placeholderTextColor={colors.muted}
                value={checkInSearch}
                onChangeText={(t) => {
                  setCheckInSearch(t);
                  void fetchCandidateMembers(t);
                }}
              />
            </View>
            <FlatList
              data={candidateMembers}
              keyExtractor={(item) => String(item.id)}
              style={{ maxHeight: 350 }}
              renderItem={({ item }) => (
                <View style={styles.candidateRow}>
                  <Avatar name={item.full_name} size={36} />
                  <View style={{ flex: 1, marginLeft: spacing.sm }}>
                    <Text style={styles.candidateName} numberOfLines={1}>{item.full_name}</Text>
                    <Text style={styles.candidatePhone}>{item.phone}{item.plan ? ` · ${item.plan.name}` : ''}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.candidateCheckInBtn}
                    disabled={checkingInId === item.id}
                    onPress={() => void handleManualCheckIn(item.id, 'ENTRY')}
                  >
                    <Text style={styles.candidateCheckInBtnText}>
                      {checkingInId === item.id ? 'Checking...' : 'Check In'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
              ListEmptyComponent={
                loadingCandidates ? (
                  <ActivityIndicator style={{ padding: spacing.lg }} color={colors.brand} />
                ) : (
                  <Text style={styles.modalEmptyText}>No active members found.</Text>
                )
              }
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.background,
    flex: 1,
  },
  header: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  headerTitle: {
    color: colors.text,
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.bold,
    letterSpacing: -0.3,
  },
  headerRight: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  headerStatus: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: spacing.bottomTabSafe,
  },

  // Summary cards
  summaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderLeftWidth: 3,
    borderRadius: radius.md,
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...shadows.sm,
  },
  summaryNumber: {
    fontSize: fontSize['4xl'],
    fontWeight: fontWeight.bold,
    letterSpacing: -0.5,
  },
  summaryLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    marginTop: spacing.xxs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Action banner
  actionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  actionBannerText: {
    color: colors.successDark,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },

  // Action Buttons (Check In + Quick Unlock)
  actionButtonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  checkInHalfBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    ...shadows.sm,
  },
  checkInBtnText: {
    color: colors.textInverse,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  quickUnlockBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderColor: colors.success,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    ...shadows.sm,
  },
  quickUnlockBtnActive: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successDark,
  },
  quickUnlockBtnText: {
    color: colors.success,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  quickUnlockBtnTextActive: {
    color: colors.successDark,
  },

  // Failed commands / hardware health
  failedCommandsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  failedCommandsLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
  },
  failedCommandsText: {
    color: colors.warningDark,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    flexShrink: 1,
  },
  retrySyncBtn: {
    backgroundColor: colors.warning,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xxs + 2,
    marginLeft: spacing.xs,
  },
  retrySyncBtnText: {
    color: colors.textInverse,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },

  // Device status bar
  deviceBar: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...shadows.sm,
  },
  deviceLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  statusDot: {
    borderRadius: 5,
    height: 8,
    width: 8,
  },
  deviceText: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  deviceName: {
    color: colors.muted,
    fontSize: fontSize.xs,
  },
  deviceRight: {
    color: colors.muted,
    fontSize: fontSize.xs,
  },

  // Denied banner
  deniedBanner: {
    alignItems: 'center',
    backgroundColor: colors.criticalSurface,
    borderColor: colors.criticalBorder,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  deniedText: {
    color: colors.critical,
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },

  // Filter tabs
  tabRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  tab: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  tabActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  tabText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  tabTextActive: {
    color: colors.textInverse,
  },

  // Search
  searchContainer: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  searchInput: {
    color: colors.text,
    flex: 1,
    fontSize: fontSize.base,
    paddingVertical: spacing.xs,
  },

  // Event card
  eventCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.borderLight,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  eventLeft: {},
  eventCenter: {
    flex: 1,
  },
  eventRight: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventName: {
    color: colors.text,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  eventMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xxs,
  },
  eventBadge: {
    borderRadius: radius.xs,
    borderWidth: 1,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 1,
  },
  eventBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.5,
  },
  eventReason: {
    color: colors.critical,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  eventTime: {
    color: colors.muted,
    fontSize: fontSize.xs,
    marginTop: spacing.xxs,
  },

  // Empty state
  emptyContainer: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xxxl,
    paddingVertical: spacing.section,
  },
  emptyTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    textAlign: 'center',
  },
  emptySubtitle: {
    color: colors.muted,
    fontSize: fontSize.md,
    textAlign: 'center',
  },

  // Footer loader
  footerLoader: {
    paddingVertical: spacing.lg,
  },

  // Legacy bridge info banner
  legacyBanner: {
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  legacyBannerText: {
    color: '#1E40AF',
    flex: 1,
    fontSize: fontSize.xs,
    lineHeight: 16,
  },
  smallCheckOutBtn: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  smallCheckOutText: {
    color: colors.text,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  modalOverlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  modalTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  modalSearchBox: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  modalSearchInput: {
    flex: 1,
    height: 40,
    fontSize: fontSize.base,
    color: colors.text,
    marginLeft: spacing.xs,
  },
  candidateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  candidateName: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  candidatePhone: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  candidateCheckInBtn: {
    backgroundColor: colors.brand,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  candidateCheckInBtnText: {
    color: colors.textInverse,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  modalEmptyText: {
    textAlign: 'center',
    color: colors.muted,
    padding: spacing.lg,
    fontSize: fontSize.sm,
  },
});

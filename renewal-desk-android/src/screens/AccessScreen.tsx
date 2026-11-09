import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveEffect } from '../hooks/useLiveEffect';
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
import { MemberPickerModal, type PickerPerson } from '../components/MemberPickerModal';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing, fontFamily} from '../theme/tokens';
import { apiRequest, getCachedSession } from '../services/apiClient';
import { resolveAccessRowTap, buildQuickAssignBody } from '../services/accessRowTap';
import { resolveAccessListView, shouldShowFeedErrorBanner, switchAccessTab } from '../services/accessFeedState';
import { accessOwnerControls, isOwnerRole } from '../services/roleAccess';
import {
  cancelQueuedAdmsCommand,
  clearFailedSyncsWithConfirm,
  reconcileMembers,
} from '../services/accessSync';
import {
  retrySkippedSummary,
  type RetrySyncResult,
} from '../services/retrySkipReasons';
import type {
  AccessEvent,
  AccessEventsResponse,
  AccessSummary,
  Member,
  Pagination,
} from '../types';
import { formatDate, formatShortDate, formatTime } from '../types';

// ─── Types ───────────────────────────────────────────────────────────

type FilterTab = 'all' | 'entry' | 'exit' | 'denied';

type AccessScreenProps = {
  onBack?: () => void;
  onNavigateMemberDetail?: (member: any) => void;
  onLogout?: () => void;
  refreshToken?: number;
};

// ─── Helper ──────────────────────────────────────────────────────────

/** Punch/event times in the gym's timezone (never the device timezone). */
function formatAccessTime(isoString: string): string {
  const isToday = formatDate(isoString) === formatDate(new Date().toISOString());
  const timeStr = formatTime(isoString);
  if (isToday) return `Today, ${timeStr}`;
  return `${formatShortDate(isoString)}, ${timeStr}`;
}

/** Defence against duplicate feed rows: same terminal + same member + same punch instant.
 * The terminal discriminator is device_name — the event payload carries no
 * device serial/terminal ID, so two terminals reporting the same member at
 * the same second must not collapse into one row. */
function dedupeEvents(events: AccessEvent[]): AccessEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    // V4-L24: the key must include the event kind — an ENTRY and an EXIT
    // (or ATTENDANCE) for the same member at the same second are distinct
    // punches and must not collapse into one row.
    const key = `${event.device_name ?? ''}:${event.member_id ?? event.device_enroll_number}:${event.event_timestamp}:${event.event_type}:${event.direction ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  // V6-L33: a failed summary fetch used to be fully silent — the 15 s
  // poll kept failing while last-good counts rendered as live. Track the
  // failure and the last good update so the screen can say so.
  const [summaryStale, setSummaryStale] = useState(false);
  const [summaryUpdatedAt, setSummaryUpdatedAt] = useState<number | null>(null);
  // V10-L26: V6-L33 only covered the stale-last-good case — a first-load
  // summary failure (no summary at all) stayed fully silent: no cards,
  // no device status, no failed-commands banner, no error, no retry.
  const [summaryError, setSummaryError] = useState<string | undefined>();
  // V10-M6: keep the last Retry All response so its skip breakdown
  // renders under the failed-commands card (not the 3.5 s banner).
  const [lastRetryResult, setLastRetryResult] = useState<RetrySyncResult | null>(null);
  // V10-L33: per-row cancel in flight for a queued ADMS command.
  const [cancellingCommandId, setCancellingCommandId] = useState<number | null>(null);
  const [events, setEvents] = useState<AccessEvent[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  // V4-M15: the feed search is debounced — the raw keystrokes only
  // update the input; fetches run against this settled value, 350 ms after
  // the user stops typing (same pattern as the check-in modal below).
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const [showCheckInModal, setShowCheckInModal] = useState(false);
  const [checkInSearch, setCheckInSearch] = useState('');
  const [candidateMembers, setCandidateMembers] = useState<Member[]>([]);
  // V10-L35: a candidate-search failure used to keep the previous
  // query's members on screen as if they matched — a wrong-member
  // check-in one tap away.
  const [candidateSearchError, setCandidateSearchError] = useState<string | undefined>();
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [checkingInId, setCheckingInId] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  // V9-L25: tap-to-assign — the terminal ID of the Unknown row whose
  // member picker is open, or null. Named rows navigate to the member
  // instead (handleEventRowPress).
  const [assignBioId, setAssignBioId] = useState<string | null>(null);
  const [linkingAssign, setLinkingAssign] = useState(false);

  // V7-L13: Clear-failed (POST /access/clear-failed) and remote-unlock
  // (POST /access/remote-unlock) are owner-only — they rendered for staff
  // and 403'd with a generic message. Backend enforcement was always
  // correct; hide the dead buttons instead.
  const isOwner = isOwnerRole(getCachedSession()?.userRole);
  const ownerControls = accessOwnerControls(isOwner);

  // ── Fetch summary ────────────────────────────────────────────────

  const fetchSummary = useCallback(async () => {
    const res = await apiRequest<AccessSummary>('/api/mobile/v1/access/summary');
    if (res.ok) {
      setSummary(res.data);
      setSummaryStale(false);
      setSummaryError(undefined);
      setSummaryUpdatedAt(Date.now());
    } else {
      // V6-L33: keep the last-good stats but mark them stale — never
      // render them as live with no signal. V10-L26: also remember the
      // failure itself so a first load with no summary can show an
      // inline error + retry instead of an empty, silent screen.
      setSummaryStale(true);
      setSummaryError(res.error.message);
    }
  }, []);

  // ── Fetch events ─────────────────────────────────────────────────

  // V4-M15: sequence guard — only the latest feed request may apply
  // its results, so a slow response for an old query can never overwrite
  // newer results (same pattern as the check-in candidate fetch below).
  const eventsSeqRef = useRef(0);

  const fetchEvents = useCallback(
    async (page = 1, append = false) => {
      const seq = ++eventsSeqRef.current;
      const typeParam =
        activeTab === 'entry' ? '&type=entry' :
        activeTab === 'exit' ? '&type=exit' :
        activeTab === 'denied' ? '&type=denied' : '';
      const searchParam = debouncedSearch.trim() ? `&search=${encodeURIComponent(debouncedSearch.trim())}` : '';
      const url = `/api/mobile/v1/access/events?page=${page}&per_page=25&date=today${typeParam}${searchParam}`;

      const res = await apiRequest<AccessEventsResponse>(url);
      if (seq !== eventsSeqRef.current) return;
      if (res.ok) {
        if (append) {
          setEvents((prev) => dedupeEvents([...prev, ...res.data.events]));
        } else {
          setEvents(dedupeEvents(res.data.events));
        }
        setPagination(res.data.pagination);
        setError(undefined);
      } else {
        if (!append) setError(res.error.message);
      }
    },
    [activeTab, debouncedSearch],
  );

  // ── Initial + refresh load ───────────────────────────────────────

  const loadAll = useCallback(async () => {
    await Promise.all([
      fetchSummary(),
      fetchEvents(1),
    ]);
    setLoading(false);
  }, [fetchSummary, fetchEvents]);

  // V4-M15: settle the shared search 350 ms after the last keystroke so
  // the feed fetches fire once per pause in typing, not once per
  // keystroke. Clearing the box settles immediately (tab switch / X tap
  // must not wait out the debounce with a stale query).
  useEffect(() => {
    if (!search.trim()) {
      setDebouncedSearch('');
      return;
    }
    const timer = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  useLiveEffect(() => {
    let cancelled = false;
    const run = async () => {
      await Promise.all([
        fetchSummary(),
        fetchEvents(1),
      ]);
      if (!cancelled) {
        setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [activeTab, fetchEvents, fetchSummary, refreshToken], 15000);

  // ── Pull-to-refresh ──────────────────────────────────────────────

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [loadAll]);

  // ── Load more (pagination) ───────────────────────────────────────

  const onEndReached = useCallback(async () => {
    if (loadingMore) return;
    if (
      !pagination ||
      pagination.page >= pagination.total_pages
    )
      return;
    setLoadingMore(true);
    await fetchEvents(pagination.page + 1, true);
    setLoadingMore(false);
  }, [activeTab, loadingMore, pagination, fetchEvents]);

  // Sequence guard: only the latest search may apply its results, so a
  // slow earlier request can never overwrite a newer one.
  const candidateSearchSeqRef = useRef(0);

  const fetchCandidateMembers = useCallback(async (q: string) => {
    const seq = ++candidateSearchSeqRef.current;
    setLoadingCandidates(true);
    // V4-M16: status=active stays in the query when typing — dropping it
    // let paused members appear and be checked in, bypassing the freeze
    // (the backend denies expired members but not paused ones).
    const url = `/api/mobile/v1/members?per_page=20&status=active${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`;
    const res = await apiRequest<{ members: Member[] }>(url);
    if (seq !== candidateSearchSeqRef.current) return;
    if (res.ok) {
      setCandidateMembers(res.data.members || []);
      setCandidateSearchError(undefined);
    } else {
      // V10-L35: never present a stale list as the new query's results.
      setCandidateMembers([]);
      setCandidateSearchError(res.error.message);
    }
    setLoadingCandidates(false);
  }, []);

  // Manual check-in search is debounced 350ms — one request per pause in
  // typing, not one per keystroke. Fires on open too (current query).
  useEffect(() => {
    if (!showCheckInModal) return;
    const timer = setTimeout(() => {
      void fetchCandidateMembers(checkInSearch);
    }, 350);
    return () => clearTimeout(timer);
  }, [checkInSearch, showCheckInModal, fetchCandidateMembers]);

  const handleManualCheckIn = useCallback(async (memberId: number, type: 'ENTRY' | 'EXIT' = 'ENTRY') => {
    setCheckingInId(memberId);
    const res = await apiRequest<AccessEvent>('/api/mobile/v1/access/checkin', {
      method: 'POST',
      body: { member_id: memberId, type },
    });
    if (res.ok) {
      // V5-M13: the backend returns HTTP 200 success:true even when it
      // DENIED the check-in (expired/paused member tapped from a stale
      // list). The denial rides in data.event_type plus the top-level
      // message — a hardcoded "checked in successfully!" banner here
      // made staff believe a denied member was admitted.
      if (res.data?.event_type === 'ACCESS_DENIED') {
        Alert.alert(
          'Access denied',
          res.message || 'This member cannot check in — their membership is expired or paused.',
        );
      } else {
        const msg = res.message || (type === 'ENTRY' ? 'Member checked in successfully!' : 'Member checked out.');
        setActionMessage(msg);
        setTimeout(() => setActionMessage(null), 3500);
        setShowCheckInModal(false);
        void loadAll();
      }
    } else {
      Alert.alert('Action Failed', res.error.message);
    }
    setCheckingInId(null);
  }, [loadAll]);

  const requestRemoteUnlock = useCallback(async () => {
    if (unlocking) return;
    setUnlocking(true);
    const res = await apiRequest<{ command_id: number; message: string }>(
      '/api/mobile/v1/access/remote-unlock',
      { method: 'POST', body: { delay_seconds: 5, confirm: true } },
    );
    setUnlocking(false);
    if (res.ok) {
      setActionMessage(res.data.message || 'Unlock command queued; waiting for terminal acknowledgement.');
      setTimeout(() => setActionMessage(null), 5000);
      void fetchSummary();
    } else {
      Alert.alert('Unlock Not Sent', res.error.message);
    }
  }, [fetchSummary, unlocking]);

  const handleRemoteUnlock = useCallback(() => {
    Alert.alert(
      'Unlock gym gate?',
      'This sends a 5-second unlock command to the connected terminal.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unlock', onPress: () => void requestRemoteUnlock() },
      ],
    );
  }, [requestRemoteUnlock]);

  // ── V9-L25: feed row taps ───────────────────────────────────────
  // Named rows open the member;
  // Unknown rows open the assign picker — the PWA quick-assign flow
  // (pick a member → link the terminal ID via bulk-resolve, feed
  // refreshes to show the name). Rows with neither do nothing.

  const handleEventRowPress = useCallback((item: AccessEvent) => {
    const tap = resolveAccessRowTap(item);
    if (tap.kind === 'member') {
      onNavigateMemberDetail?.(tap.member as any);
    } else if (tap.kind === 'assign') {
      setAssignBioId(tap.bioId);
    }
  }, [onNavigateMemberDetail]);

  /** Server-side member search for the assign picker (q=, 20/page) —
   * same endpoint shape as the RrrGrowthScreen mapping picker. */
  const searchMembersForAssign = useCallback(async (query: string): Promise<PickerPerson[]> => {
    const q = query.trim();
    const url = q
      ? `/api/mobile/v1/members?q=${encodeURIComponent(q)}&page_size=20`
      : '/api/mobile/v1/members?page=1&page_size=20';
    const res = await apiRequest<{ members: PickerPerson[] }>(url);
    return res.ok ? (res.data.members || []) : [];
  }, []);

  const handleAssignSelect = useCallback(async (person: PickerPerson) => {
    // Double-tap guard (PWA V3-L21): a second tap must not fire the
    // link twice.
    if (linkingAssign || !assignBioId) return;
    setLinkingAssign(true);
    const bioId = assignBioId;
    const res = await apiRequest<{ linked: number; total: number }>(
      '/api/mobile/v1/rrr/mappings/bulk-resolve',
      { method: 'POST', body: buildQuickAssignBody(bioId, person.id) },
    );
    setLinkingAssign(false);
    if (res.ok && res.data.linked === 1) {
      setAssignBioId(null);
      setActionMessage(`Biometric ID ${bioId} linked to ${person.full_name}.`);
      setTimeout(() => setActionMessage(null), 3500);
      void loadAll();
    } else {
      Alert.alert('Link failed', res.ok ? 'Could not link this ID — try again.' : res.error.message);
    }
  }, [linkingAssign, assignBioId, loadAll]);

  const [retryingSync, setRetryingSync] = useState(false);

  const handleRetrySync = useCallback(async () => {
    if (retryingSync) return;
    setRetryingSync(true);
    // V10-M6: keep the full response — the backend returns the skip
    // breakdown (skipped: [{command_id, reason}], skipped_count) and
    // the PWA renders it under the banner. The old code typed only
    // { retried_count, message } and showed it in a banner that
    // cleared in 3.5 s, so the owner never learned WHY a retry skipped.
    // Clear any stale result at the start of a new attempt (PWA
    // V10-L15 lesson: a result card must not outlive its commands).
    setLastRetryResult(null);
    const res = await apiRequest<RetrySyncResult>('/api/mobile/v1/access/retry-sync', {
      method: 'POST',
    });
    setRetryingSync(false);
    if (res.ok) {
      setLastRetryResult(res.data);
      setActionMessage(res.data?.message || 'Commands queued for retry!');
      setTimeout(() => setActionMessage(null), 3500);
      void loadAll();
    } else {
      Alert.alert('Retry Failed', res.error.message || 'Could not retry syncs.');
    }
  }, [retryingSync, loadAll]);

  // V10-L33: cancel one queued Direct ADMS command (POST
  // /access/adms-commands/<id>/cancel, owner-only, queued rows only).
  // A stuck queued unlock wedges the whole ADMS pipe; until now no
  // client surfaced it. On success, refresh the summary so the row
  // disappears from the queued list.
  const handleCancelQueuedCommand = useCallback(async (commandId: number) => {
    if (cancellingCommandId !== null) return;
    setCancellingCommandId(commandId);
    const res = await cancelQueuedAdmsCommand(apiRequest, commandId);
    setCancellingCommandId(null);
    if (res.ok) {
      setActionMessage(res.data?.message || 'Queued command cancelled.');
      setTimeout(() => setActionMessage(null), 3500);
      void fetchSummary();
    } else {
      Alert.alert('Could not cancel', res.error.message || 'This command can no longer be cancelled.');
      void fetchSummary();
    }
  }, [cancellingCommandId, fetchSummary]);

  const [reconciling, setReconciling] = useState(false);

  // PWA parity: "Re-sync Members" (POST /access/reconcile) — re-sync all
  // active members' access states to the biometric device.
  const handleReconcile = useCallback(async () => {
    if (reconciling) return;
    setReconciling(true);
    const res = await reconcileMembers(apiRequest);
    setReconciling(false);
    if (res.ok) {
      setActionMessage(res.data?.message || 'Re-sync queued for device');
      setTimeout(() => setActionMessage(null), 3500);
      void loadAll();
    } else {
      Alert.alert('Re-sync Failed', res.error.message || 'Re-sync failed.');
    }
  }, [reconciling, loadAll]);

  const [clearingFailed, setClearingFailed] = useState(false);

  // PWA parity: "Clear" failed syncs (POST /access/clear-failed).
  // V10-M7: the confirm wording branches on the gym type, exactly like
  // the PWA (access.js:439-442). ADMS rows are marked cleared and their
  // history is kept — "permanently delete … cannot be undone" is only
  // true for the legacy bridge path, and the scary wording discouraged
  // the exact tap that resolves the stuck failed-commands banner.
  const handleClearFailedSyncs = useCallback(() => {
    if (clearingFailed) return;
    setClearingFailed(true);
    void (async () => {
      try {
        const res = await clearFailedSyncsWithConfirm({
          confirm: () =>
            new Promise<boolean>((resolve) => {
              Alert.alert(
                'Clear failed syncs?',
                summary?.adms_integration_id
                  ? 'Clear all failed biometric commands? They will be marked cleared and hidden from this list (their history is kept).'
                  : 'Permanently delete all failed biometric commands? This cannot be undone.',
                [
                  { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                  { text: 'Clear', style: 'destructive', onPress: () => resolve(true) },
                ],
              );
            }),
          request: apiRequest,
        });
        if (res === null) return; // operator cancelled — nothing to do
        if (res.ok) {
          // The retry result described the rows just cleared — it must
          // not outlive them (PWA V10-L15 lesson).
          setLastRetryResult(null);
          setActionMessage(res.data?.message || 'Failed commands cleared');
          setTimeout(() => setActionMessage(null), 3500);
          void loadAll();
        } else {
          Alert.alert('Clear Failed', res.error.message || 'Could not clear commands.');
        }
      } finally {
        setClearingFailed(false);
      }
    })();
  }, [clearingFailed, loadAll, summary?.adms_integration_id]);

  const renderActionBanner = () => {
    if (!actionMessage) return null;
    return (
      <View style={styles.actionBanner}>
        <Icon name="check" size={16} color={colors.success} />
        <Text style={styles.actionBannerText}>{actionMessage}</Text>
      </View>
    );
  };

  // V7-M10: a feed fetch failure used to be invisible once the
  // summary loaded — `error` only rendered via the `error && !summary`
  // full-screen gate, so staff stared at stale rows with no signal.
  // Show an inline banner + retry above the stale list whenever the
  // feed fetch failed.
  const renderFeedErrorBanner = () => {
    const itemCount = events.length;
    if (!shouldShowFeedErrorBanner({ error, summaryLoaded: !!summary, itemCount })) return null;
    return (
      <View style={styles.feedErrorBanner}>
        <Icon name="alert" size={16} color={colors.critical} />
        <Text style={styles.feedErrorText}>
          Couldn&apos;t load the latest events — showing last loaded data. {error}
        </Text>
        <TouchableOpacity style={styles.feedErrorRetryBtn} onPress={onRefresh} activeOpacity={0.7}>
          <Text style={styles.feedErrorRetryText}>Retry</Text>
        </TouchableOpacity>
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
        <View style={styles.failedCommandsActions}>
          <TouchableOpacity
            style={styles.retrySyncBtn}
            onPress={handleRetrySync}
            disabled={retryingSync}
          >
            <Text style={styles.retrySyncBtnText}>
              {retryingSync ? 'Retrying...' : 'Retry All'}
            </Text>
          </TouchableOpacity>
          {/* V7-L13: Clear is owner-only (POST /access/clear-failed) — hide it for staff. */}
          {ownerControls.showClearFailed ? (
            <TouchableOpacity
              style={styles.clearFailedBtn}
              onPress={handleClearFailedSyncs}
              disabled={clearingFailed}
            >
              <Text style={styles.clearFailedBtnText}>
                {clearingFailed ? 'Clearing...' : 'Clear'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  };

  // V10-L26: first-load summary failure — no summary at all — used to
  // render the feed with no cards, no device status, no failed-commands
  // banner and no error. Mirror the feed-error banner: an inline error
  // + retry above the feed whenever there is no summary to show.
  const renderSummaryErrorBanner = () => {
    if (summary || !summaryError) return null;
    return (
      <View style={styles.feedErrorBanner}>
        <Icon name="alert" size={16} color={colors.critical} />
        <Text style={styles.feedErrorText}>
          Couldn&apos;t load live access stats — the failed-commands list and device status are hidden. {summaryError}
        </Text>
        <TouchableOpacity style={styles.feedErrorRetryBtn} onPress={onRefresh} activeOpacity={0.7}>
          <Text style={styles.feedErrorRetryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  };

  // V10-M6: the last Retry All result, kept in state (not the
  // auto-clearing banner) with the grouped skip breakdown, mirroring
  // the PWA (access.js:292-295). Labels live in
  // services/retrySkipReasons with explicit plurals.
  const renderRetryResult = () => {
    if (!lastRetryResult) return null;
    const skippedCount = lastRetryResult.skipped_count ?? 0;
    return (
      <View style={styles.retryResultCard}>
        <Text style={styles.retryResultTitle}>
          Retry All result: {lastRetryResult.retried_count ?? 0} queued
          {skippedCount ? `, ${skippedCount} skipped` : ''}
        </Text>
        {skippedCount > 0 ? (
          <Text style={styles.retryResultText}>
            Skipped — {retrySkippedSummary(lastRetryResult.skipped)}.
          </Text>
        ) : null}
      </View>
    );
  };

  // V10-L33: queued Direct ADMS commands from the summary payload,
  // with a per-row Cancel (owner-only endpoint). Renders nothing when
  // the backend does not send the field yet (older backend) or when
  // nothing is queued — the failed-commands banner only ever showed
  // failed rows, so a stuck queued unlock was invisible until now.
  const renderQueuedCommands = () => {
    const queued = summary?.queued_adms_commands;
    if (!queued || !queued.count || !queued.commands?.length) return null;
    return (
      <View style={styles.queuedCommandsCard}>
        <Text style={styles.queuedCommandsTitle}>
          {queued.count} queued Direct ADMS command{queued.count > 1 ? 's' : ''}
        </Text>
        {queued.commands.map((cmd) => (
          <View key={cmd.id} style={styles.queuedCommandRow}>
            <View style={styles.queuedCommandInfo}>
              <Text style={styles.queuedCommandAction}>{cmd.action}</Text>
              <Text style={styles.queuedCommandMeta}>
                {cmd.enroll_number ? `ID ${cmd.enroll_number}` : 'No terminal ID'}
                {cmd.queued_at ? ` · queued ${timeAgo(cmd.queued_at)}` : ''}
              </Text>
            </View>
            {ownerControls.showClearFailed ? (
              <TouchableOpacity
                style={styles.queuedCancelBtn}
                onPress={() => void handleCancelQueuedCommand(cmd.id)}
                disabled={cancellingCommandId === cmd.id}
                activeOpacity={0.7}
              >
                <Text style={styles.queuedCancelBtnText}>
                  {cancellingCommandId === cmd.id ? 'Cancelling…' : 'Cancel'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ))}
      </View>
    );
  };

  // PWA parity: "Hardware Bridge Controls" card with Re-sync Members.
  // Bridge-only — Direct Cloud (ADMS) gyms have no legacy bridge queue to
  // re-sync, exactly as the PWA hides this card when adms_integration_id
  // is set. (The backend reconcile endpoint would 403 for an
  // uncommissioned ADMS gym, so hiding it also avoids a dead button.)
  const renderBridgeControls = () => {
    if (!summary || summary.adms_integration_id) return null;
    return (
      <View style={styles.bridgeControlsCard}>
        <View style={styles.bridgeControlsHeader}>
          <Text style={styles.bridgeControlsTitle}>Hardware Bridge Controls</Text>
          <View style={[styles.bridgeStatusPill, { backgroundColor: summary.bridge_online ? colors.successSurface : colors.criticalSurface }]}>
            <Text style={[styles.bridgeStatusPillText, { color: summary.bridge_online ? colors.success : colors.critical }]}>
              {summary.bridge_online ? 'BRIDGE ONLINE' : 'BRIDGE OFFLINE'}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.reconcileBtn}
          onPress={handleReconcile}
          disabled={reconciling}
          activeOpacity={0.8}
        >
          <Icon name="refresh" size={16} color={colors.text} />
          <Text style={styles.reconcileBtnText}>
            {reconciling ? 'Syncing...' : 'Re-sync Members'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderCheckInButton = () => (
    <View>
      <View style={styles.actionButtonRow}>
      <TouchableOpacity
        style={styles.checkInBtn}
        onPress={() => {
          setShowCheckInModal(true);
        }}
        activeOpacity={0.8}
      >
        <Icon name="access" size={16} color={colors.textInverse} />
        <Text style={styles.checkInBtnText}>+ Check In</Text>
      </TouchableOpacity>
      {summary?.remote_unlock_available && ownerControls.showRemoteUnlock ? (
        <TouchableOpacity
          style={[styles.checkInBtn, { backgroundColor: colors.success }]}
          onPress={handleRemoteUnlock}
          disabled={unlocking}
          activeOpacity={0.8}
        >
          <Icon name="lock" size={16} color={colors.textInverse} />
          <Text style={styles.checkInBtnText}>{unlocking ? 'Sending...' : 'Unlock Gate'}</Text>
        </TouchableOpacity>
      ) : null}
      </View>
      {!summary?.remote_unlock_available && (
        <Text style={styles.remoteUnlockNotice}>
          {summary?.remote_unlock_reason || 'Physical remote unlock is not commissioned for this controller.'}
        </Text>
      )}
    </View>
  );

  // ── Renders ──────────────────────────────────────────────────────

  const renderSummaryCards = () => {
    if (!summary) return null;
    return (
      <View style={styles.summaryRow}>
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

  // V6-L33: when the summary fetch fails, the last-good counts stay on
  // screen — say so, with when they were last fresh, instead of letting
  // stale stats pass as live.
  const renderSummaryStaleness = () => {
    if (!summary || !summaryStale) return null;
    return (
      <Text style={styles.staleNote}>
        Stats may be out of date
        {summaryUpdatedAt ? ` — last updated ${timeAgo(new Date(summaryUpdatedAt).toISOString())}` : ''}. Pull to refresh.
      </Text>
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
        onPress={() => {
          // V8-L35 (V7-M10 rule): the shortcut must clear the error and
          // the search exactly like a tab-row tap — setActiveTab alone
          // left the stale error over the denied list until its fetch
          // succeeded. Both paths share switchAccessTab so they cannot
          // drift apart again.
          const next = switchAccessTab('denied');
          setActiveTab(next.activeTab);
          setSearch(next.search);
          setError(next.error);
        }}
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
              // V7-M10: a feed error from the previous tab must not linger
              // over the new tab's list while its fetch is still in flight.
              // Shared with the denied-banner shortcut (V8-L35) via
              // switchAccessTab — one transition, both call sites.
              const next = switchAccessTab(tab.key);
              setActiveTab(next.activeTab);
              setSearch(next.search);
              setError(next.error);
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
    // Terminal ID for unmapped punches — the ADMS leg sends
    // biometric_user_id, the AccessEvent leg sends device_enroll_number.
    // Without it staff only see "Unknown Member" and can't tell IDs apart.
    const bioId = item.biometric_user_id || item.device_enroll_number;
    const isUnknown = !item.member_id && !!bioId;
    // V9-L25: feed rows are tappable — named rows open the member,
    // Unknown rows open tap-to-assign (same flow as the PWA).
    return (
      <TouchableOpacity
        style={styles.eventCard}
        onPress={() => handleEventRowPress(item)}
        activeOpacity={0.7}
      >
        <View style={styles.eventLeft}>
          <Avatar name={item.member_name || '?'} size={40} />
        </View>
        <View style={styles.eventCenter}>
          <Text style={styles.eventName} numberOfLines={1}>
            {item.member_id ? (item.member_name || 'Unknown Member') : (bioId ? `Unknown Member · ID ${bioId}` : 'Unknown Member')}
            {isUnknown ? <Text style={styles.tapToAssignHint}> · tap to assign</Text> : null}
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
      </TouchableOpacity>
    );
  };

  const renderEmpty = () => {
    if (loading) return null;
    // V7-M10: a failed feed fetch must never fall through to the
    // misleading "No access events today." empty state — show the
    // error + retry instead.
    if (resolveAccessListView({ loading, error, itemCount: events.length }) === 'error') {
      return (
        <View style={styles.emptyContainer}>
          <Icon name="alert" size={48} color={colors.critical} />
          <Text style={styles.emptyTitle}>Couldn&apos;t load access events.</Text>
          <Text style={styles.emptySubtitle}>{error}</Text>
          <TouchableOpacity style={styles.feedErrorRetryBtn} onPress={onRefresh} activeOpacity={0.7}>
            <Text style={styles.feedErrorRetryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    const message =
      activeTab === 'denied'
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
        <FlatList
          data={events}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderEventItem}
          ListHeaderComponent={
            <>
              {renderActionBanner()}
              {renderFeedErrorBanner()}
              {renderSummaryErrorBanner()}
              {renderSummaryCards()}
              {renderSummaryStaleness()}
              {renderCheckInButton()}
              {renderDeviceStatus()}
              {renderBridgeControls()}
              {renderFailedCommandsBanner()}
              {renderRetryResult()}
              {renderQueuedCommands()}
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
                onChangeText={setCheckInSearch}
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
                ) : candidateSearchError ? (
                  // V10-L35: the search leg failed — say so with a retry
                  // instead of "No active members found." over an empty
                  // (cleared) list.
                  <View style={styles.modalSearchError}>
                    <Text style={styles.modalSearchErrorText}>
                      Couldn&apos;t search members — {candidateSearchError}
                    </Text>
                    <TouchableOpacity
                      style={styles.feedErrorRetryBtn}
                      onPress={() => void fetchCandidateMembers(checkInSearch)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.feedErrorRetryText}>Retry</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={styles.modalEmptyText}>No active members found.</Text>
                )
              }
            />
          </View>
        </View>
      </Modal>

      {/* V9-L25: tap-to-assign — pick the member for an Unknown terminal
          ID; links via bulk-resolve, same endpoint as the PWA
          quick-assign sheet and the RrrGrowthScreen mapping picker. */}
      <MemberPickerModal
        visible={assignBioId !== null}
        title={assignBioId ? `Who is biometric ID ${assignBioId}?` : 'Assign biometric ID'}
        serverSearch={searchMembersForAssign}
        onSelect={(person) => void handleAssignSelect(person)}
        onClose={() => setAssignBioId(null)}
      />
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
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
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
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
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
  // V6-L33: staleness note under the summary cards.
  staleNote: {
    color: colors.warningDark,
    fontSize: fontSize.xs,
    marginHorizontal: spacing.lg,
    marginTop: spacing.xs,
  },

  // V7-M10: inline feed error banner + retry (above a stale list).
  feedErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.criticalSurface,
    borderColor: colors.criticalBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  feedErrorText: {
    color: colors.critical,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    flex: 1,
    flexShrink: 1,
  },
  feedErrorRetryBtn: {
    backgroundColor: colors.critical,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  feedErrorRetryText: {
    color: colors.textInverse,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
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

  // Action buttons
  actionButtonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  checkInBtn: {
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
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
  remoteUnlockNotice: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.xs,
    color: colors.muted,
    fontSize: fontSize.xs,
    lineHeight: 17,
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
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
  failedCommandsActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  clearFailedBtn: {
    backgroundColor: colors.criticalSurface,
    borderColor: colors.criticalBorder,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xxs + 2,
  },
  clearFailedBtnText: {
    color: colors.critical,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },

  // V10-M6: Retry All result card — kept in state, not the 3.5 s banner.
  retryResultCard: {
    backgroundColor: colors.surface,
    borderColor: colors.warningBorder,
    borderRadius: radius.md,
    borderWidth: 1,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  retryResultTitle: {
    color: colors.warningDark,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  retryResultText: {
    color: colors.muted,
    fontSize: fontSize.xs,
    marginTop: spacing.xxs,
  },

  // V10-L33: queued Direct ADMS commands with per-row Cancel.
  queuedCommandsCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...shadows.sm,
  },
  queuedCommandsTitle: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.xs,
  },
  queuedCommandRow: {
    alignItems: 'center',
    borderTopColor: colors.borderLight,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  queuedCommandInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  queuedCommandAction: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  queuedCommandMeta: {
    color: colors.muted,
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  queuedCancelBtn: {
    backgroundColor: colors.criticalSurface,
    borderColor: colors.criticalBorder,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xxs + 2,
  },
  queuedCancelBtnText: {
    color: colors.critical,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },

  // Hardware Bridge Controls (Re-sync Members) — PWA parity
  bridgeControlsCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...shadows.sm,
  },
  bridgeControlsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  bridgeControlsTitle: {
    color: colors.muted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  bridgeStatusPill: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  bridgeStatusPillText: {
    fontSize: 10,
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
  reconcileBtn: {
    alignItems: 'center',
    backgroundColor: colors.gray100,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  reconcileBtnText: {
    color: colors.text,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
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
  // V9-L25: hint on Unknown rows, same wording as the PWA feed.
  tapToAssignHint: {
    color: colors.brand,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
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
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
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
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
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
    fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold,
  },
  modalEmptyText: {
    textAlign: 'center',
    color: colors.muted,
    padding: spacing.lg,
    fontSize: fontSize.sm,
  },
  // V10-L35: inline candidate-search failure note + retry in the modal.
  modalSearchError: {
    alignItems: 'center',
    backgroundColor: colors.criticalSurface,
    borderColor: colors.criticalBorder,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  modalSearchErrorText: {
    color: colors.critical,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
});

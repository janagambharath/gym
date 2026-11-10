import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveEffect } from '../hooks/useLiveEffect';
import { Alert, Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiRequest, getCachedSession } from '../services/apiClient';
import { isOwnerRole, rrrGrowthOwnerSections } from '../services/roleAccess';
import { decommissionTerminal, replaceTerminal, restoreFingerprints, restoreQueuedCount, rotateAdmsToken, setAdmsSerialFallback } from '../services/admsIntegration';
import type { AdmsTerminalSettings } from '../services/admsIntegration';
import { colors, fontSize, fontWeight, radius, shadows, spacing, fontFamily} from '../theme/tokens';
import { formatDateTime, formatTime } from '../types';
import { MemberPickerModal, PickerPerson } from '../components/MemberPickerModal';
import { ErrorState } from '../components/ErrorState';
import { resolveRrrGrowthLoadError } from '../services/rrrGrowthLoad';
import { CardSkeleton, PillarCardSkeleton } from '../components/LoadingSkeleton';

type Opportunity = { id: number; pillar: string; status: string; reason: string; potential_revenue: string; member: { name: string } };
type Device = { id: number; name: string; serial_number: string; status: string; selected: boolean };
/** One distinct unmapped terminal ID, grouped server-side with punch counts. */
type UnresolvedGroup = {
  biometric_user_id: string;
  punch_count: number;
  latest_punch_time: string | null;
  first_punch_time: string | null;
  latest_event_id: number | null;
  source: string | null;
  device_serial: string | null;
};
type Integration = { id: number; type: 'adms_direct' | 'ebioserver' | 'direct_bridge'; status: string; device_name?: string; device_serial?: string; records_synced?: number; terminal_settings?: TerminalSettings; commands_enabled?: boolean; commissioning_status?: string; last_success_at?: string | null; last_seen_at?: string | null; allow_serial_fallback?: boolean };
type TerminalSettings = { server_mode?: string; server_address?: string; server_port?: number; https?: boolean; path?: string; warning?: string; token_present?: boolean; token_note?: string };
type Command = { id: number; action: string; status: string; result_code?: string };
type EnrollSuggestion = { enroll_number: string; terminal_name: string; member_id: number | null; member_name: string | null; member_phone?: string; confidence: number; ambiguous?: boolean; candidate_members?: { id: number; name: string; phone?: string }[] };
type EnrollMatches = { suggestions: EnrollSuggestion[]; unmatched_terminal: { enroll_number: string; terminal_name: string }[]; snapshot?: { terminal_user_count: number; source: string; acknowledged_at?: string } | null; error?: string };
type Payload = { opportunities: Opportunity[]; pillars: Record<string, { count: number; potential_revenue: string }>; unmapped_count: number; total_potential_revenue?: string; owner_confirmed_revenue?: string; members?: { total?: number; attendance_rate?: number } };
type OwnerToday = {
  collections: { total: string; expected_cash: string };
  cash_close: { closed: boolean; counted_cash?: string | null; variance?: string | null };
  actions: { title: string; detail: string; count: number; priority: string }[];
  follow_up_count: number;
  trials_today: { id: number; name?: string; trial_scheduled_for?: string | null }[];
};
const ruleFields = [['expiry_days', 'Expiry window'], ['no_visit_days', 'No visit'], ['attendance_drop_percent', 'Attendance decline'], ['recent_expiry_days', 'Recent expiry']] as const;
const tones = { revenue: { label: 'REVENUE', copy: 'Grow existing value', color: colors.success, surface: colors.successSurface }, retain: { label: 'RETAIN', copy: 'Protect recurring revenue', color: colors.warning, surface: colors.warningSurface }, recover: { label: 'RECOVER', copy: 'Bring members back', color: colors.critical, surface: colors.criticalSurface } } as const;

export function RrrGrowthScreen({ onBack, onNavigateBulkDeactivate, onNavigateOpportunities }: { onBack: () => void; onNavigateBulkDeactivate?: () => void; onNavigateOpportunities?: (pillar: 'revenue' | 'retain' | 'recover') => void }) {
  // V7-L13: provision / rotate / serial-fallback / device select / pairing
  // / test commands / commission / thresholds are owner-only — they rendered
  // for staff and 403'd with a generic message. Backend enforcement was
  // always correct; hide the dead controls instead (same pattern as the
  // BulkDeactivate link below). Mapping, scan/confirm, and the opportunity
  // Action/Recovered buttons are staff-allowed and stay visible.
  const isOwner = isOwnerRole(getCachedSession()?.userRole);
  const ownerSections = rrrGrowthOwnerSections(isOwner);
  const [data, setData] = useState<Payload>();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [commands, setCommands] = useState<Command[]>([]);
  const [unresolvedGroups, setUnresolvedGroups] = useState<UnresolvedGroup[]>([]);
  const [unresolvedPage, setUnresolvedPage] = useState(1);
  const [unresolvedTotalPages, setUnresolvedTotalPages] = useState(0);
  const [unresolvedTotal, setUnresolvedTotal] = useState(0);
  const [loadingMoreUnresolved, setLoadingMoreUnresolved] = useState(false);
  // Staged terminal-ID → member pairs, linked together via bulk-resolve.
  const [pendingMappings, setPendingMappings] = useState<Record<string, number>>({});
  const [pendingMappingNames, setPendingMappingNames] = useState<Record<string, string>>({});
  const [showBiometricLinkBanner, setShowBiometricLinkBanner] = useState(true);
  const [rules, setRules] = useState<Record<string, number>>({});
  const [ownerToday, setOwnerToday] = useState<OwnerToday>();
  const [pairingCode, setPairingCode] = useState('');
  const [rotatingToken, setRotatingToken] = useState(false);
  const [switchingSerial, setSwitchingSerial] = useState(false);
  // G1/G4 (v11): terminal replace / decommission / fingerprint restore.
  const [replacingTerminal, setReplacingTerminal] = useState(false);
  const [decommissioningTerminal, setDecommissioningTerminal] = useState(false);
  const [restoringFingerprints, setRestoringFingerprints] = useState(false);
  const [showReplaceForm, setShowReplaceForm] = useState(false);
  const [newSerial, setNewSerial] = useState('');
  const [newDeviceName, setNewDeviceName] = useState('');
  // Fresh terminal values after a token rotate — shown exactly once, never
  // re-fetched (the backend returns the token once by design).
  const [freshSettings, setFreshSettings] = useState<AdmsTerminalSettings | null>(null);
  const [serial, setSerial] = useState('');
  const [deviceName, setDeviceName] = useState('Elite Gym Entry');
  const [testUserId, setTestUserId] = useState('');
  const [testUserName, setTestUserName] = useState('');
  const [testMemberConfirmed, setTestMemberConfirmed] = useState(false);
  const [doorConfirmed, setDoorConfirmed] = useState(false);
  const [directDoorConfirmed, setDirectDoorConfirmed] = useState(false);
  const [commissioning, setCommissioning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pickerEvent, setPickerEvent] = useState<UnresolvedGroup | null>(null);
  const [matches, setMatches] = useState<EnrollMatches | null>(null);
  const [matchesError, setMatchesError] = useState<string | undefined>();
  // V6-L37: which terminal ID is mid-confirm, so a rapid double-tap
  // can't fire two /enroll-matches/confirm POSTs for the same pair.
  const [confirmingEnroll, setConfirmingEnroll] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // The terminal-scan poll must die when the screen unmounts / is navigated
  // away from — otherwise it keeps firing API calls for up to 60s.
  const stopScanTimer = useCallback(() => {
    if (scanTimerRef.current) {
      clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
  }, []);
  useEffect(() => () => stopScanTimer(), [stopScanTimer]);
  const [loading, setLoading] = useState(true);
  // V8-M14: dashboard/integrations load failure — without this the
  // screen rendered a failed load as an empty gym (0 Members · ₹0
  // pipeline) with the Direct Cloud card in "SET UP" state.
  const [loadError, setLoadError] = useState<string | undefined>();
  const [recoveryTarget, setRecoveryTarget] = useState<Opportunity | null>(null);
  const [outcomeAmount, setOutcomeAmount] = useState('');
  const [now, setNow] = useState(0);
  const direct = integrations.find((item) => item.type === 'adms_direct');
  const bridge = integrations.find((item) => item.type === 'ebioserver');
  // Port of the PWA's 5-minute liveness check — status alone never goes stale server-side.
  const isLive = (integration?: Integration) => {
    if (!integration || integration.status !== 'connected' || !integration.last_success_at) return false;
    return now > 0 && now - new Date(integration.last_success_at).getTime() < 5 * 60 * 1000;
  };
  const directLive = isLive(direct);

  const load = useCallback(async (preserveDrafts = false) => {
    const [dashboard, integrationData, mappings, ruleData, ownerTodayData, settings] = await Promise.all([
      apiRequest<Payload>('/api/mobile/v1/rrr/dashboard'),
      apiRequest<{ integrations: Integration[]; devices: Device[] }>('/api/mobile/v1/rrr/integrations'),
      apiRequest<{ groups: UnresolvedGroup[]; pagination: { page: number; per_page: number; total: number; total_pages: number } }>('/api/mobile/v1/rrr/mappings/unresolved?page=1&per_page=20'),
      apiRequest<{ rules: Record<string, number> }>('/api/mobile/v1/rrr/rules'),
      apiRequest<OwnerToday>('/api/mobile/v1/owner/today'),
      apiRequest<{ gym: { show_biometric_link_banner?: boolean } }>('/api/mobile/v1/settings'),
    ]);
    setNow(Date.now());
    // V8-M14: capture a dashboard or integrations failure — the two
    // legs whose numbers decide what this screen claims. The other legs
    // (mappings, rules, owner-today, settings) degrade to empty/default
    // values and do not by themselves make the screen a lie.
    setLoadError(resolveRrrGrowthLoadError(dashboard, integrationData));
    if (dashboard.ok) setData(dashboard.data);
    if (integrationData.ok) {
      setIntegrations(integrationData.data.integrations || []);
      setDevices(integrationData.data.devices || []);
      const currentDirect = integrationData.data.integrations.find((item) => item.type === 'adms_direct');
      if (currentDirect) {
        setSerial((current) => current || currentDirect.device_serial || '');
        setDeviceName((current) => current === 'Elite Gym Entry' ? (currentDirect.device_name || current) : current);
        const commandData = await apiRequest<{ commands: Command[] }>(`/api/mobile/v1/rrr/integrations/${currentDirect.id}/adms/commands`);
        if (commandData.ok) setCommands(commandData.data.commands || []);
      } else setCommands([]);
    }
    if (mappings.ok) {
      setUnresolvedGroups(mappings.data.groups || []);
      setUnresolvedPage(mappings.data.pagination?.page ?? 1);
      setUnresolvedTotalPages(mappings.data.pagination?.total_pages ?? 0);
      setUnresolvedTotal(mappings.data.pagination?.total ?? 0);
    }
    if (settings.ok) setShowBiometricLinkBanner(settings.data.gym?.show_biometric_link_banner !== false);
    if (ruleData.ok) setRules(current => preserveDrafts && Object.keys(current).length ? current : ruleData.data.rules || {});
    if (ownerTodayData.ok) {
      setOwnerToday(ownerTodayData.data);
    }
    setRefreshing(false);
    setLoading(false);
  }, []);
  // V8-M14: ErrorState retry — re-runs the full load behind the
  // skeleton, same as the initial mount.
  const retryLoad = useCallback(() => {
    setLoading(true);
    void load();
  }, [load]);
  useLiveEffect(() => {
    const initialLoad = setTimeout(() => { void load(true); }, 0);
    return () => clearTimeout(initialLoad);
  }, [load]);

  const provision = async () => {
    if (!serial.trim()) { Alert.alert('Terminal serial required', 'Enter the serial from Menu → System Info.'); return; }
    const result = await apiRequest<{ integration: Integration; terminal_settings: TerminalSettings }>('/api/mobile/v1/rrr/integrations/adms/provision', { method: 'POST', body: { device_serial: serial.trim(), device_name: deviceName.trim() || 'Gym entry terminal' } });
    if (result.ok) {
      const ts = result.data.terminal_settings;
      setIntegrations((current) => current.map((item) => item.id === result.data.integration.id ? { ...item, terminal_settings: ts } : item));
      Alert.alert(
        'Terminal saved',
        `On the terminal: Menu → Comm. → Cloud Server Setting.\nServer: ${ts.server_address}\nPort: ${ts.server_port}\nHTTPS: ${ts.https ? 'ON' : 'OFF'}\nPath: ${ts.path}\nADMS mode on. Then make one test punch.`,
      );
      void load();
    }
    else Alert.alert('Could not save terminal', result.error.message);
  };
  const pairBridge = async () => {
    const result = await apiRequest<{ pairing_code: string; expires_at: string }>('/api/mobile/v1/rrr/integrations/ebioserver/pairing', { method: 'POST', body: {} });
    // V4-L27: expiry in the gym's timezone via the shared helper —
    // `new Date(...).toLocaleTimeString()` showed the phone's timezone.
    if (result.ok) setPairingCode(`${result.data.pairing_code} · expires ${formatTime(result.data.expires_at)}`);
    else Alert.alert('Pairing unavailable', result.error.message);
  };
  /** Rotate the ADMS token (PWA parity). Confirm first: the new values are
   * shown once and the old token stops working after the 7-day grace. */
  const rotateToken = async () => {
    if (!direct || rotatingToken) return;
    Alert.alert(
      'Rotate connection token?',
      'You will get fresh values to type into the terminal (shown once — copy them before leaving this screen). The old values keep working for 7 days.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rotate token',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setRotatingToken(true);
              const result = await rotateAdmsToken(apiRequest, direct.id);
              setRotatingToken(false);
              if (result.ok) {
                const ts = result.data.terminal_settings;
                setFreshSettings(ts);
                setIntegrations((current) => current.map((item) => item.id === direct.id ? { ...item, terminal_settings: ts } : item));
              } else Alert.alert('Could not rotate token', result.error.message);
            })();
          },
        },
      ],
    );
  };
  /** Toggle bare-serial ADMS login (PWA parity). Confirm both directions:
   * enabling re-opens serial-only auth; disabling stops the terminal
   * connecting until it uses the token path. */
  const toggleSerialFallback = async () => {
    if (!direct || switchingSerial) return;
    const enabling = !direct.allow_serial_fallback;
    Alert.alert(
      enabling ? 'Connect with serial number instead?' : 'Turn off serial-number login?',
      enabling
        ? 'This terminal will log in with its serial number — it needs only the server address and port, no token. You can turn this off again any time.'
        : 'This terminal will stop connecting until it uses the token path.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: enabling ? 'Turn on serial login' : 'Turn off serial login',
          onPress: () => {
            void (async () => {
              setSwitchingSerial(true);
              const result = await setAdmsSerialFallback(apiRequest, direct.id, enabling);
              setSwitchingSerial(false);
              if (result.ok) {
                const next = result.data.integration.allow_serial_fallback ?? enabling;
                setIntegrations((current) => current.map((item) => item.id === direct.id ? { ...item, allow_serial_fallback: next } : item));
              } else Alert.alert('Could not switch login mode', result.error.message);
            })();
          },
        },
      ],
    );
  };
  /** G1 (v11): replace the terminal. The confirm dialog states the
   * consequences — the old terminal is decommissioned and the
   * supervised physical door test must pass again before automatic
   * block/unblock enables on the new serial. Backend 409s (e.g. the
   * serial belongs to another gym) surface verbatim. */
  const confirmReplaceTerminal = () => {
    if (!direct || replacingTerminal) return;
    const serialValue = newSerial.trim();
    if (!serialValue) { Alert.alert('New terminal serial required', 'Enter the serial from the new terminal (Menu → System Info).'); return; }
    Alert.alert(
      'Replace this terminal?',
      `The current terminal (${direct.device_serial}) will be decommissioned and stop working with RRR. The new terminal (${serialValue}) gets a fresh connection token, and the supervised physical door test must pass again before automatic block/unblock enables.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace terminal',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setReplacingTerminal(true);
              const result = await replaceTerminal(apiRequest, direct.id, {
                device_serial: serialValue,
                device_name: newDeviceName.trim() || 'Gym entry terminal',
              });
              setReplacingTerminal(false);
              if (result.ok) {
                setShowReplaceForm(false);
                setNewSerial('');
                Alert.alert('Terminal replaced', 'The old terminal is decommissioned. Set up the new terminal with its fresh values, then pass the supervised door test to enable automatic block/unblock.');
                void load();
              } else Alert.alert('Could not replace terminal', result.error.message);
            })();
          },
        },
      ],
    );
  };
  /** G1 (v11): decommission the terminal. Confirm first — this
   * disconnects it from RRR and it stops syncing attendance. */
  const confirmDecommissionTerminal = () => {
    if (!direct || decommissioningTerminal) return;
    Alert.alert(
      'Decommission this terminal?',
      `Terminal ${direct.device_serial} will be disconnected from RRR and stop syncing attendance. This cannot be undone — reconnecting needs a fresh setup.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decommission',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDecommissioningTerminal(true);
              const result = await decommissionTerminal(apiRequest, direct.id);
              setDecommissioningTerminal(false);
              if (result.ok) {
                Alert.alert('Terminal decommissioned', 'The terminal is disconnected from RRR.');
                void load();
              } else Alert.alert('Could not decommission terminal', result.error.message);
            })();
          },
        },
      ],
    );
  };
  /** G4 (v11): re-queue stored fingerprint templates to the terminal.
   * The backend restores only onto the same member the template
   * belongs to; the response carries a queued count, never template
   * data — nothing here renders templates. */
  const confirmRestoreFingerprints = () => {
    if (!direct || restoringFingerprints) return;
    Alert.alert(
      'Restore fingerprints?',
      'Fingerprint templates stored for this gym will be re-queued to the terminal for the same members they belong to. Keep the terminal online; it picks them up on its next poll.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore fingerprints',
          onPress: () => {
            void (async () => {
              setRestoringFingerprints(true);
              const result = await restoreFingerprints(apiRequest, direct.id);
              setRestoringFingerprints(false);
              if (result.ok) {
                const queued = restoreQueuedCount(result.data);
                Alert.alert('Fingerprints queued', `${queued} fingerprint restore${queued === 1 ? '' : 's'} queued. Keep the terminal online; it will receive them on its next poll.`);
              } else Alert.alert('Could not restore fingerprints', result.error.message);
            })();
          },
        },
      ],
    );
  };
  const selectDevice = async (id: number) => {
    if (!bridge) return;
    const result = await apiRequest(`/api/mobile/v1/rrr/integrations/${bridge.id}/device`, { method: 'POST', body: { device_id: id } });
    if (result.ok) void load(); else Alert.alert('Could not select device', result.error.message);
  };
  const commissionIntegration = async (integration: Integration, confirmed: boolean) => {
    if (!confirmed) { Alert.alert('Door test required', 'Stand at the door and verify block/unblock works before enabling.'); return; }
    setCommissioning(true);
    const result = await apiRequest(`/api/mobile/v1/rrr/integrations/${integration.id}/commission`, { method: 'POST', body: { physical_test_passed: true } });
    setCommissioning(false);
    if (result.ok) { Alert.alert('Enabled', 'Automatic block/unblock is now active for this device.'); void load(); }
    else Alert.alert('Not ready yet', result.error.message);
  };
  const commissionBridge = async () => {
    if (!bridge) return;
    await commissionIntegration(bridge, doorConfirmed);
  };
  const commissionDirect = async () => {
    if (!direct) return;
    await commissionIntegration(direct, directDoorConfirmed);
  };
  const sendTestCommand = async (action: 'probe_info' | 'essl_group_block_test' | 'essl_group_unblock_test') => {
    if (!direct) return;
    const groupTest = action !== 'probe_info';
    const result = await apiRequest(`/api/mobile/v1/rrr/integrations/${direct.id}/adms/commands`, {
      method: 'POST',
      body: {
        action,
        ...(groupTest ? {
          test_enroll_number: testUserId.trim(),
          test_user_name: testUserName.trim(),
          test_member_confirmed: true,
        } : {}),
      },
    });
    if (result.ok) { Alert.alert('Command queued', 'Keep the terminal online; it will receive this on its next cloud poll.'); void load(); }
    else Alert.alert('Command not queued', result.error.message);
  };

  /** Canonical terminal-ID compare: "042" and "42" are the same enrollee. */
  const canonicalEnroll = (value: string) => value.replace(/^0+/, '') || '0';

  /**
   * Resolve the typed test ID against real members BEFORE queuing a group
   * test. Typing a real member's terminal ID + exact name used to queue a
   * Grp=100 block on them. Returns the matched member (hard refuse), or a
   * terminal user with no linked member (loud warning), or null.
   */
  const resolveTestId = async (): Promise<{ memberName?: string; terminalName?: string } | null> => {
    const wantedId = canonicalEnroll(testUserId.trim());
    // V4-L26 / V5-L40: targeted lookup — enrolled members whose stored
    // name/phone matches the typed terminal name, filtered server-side.
    // The name search used to be capped at one page of 20: a name
    // matching >20 enrolled members could miss the real member. Page
    // through it (page_size=100, up to 5 pages) before giving up.
    for (let namePage = 1; namePage <= 5; namePage += 1) {
      const byName = await apiRequest<{ members: { id: number; full_name: string; device_enroll_number?: string | null }[]; pagination?: { page: number; total_pages: number } }>(
        `/api/mobile/v1/members?biometric=enrolled&q=${encodeURIComponent(testUserName.trim())}&page=${namePage}&page_size=100`,
      );
      if (!byName.ok) break;
      const hit = (byName.data.members || []).find(
        (m) => m.device_enroll_number != null && canonicalEnroll(String(m.device_enroll_number)) === wantedId,
      );
      if (hit) return { memberName: hit.full_name };
      const totalPages = byName.data.pagination?.total_pages ?? 1;
      if (namePage >= totalPages) break;
    }
    // Terminal snapshot: a suggestion already linked to a member.
    const snapshot = await apiRequest<EnrollMatches>('/api/mobile/v1/rrr/enroll-matches');
    if (snapshot.ok) {
      const linked = (snapshot.data.suggestions || []).find(
        (s) => canonicalEnroll(s.enroll_number) === wantedId,
      );
      if (linked?.member_id) return { memberName: linked.member_name ?? undefined, terminalName: linked.terminal_name };
      const unlinked = (snapshot.data.unmatched_terminal || []).find(
        (s) => canonicalEnroll(s.enroll_number) === wantedId,
      );
      if (unlinked) return { terminalName: unlinked.terminal_name };
    }
    // Members enrolled by terminal ID but absent from the snapshot (stale
    // or offline terminal, user never appeared in a snapshot): page
    // through the enrolled list instead of trusting one capped page.
    // V4-L26: the old single page_size=500 fetch missed real members at
    // Yodha scale (>500 enrolled); the serve-side guard remains the final
    // defence, but this sweep is the last client-side chance to catch one.
    let page = 1;
    for (;;) {
      const enrolled = await apiRequest<{ members: { id: number; full_name: string; device_enroll_number?: string | null }[]; pagination?: { page: number; total_pages: number } }>(
        `/api/mobile/v1/members?biometric=enrolled&page=${page}&page_size=500`,
      );
      // V5-L40: a failed sweep page used to `break` silently and queue
      // the test on incomplete data. Fail loudly instead — the caller
      // refuses to queue the test until the ID is verified.
      if (!enrolled.ok) throw new Error(enrolled.error.message);
      const hit = (enrolled.data.members || []).find(
        (m) => m.device_enroll_number != null && canonicalEnroll(String(m.device_enroll_number)) === wantedId,
      );
      if (hit) return { memberName: hit.full_name };
      const totalPages = enrolled.data.pagination?.total_pages ?? 1;
      if (page >= totalPages) break;
      page += 1;
    }
    return null;
  };

  const queue = async (action: 'probe_info' | 'essl_group_block_test' | 'essl_group_unblock_test') => {
    if (!direct) return;
    if (action === 'probe_info') { void sendTestCommand(action); return; }
    if (!/^[1-9][0-9]{0,8}$/.test(testUserId.trim())) {
      Alert.alert('Temporary User ID required', 'Use the 1–9 digit ID of the dedicated fake account created on the terminal.');
      return;
    }
    if (!testUserName.trim()) {
      Alert.alert('Current terminal name required', 'Enter the fake account name exactly as it appears on the terminal.');
      return;
    }
    if (!testMemberConfirmed) {
      Alert.alert('Fake account confirmation required', 'Confirm that this is the dedicated fake test account, not a real customer or member.');
      return;
    }
    let resolved: { memberName?: string; terminalName?: string } | null;
    try {
      resolved = await resolveTestId();
    } catch (err) {
      // V5-L40: the enrolled sweep failed — do not queue a group test on
      // unverified data; the ID might belong to a real member.
      Alert.alert(
        'Could not verify terminal ID',
        `The member check failed (${err instanceof Error ? err.message : 'network error'}), so the test was not queued. Check your connection and try again.`,
      );
      return;
    }
    if (resolved?.memberName) {
      Alert.alert(
        'That ID belongs to a real member',
        `Terminal ID ${testUserId.trim()} is linked to member ${resolved.memberName}. Test blocks must only target the dedicated fake test account — use a different ID.`,
      );
      return;
    }
    const isBlock = action === 'essl_group_block_test';
    Alert.alert(
      isBlock ? 'Confirm safe eSSL block test' : 'Confirm safe eSSL unblock test',
      isBlock
        ? `Queue a Grp=100 update for fake test ID ${testUserId.trim()}? This updates USERINFO without deleting the user or fingerprint.${resolved?.terminalName ? ` WARNING: the terminal shows a user named "${resolved.terminalName}" on this ID with no linked member — if that is a real person, do NOT continue.` : ''}`
        : `Queue a Grp=1 restore for fake test ID ${testUserId.trim()}? Verify that the same fingerprint still works at the terminal.${resolved?.terminalName ? ` WARNING: the terminal shows a user named "${resolved.terminalName}" on this ID with no linked member — if that is a real person, do NOT continue.` : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Queue test', onPress: () => void sendTestCommand(action) },
      ],
    );
  };
  const markActioned = async (id: number) => { const result = await apiRequest(`/api/mobile/v1/rrr/opportunities/${id}`, { method: 'PATCH', body: { status: 'actioned' } }); if (result.ok) void load(); else Alert.alert('Could not update opportunity', result.error.message); };
  const saveRecovery = async () => {
    const amount = outcomeAmount.trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(amount)) { Alert.alert('Enter recovered amount', 'Use a non-negative amount with up to two decimal places.'); return; }
    if (!recoveryTarget) return;
    const result = await apiRequest(`/api/mobile/v1/rrr/opportunities/${recoveryTarget.id}`, { method: 'PATCH', body: { status: 'closed', outcome_revenue: amount } });
    if (!result.ok) { Alert.alert('Could not record recovery', result.error.message); return; }
    setRecoveryTarget(null);
    setOutcomeAmount('');
    void load();
  };
  /** Stage one terminal-ID → member pair; linked together via bulk-resolve. */
  const stageMapping = (externalId: string, person: PickerPerson) => {
    setPendingMappings((prev) => ({ ...prev, [externalId]: person.id }));
    setPendingMappingNames((prev) => ({ ...prev, [externalId]: person.full_name }));
  };
  const unstageMapping = (externalId: string) => {
    setPendingMappings((prev) => {
      const next = { ...prev };
      delete next[externalId];
      return next;
    });
    setPendingMappingNames((prev) => {
      const next = { ...prev };
      delete next[externalId];
      return next;
    });
  };
  /** Link every staged pair in one bulk-resolve call (max 100/call). */
  const linkStagedMappings = async () => {
    const entries = Object.entries(pendingMappings);
    if (!entries.length) return;
    Alert.alert(
      `Link ${entries.length} terminal ID${entries.length === 1 ? '' : 's'}?`,
      'Each terminal ID will be linked to the member you picked, and that member\u2019s past punches will be replayed onto them.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Link all',
          onPress: () => {
            void (async () => {
              const mappings = entries.map(([external_id, member_id]) => ({ external_id, member_id }));
              let linked = 0;
              let failed = 0;
              for (let i = 0; i < mappings.length; i += 100) {
                const chunk = mappings.slice(i, i + 100);
                const res = await apiRequest<{ linked: number; total: number }>('/api/mobile/v1/rrr/mappings/bulk-resolve', {
                  method: 'POST',
                  body: { mappings: chunk },
                });
                if (res.ok) {
                  linked += res.data.linked;
                  failed += res.data.total - res.data.linked;
                } else {
                  failed += chunk.length;
                }
              }
              setPendingMappings({});
              setPendingMappingNames({});
              Alert.alert('Linking done', `${linked} terminal ID${linked === 1 ? '' : 's'} linked${failed ? `, ${failed} failed` : ''}.`);
              void load();
            })();
          },
        },
      ],
    );
  };
  const loadMoreUnresolved = async () => {
    if (loadingMoreUnresolved || unresolvedPage >= unresolvedTotalPages) return;
    setLoadingMoreUnresolved(true);
    const nextPage = unresolvedPage + 1;
    const res = await apiRequest<{ groups: UnresolvedGroup[]; pagination: { page: number; per_page: number; total: number; total_pages: number } }>(
      `/api/mobile/v1/rrr/mappings/unresolved?page=${nextPage}&per_page=20`,
    );
    if (res.ok) {
      setUnresolvedGroups((prev) => {
        const seen = new Set(prev.map((g) => g.biometric_user_id));
        return [...prev, ...res.data.groups.filter((g) => !seen.has(g.biometric_user_id))];
      });
      setUnresolvedPage(nextPage);
      setUnresolvedTotalPages(res.data.pagination?.total_pages ?? unresolvedTotalPages);
      setUnresolvedTotal(res.data.pagination?.total ?? unresolvedTotal);
    } else {
      Alert.alert('Could not load more', res.error.message);
    }
    setLoadingMoreUnresolved(false);
  };
  /** Server-side member search for the mapping picker (q=, 20/page). */
  const searchMembersForPicker = useCallback(async (query: string): Promise<PickerPerson[]> => {
    const q = query.trim();
    const url = q
      ? `/api/mobile/v1/members?q=${encodeURIComponent(q)}&page_size=20`
      : '/api/mobile/v1/members?page=1&page_size=20';
    const res = await apiRequest<{ members: PickerPerson[] }>(url);
    return res.ok ? (res.data.members || []) : [];
  }, []);
  const saveRules = async () => { const result = await apiRequest('/api/mobile/v1/rrr/rules', { method: 'PUT', body: { rules } }); if (result.ok) Alert.alert('Saved', 'RRR signal thresholds updated.'); else Alert.alert('Could not save rules', result.error.message); };
  const loadMatches = useCallback(async () => {
    const result = await apiRequest<EnrollMatches>('/api/mobile/v1/rrr/enroll-matches');
    if (result.ok) {
      setMatches(result.data);
      setMatchesError(undefined);
    } else {
      // V6-L37: a failed matches fetch used to leave the previous (stale)
      // suggestions on screen with no error — the owner could stare at
      // them believing they were fresh from the scan.
      setMatchesError(result.error.message);
    }
  }, []);
  const scanTerminalUsers = async () => {
    if (scanning) return;
    setScanning(true);
    const result = await apiRequest('/api/mobile/v1/rrr/enroll-scan', { method: 'POST', body: {} });
    if (!result.ok) { setScanning(false); Alert.alert('Scan failed', result.error.message); return; }
    // Poll for the snapshot to arrive (terminal responds on its next poll).
    // V4-M7 (PWA parity): poll the cheap snapshot-presence check, NOT the
    // full fuzzy scan — the heavy /enroll-matches runs once, when the
    // terminal user list has actually arrived.
    // The timer is cleared on success, on 20 tries, AND on unmount (above).
    let tries = 0;
    stopScanTimer();
    scanTimerRef.current = setInterval(async () => {
      tries += 1;
      const r = await apiRequest<{ has_snapshot: boolean }>('/api/mobile/v1/rrr/enroll-snapshot-status');
      if (r.ok && r.data.has_snapshot) {
        stopScanTimer(); setScanning(false); void loadMatches(); return;
      }
      if (tries >= 20) { stopScanTimer(); setScanning(false); Alert.alert('Still waiting', 'The terminal may be offline. It will respond when it reconnects — pull to refresh then.'); }
    }, 3000);
  };
  const confirmMatch = async (s: EnrollSuggestion) => {
    if (s.ambiguous || !s.member_id) return;
    if (confirmingEnroll === s.enroll_number) return;
    setConfirmingEnroll(s.enroll_number);
    const result = await apiRequest('/api/mobile/v1/rrr/enroll-matches/confirm', { method: 'POST', body: { member_id: s.member_id, enroll_number: s.enroll_number } });
    setConfirmingEnroll(null);
    if (result.ok) { Alert.alert('Linked', `${s.member_name} is now linked to terminal #${s.enroll_number}.`); void loadMatches(); }
    else Alert.alert('Could not link', result.error.message);
  };
  const pillars = data?.pillars || {};
  const potential = Number(data?.total_potential_revenue ?? Object.values(pillars).reduce((sum, item) => sum + Number(item.potential_revenue || 0), 0));
  const latest = commands[0];

  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={colors.brand} refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}>
    <TouchableOpacity onPress={onBack}><Text style={styles.back}>‹ Settings</Text></TouchableOpacity>
    {loading ? <><View style={styles.hero}><Text style={styles.eyebrow}>RRR GYM GROWTH SYSTEM</Text><Text style={styles.title}>Run the gym. Grow the business.</Text></View><PillarCardSkeleton /><PillarCardSkeleton /><PillarCardSkeleton /><CardSkeleton count={2} /></> : loadError && !data ? (
      <ErrorState message={loadError} onRetry={retryLoad} />
    ) : <>
    {loadError ? (
      <View style={styles.staleBanner}>
        <Text style={styles.staleBannerText}>Update failed — showing previous data. Pull to refresh to retry.</Text>
      </View>
    ) : null}
    <View style={styles.hero}><Text style={styles.eyebrow}>RRR GYM GROWTH SYSTEM</Text><Text style={styles.title}>Run the gym. Grow the business.</Text><Text style={styles.subtitle}>Revenue, retention, recovery and attendance—one owner workspace.</Text></View>
    <View style={[styles.metrics, recoveryStyles.metricsWrap]}><Metric value={String(data?.members?.total ?? 0)} label="Members" /><Metric value={`${data?.members?.attendance_rate ?? 0}%`} label="Attendance" /><Metric value={`₹${money(potential)}`} label="Pipeline estimate" /><Metric value={`₹${money(Number(data?.owner_confirmed_revenue || 0))}`} label="Owner-reported recovered" /></View>
    {ownerToday && <View style={[styles.card, ownerStyles.todayCard]}><View style={styles.cardHeader}><View><Text style={styles.cardEyebrow}>OWNER TODAY</Text><Text style={styles.cardTitle}>Run this shift with clarity</Text></View><Text style={ownerStyles.todayTotal}>₹{money(Number(ownerToday.collections.total || 0))}</Text></View><Text style={styles.copy}>{ownerToday.follow_up_count} lead follow-up(s) and {ownerToday.trials_today.length} trial visit(s) need attention today.</Text>{ownerToday.actions.slice(0, 4).map((action, index) => <View style={ownerStyles.todayAction} key={`${action.title}-${index}`}><View style={[ownerStyles.actionDot, action.priority === 'high' && ownerStyles.actionDotHigh]} /><View style={ownerStyles.todayActionCopy}><Text style={styles.rowTitle}>{action.title}</Text><Text style={styles.rowSub}>{action.detail}</Text></View><Text style={ownerStyles.actionCount}>{action.count}</Text></View>)}</View>}
    {(['revenue', 'retain', 'recover'] as const).map((pillar) => { const tone = tones[pillar]; const values = pillars[pillar]; return <View key={pillar} style={[styles.focus, { backgroundColor: tone.surface }]}><View style={styles.focusTop}><View><Text style={[styles.focusLabel, { color: tone.color }]}>{tone.label}</Text><Text style={styles.rowSub}>{tone.copy}</Text></View><Text style={[styles.focusCount, { color: tone.color }]}>{values?.count ?? 0}</Text></View><View style={styles.focusBottom}><Text style={styles.copy}>{pillar === 'revenue' ? 'Revenue opportunities' : pillar === 'retain' ? 'Members at risk' : 'Inactive / expired'}</Text><Text style={[styles.focusValue, { color: tone.color }]}>₹{money(Number(values?.potential_revenue || 0))}</Text></View>{(data?.opportunities || []).filter((item) => item.pillar === pillar).slice(0, 2).map((item) => <View key={item.id} style={styles.opportunity}><View style={recoveryStyles.opportunityCopy}><Text style={styles.rowTitle}>{item.member.name}</Text><Text style={styles.rowSub}>{item.reason}</Text><Text style={styles.rowSub}>{item.status}</Text></View><View style={recoveryStyles.opportunityActions}><TouchableOpacity onPress={() => void markActioned(item.id)}><Text style={[styles.link, { color: tone.color }]}>Action</Text></TouchableOpacity><TouchableOpacity onPress={() => { setOutcomeAmount(''); setRecoveryTarget(item); }}><Text style={[styles.link, { color: colors.successDark }]}>Recovered</Text></TouchableOpacity></View></View>)}
    {onNavigateOpportunities ? <TouchableOpacity onPress={() => onNavigateOpportunities(pillar)}><Text style={[styles.link, { color: tone.color }]}>View all {pillar === 'revenue' ? 'revenue opportunities' : pillar === 'retain' ? 'at-risk members' : 'inactive / expired members'} →</Text></TouchableOpacity> : null}</View>; })}
    <View style={[styles.card, styles.directCard]}><View style={styles.cardHeader}><View><Text style={styles.cardEyebrow}>ATTENDANCE CONNECTION</Text><Text style={styles.cardTitle}>Direct Cloud</Text></View><View style={[styles.status, directLive ? styles.live : styles.setup]}><Text style={[styles.statusText, directLive ? styles.liveText : styles.setupText]}>{directLive ? 'LIVE' : 'SET UP'}</Text></View></View>
      {direct ? <><Text style={styles.deviceTitle}>{direct.device_name || 'Gym entry terminal'}</Text><Text style={styles.copy}>{direct.device_serial} · {direct.records_synced || 0} attendance records · {data?.unmapped_count || 0} need review</Text><Text style={styles.copy}>Commissioning: {direct.commissioning_status ?? (direct.commands_enabled ? 'complete — automatic block/unblock is on' : 'pending — supervised door test not passed yet')}</Text><View style={styles.server}><Text style={styles.serverLabel}>Terminal Cloud Server</Text><Text selectable style={styles.serverHost}>{direct.terminal_settings?.server_address || '—'}</Text><Text style={styles.serverMeta}>ADMS mode · Port {direct.terminal_settings?.server_port ?? '—'} · HTTPS {direct.terminal_settings?.https === false ? 'off' : 'on'} · Path {direct.terminal_settings?.path || '/iclock'}</Text></View><Text style={styles.copy}>Terminal: Menu → Comm. → Cloud Server Setting. Save these values and make a test punch. Your phone never joins the gym LAN.</Text>
      {direct.terminal_settings?.token_present && ownerSections.showTerminalSetup ? <View style={styles.tokenBox}><Text style={styles.copy}>Connection values hidden. The token for this terminal is stored securely and can&apos;t be shown again — rotate to get fresh values.</Text><Button text={rotatingToken ? 'Rotating…' : 'Rotate token — get fresh values'} onPress={() => void rotateToken()} secondary disabled={rotatingToken} /></View> : null}
      {freshSettings && ownerSections.showTerminalSetup ? <View style={styles.server}><Text style={styles.serverLabel}>Fresh values — copy them NOW (shown once)</Text><Text selectable style={styles.serverHost}>{freshSettings.server_address || '—'}</Text><Text style={styles.serverMeta}>ADMS mode · Port {freshSettings.server_port ?? '—'} · HTTPS {freshSettings.https === false ? 'off' : 'on'} · Path {freshSettings.path || '/iclock'}</Text><Text style={styles.copy}>Save these in the terminal before leaving this screen. The old values keep working for 7 days.</Text></View> : null}
      {ownerSections.showTerminalSetup ? <View style={styles.tokenBox}><Text style={styles.copy}>{direct.allow_serial_fallback ? 'Serial-number login is ON for this terminal — it connects with address + port only, no token needed.' : 'No path/URL field on your terminal? Some terminals can\'t send the token. Let this terminal log in with its serial number instead — it then needs only the address and port.'}</Text><Button text={switchingSerial ? 'Switching…' : direct.allow_serial_fallback ? 'Turn off serial login' : 'Connect with serial number instead'} onPress={() => void toggleSerialFallback()} secondary disabled={switchingSerial} /></View> : null}
      {ownerSections.showTerminalLifecycle ? <View style={styles.tokenBox}><Text style={styles.cardEyebrow}>TERMINAL LIFECYCLE</Text>
        {showReplaceForm ? <><Text style={styles.copy}>Enter the new terminal&apos;s details. The current terminal will be decommissioned, and the supervised physical door test must pass again before automatic block/unblock enables.</Text><TextInput style={styles.textInput} value={newSerial} onChangeText={setNewSerial} placeholder="New terminal serial number" placeholderTextColor={colors.muted} autoCapitalize="characters" /><TextInput style={styles.textInput} value={newDeviceName} onChangeText={setNewDeviceName} placeholder="Friendly terminal name" placeholderTextColor={colors.muted} /><Button text={replacingTerminal ? 'Replacing…' : 'Confirm replacement'} onPress={() => void confirmReplaceTerminal()} disabled={replacingTerminal} /><Button text="Cancel" onPress={() => { setShowReplaceForm(false); setNewSerial(''); }} secondary /></> : <Button text="Replace terminal" onPress={() => { setNewDeviceName(direct.device_name || 'Gym entry terminal'); setShowReplaceForm(true); }} secondary />}
        <Button text={restoringFingerprints ? 'Queuing…' : 'Restore fingerprints'} onPress={() => void confirmRestoreFingerprints()} secondary disabled={restoringFingerprints} />
        <Button text={decommissioningTerminal ? 'Decommissioning…' : 'Decommission terminal'} onPress={() => void confirmDecommissionTerminal()} secondary disabled={decommissioningTerminal} />
      </View> : null}</> : ownerSections.showTerminalSetup ? <><Text style={styles.copy}>Connect eSSL attendance directly to RRR Cloud—no gym PC or bridge is required for attendance.</Text><TextInput style={styles.textInput} value={serial} onChangeText={setSerial} placeholder="Terminal serial number" placeholderTextColor={colors.muted} autoCapitalize="characters" /><TextInput style={styles.textInput} value={deviceName} onChangeText={setDeviceName} placeholder="Friendly terminal name" placeholderTextColor={colors.muted} /><Button text="Save terminal and continue" onPress={() => void provision()} /></> : <Text style={styles.copy}>Terminal setup is owner-only — ask the gym owner to connect the terminal.</Text>}</View>
    {direct && ownerSections.showCommissioningConsole && <View style={styles.card}><Text style={styles.cardEyebrow}>CONTROLLED DEVICE TEST</Text><Text style={styles.cardTitle}>Commissioning console</Text><Text style={styles.copy}>These safe Group tests update USERINFO and preserve the fingerprint. Automatic access rules remain off until a test command is acknowledged and you verify the door in person.</Text><Text style={styles.command}>{latest ? `${latest.action.replace(/_/g, ' ')} · ${latest.status}${latest.result_code ? ` · ${latest.result_code}` : ''}` : 'No command sent yet.'}</Text><Button text="1. Send safe connection probe" onPress={() => void queue('probe_info')} secondary disabled={!directLive} />{!directLive ? <Text style={styles.copy}>Buttons unlock once the terminal phones home — finish step 2 above first.</Text> : null}<TextInput style={styles.textInput} value={testUserId} onChangeText={setTestUserId} keyboardType="number-pad" placeholder="Fake terminal User ID (example: 999)" placeholderTextColor={colors.muted} /><TextInput style={styles.textInput} value={testUserName} onChangeText={setTestUserName} placeholder="Exact name currently shown on terminal" placeholderTextColor={colors.muted} /><TouchableOpacity style={recoveryStyles.testConfirmation} onPress={() => setTestMemberConfirmed((value) => !value)}><Text style={recoveryStyles.testConfirmationBox}>{testMemberConfirmed ? '☑' : '☐'}</Text><Text style={styles.copy}>I confirm this is the dedicated fake test account I created, not a real customer/member.</Text></TouchableOpacity><View style={styles.commands}><TouchableOpacity style={[styles.block, !directLive && { opacity: 0.5 }]} disabled={!directLive} onPress={() => void queue('essl_group_block_test')}><Text style={styles.blockText}>2. Test eSSL block (Grp=100)</Text></TouchableOpacity><TouchableOpacity style={[styles.unblock, !directLive && { opacity: 0.5 }]} disabled={!directLive} onPress={() => void queue('essl_group_unblock_test')}><Text style={styles.unblockText}>3. Test eSSL unblock (Grp=1)</Text></TouchableOpacity></View>
    <View style={styles.commissionRow}>
      <TouchableOpacity style={styles.checkbox} onPress={() => setDirectDoorConfirmed(!directDoorConfirmed)}>
        <Text style={styles.checkboxText}>{directDoorConfirmed ? '☑' : '☐'}</Text>
      </TouchableOpacity>
      <Text style={styles.copy}>I stood at the door and verified block/unblock works on the terminal.</Text>
    </View><Button text={commissioning ? 'Enabling…' : direct.commands_enabled ? 'Automatic block/unblock is ON' : '4. Enable automatic block/unblock'} onPress={() => void commissionDirect()} /></View>}
    <View style={styles.card}><Text style={styles.cardEyebrow}>FALLBACK CONNECTION</Text><Text style={styles.cardTitle}>eBioServer bridge</Text><Text style={styles.copy}>Use only where licensed eBioServer must remain on a gym PC. Direct Cloud does not require it.</Text><Text style={styles.copy}>Status: {bridge?.status || 'not configured'} · {bridge?.device_name || bridge?.device_serial || 'No selected device'}</Text>{devices.map((device) => <View style={styles.deviceRow} key={device.id}><View><Text style={styles.rowTitle}>{device.name}</Text><Text style={styles.rowSub}>{device.serial_number} · {device.status}</Text></View>{!device.selected && ownerSections.showBridgeControls && <TouchableOpacity onPress={() => void selectDevice(device.id)}><Text style={styles.link}>Select</Text></TouchableOpacity>}</View>)}{ownerSections.showBridgeControls ? <Button text="Generate gym-PC pairing code" onPress={() => void pairBridge()} secondary /> : null}{!!pairingCode && <Text selectable style={styles.code}>{pairingCode}</Text>}
    {bridge && bridge.status === 'connected' && ownerSections.showBridgeControls && <><View style={styles.commissionRow}>
      <TouchableOpacity style={styles.checkbox} onPress={() => setDoorConfirmed(!doorConfirmed)}>
        <Text style={styles.checkboxText}>{doorConfirmed ? '☑' : '☐'}</Text>
      </TouchableOpacity>
      <Text style={styles.copy}>I stood at the door and verified block/unblock works on the terminal.</Text>
    </View><Button text={commissioning ? 'Enabling…' : bridge.commands_enabled ? 'Automatic block/unblock is ON' : 'Enable automatic block/unblock'} onPress={() => void commissionBridge()} /></>}</View>
    {showBiometricLinkBanner && <View style={styles.card}><Text style={styles.cardEyebrow}>IDENTITY REVIEW</Text><Text style={styles.cardTitle}>{unresolvedTotal} terminal IDs · {unresolvedGroups.reduce((sum, g) => sum + (g.punch_count || 0), 0)} punches need a member</Text>{unresolvedGroups.length ? unresolvedGroups.map((group) => <View style={styles.deviceRow} key={group.biometric_user_id}><View style={{ flex: 1 }}><Text style={styles.rowTitle}>Terminal ID {group.biometric_user_id}</Text><Text style={styles.rowSub}>{group.punch_count} punch{group.punch_count === 1 ? '' : 'es'}{group.latest_punch_time ? ` · latest ${formatDateTime(group.latest_punch_time)}` : ''}</Text>{pendingMappingNames[group.biometric_user_id] ? <Text style={[styles.rowSub, { color: colors.successDark }]}>→ {pendingMappingNames[group.biometric_user_id]} (ready to link)</Text> : null}</View>{pendingMappingNames[group.biometric_user_id] ? <TouchableOpacity onPress={() => unstageMapping(group.biometric_user_id)}><Text style={styles.link}>Clear</Text></TouchableOpacity> : <TouchableOpacity onPress={() => setPickerEvent(group)}><Text style={styles.link}>Map to member…</Text></TouchableOpacity>}</View>) : <Text style={styles.copy}>No unresolved biometric punches.</Text>}{unresolvedPage < unresolvedTotalPages ? <Button text={loadingMoreUnresolved ? 'Loading…' : `Show more (${Math.max(0, unresolvedTotal - unresolvedGroups.length)} remaining)`} onPress={() => void loadMoreUnresolved()} secondary /> : null}{Object.keys(pendingMappings).length > 0 ? <Button text={`Link ${Object.keys(pendingMappings).length} selected`} onPress={() => void linkStagedMappings()} /> : null}</View>}
    {(direct || bridge) && <View style={styles.card}><Text style={styles.cardEyebrow}>SMART MATCHING</Text><Text style={styles.cardTitle}>Who is who on the terminal?</Text><Text style={styles.copy}>We read the names on your terminal and match them to members. One tap per match — nothing links without your approval.</Text><Button text={scanning ? 'Scanning…' : 'Scan terminal users'} onPress={() => { void scanTerminalUsers(); }} secondary disabled={scanning} />
    {matchesError ? <Text style={[styles.copy, { color: colors.critical }]}>Couldn&apos;t load terminal matches: {matchesError} <Text style={styles.link} onPress={() => void loadMatches()}>Retry</Text></Text> : null}
    {(matches?.suggestions || []).map((s) => <View style={styles.deviceRow} key={s.enroll_number}><View style={{ flex: 1 }}><Text style={styles.rowTitle}>#{s.enroll_number} {s.terminal_name || 'No name'}</Text>{s.ambiguous ? <Text style={styles.rowSub}>This name matches multiple members: {(s.candidate_members || []).map((candidate) => candidate.name).join(', ')}. Link from the correct member profile.</Text> : <Text style={styles.rowSub}>→ {s.member_name}{s.member_phone ? ` · ${s.member_phone}` : ''} · {s.confidence}%</Text>}</View>{!s.ambiguous && s.member_id ? <TouchableOpacity onPress={() => void confirmMatch(s)} disabled={confirmingEnroll === s.enroll_number} style={confirmingEnroll === s.enroll_number ? { opacity: 0.5 } : undefined}><Text style={styles.link}>{confirmingEnroll === s.enroll_number ? 'Linking…' : 'Confirm'}</Text></TouchableOpacity> : null}</View>)}
      {(matches?.unmatched_terminal || []).length > 0 && <Text style={styles.copy}>{matches?.unmatched_terminal?.length} terminal user(s) couldn&apos;t be matched confidently — ask staff and link from the member profile.</Text>}
      {matches && !(matches.suggestions || []).length && !(matches.unmatched_terminal || []).length && matches.snapshot && <Text style={styles.copy}>Everyone on the terminal is already linked. 🎉</Text>}</View>}
    {(direct || bridge) && isOwner && onNavigateBulkDeactivate ? (
      <TouchableOpacity onPress={onNavigateBulkDeactivate} style={{ paddingVertical: spacing.sm }} activeOpacity={0.7}>
        <Text style={styles.link}>Manage terminal members (deactivate) →</Text>
      </TouchableOpacity>
    ) : null}
    <MemberPickerModal
      visible={pickerEvent !== null}
      title={pickerEvent ? `Map Terminal ID ${pickerEvent.biometric_user_id}` : 'Map to member'}
      onClose={() => setPickerEvent(null)}
      serverSearch={searchMembersForPicker}
      onSelect={(person) => {
        const event = pickerEvent;
        setPickerEvent(null);
        if (event) stageMapping(event.biometric_user_id, person);
      }}
    />
    {ownerSections.showThresholds ? <View style={styles.card}><Text style={styles.cardEyebrow}>GROWTH ENGINE</Text><Text style={styles.cardTitle}>Signal thresholds</Text>{ruleFields.map(([key, label]) => <View style={styles.rule} key={key}><Text style={styles.copy}>{label}</Text><View style={styles.ruleValue}><TextInput keyboardType="number-pad" value={String(rules[key] ?? '')} onChangeText={(value) => setRules((old) => ({ ...old, [key]: Number(value) }))} style={styles.ruleInput} /><Text style={styles.unit}>{key === 'attendance_drop_percent' ? '%' : 'days'}</Text></View></View>)}<Button text="Save thresholds" onPress={() => void saveRules()} /></View> : null}
  </>}</ScrollView>
    <Modal visible={recoveryTarget !== null} transparent animationType="fade" onRequestClose={() => setRecoveryTarget(null)}>
      <View style={recoveryStyles.modalOverlay}><View style={recoveryStyles.recoveryModal}>
        <Text style={styles.cardEyebrow}>OWNER CONFIRMATION</Text>
        <Text style={styles.cardTitle}>Record recovered revenue</Text>
        <Text style={styles.copy}>{recoveryTarget?.member.name} · Enter the amount actually collected. This is an owner-confirmed outcome.</Text>
        <TextInput style={styles.textInput} value={outcomeAmount} onChangeText={setOutcomeAmount} keyboardType="decimal-pad" placeholder="Amount collected (₹)" placeholderTextColor={colors.muted} />
        <View style={styles.commands}><TouchableOpacity style={recoveryStyles.cancelRecovery} onPress={() => setRecoveryTarget(null)}><Text style={recoveryStyles.cancelRecoveryText}>Cancel</Text></TouchableOpacity><TouchableOpacity style={recoveryStyles.saveRecovery} onPress={() => void saveRecovery()}><Text style={recoveryStyles.saveRecoveryText}>Save recovery</Text></TouchableOpacity></View>
      </View></View>
    </Modal>
  </SafeAreaView>;
}

function Metric({ value, label }: { value: string; label: string }) { return <View style={[styles.metric, recoveryStyles.metricGridItem]}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }
function Button({ text, onPress, secondary = false, disabled = false }: { text: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) { return <TouchableOpacity style={[secondary ? styles.secondaryButton : styles.button, disabled && { opacity: 0.5 }]} onPress={onPress} disabled={disabled}><Text style={secondary ? styles.secondaryText : styles.buttonText}>{text}</Text></TouchableOpacity>; }
function money(value: number) { return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number.isFinite(value) ? value : 0); }

const ownerStyles = StyleSheet.create({
  todayCard: { borderColor: colors.successBorder },
  todayTotal: { color: colors.successDark, fontSize: fontSize.xl, fontWeight: fontWeight.extrabold },
  todayAction: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: 1, borderColor: colors.borderLight, paddingTop: spacing.sm },
  actionDot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: colors.warning },
  actionDotHigh: { backgroundColor: colors.critical },
  todayActionCopy: { flex: 1 },
  actionCount: { color: colors.successDark, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.section }, back: { color: colors.brand, fontWeight: fontWeight.semibold, fontSize: fontSize.md }, hero: { gap: spacing.xs, paddingTop: spacing.xs }, eyebrow: { color: colors.brand, fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold, fontSize: fontSize.xs, letterSpacing: 1 }, title: { color: colors.text, fontSize: fontSize['4xl'], lineHeight: 30, fontWeight: fontWeight.extrabold }, subtitle: { color: colors.textSecondary, fontSize: fontSize.lg, lineHeight: 21 }, metrics: { flexDirection: 'row', gap: spacing.sm }, metric: { flex: 1, minHeight: 82, padding: spacing.md, justifyContent: 'center', backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadows.sm }, metricValue: { color: colors.text, fontSize: fontSize['2xl'], fontWeight: fontWeight.extrabold }, metricLabel: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: spacing.xs }, focus: { borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: colors.borderLight }, focusTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }, focusLabel: { fontSize: fontSize.lg, fontWeight: fontWeight.extrabold }, focusCount: { fontSize: fontSize['5xl'], lineHeight: 32, fontWeight: fontWeight.extrabold }, focusBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }, focusValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold }, opportunity: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing.sm, borderTopWidth: 1, borderColor: 'rgba(15,23,42,0.08)' }, rowTitle: { color: colors.text, fontWeight: fontWeight.semibold, fontSize: fontSize.sm }, rowSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 }, link: { color: colors.brand, fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold, fontSize: fontSize.sm }, card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm, ...shadows.sm }, directCard: { borderColor: colors.successBorder }, cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }, cardEyebrow: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: fontWeight.bold, fontFamily: fontFamily.bodyBold, letterSpacing: .8 }, cardTitle: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.extrabold, fontFamily: fontFamily.displayExtra, marginTop: 2 }, status: { borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 5 }, live: { backgroundColor: colors.successSurface }, setup: { backgroundColor: colors.warningSurface }, statusText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold }, liveText: { color: colors.successDark }, setupText: { color: colors.warningDark }, deviceTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold }, copy: { color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 19 }, server: { padding: spacing.md, backgroundColor: colors.brandSubtle, borderRadius: radius.md, gap: 3 }, tokenBox: { gap: spacing.sm, padding: spacing.md, backgroundColor: colors.gray50, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md }, serverLabel: { color: colors.brandDark, fontSize: fontSize.xs, fontWeight: fontWeight.bold }, serverHost: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.bold }, serverMeta: { color: colors.textSecondary, fontSize: fontSize.xs }, textInput: { width: '100%', color: colors.text, backgroundColor: colors.gray50, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 11, fontSize: fontSize.base }, button: { backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.xs }, buttonText: { color: colors.textInverse, fontWeight: fontWeight.bold }, secondaryButton: { borderWidth: 1, borderColor: colors.successBorder, backgroundColor: colors.successSurface, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.xs }, secondaryText: { color: colors.successDark, fontWeight: fontWeight.bold }, command: { color: colors.text, backgroundColor: colors.gray50, borderRadius: radius.sm, padding: spacing.sm, fontSize: fontSize.sm }, commands: { flexDirection: 'row', gap: spacing.sm }, block: { flex: 1, backgroundColor: colors.criticalSurface, borderRadius: radius.md, borderColor: colors.criticalBorder, borderWidth: 1, padding: spacing.md, alignItems: 'center' }, blockText: { color: colors.criticalDark, fontSize: fontSize.sm, fontWeight: fontWeight.bold }, unblock: { flex: 1, backgroundColor: colors.successSurface, borderRadius: radius.md, borderColor: colors.successBorder, borderWidth: 1, padding: spacing.md, alignItems: 'center' }, unblockText: { color: colors.successDark, fontSize: fontSize.sm, fontWeight: fontWeight.bold }, deviceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderColor: colors.borderLight }, code: { color: colors.text, fontSize: fontSize.md, padding: spacing.sm, backgroundColor: colors.gray100, borderRadius: radius.sm }, rule: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: spacing.xs }, ruleValue: { flexDirection: 'row', alignItems: 'center', width: 104, backgroundColor: colors.gray50, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm }, ruleInput: { flex: 1, color: colors.text, textAlign: 'right', paddingVertical: spacing.xs, fontSize: fontSize.md }, unit: { color: colors.muted, fontSize: fontSize.xs, marginLeft: spacing.xs }, commissionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.sm }, checkbox: { padding: 4 }, checkboxText: { fontSize: 22, color: colors.brand }, staleBanner: { backgroundColor: colors.warningSurface, borderColor: colors.warningBorder, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }, staleBannerText: { color: colors.textSecondary, fontSize: fontSize.sm },
});

const recoveryStyles = StyleSheet.create({
  metricsWrap: { flexWrap: 'wrap' },
  metricGridItem: { minWidth: '46%' },
  testConfirmation: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  testConfirmationBox: { color: colors.brand, fontSize: 22, lineHeight: 24 },
  opportunityCopy: { flex: 1, paddingRight: spacing.sm },
  opportunityActions: { alignItems: 'flex-end', gap: spacing.xs },
  modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.lg },
  recoveryModal: { backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.md },
  cancelRecovery: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  cancelRecoveryText: { color: colors.textSecondary, fontWeight: fontWeight.bold },
  saveRecovery: { flex: 1, backgroundColor: colors.successDark, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  saveRecoveryText: { color: colors.textInverse, fontWeight: fontWeight.bold },
});

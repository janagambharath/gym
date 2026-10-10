import { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiRequest } from '../services/apiClient';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import { MemberPickerModal, PickerPerson } from '../components/MemberPickerModal';

type Opportunity = { id: number; pillar: string; reason: string; potential_revenue: string; member: { name: string } };
type Device = { id: number; name: string; serial_number: string; status: string; selected: boolean };
type Unresolved = { biometric_user_id: string; punch_time: string };
type Person = { id: number; full_name: string };
type Integration = { id: number; type: 'adms_direct' | 'ebioserver'; status: string; device_name?: string; device_serial?: string; records_synced?: number; terminal_settings?: TerminalSettings };
type TerminalSettings = { server_mode?: string; server_address?: string; server_port?: number; https?: boolean; path?: string; warning?: string };
type Command = { id: number; action: string; status: string; result_code?: string };
type Payload = { opportunities: Opportunity[]; pillars: Record<string, { count: number; potential_revenue: string }>; unmapped_count: number; members?: { total?: number; attendance_rate?: number } };
type OwnerToday = {
  collections: { total: string; expected_cash: string };
  cash_close: { closed: boolean; counted_cash?: string | null; variance?: string | null };
  actions: { title: string; detail: string; count: number; priority: string }[];
  follow_up_count: number;
  trials_today: { id: number; name?: string; trial_scheduled_for?: string | null }[];
};
const ruleFields = [['expiry_days', 'Expiry window'], ['no_visit_days', 'No visit'], ['attendance_drop_percent', 'Attendance decline'], ['recent_expiry_days', 'Recent expiry']] as const;
const tones = { revenue: { label: 'REVENUE', copy: 'Grow existing value', color: colors.success, surface: colors.successSurface }, retain: { label: 'RETAIN', copy: 'Protect recurring revenue', color: colors.warning, surface: colors.warningSurface }, recover: { label: 'RECOVER', copy: 'Bring members back', color: colors.critical, surface: colors.criticalSurface } } as const;

export function RrrGrowthScreen({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<Payload>();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [commands, setCommands] = useState<Command[]>([]);
  const [unresolved, setUnresolved] = useState<Unresolved[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [rules, setRules] = useState<Record<string, number>>({});
  const [ownerToday, setOwnerToday] = useState<OwnerToday>();
  const [cashCount, setCashCount] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [serial, setSerial] = useState('');
  const [deviceName, setDeviceName] = useState('Elite Gym Entry');
  const [testUserId, setTestUserId] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [pickerEvent, setPickerEvent] = useState<Unresolved | null>(null);
  const direct = integrations.find((item) => item.type === 'adms_direct');
  const bridge = integrations.find((item) => item.type === 'ebioserver');

  const load = useCallback(async () => {
    const [dashboard, integrationData, mappings, members, ruleData, ownerTodayData] = await Promise.all([
      apiRequest<Payload>('/api/mobile/v1/rrr/dashboard'),
      apiRequest<{ integrations: Integration[]; devices: Device[] }>('/api/mobile/v1/rrr/integrations'),
      apiRequest<{ events: Unresolved[] }>('/api/mobile/v1/rrr/mappings/unresolved'),
      apiRequest<{ members: Person[] }>('/api/mobile/v1/members?page=1&page_size=100'),
      apiRequest<{ rules: Record<string, number> }>('/api/mobile/v1/rrr/rules'),
      apiRequest<OwnerToday>('/api/mobile/v1/owner/today'),
    ]);
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
    if (mappings.ok) setUnresolved(mappings.data.events || []);
    if (members.ok) setPeople(members.data.members || []);
    if (ruleData.ok) setRules(ruleData.data.rules || {});
    if (ownerTodayData.ok) {
      setOwnerToday(ownerTodayData.data);
      setCashCount((current) => current || ownerTodayData.data.cash_close.counted_cash || ownerTodayData.data.collections.expected_cash || '');
    }
    setRefreshing(false);
  }, []);
  useEffect(() => {
    const initialLoad = setTimeout(() => { void load(); }, 0);
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
    if (result.ok) setPairingCode(`${result.data.pairing_code} · expires ${new Date(result.data.expires_at).toLocaleTimeString()}`);
    else Alert.alert('Pairing unavailable', result.error.message);
  };
  const selectDevice = async (id: number) => {
    if (!bridge) return;
    const result = await apiRequest(`/api/mobile/v1/rrr/integrations/${bridge.id}/device`, { method: 'POST', body: { device_id: id } });
    if (result.ok) void load(); else Alert.alert('Could not select device', result.error.message);
  };
  const queue = async (action: 'probe_info' | 'block_test' | 'unblock_test') => {
    if (!direct) return;
    if (action !== 'probe_info' && !/^[1-9][0-9]{0,8}$/.test(testUserId)) { Alert.alert('Temporary User ID required', 'Use a 1–9 digit temporary User ID that exists only for this test.'); return; }
    const result = await apiRequest(`/api/mobile/v1/rrr/integrations/${direct.id}/adms/commands`, { method: 'POST', body: { action, test_enroll_number: testUserId } });
    if (result.ok) { Alert.alert('Command queued', 'Keep the terminal online; it will receive this on its next cloud poll.'); void load(); }
    else Alert.alert('Command not queued', result.error.message);
  };
  const markActioned = async (id: number) => { const result = await apiRequest(`/api/mobile/v1/rrr/opportunities/${id}`, { method: 'PATCH', body: { status: 'actioned' } }); if (result.ok) void load(); else Alert.alert('Could not update opportunity', result.error.message); };
  const mapIdentity = async (externalId: string, memberId: number) => { const result = await apiRequest(`/api/mobile/v1/rrr/mappings/${encodeURIComponent(externalId)}`, { method: 'POST', body: { member_id: memberId } }); if (result.ok) void load(); else Alert.alert('Could not map biometric ID', result.error.message); };
  const saveRules = async () => { const result = await apiRequest('/api/mobile/v1/rrr/rules', { method: 'PUT', body: { rules } }); if (result.ok) Alert.alert('Saved', 'RRR signal thresholds updated.'); else Alert.alert('Could not save rules', result.error.message); };
  const closeCash = async () => {
    if (!cashCount.trim()) { Alert.alert('Cash amount required', 'Enter the cash physically counted at the front desk.'); return; }
    const result = await apiRequest<{ variance: string }>('/api/mobile/v1/owner/cash-close', { method: 'POST', body: { counted_cash: cashCount } });
    if (result.ok) { Alert.alert('Cash close saved', `Variance: ₹${money(Number(result.data.variance || 0))}`); void load(); }
    else Alert.alert('Could not save cash close', result.error.message);
  };
  const pillars = data?.pillars || {};
  const potential = Object.values(pillars).reduce((sum, item) => sum + Number(item.potential_revenue || 0), 0);
  const latest = commands[0];

  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={colors.brand} refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}>
    <TouchableOpacity onPress={onBack}><Text style={styles.back}>‹ Settings</Text></TouchableOpacity>
    <View style={styles.hero}><Text style={styles.eyebrow}>RRR GYM GROWTH SYSTEM</Text><Text style={styles.title}>Run the gym. Grow the business.</Text><Text style={styles.subtitle}>Revenue, retention, recovery and attendance—one owner workspace.</Text></View>
    <View style={styles.metrics}><Metric value={String(data?.members?.total ?? 0)} label="Members" /><Metric value={`${data?.members?.attendance_rate ?? 0}%`} label="Attendance" /><Metric value={`₹${money(potential)}`} label="Pipeline" /></View>
    {ownerToday && <View style={[styles.card, ownerStyles.todayCard]}><View style={styles.cardHeader}><View><Text style={styles.cardEyebrow}>OWNER TODAY</Text><Text style={styles.cardTitle}>Run this shift with clarity</Text></View><Text style={ownerStyles.todayTotal}>₹{money(Number(ownerToday.collections.total || 0))}</Text></View><Text style={styles.copy}>{ownerToday.follow_up_count} lead follow-up(s) and {ownerToday.trials_today.length} trial visit(s) need attention today.</Text>{ownerToday.actions.slice(0, 4).map((action, index) => <View style={ownerStyles.todayAction} key={`${action.title}-${index}`}><View style={[ownerStyles.actionDot, action.priority === 'high' && ownerStyles.actionDotHigh]} /><View style={ownerStyles.todayActionCopy}><Text style={styles.rowTitle}>{action.title}</Text><Text style={styles.rowSub}>{action.detail}</Text></View><Text style={ownerStyles.actionCount}>{action.count}</Text></View>)}<View style={ownerStyles.cashClose}><View style={ownerStyles.cashCloseCopy}><Text style={styles.rowTitle}>{ownerToday.cash_close.closed ? 'Cash close recorded' : 'Close cash today'}</Text><Text style={styles.rowSub}>Expected cash ₹{money(Number(ownerToday.collections.expected_cash || 0))}</Text></View><TextInput value={cashCount} onChangeText={setCashCount} keyboardType="decimal-pad" placeholder="Counted cash" placeholderTextColor={colors.muted} style={ownerStyles.cashInput} /></View><Button text={ownerToday.cash_close.closed ? 'Update cash close' : 'Record cash close'} onPress={() => void closeCash()} /></View>}
    {(['revenue', 'retain', 'recover'] as const).map((pillar) => { const tone = tones[pillar]; const values = pillars[pillar]; return <View key={pillar} style={[styles.focus, { backgroundColor: tone.surface }]}><View style={styles.focusTop}><View><Text style={[styles.focusLabel, { color: tone.color }]}>{tone.label}</Text><Text style={styles.rowSub}>{tone.copy}</Text></View><Text style={[styles.focusCount, { color: tone.color }]}>{values?.count ?? 0}</Text></View><View style={styles.focusBottom}><Text style={styles.copy}>{pillar === 'revenue' ? 'Revenue opportunities' : pillar === 'retain' ? 'Members at risk' : 'Inactive / expired'}</Text><Text style={[styles.focusValue, { color: tone.color }]}>₹{money(Number(values?.potential_revenue || 0))}</Text></View>{(data?.opportunities || []).filter((item) => item.pillar === pillar).slice(0, 2).map((item) => <TouchableOpacity key={item.id} onPress={() => void markActioned(item.id)} style={styles.opportunity}><View><Text style={styles.rowTitle}>{item.member.name}</Text><Text style={styles.rowSub}>{item.reason}</Text></View><Text style={[styles.link, { color: tone.color }]}>Action ›</Text></TouchableOpacity>)}</View>; })}
    <View style={[styles.card, styles.directCard]}><View style={styles.cardHeader}><View><Text style={styles.cardEyebrow}>ATTENDANCE CONNECTION</Text><Text style={styles.cardTitle}>Direct Cloud</Text></View><View style={[styles.status, direct?.status === 'connected' ? styles.live : styles.setup]}><Text style={[styles.statusText, direct?.status === 'connected' ? styles.liveText : styles.setupText]}>{direct?.status === 'connected' ? 'LIVE' : 'SET UP'}</Text></View></View>
      {direct ? <><Text style={styles.deviceTitle}>{direct.device_name || 'Gym entry terminal'}</Text><Text style={styles.copy}>{direct.device_serial} · {direct.records_synced || 0} attendance records · {data?.unmapped_count || 0} need review</Text><View style={styles.server}><Text style={styles.serverLabel}>Terminal Cloud Server</Text><Text selectable style={styles.serverHost}>{direct.terminal_settings?.server_address || '—'}</Text><Text style={styles.serverMeta}>ADMS mode · Port {direct.terminal_settings?.server_port ?? '—'} · HTTPS {direct.terminal_settings?.https === false ? 'off' : 'on'} · Path {direct.terminal_settings?.path || '/iclock'}</Text></View><Text style={styles.copy}>Terminal: Menu → Comm. → Cloud Server Setting. Save these values and make a test punch. Your phone never joins the gym LAN.</Text></> : <><Text style={styles.copy}>Connect eSSL attendance directly to RRR Cloud—no gym PC or bridge is required for attendance.</Text><TextInput style={styles.textInput} value={serial} onChangeText={setSerial} placeholder="Terminal serial number" placeholderTextColor={colors.muted} autoCapitalize="characters" /><TextInput style={styles.textInput} value={deviceName} onChangeText={setDeviceName} placeholder="Friendly terminal name" placeholderTextColor={colors.muted} /><Button text="Save terminal and continue" onPress={() => void provision()} /></>}</View>
    {direct && <View style={styles.card}><Text style={styles.cardEyebrow}>CONTROLLED DEVICE TEST</Text><Text style={styles.cardTitle}>Commissioning console</Text><Text style={styles.copy}>Only auditable test commands are available. Automatic access rules remain off until the terminal returns a supervised acknowledgment.</Text><Text style={styles.command}>{latest ? `${latest.action.replace('_', ' ')} · ${latest.status}${latest.result_code ? ` · ${latest.result_code}` : ''}` : 'No command sent yet.'}</Text><Button text="1. Send safe connection probe" onPress={() => void queue('probe_info')} secondary /><TextInput style={styles.textInput} value={testUserId} onChangeText={setTestUserId} keyboardType="number-pad" placeholder="Temporary terminal User ID (example: 999)" placeholderTextColor={colors.muted} /><View style={styles.commands}><TouchableOpacity style={styles.block} onPress={() => void queue('block_test')}><Text style={styles.blockText}>2. Test block</Text></TouchableOpacity><TouchableOpacity style={styles.unblock} onPress={() => void queue('unblock_test')}><Text style={styles.unblockText}>3. Test unblock</Text></TouchableOpacity></View></View>}
    <View style={styles.card}><Text style={styles.cardEyebrow}>FALLBACK CONNECTION</Text><Text style={styles.cardTitle}>eBioServer bridge</Text><Text style={styles.copy}>Use only where licensed eBioServer must remain on a gym PC. Direct Cloud does not require it.</Text><Text style={styles.copy}>Status: {bridge?.status || 'not configured'} · {bridge?.device_name || bridge?.device_serial || 'No selected device'}</Text>{devices.map((device) => <View style={styles.deviceRow} key={device.id}><View><Text style={styles.rowTitle}>{device.name}</Text><Text style={styles.rowSub}>{device.serial_number} · {device.status}</Text></View>{!device.selected && <TouchableOpacity onPress={() => void selectDevice(device.id)}><Text style={styles.link}>Select</Text></TouchableOpacity>}</View>)}<Button text="Generate gym-PC pairing code" onPress={() => void pairBridge()} secondary />{!!pairingCode && <Text selectable style={styles.code}>{pairingCode}</Text>}</View>
    <View style={styles.card}><Text style={styles.cardEyebrow}>IDENTITY REVIEW</Text><Text style={styles.cardTitle}>{unresolved.length} punches need a member</Text>{unresolved.length ? unresolved.slice(0, 5).map((event, index) => <View style={styles.deviceRow} key={`${event.biometric_user_id}-${index}`}><View><Text style={styles.rowTitle}>Terminal ID {event.biometric_user_id}</Text><Text style={styles.rowSub}>{new Date(event.punch_time).toLocaleString()}</Text></View><TouchableOpacity onPress={() => setPickerEvent(event)}><Text style={styles.link}>Map to member…</Text></TouchableOpacity></View>) : <Text style={styles.copy}>No unresolved biometric punches.</Text>}</View>
    <MemberPickerModal
      visible={pickerEvent !== null}
      title={pickerEvent ? `Map Terminal ID ${pickerEvent.biometric_user_id}` : 'Map to member'}
      people={people as PickerPerson[]}
      onClose={() => setPickerEvent(null)}
      onSelect={(person) => {
        const event = pickerEvent;
        setPickerEvent(null);
        if (event) void mapIdentity(event.biometric_user_id, person.id);
      }}
    />
    <View style={styles.card}><Text style={styles.cardEyebrow}>GROWTH ENGINE</Text><Text style={styles.cardTitle}>Signal thresholds</Text>{ruleFields.map(([key, label]) => <View style={styles.rule} key={key}><Text style={styles.copy}>{label}</Text><View style={styles.ruleValue}><TextInput keyboardType="number-pad" value={String(rules[key] ?? '')} onChangeText={(value) => setRules((old) => ({ ...old, [key]: Number(value) }))} style={styles.ruleInput} /><Text style={styles.unit}>{key === 'attendance_drop_percent' ? '%' : 'days'}</Text></View></View>)}<Button text="Save thresholds" onPress={() => void saveRules()} /></View>
  </ScrollView></SafeAreaView>;
}

function Metric({ value, label }: { value: string; label: string }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }
function Button({ text, onPress, secondary = false }: { text: string; onPress: () => void; secondary?: boolean }) { return <TouchableOpacity style={secondary ? styles.secondaryButton : styles.button} onPress={onPress}><Text style={secondary ? styles.secondaryText : styles.buttonText}>{text}</Text></TouchableOpacity>; }
function money(value: number) { return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number.isFinite(value) ? value : 0); }

const ownerStyles = StyleSheet.create({
  todayCard: { borderColor: colors.successBorder },
  todayTotal: { color: colors.successDark, fontSize: fontSize.xl, fontWeight: fontWeight.extrabold },
  todayAction: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: 1, borderColor: colors.borderLight, paddingTop: spacing.sm },
  actionDot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: colors.warning },
  actionDotHigh: { backgroundColor: colors.critical },
  todayActionCopy: { flex: 1 },
  actionCount: { color: colors.successDark, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  cashClose: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.gray50, borderRadius: radius.md, padding: spacing.sm, marginTop: spacing.xs },
  cashCloseCopy: { flex: 1 },
  cashInput: { minWidth: 110, color: colors.text, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 8, fontSize: fontSize.sm },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.section }, back: { color: colors.brand, fontWeight: fontWeight.semibold, fontSize: fontSize.md }, hero: { gap: spacing.xs, paddingTop: spacing.xs }, eyebrow: { color: colors.brand, fontWeight: fontWeight.bold, fontSize: fontSize.xs, letterSpacing: 1 }, title: { color: colors.text, fontSize: fontSize['4xl'], lineHeight: 30, fontWeight: fontWeight.extrabold }, subtitle: { color: colors.textSecondary, fontSize: fontSize.lg, lineHeight: 21 }, metrics: { flexDirection: 'row', gap: spacing.sm }, metric: { flex: 1, minHeight: 82, padding: spacing.md, justifyContent: 'center', backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadows.sm }, metricValue: { color: colors.text, fontSize: fontSize['2xl'], fontWeight: fontWeight.extrabold }, metricLabel: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: spacing.xs }, focus: { borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: colors.borderLight }, focusTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }, focusLabel: { fontSize: fontSize.lg, fontWeight: fontWeight.extrabold }, focusCount: { fontSize: fontSize['5xl'], lineHeight: 32, fontWeight: fontWeight.extrabold }, focusBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }, focusValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold }, opportunity: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing.sm, borderTopWidth: 1, borderColor: 'rgba(15,23,42,0.08)' }, rowTitle: { color: colors.text, fontWeight: fontWeight.semibold, fontSize: fontSize.sm }, rowSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 }, link: { color: colors.brand, fontWeight: fontWeight.bold, fontSize: fontSize.sm }, card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm, ...shadows.sm }, directCard: { borderColor: colors.successBorder }, cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }, cardEyebrow: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: fontWeight.bold, letterSpacing: .8 }, cardTitle: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.extrabold, marginTop: 2 }, status: { borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 5 }, live: { backgroundColor: colors.successSurface }, setup: { backgroundColor: colors.warningSurface }, statusText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold }, liveText: { color: colors.successDark }, setupText: { color: colors.warningDark }, deviceTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold }, copy: { color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 19 }, server: { padding: spacing.md, backgroundColor: colors.brandSubtle, borderRadius: radius.md, gap: 3 }, serverLabel: { color: colors.brandDark, fontSize: fontSize.xs, fontWeight: fontWeight.bold }, serverHost: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.bold }, serverMeta: { color: colors.textSecondary, fontSize: fontSize.xs }, textInput: { width: '100%', color: colors.text, backgroundColor: colors.gray50, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 11, fontSize: fontSize.base }, button: { backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.xs }, buttonText: { color: colors.textInverse, fontWeight: fontWeight.bold }, secondaryButton: { borderWidth: 1, borderColor: colors.successBorder, backgroundColor: colors.successSurface, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.xs }, secondaryText: { color: colors.successDark, fontWeight: fontWeight.bold }, command: { color: colors.text, backgroundColor: colors.gray50, borderRadius: radius.sm, padding: spacing.sm, fontSize: fontSize.sm }, commands: { flexDirection: 'row', gap: spacing.sm }, block: { flex: 1, backgroundColor: colors.criticalSurface, borderRadius: radius.md, borderColor: colors.criticalBorder, borderWidth: 1, padding: spacing.md, alignItems: 'center' }, blockText: { color: colors.criticalDark, fontSize: fontSize.sm, fontWeight: fontWeight.bold }, unblock: { flex: 1, backgroundColor: colors.successSurface, borderRadius: radius.md, borderColor: colors.successBorder, borderWidth: 1, padding: spacing.md, alignItems: 'center' }, unblockText: { color: colors.successDark, fontSize: fontSize.sm, fontWeight: fontWeight.bold }, deviceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderColor: colors.borderLight }, code: { color: colors.text, fontSize: fontSize.md, padding: spacing.sm, backgroundColor: colors.gray100, borderRadius: radius.sm }, rule: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: spacing.xs }, ruleValue: { flexDirection: 'row', alignItems: 'center', width: 104, backgroundColor: colors.gray50, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm }, ruleInput: { flex: 1, color: colors.text, textAlign: 'right', paddingVertical: spacing.xs, fontSize: fontSize.md }, unit: { color: colors.muted, fontSize: fontSize.xs, marginLeft: spacing.xs },
});

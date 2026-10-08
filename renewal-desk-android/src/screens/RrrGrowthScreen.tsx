import { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiRequest } from '../services/apiClient';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';

type Opportunity = { id: number; pillar: string; reason: string; potential_revenue: string; member: { name: string } };
type Device = { id: number; name: string; serial_number: string; status: string; selected: boolean };
type Unresolved = { biometric_user_id: string; punch_time: string };
type Person = { id: number; full_name: string };
type Integration = { id: number; type: 'adms_direct' | 'ebioserver'; status: string; device_name?: string; device_serial?: string; records_synced?: number };
type Command = { id: number; action: string; status: string; result_code?: string };
type Payload = { opportunities: Opportunity[]; pillars: Record<string, { count: number; potential_revenue: string }>; unmapped_count: number; members?: { total?: number; attendance_rate?: number } };
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
  const [pairingCode, setPairingCode] = useState('');
  const [serial, setSerial] = useState('');
  const [deviceName, setDeviceName] = useState('Elite Gym Entry');
  const [testUserId, setTestUserId] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const direct = integrations.find((item) => item.type === 'adms_direct');
  const bridge = integrations.find((item) => item.type === 'ebioserver');

  const load = useCallback(async () => {
    const [dashboard, integrationData, mappings, members, ruleData] = await Promise.all([
      apiRequest<Payload>('/api/mobile/v1/rrr/dashboard'),
      apiRequest<{ integrations: Integration[]; devices: Device[] }>('/api/mobile/v1/rrr/integrations'),
      apiRequest<{ events: Unresolved[] }>('/api/mobile/v1/rrr/mappings/unresolved'),
      apiRequest<{ members: Person[] }>('/api/mobile/v1/members?page=1&page_size=100'),
      apiRequest<{ rules: Record<string, number> }>('/api/mobile/v1/rrr/rules'),
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
    setRefreshing(false);
  }, []);
  useEffect(() => {
    const initialLoad = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(initialLoad);
  }, [load]);

  const provision = async () => {
    if (!serial.trim()) { Alert.alert('Terminal serial required', 'Enter the serial from Menu → System Info.'); return; }
    const result = await apiRequest('/api/mobile/v1/rrr/integrations/adms/provision', { method: 'POST', body: { device_serial: serial.trim(), device_name: deviceName.trim() || 'Gym entry terminal' } });
    if (result.ok) { Alert.alert('Terminal saved', 'Set Cloud Server to gym-production-910c.up.railway.app, port 443, HTTPS on, ADMS mode; then make one test punch.'); void load(); }
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
  const pillars = data?.pillars || {};
  const potential = Object.values(pillars).reduce((sum, item) => sum + Number(item.potential_revenue || 0), 0);
  const latest = commands[0];

  return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl tintColor={colors.brand} refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}>
    <TouchableOpacity onPress={onBack}><Text style={styles.back}>‹ Settings</Text></TouchableOpacity>
    <View style={styles.hero}><Text style={styles.eyebrow}>RRR GYM GROWTH SYSTEM</Text><Text style={styles.title}>Run the gym. Grow the business.</Text><Text style={styles.subtitle}>Revenue, retention, recovery and attendance—one owner workspace.</Text></View>
    <View style={styles.metrics}><Metric value={String(data?.members?.total ?? 0)} label="Members" /><Metric value={`${data?.members?.attendance_rate ?? 0}%`} label="Attendance" /><Metric value={`₹${money(potential)}`} label="Pipeline" /></View>
    {(['revenue', 'retain', 'recover'] as const).map((pillar) => { const tone = tones[pillar]; const values = pillars[pillar]; return <View key={pillar} style={[styles.focus, { backgroundColor: tone.surface }]}><View style={styles.focusTop}><View><Text style={[styles.focusLabel, { color: tone.color }]}>{tone.label}</Text><Text style={styles.rowSub}>{tone.copy}</Text></View><Text style={[styles.focusCount, { color: tone.color }]}>{values?.count ?? 0}</Text></View><View style={styles.focusBottom}><Text style={styles.copy}>{pillar === 'revenue' ? 'Revenue opportunities' : pillar === 'retain' ? 'Members at risk' : 'Inactive / expired'}</Text><Text style={[styles.focusValue, { color: tone.color }]}>₹{money(Number(values?.potential_revenue || 0))}</Text></View>{(data?.opportunities || []).filter((item) => item.pillar === pillar).slice(0, 2).map((item) => <TouchableOpacity key={item.id} onPress={() => void markActioned(item.id)} style={styles.opportunity}><View><Text style={styles.rowTitle}>{item.member.name}</Text><Text style={styles.rowSub}>{item.reason}</Text></View><Text style={[styles.link, { color: tone.color }]}>Action ›</Text></TouchableOpacity>)}</View>; })}
    <View style={[styles.card, styles.directCard]}><View style={styles.cardHeader}><View><Text style={styles.cardEyebrow}>ATTENDANCE CONNECTION</Text><Text style={styles.cardTitle}>Direct Cloud</Text></View><View style={[styles.status, direct?.status === 'connected' ? styles.live : styles.setup]}><Text style={[styles.statusText, direct?.status === 'connected' ? styles.liveText : styles.setupText]}>{direct?.status === 'connected' ? 'LIVE' : 'SET UP'}</Text></View></View>
      {direct ? <><Text style={styles.deviceTitle}>{direct.device_name || 'Gym entry terminal'}</Text><Text style={styles.copy}>{direct.device_serial} · {direct.records_synced || 0} attendance records · {data?.unmapped_count || 0} need review</Text><View style={styles.server}><Text style={styles.serverLabel}>Terminal Cloud Server</Text><Text selectable style={styles.serverHost}>gym-production-910c.up.railway.app</Text><Text style={styles.serverMeta}>ADMS mode · Port 443 · HTTPS on · Path /iclock</Text></View><Text style={styles.copy}>Terminal: Menu → Comm. → Cloud Server Setting. Save these values and make a test punch. Your phone never joins the gym LAN.</Text></> : <><Text style={styles.copy}>Connect eSSL attendance directly to RRR Cloud—no gym PC or bridge is required for attendance.</Text><TextInput style={styles.textInput} value={serial} onChangeText={setSerial} placeholder="Terminal serial number" placeholderTextColor={colors.muted} autoCapitalize="characters" /><TextInput style={styles.textInput} value={deviceName} onChangeText={setDeviceName} placeholder="Friendly terminal name" placeholderTextColor={colors.muted} /><Button text="Save terminal and continue" onPress={() => void provision()} /></>}</View>
    {direct && <View style={styles.card}><Text style={styles.cardEyebrow}>CONTROLLED DEVICE TEST</Text><Text style={styles.cardTitle}>Commissioning console</Text><Text style={styles.copy}>Only auditable test commands are available. Automatic access rules remain off until the terminal returns a supervised acknowledgment.</Text><Text style={styles.command}>{latest ? `${latest.action.replace('_', ' ')} · ${latest.status}${latest.result_code ? ` · ${latest.result_code}` : ''}` : 'No command sent yet.'}</Text><Button text="1. Send safe connection probe" onPress={() => void queue('probe_info')} secondary /><TextInput style={styles.textInput} value={testUserId} onChangeText={setTestUserId} keyboardType="number-pad" placeholder="Temporary terminal User ID (example: 999)" placeholderTextColor={colors.muted} /><View style={styles.commands}><TouchableOpacity style={styles.block} onPress={() => void queue('block_test')}><Text style={styles.blockText}>2. Test block</Text></TouchableOpacity><TouchableOpacity style={styles.unblock} onPress={() => void queue('unblock_test')}><Text style={styles.unblockText}>3. Test unblock</Text></TouchableOpacity></View></View>}
    <View style={styles.card}><Text style={styles.cardEyebrow}>FALLBACK CONNECTION</Text><Text style={styles.cardTitle}>eBioServer bridge</Text><Text style={styles.copy}>Use only where licensed eBioServer must remain on a gym PC. Direct Cloud does not require it.</Text><Text style={styles.copy}>Status: {bridge?.status || 'not configured'} · {bridge?.device_name || bridge?.device_serial || 'No selected device'}</Text>{devices.map((device) => <View style={styles.deviceRow} key={device.id}><View><Text style={styles.rowTitle}>{device.name}</Text><Text style={styles.rowSub}>{device.serial_number} · {device.status}</Text></View>{!device.selected && <TouchableOpacity onPress={() => void selectDevice(device.id)}><Text style={styles.link}>Select</Text></TouchableOpacity>}</View>)}<Button text="Generate gym-PC pairing code" onPress={() => void pairBridge()} secondary />{!!pairingCode && <Text selectable style={styles.code}>{pairingCode}</Text>}</View>
    <View style={styles.card}><Text style={styles.cardEyebrow}>IDENTITY REVIEW</Text><Text style={styles.cardTitle}>{unresolved.length} punches need a member</Text>{unresolved.length ? unresolved.slice(0, 5).map((event, index) => <View style={styles.deviceRow} key={`${event.biometric_user_id}-${index}`}><View><Text style={styles.rowTitle}>Terminal ID {event.biometric_user_id}</Text><Text style={styles.rowSub}>{new Date(event.punch_time).toLocaleString()}</Text></View>{people[0] && <TouchableOpacity onPress={() => void mapIdentity(event.biometric_user_id, people[0].id)}><Text style={styles.link}>Map to {people[0].full_name}</Text></TouchableOpacity>}</View>) : <Text style={styles.copy}>No unresolved biometric punches.</Text>}</View>
    <View style={styles.card}><Text style={styles.cardEyebrow}>GROWTH ENGINE</Text><Text style={styles.cardTitle}>Signal thresholds</Text>{ruleFields.map(([key, label]) => <View style={styles.rule} key={key}><Text style={styles.copy}>{label}</Text><View style={styles.ruleValue}><TextInput keyboardType="number-pad" value={String(rules[key] ?? '')} onChangeText={(value) => setRules((old) => ({ ...old, [key]: Number(value) }))} style={styles.ruleInput} /><Text style={styles.unit}>{key === 'attendance_drop_percent' ? '%' : 'days'}</Text></View></View>)}<Button text="Save thresholds" onPress={() => void saveRules()} /></View>
  </ScrollView></SafeAreaView>;
}

function Metric({ value, label }: { value: string; label: string }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }
function Button({ text, onPress, secondary = false }: { text: string; onPress: () => void; secondary?: boolean }) { return <TouchableOpacity style={secondary ? styles.secondaryButton : styles.button} onPress={onPress}><Text style={secondary ? styles.secondaryText : styles.buttonText}>{text}</Text></TouchableOpacity>; }
function money(value: number) { return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number.isFinite(value) ? value : 0); }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.section }, back: { color: colors.brand, fontWeight: fontWeight.semibold, fontSize: fontSize.md }, hero: { gap: spacing.xs, paddingTop: spacing.xs }, eyebrow: { color: colors.brand, fontWeight: fontWeight.bold, fontSize: fontSize.xs, letterSpacing: 1 }, title: { color: colors.text, fontSize: fontSize['4xl'], lineHeight: 30, fontWeight: fontWeight.extrabold }, subtitle: { color: colors.textSecondary, fontSize: fontSize.lg, lineHeight: 21 }, metrics: { flexDirection: 'row', gap: spacing.sm }, metric: { flex: 1, minHeight: 82, padding: spacing.md, justifyContent: 'center', backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadows.sm }, metricValue: { color: colors.text, fontSize: fontSize['2xl'], fontWeight: fontWeight.extrabold }, metricLabel: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: spacing.xs }, focus: { borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: colors.borderLight }, focusTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }, focusLabel: { fontSize: fontSize.lg, fontWeight: fontWeight.extrabold }, focusCount: { fontSize: fontSize['5xl'], lineHeight: 32, fontWeight: fontWeight.extrabold }, focusBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }, focusValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold }, opportunity: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: spacing.sm, borderTopWidth: 1, borderColor: 'rgba(15,23,42,0.08)' }, rowTitle: { color: colors.text, fontWeight: fontWeight.semibold, fontSize: fontSize.sm }, rowSub: { color: colors.textSecondary, fontSize: fontSize.xs, marginTop: 2 }, link: { color: colors.brand, fontWeight: fontWeight.bold, fontSize: fontSize.sm }, card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm, ...shadows.sm }, directCard: { borderColor: colors.successBorder }, cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }, cardEyebrow: { color: colors.textSecondary, fontSize: fontSize.xs, fontWeight: fontWeight.bold, letterSpacing: .8 }, cardTitle: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.extrabold, marginTop: 2 }, status: { borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 5 }, live: { backgroundColor: colors.successSurface }, setup: { backgroundColor: colors.warningSurface }, statusText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold }, liveText: { color: colors.successDark }, setupText: { color: colors.warningDark }, deviceTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold }, copy: { color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 19 }, server: { padding: spacing.md, backgroundColor: colors.brandSubtle, borderRadius: radius.md, gap: 3 }, serverLabel: { color: colors.brandDark, fontSize: fontSize.xs, fontWeight: fontWeight.bold }, serverHost: { color: colors.text, fontSize: fontSize.md, fontWeight: fontWeight.bold }, serverMeta: { color: colors.textSecondary, fontSize: fontSize.xs }, textInput: { width: '100%', color: colors.text, backgroundColor: colors.gray50, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 11, fontSize: fontSize.base }, button: { backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.xs }, buttonText: { color: colors.textInverse, fontWeight: fontWeight.bold }, secondaryButton: { borderWidth: 1, borderColor: colors.successBorder, backgroundColor: colors.successSurface, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.xs }, secondaryText: { color: colors.successDark, fontWeight: fontWeight.bold }, command: { color: colors.text, backgroundColor: colors.gray50, borderRadius: radius.sm, padding: spacing.sm, fontSize: fontSize.sm }, commands: { flexDirection: 'row', gap: spacing.sm }, block: { flex: 1, backgroundColor: colors.criticalSurface, borderRadius: radius.md, borderColor: colors.criticalBorder, borderWidth: 1, padding: spacing.md, alignItems: 'center' }, blockText: { color: colors.criticalDark, fontSize: fontSize.sm, fontWeight: fontWeight.bold }, unblock: { flex: 1, backgroundColor: colors.successSurface, borderRadius: radius.md, borderColor: colors.successBorder, borderWidth: 1, padding: spacing.md, alignItems: 'center' }, unblockText: { color: colors.successDark, fontSize: fontSize.sm, fontWeight: fontWeight.bold }, deviceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderColor: colors.borderLight }, code: { color: colors.text, fontSize: fontSize.md, padding: spacing.sm, backgroundColor: colors.gray100, borderRadius: radius.sm }, rule: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: spacing.xs }, ruleValue: { flexDirection: 'row', alignItems: 'center', width: 104, backgroundColor: colors.gray50, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm }, ruleInput: { flex: 1, color: colors.text, textAlign: 'right', paddingVertical: spacing.xs, fontSize: fontSize.md }, unit: { color: colors.muted, fontSize: fontSize.xs, marginLeft: spacing.xs },
});

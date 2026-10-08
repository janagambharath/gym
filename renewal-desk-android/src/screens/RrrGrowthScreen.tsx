import { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiRequest } from '../services/apiClient';
import { colors, fontSize, fontWeight, radius, spacing } from '../theme/tokens';

type Opportunity = { id: number; pillar: string; reason: string; potential_revenue: string; member: { name: string } };
type Device = { id: number; name: string; serial_number: string; status: string; selected: boolean };
type Unresolved = { biometric_user_id: string; punch_time: string; source: string; device_serial?: string };
type Person = { id: number; full_name: string; phone: string };
type Payload = { opportunities: Opportunity[]; pillars: Record<string, { count: number; potential_revenue: string }>; integration: any; unmapped_count: number };
const ruleFields = [['expiry_days', 'Expiry window (days)'], ['no_visit_days', 'No visit (days)'], ['attendance_drop_percent', 'Attendance decline (%)'], ['recent_expiry_days', 'Recent expiry (days)']] as const;

export function RrrGrowthScreen({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<Payload>();
  const [devices, setDevices] = useState<Device[]>([]);
  const [unresolved, setUnresolved] = useState<Unresolved[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [rules, setRules] = useState<Record<string, number>>({});
  const [code, setCode] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    const [dashboard, integrations, mappingData, memberData, ruleData] = await Promise.all([
      apiRequest<Payload>('/api/mobile/v1/rrr/dashboard'),
      apiRequest<{ integrations: any[]; devices: Device[] }>('/api/mobile/v1/rrr/integrations'),
      apiRequest<{ events: Unresolved[] }>('/api/mobile/v1/rrr/mappings/unresolved'),
      apiRequest<{ members: Person[] }>('/api/mobile/v1/members?page=1&page_size=100'),
      apiRequest<{ rules: Record<string, number> }>('/api/mobile/v1/rrr/rules'),
    ]);
    if (dashboard.ok) setData(dashboard.data);
    if (integrations.ok) {
      setDevices(integrations.data.devices || []);
      setData((old) => old ? { ...old, integration: integrations.data.integrations.find((x) => x.type === 'ebioserver') } : old);
    }
    if (mappingData.ok) setUnresolved(mappingData.data.events || []);
    if (memberData.ok) setPeople(memberData.data.members || []);
    if (ruleData.ok) setRules(ruleData.data.rules || {});
    setRefreshing(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const pair = async () => {
    const result = await apiRequest<{ pairing_code: string; expires_at: string }>('/api/mobile/v1/rrr/integrations/ebioserver/pairing', { method: 'POST', body: {} });
    if (result.ok) setCode(`${result.data.pairing_code} · expires ${new Date(result.data.expires_at).toLocaleTimeString()}`);
    else Alert.alert('Pairing unavailable', result.error.message);
  };
  const selectDevice = async (id: number) => {
    const integration = data?.integration;
    if (!integration) return;
    const result = await apiRequest(`/api/mobile/v1/rrr/integrations/${integration.id}/device`, { method: 'POST', body: { device_id: id } });
    if (result.ok) void load(); else Alert.alert('Could not select device', result.error.message);
  };
  const markActioned = async (id: number) => {
    const result = await apiRequest(`/api/mobile/v1/rrr/opportunities/${id}`, { method: 'PATCH', body: { status: 'actioned' } });
    if (result.ok) void load(); else Alert.alert('Could not update opportunity', result.error.message);
  };
  const mapIdentity = async (externalId: string, memberId: number) => {
    const result = await apiRequest(`/api/mobile/v1/rrr/mappings/${encodeURIComponent(externalId)}`, { method: 'POST', body: { member_id: memberId } });
    if (result.ok) void load(); else Alert.alert('Could not map biometric ID', result.error.message);
  };
  const saveRules = async () => {
    const result = await apiRequest('/api/mobile/v1/rrr/rules', { method: 'PUT', body: { rules } });
    if (result.ok) Alert.alert('Saved', 'RRR thresholds updated.'); else Alert.alert('Could not save rules', result.error.message);
  };
  const pillars = data?.pillars || {};
  return <SafeAreaView style={styles.safe}>
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}>
      <TouchableOpacity onPress={onBack}><Text style={styles.back}>‹  Settings</Text></TouchableOpacity>
      <Text style={styles.title}>RRR Growth System</Text>
      <Text style={styles.subtitle}>Live Revenue, Retain and Recover opportunities from your gym records.</Text>
      {['revenue', 'retain', 'recover'].map((pillar) => <View style={styles.card} key={pillar}>
        <Text style={styles.cardTitle}>{pillar.toUpperCase()}</Text>
        <Text style={styles.metric}>{pillars[pillar]?.count ?? 0} opportunities</Text>
        <Text style={styles.copy}>Potential revenue: ₹{pillars[pillar]?.potential_revenue ?? '0'}</Text>
        {(data?.opportunities || []).filter((item) => item.pillar === pillar).slice(0, 3).map((item) => <View key={item.id} style={styles.opportunity}><Text style={styles.row}>• {item.member.name} — {item.reason}</Text><TouchableOpacity onPress={() => void markActioned(item.id)}><Text style={styles.link}>Mark actioned</Text></TouchableOpacity></View>)}
      </View>)}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>eSSL eBioServer</Text>
        <Text style={styles.copy}>Connector: {data?.integration?.status || 'not configured'} · {data?.integration?.records_synced || 0} punches · {data?.unmapped_count || 0} need identity mapping</Text>
        <Text style={styles.copy}>Selected device: {data?.integration?.device_name || data?.integration?.device_serial || 'none'}</Text>
        {devices.map((device) => <View style={styles.device} key={device.id}>
          <Text style={styles.copy}>{device.name} · {device.serial_number} · {device.status}</Text>
          {!device.selected && <TouchableOpacity onPress={() => void selectDevice(device.id)}><Text style={styles.link}>Select this device</Text></TouchableOpacity>}
        </View>)}
        <TouchableOpacity style={styles.button} onPress={() => void pair()}><Text style={styles.buttonText}>Generate gym-PC pairing code</Text></TouchableOpacity>
        {!!code && <Text selectable style={styles.code}>{code}</Text>}
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Unmapped biometric IDs · {unresolved.length}</Text>
        {unresolved.length ? unresolved.slice(0, 10).map((event, index) => <View style={styles.device} key={`${event.biometric_user_id}-${index}`}>
          <Text style={styles.copy}>ID {event.biometric_user_id} · {new Date(event.punch_time).toLocaleString()}</Text>
          {people.slice(0, 5).map((person) => <TouchableOpacity key={person.id} onPress={() => void mapIdentity(event.biometric_user_id, person.id)}><Text style={styles.link}>Map to {person.full_name}</Text></TouchableOpacity>)}
        </View>) : <Text style={styles.copy}>No unresolved punches.</Text>}
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Signal thresholds</Text>
        {ruleFields.map(([key, label]) => <View style={styles.ruleRow} key={key}><Text style={styles.copy}>{label}</Text><TextInput keyboardType="number-pad" value={String(rules[key] ?? '')} onChangeText={(value) => setRules((old) => ({ ...old, [key]: Number(value) }))} style={styles.input} /></View>)}
        <TouchableOpacity style={styles.button} onPress={() => void saveRules()}><Text style={styles.buttonText}>Save thresholds</Text></TouchableOpacity>
      </View>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.background }, content: { padding: spacing.lg, gap: spacing.md }, back: { color: colors.brand, fontSize: fontSize.md }, title: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.bold }, subtitle: { color: colors.textSecondary }, card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs }, cardTitle: { color: colors.brand, fontWeight: fontWeight.bold, fontSize: fontSize.md }, metric: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold }, copy: { color: colors.textSecondary, fontSize: fontSize.sm }, row: { color: colors.text, fontSize: fontSize.sm, paddingTop: spacing.xs }, opportunity: { borderTopWidth: 1, borderColor: colors.border, paddingTop: spacing.xs }, device: { borderTopWidth: 1, borderColor: colors.border, paddingTop: spacing.sm }, ruleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: spacing.xs }, input: { width: 72, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.xs, textAlign: 'center', color: colors.text }, link: { color: colors.brand, fontWeight: fontWeight.semibold, paddingTop: spacing.xs }, button: { backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.sm }, buttonText: { color: '#fff', fontWeight: fontWeight.bold }, code: { color: colors.text, fontSize: fontSize.md, padding: spacing.sm, backgroundColor: colors.gray100, borderRadius: radius.sm } });

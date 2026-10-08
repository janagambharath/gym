import { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiRequest } from '../services/apiClient';
import { colors, fontSize, fontWeight, radius, spacing } from '../theme/tokens';

type Opportunity = { id: number; pillar: string; reason: string; potential_revenue: string; member: { name: string } };
type Device = { id: number; name: string; serial_number: string; status: string; selected: boolean };
type Payload = { opportunities: Opportunity[]; pillars: Record<string, { count: number; potential_revenue: string }>; integration: any; unmapped_count: number };

export function RrrGrowthScreen({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<Payload>();
  const [devices, setDevices] = useState<Device[]>([]);
  const [code, setCode] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    const [dashboard, integrations] = await Promise.all([
      apiRequest<Payload>('/api/mobile/v1/rrr/dashboard'),
      apiRequest<{ integrations: any[]; devices: Device[] }>('/api/mobile/v1/rrr/integrations'),
    ]);
    if (dashboard.ok) setData(dashboard.data);
    if (integrations.ok) {
      setDevices(integrations.data.devices || []);
      setData((old) => old ? { ...old, integration: integrations.data.integrations.find((x) => x.type === 'ebioserver') } : old);
    }
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
        {(data?.opportunities || []).filter((item) => item.pillar === pillar).slice(0, 3).map((item) => <Text key={item.id} style={styles.row}>• {item.member.name} — {item.reason}</Text>)}
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
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.background }, content: { padding: spacing.lg, gap: spacing.md }, back: { color: colors.brand, fontSize: fontSize.md }, title: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.bold }, subtitle: { color: colors.textSecondary }, card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs }, cardTitle: { color: colors.brand, fontWeight: fontWeight.bold, fontSize: fontSize.md }, metric: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold }, copy: { color: colors.textSecondary, fontSize: fontSize.sm }, row: { color: colors.text, fontSize: fontSize.sm, paddingTop: spacing.xs }, device: { borderTopWidth: 1, borderColor: colors.border, paddingTop: spacing.sm }, link: { color: colors.brand, fontWeight: fontWeight.semibold, paddingTop: spacing.xs }, button: { backgroundColor: colors.brand, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginTop: spacing.sm }, buttonText: { color: '#fff', fontWeight: fontWeight.bold }, code: { color: colors.text, fontSize: fontSize.md, padding: spacing.sm, backgroundColor: colors.gray100, borderRadius: radius.sm } });

import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../components/AppHeader';
import { FormField } from '../components/FormField';
import { PrimaryButton } from '../components/PrimaryButton';
import { apiRequest } from '../services/apiClient';
import { colors, fontSize, fontWeight, radius, spacing } from '../theme/tokens';

type ImportRow = { row: number; errors: string[]; status: 'VALID' | 'INVALID' | 'DUPLICATE'; values: Record<string, string> };
type Preview = { rows: ImportRow[]; summary: { total: number; valid: number; invalid: number; duplicates: number }; file_errors: string[] };
type MemberImportScreenProps = { onBack: () => void; onComplete?: () => void };

export function MemberImportScreen({ onBack, onComplete }: MemberImportScreenProps) {
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState<Preview>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [selectedFileName, setSelectedFileName] = useState<string>();

  const pickCsvFile = useCallback(async () => {
    setError(undefined);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'application/csv', 'application/vnd.ms-excel'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      if (asset.size && asset.size > 2 * 1024 * 1024) {
        setError('CSV must be 2 MB or smaller.');
        return;
      }
      const contents = await new File(asset.uri).text();
      setCsvText(contents);
      setSelectedFileName(asset.name);
      setPreview(undefined);
    } catch {
      setError('Could not read that file. Choose a UTF-8 CSV and try again.');
    }
  }, []);

  const previewImport = useCallback(async () => {
    setLoading(true); setError(undefined);
    const result = await apiRequest<Preview>('/api/mobile/v1/members/import/preview', { method: 'POST', body: { csv_text: csvText } });
    if (result.ok) setPreview(result.data); else setError(result.error.message);
    setLoading(false);
  }, [csvText]);

  const confirmImport = useCallback(async () => {
    if (!preview || preview.summary.invalid || preview.summary.duplicates || preview.file_errors.length) return;
    setLoading(true); setError(undefined);
    const result = await apiRequest<{ imported: number }>('/api/mobile/v1/members/import', { method: 'POST', body: { csv_text: csvText } });
    setLoading(false);
    if (result.ok) {
      Alert.alert('Import complete', `${result.data.imported} members imported.`);
      onComplete?.(); onBack();
    } else setError(result.error.message);
  }, [csvText, onBack, onComplete, preview]);

  return <SafeAreaView style={styles.safeArea}>
    <AppHeader title="Import members" onBack={onBack} />
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.title}>Pick a CSV for validation</Text>
        <Text style={styles.text}>Required columns: full_name, phone, membership_start, membership_end. Phone must use E.164 and dates use YYYY-MM-DD. The backend performs the same validation before atomic import.</Text>
        <PrimaryButton label="Pick CSV file" onPress={() => void pickCsvFile()} variant="outline" />
        {selectedFileName ? <Text style={styles.fileName}>Selected: {selectedFileName}</Text> : null}
        <FormField label="CSV data" value={csvText} onChangeText={setCsvText} multiline numberOfLines={10} placeholder="full_name,phone,membership_start,membership_end\nAsha,+919876543210,2026-09-01,2026-10-01" />
        <Text style={styles.notice}>You can review or correct the selected CSV before previewing. Invalid and duplicate rows are shown individually and block import.</Text>
        <PrimaryButton label="Preview and validate" onPress={() => void previewImport()} loading={loading} disabled={!csvText.trim()} />
      </View>
      {preview ? <View style={styles.card}>
        <Text style={styles.title}>Preview</Text>
        <View style={styles.summary}><Summary label="Total" value={preview.summary.total} /><Summary label="Valid" value={preview.summary.valid} /><Summary label="Invalid" value={preview.summary.invalid} /><Summary label="Duplicates" value={preview.summary.duplicates} /></View>
        {preview.file_errors.map((item) => <Text key={item} style={styles.error}>{item}</Text>)}
        {preview.rows.filter((row) => row.status !== 'VALID').map((row) => <View key={row.row} style={styles.row}><Text style={styles.rowTitle}>Row {row.row} · {row.status}</Text><Text style={styles.error}>{row.errors.join('; ')}</Text></View>)}
        {preview.summary.valid > 0 && !preview.summary.invalid && !preview.summary.duplicates && !preview.file_errors.length ? <PrimaryButton label="Confirm import" onPress={() => void confirmImport()} loading={loading} /> : <Text style={styles.notice}>Fix every invalid or duplicate row before confirming. No rows will be silently skipped.</Text>}
      </View> : null}
      {error ? <View style={styles.errorCard}><Text style={styles.error}>{error}</Text></View> : null}
    </ScrollView>
  </SafeAreaView>;
}

function Summary({ label, value }: { label: string; value: number }) { return <View><Text style={styles.summaryValue}>{value}</Text><Text style={styles.summaryLabel}>{label}</Text></View>; }

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.section },
  error: { color: colors.critical, fontSize: fontSize.sm, lineHeight: 20 },
  errorCard: { backgroundColor: colors.criticalSurface, borderColor: colors.criticalBorder, borderRadius: radius.md, borderWidth: 1, padding: spacing.md },
  fileName: { color: colors.success, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  notice: { color: colors.statusPending, fontSize: fontSize.sm, lineHeight: 20 },
  row: { borderTopColor: colors.borderLight, borderTopWidth: 1, gap: spacing.xs, paddingTop: spacing.md },
  rowTitle: { color: colors.text, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  summary: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryLabel: { color: colors.muted, fontSize: fontSize.xs },
  summaryValue: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.bold, textAlign: 'center' },
  text: { color: colors.textSecondary, fontSize: fontSize.base, lineHeight: 22 },
  title: { color: colors.text, fontSize: fontSize.xl, fontWeight: fontWeight.bold },
});

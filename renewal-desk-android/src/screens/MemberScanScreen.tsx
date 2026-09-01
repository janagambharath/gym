import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../components/AppHeader';
import { PrimaryButton } from '../components/PrimaryButton';
import { scanMemberDocuments, type ScanDocumentResult } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';

type SelectedImage = {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
  base64Data?: string;
};

type MemberScanScreenProps = {
  onBack: () => void;
  onScanComplete: (result: ScanDocumentResult) => void;
  onNavigateCSV: () => void;
  onNavigateManual: () => void;
};

export function MemberScanScreen({
  onBack,
  onScanComplete,
  onNavigateCSV,
  onNavigateManual,
}: MemberScanScreenProps) {
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [processingStep, setProcessingStep] = useState<string>('Reading records…');
  const [error, setError] = useState<string | null>(null);

  const pickImages = useCallback(async () => {
    setError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/jpeg', 'image/png', 'image/webp', 'image/*'],
        copyToCacheDirectory: true,
        multiple: true,
      });

      if (result.canceled || !result.assets) return;

      const newImages: SelectedImage[] = [];
      for (const asset of result.assets) {
        if (asset.size && asset.size > 5 * 1024 * 1024) {
          Alert.alert('File Too Large', `Image ${asset.name} is larger than 5 MB.`);
          continue;
        }

        try {
          const file = new File(asset.uri);
          const base64Content = await file.base64();
          newImages.push({
            uri: asset.uri,
            name: asset.name,
            mimeType: asset.mimeType || 'image/jpeg',
            size: asset.size,
            base64Data: base64Content,
          });
        } catch {
          // If direct base64 fails, still keep URI
          newImages.push({
            uri: asset.uri,
            name: asset.name,
            mimeType: asset.mimeType || 'image/jpeg',
            size: asset.size,
          });
        }
      }

      setSelectedImages((prev) => {
        const combined = [...prev, ...newImages];
        return combined.slice(0, 5); // Max 5 pages
      });
    } catch {
      setError('Could not access image picker. Please try again.');
    }
  }, []);

  const removeImage = useCallback((index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleScan = useCallback(async () => {
    if (selectedImages.length === 0) return;

    setLoading(true);
    setError(null);
    setProcessingStep('Reading document pages…');

    const stepTimer1 = setTimeout(() => {
      setProcessingStep('Extracting names, phones, and expiry dates…');
    }, 2500);

    const stepTimer2 = setTimeout(() => {
      setProcessingStep('Matching membership plans & checking duplicates…');
    }, 6000);

    try {
      const imagePayloads: { data: string; mime_type: string; filename: string }[] = [];

      for (const img of selectedImages) {
        let b64 = img.base64Data;
        if (!b64) {
          const file = new File(img.uri);
          b64 = await file.base64();
        }
        imagePayloads.push({
          data: b64,
          mime_type: img.mimeType,
          filename: img.name,
        });
      }

      const res = await scanMemberDocuments(imagePayloads);

      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);
      setLoading(false);

      if (res.ok) {
        if (!res.data.members || res.data.members.length === 0) {
          setError('No legible member records were detected in these images. Please ensure the text is clear, or use CSV import.');
        } else {
          onScanComplete(res.data);
        }
      } else {
        setError(res.error.message || 'We could not read this document right now. Please try again or use CSV.');
      }
    } catch (err: any) {
      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);
      setLoading(false);
      setError(err?.message || 'A network error occurred while scanning. Please check your connection.');
    }
  }, [selectedImages, onScanComplete]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Scan Member Records" onBack={onBack} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerInfo}>
          <Text style={styles.title}>Scan Paper Registers & Records</Text>
          <Text style={styles.subtitle}>
            Take photos or select scanned pages of your membership ledger, registration forms, or receipts.
          </Text>
        </View>

        {/* Selected Images Preview List */}
        {selectedImages.length > 0 ? (
          <View style={styles.previewSection}>
            <View style={styles.previewHeader}>
              <Text style={styles.previewCount}>
                {selectedImages.length} page{selectedImages.length > 1 ? 's' : ''} selected (max 5)
              </Text>
              {selectedImages.length < 5 && !loading ? (
                <TouchableOpacity onPress={pickImages} style={styles.addMoreBtn} activeOpacity={0.7}>
                  <Icon name="personAdd" size={14} color={colors.brand} />
                  <Text style={styles.addMoreText}>+ Add Page</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbnailList}>
              {selectedImages.map((img, idx) => (
                <View key={img.uri + idx} style={styles.thumbnailWrap}>
                  <Image source={{ uri: img.uri }} style={styles.thumbnail} />
                  <View style={styles.pageBadge}>
                    <Text style={styles.pageBadgeText}>Page {idx + 1}</Text>
                  </View>
                  {!loading && (
                    <TouchableOpacity
                      style={styles.deleteThumbBtn}
                      onPress={() => removeImage(idx)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Icon name="close" size={12} color="#fff" />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </ScrollView>
          </View>
        ) : (
          /* Empty Selection Dropzone */
          <TouchableOpacity
            style={styles.uploadBox}
            onPress={pickImages}
            disabled={loading}
            activeOpacity={0.8}
          >
            <View style={styles.uploadIconWrap}>
              <Icon name="camera" size={32} color={colors.brand} />
            </View>
            <Text style={styles.uploadTitle}>Tap to Select or Take Photos</Text>
            <Text style={styles.uploadSub}>
              Supports paper registers, printed lists, receipts, and membership forms (JPEG, PNG).
            </Text>
            <View style={styles.uploadBtn}>
              <Text style={styles.uploadBtnText}>Choose Document Pages</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Processing State Overlay Card */}
        {loading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color={colors.brand} />
            <Text style={styles.loadingTitle}>{processingStep}</Text>
            <Text style={styles.loadingSub}>
              Our AI is extracting structured member details. This usually takes 5–15 seconds.
            </Text>
          </View>
        ) : null}

        {/* Error / Fallback Card */}
        {error ? (
          <View style={styles.errorCard}>
            <View style={styles.errorHeader}>
              <Icon name="alert" size={18} color={colors.critical} />
              <Text style={styles.errorTitle}>Scanning Notice</Text>
            </View>
            <Text style={styles.errorText}>{error}</Text>
            <View style={styles.errorActions}>
              <TouchableOpacity style={styles.errorRetryBtn} onPress={handleScan} activeOpacity={0.8}>
                <Text style={styles.errorRetryBtnText}>Try Again</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.errorAltBtn} onPress={onNavigateCSV} activeOpacity={0.8}>
                <Text style={styles.errorAltBtnText}>Use CSV Instead</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.errorAltBtn} onPress={onNavigateManual} activeOpacity={0.8}>
                <Text style={styles.errorAltBtnText}>Add Manually</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* Scan Action Button */}
        {selectedImages.length > 0 && !loading ? (
          <View style={styles.actionContainer}>
            <PrimaryButton
              title={`Scan & Extract ${selectedImages.length} Page${selectedImages.length > 1 ? 's' : ''}`}
              onPress={handleScan}
              size="lg"
            />
            <Text style={styles.disclaimerText}>
              AI helps extract member details. You will review, edit, and confirm all records before importing.
            </Text>
          </View>
        ) : null}

        {/* Supported Document Tips */}
        <View style={styles.tipsCard}>
          <Text style={styles.tipsTitle}>Tips for Best Results:</Text>
          <View style={styles.tipRow}>
            <Text style={styles.tipBullet}>•</Text>
            <Text style={styles.tipText}>Ensure adequate lighting and flat document pages.</Text>
          </View>
          <View style={styles.tipRow}>
            <Text style={styles.tipBullet}>•</Text>
            <Text style={styles.tipText}>Phone numbers and names should be clearly legible.</Text>
          </View>
          <View style={styles.tipRow}>
            <Text style={styles.tipBullet}>•</Text>
            <Text style={styles.tipText}>Multiple pages can be combined in one review step.</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.section,
  },
  headerInfo: {
    gap: spacing.xs,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  uploadBox: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.brand,
    borderRadius: radius.lg,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    gap: spacing.sm,
    padding: spacing.xl,
    ...shadows.sm,
  },
  uploadIconWrap: {
    alignItems: 'center',
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.full,
    height: 60,
    justifyContent: 'center',
    marginBottom: spacing.xs,
    width: 60,
  },
  uploadTitle: {
    color: colors.text,
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
  },
  uploadSub: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    lineHeight: 18,
    textAlign: 'center',
  },
  uploadBtn: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  uploadBtnText: {
    color: colors.textInverse,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  previewSection: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
    ...shadows.sm,
  },
  previewHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  previewCount: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  addMoreBtn: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  addMoreText: {
    color: colors.brand,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  thumbnailList: {
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  thumbnailWrap: {
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    height: 120,
    overflow: 'hidden',
    position: 'relative',
    width: 90,
  },
  thumbnail: {
    height: '100%',
    width: '100%',
  },
  pageBadge: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: radius.sm,
    bottom: 4,
    left: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
    position: 'absolute',
  },
  pageBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: fontWeight.bold,
  },
  deleteThumbBtn: {
    alignItems: 'center',
    backgroundColor: colors.critical,
    borderRadius: radius.full,
    height: 20,
    justifyContent: 'center',
    position: 'absolute',
    right: 4,
    top: 4,
    width: 20,
  },
  loadingCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.brand,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.xl,
    ...shadows.sm,
  },
  loadingTitle: {
    color: colors.text,
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  loadingSub: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    lineHeight: 18,
    textAlign: 'center',
  },
  errorCard: {
    backgroundColor: colors.criticalSurface,
    borderColor: colors.criticalBorder,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  errorHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  errorTitle: {
    color: colors.critical,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  errorText: {
    color: colors.text,
    fontSize: fontSize.xs,
    lineHeight: 18,
  },
  errorActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  errorRetryBtn: {
    backgroundColor: colors.critical,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  errorRetryBtnText: {
    color: '#fff',
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  errorAltBtn: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  errorAltBtnText: {
    color: colors.text,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  actionContainer: {
    gap: spacing.xs,
  },
  disclaimerText: {
    color: colors.muted,
    fontSize: fontSize.xs,
    lineHeight: 16,
    textAlign: 'center',
  },
  tipsCard: {
    backgroundColor: colors.gray50,
    borderRadius: radius.md,
    gap: spacing.xs,
    padding: spacing.md,
  },
  tipsTitle: {
    color: colors.text,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  tipRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  tipBullet: {
    color: colors.brand,
    fontSize: fontSize.xs,
  },
  tipText: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: fontSize.xs,
    lineHeight: 16,
  },
});

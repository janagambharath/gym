import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';
import { CardSkeleton } from '../components/LoadingSkeleton';
import { apiRequest } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type {
  CampaignSegmentType,
  CampaignTemplate,
  CampaignType,
  CooldownCheckResult,
  ImportedContact,
  ImportValidationResult,
  PromoPreset,
  SegmentPreview,
} from '../types';
import { SEGMENT_LABELS } from '../types';

type CampaignCreateScreenProps = {
  initialPurpose?: CampaignType;
  onBack: () => void;
  onCampaignCreated: () => void;
};

type Step = 'audience' | 'template' | 'review' | 'sending';

const PROMO_PRESETS: { id: PromoPreset; label: string; desc: string; icon: 'gift' | 'sparkles' | 'target' | 'fitness' | 'megaphone' }[] = [
  { id: 'special_offer', label: 'Special Offer', desc: 'Limited-time discount on membership plans', icon: 'gift' },
  { id: 'festival_offer', label: 'Festival Offer', desc: 'Holiday and seasonal special promotions', icon: 'sparkles' },
  { id: 'referral_offer', label: 'Referral Offer', desc: 'Refer friends to earn free renewal days', icon: 'target' },
  { id: 'pt_offer', label: 'Personal Training', desc: 'Trial session or PT package promotion', icon: 'fitness' },
  { id: 'new_membership', label: 'New Membership', desc: 'Announcement for new programs or tiers', icon: 'sparkles' },
  { id: 'announcement', label: 'Gym Announcement', desc: 'Timings update, holiday notice or event', icon: 'megaphone' },
];

export function CampaignCreateScreen({
  initialPurpose = 'recovery',
  onBack,
  onCampaignCreated,
}: CampaignCreateScreenProps) {
  const [purpose, setPurpose] = useState<CampaignType>(initialPurpose);
  const [step, setStep] = useState<Step>('audience');

  // Audience & Source state
  const [audienceSource, setAudienceSource] = useState<'existing' | 'import'>('existing');
  const [selectedSegment, setSelectedSegment] = useState<CampaignSegmentType>(
    initialPurpose === 'recovery' ? 'all_expired' : 'all_customers',
  );
  const [promoPreset, setPromoPreset] = useState<PromoPreset>('special_offer');

  // CSV Import state
  const [csvText, setCsvText] = useState('');
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [validatingCsv, setValidatingCsv] = useState(false);
  const [importResult, setImportResult] = useState<ImportValidationResult | null>(null);

  // Preview state
  const [dbPreview, setDbPreview] = useState<SegmentPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Template & Cooldown state
  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<CampaignTemplate | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  // Cooldown Protection
  const [cooldownResult, setCooldownResult] = useState<CooldownCheckResult | null>(null);
  const [excludeRecent, setExcludeRecent] = useState(true);
  const [checkingCooldown, setCheckingCooldown] = useState(false);

  // Campaign Meta & Send
  const [campaignName, setCampaignName] = useState('');
  const [sending, setSending] = useState(false);

  const onSwitchPurpose = useCallback((newPurpose: CampaignType) => {
    setPurpose(newPurpose);
    setSelectedSegment(newPurpose === 'recovery' ? 'all_expired' : 'all_customers');
    setPreviewLoading(true);
  }, []);

  const onSelectSegment = useCallback((segType: CampaignSegmentType) => {
    setSelectedSegment(segType);
    setPreviewLoading(true);
  }, []);

  useEffect(() => {
    if (audienceSource !== 'existing') return;
    let active = true;
    void apiRequest<SegmentPreview>(
      `/api/mobile/v1/campaigns/segments/preview?type=${selectedSegment}`,
    ).then((res) => {
      if (!active) return;
      if (res.ok) {
        setDbPreview(res.data);
      }
      setPreviewLoading(false);
    });
    return () => {
      active = false;
    };
  }, [audienceSource, selectedSegment]);

  // CSV picking via DocumentPicker
  const onPickCsvFile = useCallback(async () => {
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
        Alert.alert('File too large', 'CSV file must be 2 MB or smaller.');
        return;
      }
      const contents = await new File(asset.uri).text();
      setCsvText(contents);
      setSelectedFileName(asset.name);
      setImportResult(null);
    } catch {
      Alert.alert('Error', 'Could not read CSV file. Please make sure it is a valid text CSV.');
    }
  }, []);

  // Validate CSV
  const onValidateCsv = useCallback(async () => {
    if (!csvText.trim()) {
      Alert.alert('Empty CSV', 'Please select a file or paste CSV text.');
      return;
    }
    setValidatingCsv(true);
    const res = await apiRequest<ImportValidationResult>('/api/mobile/v1/campaigns/import/validate', {
      method: 'POST',
      body: {
        csv_text: csvText,
        purpose,
      },
    });
    setValidatingCsv(false);

    if (res.ok) {
      setImportResult(res.data);
      if (!res.data.valid) {
        Alert.alert('Validation Notice', `Found ${res.data.invalid_count} invalid and ${res.data.duplicate_count} duplicate rows. Valid rows will be used.`);
      }
    } else {
      Alert.alert('Validation Error', res.error.message || 'Failed to validate CSV format.');
    }
  }, [csvText, purpose]);

  // Check cooldown for recipient phones
  const checkCooldown = useCallback(async (phonesToCheck: string[]) => {
    if (phonesToCheck.length === 0) return;
    setCheckingCooldown(true);
    const res = await apiRequest<CooldownCheckResult>('/api/mobile/v1/campaigns/cooldown-check', {
      method: 'POST',
      body: {
        phones: phonesToCheck,
        days: 7,
      },
    });
    setCheckingCooldown(false);
    if (res.ok) {
      setCooldownResult(res.data);
    }
  }, []);

  // Load templates & check cooldown when transitioning from Step 1 to Step 2
  const goToTemplateStep = useCallback(async () => {
    if (audienceSource === 'existing') {
      if (!dbPreview || dbPreview.total === 0) {
        Alert.alert('No Recipients', 'The selected audience has 0 members right now.');
        return;
      }
    } else {
      if (!importResult || importResult.valid_contacts.length === 0) {
        Alert.alert('Validate First', 'Please validate your contact list before proceeding.');
        return;
      }
    }

    setTemplatesLoading(true);
    setStep('template');

    // Fetch approved templates for this purpose
    const res = await apiRequest<{ templates: CampaignTemplate[] }>(
      `/api/mobile/v1/campaigns/templates?purpose=${purpose}`,
    );
    setTemplatesLoading(false);

    if (res.ok && res.data.templates.length > 0) {
      setTemplates(res.data.templates);
      setSelectedTemplate(res.data.templates[0]);
    }

    // Check Cooldown
    let phones: string[] = [];
    if (audienceSource === 'existing' && dbPreview) {
      phones = dbPreview.preview.map((p) => p.phone);
    } else if (audienceSource === 'import' && importResult) {
      phones = importResult.valid_contacts.map((c) => c.phone);
    }
    void checkCooldown(phones);

    // Auto pre-populate campaign name
    const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    if (purpose === 'recovery') {
      setCampaignName(`Expired Recovery — ${dateStr}`);
    } else {
      const presetObj = PROMO_PRESETS.find((p) => p.id === promoPreset);
      setCampaignName(`${presetObj?.label || 'Promotion'} — ${dateStr}`);
    }
  }, [audienceSource, dbPreview, importResult, purpose, promoPreset, checkCooldown]);

  const goToReviewStep = useCallback(() => {
    if (!selectedTemplate) {
      Alert.alert('Select Template', 'Please select a WhatsApp template.');
      return;
    }
    setStep('review');
  }, [selectedTemplate]);

  // Launch Campaign
  const onLaunchCampaign = useCallback(async () => {
    if (!campaignName.trim()) {
      Alert.alert('Campaign Name Required', 'Please enter a name for this campaign.');
      return;
    }

    setSending(true);
    setStep('sending');

    const effectiveSegment: CampaignSegmentType = audienceSource === 'import' ? 'custom_import' : selectedSegment;
    const importedContacts: ImportedContact[] = audienceSource === 'import' ? importResult?.valid_contacts || [] : [];

    const createRes = await apiRequest<{ id: number }>('/api/mobile/v1/campaigns', {
      method: 'POST',
      body: {
        name: campaignName.trim(),
        campaign_type: purpose,
        promo_preset: purpose === 'promotion' ? promoPreset : undefined,
        template_name: selectedTemplate?.name,
        segment_type: effectiveSegment,
        imported_contacts: importedContacts.length > 0 ? importedContacts : undefined,
        exclude_recent: excludeRecent,
      },
    });

    if (!createRes.ok) {
      Alert.alert('Error Creating Campaign', createRes.error.message || 'Failed to create campaign.');
      setSending(false);
      setStep('review');
      return;
    }

    const campaignId = createRes.data.id;

    // Send Campaign
    const sendRes = await apiRequest<{ sent: number; total: number; failed: number }>(
      `/api/mobile/v1/campaigns/${campaignId}/send`,
      { method: 'POST' },
    );

    setSending(false);

    if (sendRes.ok) {
      Alert.alert(
        'Campaign Launched! 🎉',
        `Successfully sent to ${sendRes.data.sent} of ${sendRes.data.total} members.${
          sendRes.data.failed > 0 ? ` (${sendRes.data.failed} failed)` : ''
        }`,
        [{ text: 'View Campaigns', onPress: onCampaignCreated }],
      );
    } else {
      Alert.alert('Notice', sendRes.error.message || 'Some messages may not have sent.', [
        { text: 'OK', onPress: onCampaignCreated },
      ]);
    }
  }, [
    campaignName,
    purpose,
    promoPreset,
    selectedTemplate,
    audienceSource,
    selectedSegment,
    importResult,
    excludeRecent,
    onCampaignCreated,
  ]);

  // Recipient totals calculation
  const totalAudienceCount = audienceSource === 'existing' ? (dbPreview?.total ?? 0) : (importResult?.valid_count ?? 0);
  const inCooldownCount = excludeRecent && cooldownResult ? cooldownResult.in_cooldown_count : 0;
  const netRecipientsCount = Math.max(0, totalAudienceCount - inCooldownCount);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Navigation Header */}
      <View style={styles.navHeader}>
        <TouchableOpacity
          onPress={() => {
            if (step === 'audience') onBack();
            else if (step === 'template') setStep('audience');
            else if (step === 'review') setStep('template');
          }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Icon name="back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.navTitle}>
          {step === 'audience'
            ? '1. Select Audience'
            : step === 'template'
              ? '2. Message Template'
              : step === 'review'
                ? '3. Name & Send'
                : 'Launching Campaign...'}
        </Text>
        <View style={{ width: 22 }} />
      </View>

      {/* Wizard Progress Indicator */}
      <View style={styles.stepProgressRow}>
        <StepItem active={step === 'audience'} completed={step !== 'audience'} label="1. Audience" />
        <View style={styles.stepConnector} />
        <StepItem active={step === 'template'} completed={step === 'review' || step === 'sending'} label="2. Template" />
        <View style={styles.stepConnector} />
        <StepItem active={step === 'review' || step === 'sending'} completed={step === 'sending'} label="3. Send" />
      </View>

      {/* ── STEP 1: AUDIENCE & SOURCE ─────────────────────────────────── */}
      {step === 'audience' && (
        <ScrollView style={styles.scrollContainer} contentContainerStyle={styles.scrollContent}>
          {/* Purpose Switcher */}
          <View style={styles.purposeTabsContainer}>
            <TouchableOpacity
              style={[styles.purposeTab, purpose === 'recovery' && styles.purposeTabActiveRecovery]}
              onPress={() => onSwitchPurpose('recovery')}
              activeOpacity={0.8}
            >
              <Icon name="revenue" size={16} color={purpose === 'recovery' ? colors.successDark : colors.muted} />
              <Text style={[styles.purposeTabText, purpose === 'recovery' && styles.purposeTabTextActiveRecovery]}>
                Recover Expired
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.purposeTab, purpose === 'promotion' && styles.purposeTabActivePromo]}
              onPress={() => onSwitchPurpose('promotion')}
              activeOpacity={0.8}
            >
              <Icon name="gift" size={16} color={purpose === 'promotion' ? colors.brand : colors.muted} />
              <Text style={[styles.purposeTabText, purpose === 'promotion' && styles.purposeTabTextActivePromo]}>
                Promotions & Offers
              </Text>
            </TouchableOpacity>
          </View>

          {/* Promotion Preset Picker if purpose is promotion */}
          {purpose === 'promotion' && (
            <View style={styles.sectionBox}>
              <Text style={styles.sectionHeader}>Choose Promotion Preset</Text>
              <View style={styles.presetsGrid}>
                {PROMO_PRESETS.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.presetCard, promoPreset === p.id && styles.presetCardActive]}
                    onPress={() => setPromoPreset(p.id)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.presetIcon, promoPreset === p.id && styles.presetIconActive]}>
                      <Icon name={p.icon} size={18} color={promoPreset === p.id ? colors.brand : colors.muted} />
                    </View>
                    <Text style={[styles.presetTitle, promoPreset === p.id && styles.presetTitleActive]}>
                      {p.label}
                    </Text>
                    <Text style={styles.presetDesc} numberOfLines={2}>
                      {p.desc}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Audience Source Selector (Database vs CSV Upload) */}
          <View style={styles.sourceSelectorCard}>
            <Text style={styles.sectionHeader}>Audience Source</Text>
            <View style={styles.sourceTabs}>
              <TouchableOpacity
                style={[styles.sourceTab, audienceSource === 'existing' && styles.sourceTabActive]}
                onPress={() => setAudienceSource('existing')}
              >
                <Icon name="members" size={16} color={audienceSource === 'existing' ? colors.brand : colors.muted} />
                <Text style={[styles.sourceTabText, audienceSource === 'existing' && styles.sourceTabTextActive]}>
                  {purpose === 'recovery' ? 'Expired in Database' : 'Existing Members'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sourceTab, audienceSource === 'import' && styles.sourceTabActive]}
                onPress={() => setAudienceSource('import')}
              >
                <Icon name="document" size={16} color={audienceSource === 'import' ? colors.brand : colors.muted} />
                <Text style={[styles.sourceTabText, audienceSource === 'import' && styles.sourceTabTextActive]}>
                  Upload / Paste CSV
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* MODE A: Existing Database Segments */}
          {audienceSource === 'existing' && (
            <View style={styles.sectionBox}>
              <Text style={styles.sectionHeader}>
                {purpose === 'recovery' ? 'Select Expired Segment' : 'Select Audience Segment'}
              </Text>

              {/* Segments filtered for the purpose */}
              <View style={styles.segmentsList}>
                {(purpose === 'recovery'
                  ? [
                      { type: 'all_expired' as const, label: 'All Expired Members' },
                      { type: 'recently_expired' as const, label: 'Recently Expired (0-30 days)' },
                      { type: 'inactive_30d' as const, label: 'Inactive 30+ Days' },
                      { type: 'inactive_60d' as const, label: 'Inactive 60+ Days' },
                      { type: 'inactive_90d' as const, label: 'Inactive 90+ Days' },
                      { type: 'expiring_7d' as const, label: 'Expiring in 7 Days' },
                    ]
                  : [
                      { type: 'all_customers' as const, label: 'All Customers (Active + Expired)' },
                      { type: 'all_active' as const, label: 'Active Members Only' },
                      { type: 'all_expired' as const, label: 'Expired Members Only' },
                    ]
                ).map((seg) => (
                  <TouchableOpacity
                    key={seg.type}
                    style={[styles.segmentItem, selectedSegment === seg.type && styles.segmentItemActive]}
                    onPress={() => onSelectSegment(seg.type)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.segmentRadio}>
                      {selectedSegment === seg.type && <View style={styles.segmentRadioInner} />}
                    </View>
                    <Text style={[styles.segmentItemText, selectedSegment === seg.type && styles.segmentItemTextActive]}>
                      {seg.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Live Preview of Segment Count & Members */}
              {previewLoading ? (
                <View style={{ marginTop: spacing.md }}>
                  <CardSkeleton count={2} />
                </View>
              ) : dbPreview ? (
                <View style={styles.previewBox}>
                  <View style={styles.previewHeaderRow}>
                    <Text style={styles.previewCountBadge}>{dbPreview.total} members</Text>
                    <Text style={styles.previewSubtitle}>ready to receive message</Text>
                  </View>
                  {dbPreview.preview.slice(0, 3).map((m) => (
                    <View key={m.id} style={styles.previewMemberRow}>
                      <Avatar name={m.full_name} size={32} />
                      <View style={{ flex: 1, marginLeft: spacing.sm }}>
                        <Text style={styles.previewMemberName}>{m.full_name}</Text>
                        <Text style={styles.previewMemberMeta}>
                          {m.phone} · {m.plan_name || 'Standard'}
                        </Text>
                      </View>
                      {m.days_until_expiry !== null && (
                        <Text style={styles.previewDaysText}>
                          {m.days_until_expiry < 0 ? `${Math.abs(m.days_until_expiry)}d ago` : `${m.days_until_expiry}d left`}
                        </Text>
                      )}
                    </View>
                  ))}
                  {dbPreview.total > 3 && (
                    <Text style={styles.previewMoreText}>+ {dbPreview.total - 3} more members</Text>
                  )}
                </View>
              ) : null}
            </View>
          )}

          {/* MODE B: CSV Import */}
          {audienceSource === 'import' && (
            <View style={styles.sectionBox}>
              <Text style={styles.sectionHeader}>
                {purpose === 'recovery'
                  ? 'Expired Contacts CSV (name,phone,expiry_date,plan,renewal_amount)'
                  : 'Contact List CSV (name,phone)'}
              </Text>
              <Text style={styles.csvHelpText}>
                {purpose === 'recovery'
                  ? 'Format: name,phone,expiry_date,plan,renewal_amount (phone must be in E.164, e.g. +919876543210; expiry_date must be in the past).'
                  : 'Format: name,phone (phone must be in E.164 format, e.g. +919876543210).'}
              </Text>

              <View style={styles.csvActionButtons}>
                <TouchableOpacity style={styles.pickFileButton} onPress={onPickCsvFile} activeOpacity={0.8}>
                  <Icon name="document" size={16} color={colors.brand} />
                  <Text style={styles.pickFileButtonText}>
                    {selectedFileName ? `Selected: ${selectedFileName}` : 'Pick CSV File'}
                  </Text>
                </TouchableOpacity>
              </View>

              <TextInput
                style={styles.csvInput}
                multiline
                numberOfLines={5}
                placeholder={
                  purpose === 'recovery'
                    ? 'name,phone,expiry_date,plan,renewal_amount\nRahul Sharma,+919876543210,2026-01-15,Gold Annual,12000'
                    : 'name,phone\nRahul Sharma,+919876543210\nSneha Patel,+919876543211'
                }
                placeholderTextColor={colors.muted}
                value={csvText}
                onChangeText={(t) => {
                  setCsvText(t);
                  setImportResult(null);
                }}
              />

              <TouchableOpacity
                style={[styles.validateButton, !csvText.trim() && styles.validateButtonDisabled]}
                onPress={onValidateCsv}
                disabled={!csvText.trim() || validatingCsv}
                activeOpacity={0.8}
              >
                {validatingCsv ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <>
                    <Icon name="check" size={16} color={colors.textInverse} />
                    <Text style={styles.validateButtonText}>Validate Contacts</Text>
                  </>
                )}
              </TouchableOpacity>

              {importResult && (
                <View style={styles.validationSummaryCard}>
                  <View style={styles.summaryStatsRow}>
                    <View style={styles.summaryStatItem}>
                      <Text style={[styles.summaryStatValue, { color: colors.success }]}>
                        {importResult.valid_count}
                      </Text>
                      <Text style={styles.summaryStatLabel}>Valid</Text>
                    </View>
                    <View style={styles.summaryStatItem}>
                      <Text style={[styles.summaryStatValue, { color: colors.critical }]}>
                        {importResult.invalid_count}
                      </Text>
                      <Text style={styles.summaryStatLabel}>Invalid</Text>
                    </View>
                    <View style={styles.summaryStatItem}>
                      <Text style={[styles.summaryStatValue, { color: colors.warning }]}>
                        {importResult.duplicate_count}
                      </Text>
                      <Text style={styles.summaryStatLabel}>Duplicates</Text>
                    </View>
                  </View>

                  {importResult.errors.length > 0 && (
                    <View style={styles.validationErrorsBox}>
                      <Text style={styles.validationErrorsTitle}>Row Errors:</Text>
                      {importResult.errors.slice(0, 4).map((err) => (
                        <Text key={err.row} style={styles.validationErrorLine}>
                          Row {err.row}: {err.error}
                        </Text>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </View>
          )}

          {/* Continue Button to Step 2 */}
          <TouchableOpacity
            style={[
              styles.primaryButton,
              ((audienceSource === 'existing' && (!dbPreview || dbPreview.total === 0)) ||
                (audienceSource === 'import' && (!importResult || importResult.valid_count === 0))) &&
                styles.primaryButtonDisabled,
            ]}
            onPress={goToTemplateStep}
            disabled={
              (audienceSource === 'existing' && (!dbPreview || dbPreview.total === 0)) ||
              (audienceSource === 'import' && (!importResult || importResult.valid_count === 0))
            }
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>Continue to Template</Text>
            <Icon name="forward" size={16} color={colors.textInverse} />
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* ── STEP 2: TEMPLATE & COOLDOWN PROTECTION ─────────────────────── */}
      {step === 'template' && (
        <ScrollView style={styles.scrollContainer} contentContainerStyle={styles.scrollContent}>
          <Text style={styles.sectionHeader}>Select WhatsApp Template</Text>
          <Text style={styles.csvHelpText}>
            Official Meta WhatsApp Business marketing templates ensure high deliverability and prevent spam flagging.
          </Text>

          {templatesLoading ? (
            <CardSkeleton count={2} />
          ) : (
            templates.map((tpl) => (
              <TouchableOpacity
                key={tpl.name}
                style={[styles.templateCard, selectedTemplate?.name === tpl.name && styles.templateCardSelected]}
                onPress={() => setSelectedTemplate(tpl)}
                activeOpacity={0.8}
              >
                <View style={styles.templateHeader}>
                  <View style={styles.templateBadge}>
                    <Icon name="whatsapp" size={14} color={colors.success} />
                    <Text style={styles.templateBadgeText}>Meta Approved</Text>
                  </View>
                  <Text style={styles.templatePurposeText}>{tpl.purpose.toUpperCase()}</Text>
                </View>
                <Text style={styles.templateTitle}>{tpl.title}</Text>
                <Text style={styles.templateDescription}>{tpl.description}</Text>

                {/* WhatsApp Chat Bubble Preview */}
                <View style={styles.waPreviewBubble}>
                  <Text style={styles.waPreviewText}>{tpl.body_preview}</Text>
                  <View style={styles.waCheckRow}>
                    <Text style={styles.waTime}>12:00 PM</Text>
                    <Icon name="delivered" size={14} color={colors.brand} />
                  </View>
                </View>

                <View style={styles.variablesRow}>
                  <Text style={styles.variablesLabel}>Variables: </Text>
                  {tpl.variables.map((v) => (
                    <View key={v} style={styles.variablePill}>
                      <Text style={styles.variablePillText}>{`{{${v}}}`}</Text>
                    </View>
                  ))}
                </View>
              </TouchableOpacity>
            ))
          )}

          {/* Cooldown Protection Section */}
          <View style={styles.cooldownCard}>
            <View style={styles.cooldownHeader}>
              <Icon name="shield" size={20} color={colors.brand} />
              <View style={{ flex: 1, marginLeft: spacing.xs }}>
                <Text style={styles.cooldownTitle}>Cooldown Protection</Text>
                <Text style={styles.cooldownDesc}>
                  Prevents messaging contacts contacted in the last 7 days to avoid customer fatigue and WhatsApp blocks.
                </Text>
              </View>
            </View>

            {checkingCooldown ? (
              <ActivityIndicator size="small" color={colors.brand} style={{ marginVertical: spacing.xs }} />
            ) : cooldownResult && cooldownResult.in_cooldown_count > 0 ? (
              <View style={styles.cooldownWarning}>
                <Icon name="warning" size={16} color={colors.warning} />
                <Text style={styles.cooldownWarningText}>
                  {cooldownResult.in_cooldown_count} of {cooldownResult.total_checked} contacts were messaged in the last 7 days.
                </Text>
              </View>
            ) : (
              <View style={styles.cooldownSafe}>
                <Icon name="check" size={16} color={colors.success} />
                <Text style={styles.cooldownSafeText}>All contacts are clean to receive this campaign.</Text>
              </View>
            )}

            <View style={styles.cooldownToggleRow}>
              <Text style={styles.cooldownToggleLabel}>
                Exclude contacts messaged in last 7 days
              </Text>
              <Switch
                value={excludeRecent}
                onValueChange={setExcludeRecent}
                trackColor={{ false: colors.gray200, true: colors.brand }}
                thumbColor={colors.surface}
              />
            </View>
          </View>

          {/* Continue Button to Step 3 */}
          <TouchableOpacity style={styles.primaryButton} onPress={goToReviewStep} activeOpacity={0.8}>
            <Text style={styles.primaryButtonText}>Continue to Review & Launch</Text>
            <Icon name="forward" size={16} color={colors.textInverse} />
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* ── STEP 3: NAME & LAUNCH ───────────────────────────────────────── */}
      {step === 'review' && (
        <ScrollView style={styles.scrollContainer} contentContainerStyle={styles.scrollContent}>
          <Text style={styles.sectionHeader}>Campaign Name</Text>
          <TextInput
            style={styles.nameTextInput}
            value={campaignName}
            onChangeText={setCampaignName}
            placeholder="e.g. Expired Recovery — 11 Sep"
            placeholderTextColor={colors.muted}
            autoFocus
          />

          {/* Summary Card */}
          <View style={styles.reviewSummaryCard}>
            <Text style={styles.reviewSummaryTitle}>Campaign Summary</Text>

            <View style={styles.summaryItemRow}>
              <Text style={styles.summaryItemLabel}>Purpose</Text>
              <Text style={styles.summaryItemValue}>
                {purpose === 'recovery' ? 'Recover Expired Members' : `Promotions (${promoPreset})`}
              </Text>
            </View>

            <View style={styles.summaryItemRow}>
              <Text style={styles.summaryItemLabel}>Audience</Text>
              <Text style={styles.summaryItemValue}>
                {audienceSource === 'existing'
                  ? SEGMENT_LABELS[selectedSegment] || selectedSegment
                  : 'Custom Contact List (CSV)'}
              </Text>
            </View>

            <View style={styles.summaryItemRow}>
              <Text style={styles.summaryItemLabel}>Total Contacts</Text>
              <Text style={styles.summaryItemValue}>{totalAudienceCount}</Text>
            </View>

            {inCooldownCount > 0 && (
              <View style={styles.summaryItemRow}>
                <Text style={[styles.summaryItemLabel, { color: colors.warning }]}>
                  Cooldown Excluded
                </Text>
                <Text style={[styles.summaryItemValue, { color: colors.warning }]}>
                  - {inCooldownCount} contacts
                </Text>
              </View>
            )}

            <View style={[styles.summaryItemRow, styles.summaryItemTotal]}>
              <Text style={styles.summaryTotalLabel}>Net Recipients</Text>
              <Text style={styles.summaryTotalValue}>{netRecipientsCount} members</Text>
            </View>

            <View style={styles.summaryItemRow}>
              <Text style={styles.summaryItemLabel}>Template</Text>
              <Text style={styles.summaryItemValue}>{selectedTemplate?.name}</Text>
            </View>
          </View>

          {/* Compliance & Policy Card */}
          <View style={styles.complianceCard}>
            <Icon name="shield" size={18} color={colors.successDark} />
            <Text style={styles.complianceText}>
              All WhatsApp messages follow Meta Business Platform policies. Messages are tracked for delivery, read status, and responses.
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.launchButton,
              (!campaignName.trim() || netRecipientsCount === 0 || sending) && styles.launchButtonDisabled,
            ]}
            onPress={onLaunchCampaign}
            disabled={!campaignName.trim() || netRecipientsCount === 0 || sending}
            activeOpacity={0.8}
          >
            <Icon name="send" size={18} color={colors.textInverse} />
            <Text style={styles.launchButtonText}>Launch Campaign Now</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* ── STEP 4: SENDING STATE ─────────────────────────────────────── */}
      {step === 'sending' && (
        <View style={styles.sendingContainer}>
          <ActivityIndicator size="large" color={colors.brand} />
          <Text style={styles.sendingTitle}>Sending WhatsApp Campaign...</Text>
          <Text style={styles.sendingSubtitle}>
            Dispatches are being sent via official Meta WhatsApp Business API.
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

function StepItem({ active, completed, label }: { active: boolean; completed: boolean; label: string }) {
  return (
    <View style={styles.stepItem}>
      <View
        style={[
          styles.stepCircle,
          active && styles.stepCircleActive,
          completed && styles.stepCircleCompleted,
        ]}
      >
        {completed ? (
          <Icon name="check" size={12} color={colors.textInverse} />
        ) : (
          <Text style={[styles.stepCircleText, active && styles.stepCircleTextActive]}>
            {label.charAt(0)}
          </Text>
        )}
      </View>
      <Text style={[styles.stepLabel, active && styles.stepLabelActive]}>{label.slice(3)}</Text>
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
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginLeft: spacing.md,
  },
  stepProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  stepItem: {
    alignItems: 'center',
    gap: 2,
  },
  stepCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.gray100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCircleActive: {
    backgroundColor: colors.brand,
  },
  stepCircleCompleted: {
    backgroundColor: colors.success,
  },
  stepCircleText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.muted,
  },
  stepCircleTextActive: {
    color: colors.textInverse,
  },
  stepLabel: {
    fontSize: 10,
    color: colors.muted,
    fontWeight: fontWeight.medium,
  },
  stepLabelActive: {
    color: colors.text,
    fontWeight: fontWeight.bold,
  },
  stepConnector: {
    flex: 1,
    height: 2,
    backgroundColor: colors.borderLight,
    marginHorizontal: spacing.xs,
    marginBottom: 12,
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.bottomTabSafe,
    gap: spacing.lg,
  },
  purposeTabsContainer: {
    flexDirection: 'row',
    backgroundColor: colors.gray100,
    borderRadius: radius.md,
    padding: 3,
    gap: 3,
  },
  purposeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    gap: spacing.xs,
  },
  purposeTabActiveRecovery: {
    backgroundColor: colors.successSurface,
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  purposeTabActivePromo: {
    backgroundColor: colors.brandSubtle,
    borderWidth: 1,
    borderColor: colors.infoBorder,
  },
  purposeTabText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.muted,
  },
  purposeTabTextActiveRecovery: {
    color: colors.successDark,
    fontWeight: fontWeight.bold,
  },
  purposeTabTextActivePromo: {
    color: colors.brand,
    fontWeight: fontWeight.bold,
  },
  sectionBox: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
    ...shadows.sm,
  },
  sectionHeader: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  presetsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  presetCard: {
    width: '48%',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.borderLight,
    gap: 4,
  },
  presetCardActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSubtle,
  },
  presetIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.gray100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetIconActive: {
    backgroundColor: colors.surface,
  },
  presetTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  presetTitleActive: {
    color: colors.brand,
  },
  presetDesc: {
    fontSize: fontSize.xs,
    color: colors.muted,
    lineHeight: 14,
  },
  sourceSelectorCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
    ...shadows.sm,
  },
  sourceTabs: {
    flexDirection: 'row',
    backgroundColor: colors.gray100,
    borderRadius: radius.md,
    padding: 3,
    gap: 3,
  },
  sourceTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    gap: spacing.xs,
  },
  sourceTabActive: {
    backgroundColor: colors.surface,
    ...shadows.sm,
  },
  sourceTabText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.muted,
  },
  sourceTabTextActive: {
    color: colors.text,
    fontWeight: fontWeight.bold,
  },
  segmentsList: {
    gap: spacing.xs,
  },
  segmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    gap: spacing.sm,
  },
  segmentItemActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSubtle,
  },
  segmentRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentRadioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.brand,
  },
  segmentItemText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text,
  },
  segmentItemTextActive: {
    fontWeight: fontWeight.bold,
    color: colors.brand,
  },
  previewBox: {
    backgroundColor: colors.gray50,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: colors.borderLight,
    gap: spacing.sm,
  },
  previewHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  previewCountBadge: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.brand,
  },
  previewSubtitle: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  previewMemberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  previewMemberName: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  previewMemberMeta: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  previewDaysText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.critical,
  },
  previewMoreText: {
    fontSize: fontSize.xs,
    color: colors.muted,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 4,
  },
  csvHelpText: {
    fontSize: fontSize.xs,
    color: colors.muted,
    lineHeight: 18,
  },
  csvActionButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  pickFileButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.brand,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    gap: spacing.xs,
  },
  pickFileButtonText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.brand,
  },
  csvInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    fontSize: fontSize.xs,
    color: colors.text,
    fontFamily: 'monospace',
    minHeight: 90,
    textAlignVertical: 'top',
  },
  validateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    gap: spacing.xs,
  },
  validateButtonDisabled: {
    backgroundColor: colors.gray300,
  },
  validateButtonText: {
    color: colors.textInverse,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  validationSummaryCard: {
    backgroundColor: colors.gray50,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    gap: spacing.sm,
  },
  summaryStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  summaryStatItem: {
    alignItems: 'center',
  },
  summaryStatValue: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  summaryStatLabel: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  validationErrorsBox: {
    marginTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingTop: spacing.xs,
  },
  validationErrorsTitle: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.critical,
    marginBottom: 2,
  },
  validationErrorLine: {
    fontSize: fontSize.xs,
    color: colors.critical,
    lineHeight: 16,
  },
  templateCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
    ...shadows.sm,
  },
  templateCardSelected: {
    borderColor: colors.brand,
    borderWidth: 2,
    backgroundColor: colors.surface,
  },
  templateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  templateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successSurface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.xs,
    gap: 4,
  },
  templateBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.successDark,
  },
  templatePurposeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.muted,
  },
  templateTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginTop: 4,
  },
  templateDescription: {
    fontSize: fontSize.xs,
    color: colors.muted,
    lineHeight: 16,
  },
  waPreviewBubble: {
    backgroundColor: '#E7FFDB',
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: '#C2EDAE',
  },
  waPreviewText: {
    fontSize: fontSize.sm,
    color: '#111B21',
    lineHeight: 20,
  },
  waCheckRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  waTime: {
    fontSize: 10,
    color: colors.muted,
  },
  variablesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.xs,
  },
  variablesLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.muted,
  },
  variablePill: {
    backgroundColor: colors.gray100,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
    borderRadius: radius.xs,
  },
  variablePillText: {
    fontSize: 10,
    fontWeight: fontWeight.medium,
    color: colors.text,
  },
  cooldownCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    ...shadows.sm,
  },
  cooldownHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  cooldownTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  cooldownDesc: {
    fontSize: fontSize.xs,
    color: colors.muted,
    lineHeight: 16,
    marginTop: 2,
  },
  cooldownWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warningSurface,
    padding: spacing.sm,
    borderRadius: radius.sm,
    gap: spacing.xs,
  },
  cooldownWarningText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.warningDark,
    fontWeight: fontWeight.medium,
  },
  cooldownSafe: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successSurface,
    padding: spacing.sm,
    borderRadius: radius.sm,
    gap: spacing.xs,
  },
  cooldownSafeText: {
    fontSize: fontSize.xs,
    color: colors.successDark,
    fontWeight: fontWeight.medium,
  },
  cooldownToggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  cooldownToggleLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.text,
    flex: 1,
    marginRight: spacing.sm,
  },
  nameTextInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: fontSize.base,
    color: colors.text,
  },
  reviewSummaryCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
    ...shadows.sm,
  },
  reviewSummaryTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  summaryItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  summaryItemLabel: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  summaryItemValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  summaryItemTotal: {
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
  },
  summaryTotalLabel: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  summaryTotalValue: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.brand,
  },
  complianceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successSurface,
    padding: spacing.md,
    borderRadius: radius.md,
    gap: spacing.sm,
  },
  complianceText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.successDark,
    lineHeight: 18,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    gap: spacing.xs,
  },
  primaryButtonDisabled: {
    backgroundColor: colors.gray300,
  },
  primaryButtonText: {
    color: colors.textInverse,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  launchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    gap: spacing.xs,
  },
  launchButtonDisabled: {
    backgroundColor: colors.gray300,
  },
  launchButtonText: {
    color: colors.textInverse,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  sendingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  sendingTitle: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  sendingSubtitle: {
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
});

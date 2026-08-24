import { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { BotAccessState, isBotEntitlementError, isBotSetupError } from '../components/BotAccessState';
import { FormField } from '../components/FormField';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { PrimaryButton } from '../components/PrimaryButton';
import { SectionHeader } from '../components/SectionHeader';
import type { ApiError } from '../services/apiClient';
import { apiRequest, getCachedSession } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import type { BotConfig, BotConfigResponse, BotConfigUpdate, BotFAQ } from '../types';

type BotSetupScreenProps = {
  onBack: () => void;
  onLogout?: () => void;
};

type Notice = {
  kind: 'success' | 'error';
  text: string;
};

function priceIsValid(value: string): boolean {
  return !value || /^\d+(?:\.\d{1,2})?$/.test(value);
}

function durationIsValid(value: string): boolean {
  return !value || /^\d+$/.test(value);
}

export function BotSetupScreen({ onBack, onLogout }: BotSetupScreenProps) {
  const [faqs, setFaqs] = useState<BotFAQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ApiError>();
  const [notice, setNotice] = useState<Notice>();
  const [saving, setSaving] = useState(false);
  const [greeting, setGreeting] = useState('');
  const [openingHours, setOpeningHours] = useState('');
  const [mapLink, setMapLink] = useState('');
  const [trialEnabled, setTrialEnabled] = useState(false);
  const [trialPrice, setTrialPrice] = useState('');
  const [trialDurationDays, setTrialDurationDays] = useState('');
  const [registrationLink, setRegistrationLink] = useState('');
  const [handoverEnabled, setHandoverEnabled] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const canEdit = getCachedSession()?.userRole === 'gym_owner';

  const applyConfig = useCallback((nextConfig: BotConfig) => {
    setGreeting(nextConfig.greeting_message ?? '');
    setOpeningHours(nextConfig.opening_hours ?? '');
    setMapLink(nextConfig.map_link ?? '');
    setTrialEnabled(nextConfig.trial_enabled);
    setTrialPrice(nextConfig.trial_price ?? '');
    setTrialDurationDays(
      nextConfig.trial_duration_days === null || nextConfig.trial_duration_days === undefined
        ? ''
        : String(nextConfig.trial_duration_days),
    );
    setRegistrationLink(nextConfig.registration_link ?? '');
    setHandoverEnabled(nextConfig.handover_enabled);
  }, []);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    const result = await apiRequest<BotConfigResponse>('/api/mobile/v1/bot/config');
    if (result.ok) {
      applyConfig(result.data.config);
      setFaqs(result.data.faqs);
      setError(undefined);
    } else if (result.error.status === 401 && onLogout) {
      onLogout();
    } else {
      setError(result.error);
    }

    setLoading(false);
    setRefreshing(false);
  }, [applyConfig, onLogout]);

  useEffect(() => {
    const initialLoad = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(initialLoad);
  }, [load]);

  const handleSave = useCallback(async () => {
    if (!canEdit) {
      setNotice({ kind: 'error', text: 'Only the gym owner can update bot setup.' });
      return;
    }

    const normalizedPrice = trialPrice.trim();
    const normalizedDuration = trialDurationDays.trim();
    const errors: Record<string, string> = {};
    if (!priceIsValid(normalizedPrice)) {
      errors.trialPrice = 'Enter a valid amount with up to two decimal places.';
    }
    if (!durationIsValid(normalizedDuration)) {
      errors.trialDuration = 'Enter a whole number of days.';
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    setNotice(undefined);

    const update: BotConfigUpdate = {
      greeting_message: greeting.trim() || null,
      opening_hours: openingHours.trim() || null,
      map_link: mapLink.trim() || null,
      trial_enabled: trialEnabled,
      trial_price: normalizedPrice || null,
      trial_duration_days: normalizedDuration ? Number(normalizedDuration) : null,
      registration_link: registrationLink.trim() || null,
      handover_enabled: handoverEnabled,
    };
    const result = await apiRequest<{ message: string }>('/api/mobile/v1/bot/config', {
      method: 'PATCH',
      body: update,
    });

    if (result.ok) {
      setNotice({ kind: 'success', text: result.data.message || 'Bot setup saved.' });
    } else if (result.error.status === 401 && onLogout) {
      onLogout();
    } else {
      setNotice({
        kind: 'error',
        text: isBotEntitlementError(result.error)
          ? 'WhatsApp Bot is not enabled for this gym.'
          : isBotSetupError(result.error)
            ? 'WhatsApp setup is incomplete.'
            : result.error.status === 403
              ? 'Only the gym owner can update bot setup.'
              : result.error.message,
      });
    }
    setSaving(false);
  }, [canEdit, greeting, handoverEnabled, mapLink, onLogout, openingHours, registrationLink, trialDurationDays, trialEnabled, trialPrice]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <AppHeader title="Bot Setup" onBack={onBack} />
        <View style={styles.loadingWrap}><LoadingSkeleton height={18} lines={10} /></View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <AppHeader title="Bot Setup" onBack={onBack} />
        <BotAccessState error={error} onRetry={() => void load()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Bot Setup" subtitle={canEdit ? 'Owner controls' : 'View only'} onBack={onBack} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={(
            <RefreshControl
              colors={[colors.brand]}
              onRefresh={() => void load(true)}
              refreshing={refreshing}
            />
          )}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.statusCard}>
            <View style={styles.statusIcon}>
              <Icon name="robot" size={25} color={colors.brand} />
            </View>
            <View style={styles.statusBody}>
              <Text style={styles.statusTitle}>WhatsApp Bot configuration</Text>
              <Text style={styles.statusText}>
                {handoverEnabled
                  ? 'Staff can take over conversations when a customer needs help.'
                  : 'Human handover is currently disabled.'}
              </Text>
            </View>
          </View>

          {!canEdit ? (
            <View style={styles.readOnlyBanner}>
              <Icon name="lock" size={18} color={colors.info} />
              <Text style={styles.readOnlyText}>Only the gym owner can change this configuration.</Text>
            </View>
          ) : null}

          {notice ? (
            <View style={[styles.notice, notice.kind === 'success' ? styles.successNotice : styles.errorNotice]}>
              <Icon
                name={notice.kind === 'success' ? 'checkmark' : 'warning'}
                size={18}
                color={notice.kind === 'success' ? colors.successDark : colors.critical}
              />
              <Text style={[styles.noticeText, { color: notice.kind === 'success' ? colors.successDark : colors.critical }]}>
                {notice.text}
              </Text>
            </View>
          ) : null}

          <View style={styles.card}>
            <SectionHeader title="Receptionist" icon={<Icon name="chatbubble" size={18} color={colors.brand} />} />
            <View style={styles.formContent}>
              <FormField
                editable={canEdit}
                label="Greeting message"
                maxLength={4000}
                multiline
                numberOfLines={4}
                onChangeText={setGreeting}
                placeholder="How should the bot welcome customers?"
                value={greeting}
              />
              <FormField
                editable={canEdit}
                label="Opening hours"
                maxLength={4000}
                multiline
                numberOfLines={3}
                onChangeText={setOpeningHours}
                placeholder="e.g. Mon–Sat, 6 AM–10 PM"
                value={openingHours}
              />
              <FormField
                autoCapitalize="none"
                editable={canEdit}
                label="Google Maps link"
                maxLength={512}
                onChangeText={setMapLink}
                placeholder="https://maps.google.com/..."
                value={mapLink}
              />
            </View>
          </View>

          <View style={styles.card}>
            <SectionHeader title="Trial visit" icon={<Icon name="calendar" size={18} color={colors.brand} />} />
            <View style={styles.toggleRow}>
              <View style={styles.toggleCopy}>
                <Text style={styles.toggleTitle}>Offer a trial</Text>
                <Text style={styles.toggleText}>Let the bot share trial visit details.</Text>
              </View>
              <Switch
                disabled={!canEdit}
                onValueChange={setTrialEnabled}
                thumbColor={trialEnabled ? colors.surface : colors.gray300}
                trackColor={{ false: colors.gray300, true: colors.success }}
                value={trialEnabled}
              />
            </View>
            <View style={styles.formContent}>
              <FormField
                editable={canEdit}
                error={fieldErrors.trialPrice}
                keyboardType="decimal-pad"
                label="Trial price"
                onChangeText={setTrialPrice}
                placeholder="0.00"
                value={trialPrice}
              />
              <FormField
                editable={canEdit}
                error={fieldErrors.trialDuration}
                keyboardType="number-pad"
                label="Trial duration (days)"
                onChangeText={setTrialDurationDays}
                placeholder="1"
                value={trialDurationDays}
              />
            </View>
          </View>

          <View style={styles.card}>
            <SectionHeader title="Handover & joining" icon={<Icon name="handshake" size={18} color={colors.brand} />} />
            <View style={styles.toggleRow}>
              <View style={styles.toggleCopy}>
                <Text style={styles.toggleTitle}>Enable human handover</Text>
                <Text style={styles.toggleText}>Allow staff to take over a chat.</Text>
              </View>
              <Switch
                disabled={!canEdit}
                onValueChange={setHandoverEnabled}
                thumbColor={handoverEnabled ? colors.surface : colors.gray300}
                trackColor={{ false: colors.gray300, true: colors.success }}
                value={handoverEnabled}
              />
            </View>
            <View style={styles.formContent}>
              <FormField
                autoCapitalize="none"
                editable={canEdit}
                label="Registration link"
                maxLength={512}
                onChangeText={setRegistrationLink}
                placeholder="https://..."
                value={registrationLink}
              />
            </View>
          </View>

          <View style={styles.card}>
            <SectionHeader title={`FAQs (${faqs.length})`} icon={<Icon name="help" size={18} color={colors.brand} />} />
            {faqs.length > 0 ? (
              <View style={styles.faqList}>
                {faqs.map((faq) => (
                  <View key={faq.id} style={styles.faqItem}>
                    <View style={styles.faqQuestionRow}>
                      <Text style={styles.faqQuestion}>{faq.question}</Text>
                      <View style={[styles.faqStatus, { backgroundColor: faq.enabled ? colors.successSurface : colors.gray100 }]}>
                        <Text style={[styles.faqStatusText, { color: faq.enabled ? colors.successDark : colors.muted }]}>
                          {faq.enabled ? 'ON' : 'OFF'}
                        </Text>
                      </View>
                    </View>
                    <Text numberOfLines={3} style={styles.faqAnswer}>{faq.answer}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.emptyFaqText}>No FAQs are configured for this bot yet.</Text>
            )}
          </View>

          <PrimaryButton
            disabled={!canEdit}
            icon={<Icon name="checkmark" size={18} color={colors.textInverse} />}
            loading={saving}
            onPress={() => void handleSave()}
            title="Save bot setup"
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.section,
  },
  emptyFaqText: {
    color: colors.muted,
    fontSize: fontSize.sm,
    marginTop: spacing.md,
  },
  errorNotice: {
    backgroundColor: colors.criticalSurface,
    borderColor: colors.criticalBorder,
  },
  faqAnswer: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 18,
    marginTop: spacing.xs,
  },
  faqItem: {
    borderTopColor: colors.borderLight,
    borderTopWidth: 1,
    paddingVertical: spacing.sm,
  },
  faqList: {
    marginTop: spacing.md,
  },
  faqQuestion: {
    color: colors.text,
    flex: 1,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    marginRight: spacing.sm,
  },
  faqQuestionRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  faqStatus: {
    borderRadius: radius.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  faqStatusText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
  },
  flex: {
    flex: 1,
  },
  formContent: {
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  loadingWrap: {
    padding: spacing.lg,
  },
  notice: {
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  noticeText: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  readOnlyBanner: {
    alignItems: 'center',
    backgroundColor: colors.infoSurface,
    borderColor: colors.infoBorder,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  readOnlyText: {
    color: colors.info,
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  statusBody: {
    flex: 1,
  },
  statusCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    ...shadows.sm,
  },
  statusIcon: {
    alignItems: 'center',
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.lg,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  statusText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 18,
    marginTop: spacing.xxs,
  },
  statusTitle: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  successNotice: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  toggleCopy: {
    flex: 1,
    marginRight: spacing.lg,
  },
  toggleRow: {
    alignItems: 'center',
    borderTopColor: colors.borderLight,
    borderTopWidth: 1,
    flexDirection: 'row',
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  toggleText: {
    color: colors.muted,
    fontSize: fontSize.sm,
    lineHeight: 18,
    marginTop: spacing.xxs,
  },
  toggleTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
});

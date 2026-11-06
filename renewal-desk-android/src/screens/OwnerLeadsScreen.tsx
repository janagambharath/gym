import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../components/AppHeader';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { FormField } from '../components/FormField';
import { LoadingSkeleton } from '../components/LoadingSkeleton';
import { PrimaryButton } from '../components/PrimaryButton';
import { apiRequest, getCachedSession } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';
import { formatDateTime, getPhoneCountryPrefix, safeDateKeyInTimezone } from '../types';

type OwnerLead = {
  id: number;
  name: string;
  phone: string;
  source: string | null;
  intent: string | null;
  interested_plan: string | null;
  status: string;
  trial_requested: boolean;
  notes: string | null;
  lost_reason: string | null;
  next_follow_up_at: string | null;
  last_contacted_at: string | null;
  trial_scheduled_for: string | null;
  trial_attended_at: string | null;
  converted_member_id: number | null;
  created_at: string | null;
};

const OPEN_STATUSES = new Set(['new', 'contacted', 'interested', 'trial_requested', 'booked']);

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  interested: 'Interested',
  trial_requested: 'Trial requested',
  booked: 'Trial booked',
  converted: 'Joined',
  lost: 'Lost',
  closed: 'Closed',
};

const SOURCES = ['walk_in', 'phone', 'referral', 'instagram', 'google', 'whatsapp', 'other'] as const;

type Filter = 'open' | 'booked' | 'all';
type PromptAction = 'book' | 'followup' | 'lost';

/** Date key (YYYY-MM-DD) of an instant in the gym's timezone — same
 * helper shape as the renew/record-payment screens. */
function dateKeyInTimezone(value: Date, timezone: string): string {
  // V5-L32 (same class as Renew/Record Payment): never throw RangeError
  // on an invalid gym timezone — fall back with a loud warning.
  return safeDateKeyInTimezone(value, timezone);
}

/** Calendar-day arithmetic on a YYYY-MM-DD key (noon-local construction
 * keeps the date stable across DST; only the key is used). */
function addDaysToDateKey(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day + days, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Interpret wall-clock components as a time in `timezone` and return the
 * UTC ISO string. (No tz library in this tree; two-pass Intl refinement
 * converges the UTC instant whose wall-clock reading in the zone equals
 * the typed components, including across DST changes.)
 */
function wallTimeInTimezoneToIso(
  y: number, mo: number, d: number, h: number, mi: number, timezone: string,
): string {
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const partsAsUtc = (t: number): number => {
    const p = dtf.formatToParts(new Date(t));
    const get = (type: string) => Number(p.find((x) => x.type === type)?.value);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  };
  let utc = wallAsUtc - (partsAsUtc(wallAsUtc) - wallAsUtc);
  utc = wallAsUtc - (partsAsUtc(utc) - utc);
  return new Date(utc).toISOString();
}

function localInputToIso(value: string, timezone: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Accept "YYYY-MM-DD HH:MM" (or with a T) as GYM-LOCAL time — the owner
  // types the time on the gym wall clock, not the phone's clock. (Was:
  // `new Date(y, mo-1, d, h, mi)`, which parsed in the phone timezone —
  // a phone on IST booking for a US gym shifted the trial by hours.)
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/);
  if (match) {
    const [, y, mo, d, h, mi] = match;
    try {
      return wallTimeInTimezoneToIso(Number(y), Number(mo), Number(d), Number(h), Number(mi), timezone);
    } catch {
      // V4-L28: an invalid gym timezone must NOT silently fall back to
      // a device-local parse (that silently books the trial/follow-up
      // hours off). Return null so the caller rejects the input with a
      // visible warning naming the broken timezone instead.
      return null;
    }
  }
  // V5-L37: anything not matching YYYY-MM-DD HH:MM is REJECTED — the
  // old `new Date(trimmed)` fallback parsed device-local time and saved
  // it with no warning, booking trials/follow-ups hours off whenever
  // the phone timezone differed from the gym's. Callers already show
  // the "Enter a valid date" alert on a null return.
  return null;
}

/** True when Intl accepts the timezone. Used to surface a broken gym
 * timezone as a visible warning instead of silently mis-parsing dates. */
function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Visible warning for a broken gym timezone: the date the owner typed is
 * fine — the gym's stored timezone is not, so nothing can be booked until
 * it is fixed in Settings. */
function alertInvalidGymTimezone(timezone: string) {
  Alert.alert(
    'Gym timezone is invalid',
    `The gym's timezone (“${timezone}”) isn't a valid timezone, so this date can't be converted reliably. Fix it in Settings before booking trials or follow-ups — the time was NOT saved.`,
  );
}

function defaultPromptValue(timezone: string): string {
  const tomorrow = addDaysToDateKey(dateKeyInTimezone(new Date(), timezone), 1);
  return `${tomorrow} 18:30`;
}

type OwnerLeadsScreenProps = {
  onBack: () => void;
};

/**
 * Owner Leads pipeline — add-lead form, Open / Trials / All filters, and
 * per-lead actions (contacted / trial / attended / follow-up / lost).
 * Mirrors the PWA owner-leads flow against the same backend endpoints.
 * The filter is kept in state across reloads — lead actions never snap it
 * back to Open.
 */
export function OwnerLeadsScreen({ onBack }: OwnerLeadsScreenProps) {
  const [leads, setLeads] = useState<OwnerLead[]>([]);
  const [filter, setFilter] = useState<Filter>('open');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [showForm, setShowForm] = useState(false);
  const [savingLead, setSavingLead] = useState(false);
  const [actioningId, setActioningId] = useState<number | null>(null);

  // Add-lead form
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [source, setSource] = useState<string>('walk_in');
  const [interestedPlan, setInterestedPlan] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [notes, setNotes] = useState('');
  const [trialRequested, setTrialRequested] = useState(false);

  // Prompt modal for book / follow-up / lost (needs a date or a reason).
  const [prompt, setPrompt] = useState<{ leadId: number; action: PromptAction; value: string } | null>(null);

  const load = useCallback(async () => {
    const res = await apiRequest<{ leads: OwnerLead[] }>('/api/mobile/v1/owner/leads');
    if (res.ok) {
      setLeads(res.data.leads || []);
      setError(undefined);
    } else {
      setError(res.error.message);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openLeads = leads.filter((l) => OPEN_STATUSES.has(l.status));
  const bookedLeads = leads.filter((l) => l.status === 'booked');
  const newCount = leads.filter((l) => l.status === 'new').length;
  const visible =
    filter === 'open' ? openLeads : filter === 'booked' ? bookedLeads : leads;

  const updateLead = async (leadId: number, body: Record<string, unknown>) => {
    setActioningId(leadId);
    const res = await apiRequest<{ lead: OwnerLead }>(`/api/mobile/v1/owner/leads/${leadId}`, {
      method: 'PATCH',
      body,
    });
    setActioningId(null);
    if (res.ok) {
      void load();
    } else {
      Alert.alert('Could not update lead', res.error.message);
    }
  };

  const handleAction = (lead: OwnerLead, action: 'contacted' | 'attended' | 'book' | 'followup' | 'lost') => {
    if (action === 'contacted') {
      void updateLead(lead.id, { status: 'contacted' });
      return;
    }
    if (action === 'attended') {
      void updateLead(lead.id, { status: 'interested', mark_trial_attended: true });
      return;
    }
    if (action === 'book') {
      const timezone = getCachedSession()?.gymTimezone ?? 'Asia/Kolkata';
      // V4-L28: defaultPromptValue throws on an invalid timezone
      // (dateKeyInTimezone) — warn visibly instead of crashing, and
      // never open the prompt on a timezone that can't parse dates.
      if (!isValidTimezone(timezone)) {
        alertInvalidGymTimezone(timezone);
        return;
      }
      setPrompt({ leadId: lead.id, action: 'book', value: defaultPromptValue(timezone) });
      return;
    }
    if (action === 'followup') {
      const timezone = getCachedSession()?.gymTimezone ?? 'Asia/Kolkata';
      if (!isValidTimezone(timezone)) {
        alertInvalidGymTimezone(timezone);
        return;
      }
      setPrompt({ leadId: lead.id, action: 'followup', value: defaultPromptValue(timezone) });
      return;
    }
    setPrompt({ leadId: lead.id, action: 'lost', value: '' });
  };

  const submitPrompt = () => {
    if (!prompt) return;
    if (prompt.action === 'lost') {
      void updateLead(prompt.leadId, { status: 'lost', lost_reason: prompt.value.trim() || undefined });
      setPrompt(null);
      return;
    }
    const timezone = getCachedSession()?.gymTimezone ?? 'Asia/Kolkata';
    // V4-L28: a null parse on a well-formed date means the gym timezone
    // is broken — say so explicitly instead of the generic "valid date"
    // message, which would blame the owner's (correct) input.
    if (!isValidTimezone(timezone)) {
      alertInvalidGymTimezone(timezone);
      return;
    }
    const iso = localInputToIso(prompt.value, timezone);
    if (!iso) {
      Alert.alert('Enter a valid date and time', 'Use the format YYYY-MM-DD HH:MM (e.g. 2026-11-07 18:30).');
      return;
    }
    if (prompt.action === 'book') {
      void updateLead(prompt.leadId, { status: 'booked', trial_requested: true, trial_scheduled_for: iso });
    } else {
      void updateLead(prompt.leadId, { next_follow_up_at: iso });
    }
    setPrompt(null);
  };

  const handleCreateLead = async () => {
    if (!name.trim() || !phone.trim()) {
      Alert.alert('Name and phone required', 'Enter the lead\u2019s name and a phone number.');
      return;
    }
    const session = getCachedSession();
    const countryPrefix = getPhoneCountryPrefix(session?.gymTimezone, session?.gymCountry);
    const cleanDigits = phone.replace(/\D/g, '');
    const normalizedPhone = phone.trim().startsWith('+')
      ? phone.trim()
      : cleanDigits.length === 10
        ? `${countryPrefix}${cleanDigits}`
        : `+${cleanDigits}`;
    // V4-L28: an invalid gym timezone rejects the follow-up with a named
    // warning — never a silent device-local parse of the typed time.
    if (followUpAt.trim()) {
      const timezone = session?.gymTimezone ?? 'Asia/Kolkata';
      if (!isValidTimezone(timezone)) {
        alertInvalidGymTimezone(timezone);
        return;
      }
    }
    const followUpIso = followUpAt.trim() ? localInputToIso(followUpAt, session?.gymTimezone ?? 'Asia/Kolkata') : null;
    if (followUpAt.trim() && !followUpIso) {
      Alert.alert('Enter a valid follow-up time', 'Use the format YYYY-MM-DD HH:MM (e.g. 2026-11-07 18:30).');
      return;
    }
    setSavingLead(true);
    const res = await apiRequest<{ lead: OwnerLead }>('/api/mobile/v1/owner/leads', {
      method: 'POST',
      body: {
        name: name.trim(),
        phone: normalizedPhone,
        source,
        interested_plan: interestedPlan.trim() || undefined,
        notes: notes.trim() || undefined,
        trial_requested: trialRequested,
        next_follow_up_at: followUpIso,
      },
    });
    setSavingLead(false);
    if (res.ok) {
      setName('');
      setPhone('');
      setInterestedPlan('');
      setFollowUpAt('');
      setNotes('');
      setTrialRequested(false);
      setShowForm(false);
      Alert.alert('Lead saved', 'Lead saved to the follow-up queue.');
      void load();
    } else {
      Alert.alert('Could not save lead', res.error.message);
    }
  };

  const promptTitle =
    prompt?.action === 'book' ? 'Book Trial' : prompt?.action === 'followup' ? 'Follow-up' : 'Mark Lost';
  const promptMessage =
    prompt?.action === 'book'
      ? 'Trial date and time:'
      : prompt?.action === 'followup'
        ? 'Next follow-up date and time:'
        : 'Why was this lead lost? (optional)';
  const promptPlaceholder =
    prompt?.action === 'lost' ? 'e.g. Joined another gym' : 'YYYY-MM-DD HH:MM (e.g. 2026-11-07 18:30)';

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="Leads & Trial Visits" onBack={onBack} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            colors={[colors.brand]}
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
      >
        {loading ? (
          <LoadingSkeleton lines={6} height={18} />
        ) : error ? (
          <ErrorState
            message={error}
            onRetry={() => {
              setLoading(true);
              void load();
            }}
          />
        ) : (
          <>
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{newCount}</Text>
                <Text style={styles.summaryLabel}>New</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{openLeads.length}</Text>
                <Text style={styles.summaryLabel}>Open</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{bookedLeads.length}</Text>
                <Text style={styles.summaryLabel}>Trials booked</Text>
              </View>
              <TouchableOpacity
                style={styles.addButton}
                onPress={() => setShowForm((v) => !v)}
                activeOpacity={0.7}
              >
                <Text style={styles.addButtonText}>{showForm ? 'Close' : '+ Add lead'}</Text>
              </TouchableOpacity>
            </View>

            {showForm ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Add a lead</Text>
                <Text style={styles.cardSub}>
                  Capture walk-ins and phone enquiries even without WhatsApp automation.
                </Text>
                <FormField label="Full name *" value={name} onChangeText={setName} placeholder="e.g. Neha Rao" />
                <FormField
                  label="Phone number *"
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="+91 98…"
                  keyboardType="phone-pad"
                />
                <Text style={styles.fieldLabel}>Source</Text>
                <View style={styles.chipRow}>
                  {SOURCES.map((s) => (
                    <TouchableOpacity
                      key={s}
                      style={[styles.chip, source === s && styles.chipActive]}
                      onPress={() => setSource(s)}
                    >
                      <Text style={[styles.chipText, source === s && styles.chipTextActive]}>
                        {s.replace('_', ' ')}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <FormField
                  label="Next follow-up"
                  value={followUpAt}
                  onChangeText={setFollowUpAt}
                  placeholder="YYYY-MM-DD HH:MM (optional)"
                />
                <FormField
                  label="Interested in"
                  value={interestedPlan}
                  onChangeText={setInterestedPlan}
                  placeholder="Membership / personal training"
                />
                <FormField
                  label="Notes"
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Goal, budget, schedule or anything the team should know"
                  multiline
                  numberOfLines={3}
                />
                <TouchableOpacity
                  style={styles.checkRow}
                  onPress={() => setTrialRequested((v) => !v)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.checkbox, trialRequested && styles.checkboxChecked]}>
                    {trialRequested ? <Icon name="checkmark" size={15} color={colors.textInverse} /> : null}
                  </View>
                  <Text style={styles.checkLabel}>Wants a trial visit</Text>
                </TouchableOpacity>
                <PrimaryButton
                  label="Save lead"
                  onPress={() => void handleCreateLead()}
                  loading={savingLead}
                  disabled={savingLead}
                />
              </View>
            ) : null}

            <View style={styles.filterRow}>
              {(
                [
                  { key: 'open', label: `Open (${openLeads.length})` },
                  { key: 'booked', label: `Trials (${bookedLeads.length})` },
                  { key: 'all', label: `All (${leads.length})` },
                ] as { key: Filter; label: string }[]
              ).map((f) => (
                <TouchableOpacity
                  key={f.key}
                  style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
                  onPress={() => setFilter(f.key)}
                >
                  <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.hint}>Follow up before the lead goes cold.</Text>

            {visible.length === 0 ? (
              <EmptyState
                icon={<Icon name="members" size={40} color={colors.muted} />}
                title={`No ${filter === 'all' ? '' : filter} leads`}
                subtitle="Add a lead or switch the filter to see your pipeline."
              />
            ) : (
              visible.map((lead) => (
                <View key={lead.id} style={styles.card}>
                  <View style={styles.leadHeader}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{(lead.name || '?').slice(0, 1).toUpperCase()}</Text>
                    </View>
                    <View style={styles.leadMain}>
                      <Text style={styles.leadName}>{lead.name || 'Unnamed lead'}</Text>
                      <Text style={styles.leadMeta}>
                        {lead.phone}
                        {lead.source ? ` · ${lead.source.replace('_', ' ')}` : ''}
                      </Text>
                    </View>
                    <View style={styles.statusPill}>
                      <Text style={styles.statusText}>{STATUS_LABELS[lead.status] || lead.status}</Text>
                    </View>
                  </View>
                  <Text style={styles.leadMeta}>
                    Follow-up: {lead.next_follow_up_at ? formatDateTime(lead.next_follow_up_at) : 'Set a follow-up time'}
                  </Text>
                  {lead.trial_scheduled_for ? (
                    <Text style={styles.leadMeta}>Trial: {formatDateTime(lead.trial_scheduled_for)}</Text>
                  ) : null}
                  {lead.interested_plan ? (
                    <Text style={styles.leadMeta}>Interested in: {lead.interested_plan}</Text>
                  ) : null}
                  {lead.notes ? <Text style={styles.leadNote}>{lead.notes}</Text> : null}
                  {lead.lost_reason ? (
                    <Text style={styles.leadMeta}>Lost reason: {lead.lost_reason}</Text>
                  ) : null}
                  <View style={styles.actionsRow}>
                    {lead.status === 'new' ? (
                      <TouchableOpacity
                        style={styles.actionButton}
                        disabled={actioningId === lead.id}
                        onPress={() => handleAction(lead, 'contacted')}
                      >
                        <Text style={styles.actionText}>Mark contacted</Text>
                      </TouchableOpacity>
                    ) : null}
                    {lead.status !== 'booked' && OPEN_STATUSES.has(lead.status) ? (
                      <TouchableOpacity
                        style={[styles.actionButton, styles.actionPrimary]}
                        disabled={actioningId === lead.id}
                        onPress={() => handleAction(lead, 'book')}
                      >
                        <Text style={[styles.actionText, styles.actionTextPrimary]}>Book trial</Text>
                      </TouchableOpacity>
                    ) : null}
                    {lead.status === 'booked' ? (
                      <TouchableOpacity
                        style={[styles.actionButton, styles.actionPrimary]}
                        disabled={actioningId === lead.id}
                        onPress={() => handleAction(lead, 'attended')}
                      >
                        <Text style={[styles.actionText, styles.actionTextPrimary]}>Trial attended</Text>
                      </TouchableOpacity>
                    ) : null}
                    {OPEN_STATUSES.has(lead.status) ? (
                      <>
                        <TouchableOpacity
                          style={styles.actionButton}
                          disabled={actioningId === lead.id}
                          onPress={() => handleAction(lead, 'followup')}
                        >
                          <Text style={styles.actionText}>Set follow-up</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.actionButton, styles.actionDanger]}
                          disabled={actioningId === lead.id}
                          onPress={() => handleAction(lead, 'lost')}
                        >
                          <Text style={[styles.actionText, styles.actionTextDanger]}>Mark lost</Text>
                        </TouchableOpacity>
                      </>
                    ) : null}
                  </View>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>

      <Modal visible={prompt !== null} transparent animationType="fade" onRequestClose={() => setPrompt(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.promptCard}>
            <Text style={styles.promptTitle}>{promptTitle}</Text>
            <Text style={styles.promptMessage}>{promptMessage}</Text>
            <TextInput
              style={styles.promptInput}
              value={prompt?.value ?? ''}
              onChangeText={(value) => setPrompt((p) => (p ? { ...p, value } : p))}
              placeholder={promptPlaceholder}
              placeholderTextColor={colors.muted}
              autoFocus
            />
            <View style={styles.promptActions}>
              <TouchableOpacity style={styles.promptCancel} onPress={() => setPrompt(null)}>
                <Text style={styles.promptCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.promptSave} onPress={submitPrompt}>
                <Text style={styles.promptSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.bottomTabSafe },
  summaryRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  summaryItem: { alignItems: 'center' },
  summaryValue: { color: colors.text, fontSize: fontSize['2xl'], fontWeight: fontWeight.extrabold },
  summaryLabel: { color: colors.textSecondary, fontSize: fontSize.xs },
  addButton: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    marginLeft: 'auto',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  addButtonText: { color: colors.textInverse, fontSize: fontSize.base, fontWeight: fontWeight.bold },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
    ...shadows.sm,
  },
  cardTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  cardSub: { color: colors.textSecondary, fontSize: fontSize.sm, lineHeight: 19 },
  fieldLabel: { color: colors.textSecondary, fontSize: fontSize.base, fontWeight: fontWeight.medium },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  chipActive: { backgroundColor: colors.brandSubtle, borderColor: colors.brand },
  chipText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: fontWeight.medium, textTransform: 'capitalize' },
  chipTextActive: { color: colors.brand, fontWeight: fontWeight.bold },
  checkRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.xs,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  checkboxChecked: { backgroundColor: colors.brand, borderColor: colors.brand },
  checkLabel: { color: colors.text, fontSize: fontSize.base },
  filterRow: { flexDirection: 'row', gap: spacing.sm },
  filterChip: {
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  filterChipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  filterText: { color: colors.textSecondary, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  filterTextActive: { color: colors.textInverse },
  hint: { color: colors.muted, fontSize: fontSize.sm },
  leadHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.full,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  avatarText: { color: colors.brand, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  leadMain: { flex: 1 },
  leadName: { color: colors.text, fontSize: fontSize.base, fontWeight: fontWeight.bold },
  leadMeta: { color: colors.textSecondary, fontSize: fontSize.sm, marginTop: 2 },
  leadNote: { color: colors.textSecondary, fontSize: fontSize.sm, fontStyle: 'italic' },
  statusPill: { backgroundColor: colors.infoSurface, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  statusText: { color: colors.info, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  actionButton: {
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionPrimary: { backgroundColor: colors.brand, borderColor: colors.brand },
  actionDanger: { borderColor: colors.critical },
  actionText: { color: colors.text, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  actionTextPrimary: { color: colors.textInverse },
  actionTextDanger: { color: colors.critical },
  modalOverlay: { alignItems: 'center', backgroundColor: colors.overlay, flex: 1, justifyContent: 'center', padding: spacing.lg },
  promptCard: { backgroundColor: colors.card, borderRadius: radius.xl, gap: spacing.md, padding: spacing.lg, width: '100%' },
  promptTitle: { color: colors.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  promptMessage: { color: colors.textSecondary, fontSize: fontSize.base },
  promptInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: fontSize.base,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  promptActions: { flexDirection: 'row', gap: spacing.sm },
  promptCancel: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    paddingVertical: spacing.md,
  },
  promptCancelText: { color: colors.textSecondary, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  promptSave: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    flex: 1,
    paddingVertical: spacing.md,
  },
  promptSaveText: { color: colors.textInverse, fontSize: fontSize.base, fontWeight: fontWeight.bold },
});

import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppHeader } from '../components/AppHeader';
import { PrimaryButton } from '../components/PrimaryButton';
import { StatusBadge } from '../components/StatusBadge';
import { apiRequest } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, shadows, spacing } from '../theme/tokens';

type BotTestResponse = {
  input: string;
  response: string;
  intent: string;
  handover: boolean;
  lead_captured: {
    name: string | null;
    interested_plan: string | null;
    status: string;
    notes: string | null;
  };
};

type BotTestScreenProps = {
  onBack: () => void;
};

const SUGGESTED_PROMPTS = [
  'What are your membership plans and pricing?',
  'Are you open on Sunday?',
  'Can I come for a free workout trial?',
  'Where is your gym located?',
  'I need to talk to the gym owner directly.',
];

export function BotTestScreen({ onBack }: BotTestScreenProps) {
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BotTestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleTest = async (queryText?: string) => {
    const textToSend = (queryText ?? inputText).trim();
    if (!textToSend) return;

    setLoading(true);
    setError(null);
    setInputText(textToSend);

    const res = await apiRequest<BotTestResponse>('/api/mobile/v1/bot/test', {
      method: 'POST',
      body: { message: textToSend },
    });

    if (res.ok) {
      setResult(res.data);
    } else {
      setError(res.error.message);
    }
    setLoading(false);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <AppHeader title="AI Bot Sandbox" onBack={onBack} />

      <KeyboardAvoidingView
        style={styles.keyboardWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Info Banner */}
          <View style={styles.infoBanner}>
            <Icon name="chatbubble" size={20} color={colors.whatsapp} />
            <Text style={styles.infoText}>
              Test how your AI receptionist answers prospective members based on your configured plans, hours, and FAQs. No real WhatsApp messages are sent.
            </Text>
          </View>

          {/* Quick suggestions */}
          <Text style={styles.sectionLabel}>Quick Test Questions</Text>
          <View style={styles.chipRow}>
            {SUGGESTED_PROMPTS.map((prompt, idx) => (
              <TouchableOpacity
                key={idx}
                style={styles.promptChip}
                onPress={() => void handleTest(prompt)}
                disabled={loading}
              >
                <Text style={styles.promptChipText}>{prompt}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Input Box */}
          <Text style={styles.sectionLabel}>Custom Message</Text>
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.textInput}
              placeholder="Type any inquiry (e.g. Do you have showers?)..."
              placeholderTextColor={colors.muted}
              value={inputText}
              onChangeText={setInputText}
              multiline
              numberOfLines={3}
            />
            <View style={styles.actionBtnRow}>
              <PrimaryButton
                title="Simulate Response"
                icon={<Icon name="send" size={16} color={colors.textInverse} />}
                onPress={() => void handleTest()}
                loading={loading}
                disabled={!inputText.trim()}
              />
            </View>
          </View>

          {/* Error */}
          {error ? (
            <View style={styles.errorCard}>
              <Icon name="alert" size={18} color={colors.critical} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Result */}
          {result ? (
            <View style={styles.resultCard}>
              <View style={styles.resultHeader}>
                <Icon name="whatsapp" size={22} color={colors.whatsapp} />
                <Text style={styles.resultTitle}>AI Receptionist Reply</Text>
                <StatusBadge status={result.handover ? 'Pending' : 'Active'} />
              </View>

              <View style={styles.responseBubble}>
                <Text style={styles.responseText}>{result.response}</Text>
              </View>

              {/* Metadata */}
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Classified Intent: </Text>
                <Text style={styles.metaValue}>{result.intent.toUpperCase()}</Text>
              </View>

              {result.handover ? (
                <View style={styles.handoverNotice}>
                  <Icon name="warning" size={16} color={colors.statusExpiring} />
                  <Text style={styles.handoverText}>Human handover was triggered.</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  actionBtnRow: {
    marginTop: spacing.md,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.section,
  },
  errorCard: {
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    borderColor: colors.critical,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  errorText: {
    color: colors.critical,
    fontSize: fontSize.sm,
  },
  handoverNotice: {
    alignItems: 'center',
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  handoverText: {
    color: colors.brandDark,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  infoBanner: {
    alignItems: 'flex-start',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    ...shadows.sm,
  },
  infoText: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  inputContainer: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    ...shadows.sm,
  },
  keyboardWrap: {
    flex: 1,
  },
  metaLabel: {
    color: colors.muted,
    fontSize: fontSize.xs,
  },
  metaRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
  },
  metaValue: {
    color: colors.text,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  promptChip: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  promptChipText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  responseBubble: {
    backgroundColor: '#F0FDF4',
    borderColor: '#DCFCE7',
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  responseText: {
    color: colors.text,
    fontSize: fontSize.base,
    lineHeight: 22,
  },
  resultCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.md,
  },
  resultHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  resultTitle: {
    color: colors.text,
    flex: 1,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  sectionLabel: {
    color: colors.text,
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
  },
  textInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: fontSize.base,
    minHeight: 80,
    padding: spacing.md,
    textAlignVertical: 'top',
  },
});

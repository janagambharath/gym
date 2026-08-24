import { StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import type { BotMessage } from '../types';
import { colors, fontSize, fontWeight, radius, spacing } from '../theme/tokens';

type BotMessageBubbleProps = {
  message: BotMessage;
};

function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return '';
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function styleForSender(sender: string): {
  label: string;
  bubble: ViewStyle;
  text: TextStyle;
  meta: TextStyle;
} {
  switch (sender.toLowerCase()) {
    case 'staff':
      return {
        label: 'You',
        bubble: styles.staffBubble,
        text: styles.staffText,
        meta: styles.staffMeta,
      };
    case 'bot':
      return {
        label: 'AI receptionist',
        bubble: styles.botBubble,
        text: styles.defaultText,
        meta: styles.defaultMeta,
      };
    case 'system':
      return {
        label: 'System',
        bubble: styles.systemBubble,
        text: styles.defaultText,
        meta: styles.defaultMeta,
      };
    default:
      return {
        label: 'Customer',
        bubble: styles.customerBubble,
        text: styles.defaultText,
        meta: styles.defaultMeta,
      };
  }
}

/** A real message bubble; the caller supplies only messages returned by the API. */
export function BotMessageBubble({ message }: BotMessageBubbleProps) {
  const senderStyle = styleForSender(message.sender);
  const isStaff = message.sender.toLowerCase() === 'staff';
  const timestamp = formatTimestamp(message.created_at);

  return (
    <View style={[styles.row, isStaff ? styles.staffRow : styles.customerRow]}>
      <View style={[styles.bubble, senderStyle.bubble]}>
        <Text style={[styles.sender, senderStyle.meta]}>{senderStyle.label}</Text>
        <Text style={[styles.body, senderStyle.text]}>{message.body}</Text>
        {timestamp ? <Text style={[styles.timestamp, senderStyle.meta]}>{timestamp}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    fontSize: fontSize.base,
    lineHeight: 20,
  },
  botBubble: {
    backgroundColor: colors.brandSubtle,
    borderColor: colors.infoBorder,
  },
  bubble: {
    borderRadius: radius.lg,
    borderWidth: 1,
    maxWidth: '84%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  customerBubble: {
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
  customerRow: {
    justifyContent: 'flex-start',
  },
  defaultMeta: {
    color: colors.muted,
  },
  defaultText: {
    color: colors.text,
  },
  row: {
    flexDirection: 'row',
  },
  sender: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.xxs,
  },
  staffBubble: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  staffMeta: {
    color: '#DBEAFE',
  },
  staffRow: {
    justifyContent: 'flex-end',
  },
  staffText: {
    color: colors.textInverse,
  },
  systemBubble: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  timestamp: {
    fontSize: fontSize.xs,
    marginTop: spacing.xs,
  },
});

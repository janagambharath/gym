import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { ApiError } from '../services/apiClient';
import { Icon } from '../theme/icons';
import { colors, fontSize, fontWeight, radius, spacing } from '../theme/tokens';

type BotAccessStateProps = {
  error: ApiError;
  onRetry?: () => void;
};

type ErrorPresentation = {
  title: string;
  message: string;
  icon: 'lock' | 'settings' | 'warning';
  color: string;
  surface: string;
  border: string;
};

const SETUP_ERROR_CODES = new Set([
  'BOT_SETUP_REQUIRED',
  'BOT_NOT_CONFIGURED',
  'SETUP_REQUIRED',
  'WHATSAPP_DISABLED',
]);

/** True only when the server explicitly says this tenant lacks the paid module. */
export function isBotEntitlementError(error: ApiError | undefined): boolean {
  return error?.code === 'FEATURE_NOT_ENABLED';
}

/** Errors for a missing WhatsApp/Bot setup, rather than a general transport error. */
export function isBotSetupError(error: ApiError | undefined): boolean {
  return !!error?.code && SETUP_ERROR_CODES.has(error.code);
}

function presentationFor(error: ApiError): ErrorPresentation {
  if (isBotEntitlementError(error)) {
    return {
      title: 'WhatsApp Bot is not enabled',
      message: 'This gym needs an active WhatsApp Bot entitlement before bot operations can be used.',
      icon: 'lock',
      color: colors.warningDark,
      surface: colors.warningSurface,
      border: colors.warningBorder,
    };
  }

  if (isBotSetupError(error)) {
    return {
      title: 'WhatsApp setup is incomplete',
      message: 'Connect WhatsApp and complete the bot setup before sending or managing bot messages.',
      icon: 'settings',
      color: colors.info,
      surface: colors.infoSurface,
      border: colors.infoBorder,
    };
  }

  if (error.status === 403) {
    return {
      title: 'Bot access is restricted',
      message: 'Your account does not have access to this WhatsApp Bot operation.',
      icon: 'lock',
      color: colors.critical,
      surface: colors.criticalSurface,
      border: colors.criticalBorder,
    };
  }

  return {
    title: 'Could not load WhatsApp Bot',
    message: error.message,
    icon: 'warning',
    color: colors.critical,
    surface: colors.criticalSurface,
    border: colors.criticalBorder,
  };
}

/**
 * A bot-specific failure state. It separates a missing paid entitlement or
 * configuration from ordinary network/API failures, so operators know whether
 * retrying can help.
 */
export function BotAccessState({ error, onRetry }: BotAccessStateProps) {
  const presentation = presentationFor(error);
  const canRetry = !isBotEntitlementError(error) && !isBotSetupError(error);

  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.container,
        { backgroundColor: presentation.surface, borderColor: presentation.border },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: presentation.border }]}>
        <Icon name={presentation.icon} size={26} color={presentation.color} />
      </View>
      <Text style={[styles.title, { color: presentation.color }]}>{presentation.title}</Text>
      <Text style={styles.message}>{presentation.message}</Text>
      {canRetry && onRetry ? (
        <TouchableOpacity accessibilityRole="button" onPress={onRetry} style={styles.retry}>
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    margin: spacing.lg,
    padding: spacing.xxl,
  },
  iconWrap: {
    alignItems: 'center',
    borderRadius: radius.full,
    height: 48,
    justifyContent: 'center',
    marginBottom: spacing.md,
    width: 48,
  },
  message: {
    color: colors.textSecondary,
    fontSize: fontSize.base,
    lineHeight: 20,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  retry: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  retryText: {
    color: colors.textInverse,
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
  },
});

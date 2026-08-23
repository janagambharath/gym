import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { PrimaryButton } from '../components/PrimaryButton';
import { StatusCard } from '../components/StatusCard';
import { getRuntimeConfiguration } from '../config/runtime';
import { fetchPlatformHealth, PlatformHealth, PlatformRequestError } from '../services/platformHealth';
import { colors, radius, spacing } from '../theme/tokens';

type ConnectionState =
  | { kind: 'checking' }
  | { health: PlatformHealth; kind: 'ready' }
  | { detail: string; kind: 'error' }
  | { kind: 'unconfigured' };

const runtimeConfiguration = getRuntimeConfiguration();

function healthDetail(health: PlatformHealth): string {
  const database = health.database === 'ok' ? 'database ready' : 'database unavailable';
  const schema = health.schema === 'ok' ? 'schema ready' : 'schema unavailable';
  const revision = health.revision ? ` Revision ${health.revision}.` : '';
  return `${database}; ${schema}.${revision}`;
}

export function ServiceReadinessScreen() {
  const [connection, setConnection] = useState<ConnectionState>(() =>
    runtimeConfiguration.apiBaseUrl ? { kind: 'checking' } : { kind: 'unconfigured' },
  );

  const checkService = useCallback(async () => {
    if (!runtimeConfiguration.apiBaseUrl) {
      setConnection({ kind: 'unconfigured' });
      return;
    }

    setConnection({ kind: 'checking' });
    try {
      const health = await fetchPlatformHealth(runtimeConfiguration.apiBaseUrl);
      setConnection({ health, kind: 'ready' });
    } catch (error) {
      const detail = error instanceof PlatformRequestError ? error.message : 'Unexpected connection error.';
      setConnection({ detail, kind: 'error' });
    }
  }, []);

  useEffect(() => {
    const startupCheck = setTimeout(() => {
      void checkService();
    }, 0);

    return () => clearTimeout(startupCheck);
  }, [checkService]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.brand}>
            Renewal Desk
          </Text>
          <Text style={styles.subtitle}>Secure Android client foundation</Text>
        </View>

        <StatusCard
          detail={`Environment: ${runtimeConfiguration.environment}. The API URL is configured only through the app environment, never source code.`}
          title="Environment protection"
          tone="success"
        />

        {connection.kind === 'checking' ? (
          <StatusCard detail="Checking the configured Renewal Desk service…" title="Server connection">
            <ActivityIndicator accessibilityLabel="Checking server connection" color={colors.brand} />
          </StatusCard>
        ) : null}

        {connection.kind === 'unconfigured' ? (
          <StatusCard
            detail="Set EXPO_PUBLIC_API_BASE_URL in .env.local before connecting this app to a Renewal Desk environment."
            title="Server URL required"
            tone="warning"
          />
        ) : null}

        {connection.kind === 'ready' ? (
          <StatusCard
            detail={healthDetail(connection.health)}
            title="Renewal Desk service reachable"
            tone={connection.health.status === 'ok' ? 'success' : 'warning'}
          />
        ) : null}

        {connection.kind === 'error' ? (
          <StatusCard detail={connection.detail} title="Could not reach Renewal Desk" tone="critical" />
        ) : null}

        <StatusCard
          detail="Owner and staff workflows remain unavailable until this build is connected to a deployed, token-authenticated Renewal Desk Mobile API. This app will not scrape browser forms, store browser cookies, or use Bridge credentials as a workaround."
          title="Mobile workflows are safely blocked"
          tone="warning"
        />

        <View style={styles.nextSteps}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            What is ready
          </Text>
          <Text style={styles.bullet}>• Isolated Expo + TypeScript Android project</Text>
          <Text style={styles.bullet}>• HTTPS-only runtime configuration outside local development</Text>
          <Text style={styles.bullet}>• SecureStore session boundary for a future authorized token contract</Text>
          <Text style={styles.bullet}>• Safe health check, timeout, retry, and error presentation</Text>
        </View>

        <PrimaryButton label="Retry server connection" onPress={() => void checkService()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  brand: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  bullet: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 23,
  },
  content: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  header: {
    gap: spacing.xxs,
    marginBottom: spacing.xs,
  },
  nextSteps: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.xxs,
    padding: spacing.md,
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 16,
  },
});

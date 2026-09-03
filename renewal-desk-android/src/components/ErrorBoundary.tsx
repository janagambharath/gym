import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, fontSize, fontWeight, radius, spacing } from '../theme/tokens';
import { Icon } from '../theme/icons';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage?: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error?.message || 'An unexpected error occurred.' };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.warn('[ErrorBoundary] Caught runtime component error:', error?.message, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, errorMessage: undefined });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.container}>
          <View style={styles.iconCircle}>
            <Icon name="alert" size={32} color={colors.critical} />
          </View>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.subtitle}>
            Renewal Desk encountered an unexpected error. You can reload the screen to continue.
          </Text>
          {this.state.errorMessage ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText} numberOfLines={3}>
                {this.state.errorMessage}
              </Text>
            </View>
          ) : null}
          <TouchableOpacity style={styles.button} onPress={this.handleReset} activeOpacity={0.8}>
            <Icon name="refresh" size={16} color={colors.textInverse} />
            <Text style={styles.buttonText}>Reload Application</Text>
          </TouchableOpacity>
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  buttonText: {
    color: colors.textInverse,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  container: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  errorBox: {
    backgroundColor: colors.gray100,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginBottom: spacing.xl,
    padding: spacing.md,
    width: '100%',
  },
  errorText: {
    color: colors.textSecondary,
    fontFamily: 'monospace',
    fontSize: fontSize.xs,
  },
  iconCircle: {
    alignItems: 'center',
    backgroundColor: colors.criticalSurface,
    borderColor: colors.criticalBorder,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 64,
    justifyContent: 'center',
    marginBottom: spacing.lg,
    width: 64,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 20,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
  title: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
});

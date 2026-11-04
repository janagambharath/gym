import { useEffect, useState, type DependencyList, type EffectCallback } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

/** Revalidate only while this screen is visible. Existing effect cleanup cancels stale loads. */
export function useLiveEffect(effect: EffectCallback, deps: DependencyList, intervalMs = 30000) {
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!focused || !foreground || intervalMs <= 0) return;
    const timer = setInterval(() => setRevision(value => value + 1), intervalMs);
    return () => clearInterval(timer);
  }, [focused, foreground, intervalMs]);

  useEffect(() => {
    if (focused && foreground) return effect();
    // Callers supply the same dependency list they would supply to useEffect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, foreground, revision, ...deps]);
}

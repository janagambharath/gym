import { registerRootComponent } from 'expo';

// Global error guard to prevent unhandled app crashes
if (typeof (global as any).ErrorUtils !== 'undefined') {
  const globalErrorUtils = (global as any).ErrorUtils;
  const defaultHandler = globalErrorUtils.getGlobalHandler();
  globalErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    console.warn('[VYNLA_ErrorGuard] Unhandled JS error:', error?.message);
    if (__DEV__ && defaultHandler) {
      defaultHandler(error, isFatal);
    }
  });
}

import App from './App';

registerRootComponent(App);

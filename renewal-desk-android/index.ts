import { registerRootComponent } from 'expo';

// Install global error guard to suppress unhandled native crashes
if (typeof (global as any).ErrorUtils !== 'undefined') {
  const globalErrorUtils = (global as any).ErrorUtils;
  const defaultHandler = globalErrorUtils.getGlobalHandler();
  globalErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    console.warn('[GlobalErrorGuard] Unhandled JS error:', error?.message);
    if (__DEV__ && defaultHandler) {
      defaultHandler(error, isFatal);
    }
  });
}

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

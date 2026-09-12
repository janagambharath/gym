import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { BrandingProvider } from './src/context/BrandingContext';
import { AppNavigator } from './src/navigation/AppNavigator';

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <BrandingProvider>
          <StatusBar style="dark" />
          <AppNavigator />
        </BrandingProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

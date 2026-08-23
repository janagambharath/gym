import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { MemberDetailScreen } from './src/screens/MemberDetailScreen';
import { MembersScreen } from './src/screens/MembersScreen';
import type { Member } from './src/screens/MembersScreen';
import { PaymentsScreen } from './src/screens/PaymentsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { restoreSession } from './src/services/apiClient';
import { colors } from './src/theme/tokens';

type RootStackParamList = {
  Login: undefined;
  Dashboard: undefined;
  Members: undefined;
  MemberDetail: { member: Member };
  Payments: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    async function bootstrap() {
      const session = await restoreSession();
      setIsAuthenticated(!!session);
      setIsReady(true);
    }
    void bootstrap();
  }, []);

  const handleLoginSuccess = useCallback(() => {
    setIsAuthenticated(true);
  }, []);

  const handleLogout = useCallback(() => {
    setIsAuthenticated(false);
  }, []);

  if (!isReady) {
    return (
      <View style={styles.splash}>
        <StatusBar style="dark" />
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {isAuthenticated ? (
            <>
              <Stack.Screen name="Dashboard">
                {(props) => (
                  <DashboardScreen
                    {...props}
                    onLogout={handleLogout}
                    onNavigateMembers={() => props.navigation.navigate('Members')}
                    onNavigatePayments={() => props.navigation.navigate('Payments')}
                    onNavigateSettings={() => props.navigation.navigate('Settings')}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen name="Members">
                {(props) => (
                  <MembersScreen
                    {...props}
                    onBack={() => props.navigation.goBack()}
                    onLogout={handleLogout}
                    onSelectMember={(member) => props.navigation.navigate('MemberDetail', { member })}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen name="MemberDetail">
                {(props) => {
                  const member = (props.route.params as { member: Member })?.member;
                  return (
                    <MemberDetailScreen
                      member={member}
                      onBack={() => props.navigation.goBack()}
                      onLogout={handleLogout}
                    />
                  );
                }}
              </Stack.Screen>
              <Stack.Screen name="Payments">
                {(props) => (
                  <PaymentsScreen
                    onBack={() => props.navigation.goBack()}
                    onLogout={handleLogout}
                  />
                )}
              </Stack.Screen>
              <Stack.Screen name="Settings">
                {(props) => (
                  <SettingsScreen
                    onBack={() => props.navigation.goBack()}
                    onLogout={handleLogout}
                  />
                )}
              </Stack.Screen>
            </>
          ) : (
            <Stack.Screen name="Login">
              {() => <LoginScreen onLoginSuccess={handleLoginSuccess} />}
            </Stack.Screen>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </>
  );
}

const styles = StyleSheet.create({
  splash: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
  },
});

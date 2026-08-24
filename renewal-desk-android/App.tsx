import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { AddMemberScreen } from './src/screens/AddMemberScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { MemberDetailScreen } from './src/screens/MemberDetailScreen';
import { MembersScreen } from './src/screens/MembersScreen';
import { PaymentsScreen } from './src/screens/PaymentsScreen';
import { RenewalsScreen } from './src/screens/RenewalsScreen';
import { RenewMemberScreen } from './src/screens/RenewMemberScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { apiRequest, restoreSession } from './src/services/apiClient';
import { colors, fontSize, fontWeight, spacing } from './src/theme/tokens';
import type { Member, Plan, SettingsResponse } from './src/types';

// ─── Navigation Types ────────────────────────────────────────────────

type DashboardStackParamList = {
  DashboardHome: undefined;
  MemberDetail: { member: Member };
  RenewMember: { member: Member };
  AddMember: undefined;
};

type MembersStackParamList = {
  MembersList: undefined;
  MemberDetail: { member: Member };
  RenewMember: { member: Member };
  AddMember: undefined;
};

type RenewalsStackParamList = {
  RenewalsHome: undefined;
  MemberDetail: { member: Member };
  RenewMember: { member: Member };
};

type PaymentsStackParamList = {
  PaymentsHome: undefined;
};

type MoreStackParamList = {
  MoreHome: undefined;
};

type AuthStackParamList = {
  Login: undefined;
};

// ─── Navigators ──────────────────────────────────────────────────────

const Tab = createBottomTabNavigator();
const DashboardStack = createNativeStackNavigator<DashboardStackParamList>();
const MembersStack = createNativeStackNavigator<MembersStackParamList>();
const RenewalsStack = createNativeStackNavigator<RenewalsStackParamList>();
const PaymentsStack = createNativeStackNavigator<PaymentsStackParamList>();
const MoreStack = createNativeStackNavigator<MoreStackParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();

const TAB_ICONS: Record<string, { active: string; inactive: string }> = {
  Dashboard: { active: '📊', inactive: '📊' },
  Members: { active: '👥', inactive: '👥' },
  Renewals: { active: '🔄', inactive: '🔄' },
  Payments: { active: '💳', inactive: '💳' },
  More: { active: '⚙', inactive: '⚙' },
};

// ─── Stack Screens ───────────────────────────────────────────────────

function DashboardStackScreen({
  onLogout,
  plans,
}: {
  onLogout: () => void;
  plans: Plan[];
}) {
  return (
    <DashboardStack.Navigator screenOptions={{ headerShown: false }}>
      <DashboardStack.Screen name="DashboardHome">
        {(props) => (
          <DashboardScreen
            onLogout={onLogout}
            onNavigateMembers={() => {}}
            onNavigatePayments={() => {}}
            onNavigateRenewals={() => {}}
            onNavigateSettings={() => {}}
            onNavigateMemberDetail={(member) =>
              props.navigation.navigate('MemberDetail', { member })
            }
            onNavigateAddMember={() => props.navigation.navigate('AddMember')}
          />
        )}
      </DashboardStack.Screen>
      <DashboardStack.Screen name="MemberDetail">
        {(props) => {
          const member = (props.route.params as { member: Member })?.member;
          return (
            <MemberDetailScreen
              member={member}
              onBack={() => props.navigation.goBack()}
              onLogout={onLogout}
              onRenew={(m) => props.navigation.navigate('RenewMember', { member: m })}
            />
          );
        }}
      </DashboardStack.Screen>
      <DashboardStack.Screen name="RenewMember">
        {(props) => {
          const member = (props.route.params as { member: Member })?.member;
          return (
            <RenewMemberScreen
              member={member}
              onBack={() => props.navigation.goBack()}
              onLogout={onLogout}
              onViewMember={() => props.navigation.goBack()}
              onComplete={() => {}}
            />
          );
        }}
      </DashboardStack.Screen>
      <DashboardStack.Screen name="AddMember">
        {(props) => (
          <AddMemberScreen
            onBack={() => props.navigation.goBack()}
            onLogout={onLogout}
            plans={plans}
            onMemberCreated={(member) => {
              props.navigation.replace('MemberDetail', { member });
            }}
          />
        )}
      </DashboardStack.Screen>
    </DashboardStack.Navigator>
  );
}

function MembersStackScreen({
  onLogout,
  plans,
}: {
  onLogout: () => void;
  plans: Plan[];
}) {
  return (
    <MembersStack.Navigator screenOptions={{ headerShown: false }}>
      <MembersStack.Screen name="MembersList">
        {(props) => (
          <MembersScreen
            onLogout={onLogout}
            onSelectMember={(member) =>
              props.navigation.navigate('MemberDetail', { member })
            }
            onAddMember={() => props.navigation.navigate('AddMember')}
          />
        )}
      </MembersStack.Screen>
      <MembersStack.Screen name="MemberDetail">
        {(props) => {
          const member = (props.route.params as { member: Member })?.member;
          return (
            <MemberDetailScreen
              member={member}
              onBack={() => props.navigation.goBack()}
              onLogout={onLogout}
              onRenew={(m) => props.navigation.navigate('RenewMember', { member: m })}
            />
          );
        }}
      </MembersStack.Screen>
      <MembersStack.Screen name="RenewMember">
        {(props) => {
          const member = (props.route.params as { member: Member })?.member;
          return (
            <RenewMemberScreen
              member={member}
              onBack={() => props.navigation.goBack()}
              onLogout={onLogout}
              onViewMember={() => props.navigation.goBack()}
              onComplete={() => {}}
            />
          );
        }}
      </MembersStack.Screen>
      <MembersStack.Screen name="AddMember">
        {(props) => (
          <AddMemberScreen
            onBack={() => props.navigation.goBack()}
            onLogout={onLogout}
            plans={plans}
            onMemberCreated={(member) => {
              props.navigation.replace('MemberDetail', { member });
            }}
          />
        )}
      </MembersStack.Screen>
    </MembersStack.Navigator>
  );
}

function RenewalsStackScreen({ onLogout }: { onLogout: () => void }) {
  return (
    <RenewalsStack.Navigator screenOptions={{ headerShown: false }}>
      <RenewalsStack.Screen name="RenewalsHome">
        {(props) => (
          <RenewalsScreen
            onLogout={onLogout}
            onSelectMember={(member) =>
              props.navigation.navigate('MemberDetail', { member })
            }
            onRenew={(member) =>
              props.navigation.navigate('RenewMember', { member })
            }
          />
        )}
      </RenewalsStack.Screen>
      <RenewalsStack.Screen name="MemberDetail">
        {(props) => {
          const member = (props.route.params as { member: Member })?.member;
          return (
            <MemberDetailScreen
              member={member}
              onBack={() => props.navigation.goBack()}
              onLogout={onLogout}
              onRenew={(m) => props.navigation.navigate('RenewMember', { member: m })}
            />
          );
        }}
      </RenewalsStack.Screen>
      <RenewalsStack.Screen name="RenewMember">
        {(props) => {
          const member = (props.route.params as { member: Member })?.member;
          return (
            <RenewMemberScreen
              member={member}
              onBack={() => props.navigation.goBack()}
              onLogout={onLogout}
              onViewMember={() => props.navigation.goBack()}
              onComplete={() => {}}
            />
          );
        }}
      </RenewalsStack.Screen>
    </RenewalsStack.Navigator>
  );
}

function PaymentsStackScreen({ onLogout }: { onLogout: () => void }) {
  return (
    <PaymentsStack.Navigator screenOptions={{ headerShown: false }}>
      <PaymentsStack.Screen name="PaymentsHome">
        {() => <PaymentsScreen onLogout={onLogout} />}
      </PaymentsStack.Screen>
    </PaymentsStack.Navigator>
  );
}

function MoreStackScreen({ onLogout }: { onLogout: () => void }) {
  return (
    <MoreStack.Navigator screenOptions={{ headerShown: false }}>
      <MoreStack.Screen name="MoreHome">
        {() => <SettingsScreen onLogout={onLogout} />}
      </MoreStack.Screen>
    </MoreStack.Navigator>
  );
}

// ─── Main App ────────────────────────────────────────────────────────

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);

  useEffect(() => {
    async function bootstrap() {
      const session = await restoreSession();
      setIsAuthenticated(!!session);
      setIsReady(true);
    }
    void bootstrap();
  }, []);

  // Fetch plans for the Add Member form once authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    void apiRequest<SettingsResponse>('/api/mobile/v1/settings').then((res) => {
      if (res.ok) setPlans(res.data.plans);
    });
  }, [isAuthenticated]);

  const handleLoginSuccess = useCallback(() => {
    setIsAuthenticated(true);
  }, []);

  const handleLogout = useCallback(() => {
    setIsAuthenticated(false);
    setPlans([]);
  }, []);

  if (!isReady) {
    return (
      <View style={styles.splash}>
        <StatusBar style="dark" />
        <View style={styles.splashContent}>
          <Text style={styles.splashIcon}>📋</Text>
          <Text style={styles.splashTitle}>Renewal Desk</Text>
          <ActivityIndicator color={colors.brand} size="large" style={styles.splashLoader} />
        </View>
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <StatusBar style="dark" />
        <NavigationContainer>
          <AuthStack.Navigator screenOptions={{ headerShown: false }}>
            <AuthStack.Screen name="Login">
              {() => <LoginScreen onLogin={handleLoginSuccess} />}
            </AuthStack.Screen>
          </AuthStack.Navigator>
        </NavigationContainer>
      </>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarActiveTintColor: colors.brand,
            tabBarInactiveTintColor: colors.muted,
            tabBarLabelStyle: {
              fontSize: fontSize.xs,
              fontWeight: fontWeight.semibold,
              marginTop: -2,
            },
            tabBarStyle: {
              backgroundColor: colors.surface,
              borderTopColor: colors.border,
              borderTopWidth: 1,
              height: 60,
              paddingBottom: 6,
              paddingTop: 6,
            },
            tabBarIcon: ({ focused }) => {
              const icons = TAB_ICONS[route.name] ?? { active: '•', inactive: '•' };
              return (
                <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>
                  {focused ? icons.active : icons.inactive}
                </Text>
              );
            },
          })}
        >
          <Tab.Screen name="Dashboard">
            {() => <DashboardStackScreen onLogout={handleLogout} plans={plans} />}
          </Tab.Screen>
          <Tab.Screen name="Members">
            {() => <MembersStackScreen onLogout={handleLogout} plans={plans} />}
          </Tab.Screen>
          <Tab.Screen name="Renewals">
            {() => <RenewalsStackScreen onLogout={handleLogout} />}
          </Tab.Screen>
          <Tab.Screen name="Payments">
            {() => <PaymentsStackScreen onLogout={handleLogout} />}
          </Tab.Screen>
          <Tab.Screen name="More">
            {() => <MoreStackScreen onLogout={handleLogout} />}
          </Tab.Screen>
        </Tab.Navigator>
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
  splashContent: {
    alignItems: 'center',
  },
  splashIcon: {
    fontSize: 48,
    marginBottom: spacing.lg,
  },
  splashLoader: {
    marginTop: spacing.xxl,
  },
  splashTitle: {
    color: colors.text,
    fontSize: fontSize['5xl'],
    fontWeight: fontWeight.extrabold,
    letterSpacing: -0.5,
  },
});

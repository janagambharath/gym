import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AddMemberScreen } from './src/screens/AddMemberScreen';
import { BotConversationDetailScreen } from './src/screens/BotConversationDetailScreen';
import { BotConversationsScreen } from './src/screens/BotConversationsScreen';
import { BotLeadDetailScreen } from './src/screens/BotLeadDetailScreen';
import { BotLeadsScreen } from './src/screens/BotLeadsScreen';
import { BotOverviewScreen } from './src/screens/BotOverviewScreen';
import { BotSetupScreen } from './src/screens/BotSetupScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { BotTestScreen } from './src/screens/BotTestScreen';
import { EditMemberScreen } from './src/screens/EditMemberScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { MemberDetailScreen } from './src/screens/MemberDetailScreen';
import { MembersScreen } from './src/screens/MembersScreen';
import { PaymentDetailScreen } from './src/screens/PaymentDetailScreen';
import { PaymentsScreen } from './src/screens/PaymentsScreen';
import { PlansScreen } from './src/screens/PlansScreen';
import { RecordPaymentScreen } from './src/screens/RecordPaymentScreen';
import { RenewalsScreen } from './src/screens/RenewalsScreen';
import { RenewMemberScreen } from './src/screens/RenewMemberScreen';
import { ReportsScreen } from './src/screens/ReportsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { StaffScreen } from './src/screens/StaffScreen';
import { WhatsAppScreen } from './src/screens/WhatsAppScreen';
import { apiRequest, restoreSession } from './src/services/apiClient';
import { Icon, TabIcon } from './src/theme/icons';
import { colors, fontSize, fontWeight, spacing } from './src/theme/tokens';
import type { BotConversation, Member, Plan, SettingsResponse } from './src/types';

// ─── Navigation Types ────────────────────────────────────────────────

type DashboardStackParamList = {
  DashboardHome: undefined;
  MemberDetail: { member: Member };
  RenewMember: { member: Member };
  AddMember: undefined;
  EditMember: { memberId: number };
  RecordPayment: { memberId?: number };
  WhatsApp: undefined;
};

type MembersStackParamList = {
  MembersList: undefined;
  MemberDetail: { member: Member };
  RenewMember: { member: Member };
  AddMember: undefined;
  EditMember: { memberId: number };
  RecordPayment: { memberId?: number };
};

type RenewalsStackParamList = {
  RenewalsHome: undefined;
  MemberDetail: { member: Member };
  RenewMember: { member: Member };
  EditMember: { memberId: number };
  RecordPayment: { memberId?: number };
};

type PaymentsStackParamList = {
  PaymentsHome: undefined;
  PaymentDetail: { paymentId: number };
  RecordPayment: { memberId?: number };
};

type MoreStackParamList = {
  MoreHome: undefined;
  WhatsApp: undefined;
  BotOverview: undefined;
  BotConversations: undefined;
  BotConversationDetail: { conversation: BotConversation };
  BotLeads: undefined;
  BotLeadDetail: { leadId: number };
  BotSetup: undefined;
  BotTest: undefined;
  Plans: undefined;
  Staff: undefined;
  Reports: undefined;
};

type AuthStackParamList = {
  Login: undefined;
};

// ─── Navigators ──────────────────────────────────────────────────────

const Tab = createBottomTabNavigator();
const DashboardStackNav = createNativeStackNavigator<DashboardStackParamList>();
const MembersStackNav = createNativeStackNavigator<MembersStackParamList>();
const RenewalsStackNav = createNativeStackNavigator<RenewalsStackParamList>();
const PaymentsStackNav = createNativeStackNavigator<PaymentsStackParamList>();
const MoreStackNav = createNativeStackNavigator<MoreStackParamList>();
const AuthStackNav = createNativeStackNavigator<AuthStackParamList>();

function useRefreshToken() {
  const [refreshToken, setRefreshToken] = useState(0);
  const refresh = useCallback(() => {
    setRefreshToken((token) => token + 1);
  }, []);

  return { refresh, refreshToken };
}

// ─── Stack Screens ───────────────────────────────────────────────────

function DashboardStackScreen({
  onLogout,
  plans,
  onNavigateMembers,
  onNavigatePayments,
  onNavigateRenewals,
  onNavigateSettings,
}: {
  onLogout: () => void;
  plans: Plan[];
  onNavigateMembers: () => void;
  onNavigatePayments: () => void;
  onNavigateRenewals: () => void;
  onNavigateSettings: () => void;
}) {
  const { refresh, refreshToken } = useRefreshToken();

  return (
    <DashboardStackNav.Navigator screenOptions={{ headerShown: false }}>
      <DashboardStackNav.Screen name="DashboardHome">
        {(props) => (
          <DashboardScreen
            onLogout={onLogout}
            onNavigateMembers={onNavigateMembers}
            onNavigatePayments={onNavigatePayments}
            onNavigateRenewals={onNavigateRenewals}
            onNavigateSettings={onNavigateSettings}
            onNavigateMemberDetail={(member) =>
              props.navigation.navigate('MemberDetail', { member })
            }
            onNavigateAddMember={() => props.navigation.navigate('AddMember')}
            onNavigateRecordPayment={() => props.navigation.navigate('RecordPayment', {})}
            onNavigateWhatsApp={() => props.navigation.navigate('WhatsApp')}
            refreshToken={refreshToken}
          />
        )}
      </DashboardStackNav.Screen>
      <DashboardStackNav.Screen name="MemberDetail">
        {(props) => {
          const member = (props.route.params as { member: Member })?.member;
          return (
            <MemberDetailScreen
              member={member}
              onBack={() => props.navigation.goBack()}
              onLogout={onLogout}
              onRenew={(m) => props.navigation.navigate('RenewMember', { member: m })}
              onEdit={(memberId) => props.navigation.navigate('EditMember', { memberId })}
              onRecordPayment={(memberId) => props.navigation.navigate('RecordPayment', { memberId })}
              onMemberUpdated={refresh}
              refreshToken={refreshToken}
            />
          );
        }}
      </DashboardStackNav.Screen>
      <DashboardStackNav.Screen name="EditMember">
        {(props) => {
          const memberId = (props.route.params as { memberId: number })?.memberId;
          return (
            <EditMemberScreen
              memberId={memberId}
              onBack={() => props.navigation.goBack()}
              onSaved={() => refresh()}
            />
          );
        }}
      </DashboardStackNav.Screen>
      <DashboardStackNav.Screen name="RenewMember">
        {(props) => {
          const member = (props.route.params as { member: Member })?.member;
          return (
            <RenewMemberScreen
              member={member}
              onBack={() => props.navigation.goBack()}
              onLogout={onLogout}
              onViewMember={(updatedMember) =>
                props.navigation.navigate('MemberDetail', { member: updatedMember })
              }
              onComplete={() => refresh()}
            />
          );
        }}
      </DashboardStackNav.Screen>
      <DashboardStackNav.Screen name="AddMember">
        {(props) => (
          <AddMemberScreen
            onBack={() => props.navigation.goBack()}
            onLogout={onLogout}
            plans={plans}
            onMemberCreated={(member) => {
              refresh();
              props.navigation.replace('MemberDetail', { member });
            }}
          />
        )}
      </DashboardStackNav.Screen>
      <DashboardStackNav.Screen name="RecordPayment">
        {(props) => {
          const memberId = (props.route.params as { memberId?: number })?.memberId;
          return (
            <RecordPaymentScreen
              onBack={() => props.navigation.goBack()}
              preselectedMemberId={memberId}
              onCreated={() => refresh()}
            />
          );
        }}
      </DashboardStackNav.Screen>
      <DashboardStackNav.Screen name="WhatsApp">
        {(props) => (
          <WhatsAppScreen onBack={() => props.navigation.goBack()} />
        )}
      </DashboardStackNav.Screen>
    </DashboardStackNav.Navigator>
  );
}

function MembersStackScreen({ onLogout, plans }: { onLogout: () => void; plans: Plan[] }) {
  const { refresh, refreshToken } = useRefreshToken();

  return (
    <MembersStackNav.Navigator screenOptions={{ headerShown: false }}>
      <MembersStackNav.Screen name="MembersList">
        {(props) => (
          <MembersScreen
            onLogout={onLogout}
            onSelectMember={(member) =>
              props.navigation.navigate('MemberDetail', { member })
            }
            onAddMember={() => props.navigation.navigate('AddMember')}
            refreshToken={refreshToken}
          />
        )}
      </MembersStackNav.Screen>
      <MembersStackNav.Screen name="MemberDetail">
        {(props) => {
          const member = (props.route.params as { member: Member })?.member;
          return (
            <MemberDetailScreen
              member={member}
              onBack={() => props.navigation.goBack()}
              onLogout={onLogout}
              onRenew={(m) => props.navigation.navigate('RenewMember', { member: m })}
              onEdit={(memberId) => props.navigation.navigate('EditMember', { memberId })}
              onRecordPayment={(memberId) => props.navigation.navigate('RecordPayment', { memberId })}
              onMemberUpdated={refresh}
              refreshToken={refreshToken}
            />
          );
        }}
      </MembersStackNav.Screen>
      <MembersStackNav.Screen name="EditMember">
        {(props) => {
          const memberId = (props.route.params as { memberId: number })?.memberId;
          return (
            <EditMemberScreen
              memberId={memberId}
              onBack={() => props.navigation.goBack()}
              onSaved={() => refresh()}
            />
          );
        }}
      </MembersStackNav.Screen>
      <MembersStackNav.Screen name="RenewMember">
        {(props) => {
          const member = (props.route.params as { member: Member })?.member;
          return (
            <RenewMemberScreen
              member={member}
              onBack={() => props.navigation.goBack()}
              onLogout={onLogout}
              onViewMember={(updatedMember) =>
                props.navigation.navigate('MemberDetail', { member: updatedMember })
              }
              onComplete={() => refresh()}
            />
          );
        }}
      </MembersStackNav.Screen>
      <MembersStackNav.Screen name="AddMember">
        {(props) => (
          <AddMemberScreen
            onBack={() => props.navigation.goBack()}
            onLogout={onLogout}
            plans={plans}
            onMemberCreated={(member) => {
              refresh();
              props.navigation.replace('MemberDetail', { member });
            }}
          />
        )}
      </MembersStackNav.Screen>
      <MembersStackNav.Screen name="RecordPayment">
        {(props) => {
          const memberId = (props.route.params as { memberId?: number })?.memberId;
          return (
            <RecordPaymentScreen
              onBack={() => props.navigation.goBack()}
              preselectedMemberId={memberId}
              onCreated={() => refresh()}
            />
          );
        }}
      </MembersStackNav.Screen>
    </MembersStackNav.Navigator>
  );
}

function RenewalsStackScreen({ onLogout }: { onLogout: () => void }) {
  const { refresh, refreshToken } = useRefreshToken();

  return (
    <RenewalsStackNav.Navigator screenOptions={{ headerShown: false }}>
      <RenewalsStackNav.Screen name="RenewalsHome">
        {(props) => (
          <RenewalsScreen
            onLogout={onLogout}
            onSelectMember={(member) =>
              props.navigation.navigate('MemberDetail', { member })
            }
            onRenew={(member) =>
              props.navigation.navigate('RenewMember', { member })
            }
            refreshToken={refreshToken}
          />
        )}
      </RenewalsStackNav.Screen>
      <RenewalsStackNav.Screen name="MemberDetail">
        {(props) => {
          const member = (props.route.params as { member: Member })?.member;
          return (
            <MemberDetailScreen
              member={member}
              onBack={() => props.navigation.goBack()}
              onLogout={onLogout}
              onRenew={(m) => props.navigation.navigate('RenewMember', { member: m })}
              onEdit={(memberId) => props.navigation.navigate('EditMember', { memberId })}
              onRecordPayment={(memberId) => props.navigation.navigate('RecordPayment', { memberId })}
              onMemberUpdated={refresh}
              refreshToken={refreshToken}
            />
          );
        }}
      </RenewalsStackNav.Screen>
      <RenewalsStackNav.Screen name="EditMember">
        {(props) => {
          const memberId = (props.route.params as { memberId: number })?.memberId;
          return (
            <EditMemberScreen
              memberId={memberId}
              onBack={() => props.navigation.goBack()}
              onSaved={() => refresh()}
            />
          );
        }}
      </RenewalsStackNav.Screen>
      <RenewalsStackNav.Screen name="RenewMember">
        {(props) => {
          const member = (props.route.params as { member: Member })?.member;
          return (
            <RenewMemberScreen
              member={member}
              onBack={() => props.navigation.goBack()}
              onLogout={onLogout}
              onViewMember={(updatedMember) =>
                props.navigation.navigate('MemberDetail', { member: updatedMember })
              }
              onComplete={() => refresh()}
            />
          );
        }}
      </RenewalsStackNav.Screen>
      <RenewalsStackNav.Screen name="RecordPayment">
        {(props) => {
          const memberId = (props.route.params as { memberId?: number })?.memberId;
          return (
            <RecordPaymentScreen
              onBack={() => props.navigation.goBack()}
              preselectedMemberId={memberId}
              onCreated={() => refresh()}
            />
          );
        }}
      </RenewalsStackNav.Screen>
    </RenewalsStackNav.Navigator>
  );
}

function PaymentsStackScreen({ onLogout }: { onLogout: () => void }) {
  const { refresh, refreshToken } = useRefreshToken();

  return (
    <PaymentsStackNav.Navigator screenOptions={{ headerShown: false }}>
      <PaymentsStackNav.Screen name="PaymentsHome">
        {(props) => (
          <PaymentsScreen
            onLogout={onLogout}
            onSelectPayment={(paymentId) => props.navigation.navigate('PaymentDetail', { paymentId })}
            onRecordPayment={() => props.navigation.navigate('RecordPayment', {})}
            refreshToken={refreshToken}
          />
        )}
      </PaymentsStackNav.Screen>
      <PaymentsStackNav.Screen name="PaymentDetail">
        {(props) => {
          const paymentId = (props.route.params as { paymentId: number })?.paymentId;
          return (
            <PaymentDetailScreen
              paymentId={paymentId}
              onBack={() => props.navigation.goBack()}
            />
          );
        }}
      </PaymentsStackNav.Screen>
      <PaymentsStackNav.Screen name="RecordPayment">
        {(props) => {
          const memberId = (props.route.params as { memberId?: number })?.memberId;
          return (
            <RecordPaymentScreen
              onBack={() => props.navigation.goBack()}
              preselectedMemberId={memberId}
              onCreated={() => refresh()}
            />
          );
        }}
      </PaymentsStackNav.Screen>
    </PaymentsStackNav.Navigator>
  );
}

function MoreStackScreen({ onLogout }: { onLogout: () => void }) {
  return (
    <MoreStackNav.Navigator screenOptions={{ headerShown: false }}>
      <MoreStackNav.Screen name="MoreHome">
        {(props) => (
          <SettingsScreen
            onLogout={onLogout}
            onNavigateWhatsApp={() => props.navigation.navigate('WhatsApp')}
            onNavigateBot={() => props.navigation.navigate('BotOverview')}
            onNavigateBotTest={() => props.navigation.navigate('BotTest')}
            onNavigatePlans={() => props.navigation.navigate('Plans')}
            onNavigateStaff={() => props.navigation.navigate('Staff')}
            onNavigateReports={() => props.navigation.navigate('Reports')}
          />
        )}
      </MoreStackNav.Screen>
      <MoreStackNav.Screen name="WhatsApp">
        {(props) => <WhatsAppScreen onBack={() => props.navigation.goBack()} />}
      </MoreStackNav.Screen>
      <MoreStackNav.Screen name="BotOverview">
        {(props) => (
          <BotOverviewScreen
            onBack={() => props.navigation.goBack()}
            onLogout={onLogout}
            onOpenConversations={() => props.navigation.navigate('BotConversations')}
            onOpenLeads={() => props.navigation.navigate('BotLeads')}
            onOpenSetup={() => props.navigation.navigate('BotSetup')}
          />
        )}
      </MoreStackNav.Screen>
      <MoreStackNav.Screen name="BotConversations">
        {(props) => (
          <BotConversationsScreen
            onBack={() => props.navigation.goBack()}
            onLogout={onLogout}
            onSelectConversation={(conversation) => props.navigation.navigate('BotConversationDetail', { conversation })}
          />
        )}
      </MoreStackNav.Screen>
      <MoreStackNav.Screen name="BotConversationDetail">
        {(props) => (
          <BotConversationDetailScreen
            conversation={props.route.params.conversation}
            onBack={() => props.navigation.goBack()}
            onLogout={onLogout}
            onOpenLead={(lead) => props.navigation.navigate('BotLeadDetail', { leadId: lead.id })}
          />
        )}
      </MoreStackNav.Screen>
      <MoreStackNav.Screen name="BotLeads">
        {(props) => (
          <BotLeadsScreen
            onBack={() => props.navigation.goBack()}
            onLogout={onLogout}
            onSelectLead={(lead) => props.navigation.navigate('BotLeadDetail', { leadId: lead.id })}
          />
        )}
      </MoreStackNav.Screen>
      <MoreStackNav.Screen name="BotLeadDetail">
        {(props) => (
          <BotLeadDetailScreen
            leadId={props.route.params.leadId}
            onBack={() => props.navigation.goBack()}
            onLogout={onLogout}
          />
        )}
      </MoreStackNav.Screen>
      <MoreStackNav.Screen name="BotSetup">
        {(props) => <BotSetupScreen onBack={() => props.navigation.goBack()} onLogout={onLogout} />}
      </MoreStackNav.Screen>
      <MoreStackNav.Screen name="BotTest">
        {(props) => <BotTestScreen onBack={() => props.navigation.goBack()} />}
      </MoreStackNav.Screen>
      <MoreStackNav.Screen name="Plans">
        {(props) => <PlansScreen onBack={() => props.navigation.goBack()} />}
      </MoreStackNav.Screen>
      <MoreStackNav.Screen name="Staff">
        {(props) => <StaffScreen onBack={() => props.navigation.goBack()} />}
      </MoreStackNav.Screen>
      <MoreStackNav.Screen name="Reports">
        {(props) => <ReportsScreen onBack={() => props.navigation.goBack()} />}
      </MoreStackNav.Screen>
    </MoreStackNav.Navigator>
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

  // Fetch plans once authenticated
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
          <Icon name="fitness" size={48} color={colors.brand} />
          <Text style={styles.splashTitle}>Renewal Desk</Text>
          <ActivityIndicator color={colors.brand} size="large" style={styles.splashLoader} />
        </View>
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <NavigationContainer>
          <AuthStackNav.Navigator screenOptions={{ headerShown: false }}>
            <AuthStackNav.Screen name="Login">
              {() => <LoginScreen onLogin={handleLoginSuccess} />}
            </AuthStackNav.Screen>
          </AuthStackNav.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
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
              height: Platform.OS === 'ios' ? 84 : 64,
              paddingBottom: Platform.OS === 'ios' ? 24 : 8,
              paddingTop: 8,
            },
            tabBarIcon: ({ focused, color }) => {
              const iconMap: Record<string, 'dashboard' | 'members' | 'renewals' | 'payments' | 'more'> = {
                Dashboard: 'dashboard',
                Members: 'members',
                Renewals: 'renewals',
                Payments: 'payments',
                More: 'more',
              };
              const iconName = iconMap[route.name] ?? 'more';
              return <TabIcon name={iconName} focused={focused} color={color} size={22} />;
            },
          })}
        >
          <Tab.Screen name="Dashboard">
            {(props) => (
              <DashboardStackScreen
                onLogout={handleLogout}
                plans={plans}
                onNavigateMembers={() => props.navigation.navigate('Members')}
                onNavigatePayments={() => props.navigation.navigate('Payments')}
                onNavigateRenewals={() => props.navigation.navigate('Renewals')}
                onNavigateSettings={() => props.navigation.navigate('More')}
              />
            )}
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
    </SafeAreaProvider>
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
    gap: spacing.lg,
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

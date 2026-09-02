import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

export const navigationRef = createNavigationContainerRef<any>();
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from './src/components/ErrorBoundary';
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
import { ImportMembersScreen } from './src/screens/ImportMembersScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { MemberDetailScreen } from './src/screens/MemberDetailScreen';
import { MemberImportScreen } from './src/screens/MemberImportScreen';
import { MembersScreen } from './src/screens/MembersScreen';
import { MemberScanReviewScreen } from './src/screens/MemberScanReviewScreen';
import { MemberScanScreen } from './src/screens/MemberScanScreen';
import * as Notifications from 'expo-notifications';
import { NotificationsScreen } from './src/screens/NotificationsScreen';
import { PaymentDetailScreen } from './src/screens/PaymentDetailScreen';
import { PaymentsScreen } from './src/screens/PaymentsScreen';
import { PlansScreen } from './src/screens/PlansScreen';
import { RecordPaymentScreen } from './src/screens/RecordPaymentScreen';
import { RenewalsScreen } from './src/screens/RenewalsScreen';
import { RenewMemberScreen } from './src/screens/RenewMemberScreen';
import { ReportsScreen } from './src/screens/ReportsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { SignupScreen } from './src/screens/SignupScreen';
import { StaffScreen } from './src/screens/StaffScreen';
import { SubscriptionScreen } from './src/screens/SubscriptionScreen';
import { WhatsAppScreen } from './src/screens/WhatsAppScreen';
import { apiRequest, restoreSession, type ScanDocumentResult } from './src/services/apiClient';
import { registerForPushNotificationsAsync, unregisterPushNotificationsAsync } from './src/services/notificationService';
import { Icon, TabIcon } from './src/theme/icons';
import { colors, fontSize, fontWeight, spacing } from './src/theme/tokens';
import type { BotConversation, Member, Plan, SettingsResponse } from './src/types';

// ─── Navigation Types ────────────────────────────────────────────────

type DashboardStackParamList = {
  DashboardHome: undefined;
  MemberDetail: { member: Member };
  RenewMember: { member: Member };
  AddMember: undefined;
  ImportMembers: undefined;
  MemberImport: undefined;
  MemberScan: undefined;
  MemberScanReview: { scanResult: ScanDocumentResult };
  EditMember: { memberId: number };
  RecordPayment: { memberId?: number };
  WhatsApp: undefined;
  BotOverview: undefined;
  BotConversations: undefined;
  BotConversationDetail: { conversation: BotConversation };
  BotLeads: undefined;
  BotLeadDetail: { leadId: number };
  Notifications: undefined;
  Plans: undefined;
};

type MembersStackParamList = {
  MembersList: undefined;
  MemberDetail: { member: Member };
  RenewMember: { member: Member };
  AddMember: undefined;
  ImportMembers: undefined;
  MemberImport: undefined;
  MemberScan: undefined;
  MemberScanReview: { scanResult: ScanDocumentResult };
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
  Subscription: undefined;
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
  Signup: undefined;
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
            onNavigatePlans={() => props.navigation.navigate('Plans')}
            onNavigateMemberDetail={(member) =>
              props.navigation.navigate('MemberDetail', { member })
            }
            onNavigateAddMember={() => props.navigation.navigate('AddMember')}
            onNavigateImportMembers={() => props.navigation.navigate('ImportMembers')}
            onNavigateRecordPayment={() => props.navigation.navigate('RecordPayment', {})}
            onNavigateWhatsApp={() => props.navigation.navigate('WhatsApp')}
            onNavigateBotOverview={() => props.navigation.navigate('BotOverview')}
            onNavigateBotConversations={() => props.navigation.navigate('BotConversations')}
            onNavigateBotLeads={() => props.navigation.navigate('BotLeads')}
            onNavigateConversationDetail={(conversation) =>
              props.navigation.navigate('BotConversationDetail', { conversation })
            }
            onNavigateLeadDetail={(leadId) =>
              props.navigation.navigate('BotLeadDetail', { leadId })
            }
            onNavigateNotifications={() => props.navigation.navigate('Notifications')}
            refreshToken={refreshToken}
          />
        )}
      </DashboardStackNav.Screen>
      <DashboardStackNav.Screen name="ImportMembers">
        {(props) => (
          <ImportMembersScreen
            onBack={() => props.navigation.goBack()}
            onNavigateCSV={() => props.navigation.navigate('MemberImport')}
            onNavigateScan={() => props.navigation.navigate('MemberScan')}
            onNavigateManual={() => props.navigation.navigate('AddMember')}
          />
        )}
      </DashboardStackNav.Screen>
      <DashboardStackNav.Screen name="MemberImport">
        {(props) => (
          <MemberImportScreen
            onBack={() => props.navigation.goBack()}
            onComplete={() => refresh()}
          />
        )}
      </DashboardStackNav.Screen>
      <DashboardStackNav.Screen name="MemberScan">
        {(props) => (
          <MemberScanScreen
            onBack={() => props.navigation.goBack()}
            onScanComplete={(scanResult) =>
              props.navigation.navigate('MemberScanReview', { scanResult })
            }
            onNavigateCSV={() => props.navigation.replace('MemberImport')}
            onNavigateManual={() => props.navigation.replace('AddMember')}
          />
        )}
      </DashboardStackNav.Screen>
      <DashboardStackNav.Screen name="MemberScanReview">
        {(props) => (
          <MemberScanReviewScreen
            scanResult={props.route.params.scanResult}
            onBack={() => props.navigation.goBack()}
            onImportComplete={() => refresh()}
            onViewMembers={() => {
              refresh();
              onNavigateMembers();
            }}
            onViewRenewals={() => {
              refresh();
              onNavigateRenewals();
            }}
          />
        )}
      </DashboardStackNav.Screen>
      <DashboardStackNav.Screen name="Notifications">
        {(props) => (
          <NotificationsScreen
            onBack={() => props.navigation.goBack()}
            onNavigateScreen={(screen, data) => {
              if (screen === 'BotConversationDetail' && data?.conversation_id) {
                props.navigation.navigate('BotConversationDetail', {
                  conversation: {
                    id: data.conversation_id,
                    phone: data.phone ?? '',
                    customer_name: data.customer_name ?? '',
                    handover_status: 'human_requested',
                    state: 'active',
                  } as any,
                });
              } else if (screen === 'BotLeadDetail' && data?.lead_id) {
                props.navigation.navigate('BotLeadDetail', { leadId: data.lead_id });
              } else if (screen === 'PaymentDetail' && data?.payment_id) {
                props.navigation.navigate('PaymentDetail', { paymentId: data.payment_id });
              } else if (screen === 'RenewalsHome') {
                onNavigateRenewals();
              }
            }}
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
      <DashboardStackNav.Screen name="BotOverview">
        {(props) => (
          <BotOverviewScreen
            onBack={() => props.navigation.goBack()}
            onLogout={onLogout}
            onOpenConversations={() => props.navigation.navigate('BotConversations')}
            onOpenLeads={() => props.navigation.navigate('BotLeads')}
            onOpenSetup={() => {}}
          />
        )}
      </DashboardStackNav.Screen>
      <DashboardStackNav.Screen name="BotConversations">
        {(props) => (
          <BotConversationsScreen
            onBack={() => props.navigation.goBack()}
            onLogout={onLogout}
            onSelectConversation={(conversation) =>
              props.navigation.navigate('BotConversationDetail', { conversation })
            }
          />
        )}
      </DashboardStackNav.Screen>
      <DashboardStackNav.Screen name="BotConversationDetail">
        {(props) => (
          <BotConversationDetailScreen
            conversation={props.route.params.conversation}
            onBack={() => props.navigation.goBack()}
            onLogout={onLogout}
          />
        )}
      </DashboardStackNav.Screen>
      <DashboardStackNav.Screen name="BotLeads">
        {(props) => (
          <BotLeadsScreen
            onBack={() => props.navigation.goBack()}
            onLogout={onLogout}
            onSelectLead={(lead) =>
              props.navigation.navigate('BotLeadDetail', { leadId: lead.id })
            }
          />
        )}
      </DashboardStackNav.Screen>
      <DashboardStackNav.Screen name="BotLeadDetail">
        {(props) => (
          <BotLeadDetailScreen
            leadId={props.route.params.leadId}
            onBack={() => props.navigation.goBack()}
            onLogout={onLogout}
          />
        )}
      </DashboardStackNav.Screen>
      <DashboardStackNav.Screen name="Plans">
        {(props) => <PlansScreen onBack={() => props.navigation.goBack()} />}
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
      <MembersStackNav.Screen name="ImportMembers">
        {(props) => (
          <ImportMembersScreen
            onBack={() => props.navigation.goBack()}
            onNavigateCSV={() => props.navigation.navigate('MemberImport')}
            onNavigateScan={() => props.navigation.navigate('MemberScan')}
            onNavigateManual={() => props.navigation.navigate('AddMember')}
          />
        )}
      </MembersStackNav.Screen>
      <MembersStackNav.Screen name="MemberImport">
        {(props) => (
          <MemberImportScreen
            onBack={() => props.navigation.goBack()}
            onComplete={() => refresh()}
          />
        )}
      </MembersStackNav.Screen>
      <MembersStackNav.Screen name="MemberScan">
        {(props) => (
          <MemberScanScreen
            onBack={() => props.navigation.goBack()}
            onScanComplete={(scanResult) =>
              props.navigation.navigate('MemberScanReview', { scanResult })
            }
            onNavigateCSV={() => props.navigation.replace('MemberImport')}
            onNavigateManual={() => props.navigation.replace('AddMember')}
          />
        )}
      </MembersStackNav.Screen>
      <MembersStackNav.Screen name="MemberScanReview">
        {(props) => (
          <MemberScanReviewScreen
            scanResult={props.route.params.scanResult}
            onBack={() => props.navigation.goBack()}
            onImportComplete={() => refresh()}
            onViewMembers={() => {
              refresh();
              props.navigation.navigate('MembersList');
            }}
            onViewRenewals={() => {
              refresh();
              props.navigation.navigate('MembersList');
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
            onNavigateSubscription={() => props.navigation.navigate('Subscription')}
            onNavigateWhatsApp={() => props.navigation.navigate('WhatsApp')}
            onNavigateBot={() => props.navigation.navigate('BotOverview')}
            onNavigateBotTest={() => props.navigation.navigate('BotTest')}
            onNavigatePlans={() => props.navigation.navigate('Plans')}
            onNavigateStaff={() => props.navigation.navigate('Staff')}
            onNavigateReports={() => props.navigation.navigate('Reports')}
          />
        )}
      </MoreStackNav.Screen>
      <MoreStackNav.Screen name="Subscription">
        {(props) => <SubscriptionScreen onBack={() => props.navigation.goBack()} />}
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

  // Fetch plans & register push notifications once authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    void apiRequest<SettingsResponse>('/api/mobile/v1/settings').then((res) => {
      if (res.ok) setPlans(res.data.plans);
    });

    // Register device for native push notifications
    void registerForPushNotificationsAsync();

    // Listen to push notification tap responses
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const payload = response.notification.request.content.data as any;
      if (navigationRef.isReady()) {
        if (payload?.screen === 'BotConversationDetail' && payload?.conversation_id) {
          navigationRef.navigate('Dashboard', {
            screen: 'BotConversationDetail',
            params: {
              conversation: {
                id: payload.conversation_id,
                phone: payload.phone ?? '',
                customer_name: payload.customer_name ?? '',
                handover_status: 'human_requested',
                state: 'active',
              },
            },
          });
        } else if (payload?.screen === 'BotLeadDetail' && payload?.lead_id) {
          navigationRef.navigate('Dashboard', {
            screen: 'BotLeadDetail',
            params: { leadId: payload.lead_id },
          });
        } else if (payload?.screen === 'PaymentDetail' && payload?.payment_id) {
          navigationRef.navigate('Payments', {
            screen: 'PaymentDetail',
            params: { paymentId: payload.payment_id },
          });
        } else if (payload?.screen === 'RenewalsHome') {
          navigationRef.navigate('Renewals');
        } else if (payload?.screen === 'Notifications') {
          navigationRef.navigate('Dashboard', { screen: 'Notifications' });
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [isAuthenticated]);

  const handleLoginSuccess = useCallback(() => {
    setIsAuthenticated(true);
  }, []);

  const handleLogout = useCallback(() => {
    void unregisterPushNotificationsAsync();
    setIsAuthenticated(false);
    setPlans([]);
  }, []);

  if (!isReady) {
    return (
      <View style={styles.splash}>
        <StatusBar style="dark" />
        <View style={styles.splashContent}>
          <Image
            source={require('./assets/logo.png')}
            style={styles.splashLogo}
            resizeMode="contain"
          />
          <Text style={styles.splashTitle}>Renewal Desk</Text>
          <ActivityIndicator color={colors.brand} size="large" style={styles.splashLoader} />
        </View>
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <ErrorBoundary>
        <SafeAreaProvider>
          <StatusBar style="dark" />
          <NavigationContainer ref={navigationRef}>
            <AuthStackNav.Navigator screenOptions={{ headerShown: false }}>
              <AuthStackNav.Screen name="Login">
                {(props) => (
                  <LoginScreen
                    onLogin={handleLoginSuccess}
                    onNavigateSignup={() => props.navigation.navigate('Signup')}
                  />
                )}
              </AuthStackNav.Screen>
              <AuthStackNav.Screen name="Signup">
                {(props) => (
                  <SignupScreen
                    onSignupSuccess={handleLoginSuccess}
                    onNavigateLogin={() => props.navigation.navigate('Login')}
                  />
                )}
              </AuthStackNav.Screen>
            </AuthStackNav.Navigator>
          </NavigationContainer>
        </SafeAreaProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <NavigationContainer ref={navigationRef}>
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
    </ErrorBoundary>
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
  splashLogo: {
    height: 72,
    width: 72,
  },
  splashTitle: {
    color: colors.text,
    fontSize: fontSize['5xl'],
    fontWeight: fontWeight.extrabold,
    letterSpacing: -0.5,
  },
});

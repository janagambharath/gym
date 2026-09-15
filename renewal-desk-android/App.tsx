import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

export const navigationRef = createNavigationContainerRef<any>();
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { AddMemberScreen } from './src/screens/AddMemberScreen';
import { BotConversationDetailScreen } from './src/screens/BotConversationDetailScreen';
import { BotConversationsScreen } from './src/screens/BotConversationsScreen';
import { BotLeadDetailScreen } from './src/screens/BotLeadDetailScreen';
import { AccessScreen } from './src/screens/AccessScreen';
import { BotLeadsScreen } from './src/screens/BotLeadsScreen';
import { BotOverviewScreen } from './src/screens/BotOverviewScreen';
import { BotSetupScreen } from './src/screens/BotSetupScreen';
import { CampaignsScreen } from './src/screens/CampaignsScreen';
import { CampaignCreateScreen } from './src/screens/CampaignCreateScreen';
import { CampaignDetailScreen } from './src/screens/CampaignDetailScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { FastRenewalScreen } from './src/screens/FastRenewalScreen';
import { InboxScreen } from './src/screens/InboxScreen';
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
import { PaymentSetupScreen } from './src/screens/PaymentSetupScreen';
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
import { MemberAccessScreen } from './src/screens/member/MemberAccessScreen';
import { MemberHomeScreen } from './src/screens/member/MemberHomeScreen';
import { MemberLoginScreen } from './src/screens/member/MemberLoginScreen';
import { MemberMembershipScreen } from './src/screens/member/MemberMembershipScreen';
import { MemberPaymentHistoryScreen } from './src/screens/member/MemberPaymentHistoryScreen';
import { MemberProfileScreen } from './src/screens/member/MemberProfileScreen';
import { MemberRenewScreen } from './src/screens/member/MemberRenewScreen';
import { clearMemberSession, loadMemberSession } from './src/services/memberApiClient';
import { apiRequest, restoreSession, type ScanDocumentResult } from './src/services/apiClient';
import { registerForPushNotificationsAsync, unregisterPushNotificationsAsync } from './src/services/notificationService';
import { Icon, TabIcon } from './src/theme/icons';
import { colors, fontSize, fontWeight, spacing } from './src/theme/tokens';
import type { BotConversation, Campaign, CampaignType, Member, Plan, SettingsResponse } from './src/types';

// ─── Navigation Types ────────────────────────────────────────────────

type FastRenewalParams = {
  paymentId: number;
  memberName: string;
  amount: string;
  planName?: string;
  paymentMethod?: string;
  paymentReference?: string;
  membershipEnd?: string;
};

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
  Campaigns: undefined;
  CampaignCreate: { initialPurpose?: CampaignType } | undefined;
  CampaignDetail: { campaign: Campaign };
  FastRenewal: FastRenewalParams;
  Inbox: undefined;
  PaymentSetup: undefined;
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
  Campaigns: undefined;
  CampaignCreate: { initialPurpose?: CampaignType } | undefined;
  CampaignDetail: { campaign: Campaign };
  FastRenewal: FastRenewalParams;
};

type PaymentsStackParamList = {
  PaymentsHome: undefined;
  PaymentDetail: { paymentId: number };
  RecordPayment: { memberId?: number };
  FastRenewal: FastRenewalParams;
};

type AccessStackParamList = {
  AccessHome: undefined;
  MemberDetail: { member: Member };
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
  Campaigns: undefined;
  CampaignCreate: { initialPurpose?: CampaignType } | undefined;
  CampaignDetail: { campaign: Campaign };
  AccessHome: undefined;
  MemberDetail: { member: Member };
  PaymentsHome: undefined;
  PaymentDetail: { paymentId: number };
  RecordPayment: { memberId?: number };
  Inbox: undefined;
  FastRenewal: FastRenewalParams;
  PaymentSetup: undefined;
};

type AuthStackParamList = {
  Login: undefined;
  Signup: undefined;
  MemberLogin: undefined;
};

type MemberHomeStackParamList = {
  MemberHomeMain: undefined;
  MemberRenew: undefined;
};

type MemberMembershipStackParamList = {
  MemberMembershipMain: undefined;
  MemberRenew: undefined;
};

// ─── Navigators ──────────────────────────────────────────────────────

const Tab = createBottomTabNavigator();
const MemberTab = createBottomTabNavigator();
const DashboardStackNav = createNativeStackNavigator<DashboardStackParamList>();
const MembersStackNav = createNativeStackNavigator<MembersStackParamList>();
const RenewalsStackNav = createNativeStackNavigator<RenewalsStackParamList>();
const PaymentsStackNav = createNativeStackNavigator<PaymentsStackParamList>();
const AccessStackNav = createNativeStackNavigator<AccessStackParamList>();
const MoreStackNav = createNativeStackNavigator<MoreStackParamList>();
const AuthStackNav = createNativeStackNavigator<AuthStackParamList>();
const MemberHomeStackNav = createNativeStackNavigator<MemberHomeStackParamList>();
const MemberMembershipStackNav = createNativeStackNavigator<MemberMembershipStackParamList>();

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
  onNavigateAccess,
}: {
  onLogout: () => void;
  plans: Plan[];
  onNavigateMembers: () => void;
  onNavigatePayments: () => void;
  onNavigateRenewals: () => void;
  onNavigateSettings: () => void;
  onNavigateAccess?: () => void;
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
            onNavigateAccess={onNavigateAccess}
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
            onNavigateCampaigns={() => props.navigation.navigate('Campaigns')}
            onNavigateInbox={() => props.navigation.navigate('Inbox')}
            onNavigatePaymentSetup={() => props.navigation.navigate('PaymentSetup')}
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
      <DashboardStackNav.Screen name="PaymentSetup">
        {(props) => <PaymentSetupScreen onBack={() => props.navigation.goBack()} />}
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
      <DashboardStackNav.Screen name="Campaigns">
        {(props) => (
          <CampaignsScreen
            onBack={() => props.navigation.goBack()}
            onCreateCampaign={(purpose) => props.navigation.navigate('CampaignCreate', { initialPurpose: purpose })}
            onSelectCampaign={(campaign) => props.navigation.navigate('CampaignDetail', { campaign })}
          />
        )}
      </DashboardStackNav.Screen>
      <DashboardStackNav.Screen name="CampaignCreate">
        {(props) => (
          <CampaignCreateScreen
            initialPurpose={props.route.params?.initialPurpose}
            onBack={() => props.navigation.goBack()}
            onCampaignCreated={() => props.navigation.navigate('Campaigns')}
          />
        )}
      </DashboardStackNav.Screen>
      <DashboardStackNav.Screen name="CampaignDetail">
        {(props) => (
          <CampaignDetailScreen
            campaign={props.route.params.campaign}
            onBack={() => props.navigation.goBack()}
          />
        )}
      </DashboardStackNav.Screen>
      <DashboardStackNav.Screen name="FastRenewal">
        {(props) => (
          <FastRenewalScreen
            paymentId={props.route.params.paymentId}
            memberName={props.route.params.memberName}
            amount={props.route.params.amount}
            planName={props.route.params.planName}
            paymentMethod={props.route.params.paymentMethod}
            paymentReference={props.route.params.paymentReference}
            membershipEnd={props.route.params.membershipEnd}
            onBack={() => props.navigation.goBack()}
            onConfirmed={() => {
              refresh();
              props.navigation.goBack();
            }}
          />
        )}
      </DashboardStackNav.Screen>
      <DashboardStackNav.Screen name="Inbox">
        {(props) => (
          <InboxScreen
            onLogout={onLogout}
            onNavigateBotConversations={() => props.navigation.navigate('BotConversations')}
            refreshToken={refreshToken}
          />
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
            onNavigateCampaigns={() => props.navigation.navigate('Campaigns')}
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
      <RenewalsStackNav.Screen name="Campaigns">
        {(props) => (
          <CampaignsScreen
            onBack={() => props.navigation.goBack()}
            onCreateCampaign={(purpose) => props.navigation.navigate('CampaignCreate', { initialPurpose: purpose })}
            onSelectCampaign={(campaign) => props.navigation.navigate('CampaignDetail', { campaign })}
          />
        )}
      </RenewalsStackNav.Screen>
      <RenewalsStackNav.Screen name="CampaignCreate">
        {(props) => (
          <CampaignCreateScreen
            initialPurpose={props.route.params?.initialPurpose}
            onBack={() => props.navigation.goBack()}
            onCampaignCreated={() => props.navigation.navigate('Campaigns')}
          />
        )}
      </RenewalsStackNav.Screen>
      <RenewalsStackNav.Screen name="CampaignDetail">
        {(props) => (
          <CampaignDetailScreen
            campaign={props.route.params.campaign}
            onBack={() => props.navigation.goBack()}
          />
        )}
      </RenewalsStackNav.Screen>
      <RenewalsStackNav.Screen name="FastRenewal">
        {(props) => (
          <FastRenewalScreen
            paymentId={props.route.params.paymentId}
            memberName={props.route.params.memberName}
            amount={props.route.params.amount}
            planName={props.route.params.planName}
            paymentMethod={props.route.params.paymentMethod}
            paymentReference={props.route.params.paymentReference}
            membershipEnd={props.route.params.membershipEnd}
            onBack={() => props.navigation.goBack()}
            onConfirmed={() => {
              refresh();
              props.navigation.goBack();
            }}
          />
        )}
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
      <PaymentsStackNav.Screen name="FastRenewal">
        {(props) => (
          <FastRenewalScreen
            paymentId={props.route.params.paymentId}
            memberName={props.route.params.memberName}
            amount={props.route.params.amount}
            planName={props.route.params.planName}
            paymentMethod={props.route.params.paymentMethod}
            paymentReference={props.route.params.paymentReference}
            membershipEnd={props.route.params.membershipEnd}
            onBack={() => props.navigation.goBack()}
            onConfirmed={() => {
              refresh();
              props.navigation.goBack();
            }}
          />
        )}
      </PaymentsStackNav.Screen>
    </PaymentsStackNav.Navigator>
  );
}

function AccessStackScreen({ onLogout }: { onLogout: () => void }) {
  const { refresh, refreshToken } = useRefreshToken();

  return (
    <AccessStackNav.Navigator screenOptions={{ headerShown: false }}>
      <AccessStackNav.Screen name="AccessHome">
        {(props) => (
          <AccessScreen
            refreshToken={refreshToken}
            onNavigateMemberDetail={(member) =>
              props.navigation.navigate('MemberDetail', { member })
            }
          />
        )}
      </AccessStackNav.Screen>
      <AccessStackNav.Screen name="MemberDetail">
        {(props) => {
          const member = (props.route.params as { member: Member })?.member;
          return (
            <MemberDetailScreen
              member={member}
              onBack={() => props.navigation.goBack()}
              onLogout={onLogout}
              onRenew={() => {}}
              onEdit={() => {}}
              onRecordPayment={() => {}}
              onMemberUpdated={refresh}
              refreshToken={refreshToken}
            />
          );
        }}
      </AccessStackNav.Screen>
    </AccessStackNav.Navigator>
  );
}

function MoreStackScreen({ onLogout }: { onLogout: () => void }) {
  const { refresh, refreshToken } = useRefreshToken();

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
            onNavigateCampaigns={() => props.navigation.navigate('Campaigns')}
            onNavigateAccess={() => props.navigation.navigate('AccessHome')}
            onNavigatePayments={() => props.navigation.navigate('PaymentsHome')}
            onNavigatePaymentSetup={() => props.navigation.navigate('PaymentSetup')}
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
      <MoreStackNav.Screen name="Campaigns">
        {(props) => (
          <CampaignsScreen
            onBack={() => props.navigation.goBack()}
            onCreateCampaign={(purpose) => props.navigation.navigate('CampaignCreate', { initialPurpose: purpose })}
            onSelectCampaign={(campaign) => props.navigation.navigate('CampaignDetail', { campaign })}
          />
        )}
      </MoreStackNav.Screen>
      <MoreStackNav.Screen name="CampaignCreate">
        {(props) => (
          <CampaignCreateScreen
            initialPurpose={props.route.params?.initialPurpose}
            onBack={() => props.navigation.goBack()}
            onCampaignCreated={() => props.navigation.navigate('Campaigns')}
          />
        )}
      </MoreStackNav.Screen>
      <MoreStackNav.Screen name="CampaignDetail">
        {(props) => (
          <CampaignDetailScreen
            campaign={props.route.params.campaign}
            onBack={() => props.navigation.goBack()}
          />
        )}
      </MoreStackNav.Screen>
      <MoreStackNav.Screen name="AccessHome">
        {(props) => <AccessScreen onBack={() => props.navigation.goBack()} onLogout={onLogout} />}
      </MoreStackNav.Screen>
      <MoreStackNav.Screen name="PaymentsHome">
        {(props) => (
          <PaymentsScreen
            onLogout={onLogout}
            onSelectPayment={(paymentId) => props.navigation.navigate('PaymentDetail', { paymentId })}
            onRecordPayment={() => props.navigation.navigate('RecordPayment', {})}
          />
        )}
      </MoreStackNav.Screen>
      <MoreStackNav.Screen name="PaymentDetail">
        {(props) => (
          <PaymentDetailScreen
            paymentId={props.route.params.paymentId}
            onBack={() => props.navigation.goBack()}
          />
        )}
      </MoreStackNav.Screen>
      <MoreStackNav.Screen name="RecordPayment">
        {(props) => (
          <RecordPaymentScreen
            onBack={() => props.navigation.goBack()}
            preselectedMemberId={props.route.params?.memberId}
          />
        )}
      </MoreStackNav.Screen>
      <MoreStackNav.Screen name="Inbox">
        {(props) => (
          <InboxScreen
            onLogout={onLogout}
            onNavigateBotConversations={() => props.navigation.navigate('BotConversations')}
            refreshToken={refreshToken}
          />
        )}
      </MoreStackNav.Screen>
      <MoreStackNav.Screen name="FastRenewal">
        {(props) => (
          <FastRenewalScreen
            paymentId={props.route.params.paymentId}
            memberName={props.route.params.memberName}
            amount={props.route.params.amount}
            planName={props.route.params.planName}
            paymentMethod={props.route.params.paymentMethod}
            paymentReference={props.route.params.paymentReference}
            membershipEnd={props.route.params.membershipEnd}
            onBack={() => props.navigation.goBack()}
            onConfirmed={() => {
              refresh();
              props.navigation.goBack();
            }}
          />
        )}
      </MoreStackNav.Screen>
      <MoreStackNav.Screen name="PaymentSetup">
        {(props) => <PaymentSetupScreen onBack={() => props.navigation.goBack()} />}
      </MoreStackNav.Screen>
    </MoreStackNav.Navigator>
  );
}

// ─── Member Stack Screens ────────────────────────────────────────────

function MemberHomeStackScreen({
  onNavigatePayments,
  onNavigateMembership,
}: {
  onNavigatePayments: () => void;
  onNavigateMembership: () => void;
}) {
  return (
    <MemberHomeStackNav.Navigator screenOptions={{ headerShown: false }}>
      <MemberHomeStackNav.Screen name="MemberHomeMain">
        {(props) => (
          <MemberHomeScreen
            onNavigateRenew={() => props.navigation.navigate('MemberRenew')}
            onNavigatePayments={onNavigatePayments}
            onNavigateMembership={onNavigateMembership}
          />
        )}
      </MemberHomeStackNav.Screen>
      <MemberHomeStackNav.Screen name="MemberRenew">
        {(props) => (
          <MemberRenewScreen
            onBack={() => props.navigation.goBack()}
            onSuccess={() => props.navigation.goBack()}
          />
        )}
      </MemberHomeStackNav.Screen>
    </MemberHomeStackNav.Navigator>
  );
}

function MemberMembershipStackScreen() {
  return (
    <MemberMembershipStackNav.Navigator screenOptions={{ headerShown: false }}>
      <MemberMembershipStackNav.Screen name="MemberMembershipMain">
        {(props) => (
          <MemberMembershipScreen
            onNavigateRenew={() => props.navigation.navigate('MemberRenew')}
          />
        )}
      </MemberMembershipStackNav.Screen>
      <MemberMembershipStackNav.Screen name="MemberRenew">
        {(props) => (
          <MemberRenewScreen
            onBack={() => props.navigation.goBack()}
            onSuccess={() => props.navigation.goBack()}
          />
        )}
      </MemberMembershipStackNav.Screen>
    </MemberMembershipStackNav.Navigator>
  );
}

function MemberTabsNavigator({ onLogout }: { onLogout: () => void }) {
  const insets = useSafeAreaInsets();

  return (
    <MemberTab.Navigator
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
          height: Platform.OS === 'ios' ? 84 : 64 + Math.max(insets.bottom, 0),
          paddingBottom: Platform.OS === 'ios' ? 24 : Math.max(insets.bottom, 8),
          paddingTop: 8,
        },
        tabBarIcon: ({ focused, color }) => {
          const iconMap: Record<string, 'dashboard' | 'members' | 'access' | 'payments' | 'more'> = {
            Home: 'dashboard',
            Membership: 'members',
            Payments: 'payments',
            Access: 'access',
            Profile: 'more',
          };
          const iconName = iconMap[route.name] ?? 'dashboard';
          return <TabIcon name={iconName} focused={focused} color={color} size={22} />;
        },
      })}
    >
      <MemberTab.Screen name="Home">
        {(props) => (
          <MemberHomeStackScreen
            onNavigatePayments={() => props.navigation.navigate('Payments')}
            onNavigateMembership={() => props.navigation.navigate('Membership')}
          />
        )}
      </MemberTab.Screen>
      <MemberTab.Screen name="Membership" component={MemberMembershipStackScreen} />
      <MemberTab.Screen name="Payments" component={MemberPaymentHistoryScreen} />
      <MemberTab.Screen name="Access" component={MemberAccessScreen} />
      <MemberTab.Screen name="Profile">
        {() => <MemberProfileScreen onLogout={onLogout} />}
      </MemberTab.Screen>
    </MemberTab.Navigator>
  );
}

// ─── Main App ────────────────────────────────────────────────────────

function AppRoot() {
  const [isReady, setIsReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authRole, setAuthRole] = useState<'owner' | 'member' | 'none'>('none');
  const [plans, setPlans] = useState<Plan[]>([]);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    let active = true;
    async function bootstrap() {
      try {
        const ownerSession = await restoreSession();
        if (active && ownerSession) {
          setAuthRole('owner');
          setIsAuthenticated(true);
        } else {
          const memberSession = await loadMemberSession();
          if (active && memberSession) {
            setAuthRole('member');
            setIsAuthenticated(true);
          } else if (active) {
            setAuthRole('none');
            setIsAuthenticated(false);
          }
        }
      } catch (err) {
        console.warn('[AppRoot] Error restoring session:', err);
        if (active) {
          setAuthRole('none');
          setIsAuthenticated(false);
        }
      } finally {
        if (active) {
          setIsReady(true);
        }
      }
    }
    void bootstrap();
    return () => {
      active = false;
    };
  }, []);

  // Fetch plans & register push notifications once authenticated as owner
  useEffect(() => {
    if (!isAuthenticated || authRole !== 'owner') return;
    void apiRequest<SettingsResponse>('/api/mobile/v1/settings').then((res) => {
      if (res.ok) setPlans(res.data.plans);
    });

    // Register device for native push notifications safely
    void registerForPushNotificationsAsync().catch((err) => {
      console.warn('[AppRoot] Push registration error:', err);
    });

    // Listen to push notification tap responses safely
    let subscription: Notifications.Subscription | undefined;
    try {
      subscription = Notifications.addNotificationResponseReceivedListener((response) => {
        try {
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
            } else if (payload?.screen === 'FastRenewal' && payload?.payment_id) {
              navigationRef.navigate('Renewals', {
                screen: 'FastRenewal',
                params: {
                  paymentId: payload.payment_id,
                  memberName: payload.member_name ?? 'Member',
                  amount: payload.amount ?? '0',
                  planName: payload.plan_name,
                  paymentMethod: payload.payment_method,
                  paymentReference: payload.payment_reference,
                  membershipEnd: payload.membership_end,
                },
              });
            } else if (payload?.screen === 'Inbox') {
              navigationRef.navigate('Dashboard', { screen: 'Inbox' });
            } else if (payload?.screen === 'Campaigns') {
              navigationRef.navigate('Dashboard', { screen: 'Campaigns' });
            }
          }
        } catch (navErr) {
          console.warn('[AppRoot] Push notification navigation failed:', navErr);
        }
      });
    } catch (listenerErr) {
      console.warn('[AppRoot] Failed to register notification response listener:', listenerErr);
    }

    return () => {
      subscription?.remove();
    };
  }, [isAuthenticated, authRole]);

  const handleOwnerLoginSuccess = useCallback(() => {
    setAuthRole('owner');
    setIsAuthenticated(true);
  }, []);

  const handleMemberLoginSuccess = useCallback(() => {
    setAuthRole('member');
    setIsAuthenticated(true);
  }, []);

  const handleOwnerLogout = useCallback(() => {
    void unregisterPushNotificationsAsync().catch(() => {});
    setAuthRole('none');
    setIsAuthenticated(false);
    setPlans([]);
  }, []);

  const handleMemberLogout = useCallback(async () => {
    await clearMemberSession();
    setAuthRole('none');
    setIsAuthenticated(false);
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

  if (!isAuthenticated || authRole === 'none') {
    return (
      <>
        <StatusBar style="dark" />
        <NavigationContainer ref={navigationRef}>
          <AuthStackNav.Navigator screenOptions={{ headerShown: false }}>
            <AuthStackNav.Screen name="Login">
              {(props) => (
                <LoginScreen
                  onLogin={handleOwnerLoginSuccess}
                  onNavigateSignup={() => props.navigation.navigate('Signup')}
                  onNavigateMemberLogin={() => props.navigation.navigate('MemberLogin')}
                />
              )}
            </AuthStackNav.Screen>
            <AuthStackNav.Screen name="MemberLogin">
              {() => (
                <MemberLoginScreen
                  onLoginSuccess={handleMemberLoginSuccess}
                  onSwitchToOwner={() => navigationRef.navigate('Login')}
                />
              )}
            </AuthStackNav.Screen>
            <AuthStackNav.Screen name="Signup">
              {(props) => (
                <SignupScreen
                  onSignupSuccess={handleOwnerLoginSuccess}
                  onNavigateLogin={() => props.navigation.navigate('Login')}
                />
              )}
            </AuthStackNav.Screen>
          </AuthStackNav.Navigator>
        </NavigationContainer>
      </>
    );
  }

  if (authRole === 'member') {
    return (
      <>
        <StatusBar style="dark" />
        <NavigationContainer ref={navigationRef}>
          <MemberTabsNavigator onLogout={handleMemberLogout} />
        </NavigationContainer>
      </>
    );
  }

  return (
    <>
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
              height: Platform.OS === 'ios' ? 84 : 64 + Math.max(insets.bottom, 0),
              paddingBottom: Platform.OS === 'ios' ? 24 : Math.max(insets.bottom, 8),
              paddingTop: 8,
            },
            tabBarIcon: ({ focused, color }) => {
              const iconMap: Record<string, 'dashboard' | 'members' | 'access' | 'renewals' | 'payments' | 'more'> = {
                Dashboard: 'dashboard',
                Members: 'members',
                Access: 'access',
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
                onLogout={handleOwnerLogout}
                plans={plans}
                onNavigateMembers={() => props.navigation.navigate('Members')}
                onNavigatePayments={() => props.navigation.navigate('Payments')}
                onNavigateRenewals={() => props.navigation.navigate('Renewals')}
                onNavigateSettings={() => props.navigation.navigate('More')}
                onNavigateAccess={() => props.navigation.navigate('Access')}
              />
            )}
          </Tab.Screen>
          <Tab.Screen name="Members">
            {() => <MembersStackScreen onLogout={handleOwnerLogout} plans={plans} />}
          </Tab.Screen>
          <Tab.Screen name="Access">
            {() => <AccessStackScreen onLogout={handleOwnerLogout} />}
          </Tab.Screen>
          <Tab.Screen name="Renewals">
            {() => <RenewalsStackScreen onLogout={handleOwnerLogout} />}
          </Tab.Screen>
          <Tab.Screen name="Payments">
            {() => <PaymentsStackScreen onLogout={handleOwnerLogout} />}
          </Tab.Screen>
          <Tab.Screen name="More">
            {() => <MoreStackScreen onLogout={handleOwnerLogout} />}
          </Tab.Screen>
        </Tab.Navigator>
      </NavigationContainer>
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AppRoot />
      </ErrorBoundary>
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

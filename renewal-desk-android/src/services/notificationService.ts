import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { apiRequest } from './apiClient';

// Configure foreground notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

let cachedPushToken: string | null = null;

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (Platform.OS === 'android') {
    // 1. Setup urgent-alerts channel (for Handover Requests)
    await Notifications.setNotificationChannelAsync('urgent-alerts', {
      name: 'Urgent Staff Handovers',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#EF4444',
      sound: 'default',
      enableVibrate: true,
    });

    // 2. Setup leads channel
    await Notifications.setNotificationChannelAsync('leads', {
      name: 'WhatsApp Leads & Inquiries',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 200],
      lightColor: '#2563EB',
      sound: 'default',
    });

    // 3. Setup payments channel
    await Notifications.setNotificationChannelAsync('payments', {
      name: 'Payments & Verifications',
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: '#10B981',
      sound: 'default',
    });

    // 4. Setup renewals channel
    await Notifications.setNotificationChannelAsync('renewals', {
      name: 'Renewals & Reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  if (!Device.isDevice) {
    return null;
  }

  // Request permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  try {
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ??
      Constants?.easConfig?.projectId ??
      '7eef8559-b676-40bc-a7e0-faa9424765db';

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    const token = tokenData.data;
    cachedPushToken = token;

    // Send token to backend
    const deviceName = Device.modelName ?? `${Device.manufacturer ?? 'Android'} Device`;
    await apiRequest('/api/mobile/v1/notifications/register-token', {
      method: 'POST',
      body: {
        push_token: token,
        device_name: deviceName,
        platform: Platform.OS,
      },
    });

    return token;
  } catch {
    return null;
  }
}

export async function unregisterPushNotificationsAsync(): Promise<void> {
  if (cachedPushToken) {
    try {
      await apiRequest('/api/mobile/v1/notifications/unregister-token', {
        method: 'POST',
        body: { push_token: cachedPushToken },
      });
      cachedPushToken = null;
    } catch {
      // Safe no-op on logout
    }
  }
}

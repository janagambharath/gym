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
  try {
    if (Platform.OS === 'android') {
      try {
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
      } catch (channelErr) {
        console.warn('Could not configure notification channels:', channelErr);
      }
    }

    if (!Device.isDevice) {
      return null;
    }

    // Request permissions
    let finalStatus: Notifications.PermissionStatus = Notifications.PermissionStatus.UNDETERMINED;
    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      finalStatus = existingStatus;
      if (existingStatus !== Notifications.PermissionStatus.GRANTED) {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
    } catch (permErr) {
      console.warn('Could not query notification permissions:', permErr);
      return null;
    }

    if (finalStatus !== Notifications.PermissionStatus.GRANTED) {
      return null;
    }

    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ??
      Constants?.easConfig?.projectId;
    if (!projectId) {
      return null;
    }

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
  } catch (err) {
    console.warn('Push notification registration failed gracefully:', err);
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

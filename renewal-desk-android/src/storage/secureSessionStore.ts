import * as SecureStore from 'expo-secure-store';

const SESSION_KEY = 'renewal-desk.mobile-session.v1';

export type MobileSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt?: string;
  tenantId: string;
  tenantName?: string;
  userId: string;
  userName?: string;
  userRole?: string;
};

function isSession(value: unknown): value is MobileSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const session = value as Record<string, unknown>;
  return (
    typeof session.accessToken === 'string' &&
    typeof session.refreshToken === 'string' &&
    typeof session.tenantId === 'string' &&
    typeof session.userId === 'string' &&
    (session.expiresAt === undefined || typeof session.expiresAt === 'string') &&
    (session.tenantName === undefined || typeof session.tenantName === 'string') &&
    (session.userName === undefined || typeof session.userName === 'string') &&
    (session.userRole === undefined || typeof session.userRole === 'string')
  );
}

export async function saveSession(session: MobileSession): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
}

export async function loadSession(): Promise<MobileSession | undefined> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return isSession(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiClient, clearToken, getToken } from '../services/apiClient';
import { Member } from '../types';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  member: Member | null;
  token: string | null;
  requestOtp: (phone: string) => Promise<{ success: boolean; challenge?: string; gym_name?: string; message?: string; error?: string }>;
  verifyOtp: (phone: string, otp: string, challenge: string) => Promise<{ success: boolean; member?: Member; error?: string }>;
  logout: () => Promise<void>;
  updateMember: (member: Member) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [member, setMember] = useState<Member | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const restoreSession = useCallback(async () => {
    setIsLoading(true);
    let savedToken: string | null = null;
    try {
      savedToken = await getToken();
      if (savedToken) {
        setToken(savedToken);
        const dash = await apiClient.getDashboard();
        setMember(dash.member);
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);
      }
    } catch (err: any) {
      // V11-M7: only a definitive session-expiry wipes the session. A
      // cold start on flaky gym Wi-Fi (timeout / 5xx / unreachable)
      // must keep the tokens — the member stays signed in and Home
      // shows its offline banner + retry instead of forcing a re-OTP.
      // apiClient already cleared the tokens on a definitive 401/403,
      // so the message check below only decides whether to also drop
      // the (possibly still-valid) local session.
      const message = err?.message || '';
      const sessionExpired =
        message.includes('session has expired') || message.includes('log in again');
      if (sessionExpired) {
        await clearToken();
        setToken(null);
        setMember(null);
        setIsAuthenticated(false);
      } else if (savedToken) {
        setToken(savedToken);
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  const requestOtp = useCallback(async (phone: string) => {
    return await apiClient.requestOtp(phone);
  }, []);

  // V12-H2: login success must NOT depend on the dashboard fetch. The
  // verify response already persisted the tokens (apiClient.verifyOtp
  // saves them before returning) and the backend consumed the challenge
  // atomically (member_api.py _consume_otp_challenge) — so a dashboard
  // blip after a successful verify used to report "Verification failed"
  // and the retry 400'd "code already used", stranding the member.
  // Success is now decided by the verify response alone; the dashboard
  // is best-effort afterwards. On a dashboard failure the member still
  // lands signed in (Home shows its offline banner + pull-to-refresh
  // retry) and the verify payload seeds a transient member record so
  // the home screen has a name/status to render until the dashboard
  // answers. days_left/is_expired are derived from the payload's own
  // membership_end (same date-only math the backend uses); the dashboard
  // overwrites them as soon as it loads.
  const verifyOtp = useCallback(async (phone: string, otp: string, challenge: string) => {
    try {
      const res = await apiClient.verifyOtp(phone, otp, challenge);
      if (res.success && res.data) {
        setToken(res.data.token);
        setIsAuthenticated(true);
        const payloadMember = res.data.member;
        let seedMember: Member | null = null;
        if (payloadMember) {
          const end = payloadMember.membership_end ? new Date(payloadMember.membership_end) : null;
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const daysLeft = end && !Number.isNaN(end.getTime())
            ? Math.round((new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime() - today.getTime()) / 86400000)
            : null;
          seedMember = {
            id: payloadMember.id,
            full_name: payloadMember.full_name,
            phone: payloadMember.phone,
            email: null,
            gender: null,
            profile_photo_url: null,
            address: null,
            joined_on: null,
            status: payloadMember.membership_status || 'active',
            membership_start: null,
            membership_end: payloadMember.membership_end || null,
            // Backend is_expired is True when membership_end is None
            // (models/member.py:109-113); a dated end is expired only
            // once it passes.
            days_left: daysLeft,
            is_expired: end === null ? true : (daysLeft !== null && daysLeft < 0),
            plan_name: payloadMember.plan_name || null,
            plan_price: null,
          };
          setMember(seedMember);
        }
        try {
          const dash = await apiClient.getDashboard();
          setMember(dash.member);
        } catch {
          // Best-effort only: the member is already signed in (seed
          // above, or Home's own dashboard fetch + offline retry).
        }
        return { success: true, member: seedMember ?? undefined };
      }
      return { success: false, error: 'Verification failed.' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Verification error' };
    }
  }, []);

  const logout = useCallback(async () => {
    // V11-M8: revoke the server session first (best-effort — the local
    // clear below is the fallback if the revocation call fails).
    await apiClient.logout();
    await clearToken();
    setToken(null);
    setMember(null);
    setIsAuthenticated(false);
  }, []);

  const updateMember = useCallback((updated: Member) => {
    setMember(updated);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        member,
        token,
        requestOtp,
        verifyOtp,
        logout,
        updateMember,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

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

  const verifyOtp = useCallback(async (phone: string, otp: string, challenge: string) => {
    try {
      const res = await apiClient.verifyOtp(phone, otp, challenge);
      if (res.success && res.data) {
        setToken(res.data.token);
        // Refresh dashboard for full member data
        const dash = await apiClient.getDashboard();
        setMember(dash.member);
        setIsAuthenticated(true);
        return { success: true, member: dash.member };
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

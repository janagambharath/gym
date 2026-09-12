import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiClient, clearToken, getToken } from '../services/apiClient';
import { Member } from '../types';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  member: Member | null;
  token: string | null;
  requestOtp: (phone: string) => Promise<{ success: boolean; challenge?: string; gym_name?: string; message?: string; is_staff?: boolean; error?: string }>;
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
    try {
      const savedToken = await getToken();
      if (savedToken) {
        setToken(savedToken);
        const dash = await apiClient.getDashboard();
        setMember(dash.member);
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);
      }
    } catch {
      await clearToken();
      setToken(null);
      setMember(null);
      setIsAuthenticated(false);
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

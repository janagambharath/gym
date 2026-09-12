import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiClient } from '../services/apiClient';
import { GymBranding } from '../types';
import { defaultBrandingTheme, resolveBrandingTheme, ResolvedBrandingTheme } from '../theme/branding';
import { useAuth } from './AuthContext';

interface BrandingContextType {
  branding: GymBranding | null;
  theme: ResolvedBrandingTheme;
  isLoading: boolean;
  refreshBranding: () => Promise<void>;
}

const BrandingContext = createContext<BrandingContextType | undefined>(undefined);

export const BrandingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const [branding, setBranding] = useState<GymBranding | null>(null);
  const [theme, setTheme] = useState<ResolvedBrandingTheme>(defaultBrandingTheme);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const refreshBranding = useCallback(async () => {
    if (!isAuthenticated) {
      setBranding(null);
      setTheme(defaultBrandingTheme);
      return;
    }
    setIsLoading(true);
    try {
      const data = await apiClient.getGymBranding();
      setBranding(data);
      setTheme(resolveBrandingTheme(data));
    } catch {
      // Keep sensible fallback theme on error
      setTheme(resolveBrandingTheme(branding));
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, branding]);

  useEffect(() => {
    if (isAuthenticated) {
      refreshBranding();
    } else {
      setBranding(null);
      setTheme(defaultBrandingTheme);
    }
  }, [isAuthenticated, refreshBranding]);

  return (
    <BrandingContext.Provider
      value={{
        branding,
        theme,
        isLoading,
        refreshBranding,
      }}
    >
      {children}
    </BrandingContext.Provider>
  );
};

export const useBranding = (): BrandingContextType => {
  const context = useContext(BrandingContext);
  if (!context) {
    throw new Error('useBranding must be used within a BrandingProvider');
  }
  return context;
};

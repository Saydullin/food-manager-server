import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { clearToken, hasToken, setToken, setUnauthorizedHandler } from './api';

interface AuthContextValue {
  isAuthenticated: boolean;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(hasToken());

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearToken();
      setIsAuthenticated(false);
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated,
      login: (token: string) => {
        setToken(token);
        setIsAuthenticated(true);
      },
      logout: () => {
        clearToken();
        setIsAuthenticated(false);
      },
    }),
    [isAuthenticated],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

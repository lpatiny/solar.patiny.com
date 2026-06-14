import { createContext, useContext } from 'react';

import type { AuthStatus } from './auth.ts';

export interface AuthContextValue {
  /** Current auth status, or `null` while the initial check is in flight. */
  status: AuthStatus | null;
  /** Logs in and updates the shared status on success. */
  login: (
    username: string,
    password: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Logs out and clears the shared status. */
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Returns the shared authentication context.
 * @returns The auth context value.
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

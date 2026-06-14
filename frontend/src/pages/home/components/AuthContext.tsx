import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';

import type { AuthStatus } from './auth.ts';
import {
  clearStoredCredentials,
  fetchAuthStatus,
  loadStoredCredentials,
  login as apiLogin,
  logout as apiLogout,
  storeCredentials,
} from './auth.ts';
import type { AuthContextValue } from './useAuth.ts';
import { AuthContext } from './useAuth.ts';

/**
 * Provides the app-wide authentication status (backed by the session cookie)
 * so the header login control and every protected widget share one state.
 * @param root0 - Component props.
 * @param root0.children - The application subtree.
 * @returns The auth provider.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function restore(): Promise<AuthStatus> {
      const current = await fetchAuthStatus();
      if (current.authenticated) return current;
      // The cookie is gone or the server-side session was cleared (e.g. a
      // backend restart). Re-establish it transparently from saved credentials.
      const stored = loadStoredCredentials();
      if (!stored) return current;
      const result = await apiLogin(stored.username, stored.password);
      if (result.ok) return { authenticated: true, username: result.username };
      clearStoredCredentials();
      return current;
    }
    restore()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        if (!cancelled) setStatus({ authenticated: false, username: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      async login(username, password) {
        const result = await apiLogin(username, password);
        if (result.ok) {
          storeCredentials({ username, password });
          setStatus({ authenticated: true, username: result.username });
          return { ok: true };
        }
        return { ok: false, error: result.error };
      },
      async logout() {
        clearStoredCredentials();
        await apiLogout();
        setStatus({ authenticated: false, username: null });
      },
    }),
    [status],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export interface AuthStatus {
  authenticated: boolean;
  username: string | null;
}

interface StoredCredentials {
  username: string;
  password: string;
}

const CREDENTIALS_KEY = 'solar-auth';

/**
 * Reads the credentials saved on the last successful login, if any. They are
 * used to transparently re-establish a session after the server-side session
 * store is cleared (e.g. a backend restart) so the user is not asked to log in
 * again on every reload.
 * @returns The stored credentials, or `null` when none are saved.
 */
export function loadStoredCredentials(): StoredCredentials | null {
  try {
    const raw = localStorage.getItem(CREDENTIALS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredCredentials>;
    if (
      typeof parsed.username !== 'string' ||
      typeof parsed.password !== 'string'
    ) {
      return null;
    }
    return { username: parsed.username, password: parsed.password };
  } catch {
    return null;
  }
}

/**
 * Persists the credentials used for the current session so the session can be
 * re-established automatically after a reload or backend restart.
 * @param credentials - The credentials to store.
 */
export function storeCredentials(credentials: StoredCredentials): void {
  try {
    localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(credentials));
  } catch {
    // Best-effort: ignore quota/availability errors.
  }
}

/**
 * Removes any saved credentials (called on logout).
 */
export function clearStoredCredentials(): void {
  try {
    localStorage.removeItem(CREDENTIALS_KEY);
  } catch {
    // Best-effort: ignore availability errors.
  }
}

/**
 * Returns the current authentication status from the session cookie.
 * @returns The authentication status.
 */
export async function fetchAuthStatus(): Promise<AuthStatus> {
  const response = await fetch('/api/auth/me');
  if (!response.ok) return { authenticated: false, username: null };
  return (await response.json()) as AuthStatus;
}

/**
 * Attempts to log in and start a session.
 * @param username - The account username.
 * @param password - The account password.
 * @returns The username on success, or an error message on failure.
 */
export async function login(
  username: string,
  password: string,
): Promise<{ ok: true; username: string } | { ok: false; error: string }> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (response.ok) {
    const data = (await response.json()) as { username: string };
    return { ok: true, username: data.username };
  }
  const data = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return { ok: false, error: data?.error ?? 'login failed' };
}

/**
 * Destroys the current session.
 */
export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' });
}

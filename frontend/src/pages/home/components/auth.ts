export interface AuthStatus {
  authenticated: boolean;
  username: string | null;
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

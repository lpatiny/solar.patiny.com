import { Button, Callout, InputGroup } from '@blueprintjs/core';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { fetchAuthStatus, login, logout } from './auth.ts';

interface LoginPanelProps {
  /** Rendered only while authenticated (e.g. the control widgets). */
  children: ReactNode;
}

/**
 * Gates its children behind a login form. While unauthenticated it shows a
 * username/password form; once logged in it shows the children plus a small
 * "logged in as … / log out" bar. The session is a cookie shared across the
 * whole app, so logging in here also unlocks the other protected routes.
 * @param root0 - Component props.
 * @param root0.children - Content shown only to authenticated users.
 * @returns The login gate.
 */
export default function LoginPanel({ children }: LoginPanelProps) {
  const [status, setStatus] = useState<{
    authenticated: boolean;
    username: string | null;
  } | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAuthStatus()
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

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await login(username, password);
      if (result.ok) {
        setStatus({ authenticated: true, username: result.username });
        setPassword('');
      } else {
        setError(result.error);
      }
    } finally {
      setBusy(false);
    }
  }

  async function doLogout() {
    setBusy(true);
    try {
      await logout();
      setStatus({ authenticated: false, username: null });
    } finally {
      setBusy(false);
    }
  }

  if (status === null) return null;

  if (!status.authenticated) {
    return (
      <div style={{ maxWidth: 320, padding: '8px 0' }}>
        <div
          style={{
            color: 'var(--text-secondary)',
            fontSize: 13,
            marginBottom: 8,
          }}
        >
          Log in to change the charging speed.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <InputGroup
            placeholder="Username"
            value={username}
            onValueChange={setUsername}
          />
          <InputGroup
            type="password"
            placeholder="Password"
            value={password}
            onValueChange={setPassword}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit();
            }}
          />
          <Button
            intent="primary"
            loading={busy}
            disabled={username === '' || password === ''}
            onClick={() => void submit()}
          >
            Log in
          </Button>
          {error && <Callout intent="danger">{error}</Callout>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
          Logged in as {status.username}
        </span>
        <Button minimal small loading={busy} onClick={() => void doLogout()}>
          Log out
        </Button>
      </div>
      {children}
    </div>
  );
}

import { Button, Callout, InputGroup, Popover } from '@blueprintjs/core';
import { useState } from 'react';

import { useAuth } from './useAuth.ts';

/**
 * Compact authentication control for the top-right of the header. Shows a
 * "Log in" button that opens a popover with the credentials form when logged
 * out, and the username plus a "Log out" button when logged in.
 * @returns The header auth control.
 */
export default function HeaderAuth() {
  const { status, login, logout } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  if (status === null) return null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await login(username, password);
      if (result.ok) {
        setPassword('');
        setUsername('');
        setOpen(false);
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
    } finally {
      setBusy(false);
    }
  }

  if (status.authenticated) {
    return (
      <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
          {status.username}
        </span>
        <Button
          icon="log-out"
          size="small"
          variant="minimal"
          loading={busy}
          onClick={() => void doLogout()}
        >
          Log out
        </Button>
      </div>
    );
  }

  return (
    <Popover
      isOpen={open}
      onInteraction={(next) => setOpen(next)}
      placement="bottom-end"
      content={
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: 12,
            width: 240,
          }}
        >
          <InputGroup
            placeholder="Username"
            autoFocus
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
      }
    >
      <Button icon="log-in" size="small" intent="primary">
        Log in
      </Button>
    </Popover>
  );
}

import { Button, Intent, Tag, TextArea } from '@blueprintjs/core';
import { useEffect, useState } from 'react';

import { ErrorText, Row } from './configUi.tsx';

interface SessionStatus {
  hasSession: boolean;
  cookieKeys: string[];
  lastError: string | null;
  savedAt: string | null;
}

export default function SolarWebLogin() {
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(
    null,
  );
  const [showLoginHelper, setShowLoginHelper] = useState(false);
  const [cookiePaste, setCookiePaste] = useState('');
  const [importingSession, setImportingSession] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);

  useEffect(() => {
    void fetch('/api/solarweb/session')
      .then((r) => r.json())
      .then((s) => setSessionStatus(s as SessionStatus))
      .catch(() => null);
  }, []);

  async function handleImportSession() {
    setImportingSession(true);
    setImportError(null);
    setImportSuccess(false);
    try {
      const res = await fetch('/api/solarweb/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies: cookiePaste }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setImportSuccess(true);
      setCookiePaste('');
      setShowLoginHelper(false);
      const s = await fetch('/api/solarweb/session').then((r) => r.json());
      setSessionStatus(s as SessionStatus);
    } catch (error_) {
      setImportError(
        error_ instanceof Error ? error_.message : 'Import failed',
      );
    } finally {
      setImportingSession(false);
    }
  }

  return (
    <div>
      <Row label="Session">
        {sessionStatus === null ? (
          <Tag minimal>Loading…</Tag>
        ) : sessionStatus.hasSession ? (
          <Tag intent={Intent.SUCCESS} minimal>
            Active
          </Tag>
        ) : (
          <Tag intent={Intent.DANGER} minimal>
            {sessionStatus.lastError ? 'CAPTCHA blocked' : 'No session'}
          </Tag>
        )}
      </Row>
      {sessionStatus?.savedAt && (
        <Row
          label="Saved"
          value={new Date(sessionStatus.savedAt).toLocaleString()}
        />
      )}
      {sessionStatus?.lastError && (
        <div
          style={{
            color: 'var(--danger)',
            fontSize: 11,
            marginTop: 4,
            wordBreak: 'break-all',
          }}
        >
          {sessionStatus.lastError}
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <Button
          size="small"
          intent={
            sessionStatus && !sessionStatus.hasSession
              ? Intent.WARNING
              : Intent.NONE
          }
          onClick={() => setShowLoginHelper((v) => !v)}
        >
          {showLoginHelper ? 'Hide' : 'Fix Login'}
        </Button>
        {importSuccess && !showLoginHelper && (
          <span style={{ fontSize: 11, color: '#86efac', marginLeft: 10 }}>
            Session imported successfully
          </span>
        )}
      </div>
      {showLoginHelper && (
        <div
          style={{
            background: 'var(--card-bg, #1a1a2e)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            marginTop: 10,
            padding: 12,
            fontSize: 12,
          }}
        >
          <div style={{ marginBottom: 10, color: 'var(--text-secondary)' }}>
            The session cookie is HttpOnly and cannot be read via the console.
            Use the DevTools Network tab instead.
          </div>

          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            Step 1 — Log in to SolarWeb
          </div>
          <div style={{ marginBottom: 8 }}>
            <a
              href="https://www.solarweb.com"
              target="_blank"
              rel="noreferrer"
              style={{ color: '#60a5fa' }}
            >
              Open solarweb.com ↗
            </a>{' '}
            and complete login (solve any CAPTCHA if prompted).
          </div>

          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            Step 2 — Copy the Cookie request header
          </div>
          <div style={{ marginBottom: 4 }}>
            Press <b>F12</b> on the SolarWeb tab → <b>Network</b> → reload the
            page → click any request to <code>www.solarweb.com</code> →{' '}
            <b>Headers</b> → scroll to <b>Request Headers</b> → find{' '}
            <code>Cookie:</code> and copy its full value.
          </div>
          <div
            style={{
              background: '#0f172a',
              borderRadius: 4,
              color: 'var(--text-secondary)',
              fontFamily: 'monospace',
              fontSize: 11,
              marginBottom: 10,
              padding: '6px 10px',
            }}
          >
            F12 → Network → any solarweb.com request → Headers → Cookie: …
          </div>

          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            Step 3 — Paste and import
          </div>
          <TextArea
            value={cookiePaste}
            onChange={(e) => setCookiePaste(e.target.value)}
            placeholder="Paste full Cookie header value here…"
            fill
            rows={4}
            style={{ fontFamily: 'monospace', fontSize: 11, marginBottom: 8 }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button
              intent={Intent.PRIMARY}
              size="small"
              loading={importingSession}
              disabled={!cookiePaste.trim()}
              onClick={() => void handleImportSession()}
            >
              Import Session
            </Button>
            {importError && <ErrorText>{importError}</ErrorText>}
          </div>
        </div>
      )}
    </div>
  );
}

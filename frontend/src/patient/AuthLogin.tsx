/**
 * AuthLogin — login method selector for the patient portal.
 *
 * Options:
 *   1. Browser wallet (dapp-kit ConnectButton)
 *   2. Google / zkLogin — redirects to Google OAuth, completes on return
 *   3. Passkey — WebAuthn register or authenticate
 *
 * On successful non-wallet auth, calls setPatientSession() so the rest of the
 * app can use session.signAndExecute() transparently.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { setPatientSession } from '../lib/patientSession';
import {
  initiateZkLogin,
  completeZkLogin,
  ZkLoginSession,
  clearZkLoginSession,
} from '../lib/zkLoginSession';
import {
  registerPasskey,
  restorePasskeySession,
  clearPasskeySession,
} from '../lib/passkeySession';
import { restorePendingConsume } from '../lib/consumeLink';

interface Props {
  onSessionReady: () => void;
}

// Module-level guard: React.StrictMode double-invokes effects in dev, which
// would POST the same JWT to the prover twice → 429 "Same JWT within 5 sec".
// Survives the double-mount because it lives outside the component instance.
let zkCompletionStarted = false;

export function AuthLogin({ onSessionReady }: Props) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');
  // In-flight guard: WebAuthn allows only one pending navigator.credentials
  // request at a time. Without this, double-clicking fires concurrent calls →
  // "A request is already pending". Blocks all three login buttons while busy.
  const [busy, setBusy] = useState(false);

  // On mount: handle zkLogin callback OR restore passkey session
  useEffect(() => {
    void (async () => {
      // Check for id_token in URL fragment (Google OAuth implicit flow)
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const idToken = hash.get('id_token');
      if (idToken) {
        if (zkCompletionStarted) return;
        zkCompletionStarted = true;
        setStatus('Completing Google sign-in...');
        try {
          const session = await completeZkLogin(idToken);
          setPatientSession(session);
          // Clean up URL fragment, then leave the OAuth callback path for the app.
          window.history.replaceState({}, '', window.location.pathname);
          onSessionReady();
          zkCompletionStarted = false; // allow a future re-login after logout
          if (window.location.pathname.startsWith('/zklogin/callback')) {
            // Honor a pending doctor deep-link: land on /doctor so ConsumePage
            // can pick up the stashed grant params instead of the patient app.
            navigate(restorePendingConsume() ? '/doctor' : '/patient', { replace: true });
          }
        } catch (e) {
          setError(`zkLogin error: ${(e as Error).message}`);
          setStatus('');
          clearZkLoginSession();
          zkCompletionStarted = false; // allow a fresh retry
        }
        return;
      }

      // Try restore from existing zkLogin session
      const zkSession = ZkLoginSession.restore();
      if (zkSession) {
        setPatientSession(zkSession);
        onSessionReady();
        return;
      }

      // Try restore passkey session (requires user interaction — skip silent restore
      // since signAndRecover triggers the WebAuthn dialog; only restore if explicitly
      // triggered by the user).
    })();
  }, [onSessionReady]);

  async function handleGoogleLogin() {
    if (busy) return;
    setBusy(true);
    setStatus('Redirecting to Google...');
    setError('');
    try {
      // Start every sign-in from a clean slate: drop any prior completed session
      // and stale ephemeral key so an account switch can't leave sessionStorage in
      // a mixed (address/proof/ephemeral desynced) state.
      clearZkLoginSession();
      const { authUrl } = await initiateZkLogin();
      window.location.href = authUrl;
      // Navigating away; leave busy=true so buttons stay disabled until unload.
    } catch (e) {
      setError(`Failed to start zkLogin: ${(e as Error).message}`);
      setStatus('');
      setBusy(false);
    }
  }

  async function handlePasskeyRegister() {
    if (busy) return;
    setBusy(true);
    setStatus('Creating passkey...');
    setError('');
    try {
      const session = await registerPasskey();
      setPatientSession(session);
      onSessionReady();
    } catch (e) {
      setError(`Passkey registration failed: ${(e as Error).message}`);
      setStatus('');
    } finally {
      setBusy(false);
    }
  }

  async function handlePasskeyLogin() {
    if (busy) return;
    setBusy(true);
    setStatus('Authenticating with passkey...');
    setError('');
    try {
      const session = await restorePasskeySession();
      if (!session) {
        setError('No passkey found for this device. Register first.');
        setStatus('');
        return;
      }
      setPatientSession(session);
      onSessionReady();
    } catch (e) {
      setError(`Passkey authentication failed: ${(e as Error).message}`);
      setStatus('');
    } finally {
      setBusy(false);
    }
  }

  function handleLogoutPasskey() {
    clearPasskeySession();
    clearZkLoginSession();
  }

  const btnStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '10px 16px',
    marginBottom: 10,
    fontSize: 14,
    borderRadius: 6,
    border: '1px solid #ccc',
    cursor: 'pointer',
    background: '#fff',
  };

  return (
    <div className="card" style={{ maxWidth: 400, margin: '60px auto', textAlign: 'center' }}>
      <img src="/anampouch_logo_original.png" alt="AnamPouch" style={{ width: 110, height: 110, marginBottom: 16 }} />
      <h2 style={{ fontSize: 24, marginBottom: 8, color: 'var(--primary)' }}>Welcome to AnamPouch</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 32, fontSize: 15 }}>
        Your portable, encrypted health pouch.
      </p>

      {status && (
        <div style={{ background: 'var(--primary-soft)', padding: 12, borderRadius: 12, marginBottom: 20, fontSize: 13, color: 'var(--primary)', fontWeight: 500 }}>
          {status}
        </div>
      )}
      
      {error && (
        <div style={{ background: 'var(--error-soft)', padding: 12, borderRadius: 12, marginBottom: 20, fontSize: 13, color: 'var(--error)', fontWeight: 500 }}>
          {error}
        </div>
      )}

      {/* Option 2: zkLogin (Google) */}
      <div style={{ marginBottom: 24 }}>
        <button 
          className="btn-primary" 
          style={{ 
            width: '100%', 
            background: 'white', 
            color: '#444', 
            border: '1px solid #ddd',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
            opacity: busy ? 0.6 : 1,
            cursor: busy ? 'not-allowed' : 'pointer'
          }}
          onClick={handleGoogleLogin}
          disabled={busy}
        >
          <svg width="18" height="18" viewBox="0 0 18 18"><path d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.91a8.78 8.78 0 0 0 2.69-6.62z" fill="#4285F4"/><path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.8.54-1.83.86-3.05.86-2.34 0-4.33-1.58-5.03-3.7H.95v2.3A8.99 8.99 0 0 0 9 18z" fill="#34A853"/><path d="M3.97 10.71a5.41 5.41 0 0 1 0-3.42V4.99H.95a8.99 8.99 0 0 0 0 8.02l3.02-2.3z" fill="#FBBC05"/><path d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A8.99 8.99 0 0 0 9 0 8.99 8.99 0 0 0 .95 4.99L3.97 7.29c.7-2.13 2.69-3.71 5.03-3.71z" fill="#EA4335"/></svg>
          Continue with Google
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0', color: '#cbd5e1' }}>
        <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>OR</span>
        <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
      </div>

      {/* Option 3: Passkey */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
        <button className="btn-secondary" onClick={handlePasskeyLogin} disabled={busy} style={{ padding: '12px', opacity: busy ? 0.6 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}>
          🔑 Passkey
        </button>
        <button className="btn-secondary" onClick={handlePasskeyRegister} disabled={busy} style={{ padding: '12px', opacity: busy ? 0.6 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}>
          ✨ New Passkey
        </button>
      </div>

      <div style={{ marginBottom: 32 }}>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Use your browser wallet</p>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <ConnectButton />
        </div>
      </div>

      <button 
        style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }} 
        onClick={handleLogoutPasskey}
      >
        Clear stored credentials
      </button>
    </div>
  );
}

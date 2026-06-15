import { useRef } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { useAuthSession } from '../lib/useAuthSession';
import { AuthControls } from '../components/AuthControls';
import { AuthLogin } from '../patient/AuthLogin';
import { parseConsumeHash, stashPendingConsume } from '../lib/consumeLink';

export function DoctorShell() {
  // Capture deep-link params (#g=..&t=..) synchronously during render, BEFORE
  // children mount. Child effects (ConsumePage prefill) run before parent
  // effects on mount, so capturing in a useEffect here would let an
  // already-authenticated ConsumePage read an empty stash and miss the prefill.
  // Capturing in render (idempotent, ref-guarded) guarantees the stash is ready
  // first. We also strip the hash so a later zkLogin OAuth round-trip cannot
  // collide its #id_token with our fragment.
  const captured = useRef(false);
  if (!captured.current) {
    captured.current = true;
    const params = parseConsumeHash(window.location.hash);
    if (params) {
      stashPendingConsume(params);
      window.history.replaceState({}, '', window.location.pathname + window.location.search);
    }
  }

  const auth = useAuthSession();

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 24px' }}>
      <header className="header-container">
        <h1 className="logo-text">
          <Link to="/doctor" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 28 }}>🩺</span>
            AnamPouch <span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: 16, marginLeft: 4 }}>Doctor Portal</span>
          </Link>
        </h1>
        <AuthControls auth={auth} />
      </header>

      <nav style={{ marginBottom: 32, display: 'flex', gap: 8, background: 'var(--primary-soft)', padding: 6, borderRadius: 12, width: 'fit-content' }}>
        <Link to="/doctor" className="nav-link">Consume Grant</Link>
        <Link to="/patient" className="nav-link">Patient App →</Link>
      </nav>

      <main>
        {auth.isAuthenticated ? (
          <div className="card" style={{ minHeight: 400 }}>
            <Outlet />
          </div>
        ) : (
          <AuthLogin onSessionReady={auth.onSessionReady} />
        )}
      </main>

      <footer style={{ marginTop: 64, padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, borderTop: '1px solid var(--border)' }}>
        <p>© 2026 AnamPouch — Secure Doctor Interface.</p>
      </footer>
    </div>
  );
}

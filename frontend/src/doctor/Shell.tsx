import { useRef, useEffect } from 'react';
import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuthSession } from '../lib/useAuthSession';
import { AuthControls } from '../components/AuthControls';
import { AuthLogin } from '../patient/AuthLogin';
import { parseConsumeHash, stashPendingConsume } from '../lib/consumeLink';
import { MascotBuddy } from '../components/MascotBuddy';

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
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!auth.isAuthenticated && location.pathname !== '/doctor') {
      navigate('/doctor', { replace: true });
    }
  }, [auth.isAuthenticated, location.pathname, navigate]);

  return (
    <div style={{ position: 'relative', minHeight: '100vh', paddingBottom: 64 }}>
      {/* Soft atmospheric background glow */}
      <div style={{
        position: 'absolute',
        top: -100,
        left: '10%',
        width: 300,
        height: 300,
        background: 'rgba(127, 197, 227, 0.15)',
        filter: 'blur(80px)',
        borderRadius: '50%',
        pointerEvents: 'none',
        zIndex: 0
      }} />
      <div style={{
        position: 'absolute',
        top: 200,
        right: '5%',
        width: 250,
        height: 250,
        background: 'rgba(181, 229, 224, 0.15)',
        filter: 'blur(70px)',
        borderRadius: '50%',
        pointerEvents: 'none',
        zIndex: 0
      }} />

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 24px', position: 'relative', zIndex: 1 }}>
        <header className="header-container">
          <h1 className="logo-text">
            <a href="/" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
              <img src="/anampouch_logo_transparent.png" className="mascot-wiggle" alt="" style={{ width: 50, height: 50, transition: 'transform 0.3s ease' }} />
              AnamPouch <span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: 16, marginLeft: 4 }}>Doctor Portal</span>
            </a>
          </h1>
          <AuthControls auth={auth} />
        </header>

        {auth.isAuthenticated && (
          <nav style={{ marginBottom: 32, display: 'flex', gap: 8, background: 'rgba(45, 90, 142, 0.05)', backdropFilter: 'blur(4px)', padding: 6, borderRadius: 12, width: 'fit-content' }}>
            <Link to="/doctor" className="nav-link">Consume Grant</Link>
            <Link to="/patient" className="nav-link">Patient App →</Link>
          </nav>
        )}

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

      {/* Floating Interactive Mascot Buddy for Doctor */}
      <MascotBuddy role="doctor" />
    </div>
  );
}

import { Link, Outlet } from 'react-router-dom';
import { useAuthSession } from '../lib/useAuthSession';
import { AuthControls } from '../components/AuthControls';
import { AuthLogin } from './AuthLogin';

export function PatientShell() {
  const auth = useAuthSession();

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 24px' }}>
      <header className="header-container">
        <h1 className="logo-text">
          <Link to="/patient" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
            <img src="/anampouch_logo_transparent.png" alt="" style={{ width: 50, height: 50 }} />
            AnamPouch
          </Link>
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <AuthControls auth={auth} />
        </div>
      </header>

      {auth.isAuthenticated && (
        <nav style={{ marginBottom: 32, display: 'flex', gap: 8, background: 'var(--primary-soft)', padding: 6, borderRadius: 12, width: 'fit-content' }}>
          <Link to="/patient" className="nav-link">Records</Link>
          <Link to="/patient/grants" className="nav-link">Grants</Link>
          <Link to="/patient/new" className="nav-link">+ New visit</Link>
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
        <p>© 2026 AnamPouch — Your Health, Your Pouch.</p>
      </footer>
    </div>
  );
}

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  queryGrantsIssuedByPatient,
  queryRevokedGrantIds,
  queryConsumedGrantIds,
} from '../api/queries';
import { buildRevokeGrantTx } from '../api/accessGrant';
import { getPatientSession } from '../lib/patientSession';
import { deriveGrantStatus, isRevocable, type GrantStatus } from '../lib/grantStatus';
import { explainMoveError } from '../lib/errors';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SCOPE, type ObjectId, type SuiAddress } from '../types/contracts';

const SCOPE_LABEL: Record<number, string> = {
  [SCOPE.Single]: 'Single visit',
  [SCOPE.Period]: 'Time period',
  [SCOPE.Disease]: 'Disease scope',
};

const STATUS_STYLE: Record<GrantStatus, { label: string; bg: string; color: string }> = {
  active: { label: 'Active', bg: 'var(--primary-soft)', color: 'var(--primary)' },
  used: { label: 'Used', bg: '#f1f5f9', color: 'var(--text-muted)' },
  revoked: { label: 'Revoked', bg: 'var(--error-soft)', color: 'var(--error)' },
  expired: { label: 'Expired', bg: '#f1f5f9', color: 'var(--text-muted)' },
};

export function GrantList() {
  const session = getPatientSession();
  const address = session.getAddress();
  const qc = useQueryClient();

  const [pending, setPending] = useState<ObjectId | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['grants', address],
    enabled: !!address,
    queryFn: async () => {
      const [grants, revoked, consumed] = await Promise.all([
        queryGrantsIssuedByPatient(address as SuiAddress),
        queryRevokedGrantIds(),
        queryConsumedGrantIds(),
      ]);
      const now = Date.now();
      return grants.map((g) => ({ ...g, status: deriveGrantStatus(g, revoked, consumed, now) }));
    },
  });

  async function handleRevoke(grantId: ObjectId) {
    setBusy(true);
    setErr(null);
    try {
      const tx = buildRevokeGrantTx(grantId);
      await session.signAndExecute(tx);
      setPending(null);
      await qc.invalidateQueries({ queryKey: ['grants', address] });
    } catch (e) {
      const friendly = explainMoveError(e);
      setErr(friendly.hint || (e as Error).message);
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0' }}>Loading your grants…</p>;
  if (error) return <p style={{ color: 'var(--error)', textAlign: 'center', padding: '40px 0' }}>Failed to load: {String(error)}</p>;
  if (!data?.length) return (
    <div style={{ textAlign: 'center', padding: '60px 0' }}>
      <p style={{ color: 'var(--text-muted)', fontSize: 16, marginBottom: 20 }}>You haven't shared any records yet.</p>
      <Link to="/patient" className="btn-primary">Go to Records</Link>
    </div>
  );

  return (
    <div>
      <h2 style={{ fontSize: 20, marginBottom: 20, color: 'var(--primary)' }}>Access You've Granted</h2>
      {err && (
        <p style={{ color: 'var(--error)', fontWeight: 600, marginBottom: 16 }}>⚠️ {err}</p>
      )}
      <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {data.map((g) => {
          const ss = STATUS_STYLE[g.status];
          return (
            <li key={g.grantId} style={{
              padding: 16, background: 'white', border: '1px solid var(--border)',
              borderRadius: 12, boxShadow: 'var(--shadow-sm)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                    {SCOPE_LABEL[g.scope] ?? `Scope ${g.scope}`}
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6,
                    background: ss.bg, color: ss.color,
                  }}>{ss.label}</span>
                </div>
                <code className="code-inset" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.grantId}</code>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Expires {new Date(Number(g.expiresAtMs)).toLocaleString()}
                </span>
              </div>
              {isRevocable(g.status) && (
                <button
                  type="button"
                  onClick={() => setPending(g.grantId)}
                  className="btn-secondary"
                  style={{ fontSize: 13, padding: '8px 16px', color: 'var(--error)', flexShrink: 0 }}
                >
                  🚫 Revoke
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={pending !== null}
        destructive
        busy={busy}
        title="Revoke this access?"
        message="The doctor will no longer be able to decrypt this record with this grant. This cannot be undone."
        confirmLabel="Revoke"
        onConfirm={() => pending && handleRevoke(pending)}
        onCancel={() => !busy && setPending(null)}
      />
    </div>
  );
}

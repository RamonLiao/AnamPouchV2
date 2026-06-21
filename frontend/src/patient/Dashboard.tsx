import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SealCompatibleClient } from '@mysten/seal';
import { loadDashboard } from '../lib/dashboardQuery';
import { viewOwnRecord, type ViewStage } from '../lib/patientPipeline';
import { getPatientSession } from '../lib/patientSession';
import { sealClient, suiJsonRpc, dAppKit } from '../lib/dappKit';
import { explainMoveError } from '../lib/errors';
import type { ObjectId, SuiAddress } from '../types/contracts';

const STAGE_LABEL: Record<ViewStage, string> = {
  idle: '',
  fetching: 'Fetching encrypted blob…',
  session: 'Signing Seal session key…',
  decrypting: 'Decrypting via key servers…',
  done: '',
  error: '',
};

interface DecryptState {
  stage: ViewStage;
  text?: string;
  err?: string;
}

function formatDate(ms: bigint): string {
  return new Date(Number(ms)).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function Dashboard() {
  const session = getPatientSession();
  const address = session.getAddress();

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard', address],
    enabled: !!address,
    queryFn: () => loadDashboard(address as SuiAddress),
  });

  const [decryptState, setDecryptState] = useState<DecryptState>({ stage: 'idle' });

  async function handleDecryptSummary(recordId: ObjectId) {
    if (!address) return;
    setDecryptState({ stage: 'fetching' });
    try {
      const text = await viewOwnRecord({
        recordId,
        address,
        signPersonalMessage: (msg) => session.signPersonalMessage(msg),
        suiClient: suiJsonRpc as any,
        sealCompatibleClient: dAppKit.getClient() as unknown as SealCompatibleClient,
        sealClient,
        onStage: (stage) => setDecryptState((prev) => ({ ...prev, stage })),
      });
      setDecryptState({ stage: 'done', text });
    } catch (e) {
      const friendly = explainMoveError(e);
      setDecryptState({ stage: 'error', err: friendly.hint || (e as Error).message });
    }
  }

  if (isLoading) {
    return <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0' }}>Loading your dashboard…</p>;
  }
  if (error) {
    return <p style={{ color: 'var(--error)', textAlign: 'center', padding: '40px 0' }}>Failed to load: {String(error)}</p>;
  }
  if (!data) return null;

  const { recordCount, timeline, latestSummary } = data;

  return (
    <div>
      <h2 style={{ fontSize: 20, marginBottom: 20, color: 'var(--primary)' }}>Your Health Dashboard</h2>

      {/* Summary stats */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 28, flexWrap: 'wrap' }}>
        <div style={{
          flex: 1,
          minWidth: 140,
          padding: '20px 24px',
          background: 'var(--primary-soft)',
          border: '1px solid var(--primary-light)',
          borderRadius: 12,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 36, fontWeight: 700, color: 'var(--primary)' }}>{recordCount}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Total Records</div>
        </div>

        {latestSummary && (
          <div style={{
            flex: 1,
            minWidth: 140,
            padding: '20px 24px',
            background: 'var(--primary-soft)',
            border: '1px solid var(--primary-light)',
            borderRadius: 12,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: 'var(--primary)' }}>{String(latestSummary.coveredCount)}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>Records in Latest Summary</div>
          </div>
        )}
      </div>

      {/* Latest summary decrypt */}
      {latestSummary && (
        <section style={{ marginBottom: 28 }}>
          <h3 style={{ fontSize: 16, marginBottom: 12, color: 'var(--text)' }}>Latest Summary</h3>
          <div style={{
            padding: 16,
            background: 'white',
            border: '1px solid var(--border)',
            borderRadius: 12,
            boxShadow: 'var(--shadow-sm)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>
                  Created {formatDate(latestSummary.createdAtMs)} · covers {String(latestSummary.coveredCount)} records
                </div>
                <code className="code-inset" style={{ fontSize: 11 }}>{latestSummary.recordId}</code>
              </div>
              {decryptState.stage === 'idle' && (
                <button
                  type="button"
                  onClick={() => handleDecryptSummary(latestSummary.recordId)}
                  className="btn-secondary"
                  style={{ fontSize: 13, padding: '8px 16px' }}
                >
                  🔓 Decrypt Summary
                </button>
              )}
              {decryptState.stage !== 'idle' && decryptState.stage !== 'done' && decryptState.stage !== 'error' && (
                <span style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 600 }}>
                  <span className="pulse">⏳</span> {STAGE_LABEL[decryptState.stage]}
                </span>
              )}
            </div>

            {decryptState.stage === 'error' && (
              <p style={{ margin: '12px 0 0', color: 'var(--error)', fontWeight: 600, fontSize: 14 }}>
                ⚠️ {decryptState.err}
              </p>
            )}
            {decryptState.stage === 'done' && decryptState.text && (
              <div style={{
                marginTop: 12,
                padding: 14,
                background: 'var(--primary-soft)',
                border: '1px solid var(--primary-light)',
                borderRadius: 10,
                fontSize: 14,
                lineHeight: 1.6,
              }}>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontFamily: 'inherit', color: 'var(--text)' }}>
                  {decryptState.text}
                </pre>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Visit timeline */}
      <section>
        <h3 style={{ fontSize: 16, marginBottom: 12, color: 'var(--text)' }}>Visit Timeline</h3>
        {timeline.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No visits yet.</p>
        ) : (
          <ol style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {timeline.map((entry, i) => (
              <li
                key={entry.recordId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 16px',
                  background: 'white',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <span style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: 'var(--primary)',
                  color: 'white',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  flexShrink: 0,
                }}>
                  {i + 1}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{formatDate(entry.visitMs)}</div>
                  <code className="code-inset" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.recordId}</code>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

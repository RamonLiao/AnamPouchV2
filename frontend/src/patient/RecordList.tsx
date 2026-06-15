import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { SealCompatibleClient } from '@mysten/seal';
import { queryRecordCreatedByPatient } from '../api/queries';
import { sealClient, suiJsonRpc, dAppKit } from '../lib/dappKit';
import { getPatientSession } from '../lib/patientSession';
import { viewOwnRecord, type ViewStage } from '../lib/patientPipeline';
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

interface ExpandState {
  stage: ViewStage;
  plaintext?: string;
  err?: string;
}

export function RecordList() {
  const session = getPatientSession();
  const address = session.getAddress();
  const [expandedId, setExpandedId] = useState<ObjectId | null>(null);
  const [states, setStates] = useState<Record<string, ExpandState>>({});

  const { data, isLoading, error } = useQuery({
    queryKey: ['records', address],
    enabled: !!address,
    queryFn: () => queryRecordCreatedByPatient(address as SuiAddress),
  });

  async function handleView(id: ObjectId) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (states[id]?.plaintext) return; // already decrypted, just expand

    if (!address) return;
    const update = (s: ExpandState) => setStates((prev) => ({ ...prev, [id]: s }));
    update({ stage: 'fetching' });
    try {
      const plaintext = await viewOwnRecord({
        recordId: id,
        address,
        signPersonalMessage: (msg) => session.signPersonalMessage(msg),
        suiClient: suiJsonRpc as any,
        sealCompatibleClient: dAppKit.getClient() as unknown as SealCompatibleClient,
        sealClient,
        onStage: (stage) => update({ stage }),
      });
      update({ stage: 'done', plaintext });
    } catch (e) {
      const friendly = explainMoveError(e);
      update({ stage: 'error', err: friendly.hint || (e as Error).message });
    }
  }

  if (isLoading) return <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '40px 0' }}>Loading your health pouch…</p>;
  if (error) return <p style={{ color: 'var(--error)', textAlign: 'center', padding: '40px 0' }}>Failed to load: {String(error)}</p>;
  if (!data?.records.length) return (
    <div style={{ textAlign: 'center', padding: '60px 0' }}>
      <p style={{ color: 'var(--text-muted)', fontSize: 16, marginBottom: 20 }}>No records in your pouch yet.</p>
      <Link to="/patient/new" className="btn-primary">Start a New Visit</Link>
    </div>
  );

  return (
    <div>
      <h2 style={{ fontSize: 20, marginBottom: 20, color: 'var(--primary)' }}>Your Health Records</h2>
      <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {data.records.map((id) => {
          const st = states[id];
          const expanded = expandedId === id;
          const busy = expanded && st && st.stage !== 'done' && st.stage !== 'error';
          return (
            <li key={id} style={{
              padding: 16,
              background: 'white',
              border: '1px solid var(--border)',
              borderRadius: 12,
              boxShadow: 'var(--shadow-sm)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Visit Record</span>
                  <code className="code-inset" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis' }}>{id}</code>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => handleView(id)}
                    disabled={busy}
                    aria-expanded={expanded}
                    aria-controls={`record-${id}-content`}
                    className="btn-secondary"
                    style={{ fontSize: 13, padding: '8px 16px' }}
                  >
                    {busy ? '⏳ …' : expanded ? '▲ Hide' : '👁 View'}
                  </button>
                  <Link to={`/patient/share/${id}`} className="btn-secondary" style={{ fontSize: 13, padding: '8px 16px' }}>
                    📤 Share via QR
                  </Link>
                </div>
              </div>

              {expanded && st && (
                <div id={`record-${id}-content`} style={{
                  padding: 16,
                  background: 'var(--primary-soft)',
                  border: '1px solid var(--primary-light)',
                  borderRadius: 10,
                  fontSize: 14,
                  lineHeight: 1.6,
                }}>
                  {st.stage === 'error' && (
                    <p style={{ margin: 0, color: 'var(--error)', fontWeight: 600 }}>⚠️ {st.err}</p>
                  )}
                  {st.stage !== 'error' && st.stage !== 'done' && (
                    <p style={{ margin: 0, color: 'var(--primary)', fontWeight: 600 }}>
                      <span className="pulse">⏳</span> {STAGE_LABEL[st.stage]}
                    </p>
                  )}
                  {st.stage === 'done' && st.plaintext !== undefined && (
                    <pre style={{
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      margin: 0,
                      fontFamily: 'inherit',
                      color: 'var(--text)',
                    }}>{st.plaintext}</pre>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

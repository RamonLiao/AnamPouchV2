import { useState, useEffect, useRef } from 'react';
import { Transaction } from '@mysten/sui/transactions';
import { SessionKey, type SealCompatibleClient } from '@mysten/seal';
import { CONTRACT, CLOCK_OBJECT_ID, WALRUS, SEAL } from '../config/contract';
import { sealClient, suiJsonRpc, dAppKit } from '../lib/dappKit';
import { getPatientSession, signAndGetObjectChanges } from '../lib/patientSession';
import { buildConsumeGrantTx } from '../api/accessGrant';
import { decodeQrPayload } from '../lib/preimage';
import { fetchBlob } from '../lib/walrus';
import { explainMoveError } from '../lib/errors';
import { restorePendingConsume, clearPendingConsume } from '../lib/consumeLink';
import type { ObjectId } from '../types/contracts';

type Stage = 'idle' | 'consuming' | 'fetching' | 'session' | 'decrypting' | 'done' | 'error';

const STAGE_LABEL: Record<Stage, string> = {
  idle: '',
  consuming: 'Consuming grant on chain…',
  fetching: 'Fetching encrypted blob from Walrus…',
  session: 'Signing Seal session key…',
  decrypting: 'Decrypting via key servers…',
  done: 'Decrypted',
  error: 'Failed',
};

export function ConsumePage() {
  const session = getPatientSession();
  const address = session.getAddress();

  const [grantId, setGrantId] = useState('');
  const [token, setToken] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ ticketId: string; recordId: string; blobId: string } | null>(
    null,
  );

  // Prefill from a doctor deep-link captured by DoctorShell. Read-and-clear so a
  // reload (or StrictMode double-mount) does not resurrect consumed params.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current) return;
    prefilled.current = true;
    const pending = restorePendingConsume();
    if (pending) {
      setGrantId(pending.g);
      setToken(pending.t);
      clearPendingConsume();
    }
  }, []);

  async function handleDecrypt() {
    if (!address) return;
    setErr(null);
    setPlaintext(null);
    setMeta(null);
    try {
      const preimage = decodeQrPayload(token.trim());

      // 1. Resolve recordId from grant
      const grantObj = await suiJsonRpc.getObject({
        id: grantId.trim(),
        options: { showContent: true },
      });
      const grantContent: any = (grantObj as any).data?.content;
      const recordIdRaw: string | undefined = grantContent?.fields?.record_id;
      if (!recordIdRaw) throw new Error('grant object missing record_id');
      const recordId = recordIdRaw as ObjectId;

      // 2. consume_grant — mints DecryptionTicket (gRPC internals, session-agnostic)
      setStage('consuming');
      const consumeTx = buildConsumeGrantTx({
        grantId: grantId.trim() as ObjectId,
        recordId,
        preimage,
      });
      const { objectChanges } = await signAndGetObjectChanges(session, consumeTx);
      const ticketChange = objectChanges.find(
        (c) =>
          c.type === 'created' &&
          typeof c.objectType === 'string' &&
          c.objectType.endsWith('::decryption_ticket::DecryptionTicket'),
      );
      if (!ticketChange?.objectId) throw new Error('DecryptionTicket not in tx effects');
      const ticketId = ticketChange.objectId as ObjectId;

      // 3. Fetch encrypted blob via Walrus
      setStage('fetching');
      const recordObj = await suiJsonRpc.getObject({
        id: recordId,
        options: { showContent: true },
      });
      const recordContent: any = (recordObj as any).data?.content;
      const blobIdBytes: number[] = recordContent?.fields?.walrus_blob_id ?? [];
      const blobId = new TextDecoder().decode(new Uint8Array(blobIdBytes));
      if (!blobId) throw new Error('record has no walrus_blob_id');
      const cipher = await fetchBlob(blobId, WALRUS.aggregatorUrl);

      // 4. SessionKey via the active session's personal_message signature
      setStage('session');
      const sessionKey = await SessionKey.create({
        address: address,
        packageId: CONTRACT.originalPackageId,
        ttlMin: SEAL.sessionTtlMs / 60_000,
        suiClient: dAppKit.getClient() as unknown as SealCompatibleClient,
      });
      const personalMsg = sessionKey.getPersonalMessage();
      const sig = await session.signPersonalMessage(personalMsg);
      sessionKey.setPersonalMessageSignature(sig.signature);

      // 5. Build seal_approve PTB bytes (dry-run target for keyservers)
      // Per Seal 1.x: first arg MUST be the IBE id (vector<u8>) the ciphertext
      // was encrypted to. We use record.content_hash (32-byte sha256 of plaintext).
      const contentHashBytes: number[] = recordContent?.fields?.content_hash ?? [];
      if (contentHashBytes.length !== 32) throw new Error('record content_hash missing or wrong length');
      const approveTx = new Transaction();
      approveTx.moveCall({
        target: CONTRACT.fns.sealApprove,
        arguments: [
          approveTx.pure.vector('u8', contentHashBytes),
          approveTx.object(recordId),
          approveTx.object(ticketId),
          approveTx.object(CLOCK_OBJECT_ID),
        ],
      });
      approveTx.setSender(address);
      const txBytes = await approveTx.build({
        client: dAppKit.getClient() as any,
        onlyTransactionKind: true,
      });

      // 6. Decrypt
      setStage('decrypting');
      const plaintextBytes = await sealClient.decrypt({
        data: cipher,
        sessionKey,
        txBytes,
      });

      setPlaintext(new TextDecoder().decode(plaintextBytes));
      setMeta({ ticketId, recordId, blobId });
      setStage('done');
    } catch (e) {
      const friendly = explainMoveError(e);
      setErr(friendly.hint || (e as Error).message);
      setStage('error');
    }
  }

  const busy = stage !== 'idle' && stage !== 'done' && stage !== 'error';

  return (
    <section>
      <h2 style={{ fontSize: 24, marginBottom: 8, color: 'var(--primary)' }}>Access Patient Record</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 15, marginBottom: 24 }}>
        Securely consume a patient's access grant and decrypt their health record via the Seal key server network.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        <div className="input-group" style={{ margin: 0 }}>
          <label className="input-label">Grant Object ID</label>
          <input
            aria-label="Grant ID"
            value={grantId}
            onChange={(e) => setGrantId(e.target.value)}
            placeholder="0x…"
            style={{ display: 'block', width: '100%', fontFamily: 'monospace', fontSize: 13 }}
          />
        </div>

        <div className="input-group" style={{ margin: 0 }}>
          <label className="input-label">Access Token (QR Payload)</label>
          <input
            aria-label="Access token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="cqx9nh…"
            style={{ display: 'block', width: '100%', fontFamily: 'monospace', fontSize: 13 }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <button
          type="button"
          onClick={handleDecrypt}
          disabled={busy || !grantId || !token}
          className="btn-primary"
          style={{ padding: '12px 24px', minWidth: 180 }}
        >
          {busy ? 'Processing…' : '🔓 Decrypt Record'}
        </button>

        {stage !== 'idle' && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 10, 
            padding: '8px 16px', 
            background: stage === 'error' ? 'var(--error-soft)' : 'var(--primary-soft)', 
            borderRadius: 12,
            border: `1px solid ${stage === 'error' ? 'var(--error)' : 'var(--primary-light)'}`,
            fontSize: 13,
            fontWeight: 600,
            color: stage === 'error' ? 'var(--error)' : 'var(--primary)'
          }}>
            {stage === 'consuming' || stage === 'fetching' || stage === 'session' || stage === 'decrypting' ? (
              <span className="pulse">⏳</span>
            ) : stage === 'error' ? (
              <span>⚠️</span>
            ) : (
              <span>✅</span>
            )}
            {stage === 'error' ? `Error: ${err}` : STAGE_LABEL[stage]}
          </div>
        )}
      </div>

      {plaintext !== null && (
        <article style={{ marginTop: 40, animation: 'fadeIn 0.5s ease-out' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 18, color: 'var(--primary)' }}>Decrypted Health Record</h3>
            <span className="badge" style={{ background: 'var(--primary-soft)', color: 'var(--primary)', borderColor: 'var(--primary-light)' }}>
              🔒 Verified by Seal
            </span>
          </div>

          <div style={{ 
            background: 'white', 
            border: '2px solid var(--primary-soft)', 
            borderRadius: 16, 
            overflow: 'hidden',
            boxShadow: 'var(--shadow)'
          }}>
            <pre style={{ 
              whiteSpace: 'pre-wrap', 
              wordBreak: 'break-word', 
              background: '#fcfdfe', 
              padding: 24,
              margin: 0,
              fontSize: 15,
              lineHeight: 1.6,
              color: 'var(--text)',
              minHeight: 200
            }}>
              {plaintext}
            </pre>
            
            {meta && (
              <div style={{ background: 'var(--primary-soft)', padding: '12px 24px', borderTop: '1px solid var(--border)' }}>
                <details>
                  <summary style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary)', cursor: 'pointer' }}>Blockchain Traceability Meta</summary>
                  <div style={{ marginTop: 12, fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                    <p style={{ margin: '4px 0' }}>Record: {meta.recordId}</p>
                    <p style={{ margin: '4px 0' }}>Ticket: {meta.ticketId}</p>
                    <p style={{ margin: '4px 0' }}>Walrus: {meta.blobId}</p>
                  </div>
                </details>
              </div>
            )}
          </div>
        </article>
      )}
      
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </section>
  );
}

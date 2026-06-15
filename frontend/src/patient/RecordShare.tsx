import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { buildIssueGrantTx } from '../api/accessGrant';
import { buildConsumeLink } from '../lib/consumeLink';
import { getPatientSession } from '../lib/patientSession';
import { suiJsonRpc } from '../lib/dappKit';
import { SCOPE, type ObjectId } from '../types/contracts';
import { explainMoveError } from '../lib/errors';

/**
 * Share flow:
 *   - Generate one-time CSPRNG token (R7 / T13 / T14 hardening)
 *   - issue_grant on-chain anchors sha3(token)
 *   - Display QR with base64url(preimage) for doctor to scan
 *   - Preimage discarded from memory after QR shown (closure scope)
 */
const TTL_OPTIONS: { label: string; ms: bigint }[] = [
  { label: '15 minutes', ms: 15n * 60_000n },
  { label: '1 hour', ms: 60n * 60_000n },
  { label: '24 hours', ms: 24n * 60n * 60_000n },
];

export function RecordShare() {
  const { recordId } = useParams<{ recordId: string }>();
  const [qr, setQr] = useState<string | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [grantId, setGrantId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [ttlMs, setTtlMs] = useState<bigint>(60n * 60_000n); // default 1 hour
  const [link, setLink] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const payload = link ?? qr;
    if (!payload || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, payload, {
      errorCorrectionLevel: 'M',
      width: 288,
      margin: 2,
    }).catch(() => {/* non-fatal */});
  }, [qr, link]);

  const handleCopy = () => {
    if (!grantId) return;
    navigator.clipboard.writeText(grantId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleCopyLink = () => {
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    });
  };

  const handleIssue = async () => {
    if (!recordId) return;
    setBusy(true);
    setErr(null);
    try {
      const { tx, token } = buildIssueGrantTx({
        recordId: recordId as ObjectId,
        scope: SCOPE.Single,
        ttlMs,
      });
      // Execute first and surface the QR immediately: the preimage lives only
      // in this closure, so the QR MUST be shown even if the effect lookup
      // below fails — otherwise the (already on-chain) grant becomes unusable.
      const { digest } = await getPatientSession().signAndExecute(tx);
      setDigest(digest);
      setQr(token.qrPayload);
      // Best-effort: pull the freshly created AccessGrant id from tx effects so
      // the patient can hand it to the doctor (alongside the QR token).
      try {
        const tb = await suiJsonRpc.waitForTransaction({
          digest,
          options: { showObjectChanges: true },
        });
        const created = (tb.objectChanges ?? []).find(
          (c: any) =>
            c.type === 'created' &&
            typeof c.objectType === 'string' &&
            c.objectType.endsWith('::access_grant::AccessGrant'),
        ) as any;
        if (created?.objectId) {
          setGrantId(created.objectId);
          setLink(buildConsumeLink(window.location.origin, created.objectId, token.qrPayload));
        }
      } catch {
        // non-fatal: QR is still usable, doctor can look up grant via explorer
      }
      // token.preimage / token.tokenHash drop out of scope after this fn returns.
    } catch (e) {
      setErr(explainMoveError(e).hint);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2 style={{ fontSize: 24, marginBottom: 8, color: 'var(--primary)' }}>Share Health Record</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Grant temporary access to a healthcare provider.</p>
      <div style={{ marginBottom: 24 }}>
        <code className="code-inset" style={{ fontSize: 11 }}>{recordId}</code>
      </div>

      {!qr && (
        <div style={{ textAlign: 'center', padding: '40px 0', background: 'var(--primary-soft)', borderRadius: 16 }}>
          <div style={{ marginBottom: 20 }}>
            <label className="input-label" style={{ display: 'block', marginBottom: 8 }}>Link valid for</label>
            <select
              aria-label="Access link validity"
              value={ttlMs.toString()}
              onChange={(e) => setTtlMs(BigInt(e.target.value))}
              disabled={busy}
              style={{ padding: '8px 12px', fontSize: 14, borderRadius: 8, border: '1px solid var(--border)' }}
            >
              {TTL_OPTIONS.map((o) => (
                <option key={o.label} value={o.ms.toString()}>{o.label}</option>
              ))}
            </select>
          </div>
          <button
            className="btn-primary"
            style={{ padding: '12px 24px', fontSize: 16 }}
            onClick={handleIssue}
            disabled={busy}
          >
            {busy ? '🚀 Issuing Grant…' : '🎫 Issue single-use access link'}
          </button>
          <p style={{ marginTop: 16, fontSize: 12, color: 'var(--primary)', fontWeight: 500 }}>
            Generates a one-time access token anchored on-chain.
          </p>
        </div>
      )}

      {err && (
        <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: 'var(--error-soft)', color: 'var(--error)', fontSize: 13, fontWeight: 500 }}>
          ⚠️ {err}
        </div>
      )}

      {qr && (
        <section style={{ marginTop: 16 }}>
          <div style={{ background: 'var(--accent-soft)', padding: 16, borderRadius: 12, border: '1px solid var(--accent)', marginBottom: 24, textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--primary)', fontWeight: 600 }}>
              Show the QR code to your doctor.
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
              Valid for {TTL_OPTIONS.find((o) => o.ms === ttlMs)?.label ?? 'a limited time'} • Single-use only
            </p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 32 }}>
            <div style={{ 
              background: 'white', 
              padding: 24, 
              borderRadius: 24, 
              boxShadow: 'var(--shadow-lg)',
              border: '1px solid var(--border)'
            }}>
              <canvas
                ref={canvasRef}
                aria-label="QR code for access token"
                style={{ display: 'block' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {link ? (
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Share Link (QR encodes this)</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <pre className="pre-block" style={{
                    flex: 1, padding: '12px 16px', margin: 0, fontSize: 12, wordBreak: 'break-all',
                  }}>{link}</pre>
                  <button
                    onClick={handleCopyLink}
                    className="btn-secondary"
                    aria-label="Copy share link to clipboard"
                    style={{ padding: '12px 16px', borderRadius: 12, minWidth: 80 }}
                  >
                    {copiedLink ? '✅' : '🔗'} {copiedLink ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ padding: 12, borderRadius: 8, background: 'var(--primary-soft)', fontSize: 12, color: 'var(--text-muted)' }}>
                Resolving grant from blockchain… QR currently encodes the raw token; the doctor can paste it manually if the share link does not appear.
              </div>
            )}
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Grant Object ID</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <pre className="pre-block" style={{
                  flex: 1, padding: '12px 16px', margin: 0, fontSize: 12, wordBreak: 'break-all',
                }}>{grantId ?? '(Resolving from blockchain…)'}</pre>
                <button
                  onClick={handleCopy}
                  disabled={!grantId}
                  className="btn-secondary"
                  aria-label="Copy grant ID to clipboard"
                  style={{ padding: '12px 16px', borderRadius: 12, minWidth: 80 }}
                >
                  {copied ? '✅' : '📋'} {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Access Token (Raw)</p>
              <pre className="pre-block" style={{
                padding: '12px 16px', border: '1px dashed var(--border)', fontSize: 11, color: 'var(--text-muted)'
              }}>{qr}</pre>
            </div>
          </div>

          {digest && (
            <div style={{ marginTop: 32, textAlign: 'center' }}>
              <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Transaction Hash: <code style={{ fontSize: 10 }}>{digest}</code>
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

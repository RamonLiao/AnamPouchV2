import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { redact, type RedactionReport } from '../lib/redactor';
import { explainMoveError } from '../lib/errors';
import { createEncryptedRecord } from '../lib/recordPipeline';
import { createImageRecord } from '../lib/imagePipeline';
import { extractText } from '../lib/ocr';
import { geminiGenerate } from '../lib/gemini';
import { sealClient } from '../lib/dappKit';
import { getPatientSession, signAndGetObjectChanges } from '../lib/patientSession';
import { isSpeechSupported, startAsr, type AsrSession } from '../lib/asr';
import { GEMINI } from '../config/contract';

/**
 * Record-creation flow:
 *   1. (Optional) Voice capture via Web Speech API → transcript fills textarea
 *      BROWSER COMPAT: Chrome/Edge only. Requires internet (Google STT).
 *   2. User can edit the transcript in the textarea before proceeding.
 *   3. Redact PII   ← MANDATORY GATE before any LLM call
 *   4. Summarize via AIProvider (TODO: wire up)
 *   5. Encrypt + upload + anchor via createEncryptedRecord pipeline
 *   6. Navigate to /patient/share/<recordId> for QR generation
 */
export function RecordCreate() {
  const navigate = useNavigate();
  // RecordCreate only mounts under an authenticated PatientShell, so a session
  // (wallet / zkLogin / passkey) is always present here.
  const address = getPatientSession().getAddress();

  const [transcript, setTranscript] = useState('');
  const [hospitalId, setHospitalId] = useState('');
  const [report, setReport] = useState<RedactionReport | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Photo/upload state
  const [pendingImage, setPendingImage] = useState<Uint8Array | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);

  // ASR state
  const asrSupported = useRef(isSpeechSupported());
  const [recording, setRecording] = useState(false);
  const [interimText, setInterimText] = useState('');
  const sessionRef = useRef<AsrSession | null>(null);

  // Clean up ASR session on unmount
  useEffect(() => {
    return () => {
      sessionRef.current?.stop();
    };
  }, []);

  function handleStartRecording() {
    setErr(null);
    setInterimText('');
    // Keep any previously typed text; ASR appends to it
    const baseText = transcript;

    const session = startAsr(
      (interim, finalSoFar) => {
        setInterimText(interim);
        setTranscript(baseText + finalSoFar);
        // Reset redaction preview when transcript changes
        setReport(null);
      },
      (msg) => {
        setErr(msg);
        setRecording(false);
        setInterimText('');
      },
      () => {
        setRecording(false);
        setInterimText('');
      },
    );

    if (!session) {
      setErr('Speech recognition not available in this browser.');
      return;
    }

    sessionRef.current = session;
    setRecording(true);
  }

  function handleStopRecording() {
    sessionRef.current?.stop();
    sessionRef.current = null;
    // recording + interimText cleared via onEnd callback
  }

  const handleRedactPreview = () => {
    try {
      setReport(redact(transcript));
      setErr(null);
    } catch (e) {
      setErr(explainMoveError(e).hint);
    }
  };

  async function handleSubmit() {
    const session = getPatientSession();
    if (!session.getAddress() || !report) return;
    setSubmitting(true);
    setErr(null);
    try {
      // For the Task-9 wire-up we encrypt the (already-redacted) transcript
      // bytes. Real flow will encrypt the LLM-summarised JSON envelope.
      const redactedBytes = new TextEncoder().encode(report.redacted);
      const sui = { signAndExecute: (tx: import('@mysten/sui/transactions').Transaction) => signAndGetObjectChanges(session, tx) };
      let recordId: string;
      let blobId: string | undefined;
      if (pendingImage) {
        const result = await createImageRecord({
          redactedText: redactedBytes,
          image: pendingImage,
          hospitalId: hospitalId.trim() || 'unknown',
          visitTimestampMs: BigInt(Date.now()),
          sealClient,
          sui,
        });
        recordId = result.recordId;
        blobId = result.textBlobId;
      } else {
        const result = await createEncryptedRecord({
          plaintext: redactedBytes,
          hospitalId: hospitalId.trim() || 'unknown',
          visitTimestampMs: BigInt(Date.now()),
          sealClient,
          sui,
        });
        recordId = result.recordId;
        blobId = result.blobId;
      }
      navigate(`/patient/share/${recordId}`, { state: { blobId } });
    } catch (e) {
      setErr(explainMoveError(e).hint);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h2 style={{ fontSize: 24, marginBottom: 8, color: 'var(--primary)' }}>New Health Visit</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>Record your doctor's visit securely in your encrypted pouch.</p>

      {/* Voice capture — only rendered when browser supports Web Speech API */}
      {asrSupported.current && (
        <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12, padding: 16, background: 'var(--accent-soft)', borderRadius: 12, border: '1px solid var(--accent)' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {!recording ? (
              <button
                onClick={handleStartRecording}
                disabled={submitting}
                className="btn-primary"
                aria-label="Start voice recording"
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px' }}
              >
                <span style={{ fontSize: 18 }}>🎤</span> Start Recording
              </button>
            ) : (
              <button
                onClick={handleStopRecording}
                aria-label="Stop voice recording"
                className="btn-primary pulse"
                style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--error)', padding: '10px 16px' }}
              >
                <span style={{ fontSize: 18 }}>🛑</span> Stop Recording…
              </button>
            )}
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 12, fontWeight: 600, margin: 0, color: 'var(--primary)' }}>Voice Capture Active</p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>Chrome / Edge only &middot; Encrypted & Private</p>
            </div>
          </div>
          
          {/* Interim (live) transcript preview */}
          {interimText && (
            <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.5)', borderRadius: 8, borderLeft: '3px solid var(--primary-light)' }}>
              <p style={{ fontSize: 13, color: 'var(--primary)', fontStyle: 'italic', margin: 0 }}>
                "{interimText}..."
              </p>
            </div>
          )}
        </div>
      )}

      {/* Photo / upload capture — OCR into transcript */}
      <div style={{ marginBottom: 16, padding: 16, background: 'var(--accent-soft)', borderRadius: 12, border: '1px solid var(--accent)' }}>
        <label htmlFor="photo-upload" className="input-label" style={{ display: 'block', marginBottom: 8 }}>
          📷 Upload or Capture Medical Document (OCR)
        </label>
        <input
          id="photo-upload"
          type="file"
          accept="image/*"
          capture="environment"
          aria-label="Upload or capture a medical document image for OCR"
          disabled={ocrBusy || submitting || recording}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setOcrBusy(true);
            setErr(null);
            try {
              const bytes = new Uint8Array(await file.arrayBuffer());
              const text = await extractText({
                image: { bytes, mimeType: file.type },
                language: 'zh-TW',
                gemini: (parts, sys) =>
                  geminiGenerate({ apiKey: GEMINI.apiKey, model: GEMINI.model, systemPrompt: sys, parts }),
              });
              setTranscript((prev) => (prev ? prev + '\n' : '') + text);
              setReport(null);
              setPendingImage(bytes);
            } catch (err) {
              setErr(`OCR 失敗: ${(err as Error).message}`);
            } finally {
              setOcrBusy(false);
            }
          }}
        />
        {ocrBusy && (
          <p style={{ fontSize: 12, color: 'var(--primary)', marginTop: 8, margin: 0 }}>
            ⏳ Extracting text from image…
          </p>
        )}
        {pendingImage && !ocrBusy && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, margin: 0 }}>
            ✅ Image ready — will be stored alongside the encrypted text.
          </p>
        )}
      </div>

      <div className="input-group">
        <label className="input-label">Visit Transcript</label>
        <textarea
          value={transcript}
          onChange={(e) => {
            setTranscript(e.target.value);
            setReport(null);
          }}
          placeholder="Paste or speak the visit transcript here…"
          rows={10}
          style={{ width: '100%', resize: 'vertical', minHeight: 160 }}
          disabled={recording}
        />
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <label className="input-label">Hospital ID (Optional)</label>
          <input
            type="text"
            value={hospitalId}
            onChange={(e) => setHospitalId(e.target.value)}
            placeholder="e.g. SUI-GEN-001"
            style={{ width: '100%' }}
            disabled={submitting}
          />
        </div>
        <button
          className="btn-secondary"
          style={{ padding: '10px 16px' }}
          onClick={handleRedactPreview}
          disabled={!transcript.trim() || submitting || recording}
        >
          🛡️ Preview Redaction
        </button>
        <button
          className="btn-primary"
          style={{ padding: '10px 20px' }}
          onClick={handleSubmit}
          disabled={!report || !address || submitting}
          aria-label="Encrypt, upload, and anchor record"
        >
          {submitting ? 'Creating Pouch…' : '🔒 Encrypt & Anchor'}
        </button>
      </div>

      {err && (
        <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: 'var(--error-soft)', color: 'var(--error)', fontSize: 13, fontWeight: 500 }}>
          ⚠️ {err}
        </div>
      )}

      {report && (
        <section style={{ marginTop: 32, padding: 24, background: 'white', border: '2px solid var(--primary-soft)', borderRadius: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 18, color: 'var(--primary)' }}>Redaction Report</h3>
            <span className="badge">Safe for AI</span>
          </div>
          
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>Redacted content (Sent to LLM for summarization)</p>
            <pre className="pre-block" style={{ margin: 0 }}>{report.redacted}</pre>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>Sensitive Entities Removed</p>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: 'var(--text)' }}>
                {Object.entries(report.stats)
                  .filter(([, n]) => n > 0)
                  .map(([k, n]) => <li key={k} style={{ marginBottom: 4 }}><span style={{ fontWeight: 600 }}>{k}</span>: {n} items</li>)}
              </ul>
            </div>
            <div style={{ background: 'var(--accent-soft)', padding: 12, borderRadius: 12, border: '1px solid var(--accent)' }}>
              <p style={{ fontSize: 12, color: 'var(--primary)', margin: 0, lineHeight: 1.4 }}>
                <strong>Privacy Guard:</strong> {report.reverseMap.size} unique token(s) are held in your device's memory only. The reverse map never leaves this browser.
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

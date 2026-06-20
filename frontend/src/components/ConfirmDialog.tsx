import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, the confirm button is shown in a destructive (red) style. */
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Minimal accessible confirmation modal for destructive actions (revoke).
 * Escape cancels; focus moves to the confirm button on open. The backdrop
 * click cancels only when not busy so an in-flight tx can't be abandoned.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      onClick={() => { if (!busy) onCancel(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white', borderRadius: 16, padding: 24, maxWidth: 420, width: '100%',
          boxShadow: 'var(--shadow-md, 0 12px 32px rgba(0,0,0,0.18))',
        }}
      >
        <h3 id="confirm-title" style={{ margin: '0 0 8px', fontSize: 18, color: 'var(--text)' }}>{title}</h3>
        <p id="confirm-message" style={{ margin: '0 0 24px', fontSize: 14, lineHeight: 1.6, color: 'var(--text-muted)' }}>
          {message}
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy} style={{ fontSize: 14 }}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={destructive ? undefined : 'btn-primary'}
            style={destructive ? {
              fontSize: 14, padding: '10px 20px', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: 'var(--error)', color: 'white',
            } : { fontSize: 14 }}
          >
            {busy ? '⏳ Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * asr.ts — Thin wrapper around Web Speech API (SpeechRecognition).
 *
 * Browser compat: Chrome 33+, Edge 79+. Firefox / Safari do NOT support
 * SpeechRecognition without a flag (as of 2026-05). The helpers below return
 * null / false when unsupported so callers can hide the UI gracefully.
 *
 * Privacy note: Browser ASR sends audio to Google's servers (for Chrome).
 * The transcript is text-only; the audio blob is never retained here.
 * The transcript MUST pass through redact() before any LLM call — enforced
 * at the RecordCreate level.
 */

/// <reference types="@types/dom-speech-recognition" />

/** Returns true if the current browser supports SpeechRecognition. */
export function isSpeechSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
  );
}

type TranscriptCallback = (interim: string, final: string) => void;
type ErrorCallback = (msg: string) => void;
type EndCallback = () => void;

export interface AsrSession {
  /** Stop recognition and commit the current transcript. */
  stop(): void;
}

/**
 * Start a continuous speech recognition session.
 *
 * @param onTranscript called with (interim, accumulated-final) on each result
 * @param onError      called with a human-readable error string
 * @param onEnd        called when recognition ends (after stop() or timeout)
 * @returns AsrSession or null if unsupported
 */
export function startAsr(
  onTranscript: TranscriptCallback,
  onError: ErrorCallback,
  onEnd: EndCallback,
): AsrSession | null {
  const Ctor =
    (window as unknown as { SpeechRecognition?: typeof SpeechRecognition })
      .SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition })
      .webkitSpeechRecognition;

  if (!Ctor) return null;

  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  let finalTranscript = '';

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (!result) continue;
      const alt = result[0];
      if (!alt) continue;
      if (result.isFinal) {
        finalTranscript += alt.transcript + ' ';
      } else {
        interim += alt.transcript;
      }
    }
    onTranscript(interim, finalTranscript);
  };

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    const msg =
      event.error === 'not-allowed'
        ? 'Microphone permission denied.'
        : event.error === 'no-speech'
          ? 'No speech detected.'
          : `ASR error: ${event.error}`;
    onError(msg);
  };

  recognition.onend = () => {
    onEnd();
  };

  recognition.start();

  return {
    stop() {
      recognition.stop();
    },
  };
}

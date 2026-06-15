/**
 * One-time access token (preimage) generation & encoding.
 *
 * SECURITY (T13/T14 from threat-model):
 *   - Preimage MUST be generated with crypto.getRandomValues. Never derive from
 *     timestamp, uuid, Math.random, or session ID.
 *   - Preimage is 32 bytes raw. We hash with sha3-256 on-chain.
 *   - Transport via QR uses base64url (URL-safe, no padding). Decode back to
 *     Uint8Array before passing to consume_grant — DO NOT re-hex round-trip,
 *     it's pointless cost and an extra place to introduce bugs.
 *   - Never log, persist, or send the preimage to any backend you don't trust.
 */

import { sha3_256 } from '@noble/hashes/sha3.js';

export const PREIMAGE_LEN = 32;
export const TOKEN_HASH_LEN = 32;

export interface AccessToken {
  /** Raw 32-byte preimage. Held by patient, transported via QR to doctor. */
  preimage: Uint8Array;
  /** sha3-256(preimage). This is what gets anchored on-chain via issue_grant. */
  tokenHash: Uint8Array;
  /** base64url encoding of preimage for QR payload. */
  qrPayload: string;
}

/** Generate a fresh single-use access token. CSPRNG-backed. */
export function generateAccessToken(): AccessToken {
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('CSPRNG unavailable — refusing to issue grant with weak entropy');
  }
  const preimage = new Uint8Array(PREIMAGE_LEN);
  crypto.getRandomValues(preimage);

  const tokenHash = sha3_256(preimage);
  return {
    preimage,
    tokenHash,
    qrPayload: bytesToBase64Url(preimage),
  };
}

/** Decode a QR payload back to the raw preimage. Validates length. */
export function decodeQrPayload(payload: string): Uint8Array {
  const bytes = base64UrlToBytes(payload);
  if (bytes.length !== PREIMAGE_LEN) {
    throw new Error(`Invalid preimage length: ${bytes.length} (expected ${PREIMAGE_LEN})`);
  }
  return bytes;
}

// === base64url helpers (no deps) ===

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=');
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

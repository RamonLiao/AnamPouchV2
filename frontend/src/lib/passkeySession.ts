/**
 * passkeySession — WebAuthn / PasskeyKeypair adapter for PatientSession.
 *
 * First run:  call `registerPasskey()` → creates a new WebAuthn credential,
 *             stores the credential ID + public key bytes in localStorage,
 *             returns a PasskeySession.
 *
 * Returning:  call `restorePasskeySession()` → loads stored state from
 *             localStorage and reconstructs the PasskeyKeypair using
 *             `signAndRecover` to identify the correct public key, then
 *             returns a PasskeySession.
 *
 * Hackathon shortcuts (documented):
 *   - Credential ID and public key bytes stored in localStorage unencrypted.
 *     TODO(prod): store server-side with user authentication, or encrypt with
 *     a PIN-derived key.
 *   - No multi-device sync; credential is per-browser-origin.
 */

import {
  BrowserPasskeyProvider,
  PasskeyKeypair,
  findCommonPublicKey,
} from '@mysten/sui/keypairs/passkey';
import type { Transaction } from '@mysten/sui/transactions';
import type { PatientSession } from './patientSession';
import { dAppKit } from './dappKit';

// ─────────────── storage ─────────────────────────────────────────────────────

const STORAGE_KEY_CRED_ID = 'passkey_credential_id';
const STORAGE_KEY_PUBKEY = 'passkey_public_key';

/** credential ID as hex string */
function saveCredential(credentialId: Uint8Array, publicKey: Uint8Array): void {
  localStorage.setItem(STORAGE_KEY_CRED_ID, toHex(credentialId));
  localStorage.setItem(STORAGE_KEY_PUBKEY, toHex(publicKey));
}

function loadCredential(): { credentialId: Uint8Array; publicKey: Uint8Array } | null {
  const credHex = localStorage.getItem(STORAGE_KEY_CRED_ID);
  const pkHex = localStorage.getItem(STORAGE_KEY_PUBKEY);
  if (!credHex || !pkHex) return null;
  return { credentialId: fromHex(credHex), publicKey: fromHex(pkHex) };
}

export function clearPasskeySession(): void {
  localStorage.removeItem(STORAGE_KEY_CRED_ID);
  localStorage.removeItem(STORAGE_KEY_PUBKEY);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ─────────────── helpers ─────────────────────────────────────────────────────

function makeProvider(): BrowserPasskeyProvider {
  return new BrowserPasskeyProvider('AnamPouch', {
    rp: { name: 'AnamPouch', id: window.location.hostname },
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
    },
  });
}

// ─────────────── public API ──────────────────────────────────────────────────

/**
 * Creates a new passkey credential and returns a session.
 * Overwrites any previously stored credential for this origin.
 */
export async function registerPasskey(): Promise<PasskeySession> {
  const provider = makeProvider();
  const keypair = await PasskeyKeypair.getPasskeyInstance(provider);

  const credentialId = keypair.getCredentialId();
  if (!credentialId) {
    throw new Error('PasskeyKeypair did not return a credential ID after registration');
  }

  const publicKey = keypair.getPublicKey().toRawBytes();
  saveCredential(credentialId, publicKey);

  return new PasskeySession(keypair);
}

/**
 * Recovers an existing passkey session from localStorage.
 * Uses two sign+recover calls to uniquely identify the stored public key.
 *
 * Returns null if no stored credential exists.
 */
export async function restorePasskeySession(): Promise<PasskeySession | null> {
  const stored = loadCredential();
  if (!stored) return null;

  const provider = makeProvider();

  // We stored the exact public key at registration, so a single sign+recover is
  // enough: signAndRecover returns the candidate public keys consistent with the
  // signature; pick the one matching what we saved. This avoids a second WebAuthn
  // prompt (two calls can't run concurrently anyway — "A request is already
  // pending" — and serial calls mean two dialogs the user must answer identically).
  const msg = new TextEncoder().encode('anampouch-recovery-1');
  const candidates = await PasskeyKeypair.signAndRecover(provider, msg);

  const storedHex = toHex(stored.publicKey);
  const match = candidates.find((pk) => toHex(pk.toRawBytes()) === storedHex);

  // Fallback: stored pubkey not among candidates (e.g. credential created before
  // we persisted the key). Do a second recovery and intersect, then re-persist.
  let commonPk = match ?? null;
  if (!commonPk) {
    const msg2 = new TextEncoder().encode('anampouch-recovery-2');
    const candidates2 = await PasskeyKeypair.signAndRecover(provider, msg2);
    commonPk = findCommonPublicKey(candidates, candidates2);
    saveCredential(stored.credentialId, commonPk.toRawBytes());
  }

  const keypair = new PasskeyKeypair(commonPk.toRawBytes(), provider, stored.credentialId);
  return new PasskeySession(keypair);
}

// ─────────────── PatientSession adapter ──────────────────────────────────────

export class PasskeySession implements PatientSession {
  readonly authMethod = 'passkey' as const;
  private keypair: PasskeyKeypair;

  constructor(keypair: PasskeyKeypair) {
    this.keypair = keypair;
  }

  getAddress(): string {
    return this.keypair.getPublicKey().toSuiAddress();
  }

  async signAndExecute(tx: Transaction): Promise<{ digest: string }> {
    const client = dAppKit.getClient() as unknown as import('@mysten/sui/grpc').SuiGrpcClient;
    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: this.keypair,
    });

    if (result.$kind === 'FailedTransaction') {
      throw new Error('Passkey transaction failed');
    }
    return { digest: result.Transaction.digest };
  }

  async signPersonalMessage(message: Uint8Array): Promise<{ signature: string }> {
    const { signature } = await this.keypair.signPersonalMessage(message);
    return { signature };
  }
}

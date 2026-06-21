import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared spies must live in vi.hoisted so the hoisted vi.mock factory can see them.
const h = vi.hoisted(() => {
  const signAndRecover = vi.fn();
  const findCommonPublicKey = vi.fn();
  return { signAndRecover, findCommonPublicKey };
});

vi.mock('./dappKit', () => ({ dAppKit: { getClient: vi.fn() } }));
vi.mock('@mysten/sui/keypairs/passkey', () => ({
  BrowserPasskeyProvider: class {},
  PasskeyKeypair: class {
    static signAndRecover = h.signAndRecover;
    pk: Uint8Array;
    constructor(pk: Uint8Array) {
      this.pk = pk;
    }
    getPublicKey() {
      return {
        toSuiAddress: () => '0xpk',
        toRawBytes: () => this.pk,
      };
    }
  },
  findCommonPublicKey: h.findCommonPublicKey,
}));

import {
  PasskeySession,
  restorePasskeySession,
  loginPasskeyDiscoverable,
} from './passkeySession';

function pubkey(bytes: number[]) {
  return { toRawBytes: () => new Uint8Array(bytes) };
}

describe('PasskeySession.signPersonalMessage', () => {
  it('delegates to the keypair and returns the signature', async () => {
    const keypair = {
      getPublicKey: () => ({ toSuiAddress: () => '0xpk' }),
      signPersonalMessage: vi.fn().mockResolvedValue({ signature: 'PK_SIG', bytes: 'b' }),
    };
    const session = new PasskeySession(keypair as never);
    const msg = new Uint8Array([7]);
    const res = await session.signPersonalMessage(msg);

    expect(keypair.signPersonalMessage).toHaveBeenCalledWith(msg);
    expect(res).toEqual({ signature: 'PK_SIG' });
  });
});

describe('restorePasskeySession', () => {
  beforeEach(() => {
    localStorage.clear();
    h.signAndRecover.mockReset();
    h.findCommonPublicKey.mockReset();
  });

  it('returns null when no credential is stored', async () => {
    expect(await restorePasskeySession()).toBeNull();
    expect(h.signAndRecover).not.toHaveBeenCalled();
  });

  it('recovers with a SINGLE prompt when the stored pubkey is among candidates', async () => {
    // stored: credId 0xaa, pubkey 0xaabb
    localStorage.setItem('passkey_credential_id', 'aa');
    localStorage.setItem('passkey_public_key', 'aabb');
    // candidates from one recover: a non-match and the match
    h.signAndRecover.mockResolvedValueOnce([pubkey([0x11, 0x22]), pubkey([0xaa, 0xbb])]);

    const session = await restorePasskeySession();

    expect(session).not.toBeNull();
    // Exactly one WebAuthn prompt — the whole point of the fix.
    expect(h.signAndRecover).toHaveBeenCalledTimes(1);
    expect(h.findCommonPublicKey).not.toHaveBeenCalled();
  });

  it('falls back to a second recover + intersect when stored pubkey is not a candidate', async () => {
    localStorage.setItem('passkey_credential_id', 'aa');
    localStorage.setItem('passkey_public_key', 'ffff'); // not in candidates
    h.signAndRecover
      .mockResolvedValueOnce([pubkey([0x11, 0x22])])
      .mockResolvedValueOnce([pubkey([0x33, 0x44])]);
    h.findCommonPublicKey.mockReturnValue(pubkey([0x99, 0x99]));

    const session = await restorePasskeySession();

    expect(session).not.toBeNull();
    expect(h.signAndRecover).toHaveBeenCalledTimes(2);
    expect(h.findCommonPublicKey).toHaveBeenCalledTimes(1);
    // re-persisted the recovered key
    expect(localStorage.getItem('passkey_public_key')).toBe('9999');
  });

  it('restores from a pubkey-only cache (no credentialId) — discoverable fast-path', async () => {
    // Only the pubkey is cached (e.g. a prior discoverable login). Must NOT bail.
    localStorage.setItem('passkey_public_key', 'aabb');
    h.signAndRecover.mockResolvedValueOnce([pubkey([0xaa, 0xbb])]);

    const session = await restorePasskeySession();

    expect(session).not.toBeNull();
    expect(h.signAndRecover).toHaveBeenCalledTimes(1);
  });
});

describe('loginPasskeyDiscoverable', () => {
  beforeEach(() => {
    localStorage.clear();
    h.signAndRecover.mockReset();
    h.findCommonPublicKey.mockReset();
  });

  it('recovers storage-less via two signed messages + intersection', async () => {
    h.signAndRecover
      .mockResolvedValueOnce([pubkey([0x11, 0x22]), pubkey([0xab, 0xcd])])
      .mockResolvedValueOnce([pubkey([0x33, 0x44]), pubkey([0xab, 0xcd])]);
    h.findCommonPublicKey.mockReturnValue(pubkey([0xab, 0xcd]));

    const session = await loginPasskeyDiscoverable();

    expect(session).not.toBeNull();
    // TWO prompts — intersection requires two distinct signatures; this is the
    // documented cost of cross-browser login with no stored pubkey.
    expect(h.signAndRecover).toHaveBeenCalledTimes(2);
    expect(h.findCommonPublicKey).toHaveBeenCalledTimes(1);
    // Caches pubkey for the next single-prompt fast-path, and stores NO stale credId.
    expect(localStorage.getItem('passkey_public_key')).toBe('abcd');
    expect(localStorage.getItem('passkey_credential_id')).toBeNull();
  });

  it('propagates when intersection is ambiguous (never guesses an address)', async () => {
    h.signAndRecover
      .mockResolvedValueOnce([pubkey([0x11, 0x22])])
      .mockResolvedValueOnce([pubkey([0x33, 0x44])]);
    h.findCommonPublicKey.mockImplementation(() => {
      throw new Error('no common public key');
    });

    await expect(loginPasskeyDiscoverable()).rejects.toThrow('no common public key');
    // Nothing persisted on failure.
    expect(localStorage.getItem('passkey_public_key')).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dappKit so importing zkLoginSession doesn't construct gRPC/Seal clients.
vi.mock('./dappKit', () => ({
  dAppKit: { getClient: vi.fn() },
}));

// Spy on the Ed25519 ephemeral signer + the zkLogin signature wrapper.
const h = vi.hoisted(() => ({
  signPersonalMessage: vi.fn(),
  getZkLoginSignature: vi.fn(() => 'ZK_WRAPPED_SIG'),
}));
vi.mock('@mysten/sui/keypairs/ed25519', () => ({
  Ed25519Keypair: {
    fromSecretKey: () => ({ signPersonalMessage: h.signPersonalMessage }),
  },
}));
vi.mock('@mysten/sui/zklogin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mysten/sui/zklogin')>()),
  getZkLoginSignature: h.getZkLoginSignature,
}));

import { ZkLoginSession, type ZkLoginSessionState, __setEpochFetcherForTest, __resetEpochFetcherForTest } from './zkLoginSession';

function state(maxEpoch: number): ZkLoginSessionState {
  return {
    address: '0xzk',
    proof: {
      proofPoints: { a: [], b: [[]], c: [] },
      issBase64Details: { value: 'v', indexMod4: 1 },
      headerBase64: 'h',
    },
    ephemeralSecretKey: 'suiprivkey1xxxx',
    maxEpoch,
    randomness: 'r',
    userSalt: '',
    addressSeed: '12345',
    sub: 'sub',
    iss: 'https://accounts.google.com',
    aud: 'aud',
    keyClaimName: 'sub',
  };
}

describe('ZkLoginSession.signPersonalMessage', () => {
  beforeEach(() => {
    h.signPersonalMessage.mockReset().mockResolvedValue({ signature: 'EPH_SIG' });
    h.getZkLoginSignature.mockClear();
  });

  afterEach(() => {
    __resetEpochFetcherForTest();
  });

  it('ephemeral-signs and wraps via getZkLoginSignature when epoch is fresh', async () => {
    __setEpochFetcherForTest(async () => 10); // currentEpoch 10, maxEpoch 12 → valid
    const session = new ZkLoginSession(state(12));
    const res = await session.signPersonalMessage(new Uint8Array([9, 9]));

    expect(h.signPersonalMessage).toHaveBeenCalledWith(new Uint8Array([9, 9]));
    expect(h.getZkLoginSignature).toHaveBeenCalledWith(
      expect.objectContaining({ maxEpoch: '12', userSignature: 'EPH_SIG' }),
    );
    expect(res).toEqual({ signature: 'ZK_WRAPPED_SIG' });
  });

  it('fails fast with a friendly message when maxEpoch < currentEpoch', async () => {
    __setEpochFetcherForTest(async () => 20); // currentEpoch 20 > maxEpoch 12 → expired
    const session = new ZkLoginSession(state(12));
    await expect(session.signPersonalMessage(new Uint8Array([1]))).rejects.toThrow(
      /sign in with Google again/i,
    );
    expect(h.signPersonalMessage).not.toHaveBeenCalled();
  });

  it('signs successfully when maxEpoch === currentEpoch (inclusive boundary)', async () => {
    __setEpochFetcherForTest(async () => 12); // currentEpoch === maxEpoch → still valid
    const session = new ZkLoginSession(state(12));
    const res = await session.signPersonalMessage(new Uint8Array([7]));
    expect(res).toEqual({ signature: 'ZK_WRAPPED_SIG' });
  });
});

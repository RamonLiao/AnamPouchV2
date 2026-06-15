import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted lets us share spies with hoisted vi.mock factories.
const h = vi.hoisted(() => {
  const setSig = vi.fn();
  const getPersonalMessage = vi.fn(() => new Uint8Array([1, 2]));
  const sessionCreate = vi.fn(async () => ({
    getPersonalMessage,
    setPersonalMessageSignature: setSig,
  }));
  const moveCall = vi.fn();
  const setSender = vi.fn();
  const build = vi.fn(async () => new Uint8Array([9, 9, 9]));
  const fetchBlob = vi.fn();
  return { setSig, getPersonalMessage, sessionCreate, moveCall, setSender, build, fetchBlob };
});

vi.mock('@mysten/seal', () => ({
  SessionKey: { create: (...a: unknown[]) => (h.sessionCreate as any)(...a) },
}));

vi.mock('@mysten/sui/transactions', () => {
  class FakeTx {
    pure = { vector: (_t: string, v: number[]) => ({ kind: 'pure', v }) };
    object = (id: string) => ({ kind: 'object', id });
    moveCall = h.moveCall;
    setSender = h.setSender;
    build = h.build;
  }
  return { Transaction: FakeTx };
});

vi.mock('./walrus', () => ({ fetchBlob: (...a: unknown[]) => h.fetchBlob(...a) }));

vi.mock('../config/contract', () => ({
  CONTRACT: {
    packageId: '0xPKG',
    fns: { sealApproveOwner: '0xPKG::record_anchor::seal_approve_owner' },
  },
  SEAL: { sessionTtlMs: 5 * 60 * 1000 },
  WALRUS: { aggregatorUrl: 'https://agg.test' },
}));

import { viewOwnRecord } from './patientPipeline';

const CONTENT_HASH = Array.from({ length: 32 }, (_, i) => i);
const BLOB_BYTES = Array.from(new TextEncoder().encode('blob-xyz'));

function makeDeps(overrides: Partial<Parameters<typeof viewOwnRecord>[0]> = {}) {
  const cipher = new Uint8Array([0xaa, 0xbb]);
  h.fetchBlob.mockResolvedValue(cipher);
  return {
    recordId: '0xRECORD' as `0x${string}`,
    address: '0xPATIENT',
    signPersonalMessage: vi.fn(async () => ({ signature: 'SIG' })),
    suiClient: {
      getObject: vi.fn(async () => ({
        data: {
          content: {
            fields: { walrus_blob_id: BLOB_BYTES, content_hash: CONTENT_HASH },
          },
        },
      })),
    },
    sealCompatibleClient: {} as any,
    sealClient: {
      decrypt: vi.fn(async () => new TextEncoder().encode('hello world')),
    },
    onStage: vi.fn(),
    ...overrides,
  };
}

describe('viewOwnRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: fetches blob, builds owner PTB, decrypts plaintext', async () => {
    const deps = makeDeps();
    const out = await viewOwnRecord(deps);

    expect(out).toBe('hello world');
    expect(h.fetchBlob).toHaveBeenCalledWith('blob-xyz', 'https://agg.test');
    expect(deps.signPersonalMessage).toHaveBeenCalledWith(new Uint8Array([1, 2]));
    expect(h.setSig).toHaveBeenCalledWith('SIG');
    expect(h.moveCall).toHaveBeenCalledWith({
      target: '0xPKG::record_anchor::seal_approve_owner',
      arguments: [
        { kind: 'pure', v: CONTENT_HASH },
        { kind: 'object', id: '0xRECORD' },
      ],
    });
    expect(h.setSender).toHaveBeenCalledWith('0xPATIENT');
    expect(deps.sealClient.decrypt).toHaveBeenCalledWith({
      data: new Uint8Array([0xaa, 0xbb]),
      sessionKey: expect.anything(),
      txBytes: new Uint8Array([9, 9, 9]),
    });
    expect(deps.onStage).toHaveBeenCalledWith('fetching');
    expect(deps.onStage).toHaveBeenCalledWith('session');
    expect(deps.onStage).toHaveBeenCalledWith('decrypting');
    expect(deps.onStage).toHaveBeenCalledWith('done');
  });

  it('throws when content_hash length != 32', async () => {
    const deps = makeDeps({
      suiClient: {
        getObject: vi.fn(async () => ({
          data: {
            content: { fields: { walrus_blob_id: BLOB_BYTES, content_hash: [1, 2, 3] } },
          },
        })),
      },
    });
    await expect(viewOwnRecord(deps)).rejects.toThrow(/content_hash/);
  });

  it('throws when walrus_blob_id is empty', async () => {
    const deps = makeDeps({
      suiClient: {
        getObject: vi.fn(async () => ({
          data: { content: { fields: { walrus_blob_id: [], content_hash: CONTENT_HASH } } },
        })),
      },
    });
    await expect(viewOwnRecord(deps)).rejects.toThrow(/walrus_blob_id/);
  });

  it('throws when record object is missing content', async () => {
    const deps = makeDeps({
      suiClient: { getObject: vi.fn(async () => ({ data: null })) },
    });
    await expect(viewOwnRecord(deps)).rejects.toThrow(/content/);
  });

  it('propagates sealClient.decrypt rejection (e.g. non-owner)', async () => {
    const deps = makeDeps({
      sealClient: {
        decrypt: vi.fn(async () => {
          throw new Error('keyserver rejected: ENotOwner');
        }),
      },
    });
    await expect(viewOwnRecord(deps)).rejects.toThrow(/ENotOwner/);
  });
});

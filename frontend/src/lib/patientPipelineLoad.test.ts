/**
 * Unit tests for loadAllDecryptedRecords.
 *
 * Uses injected fakes: listRecordIds overrides the real queryRecordCreatedByPatient;
 * suiClient/sealClient/signPersonalMessage are stub fakes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted: create spies shared between vi.mock factories and test body.
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
    originalPackageId: '0xPKG',
    fns: { sealApproveOwner: '0xPKG::record_anchor::seal_approve_owner' },
  },
  SEAL: { sessionTtlMs: 5 * 60 * 1000 },
  WALRUS: { aggregatorUrl: 'https://agg.test' },
}));

// queries not used — we override listRecordIds in deps
vi.mock('../api/queries', () => ({
  queryRecordCreatedByPatient: vi.fn(),
}));

import { loadAllDecryptedRecords } from './patientPipeline';

const CONTENT_HASH = Array.from({ length: 32 }, (_, i) => i);
const BLOB_BYTES = Array.from(new TextEncoder().encode('blob-abc'));

function makeAnchorResponse(visitMs = 1000, extraFields: Record<string, unknown> = {}) {
  return {
    data: {
      content: {
        fields: {
          walrus_blob_id: BLOB_BYTES,
          content_hash: CONTENT_HASH,
          visit_timestamp_ms: String(visitMs),
          ...extraFields,
        },
      },
    },
  };
}

function makeDeps(overrides: Partial<Parameters<typeof loadAllDecryptedRecords>[0]> = {}) {
  h.fetchBlob.mockResolvedValue(new Uint8Array([0xaa]));
  return {
    address: '0xPATIENT',
    signPersonalMessage: vi.fn(async () => ({ signature: 'SIG' })),
    suiClient: {
      getObject: vi.fn(async () => makeAnchorResponse()),
    },
    sealCompatibleClient: {} as any,
    sealClient: {
      decrypt: vi.fn(async () => new TextEncoder().encode('decrypted text')),
    },
    ...overrides,
  };
}

describe('loadAllDecryptedRecords', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when no records exist', async () => {
    const deps = makeDeps({
      listRecordIds: vi.fn(async () => ({ records: [], nextCursor: null })),
    });
    const result = await loadAllDecryptedRecords(deps);
    expect(result).toEqual([]);
  });

  it('decrypts multiple records and returns { text, visitMs }[]', async () => {
    const records = ['0xREC1', '0xREC2'] as `0x${string}`[];
    let callCount = 0;
    const deps = makeDeps({
      listRecordIds: vi.fn(async () => ({ records, nextCursor: null })),
      suiClient: {
        getObject: vi.fn(async ({ id }: { id: string }) => makeAnchorResponse(id === '0xREC1' ? 1000 : 2000)),
      },
      sealClient: {
        decrypt: vi.fn(async () => {
          callCount++;
          return new TextEncoder().encode(`text-${callCount}`);
        }),
      },
    });
    const result = await loadAllDecryptedRecords(deps);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('text-1');
    expect(result[0].visitMs).toBe(1000n);
    expect(result[1].text).toBe('text-2');
    expect(result[1].visitMs).toBe(2000n);
  });

  it('drains multiple pages via nextCursor', async () => {
    const page1 = { records: ['0xREC1'] as `0x${string}`[], nextCursor: 'cursor1' };
    const page2 = { records: ['0xREC2'] as `0x${string}`[], nextCursor: null };
    const listFn = vi.fn()
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);
    const deps = makeDeps({ listRecordIds: listFn });
    const result = await loadAllDecryptedRecords(deps);
    expect(listFn).toHaveBeenCalledTimes(2);
    expect(listFn).toHaveBeenNthCalledWith(1, '0xPATIENT', undefined);
    expect(listFn).toHaveBeenNthCalledWith(2, '0xPATIENT', 'cursor1');
    expect(result).toHaveLength(2);
  });

  it('skips a failing record without aborting the rest', async () => {
    const records = ['0xBAD', '0xGOOD'] as `0x${string}`[];
    let call = 0;
    const deps = makeDeps({
      listRecordIds: vi.fn(async () => ({ records, nextCursor: null })),
      sealClient: {
        decrypt: vi.fn(async () => {
          call++;
          if (call === 1) throw new Error('keyserver rejected');
          return new TextEncoder().encode('good text');
        }),
      },
    });
    const result = await loadAllDecryptedRecords(deps);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('good text');
  });

  it('falls back visitMs to 0n when visit_timestamp_ms is absent', async () => {
    const deps = makeDeps({
      listRecordIds: vi.fn(async () => ({ records: ['0xREC' as `0x${string}`], nextCursor: null })),
      suiClient: {
        getObject: vi.fn(async () => ({
          data: {
            content: {
              fields: { walrus_blob_id: BLOB_BYTES, content_hash: CONTENT_HASH },
            },
          },
        })),
      },
    });
    const result = await loadAllDecryptedRecords(deps);
    expect(result[0].visitMs).toBe(0n);
  });
});

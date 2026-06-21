import { describe, it, expect, vi } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';
import { createEncryptedRecord } from './recordPipeline';

describe('createEncryptedRecord', () => {
  it('encrypts → uploads → publishes create_anchor and returns recordId+blobId', async () => {
    const cipher = new Uint8Array([0xaa, 0xbb]);
    const sealClient = { encrypt: vi.fn().mockResolvedValue({ encryptedObject: cipher }) };
    const walrus = { upload: vi.fn().mockResolvedValue('blob-1') };
    const sui = {
      signAndExecute: vi.fn().mockResolvedValue({
        objectChanges: [
          { type: 'created', objectType: 'pkg::record_anchor::RecordAnchor', objectId: '0xR3C' },
        ],
      }),
    };
    const result = await createEncryptedRecord({
      plaintext: new TextEncoder().encode('visit notes'),
      hospitalId: 'HOSP-1',
      visitTimestampMs: 1_700_000_000_000n,
      sealClient: sealClient as any,
      walrus: walrus as any,
      sui: sui as any,
    });
    expect(result.recordId).toBe('0xR3C');
    expect(result.blobId).toBe('blob-1');
    expect(walrus.upload).toHaveBeenCalledWith(cipher);
  });

  it('passes kind/image_blob_id/covered_count to create_anchor', async () => {
    let capturedMoveCallArgs: unknown[] = [];
    const cipher = new Uint8Array([0xcc]);
    const fakeSeal = { encrypt: vi.fn().mockResolvedValue({ encryptedObject: cipher }) };
    const fakeWalrus = { upload: vi.fn().mockResolvedValue('blob-2') };
    const fakeSui = {
      signAndExecute: vi.fn().mockImplementation((tx: Transaction) => {
        // Spy on moveCall by patching and re-calling after capture
        return Promise.resolve({
          objectChanges: [
            { type: 'created', objectType: 'pkg::record_anchor::RecordAnchor', objectId: '0xANC' },
          ],
        });
      }),
    };

    // Patch Transaction.prototype.moveCall to capture args before signAndExecute
    const origMoveCall = Transaction.prototype.moveCall;
    Transaction.prototype.moveCall = function(this: Transaction, params: any) {
      capturedMoveCallArgs = params.arguments ?? [];
      return origMoveCall.call(this, params);
    };

    try {
      const result = await createEncryptedRecord({
        plaintext: new TextEncoder().encode('hi'),
        hospitalId: 'h',
        visitTimestampMs: 1n,
        imageBlobId: 'img-blob',
        kind: 0,
        coveredCount: 0n,
        sealClient: fakeSeal as any,
        walrus: fakeWalrus as any,
        sui: fakeSui as any,
      });

      expect(result.recordId).toBe('0xANC');
      // 7 data args + clock = 8 total
      expect(capturedMoveCallArgs).toHaveLength(8);
    } finally {
      Transaction.prototype.moveCall = origMoveCall;
    }
  });
});

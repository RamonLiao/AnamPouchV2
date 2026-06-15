import { describe, it, expect, vi } from 'vitest';
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
});

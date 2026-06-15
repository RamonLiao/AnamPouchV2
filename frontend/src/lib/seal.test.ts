import { describe, it, expect, vi } from 'vitest';
import { encryptForRecord } from './seal';

describe('encryptForRecord', () => {
  it('returns ciphertext bytes when SealClient.encrypt resolves', async () => {
    const fakeCipher = new Uint8Array([1, 2, 3]);
    const fakeClient = {
      encrypt: vi.fn().mockResolvedValue({ encryptedObject: fakeCipher }),
    };
    const result = await encryptForRecord({
      data: new Uint8Array([0xff]),
      recordId: '0xabc',
      sealClient: fakeClient as any,
    });
    expect(result).toEqual(fakeCipher);
    expect(fakeClient.encrypt).toHaveBeenCalledWith(
      expect.objectContaining({ id: '0xabc', threshold: 2 }),
    );
  });

  it('throws when payload is empty', async () => {
    await expect(
      encryptForRecord({
        data: new Uint8Array(),
        recordId: '0xabc',
        sealClient: {} as any,
      }),
    ).rejects.toThrow(/empty/i);
  });
});

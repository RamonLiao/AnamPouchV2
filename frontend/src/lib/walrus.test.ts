import { describe, it, expect, vi } from 'vitest';
import { uploadBlob } from './walrus';

describe('uploadBlob', () => {
  it('PUTs to publisher and returns blobId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ newlyCreated: { blobObject: { blobId: 'abc123' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const id = await uploadBlob(new Uint8Array([1, 2, 3]), {
      publisherUrl: 'https://pub',
      epochs: 5,
    });
    expect(id).toBe('abc123');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://pub/v1/blobs?epochs=5',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('throws on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('oops') }));
    await expect(uploadBlob(new Uint8Array([1]), { publisherUrl: 'https://pub', epochs: 5 })).rejects.toThrow(/500/);
  });
});

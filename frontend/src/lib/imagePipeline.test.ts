import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createImageRecord } from './imagePipeline';

describe('createImageRecord', () => {
  it('encrypts image and text under the SAME content_hash and uploads two blobs', async () => {
    const encIds: string[] = [];
    const uploads: Uint8Array[] = [];
    const fakeSeal = {
      encrypt: vi.fn(async ({ id, data }: any) => {
        encIds.push(id);
        return { encryptedObject: data };
      }),
    };
    const fakeWalrus = {
      upload: vi.fn(async (d: Uint8Array) => {
        uploads.push(d);
        return `blob-${uploads.length}`;
      }),
    };
    const fakeSui = {
      signAndExecute: vi.fn(async () => ({
        objectChanges: [
          {
            type: 'created',
            objectType: '0x1::record_anchor::RecordAnchor',
            objectId: '0xrec',
          },
        ],
      })),
    };

    const out = await createImageRecord({
      redactedText: new TextEncoder().encode('redacted body'),
      image: new Uint8Array([9, 9, 9]),
      hospitalId: 'h',
      visitTimestampMs: 1n,
      sealClient: fakeSeal as any,
      walrus: fakeWalrus,
      sui: fakeSui as any,
    });

    expect(encIds.length).toBe(2);
    expect(encIds[0]).toBe(encIds[1]); // scheme A: same IBE id
    expect(uploads.length).toBe(2);
    expect(out.recordId).toBe('0xrec');
    expect(out.imageBlobId).toBeTruthy();
  });

  it('aborts before anchor if image upload fails (image upload before text/anchor)', async () => {
    const fakeSeal = {
      encrypt: vi.fn(async ({ data }: any) => ({ encryptedObject: data })),
    };
    const fakeWalrus = {
      upload: vi.fn().mockRejectedValueOnce(new Error('walrus down')),
    };
    const fakeSui = { signAndExecute: vi.fn() };

    await expect(
      createImageRecord({
        redactedText: new TextEncoder().encode('text'),
        image: new Uint8Array([1]),
        hospitalId: 'h',
        visitTimestampMs: 1n,
        sealClient: fakeSeal as any,
        walrus: fakeWalrus,
        sui: fakeSui as any,
      }),
    ).rejects.toThrow('walrus down');

    // sui should never be called — anchor was never created
    expect(fakeSui.signAndExecute).not.toHaveBeenCalled();
  });

  // ── Monkey: zero-length redactedText ────────────────────────────────────────
  // BUG FIX: without early guard, image blob was uploaded before
  // createEncryptedRecord threw "payload is empty" → orphan blob.
  // Fix: validate redactedText.length > 0 at top of createImageRecord.
  it('rejects zero-length redactedText before uploading any blob (no orphan)', async () => {
    const fakeSeal = {
      encrypt: vi.fn(async ({ data }: any) => ({ encryptedObject: data })),
    };
    const fakeWalrus = { upload: vi.fn() };
    const fakeSui = { signAndExecute: vi.fn() };

    await expect(
      createImageRecord({
        redactedText: new Uint8Array(0),
        image: new Uint8Array([9]),
        hospitalId: 'h',
        visitTimestampMs: 1n,
        sealClient: fakeSeal as any,
        walrus: fakeWalrus,
        sui: fakeSui as any,
      }),
    ).rejects.toThrow(/empty/i);

    // No uploads and no chain calls — guard fired before any side effects
    expect(fakeWalrus.upload).not.toHaveBeenCalled();
    expect(fakeSui.signAndExecute).not.toHaveBeenCalled();
  });

  // ── Monkey: anchor creation throws after successful image upload ─────────────
  it('propagates anchor error and does not return false success', async () => {
    const fakeSeal = {
      encrypt: vi.fn(async ({ data }: any) => ({ encryptedObject: data })),
    };
    let uploadCount = 0;
    const fakeWalrus = {
      upload: vi.fn(async () => `blob-${++uploadCount}`),
    };
    const fakeSui = {
      signAndExecute: vi.fn(async () => { throw new Error('chain aborted'); }),
    };

    await expect(
      createImageRecord({
        redactedText: new TextEncoder().encode('body'),
        image: new Uint8Array([1, 2]),
        hospitalId: 'h',
        visitTimestampMs: 5n,
        sealClient: fakeSeal as any,
        walrus: fakeWalrus,
        sui: fakeSui as any,
      }),
    ).rejects.toThrow('chain aborted');
  });
});

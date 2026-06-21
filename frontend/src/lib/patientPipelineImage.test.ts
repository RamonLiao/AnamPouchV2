/**
 * Tests for decodeBlobIdBytes — the encoding/decode bridge between on-chain
 * vector<u8> (TextEncoder output) and the string blobId used for Walrus fetch.
 *
 * Why this matters: an off-by-one or wrong decoder would silently fetch the wrong
 * blob or skip images entirely. We test the contract: encode → store → decode → same string.
 */
import { describe, it, expect } from 'vitest';
import { decodeBlobIdBytes } from './patientPipeline';

describe('decodeBlobIdBytes', () => {
  it('round-trips a typical Walrus blobId string', () => {
    const blobId = 'ABC123XYZwalrusTestBlobId';
    const encoded = Array.from(new TextEncoder().encode(blobId));
    expect(decodeBlobIdBytes(encoded)).toBe(blobId);
  });

  it('returns empty string for empty array (no image)', () => {
    expect(decodeBlobIdBytes([])).toBe('');
  });

  it('handles blobId with special characters', () => {
    const blobId = 'blob-id_with.special+chars=';
    const encoded = Array.from(new TextEncoder().encode(blobId));
    expect(decodeBlobIdBytes(encoded)).toBe(blobId);
  });

  it('handles a realistic 64-char base64url blobId', () => {
    const blobId = 'z4ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ab';
    const encoded = Array.from(new TextEncoder().encode(blobId));
    expect(decodeBlobIdBytes(encoded)).toBe(blobId);
  });
});

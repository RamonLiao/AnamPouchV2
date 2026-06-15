import { describe, it, expect, vi } from 'vitest';
import { consumeAndDecrypt } from './doctorPipeline';

describe('consumeAndDecrypt', () => {
  it('runs consume_grant, builds seal_approve PTB, decrypts via session key', async () => {
    const decrypted = new TextEncoder().encode('plaintext');
    const sui = {
      signAndExecute: vi.fn().mockResolvedValue({
        objectChanges: [
          { type: 'created', objectType: 'pkg::decryption_ticket::DecryptionTicket', objectId: '0xT1' },
        ],
      }),
      getObject: vi.fn().mockResolvedValue({
        data: { content: { fields: { record_id: '0xR3C', walrus_blob_id: Array.from(new TextEncoder().encode('blob-1')) } } },
      }),
    };
    const sealClient = { decrypt: vi.fn().mockResolvedValue(decrypted) };
    const walrus = { fetch: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])) };
    const sessionKey = {} as any;

    const out = await consumeAndDecrypt({
      grantId: '0xG',
      preimage: new Uint8Array(32),
      sui: sui as any,
      sealClient: sealClient as any,
      walrus: walrus as any,
      sessionKey,
      buildApprovePtbBytes: vi.fn().mockResolvedValue(new Uint8Array([9, 9, 9])),
    });

    expect(new TextDecoder().decode(out.plaintext)).toBe('plaintext');
    expect(out.ticketId).toBe('0xT1');
    expect(sealClient.decrypt).toHaveBeenCalled();
  });
});

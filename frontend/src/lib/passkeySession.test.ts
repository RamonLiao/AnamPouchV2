import { describe, it, expect, vi } from 'vitest';

vi.mock('./dappKit', () => ({ dAppKit: { getClient: vi.fn() } }));
vi.mock('@mysten/sui/keypairs/passkey', () => ({
  BrowserPasskeyProvider: class {},
  PasskeyKeypair: class {},
  findCommonPublicKey: vi.fn(),
}));

import { PasskeySession } from './passkeySession';

describe('PasskeySession.signPersonalMessage', () => {
  it('delegates to the keypair and returns the signature', async () => {
    const keypair = {
      getPublicKey: () => ({ toSuiAddress: () => '0xpk' }),
      signPersonalMessage: vi.fn().mockResolvedValue({ signature: 'PK_SIG', bytes: 'b' }),
    };
    const session = new PasskeySession(keypair as never);
    const msg = new Uint8Array([7]);
    const res = await session.signPersonalMessage(msg);

    expect(keypair.signPersonalMessage).toHaveBeenCalledWith(msg);
    expect(res).toEqual({ signature: 'PK_SIG' });
  });
});

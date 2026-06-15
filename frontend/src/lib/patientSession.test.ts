import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Transaction } from '@mysten/sui/transactions';
import type { PatientSession } from './patientSession';

// Mock dappKit so importing patientSession doesn't spin up SealClient / gRPC.
const h = vi.hoisted(() => ({
  waitForTransaction: vi.fn(),
  signPersonalMessage: vi.fn(),
  getClient: vi.fn(),
}));
vi.mock('./dappKit', () => ({
  dAppKit: {
    stores: { $connection: { get: () => ({ account: null }) } },
    signPersonalMessage: h.signPersonalMessage,
    getClient: h.getClient,
  },
  suiJsonRpc: { waitForTransaction: h.waitForTransaction },
}));

import { signAndGetObjectChanges, WalletSession } from './patientSession';

function fakeSession(digest: string): PatientSession {
  return {
    authMethod: 'zklogin',
    getAddress: () => '0xpatient',
    signAndExecute: vi.fn().mockResolvedValue({ digest }),
    signPersonalMessage: vi.fn().mockResolvedValue({ signature: '0x' }),
  };
}

const tx = {} as Transaction;

describe('signAndGetObjectChanges (gRPC)', () => {
  beforeEach(() => {
    h.waitForTransaction.mockReset();
    h.getClient.mockReset();
    h.getClient.mockReturnValue({ waitForTransaction: h.waitForTransaction });
  });

  it('signs then maps created changedObjects + objectTypes into objectChanges', async () => {
    h.waitForTransaction.mockResolvedValue({
      $kind: 'Transaction',
      Transaction: {
        effects: {
          changedObjects: [
            { objectId: '0xrec', idOperation: 'Created' },
            { objectId: '0xgas', idOperation: 'None' },
          ],
        },
        objectTypes: {
          '0xrec': '0x2::record_anchor::RecordAnchor',
          '0xgas': '0x2::coin::Coin',
        },
      },
    });
    const session = fakeSession('0xdig');
    const res = await signAndGetObjectChanges(session, tx);

    expect(session.signAndExecute).toHaveBeenCalledWith(tx);
    expect(h.waitForTransaction).toHaveBeenCalledWith({
      digest: '0xdig',
      include: { effects: true, objectTypes: true },
    });
    expect(res.digest).toBe('0xdig');
    expect(res.objectChanges).toEqual([
      { type: 'created', objectType: '0x2::record_anchor::RecordAnchor', objectId: '0xrec' },
    ]);
  });

  it('returns empty objectChanges when effects have no created objects', async () => {
    h.waitForTransaction.mockResolvedValue({
      $kind: 'Transaction',
      Transaction: { effects: { changedObjects: [] }, objectTypes: {} },
    });
    const res = await signAndGetObjectChanges(fakeSession('0xd'), tx);
    expect(res.objectChanges).toEqual([]);
  });

  it('throws when waitForTransaction returns FailedTransaction', async () => {
    h.waitForTransaction.mockResolvedValue({ $kind: 'FailedTransaction', FailedTransaction: {} });
    await expect(signAndGetObjectChanges(fakeSession('0xd'), tx)).rejects.toThrow(
      'waitForTransaction returned no transaction effects',
    );
  });

  it('propagates a signing failure (no digest lookup)', async () => {
    const session: PatientSession = {
      authMethod: 'wallet',
      getAddress: () => '0xp',
      signAndExecute: vi.fn().mockRejectedValue(new Error('Transaction failed')),
      signPersonalMessage: vi.fn().mockResolvedValue({ signature: '0x' }),
    };
    await expect(signAndGetObjectChanges(session, tx)).rejects.toThrow('Transaction failed');
    expect(h.waitForTransaction).not.toHaveBeenCalled();
  });
});

describe('WalletSession.signPersonalMessage', () => {
  beforeEach(() => h.signPersonalMessage.mockReset());

  it('delegates to dAppKit.signPersonalMessage and returns the signature', async () => {
    h.signPersonalMessage.mockResolvedValue({ signature: '0xsig', bytes: 'b' });
    const msg = new Uint8Array([1, 2, 3]);
    const res = await new WalletSession().signPersonalMessage(msg);

    expect(h.signPersonalMessage).toHaveBeenCalledWith({ message: msg });
    expect(res).toEqual({ signature: '0xsig' });
  });
});

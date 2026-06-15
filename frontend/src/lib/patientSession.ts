/**
 * PatientSession — unified abstraction over zkLogin (OAuth) + Passkey (WebAuthn) + wallet.
 *
 * Three adapters:
 *   - WalletSession   – delegates to dapp-kit browser wallet (default)
 *   - ZkLoginSession  – Google OAuth + ZK proof (see lib/zkLoginSession.ts)
 *   - PasskeySession  – WebAuthn biometrics (see lib/passkeySession.ts)
 *
 * Contract:
 *   - `getAddress()` returns the Sui address used for issuing/owning records.
 *   - `signAndExecute(tx)` signs with whichever auth method is active.
 */

import type { Transaction } from '@mysten/sui/transactions';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { dAppKit } from './dappKit';

export interface PatientSession {
  readonly authMethod: 'wallet' | 'zklogin' | 'passkey';
  getAddress(): string | null;
  signAndExecute(tx: Transaction): Promise<{ digest: string }>;
  /** Sign a Seal SessionKey personal message. Returns a serialized signature. */
  signPersonalMessage(message: Uint8Array): Promise<{ signature: string }>;
}

export class WalletSession implements PatientSession {
  readonly authMethod = 'wallet' as const;

  getAddress(): string | null {
    return dAppKit.stores.$connection.get().account?.address ?? null;
  }

  async signAndExecute(tx: Transaction): Promise<{ digest: string }> {
    const result = await dAppKit.signAndExecuteTransaction({ transaction: tx });
    if ('FailedTransaction' in result && result.FailedTransaction) {
      throw new Error(result.FailedTransaction.status.error?.message ?? 'Transaction failed');
    }
    return { digest: result.Transaction.digest };
  }

  async signPersonalMessage(message: Uint8Array): Promise<{ signature: string }> {
    const { signature } = await dAppKit.signPersonalMessage({ message });
    return { signature };
  }
}

let active: PatientSession = new WalletSession();

export function getPatientSession(): PatientSession {
  return active;
}

export function setPatientSession(s: PatientSession): void {
  active = s;
}

/** Minimal shape the record/grant pipelines need from a tx's effects. */
export interface ObjectChange {
  type: string;
  objectType?: string;
  objectId?: string;
}

/**
 * Sign+execute a tx via whichever auth method is active, then resolve the tx's
 * created objects via a gRPC `waitForTransaction` (NOT getTransaction — a bare
 * read immediately after execute can race the node's indexing and 404).
 * gRPC returns effects.changedObjects + a separate objectTypes map; we join them
 * back into the legacy { type:'created', objectType, objectId } shape so Flow A
 * (recordPipeline) and the doctor pipeline keep working unchanged.
 */
export async function signAndGetObjectChanges(
  session: PatientSession,
  tx: Transaction,
): Promise<{ digest: string; objectChanges: ObjectChange[] }> {
  const { digest } = await session.signAndExecute(tx);
  const grpc = dAppKit.getClient() as unknown as SuiGrpcClient;
  if (typeof (grpc as { waitForTransaction?: unknown }).waitForTransaction !== 'function') {
    throw new Error('Active client does not expose gRPC waitForTransaction');
  }
  const res = await grpc.waitForTransaction({
    digest,
    include: { effects: true, objectTypes: true },
  });
  if (res.$kind !== 'Transaction' || !res.Transaction) {
    throw new Error('waitForTransaction returned no transaction effects');
  }
  const txResult = res.Transaction;
  const objectTypes = txResult.objectTypes ?? {};
  const objectChanges = (txResult.effects?.changedObjects ?? []).flatMap((c) => {
    if (c.idOperation !== 'Created') return [];
    const objectType = objectTypes[c.objectId];
    const change: ObjectChange = { type: 'created', objectId: c.objectId };
    if (objectType !== undefined) change.objectType = objectType;
    return [change];
  });
  return { digest, objectChanges };
}

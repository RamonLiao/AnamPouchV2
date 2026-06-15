/**
 * Patient self-decrypt pipeline.
 *
 * Mirrors the doctor flow but uses `seal_approve_owner(id, record)` — no ticket,
 * no clock, no grant. Keyserver dry-runs the PTB; sender == record.patient
 * gates the key release.
 */

import { Transaction } from '@mysten/sui/transactions';
import { SessionKey, type SealClient, type SealCompatibleClient } from '@mysten/seal';
import { CONTRACT, SEAL, WALRUS } from '../config/contract';
import { fetchBlob } from './walrus';
import type { ObjectId } from '../types/contracts';

export type ViewStage =
  | 'idle'
  | 'fetching'
  | 'session'
  | 'decrypting'
  | 'done'
  | 'error';

export interface ViewOwnRecordDeps {
  recordId: ObjectId;
  address: string;
  signPersonalMessage: (msg: Uint8Array) => Promise<{ signature: string }>;
  suiClient: {
    getObject: (args: { id: string; options: { showContent: boolean } }) => Promise<unknown>;
  };
  /** Underlying client used by both SessionKey + tx.build. */
  sealCompatibleClient: SealCompatibleClient;
  sealClient: Pick<SealClient, 'decrypt'>;
  onStage?: (s: ViewStage) => void;
  /** Override aggregator (tests). */
  walrusAggregator?: string;
}

export async function viewOwnRecord(deps: ViewOwnRecordDeps): Promise<string> {
  const stage = (s: ViewStage) => deps.onStage?.(s);

  stage('fetching');
  const recordObj: any = await deps.suiClient.getObject({
    id: deps.recordId,
    options: { showContent: true },
  });
  const fields = recordObj?.data?.content?.fields;
  if (!fields) throw new Error('record object missing content');

  const blobIdBytes: number[] = fields.walrus_blob_id ?? [];
  const blobId = new TextDecoder().decode(new Uint8Array(blobIdBytes));
  if (!blobId) throw new Error('record has no walrus_blob_id');

  const contentHashBytes: number[] = fields.content_hash ?? [];
  if (contentHashBytes.length !== 32) {
    throw new Error('record content_hash missing or wrong length');
  }

  const cipher = await fetchBlob(blobId, deps.walrusAggregator ?? WALRUS.aggregatorUrl);

  stage('session');
  const sessionKey = await SessionKey.create({
    address: deps.address,
    packageId: CONTRACT.originalPackageId,
    ttlMin: SEAL.sessionTtlMs / 60_000,
    suiClient: deps.sealCompatibleClient,
  });
  const personalMsg = sessionKey.getPersonalMessage();
  const sig = await deps.signPersonalMessage(personalMsg);
  sessionKey.setPersonalMessageSignature(sig.signature);

  const approveTx = new Transaction();
  approveTx.moveCall({
    target: CONTRACT.fns.sealApproveOwner,
    arguments: [
      approveTx.pure.vector('u8', contentHashBytes),
      approveTx.object(deps.recordId),
    ],
  });
  approveTx.setSender(deps.address);
  const txBytes = await approveTx.build({
    client: deps.sealCompatibleClient as any,
    onlyTransactionKind: true,
  });

  stage('decrypting');
  const plaintextBytes = await deps.sealClient.decrypt({
    data: cipher,
    sessionKey,
    txBytes,
  });

  stage('done');
  return new TextDecoder().decode(plaintextBytes);
}

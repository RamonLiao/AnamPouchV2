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
import type { DecryptedRecord } from './summary';
import { queryRecordCreatedByPatient } from '../api/queries';

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

/** Deps injected by the caller — allows fakes in tests. */
export interface LoadAllRecordsDeps {
  address: string;
  signPersonalMessage: (msg: Uint8Array) => Promise<{ signature: string }>;
  suiClient: ViewOwnRecordDeps['suiClient'];
  sealCompatibleClient: SealCompatibleClient;
  sealClient: Pick<SealClient, 'decrypt'>;
  /** Override Walrus aggregator URL (tests). */
  walrusAggregator?: string;
  /** Override the event query function (tests). */
  listRecordIds?: (patient: string, cursor?: string | null) => Promise<{ records: ObjectId[]; nextCursor: string | null }>;
}

/**
 * Drain all active (kind=0) record ids for a patient, decrypt each one via the
 * owner path, and return a list of { text, visitMs } for summary generation.
 *
 * Failures on individual records are silently skipped so that a single corrupt
 * blob cannot abort the whole summary.
 */
export async function loadAllDecryptedRecords(
  deps: LoadAllRecordsDeps,
): Promise<DecryptedRecord[]> {
  const listFn = deps.listRecordIds ?? queryRecordCreatedByPatient;

  // Drain all pages of kind=0 record ids.
  const recordIds: ObjectId[] = [];
  let cursor: string | null | undefined = undefined;
  for (;;) {
    const page = await listFn(deps.address as `0x${string}`, cursor);
    recordIds.push(...page.records);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }

  // Decrypt each record; skip on failure.
  const results: DecryptedRecord[] = [];
  for (const recordId of recordIds) {
    try {
      // Fetch the anchor object to get visitTimestampMs.
      const anchorRes: any = await deps.suiClient.getObject({
        id: recordId,
        options: { showContent: true },
      });
      const fields = anchorRes?.data?.content?.fields;
      const visitMs: bigint = fields?.visit_timestamp_ms
        ? BigInt(fields.visit_timestamp_ms)
        : 0n;

      const text = await viewOwnRecord({
        recordId,
        address: deps.address,
        signPersonalMessage: deps.signPersonalMessage,
        suiClient: deps.suiClient,
        sealCompatibleClient: deps.sealCompatibleClient,
        sealClient: deps.sealClient,
        ...(deps.walrusAggregator !== undefined ? { walrusAggregator: deps.walrusAggregator } : {}),
      });
      results.push({ text, visitMs });
    } catch (e) {
      console.warn(`loadAllDecryptedRecords: skipping ${recordId}`, e);
    }
  }
  return results;
}

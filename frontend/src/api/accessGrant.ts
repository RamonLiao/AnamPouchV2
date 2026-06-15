/**
 * PTB builders for the `access_grant` module.
 *
 * IMPORTANT (R6 cascade fix): consume_grant takes the shared RecordAnchor as
 * a parameter so revoking the record kills live grants atomically. Doctor
 * frontend MUST resolve `recordId` (from grant query) and pass `tx.object()`.
 */

import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { CONTRACT, CLOCK_OBJECT_ID } from '../config/contract';
import type { ObjectId, Scope } from '../types/contracts';
import { generateAccessToken, type AccessToken } from '../lib/preimage';

export interface IssueGrantArgs {
  recordId: ObjectId;
  scope: Scope;
  ttlMs: bigint;
}

export interface IssueGrantResult {
  tx: Transaction;
  /** KEEP THIS LOCAL. Goes into the QR. Never send to backend. */
  token: AccessToken;
}

/**
 * Build an issue_grant PTB and freshly generate the one-time token.
 * Caller is responsible for displaying `result.token.qrPayload` to the patient
 * and discarding the preimage as soon as the QR is shown / scanned.
 */
export function buildIssueGrantTx(args: IssueGrantArgs): IssueGrantResult {
  const token = generateAccessToken();
  const tx = new Transaction();
  tx.moveCall({
    target: CONTRACT.fns.issueGrant,
    arguments: [
      tx.object(args.recordId), // shared RecordAnchor (immutable ref ok, runtime treats as &)
      tx.pure(bcs.vector(bcs.u8()).serialize(token.tokenHash)),
      tx.pure.u8(args.scope),
      tx.pure.u64(args.ttlMs),
      tx.object(CLOCK_OBJECT_ID),
    ],
  });
  return { tx, token };
}

/**
 * Builds a consume_grant PTB. On success, a `DecryptionTicket` object is
 * transferred to the tx sender — caller should read it from tx effects via
 * `result.objectChanges` filtering by `objectType` ending in `::DecryptionTicket`.
 */
export interface ConsumeGrantArgs {
  grantId: ObjectId;
  /** Resolved from `AccessGrant.record_id` field via getObject. */
  recordId: ObjectId;
  /** Raw preimage bytes from QR scan (NOT base64). Use decodeQrPayload(). */
  preimage: Uint8Array;
}

export function buildConsumeGrantTx(args: ConsumeGrantArgs): Transaction {
  if (args.preimage.length !== 32) throw new Error('preimage must be 32 bytes');
  const tx = new Transaction();
  tx.moveCall({
    target: CONTRACT.fns.consumeGrant,
    arguments: [
      tx.object(args.grantId),
      tx.object(args.recordId),
      tx.pure(bcs.vector(bcs.u8()).serialize(args.preimage)),
      tx.object(CLOCK_OBJECT_ID),
    ],
  });
  return tx;
}

export function buildRevokeGrantTx(grantId: ObjectId): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: CONTRACT.fns.revokeGrant,
    arguments: [tx.object(grantId), tx.object(CLOCK_OBJECT_ID)],
  });
  return tx;
}

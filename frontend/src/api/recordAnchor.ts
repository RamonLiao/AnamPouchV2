/**
 * PTB builders for the `record_anchor` module.
 * These return Transaction objects — caller signs/executes via dapp-kit's
 * `useSignAndExecuteTransaction` or a backend signer.
 */

import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { CONTRACT, CLOCK_OBJECT_ID } from '../config/contract';
import type { ObjectId } from '../types/contracts';

export interface CreateAnchorArgs {
  contentHash: Uint8Array;      // 32 bytes (sha3-256 of Seal ciphertext)
  walrusBlobId: Uint8Array;     // raw bytes from Walrus
  hospitalId: Uint8Array;       // opaque facility identifier
  visitTimestampMs: bigint;
}

export function buildCreateAnchorTx(args: CreateAnchorArgs): Transaction {
  if (args.contentHash.length !== 32) throw new Error('contentHash must be 32 bytes');
  if (args.walrusBlobId.length === 0) throw new Error('walrusBlobId is empty');
  if (args.hospitalId.length === 0) throw new Error('hospitalId is empty');

  const tx = new Transaction();
  tx.moveCall({
    target: CONTRACT.fns.createAnchor,
    arguments: [
      tx.pure(bcs.vector(bcs.u8()).serialize(args.contentHash)),
      tx.pure(bcs.vector(bcs.u8()).serialize(args.walrusBlobId)),
      tx.pure(bcs.vector(bcs.u8()).serialize(args.hospitalId)),
      tx.pure.u64(args.visitTimestampMs),
      tx.object(CLOCK_OBJECT_ID),
    ],
  });
  return tx;
}

export function buildRevokeAnchorTx(recordId: ObjectId): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: CONTRACT.fns.revokeAnchor,
    arguments: [tx.object(recordId), tx.object(CLOCK_OBJECT_ID)],
  });
  return tx;
}

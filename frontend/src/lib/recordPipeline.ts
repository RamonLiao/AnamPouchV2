import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { CONTRACT, CLOCK_OBJECT_ID, WALRUS } from '../config/contract';
import { encryptForRecord } from './seal';
import { uploadBlob } from './walrus';
import type { ObjectId } from '../types/contracts';

export interface CreateRecordArgs {
  plaintext: Uint8Array;
  hospitalId: string;
  visitTimestampMs: bigint;
  sealClient: import('@mysten/seal').SealClient;
  walrus?: { upload: (data: Uint8Array) => Promise<string> };
  sui: {
    signAndExecute: (
      tx: Transaction,
    ) => Promise<{ objectChanges?: Array<{ type: string; objectType?: string; objectId?: string }> }>;
  };
}

export interface CreateRecordResult {
  recordId: ObjectId;
  blobId: string;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  // Copy into a fresh ArrayBuffer to satisfy BufferSource (avoid SharedArrayBuffer union).
  const ab = new ArrayBuffer(data.byteLength);
  new Uint8Array(ab).set(data);
  const buf = await crypto.subtle.digest('SHA-256', ab);
  return new Uint8Array(buf);
}

export async function createEncryptedRecord(args: CreateRecordArgs): Promise<CreateRecordResult> {
  // Hackathon simplification: derive Seal IBE id from sha256(plaintext) and
  // store the same hash on-chain as content_hash. Production path would be a
  // two-tx flow: create empty anchor → encrypt under its object id → finalize.
  const contentHash = await sha256(args.plaintext);
  const cipher = await encryptForRecord({
    data: args.plaintext,
    recordId: bytesToHex(contentHash),
    sealClient: args.sealClient,
  });
  const blobId = args.walrus
    ? await args.walrus.upload(cipher)
    : await uploadBlob(cipher, { publisherUrl: WALRUS.publisherUrl, epochs: 5 });

  const tx = new Transaction();
  tx.moveCall({
    target: CONTRACT.fns.createAnchor,
    arguments: [
      tx.pure(bcs.vector(bcs.u8()).serialize(contentHash)),
      tx.pure(bcs.vector(bcs.u8()).serialize(new TextEncoder().encode(blobId))),
      tx.pure(bcs.vector(bcs.u8()).serialize(new TextEncoder().encode(args.hospitalId))),
      tx.pure.u64(args.visitTimestampMs),
      tx.object(CLOCK_OBJECT_ID),
    ],
  });

  const res = await args.sui.signAndExecute(tx);
  const created = res.objectChanges?.find(
    (c) => c.type === 'created' && c.objectType?.endsWith('::record_anchor::RecordAnchor'),
  );
  if (!created?.objectId) throw new Error('RecordAnchor not in tx effects');
  return { recordId: created.objectId as ObjectId, blobId };
}

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  return ('0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`;
}

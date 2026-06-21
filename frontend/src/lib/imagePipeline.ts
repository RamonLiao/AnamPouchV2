import { encryptForRecord } from './seal';
import { uploadBlob } from './walrus';
import { createEncryptedRecord } from './recordPipeline';
import { WALRUS } from '../config/contract';
import type { ObjectId } from '../types/contracts';
import type { Transaction } from '@mysten/sui/transactions';

export interface CreateImageRecordArgs {
  redactedText: Uint8Array;
  image: Uint8Array;
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

async function sha256Hex(data: Uint8Array): Promise<string> {
  const ab = new ArrayBuffer(data.byteLength);
  new Uint8Array(ab).set(data);
  const buf = await crypto.subtle.digest('SHA-256', ab);
  return (
    '0x' +
    Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  );
}

export async function createImageRecord(args: CreateImageRecordArgs): Promise<{
  recordId: ObjectId;
  textBlobId: string;
  imageBlobId: string;
}> {
  // Scheme A: image is encrypted under the same IBE id as the text.
  // The IBE id = sha256(redactedText) as 0x-prefixed lowercase hex,
  // identical to what createEncryptedRecord derives internally.
  const contentHashHex = await sha256Hex(args.redactedText);

  const upload = args.walrus
    ? args.walrus.upload
    : (d: Uint8Array) => uploadBlob(d, { publisherUrl: WALRUS.publisherUrl, epochs: 5 });

  // 1. Encrypt + upload image FIRST so a failure aborts before any anchor is created.
  const imageCipher = await encryptForRecord({
    data: args.image,
    recordId: contentHashHex,
    sealClient: args.sealClient,
  });
  const imageBlobId = await upload(imageCipher);

  // 2. Encrypt + upload text and create the anchor (delegates to existing pipeline).
  const { recordId, blobId: textBlobId } = await createEncryptedRecord({
    plaintext: args.redactedText,
    hospitalId: args.hospitalId,
    visitTimestampMs: args.visitTimestampMs,
    imageBlobId,
    kind: 0,
    coveredCount: 0n,
    sealClient: args.sealClient,
    ...(args.walrus ? { walrus: args.walrus } : {}),
    sui: args.sui,
  });

  return { recordId, textBlobId, imageBlobId };
}

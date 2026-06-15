import type { Transaction } from '@mysten/sui/transactions';
import { buildConsumeGrantTx } from '../api/accessGrant';
import type { ObjectId } from '../types/contracts';

export interface ConsumeAndDecryptArgs {
  grantId: ObjectId;
  preimage: Uint8Array;
  sui: {
    signAndExecute: (tx: Transaction) => Promise<{ objectChanges?: Array<{ type: string; objectType?: string; objectId?: string }> }>;
    getObject: (id: string) => Promise<any>;
  };
  sealClient: { decrypt: (args: any) => Promise<Uint8Array> };
  walrus: { fetch: (blobId: string) => Promise<Uint8Array> };
  sessionKey: import('@mysten/seal').SessionKey;
  /** Builds the seal_approve PTB bytes for the keyserver dry-run. */
  buildApprovePtbBytes: (ctx: { recordId: ObjectId; ticketId: ObjectId }) => Promise<Uint8Array>;
}

export interface ConsumeAndDecryptResult {
  plaintext: Uint8Array;
  ticketId: ObjectId;
  recordId: ObjectId;
}

export async function consumeAndDecrypt(args: ConsumeAndDecryptArgs): Promise<ConsumeAndDecryptResult> {
  // 1. Resolve recordId from grant
  const grantObj = await args.sui.getObject(args.grantId);
  const recordIdRaw: string | undefined = grantObj?.data?.content?.fields?.record_id;
  if (!recordIdRaw) throw new Error('grant object missing record_id');
  const recordId = recordIdRaw as ObjectId;

  // 2. Build + run consume_grant tx
  const tx = buildConsumeGrantTx({ grantId: args.grantId, recordId, preimage: args.preimage });
  const res = await args.sui.signAndExecute(tx);
  const ticket = res.objectChanges?.find(
    (c) => c.type === 'created' && c.objectType?.endsWith('::decryption_ticket::DecryptionTicket'),
  );
  if (!ticket?.objectId) throw new Error('DecryptionTicket not in tx effects');
  const ticketId = ticket.objectId as ObjectId;

  // 3. Fetch encrypted blob from Walrus
  const recordObj = await args.sui.getObject(recordId);
  const blobIdBytes: number[] = recordObj?.data?.content?.fields?.walrus_blob_id ?? [];
  const blobId = new TextDecoder().decode(new Uint8Array(blobIdBytes));
  const cipher = await args.walrus.fetch(blobId);

  // 4. Build seal_approve PTB bytes for keyserver and decrypt
  const txBytes = await args.buildApprovePtbBytes({ recordId, ticketId });
  const plaintext = await args.sealClient.decrypt({
    data: cipher,
    sessionKey: args.sessionKey,
    txBytes,
  } as any);

  return { plaintext, ticketId, recordId };
}

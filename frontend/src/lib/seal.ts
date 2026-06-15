import { SealClient, SessionKey, type SealCompatibleClient } from '@mysten/seal';
import type { Signer } from '@mysten/sui/cryptography';
import { CONTRACT, SEAL } from '../config/contract';

export interface EncryptArgs {
  data: Uint8Array;
  /** RecordAnchor object id — used as Seal IBE policy identity. */
  recordId: string;
  sealClient: SealClient;
}

export async function encryptForRecord(args: EncryptArgs): Promise<Uint8Array> {
  if (args.data.length === 0) throw new Error('payload is empty');
  const { encryptedObject } = await args.sealClient.encrypt({
    threshold: SEAL.threshold,
    packageId: CONTRACT.originalPackageId,
    id: args.recordId,
    data: args.data,
  });
  return encryptedObject;
}

export interface SessionArgs {
  address: string;
  packageId: string;
  signer: Signer;
  suiClient: SealCompatibleClient;
}

export async function createSessionKey(args: SessionArgs): Promise<SessionKey> {
  return SessionKey.create({
    address: args.address,
    packageId: args.packageId,
    ttlMin: SEAL.sessionTtlMs / 60_000,
    signer: args.signer,
    suiClient: args.suiClient,
  });
}

export interface DecryptArgs {
  ciphertext: Uint8Array;
  sessionKey: SessionKey;
  /** PTB bytes for the seal_approve dry-run (built by caller). */
  txBytes: Uint8Array;
  sealClient: SealClient;
}

export async function decryptWithTicket(args: DecryptArgs): Promise<Uint8Array> {
  return args.sealClient.decrypt({
    data: args.ciphertext,
    sessionKey: args.sessionKey,
    txBytes: args.txBytes,
  });
}

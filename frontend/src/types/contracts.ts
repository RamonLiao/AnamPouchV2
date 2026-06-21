/**
 * TypeScript mirrors of Move structs and event payloads.
 * Hand-curated (small ABI surface). Update in lockstep with contracts/sources/*.move.
 *
 * Move ↔ TS conventions:
 *   address / ID / UID -> `0x${string}`
 *   u8                  -> number
 *   u64                 -> bigint   (BCS deserializer returns string; cast at boundary)
 *   vector<u8>          -> Uint8Array on the wire; events arrive as number[] from JSON-RPC
 *   bool                -> boolean
 */

export type SuiAddress = `0x${string}`;
export type ObjectId = `0x${string}`;

export const RECORD_VERSION_ACTIVE = 1;
export const RECORD_VERSION_TOMBSTONE = 255;

export const SCOPE = {
  Single: 0,
  Period: 1,
  Disease: 2,
} as const;
export type Scope = (typeof SCOPE)[keyof typeof SCOPE];

export interface RecordAnchorFields {
  id: { id: ObjectId };
  patient: SuiAddress;
  content_hash: number[];
  walrus_blob_id: number[];
  seal_policy_id: ObjectId;
  hospital_id: number[];
  visit_timestamp_ms: string; // u64 as decimal string from RPC
  created_at_ms: string;
  version: number;
  kind: number;
  image_blob_id: number[];
  covered_count: string; // u64 as decimal string from RPC
}

export const RECORD_KIND = { Record: 0, Summary: 1 } as const;
export type RecordKind = (typeof RECORD_KIND)[keyof typeof RECORD_KIND];

export interface AccessGrantFields {
  id: { id: ObjectId };
  record_id: ObjectId;
  issuer: SuiAddress;
  grantee_token_hash: number[];
  grantee_doctor_cap: { vec: ObjectId[] };
  scope: number;
  expires_at_ms: string;
  used: boolean;
  revoked: boolean;
}

// === Event payloads (parsedJson shape from suix_queryEvents / gRPC stream) ===

export interface RecordCreatedEvent {
  record_id: ObjectId;
  patient: SuiAddress;
  content_hash: number[];
  hospital_id: number[];
  visit_timestamp_ms: string;
  created_at_ms: string;
  kind: number;
  covered_count: string;
}

export interface RecordRevokedEvent {
  record_id: ObjectId;
  patient: SuiAddress;
  revoked_at_ms: string;
}

export interface GrantIssuedEvent {
  grant_id: ObjectId;
  record_id: ObjectId;
  issuer: SuiAddress;
  scope: number;
  expires_at_ms: string;
  issued_at_ms: string;
}

export interface GrantConsumedEvent {
  grant_id: ObjectId;
  record_id: ObjectId;
  consumer: SuiAddress;
  consumed_at_ms: string;
}

export interface GrantRevokedEvent {
  grant_id: ObjectId;
  record_id: ObjectId;
  revoked_at_ms: string;
}

export interface DecryptionTicket {
  id: ObjectId;
  record_id: ObjectId;
  grant_id: ObjectId;
  holder: string;
  expires_at_ms: string;
}

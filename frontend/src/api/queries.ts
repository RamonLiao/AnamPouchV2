/**
 * Read-side helpers: fetch & decode RecordAnchor / AccessGrant objects.
 *
 * TRANSPORT: dApp Kit serves a `SuiGrpcClient` (gRPC is the supported transport
 * post-sui-2.x). However, gRPC has no historical event query and returns
 * objects as BCS bytes, while we still want JSON `fields` for hackathon speed.
 * This module spins up a private `SuiJsonRpcClient` and isolates all jsonRpc
 * usage here. Callers do NOT pass a client.
 *
 * TODO(post-hackathon): replace with
 *   - gRPC `core.getObject({include:{content:true}})` + BCS decoders for reads
 *   - custom indexer (see `sui-indexer` skill) or GraphQL (when stable) for
 *     historical event scans
 */

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { CONTRACT } from '../config/contract';
import type {
  AccessGrantFields,
  ObjectId,
  RecordAnchorFields,
  SuiAddress,
} from '../types/contracts';

type Network = 'mainnet' | 'testnet' | 'devnet' | 'localnet';

const NETWORK = (import.meta.env.VITE_SUI_NETWORK ?? 'testnet') as Network;

const jsonRpc = new SuiJsonRpcClient({
  network: NETWORK,
  url: getJsonRpcFullnodeUrl(NETWORK),
});

export async function fetchRecordAnchor(
  recordId: ObjectId,
): Promise<RecordAnchorFields | null> {
  const res = await jsonRpc.getObject({
    id: recordId,
    options: { showContent: true, showType: true },
  });
  const content = res.data?.content;
  if (!content || content.dataType !== 'moveObject') return null;
  if (!content.type.startsWith(`${CONTRACT.originalPackageId}::record_anchor::RecordAnchor`)) return null;
  return content.fields as unknown as RecordAnchorFields;
}

export async function fetchAccessGrant(
  grantId: ObjectId,
): Promise<AccessGrantFields | null> {
  const res = await jsonRpc.getObject({
    id: grantId,
    options: { showContent: true, showType: true },
  });
  const content = res.data?.content;
  if (!content || content.dataType !== 'moveObject') return null;
  if (!content.type.startsWith(`${CONTRACT.originalPackageId}::access_grant::AccessGrant`)) return null;
  return content.fields as unknown as AccessGrantFields;
}

/**
 * List a patient's RecordAnchors via RecordCreated event scan.
 * Anchors are SHARED objects (R6 fix), so owned-object queries don't work.
 */
export async function queryRecordCreatedByPatient(
  patient: SuiAddress,
  cursor?: string | null,
): Promise<{ records: ObjectId[]; nextCursor: string | null }> {
  const res = await jsonRpc.queryEvents({
    query: {
      MoveEventType: CONTRACT.events.recordCreated,
    },
    cursor: cursor ? (JSON.parse(cursor) as { txDigest: string; eventSeq: string }) : null,
    limit: 50,
    order: 'descending',
  });
  const records = res.data
    .filter((e: { parsedJson?: unknown }) => (e.parsedJson as { patient: string }).patient === patient)
    .map((e: { parsedJson?: unknown }) => (e.parsedJson as { record_id: ObjectId }).record_id);
  return {
    records,
    nextCursor: res.nextCursor ? JSON.stringify(res.nextCursor) : null,
  };
}

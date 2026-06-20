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

/**
 * Drain ALL pages of an event type. Status sets (revoked/used) MUST be
 * complete — a missed GrantRevoked event would mislabel a dead grant as Active
 * and offer a revoke that MoveAborts. Single-page truncation is therefore a
 * correctness bug here, not just a perf cap. Safe bound: stop after MAX_PAGES
 * to avoid an unbounded loop on a pathological history (logged if hit).
 */
const PAGE_LIMIT = 50;
const MAX_PAGES = 40; // 2000 events; raise + switch to indexer if ever hit

async function drainEvents(eventType: string): Promise<{ parsedJson?: unknown }[]> {
  const out: { parsedJson?: unknown }[] = [];
  let cursor: { txDigest: string; eventSeq: string } | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await jsonRpc.queryEvents({
      query: { MoveEventType: eventType },
      cursor,
      limit: PAGE_LIMIT,
      order: 'descending',
    });
    out.push(...res.data);
    if (!res.hasNextPage || !res.nextCursor) return out;
    cursor = res.nextCursor as { txDigest: string; eventSeq: string };
  }
  console.warn(`drainEvents(${eventType}) hit MAX_PAGES=${MAX_PAGES}; results may be truncated — migrate to an indexer.`);
  return out;
}

/** Record ids tombstoned via revoke_anchor (RecordRevoked event scan). */
export async function queryRevokedRecordIds(): Promise<Set<ObjectId>> {
  const data = await drainEvents(CONTRACT.events.recordRevoked);
  return new Set(
    data.map((e) => (e.parsedJson as { record_id: ObjectId }).record_id),
  );
}

export interface IssuedGrantRow {
  grantId: ObjectId;
  recordId: ObjectId;
  scope: number;
  expiresAtMs: string;
}

/**
 * List grants a patient issued, via GrantIssued event scan (grants are SHARED
 * objects so owned-object queries don't apply). Status (used/revoked/expired)
 * is derived client-side from the revoked/consumed id sets — see grantStatus.ts.
 */
export async function queryGrantsIssuedByPatient(
  patient: SuiAddress,
): Promise<IssuedGrantRow[]> {
  const data = await drainEvents(CONTRACT.events.grantIssued);
  return data
    .map((e) => e.parsedJson as {
      grant_id: ObjectId;
      record_id: ObjectId;
      issuer: string;
      scope: number;
      expires_at_ms: string;
    })
    .filter((p) => p.issuer === patient)
    .map((p) => ({
      grantId: p.grant_id,
      recordId: p.record_id,
      scope: Number(p.scope),
      expiresAtMs: String(p.expires_at_ms),
    }));
}

async function scanGrantIdSet(eventType: string): Promise<Set<ObjectId>> {
  const data = await drainEvents(eventType);
  return new Set(
    data.map((e) => (e.parsedJson as { grant_id: ObjectId }).grant_id),
  );
}

export function queryRevokedGrantIds(): Promise<Set<ObjectId>> {
  return scanGrantIdSet(CONTRACT.events.grantRevoked);
}

export function queryConsumedGrantIds(): Promise<Set<ObjectId>> {
  return scanGrantIdSet(CONTRACT.events.grantConsumed);
}

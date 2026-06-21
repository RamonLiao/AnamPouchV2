/**
 * Pure status derivation for issued AccessGrants, computed from event scans
 * (GrantIssued + GrantRevoked + GrantConsumed) instead of per-object getObject.
 *
 * Precedence mirrors the on-chain `revoke_grant` guards: a grant that is already
 * used OR revoked can no longer be revoked, so the UI must reflect those terminal
 * states first. `revoked` outranks `used` only for display labelling — on-chain
 * the two are mutually reachable but never both set, so order is cosmetic there.
 * Expiry is the weakest signal: it is enforced on-chain at consume time, here it
 * is a best-effort client-clock hint that only gates the (optional) Revoke button.
 */

import type { ObjectId } from '../types/contracts';

export type GrantStatus = 'active' | 'used' | 'revoked' | 'expired';

export interface IssuedGrant {
  grantId: ObjectId;
  recordId: ObjectId;
  scope: number;
  /** u64 ms as decimal string from the GrantIssued event. */
  expiresAtMs: string;
}

/**
 * @param revoked  set of grant ids seen in GrantRevoked events
 * @param consumed set of grant ids seen in GrantConsumed events
 * @param nowMs    current wall-clock ms (injected for testability)
 */
export function deriveGrantStatus(
  grant: IssuedGrant,
  revoked: Set<ObjectId>,
  consumed: Set<ObjectId>,
  nowMs: number,
): GrantStatus {
  if (revoked.has(grant.grantId)) return 'revoked';
  if (consumed.has(grant.grantId)) return 'used';
  if (Number(grant.expiresAtMs) <= nowMs) return 'expired';
  return 'active';
}

/**
 * Whether the Revoke button should be offered. Mirrors the on-chain
 * `revoke_grant` guards, which reject ONLY already-used or already-revoked
 * grants — expiry is NOT a guard there. Crucially, `expired` here is judged by
 * the client clock; if that clock runs fast a still-live grant looks expired,
 * so gating revoke on it would strand a grant the doctor can still consume.
 * Therefore expired stays revocable; only the event-confirmed terminal states
 * (used/revoked) are non-revocable.
 */
export function isRevocable(status: GrantStatus): boolean {
  return status === 'active';
}

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
 * Whether the Revoke button should be offered. Only `active` grants are
 * revocable — used/revoked are terminal, and an expired grant can no longer be
 * consumed on-chain (the Clock guard in consume_grant rejects it), so revoke
 * would be a pointless gas-burning no-op.
 *
 * KNOWN TRADE-OFF (revisit later): `expired` here is judged by the untrusted
 * client clock. If that clock runs fast, a grant the doctor can STILL consume
 * on-chain shows as "Expired" and loses its Revoke button (stranded). Two
 * future options under discussion: (1) keep hiding revoke on expired [current];
 * (2) stop using the client clock to label expiry at all and let the chain be
 * the sole authority, keeping revoke always available. See tasks/notes.md.
 */
export function isRevocable(status: GrantStatus): boolean {
  return status === 'active';
}

import { describe, it, expect } from 'vitest';
import { deriveGrantStatus, isRevocable, type IssuedGrant } from './grantStatus';
import type { ObjectId } from '../types/contracts';

const g = (id: string, expiresAtMs: string): IssuedGrant => ({
  grantId: id as ObjectId,
  recordId: '0xrec' as ObjectId,
  scope: 0,
  expiresAtMs,
});

const NOW = 1_000_000;

describe('deriveGrantStatus', () => {
  it('is active when not revoked/used and not yet expired', () => {
    const s = deriveGrantStatus(g('0x1', String(NOW + 1)), new Set(), new Set(), NOW);
    expect(s).toBe('active');
  });

  it('is expired when expires_at <= now', () => {
    // boundary: expiry exactly at now counts as expired (grant no longer valid at `now`)
    expect(deriveGrantStatus(g('0x1', String(NOW)), new Set(), new Set(), NOW)).toBe('expired');
    expect(deriveGrantStatus(g('0x1', String(NOW - 1)), new Set(), new Set(), NOW)).toBe('expired');
  });

  it('revoked outranks expired — a revoked grant must never show as merely expired', () => {
    // WHY: revoke is the patient's explicit action; surfacing it as "expired"
    // would hide that they cut access, which is the whole point of the UI.
    const past = String(NOW - 1);
    const s = deriveGrantStatus(g('0x1', past), new Set(['0x1' as ObjectId]), new Set(), NOW);
    expect(s).toBe('revoked');
  });

  it('used outranks expired', () => {
    const s = deriveGrantStatus(g('0x1', String(NOW - 1)), new Set(), new Set(['0x1' as ObjectId]), NOW);
    expect(s).toBe('used');
  });

  it('revoked outranks used (display precedence)', () => {
    const id = '0x1' as ObjectId;
    const s = deriveGrantStatus(g('0x1', String(NOW + 1)), new Set([id]), new Set([id]), NOW);
    expect(s).toBe('revoked');
  });
});

describe('isRevocable', () => {
  it('offers revoke only for active grants', () => {
    // WHY: used/revoked are terminal; an expired grant can no longer be
    // consumed on-chain, so revoking it is a pointless gas-burning no-op.
    // KNOWN TRADE-OFF (revisit, see tasks/notes.md): expiry is judged by the
    // untrusted client clock, so a fast clock can strand a still-consumable
    // grant. Accepted for now in favor of cleaner UX.
    expect(isRevocable('active')).toBe(true);
    expect(isRevocable('expired')).toBe(false);
    expect(isRevocable('used')).toBe(false);
    expect(isRevocable('revoked')).toBe(false);
  });
});

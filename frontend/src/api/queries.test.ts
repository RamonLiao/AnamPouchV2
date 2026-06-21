import { describe, it, expect } from 'vitest';
import { pickLatestSummary } from './queries';

const ev = (id: string, created: string, count: string, kind = 1) => ({
  record_id: id,
  patient: '0xpatient',
  kind,
  covered_count: count,
  created_at_ms: created,
});

describe('pickLatestSummary', () => {
  it('returns null for empty array', () => {
    expect(pickLatestSummary([], new Set())).toBeNull();
  });

  it('returns null when all kind=1 are tombstoned', () => {
    const events = [ev('0xa', '100', '2'), ev('0xb', '200', '3')];
    expect(pickLatestSummary(events as any, new Set(['0xa', '0xb']))).toBeNull();
  });

  it('picks highest created_at_ms among non-revoked kind=1', () => {
    const events = [ev('0xa', '100', '2'), ev('0xb', '300', '5'), ev('0xc', '200', '3')];
    // 0xb tombstoned — highest remaining is 0xc at 200
    const out = pickLatestSummary(events as any, new Set(['0xb']));
    expect(out?.recordId).toBe('0xc');
    expect(out?.coveredCount).toBe(3n);
    expect(out?.createdAtMs).toBe(200n);
  });

  it('excludes tombstoned entries', () => {
    const events = [ev('0xa', '500', '10'), ev('0xb', '400', '8')];
    const out = pickLatestSummary(events as any, new Set(['0xa']));
    expect(out?.recordId).toBe('0xb');
  });

  it('treats kind===undefined as 0 (not a summary)', () => {
    // events with no kind field should not be returned as summaries
    const events = [
      { record_id: '0xa', patient: '0xp', covered_count: '2', created_at_ms: '999' }, // kind undefined
    ];
    expect(pickLatestSummary(events as any, new Set())).toBeNull();
  });

  it('returns null when there are only kind=0 events', () => {
    const events = [ev('0xa', '100', '2', 0), ev('0xb', '200', '3', 0)];
    expect(pickLatestSummary(events as any, new Set())).toBeNull();
  });

  // ── Monkey ───────────────────────────────────────────────────────────────────

  it('returns null when all kind=1 candidates are revoked', () => {
    const events = [ev('0xa', '100', '2'), ev('0xb', '200', '3'), ev('0xc', '300', '4')];
    const out = pickLatestSummary(events as any, new Set(['0xa', '0xb', '0xc']));
    expect(out).toBeNull();
  });

  it('tie-break on equal created_at_ms: first-encountered wins (documented behavior)', () => {
    // Both have created_at_ms = '500'; neither is revoked.
    // The loop picks the first one that beats `best`; the second has equal ts (not >), so first wins.
    const events = [ev('0xfirst', '500', '3'), ev('0xlast', '500', '5')];
    const out = pickLatestSummary(events as any, new Set());
    expect(out?.recordId).toBe('0xfirst'); // strict > means equal does not replace
  });

  it('uses BigInt comparison for created_at_ms (not lexicographic)', () => {
    // Lexicographic: '9' > '10', but BigInt: 10n > 9n.
    // '0' is smallest, huge 18-digit string is largest.
    const events = [
      ev('0xzero', '0', '1'),
      ev('0xhuge', '999999999999999999', '10'),
      ev('0xsmall', '9', '2'),
    ];
    const out = pickLatestSummary(events as any, new Set());
    expect(out?.recordId).toBe('0xhuge');
    expect(out?.createdAtMs).toBe(999999999999999999n);
  });

  it('mixed revoked and live: skips revoked, picks best live', () => {
    const events = [
      ev('0xbest', '1000', '5'),  // revoked
      ev('0xsecond', '800', '4'), // live
      ev('0xthird', '600', '3'),  // live
    ];
    const out = pickLatestSummary(events as any, new Set(['0xbest']));
    expect(out?.recordId).toBe('0xsecond');
    expect(out?.createdAtMs).toBe(800n);
  });
});

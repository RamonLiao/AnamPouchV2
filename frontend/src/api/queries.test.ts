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
});

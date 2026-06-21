import { describe, it, expect } from 'vitest';
import { buildDashboard } from './dashboardQuery';

describe('buildDashboard', () => {
  it('counts records and sorts timeline ascending', () => {
    const anchors = [
      { recordId: '0xa' as `0x${string}`, visitMs: 300n },
      { recordId: '0xb' as `0x${string}`, visitMs: 100n },
    ];
    const out = buildDashboard(anchors, { recordId: '0xs' as `0x${string}`, coveredCount: 2n, createdAtMs: 9n });
    expect(out.recordCount).toBe(2);
    expect(out.timeline[0]!.visitMs).toBe(100n);
    expect(out.latestSummary?.recordId).toBe('0xs');
  });

  it('returns null latestSummary when none provided', () => {
    const anchors = [{ recordId: '0xa' as `0x${string}`, visitMs: 1n }];
    const out = buildDashboard(anchors, null);
    expect(out.recordCount).toBe(1);
    expect(out.latestSummary).toBeNull();
  });

  it('handles empty anchors', () => {
    const out = buildDashboard([], null);
    expect(out.recordCount).toBe(0);
    expect(out.timeline).toHaveLength(0);
  });

  it('does not mutate input array', () => {
    const anchors = [
      { recordId: '0xa' as `0x${string}`, visitMs: 500n },
      { recordId: '0xb' as `0x${string}`, visitMs: 200n },
    ];
    const original = [...anchors];
    buildDashboard(anchors, null);
    expect(anchors[0]!.visitMs).toBe(original[0]!.visitMs);
  });
});

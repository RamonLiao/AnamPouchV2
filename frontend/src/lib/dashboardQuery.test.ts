import { describe, it, expect, vi } from 'vitest';
import { buildDashboard, loadDashboard } from './dashboardQuery';

vi.mock('../api/queries', () => ({
  queryRevokedRecordIds: vi.fn(),
  queryRecordCreatedByPatient: vi.fn(),
  fetchRecordAnchor: vi.fn(),
  queryLatestSummary: vi.fn(),
}));

describe('loadDashboard', () => {
  it('excludes revoked records from recordCount and timeline', async () => {
    const { queryRevokedRecordIds, queryRecordCreatedByPatient, fetchRecordAnchor, queryLatestSummary } =
      await import('../api/queries');

    vi.mocked(queryRevokedRecordIds).mockResolvedValue(new Set(['0xrevoked' as `0x${string}`]));
    vi.mocked(queryRecordCreatedByPatient).mockResolvedValue({ records: ['0xactive' as `0x${string}`, '0xrevoked' as `0x${string}`] });
    vi.mocked(fetchRecordAnchor).mockResolvedValue({ visit_timestamp_ms: 1000 });
    vi.mocked(queryLatestSummary).mockResolvedValue(null);

    const result = await loadDashboard('0xpatient' as `0x${string}`);

    expect(result.recordCount).toBe(1);
    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0]!.recordId).toBe('0xactive');
  });
});

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

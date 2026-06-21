import { describe, it, expect, vi } from 'vitest';
import { regenerateSummary } from './summary';

const base = {
  decryptedRecords: [{ text: '頭痛', visitMs: 1n }, { text: '發燒', visitMs: 2n }],
  language: 'zh-TW' as const,
  oldSummaryId: '0xold' as const,
};

function deps(over: Partial<any> = {}) {
  return {
    gemini: vi.fn(async () => '兩次就診:頭痛、發燒。建議追蹤。'),
    createSummaryAnchor: vi.fn(async () => ({ recordId: '0xnew' as const })),
    revokeOld: vi.fn(async () => {}),
    ...over,
  };
}

describe('regenerateSummary', () => {
  it('summarizes, creates kind=1 anchor with covered_count, revokes old', async () => {
    const d = deps();
    const out = await regenerateSummary({ ...base, ...d });
    expect(out?.recordId).toBe('0xnew');
    expect(d.createSummaryAnchor).toHaveBeenCalledWith(
      expect.objectContaining({ coveredCount: 2n }));
    expect(d.revokeOld).toHaveBeenCalledWith('0xold');
  });

  it('returns null and does NOT throw when gemini fails', async () => {
    const d = deps({ gemini: vi.fn(async () => { throw new Error('LLM down'); }) });
    const out = await regenerateSummary({ ...base, ...d });
    expect(out).toBeNull();
    expect(d.createSummaryAnchor).not.toHaveBeenCalled();
  });

  it('does not revoke old when anchor creation fails', async () => {
    const d = deps({ createSummaryAnchor: vi.fn(async () => { throw new Error('chain'); }) });
    const out = await regenerateSummary({ ...base, ...d });
    expect(out).toBeNull();
    expect(d.revokeOld).not.toHaveBeenCalled();
  });
});

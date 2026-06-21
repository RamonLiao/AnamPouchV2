import { describe, it, expect, vi } from 'vitest';
import { regenerateSummary, makeExclusiveLock } from './summary';

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

describe('runSummaryExclusive', () => {
  it('serializes calls and preserves order', async () => {
    const run = makeExclusiveLock();
    const order: number[] = [];
    let resolveFirst!: (v: number) => void;
    const first = run<number>(() => new Promise<number>(res => { resolveFirst = res; }));
    // fn for `first` is deferred by one microtask; await to let it install
    await Promise.resolve();
    const second = run<number>(() => { order.push(2); return Promise.resolve(2); });
    // first is still pending — second's fn must NOT have started yet
    expect(order).toEqual([]);
    order.push(1);
    resolveFirst(1);
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).toBe(1);
    expect(r2).toBe(2);
    expect(order).toEqual([1, 2]);
  });

  it('rejection does not wedge subsequent calls', async () => {
    const run = makeExclusiveLock();
    const rejected = run<number>(() => Promise.reject(new Error('boom')));
    await expect(rejected).rejects.toThrow('boom');
    const resolved = run<number>(() => Promise.resolve(42));
    await expect(resolved).resolves.toBe(42);
  });

  it('each caller gets its own error on rejection', async () => {
    const run = makeExclusiveLock();
    const p = run<number>(() => Promise.reject(new Error('mine')));
    await expect(p).rejects.toThrow('mine');
  });
});

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

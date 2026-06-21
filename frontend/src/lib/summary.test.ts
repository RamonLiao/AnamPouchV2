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

  // ── Monkey: 10 rapid concurrent calls ────────────────────────────────────────
  it('10 concurrent calls run strictly in order, none lost', async () => {
    const run = makeExclusiveLock();
    const executed: number[] = [];
    const promises = Array.from({ length: 10 }, (_, i) =>
      run<number>(async () => { executed.push(i); return i; }),
    );
    const results = await Promise.all(promises);
    // All returned correct value
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // Executed in enqueue order (chained, not parallel)
    expect(executed).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('10 concurrent calls with one rejecting in the middle — rest still run', async () => {
    const run = makeExclusiveLock();
    const executed: number[] = [];
    const promises = Array.from({ length: 10 }, (_, i) =>
      run<number>(async () => {
        executed.push(i);
        if (i === 4) throw new Error(`fail-${i}`);
        return i;
      }),
    );
    const settled = await Promise.allSettled(promises);
    // Call 4 rejected
    expect(settled[4]!.status).toBe('rejected');
    expect((settled[4] as PromiseRejectedResult).reason.message).toBe('fail-4');
    // All others fulfilled
    for (let i = 0; i < 10; i++) {
      if (i !== 4) {
        expect(settled[i]!.status).toBe('fulfilled');
        expect((settled[i] as PromiseFulfilledResult<number>).value).toBe(i);
      }
    }
    // All 10 functions executed — rejection does not wedge subsequent calls
    expect(executed).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
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

  // ── Monkey ───────────────────────────────────────────────────────────────────

  it('returns null for empty decryptedRecords (no anchor, no revoke)', async () => {
    const d = deps();
    const out = await regenerateSummary({ ...base, decryptedRecords: [], ...d });
    expect(out).toBeNull();
    expect(d.createSummaryAnchor).not.toHaveBeenCalled();
    expect(d.revokeOld).not.toHaveBeenCalled();
  });

  it('returns null when gemini returns whitespace-only', async () => {
    const d = deps({ gemini: vi.fn(async () => '  \t\n  ') });
    const out = await regenerateSummary({ ...base, ...d });
    expect(out).toBeNull();
    expect(d.createSummaryAnchor).not.toHaveBeenCalled();
  });

  it('handles record with empty text among many — does not crash', async () => {
    const records = [
      { text: '', visitMs: 1n },
      { text: '發燒', visitMs: 2n },
      { text: '', visitMs: 3n },
      { text: '頭痛', visitMs: 4n },
    ];
    const d = deps();
    const out = await regenerateSummary({ ...base, decryptedRecords: records, ...d });
    // gemini called once, anchor created, no crash
    expect(d.gemini).toHaveBeenCalledTimes(1);
    expect(out?.recordId).toBe('0xnew');
    // coveredCount = 4 (all records, including empty-text ones)
    expect(d.createSummaryAnchor).toHaveBeenCalledWith(
      expect.objectContaining({ coveredCount: 4n }));
  });

  it('handles very large coveredCount (100000 records) — BigInt conversion correct', async () => {
    const records = Array.from({ length: 100000 }, (_, i) => ({ text: `r${i}`, visitMs: BigInt(i) }));
    const d = deps();
    const out = await regenerateSummary({ ...base, decryptedRecords: records, ...d });
    expect(out?.recordId).toBe('0xnew');
    expect(d.createSummaryAnchor).toHaveBeenCalledWith(
      expect.objectContaining({ coveredCount: 100000n }));
  });
});

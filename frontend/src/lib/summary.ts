import type { ObjectId } from '../types/contracts';

export interface DecryptedRecord { text: string; visitMs: bigint; }

export interface RegenerateSummaryArgs {
  decryptedRecords: DecryptedRecord[];
  language: 'zh-TW' | 'ja-JP' | 'en';
  oldSummaryId?: ObjectId | null;
  gemini: (prompt: string) => Promise<string>;
  createSummaryAnchor: (a: { summaryText: string; coveredCount: bigint }) => Promise<{ recordId: ObjectId }>;
  revokeOld?: (oldSummaryId: ObjectId) => Promise<void>;
}

function summaryPrompt(records: DecryptedRecord[], lang: 'zh-TW' | 'ja-JP' | 'en'): string {
  const label = { 'zh-TW': '繁體中文', 'ja-JP': '日本語', en: 'English' }[lang];
  const body = records
    .slice()
    .sort((a, b) => Number(a.visitMs - b.visitMs))
    .map((r, i) => `# 就診 ${i + 1} (ts=${r.visitMs})\n${r.text}`)
    .join('\n\n');
  return [
    `You are a clinical summarizer. Produce a longitudinal health summary in ${label}.`,
    `Cover: chronic conditions, medication history, allergies, notable trends across visits, and follow-up items.`,
    `Input may contain redaction tokens like [NAME_1] — preserve verbatim, never invent values.`,
    `Be concise. No disclaimers, no markdown fences.`,
    `\n--- VISITS ---\n${body}`,
  ].join('\n');
}

export async function regenerateSummary(args: RegenerateSummaryArgs): Promise<{ recordId: ObjectId } | null> {
  try {
    if (args.decryptedRecords.length === 0) return null;
    const summaryText = (await args.gemini(summaryPrompt(args.decryptedRecords, args.language))).trim();
    if (!summaryText) { console.warn('summary: empty LLM output'); return null; }
    const created = await args.createSummaryAnchor({
      summaryText,
      coveredCount: BigInt(args.decryptedRecords.length),
    });
    // Only revoke old after new anchor is successfully created — stale fork is tolerated.
    if (args.oldSummaryId && args.revokeOld) {
      try { await args.revokeOld(args.oldSummaryId); }
      catch (e) { console.warn('summary: revoke old failed (stale fork tolerated)', e); }
    }
    return created;
  } catch (e) {
    console.warn('summary: regeneration failed, skipped (record creation unaffected)', e);
    return null;
  }
}

// Single in-flight lock: prevents concurrent triggers from forking the version chain (best-effort, single tab).
let inflight: Promise<unknown> | null = null;
export async function runSummaryExclusive<T>(fn: () => Promise<T>): Promise<T> {
  while (inflight) { try { await inflight; } catch { /* ignore prior rejection */ } }
  const p = fn();
  inflight = p;
  try { return await p; } finally { if (inflight === p) inflight = null; }
}

/**
 * PII Redactor — mandatory chokepoint before sending text to any cloud LLM.
 *
 * THREAT MODEL (T15 from threat-model.md):
 *   Patient transcripts contain PHI (name, national ID, address, phone, DOB,
 *   diagnosis, hospital). Sending raw transcript to OpenAI/Gemini API leaks
 *   PHI to a third party that's outside our threat boundary.
 *
 * DESIGN:
 *   - Single function `redact(rawText)` returns a `RedactedText` branded type.
 *   - `AIProvider` interface only accepts `RedactedText`. TypeScript prevents
 *     calling `provider.summarize(rawTranscript)` — must go through redact().
 *   - Replacements use opaque tokens: `[NAME_1]`, `[NHI_1]`, `[PHONE_1]`...
 *     Same input → same token in one pass (so LLM can co-refer), different
 *     across pass invocations.
 *   - Detected patterns: TW national ID (with checksum), JP マイナンバー
 *     (12-digit + check digit), phone (TW/JP), email, DOB, address keywords,
 *     name regex+dictionary fallback (speculative — replace with NER later).
 *
 * NOT a substitute for proper NER. This is a defense-in-depth layer.
 * Audit logs MUST capture redaction stats so over/under-redaction shows up.
 */

export type RedactedText = string & { readonly __redacted: unique symbol };

export interface RedactionReport {
  redacted: RedactedText;
  stats: Record<RedactionCategory, number>;
  /** Mapping token → original (held only in memory, never sent off-device). */
  reverseMap: Map<string, string>;
}

export type RedactionCategory =
  | 'TW_NHI'
  | 'JP_MYNUMBER'
  | 'PHONE'
  | 'EMAIL'
  | 'DOB'
  | 'ADDRESS'
  | 'NAME';

interface Pattern {
  category: RedactionCategory;
  regex: RegExp;
  validate?: (match: string) => boolean;
}

// === TW National ID checksum (A-Z + 9 digits, weighted mod 10) ===
function validateTwNhi(id: string): boolean {
  if (!/^[A-Z][12]\d{8}$/.test(id)) return false;
  const letterMap: Record<string, number> = {
    A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17, I: 34, J: 18,
    K: 19, L: 20, M: 21, N: 22, O: 35, P: 23, Q: 24, R: 25, S: 26, T: 27,
    U: 28, V: 29, W: 32, X: 30, Y: 31, Z: 33,
  };
  const n = letterMap[id[0]!]!;
  const digits = [Math.floor(n / 10), n % 10, ...id.slice(1).split('').map(Number)];
  const weights = [1, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1];
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i]!, 0);
  return sum % 10 === 0;
}

// === JP マイナンバー (12 digits + check digit per Q value mod 11) ===
function validateJpMyNumber(id: string): boolean {
  if (!/^\d{12}$/.test(id)) return false;
  const weights = [6, 5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = id.slice(0, 11).split('').reduce((acc, d, i) => acc + Number(d) * weights[i]!, 0);
  const rem = sum % 11;
  const check = rem <= 1 ? 0 : 11 - rem;
  return check === Number(id[11]);
}

// === Speculative name dictionary (top common surnames). Replace with NER. ===
const NAME_HINTS = [
  // CJK common surnames — match 1 surname + 1-2 given chars
  /[陳林黃張李王吳劉蔡楊許鄭謝洪郭邱曾廖賴徐周葉蘇莊呂江何蕭羅高潘簡朱鍾彭游詹胡施沈余趙盧梁顏柯孫魏翁戴范方宋鄧杜傅侯曹薛丁卓馬董温唐藍石蔣古紀姚連馮歐程湯黄田康姜白汪鄒尤鐘巫黎涂龔嚴韓袁金童陸夏柳凃邵錢伍倪溫于譚谷駱關阮姬陶崔][一-鿿]{1,2}/g,
  // JP kanji name (姓+名 2-4 chars, very rough)
  /[一-龯]{2,4}(?=さん|様|医師|医生|patient)/g,
];

const PATTERNS: Pattern[] = [
  { category: 'TW_NHI', regex: /\b[A-Z][12]\d{8}\b/g, validate: validateTwNhi },
  { category: 'JP_MYNUMBER', regex: /\b\d{12}\b/g, validate: validateJpMyNumber },
  // TW mobile (09xx-xxx-xxx) + landline; JP mobile (070/080/090); generic intl
  { category: 'PHONE', regex: /\b(?:\+?886-?|0)9\d{2}-?\d{3}-?\d{3}\b/g },
  { category: 'PHONE', regex: /\b(?:\+?81-?)?0?[789]0-?\d{4}-?\d{4}\b/g },
  { category: 'EMAIL', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // Dates: YYYY-MM-DD, YYYY/MM/DD, 民國 NNN/MM/DD, JP 令和N年M月D日
  { category: 'DOB', regex: /\b(?:19|20)\d{2}[-/年]\d{1,2}[-/月]\d{1,2}日?\b/g },
  // No leading \b: 民 is a CJK char (not a JS word char), so \b never matches before it.
  { category: 'DOB', regex: /民國\s?\d{2,3}[-/年]\d{1,2}[-/月]\d{1,2}日?/g },
  // Address keywords
  { category: 'ADDRESS', regex: /[一-鿿0-9０-９]{2,8}(?:市|區|縣|鄉|鎮|里|村|路|街|巷|弄|號|樓)[一-鿿0-9０-９號樓-]{0,30}/g },
  { category: 'ADDRESS', regex: /\d{1,4}[-丁目]\d{1,4}(?:[-番]\d{1,4})?(?:号|号室)?/g },
];

export function redact(rawText: string): RedactionReport {
  const stats: Record<RedactionCategory, number> = {
    TW_NHI: 0, JP_MYNUMBER: 0, PHONE: 0, EMAIL: 0, DOB: 0, ADDRESS: 0, NAME: 0,
  };
  const counters: Record<RedactionCategory, number> = {
    TW_NHI: 0, JP_MYNUMBER: 0, PHONE: 0, EMAIL: 0, DOB: 0, ADDRESS: 0, NAME: 0,
  };
  const reverseMap = new Map<string, string>();
  const dedup = new Map<string, string>(); // original → token (within this pass)

  let out = rawText;

  const replaceWith = (match: string, category: RedactionCategory): string => {
    const cached = dedup.get(`${category}:${match}`);
    if (cached) return cached;
    counters[category] += 1;
    const token = `[${category}_${counters[category]}]`;
    dedup.set(`${category}:${match}`, token);
    reverseMap.set(token, match);
    stats[category] += 1;
    return token;
  };

  // Run structured PII first (highest precision).
  for (const { category, regex, validate } of PATTERNS) {
    out = out.replace(regex, (m) => {
      if (validate && !validate(m)) return m;
      return replaceWith(m, category);
    });
  }

  // Names last (lowest precision, may match inside already-replaced tokens — guard).
  for (const re of NAME_HINTS) {
    out = out.replace(re, (m) => {
      if (m.startsWith('[') && m.endsWith(']')) return m;
      return replaceWith(m, 'NAME');
    });
  }

  return { redacted: out as RedactedText, stats, reverseMap };
}

/**
 * Reverse a redacted LLM response back to original tokens.
 * Use this only when displaying the AI summary back to the patient on-device.
 * Never persist the de-redacted text without re-encrypting.
 */
export function unredact(text: string, reverseMap: Map<string, string>): string {
  let out = text;
  for (const [token, original] of reverseMap) {
    out = out.split(token).join(original);
  }
  return out;
}

/** Type guard / explicit cast for code paths that already redacted upstream. */
export function asRedacted(s: string): RedactedText {
  return s as RedactedText;
}

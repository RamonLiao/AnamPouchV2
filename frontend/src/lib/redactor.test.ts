/**
 * Tests for the PII redactor — the mandatory chokepoint before any cloud LLM call.
 * Each case encodes WHY: an under-redacted category here = real PHI leaking to a
 * third-party API (threat T15). Round-trip asserts unredact() is lossless so the
 * on-device summary can be restored without corrupting the original transcript.
 */
import { describe, it, expect } from 'vitest';
import { redact, unredact, type RedactionCategory } from './redactor';

const cases: Array<[string, string, Partial<Record<RedactionCategory, number>>]> = [
  ['TW NHI valid', '我的身分證 A123456789，電話 0912-345-678。', { TW_NHI: 1, PHONE: 1 }],
  ['TW NHI invalid checksum (should NOT redact)', '假身分證 A123456788', { TW_NHI: 0 }],
  ['JP my-number', 'マイナンバー 123456789018 です。', { JP_MYNUMBER: 1 }],
  ['email + address (TW)', '聯絡 foo@bar.com 住址：台北市大安區忠孝東路四段100號', { EMAIL: 1, ADDRESS: 1 }],
  // Gregorian (1980-05-12) + ROC era (民國 70/05/12) must both redact; 令和 not yet supported.
  ['DOB various formats', '出生 1980-05-12，民國 70/05/12，令和2年5月12日', { DOB: 2 }],
  ['CJK name hint', '陳大文 patient reports 頭痛', { NAME: 1 }],
];

describe('redact', () => {
  for (const [name, input, expected] of cases) {
    it(`detects expected PII counts: ${name}`, () => {
      const r = redact(input);
      for (const [k, v] of Object.entries(expected)) {
        expect(r.stats[k as RedactionCategory], `category ${k}`).toBe(v);
      }
    });

    it(`round-trips losslessly: ${name}`, () => {
      const r = redact(input);
      expect(unredact(r.redacted, r.reverseMap)).toBe(input);
    });
  }
});

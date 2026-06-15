/**
 * Smoke tests for the PII redactor. Run with `vitest` (add later if needed).
 * For now: import & assert in a dev-only route, or run via `tsx`.
 *
 *   pnpm tsx src/lib/redactor.test.ts
 */

import { redact, unredact } from './redactor';

const cases: Array<[string, string, Partial<Record<string, number>>]> = [
  [
    'TW NHI valid',
    '我的身分證 A123456789，電話 0912-345-678。',
    { TW_NHI: 1, PHONE: 1 },
  ],
  [
    'TW NHI invalid checksum (should NOT redact)',
    '假身分證 A123456788',
    { TW_NHI: 0 },
  ],
  [
    'JP my-number',
    'マイナンバー 123456789018 です。',
    { JP_MYNUMBER: 1 },
  ],
  [
    'email + address (TW)',
    '聯絡 foo@bar.com 住址：台北市大安區忠孝東路四段100號',
    { EMAIL: 1, ADDRESS: 1 },
  ],
  [
    'DOB various formats',
    '出生 1980-05-12，民國 70/05/12，令和2年5月12日',
    { DOB: 2 },
  ],
  [
    'CJK name hint',
    '陳大文 patient reports 頭痛',
    { NAME: 1 },
  ],
];

let pass = 0, fail = 0;
for (const [name, input, expect] of cases) {
  const r = redact(input);
  const ok = Object.entries(expect).every(([k, v]) => (r.stats as Record<string, number>)[k] === v);
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  console.log(`  in:  ${input}`);
  console.log(`  out: ${r.redacted}`);
  console.log(`  stats: ${JSON.stringify(r.stats)}`);
  if (!ok) {
    console.log(`  expected: ${JSON.stringify(expect)}`);
    fail++;
  } else {
    pass++;
  }

  // Round-trip
  const restored = unredact(r.redacted, r.reverseMap);
  if (restored !== input) {
    console.log(`  ✗ round-trip failed: ${restored}`);
    fail++;
  }
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);

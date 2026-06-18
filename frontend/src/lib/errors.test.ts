import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { explainMoveError } from './errors';

describe('explainMoveError', () => {
  it('maps named #[error] aborts (post-execution effects carry the const name)', () => {
    expect(explainMoveError('MoveAbort ... EGrantUsed ...').code).toBe('USED');
  });

  // Regression: dApp Kit dry-runs the tx before signing. That resolution error
  // omits the #[error] const name AND the byte-string, so a doctor re-consuming
  // a single-use grant must still get the friendly "already used" message —
  // otherwise replay protection looks like a generic on-chain failure.
  it('maps resolution-stage aborts (no const name) by function+line', () => {
    const raw =
      "Transaction resolution failed: MoveAbort in 1st command, abort code: 0, " +
      "in '0x003541284dfd4ff30719150942dda62970c1643d4d5fa7abf6183819c903bbd5" +
      "::access_grant::consume_grant' (line 171)";
    const friendly = explainMoveError(raw);
    expect(friendly.code).toBe('USED');
    expect(friendly.hint).toMatch(/single-use/i);
  });

  it('maps expired grant by location (line 174)', () => {
    const raw = "MoveAbort ... '0xabc::access_grant::consume_grant' (line 174)";
    expect(explainMoveError(raw).code).toBe('EXPIRED');
  });

  it('falls back to generic for an unmapped MoveAbort line', () => {
    const raw = "MoveAbort ... '0xabc::access_grant::consume_grant' (line 999)";
    expect(explainMoveError(raw).code).toBe('MOVE_ABORT');
  });

  // Source-map guard. BY_LOCATION keys (function:line) are bound to the deployed
  // contract's source map. If access_grant.move is edited & redeployed but the TS
  // table isn't updated, a doctor would silently see the WRONG friendly message
  // (e.g. "expired" instead of "already used"). This test reads the real Move
  // source and asserts each mapped line is still the abort site we think it is —
  // so a line shift fails loudly here instead of in production.
  describe('BY_LOCATION line numbers match access_grant.move source', () => {
    const MOVE_SRC = resolve(process.cwd(), '../contracts/portable_health/sources/access_grant.move');
    const lines = readFileSync(MOVE_SRC, 'utf8').split('\n');
    // line (1-indexed in abort msg) -> { const it must assert, code explainMoveError must return }
    const EXPECTED: Record<number, { konst: string; code: string }> = {
      168: { konst: 'ERecordMismatch', code: 'MISMATCH' },
      169: { konst: 'ERecordRevoked', code: 'CASCADED' },
      170: { konst: 'EGrantRevoked', code: 'REVOKED' },
      171: { konst: 'EGrantUsed', code: 'USED' },
      174: { konst: 'EGrantExpired', code: 'EXPIRED' },
      177: { konst: 'EInvalidToken', code: 'BAD_TOKEN' },
    };
    for (const [lineStr, { konst, code }] of Object.entries(EXPECTED)) {
      const lineNo = Number(lineStr);
      it(`line ${lineNo} asserts ${konst} and maps to ${code}`, () => {
        const srcLine = lines[lineNo - 1] ?? '';
        expect(srcLine, `source line ${lineNo}: ${srcLine.trim()}`).toContain(konst);
        const raw = `MoveAbort ... '0xpkg::access_grant::consume_grant' (line ${lineNo})`;
        expect(explainMoveError(raw).code).toBe(code);
      });
    }
  });
});

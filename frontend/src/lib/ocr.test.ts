import { describe, it, expect } from 'vitest';
import { extractText } from './ocr';

const img = { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' };

describe('extractText', () => {
  it('returns OCR text from gemini', async () => {
    const gemini = async () => '主訴:頭痛三天';
    const out = await extractText({ image: img, language: 'zh-TW', gemini });
    expect(out).toBe('主訴:頭痛三天');
  });

  it('throws when gemini returns blank', async () => {
    const gemini = async () => '   ';
    await expect(extractText({ image: img, language: 'zh-TW', gemini }))
      .rejects.toThrow(/no text|empty/i);
  });

  // ── Monkey: whitespace-only variants ────────────────────────────────────────
  it('throws when gemini returns tabs-only', async () => {
    const gemini = async () => '\t\t\t';
    await expect(extractText({ image: img, language: 'zh-TW', gemini }))
      .rejects.toThrow(/no text|empty/i);
  });

  it('throws when gemini returns newlines-only', async () => {
    const gemini = async () => '\n\n\r\n';
    await expect(extractText({ image: img, language: 'zh-TW', gemini }))
      .rejects.toThrow(/no text|empty/i);
  });

  it('throws when gemini returns mixed whitespace (space+tab+newline)', async () => {
    const gemini = async () => '  \t  \n  ';
    await expect(extractText({ image: img, language: 'zh-TW', gemini }))
      .rejects.toThrow(/no text|empty/i);
  });

  // ── Monkey: redaction-token garbage — OCR must pass through unchanged ───────
  it('passes redaction tokens through verbatim (redaction is not OCR job)', async () => {
    const garbage = '[NAME_1] [DATE_2] [MED_3] [PHONE_4]';
    const gemini = async () => garbage;
    const out = await extractText({ image: img, language: 'zh-TW', gemini });
    expect(out).toBe(garbage);
  });

  it('passes mixed real text + redaction tokens through unchanged', async () => {
    const mixed = '血壓 [VALUE_1] mmHg, 體重 [VALUE_2] kg';
    const gemini = async () => mixed;
    const out = await extractText({ image: img, language: 'zh-TW', gemini });
    expect(out).toBe(mixed);
  });

  // ── Monkey: zero-byte image ──────────────────────────────────────────────────
  it('does not crash on zero-byte image (toBase64 returns empty string)', async () => {
    const zeroImg = { bytes: new Uint8Array(0), mimeType: 'image/png' };
    // gemini fake returns real text — proves toBase64(empty) doesn't throw
    const gemini = async () => 'some text';
    const out = await extractText({ image: zeroImg, language: 'en', gemini });
    expect(out).toBe('some text');
  });

  it('zero-byte image + gemini returns empty → throws cleanly (no crash in toBase64)', async () => {
    const zeroImg = { bytes: new Uint8Array(0), mimeType: 'image/png' };
    const gemini = async () => '';
    await expect(extractText({ image: zeroImg, language: 'en', gemini }))
      .rejects.toThrow(/no text|empty/i);
  });
});

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
});

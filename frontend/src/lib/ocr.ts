import type { GeminiPart } from './gemini';

export type GeminiCall = (parts: GeminiPart[], systemPrompt: string) => Promise<string>;

function ocrPrompt(lang: 'zh-TW' | 'ja-JP' | 'en'): string {
  const label = { 'zh-TW': '繁體中文', 'ja-JP': '日本語', en: 'English' }[lang];
  return [
    `You are a medical-document OCR engine. Transcribe ALL visible text from the image verbatim.`,
    `Preserve numbers, units, and table structure as plain text. Output language as printed; primary expected language: ${label}.`,
    `Output ONLY the transcribed text — no commentary, no markdown fences.`,
  ].join('\n');
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

export async function extractText(args: {
  image: { bytes: Uint8Array; mimeType: string };
  language: 'zh-TW' | 'ja-JP' | 'en';
  gemini: GeminiCall;
}): Promise<string> {
  const parts: GeminiPart[] = [
    { text: 'Transcribe this medical document.' },
    { inlineData: { mimeType: args.image.mimeType, data: toBase64(args.image.bytes) } },
  ];
  const raw = await args.gemini(parts, ocrPrompt(args.language));
  const text = raw.trim();
  if (!text) throw new Error('OCR returned empty text');
  return text;
}

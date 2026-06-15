/**
 * AIProvider — pluggable LLM backend.
 *
 * SECURITY GATE: every method takes `RedactedText`, NOT `string`. TypeScript
 * forbids passing raw transcripts. Any caller must go through `redact()`.
 *
 * MVP adapters: OpenAI, Gemini (cloud — disclosed in demo).
 * Post-hackathon: LocalLlamaAdapter (on-device WebLLM) → swap without API change.
 */

import type { RedactedText } from './redactor';

export interface SummarizeRequest {
  transcript: RedactedText;
  hospitalContextHint?: RedactedText;
  language: 'zh-TW' | 'ja-JP' | 'en';
}

export interface SummarizeResponse {
  /** Structured summary fields. Each field is plain text potentially containing
   *  redaction tokens (e.g. `[NAME_1]`) that the caller can `unredact()`. */
  chiefComplaint: string;
  history: string;
  recommendations: string[];
  /** Provider-specific metadata for audit (model name, latency, token usage). */
  meta: { provider: string; model: string; latencyMs: number };
}

export interface AIProvider {
  readonly name: string;
  summarize(req: SummarizeRequest): Promise<SummarizeResponse>;
}

// === OpenAI adapter (MVP) ===

export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';
  constructor(private readonly opts: { apiKey: string; model?: string; baseUrl?: string }) {}

  async summarize(req: SummarizeRequest): Promise<SummarizeResponse> {
    const t0 = performance.now();
    const model = this.opts.model ?? 'gpt-4o-mini';
    const sys = systemPrompt(req.language);
    const res = await fetch(`${this.opts.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: req.transcript },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    const json = await res.json() as { choices: Array<{ message: { content: string } }> };
    const parsed = JSON.parse(json.choices[0]!.message.content) as {
      chief_complaint: string; history: string; recommendations: string[];
    };
    return {
      chiefComplaint: parsed.chief_complaint,
      history: parsed.history,
      recommendations: parsed.recommendations,
      meta: { provider: 'openai', model, latencyMs: performance.now() - t0 },
    };
  }
}

// === Gemini adapter (MVP) ===

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  constructor(private readonly opts: { apiKey: string; model?: string }) {}

  async summarize(req: SummarizeRequest): Promise<SummarizeResponse> {
    const t0 = performance.now();
    const model = this.opts.model ?? 'gemini-2.0-flash-exp';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.opts.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt(req.language) }] },
        contents: [{ role: 'user', parts: [{ text: req.transcript }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    const json = await res.json() as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const parsed = JSON.parse(json.candidates[0]!.content.parts[0]!.text) as {
      chief_complaint: string; history: string; recommendations: string[];
    };
    return {
      chiefComplaint: parsed.chief_complaint,
      history: parsed.history,
      recommendations: parsed.recommendations,
      meta: { provider: 'gemini', model, latencyMs: performance.now() - t0 },
    };
  }
}

function systemPrompt(lang: SummarizeRequest['language']): string {
  const langLabel = { 'zh-TW': '繁體中文', 'ja-JP': '日本語', en: 'English' }[lang];
  return [
    `You summarize medical visit transcripts into structured JSON. Output language: ${langLabel}.`,
    `Schema: { "chief_complaint": string, "history": string, "recommendations": string[] }.`,
    `The input may contain opaque redaction tokens like [NAME_1], [NHI_1], [PHONE_1]. Preserve them verbatim — never invent values.`,
    `Be concise and clinically accurate. Do not add disclaimers.`,
  ].join('\n');
}

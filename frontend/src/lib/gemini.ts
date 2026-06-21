export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export async function geminiGenerate(opts: {
  apiKey: string; model: string; systemPrompt: string;
  parts: GeminiPart[]; jsonMime?: boolean;
}): Promise<string> {
  if (!opts.apiKey) throw new Error('Gemini API key missing (VITE_GEMINI_API_KEY)');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent?key=${opts.apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.systemPrompt }] },
      contents: [{ role: 'user', parts: opts.parts }],
      ...(opts.jsonMime ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const json = await res.json() as { candidates?: Array<{ content: { parts: Array<{ text: string }> } }> };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text == null) throw new Error('Gemini returned no text');
  return text;
}

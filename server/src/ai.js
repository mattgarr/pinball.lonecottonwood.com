import { config } from './config.js';

// Calls a local OpenAI-compatible endpoint (LM Studio / Ollama) with a base64 photo
// and asks for JSON-only score extraction. When config.ai.stub is true, returns a
// canned response so Phase 0 can round-trip without the model running.
export async function extractScore({ imageBase64, machineHint }) {
  if (config.ai.stub) {
    // Deterministic-ish stub: returns one high-confidence score so the confirm flow works.
    return {
      scores: [config.ai.stubScore ?? 1234567],
      confidence: 'high',
      stub: true,
    };
  }

  const prompt = [
    `You are reading a pinball score display.`,
    machineHint ? `Machine: ${machineHint}.` : null,
    `Return ONLY JSON in this exact shape: {"scores": [<int>, ...], "confidence": "high" | "low"}.`,
    `Each entry in "scores" is one distinct score-like number visible on the display, as an integer with no separators.`,
    `If you cannot read a clear score, return {"scores": [], "confidence": "low"}.`,
  ].filter(Boolean).join(' ');

  const body = {
    model: config.ai.model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
        ],
      },
    ],
    temperature: 0,
    response_format: { type: 'json_object' },
  };

  const res = await fetch(config.ai.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AI endpoint ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  try {
    const parsed = JSON.parse(text);
    return {
      scores: Array.isArray(parsed.scores) ? parsed.scores.map(n => Math.trunc(Number(n))).filter(Number.isFinite) : [],
      confidence: parsed.confidence === 'high' ? 'high' : 'low',
    };
  } catch {
    return { scores: [], confidence: 'low' };
  }
}

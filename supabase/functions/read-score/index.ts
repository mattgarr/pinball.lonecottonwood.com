// read-score: save a score-display photo as proof, then ask Gemini to read every player's score.
// Deploy with "Verify JWT" OFF (the app sends its own player token). Secret needed: GEMINI_API_KEY.
import { createClient } from 'npm:@supabase/supabase-js@2';

const MODEL = 'gemini-3.8-flash';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SCHEMA = {
  type: 'object',
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: { slot: { type: 'integer' }, value: { type: 'integer' } },
        required: ['slot', 'value'],
      },
    },
    confidence: { type: 'string', enum: ['high', 'low'] },
    note: { type: 'string' },
  },
  required: ['scores', 'confidence'],
};

// Find the model's JSON answer anywhere in the response (robust to response-shape details).
function findAnswer(node: unknown): { scores: { slot: number; value: number }[]; confidence: string; note?: string } | null {
  if (typeof node === 'string') {
    try {
      const v = JSON.parse(node);
      if (v && Array.isArray(v.scores)) return v;
    } catch { /* not JSON */ }
    return null;
  }
  if (Array.isArray(node)) {
    for (let i = node.length - 1; i >= 0; i--) { const r = findAnswer(node[i]); if (r) return r; }
    return null;
  }
  if (node && typeof node === 'object') {
    for (const v of Object.values(node as Record<string, unknown>)) { const r = findAnswer(v); if (r) return r; }
  }
  return null;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const { token, machine_id, image } = await req.json();
    if (typeof image !== 'string' || image.length > 4_000_000) return json({ error: 'Photo missing or too large.' }, 400);
    const b64 = image.replace(/^data:image\/\w+;base64,/, '');

    // Newer projects expose secret keys as JSON in SUPABASE_SECRET_KEYS; older ones as SUPABASE_SERVICE_ROLE_KEY.
    let serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!serviceKey) {
      try { serviceKey = Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}'))[0] as string; } catch { /* ignore */ }
    }
    const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
      auth: { persistSession: false },
    });

    // Valid player + rate limit.
    const gate = await db.rpc('photo_gate', { p_token: token });
    if (gate.error) return json({ error: gate.error.message }, 403);

    const { data: machine } = await db.from('machines').select('name, manufacturer, year, display_type').eq('id', machine_id).single();
    if (!machine) return json({ error: 'Unknown machine.' }, 400);

    // Save the photo as proof first, so it's kept even if the AI read fails.
    const photoPath = `photos/${crypto.randomUUID()}.jpg`;
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const up = await db.storage.from('score-photos').upload(photoPath, bytes, { contentType: 'image/jpeg' });
    const savedPath = up.error ? null : photoPath;

    // GEMINI_API_KEY, or any secret whose value looks like a Google AI key (it was once saved under another name).
    const key = Deno.env.get('GEMINI_API_KEY') ??
      Object.values(Deno.env.toObject()).find(v => /^(AIza|AQ\.)[\w.-]{20,}$/.test(v.trim()))?.trim();
    if (!key) return json({ scores: [], confidence: 'low', note: 'AI reading is not set up.', photoPath: savedPath });

    const prompt =
      `This photo shows the score display of the pinball machine "${machine.name}" ` +
      `(${machine.manufacturer} ${machine.year}, ${machine.display_type} display). ` +
      `Read the score of every player shown. slot = the player number (1-4): use on-screen labels like "PLAYER 2" / "P2" when present; ` +
      `on older machines with four separate score displays, Player 1 is top-left, 2 top-right, 3 bottom-left, 4 bottom-right. ` +
      `Ignore credits, ball-in-play, match, high-score-table and timer numbers. ` +
      `value = the full score as an integer with no commas. Only include scores you can actually see; never guess digits. ` +
      `confidence = "high" only if every digit you report is clearly legible, otherwise "low". ` +
      `If this isn't a pinball score display, return no scores and say why in note.`;

    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json', 'Api-Revision': '2026-05-20' },
      body: JSON.stringify({
        model: MODEL,
        store: false,
        input: [
          { type: 'text', text: prompt },
          { type: 'image', data: b64, mime_type: 'image/jpeg' },
        ],
        response_format: { type: 'text', mime_type: 'application/json', schema: SCHEMA },
        generation_config: { thinking_level: 'low' },
      }),
    });
    const body = await r.json().catch(() => null);
    if (!r.ok) {
      console.error('gemini error', r.status, JSON.stringify(body)?.slice(0, 2000));
      return json({ scores: [], confidence: 'low', note: "Couldn't read the photo. Type the score instead.", photoPath: savedPath });
    }
    const answer = findAnswer(body);
    if (!answer) {
      console.error('no answer in', JSON.stringify(body)?.slice(0, 2000));
      return json({ scores: [], confidence: 'low', note: "Couldn't read the photo. Type the score instead.", photoPath: savedPath });
    }
    const scores = answer.scores
      .filter(s => Number.isInteger(s.slot) && Number.isFinite(s.value) && s.value >= 0)
      .sort((a, b) => a.slot - b.slot);
    return json({ scores, confidence: answer.confidence === 'high' ? 'high' : 'low', note: answer.note ?? '', photoPath: savedPath });
  } catch (e) {
    console.error(e);
    return json({ error: 'Something went wrong reading the photo.' }, 500);
  }
});

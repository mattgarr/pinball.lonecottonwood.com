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
    screen: { type: 'string', enum: ['player_scores', 'high_score', 'other'] },
    label_glowing: { type: 'boolean' },
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
  required: ['screen', 'scores', 'confidence'],
};

// Find the model's JSON answer anywhere in the response (robust to response-shape details).
type Answer = { screen?: string; label_glowing?: boolean; scores: { slot: number; value: number }[]; confidence: string; note?: string };
function findAnswer(node: unknown): Answer | null {
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
    const t0 = Date.now();
    const { token, machine_id, image, extra, video, fps } = await req.json();
    if (typeof image !== 'string' || image.length > 4_000_000) return json({ error: 'Photo missing or too large.' }, 400);
    const b64 = image.replace(/^data:image\/\w+;base64,/, '');
    // Extra frames from a live scan (same display, ~3 s): the screen may cycle or flicker between them.
    const extras: string[] = Array.isArray(extra)
      ? extra.filter((x: unknown) => typeof x === 'string' && x.length < 4_000_000).slice(0, 5).map((x: string) => x.replace(/^data:image\/\w+;base64,/, ''))
      : [];

    // Newer projects expose secret keys as JSON in SUPABASE_SECRET_KEYS; older ones as SUPABASE_SERVICE_ROLE_KEY.
    let serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!serviceKey) {
      try { serviceKey = Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}'))[0] as string; } catch { /* ignore */ }
    }
    const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
      auth: { persistSession: false },
    });

    // Valid player + rate limit, and the machine, in parallel.
    const [gate, mres] = await Promise.all([
      db.rpc('photo_gate', { p_token: token }),
      db.from('machines').select('name, manufacturer, year, display_type').eq('id', machine_id).single(),
    ]);
    if (gate.error) return json({ error: gate.error.message }, 403);
    const machine = mres.data;
    if (!machine) return json({ error: 'Unknown machine.' }, 400);

    // Save the photo as proof in the background while the AI reads it.
    const photoPath = `photos/${crypto.randomUUID()}.jpg`;
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const upload = db.storage.from('score-photos').upload(photoPath, bytes, { contentType: 'image/jpeg' });
    const saved = async () => ((await upload).error ? null : photoPath);

    // GEMINI_API_KEY, or any secret whose value looks like a Google AI key (it was once saved under another name).
    const key = Deno.env.get('GEMINI_API_KEY') ??
      Object.values(Deno.env.toObject()).find(v => /^(AIza|AQ\.)[\w.-]{20,}$/.test(v.trim()))?.trim();
    if (!key) return json({ scores: [], confidence: 'low', note: 'AI reading is not set up.', photoPath: await saved() });

    const about = `the pinball machine "${machine.name}" (${machine.manufacturer} ${machine.year}, ${machine.display_type} display)`;
    const rules =
      `slot = player number 1-4: use on-screen labels like "PLAYER 2" / "P2" when present; on older machines with four separate ` +
      `score displays, Player 1 is top-left, 2 top-right, 3 bottom-left, 4 bottom-right. ` +
      `Ignore credits, ball-in-play, match and timer numbers. Blank or "00" displays are unused player slots: leave them out. ` +
      `7-segment displays: count only brightly LIT segments; unlit segments stay faintly visible (dim 8s) and glare can fake a lit segment. ` +
      `Check confusable digits by which segments are lit: 3 vs 2 (3 = lower-RIGHT lit, 2 = lower-LEFT lit), 5 vs 6, 6 vs 8, 0 vs 8, 1 vs 7, 9 vs 8. ` +
      `value = the full number as an integer with no commas. Never guess a digit: if glare hides part of a number, leave that display out. ` +
      `confidence = "high" only if every digit you report is clearly legible, otherwise "low".`;
    const framePrompt =
      `This photo shows the score displays of ${about}, taken just after a game. After a game many machines ALTERNATE between ` +
      `the players' scores and the all-time high score. Classify the screen: "high_score" if a HIGH SCORE TO DATE / HIGH SCORE / ` +
      `GRAND CHAMPION label is GLOWING (lit from behind; note such labels are often printed on the glass and visible even when NOT lit, ` +
      `which does not count) or a high-score table is shown; "player_scores" if the displays show the players' game scores; ` +
      `"other" for logos, animations or anything else. label_glowing = whether such a label is actually lit. ` +
      `In ALL cases, list the numbers shown on the player score displays in scores. ` + rules;
    const videoPrompt =
      `This short video shows the score displays of ${about}, filmed just after a game while the camera moves a little. ` +
      `The displays may ALTERNATE between the players' scores and the all-time high score (shown with a glowing HIGH SCORE TO DATE / ` +
      `HIGH SCORE / GRAND CHAMPION label, or as a high-score table); they may also flicker, and glare moves as the camera moves. ` +
      `Report each PLAYER's score from the game that just ended, using the moments where it is clearest. NEVER report the high score. ` +
      `Set screen = "player_scores" if you found player scores, otherwise "high_score" or "other" and explain in note. ` + rules;

    async function ask(parts: unknown[], label: string): Promise<Answer | null> {
      const body = (extra: Record<string, unknown>) => JSON.stringify({
        model: MODEL, store: false, input: parts,
        response_format: { type: 'text', mime_type: 'application/json', schema: SCHEMA },
        generation_config: { thinking_level: 'low' }, ...extra,
      });
      try {
        let r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
          method: 'POST', signal: AbortSignal.timeout(label === 'video' ? 30000 : 12000),
          headers: { 'x-goog-api-key': key!, 'Content-Type': 'application/json', 'Api-Revision': '2026-05-20' },
          body: body({}),
        });
        let out = await r.json().catch(() => null);
        if (!r.ok) { console.error('gemini error', label, r.status, JSON.stringify(out)?.slice(0, 800)); return null; }
        const a = findAnswer(out);
        if (!a) console.error('no answer', label, JSON.stringify(out)?.slice(0, 800));
        return a;
      } catch (e) {
        console.error('gemini call failed', label, String(e));
        return null;
      }
    }

    // ---- Experimental: one video clip, read in a single call ----
    if (typeof video === 'string' && video.startsWith('data:video/') && video.length < 15_000_000) {
      const mime = (video.match(/^data:(video\/[\w-]+)/) || [])[1] || 'video/mp4';
      const vdata = video.slice(video.indexOf(',') + 1);
      const a = await ask([
        { type: 'video', data: vdata, mime_type: mime, processing: { type: 'static', fps: Math.min(15, Math.max(1, Number(fps) || 4)) } },
        { type: 'text', text: videoPrompt },
      ], 'video');
      const scores = (a?.scores ?? []).filter(x => Number.isInteger(x.slot) && Number.isFinite(x.value) && x.value > 0).sort((x, y) => x.slot - y.slot);
      const res = { scores, confidence: a?.confidence === 'high' ? 'high' : 'low', note: a ? (a.note ?? '') : "Couldn't read the video.", photoPath: await saved(), mode: 'video', fps: Math.min(15, Math.max(1, Number(fps) || 4)), ms: Date.now() - t0 };
      console.log('read-score', JSON.stringify({ ...res, machine: machine.name, videoKB: Math.round(vdata.length * 0.75 / 1024), mime }));
      return json(res);
    }

    // ---- Frames: read each separately, in parallel; stop early once enough frames agree ----
    const frames = [b64, ...extras];
    const good = (a: Answer) => (a.scores ?? []).filter(x => Number.isInteger(x.slot) && Number.isFinite(x.value) && x.value > 0);
    // On 7-segment machines the HIGH SCORE label is printed on the glass, so trust only "glowing", not the screen guess.
    const hsFrame = (a: Answer) => a.label_glowing === true || (a.screen === 'high_score' && machine.display_type !== '7-segment');
    const ok: Answer[] = [];
    function decide() {
      // Numbers seen on high-score screens are the high score, wherever else they show up.
      const highScores = new Set(ok.filter(hsFrame).flatMap(a => good(a).map(x => x.value)));
      const votes = new Map<number, Map<number, { n: number; high: number }>>();
      let scoreFrames = 0;
      for (const a of ok) {
        if (a.screen === 'other' || hsFrame(a)) continue;
        const vals = good(a).filter(x => !highScores.has(x.value));
        if (!vals.length) continue;
        scoreFrames++;
        for (const x of vals) {
          if (!votes.has(x.slot)) votes.set(x.slot, new Map());
          const m = votes.get(x.slot)!;
          const v = m.get(x.value) ?? { n: 0, high: 0 };
          v.n++; if (a.confidence === 'high') v.high++;
          m.set(x.value, v);
        }
      }
      let allSure = true, settled = true;
      const scores: { slot: number; value: number }[] = [];
      for (const [slot, m] of [...votes].sort((a, b) => a[0] - b[0])) {
        const ranked = [...m].sort((a, b) => b[1].n - a[1].n || b[1].high - a[1].high);
        const [value, top] = ranked[0];
        const total = ranked.reduce((t, [, v]) => t + v.n, 0);
        if (ok.length >= 3 && total === 1 && scoreFrames >= 3) continue; // one-off reading among many: noise
        const sure = ok.length === 1 ? top.high > 0 : (top.n >= 2 && top.n / total >= 0.6);
        if (!sure) allSure = false;
        if (top.n < 3 || (ranked[1]?.[1].n ?? 0) >= 2) settled = false;
        scores.push({ slot, value });
      }
      return { scores, allSure, scoreFrames, settled: settled && scores.length > 0 };
    }
    await new Promise<void>(resolve => {
      let pending = frames.length;
      frames.forEach((d, i) => {
        ask([{ type: 'text', text: framePrompt }, { type: 'image', data: d, mime_type: 'image/jpeg' }], 'frame' + i).then(a => {
          if (a) ok.push(a);
          pending--;
          if (pending === 0 || decide().settled) resolve(); // 3+ frames agree on every player: don't wait for stragglers
        });
      });
    });
    if (!ok.length) return json({ scores: [], confidence: 'low', note: "Couldn't read the photo. Type the score instead.", photoPath: await saved() });
    const d = decide();
    const note = d.scores.length ? '' : (ok.map(a => a.note).find(t => t) || 'scores screen not visible');
    const res = { scores: d.scores, confidence: d.scores.length && d.allSure ? 'high' : 'low', note, photoPath: await saved(), mode: 'frames', frames: ok.length, scoreFrames: d.scoreFrames, ms: Date.now() - t0 };
    console.log('read-score', JSON.stringify({ ...res, machine: machine.name, perFrame: ok.map(a => ({ s: a.screen, g: a.label_glowing, v: good(a).map(x => x.slot + ':' + x.value), c: a.confidence })) }));
    return json(res);
  } catch (e) {
    console.error(e);
    return json({ error: 'Something went wrong reading the photo.' }, 500);
  }
});

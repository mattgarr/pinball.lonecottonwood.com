// booth: the two-host announce booth. The TV sends a short digest of what's happening tonight; Gemini
// writes a 2-5 line exchange between DONNIE (the fun-center DJ voice: cheesy hype dad) and DASH (the
// arcade hype voice: fast play-by-play), every line is checked (family party: no bad words, no teasing
// people about anything but their pinball), voiced with the two designed voices and stitched into one
// WAV in the public `tts` bucket. Deploy with "Verify JWT" OFF. Secret: GEMINI_API_KEY.
//   { pass | token, digest, roast?: 'gentle'|'spicy', names?: "Stacia=Stay-sha, …", avoid?: [lines] }
//     -> { url, ms, lines: [{ host, text }], took }
import { createClient } from 'npm:@supabase/supabase-js@2';

const TEXT_MODEL = 'gemini-3.8-flash';
const TTS_MODEL = 'gemini-3.8-flash-tts';
const API = 'https://generativelanguage.googleapis.com/v1beta';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// The hosts: which announcer voice each one uses, and how they talk.
const HOSTS: Record<string, { pack: string; prebuilt: string; style: string }> = {
  DONNIE: { pack: 'dj', prebuilt: 'Puck', style: 'cheesy, warm and upbeat, a fun-center DJ on the mic, chatting with his co-host' },
  DASH: { pack: 'hype', prebuilt: 'Fenrir', style: 'fast, excited play-by-play sportscaster, chatting with his co-host' },
};
// Names the voices get wrong (keep in sync with web/src/lib/audio/pronounce.json).
const PRONOUNCE: Record<string, string> = { Stacia: 'Stay-sha' };

// Words that never go out over the PA (the nickname blocklist, plus teasing that isn't about pinball).
const SUBS = ['fuck', 'fvck', 'phuck', 'shit', 'cunt', 'bitch', 'nigg', 'whore', 'slut', 'porn', 'penis', 'vagina', 'nazi', 'hitler',
  'retard', 'twat', 'wank', 'jizz', 'faggot', 'dildo', 'asshole', 'pussy', 'motherf', 'bastard', 'blowjob', 'handjob', 'cumshot', 'molest'];
const WORDS = ['ass', 'asses', 'cock', 'dick', 'dicks', 'cum', 'rape', 'fag', 'tit', 'tits', 'boob', 'boobs', 'sex', 'sexy', 'kkk', 'nude',
  'anal', 'anus', 'piss', 'arse', 'wtf', 'stfu', 'damn', 'hell', 'crap', 'sucks', 'stupid', 'dumb', 'idiot', 'moron', 'loser', 'losers',
  'fat', 'ugly', 'old', 'bald', 'drunk', 'beer', 'beers', 'booze', 'wasted', 'hate', 'kill', 'die', 'dead', 'pathetic', 'worthless',
  'lame', 'weird', 'gay', 'girly', 'wife', 'husband', 'girlfriend', 'boyfriend', 'divorce'];
// While results are sealed (last 15 minutes until the reveal), nothing that hints at the standings.
const SEALED = /\b(lead|leads|leader|leading|first place|second place|third place|number one|no\. ?1|rank|ranked|ranking|rankings|rating|rated|podium|winning|frontrunner|front-runner|top spot|in front|ahead)\b/i;
export function unsafe(text: string) {
  const v = text.toLowerCase().replace(/[0134578@$!|]/g, c => ({ '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '|': 'i' } as Record<string, string>)[c] || c);
  for (const t of v.split(/[^a-z]+/)) {
    if (!t) continue;
    const sq = t.replace(/(.)\1+/g, '$1');
    if (SUBS.some(w => t.includes(w) || sq.includes(w))) return true;
    if (WORDS.includes(t) || WORDS.includes(sq)) return true;
  }
  return false;
}

const SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: { type: 'object', properties: { host: { type: 'string', enum: ['DONNIE', 'DASH'] }, text: { type: 'string' } }, required: ['host', 'text'] },
    },
  },
  required: ['lines'],
};

function prompt(digest: unknown, roast: string, avoid: string[]) {
  return `You write the next short bit for a two-person announce booth at a home pinball party tonight, played over the
speakers in the garage. Families are there, including kids.

The hosts:
- DONNIE: a cheesy fun-center DJ, warm hype dad energy, puns, "Alllll right!", loves everybody.
- DASH: a fast play-by-play sportscaster, stats and drama, calls it like a big game.
They riff off each other like real broadcast partners: short back-and-forth, natural, contractions, never stiff.

Write 2 to 5 lines, alternating hosts, about 15 to 20 seconds out loud in total (40 to 55 words, never more than 60).
Each line is one or two short sentences, easy to hear in a noisy room.

Use ONLY facts in the digest below: real names, machines and numbers exactly as given (numbers are already written as
words; keep them that way). Pick the most interesting one or two things; don't list everything. If nothing much is
happening, hype the room, the machines or the time left.
${roast === 'spicy'
    ? 'Roasting: playful and a bit cheeky about bad games, drains, cold streaks and losing streaks, like friendly trash talk.'
    : 'Roasting: gentle and warm. Tease a bad game lightly, then cheer them on.'}
Rules, always: PG and kind. Tease only pinball play (scores, drains, luck, streaks), never anyone's looks, body, age,
gender, family, job, intelligence, or anything else about them. No swearing, no innuendo, no alcohol, no politics.
Never make up scores, names or events. Don't mention prizes or awards.
${(digest as { sealed?: boolean })?.sealed ? 'The standings are SECRET right now: never say who is leading, any ranks, ratings or who might win. Talk about the clock, the games being played and the excitement instead.' : ''}
${avoid.length ? `Don't repeat these recent bits:\n${avoid.map(a => `- ${a}`).join('\n')}` : ''}

Digest (JSON):
${JSON.stringify(digest)}`;
}

function serviceDb() {
  let key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!key) {
    try { key = Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}'))[0] as string; } catch { /* ignore */ }
  }
  return createClient(Deno.env.get('SUPABASE_URL')!, key, { auth: { persistSession: false } });
}
const geminiKey = () => Deno.env.get('GEMINI_API_KEY') ??
  Object.values(Deno.env.toObject()).find(v => /^(AIza|AQ\.)[\w.-]{20,}$/.test(v.trim()))?.trim();

// The same announcer tokens as `tts`.
async function hmac(msg: string) {
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEYS') || '';
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(`tts|${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function tokenOk(t: unknown) {
  if (typeof t !== 'string') return false;
  const [exp, sig] = t.split('.');
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  return (await hmac(exp)) === sig;
}

function findText(node: unknown): string | null {
  if (typeof node === 'string') { try { const v = JSON.parse(node); if (v && Array.isArray(v.lines)) return node; } catch { /* no */ } return null; }
  if (Array.isArray(node)) { for (let i = node.length - 1; i >= 0; i--) { const r = findText(node[i]); if (r) return r; } return null; }
  if (node && typeof node === 'object') { for (const v of Object.values(node as Record<string, unknown>)) { const r = findText(v); if (r) return r; } }
  return null;
}
function findAudio(node: unknown): string | null {
  if (Array.isArray(node)) { for (let i = node.length - 1; i >= 0; i--) { const r = findAudio(node[i]); if (r) return r; } return null; }
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if ((o.type === 'audio' || String(o.mime_type || '').startsWith('audio/')) && typeof o.data === 'string' && o.data.length > 100) return o.data;
    for (const v of Object.values(o)) { const r = findAudio(v); if (r) return r; }
  }
  return null;
}
const b64bytes = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
// The PCM inside a WAV (or the bytes themselves if headerless), 24 kHz 16-bit mono.
function pcmOf(b: Uint8Array) {
  if (String.fromCharCode(...b.slice(0, 4)) !== 'RIFF') return b;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let off = 12;
  while (off + 8 <= b.length) {
    const id = String.fromCharCode(b[off], b[off + 1], b[off + 2], b[off + 3]);
    const size = dv.getUint32(off + 4, true);
    if (id === 'data') return b.slice(off + 8, Math.min(b.length, off + 8 + size));
    off += 8 + size;
  }
  return b.slice(44);
}
function wav(pcm: Uint8Array, sr = 24000) {
  const h = new DataView(new ArrayBuffer(44));
  const w = (o: number, s: string) => [...s].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); h.setUint32(4, 36 + pcm.length, true); w(8, 'WAVE'); w(12, 'fmt ');
  h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true); h.setUint32(24, sr, true);
  h.setUint32(28, sr * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); w(36, 'data'); h.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length); out.set(new Uint8Array(h.buffer), 0); out.set(pcm, 44);
  return out;
}
async function sha(s: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function pronounce(text: string, extra: string) {
  const map: Record<string, string> = { ...PRONOUNCE };
  for (const part of String(extra || '').split(/[\n;,]+/)) { const m = /^\s*([^=]+?)\s*=\s*(.+?)\s*$/.exec(part); if (m) map[m[1]] = m[2]; }
  let s = text;
  for (const [k, v] of Object.entries(map)) s = s.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${esc(k)}(?=$|[^\\p{L}\\p{N}])`, 'giu'), (_, pre) => pre + v);
  return s;
}

type Line = { host: string; text: string };
function check(out: unknown, sealed = false): Line[] | null {
  const lines = (out as { lines?: Line[] })?.lines;
  if (!Array.isArray(lines) || lines.length < 2 || lines.length > 5) return null;
  const clean = lines.map(l => ({ host: String(l?.host || '').toUpperCase(), text: String(l?.text || '').replace(/\s+/g, ' ').trim() }));
  if (clean.some(l => !HOSTS[l.host] || !l.text || l.text.length > 220 || /[<>{}[\]*_#]/.test(l.text) || unsafe(l.text) || (sealed && SEALED.test(l.text)))) return null;
  const words = clean.reduce((n, l) => n + l.text.split(' ').length, 0);
  if (words < 12 || words > 70) return null;
  return clean;
}

async function write(key: string, digest: unknown, roast: string, avoid: string[]) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(`${API}/interactions`, {
      method: 'POST', signal: AbortSignal.timeout(30000),
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json', 'Api-Revision': '2026-05-20' },
      body: JSON.stringify({
        model: TEXT_MODEL, store: false,
        input: [{ type: 'text', text: prompt(digest, roast, avoid) }],
        response_format: { type: 'text', mime_type: 'application/json', schema: SCHEMA },
        generation_config: { thinking_level: 'low', temperature: 1.0 },
      }),
    });
    const out = await r.json().catch(() => null);
    if (!r.ok) { console.error('booth text error', r.status, JSON.stringify(out)?.slice(0, 800)); continue; }
    const txt = findText(out);
    let parsed: unknown = null;
    try { parsed = txt ? JSON.parse(txt) : null; } catch { /* bad JSON */ }
    const lines = check(parsed, !!(digest as { sealed?: boolean })?.sealed);
    if (lines) return lines;
    console.error('booth rejected', txt?.slice(0, 600));
  }
  return null;
}

async function voice(key: string, voiceId: string, text: string, style: string) {
  const r = await fetch(`${API}/interactions`, {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: TTS_MODEL, store: false,
      input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style }] }] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice: voiceId }] },
    }),
  });
  const out = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`tts ${r.status} ${JSON.stringify(out)?.slice(0, 300)}`);
  const b64 = findAudio(out);
  if (!b64) throw new Error('no audio');
  return pcmOf(b64bytes(b64));
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const t0 = Date.now();
    const body = await req.json();
    const db = serviceDb();
    if (!(await tokenOk(body.token))) {
      const ok = await db.rpc('host_check', { p_pass: body.pass });
      if (ok.error || ok.data !== true) return json({ error: 'Wrong host passcode.' }, 403);
    }
    const key = geminiKey();
    if (!key) return json({ error: 'AI is not set up.' }, 500);
    const digest = body.digest && typeof body.digest === 'object' ? body.digest : {};
    if (JSON.stringify(digest).length > 8000) return json({ error: 'Digest too big.' }, 400);
    const roast = body.roast === 'spicy' ? 'spicy' : 'gentle';
    const avoid = (Array.isArray(body.avoid) ? body.avoid : []).filter((x: unknown) => typeof x === 'string').slice(0, 8).map((x: string) => x.slice(0, 200));
    const gate = await db.rpc('tts_count');
    if (gate.error) return json({ error: gate.error.message }, 429);

    const lines = await write(key, digest, roast, avoid);
    if (!lines) return json({ error: 'No usable bit this time.' }, 422);
    const t1 = Date.now();

    const { data: rows } = await db.from('tts_voices').select('pack, voice');
    const vid = (pack: string, fallback: string) => rows?.find(r => r.pack === pack)?.voice || fallback;
    const names = typeof body.names === 'string' ? body.names.slice(0, 1000) : '';
    const pcms = await Promise.all(lines.map(l => voice(key, vid(HOSTS[l.host].pack, HOSTS[l.host].prebuilt), pronounce(l.text, names), HOSTS[l.host].style)));
    const gap = new Uint8Array(Math.round(24000 * 0.22) * 2); // a breath between hosts
    const total = pcms.reduce((n, p) => n + p.length, 0) + gap.length * (pcms.length - 1);
    const pcm = new Uint8Array(total);
    let off = 0;
    pcms.forEach((p, i) => { pcm.set(p, off); off += p.length; if (i < pcms.length - 1) off += gap.length; });
    const file = wav(pcm);
    const path = `booth/${await sha(JSON.stringify(lines) + Date.now())}.wav`;
    const up = await db.storage.from('tts').upload(path, file, { contentType: 'audio/wav', upsert: true });
    if (up.error) { console.error('upload', up.error.message); return json({ error: "Couldn't save the bit." }, 502); }
    const url = db.storage.from('tts').getPublicUrl(path).data.publicUrl;
    const ms = Math.round((pcm.length / 48000) * 1000);
    console.log('booth', JSON.stringify({ lines: lines.length, ms, write: t1 - t0, voice: Date.now() - t1 }));
    return json({ url, ms, lines, took: Date.now() - t0 });
  } catch (e) {
    console.error(e);
    return json({ error: "Couldn't make a booth bit right now." }, 502);
  }
});

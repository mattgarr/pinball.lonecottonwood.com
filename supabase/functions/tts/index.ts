// tts: the TV announcer's voice. Gemini text-to-speech, one cached WAV per line.
// Deploy with "Verify JWT" OFF (the app sends the host passcode). Secret: GEMINI_API_KEY (the same key
// read-score uses). Host only.
//   { pass, text, pack, style? }       -> { url, ms, cached }   (style: an optional mood for this line)
//   { pass, action: 'design', packs? } -> designs each pack's voice once (Gemini Voice design) and saves
//                                         its voice id in tts_voices; returns { packs: { id: { voice, sample } } }
//   { pass, action: 'status' }         -> { packs: { id: { voice, model, designed } } }
// Lines are saved in the public `tts` bucket under a hash of model + voice + style + text: a line said
// twice is generated once, and the TV can fetch it straight from storage next time.
import { createClient } from 'npm:@supabase/supabase-js@2';

const MODEL = 'gemini-3.8-flash-tts';
const API = 'https://generativelanguage.googleapis.com/v1beta';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Each announcer pack: a designed persona (original characters, not imitations of anyone), the
// prebuilt voice used until it's designed, and the default delivery.
const PACKS: Record<string, { name: string; gender: string; lang: string; prompt: string; prebuilt: string; style: string }> = {
  british: {
    name: 'Woodside British agent', gender: 'male', lang: 'en-GB', prebuilt: 'Algieba',
    prompt: 'A suave, debonair English gentleman in his forties: a smooth, low baritone with crisp received pronunciation, '
      + 'dry wit and effortless confidence, like the narrator of a glamorous 1960s spy caper. Unhurried but never slow, every word crystal clear.',
    style: 'smooth, confident, a hint of amusement',
  },
  hype: {
    name: 'Woodside arcade hype', gender: 'male', lang: 'en-US', prebuilt: 'Fenrir',
    prompt: 'A huge, high-energy American arcade and arena announcer in his thirties: a booming voice with a slight rasp, explosive '
      + 'enthusiasm and punchy delivery that makes every line sound like a knockout, with a big grin in the voice.',
    style: 'excited, loud and punchy',
  },
  ship: {
    name: 'Woodside ship computer', gender: 'male', lang: 'en-US', prebuilt: 'Iapetus',
    prompt: 'A calm, soft-spoken spaceship computer with a warm, low male voice: perfectly even, gentle and precise, unnervingly '
      + 'polite and serene, measured pace, never raises its voice.',
    style: 'calm, even and precise',
  },
  '8bit': {
    name: 'Woodside 8-bit computer', gender: 'neutral', lang: 'en-US', prebuilt: 'Orus',
    prompt: 'A retro 1980s home-computer robot voice: flat monotone, clipped and evenly spaced syllables, slightly nasal and '
      + 'mechanical, completely deadpan.',
    style: 'flat robotic monotone, evenly spaced words',
  },
  newsreel: {
    name: 'Woodside retro newsreel', gender: 'male', lang: 'en-US', prebuilt: 'Sadachbia',
    prompt: 'A 1940s American newsreel narrator: fast, bright and theatrical, with a mid-Atlantic accent, booming and dramatic, '
      + 'every sentence delivered like breaking news.',
    style: 'fast, dramatic and enthusiastic',
  },
  dj: {
    name: 'Woodside fun-center DJ', gender: 'male', lang: 'en-US', prebuilt: 'Puck',
    prompt: 'A corny, over-the-top American DJ on the microphone at a roller rink or family fun center, in his forties: a big cheesy '
      + 'grin in the voice, stretched-out "Alllll right!" energy, upbeat and goofy with dad-joke enthusiasm, warm and friendly, never mean.',
    style: 'cheesy, upbeat and enthusiastic, like a roller-rink DJ on the mic',
  },
};

function serviceDb() {
  let key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!key) {
    try { key = Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}'))[0] as string; } catch { /* ignore */ }
  }
  return createClient(Deno.env.get('SUPABASE_URL')!, key, { auth: { persistSession: false } });
}
const geminiKey = () => Deno.env.get('GEMINI_API_KEY') ??
  Object.values(Deno.env.toObject()).find(v => /^(AIza|AQ\.)[\w.-]{20,}$/.test(v.trim()))?.trim();

// The first audio block anywhere in a response.
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
async function sha256(s: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// WAV duration from its header (falls back to 24 kHz 16-bit mono).
function wavMs(b: Uint8Array) {
  try {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const byteRate = dv.getUint32(28, true);
    let off = 12;
    while (off + 8 <= b.length) {
      const id = String.fromCharCode(b[off], b[off + 1], b[off + 2], b[off + 3]);
      const size = dv.getUint32(off + 4, true);
      if (id === 'data') return Math.round((Math.min(size, b.length - off - 8) / byteRate) * 1000);
      off += 8 + size;
    }
  } catch { /* not a WAV header */ }
  return Math.round(((b.length - 44) / 48000) * 1000);
}
// Raw 16-bit PCM (24 kHz mono) -> a WAV file.
function wavWrap(pcm: Uint8Array, sr = 24000) {
  const h = new DataView(new ArrayBuffer(44));
  const w = (o: number, s: string) => [...s].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); h.setUint32(4, 36 + pcm.length, true); w(8, 'WAVE'); w(12, 'fmt ');
  h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true); h.setUint32(24, sr, true);
  h.setUint32(28, sr * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); w(36, 'data'); h.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length); out.set(new Uint8Array(h.buffer), 0); out.set(pcm, 44);
  return out;
}

let voiceCache: { at: number; rows: Record<string, { voice: string; model: string; style: string }> } | null = null;
async function voices(db: ReturnType<typeof serviceDb>) {
  if (voiceCache && Date.now() - voiceCache.at < 60000) return voiceCache.rows;
  const { data } = await db.from('tts_voices').select('pack, voice, model, style');
  const rows: Record<string, { voice: string; model: string; style: string }> = {};
  for (const r of data ?? []) rows[r.pack] = r;
  voiceCache = { at: Date.now(), rows };
  return rows;
}

async function synth(key: string, model: string, voice: string, text: string, style: string) {
  const r = await fetch(`${API}/interactions`, {
    method: 'POST', signal: AbortSignal.timeout(25000),
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, store: false,
      input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style }] }] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice }] },
    }),
  });
  const out = await r.json().catch(() => null);
  if (!r.ok) { console.error('gemini tts error', r.status, JSON.stringify(out)?.slice(0, 1200)); throw new Error(`tts ${r.status}`); }
  const b64 = findAudio(out);
  if (!b64) { console.error('no audio in', JSON.stringify(out)?.slice(0, 1200)); throw new Error('no audio'); }
  let bytes = b64bytes(b64);
  if (String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF') bytes = wavWrap(bytes); // headerless PCM
  return bytes;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const t0 = Date.now();
    const body = await req.json();
    const { pass, action } = body;
    const db = serviceDb();
    const ok = await db.rpc('host_check', { p_pass: pass });
    if (ok.error || ok.data !== true) return json({ error: 'Wrong host passcode.' }, 403);
    const key = geminiKey();
    if (!key) return json({ error: 'AI is not set up.' }, 500);

    if (action === 'status') {
      const rows = await voices(db);
      return json({ packs: Object.fromEntries(Object.entries(PACKS).map(([id, p]) => [id, { voice: rows[id]?.voice ?? p.prebuilt, model: rows[id]?.model ?? MODEL, designed: !!rows[id]?.voice?.startsWith('voice') }])) });
    }

    if (action === 'design') {
      const want: string[] = Array.isArray(body.packs) ? body.packs.filter((p: string) => PACKS[p]) : Object.keys(PACKS);
      const out: Record<string, unknown> = {};
      for (const id of want) {
        const p = PACKS[id];
        const prompt = typeof body.prompt === 'string' && want.length === 1 ? body.prompt.slice(0, 600) : p.prompt;
        const r = await fetch(`${API}/voices`, {
          method: 'POST', signal: AbortSignal.timeout(60000),
          headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ store: true, voice: { model: MODEL, type: 'prompted', display_name: p.name, gender: p.gender, language_code: p.lang, prompted: { input: prompt } } }),
        });
        const v = await r.json().catch(() => null);
        if (!r.ok || !v?.id) { console.error('voice design error', id, r.status, JSON.stringify(v)?.slice(0, 1200)); out[id] = { error: `design ${r.status}`, detail: JSON.stringify(v)?.slice(0, 400) }; continue; }
        const vid = String(v.id).replace(/^voices\//, '');
        await db.from('tts_voices').upsert({ pack: id, voice: vid, model: MODEL, style: p.style, prompt, updated_at: new Date().toISOString() });
        let sample: string | null = null;
        const s64 = v.sample_audio?.data;
        if (typeof s64 === 'string') {
          const path = `design/${id}-${vid}.wav`;
          await db.storage.from('tts').upload(path, b64bytes(s64), { contentType: 'audio/wav', upsert: true });
          sample = db.storage.from('tts').getPublicUrl(path).data.publicUrl;
        }
        out[id] = { voice: vid, sample };
      }
      voiceCache = null;
      return json({ packs: out });
    }

    // Say a line.
    const pack = PACKS[body.pack] ? body.pack : 'british';
    const text = String(body.text ?? '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
    if (!text) return json({ error: 'Nothing to say.' }, 400);
    const rows = await voices(db);
    const voice = rows[pack]?.voice || PACKS[pack].prebuilt;
    const model = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'].includes(body.model) ? body.model : rows[pack]?.model || MODEL;
    const mood = typeof body.style === 'string' ? body.style.slice(0, 120).trim() : '';
    const style = mood || rows[pack]?.style || PACKS[pack].style;
    const name = `${(await sha256(`${model}|${voice}|${style}|${text}`)).slice(0, 40)}.wav`;
    const url = db.storage.from('tts').getPublicUrl(name).data.publicUrl;
    const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (head?.ok) {
      const len = Number(head.headers.get('content-length') || 0);
      return json({ url, ms: len ? Math.round(((len - 44) / 48000) * 1000) : null, cached: true });
    }
    const gate = await db.rpc('tts_gate', { p_pass: pass });
    if (gate.error) return json({ error: gate.error.message }, 429);
    const wav = await synth(key, model, voice, text, style);
    const up = await db.storage.from('tts').upload(name, wav, { contentType: 'audio/wav', upsert: true });
    if (up.error) console.error('upload', up.error.message);
    console.log('tts', JSON.stringify({ pack, voice, chars: text.length, ms: wavMs(wav), took: Date.now() - t0 }));
    return json({ url, ms: wavMs(wav), cached: false, took: Date.now() - t0 });
  } catch (e) {
    console.error(e);
    return json({ error: "Couldn't say that right now." }, 502);
  }
});

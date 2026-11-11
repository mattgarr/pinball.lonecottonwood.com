// booth: the two-host announce booth. The TV sends a short digest of what's happening tonight; Gemini
// writes a 2-5 line exchange between two hosts (any two announcer voices, each a character; default
// TIFFANI the valley girl + DONNIE the fun-center DJ), every line is checked (family party: no bad words, no teasing
// people about anything but their pinball), voiced with the two designed voices and stitched into one
// WAV in the public `tts` bucket. Deploy with "Verify JWT" OFF. Secret: GEMINI_API_KEY.
//   { pass | token, digest, hosts?: ['valley', 'dj'], short?, roast?: 'gentle'|'spicy', names?: "Stacia=Stay-sha, …", avoid?: [lines] }
//     -> { url, ms, lines: [{ host, text }], hosts: ['TIFFANI', 'DONNIE'], how, took }
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

// Who can sit in the booth: every announcer voice is a character (keep the names in sync with
// web/src/lib/audio/booth.js BOOTH_PERSONAS). The TV picks two (default: Roxy + Dash).
const PERSONAS: Record<string, { name: string; prebuilt: string; who: string; style: string }> = {
  aerobics: { name: 'ROXY', prebuilt: 'Laomedeia', who: 'a peppy 80s aerobics instructor in leg warmers: cheers everyone on, workout puns ("feel the burn", "and reach!", "five more!"), treats every game like a workout', style: 'peppy, bubbly and encouraging, chatting with her co-host' },
  hype: { name: 'DASH', prebuilt: 'Fenrir', who: 'a fast play-by-play sportscaster: stats, drama, calls every game like a championship', style: 'fast, excited play-by-play, chatting with his co-host' },
  dj: { name: 'DONNIE', prebuilt: 'Puck', who: 'a cheesy fun-center DJ: warm hype-dad energy, puns, loves everybody. He mixes up how he jumps in ("Whoa, whoa, whoa!", "Folks, are you seeing this?", "Hold the phone!", "Get this:", "Oh, buddy!", "Ladies and gentlemen of the garage", "Somebody check that tilt!", "Well, butter my flippers!", or straight in with the news) and never uses the same one twice in a row. He sprinkles short 80s sayings into his own lines, rotating them: radical, gnarly, cowabunga, where\'s the beef, I pity the fool, rad to the max, totally awesome, don\'t have a cow, psych, hasta la vista, party on. And fun-center jokes: couples skate, skee-ball, mini-golf windmills, tickets for the prize counter, "that\'s how we roll at the fun center". At most one catchphrase per line', style: 'warm, upbeat cheesy-dad energy, smiling but not laughing, chatting with his co-host' },
  british: { name: 'STERLING', prebuilt: 'Algieba', who: 'a suave British secret-agent type: dry wit, understatement, unflappable', style: 'smooth, dry and amused, chatting with his co-host' },
  ship: { name: 'ORBIT', prebuilt: 'Iapetus', who: 'a calm, polite spaceship computer: deadpan, precise, takes everything literally', style: 'calm, even and deadpan, chatting with its co-host' },
  '8bit': { name: 'BYTE', prebuilt: 'Orus', who: 'a retro 8-bit robot: literal, says "beep boop", calls people "humans", loves high scores', style: 'flat robotic voice, chatting with its co-host' },
  newsreel: { name: 'BUZZ', prebuilt: 'Sadachbia', who: 'a 1940s newsreel narrator: breathless headlines, "folks!", everything is big news', style: 'fast and dramatic, chatting with his co-host' },
  wedding: { name: 'RICKY', prebuilt: 'Achird', who: 'an 80s wedding-reception DJ: dance-floor hype, cheesy toasts, "everybody on the floor!"', style: 'warm and cheesy, chatting with his co-host' },
  drivetime: { name: 'MIKEY', prebuilt: 'Sadachbia', who: 'a 90s morning-drive radio guy: shout-outs, call-in-show energy, quick jokes', style: 'fast and bright radio voice, chatting with his co-host' },
  countdown: { name: 'CHUCK', prebuilt: 'Algieba', who: 'a smooth top-40 countdown host: warm, sincere, talks about scores like chart positions', style: 'smooth and warm, chatting with his co-host' },
  rumble: { name: 'THUNDER', prebuilt: 'Algenib', who: 'a booming monster-truck and boxing arena announcer: dramatic, everything is the main event', style: 'booming and dramatic, chatting with his co-host' },
  valley: { name: 'TIFFANI', prebuilt: 'Leda', who: 'a 90s Beverly Hills valley girl (an original character, no movie quotes or movie names): upbeat and fast, rates every score like an outfit or a mall haul (makeovers, "that score is so last season", "the red carpet", "the food court", "a total wardrobe malfunction on the playfield"), and sprinkles short 80s/90s slang into her own lines, rotating it: as if, whatever, totally buggin\', way harsh, gag me with a spoon, grody to the max, bodacious, tubular, most triumphant, excellent, talk to the hand, not, gnarly, radical, party on, all that and a bag of chips, da bomb, psych, take a chill pill. At most one catchphrase per line, never the same one twice in a row', style: 'bubbly, fast valley-girl voice, chatting with her co-host' },
  vj: { name: 'KAT', prebuilt: 'Aoede', who: 'a cool 90s music-TV VJ: quick, confident, rock-and-roll energy, introduces every game like a world-premiere video', style: 'cool, quick and confident, chatting with her co-host' },
  rink: { name: 'STARLA', prebuilt: 'Sulafat', who: 'an 80s roller-rink DJ: disco-ball glow, couples-skate cheese, "clear the floor!", warm and smooth', style: 'warm, smooth and glittery, chatting with her co-host' },
};
const DUO = ['valley', 'dj']; // Tiffani + Donnie
// What each host gets teased about by the other (playful, about the character, never the players).
const TEASE: Record<string, string> = {
  valley: 'her fashion snobbery, her mall obsession, rating everything like an outfit',
  dj: 'his cheesy-dad DJ act, his mullet and fanny pack, his corny puns and skee-ball stories',
  hype: 'his nonstop stats and turning every game into a championship',
  aerobics: 'her leg warmers and turning everything into a workout',
};
function duoOf(hosts: unknown) {
  const h = Array.isArray(hosts) ? hosts.filter(x => PERSONAS[x as string]) as string[] : [];
  const a = h[0] || DUO[0];
  let b = h[1] || DUO[1];
  if (b === a) b = a === DUO[1] ? DUO[0] : DUO[1];
  return [a, b];
}
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
  const v = text.toLowerCase().replace(/[0134578@$]/g, c => ({ '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's' } as Record<string, string>)[c] || c);
  for (const t of v.split(/[^a-z]+/)) {
    if (!t) continue;
    const sq = t.replace(/(.)\1+/g, '$1');
    if (SUBS.some(w => t.includes(w) || sq.includes(w))) return true;
    if (WORDS.includes(t) || WORDS.includes(sq)) return true;
  }
  return false;
}

const schema = (names: string[]) => ({
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: { type: 'object', properties: { host: { type: 'string', enum: names }, text: { type: 'string' } }, required: ['host', 'text'] },
    },
  },
  required: ['lines'],
});

function prompt(digest: unknown, roast: string, avoid: string[], duo: string[], short: boolean, local: string[] = [], rivalry = false) {
  const [A, B] = duo.map(k => PERSONAS[k]);
  const tease = (k: string) => TEASE[k] || 'their on-air persona';
  return `You write the next short bit for a two-person announce booth at a home pinball party tonight, played over the
speakers in the garage. Families are there, including kids.

The hosts (use exactly these names in "host"):
- ${A.name}: ${A.who}.
- ${B.name}: ${B.who}.
They riff off each other like real broadcast partners: short back-and-forth, natural, contractions, never stiff.
Vary how every bit starts: never open a line with "All right" or "Alright", don't lean on "Talk about…", and don't
open the way your recent bits did. No written laughs ("ha ha", "heh", "*laughs*"); let the words be the fun.

${short
    ? 'Keep it SHORT: 2 or 3 lines, alternating hosts, about 10 seconds out loud (20 to 35 words).'
    : 'Write 2 to 5 lines, alternating hosts, about 15 to 20 seconds out loud in total (40 to 55 words, never more than 60).'}
Each line is one or two short sentences, easy to hear in a noisy room.

Use ONLY facts in the digest below: real names, machines and numbers exactly as given (numbers are already written as
words; keep them that way). If "justHappened" has anything, that's why you're on the air right now: open with it
(welcome a new arrival by name, celebrate a record, tease a rough game). Otherwise pick the most interesting one or
two things; don't list everything, and don't repeat the same story as your recent bits. If nothing much is happening,
hype the room, the machines or the time left.
${roast === 'spicy'
    ? 'Roasting: playful and a bit cheeky about bad games, drains, cold streaks and losing streaks, like friendly trash talk.'
    : 'Roasting: gentle and warm. Tease a bad game lightly, then cheer them on.'}
Rules, always: PG and kind. Tease only pinball play (scores, drains, luck, streaks), never anyone's looks, body, age,
gender, family, job, intelligence, or anything else about them. No swearing, no innuendo, no alcohol, no politics.
Never make up scores, names or events. Don't mention prizes or awards.
${local.length ? `We're in Woodside, California (Silicon Valley horse country). Work exactly ONE of these local items into this bit,
ideally as the punchline of a tease about a score or a host ("that score's lower than Woodside's sidewalk count", "Omar's pivoting
harder than a startup"); keep the facts as given, affectionate, never about private people:\n${local.map(x => `- ${x}`).join('\n')}` : ''}
Slang only from the 80s and 90s, nothing modern (no "no cap", "slay", "vibe check", "rizz").
${rivalry ? `This time the hosts also tease EACH OTHER once, playfully (${A.name}: ${tease(duo[0])}; ${B.name}: ${tease(duo[1])}), mixed in with the game talk. Friendly rivals, never mean.` : ''}
${(digest as { sealed?: boolean })?.sealed ? 'The standings are SECRET right now: never say who is leading, any ranks, ratings or who might win. Talk about the clock, the games being played and the excitement instead.' : ''}
${avoid.length ? `Don't repeat these recent bits:\n${avoid.map(a => `- ${a}`).join('\n')}\nAnd don't start any line with these openers: ${[...new Set(avoid.map(openerKey).filter(Boolean))].map(o => `"${o}"`).join(', ')}.${(() => { const c = [...new Set(avoid.flatMap(catchphrasesIn))]; return c.length ? `\nDon't use these catchphrases this time (used recently): ${c.map(x => `"${x}"`).join(', ')}.` : ''; })()}` : ''}

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
// Variety (same as web/src/lib/audio/booth.js, tested there): a line's first two words; laughs; "All right".
function openerKey(text: string) {
  const w = String(text || '').toLowerCase().replace(/a+l+ +r+i+g+h+t+|a+l+r+i+g+h+t+/g, 'all right').replace(/[^a-z' ]+/g, ' ').trim().split(/\s+/);
  return w.slice(0, 2).join(' ');
}
function repeatsOpener(lines: Line[], recent: string[]) {
  const seen = new Set(recent.map(openerKey).filter(Boolean));
  return lines.some(l => seen.has(openerKey(l.text)));
}
const LAUGH = /(\*[^*]*laugh[^*]*\*|<laugh>|\b(?:ha[ -]?){2,}h?a?\b|\bheh(?:[ -]?heh)*\b|\bhehe+\b|\bhaha+\b)[,.!]*\s*/gi;
const ALL_RIGHT = /^\s*a+l+\s*r+i+g+h+t+[,.!]*\s*/i;
const CATCHPHRASES = ['as if', 'whatever', 'totally buggin', 'way harsh', 'gag me with a spoon', 'grody to the max', 'bodacious',
  'tubular', 'most triumphant', 'excellent', 'talk to the hand', 'not', 'so last season', 'like totally', 'oh my gosh', 'iconic',
  'gnarly', 'radical', 'righteous', 'party on', 'booyah', 'all that and a bag of chips', 'da bomb', 'psych', 'take a chill pill', 'eat my shorts',
  'cowabunga', 'wheres the beef', 'i pity the fool', 'rad to the max', 'totally awesome', 'dont have a cow', 'hasta la vista', 'how we roll'];
const phraseRe = (c: string) => new RegExp(`(^|[^a-z])${c.replace(/ /g, '[^a-z]+')}($|[^a-z])`, 'i');
function catchphrasesIn(text: string) { return CATCHPHRASES.filter(c => phraseRe(c).test(String(text || '').replace(/[’']/g, ''))); }
function repeatsCatchphrase(lines: Line[], recent: string[]) {
  const used = new Set(recent.flatMap(catchphrasesIn).filter(c => c !== 'not'));
  return lines.some(l => catchphrasesIn(l.text).some(c => used.has(c)));
}
function tidyLines(lines: Line[], laughOk: boolean, allRightOk: boolean) {
  return lines.map(l => {
    let t = l.text;
    if (!laughOk) t = t.replace(LAUGH, '');
    if (!allRightOk) t = t.replace(ALL_RIGHT, '');
    t = t.replace(/\s+/g, ' ').trim();
    return { ...l, text: t.charAt(0).toUpperCase() + t.slice(1) };
  }).filter(l => /[a-z]/i.test(l.text));
}
function check(out: unknown, names: string[], sealed = false, short = false): Line[] | null {
  const lines = (out as { lines?: Line[] })?.lines;
  if (!Array.isArray(lines) || lines.length < 2 || lines.length > 5) return null;
  const clean = lines.map(l => ({ host: String(l?.host || '').toUpperCase(), text: String(l?.text || '').replace(/\s+/g, ' ').trim() }));
  if (clean.some(l => !names.includes(l.host) || !l.text || l.text.length > 220 || /[<>{}[\]*_#]/.test(l.text) || unsafe(l.text) || (sealed && SEALED.test(l.text)))) return null;
  const words = clean.reduce((n, l) => n + l.text.split(' ').length, 0);
  if (words < 10 || words > (short ? 45 : 70)) return null;
  return clean;
}

async function write(key: string, digest: unknown, roast: string, avoid: string[], duo: string[], short: boolean, local: string[], rivalry: boolean) {
  const names = duo.map(k => PERSONAS[k].name);
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`${API}/interactions`, {
      method: 'POST', signal: AbortSignal.timeout(30000),
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json', 'Api-Revision': '2026-05-20' },
      body: JSON.stringify({
        model: TEXT_MODEL, store: false,
        input: [{ type: 'text', text: prompt(digest, roast, avoid, duo, short, local, rivalry) }],
        response_format: { type: 'text', mime_type: 'application/json', schema: schema(names) },
        generation_config: { thinking_level: 'low', temperature: 1.0 },
      }),
    });
    const out = await r.json().catch(() => null);
    if (!r.ok) { console.error('booth text error', r.status, JSON.stringify(out)?.slice(0, 800)); continue; }
    const txt = findText(out);
    let parsed: unknown = null;
    try { parsed = txt ? JSON.parse(txt) : null; } catch { /* bad JSON */ }
    let lines = check(parsed, names, !!(digest as { sealed?: boolean })?.sealed, short);
    // Opens like a recent bit: one more try (the last try is kept, minus the repeated "All right").
    if (lines && attempt < 2 && (repeatsOpener(lines, avoid) || repeatsCatchphrase(lines, avoid))) { console.error('booth repeat', lines.map(l => l.text.slice(0, 30)).join(' | ')); continue; }
    // A written laugh in about 1 bit in 4, an "All right!" opener rarely; otherwise they're taken out.
    if (lines) lines = tidyLines(lines, Math.random() < 0.25, Math.random() < 0.1);
    if (lines && lines.length >= 2) return lines;
    console.error('booth rejected', txt?.slice(0, 600));
  }
  return null;
}

// Both hosts in one call (Gemini multi-speaker TTS: one natural conversation). Null if it can't.
async function together(key: string, lines: { speaker: string; voice: string; text: string; style: string }[]) {
  try {
    const voices = [...new Map(lines.map(l => [l.speaker, l.voice])).entries()].map(([speaker, voice]) => ({ speaker, voice }));
    const r = await fetch(`${API}/interactions`, {
      method: 'POST', signal: AbortSignal.timeout(40000),
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: TTS_MODEL, store: false,
        input: [{ type: 'user_input', content: lines.map(l => ({ type: 'text', text: l.text, annotations: [{ type: 'speech_metadata', speaker: l.speaker, style: l.style }] })) }],
        response_format: { type: 'audio' },
        generation_config: { speech_config: { speakers: voices } },
      }),
    });
    const out = await r.json().catch(() => null);
    if (!r.ok) { console.error('multi-speaker error', r.status, JSON.stringify(out)?.slice(0, 400)); return null; }
    const b64 = findAudio(out);
    return b64 ? pcmOf(b64bytes(b64)) : null;
  } catch (e) { console.error('multi-speaker', String(e)); return null; }
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
    const duo = duoOf(body.hosts);
    const short = body.short === true;
    const avoid = (Array.isArray(body.avoid) ? body.avoid : []).filter((x: unknown) => typeof x === 'string').slice(0, 8).map((x: string) => x.slice(0, 200));
    const gate = await db.rpc('tts_count');
    if (gate.error) return json({ error: gate.error.message }, 429);

    const local = (Array.isArray(body.local) ? body.local : []).filter((x: unknown) => typeof x === 'string').slice(0, 3).map((x: string) => x.slice(0, 300));
    const lines = await write(key, digest, roast, avoid, duo, short, local, body.rivalry === true);
    if (!lines) return json({ error: 'No usable bit this time.' }, 422);
    const t1 = Date.now();

    const { data: rows } = await db.from('tts_voices').select('pack, voice');
    const packOf = (name: string) => duo.find(k => PERSONAS[k].name === name)!;
    const vid = (pack: string) => rows?.find(r => r.pack === pack)?.voice || PERSONAS[pack].prebuilt;
    const names = typeof body.names === 'string' ? body.names.slice(0, 1000) : '';
    const spoken = lines.map(l => { const k = packOf(l.host); return { speaker: PERSONAS[k].name, voice: vid(k), text: pronounce(l.text, names), style: PERSONAS[k].style }; });
    // One conversation in a single call if Gemini takes these two voices together; else line by line, stitched.
    let pcm = await together(key, spoken);
    let how = 'together';
    if (!pcm) {
      how = 'stitched';
      const pcms = await Promise.all(spoken.map(l => voice(key, l.voice, l.text, l.style)));
      const gap = new Uint8Array(Math.round(24000 * 0.22) * 2); // a breath between hosts
      pcm = new Uint8Array(pcms.reduce((n, p) => n + p.length, 0) + gap.length * (pcms.length - 1));
      let off = 0;
      pcms.forEach((p, i) => { pcm!.set(p, off); off += p.length; if (i < pcms.length - 1) off += gap.length; });
    }
    const file = wav(pcm);
    const path = `booth/${await sha(JSON.stringify(lines) + Date.now())}.wav`;
    const up = await db.storage.from('tts').upload(path, file, { contentType: 'audio/wav', upsert: true });
    if (up.error) { console.error('upload', up.error.message); return json({ error: "Couldn't save the bit." }, 502); }
    const url = db.storage.from('tts').getPublicUrl(path).data.publicUrl;
    const ms = Math.round((pcm.length / 48000) * 1000);
    console.log('booth', JSON.stringify({ duo, how, lines: lines.length, ms, write: t1 - t0, voice: Date.now() - t1 }));
    return json({ url, ms, lines, hosts: duo.map(k => PERSONAS[k].name), how, took: Date.now() - t0 });
  } catch (e) {
    console.error(e);
    return json({ error: "Couldn't make a booth bit right now." }, 502);
  }
});

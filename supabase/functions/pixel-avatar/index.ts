// pixel-avatar: turn a selfie into an 8-bit NES-style character portrait with Gemini image generation.
// Call as a player { token, image }, before joining { image } (capped per hour), or as host { pass, player_id }.
// Returns { image: dataURL }. The app downsizes it and saves it via set_my_avatar / host_set_avatar.
import { createClient } from 'npm:@supabase/supabase-js@2';
const MODEL = 'gemini-3.1-flash-image';
const cors = {
'Access-Control-Allow-Origin': '*',
'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
// Find the first generated image anywhere in the response.
function findImage(node: unknown): { data: string; mime: string } | null {
if (Array.isArray(node)) { for (const v of node) { const r = findImage(v); if (r) return r; } return null; }
if (node && typeof node === 'object') {
const o = node as Record<string, unknown>;
if (o.type === 'image' && typeof o.data === 'string' && o.data.length > 1000) return { data: o.data, mime: String(o.mime_type || 'image/png') };
if (typeof (o as any).inline_data?.data === 'string') return { data: (o as any).inline_data.data, mime: (o as any).inline_data.mime_type || 'image/png' };
for (const v of Object.values(o)) { const r = findImage(v); if (r) return r; }
}
return null;
}
const PROMPT =
'Redraw the person in this selfie as an 8-bit NES-era video game character portrait. ' +
'Pixel art on a coarse grid (about 32x32 big square pixels), limited NES color palette, bold dark outlines. ' +
'Re-frame it as a centered head-and-shoulders portrait: the face sits in the middle of the square, about 60% of the height, ' +
'even if the photo is off-center, tilted, cropped or taken from far away. Facing forward, plain solid dark navy background. ' +
'Keep them recognizable: same hair style and color, skin tone, facial hair, glasses, hats or accessories. ' +
'Friendly, heroic arcade-character vibe. No text, no border, no frame, no extra characters.';
Deno.serve(async req => {
if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
try {
const { token, image, pass, player_id } = await req.json();
let serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
if (!serviceKey) {
try { serviceKey = Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}'))[0] as string; } catch { /* ignore */ }
}
const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { persistSession: false } });
let src: string | null = null;
if (pass) {
const ok = await db.rpc('host_check', { p_pass: pass });
if (ok.error || ok.data !== true) return json({ error: 'Wrong host passcode.' }, 403);
const { data: p } = await db.from('players').select('avatar, selfie').eq('id', player_id).single();
src = p?.selfie || (p?.avatar?.startsWith('data:image/jpeg') ? p.avatar : null);
if (!src) return json({ error: 'No selfie for that player.' }, 400);
} else {
const gate = token ? await db.rpc('photo_gate', { p_token: token }) : await db.rpc('avatar_gate_anon');
if (gate.error) return json({ error: gate.error.message }, 429);
src = typeof image === 'string' ? image : null;
}
if (!src || src.length > 4_000_000) return json({ error: 'Photo missing or too large.' }, 400);
const mime = (src.match(/^data:(image\/[\w+.-]+);base64,/) || [])[1] || 'image/jpeg';
const b64 = src.replace(/^data:image\/[\w+.-]+;base64,/, '');
const key = Deno.env.get('GEMINI_API_KEY') ??
Object.values(Deno.env.toObject()).find(v => /^(AIza|AQ\.)[\w.-]{20,}$/.test(v.trim()))?.trim();
if (!key) return json({ error: 'AI is not set up.' }, 500);
const r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
method: 'POST', signal: AbortSignal.timeout(45000),
headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json', 'Api-Revision': '2026-05-20' },
body: JSON.stringify({
model: MODEL, store: false,
input: [{ type: 'text', text: PROMPT }, { type: 'image', mime_type: mime, data: b64 }],
response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '1:1', image_size: '512' },
}),
});
const out = await r.json().catch(() => null);
if (!r.ok) { console.error('gemini image error', r.status, JSON.stringify(out)?.slice(0, 1500)); return json({ error: "Couldn't draw it right now." }, 502); }
const img = findImage(out);
if (!img) { console.error('no image in', JSON.stringify(out)?.slice(0, 1500)); return json({ error: "Couldn't draw it right now." }, 502); }
return json({ image: `data:${img.mime};base64,${img.data}` });
} catch (e) {
console.error(e);
return json({ error: 'Something went wrong.' }, 500);
}
});

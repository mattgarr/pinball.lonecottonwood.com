// email-results: host sends each opted-in player their final results for an event.
// Body: { pass, event_id, event_name, event_date, results: [{player_id, name, rank, ranked_of, rating, games, machines, prizes}], board }
// Needs a Resend API key in the function secrets (any value starting "re_"), and optionally RESEND_FROM
// (e.g. "Woodside Pinball Open <results@lonecottonwood.com>", a verified Resend domain).
import { createClient } from 'npm:@supabase/supabase-js@2';
const cors = {
'Access-Control-Allow-Origin': '*',
'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fmt = (n: number | null) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const SITE = 'https://pinball.lonecottonwood.com';
const HOSTS = 'The Garrs &amp; the Simkovers'; // co-hosts, credited in every email
const ART = `${SITE}/email`;
const slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const F = "font-family:'Press Start 2P','Courier New',Courier,monospace;";
const img = (name: string, h: number, alt: string) => `<img src="${ART}/${name}.png" height="${h}" alt="${alt}" style="display:block;height:${h}px;width:auto;border:0;">`;
// Gmail on iPhone flips every email's colors in dark mode. Same fix as email-roster (see the email skill):
// backgrounds use BG() gradients (never flipped); text goes inside T(), whose blend layers flip it back.
// The flip-back only works for white text, so in Gmail all T() text is forced white, bigger and bold.
// Images and emoji stay outside T().
const BG = (c: string) => `background-color:${c};background-image:linear-gradient(${c},${c});`;
const T = (inner: string) => `<div class="gb-s"><div class="gb-d">${inner}</div></div>`;
function page(eventName: string, date: string, r: any, board: any[], titleArt: { name: string; w: number; h: number } | null, stats: any) {
const td = `${F}font-size:12px;line-height:1.6;padding:6px 4px;`;
// Every game, grouped by machine: best-score standing on top, then each game ranked against all games on that machine.
const clock = (iso: string) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' }) : '');
const playedM = (r.machines || []).filter((m: any) => (m.played || []).length || m.best != null);
const skipped = (r.machines || []).filter((m: any) => !(m.played || []).length && m.best == null).map((m: any) => m.name);
const games = playedM.map((m: any) => {
const list = (m.played || []).length ? m.played : [{ value: m.best, at: null, rank: null, of: null }];
const lines = list.map((g: any) => `<tr><td class="sm" style="${td}color:#9c9cb4;">${esc(clock(g.at))}</td><td style="${td}text-align:right;color:#ffb43a;">${fmt(g.value)}</td><td class="sm" style="${td}text-align:right;color:#9c9cb4;">${g.rank ? `#${g.rank} of ${g.of}` : ''}</td></tr>`).join('');
return T(`<div style="${F}color:#f8b800;font-size:12px;line-height:1.6;padding-top:14px;">${esc(m.name.toUpperCase())}</div>
<div class="sm" style="${F}color:#9c9cb4;font-size:10px;line-height:1.6;">${[m.rank ? `Your best: ${esc(m.rank)} players` : '', `${(m.played || []).length || 1} game${((m.played || []).length || 1) === 1 ? '' : 's'}`].filter(Boolean).join(' &middot; ')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;">${lines}</table>`);
}).join('');
const nGames = (r.machines || []).reduce((n: number, m: any) => n + (m.played || []).length, 0);
const skippedLine = skipped.length ? T(`<div class="sm" style="${F}color:#9c9cb4;font-size:10px;line-height:1.8;padding-top:14px;">Never played: ${skipped.map(esc).join(', ')}. They'll be waiting for you next time.</div>`) : '';
const top = (board || []).map((b: any) => {
const me = b.name === r.name;
return `<tr><td style="${td}color:#9c9cb4;">${esc(b.rank)}</td><td style="${td}color:${me ? '#f8b800' : '#fcfcfc'};">${me ? '&#9654; ' : ''}${esc(b.name)}${me ? ' (you)' : ''}</td><td style="${td}text-align:right;color:#ffb43a;">${esc(b.rating)}</td></tr>`;
}).join('');
const prizes = (r.prizes || []).length
? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:14px;"><tr><td width="28" valign="top" style="font-size:18px;">&#127942;</td><td>${T(`<div style="${F}color:#f8b800;font-size:13px;line-height:1.8;">${r.prizes.map(esc).join(' &middot; ')}</div>`)}</td></tr></table>`
: '';
const place = parseInt(r.rank || '0');
const quip = !place ? `Not ranked (it takes 2 machines), but you came, you flipped, you ate tacos. That counts.`
: place === 1 ? `CHAMPION! Hail to the flipper monarch. The machines fear you.`
: place <= 3 ? `Podium finish. Close enough to the top to smell the trophy.`
: place <= 10 ? `Top 10. Respect. Your flipper fingers have earned a rest.`
: place === Number(r.ranked_of) ? `Dead last, which is its own kind of legendary. Somebody had to hold the leaderboard up.`
: `Ranked and proud. There's always next year (start practicing now).`;
const headline = r.rank
? `${esc(r.name)}: you finished ${esc(r.rank)} of ${esc(r.ranked_of)}. Rating ${esc(r.rating)}/100.`
: `${esc(r.name)}: you played ${esc(r.games)} game${r.games === 1 ? '' : 's'}.`;
const n = (x: any) => Number(x) || 0;
const wrap = `What a night! ${n(stats?.players) ? `${n(stats.players)} players, ` : ''}${n(stats?.machines) || 'six'} machines${n(stats?.games) ? `, ${n(stats.games)} games logged` : ''}, and more tacos than anyone could count. Thank you for coming out, flipping hard and cheering each other on. The machines are resting now (they earned it). Here's how your night went.`;
const table = (body: string) => T(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">${body}</table>`);
return `<!doctype html><html><head><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet">
<style>u + .body .gb-s{background:#000;mix-blend-mode:screen;}
u + .body .gb-d{background:#000;mix-blend-mode:difference;}
u + .body .gb-d, u + .body .gb-d *{color:#ffffff !important;}
u + .body .gb-d div, u + .body .gb-d td{font-size:17px !important;line-height:1.5 !important;font-weight:bold !important;}
u + .body .gb-d .sm{font-size:14px !important;}</style></head>
<body class="body" style="margin:0;padding:0;${BG('#0f0f1b')}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${BG('#0f0f1b')}"><tr><td align="center" style="padding:20px 10px;">
<table role="presentation" width="568" cellpadding="0" cellspacing="0" style="max-width:568px;width:100%;${BG('#fcfcfc')}"><tr><td style="padding:4px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${BG('#000000')}">
<tr><td style="${BG('#e40058')}padding:10px 14px;">${img('brand', 12, 'WOODSIDE PINBALL')}</td></tr>
<tr><td style="padding:20px 20px 24px;">
${T(`<div style="${F}color:#3cbcfc;font-size:11px;line-height:1.6;">FINAL RESULTS</div>`)}
<div style="margin:12px 0 6px;">${titleArt ? `<img src="${ART}/${titleArt.name}.png" width="${titleArt.w}" height="${titleArt.h}" alt="${esc(eventName.toUpperCase())}" style="display:block;max-width:100%;height:auto;border:0;">` : T(`<div style="${F}color:#fcfcfc;font-size:22px;line-height:1.3;">${esc(eventName.toUpperCase())}</div>`)}</div>
${T(`<div style="${F}color:#fce0a8;font-size:12px;line-height:1.6;">${esc(date.toUpperCase())}</div>`)}
${T(`<div style="${F}color:#fcfcfc;font-size:12px;line-height:1.8;">HOSTS: ${HOSTS}</div>`)}
<div style="padding-top:18px;">${img('h-thanks', 15, 'THANKS FOR PLAYING!')}</div>
${T(`<div style="${F}color:#fcfcfc;font-size:12px;line-height:1.8;padding-top:10px;">${wrap}</div>`)}
${T(`<div style="${F}color:#fcfcfc;font-size:13px;line-height:1.8;padding-top:16px;">${headline}</div><div style="${F}color:#fce0a8;font-size:12px;line-height:1.8;padding-top:8px;">${quip}</div>`)}
${prizes}
<div style="padding-top:24px;">${img('h-games', 12, '&#9654; YOUR GAMES')}</div>
${T(`<div class="sm" style="${F}color:#9c9cb4;font-size:10px;line-height:1.8;padding-top:8px;">Every game you logged (${nGames}), best first. "#3 of 41" = your score's place among all 41 games anyone played on that machine.</div>`)}
${games}${skippedLine}
${top ? `<div style="padding-top:24px;">${img('h-top10', 12, '&#9654; FINAL TOP 10')}</div>${table(top)}` : ''}
</td></tr>
<tr><td style="padding:12px 20px;">${T(`<div class="sm" style="border-top:2px solid #3c3c5c;padding-top:12px;${F}color:#7c7c7c;font-size:9px;line-height:1.8;">GAME OVER. INSERT COIN TO CONTINUE (see you at the next one). You got this because you asked for your results at the event. We only email results, never marketing.</div>`)}</td></tr>
</table></td></tr></table></td></tr></table></body></html>`;
}
Deno.serve(async req => {
if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
try {
const { pass, event_id, event_name, event_date, results, board, test_to, stats } = await req.json();
let serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
if (!serviceKey) {
try { serviceKey = Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}'))[0] as string; } catch { /* ignore */ }
}
const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { persistSession: false } });
const ok = await db.rpc('host_check', { p_pass: pass });
if (ok.error || ok.data !== true) return json({ error: 'Wrong host passcode.' }, 403);
const key = Deno.env.get('RESEND_API_KEY') ?? Object.values(Deno.env.toObject()).find(v => /^re_[\w]{16,}$/.test(v.trim()))?.trim();
if (!key) return json({ error: 'Email is not set up yet (add the Resend key in Supabase secrets).' }, 500);
const from = Deno.env.get('RESEND_FROM') || 'Woodside Pinball <pinball@lonecottonwood.com>';
const ids = (results || []).map((r: any) => r.player_id);
const { data: contacts, error } = await db.from('player_contacts').select('player_id, email').in('player_id', ids.length ? ids : [-1]);
if (error) return json({ error: error.message }, 500);
const emailBy = new Map((contacts || []).map((c: any) => [c.player_id, c.email]));
const date = event_date ? new Date(`${event_date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
// Title art at its real size, read from the PNG header (the art is 2x, so halve it).
const titleArt = await fetch(`${ART}/title-${slug(String(event_name || ''))}.png`).then(async x => {
if (!x.ok) return null;
const v = new DataView(await x.arrayBuffer());
return { name: `title-${slug(String(event_name))}`, w: v.getUint32(16) / 2, h: v.getUint32(20) / 2 };
}).catch(() => null);
// test_to: one sample (the first result) to the host's address; nothing is marked as sent.
const msgs = test_to
? (results || []).slice(0, 1).map((r: any) => ({ from, headers: { 'X-Entity-Ref-ID': crypto.randomUUID() }, to: [String(test_to)], subject: `[TEST] ${event_name}: your results`, html: page(event_name, date, r, board, titleArt, stats) }))
: (results || []).filter((r: any) => emailBy.has(r.player_id)).map((r: any) => ({
from, headers: { 'X-Entity-Ref-ID': crypto.randomUUID() }, to: [emailBy.get(r.player_id)], subject: `${event_name}: your results`, html: page(event_name, date, r, board, titleArt, stats),
}));
let sent = 0; const errors: string[] = [];
for (let i = 0; i < msgs.length; i += 100) {
const res = await fetch('https://api.resend.com/emails/batch', {
method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
body: JSON.stringify(msgs.slice(i, i + 100)),
});
if (res.ok) sent += msgs.slice(i, i + 100).length;
else { const t = await res.text(); console.error('resend error', res.status, t.slice(0, 500)); errors.push(t.slice(0, 200)); }
}
if (sent && !test_to) await db.from('events').update({ results_sent_at: new Date().toISOString() }).eq('id', event_id);
if (errors.length && !sent) return json({ error: `Email service said: ${errors[0]}` }, 502);
return json({ sent, test: !!test_to, skipped: test_to ? 0 : (results || []).length - msgs.length });
} catch (e) {
console.error(e);
return json({ error: 'Something went wrong.' }, 500);
}
});

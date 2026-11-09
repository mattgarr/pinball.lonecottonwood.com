// email-roster: host emails the event roster. Two buttons in the app:
// kind 'auto' = SEND INVITES: each guest who hasn't had theirs gets the right one. Paid guests get "you're in"
//   + a QR to set up their player; unpaid guests get the invite with a "get tickets" link.
// kind 'reminder' = SEND UPDATE: countdown + the host's optional note, to everyone.
// invite_ids = just these guests (e.g. right after marking someone paid). test_to = one sample to that address.
// Each guest gets a personal join link (/join?invite=TOKEN) that pre-fills their email.
// Sends via Resend from RESEND_FROM (default pinball@lonecottonwood.com). Needs a Resend key ("re_...").
import { createClient } from 'npm:@supabase/supabase-js@2';
import qrcode from 'npm:qrcode-generator@1.4.4';
const SITE = 'https://pinball.lonecottonwood.com';
const cors = {
'Access-Control-Allow-Origin': '*',
'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
// Real 8-bit font where the mail app allows web fonts (Apple Mail / iPhone); others fall back to Courier.
// Headings are pixel-text images (web/public/email, made by scripts/email-art.py) so Gmail gets the look too.
const F = "font-family:'Press Start 2P','Courier New',Courier,monospace;";
const ART = `${SITE}/email`;
const img = (name: string, h: number, alt: string) => `<img src="${ART}/${name}.png" height="${h}" alt="${alt}" style="display:block;height:${h}px;width:auto;border:0;">`;
// A QR code drawn as a table of tiny cells: works in email without images or outside services.
function qrTable(text: string, cell = 5) {
const q = qrcode(0, 'M'); q.addData(text); q.make();
const n = q.getModuleCount(), quiet = 3, rows: string[] = [];
const dark = (r: number, c: number) => r >= 0 && c >= 0 && r < n && c < n && q.isDark(r, c);
for (let r = -quiet; r < n + quiet; r++) {
let tr = '';
// merge runs of same-colored cells so the email stays small (Gmail clips big emails)
for (let c = -quiet; c < n + quiet;) {
const d = dark(r, c); let k = 1;
while (c + k < n + quiet && dark(r, c + k) === d) k++;
tr += `<td width="${k * cell}" height="${cell}"${k > 1 ? ` colspan="${k}"` : ''}${d ? ' bgcolor="#000000" style="background-image:linear-gradient(#000,#000);"' : ''}></td>`;
c += k;
}
rows.push(`<tr style="height:${cell}px;font-size:0;line-height:0;">${tr}</tr>`);
}
return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${BG('#f8b800')}"><tr><td style="padding:4px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${(n + 2 * quiet) * cell}" bgcolor="#ffffff" style="border-collapse:collapse;table-layout:fixed;${BG('#ffffff')}">${rows.join('')}</table></td></tr></table>`;
}
// Days from today (Pacific) to the event date.
function daysUntil(date: string | null) {
if (!date) return null;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}
function countdown(d: number | null) {
if (d == null) return '';
if (d < 0) return 'GAME OVER';
if (d === 0) return 'TONIGHT!';
if (d === 1) return 'TOMORROW!';
return `${d} DAYS TO GO`;
}
// Gmail on iPhone flips every email's colors in dark mode, even dark ones. Two fixes keep this one dark:
// 1) backgrounds use BG() (a flat gradient), which Gmail doesn't flip;
// 2) text sits inside T(): two blend layers that flip Gmail's inversion back (they do nothing elsewhere).
// The flip-back only works for white text, so inside T() Gmail shows all text white (other apps keep the colors).
// Images and emoji stay outside T(), since Gmail never flips those.
// Party address (shown in every guest email). Change here for a future event at a different place.
const WHERE = '252 Raymundo Drive, Woodside';
const HOST_HOME = 'The Garr home';
const TIME = '6–10 PM';
const PRICE = '$150 per person'; // ticket price, shown to guests who haven't bought one
const HOSTS = 'The Garrs &amp; the Simkovers'; // co-hosts, credited in every email
const MAP = 'https://maps.google.com/?q=252+Raymundo+Drive,+Woodside,+CA+94062';
const BG = (c: string) => `background-color:${c};background-image:linear-gradient(${c},${c});`;
const T = (inner: string) => `<div class="gb-s"><div class="gb-d">${inner}</div></div>`;
const block = (art: string, title: string, body: string) =>
`<tr><td style="padding:24px 0 0;">${img(art, 12, '&#9654; ' + title)}${body}</td></tr>`;
function render(o: { kind: string; event: any; machines: any[]; name: string | null; link: string; joined: boolean; paid: boolean; message: string; days: number | null; titleArt: { name: string; w: number; h: number } | null }) {
const when = o.event.starts_on ? new Date(`${o.event.starts_on}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).toUpperCase() : '';
const hi = o.name ? `PLAYER 1: ${esc(o.name.toUpperCase())}` : 'PLAYER 1, ENTER YOUR NAME';
// Only paid guests get their personal sign-up link. Unpaid guests get the ticket link instead;
// their sign-up QR is emailed once the host marks them paid.
const canJoin = o.paid;
const cta = !canJoin ? img('btn-tickets', 16, '&#9654; GET TICKETS') : o.joined ? img('btn-open', 16, '&#9654; OPEN THE APP') : img('btn-start', 16, '&#9654; PRESS START');
const ctaLink = canJoin ? o.link : (o.event.ticket_url || SITE);
const lead = o.kind === 'register'
? (o.joined ? `Your ticket's confirmed and your player is locked in. The machines are warming up at the Garr home. See you on the leaderboard!` : `You're IN! Your ticket's confirmed. Six machines are warming up at the Garr home, the leaderboard is empty, and your name could be sitting at the top of it. Scan the code (or tap the button) to set up your player now: nickname, PIN and a selfie we'll turn into an 8-bit portrait. Then walk in ready to flip.`)
: o.kind === 'invite'
? `There's still time (and still space) to join the Ultimate Woodside Pinball Tournament at the Garr home! It's a Woodside School Foundation auction party, so every ticket supports Woodside School. Six classic machines: the Wild West gunslinging of Cactus Canyon, the raging rapids of Whitewater, the fantasy quests of Dungeons & Dragons, the storm-chasing chaos of Whirlwind, the post-apocalyptic biker brawl of Centaur and the deep-sea sirens of Fathom. Scores are tracked live all night on the big screen, and champions are crowned at evening's end. Not a pinball wizard? Spectators are warmly welcome.`
: o.kind === 'reminder'
? (!canJoin ? `There's still time (and still space) to grab a ticket! It's a Woodside School Foundation auction party, so every ticket supports Woodside School. Once your ticket is confirmed, we'll email your personal sign-up QR.` : o.joined ? `You're all set. Stretch those flipper fingers and start practicing your victory dance.` : `Your ticket's confirmed, but your player isn't set up yet! It takes 30 seconds. The leaderboard waits for no one.`)
: '';
const msg = o.message ? `<div style="${F}color:#fcfcfc;font-size:13px;line-height:1.8;margin:14px 0 0;white-space:pre-wrap;">${esc(o.message)}</div>` : '';
const cells = o.machines.map(m => `<td width="50%" valign="top" style="padding:6px;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:256px;"><tr><td style="${BG('#fcfcfc')}padding:3px;"><img src="${SITE}/machines/${slug(m.name)}.jpg" width="250" alt="${esc(m.name)}" style="display:block;width:100%;max-width:250px;height:auto;border:0;"></td></tr></table>
${T(`<div style="${F}color:#f8b800;font-size:11px;line-height:1.6;padding-top:6px;">${esc(m.name.toUpperCase())}</div>
<div class="sm" style="${F}color:#9c9cb4;font-size:10px;line-height:1.6;">${esc(m.manufacturer)} &middot; ${esc(m.year)}</div>`)}</td>`);
const rows: string[] = [];
for (let i = 0; i < cells.length; i += 2) rows.push(`<tr>${cells[i]}${cells[i + 1] || '<td></td>'}</tr>`);
const step = (n: number, t: string) => `<tr><td width="34" valign="top" align="center" style="${BG('#f8b800')}padding:7px 0;"><img src="${ART}/n${n}.png" width="12" height="12" alt="${n}" style="display:inline-block;border:0;"></td><td style="padding:4px 0 10px 12px;">${T(`<div style="${F}color:#fcfcfc;font-size:12px;line-height:1.8;">${t}</div>`)}</td></tr>`;
const dress = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:10px;"><tr><td width="28" valign="top" style="font-size:16px;">&#128095;</td><td>${T(`<div style="${F}color:#fcfcfc;font-size:13px;line-height:1.8;">Anything you would have worn to the arcade in grade school. Neon, windbreakers, scrunchies, band tees, light-up sneakers: all highly encouraged.</div>`)}</td></tr></table>`;
const fuel = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:10px;"><tr><td width="28" style="font-size:16px;">&#127790;</td><td>${T(`<div style="${F}color:#fcfcfc;font-size:13px;line-height:1.8;">Tacos from Arteaga's, plus snacks and drinks all evening to keep you refueled between multiballs. House rule: salsa and sips stay off the glass.</div>`)}</td></tr></table>`;
return `<!doctype html><html><head><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet">
<style>u + .body .gb-s{background:#000;mix-blend-mode:screen;}
u + .body .gb-d{background:#000;mix-blend-mode:difference;}
u + .body .gb-d, u + .body .gb-d *{color:#ffffff !important;}
u + .body .gb-d div{font-size:17px !important;line-height:1.5 !important;font-weight:bold !important;}
u + .body .gb-d .sm{font-size:14px !important;}</style></head>
<body class="body" style="margin:0;padding:0;${BG('#0f0f1b')}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${BG('#0f0f1b')}"><tr><td align="center" style="padding:20px 10px;">
<table role="presentation" width="568" cellpadding="0" cellspacing="0" style="max-width:568px;width:100%;${BG('#fcfcfc')}"><tr><td style="padding:4px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${BG('#000000')}">
<tr><td style="${BG('#e40058')}padding:10px 14px;">${img('brand', 12, 'WOODSIDE PINBALL')}</td></tr>
<tr><td style="padding:20px 20px 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td>
${T(`<div style="${F}color:#3cbcfc;font-size:11px;line-height:1.6;">${hi}</div>`)}
<div style="margin:12px 0 6px;">${o.titleArt ? `<img src="${ART}/${o.titleArt.name}.png" width="${o.titleArt.w}" height="${o.titleArt.h}" alt="${esc(o.event.name.toUpperCase())}" style="display:block;max-width:100%;height:auto;border:0;">` : T(`<div style="${F}color:#fcfcfc;font-size:22px;line-height:1.3;">${esc(o.event.name.toUpperCase())}</div>`)}</div>
${T(`<div style="${F}color:#fce0a8;font-size:12px;line-height:1.6;">${esc(when)}${TIME ? ` &middot; ${TIME}` : ''}</div>`)}
${T(`<div style="${F}color:#fcfcfc;font-size:12px;line-height:1.8;padding-top:8px;">WHERE: ${HOST_HOME}, <a href="${MAP}" style="color:#3cbcfc;text-decoration:underline;">${WHERE}</a><br>Adults only.</div>`)}
${T(`<div style="${F}color:#fcfcfc;font-size:12px;line-height:1.8;">HOSTS: ${HOSTS}</div>`)}
${!canJoin && PRICE ? T(`<div style="${F}color:#f8b800;font-size:14px;line-height:1.6;padding-top:10px;">TICKETS: ${PRICE.toUpperCase()}</div>`) : ''}
${!canJoin
? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0 0;"><tr><td style="${BG('#b06c00')}padding:0 5px 5px 0;"><a href="${o.event.ticket_url || SITE}" style="display:block;text-decoration:none;">${o.days != null && o.days >= 0 && o.days <= 60 ? img(`tk-${o.days}`, 60, countdown(o.days) + ' Tap here to buy tickets') : `<span style="display:block;${BG('#f8b800')}padding:8px 12px;">${img('btn-tickets', 16, '&#9654; GET TICKETS')}</span>`}</a></td></tr></table>`
: o.days != null && o.days >= 0 ? `<div style="margin-top:16px;">${o.days <= 60 ? img(`cd-${o.days}`, 32, '&#9654; ' + countdown(o.days)) : T(`<span style="${F}background:#f8b800;color:#000;font-size:14px;padding:8px 12px;">&#9654; ${countdown(o.days)}</span>`)}</div>` : ''}
${o.kind === 'invite' || (o.kind === 'register' && !o.joined) ? `<div style="padding-top:18px;">${img('hype', 15, '6 MACHINES. 1 NIGHT. 0 QUARTERS.')}</div>` : ''}
${lead || msg ? T(`${lead ? `<div style="${F}color:#fcfcfc;font-size:13px;line-height:1.8;padding-top:16px;">${lead}</div>` : ''}${msg}`) : ''}
${canJoin ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 0;"><tr><td style="${BG('#b06c00')}padding:0 5px 5px 0;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="${BG('#f8b800')}">
<a href="${ctaLink}" style="display:block;padding:14px 20px;text-decoration:none;">${cta}</a></td></tr></table></td></tr></table>` : ''}
${canJoin && !o.joined && (o.kind === 'register' || o.kind === 'reminder') ? `<div style="margin:18px 0 0;">${qrTable(o.link)}${T(`<div class="sm" style="${F}color:#9c9cb4;font-size:10px;line-height:1.6;padding-top:6px;">SCAN WITH YOUR PHONE CAMERA</div>`)}</div>` : ''}
${!canJoin ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:18px 0 0;${BG('#f878f8')}"><tr><td style="padding:2px;"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="${BG('#000000')}"><tr><td style="padding:10px 12px;">${T(`<div style="${F}color:#fcfcfc;font-size:12px;line-height:1.8;">Already bought a ticket? As soon as it's confirmed, we'll email your personal sign-up QR.</div>`)}</td></tr></table></td></tr></table>` : ''}
</td></tr>
${block('h-machines', 'THE MACHINES', `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">${rows.join('')}</table>`)}
${block('h-how', 'HOW IT WORKS', `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;">
${step(1, !canJoin ? 'Grab your ticket with the yellow button at the top. We\'ll email your sign-up QR once it\'s confirmed.' : o.joined ? 'You\'re set up. Just show up.' : 'Set up your player with the button above. It takes 30 seconds.')}
${step(2, 'Play any machine, as often as you like.')}
${step(3, 'Log your scores on your phone and watch the live leaderboard on the big screen.')}
${step(4, 'Prizes at the end of the night.')}</table>`)}
${block('h-dress', 'DRESS CODE', dress)}
${block('h-fuel', 'FUEL', fuel)}
</table></td></tr>
<tr><td style="padding:12px 20px;">${T(`<div class="sm" style="border-top:2px solid #3c3c5c;padding-top:12px;${F}color:#7c7c7c;font-size:9px;line-height:1.8;">Woodside Pinball &middot; ${esc(o.event.name)}. Event info only, never marketing. Questions? Just reply.</div>`)}</td></tr>
</table></td></tr></table></td></tr></table></body></html>`;
}
Deno.serve(async req => {
if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
try {
const { pass, event_id, kind = 'invite', audience = 'unsent', subject, message = '', test_to, invite_ids } = await req.json();
let serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
if (!serviceKey) {
try { serviceKey = Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}'))[0] as string; } catch { /* ignore */ }
}
const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { persistSession: false } });
const ok = await db.rpc('host_check', { p_pass: pass });
if (ok.error || ok.data !== true) return json({ error: 'Wrong host passcode.' }, 403);
if (!['auto', 'register', 'invite', 'reminder'].includes(kind)) return json({ error: 'Unknown email type.' }, 400);
const key = Deno.env.get('RESEND_API_KEY') ?? Object.values(Deno.env.toObject()).find(v => /^re_[\w]{16,}$/.test(v.trim()))?.trim();
if (!key) return json({ error: 'Email is not set up yet (add the Resend key in Supabase secrets).' }, 500);
const from = Deno.env.get('RESEND_FROM') || 'Woodside Pinball <pinball@lonecottonwood.com>';
const { data: event } = await db.from('events').select('id, name, starts_on, ticket_url').eq('id', event_id).single();
if (!event) return json({ error: 'Event not found.' }, 404);
const { data: em } = await db.from('event_machines').select('machine_id').eq('event_id', event_id);
const ids = (em || []).map((x: any) => x.machine_id);
const { data: machines } = await db.from('machines').select('id, name, manufacturer, year, sort_order').in('id', ids.length ? ids : [-1]).order('sort_order');
const { data: invites, error } = await db.from('event_invites').select('id, email, name, token, invited_at, register_sent_at, paid, rsvp, player_id').eq('event_id', event_id);
if (error) return json({ error: error.message }, 500);
const days = daysUntil(event.starts_on);
// The event title as pixel art, if scripts/email-art.py made one for this event.
// Its size is read from the PNG header (bytes 16-23); the art is 2x, so halve it.
const titleArt = await fetch(`${ART}/title-${slug(event.name)}.png`).then(async r => {
if (!r.ok) return null;
const v = new DataView(await r.arrayBuffer());
return { name: `title-${slug(event.name)}`, w: v.getUint32(16) / 2, h: v.getUint32(20) / 2 };
}).catch(() => null);
const kindFor = (inv: any) => (kind === 'auto' ? (inv?.paid ? 'register' : 'invite') : kind);
const subjFor = (k: string) => String(subject || '').trim() || (k === 'register' ? `You're in! Set up your player for ${event.name}`
: k === 'invite' ? `You're invited: ${event.name}${days != null && days >= 0 ? ` (${countdown(days).toLowerCase()})` : ''}`
: `${event.name}: ${countdown(days).toLowerCase() || 'update'}`);
const mk = (to: string, inv: any) => ({
from, to: [to], subject: subjFor(kindFor(inv)),
// A unique ID per email stops Gmail from threading them and hiding "repeated" parts (like the QR code).
headers: { 'X-Entity-Ref-ID': crypto.randomUUID() },
html: render({ kind: kindFor(inv), event, machines: machines || [], name: inv?.name ?? null, joined: !!inv?.player_id, paid: !!inv?.paid,
link: inv && !inv.player_id ? `${SITE}/join?invite=${inv.token}` : SITE, message: String(message || ''), days, titleArt }),
});
let list = (invites || []).filter((i: any) => i.email); // extra players on a shared ticket have no email
if (Array.isArray(invite_ids) && invite_ids.length) list = list.filter((i: any) => invite_ids.includes(i.id));
if (kind === 'register') list = list.filter((i: any) => i.paid); // registration emails only go to paid guests
// 'unsent': only people who haven't had the email that fits them (paid: sign-up email; unpaid: invite)
if (audience === 'unsent') list = list.filter((i: any) => (kindFor(i) === 'register' ? !i.register_sent_at : kindFor(i) === 'invite' ? !i.invited_at : true));
else if (audience === 'not_joined') list = list.filter((i: any) => !i.player_id);
else if (audience === 'paid') list = list.filter((i: any) => i.paid);
else if (audience === 'going') list = list.filter((i: any) => i.paid && i.rsvp !== 'no');
// Unpaid invites need somewhere to buy a ticket.
if (!test_to && !event.ticket_url && list.some((i: any) => kindFor(i) === 'invite')) {
return json({ error: 'Add a ticket link first: unpaid guests need it.' }, 400);
}
// Tests use a made-up guest and a link that isn't tied to anyone, so nobody's real sign-up link leaks.
// For "invites" the test sends both versions (paid and unpaid).
const sample = (paid: boolean) => ({ id: 0, name: 'Sample Guest', token: null, paid, player_id: null });
const testMsg = (inv: any) => {
const m = mk(String(test_to), inv);
return { ...m, subject: `[TEST] ${m.subject}`, html: m.html.replaceAll(`${SITE}/join?invite=null`, `${SITE}/join`) };
};
const msgs = test_to
? (kind === 'auto' ? [testMsg(sample(true)), testMsg(sample(false))] : [testMsg(sample(kind !== 'invite'))])
: list.map((i: any) => mk(i.email, i));
if (!msgs.length) return json({ sent: 0, note: 'Nobody matched.' });
let sent = 0; const errors: string[] = [];
for (let i = 0; i < msgs.length; i += 100) {
const res = await fetch('https://api.resend.com/emails/batch', {
method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
body: JSON.stringify(msgs.slice(i, i + 100)),
});
if (res.ok) sent += msgs.slice(i, i + 100).length;
else { const t = await res.text(); console.error('resend error', res.status, t.slice(0, 500)); errors.push(t.slice(0, 200)); }
}
if (sent && !test_to) {
const done = list.slice(0, sent);
const now = new Date().toISOString();
const idsOf = (k: string) => done.filter((i: any) => kindFor(i) === k).map((i: any) => i.id);
if (idsOf('invite').length) await db.from('event_invites').update({ invited_at: now }).in('id', idsOf('invite'));
if (idsOf('register').length) await db.from('event_invites').update({ register_sent_at: now }).in('id', idsOf('register'));
if (idsOf('reminder').length) await db.from('event_invites').update({ update_sent_at: now }).in('id', idsOf('reminder'));
}
if (errors.length && !sent) return json({ error: `Email service said: ${errors[0]}` }, 502);
return json({ sent, test: !!test_to });
} catch (e) {
console.error(e);
return json({ error: 'Something went wrong.' }, 500);
}
});

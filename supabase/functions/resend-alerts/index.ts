// resend-alerts: Resend calls this when one of our emails bounces or is marked as spam.
// It emails the host (ALERT_TO) a short alert with the guest's name, so a bad address gets fixed.
// Set up in Resend > Webhooks, pointing at /functions/v1/resend-alerts (events: email.bounced, email.complained).
// JWT verification must be OFF for this function (Resend can't sign in).
// Safety: every call must carry Resend's signature, checked with the webhook's signing secret
// (Supabase secret RESEND_WEBHOOK_SECRET, copied from the webhook's page in Resend). Unsigned calls do nothing.
import { createClient } from 'npm:@supabase/supabase-js@2';
const ALERT_TO = 'mattgarr@gmail.com';
const FROM = 'Woodside Pinball <pinball@lonecottonwood.com>';
const KINDS: Record<string, { label: string; status: string; fix: string }> = {
'email.bounced': { label: 'Bounced', status: 'bounced', fix: 'Check the address in the guest list (Edit on their row), then use "Email invite" or "Email QR" to resend.' },
'email.complained': { label: 'Marked as spam', status: 'complained', fix: 'They marked it as spam. Maybe text them instead of emailing again.' },
};
const ok = (msg: string) => new Response(msg, { status: 200 });
// Resend signs webhooks the Svix way: HMAC-SHA256 of "id.timestamp.body" with the base64 secret after "whsec_".
async function signed(req: Request, body: string) {
const secret = Deno.env.get('RESEND_WEBHOOK_SECRET') || '';
const id = req.headers.get('svix-id'), ts = req.headers.get('svix-timestamp'), sigs = req.headers.get('svix-signature');
if (!secret || !id || !ts || !sigs) return false;
if (Math.abs(Date.now() / 1000 - Number(ts)) > 600) return false; // older than 10 minutes: replay
const keyBytes = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), c => c.charCodeAt(0));
const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${id}.${ts}.${body}`)));
const want = btoa(String.fromCharCode(...mac));
return sigs.split(' ').some(s => s.split(',')[1] === want);
}
Deno.serve(async req => {
if (req.method !== 'POST') return ok('ok');
const body = await req.text();
if (!(await signed(req, body))) { console.warn('unsigned or bad signature'); return new Response('unauthorized', { status: 401 }); }
let ev: any;
try { ev = JSON.parse(body); } catch { return new Response('bad request', { status: 400 }); }
const kind = KINDS[ev?.type];
const id = ev?.data?.email_id;
if (!kind || typeof id !== 'string') return ok('ignored');
const key = Deno.env.get('RESEND_API_KEY') ?? Object.values(Deno.env.toObject()).find(v => /^re_[\w]{16,}$/.test(v.trim()))?.trim();
if (!key) return ok('no key');
const em = ev.data || {};
const to = String((Array.isArray(em.to) ? em.to[0] : em.to) || '').toLowerCase();
if (!to || to === ALERT_TO) return ok('skip'); // never alert about the alert inbox itself
// Find the guest's name in the guest list.
let serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
if (!serviceKey) {
try { serviceKey = Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}'))[0] as string; } catch { /* ignore */ }
}
let name = '';
try {
const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, { auth: { persistSession: false } });
const { data } = await db.from('event_invites').select('name').eq('email', to).limit(1);
name = data?.[0]?.name || '';
// Mark the guest so the guest list shows it.
await db.from('event_invites').update({ bounce_at: new Date().toISOString(), bounce_kind: kind.status === 'bounced' ? 'bounced' : 'spam',
bounce_note: String(ev?.data?.bounce?.message || '').slice(0, 300) || null }).eq('email', to);
} catch { /* name is optional */ }
const who = name ? `${name} (${to})` : to;
const reason = ev?.data?.bounce?.message ? `\nReason: ${ev.data.bounce.message}` : '';
const text = `${kind.label}: ${who}\n\nEmail: "${em.subject || ''}"${reason}\n\n${kind.fix}\n\n(Automatic alert from Woodside Pinball.)`;
const send = await fetch('https://api.resend.com/emails', {
method: 'POST',
headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
body: JSON.stringify({ from: FROM, to: [ALERT_TO], subject: `⚠ ${kind.label}: ${name || to}`, text }),
});
if (!send.ok) console.error('alert send failed', send.status, (await send.text()).slice(0, 300));
return ok('alerted');
});

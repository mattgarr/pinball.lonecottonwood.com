// Party access (migration 0030): who may see the app and join.
// The server is the real gate (join_party needs a credential); this file keeps the browser side:
//   * pw.access  – the party QR key or password this phone was let in with (sent when joining)
//   * pw.device  – the last player token on this phone (stays valid after "sign out", so a phone
//                  that has joined once can add a partner or a new player without the code again)
//   * pw.joinKey – the party QR key, learned with the host passcode (TV join QR, QR sheet)
import { sb, getToken, getHostPass } from './store.js';

const ACCESS_KEY = 'pw.access';
const DEVICE_KEY = 'pw.device';
const JOINKEY_KEY = 'pw.joinKey';
const safe = fn => { try { return fn(); } catch { return null; } };
const read = k => safe(() => localStorage.getItem(k)) || null;
const write = (k, v) => safe(() => (v ? localStorage.setItem(k, v) : localStorage.removeItem(k)));

export const getAccess = () => read(ACCESS_KEY);
export const setAccess = v => write(ACCESS_KEY, v);
export const getJoinKey = () => read(JOINKEY_KEY);
export const rememberDevice = token => { if (token) write(DEVICE_KEY, token); };

// What to send as p_access when joining: a ticket link beats everything (it's personal), then the
// party code this phone was let in with, then this phone's own player token.
export function accessCredential(invite = null) {
  return invite || getAccess() || getToken() || read(DEVICE_KEY) || null;
}

// May this browser see the guest app (UI only; the data API is the server's business)?
// Lights topic = the host unlocked here once (the TV Mac), so it keeps working after the unlock expires.
export function isAuthorized() {
  return !!(getToken() || getAccess() || read(DEVICE_KEY) || getHostPass() || getJoinKey() || read('pw.lightsTopic'));
}

// Pages a visitor who isn't in yet may open: the host pages (own passcode), getting back in, and a
// personal ticket link. Everything else shows the landing page.
export function isOpenToVisitors(path, search = '') {
  return path === '/host' || path.startsWith('/host/') || path === '/rejoin'
    || (path === '/join' && new URLSearchParams(search).has('invite'));
}

// Party QR codes carry ?k=<key>. Take it off the address bar (so it isn't shared by accident) and
// remember it until it's checked. Runs once, before the router reads the URL.
let pendingKey = null;
export function captureAccessKey() {
  if (typeof location === 'undefined') return;
  const u = new URL(location.href);
  const k = u.searchParams.get('k');
  if (!k) return;
  pendingKey = k.trim();
  u.searchParams.delete('k');
  safe(() => history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash));
  // Let the phone in right away (the QR is the usual way in); the server re-checks at join time,
  // and a bad key is dropped by verifyPendingKey().
  if (pendingKey && !getAccess()) setAccess(pendingKey);
}
export const takePendingKey = () => { const k = pendingKey; pendingKey = null; return k; };

// Ask the server whether a code is good: { ok, kind, event_name } or { ok:false, error }.
export async function checkAccess(code) {
  const { data, error } = await sb.rpc('check_party_access', { p_access: code });
  if (error) throw new Error(/fetch|network|load failed/i.test(error.message) ? 'No connection. Check Wi-Fi and try again.' : error.message);
  return data || { ok: false, error: 'Something went wrong. Try again.' };
}

// The join form got "you need the party code" back: forget the stale code.
export function dropAccess() { setAccess(null); }

// Address for party QR codes (TV, printed sheet). Without the key, the plain address (lands on the
// landing page, where guests type the password).
export function partyUrl(path = '/', key = getJoinKey()) {
  const origin = typeof location !== 'undefined' ? location.origin : 'https://pinball.lonecottonwood.com';
  return `${origin}${path}${key ? `${path.includes('?') ? '&' : '?'}k=${encodeURIComponent(key)}` : ''}`;
}

// Normalize a typed password the way the server does (for comparing / display only).
export const normPass = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// "Need help?" form (public, rate-limited on the server; nothing is emailed).
export async function sendHelp({ name, contact, message }) {
  const { data, error } = await sb.rpc('send_help_request', { p_name: name, p_contact: contact, p_message: message });
  if (error) throw new Error(/fetch|network|load failed/i.test(error.message) ? 'No connection. Try again.' : error.message);
  if (data?.error) throw new Error(data.error);
  return true;
}

// ----------------------------------------------------------------- host side
async function hostRpc(name, args = {}) {
  const pass = getHostPass();
  if (!pass) throw new Error('Wrong host passcode.');
  const { data, error } = await sb.rpc(name, { p_pass: pass, ...args });
  if (error) throw new Error(error.message);
  return data;
}
export const hostAccess = {
  async get() {
    const a = await hostRpc('host_party_access');
    if (a?.key) write(JOINKEY_KEY, a.key);
    return a;
  },
  async set({ password = null, newKey = false, open = null } = {}) {
    const a = await hostRpc('host_set_party_access', { p_password: password, p_new_key: newKey, p_open: open });
    if (a?.key) write(JOINKEY_KEY, a.key);
    return a;
  },
  help: () => hostRpc('host_help_requests'),
  helpDone: (id, done = true) => hostRpc('host_help_done', { p_id: id, p_done: done }),
};

// Host browsers (incl. the TV Mac) learn the party QR key once, quietly.
export async function ensureJoinKey() {
  if (!getHostPass()) return getJoinKey();
  try { await hostAccess.get(); } catch { /* offline or old server */ }
  return getJoinKey();
}

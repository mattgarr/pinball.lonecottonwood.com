// Spotify for the TV: log in with Authorization Code + PKCE (no client secret, all in the browser),
// keep the tokens in THIS browser's localStorage (the TV Mac), refresh them before they expire, and
// run the Web Playback SDK so the music plays inside the /tv page (the page owns the volume, so
// ducking is instant). The Web API also drives other Spotify devices (the Spotify app on the Mac,
// the WiiM over Spotify Connect) as a fallback.
//
// Needs: a Spotify developer app (Client ID below or set on the host Audio card), redirect URIs
// https://pinball.lonecottonwood.com/tv and http://127.0.0.1:5194/tv registered on it, and a
// Premium account (the SDK and the player API need Premium).
export const SPOTIFY_CLIENT_ID = '791b347ee3954b0a995d7e2ba8dd4d49';
export const SCOPES = [
  'streaming', 'user-read-email', 'user-read-private', // the Web Playback SDK
  'user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing',
  'playlist-read-private', 'playlist-read-collaborative',
].join(' ');

const TOKENS_KEY = 'pw.spotify';
const PKCE_KEY = 'pw.spotifyPkce';
const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';

export const redirectUri = () => `${location.origin}/tv`;

const read = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } };

export const hasLogin = () => !!read(TOKENS_KEY)?.refresh;
export function logout() { write(TOKENS_KEY, null); }

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomString(n = 64) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const r = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(r, x => abc[x % abc.length]).join('');
}

// Go to Spotify's login / consent page; it comes back to /tv?code=…
export async function login(clientId = SPOTIFY_CLIENT_ID) {
  const verifier = randomString(64);
  const state = randomString(16);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  write(PKCE_KEY, { verifier, state, clientId, at: Date.now() });
  const q = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: redirectUri(), scope: SCOPES,
    code_challenge_method: 'S256', code_challenge: challenge, state,
  });
  location.assign(`${ACCOUNTS}/authorize?${q}`);
}

// On /tv: finish a login that just came back (?code= / ?error=), then clean the address bar.
// Returns { ok } / { error } / null (nothing to do).
export async function handleCallback() {
  const u = new URL(location.href);
  const code = u.searchParams.get('code'), err = u.searchParams.get('error'), state = u.searchParams.get('state');
  if (!code && !err) return null;
  const pk = read(PKCE_KEY);
  for (const k of ['code', 'error', 'state']) u.searchParams.delete(k);
  history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
  write(PKCE_KEY, null);
  if (err) return { error: err === 'access_denied' ? 'Spotify login was cancelled' : `Spotify: ${err}` };
  if (!pk || pk.state !== state) return { error: 'Spotify login expired; try Connect again' };
  try {
    const r = await fetch(`${ACCOUNTS}/api/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), client_id: pk.clientId, code_verifier: pk.verifier }),
    });
    const j = await r.json();
    if (!r.ok) return { error: `Spotify: ${j.error_description || j.error || r.status}` };
    save(j, pk.clientId);
    return { ok: true };
  } catch { return { error: 'Spotify login: network error' }; }
}

function save(j, clientId) {
  const old = read(TOKENS_KEY) || {};
  write(TOKENS_KEY, {
    access: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000,
    refresh: j.refresh_token || old.refresh, clientId: clientId || old.clientId || SPOTIFY_CLIENT_ID, scope: j.scope || old.scope,
  });
}

let refreshing = null;
async function refresh() {
  const t = read(TOKENS_KEY);
  if (!t?.refresh) throw new Error('not connected');
  const go = async () => {
    const cur = read(TOKENS_KEY); // another tab may have refreshed (and rotated the token) meanwhile
    if (cur?.access && cur.exp - Date.now() > 120000) return cur.access;
    const r = await fetch(`${ACCOUNTS}/api/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cur.refresh, client_id: cur.clientId || SPOTIFY_CLIENT_ID }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (j.error === 'invalid_grant') logout(); // revoked: needs Connect again
      throw new Error(j.error_description || j.error || `refresh ${r.status}`);
    }
    save(j, cur.clientId);
    return j.access_token;
  };
  // One refresh at a time across tabs (refresh tokens rotate).
  refreshing ||= (navigator.locks ? navigator.locks.request('pw-spotify-refresh', go) : go()).finally(() => { refreshing = null; });
  return refreshing;
}

export async function token() {
  const t = read(TOKENS_KEY);
  if (!t?.refresh) throw new Error('not connected');
  if (t.access && t.exp - Date.now() > 60000) return t.access;
  return refresh();
}

// Web API call. Returns parsed JSON, null for 204, or throws { status, message }.
export async function api(method, path, body, retried = false) {
  const tk = await token();
  const r = await fetch(`${API}${path}`, {
    method, headers: { Authorization: `Bearer ${tk}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401 && !retried) { await refresh(); return api(method, path, body, true); }
  if (r.status === 204 || r.status === 202) return null;
  const text = await r.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch { j = null; }
  if (!r.ok) {
    const e = new Error(j?.error?.message || `Spotify ${r.status}`);
    e.status = r.status;
    e.retryAfter = Number(r.headers.get('Retry-After')) || 0;
    throw e;
  }
  return j;
}

// "https://open.spotify.com/playlist/37i9…?si=…" / "spotify:playlist:37i9…" → "spotify:playlist:37i9…"
export function parseSpotifyUri(s) {
  const v = String(s || '').trim();
  let m = /^spotify:(playlist|album|artist|show):([A-Za-z0-9]{10,})$/.exec(v);
  if (m) return `spotify:${m[1]}:${m[2]}`;
  m = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(playlist|album|artist|show)\/([A-Za-z0-9]{10,})/.exec(v);
  if (m) return `spotify:${m[1]}:${m[2]}`;
  return null;
}

// ---------- the Web Playback SDK ----------
let sdkP = null;
export function loadSdk() {
  if (window.Spotify?.Player) return Promise.resolve(window.Spotify);
  sdkP ||= new Promise((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve(window.Spotify);
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    s.async = true;
    s.onerror = () => { sdkP = null; reject(new Error('Spotify player could not load')); };
    document.head.appendChild(s);
  });
  return sdkP;
}

export async function createPlayer({ name = 'Woodside Pinball TV', volume = 0.5, on = {} } = {}) {
  const Spotify = await loadSdk();
  const player = new Spotify.Player({ name, volume, getOAuthToken: cb => { token().then(cb).catch(() => {}); } });
  for (const [ev, fn] of Object.entries(on)) player.addListener(ev, fn);
  const ok = await player.connect();
  if (!ok) throw new Error('Spotify player could not connect');
  return player;
}

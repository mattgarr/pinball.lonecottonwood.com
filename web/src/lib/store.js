import { useMemo, useSyncExternalStore } from 'react';
import { createClient } from '@supabase/supabase-js';
import { computeStandings, computeAwards } from './scoring.js';

// Public project settings. The publishable key is designed to live in the browser:
// the database only allows reads, and every write goes through checked server functions.
export const SUPABASE_URL = 'https://llmggdjxiffkwnjuogxf.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_7oGSOVFpRFVnJ5SeRcjYsQ_a6EQyojv';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TOKEN_KEY = 'pw.token';
const HOST_KEY = 'pw.host';
const safe = fn => { try { return fn(); } catch { return null; } };
export const getToken = () => safe(() => localStorage.getItem(TOKEN_KEY));
export const setToken = t => safe(() => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY)));
export const getHostPass = () => safe(() => localStorage.getItem(HOST_KEY));
export const setHostPass = p => safe(() => (p ? localStorage.setItem(HOST_KEY, p) : localStorage.removeItem(HOST_KEY)));

// ---------------------------------------------------------------------------
// One shared, live copy of the whole party (it's small: ~40 players, a few
// hundred scores). Every screen reads from here; Realtime keeps it current.
// ---------------------------------------------------------------------------
let state = {
  ready: false,
  error: null,
  machines: [],
  players: [],
  scores: [],
  party: null,
  me: null,          // the player row for this phone, or null
  meChecked: false,  // finished checking the saved token
};
const listeners = new Set();
function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach(l => l());
}
const subscribe = l => { listeners.add(l); return () => listeners.delete(l); };

const PLAYER_COLS = 'id, display_name, emoji, color, avatar, first_timer, created_at';
const SCORE_COLS = 'id, player_id, machine_id, value, voided, created_at, logged_by, photo_path, needs_review';

async function fetchAllScores() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('scores').select(SCORE_COLS).order('id').range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

async function fetchPlayers() {
  const { data, error } = await sb.from('players').select(PLAYER_COLS).order('id');
  if (error) throw error;
  return data;
}

let loading = null;
export function refreshAll() {
  if (loading) return loading;
  loading = (async () => {
    try {
      const [m, players, scores, p] = await Promise.all([
        sb.from('machines').select('*').eq('active', true).order('sort_order'),
        fetchPlayers(),
        fetchAllScores(),
        sb.from('party').select('*').eq('id', 1).single(),
      ]);
      if (m.error) throw m.error;
      if (p.error) throw p.error;
      const me = state.me ? players.find(x => x.id === state.me.id) ?? null : state.me;
      set({ ready: true, error: null, machines: m.data, players, scores, party: p.data, me });
      if (state.me && !me) { setToken(null); }
    } catch (e) {
      set({ error: e.message || String(e) });
    } finally {
      loading = null;
    }
  })();
  return loading;
}

async function checkMe() {
  const token = getToken();
  if (!token) { set({ me: null, meChecked: true }); return; }
  const { data, error } = await sb.rpc('whoami', { p_token: token });
  if (error) { set({ meChecked: true }); return; } // offline: keep token, try later
  if (!data) setToken(null);
  set({ me: data || null, meChecked: true });
}

let started = false;
function start() {
  if (started) return;
  started = true;
  refreshAll();
  checkMe();

  let wasDown = false;
  sb.channel('party-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, ev => {
      if (ev.eventType === 'INSERT') {
        if (!state.scores.some(s => s.id === ev.new.id)) set({ scores: [...state.scores, ev.new] });
      } else if (ev.eventType === 'UPDATE') {
        set({ scores: state.scores.map(s => (s.id === ev.new.id ? { ...s, ...ev.new } : s)) });
      } else {
        refreshAll();
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => {
      // Re-read players (rows carry selfies, so we don't trust the realtime payload size).
      fetchPlayers().then(players => {
        const me = state.me ? players.find(x => x.id === state.me.id) ?? null : null;
        set({ players, me: state.me ? me : null });
        if (state.me && !me) setToken(null);
      }).catch(() => {});
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'party' }, ev => {
      if (ev.new && ev.new.id === 1) set({ party: ev.new });
    })
    .subscribe(status => {
      if (status === 'SUBSCRIBED') { if (wasDown) refreshAll(); wasDown = false; }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') wasDown = true;
    });

  // Phones sleep and miss events; catch up whenever the page comes back.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAll(); });
  window.addEventListener('online', () => refreshAll());
  // Belt and braces for the always-on TV.
  setInterval(() => { if (!document.hidden) refreshAll(); }, 60_000);
}

export function useParty() {
  start();
  return useSyncExternalStore(subscribe, () => state);
}

export function useStandings() {
  const s = useParty();
  const standings = useMemo(
    () => computeStandings({ machines: s.machines, players: s.players, scores: s.scores }),
    [s.machines, s.players, s.scores],
  );
  return { ...s, standings };
}

export function useAwards(standings, matchDigits) {
  const s = useParty();
  return useMemo(
    () => computeAwards({ machines: s.machines, players: s.players, scores: s.scores, standings, matchDigits }),
    [s.machines, s.players, s.scores, standings, matchDigits],
  );
}

// ---------------------------------------------------------------------------
// Actions. Each throws an Error with a friendly message on failure.
// ---------------------------------------------------------------------------
async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(error.message || 'Something went wrong. Try again.');
  return data;
}

async function signIn(result) {
  setToken(result.token);
  const me = await rpc('whoami', { p_token: result.token });
  if (!state.players.some(p => p.id === me.id)) await refreshAll();
  set({ me, meChecked: true });
  return me;
}

import { photoPaths } from './photo.js';
const photoPathFor = opts => opts?.photoPath || (opts?.photo ? photoPaths.get(opts.photo) : null) || null;
export const photoUrl = path => (path ? `${SUPABASE_URL}/storage/v1/object/public/score-photos/${path}` : null);

export const actions = {
  async join({ name, pin, emoji, firstTimer, avatar }) {
    const r = await rpc('join_party', { p_name: name, p_pin: pin, p_emoji: emoji, p_first_timer: firstTimer, p_avatar: avatar });
    return signIn(r);
  },
  async rejoin(playerId, pin) {
    const r = await rpc('rejoin', { p_player_id: playerId, p_pin: pin });
    if (r?.error) throw new Error(r.error);
    return signIn(r);
  },
  signOut() { setToken(null); set({ me: null }); },
  // opts: { photo } (a data URL that went through readScoreFromPhoto) or { photoPath }.
  async submitScore(machineId, value, opts = {}) {
    const r = await rpc('submit_score', { p_token: getToken(), p_machine_id: machineId, p_value: value, p_photo_path: photoPathFor(opts) });
    if (!state.scores.some(s => s.id === r.score_id)) {
      set({ scores: [...state.scores, { id: r.score_id, player_id: state.me?.id, machine_id: machineId, value, voided: false, created_at: new Date().toISOString() }] });
    }
    return r;
  },
  // Log a score for a friend who played the same game.
  async submitScoreFor(playerId, machineId, value, opts = {}) {
    const r = await rpc('submit_score_for', { p_token: getToken(), p_player_id: playerId, p_machine_id: machineId, p_value: value, p_photo_path: photoPathFor(opts) });
    if (!state.scores.some(s => s.id === r.score_id)) {
      set({ scores: [...state.scores, { id: r.score_id, player_id: playerId, machine_id: machineId, value, voided: false, created_at: new Date().toISOString(), logged_by: state.me?.id }] });
    }
    return r;
  },
  async undoScore(scoreId) {
    await rpc('undo_score', { p_token: getToken(), p_score_id: scoreId });
    set({ scores: state.scores.map(s => (s.id === scoreId ? { ...s, voided: true } : s)) });
  },
};

const hostCall = (name, args = {}) => rpc(name, { p_pass: getHostPass(), ...args });
export const host = {
  check: pass => rpc('host_check', { p_pass: pass }),
  setStatus: status => hostCall('host_set_status', { p_status: status }),
  reveal: (active, matchDigits = null) => hostCall('host_reveal', { p_active: active, p_match_digits: matchDigits }),
  voidScore: (id, voided) => hostCall('host_void', { p_score_id: id, p_voided: voided }),
  markReviewed: id => hostCall('host_review', { p_score_id: id }),
  addScore: (playerId, machineId, value) => hostCall('host_add_score', { p_player_id: playerId, p_machine_id: machineId, p_value: value }),
  resetPin: (playerId, pin) => hostCall('host_reset_pin', { p_player_id: playerId, p_new_pin: pin }),
  removePlayer: playerId => hostCall('host_remove_player', { p_player_id: playerId }),
  wipe: confirm => hostCall('host_wipe', { p_confirm: confirm }),
};

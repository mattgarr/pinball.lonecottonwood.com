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
// The host unlock expires after 2 days, so a forgotten phone or laptop doesn't stay unlocked.
const HOST_TTL = 2 * 24 * 3600 * 1000;
export const getHostPass = () => safe(() => {
  let v = null;
  try { v = JSON.parse(localStorage.getItem(HOST_KEY) || 'null'); } catch { /* old plain-text format: drop it */ }
  if (v?.p && Date.now() - v.t < HOST_TTL) return v.p;
  localStorage.removeItem(HOST_KEY);
  return null;
});
export const setHostPass = p => safe(() => (p ? localStorage.setItem(HOST_KEY, JSON.stringify({ p, t: Date.now() })) : localStorage.removeItem(HOST_KEY)));

// ---------------------------------------------------------------------------
// One shared, live copy of the whole party (it's small: ~40 players, a few
// hundred scores). Every screen reads from here; Realtime keeps it current.
// ---------------------------------------------------------------------------
let state = {
  ready: false,
  error: null,
  // raw, across all events
  allMachines: [],
  allScores: [],
  events: [],
  eventMachines: [],
  entries: [],
  players: [],     // the permanent player database
  party: null,     // live state of the current event (party.current_event_id)
  lights: null,    // garage lights settings (lights_settings row): enabled, dry_run, zones
  // derived for the current event (see derive): event, machines, scores, entrantIds
  me: null,          // the player row for this phone, or null
  meChecked: false,  // finished checking the saved token
};
const listeners = new Set();
// Screens see only the current event's machines and scores; the raw lists stay for all-time views.
let memo = {};
function derive(s) {
  const evId = s.party?.current_event_id ?? null;
  if (memo.allMachines !== s.allMachines || memo.allScores !== s.allScores || memo.events !== s.events
      || memo.eventMachines !== s.eventMachines || memo.entries !== s.entries || memo.evId !== evId) {
    const inEvent = new Set(s.eventMachines.filter(x => x.event_id === evId).map(x => x.machine_id));
    memo = {
      allMachines: s.allMachines, allScores: s.allScores, events: s.events, eventMachines: s.eventMachines, entries: s.entries, evId,
      event: s.events.find(e => e.id === evId) || null,
      machines: evId == null || !inEvent.size ? s.allMachines : s.allMachines.filter(m => inEvent.has(m.id)),
      scores: evId == null ? s.allScores : s.allScores.filter(x => x.event_id === evId || x.event_id == null),
      entrantIds: new Set(s.entries.filter(x => x.event_id === evId).map(x => x.player_id)),
    };
  }
  return { ...s, event: memo.event, machines: memo.machines, scores: memo.scores, entrantIds: memo.entrantIds };
}
state = derive(state);
function set(patch) {
  state = derive({ ...state, ...patch });
  listeners.forEach(l => l());
}
const subscribe = l => { listeners.add(l); return () => listeners.delete(l); };

const PLAYER_COLS = 'id, display_name, emoji, color, avatar, first_timer, created_at';
const SCORE_COLS = 'id, player_id, machine_id, value, voided, created_at, logged_by, photo_path, needs_review, event_id';

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
      const [m, players, scores, p, ev, em, en] = await Promise.all([
        sb.from('machines').select('*').eq('active', true).order('sort_order'),
        fetchPlayers(),
        fetchAllScores(),
        sb.from('party').select('*').eq('id', 1).single(),
        sb.from('events').select('*').order('starts_on', { ascending: false, nullsFirst: false }),
        sb.from('event_machines').select('event_id, machine_id'),
        sb.from('event_entries').select('event_id, player_id'),
      ]);
      if (m.error) throw m.error;
      if (p.error) throw p.error;
      const found = state.me ? players.find(x => x.id === state.me.id) ?? null : null;
      const me = state.me ? (found ? { ...state.me, ...found } : null) : state.me;
      set({
        ready: true, error: null, allMachines: m.data, players, allScores: scores, party: p.data, me,
        events: ev.data || [], eventMachines: em.data || [], entries: en.data || [],
      });
      if (state.me && !me) { setToken(null); }
      refreshLights();
    } catch (e) {
      set({ error: e.message || String(e) });
    } finally {
      loading = null;
    }
  })();
  return loading;
}

// Lights settings live in their own small table; a missing table (before migration 0018) is fine.
export function refreshLights() {
  return sb.from('lights_settings').select('*').eq('id', 1).maybeSingle()
    .then(({ data, error }) => { if (!error) set({ lights: data || null }); })
    .catch(() => {});
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
        if (!state.allScores.some(s => s.id === ev.new.id)) set({ allScores: [...state.allScores, ev.new] });
      } else if (ev.eventType === 'UPDATE') {
        set({ allScores: state.allScores.map(s => (s.id === ev.new.id ? { ...s, ...ev.new } : s)) });
      } else {
        refreshAll();
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => {
      // Re-read players (rows carry selfies, so we don't trust the realtime payload size).
      fetchPlayers().then(players => {
        const found = state.me ? players.find(x => x.id === state.me.id) ?? null : null;
        const me = state.me && found ? { ...state.me, ...found } : null;
        set({ players, me: state.me ? me : null });
        if (state.me && !me) setToken(null);
      }).catch(() => {});
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'party' }, ev => {
      if (ev.new && ev.new.id === 1) {
        const switched = ev.new.current_event_id !== state.party?.current_event_id;
        set({ party: ev.new });
        if (switched) refreshAll();
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lights_settings' }, ev => { if (ev.new) set({ lights: ev.new }); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => refreshAll())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'event_machines' }, () => refreshAll())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'event_entries' }, ev => {
      if (ev.eventType === 'INSERT' && !state.entries.some(x => x.event_id === ev.new.event_id && x.player_id === ev.new.player_id)) {
        set({ entries: [...state.entries, { event_id: ev.new.event_id, player_id: ev.new.player_id }] });
      } else if (ev.eventType !== 'INSERT') refreshAll();
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

// Read-only snapshot for non-React helpers (e.g. building the results email).
export const getState = () => state;

export function useParty() {
  start();
  return useSyncExternalStore(subscribe, () => state);
}

// Players in an event: entered in event_entries, or with a score in that event.
function playersForEvent(allPlayers, entrantIds, eventScores, fallbackAll = true) {
  const scored = new Set(eventScores.map(x => x.player_id));
  if (!entrantIds?.size && !scored.size) return fallbackAll ? allPlayers : [];
  return allPlayers.filter(p => entrantIds.has(p.id) || scored.has(p.id));
}

export function useStandings(targetEventId = null) {
  const s = useParty();
  return useMemo(() => {
    const evId = targetEventId != null ? Number(targetEventId) : s.party?.current_event_id ?? null;
    if (evId === s.party?.current_event_id || evId == null) {
      const evPlayers = playersForEvent(s.players, s.entrantIds, s.scores, true);
      return { ...s, eventPlayers: evPlayers, standings: computeStandings({ machines: s.machines, players: evPlayers, scores: s.scores }) };
    }
    const event = s.events.find(e => e.id === evId) || null;
    const inEvent = new Set(s.eventMachines.filter(x => x.event_id === evId).map(x => x.machine_id));
    const machines = !inEvent.size ? s.allMachines : s.allMachines.filter(m => inEvent.has(m.id));
    const scores = s.allScores.filter(x => x.event_id === evId);
    const entrantIds = new Set(s.entries.filter(x => x.event_id === evId).map(x => x.player_id));
    const evPlayers = playersForEvent(s.players, entrantIds, scores, false);
    return { ...s, event, machines, scores, entrantIds, eventPlayers: evPlayers, standings: computeStandings({ machines, players: evPlayers, scores }) };
  }, [s, targetEventId]);
}

// Every event together: all machines, all scores, everyone.
export function useAllTime() {
  const s = useParty();
  return useMemo(
    () => computeStandings({ machines: s.allMachines, players: s.players, scores: s.allScores }),
    [s.allMachines, s.players, s.allScores],
  );
}

// Signed in + not in any event yet = enter the current event automatically.
// If a player is already in at least one tournament, don't silently add them to a different tournament
// just for opening the app — they'll enter when they claim a ticket, log a score, or tap "Enter" on /me.
let enteredFor = null;
function maybeEnter() {
  const evId = state.party?.current_event_id;
  if (!state.ready || !state.me || evId == null || state.entrantIds.has(state.me.id) || enteredFor === `${evId}:${state.me.id}`) return;
  if (state.entries.some(x => x.player_id === state.me.id)) return;
  if (typeof location !== 'undefined' && (location.pathname === '/join' || location.pathname === '/rejoin') && new URLSearchParams(location.search).get('invite')) return;
  enteredFor = `${evId}:${state.me.id}`;
  sb.rpc('enter_current_event', { p_token: getToken() }).then(({ error }) => {
    if (error) { enteredFor = null; return; }
    if (!state.entries.some(x => x.event_id === evId && x.player_id === state.me?.id)) {
      set({ entries: [...state.entries, { event_id: evId, player_id: state.me.id }] });
    }
  });
}
listeners.add(maybeEnter);

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
  // Returns { score_id, duplicate, logged_by }. duplicate: the server already had this exact
  // score (same player + machine + value, last 45 min), so nothing new was saved.
  async submitScore(machineId, value, opts = {}) {
    const r = await rpc('submit_score', { p_token: getToken(), p_machine_id: machineId, p_value: value, p_photo_path: photoPathFor(opts) });
    addLocalScore(r, { player_id: state.me?.id, machine_id: machineId, value });
    return r;
  },
  // Log a score for a friend who played the same game.
  async submitScoreFor(playerId, machineId, value, opts = {}) {
    const r = await rpc('submit_score_for', { p_token: getToken(), p_player_id: playerId, p_machine_id: machineId, p_value: value, p_photo_path: photoPathFor(opts) });
    addLocalScore(r, { player_id: playerId, machine_id: machineId, value, logged_by: state.me?.id });
    return r;
  },
  // Results email: opt in (with consent) or out. Never readable back; whoami says has_email.
  // Joined from an invite link: link the invite (and save its email for results if they consented).
  claimInvite: (invite, consent) => rpc('claim_invite', { p_token: getToken(), p_invite: invite, p_consent: !!consent })
    .then(async () => {
      rememberTicket(state.me?.id, invite);
      if (consent && state.me) set({ me: { ...state.me, has_email: true } });
      await refreshAll();
    }),
  // The sign-up link (invite token) of the ticket I joined with, for the ME tab's
  // "Add someone to your ticket". Asks the server (my_ticket, migration 0015/0017); if that
  // function isn't there, falls back to the ticket this phone remembers. null = no ticket.
  async myTicket() {
    const pid = state.me?.id;
    const { data, error } = await sb.rpc('my_ticket', { p_token: getToken() });
    if (error) return rememberedTicket(pid);
    if (data) rememberTicket(pid, data);
    return data || null;
  },
  // Who's on a ticket: { players: [names], player_ids: [ids] (once migration 0015 is in) }.
  ticketInfo: invite => rpc('invite_info', { p_invite: invite }),
  // A partner's email onto their own guest row (so hosts see it and reminders reach them).
  // Quietly does nothing if they're not a partner, or before migration 0015 is in.
  setTicketEmail: email => sb.rpc('set_ticket_email', { p_token: getToken(), p_email: email })
    .then(({ data }) => data ?? null, () => null),
  // Couples' tickets: which person on the ticket I am ("Cina Boitnott"). ticketName: the corrected ticket
  // name when they fixed a misspelling. Quiet no-op before migration 0016.
  setTicketWho: (who, ticketName = null) => sb.rpc('set_ticket_who', { p_token: getToken(), p_who: who, p_ticket_name: ticketName })
    .then(({ data }) => data ?? null, () => null),
  // Joined without a ticket link? If their email is on the guest list, link them to that guest.
  // Quietly does nothing otherwise (or before migration 0016 is in).
  linkByEmail: email => sb.rpc('link_by_email', { p_token: getToken(), p_email: email })
    .then(({ data }) => data ?? null, () => null),
  async setMyEmail(email, consent) {
    await rpc('set_my_email', { p_token: getToken(), p_email: email || null, p_consent: !!consent });
    if (state.me) set({ me: { ...state.me, has_email: !!(consent && email) } });
  },
  async undoScore(scoreId) {
    await rpc('undo_score', { p_token: getToken(), p_score_id: scoreId });
    set({ allScores: state.allScores.map(s => (s.id === scoreId ? { ...s, voided: true } : s)) });
  },
  // Save my AI 8-bit portrait (the original selfie is kept server-side).
  async setMyAvatar(dataUrl) {
    await rpc('set_my_avatar', { p_token: getToken(), p_avatar: dataUrl });
    patchAvatar(state.me?.id, dataUrl);
  },
  // Enter a specific tournament (or the active one) with my permanent player account.
  async enterEvent(eventId = null) {
    const evId = eventId ?? state.party?.current_event_id;
    if (!evId || !state.me) return;
    const { error } = await sb.rpc('enter_event', { p_token: getToken(), p_event_id: evId });
    if (error && evId === state.party?.current_event_id) {
      await rpc('enter_current_event', { p_token: getToken() });
    } else if (error) throw new Error(error.message);
    if (!state.entries.some(x => x.event_id === evId && x.player_id === state.me?.id)) {
      set({ entries: [...state.entries, { event_id: evId, player_id: state.me.id }] });
    }
  },
};

// Ticket links this phone has used, per player (backup for actions.myTicket).
const TICKET_KEY = pid => `pw.ticket.${pid}`;
const rememberTicket = (pid, invite) => { if (pid && invite) safe(() => localStorage.setItem(TICKET_KEY(pid), invite)); };
const rememberedTicket = pid => (pid ? safe(() => localStorage.getItem(TICKET_KEY(pid))) || null : null);

// Optimistic local row for a fresh score. A duplicate never adds a row: the existing one is
// already here (or arrives with the next refresh), so games-played counts stay honest.
function addLocalScore(r, row) {
  if (!r?.score_id || state.allScores.some(s => s.id === r.score_id)) return;
  if (r.duplicate) { refreshAll(); return; }
  set({ allScores: [...state.allScores, { id: r.score_id, voided: false, created_at: new Date().toISOString(), logged_by: null, event_id: state.party?.current_event_id ?? null, ...row }] });
}

// Who already logged this exact score? Same rule as the server (player + machine + value,
// not voided, last 45 min). Lets the assign screen mark rows "already logged" before submit.
export const DEDUPE_MS = 45 * 60 * 1000;
export function findLoggedScore(scores, { playerId = null, machineId, value }) {
  if (!(value > 0)) return null;
  const since = Date.now() - DEDUPE_MS;
  return scores.find(s => !s.voided && s.machine_id === machineId && s.value === value
    && (playerId == null || s.player_id === playerId) && (Date.parse(s.created_at) || 0) > since) || null;
}

function patchAvatar(playerId, avatar) {
  if (!playerId) return;
  set({
    players: state.players.map(p => (p.id === playerId ? { ...p, avatar } : p)),
    ...(state.me?.id === playerId ? { me: { ...state.me, avatar } } : {}),
  });
}

const hostCall = (name, args = {}) => rpc(name, { p_pass: getHostPass(), ...args });
export const host = {
  check: pass => rpc('host_check', { p_pass: pass }),
  setStatus: status => hostCall('host_set_status', { p_status: status }),
  reveal: (active, matchDigits = null) => hostCall('host_reveal', { p_active: active, p_match_digits: matchDigits }),
  voidScore: (id, voided) => hostCall('host_void', { p_score_id: id, p_voided: voided }),
  markReviewed: id => hostCall('host_review', { p_score_id: id }),
  logScanTest: t => hostCall('host_log_scan_test', {
    p_machine_id: t.machineId, p_method: t.method, p_fps: t.fps ?? null, p_conditions: t.conditions || null,
    p_truth: t.truth, p_result: t.result, p_correct: t.correct, p_ms: t.ms, p_photo_path: t.photoPath || null,
  }),
  scanTests: () => hostCall('host_scan_tests'),
  setScanMode: (machineId, mode, fps) => hostCall('host_set_scan_mode', { p_machine_id: machineId, p_mode: mode, p_fps: fps }),
  addScore: (playerId, machineId, value) => hostCall('host_add_score', { p_player_id: playerId, p_machine_id: machineId, p_value: value }),
  resetPin: (playerId, pin) => hostCall('host_reset_pin', { p_player_id: playerId, p_new_pin: pin }),
  removePlayer: playerId => hostCall('host_remove_player', { p_player_id: playerId }),
  wipe: confirm => hostCall('host_wipe', { p_confirm: confirm }),
  clearScores: confirm => hostCall('host_clear_scores', { p_confirm: confirm }),
  setLights: ({ enabled = null, dryRun = null, zones = null, music = null } = {}) =>
    hostCall('host_set_lights', { p_enabled: enabled, p_dry_run: dryRun, p_zones: zones, p_music: music }).then(r => { refreshLights(); return r; }),
  saveEvent: ({ id = null, name, startsOn = null, machineIds, makeCurrent = false }) =>
    hostCall('host_save_event', { p_event_id: id, p_name: name, p_starts_on: startsOn || null, p_machine_ids: machineIds, p_make_current: makeCurrent }),
  setCurrentEvent: id => hostCall('host_set_current_event', { p_event_id: id }),
  deleteEvent: (id, confirm) => hostCall('host_delete_event', { p_event_id: id, p_confirm: confirm }),
  setEntry: async (eventId, playerId, entered = true) => {
    await hostCall('host_set_entry', { p_event_id: eventId, p_player_id: playerId, p_in: entered });
    const next = entered
      ? (state.entries.some(x => x.event_id === eventId && x.player_id === playerId) ? state.entries : [...state.entries, { event_id: eventId, player_id: playerId }])
      : state.entries.filter(x => !(x.event_id === eventId && x.player_id === playerId));
    set({ entries: next });
  },
  addInvites: (eventId, lines, paid = false) => hostCall('host_add_invites', { p_event_id: eventId, p_lines: lines, p_paid: paid }),
  setInvitePaid: (id, paid) => hostCall('host_set_invite_paid', { p_invite_id: id, p_paid: paid }),
  saveGuest: (eventId, g) => hostCall('host_save_guest', {
    p_event_id: eventId, p_id: g.id ?? null, p_name: g.name || null, p_email: g.email, p_phone: g.phone || null,
    p_party_size: Number(g.party_size) || 1, p_paid: !!g.paid, p_rsvp: g.rsvp || null, p_notes: g.notes || null,
  }),
  setTicketUrl: (eventId, url) => hostCall('host_set_ticket_url', { p_event_id: eventId, p_url: url }),
  invites: eventId => hostCall('host_invites', { p_event_id: eventId }),
  // Players who joined without a ticket link. null = the server function isn't installed yet.
  walkins: eventId => hostCall('host_walkins', { p_event_id: eventId }).catch(() => null),
  // Put a walk-in on a guest's ticket (takes the row if it's free, otherwise joins under it).
  linkPlayer: (eventId, playerId, inviteId) => hostCall('host_link_player', { p_event_id: eventId, p_player_id: playerId, p_invite_id: inviteId }),
  removeInvite: id => hostCall('host_remove_invite', { p_invite_id: id }),
  // kind: 'invite' | 'reminder' | 'update'; audience: 'new' | 'not_joined' | 'all'; testTo: one sample to that address
  async emailRoster({ eventId, kind, audience, subject, message, testTo, inviteIds }) {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/email-roster`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
      body: JSON.stringify({ pass: getHostPass(), event_id: eventId, kind, audience, subject: subject || null, message: message || '', test_to: testTo || null, invite_ids: inviteIds || null }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(out.error || "Couldn't send.");
    return out;
  },
  async setAvatar(playerId, dataUrl) {
    await hostCall('host_set_avatar', { p_player_id: playerId, p_avatar: dataUrl });
    patchAvatar(playerId, dataUrl);
  },
};

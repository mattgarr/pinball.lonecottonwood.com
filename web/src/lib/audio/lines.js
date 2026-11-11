// What the announcer says, written the way a person says it out loud. Pure (tested in lines.test.js).
//   clockText(pack, clip)        a countdown / phase line (clockLines.json, one of 2-3 variants)
//   momentText(pack, moment)     a live TV moment: a machine record, a new #1, someone ranked, a games
//                                milestone, people joining
//   revealText(pack, slide)      the reveal: the intro, each winner, the finale
// Numbers, names and machines are spelled for speech: 3,215,440 → "three point two million".
import CLOCK from './clockLines.json';
import PRONOUNCE from './pronounce.json';

export const PACKS = ['british', 'hype', 'ship', '8bit', 'newsreel', 'dj', 'wedding', 'drivetime', 'countdown', 'aerobics', 'rumble'];
const packOf = p => (PACKS.includes(p) ? p : 'british');

// ---------- speech-friendly words ----------
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function under1000(n) {
  const h = Math.floor(n / 100), r = n % 100;
  const rest = r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : '');
  if (!h) return rest;
  return `${ONES[h]} hundred${r ? ` ${rest}` : ''}`;
}
// Whole numbers up to the billions, in words: 1205 → "one thousand two hundred five".
export function numberWords(n) {
  n = Math.round(Math.abs(Number(n) || 0));
  if (n < 1000) return under1000(n);
  const parts = [];
  for (const [v, w] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) {
    if (n >= v) { parts.push(`${numberWords(Math.floor(n / v))} ${w}`); n %= v; }
  }
  if (n) parts.push(under1000(n));
  return parts.join(' ');
}
const DIGIT = d => (d === '0' ? 'oh' : ONES[Number(d)]);
// A big number the way an announcer rounds it: "three point two million", "forty-five thousand".
export function speakScore(v) {
  v = Math.round(Math.abs(Number(v) || 0));
  const dec = (x, places) => {
    const s = x.toFixed(places).replace(/\.?0+$/, '');
    const [whole, frac] = s.split('.');
    return `${numberWords(Number(whole))}${frac ? ` point ${[...frac].map(DIGIT).join(' ')}` : ''}`;
  };
  if (v >= 1e9) return `${dec(v / 1e9, v < 1e10 ? 2 : 1)} billion`;
  if (v >= 1e6) return `${dec(v / 1e6, v < 1e8 ? 1 : 0)} million`;
  if (v >= 1e4) return `${numberWords(Math.round(v / 1000))} thousand`;
  if (v >= 1000) return numberWords(Math.round(v / 10) * 10);
  return numberWords(v);
}
const ORD = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
// 1 → "first", 22 → "twenty-second", 40 → "fortieth".
export function ordinalWords(n) {
  const w = numberWords(n);
  return w.replace(/([a-z]+)$/, last => ORD[last] || (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`));
}
// The Match number: 0 → "double zero", 40 → "forty".
export const matchWords = d => (Number(d) === 0 ? 'double zero' : numberWords(Number(d)));

// A nickname, sayable: no emoji or symbols, no shouting caps, not too long.
export function speakName(name) {
  let s = String(name ?? '').normalize('NFKC')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️]/gu, ' ')
    .replace(/[_~*^|<>[\]{}#=+\\/]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (s.length > 24) s = s.slice(0, 24).replace(/\s+\S*$/, '');
  return s || 'a mystery player';
}
// A machine name, sayable: "Dungeons & Dragons" → "Dungeons and Dragons".
export const speakMachine = m => String(m?.name ?? m ?? 'the machine').replace(/&/g, 'and').replace(/\s+/g, ' ').trim();
// A list of names: "Ann", "Ann and Bob", "Ann, Bob and Cy", "Ann, Bob, Cy and three more".
export function nameList(names, max = 3) {
  const n = names.map(speakName);
  if (n.length <= 1) return n[0] || '';
  if (n.length <= max) return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
  return `${n.slice(0, max).join(', ')} and ${numberWords(n.length - max)} more`;
}

// Pick one of several ways to say it (rand: injectable for tests).
export const pick = (list, rand = Math.random) => (Array.isArray(list) ? list[Math.floor(rand() * list.length) % list.length] : list);
const fill = (t, p) => t.replace(/\{(\w+)\}/g, (_, k) => (p[k] ?? ''));
// Capital letters at the start of each sentence (a spoken number can start one).
const cap = s => (s.charAt(0).toUpperCase() + s.slice(1)).replace(/([.!?]\s+)([a-z])/g, (_, a, b) => a + b.toUpperCase());

// ---------- countdowns and phases ----------
export const CLOCK_LINES = CLOCK;
export const CLIPS = Object.keys(CLOCK.british);
export function clockVariants(pack, clip) { return CLOCK[packOf(pack)]?.[clip] || CLOCK.british[clip] || []; }
export function clockText(pack, clip, rand) { return pick(clockVariants(pack, clip), rand) || null; }

// ---------- live moments ----------
const MOMENTS = {
  british: {
    record: ['A new {machine} record. {name}, with {score}.', "{name} has just taken the {machine} record. {score}. Rather good."],
    leader: ['We have a new leader. {name}.', '{name} takes the top spot. Well played.'],
    ranked: ['{name} joins the rankings, in {ordinal} place.', "{name}'s on the board. {Ordinal} place, no less."],
    milestone: ["That's {count} games played tonight.", '{count} games so far. Splendid.'],
    join: ['Welcome to the garage, {names}.', 'Good evening, {names}. Welcome.'],
  },
  hype: {
    record: ['New {machine} record! {name} just put up {score}!', 'Whoa! {name} owns {machine} now! {score}!'],
    leader: ['New number one! {name} takes the lead!', "There's a new top dog, and it's {name}!"],
    ranked: ["{name} is on the board! {Ordinal} place!", '{name} cracks the rankings in {ordinal}!'],
    milestone: ['{count} games tonight! Keep them coming!', "That's {count} games! Let's go!"],
    join: ['Welcome in, {names}!', '{names} just joined! Let\'s go!'],
  },
  ship: {
    record: ['A new record on {machine}. {name} scored {score}.', '{name} now holds the {machine} record, with {score}. Impressive.'],
    leader: ['{name} is now in first place.', 'The standings have changed. {name} now leads.'],
    ranked: ['{name} has joined the rankings, in {ordinal} place.', '{name} is now ranked {ordinal}.'],
    milestone: ['{count} games have been played tonight.', "We've reached {count} games."],
    join: ['Welcome, {names}.', 'Hello, {names}. Welcome aboard.'],
  },
  '8bit': {
    record: ['New high score detected. {machine}. {name}. {score}.', 'Alert! {name} is the new {machine} record holder. {score}.'],
    leader: ['New player one: {name}.', 'Leader changed. {name} is number one.'],
    ranked: ['{name} has entered the rankings. Position: {ordinal}.', 'Ranking update. {name}, {ordinal}.'],
    milestone: ['Game counter: {count}.', '{count} games played. Beep boop.'],
    join: ['New player detected: {names}. Welcome.', 'Welcome, {names}.'],
  },
  newsreel: {
    record: ['Stop the presses! A new {machine} record for {name}, {score}!', 'Extra, extra! {name} sets the {machine} record with {score}!'],
    leader: ['A new leader, folks! {name} takes the top spot!', '{name} surges into first place!'],
    ranked: ['{name} enters the rankings in {ordinal} place, folks!', "And it's {name}, debuting in {ordinal}!"],
    milestone: ['{count} games played, folks, and counting!', "That's {count} games tonight!"],
    join: ['And joining us tonight, {names}!', 'A warm welcome to {names}!'],
  },
  dj: {
    record: ['Whoa-ho-ho! New {machine} record! {name} just put up {score}! Let\'s hear it!', 'Give it up for {name}! {score} on {machine}! New record!'],
    leader: ['New number one! Woo! {name}, come on down!', "Look who's on top! It's {name}! Big round of applause!"],
    ranked: ['{name} is on the board in {ordinal} place! Woo!', 'Hey, {name} just cracked the rankings! {Ordinal} place!'],
    milestone: ['{count} games tonight! You people are machines!', "{count} games! That's a lot of quarters, if we were using quarters!"],
    join: ['Give it up for {names}! Welcome to the party!', 'Hey hey, {names} in the house!'],
  },
  wedding: {
    record: ['Whoa! New {machine} record! {name} just put up {score}! Give it up!', "Somebody stop {name}! {score} on {machine}! That's a new record!"],
    leader: ["We've got a new number one! {name}, take a bow!", "{name} is on top! Everybody, raise your glasses!"],
    ranked: ['{name} is on the board in {ordinal} place! Woo!', '{name} just made the rankings! {Ordinal} place!'],
    milestone: ['{count} games tonight! This party is on fire!', "That's {count} games, folks! Keep it going!"],
    join: ['Everybody welcome {names} to the party!', 'Look who just walked in! {names}!'],
  },
  drivetime: {
    record: ['Breaking news! {name} just set the {machine} record with {score}!', 'New {machine} record, folks! {name}, {score}! Unbelievable!'],
    leader: ["There's a new number one on the charts! It's {name}!", "{name} takes over the top spot! Let's hear it!"],
    ranked: ['{name} debuts on the chart at number {rankWords}!', '{name} cracks the rankings in {ordinal}!'],
    milestone: ["That's {count} games tonight, and counting!", '{count} games so far! Stay tuned!'],
    join: ['Shout out to {names}! Welcome to the show!', 'Welcome in, {names}! Glad you could join us!'],
  },
  countdown: {
    record: ['A brand-new {machine} record. {name}, with {score}.', 'Climbing all the way to the top on {machine}: {name}, with {score}.'],
    leader: ['And a new number one. {name}.', '{name} moves up to number one.'],
    ranked: ['A new entry on the chart. {name}, at number {rankWords}.', '{name} enters the rankings at number {rankWords}.'],
    milestone: ['{count} games played tonight, and the hits keep coming.', "That's {count} games so far."],
    join: ['Welcome, {names}. Glad you could make it.', 'And joining us tonight, {names}.'],
  },
  aerobics: {
    record: ['Whoo! New {machine} record! {name}, {score}! Feel that burn!', 'Look at {name} go! {score} on {machine}! New record!'],
    leader: ['New number one! {name}, you are on fire!', "{name} takes the lead! Way to go!"],
    ranked: ['{name} is on the board! {Ordinal} place! Keep it up!', 'Yes! {name} made the rankings! {Ordinal} place!'],
    milestone: ['{count} games tonight! Great workout, everybody!', "That's {count} games! Keep moving!"],
    join: ['Welcome, {names}! Jump right in!', 'Hi, {names}! So glad you made it!'],
  },
  rumble: {
    record: ['A new {machine} record! {name}! {score}!', 'Unbelievable! {name} destroys the {machine} record with {score}!'],
    leader: ['We have a new champion at the top! {name}!', '{name} takes the number one spot! The crowd goes wild!'],
    ranked: ['Entering the rankings in {ordinal} place: {name}!', '{name} enters the arena in {ordinal} place!'],
    milestone: ['{count} games tonight! And we are just getting started!', "That's {count} games! Incredible!"],
    join: ['A new challenger approaches! {names}!', 'Entering the arena: {names}!'],
  },
};

// moment: { kind: 'record'|'leader'|'ranked'|'milestone'|'join', player, players, machine, score, rank, count }
export function momentText(pack, m, rand) {
  if (!m) return null;
  const t = MOMENTS[packOf(pack)][m.kind];
  if (!t) return null;
  const ordinal = m.rank ? ordinalWords(m.rank) : '';
  const p = {
    name: speakName(m.player?.display_name ?? m.name),
    names: nameList((m.players || (m.player ? [m.player] : [])).map(x => x?.display_name ?? x)),
    machine: speakMachine(m.machine),
    score: m.score != null ? speakScore(m.score) : '',
    ordinal, Ordinal: cap(ordinal), rankWords: m.rank ? numberWords(m.rank) : '',
    count: m.count != null ? numberWords(m.count) : '',
  };
  if (m.kind === 'join' && !p.names) return null;
  return cap(fill(pick(t, rand), p));
}

// ---------- the reveal ----------
const REVEAL = {
  british: {
    intro: "Ladies and gentlemen, it's time for the awards. Twelve prizes tonight.",
    grand: 'Your Grand Champion. {name}! With a rating of {rating}.',
    second: 'In second place, {name}.',
    third: 'And in third place, {name}.',
    machine: 'The {machine} champion: {name}, with {score}.',
    grinder: 'The Grinder, for the most games tonight: {name}, with {plays} games.',
    whiff: 'And The Big Whiff goes to {name}. A humble effort, bravely made.',
    match: 'Match {drawn}. And The Match goes to {name}!',
    empty: 'No winner for {prize} tonight.',
    finale: 'Congratulations to all our winners. Winners, up front for the group photo, please.',
  },
  hype: {
    intro: "It's awards time! Twelve prizes on the line!",
    grand: 'Your Grand Champion! {name}! Rated {rating}!',
    second: 'Second place! {name}!',
    third: 'Third place! {name}!',
    machine: 'Your {machine} champion! {name}, with {score}!',
    grinder: 'The Grinder! {name}, with {plays} games! Absolutely sent it!',
    whiff: "And The Big Whiff goes to {name}! Hey, somebody's gotta do it!",
    match: 'Match {drawn}! The Match goes to {name}!',
    empty: 'Nobody takes {prize} tonight!',
    finale: "That's a wrap! Winners, get up front for the group photo!",
  },
  ship: {
    intro: 'The awards are about to begin. There are twelve prizes tonight.',
    grand: 'Your Grand Champion is {name}. Rating: {rating}. Congratulations.',
    second: 'Second place: {name}.',
    third: 'Third place: {name}.',
    machine: 'The {machine} champion is {name}, with {score}.',
    grinder: 'The Grinder, for the most games played, is {name}. {plays} games.',
    whiff: 'The Big Whiff goes to {name}. I admire your persistence.',
    match: 'The number is {drawn}. The Match goes to {name}.',
    empty: 'There is no winner for {prize} tonight.',
    finale: 'Congratulations to all of our winners. Please come up front for the group photo.',
  },
  '8bit': {
    intro: 'Awards sequence starting. Twelve prizes loaded.',
    grand: 'Grand Champion: {name}. Rating {rating}. Congratulations, human.',
    second: 'Second place: {name}.',
    third: 'Third place: {name}.',
    machine: '{machine} champion: {name}. Score: {score}.',
    grinder: 'The Grinder: {name}. {plays} games played.',
    whiff: 'The Big Whiff: {name}. Error. Error. Just kidding.',
    match: 'Match number: {drawn}. Winner: {name}.',
    empty: 'No winner found for {prize}.',
    finale: 'Awards complete. Winners, report to the front for the group photo.',
  },
  newsreel: {
    intro: 'Ladies and gentlemen, the moment you\'ve been waiting for! The awards!',
    grand: "Your Grand Champion, folks! It's {name}! A rating of {rating}!",
    second: 'In second place, {name}!',
    third: 'And in third, {name}!',
    machine: 'The {machine} champion! {name}, with {score}!',
    grinder: 'The Grinder, folks! {name}, with {plays} games!',
    whiff: 'And The Big Whiff goes to {name}! A gallant effort!',
    match: "Match {drawn}! And The Match goes to {name}!",
    empty: 'No winner for {prize} tonight, folks!',
    finale: 'What a night, folks! Winners, up front for the group photo!',
  },
  dj: {
    intro: "Alllll right, Woodside, it's awards time! Twelve prizes! Let's hear it!",
    grand: 'Your Grand Champion! Give it up for {name}! Rated {rating}!',
    second: 'In second place, {name}! Woo!',
    third: 'And in third place, {name}! Come on, make some noise!',
    machine: 'Your {machine} champion! {name}, with {score}! Let\'s hear it!',
    grinder: 'The Grinder! {name}, with {plays} games! Somebody get this person a chair!',
    whiff: "And The Big Whiff goes to {name}! Hey, at least you had fun, right?",
    match: 'Match {drawn}! The Match goes to {name}! Lucky you!',
    empty: 'Aw, no winner for {prize} tonight!',
    finale: "Give it up for all our winners! Winners, up front for the group photo! Say cheese!",
  },
  wedding: {
    intro: "Alright, everybody! It's time for the awards! Twelve prizes! Let's hear it!",
    grand: 'Your Grand Champion! Put your hands together for {name}! Rated {rating}!',
    second: 'In second place, {name}! Give it up!',
    third: 'And in third place, {name}!',
    machine: 'Your {machine} champion! {name}, with {score}!',
    grinder: 'The Grinder! {name}, with {plays} games! Never left the dance floor!',
    whiff: 'And The Big Whiff goes to {name}! Hey, you still showed up and danced!',
    match: 'Match {drawn}! The Match goes to {name}! Lucky, lucky!',
    empty: 'No winner for {prize} tonight, folks!',
    finale: 'Give it up for all our winners! Winners, up front for the group photo! Everybody say cheese!',
  },
  drivetime: {
    intro: "Alright, Woodside, it's awards time! Twelve prizes, coming up!",
    grand: 'Your Grand Champion! {name}! Rated {rating}!',
    second: 'In second place, {name}!',
    third: 'In third place, {name}!',
    machine: 'Your {machine} champion! {name}, with {score}!',
    grinder: 'The Grinder! {name}, with {plays} games!',
    whiff: 'And The Big Whiff goes to {name}! Hey, there\'s always next year!',
    match: 'Match {drawn}! The Match goes to {name}!',
    empty: 'No winner for {prize} tonight!',
    finale: "That's the show! Winners, up front for the group photo!",
  },
  countdown: {
    intro: 'And now, the countdown to the awards. Twelve prizes tonight.',
    grand: 'And at number one, your Grand Champion. {name}. Rated {rating}.',
    second: 'Coming in at number two, {name}.',
    third: 'At number three, {name}.',
    machine: 'The {machine} champion: {name}, with {score}.',
    grinder: 'The Grinder, for the most games tonight: {name}, with {plays} games.',
    whiff: 'The Big Whiff goes to {name}. A long climb, but a great night.',
    match: 'Match {drawn}. The Match goes to {name}.',
    empty: 'No winner for {prize} tonight.',
    finale: "That's our countdown. Congratulations to all our winners. Winners, up front for the group photo.",
  },
  aerobics: {
    intro: "Okay, everybody! It's awards time! Twelve prizes! Let's go!",
    grand: 'Your Grand Champion! {name}! Rated {rating}! You worked for it!',
    second: 'Second place! {name}! Great job!',
    third: 'Third place! {name}! Way to go!',
    machine: 'Your {machine} champion! {name}, with {score}!',
    grinder: 'The Grinder! {name}, with {plays} games! Now that is endurance!',
    whiff: "And The Big Whiff goes to {name}! Hey, you showed up, and that's what counts!",
    match: 'Match {drawn}! The Match goes to {name}!',
    empty: 'No winner for {prize} tonight!',
    finale: 'Great work, everybody! Winners, up front for the group photo! Big smiles!',
  },
  rumble: {
    intro: 'Ladies and gentlemen! It is time! For the awards! Twelve prizes on the line!',
    grand: 'Your undisputed Grand Champion! {name}! Rated {rating}!',
    second: 'In second place! {name}!',
    third: 'In third place! {name}!',
    machine: 'Your {machine} champion! {name}! With {score}!',
    grinder: 'The Grinder! {name}! {plays} games! An iron will!',
    whiff: 'And The Big Whiff goes to {name}! A true warrior, never gave up!',
    match: 'Match {drawn}! The Match goes to {name}!',
    empty: 'No winner for {prize} tonight!',
    finale: 'Ladies and gentlemen, your winners! Winners, up front for the group photo!',
  },
};

const PRIZE_SPOKEN = { 'GRAND CHAMPION': 'Grand Champion', '2ND PLACE': 'second place', '3RD PLACE': 'third place', 'THE GRINDER': 'The Grinder', 'THE BIG WHIFF': 'The Big Whiff', 'THE MATCH': 'The Match' };
const titleCase = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
// slide: a Reveal.jsx slide ({ label, title, intro, finale, empty, score, machine, plays, spin }).
export function revealText(pack, s) {
  if (!s) return null;
  const t = REVEAL[packOf(pack)];
  const label = String(s.label || '').toUpperCase();
  if (s.intro) return t.intro;
  if (s.finale) return t.finale;
  const prize = PRIZE_SPOKEN[label] || titleCase(label).replace(/&/g, 'and');
  if (s.empty) return fill(t.empty, { prize });
  const p = {
    name: speakName(s.title),
    rating: numberWords(parseInt(String(s.score ?? ''), 10) || 0),
    score: speakScore(s.score),
    machine: speakMachine(s.machine),
    plays: numberWords(s.plays ?? 0),
    drawn: matchWords(s.spin?.drawn ?? 0),
  };
  const key = label === 'GRAND CHAMPION' ? 'grand' : label === '2ND PLACE' ? 'second' : label === '3RD PLACE' ? 'third'
    : label === 'THE GRINDER' ? 'grinder' : label === 'THE BIG WHIFF' ? 'whiff' : label === 'THE MATCH' ? 'match' : s.machine ? 'machine' : null;
  return key ? cap(fill(t[key], p)) : null;
}

// ---------- pronunciation ----------
// Names the voices get wrong, respelled for speech only (pronounce.json, plus the host's extra list).
// extra: "Stacia=Staysha, Theo=Thee-oh" (comma, semicolon or new line between names).
export function parsePronounce(extra) {
  const out = {};
  for (const part of String(extra || '').split(/[\n;,]+/)) {
    const m = /^\s*([^=]+?)\s*=\s*(.+?)\s*$/.exec(part);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function pronounce(text, extra) {
  const map = { ...PRONOUNCE, ...(typeof extra === 'string' ? parsePronounce(extra) : extra || {}) };
  delete map._;
  let s = String(text || '');
  for (const [k, v] of Object.entries(map)) {
    if (!k.trim() || !v) continue;
    s = s.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${esc(k.trim())}(?=$|[^\\p{L}\\p{N}])`, 'giu'), (_, pre) => pre + v);
  }
  return s;
}

// Text for the browser's own speech voice (last resort): no inline vocal tags.
export const plainText = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

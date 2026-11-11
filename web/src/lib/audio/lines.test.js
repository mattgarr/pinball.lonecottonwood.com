import { describe, it, expect } from 'vitest';
import { PACKS, CLIPS, clockText, clockVariants, momentText, nameList, numberWords, ordinalWords, plainText, revealText, speakMachine, speakName, speakScore, matchWords } from './lines.js';

const first = () => 0;

describe('announcer words', () => {
  it('says big scores the way an announcer rounds them', () => {
    expect(speakScore(3_215_440)).toBe('three point two million');
    expect(speakScore(45_210)).toBe('forty-five thousand');
    expect(speakScore(812_000)).toBe('eight hundred twelve thousand');
    expect(speakScore(120_500_000)).toBe('one hundred twenty-one million');
    expect(speakScore(1_040_000_000)).toBe('one point oh four billion');
    expect(speakScore(2_000_000)).toBe('two million');
    expect(speakScore(9_250)).toBe('nine thousand two hundred fifty');
    expect(speakScore(680)).toBe('six hundred eighty');
  });
  it('numbers, places and the Match draw', () => {
    expect(numberWords(1205)).toBe('one thousand two hundred five');
    expect(numberWords(0)).toBe('zero');
    expect(ordinalWords(1)).toBe('first');
    expect(ordinalWords(22)).toBe('twenty-second');
    expect(ordinalWords(40)).toBe('fortieth');
    expect(ordinalWords(12)).toBe('twelfth');
    expect(matchWords(0)).toBe('double zero');
    expect(matchWords(70)).toBe('seventy');
  });
  it('names and machines are sayable', () => {
    expect(speakName('🔥Big Dave🔥')).toBe('Big Dave');
    expect(speakName('xX_Slayer_Xx')).toBe('xX Slayer Xx');
    expect(speakName('🎯')).toBe('a mystery player');
    expect(speakMachine({ name: 'Dungeons & Dragons' })).toBe('Dungeons and Dragons');
    expect(nameList(['Ann'])).toBe('Ann');
    expect(nameList(['Ann', 'Bob'])).toBe('Ann and Bob');
    expect(nameList(['Ann', 'Bob', 'Cy'])).toBe('Ann, Bob and Cy');
    expect(nameList(['Ann', 'Bob', 'Cy', 'Di', 'Ed'])).toBe('Ann, Bob, Cy and two more');
  });
});

describe('announcer lines', () => {
  it('every pack has every countdown line, with 2+ ways to say each', () => {
    expect(PACKS).toHaveLength(11);
    expect(CLIPS).toHaveLength(17);
    for (const p of PACKS) for (const c of CLIPS) {
      expect(clockVariants(p, c).length).toBeGreaterThanOrEqual(2);
      expect(clockText(p, c)).toBeTruthy();
    }
  });
  it('no computer-speak', () => {
    const all = [];
    for (const p of PACKS) for (const c of CLIPS) all.push(...clockVariants(p, c));
    for (const p of PACKS) for (const kind of ['record', 'leader', 'ranked', 'milestone', 'join']) {
      all.push(momentText(p, { kind, player: { display_name: 'Ann' }, machine: { name: 'Fathom' }, score: 3e6, rank: 4, count: 100 }, first));
    }
    for (const line of all) expect(line).not.toMatch(/rankings unlocked|end of tournament|scores are locked|prize \d|\{|\}|undefined|null|NaN/i);
  });
  it('a machine record with the name and the score in words', () => {
    const t = momentText('hype', { kind: 'record', player: { display_name: 'Big Dave 🎱' }, machine: { name: 'Fathom' }, score: 3_215_440 }, first);
    expect(t).toBe('New Fathom record! Big Dave just put up three point two million!');
    expect(momentText('dj', { kind: 'join', players: [{ display_name: 'Ann' }, { display_name: 'Bob' }] }, first)).toBe('Give it up for Ann and Bob! Welcome to the party!');
    expect(momentText('british', { kind: 'join', players: [] })).toBeNull();
    expect(momentText('british', { kind: 'nope' })).toBeNull();
  });
  it('reveal lines for each kind of slide', () => {
    expect(revealText('british', { label: 'GRAND CHAMPION', title: 'Ann', score: '92/100' })).toBe('Your Grand Champion. Ann! With a rating of ninety-two.');
    expect(revealText('british', { label: 'FATHOM CHAMPION', title: 'Bob', score: 4_200_000, machine: { name: 'Fathom' } })).toBe('The Fathom champion: Bob, with four point two million.');
    expect(revealText('ship', { label: 'THE MATCH', title: 'Cy', spin: { drawn: 0 } })).toBe('The number is double zero. The Match goes to Cy.');
    expect(revealText('british', { label: 'THE GRINDER', title: 'Di', plays: 14 })).toMatch(/fourteen games/);
    expect(revealText('british', { label: '2ND PLACE', empty: true })).toBe('No winner for second place tonight.');
    expect(revealText('british', { label: 'DUNGEONS & DRAGONS CHAMPION', empty: true })).toBe('No winner for Dungeons and Dragons Champion tonight.');
    expect(revealText('dj', { intro: true })).toMatch(/awards time/);
    for (const p of PACKS) expect(revealText(p, { finale: true })).toMatch(/photo/);
  });
  it('the browser fallback voice never reads tags', () => {
    expect(plainText('Wow <laugh> nice')).toBe('Wow nice');
  });
});

describe('pronunciation', () => {
  it('respells names for speech only, whole words, any case', async () => {
    const { pronounce, parsePronounce } = await import('./lines.js');
    expect(pronounce('Give it up for Stacia and Theo!')).toBe('Give it up for Stay-sha and Theo!');
    expect(pronounce('STACIA wins')).toBe('Stay-sha wins');
    expect(pronounce('Anastacia wins')).toBe('Anastacia wins'); // not inside other names
    expect(pronounce('Theo wins', 'Theo=Thee-oh; Bo = Bow')).toBe('Thee-oh wins');
    expect(parsePronounce('A=B, C = D\nE=F,junk')).toEqual({ A: 'B', C: 'D', E: 'F' });
  });
  it('every voice has every line', async () => {
    const { momentText, revealText } = await import('./lines.js');
    for (const p of PACKS) {
      for (const kind of ['record', 'leader', 'ranked', 'milestone', 'join']) expect(momentText(p, { kind, player: { display_name: 'Ann' }, players: [{ display_name: 'Ann' }], machine: { name: 'Fathom' }, score: 3e6, rank: 4, count: 100 })).toMatch(/^[A-Z][^{}]*$/);
      for (const label of ['GRAND CHAMPION', '2ND PLACE', '3RD PLACE', 'THE GRINDER', 'THE BIG WHIFF', 'THE MATCH']) expect(revealText(p, { label, title: 'Ann', score: '90/100', plays: 3, spin: { drawn: 10 } })).toMatch(/Ann/);
    }
  });
});

import { describe, it, expect } from 'vitest';
import { isOpenToVisitors, normPass, partyUrl } from './access.js';

describe('party access helpers', () => {
  it('normalizes passwords like the server', () => {
    expect(normPass('Silver-Jackpot 42')).toBe('silverjackpot42');
    expect(normPass('  SILVER JACKPOT 42 ')).toBe('silverjackpot42');
    expect(normPass(null)).toBe('');
  });
  it('builds party QR addresses with the key', () => {
    expect(partyUrl('/', 'abc123')).toMatch(/\/\?k=abc123$/);
    expect(partyUrl('/machine/3', 'abc')).toMatch(/\/machine\/3\?k=abc$/);
    expect(partyUrl('/join?x=1', 'abc')).toMatch(/\/join\?x=1&k=abc$/);
    expect(partyUrl('/', null)).toMatch(/\/$/);
  });
  it('lets visitors open only host pages, rejoin and ticket links', () => {
    expect(isOpenToVisitors('/host')).toBe(true);
    expect(isOpenToVisitors('/host/guests')).toBe(true);
    expect(isOpenToVisitors('/rejoin')).toBe(true);
    expect(isOpenToVisitors('/join', '?invite=abc')).toBe(true);
    expect(isOpenToVisitors('/join')).toBe(false);
    expect(isOpenToVisitors('/')).toBe(false);
    expect(isOpenToVisitors('/ranks')).toBe(false);
    expect(isOpenToVisitors('/machine/2')).toBe(false);
    expect(isOpenToVisitors('/about')).toBe(false);
    expect(isOpenToVisitors('/hostile')).toBe(false);
  });
});

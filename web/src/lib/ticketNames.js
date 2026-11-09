// Who's on a ticket, from the guest row's name.
//   "Chris and Cina Boitnott"      -> [{ first: 'Chris', full: 'Chris Boitnott' }, { first: 'Cina', full: 'Cina Boitnott' }]
//   "Chad Heaton & Meghan Cress"   -> [{ first: 'Chad', full: 'Chad Heaton' }, { first: 'Meghan', full: 'Meghan Cress' }]
//   "Matt Garr"                    -> [{ first: 'Matt', full: 'Matt Garr' }]
export function ticketPeople(name) {
  const parts = (name || '').split(/\s+(?:and|&)\s+|\s*,\s*/i).map(s => s.trim()).filter(Boolean);
  const last = (parts[parts.length - 1] || '').split(/\s+/);
  const surname = last.length > 1 ? last[last.length - 1] : '';
  return parts.map(p => {
    const words = p.split(/\s+/);
    return { first: words[0], full: words.length > 1 || !surname ? p : `${p} ${surname}` };
  });
}

// "Chris", "Chris and Cina", "Ann, Bob and Cy"
export function joinNames(names) {
  if (!names.length) return '';
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// The people on a ticket who haven't signed up yet (taken = the `who` names already in).
export function stillToJoin(name, taken = []) {
  const done = new Set(taken.map(t => (t || '').toLowerCase()));
  return ticketPeople(name).filter(p => !done.has(p.full.toLowerCase()));
}

// A guest fixed the spelling of their name: the corrected ticket name, or null if nothing to change.
//   fixTicketName('Chris and Cina Boitnott', 'Cina Boitnott', 'Gina Boitnott') -> 'Chris and Gina Boitnott'
// Picking another person who's already on the ticket isn't a spelling fix (returns null).
export function fixTicketName(name, oldFull, newFull) {
  const next = (newFull || '').trim().replace(/\s+/g, ' ');
  if (!name || !oldFull || !next || oldFull === next) return null;
  if (ticketPeople(name).some(p => p.full.toLowerCase() === next.toLowerCase())) return null;
  const was = oldFull.split(/\s+/), now = next.split(/\s+/);
  let out = name;
  was.forEach((w, i) => {
    if (now[i] && now[i] !== w) out = out.replace(new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}])`, 'u'), `$1${now[i]}`);
  });
  return out !== name ? out : null;
}

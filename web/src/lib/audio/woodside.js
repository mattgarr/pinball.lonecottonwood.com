// Local color for the announce booth: a small, fact-checked bank of Woodside / Silicon Valley material.
// The booth gets two or three of these per bit, rotated so nothing repeats within the night, and weaves at
// most one into a joke or a roast ("that score's lower than Woodside's sidewalk count"). Affectionate,
// PG, about the town and the tech scene, never about private people.
//
// kind: 'fact' (checked, source below), 'observation' (light, no numbers, no claims), 'jargon'.
// Checked Nov 10, 2026. Matt's "$60K parking spot at a school auction" could NOT be confirmed anywhere
// (Woodside School Foundation auction pages, the Almanac, general search), so it's only a vague joke here.
export const LOCAL_BANK = [
  // https://www.oag.ca.gov/news/press-releases/attorney-general-bonta-memorandum-declaring-woodside-mountain-lion-sanctuary
  // https://www.nbcbayarea.com/news/local/making-it-in-the-bay/woodside-reverses-housing-decision-after-ag-denies-mountain-lion-sanctuary-status/2803141/
  { id: 'lions', kind: 'fact', text: 'In 2022 Woodside declared the whole town mountain lion habitat to dodge SB 9, the state law that allows up to four homes on a single-family lot; the Attorney General said houses are not habitat, and the town backed down within days.' },
  // https://woodsideca.gov/274/Keeping-Horses-in-Woodside
  { id: 'trails', kind: 'fact', text: 'The town of Woodside\'s own website boasts "Trails, not sidewalks. Hitching posts, not stop lights."' },
  // https://www.almanacnews.com/woodside/2024/09/27/woodsides-day-of-the-horse-20-years-and-counting/
  { id: 'horseday', kind: 'fact', text: 'Since 2004, Woodside has officially celebrated "The Day of the Horse" every October, with a trail ride and a costume contest for riders.' },
  // https://en.wikipedia.org/wiki/Woodside,_California and https://woodsideca.gov/274/Keeping-Horses-in-Woodside
  { id: 'horses', kind: 'fact', text: 'Lots of Woodside residents keep horses, and the town maintains its own network of horse trails.' },
  // https://en.wikipedia.org/wiki/Buck%27s_of_Woodside
  { id: 'bucks', kind: 'fact', text: 'Buck\'s of Woodside, the breakfast spot opened in 1991, is where founders from Netscape, PayPal, Hotmail and Tesla took early meetings with investors.' },
  // https://en.wikipedia.org/wiki/Buck%27s_of_Woodside
  { id: 'bucksdecor', kind: 'fact', text: 'Buck\'s decor includes a talking buffalo head and a Statue of Liberty holding an ice cream sundae.' },
  // https://en.wikipedia.org/wiki/Sand_Hill_Road
  { id: 'sandhill', kind: 'fact', text: 'Sand Hill Road, the venture capital street that runs out to Woodside, has had the most expensive office space in the country, around one hundred twenty-eight dollars a square foot a year.' },
  // https://www.zillow.com/woodside-ca/home-values/ and https://en.wikipedia.org/wiki/Woodside,_California
  { id: 'prices', kind: 'fact', text: 'A typical Woodside home is worth about four million dollars, and median sale prices have topped five million.' },
  // https://en.wikipedia.org/wiki/Woodside,_California (2020 census)
  { id: 'size', kind: 'fact', text: 'Woodside has about five thousand three hundred people spread over eleven and a half square miles.' },
  // https://en.wikipedia.org/wiki/Woodside,_California
  { id: 'filoli', kind: 'fact', text: 'Filoli, just up the road, has a fifty-four thousand square foot mansion and sixteen acres of formal gardens.' },
  // https://en.wikipedia.org/wiki/Woodside,_California
  { id: 'founded', kind: 'fact', text: 'Woodside got its name in 1849 from a parcel of timberland, and only incorporated as a town in 1956.' },
  // Observations: light, no numbers, no claims about anyone.
  { id: 'traffic', kind: 'observation', text: 'On Woodside roads, a Tesla, a Rivian and a horse trailer can all be stuck behind a cyclist at the same time.' },
  { id: 'teardown', kind: 'observation', text: 'In Woodside, a perfectly nice house can be called a teardown.' },
  { id: 'parking', kind: 'observation', text: 'Around here, even a good parking spot at a school fundraiser can start a bidding war.' },
  { id: 'lionsnow', kind: 'observation', text: 'Mountain lions really do pass through the hills around Woodside now and then.' },
  // Startup jargon to roast with.
  { id: 'pivot', kind: 'jargon', text: 'Startup talk: a bad game is "a pivot", a comeback is "a Series B", a drain is "burning runway".' },
  { id: 'unicorn', kind: 'jargon', text: 'Startup talk: a huge score is "a unicorn", "ten-x", or "disrupting the leaderboard".' },
  { id: 'vc', kind: 'jargon', text: 'Startup talk: "we\'re pre-revenue", "let\'s take this offline", "circle back", "that\'s a hard pass", "term sheet".' },
];

// Two or three items for the next bit, none used earlier tonight (until the bank runs out, then it starts over).
export function pickLocal(used = new Set(), n = 2, rand = Math.random) {
  let pool = LOCAL_BANK.filter(x => !used.has(x.id));
  if (pool.length < n) { used.clear(); pool = [...LOCAL_BANK]; }
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  for (const x of out) used.add(x.id);
  return out;
}

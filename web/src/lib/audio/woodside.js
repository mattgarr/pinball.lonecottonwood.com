// Local color for the announce booth: Woodside / Silicon Valley material, so the whole room laughs at itself.
// Affectionate with some bite, PG, about the town, the money and the tech scene as a type, never about a
// private person. Each bit gets two items not used earlier tonight and works one in, ideally as the punchline
// of a roast ("that score's lower than Woodside's sidewalk count").
//
// kind: 'fact' (checked; source above it), 'host' (Matt, the host, confirmed it from his own knowledge),
// 'observation' (a light stereotype, no numbers, no claims about anyone), 'jargon'.
// `text` is the fact; `bit` is a joke angle the hosts can use or riff on.
// Checked Nov 10, 2026.
export const LOCAL_BANK = [
  // Source: Matt, host (Woodside School auction).
  { id: 'parking', kind: 'host', text: 'At the Woodside school auction, people really pay around sixty thousand dollars for a parking spot.', bit: 'Sixty grand for a parking spot, and it doesn\'t even come with a charger.' },
  // Source: Matt, host.
  { id: 'jet', kind: 'host', text: 'Woodside school auction items like a private jet trip to someone\'s house in Aspen go for over a hundred thousand dollars.', bit: 'Other schools sell cookie dough; Woodside sells jet time to Aspen.' },
  // https://www.donationmatch.com (WSF Grand Auction 2024 "Viva Las Vegas" listing: $1,000,000 goal); https://www.woodsideschool.us/Foundation/Grand-Auction/index.html (held every spring since 1984)
  { id: 'auctiongoal', kind: 'fact', text: 'The Woodside elementary school auction, a spring tradition since 1984, set a one-million-dollar goal in 2024, for a school of about four hundred kids.', bit: 'That\'s a bake sale with a term sheet.' },
  // https://www.almanacnews.com/news/2015/12/01/woodside-elementary-is-a-district-with-resources/
  { id: 'foundation', kind: 'fact', text: 'The Woodside school foundation has covered about a fifth of the school district\'s budget.', bit: 'The PTA here has a bigger budget than some startups.' },
  // https://www.oag.ca.gov/news/press-releases/attorney-general-bonta-memorandum-declaring-woodside-mountain-lion-sanctuary
  // https://www.nbcbayarea.com/news/local/making-it-in-the-bay/woodside-reverses-housing-decision-after-ag-denies-mountain-lion-sanctuary-status/2803141/
  { id: 'lions', kind: 'fact', text: 'In 2022 Woodside declared the entire town mountain lion habitat to dodge SB 9, the state law allowing up to four homes on a single-family lot. The Attorney General said a house is not habitat, and the town backed down within days.', bit: 'Woodside will protect a mountain lion before it lets in a duplex.' },
  // https://woodsideca.gov/274/Keeping-Horses-in-Woodside
  { id: 'trails', kind: 'fact', text: 'The town\'s own website says "Trails, not sidewalks. Hitching posts, not stop lights."', bit: 'No sidewalks, no stoplights, but plenty of hitching posts for your horse.' },
  // https://www.almanacnews.com/woodside/2025/09/02/woodside-holds-first-committee-meeting-for-town-center-plan-update/
  { id: 'measurej', kind: 'fact', text: 'Woodside\'s 1988 Measure J keeps "commercial creep" out of town, and consultants still list a lack of streetlights and crosswalks downtown.', bit: 'A crosswalk here needs a ballot measure.' },
  // https://www.almanacnews.com/news/print/2013/10/30/woodside-council-acquiesces-to-complaints-about-ideas-for-downtowns-future
  { id: 'downtown', kind: 'fact', text: 'In 2013 more than seventy-five residents packed a Woodside council meeting to fight ideas for changing downtown, and the council backed off.', bit: 'Seventy-five people showed up to stop a sidewalk.' },
  // https://www.almanacnews.com/woodside/2024/09/27/woodsides-day-of-the-horse-20-years-and-counting/
  { id: 'horseday', kind: 'fact', text: 'Since 2004 Woodside has officially celebrated "The Day of the Horse" every October, with a costume contest for riders.', bit: 'The horses here have a holiday. The nannies do not.' },
  // https://en.wikipedia.org/wiki/Woodside,_California ; https://woodsideca.gov/274/Keeping-Horses-in-Woodside
  { id: 'horses', kind: 'fact', text: 'Lots of Woodside residents keep horses, and the town maintains its own network of horse trails.', bit: 'In Woodside the horse has better trails than the kids have sidewalks.' },
  // https://en.wikipedia.org/wiki/Buck%27s_of_Woodside
  { id: 'bucks', kind: 'fact', text: 'Buck\'s of Woodside, opened in 1991, is the breakfast spot where Netscape, PayPal, Hotmail and Tesla founders took early meetings with investors.', bit: 'At Buck\'s, the pancakes come with a term sheet.' },
  // https://en.wikipedia.org/wiki/Buck%27s_of_Woodside
  { id: 'bucksdecor', kind: 'fact', text: 'Buck\'s decor includes a talking buffalo head and a Statue of Liberty holding an ice cream sundae.', bit: 'Billion-dollar deals, made under a talking buffalo head.' },
  // https://en.wikipedia.org/wiki/Sand_Hill_Road
  { id: 'sandhill', kind: 'fact', text: 'Sand Hill Road, the venture capital street that runs out to Woodside, has had the most expensive office space in the country, around one hundred twenty-eight dollars a square foot a year.', bit: 'A desk on Sand Hill costs more than a car.' },
  // https://www.zillow.com/woodside-ca/home-values/ ; https://en.wikipedia.org/wiki/Woodside,_California
  { id: 'prices', kind: 'fact', text: 'A typical Woodside home is worth about four million dollars, and median sale prices have topped five million.', bit: 'A four-million-dollar starter home. With a well.' },
  // https://www.inman.com/2016/01/13/findthehome-4-san-mateo-county-cities-ranked-among-top-5/
  { id: 'fifth', kind: 'fact', text: 'A 2016 ranking put Woodside only fifth among the richest cities in America, behind Portola Valley and Atherton.', bit: 'Only fifth richest. Woodside is basically roughing it.' },
  // https://en.wikipedia.org/wiki/Woodside,_California (2020 census)
  { id: 'size', kind: 'fact', text: 'Woodside has about five thousand three hundred people spread over eleven and a half square miles.', bit: 'That\'s more acres per person than parking spaces at the auction.' },
  // https://en.wikipedia.org/wiki/Woodside,_California
  { id: 'filoli', kind: 'fact', text: 'Filoli, just up the road, has a fifty-four thousand square foot mansion and sixteen acres of formal gardens.', bit: 'Around here Filoli is what people call "a little cramped".' },
  // Observations: light stereotypes of the type, no numbers, nobody in particular.
  { id: 'traffic', kind: 'observation', text: 'On Woodside roads a Tesla, a Rivian, a G-Wagon and a horse trailer can all be stuck behind one cyclist.', bit: 'Rush hour in Woodside is four EVs and a horse.' },
  { id: 'teardown', kind: 'observation', text: 'In Woodside a perfectly nice three-million-dollar house gets called a teardown.', bit: 'That score\'s a teardown.' },
  { id: 'nannies', kind: 'observation', text: 'At a Woodside school pickup, the nannies\' cars and the parents\' Teslas fight over the same few spots.', bit: 'The real tournament is the pickup line.' },
  { id: 'camps', kind: 'observation', text: 'Woodside kids do coding camp, robotics camp and a startup accelerator before middle school.', bit: 'Your ten-year-old has a cap table.' },
  { id: 'latte', kind: 'observation', text: 'Around here a latte and a scone at the local market can cost about as much as a tank of gas.', bit: 'Fifteen-dollar lattes, oat milk extra.' },
  { id: 'neighbors', kind: 'observation', text: 'In Woodside the neighbor with the barn might also own a few billion dollars of a tech company.', bit: 'Your neighbor\'s horse has a better retirement plan than you.' },
  // Startup jargon to roast with.
  { id: 'pivot', kind: 'jargon', text: 'Startup talk: a bad game is "a pivot", a comeback is "a Series B", a drain is "burning runway", last place is "pre-revenue".', bit: 'Omar is pre-revenue.' },
  { id: 'unicorn', kind: 'jargon', text: 'Startup talk: a huge score is "a unicorn", "ten-x", "disrupting the leaderboard".', bit: 'That score just raised at a billion-dollar valuation.' },
  { id: 'vc', kind: 'jargon', text: 'Startup talk: "let\'s take this offline", "circle back", "hard pass", "term sheet", "down round".', bit: 'That game was a down round.' },
];

// Two items for the next bit, none used earlier tonight (until the bank runs out, then it starts over).
export function pickLocal(used = new Set(), n = 2, rand = Math.random) {
  let pool = LOCAL_BANK.filter(x => !used.has(x.id));
  if (pool.length < n) { used.clear(); pool = [...LOCAL_BANK]; }
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  for (const x of out) used.add(x.id);
  return out;
}
// What the booth is sent for an item: the fact plus a joke angle to riff on.
export const localLine = x => `${x.text} (joke angle: ${x.bit})`;

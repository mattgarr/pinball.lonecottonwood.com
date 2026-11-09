// Maps a machine name to its bundled art in web/public/machines/.
// Real backglass photos live at <slug>.jpg; hand-made <slug>.svg files remain as fallbacks.
// Add a slug to PHOTO_SLUGS when its .jpg is added (see web/public/machines/CREDITS.md).
const PHOTO_SLUGS = new Set(['dungeons-dragons', 'centaur', 'fathom', 'whirlwind', 'white-water', 'cactus-canyon']);

// Machines renamed after their files were made keep their original slug.
const SLUG_ALIAS = { whitewater: 'white-water' };
export function machineSlug(name) {
  const s = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return SLUG_ALIAS[s] || s;
}

export function machineArtSvg(name) {
  return `/machines/${machineSlug(name)}.svg`;
}

export function machineArt(name) {
  const slug = machineSlug(name);
  return PHOTO_SLUGS.has(slug) ? `/machines/${slug}.jpg` : `/machines/${slug}.svg`;
}

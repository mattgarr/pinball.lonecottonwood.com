// Maps a machine name to its bundled art (web/public/machines/<slug>.svg).
export function machineSlug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
export function machineArt(name) {
  return `/machines/${machineSlug(name)}.svg`;
}

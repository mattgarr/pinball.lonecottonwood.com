import { machineSlug } from './machineArt.js';

// Guide pages are plain markdown in /content, bundled at build time.
const files = import.meta.glob('../../../content/*.md', { query: '?raw', import: 'default', eager: true });
const bySlug = Object.fromEntries(
  Object.entries(files).map(([path, text]) => [path.split('/').pop().replace(/\.md$/, ''), text]),
);
const CONTENT_ALIAS = {
  'dungeons-and-dragons': 'dungeons-dragons',
  'd-d-the-tyrant-s-eye': 'dungeons-dragons',
  whitewater: 'white-water',
};
const resolveSlug = slug => CONTENT_ALIAS[slug] || slug;

export const aboutMarkdown = bySlug['about-pinball'] ?? '';
export const machineMarkdown = slug => bySlug[`machine-${resolveSlug(slug)}`] ?? null;

function stripMd(line) {
  return line
    .replace(/^-+\s*/, '')
    .replace(/\*\*#1:\*\*\s*/i, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim();
}

function parseSection(md, heading) {
  if (!md) return [];
  const re = new RegExp(`##\\s+${heading}\\s*\\n([\\s\\S]*?)(?:\\n##\\s|$)`, 'i');
  const m = md.match(re);
  if (!m) return [];
  return m[1]
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('-'))
    .map(stripMd)
    .filter(Boolean);
}

// Returns { tips: string[], facts: string[] } for a machine name or slug.
export function machineHighlights(nameOrSlug) {
  const md = machineMarkdown(machineSlug(nameOrSlug));
  return {
    tips: parseSection(md, 'Tips'),
    facts: parseSection(md, 'Fun facts'),
  };
}


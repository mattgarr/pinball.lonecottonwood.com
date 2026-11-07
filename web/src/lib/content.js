// Guide pages are plain markdown in /content, bundled at build time.
const files = import.meta.glob('../../../content/*.md', { query: '?raw', import: 'default', eager: true });
const bySlug = Object.fromEntries(
  Object.entries(files).map(([path, text]) => [path.split('/').pop().replace(/\.md$/, ''), text]),
);
export const aboutMarkdown = bySlug['about-pinball'] ?? '';
export const machineMarkdown = slug => bySlug[`machine-${slug}`] ?? null;

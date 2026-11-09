import PixelEmoji, { PixelPhoto } from './PixelEmoji.jsx';

// One avatar to rule them all: a real selfie if we have one, else the chosen emoji,
// else a monogram on the team color. Circular everywhere.
export default function Avatar({ avatar, emoji, name, color, size = 32, ring = false }) {
  const dim = { width: size, height: size };
  const ringStyle = ring ? { boxShadow: `0 0 0 2px ${color || '#fff'}` } : null;

  if (avatar && avatar.startsWith('data:image/png')) {
    // AI-drawn 8-bit portrait: already pixel art, show it as-is with hard edges.
    return (
      <span className="avatar" style={{ ...dim, ...ringStyle }}>
        <img src={avatar} alt="" className="avatar-img" draggable={false}
          style={{ width: size, height: size, imageRendering: 'pixelated', objectFit: 'cover', display: 'block' }} />
      </span>
    );
  }
  if (avatar) {
    return (
      <span className="avatar" style={{ ...dim, ...ringStyle }}>
        <PixelPhoto src={avatar} size={size} grid={size <= 34 ? 12 : size <= 70 ? 16 : 24} className="avatar-img" />
      </span>
    );
  }
  if (emoji) {
    return (
      <span className="avatar avatar-emoji" style={{ ...dim, ...ringStyle }}>
        <PixelEmoji e={emoji} size={Math.round(size * 0.78)} grid={size >= 60 ? 20 : 14} />
      </span>
    );
  }
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span className="avatar avatar-mono" style={{ ...dim, ...ringStyle, background: color || '#3a3a5a', fontSize: Math.round(size * 0.46) }}>
      {initial}
    </span>
  );
}

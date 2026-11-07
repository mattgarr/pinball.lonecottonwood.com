// One avatar to rule them all: a real selfie if we have one, else the chosen emoji,
// else a monogram on the team color. Circular everywhere.
export default function Avatar({ avatar, emoji, name, color, size = 32, ring = false }) {
  const dim = { width: size, height: size };
  const ringStyle = ring ? { boxShadow: `0 0 0 2px ${color || '#fff'}` } : null;

  if (avatar) {
    return (
      <span className="avatar" style={{ ...dim, ...ringStyle }}>
        <img className="avatar-img" src={avatar} alt="" />
      </span>
    );
  }
  if (emoji) {
    return (
      <span className="avatar avatar-emoji" style={{ ...dim, ...ringStyle, fontSize: Math.round(size * 0.6) }}>
        {emoji}
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

import { artFallback, machineArt, machineGlow } from './theme.js';

// A lit pinball backbox: dark cabinet frame, backglass art behind glass, lamp glow,
// vignette and a glint that sweeps across now and then. `i` staggers the slow animations
// so the six boxes never breathe in unison.
export default function Backbox({ machine, i = 0, className = '', children }) {
  return (
    <div className={`bb ${className}`} style={{ '--glow': machineGlow(machine.name), '--i': i }}>
      <div className="bb-lamp" aria-hidden="true" />
      <div className="bb-glass">
        <img className="bb-art" src={machineArt(machine.name)} alt={machine.name}
          onError={e => artFallback(e, machine.name)} />
        <div className="bb-vignette" aria-hidden="true" />
        <div className="bb-glint" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}

import { pinballDataUrl } from '../lib/pinballSprite.js';

const URL = pinballDataUrl();

// The app's mark: a pixel-art chrome pinball.
export default function PinballIcon({ size = 24, className = '' }) {
  return (
    <img src={URL} width={size} height={size} alt="" draggable={false} className={`px-emoji ${className}`}
      style={{ imageRendering: 'pixelated', width: size, height: size, display: 'inline-block', verticalAlign: 'middle' }} />
  );
}

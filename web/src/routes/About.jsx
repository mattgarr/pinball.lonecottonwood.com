import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { aboutMarkdown } from '../lib/content.js';
import { useParty } from '../lib/store.js';
import { MIN_TABLES, PODIUM_MIN } from '../lib/scoring.js';

export default function About() {
  const { machines } = useParty();
  const n = machines?.length || 6;
  return (
    <div className="screen guide">
      <Link className="back" to="/">← Machines</Link>
      <HowItWorks n={n} />
      <article className="markdown"><ReactMarkdown>{aboutMarkdown}</ReactMarkdown></article>
    </div>
  );
}

// The party rules in plain steps. Kept in code so the numbers match the real scoring.
function HowItWorks({ n }) {
  return (
    <article className="markdown howto">
      <h1>How the party works</h1>
      <ol className="howto-steps">
        <li><strong>Scan the QR code</strong> on any machine (or pick it on the PLAY tab).</li>
        <li><strong>Play a game.</strong> Any machine, as many times as you like.</li>
        <li>
          <strong>Snap your score.</strong> Tap 📸 Snap the score, point your camera at the score
          on the machine, then tap READY. Check the number and tap Submit (or tap "or type it in").
        </li>
        <li>
          <strong>Play {MIN_TABLES}+ machines to get ranked.</strong> 1st place on a machine = 100 pts;
          your rating is your average across the machines you play. Highest rating wins. The podium (Grand Champion, 2nd, 3rd) needs {PODIUM_MIN}+ machines.
        </li>
        <li><strong>Win prizes.</strong> Winners are announced on the TV at the end of the night.</li>
      </ol>

      <h2>Rating, by example</h2>
      <p>
        1st on one machine (100 pts) + 5th of 10 on another (60 pts) = 80 rating.
        Only your best game on each machine counts, so replaying can only help.
      </p>

      <h2>Prizes</h2>
      <p>There will be prizes! Winners are announced on the TV at the end of the night.</p>

      <h2>Good to know</h2>
      <ul>
        <li>Played with friends? Log their scores too: snap the display (it can read every player) or tap "Logging for" to pick who.</li>
        <li>Wrong number? Undo it within 15 min on the ME tab. After that, ask the host.</li>
        <li>Signed out or on another device? Sign back in with your name + PIN. Forgot it? The host can reset it.</li>
        <li>Dress code: anything you would have worn to the arcade in grade school. Neon and scrunchies encouraged.</li>
      </ul>
    </article>
  );
}

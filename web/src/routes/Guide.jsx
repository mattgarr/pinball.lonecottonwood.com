import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { useParty } from '../lib/store.js';
import { machineSlug } from '../lib/machineArt.js';
import { machineMarkdown } from '../lib/content.js';

export default function Guide() {
  const { id } = useParams();
  const { machines, ready } = useParty();
  const machine = machines.find(m => m.id === Number(id));
  const md = machine ? machineMarkdown(machineSlug(machine.name)) : null;

  return (
    <div className="screen guide">
      <Link className="back" to={`/machine/${id}`}>← Back to machine</Link>
      {!ready ? <div className="muted">Loading…</div>
        : md ? <article className="markdown"><ReactMarkdown>{md}</ReactMarkdown></article>
        : <div className="err">No guide for this machine yet.</div>}
    </div>
  );
}

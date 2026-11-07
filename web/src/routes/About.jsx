import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { aboutMarkdown } from '../lib/content.js';

export default function About() {
  return (
    <div className="screen guide">
      <Link className="back" to="/">← back to machines</Link>
      <article className="markdown"><ReactMarkdown>{aboutMarkdown}</ReactMarkdown></article>
    </div>
  );
}

import { Component } from 'react';

// Never leave people staring at a blank screen: show what broke and a way out.
export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('App crashed:', error, info?.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <div className="crash-emoji">🕹️💥</div>
        <h1>Tilt! Something went wrong.</h1>
        <p className="muted">Your scores are safe. Reload to keep going.</p>
        <button className="cta" onClick={() => location.reload()}>↻ Reload</button>
        <button className="linkbtn small" onClick={() => { location.href = '/'; }}>Go to the home screen</button>
        <pre className="crash-detail">{String(this.state.error?.message || this.state.error)}</pre>
      </div>
    );
  }
}

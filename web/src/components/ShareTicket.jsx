import { useState } from 'react';

// Shares a ticket's sign-up link so others on the same ticket can join with it too
// (used after signing up, on the "add someone" screen, and on the ME tab).
export default function ShareTicket({ invite, big, label }) {
  const [done, setDone] = useState('');
  const url = `${location.origin}/join?invite=${invite}`;
  async function share() {
    try {
      if (navigator.share) { await navigator.share({ title: 'Join me at pinball', url }); setDone('Shared!'); return; }
      await navigator.clipboard.writeText(url); setDone('Link copied. Send it to them.');
    } catch { /* cancelled */ }
  }
  return (
    <div className="share-ticket">
      <button type="button" className={big ? 'cta' : 'ghost-btn small'} onClick={share}>
        {label || (big ? 'Share the sign-up link' : 'Someone else on your ticket? Share this link')}
      </button>
      {done && <div className="muted small">{done}</div>}
    </div>
  );
}

// Turn server / network errors into plain words for guests.
// forFriend: the action was logging a score for someone else.
export function friendlyError(e, forFriend = false) {
  const m = String(e?.message || e || '');
  if (/failed to fetch|load failed|networkerror|network request|timeout|timed out/i.test(m)) {
    return 'No connection — nothing was saved. Check Wi-Fi and try again.';
  }
  if (/does not exist|could not find the function|schema cache/i.test(m)) {
    return forFriend
      ? "Logging for other players is off right now. They can log it on their phone, or ask the host."
      : 'Scoreboard is updating. Try again in a minute.';
  }
  if (/bad image/i.test(m)) return "That photo didn't work — try another.";
  if (/last 15 minutes can be undone/i.test(m)) return 'Too late to undo (15 min limit) — ask the host to fix it.';
  if (/join \(or rejoin\) first/i.test(m)) return "You're signed out. Go to Me → Sign out / switch player, sign back in, then try again.";
  if (/wrong pin|incorrect pin|pin.*(wrong|match)/i.test(m)) return "That PIN doesn't match. Try again — or find the host, they can reset it in seconds.";
  return m || 'Something went wrong. Try again.';
}

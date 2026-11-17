// Optimistic reaction toggling, shared by squad chat, DMs and feed comments.
//
// The UI applies this locally the moment you tap an emoji, then swaps in the
// server's summary when the request returns (and reverts on error). One user
// holds at most one reaction per message: tapping the same emoji removes it,
// tapping a different one moves it.

export const CHAT_REACTIONS = ['🔥', '💪', '👏', '😂', '❤️'];

export interface ChatReaction {
  emoji: string;
  count: number;
  mine: boolean;
  /** Who reacted with it (usernames, oldest first). */
  users?: string[];
}

export function toggleReaction(list: ChatReaction[] = [], emoji: string, meName?: string): ChatReaction[] {
  const current = list.find((r) => r.mine)?.emoji;
  // Take my existing reaction off first (drop the chip if it hits zero).
  const next = list
    .map((r) => (r.mine ? { ...r, count: r.count - 1, mine: false, users: r.users?.filter((u) => u !== meName) } : r))
    .filter((r) => r.count > 0);
  if (current === emoji) return next; // same emoji again = un-react
  const hit = next.find((r) => r.emoji === emoji);
  const withMe = (users: string[] = []) => (meName ? [...users, meName] : users);
  const added = hit
    ? next.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, mine: true, users: withMe(r.users) } : r))
    : [...next, { emoji, count: 1, mine: true, users: withMe() }];
  // Keep the fixed display order so chips never jump around.
  return CHAT_REACTIONS.map((e) => added.find((r) => r.emoji === e)).filter((r): r is ChatReaction => !!r);
}

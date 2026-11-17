// Chat reactions, shared by squad chat (MessageReaction) and DMs
// (DirectMessageReaction) so both read and behave the same.

// Fixed set so a reaction row stays readable and nothing arbitrary is stored.
export const MESSAGE_REACTIONS = ['🔥', '💪', '👏', '😂', '❤️'];

// Names listed per emoji. The count stays exact past this; only the list stops.
const REACTOR_NAMES_CAP = 20;

export interface ReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
  /** Who reacted with it (usernames, oldest first, capped). */
  users: string[];
}

// Grouped per emoji in the fixed order, with a count, whether the viewer is one
// of them, and who. Raw reactor ids never leave the server.
export function summarizeReactions(
  rows: { userId: string; emoji: string; user?: { username: string } | null }[],
  viewerId: string,
): ReactionSummary[] {
  const byEmoji = new Map<string, ReactionSummary>();
  for (const r of rows) {
    const entry = byEmoji.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false, users: [] };
    entry.count += 1;
    if (r.userId === viewerId) entry.mine = true;
    if (r.user?.username && entry.users.length < REACTOR_NAMES_CAP) entry.users.push(r.user.username);
    byEmoji.set(r.emoji, entry);
  }
  return MESSAGE_REACTIONS.map((e) => byEmoji.get(e)).filter((x): x is ReactionSummary => !!x);
}

// What every reaction read selects: enough to summarize, plus the name.
export const REACTION_SELECT = { userId: true, emoji: true, user: { select: { username: true } } } as const;

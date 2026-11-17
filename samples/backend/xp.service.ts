import { Injectable } from '@nestjs/common';

// New accounts are exempt from decay, and from burning streak shields, for this
// long. Shared by the nightly decay run and the session-time shield cover so
// the two can never disagree about who is still in their first days.
export const NEW_USER_GRACE_MS = 72 * 60 * 60 * 1000;

// Max minutes a single session can credit toward XP. A "9-hour session" can't
// silently win the competition — anything beyond this is capped and flagged so
// friends can dispute it. (RankUp is honor-system + social policing, not sensors.)
export const MAX_CREDIT_MINUTES = 240;

// XP-credit ceiling for a Quick Log (retro-logged yesterday after a decay hit).
// The streak repair is the prize; capped credit keeps live sessions strictly
// more valuable than after-the-fact claims.
export const QUICK_LOG_MAX_CREDIT_MINUTES = 30;

// One-time bonus on a user's FIRST ever completed session. The activation wall is
// "press Start once" — a first session that credits 0 XP (e.g. a sub-minute entry)
// gives zero reward at the most fragile moment. This guarantees the first proof
// upload always lands a visible XP/rank jump. Unfarmable: only the first session
// qualifies, so it can't be ground into rank like a flat per-session floor would.
export const FIRST_SESSION_BONUS = 50;

// Both-sides referral bonus, paid once when a referred user completes their
// FIRST session (signup alone would be farmable with throwaway emails; a
// completed proof-backed session is the activation bar). Only fires when
// referredBy matches a real username — campaign codes (x, tiktok...) skip.
export const REFERRAL_BONUS_XP = 50;

// Comeback mode (2026-09-11): the first completed session after 7+ days away
// pays the first-session bonus again. Lapsed-return is where churn is decided,
// and the screen that greets a returning user used to be streak 0 plus a decay
// toast. Placed users only (3+ prior sessions): the Placement Protocol's top-up
// reads raw xpEarned of sessions 1-2, and a bonus there would inflate it.
export const COMEBACK_BONUS_XP = FIRST_SESSION_BONUS;
export const COMEBACK_LAPSE_MS = 7 * 24 * 60 * 60 * 1000;
export const COMEBACK_MIN_PRIOR_SESSIONS = 3;

const RANK_THRESHOLDS = [
  { rank: 'S', xp: 20000 },
  { rank: 'A', xp: 10000 },
  { rank: 'B', xp: 5000 },
  { rank: 'C', xp: 2500 },
  { rank: 'D', xp: 1000 },
  { rank: 'E', xp: 0 },
];

// Diminishing returns per session. Linear credit made the leaderboard a
// duration contest ("who can leave the timer running longest") — an 8-hour
// timer beat any honest hard hour by 8x. Effort concentrates early in a
// session, so credit does too: the first hour pays full, the second half,
// anything past two hours a quarter. Applies at credit time only — no
// retroactive rewrites of already-earned XP.
const CREDIT_TIERS: { upToMinute: number; rate: number }[] = [
  { upToMinute: 60, rate: 1.0 },
  { upToMinute: 120, rate: 0.5 },
  { upToMinute: MAX_CREDIT_MINUTES, rate: 0.25 },
];

export interface XpBreakdown {
  xp: number; // final award (base + streak bonus)
  baseXp: number; // diminished-credit minutes at 1x
  streakBonusXp: number; // extra from the streak multiplier
  multiplier: number;
  creditedMinutes: number; // minutes that counted (after the 240-min cap)
  diminished: boolean; // true when the session ran past the full-rate hour
}

@Injectable()
export class XpService {
  calculateXp(durationMinutes: number, streakDays: number): number {
    return this.calculateXpDetailed(durationMinutes, streakDays).xp;
  }

  // Full math for the tap-to-see breakdown: an XP number a competitor can't
  // audit reads as rigged (the "+832 next to +0" problem), so every award has
  // to be explainable in one glance.
  calculateXpDetailed(durationMinutes: number, streakDays: number): XpBreakdown {
    const creditedMinutes = Math.max(0, Math.min(durationMinutes, MAX_CREDIT_MINUTES));
    let base = 0;
    let prevCap = 0;
    for (const tier of CREDIT_TIERS) {
      if (creditedMinutes <= prevCap) break;
      base += (Math.min(creditedMinutes, tier.upToMinute) - prevCap) * tier.rate;
      prevCap = tier.upToMinute;
    }
    const multiplier = this.getStreakMultiplier(streakDays);
    const baseXp = Math.floor(base);
    const xp = Math.floor(base * multiplier);
    return {
      xp,
      baseXp,
      streakBonusXp: xp - baseXp,
      multiplier,
      creditedMinutes,
      diminished: creditedMinutes > CREDIT_TIERS[0].upToMinute,
    };
  }

  getStreakMultiplier(streakDays: number): number {
    if (streakDays >= 30) return 2.0;
    if (streakDays >= 14) return 1.5;
    if (streakDays >= 7) return 1.25;
    return 1.0;
  }

  getRank(totalXp: number): string {
    for (const threshold of RANK_THRESHOLDS) {
      if (totalXp >= threshold.xp) return threshold.rank;
    }
    return 'E';
  }

  // The xp at which the rank for `totalXp` begins. Decay clamps to this for
  // the user's peak xp, so a rank once earned is never decayed away.
  getRankFloor(totalXp: number): number {
    for (const threshold of RANK_THRESHOLDS) {
      if (totalXp >= threshold.xp) return threshold.xp;
    }
    return 0;
  }

  // The USER'S LOCAL calendar-day number, judged in their own timezone — the
  // same stored zone DecayService uses. A UTC day boundary lands mid-afternoon
  // on the US West Coast, so counting streak days in UTC (the previous fix)
  // FROZE users who trained twice either side of that boundary and RESET users
  // whose training time drifted across it, despite perfect real-day cadence —
  // the streak-side twin of the timezone-gated decay bug. Prefers the IANA zone
  // (DST-correct), falls back to a stored offset, then to UTC for accounts that
  // have reported neither yet (old behaviour, only for un-synced rows).
  // YYYY-MM-DD for a localDayNumber, the format DayMark.day stores.
  static dayString(n: number): string {
    return new Date(n * 86_400_000).toISOString().slice(0, 10);
  }

  // The instant whose LOCAL day a session is credited to. A timed session
  // belongs to the day it STARTED: started Tuesday 11:40pm, finished Wednesday
  // 12:20am is Tuesday's session (founder call, 2026-10-04, after Stella lost
  // a day to the midnight boundary). After-the-fact logs have no real start (it is
  // back-dated from the claimed minutes), so they keep their end.
  static sessionCreditInstant(s: { startedAt: Date; endedAt?: Date | null; retroLogged?: boolean | null }): Date {
    if (s.retroLogged && s.endedAt) return s.endedAt;
    return s.startedAt;
  }

  static localDayNumber(d: Date, timezone?: string | null, offsetMinutes?: number | null): number {
    if (timezone) {
      try {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).formatToParts(d);
        const y = Number(parts.find((p) => p.type === 'year')?.value);
        const m = Number(parts.find((p) => p.type === 'month')?.value);
        const day = Number(parts.find((p) => p.type === 'day')?.value);
        if (y && m && day) return Math.floor(Date.UTC(y, m - 1, day) / 86_400_000);
      } catch {
        // Unknown/garbage zone name — drop through to the offset.
      }
    }
    // utcOffsetMinutes stores getTimezoneOffset() (minutes to ADD to local to
    // reach UTC), so local = UTC - offset. Null/absent -> UTC (offset 0).
    const off = offsetMinutes ?? 0;
    return Math.floor((d.getTime() - off * 60_000) / 86_400_000);
  }

  // LOCAL calendar days (see localDayNumber), not elapsed hours. Elapsed-hours
  // math both froze streaks for people who train at different times of day and
  // forgave real skippers; UTC-calendar days fixed that but mis-judged users far
  // from UTC. Local days are correct for everyone with a known zone/offset.
  //
  // `at` is the moment being credited. Live sessions pass their START time, so a
  // session begun at 11:40pm and finished after midnight counts for the day it
  // started (founder call, 2026-10-04); everything else passes now.
  calculateStreak(
    lastActive: Date | null,
    timezone?: string | null,
    offsetMinutes?: number | null,
    at: Date = new Date(),
  ): { newStreak: number; isNewDay: boolean } {
    if (!lastActive) return { newStreak: 1, isNewDay: true };

    const today = XpService.localDayNumber(at, timezone, offsetMinutes);
    const last = XpService.localDayNumber(new Date(lastActive), timezone, offsetMinutes);
    const diffDays = today - last;

    if (diffDays <= 0) return { newStreak: 0, isNewDay: false };
    if (diffDays === 1) return { newStreak: 1, isNewDay: true };
    return { newStreak: -999, isNewDay: true }; // streak broken
  }
}

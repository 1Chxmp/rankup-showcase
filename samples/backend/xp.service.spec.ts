import { XpService } from './xp.service';

// Guards the local-timezone streak fix. calculateStreak used to count days in
// UTC, but a UTC day boundary falls mid-afternoon on the US West Coast, so a
// user training either side of it was mis-judged: two real days collapsed into
// one (streak frozen) or a drift across the boundary looked like a skipped day
// (streak reset), despite perfect cadence. Days are now counted in the user's
// own timezone.
describe('XpService.calculateStreak — local timezone day counting', () => {
  const xp = new XpService();

  // Two sessions ~16h apart that a Pacific user experiences as consecutive
  // calendar days (Mon evening -> Tue morning), but which land on the SAME UTC
  // calendar day:
  //   Mon Aug 10 2026 6pm PDT = 2026-08-11T01:00Z
  //   Tue Aug 11 2026 10am PDT = 2026-08-11T17:00Z   (both are UTC Aug 11)
  const lastActive = new Date('2026-08-11T01:00:00Z');
  const now = new Date('2026-08-11T17:00:00Z');

  beforeEach(() => jest.useFakeTimers().setSystemTime(now));
  afterEach(() => jest.useRealTimers());

  it('counts the Pacific user as a new day (streak increments) with an IANA zone', () => {
    // Local: Aug 10 -> Aug 11 = 1 day. Correct behavior.
    expect(xp.calculateStreak(lastActive, 'America/Los_Angeles')).toEqual({
      newStreak: 1,
      isNewDay: true,
    });
  });

  it('reproduces the old UTC bug when no zone/offset is known (froze the streak)', () => {
    // Both instants are UTC Aug 11 -> diff 0 -> not a new day -> streak frozen.
    // This is the pre-fix behavior, retained only for accounts with no zone yet.
    expect(xp.calculateStreak(lastActive, null, null)).toEqual({
      newStreak: 0,
      isNewDay: false,
    });
  });

  it('uses the stored offset when there is no zone name', () => {
    // PDT getTimezoneOffset() = 420 (UTC-7). Local: Aug 10 -> Aug 11 = 1 day.
    expect(xp.calculateStreak(lastActive, null, 420)).toEqual({
      newStreak: 1,
      isNewDay: true,
    });
  });

  it('still detects a genuine skipped day in local time (streak breaks)', () => {
    // Fri 6pm PDT then Mon 10am PDT — Sat & Sun untrained -> gap 3 local days.
    jest.setSystemTime(new Date('2026-08-17T17:00:00Z')); // Mon Aug 17 10am PDT
    const friday = new Date('2026-08-15T01:00:00Z'); // Fri Aug 14 6pm PDT
    expect(xp.calculateStreak(friday, 'America/Los_Angeles')).toEqual({
      newStreak: -999,
      isNewDay: true,
    });
  });

  it('does not double-count two sessions on the same local day', () => {
    const earlier = new Date('2026-08-11T16:00:00Z'); // Tue 9am PDT
    // now is Tue 10am PDT, same local day -> no increment.
    expect(xp.calculateStreak(earlier, 'America/Los_Angeles')).toEqual({
      newStreak: 0,
      isNewDay: false,
    });
  });

  it('first-ever session (null lastActive) starts the streak at 1', () => {
    expect(xp.calculateStreak(null, 'America/Los_Angeles')).toEqual({
      newStreak: 1,
      isNewDay: true,
    });
  });
});

describe('XpService.localDayNumber', () => {
  it('assigns a late-evening Pacific instant to the correct local (earlier) day', () => {
    const instant = new Date('2026-08-11T01:00:00Z'); // Aug 10 6pm PDT
    const utcDay = XpService.localDayNumber(instant, null, null);
    const laDay = XpService.localDayNumber(instant, 'America/Los_Angeles');
    // In LA it is still Aug 10; in UTC it is Aug 11 — one day apart.
    expect(utcDay - laDay).toBe(1);
  });

  it('falls back to UTC for a garbage zone name rather than throwing', () => {
    const instant = new Date('2026-08-11T01:00:00Z');
    expect(XpService.localDayNumber(instant, 'Not/AZone', null)).toBe(
      XpService.localDayNumber(instant, null, null),
    );
  });
});

// Guards the diminishing-returns credit curve. Linear credit made the
// leaderboard a duration contest — an 8-hour timer beat any honest hard hour
// 8x, so the rational play was "leave the timer running", not "train hard".
// The curve pays the first hour full (1/min), the second half, hours 3-4 a
// quarter, and nothing past the existing 240-min cap. The breakdown exists so
// every award is auditable in one glance (the "+832 next to +0" problem).
describe('XpService.calculateXpDetailed — diminishing returns + auditable breakdown', () => {
  const xp = new XpService();

  it('pays the first hour at full rate', () => {
    expect(xp.calculateXpDetailed(45, 0)).toMatchObject({
      xp: 45, baseXp: 45, streakBonusXp: 0, creditedMinutes: 45, diminished: false,
    });
  });

  it('halves the second hour', () => {
    // 60 + 30*0.5 = 75
    expect(xp.calculateXpDetailed(90, 0)).toMatchObject({ xp: 75, diminished: true });
  });

  it('quarters hours three and four, so max base is 120 not 240', () => {
    // 60 + 60*0.5 + 120*0.25 = 120
    expect(xp.calculateXpDetailed(240, 0)).toMatchObject({ xp: 120, baseXp: 120 });
  });

  it('still caps credited minutes at 240 — a 9-hour timer earns the same 120', () => {
    expect(xp.calculateXpDetailed(540, 0)).toMatchObject({ xp: 120, creditedMinutes: 240 });
  });

  it('applies the streak multiplier on top and reports the bonus separately', () => {
    // base 75, x2.0 at 30-day streak -> 150 total, 75 of it streak bonus
    expect(xp.calculateXpDetailed(90, 30)).toMatchObject({
      xp: 150, baseXp: 75, streakBonusXp: 75, multiplier: 2.0,
    });
  });

  it('keeps calculateXp as the same math (single source of truth)', () => {
    expect(xp.calculateXp(90, 30)).toBe(150);
    expect(xp.calculateXp(45, 0)).toBe(45);
  });

  it('a sub-minute session credits 0 — the visible "+0 XP" case, now explainable', () => {
    expect(xp.calculateXpDetailed(0, 12)).toMatchObject({ xp: 0, creditedMinutes: 0 });
  });
});

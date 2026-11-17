import { XpService } from './xp.service';

// Rest days are LOCAL calendar days (audit 2026-10-14).
//
// restDayAt used to be stored as UTC midnight of the UTC date the request
// arrived on, and decay compared it against UTC "yesterday" while judging each
// user at THEIR local 3am. A US user declaring "today" at 9pm local (already
// tomorrow in UTC) got a rest day for the wrong date, and a UTC+9 user's rest
// day had already been consumed (or missed) by the time their night ended.
//
// The stored value is now a day LABEL: UTC midnight of the user's local day
// number, the same convention DayMark rows use (see DecayService.writeMarks).
// Everything compares day numbers, never instants.

type Zone = { timezone?: string | null; utcOffsetMinutes?: number | null };

/** The stored label for local day number `n` (UTC midnight of that date). */
export function dayLabel(n: number): Date {
  return new Date(n * 86_400_000);
}

/** The local day number a stored label stands for. */
export function labelDay(label: Date): number {
  return Math.floor(label.getTime() / 86_400_000);
}

/** The label to store when a user schedules a rest day for 'today' or 'tomorrow'. */
export function restDayLabelFor(now: Date, when: 'today' | 'tomorrow', zone: Zone): Date {
  const today = XpService.localDayNumber(now, zone.timezone, zone.utcOffsetMinutes);
  return dayLabel(today + (when === 'tomorrow' ? 1 : 0));
}

/** True when `rest` labels the local day that has just ended (decay runs at local ~3am). */
export function restDayJustEnded(rest: Date | null | undefined, now: Date, zone: Zone): boolean {
  if (!rest) return false;
  return labelDay(rest) === XpService.localDayNumber(now, zone.timezone, zone.utcOffsetMinutes) - 1;
}

/** True when `rest` labels the user's current local day. */
export function restDayIsToday(rest: Date | null | undefined, now: Date, zone: Zone): boolean {
  if (!rest) return false;
  return labelDay(rest) === XpService.localDayNumber(now, zone.timezone, zone.utcOffsetMinutes);
}

/**
 * An instant on the user's LOCAL yesterday, around 20:00 local: the latest
 * hour that is still yesterday, minus three hours. Quick Log books its repair
 * session here; it used to be "UTC midnight minus 4h", which for a UTC+9 user
 * is 05:00 local TODAY and for a US user can be two local days back.
 */
export function localYesterdayEvening(now: Date, zone: Zone): Date {
  const today = XpService.localDayNumber(now, zone.timezone, zone.utcOffsetMinutes);
  let t = now.getTime();
  // At most ~26 steps back (UTC+14 / DST edges); bounded so a bad zone cannot loop.
  for (let i = 0; i < 30 && XpService.localDayNumber(new Date(t), zone.timezone, zone.utcOffsetMinutes) >= today; i++) {
    t -= 3_600_000;
  }
  return new Date(t - 3 * 3_600_000);
}

import { restDayLabelFor, restDayJustEnded, restDayIsToday, localYesterdayEvening, labelDay } from './rest-day';
import { XpService } from './xp.service';

// Audit 2026-10-14: rest days were stored as UTC midnight of the UTC date and
// judged against UTC "yesterday", while decay runs at each user's LOCAL 3am.

const NY = { timezone: 'America/New_York', utcOffsetMinutes: 240 };
const TOKYO = { timezone: 'Asia/Tokyo', utcOffsetMinutes: -540 };
const iso = (d: Date) => d.toISOString().slice(0, 10);
// Local hour in a timezone (the decay job judges each user at their local 3am).
const localHour = (d: Date, tz: string) =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(d));

describe('rest day labels follow the user\'s local calendar', () => {
  it('US evening: "today" at 21:00 New York (already the 15th in UTC) is the 14th', () => {
    const now = new Date('2026-10-15T01:00:00Z'); // 21:00 on the 14th in New York
    expect(iso(restDayLabelFor(now, 'today', NY))).toBe('2026-10-14');
    expect(iso(restDayLabelFor(now, 'tomorrow', NY))).toBe('2026-10-15');
  });

  it('UTC+9 morning: "today" at 08:00 Tokyo (still the 13th in UTC) is the 14th', () => {
    const now = new Date('2026-10-13T23:00:00Z'); // 08:00 on the 14th in Tokyo
    expect(iso(restDayLabelFor(now, 'today', TOKYO))).toBe('2026-10-14');
  });

  it('the New York rest day is honoured at New York 3am the next morning', () => {
    const rest = restDayLabelFor(new Date('2026-10-15T01:00:00Z'), 'today', NY); // the 14th
    const judged = new Date('2026-10-15T07:00:00Z'); // 03:00 on the 15th in New York
    expect(localHour(judged, NY.timezone)).toBe(3);
    expect(restDayJustEnded(rest, judged, NY)).toBe(true);
    // ...and not a night early (03:00 on the 14th) or a night late.
    expect(restDayJustEnded(rest, new Date('2026-10-14T07:00:00Z'), NY)).toBe(false);
    expect(restDayJustEnded(rest, new Date('2026-10-16T07:00:00Z'), NY)).toBe(false);
  });

  it('the Tokyo rest day is honoured at Tokyo 3am, which is still the same UTC date', () => {
    const rest = restDayLabelFor(new Date('2026-10-13T23:00:00Z'), 'today', TOKYO); // the 14th
    const judged = new Date('2026-10-14T18:00:00Z'); // 03:00 on the 15th in Tokyo
    expect(localHour(judged, TOKYO.timezone)).toBe(3);
    expect(restDayJustEnded(rest, judged, TOKYO)).toBe(true);
    // The old UTC rule would have looked for the 13th here and missed it.
    expect(iso(rest)).toBe('2026-10-14');
  });

  it('warnDecay sees a rest day scheduled for today in local time', () => {
    const rest = restDayLabelFor(new Date('2026-10-13T23:00:00Z'), 'today', TOKYO);
    expect(restDayIsToday(rest, new Date('2026-10-14T09:00:00Z'), TOKYO)).toBe(true); // 18:00 Tokyo
    expect(restDayIsToday(rest, new Date('2026-10-14T16:00:00Z'), TOKYO)).toBe(false); // 01:00 next day
  });
});

describe('localYesterdayEvening (Quick Log repair session)', () => {
  for (const [name, zone, now] of [
    ['New York', NY, new Date('2026-10-15T01:00:00Z')],
    ['Tokyo', TOKYO, new Date('2026-10-14T00:30:00Z')],
    ['no zone (UTC)', { timezone: null, utcOffsetMinutes: null }, new Date('2026-10-14T00:10:00Z')],
  ] as const) {
    it(`lands on the local day before today, in the evening, for ${name}`, () => {
      const at = localYesterdayEvening(now, zone);
      const today = XpService.localDayNumber(now, zone.timezone, zone.utcOffsetMinutes);
      expect(XpService.localDayNumber(at, zone.timezone, zone.utcOffsetMinutes)).toBe(today - 1);
      const hour = zone.timezone ? localHour(at, zone.timezone) : at.getUTCHours();
      expect(hour).toBeGreaterThanOrEqual(19);
      expect(hour).toBeLessThanOrEqual(21);
      expect(at.getTime()).toBeLessThan(now.getTime());
    });
  }
});

describe('stored labels', () => {
  it('labelDay round-trips the stored label', () => {
    const label = restDayLabelFor(new Date('2026-10-14T12:00:00Z'), 'today', { timezone: 'UTC' });
    expect(labelDay(label)).toBe(XpService.localDayNumber(new Date('2026-10-14T12:00:00Z'), 'UTC'));
  });
});

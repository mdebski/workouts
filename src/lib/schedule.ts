import { addDays, diffDays, fmtShort, maxISO, weekday } from './dates.ts';
import type { ISODate, Schedule } from './types.ts';

/** Upper bound on how far ahead we ever look, so a bad rule can't loop forever. */
const MAX_SCAN_DAYS = 3660;

export function matches(s: Schedule, date: ISODate): boolean {
  if (date < s.start) return false;
  if (s.repeat.kind === 'interval') return diffDays(s.start, date) % Math.max(1, s.repeat.days) === 0;
  return s.repeat.days.includes(weekday(date));
}

/** Dates on or after `from` that the repeat rule hits, ignoring the end condition. */
export function* occurrences(s: Schedule, from: ISODate = s.start): Generator<ISODate> {
  if (s.repeat.kind === 'weekdays' && s.repeat.days.length === 0) return;
  let date = maxISO(s.start, from);
  for (let i = 0; i < MAX_SCAN_DAYS; i++, date = addDays(date, 1)) {
    if (matches(s, date)) yield date;
  }
}

/** The last day a programme can have a workout on, if its end is tied to the calendar. */
export function lastDay(s: Schedule): ISODate | undefined {
  if (s.end.kind === 'until') return s.end.date;
  if (s.end.kind === 'weeks') return addDays(s.start, Math.max(1, s.end.n) * 7 - 1);
  return undefined;
}

export function describeEnd(s: Schedule): string {
  const { end } = s;
  if (end.kind === 'count') return end.n === 1 ? '1 workout' : `${end.n} workouts`;
  if (end.kind === 'weeks') return end.n === 1 ? 'for 1 week' : `for ${end.n} weeks`;
  if (end.kind === 'until') return `until ${fmtShort(end.date)}`;
  return 'no end date';
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function describeRepeat(s: Schedule): string {
  if (s.repeat.kind === 'interval') {
    const n = s.repeat.days;
    return n === 1 ? 'Every day' : n === 2 ? 'Every other day' : `Every ${n} days`;
  }
  const days = [...s.repeat.days].sort((a, b) => a - b);
  if (days.length === 7) return 'Every day';
  return days.length ? days.map((d) => DAY_NAMES[d - 1]).join(', ') : 'No days chosen';
}

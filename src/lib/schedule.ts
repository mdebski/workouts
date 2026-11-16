import { addDays, diffDays, maxISO, weekday } from './dates.ts';
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

// Durations typed by hand: "45" (seconds by default), "45s", "5min", "1.5 min",
// "1h", "1h 30min", "1m30s" or "1:30" (minutes:seconds; "1:02:03" adds hours).

const UNITS: Record<string, number> = {
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
};

export type DurationUnit = 's' | 'min';

/**
 * Parses a duration into seconds. A bare number is read in `bare` units.
 * Returns undefined for empty input and NaN for input that can't be read.
 */
export function parseDuration(text: string, bare: DurationUnit = 's'): number | undefined {
  const t = text.trim().toLowerCase().replace(/,/g, '.');
  if (!t) return undefined;

  const clock = t.match(/^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/);
  if (clock) {
    const [a, b, c] = [clock[1], clock[2], clock[3]].map((x) => (x === undefined ? undefined : Number(x)));
    return c === undefined ? a! * 60 + b! : a! * 3600 + b! * 60 + c;
  }

  const bareNumber = t.match(/^\d+(?:\.\d+)?$/);
  if (bareNumber) return Math.round(Number(t) * (bare === 'min' ? 60 : 1) * 100) / 100;

  let total = 0;
  let rest = t;
  const part = /^\s*(\d+(?:\.\d+)?)\s*([a-z]+)\s*/;
  for (let m = rest.match(part); m; m = rest.match(part)) {
    const unit = UNITS[m[2]];
    if (unit === undefined) return NaN;
    total += Number(m[1]) * unit;
    rest = rest.slice(m[0].length);
  }
  return rest === '' && t !== '' ? Math.round(total * 100) / 100 : NaN;
}

/** Formats seconds the way people write them: "45s", "5min", "1min 30s", "1h 15min". */
export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [h && `${h}h`, m && `${m}min`, sec && `${sec}s`].filter(Boolean);
  return parts.length ? parts.join(' ') : '0s';
}

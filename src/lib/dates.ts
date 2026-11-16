import type { ISODate } from './types.ts';

const DAY = 86_400_000;

const utc = (iso: ISODate) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

export function toISO(d: Date): ISODate {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const today = (): ISODate => toISO(new Date());

export function addDays(iso: ISODate, n: number): ISODate {
  return new Date(utc(iso) + n * DAY).toISOString().slice(0, 10);
}

export const diffDays = (from: ISODate, to: ISODate) => Math.round((utc(to) - utc(from)) / DAY);

/** 1 = Monday … 7 = Sunday */
export const weekday = (iso: ISODate) => ((new Date(utc(iso)).getUTCDay() + 6) % 7) + 1;

export const maxISO = (a: ISODate, b: ISODate) => (a > b ? a : b);

export const isISODate = (s: unknown): s is ISODate =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(utc(s));

const fmt = (opts: Intl.DateTimeFormatOptions) => {
  const f = new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' });
  return (iso: ISODate) => f.format(utc(iso));
};

export const fmtDay = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
export const fmtShort = fmt({ day: 'numeric', month: 'short' });
export const fmtWeekday = fmt({ weekday: 'short' });
export const fmtMonth = fmt({ month: 'long', year: 'numeric' });
export const fmtLong = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
